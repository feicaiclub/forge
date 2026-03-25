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
    anthropicBaseUrl: 'https://api.moonshot.ai/anthropic',
    authType: 'auth_token',
  },
  qwen: {
    anthropicBaseUrl: 'https://dashscope.aliyuncs.com/apps/anthropic',
    authType: 'auth_token',
  },
}

/**
 * Model ID → Provider ID mapping.
 * Used to determine which provider to use for a given model.
 */
const MODEL_TO_PROVIDER: Record<string, string> = {
  // Anthropic
  'claude-opus-4-6': 'anthropic',
  'claude-sonnet-4-6': 'anthropic',
  'claude-haiku-4-5': 'anthropic',
  // Moonshot/Kimi
  'kimi-k2.5': 'moonshot',
  'kimi-k2-thinking': 'moonshot',
  // Zhipu/GLM
  'glm-5': 'zhipu',
  'glm-5-turbo': 'zhipu',
  'glm-4-plus': 'zhipu',
  // MiniMax
  'MiniMax-M2.7': 'minimax',
  'MiniMax-M2.7-highspeed': 'minimax',
  'MiniMax-M2.5': 'minimax',
  // Qwen/DashScope
  'qwen3.5-plus': 'qwen',
  'qwen3.5-flash': 'qwen',
  'qwen3-coder-plus': 'qwen',
  'qwen-max': 'qwen',
  'qwen-plus': 'qwen',
}

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

  // Determine provider from model
  const providerId = (model && MODEL_TO_PROVIDER[model]) || 'anthropic'
  const catalog = PROVIDER_CATALOG[providerId]

  if (!catalog) {
    throw new Error(`Unknown provider for model: ${model}`)
  }

  const row = db.prepare('SELECT id, api_key, base_url, provider FROM api_providers WHERE id = ?').get(providerId) as {
    id: string
    api_key: string
    base_url: string
    provider: string
  } | undefined

  // For Anthropic: support custom endpoint override from settings
  let baseUrl: string | undefined
  if (providerId === 'anthropic') {
    const customEndpoint = db.prepare("SELECT value FROM settings WHERE key = 'custom_api_endpoint'").get() as { value: string } | undefined
    baseUrl = customEndpoint?.value || row?.base_url || undefined
  } else {
    // Non-Anthropic: always use the Anthropic-compatible endpoint
    baseUrl = catalog.anthropicBaseUrl
  }

  // If API key exists, use it directly
  if (row?.api_key) {
    return {
      apiKey: row.api_key,
      baseUrl,
      provider: row?.provider || providerId,
      providerId: row?.id || providerId,
      isCliAuth: false,
      authType: catalog.authType,
    }
  }

  // No API key — for Anthropic, check CLI auth
  if (providerId === 'anthropic' && isClaudeCliAuthenticated()) {
    return {
      apiKey: '',
      baseUrl,
      provider: row?.provider || 'anthropic',
      providerId: row?.id || providerId,
      isCliAuth: true,
      authType: 'api_key',
    }
  }

  // Non-Anthropic provider without API key
  if (providerId !== 'anthropic') {
    throw new Error(`No API key configured for ${PROVIDER_CATALOG[providerId] ? providerId : model}. Please add your API key in Settings.`)
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
