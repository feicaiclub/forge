/**
 * Core SDK client wrapper for Forge.
 * Creates configured query() instances with agents, MCP, hooks, and permissions.
 *
 * Key requirements:
 * 1. Start env with full process.env (HOME, PATH, etc.)
 * 2. Ensure HOME is set so SDK can find ~/.claude.json OAuth
 * 3. Expand PATH to include fnm/nvm/volta bin dirs
 * 4. Remove CLAUDECODE env var to prevent "nested session" detection
 * 5. Pass settingSources for SDK settings; override to ['project'] in confirm mode
 * 6. Find claude CLI binary via candidate paths + version manager scans
 */

import { query } from '@anthropic-ai/claude-agent-sdk'
import type { Query, CanUseTool, Options, McpServerConfig, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources'
import { execFileSync, execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { getDb } from '@/lib/db'
import { resolveProvider } from '@/lib/provider'
import { loadWorkspaceContext, loadMemoryContext, loadRulesContext, getProjectPath } from '@/lib/workspace-fs'
import { loadAgentsFromFiles } from './agents-loader'
import { FORGE_BASE_SYSTEM_PROMPT, FORGE_IM_SYSTEM_PROMPT, buildEnvironmentPrompt } from './system-prompt'
import { loadMcpServersFromDb } from './mcp-loader'
import { createBrowserMcpServer } from '@/lib/browser-tools'

// ── Claude CLI Binary Discovery ─────────────────────────────────

let _cachedClaudePath: string | null = null
let _cachedClaudePathTime = 0

function findClaudeExecutable(): string | undefined {
  const now = Date.now()
  if (_cachedClaudePath && now - _cachedClaudePathTime < 60_000) {
    return _cachedClaudePath
  }
  const found = _findClaudeUncached()
  if (found) {
    _cachedClaudePath = found
    _cachedClaudePathTime = now
  }
  return found
}

function _findClaudeUncached(): string | undefined {
  const home = os.homedir()

  // 1. Check well-known fixed paths
  const candidates = [
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
    path.join(home, '.npm-global', 'bin', 'claude'),
    path.join(home, '.local', 'bin', 'claude'),
    path.join(home, '.claude', 'bin', 'claude'),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try {
        execFileSync(p, ['--version'], { timeout: 5000, stdio: 'pipe' })
        return p
      } catch { /* not executable, try next */ }
    }
  }

  // 2. Scan fnm node versions for globally installed claude-code
  const fnmVersionsDir = path.join(home, '.fnm', 'node-versions')
  const cliRelPath = 'installation/lib/node_modules/@anthropic-ai/claude-code/cli.js'
  try {
    if (fs.existsSync(fnmVersionsDir)) {
      for (const v of fs.readdirSync(fnmVersionsDir)) {
        const cliPath = path.join(fnmVersionsDir, v, cliRelPath)
        if (fs.existsSync(cliPath)) return cliPath
      }
    }
  } catch { /* skip */ }

  // 3. Scan nvm node versions
  const nvmDir = process.env.NVM_DIR || path.join(home, '.nvm')
  const nvmVersionsDir = path.join(nvmDir, 'versions', 'node')
  try {
    if (fs.existsSync(nvmVersionsDir)) {
      for (const v of fs.readdirSync(nvmVersionsDir)) {
        const cliPath = path.join(nvmVersionsDir, v, 'lib', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js')
        if (fs.existsSync(cliPath)) return cliPath
      }
    }
  } catch { /* skip */ }

  // 4. Scan volta
  const voltaToolsDir = path.join(home, '.volta', 'tools', 'image', 'packages', '@anthropic-ai', 'claude-code')
  try {
    if (fs.existsSync(voltaToolsDir)) {
      for (const v of fs.readdirSync(voltaToolsDir)) {
        const cliPath = path.join(voltaToolsDir, v, 'cli.js')
        if (fs.existsSync(cliPath)) return cliPath
      }
    }
  } catch { /* skip */ }

  // 5. Last resort: ask user's login shell (handles any custom PATH setup)
  try {
    const shell = process.env.SHELL || '/bin/zsh'
    const result = execSync(`${shell} -ilc "which claude" 2>/dev/null`, {
      timeout: 5000,
      stdio: 'pipe',
    })
    const found = result.toString().trim()
    if (found && fs.existsSync(found)) {
      return fs.realpathSync(found)
    }
  } catch { /* not found */ }

  return undefined
}

// ── Expanded PATH builder ───────────────────────────────────────

function getExpandedPath(): string {
  const home = os.homedir()
  const parts = new Set((process.env.PATH || '').split(path.delimiter).filter(Boolean))

  // Add common Node.js version manager bin directories
  const extras = [
    '/usr/local/bin',
    '/opt/homebrew/bin',
    path.join(home, '.local', 'bin'),
    path.join(home, '.npm-global', 'bin'),
  ]

  // fnm: add all version bin dirs
  const fnmVersionsDir = path.join(home, '.fnm', 'node-versions')
  try {
    if (fs.existsSync(fnmVersionsDir)) {
      for (const v of fs.readdirSync(fnmVersionsDir)) {
        extras.push(path.join(fnmVersionsDir, v, 'installation', 'bin'))
      }
    }
  } catch { /* skip */ }

  // nvm: add all version bin dirs
  const nvmDir = process.env.NVM_DIR || path.join(home, '.nvm')
  const nvmVersionsDir = path.join(nvmDir, 'versions', 'node')
  try {
    if (fs.existsSync(nvmVersionsDir)) {
      for (const v of fs.readdirSync(nvmVersionsDir)) {
        extras.push(path.join(nvmVersionsDir, v, 'bin'))
      }
    }
  } catch { /* skip */ }

  // volta
  extras.push(path.join(home, '.volta', 'bin'))

  for (const p of extras) {
    if (p) parts.add(p)
  }
  return [...parts].join(path.delimiter)
}

// ── SDK Environment Builder ─────────────────────────────────────

/**
 * Build the environment for the SDK subprocess.
 *
 * 1. Start with full process.env
 * 2. Ensure HOME is set
 * 3. Expand PATH to include version managers
 * 4. Remove CLAUDECODE to prevent nested session detection
 * 5. Inject API credentials with correct auth header type
 */
function buildSdkEnv(apiKey: string, baseUrl?: string, authType: 'api_key' | 'auth_token' = 'api_key'): Record<string, string> {
  const sdkEnv: Record<string, string> = {}

  // Copy all of process.env
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === 'string') sdkEnv[k] = v
  }

  // Ensure HOME is set so SDK can find ~/.claude.json
  if (!sdkEnv.HOME) sdkEnv.HOME = os.homedir()

  // Expand PATH to include fnm/nvm/volta bin directories
  sdkEnv.PATH = getExpandedPath()

  // Remove CLAUDECODE env var to prevent "nested session" detection.
  // When Forge is launched from within a Claude Code CLI session,
  // the child process inherits this variable and the SDK refuses to start.
  delete sdkEnv.CLAUDECODE

  // Inject or clean API credentials based on auth type
  if (apiKey) {
    if (authType === 'auth_token') {
      // Non-Anthropic providers: use Bearer token (Authorization header)
      sdkEnv.ANTHROPIC_AUTH_TOKEN = apiKey
      // Must NOT set ANTHROPIC_API_KEY — it would send the wrong header
      delete sdkEnv.ANTHROPIC_API_KEY
    } else {
      // Anthropic native: use x-api-key header
      sdkEnv.ANTHROPIC_API_KEY = apiKey
      sdkEnv.ANTHROPIC_AUTH_TOKEN = apiKey
    }
  } else {
    // CLI auth mode: remove any stale API keys so SDK auto-detects OAuth from ~/.claude.json
    delete sdkEnv.ANTHROPIC_API_KEY
    delete sdkEnv.ANTHROPIC_AUTH_TOKEN
  }

  if (baseUrl) {
    sdkEnv.ANTHROPIC_BASE_URL = baseUrl
  }

  return sdkEnv
}

// ── Query Options Builder ───────────────────────────────────────

export interface ForgeQueryOptions {
  prompt: string
  sessionId: string
  model: string
  workspaceId: string
  abortController?: AbortController
  canUseTool?: CanUseTool
  bypassPermissions?: boolean
  customSystemPrompt?: string
  resumeSession?: boolean
  extraMcpServers?: Record<string, McpServerConfig>
  /** Unified thinking mode: 'off' | 'auto' | 'max' */
  thinkingMode?: string
  /** Provider type for thinking mode mapping */
  providerType?: string
  /** Skip MCP servers (DB + browser) for lightweight queries like IM */
  skipMcpServers?: boolean
  /** Skip loading agents from files */
  skipAgents?: boolean
  /** Use compact IM system prompt instead of full Forge prompt */
  useImPrompt?: boolean
  /** Skip session persistence (useful when not planning to resume) */
  skipPersistSession?: boolean
  /** File attachments for multimodal content (images, PDFs, text files) */
  attachments?: ForgeAttachment[]
}

export interface ForgeAttachment {
  /** Original filename */
  name: string
  /** Absolute server path to the uploaded file */
  serverPath: string
  /** MIME type */
  mimeType: string
  /** Tier classification */
  tier: 'image' | 'pdf' | 'text' | 'binary'
}

function buildSystemPrompt(workspaceId: string): string {
  const workspaceContext = loadWorkspaceContext(workspaceId)
  const memoryContext = loadMemoryContext(workspaceId)
  const rulesContext = loadRulesContext(workspaceId)
  const cwd = (() => { try { return getProjectPath(workspaceId) } catch { return process.cwd() } })()

  // Five-layer system prompt architecture (aligned with Claude Code):
  // 1. Forge base prompt (always present — tool usage, memory, code quality, git, safety)
  // 2. Environment info (dynamic — platform, cwd, shell)
  // 3. Forge extra config files (SOUL.md, IDENTITY.md, USER.md — CLAUDE.md is loaded by SDK natively)
  // 4. Memory context (MEMORY.md first 200 lines + recent daily memories)
  // 5. Rules context (.claude/rules/*.md — unconditional rules loaded, path-scoped listed)
  const systemParts: string[] = [
    FORGE_BASE_SYSTEM_PROMPT,
    buildEnvironmentPrompt(cwd),
  ]
  if (workspaceContext) systemParts.push(workspaceContext)
  if (memoryContext) systemParts.push(memoryContext)
  if (rulesContext) systemParts.push(rulesContext)

  return systemParts.join('\n\n---\n\n')
}

/**
 * Map unified thinking mode (Off/Auto/Max) to provider-specific SDK parameters.
 *
 * All providers use Anthropic-compatible endpoints, so the SDK `thinking` option
 * is used for all of them. The mapping accounts for each provider's native behavior:
 *
 * - Anthropic: adaptive/enabled/disabled (native support)
 * - MiniMax: Always-on thinking (Off is silently ignored)
 * - GLM: enabled/disabled via thinking option
 * - Kimi: Default enabled; disabled via thinking option
 * - Qwen: Uses enable_thinking param (mapped through Anthropic-compatible layer)
 * - Custom: Treated as Anthropic-native
 */
function mapThinkingMode(
  mode: string,
  providerType: string,
): { thinking: Options['thinking']; effort?: Options['effort'] } | null {
  // Normalize the mode (handle legacy values: adaptive→auto, enabled→max, disabled→off)
  const legacy: Record<string, string> = { adaptive: 'auto', enabled: 'max', disabled: 'off' }
  const normalized = legacy[mode.toLowerCase()] || mode.toLowerCase()

  switch (providerType) {
    case 'anthropic':
    case 'custom':
      // Anthropic native / Custom (assumed Anthropic-compatible)
      // For 'max': use enabled thinking. budgetTokens is deprecated on newer models,
      // so we rely on 'enabled' type which gives maximum thinking depth.
      if (normalized === 'off') return { thinking: { type: 'disabled' } }
      if (normalized === 'max') return { thinking: { type: 'enabled' } }
      return { thinking: { type: 'adaptive' } } // 'auto' or default

    case 'minimax':
      // MiniMax M2.5: supports standard Anthropic thinking parameter.
      // "Interleaved thinking" (reasoning between tool calls) is always on,
      // but extended thinking output in responses IS controllable.
      // Ref: platform.minimax.io/docs/api-reference/text-anthropic-api
      if (normalized === 'off') return { thinking: { type: 'disabled' } }
      return { thinking: { type: 'enabled' } }

    case 'zhipu':
      // GLM (Z.AI): supports standard Anthropic thinking parameter.
      // CRITICAL: GLM defaults to thinking mode. Omitting the param causes
      // output to go to reasoning_content instead of content → empty responses.
      // Must explicitly pass { type: 'disabled' } for Off.
      // Ref: docs.z.ai/guides/capabilities/thinking-mode
      if (normalized === 'off') return { thinking: { type: 'disabled' } }
      return { thinking: { type: 'enabled' } }

    case 'moonshot':
      // Kimi/Moonshot: thinking is model-variant based (kimi-k2-thinking vs kimi-k2-instruct).
      // The Anthropic-compatible endpoint at api.moonshot.ai/anthropic may accept
      // the standard thinking param, but thinking models think by default.
      // Sending { type: 'disabled' } is best-effort — may be silently ignored.
      // Ref: platform.moonshot.ai/docs/guide/use-kimi-k2-thinking-model
      if (normalized === 'off') return { thinking: { type: 'disabled' } }
      return null // 'auto' and 'max': default behavior (thinking on)

    case 'qwen':
      // Qwen/DashScope: supports standard Anthropic thinking parameter.
      // Known limitation: { type: 'disabled' } may not work through the Anthropic
      // proxy — thinking can remain enabled despite the disable flag.
      // Ref: alibabacloud.com/help/en/model-studio/anthropic-api-messages
      if (normalized === 'off') return { thinking: { type: 'disabled' } }
      return { thinking: { type: 'enabled' } }

    default:
      // Unknown provider — try Anthropic-native format
      if (normalized === 'off') return { thinking: { type: 'disabled' } }
      if (normalized === 'max') return { thinking: { type: 'enabled' } }
      return { thinking: { type: 'adaptive' } }
  }
}

/**
 * Create a configured SDK query instance.
 */
export function createForgeQuery(opts: ForgeQueryOptions): Query {
  // Resolve API key (supports both API key and CLI auth modes)
  const resolved = resolveProvider(opts.model)

  // Build system prompt
  // IM queries use a compact prompt to reduce token overhead
  const systemPrompt = opts.customSystemPrompt
    || (opts.useImPrompt ? FORGE_IM_SYSTEM_PROMPT : buildSystemPrompt(opts.workspaceId))

  // Load agents from .claude/agents/*.md files (skip for IM — not needed)
  const agents = opts.skipAgents ? {} : loadAgentsFromFiles(opts.workspaceId)

  // Load MCP servers from DB + browser MCP + extras
  // Skip for IM queries (skipMcpServers) to reduce subprocess startup overhead
  let mcpServers: Record<string, McpServerConfig> | undefined
  if (!opts.skipMcpServers) {
    const dbMcpServers = loadMcpServersFromDb()
    const browserMcp = createBrowserMcpServer()
    mcpServers = {
      ...dbMcpServers,
      '__forge_browser': browserMcp,
      ...opts.extraMcpServers,
    }
  } else if (opts.extraMcpServers && Object.keys(opts.extraMcpServers).length > 0) {
    mcpServers = { ...opts.extraMcpServers }
  }

  // Build subprocess environment
  const sdkEnv = buildSdkEnv(resolved.apiKey, resolved.baseUrl, resolved.authType)

  // Find Claude CLI executable
  const claudePath = findClaudeExecutable()

  // Build SDK options
  // NOTE: sessionId and resume are mutually exclusive in the SDK.
  // First message: set sessionId to persist the session.
  // Subsequent messages: set resume (without sessionId) to continue the conversation.
  const sdkOptions: Options = {
    model: opts.model,
    cwd: (() => { try { return getProjectPath(opts.workspaceId) } catch { return process.cwd() } })(),
    systemPrompt,
    env: sdkEnv,
    ...(opts.resumeSession
      ? { resume: opts.sessionId }
      : { sessionId: opts.sessionId, persistSession: !opts.skipPersistSession }),
    includePartialMessages: true,
    agentProgressSummaries: true,
    betas: ['context-1m-2025-08-07'],
    // settingSources: load settings from ~/.claude/, <project>/.claude/, and ~/.claude/settings.local.json.
    // Auth is NOT loaded from these — API key is via env vars, OAuth via subprocess reading ~/.claude.json.
    // NOTE: Overridden to ['project'] in canUseTool branch below to prevent pre-approved
    // permission rules from bypassing the permission bridge.
    settingSources: ['user', 'project', 'local'] as Options['settingSources'],
    ...(claudePath ? { pathToClaudeCodeExecutable: claudePath } : {}),
  }

  // Thinking configuration — map unified Off/Auto/Max to provider-specific params
  const thinkingConfig = mapThinkingMode(opts.thinkingMode || 'auto', opts.providerType || 'anthropic')
  if (thinkingConfig) {
    sdkOptions.thinking = thinkingConfig.thinking
  }

  // Agents (only if any exist)
  if (Object.keys(agents).length > 0) {
    sdkOptions.agents = agents
  }

  // MCP servers (skipped for IM queries to reduce startup time)
  if (mcpServers) {
    sdkOptions.mcpServers = mcpServers
  }

  // Permission handling
  //
  // IMPORTANT: The CLI has a hardcoded safetyCheck for .claude/ directory that
  // blocks Edit/Write even in bypassPermissions mode (confirmed SDK bug — see
  // GitHub issues #38806, #35718, #36497). The safetyCheck returns "ask" BEFORE
  // the bypassPermissions check runs, so the only way to approve .claude/ writes
  // is via canUseTool callback. We always provide one that auto-approves .claude/
  // paths, wrapping the caller's canUseTool if provided.
  const isClaudeDirWrite = (input: Record<string, unknown>): boolean => {
    const filePath = String(input.file_path || input.path || '')
    return filePath.includes('/.claude/') || filePath.includes('\\.claude\\')
  }

  if (opts.bypassPermissions) {
    sdkOptions.permissionMode = 'bypassPermissions'
    sdkOptions.allowDangerouslySkipPermissions = true
    // Provide canUseTool to handle .claude/ safetyCheck (which bypasses bypassPermissions).
    // Auto-approve everything — this is what bypass mode is supposed to do.
    sdkOptions.canUseTool = async (_toolName, input, options) => ({
      behavior: 'allow' as const,
      updatedInput: input,
      updatedPermissions: options.suggestions,
    })
  } else if (opts.canUseTool) {
    // Wrap the caller's canUseTool with .claude/ auto-approval.
    // .claude/ safetyCheck prompts can't be displayed in the UI (no clickable button),
    // so we auto-approve them and return SDK suggestions to unlock the session.
    const callerCanUseTool = opts.canUseTool
    sdkOptions.canUseTool = async (toolName, input, options) => {
      if (isClaudeDirWrite(input)) {
        return {
          behavior: 'allow' as const,
          updatedInput: input,
          updatedPermissions: options.suggestions,
        }
      }
      return callerCanUseTool(toolName, input, options)
    }
    // CRITICAL: Restrict settingSources to only 'project' when canUseTool is provided.
    // Without this, the SDK loads pre-approved permission rules from:
    //   - ~/.claude/settings.json ('user' source) — e.g. mcp__pencil
    //   - ~/.claude/settings.local.json ('local' source) — e.g. WebSearch, Bash(*)
    // and auto-approves those tools WITHOUT ever calling canUseTool, completely
    // bypassing Forge's permission bridge.
    // Keeping 'project' ensures <project>/.claude/CLAUDE.md and project settings load.
    // Auth unaffected: API key via ANTHROPIC_API_KEY env var, OAuth via subprocess.
    sdkOptions.settingSources = ['project'] as Options['settingSources']
  }

  // Abort controller
  if (opts.abortController) {
    sdkOptions.abortController = opts.abortController
  }

  // Stderr handler: log SDK subprocess errors for debugging
  sdkOptions.stderr = (data: string) => {
    const cleaned = data
      .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
      .replace(/\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g, '')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
      .trim()
    if (cleaned) {
      console.error('[forge-sdk-stderr]', cleaned.slice(0, 500))
    }
  }

  // If no attachments, use simple string prompt
  if (!opts.attachments || opts.attachments.length === 0) {
    return query({ prompt: opts.prompt, options: sdkOptions })
  }

  // Build multimodal SDKUserMessage with content blocks
  const contentBlocks = buildMultimodalContent(opts.prompt, opts.attachments)
  const userMessage: SDKUserMessage = {
    type: 'user',
    message: { role: 'user', content: contentBlocks },
    parent_tool_use_id: null,
    session_id: opts.sessionId,
  }

  // Use AsyncIterable<SDKUserMessage> prompt format
  async function* singleMessage(): AsyncIterable<SDKUserMessage> {
    yield userMessage
  }

  return query({ prompt: singleMessage(), options: sdkOptions })
}

/**
 * Build multimodal content blocks from text prompt + file attachments.
 *
 * Tier 1 (Claude native): images → base64 image blocks, PDF → base64 document blocks
 * Tier 2 (text injection): text/code/config files → read content, inject as tagged text
 * Tier 3 (binary): unsupported formats → mention filename only
 */
function buildMultimodalContent(prompt: string, attachments: ForgeAttachment[]): ContentBlockParam[] {
  const fs = require('fs') as typeof import('fs')
  const blocks: ContentBlockParam[] = []

  for (const att of attachments) {
    try {
      if (att.tier === 'image') {
        // Tier 1: Image → base64 image content block
        const data = fs.readFileSync(att.serverPath)
        const base64 = data.toString('base64')
        const mediaType = att.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
        blocks.push({
          type: 'image',
          source: { type: 'base64', media_type: mediaType, data: base64 },
        })
      } else if (att.tier === 'pdf') {
        // Tier 1: PDF → base64 document content block
        const data = fs.readFileSync(att.serverPath)
        const base64 = data.toString('base64')
        blocks.push({
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: base64 },
        } as ContentBlockParam)
      } else if (att.tier === 'text') {
        // Tier 2: Text file → read content, inject as tagged text block
        const content = fs.readFileSync(att.serverPath, 'utf-8')
        const maxLen = 100_000 // ~25k tokens
        const truncated = content.length > maxLen ? content.slice(0, maxLen) + '\n\n[... truncated]' : content
        blocks.push({
          type: 'text',
          text: `<file name="${att.name}">\n${truncated}\n</file>`,
        })
      } else {
        // Tier 3: Binary → just mention the filename
        blocks.push({
          type: 'text',
          text: `[Attached binary file: ${att.name} (${att.mimeType})]`,
        })
      }
    } catch (err) {
      console.warn(`[SDK] Failed to read attachment ${att.name}:`, err instanceof Error ? err.message : err)
      blocks.push({ type: 'text', text: `[Failed to read file: ${att.name}]` })
    }
  }

  // Add the user's text prompt
  if (prompt.trim()) {
    blocks.push({ type: 'text', text: prompt })
  }

  return blocks
}
