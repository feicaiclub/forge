# Forge

**Local AI agent desktop app** — chat, IM bridge, scheduled tasks. Powered by Claude Agent SDK.

Forge gives you a full desktop GUI for Claude agents, with the ability to bridge your agent to messaging platforms (Feishu, Telegram, Discord) and schedule automated tasks — all running locally on your machine.

## Features

- **Desktop Chat** — Real-time conversation with Claude agents, streaming responses, tool call visualization, file diff preview, code syntax highlighting
- **Multimodal** — Upload images, PDFs, code files, documents. Agent sees the actual content (not just filenames)
- **IM Bridge** — Bridge your agent to Feishu, Telegram, and Discord. Chat with your agent from your phone. Receive/send images and files
- **Scheduled Tasks** — Cron-based task scheduling with IM notification delivery. Heartbeat monitoring with customizable checklists
- **Project Workspaces** — Each project folder gets its own agent personality, memory, and configuration
- **Memory System** — MEMORY.md index (first 200 lines auto-loaded) + topic files (on-demand) + Agent-driven daily logs. Aligned with Claude Code's auto memory architecture
- **`/init` Interview** — Conversational workspace setup: Agent asks 6 questions, then generates personalized config files from pre-filled templates (behavioral guidelines, session rules, memory norms)
- **Skills & Agents** — Global skills/agents shared across projects (`~/.claude/skills/`, `~/.claude/agents/`), compatible with Claude Code
- **Multi-Provider** — Claude Opus/Sonnet/Haiku, Kimi, GLM, MiniMax, Qwen, and custom OpenAI-compatible endpoints
- **Bilingual** — Full Chinese and English UI

## Tech Stack

- **Desktop**: Electron + Next.js 15 (Turbopack)
- **Database**: SQLite (better-sqlite3, WAL mode)
- **AI**: Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`)
- **Styling**: Tailwind CSS
- **Package Manager**: pnpm

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm 9+
- Claude Code CLI installed (for OAuth authentication) or an Anthropic API key

### Development

```bash
git clone https://github.com/feicaiclub/forge.git
cd forge
pnpm install
pnpm dev
```

This starts both the Next.js dev server and the Electron app.

### Build & Package

```bash
# Build for macOS (Apple Silicon)
pnpm package:mac
```

The `.dmg` file will be in the `release/` directory.

> **Note**: The app is ad-hoc signed (not notarized). On first launch, right-click the app → "Open" → confirm to bypass Gatekeeper.

## Project Structure

```
forge/
├── electron/          # Electron main process + preload
├── src/
│   ├── app/           # Next.js app router (API routes + pages)
│   ├── components/    # React components (layout, views, manage)
│   ├── hooks/         # Custom React hooks
│   └── lib/           # Core logic
│       ├── sdk/       # Claude Agent SDK integration
│       ├── im/        # IM Bridge (adapters, bridge-manager, delivery)
│       ├── cron/      # Scheduled task engine
│       └── ...        # DB, workspace-fs, providers, etc.
├── templates/         # /init config file templates
├── build/             # Electron build resources
└── electron-builder.json  # Packaging configuration
```

## IM Bridge Setup

### Telegram
1. Create a bot via [@BotFather](https://t.me/BotFather)
2. Paste the bot token in Forge → IM Bridge → Telegram
3. Send `/start` to your bot, then click Auto Detect

### Feishu
1. Create an app on [Feishu Open Platform](https://open.feishu.cn/)
2. Enable `im.message.receive_v1` event subscription
3. Paste App ID and App Secret in Forge

### Discord
1. Create an application on [Discord Developer Portal](https://discord.com/developers)
2. Enable MESSAGE CONTENT privileged intent
3. Paste the bot token in Forge

## Acknowledgments

Forge is inspired by [OpenClaw](https://openclaw.ai/) by Peter Steinberger. The workspace architecture, memory system, IM bridge, and heartbeat concepts draw from OpenClaw's pioneering design.

Built with the [Claude Agent SDK](https://docs.anthropic.com/en/docs/agents-and-tools) by Anthropic.

## License

[Apache License 2.0](LICENSE)

Copyright 2026 FEICAI
