import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = getDb()

  const existing = db.prepare('SELECT * FROM api_providers WHERE id = ?').get(id)
  if (!existing) return NextResponse.json({ error: 'Provider not found' }, { status: 404 })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  if ('protocol' in body && body.protocol !== 'anthropic-compatible' && body.protocol !== 'openai-compatible') {
    return NextResponse.json({ error: 'Invalid protocol' }, { status: 400 })
  }

  const allowedFields = ['api_key', 'base_url', 'is_active', 'status', 'status_error', 'name', 'model_name', 'protocol'] as const
  const sets: string[] = []
  const values: unknown[] = []

  for (const field of allowedFields) {
    if (field in body) {
      sets.push(`${field} = ?`)
      values.push(field === 'is_active' ? (body[field] ? 1 : 0) : body[field])
    }
  }

  // Auto-reset status when api_key changes
  if ('api_key' in body && !('status' in body)) {
    const newKey = body.api_key as string
    sets.push('status = ?')
    values.push(newKey ? 'not_configured' : 'not_configured')
    sets.push('status_error = ?')
    values.push('')
  }

  if (sets.length === 0) return NextResponse.json({ error: 'No valid fields' }, { status: 400 })

  sets.push("updated_at = datetime('now')")
  values.push(id)

  db.prepare(`UPDATE api_providers SET ${sets.join(', ')} WHERE id = ?`).run(...values)

  const updated = db.prepare('SELECT * FROM api_providers WHERE id = ?').get(id)
  return NextResponse.json(updated)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  if (!id.startsWith('custom-')) {
    return NextResponse.json({ error: 'Only custom providers can be deleted' }, { status: 403 })
  }

  const db = getDb()

  const existing = db.prepare('SELECT * FROM api_providers WHERE id = ?').get(id)
  if (!existing) return NextResponse.json({ error: 'Provider not found' }, { status: 404 })

  db.prepare('DELETE FROM api_providers WHERE id = ?').run(id)
  return NextResponse.json({ success: true })
}
