/**
 * IM command parser and executor (Layer 3).
 *
 * Supported commands:
 *   /new              — Create a new session for this chat
 *   /bind <id>        — Bind this chat to an existing session
 *   /sessions         — List recent sessions for binding
 *   /clear            — Clear all messages in the current session
 *   /compact          — Compress context (summarize messages)
 *   /projects         — List all registered projects
 *   /switch <name>    — Switch to existing project by name
 *   /newproject <path> — Create and switch to new project
 *   /model [name]     — View or switch model
 *   /mode [mode]      — Show or set permission mode (confirm/full)
 *   /status           — Show bridge + session status
 *   /stop             — Stop the current running task
 *   /help             — Show all available commands
 */

import { getDb } from '@/lib/db'
import crypto from 'crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ChannelAdapter } from './adapters/base'
import type { ChannelRouter } from './channel-router'
import { emitImEvent } from './im-events'
import type { ImCommand, IncomingMessage } from './types'

const KNOWN_COMMANDS = [
  'new', 'bind', 'sessions', 'clear', 'compact',
  'projects', 'switch', 'newproject', 'model',
  'mode', 'status', 'stop', 'help',
]

import { BUILTIN_MODELS } from '@/lib/models'

interface ImModelEntry {
  id: string
  label: string
  aliases: string[]
}

/**
 * Get all available models: built-in + custom providers from DB.
 * Called at runtime so custom providers are always up to date.
 */
function getAvailableModels(): ImModelEntry[] {
  const models: ImModelEntry[] = BUILTIN_MODELS.map(m => ({
    id: m.id,
    label: m.label,
    aliases: m.aliases || [],
  }))

  // Add custom provider models from DB
  try {
    const customs = getDb().prepare(
      "SELECT model_name, name FROM api_providers WHERE provider = 'custom' AND model_name != '' AND status = 'connected'"
    ).all() as { model_name: string; name: string }[]
    for (const row of customs) {
      models.push({ id: row.model_name, label: `${row.model_name} (${row.name})`, aliases: [] })
    }
  } catch { /* DB not ready */ }

  return models
}

// ---------------------------------------------------------------------------
// i18n support
// ---------------------------------------------------------------------------

/** Read the language setting from the DB. Defaults to 'en'. */
function getLang(): 'zh' | 'en' {
  const db = getDb()
  const row = db.prepare("SELECT value FROM settings WHERE key = 'language'").get() as { value: string } | undefined
  return (row?.value === 'zh') ? 'zh' : 'en'
}

const MSG = {
  zh: {
    // /help
    helpTitle: '📖 Forge IM 命令',
    helpSession: 'Session 管理',
    helpProject: '项目管理',
    helpSettings: '设置',
    helpOther: '其他',
    helpNewDesc: '创建新会话',
    helpBindDesc: '绑定到会话（例如 /bind abc1）',
    helpSessionsDesc: '列出最近的会话',
    helpClearDesc: '清空消息',
    helpCompactDesc: '压缩上下文',
    helpProjectsDesc: '列出所有项目',
    helpSwitchDesc: '切换项目（例如 /switch forge）',
    helpNewprojectDesc: '创建项目',
    helpModelDesc: '切换模型（例如 /model opus）',
    helpModeDesc: '权限模式',
    helpStatusDesc: 'Bridge 状态',
    helpStopDesc: '停止当前任务',
    // /model
    modelCurrent: '🤖 当前模型',
    modelAvailable: '可用模型',
    modelSwitched: '✅ 模型已切换为',
    modelUnknown: '❌ 未知模型',
    // /switch
    switchTitle: '📂 切换项目',
    switchUsage: '用法',
    switchSuccess: '✅ 已切换到',
    switchNoMatch: '没有匹配的项目',
    switchMultiple: '匹配到多个项目，请更具体',
    switchBeMoreSpecific: '请更具体。',
    // /projects
    projectsTitle: '📂 项目列表',
    projectsEmpty: '暂无注册项目。',
    // /sessions
    sessionsTitle: '📋 最近会话',
    sessionsEmpty: '📋 暂无会话。',
    sessionsUseNew: '使用 /new 创建新会话。',
    sessionsUseBind: '使用 /bind <id> 切换到某个会话。',
    sessionsUpdated: '更新于',
    // /new
    newCreated: '✅ 新会话已创建',
    newAllFuture: '此聊天中的未来消息将发送到此会话。',
    // /bind
    bindTitle: '📋 最近会话',
    bindUsage: '用法',
    bindSuccess: '✅ 已绑定到会话',
    bindNotFound: '❌ 未找到匹配的会话，前缀',
    bindFailed: '绑定失败',
    // /clear
    clearSuccess: '✅ 会话已清空。',
    clearNoSession: '未绑定会话，请先使用 /new。',
    // /compact
    compactSuccess: '✅ 已压缩 {n} 条消息。',
    compactEmpty: '没有消息可压缩。',
    compactNoSession: '未绑定会话，请先使用 /new。',
    compactSummaryHeader: '[对话已压缩：{total} 条消息（{user} 条用户，{assistant} 条助手）]',
    compactTopics: '讨论的主题',
    compactContinue: '之前的上下文已压缩以节省内存。您可以继续对话。',
    // /mode
    modeCurrent: '🔒 当前权限模式',
    modeConfirmDesc: 'confirm — 危险操作需确认（写文件、执行命令）',
    modeFullDesc: 'full — 所有操作自动执行',
    modeSwitched: '✅ 权限模式已切换为',
    modeInvalid: '⚠️ 无效模式。请使用：/mode confirm 或 /mode full',
    // /status
    statusTitle: '📊 Bridge 状态',
    statusPlatform: '平台',
    statusChatId: '聊天 ID',
    statusSession: '会话',
    statusNotFound: '未找到',
    statusNone: '无（下次发消息时自动创建）',
    statusModel: '模型',
    statusLastActive: '最后活跃',
    statusProject: '项目',
    statusWorkspace: '工作区',
    statusProjectNone: '无',
    statusPermission: '权限',
    // /newproject
    newprojectTitle: '📁 创建新项目',
    newprojectUsage: '用法',
    newprojectExample: '示例',
    newprojectTip: '提示：使用 ~ 代替 Home 目录',
    newprojectSuccess: '✅ 项目已创建',
    newprojectAt: '位于',
    newprojectNotExist: '路径不存在',
    newprojectNotDir: '路径不是文件夹',
    // /stop
    stopSuccess: '⏹ 正在停止当前任务...',
    stopNoTask: '当前没有运行中的任务。',
    stopNotAvailable: '⚠️ 停止功能不可用',
    // errors
    noSession: '未绑定会话，请先使用 /new。',
    unknownCmd: '❓ 未知命令',
    didYouMean: '你是否想用',
    useHelp: '输入 /help 查看所有命令。',
    sessions: '个会话',
    newSessionCreated: '已创建新会话。',
  },
  en: {
    helpTitle: '📖 Forge IM Commands',
    helpSession: 'Session',
    helpProject: 'Project',
    helpSettings: 'Settings',
    helpOther: 'Other',
    helpNewDesc: 'Create new session',
    helpBindDesc: 'Bind to session (e.g. /bind abc1)',
    helpSessionsDesc: 'List recent sessions',
    helpClearDesc: 'Clear messages',
    helpCompactDesc: 'Compress context',
    helpProjectsDesc: 'List all projects',
    helpSwitchDesc: 'Switch project (e.g. /switch forge)',
    helpNewprojectDesc: 'Create project',
    helpModelDesc: 'Switch model (e.g. /model opus)',
    helpModeDesc: 'Permission mode',
    helpStatusDesc: 'Bridge status',
    helpStopDesc: 'Stop current task',
    modelCurrent: '🤖 Current model',
    modelAvailable: 'Available models',
    modelSwitched: '✅ Model switched to',
    modelUnknown: '❌ Unknown model',
    switchTitle: '📂 Switch to a project',
    switchUsage: 'Usage',
    switchSuccess: '✅ Switched to',
    switchNoMatch: 'No project matching',
    switchMultiple: 'Multiple projects match',
    switchBeMoreSpecific: 'Be more specific.',
    projectsTitle: '📂 Projects',
    projectsEmpty: 'No projects registered.',
    sessionsTitle: '📋 Recent Sessions',
    sessionsEmpty: '📋 No sessions found.',
    sessionsUseNew: 'Use /new to create one.',
    sessionsUseBind: 'Use /bind <id> to switch to a session.',
    sessionsUpdated: 'Updated',
    newCreated: '✅ New session created',
    newAllFuture: 'All future messages in this chat will go to this session.',
    bindTitle: '📋 Recent sessions',
    bindUsage: 'Usage',
    bindSuccess: '✅ Bound to session',
    bindNotFound: '❌ No session found with prefix',
    bindFailed: 'Bind failed',
    clearSuccess: '✅ Session cleared.',
    clearNoSession: 'No session bound. Use /new first.',
    compactSuccess: '✅ Compacted {n} messages.',
    compactEmpty: 'No messages to compact.',
    compactNoSession: 'No session bound. Use /new first.',
    compactSummaryHeader: '[Conversation compacted: {total} messages ({user} user, {assistant} assistant)]',
    compactTopics: 'Topics discussed',
    compactContinue: 'Previous context has been compacted to save memory. You may continue the conversation.',
    modeCurrent: '🔒 Current permission mode',
    modeConfirmDesc: 'confirm — Ask before dangerous operations (write files, run commands)',
    modeFullDesc: 'full — Auto-approve all operations',
    modeSwitched: '✅ Permission mode set to',
    modeInvalid: '⚠️ Invalid mode. Use: /mode confirm or /mode full',
    statusTitle: '📊 Bridge Status',
    statusPlatform: 'Platform',
    statusChatId: 'Chat ID',
    statusSession: 'Session',
    statusNotFound: 'not found',
    statusNone: 'none (will auto-create on next message)',
    statusModel: 'Model',
    statusLastActive: 'Last active',
    statusProject: 'Project',
    statusWorkspace: 'Workspace',
    statusProjectNone: 'none',
    statusPermission: 'Permission',
    newprojectTitle: '📁 Create a new project',
    newprojectUsage: 'Usage',
    newprojectExample: 'Example',
    newprojectTip: 'Tip: Use ~ for home directory',
    newprojectSuccess: '✅ Created project',
    newprojectAt: 'at',
    newprojectNotExist: 'Path does not exist',
    newprojectNotDir: 'Path is not a directory',
    stopSuccess: '⏹ Stopping current task...',
    stopNoTask: 'No task is currently running.',
    stopNotAvailable: '⚠️ Stop functionality not available',
    noSession: 'No session bound. Use /new first.',
    unknownCmd: '❓ Unknown command',
    didYouMean: 'Did you mean',
    useHelp: 'Type /help to see all available commands.',
    sessions: 'sessions',
    newSessionCreated: 'New session created.',
  },
} as const

type MsgKey = keyof typeof MSG['en']

/** Get the translation string for the current language. */
function t(key: MsgKey): string {
  return MSG[getLang()][key]
}

/**
 * Parse a text message into an IM command, or null if not a command.
 * Commands start with / and are followed by a known command name.
 */
export function parseImCommand(text: string): ImCommand | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('/')) return null

  const parts = trimmed.split(/\s+/)
  let name = parts[0].slice(1).toLowerCase() // strip leading /

  // Normalize common aliases
  const aliases: Record<string, string> = {
    'project': 'projects',
    'session': 'sessions',
  }
  if (aliases[name]) name = aliases[name]

  if (!KNOWN_COMMANDS.includes(name)) return null

  return { name, args: parts.slice(1) }
}

/**
 * Check if text looks like an unknown command attempt.
 * Returns a helpful hint string, or null if not a command-like input.
 */
export function checkUnknownCommand(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('/')) return null

  const parts = trimmed.split(/\s+/)
  const attempted = parts[0].slice(1).toLowerCase()

  // Only trigger for single-word command-like input (no spaces in command name)
  if (!attempted || attempted.length > 20) return null

  // Already a known command — shouldn't reach here, but be safe
  if (KNOWN_COMMANDS.includes(attempted)) return null

  // Find similar commands (simple substring matching)
  const suggestions = KNOWN_COMMANDS.filter(c =>
    c.includes(attempted) || attempted.includes(c),
  )

  const lines = [`${t('unknownCmd')}: /${attempted}`]
  if (suggestions.length > 0) {
    lines.push('')
    lines.push(`${t('didYouMean')}: ${suggestions.map(s => `/${s}`).join(', ')}?`)
  }
  lines.push('')
  lines.push(t('useHelp'))
  return lines.join('\n')
}

/** Context for command execution */
export interface CommandContext {
  stopActiveTask?: (sessionKey: string) => boolean
}

/**
 * Execute an IM command and return the response text to send back.
 */
export async function executeImCommand(
  cmd: ImCommand,
  msg: IncomingMessage,
  router: ChannelRouter,
  _adapter: ChannelAdapter,
  context?: CommandContext,
): Promise<string> {
  switch (cmd.name) {
    case 'new':
      return handleNew(msg, router)
    case 'bind':
      return handleBind(cmd, msg, router)
    case 'sessions':
      return handleSessions(router)
    case 'clear':
      return handleClear(cmd, msg, router)
    case 'compact':
      return handleCompact(msg, router)
    case 'projects':
      return handleProjects()
    case 'switch':
      return handleSwitch(cmd, msg, router)
    case 'newproject':
      return handleNewProject(cmd, msg, router)
    case 'model':
      return handleModel(cmd, msg, router)
    case 'mode':
      return handleMode(cmd)
    case 'status':
      return handleStatus(msg, router)
    case 'stop':
      return handleStop(msg, context)
    case 'help':
      return handleHelp()
    default:
      return `${t('unknownCmd')}: /${cmd.name}`
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Replace the user's home directory prefix with ~ for display. */
function shortenPath(p: string): string {
  const home = os.homedir()
  if (p.startsWith(home)) return '~' + p.slice(home.length)
  return p
}

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------

function handleNew(msg: IncomingMessage, router: ChannelRouter): string {
  const sessionId = router.createNewSession(msg)
  const info = router.getBindingInfo(msg.channelType, msg.chatId)
  emitImEvent('im:session-changed', { sessionId, workspaceId: info?.workspace || undefined })
  return `${t('newCreated')}: ${sessionId.slice(0, 8)}...\n${t('newAllFuture')}`
}

function handleBind(cmd: ImCommand, msg: IncomingMessage, router: ChannelRouter): string {
  if (cmd.args.length === 0) {
    // Show recent sessions inline with usage hint
    const sessions = router.listRecentSessions(10)
    if (sessions.length === 0) {
      return `${t('sessionsEmpty')}\n\n${t('sessionsUseNew')}`
    }

    const db = getDb()
    const lines = [t('bindTitle') + ':', '']
    for (const s of sessions) {
      // Grab the first user message as a preview
      const firstMsg = db.prepare(
        "SELECT content FROM messages WHERE session_id = ? AND role = 'user' ORDER BY created_at ASC LIMIT 1",
      ).get(s.id) as { content: string } | undefined
      let preview = ''
      if (firstMsg?.content) {
        try {
          const parsed = JSON.parse(firstMsg.content) as Array<{ text?: string }>
          preview = parsed[0]?.text?.slice(0, 30) || ''
        } catch {
          preview = firstMsg.content.slice(0, 30)
        }
        if (preview) preview = ` — ${preview}`
      }
      lines.push(`• [${s.id.slice(0, 8)}] ${s.title}${preview}`)
    }
    const firstId = sessions[0].id.slice(0, 4)
    lines.push('', `${t('bindUsage')}: /bind <id>  (e.g. /bind ${firstId})`)
    return lines.join('\n')
  }

  const targetId = cmd.args[0]

  // Support both full UUID and short prefix
  const db = getDb()
  let sessionId = targetId

  if (targetId.length < 36) {
    // Try to find by prefix
    const match = db.prepare('SELECT id FROM sessions WHERE id LIKE ?')
      .get(`${targetId}%`) as { id: string } | undefined
    if (!match) return `${t('bindNotFound')}: ${targetId}`
    sessionId = match.id
  }

  try {
    router.bindSession(msg.channelType, msg.chatId, sessionId)
    const session = db.prepare('SELECT title FROM sessions WHERE id = ?')
      .get(sessionId) as { title: string } | undefined
    return `${t('bindSuccess')}: ${sessionId.slice(0, 8)}... (${session?.title || 'untitled'})`
  } catch (err) {
    return `❌ ${err instanceof Error ? err.message : t('bindFailed')}`
  }
}

function handleSessions(router: ChannelRouter): string {
  const sessions = router.listRecentSessions(10)
  if (sessions.length === 0) {
    return `${t('sessionsEmpty')}\n${t('sessionsUseNew')}`
  }

  const db = getDb()
  const lines = [t('sessionsTitle') + ':', '']
  for (const s of sessions) {
    const ws = db.prepare('SELECT path FROM workspaces WHERE id = ?')
      .get(s.workspace) as { path: string } | undefined
    const wsLabel = ws?.path ? ` [${ws.path.split('/').pop()}]` : ''
    lines.push(`• ${s.id.slice(0, 8)} — ${s.title}${wsLabel}`)
    lines.push(`  ${t('sessionsUpdated')}: ${s.updatedAt}`)
  }
  lines.push('', t('sessionsUseBind'))
  return lines.join('\n')
}

function handleClear(cmd: ImCommand, msg: IncomingMessage, router: ChannelRouter): string {
  // Require /clear confirm to prevent accidental deletion (P25 fix)
  if (cmd.args[0] !== 'confirm') {
    return '⚠️ This will delete all messages in the current session.\nType `/clear confirm` to proceed.'
  }

  const db = getDb()
  const info = router.getBindingInfo(msg.channelType, msg.chatId)

  if (!info?.sessionId) {
    return t('clearNoSession')
  }

  // Verify session exists
  const session = db.prepare('SELECT id FROM sessions WHERE id = ?')
    .get(info.sessionId) as { id: string } | undefined
  if (!session) {
    return t('clearNoSession')
  }

  db.prepare('DELETE FROM messages WHERE session_id = ?').run(info.sessionId)
  emitImEvent('im:session-changed', { sessionId: info.sessionId, workspaceId: info.workspace || undefined })
  return t('clearSuccess')
}

function handleCompact(msg: IncomingMessage, router: ChannelRouter): string {
  const db = getDb()
  const info = router.getBindingInfo(msg.channelType, msg.chatId)
  const lang = getLang()

  if (!info?.sessionId) {
    return t('compactNoSession')
  }

  const session = db.prepare('SELECT id, title FROM sessions WHERE id = ?')
    .get(info.sessionId) as { id: string; title: string } | undefined
  if (!session) {
    return t('compactNoSession')
  }

  const messages = db.prepare(
    'SELECT role, content FROM messages WHERE session_id = ? ORDER BY created_at ASC',
  ).all(info.sessionId) as { role: string; content: string }[]

  if (messages.length === 0) {
    return t('compactEmpty')
  }

  // Build a compact summary
  const turns = messages.length
  let userMsgCount = 0
  let assistantMsgCount = 0
  const topics: string[] = []

  for (const m of messages) {
    if (m.role === 'user') {
      userMsgCount++
      const firstLine = m.content.slice(0, 100).split('\n')[0].trim()
      if (firstLine && topics.length < 5) {
        topics.push(firstLine)
      }
    } else {
      assistantMsgCount++
    }
  }

  const summaryHeader = MSG[lang].compactSummaryHeader
    .replace('{total}', String(turns))
    .replace('{user}', String(userMsgCount))
    .replace('{assistant}', String(assistantMsgCount))

  const summary = [
    summaryHeader,
    '',
    topics.length > 0 ? `${t('compactTopics')}:\n${topics.map(tp => `- ${tp}`).join('\n')}` : '',
    '',
    t('compactContinue'),
  ].filter(Boolean).join('\n')

  const summaryContent = JSON.stringify([{ type: 'text', text: summary }])

  // Replace all messages with the summary
  const deleteAndInsert = db.transaction(() => {
    db.prepare('DELETE FROM messages WHERE session_id = ?').run(info.sessionId)
    db.prepare(
      'INSERT INTO messages (id, session_id, role, content) VALUES (?, ?, ?, ?)',
    ).run(crypto.randomUUID(), info.sessionId, 'assistant', summaryContent)
  })
  deleteAndInsert()
  emitImEvent('im:session-changed', { sessionId: info.sessionId, workspaceId: info.workspace || undefined })

  return t('compactSuccess').replace('{n}', String(turns))
}

function handleProjects(): string {
  const db = getDb()

  const workspaces = db.prepare(
    'SELECT id, path, last_opened_at FROM workspaces ORDER BY last_opened_at DESC',
  ).all() as { id: string; path: string; last_opened_at: string }[]

  if (workspaces.length === 0) {
    return t('projectsEmpty')
  }

  const lines = [t('projectsTitle') + ':', '']
  for (let i = 0; i < workspaces.length; i++) {
    const ws = workspaces[i]
    const name = path.basename(ws.path)
    const sessionCount = db.prepare(
      'SELECT COUNT(*) as count FROM sessions WHERE workspace = ?',
    ).get(ws.id) as { count: number }
    lines.push(`${i + 1}. ${name} — ${shortenPath(ws.path)} (${sessionCount.count} ${t('sessions')})`)
  }

  return lines.join('\n')
}

function handleSwitch(cmd: ImCommand, msg: IncomingMessage, router: ChannelRouter): string {
  if (cmd.args.length === 0) {
    // Show project list inline with usage hint
    const db = getDb()
    const workspaces = db.prepare(
      'SELECT id, path FROM workspaces ORDER BY last_opened_at DESC',
    ).all() as { id: string; path: string }[]

    if (workspaces.length === 0) {
      return `📂 ${t('projectsEmpty')}\n\n${t('newprojectUsage')}: /newproject <path>`
    }

    const lines = [t('switchTitle') + ':', '']
    for (let i = 0; i < workspaces.length; i++) {
      const ws = workspaces[i]
      const name = path.basename(ws.path)
      lines.push(`${i + 1}. ${name} — ${shortenPath(ws.path)}`)
    }
    const firstName = path.basename(workspaces[0].path)
    lines.push('', `${t('switchUsage')}: /switch <name>  (e.g. /switch ${firstName})`)
    return lines.join('\n')
  }

  const db = getDb()
  const query = cmd.args.join(' ').toLowerCase()

  const workspaces = db.prepare(
    'SELECT id, path FROM workspaces ORDER BY last_opened_at DESC',
  ).all() as { id: string; path: string }[]

  // Fuzzy match: case-insensitive includes on the directory name
  const matches = workspaces.filter(ws => {
    const name = path.basename(ws.path).toLowerCase()
    return name.includes(query)
  })

  if (matches.length === 0) {
    return `${t('switchNoMatch')} '${cmd.args.join(' ')}'.`
  }

  if (matches.length > 1) {
    const lines = [`${t('switchMultiple')} '${cmd.args.join(' ')}':\n`]
    for (const ws of matches) {
      lines.push(`• ${path.basename(ws.path)} — ${shortenPath(ws.path)}`)
    }
    lines.push(`\n${t('switchBeMoreSpecific')}`)
    return lines.join('\n')
  }

  // Exactly one match
  const matched = matches[0]
  const name = path.basename(matched.path)

  // Update channel binding workspace + reuse existing session or create new one (P26 fix)
  const binding = db.prepare(
    'SELECT id FROM channel_bindings WHERE channel_id = ? AND chat_id = ?',
  ).get(msg.channelType, msg.chatId) as { id: string } | undefined

  // Try to reuse the most recent session for this workspace
  const existingSession = db.prepare(
    'SELECT id FROM sessions WHERE workspace = ? ORDER BY updated_at DESC LIMIT 1',
  ).get(matched.id) as { id: string } | undefined

  let newSessionId: string
  if (existingSession) {
    newSessionId = existingSession.id
  } else {
    newSessionId = crypto.randomUUID()
    const defaultModel = getDefaultModel()
    db.prepare('INSERT INTO sessions (id, title, workspace, model) VALUES (?, ?, ?, ?)').run(
      newSessionId,
      `[${msg.channelType}] New conversation`,
      matched.id,
      defaultModel,
    )
  }

  if (binding) {
    db.prepare('UPDATE channel_bindings SET workspace = ?, session_id = ? WHERE id = ?')
      .run(matched.id, newSessionId, binding.id)
  } else {
    db.prepare(
      'INSERT INTO channel_bindings (id, channel_id, chat_id, workspace, session_id) VALUES (?, ?, ?, ?, ?)',
    ).run(crypto.randomUUID(), msg.channelType, msg.chatId, matched.id, newSessionId)
  }

  // Update last_opened_at
  db.prepare('UPDATE workspaces SET last_opened_at = datetime(\'now\') WHERE id = ?')
    .run(matched.id)

  emitImEvent('im:session-changed', { sessionId: newSessionId, workspaceId: matched.id })
  return `${t('switchSuccess')} ${name} (${shortenPath(matched.path)})。${t('newSessionCreated')}`
}

function handleNewProject(cmd: ImCommand, msg: IncomingMessage, router: ChannelRouter): string {
  if (cmd.args.length === 0) {
    return [
      t('newprojectTitle') + ':',
      '',
      `${t('newprojectUsage')}: /newproject <path>`,
      `${t('newprojectExample')}: /newproject ~/Desktop/my-app`,
      '',
      t('newprojectTip'),
    ].join('\n')
  }

  const rawPath = cmd.args.join(' ')
  // Expand ~ to home directory
  const resolvedPath = rawPath.startsWith('~')
    ? path.join(os.homedir(), rawPath.slice(1))
    : path.resolve(rawPath)

  // Validate path exists and is a directory
  if (!fs.existsSync(resolvedPath)) {
    return `${t('newprojectNotExist')}: ${resolvedPath}`
  }
  const stat = fs.statSync(resolvedPath)
  if (!stat.isDirectory()) {
    return `${t('newprojectNotDir')}: ${resolvedPath}`
  }

  const db = getDb()
  const name = path.basename(resolvedPath)

  // Check if workspace already registered
  let workspace = db.prepare('SELECT id FROM workspaces WHERE path = ?')
    .get(resolvedPath) as { id: string } | undefined

  if (!workspace) {
    const wsId = crypto.randomUUID()
    db.prepare('INSERT INTO workspaces (id, path) VALUES (?, ?)').run(wsId, resolvedPath)
    workspace = { id: wsId }
  } else {
    // Update last_opened_at
    db.prepare('UPDATE workspaces SET last_opened_at = datetime(\'now\') WHERE id = ?')
      .run(workspace.id)
  }

  // Create new session in this workspace
  const newSessionId = crypto.randomUUID()
  const defaultModel = getDefaultModel()

  db.prepare('INSERT INTO sessions (id, title, workspace, model) VALUES (?, ?, ?, ?)').run(
    newSessionId,
    `[${msg.channelType}] New conversation`,
    workspace.id,
    defaultModel,
  )

  // Update channel binding
  const binding = db.prepare(
    'SELECT id FROM channel_bindings WHERE channel_id = ? AND chat_id = ?',
  ).get(msg.channelType, msg.chatId) as { id: string } | undefined

  if (binding) {
    db.prepare('UPDATE channel_bindings SET workspace = ?, session_id = ? WHERE id = ?')
      .run(workspace.id, newSessionId, binding.id)
  } else {
    db.prepare(
      'INSERT INTO channel_bindings (id, channel_id, chat_id, workspace, session_id) VALUES (?, ?, ?, ?, ?)',
    ).run(crypto.randomUUID(), msg.channelType, msg.chatId, workspace.id, newSessionId)
  }

  emitImEvent('im:session-changed', { sessionId: newSessionId, workspaceId: workspace.id })
  return `${t('newprojectSuccess')} ${name} ${t('newprojectAt')} ${shortenPath(resolvedPath)}。${t('newSessionCreated')}`
}

function findModelLabel(modelId: string): string {
  const entry = getAvailableModels().find(m => m.id === modelId)
  return entry ? entry.label : modelId
}

function matchModel(input: string): ImModelEntry | undefined {
  const normalized = input.toLowerCase().replace(/[\s.]+/g, '-')

  // 1. Exact id match
  const exact = getAvailableModels().find(m => m.id.toLowerCase() === normalized)
  if (exact) return exact

  // 2. Alias match
  const byAlias = getAvailableModels().find(m =>
    m.aliases.some(a => a.toLowerCase() === normalized),
  )
  if (byAlias) return byAlias

  // 3. Id includes match
  const byIdIncludes = getAvailableModels().find(m =>
    m.id.toLowerCase().includes(normalized),
  )
  if (byIdIncludes) return byIdIncludes

  // 4. Label includes match (case-insensitive)
  const byLabelIncludes = getAvailableModels().find(m =>
    m.label.toLowerCase().includes(normalized),
  )
  if (byLabelIncludes) return byLabelIncludes

  return undefined
}

function handleModel(cmd: ImCommand, msg: IncomingMessage, router: ChannelRouter): string {
  const db = getDb()
  const info = router.getBindingInfo(msg.channelType, msg.chatId)

  if (cmd.args.length === 0) {
    // Show current model + available models with shortcuts
    const currentModelId = (() => {
      if (!info?.sessionId) return 'claude-sonnet-4-6'
      const session = db.prepare('SELECT model FROM sessions WHERE id = ?')
        .get(info.sessionId) as { model: string } | undefined
      return session?.model || 'claude-sonnet-4-6'
    })()

    const lines = [
      `${t('modelCurrent')}: ${findModelLabel(currentModelId)}`,
      '',
      `${t('modelAvailable')}:`,
    ]
    for (const m of getAvailableModels()) {
      const shortcut = m.aliases[0] || m.id
      lines.push(`  /model ${shortcut} → ${m.label}`)
    }
    return lines.join('\n')
  }

  // Switch model
  if (!info?.sessionId) {
    return t('noSession')
  }

  const rawArg = cmd.args.join(' ').trim()
  const matched = matchModel(rawArg)

  if (!matched) {
    const lines = [
      `${t('modelUnknown')}: ${rawArg}`,
      '',
      `${t('modelAvailable')}:`,
    ]
    for (const m of getAvailableModels()) {
      const shortcut = m.aliases[0] || m.id
      lines.push(`  /model ${shortcut} → ${m.label}`)
    }
    return lines.join('\n')
  }

  db.prepare('UPDATE sessions SET model = ? WHERE id = ?').run(matched.id, info.sessionId)
  return `${t('modelSwitched')} ${matched.label}`
}

function handleMode(cmd: ImCommand): string {
  const db = getDb()

  if (cmd.args.length === 0) {
    const setting = db.prepare("SELECT value FROM settings WHERE key = 'im_permission_mode'")
      .get() as { value: string } | undefined
    const mode = setting?.value || 'confirm'
    return [
      `${t('modeCurrent')}: ${mode}`,
      '',
      `  ${t('modeConfirmDesc')}`,
      `  ${t('modeFullDesc')}`,
      '',
      `${t('switchUsage')}: /mode <confirm|full>`,
    ].join('\n')
  }

  const newMode = cmd.args[0].toLowerCase()
  if (newMode !== 'confirm' && newMode !== 'full') {
    return t('modeInvalid')
  }

  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('im_permission_mode', ?)")
    .run(newMode)

  return `${t('modeSwitched')}: ${newMode}`
}

function handleStatus(msg: IncomingMessage, router: ChannelRouter): string {
  const info = router.getBindingInfo(msg.channelType, msg.chatId)
  const db = getDb()

  const lines: string[] = [
    t('statusTitle'),
    '',
    `${t('statusPlatform')}: ${msg.channelType}`,
    `${t('statusChatId')}: ${msg.chatId}`,
  ]

  if (info?.sessionId) {
    const session = db.prepare('SELECT title, model, updated_at FROM sessions WHERE id = ?')
      .get(info.sessionId) as { title: string; model: string; updated_at: string } | undefined
    if (session) {
      lines.push(`${t('statusSession')}: ${info.sessionId.slice(0, 8)}... (${session.title})`)
      lines.push(`${t('statusModel')}: ${findModelLabel(session.model)}`)
      lines.push(`${t('statusLastActive')}: ${session.updated_at}`)
    } else {
      lines.push(`${t('statusSession')}: ${info.sessionId.slice(0, 8)}... (${t('statusNotFound')})`)
    }
  } else {
    lines.push(`${t('statusSession')}: ${t('statusNone')}`)
  }

  if (info?.workspace) {
    const ws = db.prepare('SELECT path FROM workspaces WHERE id = ?')
      .get(info.workspace) as { path: string } | undefined
    if (ws) {
      const projectName = path.basename(ws.path)
      lines.push(`${t('statusProject')}: ${projectName} (${shortenPath(ws.path)})`)
    } else {
      lines.push(`${t('statusWorkspace')}: ${info.workspace}`)
    }
  } else {
    lines.push(`${t('statusProject')}: ${t('statusProjectNone')}`)
  }

  const permSetting = db.prepare("SELECT value FROM settings WHERE key = 'im_permission_mode'")
    .get() as { value: string } | undefined
  lines.push(`${t('statusPermission')}: ${permSetting?.value || 'confirm'}`)

  return lines.join('\n')
}

function handleStop(msg: IncomingMessage, context?: CommandContext): string {
  if (!context?.stopActiveTask) {
    return t('stopNotAvailable')
  }

  const sessionKey = `${msg.channelType}:${msg.chatId}`
  const stopped = context.stopActiveTask(sessionKey)

  if (stopped) {
    return t('stopSuccess')
  }
  return t('stopNoTask')
}

function handleHelp(): string {
  return [
    t('helpTitle'),
    '',
    `${t('helpSession')}:`,
    `  /new — ${t('helpNewDesc')}`,
    `  /bind <id> — ${t('helpBindDesc')}`,
    `  /sessions — ${t('helpSessionsDesc')}`,
    `  /clear — ${t('helpClearDesc')}`,
    `  /compact — ${t('helpCompactDesc')}`,
    '',
    `${t('helpProject')}:`,
    `  /projects — ${t('helpProjectsDesc')}`,
    `  /switch <name> — ${t('helpSwitchDesc')}`,
    `  /newproject <path> — ${t('helpNewprojectDesc')}`,
    '',
    `${t('helpSettings')}:`,
    `  /model [name] — ${t('helpModelDesc')}`,
    `  /mode [confirm|full] — ${t('helpModeDesc')}`,
    '',
    `${t('helpOther')}:`,
    `  /status — ${t('helpStatusDesc')}`,
    `  /stop — ${t('helpStopDesc')}`,
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Get the default model for new sessions (mirrors ChannelRouter logic). */
function getDefaultModel(): string {
  const db = getDb()
  const setting = db.prepare("SELECT value FROM settings WHERE key = 'bridge_default_model'")
    .get() as { value: string } | undefined
  return setting?.value || 'claude-sonnet-4-6'
}
