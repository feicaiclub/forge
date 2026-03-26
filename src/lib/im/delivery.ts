/**
 * Delivery Layer (Layer 5).
 *
 * Handles outbound message delivery with:
 *   - Token bucket rate limiting (20 msgs/min/chat)
 *   - Platform-specific message chunking
 *   - Retry with exponential backoff
 *   - Deduplication via channel_dedupe table
 *   - Audit logging to channel_audit_logs table
 *   - Outbound message reference tracking (for edit/delete)
 */

import { getDb } from '@/lib/db'
import crypto from 'crypto'
import type { ChannelAdapter } from './adapters/base'
import type { ChannelType, DeliveryOptions } from './types'
import { renderForPlatform } from './markdown-ir'

// ---------------------------------------------------------------------------
// Rate limiter (token bucket)
// ---------------------------------------------------------------------------

class TokenBucket {
  private tokens: number
  private lastRefill: number

  constructor(
    private readonly capacity: number,
    private readonly refillRate: number, // tokens per second
  ) {
    this.tokens = capacity
    this.lastRefill = Date.now()
  }

  async acquire(): Promise<void> {
    this.refill()
    if (this.tokens >= 1) {
      this.tokens -= 1
      return
    }

    // Wait until a token is available
    const waitMs = ((1 - this.tokens) / this.refillRate) * 1000
    await sleep(Math.ceil(waitMs))
    this.refill()
    this.tokens -= 1
  }

  private refill(): void {
    const now = Date.now()
    const elapsed = (now - this.lastRefill) / 1000
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillRate)
    this.lastRefill = now
  }
}

// ---------------------------------------------------------------------------
// Delivery Layer
// ---------------------------------------------------------------------------

/** Platform-specific max message lengths */
const MAX_MSG_LEN: Record<ChannelType, number> = {
  telegram: 4000,
  discord: 1900,
  feishu: 30000,
}

export class DeliveryLayer {
  private rateLimiters = new Map<string, TokenBucket>()
  private lastDedupeCleanup = 0
  private lastRateLimiterCleanup = 0

  /**
   * Deliver a message through the full delivery pipeline.
   *
   * @returns The platform message ID (for subsequent edit/delete), or undefined.
   */
  async deliver(
    adapter: ChannelAdapter,
    chatId: string,
    text: string,
    options?: DeliveryOptions,
  ): Promise<string | undefined> {
    const channelType = adapter.channelType
    console.log(`[Delivery] deliver called: chat=${chatId}, text="${text.slice(0, 40)}", opts=${JSON.stringify(options || {})}`)


    // Typing indicator — bypass rate limiting and chunking
    if (options?.isTypingIndicator) {
      try {
        await adapter.sendTypingIndicator(chatId)
      } catch { /* ignore */ }
      return undefined
    }

    // Delete message
    if (options?.deleteMessageId) {
      try {
        await adapter.send({
          chatId,
          text: '',
          deleteMessageId: options.deleteMessageId,
        })
        this.logAudit('delete', channelType, chatId, { messageId: options.deleteMessageId })
      } catch { /* ignore */ }
      return undefined
    }

    // Rate limiting
    console.log(`[Delivery] acquiring rate token...`)
    await this.acquireToken(chatId, channelType)
    console.log(`[Delivery] token acquired, rendering...`)

    // Render markdown for platform
    const rendered = renderForPlatform(text, channelType)

    // Edit existing message (for streaming draft)
    if (options?.editMessageId) {
      const editResult = await this.retryWithBackoff(async () => {
        return adapter.send({
          chatId,
          text: rendered,
          editMessageId: options.editMessageId,
          parseMode: 'markdown',
        })
      })

      this.logAudit('edit', channelType, chatId, { messageId: options.editMessageId })
      return editResult
    }

    // Chunk message for platform limits
    const chunks = this.chunkMessage(rendered, channelType)

    let lastMsgId: string | undefined
    for (const chunk of chunks) {
      // Dedup check (skippable for ephemeral messages like placeholders)
      if (!options?.skipDedup && await this.isDuplicate(chatId, channelType, chunk)) {
        continue
      }

      console.log(`[Delivery] sending chunk (${chunk.length} chars)...`)
      lastMsgId = await this.retryWithBackoff(async () => {
        return adapter.send({
          chatId,
          text: chunk,
          parseMode: 'markdown',
          replyToMessageId: options?.replyToId,
        })
      })
      console.log(`[Delivery] sent, msgId=${lastMsgId}`)

      // Track outbound reference
      if (lastMsgId) {
        this.trackOutboundRef(channelType, chatId, lastMsgId)
      }

      this.logAudit('send', channelType, chatId, {
        length: chunk.length,
        platformMsgId: lastMsgId,
      })
    }

    return lastMsgId
  }

  // ---------------------------------------------------------------------------
  // Rate limiting
  // ---------------------------------------------------------------------------

  private async acquireToken(chatId: string, channelType: ChannelType): Promise<void> {
    const key = `${channelType}:${chatId}`
    let bucket = this.rateLimiters.get(key)
    if (!bucket) {
      // 20 messages per minute = 1/3 per second, burst of 5
      bucket = new TokenBucket(5, 1 / 3)
      this.rateLimiters.set(key, bucket)
    }
    await bucket.acquire()

    // Periodic cleanup: prune stale rate limiters every 10 minutes (P31 fix)
    const now = Date.now()
    if (now - this.lastRateLimiterCleanup > 600_000 && this.rateLimiters.size > 50) {
      this.lastRateLimiterCleanup = now
      // Keep only the most recently used buckets (simple strategy: clear all, active chats will re-create)
      this.rateLimiters.clear()
      console.log('[DeliveryLayer] Pruned stale rate limiters')
    }
  }

  // ---------------------------------------------------------------------------
  // Message chunking
  // ---------------------------------------------------------------------------

  private chunkMessage(text: string, channelType: ChannelType): string[] {
    const maxLen = MAX_MSG_LEN[channelType] || 4000
    if (text.length <= maxLen) return [text]

    const chunks: string[] = []
    let remaining = text
    while (remaining.length > 0) {
      if (remaining.length <= maxLen) {
        chunks.push(remaining)
        break
      }
      // Try to split at newline
      let splitIdx = remaining.lastIndexOf('\n', maxLen)
      if (splitIdx < maxLen * 0.5) splitIdx = maxLen
      chunks.push(remaining.slice(0, splitIdx))
      remaining = remaining.slice(splitIdx).trimStart()
    }
    return chunks
  }

  // ---------------------------------------------------------------------------
  // Retry
  // ---------------------------------------------------------------------------

  private async retryWithBackoff<T>(
    fn: () => Promise<T>,
    maxRetries = 3,
  ): Promise<T> {
    let lastError: Error | undefined
    for (let i = 0; i <= maxRetries; i++) {
      try {
        return await fn()
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
        if (i < maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, i), 10000)
          await sleep(delay)
        }
      }
    }
    throw lastError
  }

  // ---------------------------------------------------------------------------
  // Deduplication
  // ---------------------------------------------------------------------------

  private async isDuplicate(chatId: string, channelType: ChannelType, text: string): Promise<boolean> {
    try {
      const db = getDb()
      const hash = this.hashText(`${channelType}:${chatId}:${text}`)

      const existing = db.prepare('SELECT hash FROM channel_dedupe WHERE hash = ?').get(hash)
      if (existing) return true

      // Insert with TTL (will be cleaned up periodically)
      db.prepare('INSERT OR IGNORE INTO channel_dedupe (hash, channel_type, chat_id) VALUES (?, ?, ?)')
        .run(hash, channelType, chatId)

      // Throttled cleanup: max once per 60 seconds (P4 fix)
      const now = Date.now()
      if (now - this.lastDedupeCleanup > 60_000) {
        this.lastDedupeCleanup = now
        db.prepare("DELETE FROM channel_dedupe WHERE created_at < datetime('now', '-5 minutes')")
          .run()
      }

      return false
    } catch {
      return false // Skip dedup on errors
    }
  }

  private hashText(text: string): string {
    // Use SHA-256 truncated to 16 hex chars for reliable dedup
    const hash = crypto.createHash('sha256').update(text).digest('hex').slice(0, 16)
    return `dedup:${hash}`
  }

  // ---------------------------------------------------------------------------
  // Outbound reference tracking
  // ---------------------------------------------------------------------------

  private trackOutboundRef(channelType: ChannelType, chatId: string, platformMsgId: string): void {
    try {
      const db = getDb()
      db.prepare(
        'INSERT INTO channel_outbound_refs (id, channel_type, chat_id, internal_id, platform_msg_id) VALUES (?, ?, ?, ?, ?)',
      ).run(crypto.randomUUID(), channelType, chatId, crypto.randomUUID(), platformMsgId)
    } catch { /* ignore */ }
  }

  // ---------------------------------------------------------------------------
  // Audit logging
  // ---------------------------------------------------------------------------

  private logAudit(action: string, channelType: ChannelType, chatId: string, details: unknown): void {
    try {
      const db = getDb()
      db.prepare(
        'INSERT INTO channel_audit_logs (id, channel_type, chat_id, action, details) VALUES (?, ?, ?, ?, ?)',
      ).run(crypto.randomUUID(), channelType, chatId, action, JSON.stringify(details))
    } catch { /* ignore audit errors */ }
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
