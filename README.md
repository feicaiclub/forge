**Local AI. Remote Control.** A desktop AI workstation powered by Claude Agent SDK.

[![GitHub release](https://img.shields.io/github/v/release/feicaiclub/forge)](https://github.com/feicaiclub/forge/releases)
[![Platform](https://img.shields.io/badge/platform-macOS-lightgrey)](https://github.com/feicaiclub/forge/releases)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

[中文文档](./README_CN.md)

[Download](#installation) | [Quick Start](#quick-start) | [Features](#core-capabilities) | [IM Bridge](#im-bridge) | [Marketplace](#marketplace)

<img width="1552" height="1012" alt="Screenshot 2026-03-27 at 12 18 49" src="https://github.com/user-attachments/assets/15f637c0-e42b-439b-8c65-67222b1cc380" />

---

## Why Forge

**Your workflows, packaged and reusable.** Most AI tool marketplaces give you individual plugins — one Skill, one Agent, installed separately, existing in isolation. Real work requires orchestration: a top-level project rule, multiple Agents, each with its own Skills. Forge's Marketplace lets you package an entire orchestration as one reusable unit, and spin up new projects from it in one click.

**Every project is an independent team.** Each project gets its own Identity, Soul, Memory, Skills, and Agents — all stored in `.claude/` and growing richer with every interaction. Switch projects, switch teams. The longer you use it, the better it gets. This isn't a disposable tool. It's an AI team you cultivate over time.

**A desktop, not a terminal.** Claude Code is powerful, but it lives in the terminal. Forge wraps the same Claude Agent SDK in a native desktop app — streaming responses, inline images, tool call visualization, file tree, and a visual task scheduler. Same capability, lower barrier.

**Control from anywhere.** Built-in IM Bridge connects Forge to Feishu, Telegram, and Discord. Send a message from your phone, get work done on your machine. All three platforms use outbound connections — no public IP, no port exposure.

**Memory that persists.** Forge maintains rich, structured memory across sessions — not just a single CLAUDE.md, but a full system: MEMORY.md index (first 200 lines auto-loaded), Agent-driven daily logs, domain-specific topic files, and a 7-day auto-archive that keeps everything without cluttering context.

---

## Quick Start

### Path A: Download a release (most users)

1. Install the Claude Code CLI: `npm install -g @anthropic-ai/claude-code`
2. Authenticate: `claude login`
3. Download the DMG from the [Releases](https://github.com/feicaiclub/forge/releases/latest) page
4. Launch Forge, complete onboarding, select a project folder
5. Type `/init` to set up your workspace with a guided interview

### Path B: Build from source (developers)

| Prerequisite | Minimum version |
|---|---|
| Node.js | 20+ |
| pnpm | 9+ |
| Claude Code CLI | Installed and authenticated |

```bash
git clone https://github.com/feicaiclub/forge.git
cd forge
pnpm install
pnpm dev
```

---

## Core Capabilities

### Conversation & Workspace

| Capability | Details |
|---|---|
| Desktop chat | Streaming responses, code highlighting, tool call visualization, inline image display |
| Permission control | Ask Permissions / Full Access, per-action approval |
| Session management | Multiple sessions per project, persistent history, background execution continues during session switching |
| Attachments | Images, PDFs, code files, documents — Agent sees actual content, not just filenames |
| File browser | Project file tree with real-time hot watching (external changes refresh instantly) |
| Multi-model | Claude Opus 4.6 / Sonnet 4.6 / Haiku 4.5, MiniMax M2.7, GLM-5 Turbo, Kimi K2 Thinking, Qwen 3.5 Flash, custom endpoints |
| Bilingual UI | Chinese + English |

### Memory System

| Capability | Details |
|---|---|
| MEMORY.md index | First 200 lines auto-loaded each session, keeps context lean |
| Daily memory | `memory/YYYY-MM-DD.md` — Agent-driven, only records what matters |
| Auto-load | Last 2 days of daily memory loaded automatically |
| 7-day archive | Older memories summarized and archived, nothing lost |
| Topic files | `memory/debugging.md`, `memory/api-conventions.md`, etc. — read on demand |
| Transparency | All memory is plain Markdown, fully visible and editable |

### Marketplace & Skills

| Capability | Details |
|---|---|
| Solution templates | Package entire orchestrations (project rules + Agents + Skills + memory) as reusable units |
| One-click reuse | Save current project config to Marketplace, or init new projects from templates |
| Skills system | Global (`~/.claude/skills/`) + project-level, compatible with Claude Code |
| Sub-Agents | Project-level and global Agents, parent dispatches child for specialized tasks |

### Extensions & Integrations

| Capability | Details |
|---|---|
| IM Bridge | Feishu / Telegram / Discord — built-in, outbound connections only, 13 IM commands |
| Image & file transfer | Two-way: send images to Agent for analysis, receive Agent-generated files via IM |
| MCP servers | Auto-synced with Claude Code config, runtime status monitoring |
| Scheduled tasks | Visual scheduler (once / minutes / hourly / daily / weekly / monthly), Heartbeat monitoring with IM alerts |
| Browser automation | Playwright integration |

---

## Project Configuration

When you open a project folder in Forge, the `.claude/` directory becomes your Agent's home. Each file shapes a different aspect of your AI team:

```
<project>/
└── .claude/
    ├── CLAUDE.md        # Project rules — what the Agent should and shouldn't do
    ├── SOUL.md          # Personality — communication style, tone, values
    ├── IDENTITY.md      # Identity — Agent name, role, emoji
    ├── USER.md          # About you — your role, preferences, background
    ├── MEMORY.md        # Memory index — first 200 lines loaded every session
    ├── HEARTBEAT.md     # Periodic checks — tasks Agent runs on a schedule
    ├── memory/          # Daily logs + topic files
    ├── agents/          # Sub-Agent definitions (.md files)
    ├── skills/          # Project-specific skills
    └── rules/           # Conditional rules (path-scoped)
```

You can edit these files directly in Forge's built-in editor, or use `/init` to generate them through a guided conversation.

Global resources at `~/.claude/skills/` and `~/.claude/agents/` are shared across all projects and synced with Claude Code.

---

## /init — Guided Workspace Setup

First time opening a project? Type `/init` in the chat. The Agent walks you through 6 questions to personalize your workspace:

| # | What it asks | What it configures |
|---|---|---|
| Q1 | What is this project about? What kind of work should I help with? | CLAUDE.md — project description and goals |
| Q2 | Chinese or English? Or mix? | CLAUDE.md — language preference |
| Q3 | Tell me about yourself — your role, background | USER.md — user profile |
| Q4 | What style do you prefer? Professional? Casual? Concise? | SOUL.md + IDENTITY.md — personality and identity |
| Q5 | Any hard rules? Things I should never do? | CLAUDE.md — boundaries and constraints |
| Q6 | Anything to check periodically? GitHub issues, CI status? | HEARTBEAT.md — scheduled checks |

Every question can be skipped — the Agent fills in sensible defaults. If `.claude/` already has config files, the Agent reads them first and only fills in what's missing.

<img width="1552" height="1012" alt="Screenshot 2026-03-27 at 12 24 04" src="https://github.com/user-attachments/assets/88a2191d-be51-4784-9d10-96a0cc9419df" />

---

## Marketplace

Forge's Marketplace isn't a plugin store — it's a **solution library**. Each template captures an entire orchestration: project rules, multiple Agents, multiple Skills, and config files, all as one package.

### Save a solution

When you've tuned a project setup that works well:

1. Type `/save-as-template` in the chat
2. Enter a template name
3. Done — your `.claude/` config (excluding runtime data like memory and heartbeat) is saved to Marketplace

### Use a solution

Starting a new project from a saved template:

1. Go to Marketplace in the sidebar
2. Select a template
3. Click "Use This Template" → choose a folder → enter project name
4. Forge creates the project, imports all config, and opens a new session

### Create from scratch

You can also build templates manually in the Marketplace editor — add files, organize folders, write Agent definitions and Skills, all from within Forge.

<img width="1552" height="1012" alt="Screenshot 2026-03-27 at 12 32 59" src="https://github.com/user-attachments/assets/26d76006-e562-4ff1-8e80-5716376fcc6b" />

---

## IM Bridge

Built-in bridge to Feishu, Telegram, and Discord. No separate server to deploy — configure your bot token in Forge and start chatting.

### Setup

**Feishu:**
1. Create an app on [Feishu Open Platform](https://open.feishu.cn/)
2. Enable `im.message.receive_v1` event subscription (WebSocket mode)
3. Paste App ID and App Secret in Forge > IM Channels > Feishu

**Telegram:**
1. Create a bot via [@BotFather](https://t.me/BotFather)
2. Paste the bot token in Forge > IM Channels > Telegram

**Discord:**
1. Create an application on [Discord Developer Portal](https://discord.com/developers)
2. Enable MESSAGE CONTENT privileged intent
3. Paste the bot token in Forge > IM Channels > Discord

### IM Commands

Once connected, you can control Forge entirely from your messaging app:

| Command | What it does |
|---|---|
| `/new` | Create a new session |
| `/bind <id>` | Bind to an existing session |
| `/sessions` | List all sessions |
| `/clear` | Clear current session |
| `/compact` | Compress session history |
| `/projects` | List all projects |
| `/switch <name>` | Switch to a different project |
| `/newproject <path>` | Create and switch to a new project |
| `/model [name]` | Show or switch model |
| `/mode [confirm\|full]` | Switch permission mode |
| `/status` | Show current session/project/model info |
| `/stop` | Stop the running task |
| `/help` | Show all commands |

### Image & File Transfer

The bridge supports two-way media:

- **You → Agent**: Send images for analysis, send files (PDF, code, documents) for processing
- **Agent → You**: Agent downloads or generates files and sends them back through IM automatically

<img width="1552" height="1012" alt="Screenshot 2026-03-27 at 12 26 21" src="https://github.com/user-attachments/assets/a82c097c-6f7c-4fc1-ad68-c5dc777e3a23" />

---

## Scheduled Tasks

Create recurring tasks visually — no cron expressions needed.

| Feature | Details |
|---|---|
| Frequency | Once / Every X minutes / Hourly / Daily / Weekly / Monthly |
| Action types | Run Agent / Run Skill / Custom Prompt |
| Notifications | Send results to Feishu / Telegram / Discord |
| Execution | Each run creates a new Session (viewable in chat list) |
| Heartbeat | Periodic checks with HEARTBEAT.md checklist, silent when nothing to report |

<img width="1552" height="1012" alt="Screenshot 2026-03-27 at 12 29 14" src="https://github.com/user-attachments/assets/de7e1306-79a5-46a0-b946-cdaedd946021" />

---

## Desktop Slash Commands

Type `/` in the chat input to see all available commands:

| Command | What it does |
|---|---|
| `/init` | Start guided workspace setup interview |
| `/model [name]` | Switch model (no args = show picker) |
| `/clear` | Clear current session messages |
| `/compact` | Compress session history to save context |
| `/cost` | Show token usage for current session |
| `/diff` | Show git diff for current project |
| `/export` | Export session as Markdown |
| `/memory` | Open MEMORY.md in editor |
| `/rename <title>` | Rename current session |
| `/stop` | Stop current Agent execution |
| `/save-as-template` | Save project config to Marketplace |
| `/workspace` | Switch project |

Skills, Agents, and MCP tools also appear in the autocomplete dropdown, grouped by category.

---

## Installation

| Platform | Format | Architecture |
|---|---|---|
| macOS | .dmg | arm64 (Apple Silicon) |

Download from the [Releases](https://github.com/feicaiclub/forge/releases/latest) page.

> Intel Mac users: build from source with `pnpm package`.

<details>
<summary>macOS: Gatekeeper warning on first launch</summary>

The app is ad-hoc signed (not notarized). On first launch:

**Option 1** — Right-click `Forge.app` in Finder > Open > confirm.

**Option 2** — System Settings > Privacy & Security > scroll to Security > click Open Anyway.

**Option 3** — Run in Terminal:
```bash
xattr -cr /Applications/Forge.app
```
</details>

---

## FAQ

<details>
<summary><code>claude</code> command not found</summary>

Install the Claude Code CLI:
```bash
npm install -g @anthropic-ai/claude-code
```
Then authenticate with `claude login`. Make sure `claude --version` works before launching Forge.
</details>

<details>
<summary>Where is my data stored?</summary>

All application data is at `~/.forge/`:
- `forge.db` — SQLite database (sessions, messages, settings)
- `uploads/` — User-uploaded and Agent-generated files
- `marketplace/` — Saved solution templates

Project-level Agent config is in each project's `.claude/` directory.
</details>

<details>
<summary>Can I use Forge without Claude Code CLI?</summary>

Yes, but with limitations. You can enter an Anthropic API Key directly during onboarding. However, some features (OAuth authentication, CLI-synced settings) require the CLI to be installed.
</details>

<details>
<summary>IM Bridge: do I need a public IP?</summary>

No. All three platforms use outbound connections:
- **Feishu**: WebSocket long connection (outbound)
- **Telegram**: HTTP long polling (outbound)
- **Discord**: Gateway WebSocket (outbound)

No public IP, no port forwarding, no webhook server required.
</details>

<details>
<summary>How do I reset a project's Agent personality?</summary>

Delete the `.claude/` directory in your project folder (or specific files within it), then run `/init` again. Forge will regenerate the config files through a fresh interview.
</details>

---

## Tech Stack

- **Desktop**: Electron + Next.js 15 (Turbopack)
- **Database**: SQLite (better-sqlite3, WAL mode)
- **AI**: Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`)
- **Styling**: Tailwind CSS
- **Package Manager**: pnpm

## Project Structure

```
forge/
├── electron/          # Electron main process + preload
├── src/
│   ├── app/           # Next.js app router (API routes + pages)
│   ├── components/    # React components
│   ├── hooks/         # Custom React hooks
│   └── lib/           # Core logic
│       ├── sdk/       # Claude Agent SDK integration
│       ├── im/        # IM Bridge (adapters, bridge-manager, delivery)
│       ├── cron/      # Scheduled task engine
│       └── ...
├── templates/         # /init config file templates
└── electron-builder.json
```

<details>
<summary>Development commands</summary>

```bash
pnpm dev               # Next.js dev server + Electron
pnpm build             # Production build (Next.js + Electron)
pnpm package           # Build macOS DMG
```

**Notes:**
- Electron forks a Next.js standalone server on `127.0.0.1` with a random free port
- SQLite uses WAL mode for fast concurrent reads
- `@larksuiteoapi/node-sdk` is externalized from webpack (serverExternalPackages) to preserve native WebSocket behavior
</details>

---

## Acknowledgments

Forge is inspired by [OpenClaw](https://openclaw.ai/) by Peter Steinberger. The workspace architecture, memory system, IM bridge, and heartbeat concepts draw from OpenClaw's pioneering design.

Built with the [Claude Agent SDK](https://docs.anthropic.com/en/docs/agents-and-tools) by Anthropic.

## License

[Apache License 2.0](LICENSE)

Copyright 2026 FEICAI
