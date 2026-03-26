/**
 * Bridge Manager (Layer 2) — Central orchestrator.
 *
 * Manages adapter lifecycles, runs message polling loops, implements
 * concurrency control, streaming preview state machine, and reconnection.
 *
 * Full message processing flow:
 *   1. adapter.consumeOne() → IncomingMessage
 *   2. policy.checkPolicy() → allowed/denied
 *   3. commands.parseImCommand() → if command, execute and return
 *   4. channelRouter.resolveSession() → sessionId, workspace
 *   5. sessionLock.acquire(key)
 *   6. conversationEngine.processMessage() with streaming callbacks
 *   7. sessionLock.release(key)
 */

import { getDb } from '@/lib/db'
import type { ChannelAdapter } from './adapters/base'
import { createAdapter } from './adapters/registry'
// Ensure all adapters are registered
import './adapters/telegram'
import './adapters/feishu'
import './adapters/discord'

import { ChannelRouter } from './channel-router'
import { SessionLockManager } from './concurrency'
import { ConversationEngine } from './conversation-engine'
import { parseImCommand, executeImCommand, checkUnknownCommand } from './commands'
import { DeliveryLayer } from './delivery'
import { emitImEvent } from './im-events'
import { PermissionBroker } from './permission-broker'
import { StreamingState } from './streaming-state'
import { checkPolicy } from './policy'
import type { BridgeState, ChannelType, IncomingMessage } from './types'

declare const globalThis: {
  __forgeBridgeManager?: BridgeManager
} & typeof global

// ---------------------------------------------------------------------------
// Bridge Manager
// ---------------------------------------------------------------------------

class BridgeManager {
  private adapters = new Map<string, ChannelAdapter>()
  private pollControllers = new Map<string, AbortController>()
  private states = new Map<string, BridgeState>()
  private channelTypes = new Map<string, ChannelType>() // channelId → ChannelType lookup

  // Shared components
  private router = new ChannelRouter()
  private locks = new SessionLockManager()
  private engine = new ConversationEngine()
  private delivery = new DeliveryLayer()
  private permissionBroker = new PermissionBroker()

  // Reconnection state
  private reconnectAttempts = new Map<string, number>()
  private circuitBroken = new Map<string, number>() // channelId → timestamp when circuit opened

  // Active task abort controllers: sessionKey → AbortController
  // Used by /stop command to cancel running queries
  private activeTasks = new Map<string, AbortController>()

  // Backpressure: limit concurrent SDK invocations
  private activeSdkCalls = 0
  private readonly maxConcurrentSdkCalls = 3
  private sdkCallWaiters: Array<() => void> = []

  // Per-channel startup lock to prevent concurrent startAdapter calls (race condition fix)
  private startingChannels = new Map<string, Promise<void>>()

  // ---------------------------------------------------------------------------
  // Adapter lifecycle
  // ---------------------------------------------------------------------------

  async startAdapter(channelId: string): Promise<void> {
    // Serialize concurrent startAdapter calls for the same channelId
    const existing = this.startingChannels.get(channelId)
    if (existing) {
      console.log(`[BridgeManager] startAdapter already in progress for ${channelId}, waiting...`)
      try { await existing } catch { /* ignore previous error */ }
    }

    const promise = this._doStartAdapter(channelId)
    this.startingChannels.set(channelId, promise)
    try {
      await promise
    } finally {
      this.startingChannels.delete(channelId)
    }
  }

  private async _doStartAdapter(channelId: string): Promise<void> {
    // Stop existing adapter if running
    if (this.adapters.has(channelId)) {
      await this.stopAdapter(channelId)
    }

    this.setState(channelId, 'connecting')

    const db = getDb()
    const channel = db.prepare('SELECT type, credentials FROM im_channels WHERE id = ?')
      .get(channelId) as { type: ChannelType; credentials: string } | undefined
    if (!channel) throw new Error(`Channel not found: ${channelId}`)

    const config = JSON.parse(channel.credentials) as Record<string, string>
    const adapter = createAdapter(channel.type)

    // Validate config before attempting connection
    const validation = adapter.validateConfig(config)
    if (!validation.valid) {
      this.setState(channelId, 'error', validation.error)
      throw new Error(validation.error)
    }

    // Register permission response handler
    adapter.onPermissionResponse((requestId, decision) => {
      this.permissionBroker.resolvePermission(requestId, decision)
    })

    try {
      await adapter.start(config)
      this.adapters.set(channelId, adapter)
      this.channelTypes.set(channelId, channel.type)
      this.setState(channelId, 'connected')
      this.reconnectAttempts.delete(channelId)
      this.circuitBroken.delete(channelId)

      // Update DB status
      db.prepare("UPDATE im_channels SET status = 'connected', updated_at = datetime('now') WHERE id = ?")
        .run(channelId)

      // Start poll loop
      this.startPollLoop(channelId, adapter)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error'
      this.setState(channelId, 'error', errorMsg)
      db.prepare("UPDATE im_channels SET status = 'error', updated_at = datetime('now') WHERE id = ?")
        .run(channelId)
      throw err
    }
  }

  async stopAdapter(channelId: string): Promise<void> {
    // Stop poll loop
    const controller = this.pollControllers.get(channelId)
    if (controller) {
      controller.abort()
      this.pollControllers.delete(channelId)
    }

    // Stop adapter
    const adapter = this.adapters.get(channelId)
    if (adapter) {
      try { await adapter.stop() } catch (err) { console.warn(`[BridgeManager] adapter.stop() error:`, err instanceof Error ? err.message : err) }
      this.adapters.delete(channelId)
    }

    // Cleanup only permission requests associated with this channel
    this.permissionBroker.cleanupChannel(channelId)

    // Clean up reconnection state for this channel
    this.reconnectAttempts.delete(channelId)
    this.circuitBroken.delete(channelId)

    this.setState(channelId, 'disconnected')

    // Update DB
    try {
      const db = getDb()
      db.prepare("UPDATE im_channels SET status = 'disconnected', updated_at = datetime('now') WHERE id = ?")
        .run(channelId)
    } catch { /* ignore */ }
  }

  async stopAll(): Promise<void> {
    const ids = [...this.adapters.keys()]
    await Promise.allSettled(ids.map(id => this.stopAdapter(id)))
    // Final cleanup of any remaining permission requests
    this.permissionBroker.cleanup()
  }

  /**
   * Auto-reconnect previously enabled channels on app startup.
   * Called once when the BridgeManager singleton is first created.
   */
  async autoReconnect(): Promise<void> {
    const db = getDb()
    const channels = db.prepare('SELECT id, type FROM im_channels WHERE enabled = 1')
      .all() as { id: string; type: string }[]

    if (channels.length === 0) return

    // Reconnect all channels in parallel (P34 fix)
    console.log(`[BridgeManager] Auto-reconnecting ${channels.length} channel(s) in parallel...`)
    const results = await Promise.allSettled(
      channels.map(async (ch) => {
        await this.startAdapter(ch.id)
        console.log(`[BridgeManager] Auto-reconnected: ${ch.type} (${ch.id})`)
      }),
    )
    for (let i = 0; i < results.length; i++) {
      if (results[i].status === 'rejected') {
        const err = (results[i] as PromiseRejectedResult).reason
        console.error(`[BridgeManager] Auto-reconnect failed for ${channels[i].type}:`, err instanceof Error ? err.message : err)
      }
    }
  }

  // ---------------------------------------------------------------------------
  // State queries (backward compat for API/frontend)
  // ---------------------------------------------------------------------------

  getState(channelId: string): BridgeState | undefined {
    return this.states.get(channelId)
  }

  getAllStates(): BridgeState[] {
    return [...this.states.values()]
  }

  isConnected(channelId: string): boolean {
    return this.adapters.get(channelId)?.isRunning() || false
  }

  /** Expose the router for IM commands that need it */
  getRouter(): ChannelRouter {
    return this.router
  }

  /** Expose adapters map for cron notification delivery */
  getAdapters(): Map<string, ChannelAdapter> {
    return this.adapters
  }

  /**
   * Abort the active task for a given session key.
   * Used by the /stop command.
   * @returns true if a task was aborted, false if no task was running.
   */
  stopActiveTask(sessionKey: string): boolean {
    const controller = this.activeTasks.get(sessionKey)
    if (controller) {
      controller.abort()
      this.activeTasks.delete(sessionKey)
      return true
    }
    return false
  }

  // ---------------------------------------------------------------------------
  // Poll loop
  // ---------------------------------------------------------------------------

  /** Recently processed message IDs — prevents duplicate processing when SDK delivers same event twice */
  private processedMessageIds = new Set<string>()
  private processedMessageIdCleanupTimer: ReturnType<typeof setTimeout> | null = null

  private isMessageDuplicate(msg: IncomingMessage): boolean {
    if (!msg.messageId) return false // No ID, can't dedup
    if (this.processedMessageIds.has(msg.messageId)) {
      console.log(`[BridgeManager] Duplicate message skipped: ${msg.messageId}`)
      return true
    }
    this.processedMessageIds.add(msg.messageId)
    // Periodic cleanup: keep only last 5 minutes of IDs
    if (!this.processedMessageIdCleanupTimer) {
      this.processedMessageIdCleanupTimer = setTimeout(() => {
        this.processedMessageIds.clear()
        this.processedMessageIdCleanupTimer = null
      }, 300_000)
    }
    return false
  }

  private startPollLoop(channelId: string, adapter: ChannelAdapter): void {
    const controller = new AbortController()
    this.pollControllers.set(channelId, controller)

    // Run poll loop in background (fire and forget)
    this.runPollLoop(channelId, adapter, controller.signal).catch(err => {
      console.error(`[BridgeManager] Poll loop error for ${channelId}:`, err)
    })
  }

  private async runPollLoop(
    channelId: string,
    adapter: ChannelAdapter,
    signal: AbortSignal,
  ): Promise<void> {
    while (!signal.aborted) {
      try {
        const msg = await adapter.consumeOne(signal)
        if (!msg) {
          if (!adapter.isRunning() && !signal.aborted) {
            // Adapter stopped (connection lost) — attempt reconnect
            await this.handleReconnect(channelId)
            return // reconnect starts a new poll loop
          }
          continue
        }

        // Skip duplicate messages (SDK may redeliver on reconnect)
        if (this.isMessageDuplicate(msg)) continue

        // Process message in background (don't block poll loop)
        // NOTE: Backpressure is applied INSIDE processMessage, after the session lock,
        // so that messages waiting for the lock don't consume backpressure slots.
        this.processMessage(channelId, msg, adapter).catch(err => {
          console.error(`[BridgeManager] Message processing error:`, err)
        })
      } catch (err) {
        if (signal.aborted) break

        console.error(`[BridgeManager] Poll error for ${channelId}:`, err)

        if (!adapter.isRunning()) {
          await this.handleReconnect(channelId)
          return
        }

        // Brief pause before retry
        await sleep(1000)
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Message processing (full pipeline)
  // ---------------------------------------------------------------------------

  /** Overall timeout for a single SDK query (5 minutes) */
  private readonly sdkQueryTimeoutMs = 300_000

  private async processMessage(
    channelId: string,
    msg: IncomingMessage,
    adapter: ChannelAdapter,
  ): Promise<void> {
    // Inject the correct DB channel ID (adapters only know their platform type, not the DB ID)
    msg.channelId = channelId

    const t0 = Date.now()
    console.log(`[BridgeManager] Processing message: channel=${channelId}, chat=${msg.chatId}, isDm=${msg.isDm}, isGroupMention=${msg.isGroupMention}, text="${msg.text.slice(0, 40)}"`)

    // L3: Policy check
    const policyResult = checkPolicy(msg)
    if (!policyResult.allowed) {
      console.log(`[BridgeManager] Message BLOCKED by policy: ${policyResult.reason} (channel=${channelId}, chat=${msg.chatId})`)
      return
    }
    console.log(`[BridgeManager] Policy check PASSED for channel=${channelId}`)

    // L3: Check for IM command
    const command = parseImCommand(msg.text)
    if (command) {
      console.log(`[BridgeManager] Executing IM command: /${command.name}`)
      // Send typing indicator for commands that may take time (P21 fix)
      try { await adapter.sendTypingIndicator(msg.chatId) } catch { /* best effort */ }
      const response = await executeImCommand(command, msg, this.router, adapter, {
        stopActiveTask: (key) => this.stopActiveTask(key),
      })
      await this.delivery.deliver(adapter, msg.chatId, response, { skipDedup: true })

      // Emit command event for desktop sync
      const bindingInfo = this.router.getBindingInfo(msg.channelType, msg.chatId)
      emitImEvent('im:command', {
        command: command.name,
        sessionId: bindingInfo?.sessionId || undefined,
        workspaceId: bindingInfo?.workspace || undefined,
      })
      return
    }

    // Check for unknown command attempts (e.g. /modle, /swtich)
    const unknownHint = checkUnknownCommand(msg.text)
    if (unknownHint) {
      console.log(`[BridgeManager] Unknown command attempt: ${msg.text.split(/\s+/)[0]}`)
      await this.delivery.deliver(adapter, msg.chatId, unknownHint, { skipDedup: true })
      return
    }

    // L3: Resolve session
    const { sessionId, workspace } = this.router.resolveSession(msg)
    console.log(`[BridgeManager] Session resolved: sessionId=${sessionId.slice(0, 8)}, workspace=${workspace.slice(0, 8)}`)
    const sessionKey = `${msg.channelType}:${msg.chatId}`

    // L2: Acquire session lock (ensures only one SDK call per chat at a time)
    // NOTE: This does NOT consume a backpressure slot — only the actual SDK call does.
    console.log(`[BridgeManager] Waiting for session lock: ${sessionKey} (+${Date.now() - t0}ms)`)
    const release = await this.locks.acquire(sessionKey)
    console.log(`[BridgeManager] Session lock acquired: ${sessionKey} (+${Date.now() - t0}ms)`)

    const streamingState = new StreamingState()

    // Create abort controller: combines /stop command abort + overall timeout
    const taskAbort = new AbortController()
    const timeoutId = setTimeout(() => {
      console.log(`[BridgeManager] SDK query timeout (${this.sdkQueryTimeoutMs}ms) for ${sessionKey}`)
      taskAbort.abort()
    }, this.sdkQueryTimeoutMs)
    this.activeTasks.set(sessionKey, taskAbort)

    try {
      // L4+L5: Process message with backpressure + streaming callbacks
      // Backpressure wraps ONLY the SDK call (after lock acquisition) so that
      // messages waiting for the session lock don't consume backpressure slots.
      const result = await this.withSdkBackpressure(() =>
        this.engine.processMessage(msg, sessionId, workspace, {
          onTyping: async () => {
            streamingState.transition('typing')
            // Emit SSE event early so desktop UI updates in real-time (P13 fix)
            emitImEvent('im:message', { sessionId, workspaceId: workspace })
            if (msg.channelType === 'feishu') {
              // Feishu: send a "processing" placeholder since it doesn't support draft editing (P2 fix)
              const placeholderId = await this.delivery.deliver(adapter, msg.chatId, '⏳ 正在处理...', { skipDedup: true })
              if (placeholderId) {
                streamingState.setDraftMessageId(placeholderId)
              }
            } else {
              await this.delivery.deliver(adapter, msg.chatId, '', { isTypingIndicator: true })
            }
          },

          onDraft: async (partialText: string) => {
            // Feishu doesn't support reliable message editing — skip draft previews
            if (msg.channelType === 'feishu') return
            // Skip if text hasn't changed — prevents duplicate messages when edit fails
            // (Telegram/Discord reject edits with identical content, causing fall-through to new send)
            if (streamingState.isDraftUnchanged(partialText)) return

            const draftMsgId = streamingState.getDraftMessageId()
            if (draftMsgId) {
              // Edit existing draft
              await this.delivery.deliver(adapter, msg.chatId, partialText + ' ▌', {
                editMessageId: draftMsgId,
              })
            } else {
              // Send initial draft
              streamingState.transition('draft')
              const msgId = await this.delivery.deliver(adapter, msg.chatId, partialText + ' ▌')
              if (msgId) {
                streamingState.setDraftMessageId(msgId)
              }
            }
          },

          onFinal: async (text: string) => {
            streamingState.transition('final')
            const draftMsgId = streamingState.getDraftMessageId()
            if (draftMsgId) {
              // Try to edit draft to final text
              const editResult = await this.delivery.deliver(adapter, msg.chatId, text, {
                editMessageId: draftMsgId,
              })
              // If edit failed (returned different ID or undefined), a new message was sent.
              // Delete the stale draft to prevent duplicate/residual messages.
              if (editResult && editResult !== draftMsgId) {
                await this.delivery.deliver(adapter, msg.chatId, '', { deleteMessageId: draftMsgId })
              }
            } else {
              // Send final message directly (skipDedup: legitimate responses should never be suppressed)
              await this.delivery.deliver(adapter, msg.chatId, text, { skipDedup: true })
            }
          },

          onPermissionRequest: async (req) => {
            return this.permissionBroker.requestPermission(req, adapter, channelId)
          },

          abortSignal: taskAbort.signal,
        }),
      )

      // If engine produced no text response and no draft was sent
      if (!result.text && !streamingState.getDraftMessageId()) {
        await this.delivery.deliver(adapter, msg.chatId, '_(No text response)_')
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error'
      const isAbort = err instanceof Error && err.name === 'AbortError'
      if (isAbort) {
        console.log(`[BridgeManager] SDK query aborted for ${sessionKey}`)
      } else {
        console.error(`[${channelId}] Agent error:`, errorMsg)
      }

      // Clean up draft if there was one
      const draftMsgId = streamingState.getDraftMessageId()
      if (draftMsgId) {
        await this.delivery.deliver(adapter, msg.chatId, '', {
          deleteMessageId: draftMsgId,
        })
      }

      if (isAbort) {
        await this.delivery.deliver(adapter, msg.chatId, '⏱ 请求超时或已取消')
      } else {
        await this.delivery.deliver(adapter, msg.chatId, `❌ Error: ${errorMsg}`)
      }
    } finally {
      clearTimeout(timeoutId)
      this.activeTasks.delete(sessionKey)
      release()
      console.log(`[BridgeManager] Session lock released: ${sessionKey} (total: ${Date.now() - t0}ms)`)

      // Emit message event for desktop sync (after processing completes)
      emitImEvent('im:message', { sessionId, workspaceId: workspace })
    }
  }

  // ---------------------------------------------------------------------------
  // Backpressure: limit concurrent SDK invocations
  // ---------------------------------------------------------------------------

  private async withSdkBackpressure<T>(fn: () => Promise<T>): Promise<T> {
    // Wait if at capacity
    while (this.activeSdkCalls >= this.maxConcurrentSdkCalls) {
      await new Promise<void>(resolve => this.sdkCallWaiters.push(resolve))
    }
    this.activeSdkCalls++
    try {
      return await fn()
    } finally {
      this.activeSdkCalls--
      // Wake one waiter
      const waiter = this.sdkCallWaiters.shift()
      if (waiter) waiter()
    }
  }

  // ---------------------------------------------------------------------------
  // Reconnection with exponential backoff + circuit breaker
  // ---------------------------------------------------------------------------

  private async handleReconnect(channelId: string): Promise<void> {
    // Check circuit breaker
    const circuitOpenTime = this.circuitBroken.get(channelId)
    if (circuitOpenTime) {
      const elapsed = Date.now() - circuitOpenTime
      if (elapsed < 5 * 60 * 1000) {
        // Circuit still open — wait
        console.log(`[BridgeManager] Circuit breaker open for ${channelId}, waiting...`)
        return
      }
      // Circuit half-open — allow one attempt
      this.circuitBroken.delete(channelId)
    }

    const attempts = (this.reconnectAttempts.get(channelId) || 0) + 1
    this.reconnectAttempts.set(channelId, attempts)

    // Trip circuit breaker after 5 consecutive failures
    if (attempts > 5) {
      console.log(`[BridgeManager] Circuit breaker tripped for ${channelId}`)
      this.circuitBroken.set(channelId, Date.now())
      this.setState(channelId, 'error', 'Too many reconnection failures, pausing for 5 minutes')
      return
    }

    // Exponential backoff with jitter: 1s, 2s, 4s, 8s, 16s, max 60s
    const baseDelay = Math.min(1000 * Math.pow(2, attempts - 1), 60_000)
    const jitter = Math.random() * baseDelay * 0.3
    const delay = baseDelay + jitter

    console.log(`[BridgeManager] Reconnecting ${channelId} in ${Math.round(delay)}ms (attempt ${attempts})`)
    await sleep(delay)

    try {
      await this.startAdapter(channelId)
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      console.error(`[BridgeManager] Reconnect failed for ${channelId}:`, errMsg)

      // Don't retry unrecoverable errors (auth failures, invalid config) — trip circuit immediately (P20 fix)
      if (/401|403|Unauthorized|Forbidden|invalid.*token|app_id|app_secret/i.test(errMsg)) {
        console.log(`[BridgeManager] Unrecoverable error for ${channelId}, stopping reconnection`)
        this.circuitBroken.set(channelId, Date.now())
        this.setState(channelId, 'error', `Authentication failed: ${errMsg}`)
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Internal state management
  // ---------------------------------------------------------------------------

  private setState(channelId: string, status: BridgeState['status'], error?: string): void {
    const type = this.channelTypes.get(channelId) || (channelId as ChannelType)
    this.states.set(channelId, { channelId, type, status, error })
  }
}

// ---------------------------------------------------------------------------
// Singleton accessor
// ---------------------------------------------------------------------------

export function getBridgeManager(): BridgeManager {
  if (!globalThis.__forgeBridgeManager) {
    globalThis.__forgeBridgeManager = new BridgeManager()
    // Auto-reconnect previously enabled channels (fire and forget)
    globalThis.__forgeBridgeManager.autoReconnect().catch(err => {
      console.error('[BridgeManager] Auto-reconnect error:', err)
    })
  }
  return globalThis.__forgeBridgeManager
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
