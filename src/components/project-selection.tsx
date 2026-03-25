'use client'

import { useCallback } from 'react'
import { FolderOpen, Anvil, Clock, Folder, Trash2 } from 'lucide-react'
import { useI18n } from '@/components/providers/i18n-provider'
import type { Workspace } from '@/lib/types'

interface ProjectSelectionProps {
  workspaces: Workspace[]
  onSelectWorkspace: (id: string) => void
  onOpenFolder: () => void
  onRemoveWorkspace: (id: string) => void
}

/**
 * Full-screen project selection page — shown on every app launch.
 * Two states:
 * - With history: Recent projects list + Open Folder button
 * - Empty (first time): Welcome text + Open Project Folder button
 */
export function ProjectSelection({
  workspaces,
  onSelectWorkspace,
  onOpenFolder,
  onRemoveWorkspace,
}: ProjectSelectionProps) {
  const { t } = useI18n()

  const handleRemove = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    onRemoveWorkspace(id)
  }, [onRemoveWorkspace])

  const formatTimeAgo = useCallback((dateStr: string) => {
    const now = Date.now()
    const then = new Date(dateStr).getTime()
    const diff = now - then
    const minutes = Math.floor(diff / 60000)
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    if (days < 7) return `${days}d ago`
    return new Date(dateStr).toLocaleDateString()
  }, [])

  const hasProjects = workspaces.length > 0

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Title bar with window controls */}
      <div className="flex items-center h-[38px] px-4 bg-surface border-b border-subtle shrink-0" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <div className="flex gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <div className="w-3 h-3 rounded-full bg-[#E85A4F]" />
          <div className="w-3 h-3 rounded-full bg-[#FFB547]" />
          <div className="w-3 h-3 rounded-full bg-[#32D583]" />
        </div>
      </div>

      {/* Main content — centered card */}
      <div className="flex-1 flex items-center justify-center bg-page">
        {hasProjects ? (
          /* With history variant */
          <div className="w-[560px] bg-surface border border-subtle rounded-2xl p-10 flex flex-col gap-8">
            {/* Header */}
            <div className="flex flex-col items-center gap-2">
              <Anvil className="w-10 h-10 text-indigo" />
              <h1 className="text-[28px] font-bold text-primary font-heading tracking-tight">
                Open a Project
              </h1>
              <p className="text-[14px] text-secondary text-center max-w-[400px]">
                Select a recent project or open a new folder to get started.
              </p>
            </div>

            {/* Recent projects list */}
            <div className="flex flex-col gap-0.5">
              <span className="text-[12px] font-semibold text-tertiary tracking-wider mb-1">
                Recent Projects
              </span>
              {workspaces.map((ws) => (
                <button
                  key={ws.id}
                  className="flex items-center gap-3 w-full px-3 py-3 rounded-lg hover:bg-hover transition-colors text-left group"
                  onClick={() => onSelectWorkspace(ws.id)}
                >
                  <Folder className="w-5 h-5 text-indigo shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] font-semibold text-primary truncate">
                      {ws.name}
                    </div>
                    <div className="text-[11px] text-tertiary truncate">
                      {ws.path.replace(/^\/Users\/[^/]+/, '~')}
                    </div>
                  </div>
                  <span className="text-[11px] text-muted shrink-0 group-hover:hidden">
                    {formatTimeAgo(ws.lastOpenedAt || ws.createdAt)}
                  </span>
                  <button
                    className="hidden group-hover:flex items-center justify-center w-7 h-7 rounded hover:bg-active shrink-0"
                    onClick={(e) => handleRemove(e, ws.id)}
                    title="Remove from recent"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-muted" />
                  </button>
                </button>
              ))}
            </div>

            {/* Open Folder button */}
            <button
              className="flex items-center justify-center gap-2 w-full h-[42px] rounded-lg bg-indigo text-white font-semibold text-[14px] hover:opacity-90 transition-opacity"
              onClick={onOpenFolder}
            >
              <FolderOpen className="w-4 h-4" />
              Open Folder
            </button>
          </div>
        ) : (
          /* Empty / first time variant */
          <div className="w-[480px] bg-surface border border-subtle rounded-2xl p-12 flex flex-col items-center gap-8">
            {/* Header */}
            <div className="flex flex-col items-center gap-2">
              <Anvil className="w-12 h-12 text-indigo" />
              <h1 className="text-[28px] font-bold text-primary font-heading tracking-tight">
                Welcome to Forge
              </h1>
              <p className="text-[14px] text-secondary text-center max-w-[380px]">
                Open a project folder to start chatting with your AI agent.
              </p>
            </div>

            {/* Open Project Folder button */}
            <button
              className="flex items-center justify-center gap-2 w-full h-[44px] rounded-lg bg-indigo text-white font-semibold text-[15px] hover:opacity-90 transition-opacity"
              onClick={onOpenFolder}
            >
              <FolderOpen className="w-[18px] h-[18px]" />
              Open Project Folder
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
