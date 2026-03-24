import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { getWorkspacePath, initializeWorkspaceDir } from '@/lib/workspace-fs'

/**
 * Resolve the path to init templates.
 * - Production (Electron): process.env.FORGE_RESOURCES_PATH/templates/init/
 * - Dev mode: process.cwd()/templates/init/
 */
function getInitTemplatesDir(): string {
  const base = process.env.FORGE_RESOURCES_PATH || process.cwd()
  return path.join(base, 'templates', 'init')
}

/**
 * Read all .md template files from the init templates directory.
 * Returns a record of filename → content.
 */
function readInitTemplates(): Record<string, string> {
  const dir = getInitTemplatesDir()
  const templates: Record<string, string> = {}

  if (!fs.existsSync(dir)) return templates

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'))
  for (const file of files) {
    try {
      templates[file] = fs.readFileSync(path.join(dir, file), 'utf-8')
    } catch { /* skip unreadable files */ }
  }

  return templates
}

/**
 * POST /api/workspaces/:id/init — Scaffold default .claude/ files for a workspace
 * and return init template content for the Agent to use.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  try {
    const forgePath = getWorkspacePath(id)
    const existed = fs.existsSync(forgePath)

    // Snapshot existing files before init
    const existingFiles = existed
      ? new Set(fs.readdirSync(forgePath).filter(f => f.endsWith('.md')))
      : new Set<string>()

    // Run full initialization (creates dirs + default stub files if missing)
    initializeWorkspaceDir(id)

    // Determine which files were newly created
    const allFiles = fs.readdirSync(forgePath).filter(f => f.endsWith('.md'))
    const created = allFiles.filter(f => !existingFiles.has(f))
    const skipped = allFiles.filter(f => existingFiles.has(f))

    // Read init templates to include in response
    const templates = readInitTemplates()

    return NextResponse.json({
      ok: true,
      created,
      skipped,
      templates,
      message: created.length > 0
        ? `Created ${created.length} file(s): ${created.join(', ')}`
        : 'All config files already exist.',
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to initialize workspace'
    return NextResponse.json({ ok: false, message: msg }, { status: 500 })
  }
}
