'use client'

import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { CATEGORY_LABELS, type SlashCommand, type CommandCategory } from '@/lib/slash-commands'
import { useI18n } from '@/components/providers/i18n-provider'
import { Zap, Bot, Plug, Terminal } from 'lucide-react'

interface SlashCommandMenuProps {
  commands: SlashCommand[]
  selectedIndex: number
  onSelect: (cmd: SlashCommand) => void
}

const CATEGORY_ICONS: Record<CommandCategory, React.ElementType> = {
  'built-in': Terminal,
  skill: Zap,
  agent: Bot,
  mcp: Plug,
}

export function SlashCommandMenu({ commands, selectedIndex, onSelect }: SlashCommandMenuProps) {
  const { t } = useI18n()
  const listRef = useRef<HTMLDivElement>(null)
  const selectedRef = useRef<HTMLButtonElement>(null)

  // Scroll selected item into view
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  if (commands.length === 0) return null

  // Group commands by category for display
  let lastCategory: CommandCategory | null = null

  return (
    <div
      ref={listRef}
      className="absolute left-0 right-0 bottom-full mb-1 bg-surface border border-subtle rounded-xl shadow-lg z-50 max-h-[400px] overflow-y-auto animate-slide-down"
    >
      <div className="p-1">
        {commands.map((cmd, i) => {
          const showHeader = cmd.category !== lastCategory
          lastCategory = cmd.category
          const Icon = CATEGORY_ICONS[cmd.category]

          return (
            <div key={`${cmd.category}-${cmd.name}`}>
              {showHeader && (
                <div className="px-3 pt-2 pb-1">
                  <span className="text-[10px] font-semibold text-muted tracking-wide uppercase">
                    {t(CATEGORY_LABELS[cmd.category])}
                  </span>
                </div>
              )}
              <button
                ref={i === selectedIndex ? selectedRef : undefined}
                onClick={() => onSelect(cmd)}
                className={cn(
                  'flex items-center gap-2.5 w-full px-3 h-8 rounded-lg transition-colors text-left',
                  i === selectedIndex ? 'bg-elevated' : 'hover:bg-surface-hover'
                )}
              >
                <Icon size={14} className={cn(i === selectedIndex ? 'text-indigo' : 'text-tertiary')} />
                <span className={cn('text-[12px] font-semibold', i === selectedIndex ? 'text-primary' : 'text-secondary')}>
                  /{cmd.name}
                </span>
                <span className="text-[11px] text-muted flex-1 truncate">
                  {t(cmd.description)}
                </span>
                {cmd.hasArg && cmd.argPlaceholder && (
                  <span className="text-[10px] text-muted italic shrink-0">
                    {t(cmd.argPlaceholder)}
                  </span>
                )}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
