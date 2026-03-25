/**
 * IM Bridge type definitions for the 5-layer architecture.
 *
 * Layers:
 *   L1 Adapter → L2 Bridge Manager → L3 Channel Router →
 *   L4 Conversation Engine → L5 Delivery Layer
 */

// ---------------------------------------------------------------------------
// Channel & status types
// ---------------------------------------------------------------------------

export type ChannelType = 'telegram' | 'feishu' | 'discord'

/** Runtime adapter status (L1) */
export type AdapterStatus = 'running' | 'stopped' | 'error'

/** Persistent bridge status stored in DB */
export type BridgeStatus = 'connected' | 'connecting' | 'disconnected' | 'error'

/** Streaming preview phase (L2 state machine) */
export type StreamingPhase = 'idle' | 'typing' | 'draft' | 'final'

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/** Normalized inbound message from any platform (L1 → L2) */
export interface IncomingMessage {
  channelType: ChannelType
  channelId: string        // DB channel id ('telegram' | 'feishu' | 'discord')
  chatId: string           // Platform-specific chat identifier
  messageId?: string       // Platform message ID for deduplication
  senderId: string
  senderName: string
  text: string
  isDm: boolean
  isGroupMention: boolean
  /** Attached images (downloaded, base64 encoded) */
  images?: Array<{ data: string; mimeType: string; name?: string }>
  /** Attached files (downloaded) */
  files?: Array<{ data: Buffer; name: string; mimeType: string; size: number }>
  rawEvent?: unknown       // Platform raw event for debugging
}

/** Outbound message to any platform (L5 → L1) */
export interface OutboundMessage {
  chatId: string
  text: string
  parseMode?: 'markdown' | 'plain'
  replyToMessageId?: string
  editMessageId?: string
  deleteMessageId?: string
  components?: unknown     // Platform-specific interactive components
}

// ---------------------------------------------------------------------------
// Permission
// ---------------------------------------------------------------------------

/** IM permission request forwarded during streaming (L4 → L1 via L2) */
export interface ImPermissionRequest {
  requestId: string
  toolName: string
  toolInput: Record<string, unknown>
  chatId: string
  channelType: ChannelType
  /** Original message sender — used to verify permission responses (P30 fix) */
  senderId: string
}

// ---------------------------------------------------------------------------
// IM Commands
// ---------------------------------------------------------------------------

/** Parsed IM command (L3) */
export interface ImCommand {
  name: string    // 'new' | 'bind' | 'cwd' | 'mode' | 'status'
  args: string[]
}

// ---------------------------------------------------------------------------
// Bridge state (backward compat for API / frontend)
// ---------------------------------------------------------------------------

export interface BridgeState {
  channelId: string
  type: ChannelType
  status: BridgeStatus
  error?: string
}

// ---------------------------------------------------------------------------
// Conversation result (L4 → L2)
// ---------------------------------------------------------------------------

export interface ConversationResult {
  text: string
  toolsUsed: string[]
  blocks: Record<string, unknown>[]
}

// ---------------------------------------------------------------------------
// Conversation callbacks (L2 → L4 → L1)
// ---------------------------------------------------------------------------

export interface ConversationCallbacks {
  onTyping: () => Promise<void>
  onDraft: (partialText: string) => Promise<void>
  onFinal: (text: string) => Promise<void>
  onPermissionRequest: (req: ImPermissionRequest) => Promise<'allow' | 'deny'>
  /** AbortSignal for cancelling the SDK query (timeout or /stop command) */
  abortSignal?: AbortSignal
}

// ---------------------------------------------------------------------------
// Delivery options (L5)
// ---------------------------------------------------------------------------

export interface DeliveryOptions {
  editMessageId?: string
  deleteMessageId?: string
  replyToId?: string
  isTypingIndicator?: boolean
  /** Skip dedup check (for ephemeral messages like "processing..." placeholders) */
  skipDedup?: boolean
}
