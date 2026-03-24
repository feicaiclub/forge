import fs from 'fs'
import path from 'path'
import os from 'os'

/** Virtual workspace ID for the global ~/.claude/ main agent */
export const GLOBAL_WORKSPACE_ID = '__global__'

/** Path to the global ~/.claude/ directory */
export const GLOBAL_CLAUDE_PATH = path.join(os.homedir(), '.claude')

// Core files every workspace gets on creation
const WORKSPACE_FILES: Record<string, string> = {
  'CLAUDE.md': '# Instructions\n\nYou are a helpful AI coding assistant. Be concise, precise, and helpful.\n',
  'SOUL.md': '# Soul\n\nPersonality and communication style for this workspace.\n',
  'IDENTITY.md': '# Identity\n\nAgent identity and role definition.\n',
  'USER.md': '# User Profile\n\nUser preferences and context.\n',
  'MEMORY.md': '# Long-term Memory\n\nPersistent facts and learnings across sessions.\n',
  'HEARTBEAT.md': `# Heartbeat Checklist

This checklist is executed periodically by the Heartbeat agent.
Each item will be checked and the results summarized.

## Checks

- [ ] Check GitHub issues and PRs for new activity
- [ ] Verify CI/CD pipeline status
- [ ] Review recent error logs
- [ ] Check disk space and system health
`,
}

const WORKSPACE_DIRS = ['memory', 'skills', 'agents', 'rules']

/**
 * Get the project folder path for a workspace by querying the DB.
 * For the global workspace, returns the home directory.
 */
export function getProjectPath(workspaceId: string): string {
  if (workspaceId === GLOBAL_WORKSPACE_ID) {
    return os.homedir()
  }
  // Lazy import to avoid circular dependency (db.ts imports workspace-fs)
  const { getDb } = require('@/lib/db')
  const db = getDb()
  const row = db.prepare('SELECT path FROM workspaces WHERE id = ?').get(workspaceId) as { path: string } | undefined
  if (!row) throw new Error(`Workspace not found: ${workspaceId}`)
  return row.path
}

/**
 * Get the .claude/ config directory path for a workspace.
 * For the global workspace, returns ~/.claude/
 */
export function getWorkspacePath(workspaceId: string): string {
  if (workspaceId === GLOBAL_WORKSPACE_ID) {
    return GLOBAL_CLAUDE_PATH
  }
  return path.join(getProjectPath(workspaceId), '.claude')
}

/**
 * Ensure the global ~/.claude/ directory exists with default structure.
 */
export function ensureGlobalClaudeDir(): void {
  // GLOBAL_CLAUDE_PATH is already ~/.claude, so pass the parent (homedir)
  initializeWorkspaceDir(os.homedir(), true)
}

/**
 * Discover .md config files in the root of a .claude/ directory.
 * Returns sorted filenames (not hardcoded — user can create/delete freely).
 */
export function discoverForgeConfigFiles(workspaceId: string): string[] {
  const forgePath = getWorkspacePath(workspaceId)
  if (!fs.existsSync(forgePath)) return []

  return fs.readdirSync(forgePath)
    .filter(f => f.endsWith('.md') && fs.statSync(path.join(forgePath, f)).isFile())
    .sort((a, b) => a.localeCompare(b))
}

/**
 * Create a new file inside .claude/ (or its subdirectories).
 */
export function createForgeFile(workspaceId: string, relativePath: string, content = ''): void {
  if (relativePath.includes('..')) throw new Error('Invalid path')
  const forgePath = getWorkspacePath(workspaceId)
  const fullPath = path.join(forgePath, relativePath)
  const dir = path.dirname(fullPath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  if (fs.existsSync(fullPath)) throw new Error('File already exists')
  fs.writeFileSync(fullPath, content, 'utf-8')
}

/**
 * Create a new folder inside .claude/ (or its subdirectories).
 */
export function createForgeFolder(workspaceId: string, relativePath: string): void {
  if (relativePath.includes('..')) throw new Error('Invalid path')
  const forgePath = getWorkspacePath(workspaceId)
  const fullPath = path.join(forgePath, relativePath)
  if (fs.existsSync(fullPath)) throw new Error('Folder already exists')
  fs.mkdirSync(fullPath, { recursive: true })
}

/**
 * Rename a file or folder inside .claude/.
 */
export function renameForgeEntry(workspaceId: string, oldRelPath: string, newRelPath: string): void {
  if (oldRelPath.includes('..') || newRelPath.includes('..')) throw new Error('Invalid path')
  const forgePath = getWorkspacePath(workspaceId)
  const oldFull = path.join(forgePath, oldRelPath)
  const newFull = path.join(forgePath, newRelPath)
  if (!fs.existsSync(oldFull)) throw new Error('Source not found')
  if (fs.existsSync(newFull)) throw new Error('Target already exists')
  const dir = path.dirname(newFull)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.renameSync(oldFull, newFull)
}

/**
 * Delete a file or folder inside .claude/.
 */
export function deleteForgeEntry(workspaceId: string, relativePath: string): void {
  if (relativePath.includes('..')) throw new Error('Invalid path')
  const forgePath = getWorkspacePath(workspaceId)
  const fullPath = path.join(forgePath, relativePath)
  if (!fs.existsSync(fullPath)) return
  const stat = fs.statSync(fullPath)
  if (stat.isDirectory()) {
    fs.rmSync(fullPath, { recursive: true, force: true })
  } else {
    fs.unlinkSync(fullPath)
  }
}

// ── Project-level file operations (relative to project root) ──

/**
 * Create a new file relative to the project root directory.
 */
export function createProjectFile(workspaceId: string, relativePath: string, content = ''): void {
  if (relativePath.includes('..')) throw new Error('Invalid path')
  const projectPath = getProjectPath(workspaceId)
  const fullPath = path.join(projectPath, relativePath)
  const dir = path.dirname(fullPath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  if (fs.existsSync(fullPath)) throw new Error('File already exists')
  fs.writeFileSync(fullPath, content, 'utf-8')
}

/**
 * Create a new folder relative to the project root directory.
 */
export function createProjectFolder(workspaceId: string, relativePath: string): void {
  if (relativePath.includes('..')) throw new Error('Invalid path')
  const projectPath = getProjectPath(workspaceId)
  const fullPath = path.join(projectPath, relativePath)
  if (fs.existsSync(fullPath)) throw new Error('Folder already exists')
  fs.mkdirSync(fullPath, { recursive: true })
}

/**
 * Rename a file or folder relative to the project root directory.
 */
export function renameProjectEntry(workspaceId: string, oldRelPath: string, newRelPath: string): void {
  if (oldRelPath.includes('..') || newRelPath.includes('..')) throw new Error('Invalid path')
  const projectPath = getProjectPath(workspaceId)
  const oldFull = path.join(projectPath, oldRelPath)
  const newFull = path.join(projectPath, newRelPath)
  if (!fs.existsSync(oldFull)) throw new Error('Source not found')
  if (fs.existsSync(newFull)) throw new Error('Target already exists')
  const dir = path.dirname(newFull)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.renameSync(oldFull, newFull)
}

/**
 * Delete a file or folder relative to the project root directory.
 */
export function deleteProjectEntry(workspaceId: string, relativePath: string): void {
  if (relativePath.includes('..')) throw new Error('Invalid path')
  const projectPath = getProjectPath(workspaceId)
  const fullPath = path.join(projectPath, relativePath)
  if (!fs.existsSync(fullPath)) return
  const stat = fs.statSync(fullPath)
  if (stat.isDirectory()) {
    fs.rmSync(fullPath, { recursive: true, force: true })
  } else {
    fs.unlinkSync(fullPath)
  }
}

/**
 * Initialize .claude/ directory with default files and subdirectories.
 * Can also accept a direct project path (for initial creation before DB entry exists).
 */
/**
 * Lightweight: ensure .claude/ directory exists (no file creation or migration).
 * Safe to call repeatedly (e.g. on every tree fetch) without re-creating user-deleted files.
 */
export function ensureWorkspaceDir(workspaceIdOrPath: string, isDirectPath = false): void {
  const forgePath = isDirectPath
    ? path.join(workspaceIdOrPath, '.claude')
    : getWorkspacePath(workspaceIdOrPath)

  if (!fs.existsSync(forgePath)) {
    fs.mkdirSync(forgePath, { recursive: true })
  }

  // Ensure all standard subdirectories exist (handles upgrades when new dirs are added)
  for (const dir of WORKSPACE_DIRS) {
    const dirPath = path.join(forgePath, dir)
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true })
    }
  }
}

/**
 * Full initialization: create .claude/ with default files, subdirectories, and run migrations.
 * Only call this once when a workspace is first created (not on every read operation).
 */
export function initializeWorkspaceDir(workspaceIdOrPath: string, isDirectPath = false): void {
  const forgePath = isDirectPath
    ? path.join(workspaceIdOrPath, '.claude')
    : getWorkspacePath(workspaceIdOrPath)

  if (!fs.existsSync(forgePath)) {
    fs.mkdirSync(forgePath, { recursive: true })
  }

  // Create subdirectories
  for (const dir of WORKSPACE_DIRS) {
    const dirPath = path.join(forgePath, dir)
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true })
    }
  }

  // Migration: rename legacy AGENT.md → CLAUDE.md if needed
  const legacyAgent = path.join(forgePath, 'AGENT.md')
  const claudeMd = path.join(forgePath, 'CLAUDE.md')
  if (fs.existsSync(legacyAgent) && !fs.existsSync(claudeMd)) {
    fs.renameSync(legacyAgent, claudeMd)
  }

  // Migration: copy files from legacy .forge/ directory (if it exists alongside .claude/)
  const parentDir = path.dirname(forgePath)
  const legacyForge = path.join(parentDir, '.forge')
  if (fs.existsSync(legacyForge) && legacyForge !== forgePath) {
    // Copy .md config files (skip AGENT.md — handled above; skip non-.md files like forge.db)
    try {
      const legacyFiles = fs.readdirSync(legacyForge)
        .filter(f => f.endsWith('.md') && f !== 'AGENT.md' && fs.statSync(path.join(legacyForge, f)).isFile())
      for (const file of legacyFiles) {
        const target = path.join(forgePath, file)
        if (!fs.existsSync(target)) {
          fs.copyFileSync(path.join(legacyForge, file), target)
        }
      }
      // Copy subdirectory contents (agents/, skills/, memory/)
      for (const dir of WORKSPACE_DIRS) {
        const legacyDir = path.join(legacyForge, dir)
        if (!fs.existsSync(legacyDir)) continue
        const targetDir = path.join(forgePath, dir)
        if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true })
        const entries = fs.readdirSync(legacyDir)
        for (const entry of entries) {
          const src = path.join(legacyDir, entry)
          const dest = path.join(targetDir, entry)
          if (!fs.existsSync(dest) && fs.statSync(src).isFile()) {
            fs.copyFileSync(src, dest)
          }
        }
      }
    } catch { /* ignore migration errors — defaults will be created below */ }
  }

  // Create default files (only if they don't already exist)
  for (const [filename, defaultContent] of Object.entries(WORKSPACE_FILES)) {
    const filePath = path.join(forgePath, filename)
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, defaultContent, 'utf-8')
    }
  }
}

/**
 * Delete the .claude/ directory for a workspace.
 * Does NOT delete the project folder itself.
 */
export function deleteWorkspaceDir(workspaceId: string): void {
  try {
    const forgePath = getWorkspacePath(workspaceId)
    if (fs.existsSync(forgePath)) {
      fs.rmSync(forgePath, { recursive: true, force: true })
    }
  } catch {
    // Workspace may no longer exist in DB after deletion
  }
}

export function readWorkspaceFile(workspaceId: string, filename: string): string | null {
  const basePath = getWorkspacePath(workspaceId)
  const filePath = path.resolve(basePath, filename)
  // Guard against path traversal (e.g. ../../etc/passwd)
  if (!filePath.startsWith(basePath + path.sep) && filePath !== basePath) return null
  if (!fs.existsSync(filePath)) return null
  return fs.readFileSync(filePath, 'utf-8')
}

export function writeWorkspaceFile(workspaceId: string, filename: string, content: string): void {
  const forgePath = getWorkspacePath(workspaceId)
  if (!fs.existsSync(forgePath)) {
    ensureWorkspaceDir(workspaceId)
  }
  const filePath = path.join(forgePath, filename)
  // Ensure parent directory exists (for nested paths like memory/2024-01-01.md)
  const parentDir = path.dirname(filePath)
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true })
  }
  fs.writeFileSync(filePath, content, 'utf-8')
}

/**
 * Load workspace context files for the system prompt.
 * Dynamically reads ALL .md files in .claude/ root (not hardcoded).
 * Files are loaded in alphabetical order. MEMORY.md is excluded here
 * (loaded separately via loadMemoryContext with group-chat safety rules).
 */
export function loadWorkspaceContext(workspaceId: string): string {
  ensureWorkspaceDir(workspaceId)

  const sections: string[] = []
  const configFiles = discoverForgeConfigFiles(workspaceId)

  for (const filename of configFiles) {
    // CLAUDE.md is loaded natively by the SDK via settingSources: ['project'] — skip to avoid duplication
    // MEMORY.md is handled separately by loadMemoryContext (not injected in group chats)
    if (filename === 'CLAUDE.md' || filename === 'MEMORY.md') continue

    const content = readWorkspaceFile(workspaceId, filename)
    if (content && content.trim()) {
      // Use filename without extension as label
      const label = filename.replace(/\.md$/i, '')
      sections.push(`<${label}>\n${content.trim()}\n</${label}>`)
    }
  }

  return sections.join('\n\n')
}

/**
 * Load memory context: MEMORY.md (first 200 lines only) + recent daily memories (last 2 days).
 *
 * Topic files in memory/ (e.g. debugging.md, api-conventions.md) are NOT loaded at startup.
 * Agent reads them on demand via file tools. MEMORY.md serves as an index pointing to topic files.
 */
export function loadMemoryContext(workspaceId: string): string {
  ensureWorkspaceDir(workspaceId)

  const sections: string[] = []

  // MEMORY.md — first 200 lines only (aligned with Claude Code auto memory)
  const memory = readWorkspaceFile(workspaceId, 'MEMORY.md')
  if (memory && memory.trim()) {
    const lines = memory.split('\n')
    const truncated = lines.length > 200
    const loadedContent = truncated ? lines.slice(0, 200).join('\n') : memory
    let memorySection = `<Long-term Memory>\n${loadedContent.trim()}\n</Long-term Memory>`
    if (truncated) {
      memorySection += `\n\n⚠️ MEMORY.md has ${lines.length} lines — only the first 200 lines are loaded. Move detailed content to topic files in .claude/memory/ and keep MEMORY.md as a concise index.`
    }
    sections.push(memorySection)
  }

  // Topic files in memory/ are NOT loaded here — Agent reads them on demand.
  // Only list their names so Agent knows what's available.
  const memoryDir = path.join(getWorkspacePath(workspaceId), 'memory')
  if (fs.existsSync(memoryDir)) {
    const topicFiles = fs.readdirSync(memoryDir)
      .filter(f => f.endsWith('.md') && !f.match(/^\d{4}-\d{2}-\d{2}\.md$/) && f !== 'archive.md')
      .sort()
    if (topicFiles.length > 0) {
      const listing = topicFiles.map(f => `- memory/${f}`).join('\n')
      sections.push(`<Available Memory Topics (read on demand with file tools)>\n${listing}\n</Available Memory Topics>`)
    }
  }

  // Recent daily memories (last 2 days)
  const today = new Date()
  for (let i = 0; i < 2; i++) {
    const date = formatDate(new Date(today.getTime() - i * 86400000))
    const daily = readWorkspaceFile(workspaceId, `memory/${date}.md`)
    if (daily && daily.trim()) {
      sections.push(`<Daily Memory ${date}>\n${daily.trim()}\n</Daily Memory>`)
    }
  }

  return sections.join('\n\n')
}

/**
 * Load rules from .claude/rules/*.md.
 * Rules without YAML frontmatter `paths` field are loaded unconditionally.
 * Rules with `paths` are listed but not loaded (future: conditional loading when Agent works with matching files).
 */
export function loadRulesContext(workspaceId: string): string {
  const rulesDir = path.join(getWorkspacePath(workspaceId), 'rules')
  if (!fs.existsSync(rulesDir)) return ''

  const sections: string[] = []
  const conditionalRules: string[] = []

  // Recursively find all .md files in rules/
  const findMdFiles = (dir: string, prefix = ''): string[] => {
    const result: string[] = []
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const relPath = prefix ? `${prefix}/${entry.name}` : entry.name
        if (entry.isDirectory()) {
          result.push(...findMdFiles(path.join(dir, entry.name), relPath))
        } else if (entry.name.endsWith('.md')) {
          result.push(relPath)
        }
      }
    } catch { /* ignore read errors */ }
    return result
  }

  const ruleFiles = findMdFiles(rulesDir)

  for (const file of ruleFiles) {
    const content = fs.readFileSync(path.join(rulesDir, file), 'utf-8')
    if (!content.trim()) continue

    // Check for YAML frontmatter with paths field
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
    if (frontmatterMatch) {
      const frontmatter = frontmatterMatch[1]
      const body = frontmatterMatch[2]
      if (frontmatter.includes('paths:')) {
        // Conditional rule — list but don't load
        conditionalRules.push(`- rules/${file} (path-scoped)`)
        continue
      }
      // No paths — load the body (strip frontmatter)
      const label = file.replace(/\.md$/i, '').replace(/\//g, '-')
      sections.push(`<Rule: ${label}>\n${body.trim()}\n</Rule>`)
    } else {
      // No frontmatter — load unconditionally
      const label = file.replace(/\.md$/i, '').replace(/\//g, '-')
      sections.push(`<Rule: ${label}>\n${content.trim()}\n</Rule>`)
    }
  }

  if (conditionalRules.length > 0) {
    sections.push(`<Path-scoped Rules (loaded on demand)>\n${conditionalRules.join('\n')}\n</Path-scoped Rules>`)
  }

  return sections.join('\n\n')
}

/**
 * Archive daily memory files older than retentionDays.
 * Appends a summary line to memory/archive.md and deletes the old file.
 */
export function archiveOldMemories(workspaceId: string, retentionDays: number = 7): number {
  const memoryDir = path.join(getWorkspacePath(workspaceId), 'memory')
  if (!fs.existsSync(memoryDir)) return 0

  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - retentionDays)
  const cutoffStr = formatDate(cutoff)

  const entries = fs.readdirSync(memoryDir)
  const archivePath = path.join(memoryDir, 'archive.md')
  let archived = 0

  for (const entry of entries) {
    if (entry === 'archive.md') continue
    const match = entry.match(/^(\d{4}-\d{2}-\d{2})\.md$/)
    if (!match) continue

    const fileDate = match[1]
    if (fileDate >= cutoffStr) continue

    // Read content, extract first few lines as summary
    const filePath = path.join(memoryDir, entry)
    const content = fs.readFileSync(filePath, 'utf-8')
    const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('#'))
    const summary = lines.slice(0, 5).join(' | ')

    // Append to archive
    const archiveEntry = `\n## ${fileDate}\n${summary || '(empty)'}\n`
    if (fs.existsSync(archivePath)) {
      fs.appendFileSync(archivePath, archiveEntry, 'utf-8')
    } else {
      fs.writeFileSync(archivePath, `# Memory Archive\n${archiveEntry}`, 'utf-8')
    }

    // Delete old file
    fs.unlinkSync(filePath)
    archived++
  }

  return archived
}

function formatDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
