'use client'

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { ArrowUp, Square, Plus, ChevronDown, ChevronRight, XCircle, Loader2, ShieldAlert, Download, X, FileIcon, ImageIcon, Check, Shield, ShieldOff, Globe, Terminal, FileText, Search, Bot, FileDiff, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useI18n } from '@/components/providers/i18n-provider'
import { useContainerWidth } from '@/hooks/use-container-width'
import type { Session, Message, ContentBlock, PermissionStatus, ToolRawContent } from '@/lib/types'
import { MarkdownRenderer } from '@/components/markdown-renderer'
import { AgentBlock, ParallelAgentIndicator, isAgentToolCall } from '@/components/chat/agent-block'
import { SlashCommandMenu } from '@/components/chat/slash-command-menu'
import { useSlashCommands } from '@/hooks/use-slash-commands'
import { filterCommands, type SlashCommand } from '@/lib/slash-commands'

interface ChatViewProps {
  session: Session | null
  messages: Message[]
  streaming: boolean
  isThinking?: boolean
  error: string | null
  workspaceName?: string
  workspaceId?: string | null
  permissionMode?: string
  thinkingMode?: string
  onSendMessage: (content: string, permissionMode?: string, thinkingMode?: string, attachments?: Array<{ name: string; filename: string; mimeType: string; tier: string }>) => void
  onStopStreaming: () => void
  onNewSession: () => void
  onPermissionDecision?: (requestId: string, decision: 'allow' | 'allow_session' | 'deny') => void
  onModelChange?: (model: string) => void
  onPermissionModeChange?: (mode: string) => void
  onThinkingModeChange?: (mode: string) => void
  onRenameSession?: (title: string) => void
  onClearSession?: () => Promise<void>
}

const MODEL_OPTIONS = [
  // Anthropic (native)
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', provider: 'Anthropic' },
  { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', provider: 'Anthropic' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', provider: 'Anthropic' },
  // Moonshot/Kimi (Anthropic-compatible)
  { id: 'kimi-k2.5', label: 'Kimi K2.5', provider: 'Moonshot' },
  // Zhipu/GLM (Anthropic-compatible)
  { id: 'glm-5', label: 'GLM-5', provider: 'Zhipu' },
  { id: 'glm-4-plus', label: 'GLM-4 Plus', provider: 'Zhipu' },
  // MiniMax (Anthropic-compatible)
  { id: 'MiniMax-M2.5', label: 'MiniMax M2.5', provider: 'MiniMax' },
  // Qwen/DashScope (Anthropic-compatible)
  { id: 'qwen3.5-plus', label: 'Qwen 3.5 Plus', provider: 'Qwen' },
  { id: 'qwen3-coder-plus', label: 'Qwen3 Coder Plus', provider: 'Qwen' },
  { id: 'qwen-max', label: 'Qwen Max', provider: 'Qwen' },
  { id: 'qwen-plus', label: 'Qwen Plus', provider: 'Qwen' },
]

export function ChatView({
  session,
  messages,
  streaming,
  isThinking = false,
  error,
  workspaceName = '',
  workspaceId = null,
  permissionMode = 'confirm',
  thinkingMode = 'auto',
  onSendMessage,
  onStopStreaming,
  onNewSession,
  onPermissionDecision,
  onModelChange,
  onPermissionModeChange,
  onThinkingModeChange,
  onRenameSession,
  onClearSession,
}: ChatViewProps) {
  const { t } = useI18n()
  const [input, setInput] = useState('')
  const [modelOpen, setModelOpen] = useState(false)
  const [permOpen, setPermOpen] = useState(false)
  const [thinkOpen, setThinkOpen] = useState(false)
  const modelRef = useRef<HTMLDivElement>(null)
  const permRef = useRef<HTMLDivElement>(null)
  const thinkRef = useRef<HTMLDivElement>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const [attachments, setAttachments] = useState<{ name: string; path: string; filename: string; mimeType: string; tier: string; isImage: boolean }[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const userScrolledUpRef = useRef(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const systemMsgRef = useRef<HTMLDivElement>(null)
  const modelPickerRef = useRef<HTMLDivElement>(null)

  const toolbarWidth = useContainerWidth(toolbarRef)
  const isCompact = toolbarWidth > 0 && toolbarWidth <= 500

  // ── Slash Commands ──
  const allCommands = useSlashCommands(workspaceId)
  const [slashMenuOpen, setSlashMenuOpen] = useState(false)
  const [slashIndex, setSlashIndex] = useState(0)
  const [systemMsg, setSystemMsg] = useState<string | null>(null)
  const [modelPickerOpen, setModelPickerOpen] = useState(false)

  // Compute the query part after `/` and filtered commands
  const slashQuery = useMemo(() => {
    if (!input.startsWith('/')) return ''
    return input.slice(1).split(/\s/)[0]
  }, [input])

  const filteredCommands = useMemo(
    () => (slashMenuOpen ? filterCommands(allCommands, slashQuery) : []),
    [slashMenuOpen, allCommands, slashQuery]
  )

  // Open/close menu based on input
  // Only show the menu while user is still typing the command name (no space yet).
  // Once a space appears (user is typing args), close the menu so Enter executes the command.
  useEffect(() => {
    if (input.startsWith('/') && !input.includes('\n')) {
      const afterSlash = input.slice(1)
      const hasSpace = afterSlash.includes(' ')
      if (!hasSpace) {
        // Still typing command name — show autocomplete
        const matches = filterCommands(allCommands, afterSlash)
        setSlashMenuOpen(matches.length > 0)
        setSlashIndex(0)
      } else {
        // Command name complete, user is typing args — close menu
        setSlashMenuOpen(false)
      }
    } else {
      setSlashMenuOpen(false)
    }
  }, [input, allCommands])

  // Auto-dismiss short system messages after 4 seconds; long ones stay until user dismisses
  useEffect(() => {
    if (!systemMsg) return
    // Messages with code blocks, lists, or > 120 chars are considered "long" — don't auto-dismiss
    if (systemMsg.length > 120 || systemMsg.includes('```') || systemMsg.includes('\n-')) return
    const timer = setTimeout(() => setSystemMsg(null), 4000)
    return () => clearTimeout(timer)
  }, [systemMsg])

  // Dismiss any overlay (slash menu / system message / model picker) on Escape
  useEffect(() => {
    if (!slashMenuOpen && !systemMsg && !modelPickerOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (slashMenuOpen) { setSlashMenuOpen(false); setInput('') }
        setSystemMsg(null)
        setModelPickerOpen(false)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [slashMenuOpen, systemMsg, modelPickerOpen])

  // Close system message on click outside
  useEffect(() => {
    if (!systemMsg) return
    const handler = (e: MouseEvent) => {
      if (systemMsgRef.current && !systemMsgRef.current.contains(e.target as Node)) {
        setSystemMsg(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [systemMsg])

  // Close model picker on click outside
  useEffect(() => {
    if (!modelPickerOpen) return
    const handler = (e: MouseEvent) => {
      if (modelPickerRef.current && !modelPickerRef.current.contains(e.target as Node)) {
        setModelPickerOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [modelPickerOpen])

  // Close slash menu on click outside input container
  const inputContainerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!slashMenuOpen) return
    const handler = (e: MouseEvent) => {
      if (inputContainerRef.current && !inputContainerRef.current.contains(e.target as Node)) {
        setSlashMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [slashMenuOpen])

  /** Execute a slash command. Returns true if handled (input should be cleared). */
  const executeCommand = useCallback(async (cmd: SlashCommand, arg?: string) => {
    if (!session) return

    switch (cmd.category) {
      case 'built-in':
        switch (cmd.name) {
          case 'clear':
            if (onClearSession) {
              await onClearSession()
              setSystemMsg('Session cleared.')
            }
            break
          case 'compact':
            try {
              const res = await fetch(`/api/sessions/${session.id}/compact`, { method: 'POST' })
              const data = await res.json()
              if (data.ok) {
                setSystemMsg(`Compacted ${data.compacted} messages.`)
                // Reload messages by dispatching event
                window.dispatchEvent(new CustomEvent('forge:session-reload', { detail: { sessionId: session.id } }))
              }
            } catch { setSystemMsg('Failed to compact session.') }
            break
          case 'cost': {
            let totalIn = 0
            let totalOut = 0
            for (const msg of messages) {
              totalIn += msg.inputTokens || 0
              totalOut += msg.outputTokens || 0
            }
            setSystemMsg(`Token usage — Input: ${totalIn.toLocaleString()} | Output: ${totalOut.toLocaleString()} | Total: ${(totalIn + totalOut).toLocaleString()}`)
            break
          }
          case 'diff':
            if (workspaceId) {
              try {
                const res = await fetch(`/api/workspaces/${workspaceId}/diff`)
                const data = await res.json()
                if (data.diff) {
                  setSystemMsg(`\`\`\`diff\n${data.diff.slice(0, 2000)}\n\`\`\``)
                } else {
                  setSystemMsg(data.message || 'No changes.')
                }
              } catch { setSystemMsg('Failed to run git diff.') }
            } else {
              setSystemMsg('No workspace selected.')
            }
            break
          case 'export':
            exportSession(session.id, session.title)
            break
          case 'init':
            if (workspaceId) {
              // Ensure .claude/ directory exists + fetch init templates
              let templateBlock = ''
              try {
                const res = await fetch(`/api/workspaces/${workspaceId}/init`, { method: 'POST' })
                const data = await res.json()
                if (data.templates && typeof data.templates === 'object') {
                  templateBlock = Object.entries(data.templates)
                    .map(([name, content]) => `<template file="${name}">\n${content}\n</template>`)
                    .join('\n\n')
                }
              } catch { /* proceed without templates as fallback */ }
              // Send interview trigger with templates attached
              const initMessage = templateBlock
                ? `/init — Please start the workspace setup interview. Ask me questions one at a time.\n\nAfter the interview, use these templates to generate the .claude/ config files. Replace <!-- [/init ...] --> placeholders with personalized content based on my answers. Keep all non-placeholder content unchanged.\n\n${templateBlock}`
                : '/init — Please start the workspace setup interview. Ask me questions one at a time to personalize my .claude/ config files.'
              onSendMessage(initMessage)
            } else {
              setSystemMsg('No workspace selected.')
            }
            break
          case 'memory':
            window.dispatchEvent(new CustomEvent('forge:slash-command', { detail: { command: 'memory' } }))
            break
          case 'model':
            if (arg) {
              // Try to find a matching model
              const match = MODEL_OPTIONS.find(
                (o) => o.id === arg || o.label.toLowerCase().includes(arg.toLowerCase())
              )
              if (match) {
                onModelChange?.(match.id)
                setSystemMsg(`Model switched to ${match.label}`)
              } else {
                setSystemMsg(`Unknown model: ${arg}`)
              }
            } else {
              // Open inline model picker
              setModelPickerOpen(true)
              setSystemMsg(null)
            }
            break
          case 'rename':
            if (arg) {
              onRenameSession?.(arg)
              setSystemMsg(`Session renamed to "${arg}"`)
            } else {
              setSystemMsg('Usage: /rename <new title>')
            }
            break
          case 'save-as-template':
            if (!arg) {
              setSystemMsg('Usage: /save-as-template <template name>')
            } else if (!workspaceId) {
              setSystemMsg('No workspace selected. Open a project first.')
            } else {
              try {
                const res = await fetch('/api/marketplace/save-from-workspace', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ workspaceId, name: arg }),
                })
                if (res.ok) {
                  setSystemMsg(`✅ 已保存为方案：${arg}`)
                } else {
                  const data = await res.json()
                  setSystemMsg(`Failed to save template: ${data.error || 'Unknown error'}`)
                }
              } catch {
                setSystemMsg('Failed to save template. Please try again.')
              }
            }
            break
          case 'stop':
            onStopStreaming()
            break
          case 'workspace':
            window.dispatchEvent(new CustomEvent('forge:slash-command', { detail: { command: 'workspace' } }))
            break
        }
        break

      case 'skill':
        // Send the skill name as an instruction to the agent
        onSendMessage(`/skill ${cmd.name}${arg ? ' ' + arg : ''}`)
        break

      case 'agent':
        // Send a delegate instruction to the agent
        onSendMessage(`@${cmd.name}${arg ? ' ' + arg : ''}`)
        break

      case 'mcp':
        // MCP commands — placeholder for future MCP prompts support
        setSystemMsg(`MCP command /${cmd.name} — feature coming soon.`)
        break
    }
  }, [session, messages, onClearSession, onStopStreaming, onModelChange, onRenameSession, onSendMessage, workspaceId, allCommands])

  const handleSlashSelect = useCallback((cmd: SlashCommand) => {
    if (cmd.name === 'model') {
      // /model opens an inline picker instead of waiting for text arg
      executeCommand(cmd)
      setInput('')
      setSlashMenuOpen(false)
    } else if (cmd.hasArg) {
      // Fill the command with a space for the user to type the argument
      setInput(`/${cmd.name} `)
      setSlashMenuOpen(false)
      textareaRef.current?.focus()
    } else {
      executeCommand(cmd)
      setInput('')
      setSlashMenuOpen(false)
    }
  }, [executeCommand])

  // Auto-scroll: only scroll to bottom when user hasn't scrolled up.
  // On session change (messages replaced entirely), always scroll to bottom instantly.
  const prevMessageCountRef = useRef(0)
  useEffect(() => {
    const isSessionChange = prevMessageCountRef.current === 0 && messages.length > 0
    const isNewMessage = messages.length > prevMessageCountRef.current && prevMessageCountRef.current > 0
    prevMessageCountRef.current = messages.length

    if (isSessionChange) {
      // Session loaded — always snap to bottom instantly, reset scroll state
      userScrolledUpRef.current = false
      messagesEndRef.current?.scrollIntoView({ behavior: 'instant' as ScrollBehavior })
    } else if ((isNewMessage || streaming) && !userScrolledUpRef.current) {
      // New message added or streaming content updating — smooth scroll to bottom
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
    // If user scrolled up or message count decreased (clear), do nothing
  }, [messages, streaming])

  // Track whether user has scrolled up away from the bottom
  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container) return
    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container
      // Consider "at bottom" if within 80px of the bottom
      userScrolledUpRef.current = scrollHeight - scrollTop - clientHeight > 80
    }
    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => container.removeEventListener('scroll', handleScroll)
  }, [])

  useEffect(() => {
    const el = textareaRef.current
    if (el) {
      el.style.height = 'auto'
      el.style.height = Math.min(el.scrollHeight, 160) + 'px'
    }
  }, [input])

  // Close model dropdown on outside click
  useEffect(() => {
    if (!modelOpen) return
    const handler = (e: MouseEvent) => {
      if (modelRef.current && !modelRef.current.contains(e.target as Node)) setModelOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [modelOpen])

  // Close permission dropdown on outside click
  useEffect(() => {
    if (!permOpen) return
    const handler = (e: MouseEvent) => {
      if (permRef.current && !permRef.current.contains(e.target as Node)) setPermOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [permOpen])

  // Close thinking dropdown on outside click
  useEffect(() => {
    if (!thinkOpen) return
    const handler = (e: MouseEvent) => {
      if (thinkRef.current && !thinkRef.current.contains(e.target as Node)) setThinkOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [thinkOpen])

  const handleFileUpload = useCallback(async (files: FileList | null) => {
    if (!files) return
    for (const file of Array.from(files)) {
      const formData = new FormData()
      formData.append('file', file)
      try {
        const res = await fetch('/api/upload', { method: 'POST', body: formData })
        if (!res.ok) continue
        const data = await res.json()
        setAttachments(prev => [...prev, {
          name: data.originalName,
          path: data.path,
          filename: data.filename,
          mimeType: data.mimeType,
          tier: data.tier,
          isImage: data.isImage,
        }])
      } catch { /* ignore */ }
    }
  }, [])

  const removeAttachment = useCallback((idx: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== idx))
  }, [])

  const handleSend = () => {
    if ((!input.trim() && attachments.length === 0) || streaming) return

    // Handle slash command execution
    if (input.startsWith('/') && !input.includes('\n')) {
      const parts = input.slice(1).split(/\s+/)
      const cmdName = parts[0]
      const arg = parts.slice(1).join(' ').trim() || undefined
      const cmd = allCommands.find((c) => c.name === cmdName)
      if (cmd) {
        executeCommand(cmd, arg)
        setInput('')
        setSlashMenuOpen(false)
        return
      }
      // Not a recognized command — fall through and send as normal message
    }

    // Pass attachments as structured data for multimodal processing
    const attachmentData = attachments.length > 0
      ? attachments.map(a => ({ name: a.name, filename: a.filename, mimeType: a.mimeType, tier: a.tier }))
      : undefined

    // Build display text (user sees file names in their message)
    let content = input
    if (attachments.length > 0 && !content.trim()) {
      content = attachments.map(a => `[${a.name}]`).join(' ')
    }

    onSendMessage(content, undefined, undefined, attachmentData)
    setInput('')
    setAttachments([])
    // User sent a message — reset scroll state so auto-scroll follows the new response
    userScrolledUpRef.current = false
  }

  if (!session) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <h1 className="text-[32px] font-bold tracking-tight text-indigo" style={{ fontFamily: "'SF Pro Display', 'Inter', system-ui, sans-serif", letterSpacing: '-0.02em' }}>
          {t('app.name')}
        </h1>
        <p className="text-[14px] text-secondary">{t('chat.startNew')}</p>
        <button
          onClick={onNewSession}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo text-white text-[13px] font-medium hover:opacity-90 transition-opacity"
        >
          <Plus size={14} />
          {t('chat.newSession')}
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Chat Header */}
      <div ref={toolbarRef} className="flex items-center justify-between px-5 h-[52px] border-b border-subtle shrink-0 min-w-0">
        <div className="flex items-center gap-3 min-w-0 flex-1 overflow-hidden">
          <span className="text-[15px] font-semibold text-primary truncate">
            {session.title}
          </span>
          {!isCompact && workspaceName && (
            <span className="text-[11px] px-2 py-0.5 rounded bg-surface-active text-tertiary shrink-0 whitespace-nowrap">
              {workspaceName}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() => exportSession(session.id, session.title)}
            className="flex items-center justify-center w-7 h-7 rounded-md hover:bg-surface-hover transition-colors"
            title={t('button.exportSession')}
          >
            <Download size={14} className="text-tertiary" />
          </button>
        </div>
      </div>

      {/* Messages Area */}
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto px-6 py-4">
        {messages.length === 0 && !streaming && (
          <div className="flex flex-col items-center justify-center h-full gap-5">
            <h1 className="text-[32px] font-bold tracking-tight text-indigo" style={{ fontFamily: "'SF Pro Display', 'Inter', system-ui, sans-serif", letterSpacing: '-0.02em' }}>
              {t('app.name')}
            </h1>
            <div className="text-center space-y-1.5">
              <p className="text-[14px] text-muted">{t('chat.suggestions')}</p>
            </div>
            <div className="flex flex-wrap gap-2 justify-center max-w-[400px]">
              {[
                t('chat.suggestSummarize'),
                t('chat.suggestBug'),
                t('chat.suggestRefactor'),
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => { setInput(suggestion); textareaRef.current?.focus() }}
                  className="px-3 py-1.5 rounded-lg border border-subtle text-[12px] text-secondary hover:bg-surface-hover hover:border-indigo/30 transition-all"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {(() => {
          // Only the LAST assistant message can be in streaming state.
          // Using temp- prefix alone is dangerous: interrupted streams leave orphaned temp IDs
          // that would incorrectly match on the next send.
          const lastAssistantIdx = messages.reduce((acc, m, i) => m.role === 'assistant' ? i : acc, -1)
          return messages.map((msg, i) => (
            <div key={msg.id} className="mb-6">
              {msg.role === 'user' ? (
                <UserMessage blocks={msg.blocks} fallbackContent={msg.content} />
              ) : (
                <AssistantMessage blocks={msg.blocks} streaming={streaming && i === lastAssistantIdx} isThinking={isThinking && streaming && i === lastAssistantIdx} thinkingMode={thinkingMode} onPermissionDecision={onPermissionDecision} elapsedSeconds={msg.elapsedSeconds} inputTokens={msg.inputTokens} outputTokens={msg.outputTokens} />
              )}
            </div>
          ))
        })()}

        {error && (
          <div className="mb-6 px-4 py-3 rounded-lg bg-coral/10 border border-coral/30 animate-fade-in">
            <p className="text-[12px] text-coral">{error}</p>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="px-5 pb-3 flex flex-col gap-0">
        {/* System message from slash commands */}
        {systemMsg && (
          <div
            ref={systemMsgRef}
            className="mb-2 rounded-lg bg-surface border border-subtle animate-fade-in"
          >
            <div className="px-4 py-2.5 max-h-[320px] overflow-y-auto text-[12px] text-secondary whitespace-pre-wrap">
              <MarkdownRenderer content={systemMsg} />
            </div>
          </div>
        )}
        {/* Model picker from /model command */}
        {modelPickerOpen && (
          <div ref={modelPickerRef} className="mb-2 rounded-lg bg-surface border border-subtle animate-fade-in">
            <div className="px-4 py-2 border-b border-subtle">
              <span className="text-[12px] font-medium text-secondary">{t('chat.selectModel')}</span>
            </div>
            <div className="max-h-[240px] overflow-y-auto py-1">
              {(() => {
                const providers = [...new Set(MODEL_OPTIONS.map(o => o.provider))]
                return providers.map(provider => (
                  <div key={provider}>
                    <div className="px-4 py-1 text-[10px] font-medium text-muted uppercase tracking-wide">{provider}</div>
                    {MODEL_OPTIONS.filter(o => o.provider === provider).map(opt => (
                      <button
                        key={opt.id}
                        onClick={() => {
                          onModelChange?.(opt.id)
                          setModelPickerOpen(false)
                          setSystemMsg(`Model switched to ${opt.label}`)
                        }}
                        className="w-full text-left px-4 py-1.5 text-[12px] text-secondary hover:bg-hover hover:text-primary transition-colors"
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                ))
              })()}
            </div>
          </div>
        )}
        {/* Attachment preview */}
        {attachments.length > 0 && (
          <div className="flex gap-2 pb-2 flex-wrap">
            {attachments.map((att, i) => (
              <div key={i} className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-surface border border-subtle text-[11px]">
                {att.isImage ? <ImageIcon size={12} className="text-indigo" /> : <FileIcon size={12} className="text-tertiary" />}
                <span className="text-secondary max-w-[120px] truncate">{att.name}</span>
                <button onClick={() => removeAttachment(i)} className="text-muted hover:text-coral">
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => handleFileUpload(e.target.files)}
        />
        {/* Input Container — rounded box with textarea + toolbar */}
        <div ref={inputContainerRef} className="flex flex-col rounded-xl bg-elevated border border-subtle relative">
          {/* Slash command autocomplete menu */}
          {slashMenuOpen && (
            <SlashCommandMenu
              commands={filteredCommands}
              selectedIndex={slashIndex}
              onSelect={handleSlashSelect}
            />
          )}
          {/* Textarea Area */}
          <div className="px-3.5 pt-3 pb-2 min-h-[80px]">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t('input.reply')}
              rows={1}
              className="w-full bg-transparent text-[13px] text-primary placeholder:text-muted outline-none resize-none leading-relaxed"
              onKeyDown={(e) => {
                // Slash command menu keyboard navigation
                if (slashMenuOpen && filteredCommands.length > 0) {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setSlashIndex((i) => Math.min(i + 1, filteredCommands.length - 1))
                    return
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setSlashIndex((i) => Math.max(i - 1, 0))
                    return
                  }
                  if (e.key === 'Tab') {
                    e.preventDefault()
                    handleSlashSelect(filteredCommands[slashIndex])
                    return
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    setSlashMenuOpen(false)
                    return
                  }
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleSlashSelect(filteredCommands[slashIndex])
                    return
                  }
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSend()
                }
              }}
            />
          </div>
          {/* Toolbar Row */}
          <div className="flex items-center justify-between px-2.5 h-10">
            {/* Left Tools */}
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-surface-hover transition-colors"
                title={t('button.attachFile')}
              >
                <Plus size={16} className="text-tertiary" />
              </button>
              {/* Permission Mode Dropdown */}
              <div className="relative" ref={permRef}>
                <button
                  onClick={() => setPermOpen(!permOpen)}
                  className={cn(
                    'flex items-center gap-1 px-2 py-1 rounded-md transition-colors text-[11px] font-medium',
                    permissionMode === 'full'
                      ? 'bg-surface-active text-amber hover:bg-surface-hover'
                      : 'bg-surface-active text-secondary hover:bg-surface-hover'
                  )}
                >
                  {permissionMode === 'full' ? <ShieldOff size={12} className="text-amber" /> : <Shield size={12} className="text-indigo" />}
                  <span>{permissionMode === 'full' ? t('permission.fullAccess') : t('permission.ask')}</span>
                  <ChevronDown size={10} className={cn('text-tertiary transition-transform', permOpen && 'rotate-180')} />
                </button>
                {permOpen && (
                  <div className="absolute left-0 bottom-full mb-1 w-[200px] bg-surface border border-subtle rounded-[10px] shadow-lg z-50 p-1 animate-slide-down">
                    <button
                      onClick={() => { onPermissionModeChange?.('confirm'); setPermOpen(false) }}
                      className={cn(
                        'flex items-center gap-2 w-full px-2.5 h-9 rounded-md transition-colors text-left',
                        permissionMode === 'confirm' ? 'bg-elevated' : 'hover:bg-surface-hover'
                      )}
                    >
                      <Shield size={14} className="text-indigo shrink-0" />
                      <span className={cn('text-[12px] font-medium flex-1', permissionMode === 'confirm' ? 'text-primary' : 'text-secondary')}>{t('permission.ask')}</span>
                      {permissionMode === 'confirm' && <Check size={14} className="text-indigo shrink-0" />}
                    </button>
                    <button
                      onClick={() => { onPermissionModeChange?.('full'); setPermOpen(false) }}
                      className={cn(
                        'flex items-center gap-2 w-full px-2.5 h-9 rounded-md transition-colors text-left',
                        permissionMode === 'full' ? 'bg-elevated' : 'hover:bg-surface-hover'
                      )}
                    >
                      <ShieldOff size={14} className="text-amber shrink-0" />
                      <span className={cn('text-[12px] font-medium flex-1', permissionMode === 'full' ? 'text-primary' : 'text-secondary')}>{t('permission.fullAccess')}</span>
                      {permissionMode === 'full' && <Check size={14} className="text-amber shrink-0" />}
                    </button>
                  </div>
                )}
              </div>
            </div>
            {/* Right Tools */}
            <div className="flex items-center gap-2">
              {/* Thinking Mode Pill */}
              <div className="relative" ref={thinkRef}>
                <button
                  onClick={() => setThinkOpen(!thinkOpen)}
                  className={cn(
                    'flex items-center gap-1 px-2 py-1 rounded-md border transition-colors',
                    thinkOpen
                      ? 'border-indigo bg-indigo/10'
                      : 'border-subtle hover:bg-surface-hover'
                  )}
                >
                  <Sparkles size={12} className={cn(thinkOpen ? 'text-indigo' : 'text-tertiary')} />
                  <span className={cn('text-[11px] font-medium', thinkOpen ? 'text-indigo' : 'text-secondary')}>
                    {thinkingMode === 'max' ? 'Max' : thinkingMode === 'off' ? 'Off' : 'Auto'}
                  </span>
                  <ChevronDown size={10} className={cn('transition-transform', thinkOpen ? 'text-indigo rotate-180' : 'text-tertiary')} />
                </button>
                {thinkOpen && (
                  <div className="absolute right-0 bottom-full mb-1 w-[160px] bg-surface border border-subtle rounded-[10px] shadow-lg z-50 p-1 animate-slide-down">
                    {[
                      { value: 'off', label: 'Off' },
                      { value: 'auto', label: 'Auto' },
                      { value: 'max', label: 'Max' },
                    ].map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => { onThinkingModeChange?.(opt.value); setThinkOpen(false) }}
                        className={cn(
                          'flex items-center gap-2 w-full px-2.5 h-8 rounded-md transition-colors text-left',
                          thinkingMode === opt.value ? 'bg-elevated' : 'hover:bg-surface-hover'
                        )}
                      >
                        <span className={cn('text-[12px] font-medium flex-1', thinkingMode === opt.value ? 'text-primary' : 'text-secondary')}>{opt.label}</span>
                        {thinkingMode === opt.value && <Check size={14} className="text-indigo shrink-0" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="relative" ref={modelRef}>
                <button
                  onClick={() => setModelOpen(!modelOpen)}
                  className={cn(
                    'flex items-center gap-1 px-2.5 py-1 rounded-md border transition-colors',
                    modelOpen
                      ? 'border-indigo bg-indigo/10'
                      : 'border-subtle hover:bg-surface-hover'
                  )}
                >
                  <span className={cn('text-[11px] font-medium', modelOpen ? 'text-indigo font-semibold' : 'text-secondary')}>
                    {formatModelShort(session.model)}
                  </span>
                  <ChevronDown size={10} className={cn('transition-transform', modelOpen ? 'text-indigo rotate-180' : 'text-tertiary')} />
                </button>
                {modelOpen && (
                  <div className="absolute right-0 bottom-full mb-1 w-[220px] bg-surface border border-subtle rounded-[10px] shadow-lg z-50 p-1 max-h-[300px] overflow-y-auto animate-slide-down">
                    {/* Anthropic group */}
                    <div className="px-2.5 pt-1.5 pb-0.5">
                      <span className="text-[10px] font-semibold text-muted tracking-wide">{t('provider.anthropic')}</span>
                    </div>
                    {MODEL_OPTIONS.filter(o => o.provider === 'Anthropic').map((opt) => (
                      <button
                        key={opt.id}
                        onClick={() => { onModelChange?.(opt.id); setModelOpen(false) }}
                        className={cn(
                          'flex items-center gap-2 w-full px-2.5 h-8 rounded-md transition-colors text-left',
                          session.model === opt.id ? 'bg-elevated' : 'hover:bg-surface-hover'
                        )}
                      >
                        <span className={cn('text-[12px] font-medium flex-1', session.model === opt.id ? 'text-primary' : 'text-secondary')}>{formatModelShort(opt.id)}</span>
                        {session.model === opt.id && <Check size={14} className="text-indigo shrink-0" />}
                      </button>
                    ))}
                    {/* Divider */}
                    <div className="mx-2 my-1 h-px bg-subtle" />
                    {/* Other Providers group */}
                    <div className="px-2.5 pt-1.5 pb-0.5">
                      <span className="text-[10px] font-semibold text-muted tracking-wide">{t('provider.other')}</span>
                    </div>
                    {MODEL_OPTIONS.filter(o => o.provider !== 'Anthropic').map((opt) => (
                      <button
                        key={opt.id}
                        onClick={() => { onModelChange?.(opt.id); setModelOpen(false) }}
                        className={cn(
                          'flex items-center gap-2 w-full px-2.5 h-8 rounded-md transition-colors text-left',
                          session.model === opt.id ? 'bg-elevated' : 'hover:bg-surface-hover'
                        )}
                      >
                        <span className={cn('text-[12px] font-medium flex-1', session.model === opt.id ? 'text-primary' : 'text-secondary')}>{opt.label}</span>
                        <span className="text-[10px] text-muted shrink-0">{opt.provider}</span>
                        {session.model === opt.id && <Check size={14} className="text-indigo shrink-0 ml-1" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {streaming ? (
                <button
                  onClick={onStopStreaming}
                  className="flex items-center justify-center w-8 h-8 rounded-lg bg-coral hover:opacity-90 transition-opacity"
                >
                  <Square size={14} className="text-white" fill="white" />
                </button>
              ) : (
                <button
                  onClick={handleSend}
                  disabled={!input.trim() && attachments.length === 0}
                  className="flex items-center justify-center w-8 h-8 rounded-lg bg-indigo hover:opacity-90 transition-opacity disabled:opacity-40"
                >
                  <ArrowUp size={16} className="text-white" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── User Message ── */

function UserMessage({ blocks, fallbackContent }: { blocks: ContentBlock[]; fallbackContent: string }) {
  const textBlock = blocks.find(b => b.type === 'text')
  const text = textBlock?.type === 'text' ? textBlock.text : fallbackContent
  const imageAttachments = blocks.filter(b => b.type === 'image_attachment') as Array<{ type: 'image_attachment'; url: string; name: string }>
  const fileAttachments = blocks.filter(b => b.type === 'file_attachment') as Array<{ type: 'file_attachment'; url: string; name: string; size: number; mimeType: string }>
  const hasAttachments = imageAttachments.length > 0 || fileAttachments.length > 0

  return (
    <div className="flex justify-end">
      <div className="max-w-[70%] px-4 py-2.5 rounded-2xl bg-indigo text-white">
        {text && <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{text}</p>}

        {/* Image attachments: single = large, 2+ = 2x2 grid */}
        {imageAttachments.length > 0 && (
          <div className={cn(
            hasAttachments && text ? 'mt-2' : '',
            imageAttachments.length === 1 ? '' : 'grid grid-cols-2 gap-1',
          )}>
            {imageAttachments.slice(0, 4).map((img, idx) => (
              <div key={idx} className="relative">
                <img
                  src={img.url}
                  alt={img.name}
                  className={cn(
                    'rounded-lg object-cover cursor-pointer hover:opacity-90 transition-opacity',
                    imageAttachments.length === 1 ? 'max-w-[300px] max-h-[300px]' : 'w-full h-[120px]',
                  )}
                  onClick={() => window.open(img.url, '_blank')}
                />
                {/* "+N" badge on the 4th image if more than 4 */}
                {idx === 3 && imageAttachments.length > 4 && (
                  <div className="absolute inset-0 rounded-lg bg-black/50 flex items-center justify-center">
                    <span className="text-white text-[16px] font-semibold">+{imageAttachments.length - 4}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* File attachments: vertical list of cards */}
        {fileAttachments.length > 0 && (
          <div className={cn('space-y-1', (text || imageAttachments.length > 0) ? 'mt-2' : '')}>
            {fileAttachments.map((file, idx) => {
              const ext = file.name.split('.').pop()?.toLowerCase() || ''
              const icon = ['pdf'].includes(ext) ? '📄'
                : ['doc', 'docx'].includes(ext) ? '📝'
                : ['xls', 'xlsx'].includes(ext) ? '📊'
                : ['ppt', 'pptx'].includes(ext) ? '📎'
                : ['csv', 'tsv'].includes(ext) ? '📋'
                : ['json', 'yaml', 'yml', 'toml', 'xml'].includes(ext) ? '⚙️'
                : ['ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'java', 'cpp', 'c', 'rb', 'php', 'sh', 'sql'].includes(ext) ? '💻'
                : '📁'
              const sizeStr = file.size > 0
                ? file.size > 1024 * 1024 ? `${(file.size / 1024 / 1024).toFixed(1)} MB`
                : file.size > 1024 ? `${(file.size / 1024).toFixed(0)} KB`
                : `${file.size} B`
                : ''
              return (
                <div key={idx} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white/10 text-white/90">
                  <span className="text-[14px]">{icon}</span>
                  <span className="text-[12px] truncate max-w-[200px]">{file.name}</span>
                  {sizeStr && <span className="text-[10px] text-white/50 shrink-0">{sizeStr}</span>}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

/* ── Assistant Message ── */

function AssistantMessage({ blocks, streaming, isThinking, thinkingMode, onPermissionDecision, elapsedSeconds, inputTokens, outputTokens }: {
  blocks: ContentBlock[]
  streaming: boolean
  isThinking?: boolean
  thinkingMode?: string
  onPermissionDecision?: (requestId: string, decision: 'allow' | 'allow_session' | 'deny') => void
  elapsedSeconds?: number
  inputTokens?: number
  outputTokens?: number
}) {
  const nonThinkingBlocks = blocks.filter(b => b.type !== 'thinking')
  const thinkingBlocks = blocks.filter(b => b.type === 'thinking')
  const hasContent = nonThinkingBlocks.length > 0
  // Show "Thinking..." label based on thinking mode:
  //   max  → immediately (we know it will think)
  //   auto → only after SDK sends thinking_start (isThinking)
  //   off  → never
  const showThinkingLabel = streaming && !hasContent && (
    thinkingMode === 'max' || (thinkingMode === 'auto' && isThinking) ||
    // Legacy value support
    thinkingMode === 'enabled' || (thinkingMode === 'adaptive' && isThinking)
  )

  return (
    <div className="flex gap-3">
      <div className="w-7 h-7 rounded-full bg-indigo flex items-center justify-center shrink-0 mt-0.5">
        <Bot size={16} className="text-white" />
      </div>
      <div className="flex-1 min-w-0 space-y-3">
        {!hasContent && streaming && <WaitingIndicator label={showThinkingLabel ? 'Thinking...' : undefined} />}
        {/* Collapsible thinking panel */}
        {thinkingBlocks.length > 0 && (
          <ThinkingPanel text={thinkingBlocks.map(b => b.type === 'thinking' ? b.text : '').join('')} streaming={streaming && !hasContent} />
        )}
        {/* Parallel agent indicator: count agent tool_use blocks that haven't received results yet */}
        {(() => {
          const runningAgents = blocks.filter(b =>
            b.type === 'tool_use' &&
            isAgentToolCall(b.name) &&
            !blocks.some(r => r.type === 'tool_result' && r.tool_use_id === b.id)
          ).length
          return <ParallelAgentIndicator count={runningAgents} />
        })()}
        {(() => {
          // Group permission requests by toolName. Both pending and resolved
          // same-tool requests are merged into a single card to reduce visual clutter.
          type PermBlock = Extract<ContentBlock, { type: 'permission_request' }>
          const permByTool = new Map<string, Array<{ idx: number; block: PermBlock }>>()
          blocks.forEach((block, idx) => {
            if (block.type === 'permission_request') {
              const key = block.toolName
              if (!permByTool.has(key)) permByTool.set(key, [])
              permByTool.get(key)!.push({ idx, block })
            }
          })
          // Groups with 2+ entries render at the first occurrence; others are skipped
          const groupRenderedAt = new Map<string, number>()
          const groupedIndices = new Set<number>()
          for (const [toolName, entries] of permByTool) {
            if (entries.length > 1) {
              groupRenderedAt.set(toolName, entries[0].idx)
              for (const e of entries) groupedIndices.add(e.idx)
            }
          }

          return blocks.map((block, i) => {
            switch (block.type) {
              case 'text':
                return <TextBlock key={`text-${i}`} text={block.text} isLast={i === blocks.length - 1 && streaming} />
              case 'tool_use': {
                // Hide tool card while its permission is pending or was denied/timed out.
                // Tools should only render AFTER the user grants permission.
                const perm = blocks.find(b =>
                  b.type === 'permission_request' &&
                  (b.toolUseId === block.id || (!b.toolUseId && b.toolName === block.name))
                )
                if (perm && perm.type === 'permission_request' && perm.status !== 'allowed' && perm.status !== 'allowed_session') {
                  return null
                }

                const result = blocks.find((b) => b.type === 'tool_result' && b.tool_use_id === block.id)
                const rawResult = blocks.find((b) => b.type === 'tool_raw_result' && b.tool_use_id === block.id)
                const progress = blocks.find((b) => b.type === 'tool_progress' && b.tool_use_id === block.id)
                const hasResult = !!result
                const isResultError = result?.type === 'tool_result' && result.is_error
                const resultContent = result?.type === 'tool_result' ? result.content : undefined
                const rawContent = rawResult?.type === 'tool_raw_result' ? rawResult.raw_content : undefined
                const elapsedSeconds = progress?.type === 'tool_progress' ? progress.elapsed_time_seconds : 0

                // Route agent/sub-agent calls to dedicated AgentBlock
                if (isAgentToolCall(block.name)) {
                  const agentInput = block.input as { description?: string; prompt?: string; subagent_type?: string }
                  const agentName = agentInput.subagent_type || agentInput.description || 'agent'
                  const agentTask = agentInput.prompt || agentInput.description || ''
                  // Find structured sub-blocks from agent_content events
                  const agentContentBlock = blocks.find(
                    (b) => b.type === 'agent_content' && (b as { parent_tool_use_id: string }).parent_tool_use_id === block.id
                  )
                  const agentSubBlocks = agentContentBlock?.type === 'agent_content'
                    ? (agentContentBlock as { blocks: import('@/lib/types').AgentSubBlock[] }).blocks
                    : undefined
                  return (
                    <AgentBlock
                      key={block.id}
                      toolUseId={block.id}
                      agentName={agentName}
                      task={agentTask}
                      hasResult={hasResult}
                      isResultError={isResultError}
                      resultContent={resultContent}
                      rawContent={rawContent}
                      elapsedSeconds={elapsedSeconds}
                      streaming={streaming}
                      allBlocks={blocks}
                      agentSubBlocks={agentSubBlocks}
                    />
                  )
                }

                return <ToolUseBlock key={block.id} name={block.name} input={block.input} hasResult={hasResult} isResultError={isResultError} resultContent={resultContent} rawContent={rawContent} streaming={streaming} />
              }
              case 'tool_result':
              case 'tool_raw_result':
              case 'tool_progress':
              case 'agent_content':
                return null // Results/progress/agent-content are shown inside ToolUseBlock/AgentBlock
              case 'permission_request': {
                if (groupedIndices.has(i)) {
                  if (groupRenderedAt.get(block.toolName) === i) {
                    const group = permByTool.get(block.toolName)!
                    return <PermissionGroupBlock key={`perm-group-${block.toolName}`} requests={group.map(e => e.block)} onDecision={onPermissionDecision} />
                  }
                  return null // Skip — handled by the group
                }
                return <PermissionBlock key={block.requestId} requestId={block.requestId} toolName={block.toolName} toolInput={block.toolInput} status={block.status} toolFailed={block.toolFailed} onDecision={onPermissionDecision} />
              }
              default:
                return null
            }
          })
        })()}
        {(elapsedSeconds != null && elapsedSeconds > 0) && (
          <TurnStats elapsedSeconds={elapsedSeconds} inputTokens={inputTokens} outputTokens={outputTokens} streaming={streaming} />
        )}
      </div>
    </div>
  )
}

/* ── Turn Stats ── */

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

function formatTurnElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}m ${s}s`
}

function TurnStats({ elapsedSeconds, inputTokens, outputTokens, streaming }: {
  elapsedSeconds: number
  inputTokens?: number
  outputTokens?: number
  streaming: boolean
}) {
  const hasTokens = (inputTokens != null && inputTokens > 0) || (outputTokens != null && outputTokens > 0)
  return (
    <div className="flex justify-end items-center gap-1.5 mt-2">
      <span className="text-[12px] text-muted font-mono tabular-nums">
        {formatTurnElapsed(elapsedSeconds)}
      </span>
      {hasTokens && (
        <>
          <span className="text-[12px] text-muted font-mono">·</span>
          <span className="text-[12px] text-muted font-mono tabular-nums">
            ↑{formatTokens(inputTokens || 0)} ↓{formatTokens(outputTokens || 0)}
          </span>
        </>
      )}
      {streaming && !hasTokens && (
        <Loader2 size={10} className="animate-spin text-muted" />
      )}
    </div>
  )
}

/* ── Thinking Panel (Collapsible) ── */

function ThinkingPanel({ text, streaming }: { text: string; streaming?: boolean }) {
  const [expanded, setExpanded] = useState(false)
  if (!text && !streaming) return null

  return (
    <div className="rounded-lg border border-subtle bg-elevated overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-2 hover:bg-surface-hover transition-colors text-left"
      >
        {expanded ? (
          <ChevronDown size={14} className="text-tertiary shrink-0" />
        ) : (
          <ChevronRight size={14} className="text-tertiary shrink-0" />
        )}
        <span className="text-[13px]">💭</span>
        <span className="text-[13px] font-medium text-secondary">Thinking</span>
        {streaming && <Loader2 size={12} className="text-indigo animate-spin shrink-0" />}
      </button>
      <div
        className="grid transition-[grid-template-rows] duration-200 ease-in-out"
        style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div className="px-3 pb-3 pt-0">
            <p className="text-[12px] text-secondary italic leading-relaxed whitespace-pre-wrap">{text}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── Text Block with Markdown rendering ── */

function TextBlock({ text, isLast }: { text: string; isLast: boolean }) {
  if (!text && isLast) return <StreamingCursor />

  return (
    <div>
      <MarkdownRenderer content={text} />
      {isLast && <StreamingCursor />}
    </div>
  )
}

/* ── Tool Use Block ── */

function ToolUseBlock({ name, input, hasResult, isResultError, resultContent, rawContent, streaming }: {
  name: string
  input: Record<string, unknown>
  hasResult?: boolean
  isResultError?: boolean
  resultContent?: string
  rawContent?: ToolRawContent
  streaming?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const summary = getToolSummary(name, input)
  const isDone = hasResult || !streaming
  // Can expand if we have raw content or result text
  const canExpand = !!(rawContent || (hasResult && resultContent))
  const toolIcon = getToolIcon(name)

  return (
    <div className={cn('rounded-lg border overflow-hidden my-1', isResultError ? 'border-coral/30' : 'border-subtle')}>
      <button
        onClick={() => canExpand && setExpanded(!expanded)}
        className={cn(
          'flex items-center gap-2 w-full px-2.5 py-2.5 bg-surface transition-colors text-left',
          canExpand ? 'hover:bg-surface-hover cursor-pointer' : 'cursor-default'
        )}
      >
        {isDone ? (
          isResultError ? <XCircle size={14} className="text-coral shrink-0" /> : toolIcon
        ) : (
          <Loader2 size={14} className="text-indigo animate-spin shrink-0" />
        )}
        <span className={cn('text-[12px] font-semibold shrink-0', isDone && !isResultError ? 'text-green' : isResultError ? 'text-coral' : 'text-secondary')}>{getToolDisplayName(name)}</span>
        {summary && <span className="text-[12px] text-tertiary truncate flex-1">{summary}</span>}
        {rawContent?.type === 'web_search' && (
          <span className="text-[10px] text-muted shrink-0">{rawContent.results.length} results</span>
        )}
        {canExpand && (
          <ChevronDown size={12} className={cn('text-muted shrink-0 transition-transform ml-auto', expanded && 'rotate-180')} />
        )}
      </button>
      {canExpand && (
        <div
          className="grid transition-[grid-template-rows] duration-200 ease-in-out"
          style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
        >
          <div className="overflow-hidden">
            <ToolResultContent
              name={name}
              rawContent={rawContent}
              resultContent={resultContent}
              isError={isResultError}
            />
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Tool Result Content (rendered inside ToolUseBlock when expanded) ── */

function ToolResultContent({ name, rawContent, resultContent, isError }: {
  name: string
  rawContent?: ToolRawContent
  resultContent?: string
  isError?: boolean
}) {
  // Web search: structured results with domain icon + title + domain link
  if (rawContent?.type === 'web_search') {
    return (
      <div className="border-t border-subtle bg-elevated">
        {rawContent.results.map((r, i) => {
          const domain = getDomain(r.url)
          return (
            <a
              key={i}
              href={r.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2.5 px-3 py-1.5 border-b border-subtle last:border-b-0 hover:bg-surface-hover transition-colors"
            >
              <span className="w-4 h-4 rounded-sm bg-surface flex items-center justify-center text-[8px] text-muted font-semibold shrink-0 uppercase">
                {domain.charAt(0)}
              </span>
              <span className="text-[11px] text-secondary truncate flex-1">{r.title}</span>
              <span className="text-[10px] text-muted shrink-0">{domain}</span>
            </a>
          )
        })}
      </div>
    )
  }

  // Raw text content (from tool execution)
  if (rawContent?.type === 'text') {
    return <DiffOrCodeView text={rawContent.text} name={name} isError={isError} />
  }

  // Fallback: tool_use_summary text
  if (resultContent) {
    return <DiffOrCodeView text={resultContent} name={name} isError={isError} />
  }

  return null
}

/**
 * Renders tool result text as either a diff view (with color-coded +/- lines)
 * or plain code view, matching the Pencil design.
 */
function DiffOrCodeView({ text, name, isError }: { text: string; name: string; isError?: boolean }) {
  const lines = text.split('\n')
  const hasDiffLines = lines.some(l => l.startsWith('+') || l.startsWith('-') || l.startsWith('@@'))
  const isDiff = hasDiffLines && (name === 'Edit' || name === 'Write' || lines.some(l => l.startsWith('---') || l.startsWith('+++')))

  if (isDiff) {
    // Count additions and deletions for the badge
    const added = lines.filter(l => l.startsWith('+') && !l.startsWith('+++')).length
    const removed = lines.filter(l => l.startsWith('-') && !l.startsWith('---')).length
    // Try to extract filename from diff header
    const fileHeader = lines.find(l => l.startsWith('---') || l.startsWith('+++'))
    const fileName = fileHeader?.replace(/^[+-]{3}\s+/, '').replace(/^[ab]\//, '') || ''

    return (
      <div className="border-t border-subtle overflow-hidden">
        {/* Diff Header */}
        {(fileName || added > 0 || removed > 0) && (
          <div className="flex items-center gap-2 px-3.5 py-2 bg-elevated">
            <FileDiff size={14} className="text-amber shrink-0" />
            {fileName && <span className="text-[12px] font-semibold text-primary truncate">{fileName}</span>}
            {(added > 0 || removed > 0) && (
              <span className="text-[10px] font-semibold text-green bg-green/10 px-1.5 py-0.5 rounded shrink-0">
                +{added} -{removed}
              </span>
            )}
          </div>
        )}
        {/* Diff Body */}
        <div className="px-3.5 py-2 max-h-[300px] overflow-y-auto">
          {lines.map((line, i) => {
            if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('@@')) return null
            const lineColor = line.startsWith('+') ? 'text-green' : line.startsWith('-') ? 'text-coral' : 'text-secondary'
            return (
              <div key={i} className={cn('text-[11px] font-mono leading-[1.6] whitespace-pre-wrap', lineColor)}>
                {line || '\u00A0'}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // Plain code/text view
  return (
    <pre className={cn(
      'px-3.5 py-2 text-[11px] font-mono overflow-x-auto max-h-[300px] overflow-y-auto border-t border-subtle whitespace-pre-wrap leading-[1.6]',
      isError ? 'bg-coral/5 text-coral' : 'bg-elevated text-secondary'
    )}>
      {text}
    </pre>
  )
}

/** Extract domain from URL */
function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** Get display-friendly tool name */
function getToolDisplayName(name: string): string {
  switch (name) {
    case 'WebSearch': return 'Web Search'
    case 'WebFetch': return 'Web Fetch'
    case 'ToolSearch': return 'Tool Search'
    case 'NotebookEdit': return 'Notebook Edit'
    default: return name
  }
}

/** Get icon for tool type */
function getToolIcon(name: string): React.ReactElement {
  switch (name) {
    case 'WebSearch':
    case 'WebFetch':
      return <Globe size={14} className="text-green shrink-0" />
    case 'Bash':
      return <Terminal size={14} className="text-green shrink-0" />
    case 'Read':
    case 'Write':
    case 'Edit':
      return <FileText size={14} className="text-green shrink-0" />
    case 'Grep':
    case 'Glob':
    case 'ToolSearch':
      return <Search size={14} className="text-green shrink-0" />
    default:
      return <FileText size={14} className="text-green shrink-0" />
  }
}

/* ── Permission Block ── */

/**
 * Grouped permission block: merges multiple same-tool requests (pending or resolved)
 * into a single compact card with expandable details.
 */
function PermissionGroupBlock({
  requests,
  onDecision,
}: {
  requests: Array<Extract<ContentBlock, { type: 'permission_request' }>>
  onDecision?: (requestId: string, decision: 'allow' | 'allow_session' | 'deny') => void
}) {
  const toolName = requests[0].toolName
  const [expanded, setExpanded] = useState(false)
  const pendingRequests = requests.filter(r => r.status === 'pending')
  const hasPending = pendingRequests.length > 0
  const allResolved = !hasPending

  // Derive group status from individual statuses
  const resolvedStatus = allResolved ? requests[0].status : undefined
  const hasFailure = requests.some(r => r.toolFailed)

  // Countdown timer (only for pending groups)
  const [remaining, setRemaining] = useState(120)
  useEffect(() => {
    if (!hasPending) return
    const start = Date.now()
    const timer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - start) / 1000)
      setRemaining(Math.max(0, 120 - elapsed))
    }, 1000)
    return () => clearInterval(timer)
  }, [hasPending])

  const handleDecision = (decision: 'allow' | 'allow_session' | 'deny') => {
    if (!onDecision) return
    for (const req of pendingRequests) {
      onDecision(req.requestId, decision)
    }
  }

  const statusTitle = hasPending ? 'Permission Required'
    : resolvedStatus === 'denied' ? 'Permission Denied'
    : resolvedStatus === 'timeout' ? 'Permission Timed Out'
    : resolvedStatus === 'allowed_session' ? 'Permission Granted (Session)'
    : 'Permission Granted'
  const statusColor = hasPending ? 'text-amber'
    : resolvedStatus === 'timeout' ? 'text-amber'
    : resolvedStatus === 'denied' ? 'text-coral'
    : 'text-green'
  const borderColor = hasPending ? 'border-strong'
    : resolvedStatus === 'timeout' ? 'border-amber/30'
    : resolvedStatus === 'denied' ? 'border-coral/30'
    : 'border-green/30'

  return (
    <div className={cn('rounded-[10px] border overflow-hidden my-2 flex flex-col gap-2.5 p-3.5 bg-elevated', borderColor)}>
      {/* Header */}
      <div className="flex items-center gap-2">
        <ShieldAlert size={16} className={cn(statusColor, 'shrink-0')} />
        <span className={cn('text-[13px] font-semibold', statusColor)}>{statusTitle}</span>
        <span className="text-[11px] text-muted px-1.5 py-0.5 rounded bg-surface-active">{requests.length}</span>
        {hasPending && remaining > 0 && (
          <span className={cn('text-[11px] font-mono tabular-nums ml-auto', remaining <= 30 ? 'text-coral' : 'text-muted')}>
            {remaining}s
          </span>
        )}
      </div>

      {/* Tool failure warning */}
      {allResolved && hasFailure && (
        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-coral/10 border border-coral/20">
          <XCircle size={13} className="text-coral shrink-0" />
          <span className="text-[11px] text-coral font-medium">Tool execution failed after permission was granted</span>
        </div>
      )}

      {/* Summary + expandable details */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-left"
      >
        <ChevronDown size={12} className={cn('text-tertiary transition-transform shrink-0', expanded && 'rotate-180')} />
        <span className="text-[12px] font-medium text-primary">{toolName}</span>
        <span className="text-[11px] text-muted">{requests.length} requests</span>
      </button>
      {expanded && (
        <div className="ml-5 flex flex-col gap-1.5">
          {requests.map((req) => {
            const summary = getToolSummary(req.toolName, req.toolInput)
            return (
              <p key={req.requestId} className="text-[11px] text-secondary font-mono truncate">
                {summary || JSON.stringify(req.toolInput).slice(0, 80)}
              </p>
            )
          })}
        </div>
      )}

      {/* Action Buttons — only for pending */}
      {hasPending && onDecision && (
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={() => handleDecision('deny')}
            className="px-3.5 py-1.5 rounded-md border border-strong text-[11px] font-medium text-secondary hover:bg-surface-hover transition-colors"
          >
            Deny
          </button>
          <button
            onClick={() => handleDecision('allow_session')}
            className="px-3.5 py-1.5 rounded-md border border-indigo/30 bg-indigo/10 text-[11px] font-medium text-indigo hover:bg-indigo/20 transition-colors"
          >
            Allow Session
          </button>
          <button
            onClick={() => handleDecision('allow')}
            className="px-3.5 py-1.5 rounded-md bg-indigo text-white text-[11px] font-medium hover:opacity-90 transition-opacity"
          >
            Allow
          </button>
        </div>
      )}
    </div>
  )
}

function PermissionBlock({
  requestId,
  toolName,
  toolInput,
  status,
  toolFailed,
  onDecision,
}: {
  requestId: string
  toolName: string
  toolInput: Record<string, unknown>
  status: PermissionStatus
  toolFailed?: boolean
  onDecision?: (requestId: string, decision: 'allow' | 'allow_session' | 'deny') => void
}) {
  const summary = getToolSummary(toolName, toolInput)
  const isPending = status === 'pending'
  const isAllowed = status === 'allowed' || status === 'allowed_session'

  // Countdown timer for pending permissions (120s timeout)
  const [remaining, setRemaining] = useState(120)
  useEffect(() => {
    if (!isPending) return
    const start = Date.now()
    const timer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - start) / 1000)
      setRemaining(Math.max(0, 120 - elapsed))
    }, 1000)
    return () => clearInterval(timer)
  }, [isPending])

  // Expanded state for long tool inputs
  const [inputExpanded, setInputExpanded] = useState(false)
  const commandStr = toolInput.command ? String(toolInput.command) : ''
  const isLongCommand = commandStr.length > 100

  const statusTitle = isPending ? 'Permission Required'
    : status === 'denied' ? 'Permission Denied'
    : status === 'timeout' ? 'Permission Timed Out'
    : status === 'allowed_session' ? 'Permission Granted (Session)'
    : 'Permission Granted'
  // Timeout uses amber, deny uses coral, allowed uses green
  const statusColor = isPending ? 'text-amber'
    : status === 'timeout' ? 'text-amber'
    : status === 'denied' ? 'text-coral'
    : 'text-green'
  const borderColor = isPending ? 'border-strong'
    : status === 'timeout' ? 'border-amber/30'
    : status === 'denied' ? 'border-coral/30'
    : 'border-green/30'

  return (
    <div className={cn(
      'rounded-[10px] border overflow-hidden my-2 flex flex-col gap-3 p-3.5 bg-elevated',
      borderColor,
    )}>
      {/* Header */}
      <div className="flex items-center gap-2">
        <ShieldAlert size={16} className={cn(statusColor, 'shrink-0')} />
        <span className={cn('text-[13px] font-semibold', statusColor)}>{statusTitle}</span>
        {isPending && remaining > 0 && (
          <span className={cn('text-[11px] font-mono tabular-nums ml-auto', remaining <= 30 ? 'text-coral' : 'text-muted')}>
            {remaining}s
          </span>
        )}
      </div>

      {/* Tool failure warning — shown when permission was granted but tool execution failed */}
      {isAllowed && toolFailed && (
        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-coral/10 border border-coral/20">
          <XCircle size={13} className="text-coral shrink-0" />
          <span className="text-[11px] text-coral font-medium">Tool execution failed after permission was granted</span>
        </div>
      )}

      {/* Description */}
      <div className="flex flex-col gap-1">
        <p className="text-[12px] font-medium text-primary">
          {toolName}{summary ? `  ${summary}` : ''}
        </p>
        {commandStr && (
          <div>
            <p className="text-[12px] text-secondary font-mono whitespace-pre-wrap break-all">
              {isLongCommand && !inputExpanded ? commandStr.slice(0, 100) + '...' : commandStr}
            </p>
            {isLongCommand && (
              <button
                onClick={() => setInputExpanded(!inputExpanded)}
                className="text-[11px] text-indigo hover:underline mt-0.5"
              >
                {inputExpanded ? 'Show less' : 'Show full command'}
              </button>
            )}
          </div>
        )}
        {!!toolInput.file_path && !summary && (
          <p className="text-[12px] text-secondary">{String(toolInput.file_path)}</p>
        )}
        {/* Show content for Write/Edit tools in pending state so user can review */}
        {isPending && typeof toolInput.content === 'string' && (toolName === 'Write' || toolName === 'Edit') && (() => {
          const contentStr = toolInput.content as string
          return (
            <details className="mt-1">
              <summary className="text-[11px] text-indigo cursor-pointer hover:underline">View file content</summary>
              <pre className="mt-1 px-2 py-1.5 rounded bg-surface text-[11px] font-mono text-secondary max-h-[200px] overflow-y-auto whitespace-pre-wrap">
                {contentStr.slice(0, 2000)}{contentStr.length > 2000 ? '\n[truncated]' : ''}
              </pre>
            </details>
          )
        })()}
      </div>

      {/* Action Buttons */}
      {isPending && onDecision && (
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={() => onDecision(requestId, 'deny')}
            className="px-3.5 py-1.5 rounded-md border border-strong text-[11px] font-medium text-secondary hover:bg-surface-hover transition-colors"
          >
            Deny
          </button>
          <button
            onClick={() => onDecision(requestId, 'allow_session')}
            className="px-3.5 py-1.5 rounded-md border border-indigo/30 bg-indigo/10 text-[11px] font-medium text-indigo hover:bg-indigo/20 transition-colors"
          >
            Allow Session
          </button>
          <button
            onClick={() => onDecision(requestId, 'allow')}
            className="px-3.5 py-1.5 rounded-md bg-indigo text-white text-[11px] font-medium hover:opacity-90 transition-opacity"
          >
            Allow
          </button>
        </div>
      )}
    </div>
  )
}

/* ── Helpers ── */

function StreamingCursor() {
  return <span className="inline-block w-2 h-4 bg-indigo/60 animate-pulse rounded-sm" />
}

/**
 * Loading indicator shown while waiting for the first response.
 * Shows "Thinking..." only when the model is actively using extended thinking.
 * Otherwise shows a generic spinner with elapsed time.
 */
function WaitingIndicator({ label }: { label?: string }) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const start = Date.now()
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000))
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  const mins = Math.floor(elapsed / 60)
  const secs = elapsed % 60

  return (
    <div className="flex items-center gap-2 py-1">
      <Loader2 size={14} className="text-indigo animate-spin shrink-0" />
      {label && <span className="text-[13px] text-secondary">{label}</span>}
      <span className="text-[12px] text-muted font-mono tabular-nums">
        {mins > 0 ? `${mins}m ${secs}s` : `${secs}s`}
      </span>
    </div>
  )
}

async function exportSession(sessionId: string, title: string) {
  try {
    const res = await fetch(`/api/sessions/${sessionId}/export`)
    if (!res.ok) return
    const data = await res.json()
    const md = convertSessionToMarkdown(data)
    const blob = new Blob([md], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${title.replace(/[^a-zA-Z0-9\u4e00-\u9fff-_]/g, '_').slice(0, 50)}.md`
    a.click()
    URL.revokeObjectURL(url)
  } catch { /* ignore */ }
}

/* ── Session → Markdown Conversion ── */

interface ExportBlock {
  type: string
  text?: string
  name?: string
  id?: string
  input?: Record<string, unknown>
  content?: string
  is_error?: boolean
  tool_use_id?: string
  parent_tool_use_id?: string
  blocks?: ExportBlock[]
}

interface ExportData {
  session: { title: string; model: string; workspace: string; created_at: string }
  messages: { role: string; text?: string; blocks?: ExportBlock[]; created_at: string }[]
}

function convertSessionToMarkdown(data: ExportData): string {
  const lines: string[] = []
  const s = data.session

  // Header
  lines.push(`# ${s.title}`)
  lines.push('')
  lines.push(`- **Model**: ${s.model}`)
  lines.push(`- **Workspace**: ${s.workspace}`)
  lines.push(`- **Created**: ${s.created_at}`)
  lines.push('')
  lines.push('---')
  lines.push('')

  for (const msg of data.messages) {
    const ts = msg.created_at ? new Date(msg.created_at).toLocaleString() : ''
    if (msg.role === 'user') {
      lines.push(`## User (${ts})`)
      lines.push('')
      lines.push(msg.text || '')
      lines.push('')
    } else {
      lines.push(`## Assistant (${ts})`)
      lines.push('')
      if (msg.blocks) {
        renderBlocks(msg.blocks, lines, '')
      }
    }
  }

  return lines.join('\n')
}

function renderBlocks(blocks: ExportBlock[], lines: string[], indent: string) {
  for (const b of blocks) {
    switch (b.type) {
      case 'text':
        if (b.text) {
          // Indent each line for nested blocks
          if (indent) {
            for (const line of b.text.split('\n')) {
              lines.push(indent + line)
            }
          } else {
            lines.push(b.text)
          }
          lines.push('')
        }
        break

      case 'thinking':
        lines.push(`${indent}> *Thinking*`)
        if (b.text) {
          for (const line of b.text.split('\n')) {
            lines.push(`${indent}> ${line}`)
          }
        }
        lines.push('')
        break

      case 'tool_use': {
        const summary = getExportToolSummary(b.name || '', b.input || {})
        lines.push(`${indent}**Tool: \`${b.name}\`**${summary ? ` — ${summary}` : ''}`)
        lines.push('')
        break
      }

      case 'tool_result':
        if (b.content) {
          lines.push(`${indent}<details><summary>${b.is_error ? 'Error Result' : 'Result'}</summary>`)
          lines.push('')
          lines.push(`${indent}\`\`\``)
          for (const line of b.content.split('\n')) {
            lines.push(indent + line)
          }
          lines.push(`${indent}\`\`\``)
          lines.push('')
          lines.push(`${indent}</details>`)
          lines.push('')
        }
        break

      case 'agent_content':
        if (b.blocks && b.blocks.length > 0) {
          lines.push(`${indent}> **Sub-Agent**`)
          lines.push('')
          renderBlocks(b.blocks, lines, indent + '> ')
        }
        break

      // tool_progress, permission_request, tool_raw_result — skip
      default:
        break
    }
  }
}

function getExportToolSummary(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'Read': return String(input.file_path || input.path || '').split('/').pop() || ''
    case 'Write': return String(input.file_path || input.path || '').split('/').pop() || ''
    case 'Edit': return String(input.file_path || input.path || '').split('/').pop() || ''
    case 'Bash': return `\`${String(input.command || '').slice(0, 80)}\``
    case 'Glob': return String(input.pattern || '')
    case 'Grep': return String(input.pattern || '')
    case 'WebSearch': return String(input.query || '')
    case 'WebFetch': return String(input.url || '').slice(0, 60)
    case 'Agent': return String(input.prompt || '').slice(0, 80)
    default: return ''
  }
}

function formatModel(model: string): string {
  const found = MODEL_OPTIONS.find((o) => o.id === model)
  if (found) return found.label
  // Fallback: prettify the model ID
  if (model.includes('opus')) return 'Claude Opus 4.6'
  if (model.includes('haiku')) return 'Claude Haiku 4.5'
  if (model.includes('claude')) return 'Claude Sonnet 4.6'
  return model
}

/** Short model name for the toolbar pill (e.g. "Sonnet 4.6" instead of "Claude Sonnet 4.6") */
function formatModelShort(model: string): string {
  const full = formatModel(model)
  return full.replace(/^Claude\s+/, '')
}

function getToolSummary(name: string, input: Record<string, unknown>): string {
  switch (name) {
    // SDK built-in tools (PascalCase)
    case 'Read': return String(input.file_path || '')
    case 'Write': return String(input.file_path || '')
    case 'Edit': return String(input.file_path || '')
    case 'Bash': return String(input.command || '').slice(0, 80)
    case 'Glob': return String(input.pattern || '')
    case 'Grep': return String(input.pattern || '').slice(0, 60)
    case 'Agent': return String(input.description || '')
    case 'WebFetch': return String(input.url || '').slice(0, 80)
    case 'WebSearch': return String(input.query || '').slice(0, 80)
    case 'ToolSearch': return String(input.query || '').slice(0, 80)
    case 'NotebookEdit': return String(input.file_path || '')
    case 'Skill': return String(input.skill || '')
    // Custom tools (snake_case, legacy)
    case 'read_file': return String(input.path || '')
    case 'write_file': return String(input.path || '')
    case 'list_directory': return String(input.path || '.')
    case 'run_command': return String(input.command || '').slice(0, 60)
    case 'search_files': return String(input.pattern || '')
    case 'search_content': return String(input.pattern || '')
    case 'delegate_to_agent': return `agent:${input.agent_id || '?'} — ${String(input.task || '').slice(0, 40)}`
    case 'browser_navigate': return String(input.url || '')
    case 'browser_click': return `click ${input.selector || ''}`
    case 'browser_type': return `type into ${input.selector || ''}`
    case 'browser_screenshot': return 'screenshot'
    case 'browser_evaluate': return String(input.expression || '').slice(0, 50)
    default:
      if (name.startsWith('browser_')) return name.replace('browser_', '')
      return ''
  }
}
