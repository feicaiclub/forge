import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import type { ProviderProtocol } from '@/lib/types'

export async function GET() {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM api_providers ORDER BY created_at').all()
  return NextResponse.json(rows)
}

export async function POST(req: NextRequest) {
  let body: { name?: string; baseUrl?: string; apiKey?: string; modelName?: string; protocol?: ProviderProtocol }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { name, baseUrl, apiKey, modelName } = body
  const protocol = body.protocol || 'anthropic-compatible'

  if (!name || !baseUrl) {
    return NextResponse.json({ error: 'name and baseUrl are required' }, { status: 400 })
  }
  if (protocol !== 'anthropic-compatible' && protocol !== 'openai-compatible') {
    return NextResponse.json({ error: 'Invalid protocol' }, { status: 400 })
  }

  const db = getDb()
  const id = `custom-${Date.now()}`

  db.prepare(
    `INSERT INTO api_providers (id, name, provider, protocol, api_key, base_url, model_name, is_active, status, status_error)
     VALUES (?, ?, 'custom', ?, ?, ?, ?, 0, 'not_configured', '')`
  ).run(id, name, protocol, apiKey || '', baseUrl, modelName || '')

  const created = db.prepare('SELECT * FROM api_providers WHERE id = ?').get(id)
  return NextResponse.json(created, { status: 201 })
}
