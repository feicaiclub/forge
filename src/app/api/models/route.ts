import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { BUILTIN_MODELS, makeCustomModelId, type ModelEntry } from '@/lib/models'

/**
 * GET /api/models — Returns all available models (built-in + custom providers).
 *
 * Built-in models come from the single source of truth in models.ts.
 * Custom models are read from the api_providers table where provider='custom'
 * and status='connected'.
 */
export async function GET() {
  const models: ModelEntry[] = [...BUILTIN_MODELS]

  // Add custom provider models from DB
  try {
    const db = getDb()
    const customs = db.prepare(
      "SELECT id, name, model_name FROM api_providers WHERE provider = 'custom' AND model_name != '' AND status = 'connected'"
    ).all() as { id: string; name: string; model_name: string }[]

    for (const row of customs) {
      models.push({
        id: makeCustomModelId(row.id, row.model_name),
        label: row.model_name,
        provider: row.name,
        providerId: row.id,
        apiModelId: row.model_name,
        aliases: [],
      })
    }
  } catch { /* DB not ready, return built-in only */ }

  return NextResponse.json(models)
}
