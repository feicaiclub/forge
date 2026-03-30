/**
 * Background memory flush — reminds the Agent to review recent conversation
 * and write to memory if there's anything worth remembering.
 *
 * Runs asynchronously after a conversation turn completes.
 * User never sees or waits for this — it's a silent background task.
 *
 * Trigger: every FLUSH_INTERVAL messages in a session (default: 5).
 */

import { getDb } from '@/lib/db'
import { createForgeQuery } from '@/lib/sdk/client'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'

/** How many messages between memory flush checks */
const FLUSH_INTERVAL = 5

/** Track last flush per session to avoid duplicate triggers */
const lastFlushCount = new Map<string, number>()

/**
 * Check if a memory flush should be triggered, and if so, run it in background.
 * Call this after saving the assistant message.
 *
 * @param sessionId - the session that just had a conversation turn
 * @param workspaceId - the workspace for context
 * @param model - the model to use for the flush query
 * @param userMessage - what the user said (for context)
 * @param assistantSummary - brief summary of agent response (first 200 chars)
 */
export function maybeFlushMemory(
  sessionId: string,
  workspaceId: string,
  model: string,
  userMessage: string,
  assistantSummary: string,
): void {
  const db = getDb()

  // Count messages in this session
  const row = db.prepare('SELECT COUNT(*) as count FROM messages WHERE session_id = ?')
    .get(sessionId) as { count: number }
  const msgCount = row.count

  // Check if we should flush (every FLUSH_INTERVAL messages)
  const lastCount = lastFlushCount.get(sessionId) || 0
  if (msgCount - lastCount < FLUSH_INTERVAL) return

  // Update tracker
  lastFlushCount.set(sessionId, msgCount)

  // Clean up stale entries (sessions no longer active)
  if (lastFlushCount.size > 100) {
    const entries = [...lastFlushCount.entries()]
    entries.slice(0, entries.length - 50).forEach(([k]) => lastFlushCount.delete(k))
  }

  // Fire and forget — run in background
  console.log(`[MemoryFlush] Triggering background memory check for session ${sessionId.slice(0, 8)} (${msgCount} messages)`)

  runMemoryFlush(workspaceId, model, userMessage, assistantSummary).catch((err) => {
    console.warn(`[MemoryFlush] Background flush failed (non-critical):`, err instanceof Error ? err.message : err)
  })
}

/**
 * Run the actual memory flush — a lightweight SDK query that asks the Agent
 * to review recent conversation and write to memory if appropriate.
 */
async function runMemoryFlush(
  workspaceId: string,
  model: string,
  userMessage: string,
  assistantSummary: string,
): Promise<void> {
  const prompt = [
    'You just completed a conversation turn. Here is a brief summary:',
    '',
    `User said: "${userMessage.slice(0, 300)}"`,
    `You responded: "${assistantSummary.slice(0, 300)}"`,
    '',
    'Please review this exchange and decide:',
    '1. Is there anything worth recording in today\'s daily memory (.claude/memory/YYYY-MM-DD.md)?',
    '2. Is there anything worth updating in MEMORY.md (persistent facts, user preferences, project decisions)?',
    '',
    'If yes, write it now using Bash + heredoc. If nothing is noteworthy, do nothing — not every exchange deserves a memory entry.',
    'Be very brief in your memory entries (1-2 lines each). Do not respond to the user — this is a background task.',
  ].join('\n')

  const q = createForgeQuery({
    prompt,
    sessionId: `memory-flush-${Date.now()}`,
    model,
    workspaceId,
    bypassPermissions: true, // memory writes need Bash access
    skipMcpServers: true,
    useImPrompt: true, // use compact prompt to save tokens
  })

  // Drain the stream silently — we don't need the response
  for await (const _msg of q as AsyncIterable<SDKMessage>) {
    // just consume, don't process
  }
}
