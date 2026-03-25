import { NextResponse } from 'next/server'
import { isClaudeCliAuthenticated, getClaudeCliAccountInfo } from '@/lib/provider'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'

/**
 * Check if claude CLI binary is installed (separate from authentication).
 */
function isClaudeCliInstalled(): boolean {
  const home = os.homedir()
  const candidates = [
    path.join(home, '.local', 'bin', 'claude'),
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
    path.join(home, '.npm-global', 'bin', 'claude'),
    path.join(home, '.claude', 'bin', 'claude'),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return true
  }
  // Also check via which (for PATH-based installs)
  try {
    const result = execFileSync('which', ['claude'], { timeout: 3000, stdio: 'pipe', encoding: 'utf-8' })
    if (result.trim()) return true
  } catch { /* not in PATH */ }
  return false
}

export async function GET() {
  const installed = isClaudeCliInstalled()
  const authenticated = installed ? isClaudeCliAuthenticated() : false
  const account = authenticated ? getClaudeCliAccountInfo() : null
  return NextResponse.json({ installed, authenticated, account })
}
