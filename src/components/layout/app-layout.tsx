'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { TitleBar } from './title-bar'
import { LeftSidebar } from './left-sidebar'
import { ProjectModal } from './project-modal'
import { RightSidebar } from './right-sidebar'
import { ForgeFileEditor } from './forge-file-editor'
import { ResizeHandle } from '@/components/ui/resize-handle'
import { ChatView } from '@/components/views/chat-view'
import { ManageView } from '@/components/views/manage-view'
import { ImView } from '@/components/views/im-view'
import { ScheduleView } from '@/components/views/schedule-view'
import { SettingsView } from '@/components/views/settings-view'
import { MarketplaceView } from '@/components/views/marketplace-view'
import { Onboarding } from '@/components/onboarding'
import { ProjectSelection } from '@/components/project-selection'
import { useSessions } from '@/hooks/use-sessions'
import { useChat } from '@/hooks/use-chat'
import { useWorkspaces } from '@/hooks/use-workspaces'
import { useSettings } from '@/hooks/use-settings'
import { useI18n } from '@/components/providers/i18n-provider'
import { useTheme } from '@/components/providers/theme-provider'
import type { View } from '@/lib/types'
import { GLOBAL_WORKSPACE_ID } from '@/lib/types'

import { BUILTIN_MODELS } from '@/lib/models'

/** Model ID → provider type (lowercase) for per-provider settings lookup */
const MODEL_PROVIDER_MAP: Record<string, string> = Object.fromEntries(
  BUILTIN_MODELS.map(m => [m.id, m.providerId])
)

export function AppLayout() {
  const [activeView, setActiveView] = useState<View>('chat')
  const [leftCollapsed, setLeftCollapsed] = useState(false)
  const [rightCollapsed, setRightCollapsed] = useState(false)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null)
  const [showOnboarding, setShowOnboarding] = useState<boolean | null>(null)
  const [editingFile, setEditingFile] = useState<string | null>(null)
  const [editorClosing, setEditorClosing] = useState(false)
  const [leftWidth, setLeftWidth] = useState(240)
  const [rightWidth, setRightWidth] = useState(260)
  const [editorWidth, setEditorWidth] = useState(520)
  const [projectModalOpen, setProjectModalOpen] = useState(false)

  const { settings, loading: settingsLoading, updateSettings } = useSettings()
  // Per-session permission mode override (null = use global Settings default)
  const [sessionPermMode, setSessionPermMode] = useState<string | null>(null)
  // Per-session thinking mode override (null = use global Settings default)
  const [sessionThinkMode, setSessionThinkMode] = useState<string | null>(null)
  const { setLocale } = useI18n()
  const { setTheme } = useTheme()
  const { workspaces, openProjectFolder, removeProject, touchWorkspace, refreshWorkspaces } = useWorkspaces()

  // Onboarding check: only on initial settings load, never re-triggered by language/theme changes
  useEffect(() => {
    if (!settingsLoading && showOnboarding === null) {
      setShowOnboarding(settings.onboarding_completed !== 'true')
    }
  }, [settingsLoading, settings.onboarding_completed, showOnboarding])

  // Apply language and theme from settings (safe to re-run on changes)
  useEffect(() => {
    if (!settingsLoading) {
      if (settings.language === 'zh' || settings.language === 'en') {
        setLocale(settings.language)
      }
      if (settings.theme === 'dark' || settings.theme === 'light' || settings.theme === 'system') {
        setTheme(settings.theme)
      }
    }
  }, [settingsLoading, settings.language, settings.theme, setLocale, setTheme])

  // NOTE: We intentionally do NOT auto-select a workspace on startup.
  // The user must explicitly choose a project from the ProjectSelection page.
  // This aligns with Cursor/VS Code behavior where each launch starts with project selection.

  const { sessions, loading: sessionsLoading, createSession, updateSession, deleteSession, refreshSessions } = useSessions()
  const { messages, streaming, isThinking, error, sendMessage, loadMessages, stopStreaming, clearMessages, sendPermissionDecision } = useChat(activeSessionId)

  // Apply font settings as CSS variables
  const fontVars = useMemo(() => {
    const size = settings.font_size || '14'
    return {
      '--forge-font-size': `${size}px`,
    } as React.CSSProperties
  }, [settings.font_size])

  // Apply code theme as data attribute on <html> so Shiki can read it
  useEffect(() => {
    const codeTheme = settings.code_theme || 'github-dark'
    document.documentElement.setAttribute('data-code-theme', codeTheme)
  }, [settings.code_theme])

  // Prevent Electron's default drag-and-drop behavior (navigating to the dropped file).
  // Uses the capture phase so component-level handlers in the bubble phase still get the events.
  // Component handlers call e.stopPropagation() to prevent this from interfering.
  useEffect(() => {
    const preventDrag = (e: DragEvent) => { e.preventDefault() }
    const preventDrop = (e: DragEvent) => {
      // Only prevent if no component handler has already stopped propagation
      if (!e.defaultPrevented) e.preventDefault()
    }
    document.addEventListener('dragover', preventDrag)
    document.addEventListener('drop', preventDrop)
    return () => {
      document.removeEventListener('dragover', preventDrag)
      document.removeEventListener('drop', preventDrop)
    }
  }, [])

  const showRightSidebar = activeView === 'chat'

  // Filter sessions by active workspace
  const filteredSessions = useMemo(
    () => sessions.filter((s) => s.workspace === activeWorkspaceId),
    [sessions, activeWorkspaceId]
  )

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId) || null

  // Auto-select first session in workspace
  useEffect(() => {
    if (!sessionsLoading && filteredSessions.length > 0 && !filteredSessions.find((s) => s.id === activeSessionId)) {
      setActiveSessionId(filteredSessions[0].id)
    }
  }, [filteredSessions, sessionsLoading, activeSessionId])

  // Load messages when session changes; reset per-session permission mode to global default
  useEffect(() => {
    if (activeSessionId) {
      loadMessages(activeSessionId)
    } else {
      clearMessages()
    }
    setSessionPermMode(null)
    setSessionThinkMode(null)
  }, [activeSessionId, loadMessages, clearMessages])

  const handleNewSession = useCallback(async () => {
    if (!activeWorkspaceId) return
    const session = await createSession({
      workspace: activeWorkspaceId,
      model: settings.default_model || 'claude-sonnet-4-6',
    })
    setActiveSessionId(session.id)
    setActiveView('chat')
  }, [createSession, activeWorkspaceId, settings.default_model])

  const handleSelectSession = useCallback((id: string) => {
    setActiveSessionId(id)
    setActiveView('chat')
  }, [])

  // Listen for session navigation from Schedule view (View Session links)
  useEffect(() => {
    const handler = (e: Event) => {
      const { sessionId } = (e as CustomEvent).detail || {}
      if (sessionId) {
        setActiveSessionId(sessionId)
        setActiveView('chat')
      }
    }
    window.addEventListener('forge:navigate-session', handler)
    return () => window.removeEventListener('forge:navigate-session', handler)
  }, [])

  // Refresh session list when scheduled tasks create new sessions
  useEffect(() => {
    const handler = () => { refreshSessions() }
    window.addEventListener('forge:sessions-changed', handler)
    return () => window.removeEventListener('forge:sessions-changed', handler)
  }, [refreshSessions])

  // Refs for SSE handlers to avoid stale closures (P14 fix)
  const activeSessionIdRef = useRef(activeSessionId)
  activeSessionIdRef.current = activeSessionId
  const activeWorkspaceIdRef = useRef(activeWorkspaceId)
  activeWorkspaceIdRef.current = activeWorkspaceId
  const refreshSessionsRef = useRef(refreshSessions)
  refreshSessionsRef.current = refreshSessions
  const loadMessagesRef = useRef(loadMessages)
  loadMessagesRef.current = loadMessages

  // SSE listener for real-time IM Bridge → Desktop sync
  // Connection established once, uses refs for current values (P14 fix)
  useEffect(() => {
    let eventSource: EventSource | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let unmounted = false

    const connect = () => {
      if (unmounted) return
      eventSource = new EventSource('/api/im-events')

      eventSource.addEventListener('im:message', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data) as { sessionId?: string; workspaceId?: string }
          refreshSessionsRef.current()
          if (data.sessionId && data.sessionId === activeSessionIdRef.current) {
            loadMessagesRef.current(data.sessionId)
          }
        } catch { /* ignore malformed */ }
      })

      eventSource.addEventListener('im:command', () => {
        refreshSessionsRef.current()
      })

      eventSource.addEventListener('im:session-changed', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data) as { sessionId?: string; workspaceId?: string }
          refreshSessionsRef.current()
          if (data.workspaceId && data.workspaceId !== activeWorkspaceIdRef.current) {
            setActiveWorkspaceId(data.workspaceId)
          }
          // Switch desktop active session to match IM session change (P15 fix)
          if (data.sessionId) {
            setActiveSessionId(data.sessionId)
            loadMessagesRef.current(data.sessionId)
          }
        } catch { /* ignore malformed */ }
      })

      eventSource.onerror = () => {
        eventSource?.close()
        eventSource = null
        if (!unmounted) {
          reconnectTimer = setTimeout(connect, 3000)
        }
      }
    }

    connect()

    return () => {
      unmounted = true
      eventSource?.close()
      if (reconnectTimer) clearTimeout(reconnectTimer)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Single connection, uses refs for mutable values

  // Listen for slash command navigation events from ChatView
  useEffect(() => {
    const handler = (e: Event) => {
      const { command } = (e as CustomEvent).detail || {}
      switch (command) {
        case 'memory':
          // Open MEMORY.md in the file editor panel
          setEditingFile('.claude/MEMORY.md')
          break
        case 'init':
          // Open CLAUDE.md in the file editor panel
          setEditingFile('.claude/CLAUDE.md')
          break
        case 'workspace':
          setProjectModalOpen(true)
          break
      }
    }
    window.addEventListener('forge:slash-command', handler)
    return () => window.removeEventListener('forge:slash-command', handler)
  }, [])

  // Listen for session reload events (after compact)
  useEffect(() => {
    const handler = (e: Event) => {
      const { sessionId } = (e as CustomEvent).detail || {}
      if (sessionId && sessionId === activeSessionId) {
        loadMessages(sessionId)
      }
    }
    window.addEventListener('forge:session-reload', handler)
    return () => window.removeEventListener('forge:session-reload', handler)
  }, [activeSessionId, loadMessages])

  const handleRenameSession = useCallback(async (id: string, title: string) => {
    await updateSession(id, { title })
  }, [updateSession])

  const handleDeleteSession = useCallback(async (id: string) => {
    await deleteSession(id)
    if (activeSessionId === id) {
      setActiveSessionId(null)
    }
  }, [deleteSession, activeSessionId])

  // Per-provider thinking mode default from settings (normalizes legacy values)
  const providerThinkingDefault = useMemo(() => {
    const session = sessions.find(s => s.id === activeSessionId)
    const model = session?.model || settings.default_model || 'claude-sonnet-4-6'
    const providerType = MODEL_PROVIDER_MAP[model] || 'anthropic'
    const raw = settings[`thinking_mode_${providerType}`] || settings.thinking_mode || 'auto'
    const legacy: Record<string, string> = { adaptive: 'auto', enabled: 'max', disabled: 'off' }
    return legacy[raw] || raw
  }, [sessions, activeSessionId, settings])

  const handleSendMessage = useCallback(async (content: string, _permissionMode?: string, _thinkingMode?: string, attachments?: Array<{ name: string; filename: string; mimeType: string; tier: string }>) => {
    const effectivePermMode = sessionPermMode || settings.desktop_permission_mode || 'confirm'
    const effectiveThinkMode = sessionThinkMode || providerThinkingDefault
    await sendMessage(content, effectivePermMode, effectiveThinkMode, attachments)
    refreshSessions()
  }, [sendMessage, refreshSessions, sessionPermMode, sessionThinkMode, settings.desktop_permission_mode, providerThinkingDefault])

  const handleUpdateSessionModel = useCallback(async (model: string) => {
    if (!activeSessionId) return
    await updateSession(activeSessionId, { model })
  }, [updateSession, activeSessionId])

  // Slash command: rename current session from chat input
  const handleRenameFromChat = useCallback(async (title: string) => {
    if (!activeSessionId) return
    await updateSession(activeSessionId, { title })
    refreshSessions()
  }, [updateSession, activeSessionId, refreshSessions])

  // Slash command: clear current session messages
  const handleClearSession = useCallback(async () => {
    if (!activeSessionId) return
    await fetch(`/api/sessions/${activeSessionId}/clear`, { method: 'POST' })
    clearMessages()
  }, [activeSessionId, clearMessages])

  const handlePermissionModeChange = useCallback((mode: string) => {
    // Per-session override — does NOT change global Settings
    setSessionPermMode(mode)
  }, [])

  const handleThinkingModeChange = useCallback((mode: string) => {
    // Per-session override — does NOT change global Settings
    setSessionThinkMode(mode)
  }, [])

  const handleSwitchWorkspace = useCallback((wsId: string) => {
    setActiveWorkspaceId(wsId)
    setActiveSessionId(null)
    setEditingFile(null)
    touchWorkspace(wsId)
  }, [touchWorkspace])

  const handleOpenProjectFolder = useCallback(async () => {
    const folderPath = await window.electronAPI?.openDirectoryDialog()
    if (!folderPath) return

    const ws = await openProjectFolder(folderPath)
    setActiveWorkspaceId(ws.id)
    setActiveSessionId(null)
    setEditingFile(null)
  }, [openProjectFolder])

  const handleRemoveProject = useCallback(async (id: string) => {
    await removeProject(id)
    if (activeWorkspaceId === id) {
      // Switch to first remaining workspace when the active one is removed
      const remaining = workspaces.find(w => w.id !== id)
      setActiveWorkspaceId(remaining?.id || null)
      setActiveSessionId(null)
      setEditingFile(null)
    }
  }, [removeProject, activeWorkspaceId])

  // Refs to track current panel widths (avoids stale closures in resize handlers)
  const leftWidthRef = useRef(leftWidth)
  const rightWidthRef = useRef(rightWidth)
  const leftCollapsedRef = useRef(leftCollapsed)
  const rightCollapsedRef = useRef(rightCollapsed)
  useEffect(() => { leftWidthRef.current = leftWidth }, [leftWidth])
  useEffect(() => { rightWidthRef.current = rightWidth }, [rightWidth])
  useEffect(() => { leftCollapsedRef.current = leftCollapsed }, [leftCollapsed])
  useEffect(() => { rightCollapsedRef.current = rightCollapsed }, [rightCollapsed])

  // Panel resize handlers — dynamic max ensures chat area keeps ≥360px
  const handleLeftResize = useCallback((delta: number) => {
    setLeftWidth(w => {
      const rw = rightCollapsedRef.current ? 36 : (showRightSidebar ? rightWidthRef.current : 0)
      const maxLeft = window.innerWidth - rw - 360 - 12
      return Math.max(180, Math.min(maxLeft, w + delta))
    })
  }, [showRightSidebar])
  const handleRightResize = useCallback((delta: number) => {
    setRightWidth(w => {
      const lw = leftCollapsedRef.current ? 52 : leftWidthRef.current
      const maxRight = window.innerWidth - lw - 360 - 12
      return Math.max(200, Math.min(maxRight, w - delta))
    })
  }, [])
  const handleEditorResize = useCallback((delta: number) => {
    setEditorWidth(w => Math.max(320, Math.min(window.innerWidth * 0.6, w - delta)))
  }, [])

  // Open a file in the inline editor (full tree path, e.g. ".claude/CLAUDE.md" or "README.md")
  const handleOpenFile = useCallback((filename: string) => {
    setEditingFile(prev => prev === filename ? null : filename)
  }, [])

  const handleCloseEditor = useCallback(() => {
    setEditorClosing(true)
    setTimeout(() => {
      setEditingFile(null)
      setEditorClosing(false)
    }, 200)
  }, [])

  const activeSession = sessions.find((s) => s.id === activeSessionId) || null

  // Wait for settings to load before deciding
  if (showOnboarding === null) {
    return <div className="flex items-center justify-center h-screen bg-page" />
  }

  if (showOnboarding) {
    return <Onboarding onComplete={(wsId) => {
      setShowOnboarding(false)
      if (wsId) setActiveWorkspaceId(wsId)
    }} />
  }

  // Show project selection page until user explicitly picks a workspace.
  // This runs on every launch (not just first time) — no auto-restore.
  if (!activeWorkspaceId) {
    return <ProjectSelection
      workspaces={workspaces}
      onSelectWorkspace={(id) => {
        setActiveWorkspaceId(id)
        touchWorkspace(id)
      }}
      onOpenFolder={async () => {
        const folderPath = await window.electronAPI?.openDirectoryDialog()
        if (!folderPath) return
        const ws = await openProjectFolder(folderPath)
        setActiveWorkspaceId(ws.id)
      }}
      onRemoveWorkspace={async (id) => {
        await removeProject(id)
        await refreshWorkspaces()
      }}
    />
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={fontVars}>
      <TitleBar />
      <div className="flex flex-1 overflow-hidden">
        <LeftSidebar
          activeView={activeView}
          onViewChange={setActiveView}
          collapsed={leftCollapsed}
          onToggleCollapse={() => setLeftCollapsed(!leftCollapsed)}
          sessions={filteredSessions}
          activeSessionId={activeSessionId}
          onSelectSession={handleSelectSession}
          onNewSession={handleNewSession}
          onDeleteSession={handleDeleteSession}
          onRenameSession={handleRenameSession}
          sessionsLoading={sessionsLoading}
          activeWorkspace={activeWorkspace}
          onOpenProjectModal={() => setProjectModalOpen(true)}
          width={leftWidth}
        />

        {!leftCollapsed && (
          <ResizeHandle direction="horizontal" onResize={handleLeftResize} />
        )}

        {/* Main content area — Chat (or other views) + optional editor panel */}
        <main className="flex-1 overflow-hidden bg-page flex min-w-[360px]">
          <div className="flex-1 shrink-0 overflow-hidden min-w-[360px]">
            <div key={activeView} className="h-full animate-fade-in">
              {activeView === 'chat' && (
                <ChatView
                  session={activeSession}
                  messages={messages}
                  streaming={streaming}
                  isThinking={isThinking}
                  error={error}
                  workspaceName={activeWorkspace?.name || ''}
                  workspaceId={activeWorkspaceId}
                  permissionMode={sessionPermMode || settings.desktop_permission_mode || 'confirm'}
                  thinkingMode={sessionThinkMode || providerThinkingDefault}
                  onSendMessage={handleSendMessage}
                  onStopStreaming={stopStreaming}
                  onNewSession={handleNewSession}
                  onPermissionDecision={sendPermissionDecision}
                  onModelChange={handleUpdateSessionModel}
                  onPermissionModeChange={handlePermissionModeChange}
                  onThinkingModeChange={handleThinkingModeChange}
                  onRenameSession={handleRenameFromChat}
                  onClearSession={handleClearSession}
                />
              )}
              {activeView === 'manage' && (
                <ManageView
                  workspaceId={GLOBAL_WORKSPACE_ID}
                  workspacePath="~/.claude"
                />
              )}
              {activeView === 'im' && <ImView />}
              {activeView === 'schedule' && <ScheduleView workspaceId={activeWorkspaceId || ''} />}
              {activeView === 'marketplace' && (
                <MarketplaceView
                  onUseTemplate={(workspaceId, sessionId) => {
                    setActiveWorkspaceId(workspaceId)
                    setActiveSessionId(sessionId)
                    setActiveView('chat')
                    refreshSessions()
                    refreshWorkspaces()
                  }}
                />
              )}
              {activeView === 'settings' && <SettingsView />}
            </div>
          </div>

          {/* Inline file editor panel — slides out between main and right sidebar */}
          {editingFile && activeView === 'chat' && activeWorkspaceId && (
            <>
              {!editorClosing && <ResizeHandle direction="horizontal" onResize={handleEditorResize} />}
              <ForgeFileEditor
                filename={editingFile}
                workspaceId={activeWorkspaceId}
                workspacePath={activeWorkspace?.path || ''}
                onClose={handleCloseEditor}
                width={editorClosing ? 0 : editorWidth}
                closing={editorClosing}
              />
            </>
          )}
        </main>

        {showRightSidebar && (
          <>
            {!rightCollapsed && (
              <ResizeHandle direction="horizontal" onResize={handleRightResize} />
            )}
            <RightSidebar
              collapsed={rightCollapsed}
              onToggleCollapse={() => setRightCollapsed(!rightCollapsed)}
              workspaceId={activeWorkspaceId || undefined}
              workspaceName={activeWorkspace?.name || ''}
              workspacePath={activeWorkspace?.path || ''}
              onOpenFile={handleOpenFile}
              activeFile={editingFile}
              width={rightWidth}
            />
          </>
        )}
      </div>

      <ProjectModal
        isOpen={projectModalOpen}
        onClose={() => setProjectModalOpen(false)}
        workspaces={workspaces}
        activeWorkspace={activeWorkspace}
        sessions={sessions}
        onSwitchWorkspace={handleSwitchWorkspace}
        onOpenProjectFolder={handleOpenProjectFolder}
        onRemoveProject={handleRemoveProject}
        onRefresh={refreshWorkspaces}
      />
    </div>
  )
}
