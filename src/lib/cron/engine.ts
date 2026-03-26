/**
 * Cron execution engine.
 * Singleton scheduler that checks all enabled tasks every 60 seconds.
 */

import { getDb } from '@/lib/db'
import crypto from 'crypto'
import { matchesCron } from './cron-parser'
import { executeTask } from './executor'
import type { CronTaskRow } from '@/lib/types'

declare const globalThis: {
  __forgeCronEngine?: CronEngine
} & typeof global

class CronEngine {
  private timer: ReturnType<typeof setInterval> | null = null
  private running = false
  private executingTasks = new Set<string>()

  start(): void {
    if (this.running) return
    this.running = true
    console.log('[CronEngine] Started')

    // Check immediately on start, then every 60 seconds
    this.tick()
    this.timer = setInterval(() => this.tick(), 60_000)
  }

  stop(): void {
    this.running = false
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    console.log('[CronEngine] Stopped')
  }

  isRunning(): boolean {
    return this.running
  }

  private async tick(): Promise<void> {
    if (!this.running) return

    const db = getDb()
    const tasks = db.prepare('SELECT * FROM cron_tasks WHERE enabled = 1').all() as CronTaskRow[]
    const now = new Date()

    for (const task of tasks) {
      if (!task.schedule.trim()) continue
      if (this.executingTasks.has(task.id)) continue // skip if already executing

      if (matchesCron(task.schedule, now)) {
        this.executingTasks.add(task.id)
        this.runTask(task).finally(() => {
          this.executingTasks.delete(task.id)
        })
      }
    }
  }

  private async runTask(task: CronTaskRow): Promise<void> {
    console.log(`[CronEngine] Executing task: ${task.name} (${task.id})`)

    const db = getDb()
    const startTime = new Date().toISOString()

    try {
      const { status, result, sessionId } = await executeTask(task)

      // Record execution with session_id
      const execId = crypto.randomUUID()
      db.prepare(
        'INSERT INTO task_executions (id, task_id, task_name, result, status, session_id, executed_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(execId, task.id, task.name, result, status, sessionId || '', startTime)

      // Update task last run
      db.prepare(
        "UPDATE cron_tasks SET last_run_at = ?, last_run_result = ?, updated_at = datetime('now') WHERE id = ?",
      ).run(startTime, result.slice(0, 200), task.id)

      // Auto-disable "once" tasks (specific day+month in cron = one-time task)
      const cronParts = task.schedule.split(/\s+/)
      if (cronParts.length === 5 && cronParts[2] !== '*' && cronParts[3] !== '*') {
        db.prepare("UPDATE cron_tasks SET enabled = 0, updated_at = datetime('now') WHERE id = ?").run(task.id)
        console.log(`[CronEngine] One-time task ${task.name} auto-disabled after execution`)
      }

      console.log(`[CronEngine] Task ${task.name}: ${status} — ${result.slice(0, 80)}`)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error'
      console.error(`[CronEngine] Task ${task.name} failed:`, errorMsg)

      const execId = crypto.randomUUID()
      db.prepare(
        'INSERT INTO task_executions (id, task_id, task_name, result, status, session_id, executed_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(execId, task.id, task.name, errorMsg, 'error', '', startTime)

      db.prepare(
        "UPDATE cron_tasks SET last_run_at = ?, last_run_result = ?, updated_at = datetime('now') WHERE id = ?",
      ).run(startTime, `Error: ${errorMsg.slice(0, 180)}`, task.id)
    }
  }
}

export function getCronEngine(): CronEngine {
  if (!globalThis.__forgeCronEngine) {
    globalThis.__forgeCronEngine = new CronEngine()
    // Auto-start if there are any enabled tasks
    const db = getDb()
    const enabledCount = db.prepare('SELECT COUNT(*) as count FROM cron_tasks WHERE enabled = 1').get() as { count: number }
    if (enabledCount.count > 0) {
      globalThis.__forgeCronEngine.start()
      console.log(`[CronEngine] Auto-started (${enabledCount.count} enabled task(s))`)
    }
  }
  return globalThis.__forgeCronEngine
}
