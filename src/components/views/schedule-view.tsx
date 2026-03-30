'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { Plus, Heart, Clock, Play, Trash2, X, Power, ExternalLink, Pencil } from 'lucide-react'
import { CustomSelect, type SelectOption } from '@/components/ui/custom-select'
import { cn } from '@/lib/utils'
import { useI18n } from '@/components/providers/i18n-provider'
import { useCronTasks } from '@/hooks/use-cron-tasks'
import { useTaskExecutions } from '@/hooks/use-task-executions'
import type { CronTask, TaskActionType } from '@/lib/types'

/* ─── Frequency → Cron helpers ─── */
type FreqUnit = 'once' | 'minutes' | 'hourly' | 'daily' | 'weekly' | 'monthly'

interface VisualSchedule {
  unit: FreqUnit
  interval: number // e.g. 5, 15, 30 for "minutes"
  time: string     // HH:MM for daily/weekly/monthly/once
  dayOfWeek: number // 0-6 for weekly (0=Sun)
  dayOfMonth: number // 1-31 for monthly
  onceDate: string // YYYY-MM-DD for once
}

const DEFAULT_SCHEDULE: VisualSchedule = { unit: 'daily', interval: 30, time: '09:00', dayOfWeek: 1, dayOfMonth: 1, onceDate: new Date().toISOString().slice(0, 10) }

function scheduleToCron(s: VisualSchedule): string {
  switch (s.unit) {
    case 'once': {
      // Store as a specific date+time cron. The engine will disable the task after execution.
      const [h, m] = s.time.split(':').map(Number)
      const d = new Date(s.onceDate)
      return `${m || 0} ${h || 9} ${d.getDate()} ${d.getMonth() + 1} *`
    }
    case 'minutes': return `*/${s.interval} * * * *`
    case 'hourly': return '0 * * * *'
    case 'daily': {
      const [h, m] = s.time.split(':').map(Number)
      return `${m || 0} ${h || 9} * * *`
    }
    case 'weekly': {
      const [h, m] = s.time.split(':').map(Number)
      return `${m || 0} ${h || 9} * * ${s.dayOfWeek}`
    }
    case 'monthly': {
      const [h, m] = s.time.split(':').map(Number)
      return `${m || 0} ${h || 9} ${s.dayOfMonth} * *`
    }
  }
}

function cronToHumanLabel(cron: string, t: (key: string) => string): string {
  if (!cron) return '—'
  const parts = cron.split(/\s+/)
  if (parts.length !== 5) return cron

  const [min, hour, dom, month, dow] = parts

  if (min.startsWith('*/')) return t('schedule.everyNMin').replace('{n}', min.slice(2))
  if (hour === '*' && min === '0') return t('schedule.everyHour')
  const hh = hour.padStart(2, '0')
  const mm = min.padStart(2, '0')
  if (dow !== '*') {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    return `${days[Number(dow)] || dow} ${hh}:${mm}`
  }
  // Once: specific day+month (dom and month are not *)
  if (dom !== '*' && month !== '*') return `${t('schedule.once')} ${month}/${dom} ${hh}:${mm}`
  if (dom !== '*') return t('schedule.day').replace('{dom}', dom).replace('{time}', `${hh}:${mm}`)
  return t('schedule.everyDay').replace('{time}', `${hh}:${mm}`)
}

const MINUTE_OPTIONS: SelectOption[] = [5, 10, 15, 20, 30, 45].map(n => ({ value: String(n), label: `${n} min` }))
const DOW_OPTIONS: SelectOption[] = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d, i) => ({ value: String(i), label: d }))
const DOM_OPTIONS: SelectOption[] = Array.from({ length: 28 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'))

/* ─── Custom Time Picker ─── */
function TimePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const [hh, mm] = value.split(':')
  const hourRef = useRef<HTMLDivElement>(null)
  const minRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Scroll selected items into view when dropdown opens
  useEffect(() => {
    if (!open) return
    setTimeout(() => {
      hourRef.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: 'center' })
      minRef.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: 'center' })
    }, 0)
  }, [open])

  return (
    <div ref={ref} className="relative w-[120px]">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          'w-full h-10 px-3 rounded-lg bg-elevated border text-[14px] text-primary flex items-center justify-between',
          open ? 'border-indigo' : 'border-subtle'
        )}
      >
        <span>{value}</span>
        <Clock size={16} className="text-muted" />
      </button>
      {open && (
        <div className="absolute top-[calc(100%+4px)] left-0 w-[120px] rounded-lg bg-elevated border border-subtle z-50 flex overflow-hidden shadow-lg">
          <div ref={hourRef} className="flex-1 max-h-[180px] overflow-y-auto scrollbar-thin">
            {HOURS.map(h => (
              <button
                key={h}
                type="button"
                data-selected={h === hh}
                onClick={() => { onChange(`${h}:${mm}`); }}
                className={cn(
                  'w-full h-8 text-[13px] flex items-center justify-center',
                  h === hh ? 'bg-indigo text-white font-semibold' : 'text-muted hover:bg-surface-hover hover:text-secondary'
                )}
              >{h}</button>
            ))}
          </div>
          <div className="w-px bg-subtle" />
          <div ref={minRef} className="flex-1 max-h-[180px] overflow-y-auto scrollbar-thin">
            {MINUTES.map(m => (
              <button
                key={m}
                type="button"
                data-selected={m === mm}
                onClick={() => { onChange(`${hh}:${m}`); }}
                className={cn(
                  'w-full h-8 text-[13px] flex items-center justify-center',
                  m === mm ? 'bg-indigo text-white font-semibold' : 'text-muted hover:bg-surface-hover hover:text-secondary'
                )}
              >{m}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/* ─── Main component ─── */

interface ScheduleViewProps {
  workspaceId: string
}

export function ScheduleView({ workspaceId }: ScheduleViewProps) {
  const { t } = useI18n()
  const { tasks, heartbeat, updateTask, createTask, deleteTask, executeTask } = useCronTasks(workspaceId)
  const { executions, refreshExecutions, loadMore, hasMore, loadingMore, typeFilter, statusFilter, setTypeFilter, setStatusFilter } = useTaskExecutions(workspaceId)
  const [showNewForm, setShowNewForm] = useState(false)
  const [editingTask, setEditingTask] = useState<CronTask | null>(null)
  const [showChecklist, setShowChecklist] = useState(false)
  const [engineRunning, setEngineRunning] = useState(false)
  const [engineLoading, setEngineLoading] = useState(false)

  useEffect(() => {
    fetch('/api/cron-engine').then(r => r.json()).then(d => setEngineRunning(d.running)).catch(() => {})
  }, [])

  const toggleEngine = useCallback(async () => {
    setEngineLoading(true)
    try {
      const res = await fetch('/api/cron-engine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: engineRunning ? 'stop' : 'start' }),
      })
      const data = await res.json()
      setEngineRunning(data.running)
    } catch { /* ignore */ }
    setEngineLoading(false)
  }, [engineRunning])

  const cronTasks = tasks.filter((tk) => !tk.isHeartbeat)

  const handleExecuteHeartbeat = useCallback(async () => {
    if (!heartbeat) return
    await executeTask(heartbeat.id)
    refreshExecutions()
    window.dispatchEvent(new CustomEvent('forge:sessions-changed'))
  }, [heartbeat, executeTask, refreshExecutions])

  const handleToggleTask = useCallback(async (id: string, enabled: boolean) => {
    await updateTask(id, { enabled })
  }, [updateTask])

  const handleDeleteTask = useCallback(async (id: string) => {
    await deleteTask(id)
  }, [deleteTask])

  const handleCreateTask = useCallback(async (opts: Parameters<typeof createTask>[0]) => {
    await createTask(opts)
    setShowNewForm(false)
  }, [createTask])

  const handleEditTask = useCallback(async (id: string, opts: Record<string, unknown>) => {
    await updateTask(id, opts)
    setEditingTask(null)
  }, [updateTask])

  const actionLabel = (task: { actionType: string; agentName: string; skillName: string; action: string }) => {
    switch (task.actionType) {
      case 'run-agent': return `${t('schedule.actionType.runAgent')}: ${task.agentName || '—'}`
      case 'run-skill': return `${t('schedule.actionType.runSkill')}: ${task.skillName || '—'}`
      default: return t('schedule.actionType.customPrompt')
    }
  }

  const INTERVALS = [
    { value: '5m', label: '5 Minutes' },
    { value: '15m', label: '15 Minutes' },
    { value: '30m', label: '30 Minutes' },
    { value: '1h', label: '1 Hour' },
    { value: '6h', label: '6 Hours' },
    { value: '24h', label: '24 Hours' },
  ]

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between h-[52px] px-6 border-b border-subtle shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-[20px] font-semibold text-primary font-heading tracking-tight">{t('schedule.title')}</span>
          <button
            onClick={toggleEngine}
            disabled={engineLoading}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors',
              engineRunning
                ? 'bg-green/10 text-green hover:bg-green/20'
                : 'bg-surface-active text-muted hover:bg-surface-hover',
            )}
          >
            <Power size={12} />
            {engineLoading ? '...' : engineRunning ? t('schedule.engineRunning') : t('schedule.engineStopped')}
          </button>
        </div>
        <button
          onClick={() => setShowNewForm(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo text-white text-[13px] font-medium hover:opacity-90"
        >
          <Plus size={14} /> {t('schedule.newTask')}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-8 py-6 space-y-6">
        {/* Heartbeat Section */}
        {heartbeat && (
          <div className="rounded-xl bg-surface border border-subtle p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Heart size={16} className="text-coral" />
                <span className="text-[14px] font-semibold text-primary">{t('schedule.heartbeat')}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className={cn('text-[12px]', heartbeat.enabled ? 'text-green' : 'text-muted')}>
                  {heartbeat.enabled ? t('schedule.enabled') : t('schedule.disabled')}
                </span>
                <button
                  onClick={() => updateTask(heartbeat.id, { enabled: !heartbeat.enabled })}
                  className={cn(
                    'w-9 h-5 rounded-full p-0.5 transition-colors',
                    heartbeat.enabled ? 'bg-green' : 'bg-surface-active'
                  )}
                >
                  <div className={cn('w-4 h-4 rounded-full bg-white transition-transform duration-200', heartbeat.enabled ? 'translate-x-[14px]' : 'translate-x-0')} />
                </button>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-[12px] text-secondary mb-1.5">{t('schedule.checkInterval')}</label>
                <CustomSelect
                  value={heartbeat.config.check_interval || '30m'}
                  onChange={(v) => {
                    // Also sync the cron schedule expression
                    const cronMap: Record<string, string> = {
                      '5m': '*/5 * * * *', '15m': '*/15 * * * *', '30m': '*/30 * * * *',
                      '1h': '0 * * * *', '6h': '0 */6 * * *', '24h': '0 9 * * *',
                    }
                    updateTask(heartbeat.id, {
                      config: { ...heartbeat.config, check_interval: v },
                      schedule: cronMap[v] || '*/30 * * * *',
                    })
                  }}
                  options={INTERVALS.map((i) => ({ value: i.value, label: i.label }))}
                  size="sm"
                />
              </div>
              <div>
                <label className="block text-[12px] text-secondary mb-1.5">{t('schedule.notifyChannel')}</label>
                <CustomSelect
                  value={heartbeat.config.notify_channel || 'telegram'}
                  onChange={(v) => updateTask(heartbeat.id, { config: { ...heartbeat.config, notify_channel: v } })}
                  options={[
                    { value: 'telegram', label: 'Telegram' },
                    { value: 'feishu', label: 'Feishu' },
                    { value: 'discord', label: 'Discord' },
                  ]}
                  size="sm"
                />
              </div>
              <div>
                <label className="block text-[12px] text-secondary mb-1.5">HEARTBEAT.md</label>
                <button
                  onClick={() => setShowChecklist(true)}
                  className="w-full h-9 flex items-center justify-center rounded-lg bg-elevated border border-subtle text-[13px] text-secondary hover:bg-surface-hover transition-colors"
                >
                  {t('schedule.editChecklist')}
                </button>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-[11px] text-muted">
                <Clock size={12} className="shrink-0" />
                <span>{t('schedule.lastRun')} {heartbeat.lastRunAt ? new Date(heartbeat.lastRunAt).toLocaleString() : t('schedule.never')}</span>
                {heartbeat.lastRunResult && (
                  <span className={cn(
                    'px-1.5 py-0.5 rounded text-[10px] font-medium',
                    heartbeat.lastRunResult.includes('error') || heartbeat.lastRunResult.includes('fail')
                      ? 'bg-coral/15 text-coral'
                      : 'bg-green/15 text-green'
                  )}>
                    {heartbeat.lastRunResult.includes('error') || heartbeat.lastRunResult.includes('fail') ? t('schedule.failed') : t('schedule.success')}
                  </span>
                )}
              </div>
              <button
                onClick={handleExecuteHeartbeat}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-subtle text-[12px] text-secondary hover:bg-surface-hover transition-colors shrink-0 whitespace-nowrap"
              >
                <Play size={11} /> {t('schedule.checkNow')}
              </button>
            </div>
          </div>
        )}

        {/* Cron Tasks Table */}
        <div className="rounded-xl bg-surface border border-subtle p-5">
          <h2 className="text-[14px] font-semibold text-primary mb-3">{t('schedule.cronTasks')}</h2>
          <table className="w-full">
            <thead>
              <tr className="border-b border-subtle">
                <th className="text-left text-[11px] font-medium text-muted pb-2 w-8"></th>
                <th className="text-left text-[11px] font-medium text-muted pb-2 w-[160px]">{t('table.name')}</th>
                <th className="text-left text-[11px] font-medium text-muted pb-2 w-[160px]">{t('table.schedule')}</th>
                <th className="text-left text-[11px] font-medium text-muted pb-2">{t('table.action')}</th>
                <th className="text-right text-[11px] font-medium text-muted pb-2 w-[100px]"></th>
              </tr>
            </thead>
            <tbody>
              {cronTasks.map((task) => (
                <tr key={task.id} className="border-b border-subtle last:border-0 group">
                  <td className="py-2.5">
                    <div className={cn('w-2 h-2 rounded-full', task.enabled ? 'bg-green' : 'bg-muted')} />
                  </td>
                  <td className="py-2.5 text-[13px] text-primary">{task.name}</td>
                  <td className="py-2.5 text-[12px] text-secondary">{cronToHumanLabel(task.schedule, t)}</td>
                  <td className="py-2.5 text-[12px] text-secondary">{actionLabel(task)}</td>
                  <td className="py-2.5">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => handleToggleTask(task.id, !task.enabled)}
                        className={cn(
                          'w-9 h-5 rounded-full p-0.5 transition-colors',
                          task.enabled ? 'bg-green' : 'bg-surface-active'
                        )}
                      >
                        <div className={cn('w-4 h-4 rounded-full bg-white transition-transform duration-200', task.enabled ? 'translate-x-[14px]' : 'translate-x-0')} />
                      </button>
                      <button
                        onClick={() => setEditingTask(task)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Pencil size={13} className="text-muted hover:text-indigo" />
                      </button>
                      <button
                        onClick={() => handleDeleteTask(task.id)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Trash2 size={13} className="text-muted hover:text-coral" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {cronTasks.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-[12px] text-muted">
                    {t('schedule.noCronTasks')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Execution History */}
        <div className="rounded-xl bg-surface border border-subtle p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[14px] font-semibold text-primary">{t('schedule.executionHistory')}</h2>
            <div className="flex items-center gap-2">
              <CustomSelect
                value={typeFilter}
                onChange={setTypeFilter}
                options={[
                  { value: 'all', label: 'All Types' },
                  { value: 'heartbeat', label: 'Heartbeat' },
                  { value: 'cron', label: 'Cron Tasks' },
                ]}
                size="sm"
              />
              <CustomSelect
                value={statusFilter}
                onChange={setStatusFilter}
                options={[
                  { value: 'all', label: 'All Status' },
                  { value: 'ok', label: '✓ OK' },
                  { value: 'alert', label: '⚠ Alert' },
                  { value: 'error', label: '✗ Error' },
                ]}
                size="sm"
              />
            </div>
          </div>
          {executions.length > 0 ? (
            <div className="space-y-1">
              {executions.map((exec) => (
                <div key={exec.id} className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-surface-hover transition-colors">
                  <div className="flex items-center gap-3">
                    <span className="text-[11px] text-muted font-mono w-[120px] shrink-0">
                      {exec.executedAt?.slice(5, 16).replace('T', ' ') || ''}
                    </span>
                    <span className="text-[12px] text-secondary w-[120px] shrink-0">{exec.taskName}</span>
                    <span className={cn('text-[12px]',
                      exec.status === 'ok' ? 'text-green' : exec.status === 'alert' ? 'text-amber' : 'text-coral'
                    )}>
                      {exec.status === 'ok' ? '✓' : exec.status === 'alert' ? '⚠' : '✗'} {exec.result?.slice(0, 60)}
                    </span>
                  </div>
                  {exec.sessionId && (
                    <button
                      onClick={() => {
                        window.dispatchEvent(new CustomEvent('forge:navigate-session', { detail: { sessionId: exec.sessionId } }))
                      }}
                      className="flex items-center gap-1 text-[12px] text-indigo hover:underline shrink-0"
                    >
                      <ExternalLink size={11} /> {t('schedule.viewSession')}
                    </button>
                  )}
                </div>
              ))}
              {hasMore && (
                <div className="flex justify-center pt-3">
                  <button
                    onClick={loadMore}
                    disabled={loadingMore}
                    className="px-4 py-1.5 rounded-lg border border-subtle text-[12px] text-secondary hover:bg-surface-hover transition-colors disabled:opacity-50"
                  >
                    {loadingMore ? '...' : 'Load More'}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <p className="text-[12px] text-muted text-center py-4">{t('schedule.noExecutionHistory')}</p>
          )}
        </div>
      </div>

      {/* Checklist Editor Modal */}
      {showChecklist && (
        <EditChecklistModal workspaceId={workspaceId} onClose={() => setShowChecklist(false)} />
      )}

      {/* New Task Modal */}
      {showNewForm && (
        <TaskFormModal
          mode="create"
          workspaceId={workspaceId}
          onSubmit={async (opts) => { await handleCreateTask(opts); }}
          onClose={() => setShowNewForm(false)}
        />
      )}

      {/* Edit Task Modal */}
      {editingTask && (
        <TaskFormModal
          mode="edit"
          workspaceId={workspaceId}
          task={editingTask}
          onSubmit={async (opts) => { await handleEditTask(editingTask.id, opts); }}
          onClose={() => setEditingTask(null)}
        />
      )}
    </div>
  )
}

/* ─── Edit Checklist Modal ─── */

function EditChecklistModal({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const { t } = useI18n()
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch(`/api/workspaces/${workspaceId}/files?name=HEARTBEAT.md`)
      .then((r) => r.ok ? r.json() : { content: '' })
      .then((d) => setContent(d.content || ''))
      .catch(() => setContent(''))
      .finally(() => setLoading(false))
  }, [workspaceId])

  const handleSave = async () => {
    setSaving(true)
    try {
      await fetch(`/api/workspaces/${workspaceId}/files`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'HEARTBEAT.md', content }),
      })
      onClose()
    } catch { /* ignore */ }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 animate-fade-in">
      <div className="w-[560px] max-h-[80vh] rounded-xl bg-surface border border-subtle p-5 flex flex-col animate-scale-in">
        <div className="flex items-center justify-between mb-4">
          <span className="text-[14px] font-semibold text-primary">{t('schedule.editHeartbeat')}</span>
          <button onClick={onClose} className="text-muted hover:text-secondary"><X size={16} /></button>
        </div>
        {loading ? (
          <p className="text-[12px] text-muted py-4">{t('common.loading')}</p>
        ) : (
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="flex-1 min-h-[300px] w-full px-3 py-2 rounded-lg bg-elevated border border-subtle text-[13px] text-primary font-mono outline-none focus:border-indigo resize-none"
            placeholder="# Heartbeat Checklist&#10;&#10;- [ ] Check disk space&#10;- [ ] Check API health&#10;- [ ] Check error logs"
          />
        )}
        <div className="flex justify-end gap-2 pt-3">
          <button onClick={onClose} className="px-4 py-1.5 rounded-lg border border-subtle text-[12px] text-secondary hover:bg-surface-hover">
            {t('common.cancel')}
          </button>
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-1.5 rounded-lg bg-indigo text-white text-[12px] font-medium hover:opacity-90 disabled:opacity-50">
            {saving ? t('status.saving') : t('common.save')}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ─── Cron → Visual Schedule reverse parser ─── */

function cronToSchedule(cron: string): VisualSchedule {
  const s = { ...DEFAULT_SCHEDULE }
  if (!cron) return s
  const parts = cron.split(/\s+/)
  if (parts.length !== 5) return s
  const [min, hour, dom, , dow] = parts

  if (min.startsWith('*/')) {
    s.unit = 'minutes'
    s.interval = parseInt(min.slice(2), 10) || 30
  } else if (hour === '*' && min === '0') {
    s.unit = 'hourly'
  } else if (dow !== '*') {
    s.unit = 'weekly'
    s.dayOfWeek = parseInt(dow, 10) || 0
    s.time = `${hour.padStart(2, '0')}:${min.padStart(2, '0')}`
  } else if (dom !== '*') {
    s.unit = 'monthly'
    s.dayOfMonth = parseInt(dom, 10) || 1
    s.time = `${hour.padStart(2, '0')}:${min.padStart(2, '0')}`
  } else {
    s.unit = 'daily'
    s.time = `${hour.padStart(2, '0')}:${min.padStart(2, '0')}`
  }
  return s
}

/* ─── Task Form Modal (Create + Edit) ─── */

function TaskFormModal({ mode, workspaceId, task, onSubmit, onClose }: {
  mode: 'create' | 'edit'
  workspaceId: string
  task?: CronTask
  onSubmit: (opts: {
    name: string
    schedule?: string
    action?: string
    action_type?: TaskActionType
    agent_name?: string
    skill_name?: string
    workspace_id?: string
    config?: Record<string, string>
  }) => Promise<void>
  onClose: () => void
}) {
  const { t } = useI18n()
  const [name, setName] = useState(task?.name || '')
  const [schedule, setSchedule] = useState<VisualSchedule>(task ? cronToSchedule(task.schedule) : { ...DEFAULT_SCHEDULE })
  const [actionType, setActionType] = useState<TaskActionType>(task?.actionType || 'run-agent')
  const [agentName, setAgentName] = useState(task?.agentName || '')
  const [skillName, setSkillName] = useState(task?.skillName || '')
  const [notifyChannel, setNotifyChannel] = useState(task?.config.notify_channel || 'none')
  const [description, setDescription] = useState(task?.action || '')
  const [submitting, setSubmitting] = useState(false)

  // Fetch available agents for this workspace
  const [agents, setAgents] = useState<SelectOption[]>([])
  const [skills, setSkills] = useState<SelectOption[]>([])

  const FREQ_OPTIONS: SelectOption[] = [
    { value: 'once', label: t('schedule.frequency.once') },
    { value: 'minutes', label: t('schedule.frequency.minutes') },
    { value: 'hourly', label: t('schedule.frequency.hourly') },
    { value: 'daily', label: t('schedule.frequency.daily') },
    { value: 'weekly', label: t('schedule.frequency.weekly') },
    { value: 'monthly', label: t('schedule.frequency.monthly') },
  ]

  const ACTION_OPTIONS: SelectOption[] = [
    { value: 'run-agent', label: t('schedule.actionType.runAgent') },
    { value: 'run-skill', label: t('schedule.actionType.runSkill') },
    { value: 'custom-prompt', label: t('schedule.actionType.customPrompt') },
  ]

  useEffect(() => {
    if (!workspaceId) return
    // Fetch project-level agents
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/agents`)
      .then(r => r.ok ? r.json() : [])
      .then(data => {
        const items: SelectOption[] = (Array.isArray(data) ? data : []).map((a: { filename: string; name: string }) => ({
          value: a.filename.replace(/\.md$/, ''),
          label: `${a.name || a.filename} (Project)`,
        }))
        // Also fetch global agents
        return fetch('/api/workspaces/__global__/agents')
          .then(r => r.ok ? r.json() : [])
          .then(gData => {
            const gItems: SelectOption[] = (Array.isArray(gData) ? gData : []).map((a: { filename: string; name: string }) => ({
              value: `global:${a.filename.replace(/\.md$/, '')}`,
              label: `${a.name || a.filename} (Global)`,
            }))
            setAgents([...items, ...gItems])
          })
      })
      .catch(() => setAgents([]))
  }, [workspaceId])

  useEffect(() => {
    // Fetch skills from DB (already have global scope info)
    fetch('/api/skills')
      .then(r => r.ok ? r.json() : [])
      .then(data => {
        const items: SelectOption[] = (Array.isArray(data) ? data : []).map((s: { id: string; name: string; scope: string }) => ({
          value: `${s.scope}:${s.name}`,
          label: `${s.name} (${s.scope === 'workspace' ? 'Project' : 'Global'})`,
        }))
        setSkills(items)
      })
      .catch(() => setSkills([]))
  }, [])

  const handleSubmit = async () => {
    if (!name.trim()) return
    setSubmitting(true)
    try {
      await onSubmit({
        name: name.trim(),
        schedule: scheduleToCron(schedule),
        action: description,
        action_type: actionType,
        agent_name: actionType === 'run-agent' ? agentName.replace(/^global:/, '') : '',
        skill_name: actionType === 'run-skill' ? skillName.replace(/^(workspace|global):/, '') : '',
        workspace_id: workspaceId,
        config: {
          notify_channel: notifyChannel === 'none' ? '' : notifyChannel,
          description,
        },
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 animate-fade-in">
      <div className="w-[500px] rounded-xl bg-surface border border-subtle flex flex-col animate-scale-in">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-subtle">
          <span className="text-[18px] font-semibold text-primary">{mode === 'edit' ? t('schedule.editTaskTitle') : t('schedule.newTaskTitle')}</span>
          <button onClick={onClose} className="text-muted hover:text-secondary"><X size={18} /></button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          {/* Task Name */}
          <div>
            <label className="block text-[13px] text-secondary mb-1.5 font-medium">{t('form.taskName')}</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('form.taskNamePlaceholder')}
              className="w-full h-10 px-3 rounded-lg bg-elevated border border-subtle text-[14px] text-primary placeholder:text-muted outline-none focus:border-indigo"
              autoFocus
            />
          </div>

          {/* Frequency (Visual Schedule Selector) */}
          <div>
            <label className="block text-[13px] text-secondary mb-1.5 font-medium">{t('form.frequency')}</label>
            <div className="flex gap-2">
              <div className="flex-1">
                <CustomSelect
                  value={schedule.unit}
                  onChange={(v) => setSchedule(s => ({ ...s, unit: v as FreqUnit }))}
                  options={FREQ_OPTIONS}
                  size="md"
                />
              </div>
              {schedule.unit === 'minutes' && (
                <div className="w-[100px]">
                  <CustomSelect
                    value={String(schedule.interval)}
                    onChange={(v) => setSchedule(s => ({ ...s, interval: Number(v) }))}
                    options={MINUTE_OPTIONS}
                    size="md"
                  />
                </div>
              )}
              {schedule.unit === 'once' && (
                <input
                  type="date"
                  value={schedule.onceDate}
                  onChange={(e) => setSchedule(s => ({ ...s, onceDate: e.target.value }))}
                  className="w-[140px] h-10 px-3 rounded-lg bg-elevated border border-subtle text-[14px] text-primary outline-none focus:border-indigo [color-scheme:dark]"
                />
              )}
              {(schedule.unit === 'once' || schedule.unit === 'daily' || schedule.unit === 'weekly' || schedule.unit === 'monthly') && (
                <TimePicker
                  value={schedule.time}
                  onChange={(v) => setSchedule(s => ({ ...s, time: v }))}
                />
              )}
              {schedule.unit === 'weekly' && (
                <div className="w-[130px]">
                  <CustomSelect
                    value={String(schedule.dayOfWeek)}
                    onChange={(v) => setSchedule(s => ({ ...s, dayOfWeek: Number(v) }))}
                    options={DOW_OPTIONS}
                    size="md"
                  />
                </div>
              )}
              {schedule.unit === 'monthly' && (
                <div className="w-[80px]">
                  <CustomSelect
                    value={String(schedule.dayOfMonth)}
                    onChange={(v) => setSchedule(s => ({ ...s, dayOfMonth: Number(v) }))}
                    options={DOM_OPTIONS}
                    size="md"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Action Type */}
          <div>
            <label className="block text-[13px] text-secondary mb-1.5 font-medium">{t('form.action')}</label>
            <CustomSelect
              value={actionType}
              onChange={(v) => setActionType(v as TaskActionType)}
              options={ACTION_OPTIONS}
              size="md"
            />
          </div>

          {/* Agent selector (conditional, optional) */}
          {actionType === 'run-agent' && (
            <div>
              <label className="block text-[13px] text-secondary mb-1.5 font-medium">
                {t('form.agent')} <span className="text-muted font-normal text-[12px]">({t('form.optional')})</span>
              </label>
              {agents.length > 0 ? (
                <CustomSelect
                  value={agentName}
                  onChange={setAgentName}
                  options={agents}
                  placeholder={t('input.selectAgent')}
                  size="md"
                />
              ) : (
                <div className="w-full rounded-lg bg-elevated border border-subtle px-3 py-4 flex flex-col items-center gap-2">
                  <div className="text-muted text-[13px]">{t('schedule.noAgents')}</div>
                  <div className="text-muted text-[11px] text-center leading-relaxed">{t('schedule.noAgentsHint')}</div>
                </div>
              )}
            </div>
          )}

          {/* Skill selector (conditional) */}
          {actionType === 'run-skill' && (
            <div>
              <label className="block text-[13px] text-secondary mb-1.5 font-medium">{t('form.skill')}</label>
              <CustomSelect
                value={skillName}
                onChange={setSkillName}
                options={skills}
                placeholder={t('input.selectSkill')}
                size="md"
              />
            </div>
          )}

          {/* Notification Channel */}
          <div>
            <label className="block text-[13px] text-secondary mb-1.5 font-medium">{t('form.notifyChannel')}</label>
            <CustomSelect
              value={notifyChannel}
              onChange={setNotifyChannel}
              options={[
                { value: 'none', label: t('schedule.notifyNone') },
                { value: 'telegram', label: 'Telegram' },
                { value: 'feishu', label: 'Feishu' },
                { value: 'discord', label: 'Discord' },
              ]}
              size="md"
            />
          </div>

          {/* Description / Prompt */}
          <div>
            <label className="block text-[13px] text-secondary mb-1.5 font-medium">
              {actionType === 'custom-prompt' ? t('form.promptRequired') : t('form.description')}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={actionType === 'custom-prompt'
                ? t('form.promptPlaceholder')
                : t('form.descriptionPlaceholder')}
              rows={actionType === 'custom-prompt' ? 4 : 3}
              className="w-full px-3 py-2 rounded-lg bg-elevated border border-subtle text-[14px] text-primary placeholder:text-muted outline-none focus:border-indigo resize-none leading-relaxed"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-subtle">
          <button onClick={onClose}
            className="px-4 py-1.5 rounded-lg border border-subtle text-[13px] text-secondary hover:bg-surface-hover">
            {t('common.cancel')}
          </button>
          <button
            onClick={handleSubmit}
            disabled={!name.trim() || (actionType === 'custom-prompt' && !description.trim()) || submitting}
            className="px-4 py-1.5 rounded-lg bg-indigo text-white text-[13px] font-medium hover:opacity-90 disabled:opacity-40"
          >
            {submitting ? '...' : mode === 'edit' ? t('common.save') : t('button.createTask')}
          </button>
        </div>
      </div>
    </div>
  )
}
