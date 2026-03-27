/**
 * Slash command definitions and registry for Forge chat input.
 */

export type CommandCategory = 'built-in' | 'skill' | 'agent' | 'mcp'

export interface SlashCommand {
  /** Command name without the leading `/` */
  name: string
  /** i18n key for the description, or a literal string for dynamic commands */
  description: string
  /** Category for grouping in the menu */
  category: CommandCategory
  /** Whether the command accepts an argument (e.g. /rename <title>) */
  hasArg?: boolean
  /** i18n key for the argument placeholder */
  argPlaceholder?: string
}

/** Built-in commands that Forge provides out of the box.
 *  Descriptions are i18n keys — resolve with t() at render time. */
export const BUILT_IN_COMMANDS: SlashCommand[] = [
  { name: 'clear', description: 'cmd.clear', category: 'built-in' },
  { name: 'compact', description: 'cmd.compact', category: 'built-in' },
  { name: 'cost', description: 'cmd.cost', category: 'built-in' },
  { name: 'diff', description: 'cmd.diff', category: 'built-in' },
  { name: 'export', description: 'cmd.export', category: 'built-in' },
  { name: 'init', description: 'cmd.init', category: 'built-in' },
  { name: 'memory', description: 'cmd.memory', category: 'built-in' },
  { name: 'model', description: 'cmd.model', category: 'built-in', hasArg: true, argPlaceholder: 'cmd.modelArg' },
  { name: 'rename', description: 'cmd.rename', category: 'built-in', hasArg: true, argPlaceholder: 'cmd.renameArg' },
  { name: 'save-as-template', description: 'cmd.saveAsTemplate', category: 'built-in', hasArg: true, argPlaceholder: 'cmd.templateArg' },
  { name: 'stop', description: 'cmd.stop', category: 'built-in' },
  { name: 'workspace', description: 'cmd.workspace', category: 'built-in' },
]

/**
 * Filter commands by a query string (the part after `/`).
 * No limit — autocomplete is the sole discovery mechanism (no /help).
 * Scroll handles overflow.
 */
export function filterCommands(commands: SlashCommand[], query: string): SlashCommand[] {
  const q = query.toLowerCase()
  const matched = commands.filter((cmd) => cmd.name.toLowerCase().startsWith(q))

  // Sort by category priority: built-in → skill → agent → mcp, then alphabetically
  const categoryOrder: Record<CommandCategory, number> = {
    'built-in': 0,
    skill: 1,
    agent: 2,
    mcp: 3,
  }
  matched.sort((a, b) => {
    const catDiff = categoryOrder[a.category] - categoryOrder[b.category]
    if (catDiff !== 0) return catDiff
    return a.name.localeCompare(b.name)
  })

  return matched
}

/** Category display labels — i18n keys */
export const CATEGORY_LABELS: Record<CommandCategory, string> = {
  'built-in': 'cmd.catBuiltIn',
  skill: 'cmd.catSkill',
  agent: 'cmd.catAgent',
  mcp: 'cmd.catMcp',
}
