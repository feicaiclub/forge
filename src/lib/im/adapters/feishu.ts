/**
 * Feishu (Lark) adapter — uses official @larksuiteoapi/node-sdk WSClient.
 * SDK handles WebSocket connection, heartbeat, and reconnection internally.
 * All outbound connections, no public endpoint needed.
 */

import { ChannelAdapter } from './base'
import { registerAdapter } from './registry'
import type { ChannelType, IncomingMessage, OutboundMessage, ImPermissionRequest } from '../types'
import * as Lark from '@larksuiteoapi/node-sdk'

// ---------------------------------------------------------------------------
// Adapter implementation
// ---------------------------------------------------------------------------

export class FeishuAdapter extends ChannelAdapter {
  readonly channelType: ChannelType = 'feishu'

  private client: Lark.Client | null = null
  private wsClient: InstanceType<typeof Lark.WSClient> | null = null
  private running = false
  private botOpenId = ''
  /** All known bot IDs (open_id, user_id, union_id, bot_id) for mention matching. */
  private botIds = new Set<string>()
  private platform: 'feishu' | 'lark' = 'feishu'
  private appId = ''
  private appSecret = ''

  // Internal message queue: SDK events fill, consumeOne drains
  private messageQueue: IncomingMessage[] = []
  private messageWaiter: ((msg: IncomingMessage | null) => void) | null = null

  // Watchdog: detect silent WSClient disconnection (P7 fix)
  private lastEventTime = 0
  private static readonly WATCHDOG_TIMEOUT_MS = 120_000 // 2 minutes
  private static readonly STALE_THRESHOLD_MS = 180_000  // 3 minutes without any event → assume dead

  // Permission response callback
  private permissionCallback: ((requestId: string, decision: 'allow' | 'deny') => void) | null = null

  // Track pending permission request per chat for simplified "allow"/"deny" responses (P30: also tracks senderId)
  private pendingPermByChat = new Map<string, { requestIdPrefix: string; senderId: string }>() // chatId → { requestIdPrefix, senderId }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async start(config: Record<string, string>): Promise<void> {
    if (!config.app_id || !config.app_secret) {
      throw new Error('Feishu app_id and app_secret are required')
    }

    this.appId = config.app_id
    this.appSecret = config.app_secret
    this.platform = (config.platform === 'lark') ? 'lark' : 'feishu'
    const domain = this.platform === 'lark' ? Lark.Domain.Lark : Lark.Domain.Feishu

    const sdkConfig = {
      appId: config.app_id,
      appSecret: config.app_secret,
      domain,
      appType: Lark.AppType.SelfBuild,
    }

    // Create REST client for sending messages
    this.client = new Lark.Client(sdkConfig)

    // Fetch bot info for @mention detection
    await this.fetchBotInfo()

    // Create event dispatcher
    const dispatcher = new Lark.EventDispatcher({}).register({
      'im.message.receive_v1': async (data) => {
        this.handleIncomingMessage(data)
      },
    })

    // Create and start WSClient
    // Disable SDK's internal auto-reconnect since BridgeManager handles reconnection
    // with its own exponential backoff + circuit breaker strategy
    this.wsClient = new Lark.WSClient({
      ...sdkConfig,
      loggerLevel: Lark.LoggerLevel.info,
      autoReconnect: false,
    })
    await this.wsClient.start({ eventDispatcher: dispatcher })

    this.running = true
    this.lastEventTime = Date.now()
    console.log(`[Feishu] Connected via SDK WSClient (${this.platform}), botOpenId=${this.botOpenId || 'unknown'}, botIds=[${[...this.botIds].join(', ')}]`)
  }

  async stop(): Promise<void> {
    this.running = false

    // Close WebSocket connection using SDK's close() method
    if (this.wsClient) {
      try {
        this.wsClient.close({ force: true })
      } catch (err) {
        console.warn('[Feishu] WSClient close error:', err instanceof Error ? err.message : err)
      }
      this.wsClient = null
    }
    this.client = null

    // Drain waiters
    if (this.messageWaiter) {
      this.messageWaiter(null)
      this.messageWaiter = null
    }
    this.messageQueue = []

    // Clear bot identity state
    this.botOpenId = ''
    this.botIds.clear()
    this.pendingPermByChat.clear()
    this.lastEventTime = 0

    console.log('[Feishu] Stopped')
  }

  isRunning(): boolean {
    return this.running
  }

  // ---------------------------------------------------------------------------
  // Message consumption (pull model)
  // ---------------------------------------------------------------------------

  async consumeOne(signal: AbortSignal): Promise<IncomingMessage | null> {
    if (this.messageQueue.length > 0) {
      return this.messageQueue.shift()!
    }

    // Guard: if signal already aborted, return immediately to avoid dangling waiter
    if (signal.aborted) return null

    return new Promise<IncomingMessage | null>((resolve) => {
      let resolved = false

      const cleanup = () => {
        if (resolved) return
        resolved = true
        clearTimeout(watchdog)
        this.messageWaiter = null
      }

      // Watchdog: prevent hanging forever if WSClient silently disconnects (P7 fix)
      const watchdog = setTimeout(() => {
        const sinceLastEvent = Date.now() - this.lastEventTime
        if (sinceLastEvent >= FeishuAdapter.STALE_THRESHOLD_MS) {
          console.warn(`[Feishu] No events for ${Math.round(sinceLastEvent / 1000)}s — assuming WSClient disconnected`)
          this.running = false
        }
        cleanup()
        resolve(null)
      }, FeishuAdapter.WATCHDOG_TIMEOUT_MS)

      // IMPORTANT: set messageWaiter BEFORE addEventListener to prevent dangling waiter
      // If signal is already aborted, addEventListener fires onAbort synchronously,
      // which clears messageWaiter. Setting it first ensures cleanup works correctly.
      this.messageWaiter = (msg) => {
        signal.removeEventListener('abort', onAbort)
        cleanup()
        resolve(msg)
      }

      const onAbort = () => {
        cleanup()
        resolve(null)
      }
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  // ---------------------------------------------------------------------------
  // Outbound messaging
  // ---------------------------------------------------------------------------

  async send(msg: OutboundMessage): Promise<string | undefined> {
    if (!this.client) throw new Error('Feishu client not initialized')

    // Edit existing message
    if (msg.editMessageId) {
      try {
        await this.client.im.message.update({
          path: { message_id: msg.editMessageId },
          data: {
            msg_type: 'text',
            content: JSON.stringify({ text: msg.text }),
          },
        })
        return msg.editMessageId
      } catch {
        // Fall through to send new message if edit fails
      }
    }

    // Delete message
    if (msg.deleteMessageId) {
      try {
        await this.client.im.message.delete({
          path: { message_id: msg.deleteMessageId },
        })
      } catch { /* ignore */ }
      return undefined
    }

    // Send new message
    const result = await this.client.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: msg.chatId,
        msg_type: 'text',
        content: JSON.stringify({ text: msg.text }),
      },
    })

    return result.data?.message_id
  }

  async sendImage(chatId: string, imageBuffer: Buffer, caption?: string): Promise<void> {
    if (!this.client) {
      if (caption) await this.send({ chatId, text: `[Image] ${caption}` })
      return
    }

    try {
      // Upload image first
      const apiBase = this.platform === 'lark' ? 'https://open.larksuite.com/open-apis' : 'https://open.feishu.cn/open-apis'
      const tokenRes = await fetch(`${apiBase}/auth/v3/tenant_access_token/internal`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: this.appId, app_secret: this.appSecret }),
      })
      const tokenData = await tokenRes.json() as { tenant_access_token?: string }
      if (!tokenData.tenant_access_token) throw new Error('No token')

      const formData = new FormData()
      formData.append('image_type', 'message')
      formData.append('image', new Blob([new Uint8Array(imageBuffer)], { type: 'image/png' }), 'image.png')

      const uploadRes = await fetch(`${apiBase}/im/v1/images`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${tokenData.tenant_access_token}` },
        body: formData,
      })
      const uploadData = await uploadRes.json() as { data?: { image_key?: string } }
      const imageKey = uploadData.data?.image_key

      if (imageKey) {
        await this.client.im.message.create({
          params: { receive_id_type: 'chat_id' },
          data: { receive_id: chatId, msg_type: 'image', content: JSON.stringify({ image_key: imageKey }) },
        })
        if (caption) await this.send({ chatId, text: caption })
      } else {
        if (caption) await this.send({ chatId, text: `[Image] ${caption}` })
      }
    } catch (err) {
      console.warn('[Feishu] sendImage failed:', err instanceof Error ? err.message : err)
      if (caption) await this.send({ chatId, text: `[Image] ${caption}` })
    }
  }

  async sendTypingIndicator(_chatId: string): Promise<void> {
    // Feishu doesn't have a typing indicator API
  }

  // ---------------------------------------------------------------------------
  // Permission UI
  // ---------------------------------------------------------------------------

  async sendPermissionPrompt(req: ImPermissionRequest): Promise<void> {
    const inputSummary = Object.entries(req.toolInput)
      .map(([k, v]) => `${k}: ${String(v).slice(0, 50)}`)
      .join('\n')

    // If there's already a pending request for this chat, the old one becomes stale (P23 fix)
    const existing = this.pendingPermByChat.get(req.chatId)
    if (existing) {
      console.warn(`[Feishu] Overwriting pending permission for chat=${req.chatId} (old=${existing.requestIdPrefix}, new=${req.requestId.slice(0, 8)})`)
    }
    // Track this request for simplified responses (P30: also track senderId for verification)
    this.pendingPermByChat.set(req.chatId, { requestIdPrefix: req.requestId.slice(0, 8), senderId: req.senderId })

    const text = `🔐 需要你的授权\n\nForge 想要使用 ${req.toolName}：\n${inputSummary}\n\n回复"允许"或"拒绝"`

    await this.send({ chatId: req.chatId, text })
  }

  onPermissionResponse(callback: (requestId: string, decision: 'allow' | 'deny') => void): void {
    this.permissionCallback = callback
  }

  // ---------------------------------------------------------------------------
  // Config validation
  // ---------------------------------------------------------------------------

  validateConfig(config: Record<string, string>): { valid: boolean; error?: string } {
    if (!config.app_id) return { valid: false, error: 'app_id is required' }
    if (!config.app_secret) return { valid: false, error: 'app_secret is required' }
    return { valid: true }
  }

  // ---------------------------------------------------------------------------
  // Internal: Bot info
  // ---------------------------------------------------------------------------

  private async fetchBotInfo(): Promise<void> {
    const success = await this.tryFetchBotInfo()
    if (!success && this.running) {
      // Schedule background retries with exponential backoff (P19 fix)
      this.retryFetchBotInfo()
    }
  }

  private async tryFetchBotInfo(): Promise<boolean> {
    try {
      const apiBase = this.platform === 'lark'
        ? 'https://open.larksuite.com/open-apis'
        : 'https://open.feishu.cn/open-apis'
      const tokenRes = await fetch(`${apiBase}/auth/v3/tenant_access_token/internal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: this.appId, app_secret: this.appSecret }),
        signal: AbortSignal.timeout(10_000),
      })
      if (!tokenRes.ok) {
        console.warn(`[Feishu] fetchBotInfo: token request failed (HTTP ${tokenRes.status})`)
        return false
      }
      const tokenData = await tokenRes.json() as { tenant_access_token?: string; code?: number }
      if (tokenData.code !== 0 || !tokenData.tenant_access_token) {
        console.warn(`[Feishu] fetchBotInfo: token response error (code=${tokenData.code})`)
        return false
      }

      const res = await fetch(`${apiBase}/bot/v3/info`, {
        headers: { 'Authorization': `Bearer ${tokenData.tenant_access_token}` },
        signal: AbortSignal.timeout(10_000),
      })
      if (res.ok) {
        const data = await res.json() as { bot?: { open_id?: string; bot_id?: string } }
        if (data.bot?.open_id) {
          this.botOpenId = data.bot.open_id
          this.botIds.add(data.bot.open_id)
        }
        if (data.bot?.bot_id) {
          this.botIds.add(data.bot.bot_id)
        }
        console.log(`[Feishu] Bot identity resolved: open_id=${this.botOpenId || 'unknown'}, botIds=[${[...this.botIds].join(', ')}]`)
        return this.botIds.size > 0
      } else {
        console.warn(`[Feishu] fetchBotInfo: bot info request failed (HTTP ${res.status})`)
        return false
      }
    } catch (err) {
      console.warn('[Feishu] Failed to fetch bot info:', err instanceof Error ? err.message : err)
      return false
    }
  }

  /** Background retry for fetchBotInfo with exponential backoff (P19 fix) */
  private retryFetchBotInfo(): void {
    const maxRetries = 3
    let attempt = 0
    const retry = () => {
      if (!this.running || this.botIds.size > 0) return
      attempt++
      const delay = Math.min(5000 * Math.pow(2, attempt - 1), 30_000) // 5s, 10s, 20s
      console.warn(`[Feishu] Bot info retry scheduled in ${delay}ms (attempt ${attempt}/${maxRetries})`)
      setTimeout(async () => {
        if (!this.running || this.botIds.size > 0) return
        const success = await this.tryFetchBotInfo()
        if (!success && attempt < maxRetries) {
          retry()
        } else if (!success) {
          console.warn('[Feishu] Could not resolve bot identity after retries — group @mention detection will not work')
        }
      }, delay)
    }
    retry()
  }

  // ---------------------------------------------------------------------------
  // Internal: Incoming message handler (called by SDK EventDispatcher)
  // ---------------------------------------------------------------------------

  private async handleIncomingMessage(data: unknown): Promise<void> {
    this.lastEventTime = Date.now()
    try {
      const event = data as {
        message?: {
          message_id?: string
          message_type?: string
          chat_id?: string
          chat_type?: string
          content?: string
          mentions?: Array<{
            key?: string
            name?: string
            id?: { open_id?: string; union_id?: string; user_id?: string }
          }>
        }
        sender?: {
          sender_id?: { open_id?: string; union_id?: string; user_id?: string }
          sender_type?: string
          tenant_key?: string
        }
      }

      const message = event.message
      const sender = event.sender
      if (!message || !sender) {
        console.warn('[Feishu] Received event with missing message or sender')
        return
      }

      const chatId = message.chat_id || ''
      const chatType = message.chat_type || ''
      const senderId = sender.sender_id?.open_id || ''

      const msgId = message.message_id || ''
      console.log(`[Feishu] Incoming: type=${message.message_type}, chat=${chatId}, chatType=${chatType}, sender=${senderId}, msgId=${msgId}`)

      const isDm = chatType === 'p2p'
      const msgType = message.message_type || ''

      // Unsupported message types
      if (['audio', 'video', 'sticker', 'share_chat', 'share_user', 'location'].includes(msgType)) {
        console.log(`[Feishu] Unsupported message type: ${msgType}`)
        if (this.client) {
          this.send({ chatId, text: '⚠️ 暂不支持该消息类型，请发送文字、图片或文件。' }).catch(() => {})
        }
        return
      }

      // Image message
      if (msgType === 'image') {
        try {
          const content = JSON.parse(message.content || '{}') as { image_key?: string }
          if (content.image_key && msgId) {
            const imageData = await this.downloadFeishuResource(msgId, content.image_key, 'image')
            const isGroupMention = !isDm || true // Images in DM always processed
            const incoming: IncomingMessage = {
              channelType: 'feishu', channelId: 'feishu', chatId, messageId: msgId, senderId, senderName: 'User',
              text: '', isDm, isGroupMention: !isDm ? this.isBotMentioned(message.mentions) || true : false,
              images: [{ data: imageData.toString('base64'), mimeType: 'image/png', name: 'image.png' }],
            }
            this.enqueueMessage(incoming)
            return
          }
        } catch (err) {
          console.error('[Feishu] Failed to download image:', err instanceof Error ? err.message : err)
        }
        return
      }

      // File message
      if (msgType === 'file') {
        try {
          const content = JSON.parse(message.content || '{}') as { file_key?: string; file_name?: string }
          if (content.file_key && msgId) {
            const fileData = await this.downloadFeishuResource(msgId, content.file_key, 'file')
            const incoming: IncomingMessage = {
              channelType: 'feishu', channelId: 'feishu', chatId, messageId: msgId, senderId, senderName: 'User',
              text: '', isDm, isGroupMention: !isDm ? true : false,
              files: [{ data: fileData, name: content.file_name || 'file', mimeType: 'application/octet-stream', size: fileData.length }],
            }
            this.enqueueMessage(incoming)
            return
          }
        } catch (err) {
          console.error('[Feishu] Failed to download file:', err instanceof Error ? err.message : err)
        }
        return
      }

      // Text message (original logic)
      if (msgType !== 'text') {
        console.log(`[Feishu] Skipping unhandled message type: ${msgType}`)
        return
      }

      let text = ''
      try {
        const content = JSON.parse(message.content || '{}') as { text?: string }
        text = content.text || ''
      } catch {
        console.warn('[Feishu] Failed to parse message content:', message.content)
        return
      }

      if (!text.trim()) return

      // Handle permission responses: /perm command or simple allow/deny text
      if (text.startsWith('/perm ')) {
        this.handlePermCommand(text, chatId, senderId)
        return
      }
      if (this.handleSimplePermResponse(text, chatId, senderId)) {
        return
      }

      const isGroupMention = !isDm && this.isBotMentioned(message.mentions)

      console.log(`[Feishu] Message parsed: isDm=${isDm}, isGroupMention=${isGroupMention}, text="${text.slice(0, 50)}${text.length > 50 ? '...' : ''}"`)

      const incoming: IncomingMessage = {
        channelType: 'feishu',
        channelId: 'feishu',
        chatId,
        messageId: msgId,
        senderId,
        senderName: 'User',
        text: text.replace(/@_user_\d+/g, '').trim(),
        isDm,
        isGroupMention,
      }

      this.enqueueMessage(incoming)
    } catch (err) {
      console.error('[Feishu] Error handling incoming message:', err)
    }
  }

  /**
   * Check if bot is mentioned — matches against all known bot IDs
   * (open_id, user_id, union_id, bot_id).
   */
  private isBotMentioned(
    mentions?: Array<{
      key?: string
      name?: string
      id?: { open_id?: string; union_id?: string; user_id?: string }
    }>,
  ): boolean {
    if (!mentions || this.botIds.size === 0) {
      if (!mentions) console.log('[Feishu] isBotMentioned: no mentions in message')
      else console.log(`[Feishu] isBotMentioned: botIds empty, cannot detect mentions`)
      return false
    }
    const result = mentions.some((m) => {
      const ids = [m.id?.open_id, m.id?.user_id, m.id?.union_id].filter(Boolean) as string[]
      return ids.some((id) => this.botIds.has(id))
    })
    console.log(`[Feishu] isBotMentioned: ${result} (mentions=${JSON.stringify(mentions.map(m => m.id))}, botIds=[${[...this.botIds].join(', ')}])`)
    return result
  }

  private handlePermCommand(text: string, chatId: string, senderId: string): void {
    const parts = text.split(/\s+/)
    if (parts.length < 3) return

    const decision = parts[1] as 'allow' | 'deny'
    if (decision !== 'allow' && decision !== 'deny') return

    // Verify sender matches the original requester (P30 fix)
    const pending = this.pendingPermByChat.get(chatId)
    if (pending && pending.senderId !== senderId) {
      console.log(`[Feishu] Permission command from wrong user: expected=${pending.senderId}, got=${senderId}`)
      return
    }

    const requestIdPrefix = parts[2]
    this.pendingPermByChat.delete(chatId)
    this.permissionCallback?.(requestIdPrefix, decision)
  }

  /**
   * Handle simple permission responses: "allow", "deny", "允许", "拒绝", "y", "n", etc.
   * Only works if there's a pending permission request for this chat.
   * @returns true if the message was handled as a permission response.
   */
  private handleSimplePermResponse(text: string, chatId: string, senderId: string): boolean {
    const pending = this.pendingPermByChat.get(chatId)
    if (!pending) return false

    // Verify sender matches the original requester (P30 fix)
    if (pending.senderId !== senderId) {
      console.log(`[Feishu] Permission response from wrong user: expected=${pending.senderId}, got=${senderId}`)
      return false
    }

    const normalized = text.trim().toLowerCase()
    const allowWords = ['allow', 'y', 'yes', 'ok', '允许', '好', '好的', '是', '可以', '同意']
    const denyWords = ['deny', 'n', 'no', '拒绝', '不', '不行', '否', '取消']

    let decision: 'allow' | 'deny' | null = null
    if (allowWords.includes(normalized)) decision = 'allow'
    else if (denyWords.includes(normalized)) decision = 'deny'

    if (!decision) return false

    console.log(`[Feishu] Simple permission response: "${text}" → ${decision} (request=${pending.requestIdPrefix})`)
    this.pendingPermByChat.delete(chatId)
    this.permissionCallback?.(pending.requestIdPrefix, decision)
    return true
  }

  // ---------------------------------------------------------------------------
  // Internal: Download resource from Feishu message
  // ---------------------------------------------------------------------------

  private async downloadFeishuResource(messageId: string, fileKey: string, type: 'image' | 'file'): Promise<Buffer> {
    const apiBase = this.platform === 'lark' ? 'https://open.larksuite.com/open-apis' : 'https://open.feishu.cn/open-apis'

    // Get tenant token
    const tokenRes = await fetch(`${apiBase}/auth/v3/tenant_access_token/internal`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: this.appId, app_secret: this.appSecret }),
      signal: AbortSignal.timeout(10_000),
    })
    const tokenData = await tokenRes.json() as { tenant_access_token?: string }
    if (!tokenData.tenant_access_token) throw new Error('No tenant token')

    // Download resource
    const res = await fetch(`${apiBase}/im/v1/messages/${messageId}/resources/${fileKey}?type=${type}`, {
      headers: { 'Authorization': `Bearer ${tokenData.tenant_access_token}` },
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) throw new Error(`Download failed: ${res.status}`)

    return Buffer.from(await res.arrayBuffer())
  }

  // ---------------------------------------------------------------------------
  // Internal: Message queue
  // ---------------------------------------------------------------------------

  private enqueueMessage(msg: IncomingMessage): void {
    if (this.messageWaiter) {
      const waiter = this.messageWaiter
      this.messageWaiter = null
      waiter(msg)
    } else {
      this.messageQueue.push(msg)
    }
  }
}

// Self-register
registerAdapter('feishu', FeishuAdapter)
