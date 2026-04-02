import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { isClaudeCliAuthenticated } from '@/lib/provider'

interface DbProvider {
  id: string
  api_key: string
  base_url: string
  provider: string
  protocol?: string
  model_name?: string
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = getDb()

  const provider = db.prepare('SELECT * FROM api_providers WHERE id = ?').get(id) as DbProvider | undefined
  if (!provider) return NextResponse.json({ error: 'Provider not found' }, { status: 404 })

  // For Anthropic: if no API key, check CLI auth
  if (!provider.api_key) {
    if (provider.provider === 'anthropic' && isClaudeCliAuthenticated()) {
      // CLI authenticated — test via SDK subprocess
      try {
        const ok = await testViaCliAuth()
        const status = ok ? 'cli_authenticated' : 'error'
        const errorMsg = ok ? '' : 'CLI authentication test failed'
        db.prepare("UPDATE api_providers SET status = ?, status_error = ?, updated_at = datetime('now') WHERE id = ?").run(status, errorMsg, id)
        const updated = db.prepare('SELECT * FROM api_providers WHERE id = ?').get(id)
        return NextResponse.json(updated)
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'CLI auth test failed'
        db.prepare("UPDATE api_providers SET status = 'error', status_error = ?, updated_at = datetime('now') WHERE id = ?").run(errorMsg, id)
        const updated = db.prepare('SELECT * FROM api_providers WHERE id = ?').get(id)
        return NextResponse.json(updated)
      }
    }

    db.prepare("UPDATE api_providers SET status = 'not_configured', status_error = '', updated_at = datetime('now') WHERE id = ?").run(id)
    const updated = db.prepare('SELECT * FROM api_providers WHERE id = ?').get(id)
    return NextResponse.json(updated)
  }

  try {
    let ok = false
    let errorMsg = ''

    if (provider.provider === 'anthropic') {
      const baseUrl = provider.base_url || 'https://api.anthropic.com'
      const res = await fetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': provider.api_key,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }],
        }),
        signal: AbortSignal.timeout(15000),
      })

      if (res.ok) {
        ok = true
      } else {
        const data = await res.json().catch(() => ({}))
        errorMsg = (data as { error?: { message?: string } }).error?.message || `HTTP ${res.status}`
      }
    } else if (provider.provider === 'zhipu') {
      // Zhipu GLM: OpenAI-compatible, uses /v4/ prefix
      const baseUrl = provider.base_url || 'https://open.bigmodel.cn/api/paas/v4'
      const url = baseUrl.replace(/\/+$/, '')
      const res = await fetch(`${url}/models`, {
        headers: { 'Authorization': `Bearer ${provider.api_key}` },
        signal: AbortSignal.timeout(15000),
      })
      if (res.ok) {
        ok = true
      } else {
        const data = await res.json().catch(() => ({}))
        errorMsg = (data as { error?: { message?: string } }).error?.message || `HTTP ${res.status}`
      }
    } else if (provider.provider === 'moonshot') {
      // Moonshot (Kimi): OpenAI-compatible, supports GET /v1/models
      const baseUrl = provider.base_url || 'https://api.moonshot.cn/v1'
      const url = baseUrl.replace(/\/+$/, '')
      const res = await fetch(`${url}/models`, {
        headers: { 'Authorization': `Bearer ${provider.api_key}` },
        signal: AbortSignal.timeout(15000),
      })
      if (res.ok) {
        ok = true
      } else {
        const data = await res.json().catch(() => ({}))
        errorMsg = (data as { error?: { message?: string } }).error?.message || `HTTP ${res.status}`
      }
    } else if (provider.provider === 'minimax') {
      // MiniMax: does NOT support /v1/models — send minimal chat request instead
      const baseUrl = provider.base_url || 'https://api.minimax.io/v1'
      const url = baseUrl.replace(/\/+$/, '')
      const res = await fetch(`${url}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${provider.api_key}`,
        },
        body: JSON.stringify({
          model: 'MiniMax-M2.7',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }],
        }),
        signal: AbortSignal.timeout(15000),
      })
      if (res.ok) {
        ok = true
      } else {
        const data = await res.json().catch(() => ({}))
        errorMsg = (data as { error?: { message?: string } }).error?.message
          || (data as { base_resp?: { status_msg?: string } }).base_resp?.status_msg
          || `HTTP ${res.status}`
      }
    } else if (provider.provider === 'qwen') {
      // Qwen (DashScope): OpenAI-compatible mode
      const baseUrl = provider.base_url || 'https://dashscope.aliyuncs.com/compatible-mode/v1'
      const url = baseUrl.replace(/\/+$/, '')
      const res = await fetch(`${url}/models`, {
        headers: { 'Authorization': `Bearer ${provider.api_key}` },
        signal: AbortSignal.timeout(15000),
      })
      if (res.ok) {
        ok = true
      } else {
        // Qwen /models may not work — fallback: try a minimal chat request
        const chatRes = await fetch(`${url}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${provider.api_key}`,
          },
          body: JSON.stringify({
            model: 'qwen-turbo',
            max_tokens: 1,
            messages: [{ role: 'user', content: 'hi' }],
          }),
          signal: AbortSignal.timeout(15000),
        })
        if (chatRes.ok) {
          ok = true
        } else {
          const data = await chatRes.json().catch(() => ({}))
          errorMsg = (data as { error?: { message?: string } }).error?.message || `HTTP ${chatRes.status}`
        }
      }
    } else if (provider.provider === 'bailian-codingplan') {
      // Bailian CodingPlan (DashScope): Anthropic-compatible mode
      const baseUrl = provider.base_url || 'https://coding.dashscope.aliyuncs.com/apps/anthropic'
      const url = baseUrl.replace(/\/+$/, '')
      const res = await fetch(`${url}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${provider.api_key}`,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'qwen3-coder-plus',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }],
        }),
        signal: AbortSignal.timeout(15000),
      })
      if (res.ok) {
        ok = true
      } else {
        const data = await res.json().catch(() => ({}))
        errorMsg = (data as { error?: { message?: string } }).error?.message || `HTTP ${res.status}`
      }
    } else if (provider.provider === 'custom') {
      // Custom providers support two explicit protocols:
      // - anthropic-compatible: tested via /v1/messages
      // - openai-compatible: tested via /chat/completions
      const baseUrl = (provider.base_url || '').replace(/\/+$/, '')
      const protocol = provider.protocol || 'anthropic-compatible'
      const modelName = provider.model_name || 'test-model'
      if (protocol === 'anthropic-compatible') {
        const url = baseUrl.includes('/v1/messages') ? baseUrl : `${baseUrl.replace(/\/v1$/, '')}/v1/messages`
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${provider.api_key}`,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: modelName,
            max_tokens: 1,
            messages: [{ role: 'user', content: 'hi' }],
          }),
          signal: AbortSignal.timeout(15000),
        })
        if (res.ok) {
          ok = true
        } else {
          const data = await res.json().catch(() => ({}))
          errorMsg = (data as { error?: { message?: string } }).error?.message || `HTTP ${res.status}`
        }
      } else {
        const url = baseUrl.includes('/chat/completions') ? baseUrl : `${baseUrl.replace(/\/$/, '')}/chat/completions`
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${provider.api_key}`,
          },
          body: JSON.stringify({
            model: modelName,
            max_tokens: 1,
            messages: [{ role: 'user', content: 'hi' }],
          }),
          signal: AbortSignal.timeout(15000),
        })
        if (res.ok) {
          ok = true
        } else {
          const data = await res.json().catch(() => ({}))
          errorMsg = (data as { error?: { message?: string } }).error?.message || `HTTP ${res.status}`
        }
      }
    } else {
      // Unknown provider type: mark as configured
      ok = true
    }

    const status = ok ? 'connected' : 'error'
    db.prepare("UPDATE api_providers SET status = ?, status_error = ?, updated_at = datetime('now') WHERE id = ?").run(status, errorMsg, id)

    const updated = db.prepare('SELECT * FROM api_providers WHERE id = ?').get(id)
    return NextResponse.json(updated)
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Connection failed'
    db.prepare("UPDATE api_providers SET status = 'error', status_error = ?, updated_at = datetime('now') WHERE id = ?").run(errorMsg, id)
    const updated = db.prepare('SELECT * FROM api_providers WHERE id = ?').get(id)
    return NextResponse.json(updated)
  }
}

/**
 * Test CLI authentication by spawning a minimal Claude Code SDK query.
 * Uses `claude --version` as a lightweight check — if the CLI can authenticate, it succeeds.
 */
async function testViaCliAuth(): Promise<boolean> {
  const { execFile } = await import('child_process')
  const { promisify } = await import('util')
  const execFileAsync = promisify(execFile)
  const fs = await import('fs')
  const path = await import('path')
  const os = await import('os')

  try {
    // Try to find claude CLI — first via which, then check common paths
    let claudePath: string | null = null
    const which = await execFileAsync('which', ['claude']).catch(() => null)
    if (which?.stdout?.trim()) {
      claudePath = which.stdout.trim()
    } else {
      // Fallback: check common installation paths (GUI apps may not have shell PATH)
      const candidates = [
        path.join(os.homedir(), '.local', 'bin', 'claude'),
        '/usr/local/bin/claude',
        '/opt/homebrew/bin/claude',
      ]
      for (const c of candidates) {
        if (fs.existsSync(c)) { claudePath = c; break }
      }
    }

    if (!claudePath) return false

    // Run `claude --version` to verify CLI is installed and authenticated
    await execFileAsync(claudePath, ['--version'], { timeout: 10000 })
    return true
  } catch {
    return false
  }
}
