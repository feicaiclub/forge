import Database from 'better-sqlite3'
import path from 'path'
import fs from 'node:fs'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { getForgeDataDir, migrateFromOldDataDir } from './forge-data'

declare const globalThis: {
  __forgeDb?: Database.Database
} & typeof global

function getDbPath(): string {
  // Attempt migration from old .forge-data/ on first access
  migrateFromOldDataDir()
  return path.join(getForgeDataDir(), 'forge.db')
}

export function getDb(): Database.Database {
  if (globalThis.__forgeDb) return globalThis.__forgeDb

  const db = new Database(getDbPath())
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'New Session',
      workspace TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);

    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      scope TEXT NOT NULL DEFAULT 'workspace',
      enabled INTEGER NOT NULL DEFAULT 1,
      content TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
      permission_mode TEXT NOT NULL DEFAULT 'confirm',
      is_main INTEGER NOT NULL DEFAULT 0,
      parent_id TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      instructions TEXT NOT NULL DEFAULT '',
      soul TEXT NOT NULL DEFAULT '',
      identity TEXT NOT NULL DEFAULT '',
      tools_config TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (parent_id) REFERENCES agents(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS agent_skills (
      agent_id TEXT NOT NULL,
      skill_id TEXT NOT NULL,
      PRIMARY KEY (agent_id, skill_id),
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
      FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS mcp_servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      protocol TEXT NOT NULL DEFAULT 'stdio',
      config TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'disconnected',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_servers_name ON mcp_servers(name);

    CREATE TABLE IF NOT EXISTS im_channels (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('feishu', 'telegram', 'discord')),
      enabled INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'not_configured' CHECK (status IN ('connected', 'disconnected', 'not_configured', 'error')),
      credentials TEXT NOT NULL DEFAULT '{}',
      dm_policy TEXT NOT NULL DEFAULT 'open',
      group_policy TEXT NOT NULL DEFAULT 'open',
      trigger_mode TEXT NOT NULL DEFAULT 'mention',
      group_whitelist TEXT NOT NULL DEFAULT '[]',
      sender_whitelist TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cron_tasks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      schedule TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL DEFAULT '',
      action_type TEXT NOT NULL DEFAULT 'custom-prompt' CHECK (action_type IN ('run-agent', 'run-skill', 'custom-prompt')),
      agent_name TEXT NOT NULL DEFAULT '',
      skill_name TEXT NOT NULL DEFAULT '',
      workspace_id TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      is_heartbeat INTEGER NOT NULL DEFAULT 0,
      config TEXT NOT NULL DEFAULT '{}',
      last_run_at TEXT,
      last_run_result TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS task_executions (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      task_name TEXT NOT NULL,
      result TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'alert', 'error')),
      session_id TEXT NOT NULL DEFAULT '',
      executed_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (task_id) REFERENCES cron_tasks(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_task_executions_task ON task_executions(task_id, executed_at DESC);

    CREATE TABLE IF NOT EXISTS hooks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      event TEXT NOT NULL DEFAULT 'pre_tool',
      tool_pattern TEXT NOT NULL DEFAULT '*',
      action TEXT NOT NULL DEFAULT 'log' CHECK (action IN ('shell', 'block', 'log')),
      command TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      last_opened_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS api_providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      provider TEXT NOT NULL,
      api_key TEXT NOT NULL DEFAULT '',
      base_url TEXT NOT NULL DEFAULT '',
      model_name TEXT NOT NULL DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'not_configured',
      status_error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS channel_bindings (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      chat_name TEXT NOT NULL DEFAULT '',
      workspace TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (channel_id) REFERENCES im_channels(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS channel_permission_links (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      agent_id TEXT,
      permission_mode TEXT NOT NULL DEFAULT 'confirm',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (channel_id) REFERENCES im_channels(id) ON DELETE CASCADE,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS marketplace_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Seed API providers
    INSERT OR IGNORE INTO api_providers (id, name, provider) VALUES ('anthropic', 'Anthropic', 'anthropic');
    INSERT OR IGNORE INTO api_providers (id, name, provider) VALUES ('minimax', 'MiniMax', 'minimax');
    INSERT OR IGNORE INTO api_providers (id, name, provider) VALUES ('zhipu', 'GLM', 'zhipu');
    INSERT OR IGNORE INTO api_providers (id, name, provider) VALUES ('moonshot', 'Kimi', 'moonshot');
    INSERT OR IGNORE INTO api_providers (id, name, provider) VALUES ('qwen', 'Qwen', 'qwen');

    -- Seed IM channels
    INSERT OR IGNORE INTO im_channels (id, type) VALUES ('feishu', 'feishu');
    INSERT OR IGNORE INTO im_channels (id, type) VALUES ('telegram', 'telegram');
    INSERT OR IGNORE INTO im_channels (id, type) VALUES ('discord', 'discord');

    -- Seed heartbeat task (disabled by default — user enables in Schedule view)
    INSERT OR IGNORE INTO cron_tasks (id, name, is_heartbeat, schedule, action, config, enabled)
      VALUES ('heartbeat', 'Heartbeat', 1, '*/30 * * * *', '/heartbeat',
        '{"check_interval":"30m","notify_channel":"","notification_email":"","checklist_path":"HEARTBEAT.md"}', 0);
  `)

  // --- Migrations ---

  // Migrate workspaces table: old schema had (name, emoji, description, is_default), new has (path, last_opened_at)
  const wsCols = db.prepare("PRAGMA table_info(workspaces)").all() as { name: string }[]
  const wsColNames = wsCols.map(c => c.name)

  if (wsColNames.includes('is_default') && !wsColNames.includes('path')) {
    // Old schema detected — migrate
    const oldRows = db.prepare('SELECT * FROM workspaces').all() as Record<string, unknown>[]
    db.exec('DROP TABLE workspaces')
    db.exec(`
      CREATE TABLE workspaces (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        last_opened_at TEXT NOT NULL DEFAULT (datetime('now')),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)

    // Migrate default workspace with cwd as path
    const defaultWs = oldRows.find(r => r.is_default === 1)
    if (defaultWs) {
      db.prepare('INSERT INTO workspaces (id, path, created_at) VALUES (?, ?, ?)').run(
        defaultWs.id, process.cwd(), defaultWs.created_at as string
      )
    }
  }

  // Migrate sessions table: remove working_directory column if it exists
  const sessionCols = db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[]
  const sessionColNames = sessionCols.map(c => c.name)

  if (sessionColNames.includes('working_directory')) {
    // Rebuild sessions table without working_directory
    const sessionRows = db.prepare('SELECT id, title, workspace, model, status, created_at, updated_at FROM sessions').all()
    db.exec('DROP TABLE sessions')
    db.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT 'New Session',
        workspace TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)
    db.exec('CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at)')
    const insertSession = db.prepare('INSERT INTO sessions (id, title, workspace, model, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    for (const row of sessionRows as Record<string, unknown>[]) {
      insertSession.run(row.id, row.title, row.workspace, row.model, row.status, row.created_at, row.updated_at)
    }
  }

  // Migrate im_channels: old CHECK constraint didn't include 'disconnected'
  const imSchemaRow = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='im_channels'").get() as { sql: string } | undefined
  const needsImMigration = imSchemaRow && !imSchemaRow.sql.includes("'disconnected'")
  if (needsImMigration) {
    // Old schema missing 'disconnected' — recreate table with updated constraint
    const rows = db.prepare('SELECT * FROM im_channels').all()
    db.exec('DROP TABLE im_channels')
    db.exec(`
      CREATE TABLE im_channels (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK (type IN ('feishu', 'telegram', 'discord')),
        enabled INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'not_configured' CHECK (status IN ('connected', 'disconnected', 'not_configured', 'error')),
        credentials TEXT NOT NULL DEFAULT '{}',
        dm_policy TEXT NOT NULL DEFAULT 'open',
        group_policy TEXT NOT NULL DEFAULT 'open',
        trigger_mode TEXT NOT NULL DEFAULT 'mention',
        group_whitelist TEXT NOT NULL DEFAULT '[]',
        sender_whitelist TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)
    for (const row of rows as Record<string, unknown>[]) {
      db.prepare('INSERT INTO im_channels (id, type, enabled, status, credentials, dm_policy, group_policy, trigger_mode, group_whitelist, sender_whitelist, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
        row.id, row.type, row.enabled, row.status === 'disconnected' ? 'not_configured' : row.status,
        row.credentials, row.dm_policy, row.group_policy, row.trigger_mode,
        row.group_whitelist, row.sender_whitelist, row.created_at, row.updated_at
      )
    }
    // Re-seed if empty
    db.exec("INSERT OR IGNORE INTO im_channels (id, type) VALUES ('feishu', 'feishu')")
    db.exec("INSERT OR IGNORE INTO im_channels (id, type) VALUES ('telegram', 'telegram')")
    db.exec("INSERT OR IGNORE INTO im_channels (id, type) VALUES ('discord', 'discord')")
  }

  // Migrate im_channels: relax default policies from pairing/allowlist to open
  // (only updates rows that still have the old restrictive defaults + empty whitelists)
  db.prepare("UPDATE im_channels SET dm_policy = 'open' WHERE dm_policy = 'pairing' AND sender_whitelist = '[]'").run()
  db.prepare("UPDATE im_channels SET group_policy = 'open' WHERE group_policy = 'allowlist' AND group_whitelist = '[]'").run()

  // Migrate api_providers: add status + status_error columns
  const apCols = db.prepare("PRAGMA table_info(api_providers)").all() as { name: string }[]
  const apColNames = apCols.map(c => c.name)
  if (!apColNames.includes('status')) {
    db.exec("ALTER TABLE api_providers ADD COLUMN status TEXT NOT NULL DEFAULT 'not_configured'")
    db.exec("ALTER TABLE api_providers ADD COLUMN status_error TEXT NOT NULL DEFAULT ''")
  }

  // Migrate api_providers: add model_name column
  if (!apColNames.includes('model_name')) {
    db.exec("ALTER TABLE api_providers ADD COLUMN model_name TEXT NOT NULL DEFAULT ''")
  }

  // Migrate hooks table: remove CHECK constraint on event column to support new event types
  // (notification, stop, subagent_start, subagent_stop)
  // SQLite cannot ALTER CHECK constraints, so test if a new event value is accepted.
  try {
    // Try inserting a test row with a new event type; if CHECK rejects it, migrate
    db.exec("INSERT INTO hooks (id, name, event) VALUES ('__migration_test__', '__test__', 'notification')")
    db.exec("DELETE FROM hooks WHERE id = '__migration_test__'")
  } catch {
    // Old CHECK constraint blocks new event types — rebuild table without event CHECK
    const hookRows = db.prepare('SELECT * FROM hooks').all() as Record<string, unknown>[]
    db.exec('DROP TABLE hooks')
    db.exec(`
      CREATE TABLE hooks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        event TEXT NOT NULL DEFAULT 'pre_tool',
        tool_pattern TEXT NOT NULL DEFAULT '*',
        action TEXT NOT NULL DEFAULT 'log' CHECK (action IN ('shell', 'block', 'log')),
        command TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)
    const insertHook = db.prepare(
      'INSERT INTO hooks (id, name, event, tool_pattern, action, command, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    for (const row of hookRows) {
      insertHook.run(row.id, row.name, row.event, row.tool_pattern, row.action, row.command, row.enabled, row.created_at)
    }
  }

  // Migrate cron_tasks: add workspace_id, action_type, agent_name, skill_name columns
  const cronCols = db.prepare("PRAGMA table_info(cron_tasks)").all() as { name: string }[]
  const cronColNames = cronCols.map(c => c.name)
  if (!cronColNames.includes('workspace_id')) {
    db.exec("ALTER TABLE cron_tasks ADD COLUMN workspace_id TEXT NOT NULL DEFAULT ''")
  }
  if (!cronColNames.includes('action_type')) {
    db.exec("ALTER TABLE cron_tasks ADD COLUMN action_type TEXT NOT NULL DEFAULT 'custom-prompt'")
  }
  if (!cronColNames.includes('agent_name')) {
    db.exec("ALTER TABLE cron_tasks ADD COLUMN agent_name TEXT NOT NULL DEFAULT ''")
  }
  if (!cronColNames.includes('skill_name')) {
    db.exec("ALTER TABLE cron_tasks ADD COLUMN skill_name TEXT NOT NULL DEFAULT ''")
  }

  // Migrate task_executions: add session_id column
  const teCols = db.prepare("PRAGMA table_info(task_executions)").all() as { name: string }[]
  const teColNames = teCols.map(c => c.name)
  if (!teColNames.includes('session_id')) {
    db.exec("ALTER TABLE task_executions ADD COLUMN session_id TEXT NOT NULL DEFAULT ''")
  }

  // Migrate channel_bindings: add session_id column for per-session binding
  const cbCols = db.prepare("PRAGMA table_info(channel_bindings)").all() as { name: string }[]
  const cbColNames = cbCols.map(c => c.name)
  if (!cbColNames.includes('session_id')) {
    db.exec("ALTER TABLE channel_bindings ADD COLUMN session_id TEXT DEFAULT NULL")
  }

  // IM Bridge Layer 5 tables: outbound refs, audit logs, dedup
  db.exec(`
    CREATE TABLE IF NOT EXISTS channel_outbound_refs (
      id TEXT PRIMARY KEY,
      channel_type TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      internal_id TEXT NOT NULL,
      platform_msg_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_outbound_refs_lookup
      ON channel_outbound_refs(channel_type, chat_id, internal_id);

    CREATE TABLE IF NOT EXISTS channel_audit_logs (
      id TEXT PRIMARY KEY,
      channel_type TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      action TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_audit_logs_time
      ON channel_audit_logs(created_at DESC);

    CREATE TABLE IF NOT EXISTS channel_dedupe (
      hash TEXT PRIMARY KEY,
      channel_type TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)

  // --- Auto-sync MCP servers from Claude Code (~/.claude.json) ---
  syncMcpFromClaudeCode(db)

  globalThis.__forgeDb = db
  return db
}

/**
 * Read Claude Code's MCP server config from ~/.claude.json and auto-create
 * any servers that don't already exist in Forge's database.
 */
function syncMcpFromClaudeCode(db: Database.Database) {
  try {
    const claudeJsonPath = path.join(os.homedir(), '.claude.json')
    const raw = fs.readFileSync(claudeJsonPath, 'utf-8')
    const data = JSON.parse(raw)
    const mcpServers = data.mcpServers
    if (!mcpServers || typeof mcpServers !== 'object') return

    const insert = db.prepare(
      'INSERT OR IGNORE INTO mcp_servers (id, name, protocol, config, enabled, status) VALUES (?, ?, ?, ?, 1, ?)'
    )

    for (const [name, serverCfg] of Object.entries(mcpServers)) {
      const cfg = serverCfg as Record<string, unknown>
      const protocol = (cfg.type as string) || 'stdio'

      // Build config matching Forge's expected format
      const forgeConfig: Record<string, unknown> = {}
      if (protocol === 'stdio') {
        if (cfg.command) forgeConfig.command = cfg.command
        if (cfg.args) forgeConfig.args = cfg.args
        if (cfg.env && Object.keys(cfg.env as object).length > 0) forgeConfig.env = cfg.env
      } else {
        if (cfg.url) forgeConfig.url = cfg.url
        if (cfg.headers) forgeConfig.headers = cfg.headers
      }

      // INSERT OR IGNORE skips if name already exists (unique index on name)
      const status = testMcpConnection(protocol, forgeConfig)
      insert.run(crypto.randomUUID(), name, protocol, JSON.stringify(forgeConfig), status)
    }
  } catch {
    // ~/.claude.json doesn't exist or isn't valid — skip silently
  }
}

/**
 * Quick connectivity check for an MCP server config.
 * stdio: check if command binary exists. SSE/HTTP: skip (async fetch not available here).
 */
function testMcpConnection(protocol: string, config: Record<string, unknown>): string {
  if (protocol === 'stdio' && config.command) {
    try {
      const mainCmd = String(config.command).split(/\s+/)[0]
      // Check if it's an absolute path that exists, or use `which`
      if (mainCmd.startsWith('/')) {
        if (fs.existsSync(mainCmd)) return 'connected'
      } else {
        execFileSync('/usr/bin/which', [mainCmd], { timeout: 3000, encoding: 'utf-8' })
        return 'connected'
      }
    } catch { /* command not found */ }
    return 'error'
  }
  return 'disconnected'
}
