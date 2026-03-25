import { NextResponse } from 'next/server'
import { execFile } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import os from 'os'
import path from 'path'

const execFileAsync = promisify(execFile)

/**
 * Find the claude CLI binary path.
 */
function findClaudeBinary(): string | null {
  const home = os.homedir()
  const candidates = [
    path.join(home, '.local', 'bin', 'claude'),
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
    path.join(home, '.npm-global', 'bin', 'claude'),
    path.join(home, '.claude', 'bin', 'claude'),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  // Fallback: which
  try {
    const { execFileSync } = require('child_process')
    const result = execFileSync('which', ['claude'], { timeout: 3000, stdio: 'pipe', encoding: 'utf-8' })
    if (result.trim()) return result.trim()
  } catch { /* not found */ }
  return null
}

/**
 * POST /api/api-providers/cli-login
 *
 * Spawns `claude login` to initiate OAuth flow.
 * The CLI opens a browser for the user to authenticate.
 * We poll ~/.claude.json to detect when auth completes.
 */
export async function POST() {
  const claudePath = findClaudeBinary()
  if (!claudePath) {
    return NextResponse.json(
      { ok: false, error: 'Claude CLI not found. Please install Claude Code CLI first.' },
      { status: 404 }
    )
  }

  try {
    // Spawn claude login — this opens the browser for OAuth
    // The process completes when the user authenticates in the browser
    // Timeout: 120 seconds (generous for browser auth flow)
    await execFileAsync(claudePath, ['login'], {
      timeout: 120_000,
      env: {
        ...process.env,
        HOME: os.homedir(),
      },
    })

    // Check if auth succeeded by reading ~/.claude.json
    const claudeJsonPath = path.join(os.homedir(), '.claude.json')
    if (fs.existsSync(claudeJsonPath)) {
      try {
        const content = JSON.parse(fs.readFileSync(claudeJsonPath, 'utf-8'))
        if (content.oauthAccount?.accountUuid) {
          return NextResponse.json({
            ok: true,
            account: {
              email: content.oauthAccount.emailAddress || '',
              displayName: content.oauthAccount.displayName || '',
            },
          })
        }
      } catch { /* parse error */ }
    }

    return NextResponse.json({ ok: false, error: 'Authentication did not complete. Please try again.' })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    if (msg.includes('timed out') || msg.includes('TIMEOUT')) {
      return NextResponse.json({ ok: false, error: 'Authentication timed out. Please try again.' })
    }
    return NextResponse.json({ ok: false, error: `Login failed: ${msg}` }, { status: 500 })
  }
}
