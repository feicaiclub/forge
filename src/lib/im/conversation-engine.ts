/**
 * Conversation Engine (Layer 4).
 *
 * Calls createForgeQuery() from the Forge SDK client to interact with Claude.
 * Consumes the SDK stream in real-time, forwarding events to the delivery
 * layer via callbacks (onTyping → onDraft → onFinal).
 *
 * Handles:
 *   - User message persistence
 *   - SDK streaming consumption
 *   - Permission callbacks during streaming
 *   - Assistant message persistence
 *   - Session title/timestamp update
 */

import { getDb } from '@/lib/db'
import crypto from 'crypto'
import { createForgeQuery } from '@/lib/sdk/client'
import type { ForgeAttachment } from '@/lib/sdk/client'
import { getUploadsDir } from '@/lib/forge-data'
import fs from 'fs'
import path from 'path'
import { archiveOldMemories } from '@/lib/workspace-fs'
import type { PermissionResult, PermissionUpdate, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { ConversationCallbacks, ConversationResult, ImPermissionRequest, IncomingMessage } from './types'

let lastArchiveTime = 0

export class ConversationEngine {
  /**
   * Process an incoming IM message through the Claude Agent SDK.
   *
   * The callbacks enable streaming preview:
   *   onTyping  — called once when the first SDK event arrives
   *   onDraft   — called periodically with accumulated partial text
   *   onFinal   — called once when the full response is ready
   *   onPermissionRequest — called when the SDK needs tool permission
   */
  async processMessage(
    msg: IncomingMessage,
    sessionId: string,
    workspace: string,
    callbacks: ConversationCallbacks,
  ): Promise<ConversationResult> {
    const db = getDb()

    // Get IM permission mode
    const permModeSetting = db.prepare("SELECT value FROM settings WHERE key = 'im_permission_mode'")
      .get() as { value: string } | undefined
    const permissionMode = permModeSetting?.value || 'confirm'

    // Save user message
    const userMsgId = crypto.randomUUID()
    db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?, ?, ?, ?)').run(
      userMsgId, sessionId, 'user', msg.text,
    )

    // Throttle archiving: max once per hour
    const now = Date.now()
    if (now - lastArchiveTime > 3600_000) {
      lastArchiveTime = now
      const retentionSetting = db.prepare("SELECT value FROM settings WHERE key = 'memory_retention_days'")
        .get() as { value: string } | undefined
      const retentionDays = parseInt(retentionSetting?.value || '7', 10)
      try {
        archiveOldMemories(workspace, retentionDays)
      } catch { /* ignore archive errors */ }
    }

    // Build canUseTool callback for IM permission handling
    const canUseTool = (permissionMode === 'confirm')
      ? async (
          toolName: string,
          input: Record<string, unknown>,
          opts: { signal: AbortSignal; suggestions?: PermissionUpdate[]; toolUseID: string; agentID?: string },
        ): Promise<PermissionResult> => {
          const reqId = crypto.randomUUID()
          const decision = await callbacks.onPermissionRequest({
            requestId: reqId,
            toolName,
            toolInput: input,
            chatId: msg.chatId,
            channelType: msg.channelType,
            senderId: msg.senderId,
          })
          if (decision === 'allow') {
            return { behavior: 'allow', updatedPermissions: opts.suggestions }
          }
          return { behavior: 'deny', message: `Permission denied for ${toolName}` }
        }
      : undefined

    // Get session model and check if this is a continuation
    const session = db.prepare('SELECT model FROM sessions WHERE id = ?')
      .get(sessionId) as { model: string } | undefined
    const model = session?.model || 'claude-sonnet-4-6'

    // Check if the session already has messages — if so, resume the conversation
    const existingMsgCount = db.prepare('SELECT COUNT(*) as count FROM messages WHERE session_id = ?')
      .get(sessionId) as { count: number }
    const isResume = existingMsgCount.count > 1

    // Create abort controller for the SDK query
    // Combines the external abort signal (from /stop or timeout) with a local controller
    const localAbort = new AbortController()
    if (callbacks.abortSignal) {
      callbacks.abortSignal.addEventListener('abort', () => localAbort.abort(), { once: true })
    }

    // Convert IM images/files to ForgeAttachment[] (save to uploads dir for SDK)
    const attachments: ForgeAttachment[] = []
    if (msg.images && msg.images.length > 0) {
      const uploadsDir = getUploadsDir()
      for (const img of msg.images) {
        const ext = img.mimeType === 'image/png' ? '.png' : img.mimeType === 'image/gif' ? '.gif' : img.mimeType === 'image/webp' ? '.webp' : '.jpg'
        const filename = `im_${Date.now()}_${Math.random().toString(36).slice(2, 6)}${ext}`
        const filePath = path.join(uploadsDir, filename)
        fs.writeFileSync(filePath, Buffer.from(img.data, 'base64'))
        attachments.push({ name: img.name || filename, serverPath: filePath, mimeType: img.mimeType, tier: 'image' })
      }
    }
    if (msg.files && msg.files.length > 0) {
      const uploadsDir = getUploadsDir()
      for (const file of msg.files) {
        const filename = `im_${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80)}`
        const filePath = path.join(uploadsDir, filename)
        fs.writeFileSync(filePath, file.data)
        const isPdf = file.mimeType === 'application/pdf' || file.name.endsWith('.pdf')
        const isText = file.mimeType.startsWith('text/') || ['.txt','.md','.csv','.json','.yaml','.yml','.toml','.xml','.py','.js','.ts','.go','.rs','.java','.cpp','.rb','.sh','.sql'].some(e => file.name.endsWith(e))
        attachments.push({ name: file.name, serverPath: filePath, mimeType: file.mimeType, tier: isPdf ? 'pdf' : isText ? 'text' : 'binary' })
      }
    }

    // Create SDK query
    // Skip MCP servers for IM to reduce subprocess startup overhead (~2-3s savings)
    const t0 = Date.now()
    let sdkSessionId = sessionId
    console.log(`[ConversationEngine] Creating SDK query: model=${model}, isResume=${isResume}, permissionMode=${permissionMode}, msgCount=${existingMsgCount.count}, attachments=${attachments.length}`)

    let result: ConversationResult
    try {
      const q = createForgeQuery({
        prompt: msg.text || (attachments.length > 0 ? attachments.map(a => `[${a.name}]`).join(' ') : ''),
        attachments: attachments.length > 0 ? attachments : undefined,
        sessionId: sdkSessionId,
        model,
        workspaceId: workspace,
        canUseTool,
        bypassPermissions: permissionMode === 'full',
        resumeSession: isResume,
        abortController: localAbort,
        skipMcpServers: true,
        useImPrompt: true,
      })
      console.log(`[ConversationEngine] SDK query created (+${Date.now() - t0}ms)`)
      result = await this.consumeStream(q, callbacks)
    } catch (err) {
      // Fallback: if "Session ID already in use", retry with a fresh SDK session
      const errMsg = err instanceof Error ? err.message : String(err)
      if (errMsg.includes('already in use')) {
        console.log(`[ConversationEngine] Session ID conflict, retrying with fresh SDK session`)
        sdkSessionId = crypto.randomUUID()
        const localAbort2 = new AbortController()
        if (callbacks.abortSignal) {
          callbacks.abortSignal.addEventListener('abort', () => localAbort2.abort(), { once: true })
        }
        const q2 = createForgeQuery({
          prompt: msg.text || (attachments.length > 0 ? attachments.map(a => `[${a.name}]`).join(' ') : ''),
          attachments: attachments.length > 0 ? attachments : undefined,
          sessionId: sdkSessionId,
          model,
          workspaceId: workspace,
          canUseTool,
          bypassPermissions: permissionMode === 'full',
          resumeSession: false,
          abortController: localAbort2,
          skipMcpServers: true,
          useImPrompt: true,
        })
        result = await this.consumeStream(q2, callbacks)
      } else {
        throw err
      }
    }
    console.log(`[ConversationEngine] Stream consumed (+${Date.now() - t0}ms), text=${result.text.length} chars, tools=${result.toolsUsed.join(',') || 'none'}`)

    // Save assistant message
    const assistantMsgId = crypto.randomUUID()
    db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?, ?, ?, ?)').run(
      assistantMsgId, sessionId, 'assistant', JSON.stringify(result.blocks),
    )

    // Update session title + timestamp
    const msgCount = db.prepare('SELECT COUNT(*) as count FROM messages WHERE session_id = ?')
      .get(sessionId) as { count: number }
    if (msgCount.count <= 2) {
      const title = `[${msg.channelType}] ${msg.text.length > 40 ? msg.text.slice(0, 37) + '...' : msg.text}`
      db.prepare("UPDATE sessions SET title = ?, updated_at = datetime('now') WHERE id = ?").run(title, sessionId)
    } else {
      db.prepare("UPDATE sessions SET updated_at = datetime('now') WHERE id = ?").run(sessionId)
    }

    return result
  }

  // ---------------------------------------------------------------------------
  // Stream consumption
  // ---------------------------------------------------------------------------

  private async consumeStream(
    q: AsyncIterable<SDKMessage>,
    callbacks: ConversationCallbacks,
  ): Promise<ConversationResult> {
    const allBlocks: Record<string, unknown>[] = []
    const toolsUsed: string[] = []
    let responseText = ''       // Authoritative text from complete 'assistant' messages
    let streamingText = ''      // Incremental text from stream_event deltas (for live preview)
    let typingSent = false
    let lastDraftTime = 0

    for await (const sdkMsg of q) {
      // Send typing indicator on first event
      if (!typingSent) {
        typingSent = true
        try { await callbacks.onTyping() } catch (err) { console.warn('[ConversationEngine] onTyping error:', err instanceof Error ? err.message : err) }
      }

      // Collect blocks
      this.collectFromMessage(sdkMsg, allBlocks, toolsUsed)

      // Accumulate text from streaming deltas (real-time preview)
      if (sdkMsg.type === 'stream_event') {
        const event = sdkMsg.event
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          streamingText += event.delta.text
        }
      }

      // Accumulate authoritative text from completed assistant messages
      // This resets streamingText since the assistant message has the complete text
      if (sdkMsg.type === 'assistant') {
        responseText = ''
        for (const block of sdkMsg.message.content) {
          if (block.type === 'text') {
            responseText += block.text
          }
        }
        streamingText = responseText // Sync streaming text
      }

      // Send draft updates from streaming text (throttled to every 800ms)
      const previewText = streamingText || responseText
      if (previewText.length > 0) {
        const now = Date.now()
        if (now - lastDraftTime >= 800) {
          lastDraftTime = now
          try { await callbacks.onDraft(previewText) } catch (err) { console.warn('[ConversationEngine] onDraft error:', err instanceof Error ? err.message : err) }
        }
      }
    }

    // Final text: prefer the authoritative assistant text, fall back to streaming
    const finalText = responseText || streamingText

    // Send final text
    if (finalText) {
      try { await callbacks.onFinal(finalText) } catch (err) { console.warn('[ConversationEngine] onFinal error:', err instanceof Error ? err.message : err) }
    }

    return { text: finalText, toolsUsed, blocks: allBlocks }
  }

  // ---------------------------------------------------------------------------
  // Block collection from SDK messages
  // ---------------------------------------------------------------------------

  private collectFromMessage(
    msg: SDKMessage,
    allBlocks: Record<string, unknown>[],
    toolsUsed: string[],
  ): void {
    if (msg.type === 'assistant') {
      for (const block of msg.message.content) {
        if (block.type === 'text') {
          allBlocks.push({ type: 'text', text: block.text })
        } else if (block.type === 'tool_use') {
          allBlocks.push({ type: 'tool_use', id: block.id, name: block.name, input: block.input })
          toolsUsed.push(block.name)
        }
      }
    } else if (msg.type === 'tool_use_summary') {
      for (const toolUseId of msg.preceding_tool_use_ids) {
        allBlocks.push({
          type: 'tool_result',
          tool_use_id: toolUseId,
          content: msg.summary,
          is_error: false,
        })
      }
    }
  }
}
