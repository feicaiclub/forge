import { getDb } from '@/lib/db'
import crypto from 'crypto'
import fs from 'fs'
import { createForgeQuery } from '@/lib/sdk/client'
import type { ForgeAttachment } from '@/lib/sdk/client'
import path from 'path'
import { getUploadsDir } from '@/lib/forge-data'
import { MessageMapper } from '@/lib/sdk/message-mapper'
import type { SseEvent } from '@/lib/sdk/message-mapper'
import { createPermissionBridge, cleanupStaleSessionAllowances } from '@/lib/sdk/permission-bridge'
import { archiveOldMemories } from '@/lib/workspace-fs'
import { resolveProvider } from '@/lib/provider'
import { runSessionCleanup } from '@/lib/session-cleanup'
import { extractFilePaths, resolveFileAttachments, parseMediaProtocol } from '@/lib/im/conversation-engine'
import type { Query } from '@anthropic-ai/claude-agent-sdk'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

let lastArchiveTime = 0

// ── Helpers ────────────────────────────────────────────────────

/** Drain an SDK query into SSE events via a mapper. */
async function drainQuery(
  q: Query,
  mapper: MessageMapper,
  emit: (data: Record<string, unknown>) => void | Promise<void>,
) {
  for await (const msg of q) {
    const events = mapper.mapMessage(msg)
    for (const event of events) {
      await emit(event as Record<string, unknown>)
    }
  }
}

/**
 * Build a prompt that includes recent conversation history as context.
 * Used as fallback when SDK session resume fails.
 */
function buildPromptWithHistory(
  newMessage: string,
  recentMessages: Array<{ role: string; content: string }>,
): string {
  if (recentMessages.length === 0) return newMessage

  const history = recentMessages
    .slice(-20) // Last 20 messages for context
    .map((m) => {
      const role = m.role === 'user' ? 'Human' : 'Assistant'
      // For assistant messages stored as JSON blocks, summarize
      let content = m.content
      if (content.startsWith('[{') || content.startsWith('[')) {
        try {
          const blocks = JSON.parse(content)
          content = blocks
            .filter((b: Record<string, unknown>) => b.type === 'text' && b.text)
            .map((b: Record<string, unknown>) => b.text)
            .join(' ')
          if (!content) content = '[tool usage]'
        } catch {
          content = content.slice(0, 200)
        }
      }
      return `${role}: ${content}`
    })
    .join('\n\n')

  return `<conversation_history>\n${history}\n</conversation_history>\n\n${newMessage}`
}

export async function POST(req: Request) {
  let body: { sessionId?: string; message?: string; permissionMode?: string; thinkingMode?: string; attachments?: Array<{ name: string; filename: string; mimeType: string; tier: string }> }
  try {
    body = await req.json()
  } catch {
    return jsonError('Invalid JSON', 400)
  }

  const { sessionId, message } = body

  // Map raw attachment data to typed ForgeAttachment[]
  // Reconstruct serverPath from filename (never trust absolute paths from client)
  const uploadsDir = getUploadsDir()
  const attachments: ForgeAttachment[] = (body.attachments || []).map(a => {
    const safeFilename = a.filename.replace(/\.\./g, '').replace(/[/\\]/g, '_') // sanitize: strip path traversal + slashes, preserve dots in extensions
    return {
      name: a.name,
      serverPath: path.join(uploadsDir, safeFilename),
      mimeType: a.mimeType,
      tier: a.tier as ForgeAttachment['tier'],
    }
  })
  if (!sessionId || (!message && attachments.length === 0)) return jsonError('sessionId and message (or attachments) required', 400)

  const db = getDb()

  // Get session
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as {
    id: string; model: string; workspace: string
  } | undefined
  if (!session) return jsonError('Session not found', 404)

  // Permission mode: per-session override from request body takes priority over global Settings
  const permModeSetting = db.prepare("SELECT value FROM settings WHERE key = 'desktop_permission_mode'").get() as { value: string } | undefined
  const permissionMode = body.permissionMode || permModeSetting?.value || 'confirm'

  // Resolve provider type for thinking mode mapping
  const resolved = resolveProvider(session.model)
  const providerType = resolved.provider

  // Get thinking mode: per-request override > provider-specific setting > global default
  const providerThinkingKey = `thinking_mode_${providerType}`
  const providerThinkingSetting = db.prepare('SELECT value FROM settings WHERE key = ?').get(providerThinkingKey) as { value: string } | undefined
  const globalThinkingSetting = db.prepare("SELECT value FROM settings WHERE key = 'thinking_mode'").get() as { value: string } | undefined
  const thinkingMode = body.thinkingMode || providerThinkingSetting?.value || globalThinkingSetting?.value || 'auto'

  // Check if this session already has messages (for resume)
  const existingMsgCount = (db.prepare('SELECT COUNT(*) as count FROM messages WHERE session_id = ?').get(sessionId) as { count: number }).count

  // Resolve effective message: if empty but has attachments, use file names
  const effectiveMessage = message || (attachments.length > 0
    ? attachments.map(a => `[${a.name}]`).join(' ')
    : '')

  // Save user message
  const userMsgId = crypto.randomUUID()
  db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?, ?, ?, ?)').run(
    userMsgId, sessionId, 'user', effectiveMessage
  )

  // Archive old daily memories (throttled: max once per hour)
  const now = Date.now()
  if (now - lastArchiveTime > 3600_000) {
    lastArchiveTime = now
    const retentionSetting = db.prepare("SELECT value FROM settings WHERE key = 'memory_retention_days'").get() as { value: string } | undefined
    const retentionDays = parseInt(retentionSetting?.value || '7', 10)
    archiveOldMemories(session.workspace, retentionDays)
  }

  // Auto-clean old sessions (throttled shared function) + stale permission allowances
  runSessionCleanup()
  cleanupStaleSessionAllowances()

  const encoder = new TextEncoder()
  const abortController = new AbortController()

  // Use TransformStream for immediate chunk flushing — ReadableStream's async start()
  // can cause Next.js to buffer the entire response before sending.
  const { readable, writable } = new TransformStream()
  const writer = writable.getWriter()

  const emit = async (data: Record<string, unknown>) => {
    try {
      await writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
    } catch { /* writer closed (client disconnected) */ }
  }

  // Run the stream processing in the background — Response is returned immediately
  ;(async () => {
    let mapper = new MessageMapper()

    try {
      // Create permission bridge (only for 'confirm' mode)
      const canUseTool = permissionMode === 'confirm'
        ? createPermissionBridge(sessionId, emit as (data: Record<string, unknown>) => void)
        : undefined

      const isResume = existingMsgCount > 0

      const q = createForgeQuery({
        prompt: effectiveMessage,
        sessionId,
        model: session.model,
        workspaceId: session.workspace,
        abortController,
        canUseTool,
        bypassPermissions: permissionMode === 'full',
        resumeSession: isResume,
        thinkingMode,
        providerType,
        attachments: attachments.length > 0 ? attachments : undefined,
      })

      // Consume SDK message stream, with resume failure recovery.
      // Two fallback triggers:
      //   A) drainQuery throws (exception path)
      //   B) drainQuery completes but produced zero blocks (silent error path —
      //      SDK returned an error result like "Session ID already in use"
      //      without throwing an exception)
      let needsFallback = false
      try {
        await drainQuery(q, mapper, emit)
        // Silent failure check: resume completed but SDK returned error result only
        if (isResume && mapper.getBlocks().length === 0) {
          needsFallback = true
          console.warn('[forge-chat] Resume produced zero blocks (likely SDK error result), will retry with fresh session')
        }
      } catch (queryErr) {
        const isResumeFailure = isResume && mapper.getBlocks().length === 0
        if (!isResumeFailure) throw queryErr
        needsFallback = true
        const errMsg = queryErr instanceof Error ? queryErr.message : String(queryErr)
        console.warn(`[forge-chat] Resume threw error, will retry with fresh session:`, errMsg)
      }

      if (needsFallback) {
        // Load recent conversation history from DB (excluding the message we just inserted)
        const recentMsgs = db
          .prepare(
            'SELECT role, content FROM messages WHERE session_id = ? AND id != ? ORDER BY created_at ASC',
          )
          .all(sessionId, userMsgId) as Array<{ role: string; content: string }>

        const historyPrompt = buildPromptWithHistory(effectiveMessage, recentMsgs)

        // Reset mapper for the retry
        mapper = new MessageMapper()

        // Use a fresh UUID to avoid SDK session lock conflicts
        // (the original sessionId may still be locked by a stale process)
        const retryQ = createForgeQuery({
          prompt: historyPrompt,
          sessionId: crypto.randomUUID(),
          model: session.model,
          workspaceId: session.workspace,
          abortController,
          canUseTool,
          bypassPermissions: permissionMode === 'full',
          resumeSession: false,
          thinkingMode,
          providerType,
        })

        await drainQuery(retryQ, mapper, emit)
      }

      // Detect file/image attachments from two sources:
      // 1. MEDIA: protocol lines in text blocks (explicit, preferred)
      // 2. Tool use heuristics (fallback)
      const blocks = mapper.getBlocks()

      // Parse MEDIA: lines from text blocks and strip them from displayed text
      const mediaPaths: string[] = []
      for (const block of blocks) {
        if ((block as Record<string, unknown>).type === 'text') {
          const b = block as { type: string; text: string }
          const parsed = parseMediaProtocol(b.text)
          mediaPaths.push(...parsed.mediaPaths)
          b.text = parsed.text // Strip MEDIA: lines from stored text
        }
      }

      // Merge MEDIA: paths with heuristic-detected paths, dedup
      const mediaAttachments = resolveFileAttachments(mediaPaths)
      const heuristicAttachments = resolveFileAttachments(extractFilePaths(blocks as Record<string, unknown>[]))
      const seenPaths = new Set(mediaAttachments.map(a => a.filePath))
      const detectedFiles = [...mediaAttachments, ...heuristicAttachments.filter(a => !seenPaths.has(a.filePath))]

      const uploadsDir = getUploadsDir()
      for (const att of detectedFiles) {
        try {
          // Copy to uploads dir so it's accessible via /api/upload/
          const destName = `agent_${Date.now()}_${att.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
          const destPath = path.join(uploadsDir, destName)
          fs.copyFileSync(att.filePath, destPath)
          if (att.isImage) {
            blocks.push({ type: 'image_attachment', url: `/api/upload/${destName}`, name: att.name })
          } else {
            blocks.push({ type: 'file_attachment', url: `/api/upload/${destName}`, name: att.name, size: att.size, mimeType: att.mimeType })
          }
          // Emit SSE event so frontend renders immediately
          await emit({ type: 'attachment', attachment: att.isImage
            ? { type: 'image_attachment', url: `/api/upload/${destName}`, name: att.name }
            : { type: 'file_attachment', url: `/api/upload/${destName}`, name: att.name, size: att.size, mimeType: att.mimeType }
          })
        } catch { /* skip unreadable files */ }
      }

      // Save assistant message to SQLite (dual persistence)
      const assistantMsgId = crypto.randomUUID()
      db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?, ?, ?, ?)').run(
        assistantMsgId, sessionId, 'assistant', JSON.stringify(blocks)
      )

      // Update session title
      const msgCount = db.prepare('SELECT COUNT(*) as count FROM messages WHERE session_id = ?').get(sessionId) as { count: number }
      if (msgCount.count <= 2) {
        const title = effectiveMessage.length > 50 ? effectiveMessage.slice(0, 47) + '...' : effectiveMessage
        db.prepare("UPDATE sessions SET title = ?, updated_at = datetime('now') WHERE id = ?").run(title, sessionId)
      } else {
        db.prepare("UPDATE sessions SET updated_at = datetime('now') WHERE id = ?").run(sessionId)
      }

      await emit({
        type: 'done',
        messageId: assistantMsgId,
        userMessageId: userMsgId,
        inputTokens: mapper.inputTokens,
        outputTokens: mapper.outputTokens,
      })
    } catch (err) {
      // Save partial response if any blocks were generated
      const blocks = mapper.getBlocks()
      if (blocks.length > 0) {
        const assistantMsgId = crypto.randomUUID()
        db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?, ?, ?, ?)').run(
          assistantMsgId, sessionId, 'assistant', JSON.stringify(blocks)
        )
      } else {
        db.prepare('DELETE FROM messages WHERE id = ?').run(userMsgId)
      }

      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      await emit({ type: 'error', error: errorMessage })
    } finally {
      try { await writer.close() } catch { /* already closed */ }
    }
  })()

  // Handle client disconnect
  req.signal.addEventListener('abort', () => {
    abortController.abort()
  })

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

function jsonError(msg: string, status: number) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
