/**
 * API provider resolution for the Claude Agent SDK.
 *
 * All providers use the Anthropic Messages API protocol.
 * Non-Anthropic providers (MiniMax, GLM, Kimi, Qwen) are accessed
 * through their Anthropic-compatible endpoints.
 *
 * Supports two authentication modes for Anthropic:
 * 1. API Key — user provides key in Settings, injected as ANTHROPIC_API_KEY
 * 2. CLI Auth — user has run `claude login`, SDK subprocess inherits OAuth from ~/.claude/
 */

import { getDb } from '@/lib/db'
import fs from 'fs'
import path from 'path'
import os from 'os'

export interface ResolvedProvider {
  apiKey: string
  baseUrl?: string
  provider: string
  providerId: string
  /** True when using CLI OAuth instead of API key */
  isCliAuth: boolean
  /** Auth header type: 'api_key' for x-api-key, 'auth_token' for Bearer */
  authType: 'api_key' | 'auth_token'
}

/**
 * Provider catalog: Anthropic-compatible base URLs and auth types.
 * Non-Anthropic providers have built Anthropic protocol endpoints.
 */
const PROVIDER_CATALOG: Record<string, {
  anthropicBaseUrl: string
  authType: 'api_key' | 'auth_token'
}> = {
  anthropic: {
    anthropicBaseUrl: 'https://api.anthropic.com',
    authType: 'api_key',
  },
  minimax: {
    anthropicBaseUrl: 'https://api.minimax.io/anthropic',
    authType: 'auth_token',
  },
  zhipu: {
    anthropicBaseUrl: 'https://open.bigmodel.cn/api/anthropic',
    authType: 'auth_token',
  },
  moonshot: {
    anthropicBaseUrl: 'https://api.moonshot.cn/anthropic',
    authType: 'auth_token',
  },
  qwen: {
    anthropicBaseUrl: 'https://dashscope.aliyuncs.com/apps/anthropic',
    authType: 'auth_token',
  },
}

// Import model-to-provider mapping from single source of truth
import { MODEL_TO_PROVIDER } from './models'

/**
 * Check if Claude Code CLI is authenticated by looking for ~/.claude.json oauthAccount.
 * Claude Code CLI stores subscription info in ~/.claude.json (home root, not ~/.claude/).
 */
export function isClaudeCliAuthenticated(): boolean {
  try {
    const claudeJsonPath = path.join(os.homedir(), '.claude.json')
    if (!fs.existsSync(claudeJsonPath)) return false
    const content = fs.readFileSync(claudeJsonPath, 'utf-8')
    const parsed = JSON.parse(content)
    // Must have oauthAccount with a valid accountUuid
    return !!(parsed.oauthAccount?.accountUuid)
  } catch {
    return false
  }
}

/**
 * Get Claude CLI account display info for UI.
 */
export function getClaudeCliAccountInfo(): { email: string; displayName: string; billingType: string } | null {
  try {
    const claudeJsonPath = path.join(os.homedir(), '.claude.json')
    if (!fs.existsSync(claudeJsonPath)) return null
    const content = fs.readFileSync(claudeJsonPath, 'utf-8')
    const parsed = JSON.parse(content)
    const acct = parsed.oauthAccount
    if (!acct?.accountUuid) return null
    return {
      email: acct.emailAddress || '',
      displayName: acct.displayName || '',
      billingType: acct.billingType || '',
    }
  } catch {
    return null
  }
}

/**
 * Resolve the API provider for a given model.
 * Looks up which provider owns the model, fetches credentials from DB,
 * and returns the correct base URL and auth type.
 *
 * For Anthropic: supports both API Key and CLI auth modes.
 * For others: requires API Key, uses Anthropic-compatible endpoint.
 */
export function resolveProvider(model?: string): ResolvedProvider {
  const db = getDb()

  // 0. Check for custom provider format: "providerId:modelName"
  if (model?.includes(':')) {
    const [providerId, modelName] = model.split(':', 2)
    const customRow = db.prepare(
      "SELECT id, name, api_key, base_url FROM api_providers WHERE id = ? AND model_name = ? AND api_key != ''"
    ).get(providerId, modelName) as { id: string; name: string; api_key: string; base_url: string } | undefined

    if (customRow) {
      return {
        apiKey: customRow.api_key,
        baseUrl: customRow.base_url || undefined,
        provider: 'custom',
        providerId: customRow.id,
        isCliAuth: false,
        authType: 'auth_token',
      }
    }
    // If custom provider not found, fall through to try modelName as regular model
    model = modelName
  }

  // 1. Try built-in provider lookup
  const builtinProviderId = model ? MODEL_TO_PROVIDER[model] : undefined

  if (builtinProviderId) {
    const catalog = PROVIDER_CATALOG[builtinProviderId]
    if (!catalog) throw new Error(`Unknown provider for model: ${model}`)

    const row = db.prepare('SELECT id, api_key, base_url, provider FROM api_providers WHERE id = ?').get(builtinProviderId) as {
      id: string; api_key: string; base_url: string; provider: string
    } | undefined

    // For Anthropic: support custom endpoint override
    let baseUrl: string | undefined
    if (builtinProviderId === 'anthropic') {
      const customEndpoint = db.prepare("SELECT value FROM settings WHERE key = 'custom_api_endpoint'").get() as { value: string } | undefined
      baseUrl = customEndpoint?.value || row?.base_url || undefined
    } else {
      baseUrl = catalog.anthropicBaseUrl
    }

    if (row?.api_key) {
      return { apiKey: row.api_key, baseUrl, provider: row.provider || builtinProviderId, providerId: row.id || builtinProviderId, isCliAuth: false, authType: catalog.authType }
    }

    // Anthropic CLI auth fallback
    if (builtinProviderId === 'anthropic' && isClaudeCliAuthenticated()) {
      return { apiKey: '', baseUrl, provider: 'anthropic', providerId: row?.id || builtinProviderId, isCliAuth: true, authType: 'api_key' }
    }

    if (builtinProviderId !== 'anthropic') {
      throw new Error(`No API key configured for ${builtinProviderId}. Please add your API key in Settings.`)
    }

    throw new Error('No Anthropic credentials found. Either add an API key in Settings, or run `claude login` in your terminal to authenticate with your Claude subscription.')
  }

  // 2. Try custom provider lookup: match model_name in api_providers where provider='custom'
  if (model) {
    const customRow = db.prepare(
      "SELECT id, name, api_key, base_url FROM api_providers WHERE provider = 'custom' AND model_name = ? AND api_key != ''"
    ).get(model) as { id: string; name: string; api_key: string; base_url: string } | undefined

    if (customRow) {
      return {
        apiKey: customRow.api_key,
        baseUrl: customRow.base_url || undefined,
        provider: 'custom',
        providerId: customRow.id,
        isCliAuth: false,
        authType: 'auth_token',  // Custom providers use Bearer token (OpenAI-compatible)
      }
    }
  }

  // 3. Default to Anthropic
  const catalog = PROVIDER_CATALOG.anthropic
  const row = db.prepare("SELECT id, api_key, base_url, provider FROM api_providers WHERE id = 'anthropic'").get() as {
    id: string; api_key: string; base_url: string; provider: string
  } | undefined

  if (row?.api_key) {
    return { apiKey: row.api_key, baseUrl: row.base_url || undefined, provider: 'anthropic', providerId: 'anthropic', isCliAuth: false, authType: catalog.authType }
  }

  if (isClaudeCliAuthenticated()) {
    return { apiKey: '', baseUrl: undefined, provider: 'anthropic', providerId: 'anthropic', isCliAuth: true, authType: 'api_key' }
  }

  throw new Error('No Anthropic credentials found. Either add an API key in Settings, or run `claude login` in your terminal to authenticate with your Claude subscription.')
}

/**
 * Check if a provider has any credentials (API key or CLI auth).
 */
export function hasCredentials(providerId: string = 'anthropic'): boolean {
  const db = getDb()
  const row = db.prepare('SELECT api_key FROM api_providers WHERE id = ?').get(providerId) as { api_key: string } | undefined
  if (row?.api_key) return true
  if (providerId === 'anthropic') return isClaudeCliAuthenticated()
  return false
}

/**
 * Check if a provider has an API key configured (without throwing).
 */
export function hasApiKey(providerId: string = 'anthropic'): boolean {
  const db = getDb()
  const row = db.prepare('SELECT api_key FROM api_providers WHERE id = ?').get(providerId) as { api_key: string } | undefined
  return !!row?.api_key
}
