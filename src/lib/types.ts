/** Virtual workspace ID representing the global ~/.claude/ main agent */
export const GLOBAL_WORKSPACE_ID = '__global__'

export type SessionStatus = 'active' | 'archived'

export interface Session {
  id: string
  title: string
  workspace: string
  model: string
  permissionMode: string
  status: SessionStatus
  createdAt: string
  updatedAt: string
}

// Content block types for agent messages
export type PermissionStatus = 'pending' | 'allowed' | 'allowed_session' | 'denied' | 'timeout'

export type ToolRawContent =
  | { type: 'text'; text: string }
  | { type: 'web_search'; results: { title: string; url: string }[] }

export type ThinkingMode = 'off' | 'auto' | 'max'

/** Sub-agent intermediate content block */
export type AgentSubBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error: boolean }
  | { type: 'tool_progress'; tool_use_id: string; tool_name: string; elapsed_time_seconds: number }

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error: boolean }
  | { type: 'tool_raw_result'; tool_use_id: string; tool_name: string; raw_content: ToolRawContent }
  | { type: 'tool_progress'; tool_use_id: string; tool_name: string; elapsed_time_seconds: number }
  | { type: 'agent_content'; parent_tool_use_id: string; blocks: AgentSubBlock[] }
  | { type: 'permission_request'; requestId: string; toolName: string; toolInput: Record<string, unknown>; status: PermissionStatus; toolUseId?: string; toolFailed?: boolean }
  | { type: 'image_attachment'; url: string; name: string }
  | { type: 'file_attachment'; url: string; name: string; size: number; mimeType: string }

export interface Message {
  id: string
  sessionId: string
  role: 'user' | 'assistant'
  content: string
  blocks: ContentBlock[]
  createdAt: string
  /** Turn-level stats (only for assistant messages during/after streaming) */
  inputTokens?: number
  outputTokens?: number
  elapsedSeconds?: number
}

export interface Settings {
  key: string
  value: string
}

export type View = 'chat' | 'manage' | 'im' | 'schedule' | 'settings' | 'marketplace'

export interface Workspace {
  id: string
  path: string
  name: string
  lastOpenedAt: string
  createdAt: string
  /** Whether the workspace folder still exists on disk */
  exists?: boolean
}

export interface Skill {
  id: string
  name: string
  description: string
  scope: 'workspace' | 'global'
  enabled: boolean
  content: string
  createdAt: string
  updatedAt: string
}

export type PermissionMode = 'confirm' | 'full'

export interface Agent {
  id: string
  name: string
  description: string
  model: string
  permissionMode: PermissionMode
  isMain: boolean
  parentId: string | null
  enabled: boolean
  instructions: string
  soul: string
  identity: string
  toolsConfig: Record<string, boolean>
  skillIds: string[]
  createdAt: string
  updatedAt: string
}

export type McpProtocol = 'stdio' | 'sse' | 'http'
export type McpStatus = 'connected' | 'disconnected' | 'error'

export interface McpServer {
  id: string
  name: string
  protocol: McpProtocol
  config: Record<string, string>
  enabled: boolean
  status: McpStatus
  createdAt: string
  updatedAt: string
}

// API Provider types
export type ProviderType = 'anthropic' | 'minimax' | 'zhipu' | 'moonshot' | 'qwen' | 'bailian-codingplan' | 'custom'
export type ProviderProtocol = 'anthropic-compatible' | 'openai-compatible'
export type ApiProviderStatus = 'not_configured' | 'connected' | 'cli_authenticated' | 'error' | 'testing'

export interface ApiProvider {
  id: string
  name: string
  provider: ProviderType
  protocol: ProviderProtocol
  apiKey: string
  baseUrl: string
  modelName?: string
  isActive: boolean
  status: ApiProviderStatus
  statusError: string
  createdAt: string
  updatedAt: string
}

// IM Channel types
export type ImChannelType = 'feishu' | 'telegram' | 'discord'
export type ImChannelStatus = 'connected' | 'disconnected' | 'not_configured' | 'error'
export type ImDmPolicy = 'pairing' | 'allowlist' | 'open' | 'disabled'
export type ImGroupPolicy = 'allowlist' | 'open' | 'disabled'
export type ImTriggerMode = 'mention' | 'all'

export interface ImChannel {
  id: string
  type: ImChannelType
  enabled: boolean
  status: ImChannelStatus
  credentials: Record<string, string>
  dmPolicy: ImDmPolicy
  groupPolicy: ImGroupPolicy
  triggerMode: ImTriggerMode
  groupWhitelist: string[]
  senderWhitelist: string[]
  createdAt: string
  updatedAt: string
}

// Cron Task types
export type TaskExecutionStatus = 'ok' | 'alert' | 'error'
export type TaskActionType = 'run-agent' | 'run-skill' | 'custom-prompt'

/** Raw DB row shape for cron_tasks (snake_case columns) */
export interface CronTaskRow {
  id: string
  name: string
  schedule: string
  action: string
  action_type: string
  agent_name: string
  skill_name: string
  workspace_id: string
  enabled: number
  is_heartbeat: number
  config: string
  last_run_at: string | null
  last_run_result: string | null
  created_at: string
  updated_at: string
}

export interface CronTask {
  id: string
  name: string
  schedule: string
  action: string
  actionType: TaskActionType
  agentName: string
  skillName: string
  workspaceId: string
  enabled: boolean
  isHeartbeat: boolean
  config: Record<string, string>
  lastRunAt: string | null
  lastRunResult: string | null
  createdAt: string
  updatedAt: string
}

export interface TaskExecution {
  id: string
  taskId: string
  taskName: string
  result: string
  status: TaskExecutionStatus
  sessionId: string
  executedAt: string
}

// Marketplace types
export interface MarketplaceTemplate {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}
