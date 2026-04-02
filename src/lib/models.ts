/**
 * Single source of truth for built-in model definitions.
 *
 * Add new models HERE — all UI components and server logic
 * consume from this file. No more duplicate hardcoded arrays.
 */

export interface ModelEntry {
  id: string
  label: string
  displayLabel?: string // Optional shorter UI label for chat/model pickers
  provider: string      // Display name: 'Anthropic', 'Moonshot', etc.
  providerId: string    // DB provider ID: 'anthropic', 'moonshot', etc.
  apiModelId?: string   // Actual upstream model name sent to the provider API
  aliases?: string[]    // For IM /model fuzzy matching
}

/**
 * Built-in models. These are always available regardless of DB state.
 * Custom provider models are loaded dynamically from the database.
 */
export const BUILTIN_MODELS: ModelEntry[] = [
  // Anthropic (native)
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', provider: 'Anthropic', providerId: 'anthropic', aliases: ['sonnet', 'claude-sonnet'] },
  { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', provider: 'Anthropic', providerId: 'anthropic', aliases: ['opus', 'claude-opus'] },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', provider: 'Anthropic', providerId: 'anthropic', aliases: ['haiku', 'claude-haiku'] },
  // Moonshot/Kimi (Anthropic-compatible)
  { id: 'kimi-k2.5', label: 'Kimi K2.5', provider: 'Moonshot', providerId: 'moonshot', aliases: ['kimi'] },
  { id: 'kimi-k2-thinking', label: 'Kimi K2 Thinking', provider: 'Moonshot', providerId: 'moonshot', aliases: ['kimi-thinking'] },
  // Zhipu/GLM (Anthropic-compatible)
  { id: 'glm-5', label: 'GLM-5', provider: 'Zhipu', providerId: 'zhipu', aliases: ['glm', 'glm5'] },
  { id: 'glm-5-turbo', label: 'GLM-5 Turbo', provider: 'Zhipu', providerId: 'zhipu', aliases: ['glm5-turbo'] },
  { id: 'glm-4-plus', label: 'GLM-4 Plus', provider: 'Zhipu', providerId: 'zhipu', aliases: ['glm4'] },
  // MiniMax (Anthropic-compatible)
  { id: 'MiniMax-M2.7', label: 'MiniMax M2.7', provider: 'MiniMax', providerId: 'minimax', aliases: ['minimax', 'm2.7'] },
  { id: 'MiniMax-M2.7-highspeed', label: 'MiniMax M2.7 Highspeed', provider: 'MiniMax', providerId: 'minimax', aliases: ['minimax-fast'] },
  { id: 'MiniMax-M2.5', label: 'MiniMax M2.5', provider: 'MiniMax', providerId: 'minimax', aliases: ['m2.5'] },
  // Qwen/DashScope (Anthropic-compatible)
  { id: 'qwen3.5-plus', label: 'Qwen 3.5 Plus', provider: 'Qwen', providerId: 'qwen', aliases: ['qwen', 'qwen3.5'] },
  { id: 'qwen3.5-flash', label: 'Qwen 3.5 Flash', provider: 'Qwen', providerId: 'qwen', aliases: ['qwen-flash'] },
  { id: 'qwen3-coder-plus', label: 'Qwen3 Coder Plus', provider: 'Qwen', providerId: 'qwen', aliases: ['qwen-coder'] },
  { id: 'qwen-max', label: 'Qwen Max', provider: 'Qwen', providerId: 'qwen', aliases: ['qwen-max'] },
  { id: 'qwen-plus', label: 'Qwen Plus', provider: 'Qwen', providerId: 'qwen', aliases: ['qwen-plus'] },
  // Bailian CodingPlan (internal IDs are namespaced to avoid provider routing collisions)
  { id: 'bailian-codingplan:qwen3.5-plus', apiModelId: 'qwen3.5-plus', label: 'qwen3.5-plus', provider: 'Bailian', providerId: 'bailian-codingplan', aliases: ['qwen3.5-codingplan'] },
  { id: 'bailian-codingplan:qwen3-max-2026-01-23', apiModelId: 'qwen3-max-2026-01-23', label: 'qwen3-max-2026-01-23', provider: 'Bailian', providerId: 'bailian-codingplan', aliases: ['qwen3-max-codingplan'] },
  { id: 'bailian-codingplan:qwen3-coder-next', apiModelId: 'qwen3-coder-next', label: 'qwen3-coder-next', provider: 'Bailian', providerId: 'bailian-codingplan', aliases: ['coder-next', 'codingplan'] },
  { id: 'bailian-codingplan:qwen3-coder-plus', apiModelId: 'qwen3-coder-plus', label: 'qwen3-coder-plus', provider: 'Bailian', providerId: 'bailian-codingplan', aliases: ['coder-plus'] },
  { id: 'bailian-codingplan:glm-5', apiModelId: 'glm-5', label: 'glm-5', provider: 'Bailian', providerId: 'bailian-codingplan', aliases: ['glm5-codingplan'] },
  { id: 'bailian-codingplan:glm-4.7', apiModelId: 'glm-4.7', label: 'glm-4.7', provider: 'Bailian', providerId: 'bailian-codingplan', aliases: ['glm4.7-codingplan'] },
  { id: 'bailian-codingplan:kimi-k2.5', apiModelId: 'kimi-k2.5', label: 'kimi-k2.5', provider: 'Bailian', providerId: 'bailian-codingplan', aliases: ['kimi-codingplan'] },
  { id: 'bailian-codingplan:MiniMax-M2.5', apiModelId: 'MiniMax-M2.5', label: 'MiniMax-M2.5', provider: 'Bailian', providerId: 'bailian-codingplan', aliases: ['minimax-codingplan'] },
]

const BUILTIN_MODEL_BY_ID = new Map(BUILTIN_MODELS.map(model => [model.id, model]))

/**
 * Build MODEL_TO_PROVIDER mapping from BUILTIN_MODELS.
 * Used by resolveProvider() for fast model → provider lookup.
 */
export const MODEL_TO_PROVIDER: Record<string, string> = Object.fromEntries(
  BUILTIN_MODELS.map(m => [m.id, m.providerId])
)

export function getModelEntry(modelId?: string | null): ModelEntry | undefined {
  if (!modelId) return undefined
  return BUILTIN_MODEL_BY_ID.get(modelId) || undefined
}

export function getModelProviderId(modelId?: string | null): string | undefined {
  const entry = getModelEntry(modelId)
  if (entry) return entry.providerId
  return parseCustomModelId(modelId)?.providerId ? 'custom' : undefined
}

export function getApiModelId(modelId?: string | null): string | undefined {
  const entry = getModelEntry(modelId)
  if (entry) return entry.apiModelId || entry.id
  const customModel = parseCustomModelId(modelId)
  return customModel?.modelName || modelId || undefined
}

export function getModelLabel(modelId?: string | null): string | undefined {
  const entry = getModelEntry(modelId)
  if (entry) return entry.label
  const customModel = parseCustomModelId(modelId)
  return customModel?.modelName
}

export function getModelDisplayLabel(modelId?: string | null): string | undefined {
  const entry = getModelEntry(modelId)
  if (entry) return entry.displayLabel || entry.label
  const customModel = parseCustomModelId(modelId)
  return customModel?.modelName
}

export function makeCustomModelId(providerId: string, modelName: string): string {
  return `custom:${providerId}:${encodeURIComponent(modelName)}`
}

export function parseCustomModelId(modelId?: string | null): { providerId: string; modelName: string } | null {
  if (!modelId || !modelId.startsWith('custom:')) return null
  const firstColon = modelId.indexOf(':')
  const secondColon = modelId.indexOf(':', firstColon + 1)
  if (secondColon === -1) return null
  const providerId = modelId.slice(firstColon + 1, secondColon)
  const encodedModelName = modelId.slice(secondColon + 1)
  if (!providerId || !encodedModelName) return null
  return {
    providerId,
    modelName: decodeURIComponent(encodedModelName),
  }
}
