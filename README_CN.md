# Forge

**Local AI. Remote Control.** 一个跑在你电脑上的 AI 工作站，基于 Claude Agent SDK 构建。

[![GitHub release](https://img.shields.io/github/v/release/feicaiclub/forge)](https://github.com/feicaiclub/forge/releases)
[![Platform](https://img.shields.io/badge/platform-macOS-lightgrey)](https://github.com/feicaiclub/forge/releases)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

[English](./README.md)

[下载安装](#安装) | [快速开始](#快速开始) | [功能一览](#核心功能) | [IM Bridge](#im-bridge) | [Marketplace](#marketplace)

![Forge 桌面端](docs/screenshots/hero.png)

---

## 为什么选择 Forge

**你的工作流，打包即复用。** 大多数 AI 工具的 Marketplace 只提供单个插件——一个 Skill 一个 Agent，各自独立。但实际工作需要的是编排：一个顶层项目规则做调度，多个 Agent 各司其职，每个 Agent 关联多个 Skill。Forge 的 Marketplace 让你把整套编排打包成一个可复用的方案，新项目一键初始化。

**每个项目都是一个独立的团队。** 每个项目拥有自己的 Identity、Soul、Memory、Skills 和 Agents——全部存储在 `.claude/` 目录中，随使用逐渐丰满。切换项目就是切换团队。这不是一次性工具，是可以长期养成的 AI 团队。

**桌面应用，不是终端。** Claude Code 很强大，但它跑在终端里。Forge 把同样的 Claude Agent SDK 包装成原生桌面应用——流式响应、内联图片、工具调用展示、文件树、可视化定时任务。同样的能力，更低的门槛。

**随时随地远程操控。** 内置 IM Bridge，连接飞书、Telegram 和 Discord。用手机给 Agent 发消息，电脑上执行任务。三个平台均使用出站连接——无需公网 IP，无需暴露端口。

**记忆不会丢失。** Forge 维护丰富的结构化跨会话记忆——不仅是一个 CLAUDE.md，而是一整套体系：MEMORY.md 索引（前 200 行自动加载）、Agent 驱动的每日记忆、按领域拆分的主题文件、7 天自动归档，井井有条且永不丢失。

---

## 快速开始

### 路径 A：下载安装（普通用户）

1. 安装 Claude Code CLI：`npm install -g @anthropic-ai/claude-code`
2. 认证登录：`claude login`
3. 从 [Releases](https://github.com/feicaiclub/forge/releases/latest) 页面下载 DMG
4. 打开 Forge，完成引导配置，选择项目文件夹
5. 输入 `/init` 开始工作区个性化配置

### 路径 B：从源码构建（开发者）

| 前置依赖 | 最低版本 |
|---|---|
| Node.js | 20+ |
| pnpm | 9+ |
| Claude Code CLI | 已安装并登录 |

```bash
git clone https://github.com/feicaiclub/forge.git
cd forge
pnpm install
pnpm dev
```

---

## 核心功能

### 对话与工作区

| 功能 | 说明 |
|---|---|
| 桌面聊天 | 流式响应、代码高亮、工具调用展示、内联图片显示 |
| 权限控制 | Ask Permissions / Full Access，逐操作审批 |
| 会话管理 | 每个项目多会话、持久历史、切换时后台不中断 |
| 附件 | 图片、PDF、代码文件、文档——Agent 看到的是内容而非文件名 |
| 文件浏览器 | 项目文件树 + 实时热监听（外部修改自动刷新） |
| 多模型 | Claude Opus 4.6 / Sonnet 4.6 / Haiku 4.5、MiniMax M2.7、GLM-5 Turbo、Kimi K2 Thinking、Qwen 3.5 Flash、自定义端点 |
| 双语界面 | 中文 + 英文 |

### 记忆系统

| 功能 | 说明 |
|---|---|
| MEMORY.md 索引 | 每次会话自动加载前 200 行，保持 context 精简 |
| 每日记忆 | `memory/YYYY-MM-DD.md`——Agent 自主驱动，只记有价值的 |
| 自动加载 | 最近 2 天的每日记忆自动加载 |
| 7 天归档 | 超过 7 天的记忆自动摘要归档，永不丢失 |
| 主题文件 | `memory/debugging.md`、`memory/api-conventions.md` 等——按需读取 |
| 透明可控 | 所有记忆都是纯 Markdown，可查看可编辑 |

### Marketplace 与 Skills

| 功能 | 说明 |
|---|---|
| 方案模板 | 整套编排打包（项目规则 + Agents + Skills + 记忆模板）为可复用单元 |
| 一键复用 | 当前项目配置保存到 Marketplace，或从模板初始化新项目 |
| Skills 系统 | 全局（`~/.claude/skills/`）+ 项目级，兼容 Claude Code |
| Sub-Agents | 项目级和全局 Agent，父 Agent 调度子 Agent 执行专项任务 |

### 扩展与集成

| 功能 | 说明 |
|---|---|
| IM Bridge | 飞书 / Telegram / Discord——内置，出站连接，13 条 IM 命令 |
| 图片文件收发 | 双向：发图片给 Agent 分析，接收 Agent 生成的文件 |
| MCP 服务器 | 与 Claude Code 配置自动同步，运行时状态监控 |
| 定时任务 | 可视化创建（一次性 / 分钟 / 小时 / 天 / 周 / 月），Heartbeat 心跳巡查 + IM 通知 |
| 浏览器自动化 | Playwright 集成 |

---

## 项目配置

在 Forge 中打开项目文件夹后，`.claude/` 目录就是你 AI 团队的"家"。每个文件塑造你 Agent 的不同面向：

```
<project>/
└── .claude/
    ├── CLAUDE.md        # 项目规则——Agent 应该做什么、不该做什么
    ├── SOUL.md          # 性格——沟通风格、语气、价值观
    ├── IDENTITY.md      # 身份——Agent 的名字、角色、标志性 emoji
    ├── USER.md          # 关于你——你的角色、偏好、背景
    ├── MEMORY.md        # 记忆索引——每次会话自动加载前 200 行
    ├── HEARTBEAT.md     # 定期检查——Agent 按计划执行的巡查任务
    ├── memory/          # 每日记忆 + 主题文件
    ├── agents/          # Sub-Agent 定义（.md 文件）
    ├── skills/          # 项目专属 Skills
    └── rules/           # 条件规则（按路径生效）
```

你可以在 Forge 内置编辑器中直接编辑这些文件，也可以用 `/init` 通过对话引导自动生成。

全局资源（`~/.claude/skills/` 和 `~/.claude/agents/`）跨项目共享，与 Claude Code 同步。

---

## /init — 对话式工作区配置

第一次打开项目？在聊天框输入 `/init`。Agent 会用 6 个问题引导你完成个性化配置：

| # | 问什么 | 配置什么 |
|---|---|---|
| Q1 | 这个项目是做什么的？你希望我帮你做哪类工作？ | CLAUDE.md — 项目描述和目标 |
| Q2 | 用中文还是英文回复？还是看情况切换？ | CLAUDE.md — 语言偏好 |
| Q3 | 介绍一下你自己——你的角色、背景 | USER.md — 用户画像 |
| Q4 | 你希望我是什么风格？严谨？轻松？简洁？ | SOUL.md + IDENTITY.md — 性格和身份 |
| Q5 | 有什么我绝对不能做的？需要特别注意的规则？ | CLAUDE.md — 边界和约束 |
| Q6 | 需要我定期检查什么？GitHub issue、CI 状态？ | HEARTBEAT.md — 定期检查项 |

每个问题都可以跳过——Agent 会填入合理的默认值。如果 `.claude/` 已有配置文件，Agent 会先读取再补充缺失的部分。

![/init 对话采访](docs/screenshots/init-interview.png)

---

## Marketplace

Forge 的 Marketplace 不是插件商店——是**方案库**。每个模板保存的是一整套编排：项目规则、多个 Agent、多个 Skill、配置文件，打包成一个方案。

### 保存方案

当你调试好一个满意的项目配置时：

1. 在聊天中输入 `/save-as-template`
2. 输入方案名称
3. 完成——你的 `.claude/` 配置（排除记忆和心跳等运行时数据）已保存到 Marketplace

### 使用方案

从已有模板创建新项目：

1. 点击侧栏 Marketplace
2. 选择一个方案
3. 点击「Use This Template」→ 选择文件夹 → 输入项目名
4. Forge 自动创建项目、导入配置、打开新会话

### 从零创建

你也可以在 Marketplace 编辑器中手动构建模板——添加文件、组织文件夹、编写 Agent 定义和 Skill，全部在 Forge 内完成。

![Marketplace](docs/screenshots/marketplace.png)

---

## IM Bridge

内置飞书、Telegram 和 Discord 桥接。无需额外部署服务——在 Forge 中配置 Bot Token 即可开始。

### 配置

**飞书：**
1. 在[飞书开放平台](https://open.feishu.cn/)创建应用
2. 启用 `im.message.receive_v1` 事件订阅（WebSocket 模式）
3. 在 Forge > IM Channels > Feishu 中填入 App ID 和 App Secret

**Telegram：**
1. 通过 [@BotFather](https://t.me/BotFather) 创建 Bot
2. 在 Forge > IM Channels > Telegram 中填入 Bot Token

**Discord：**
1. 在 [Discord Developer Portal](https://discord.com/developers) 创建应用
2. 启用 MESSAGE CONTENT 特权意图
3. 在 Forge > IM Channels > Discord 中填入 Bot Token

### IM 命令

连接后，你可以完全通过消息命令操控 Forge：

| 命令 | 功能 |
|---|---|
| `/new` | 新建会话 |
| `/bind <id>` | 绑定到已有会话 |
| `/sessions` | 列出所有会话 |
| `/clear` | 清空当前会话 |
| `/compact` | 压缩会话历史 |
| `/projects` | 列出所有项目 |
| `/switch <name>` | 切换到其他项目 |
| `/newproject <path>` | 创建并切换到新项目 |
| `/model [name]` | 查看或切换模型 |
| `/mode [confirm\|full]` | 切换权限模式 |
| `/status` | 查看当前会话/项目/模型信息 |
| `/stop` | 停止正在运行的任务 |
| `/help` | 显示所有命令 |

### 图片与文件收发

IM Bridge 支持双向多媒体：

- **你 → Agent**：发送图片让 Agent 分析，发送文件（PDF、代码、文档）让 Agent 处理
- **Agent → 你**：Agent 下载或生成的文件自动通过 IM 发送给你

![IM Bridge](docs/screenshots/im-bridge.png)

---

## 定时任务

可视化创建定期任务——不需要手写 cron 表达式。

| 功能 | 说明 |
|---|---|
| 频率 | 一次性 / 每 X 分钟 / 每小时 / 每天 / 每周 / 每月 |
| 动作类型 | 运行 Agent / 运行 Skill / 自定义 Prompt |
| 通知 | 执行结果发送到飞书 / Telegram / Discord |
| 执行 | 每次运行自动新建 Session（可在聊天列表中查看） |
| Heartbeat | 通过 HEARTBEAT.md 检查清单定期巡查，无事静默 |

![定时任务](docs/screenshots/schedule.png)

---

## 桌面端斜杠命令

在聊天输入框中输入 `/` 查看所有可用命令：

| 命令 | 功能 |
|---|---|
| `/init` | 启动工作区配置引导 |
| `/model [name]` | 切换模型（无参数 = 弹出选择器） |
| `/clear` | 清空当前会话消息 |
| `/compact` | 压缩会话历史以节省 context |
| `/cost` | 查看当前会话 Token 用量 |
| `/diff` | 显示当前项目的 git diff |
| `/export` | 导出会话为 Markdown |
| `/memory` | 在编辑器中打开 MEMORY.md |
| `/rename <title>` | 重命名当前会话 |
| `/stop` | 停止当前 Agent 执行 |
| `/save-as-template` | 保存项目配置到 Marketplace |
| `/workspace` | 切换项目 |

Skills、Agents 和 MCP 工具也会出现在自动补全下拉菜单中，按类别分组显示。

---

## 安装

| 平台 | 格式 | 架构 |
|---|---|---|
| macOS | .dmg | arm64（Apple Silicon） |

从 [Releases](https://github.com/feicaiclub/forge/releases/latest) 页面下载。

> Intel Mac 用户：通过 `pnpm package` 从源码构建。

<details>
<summary>macOS：首次启动 Gatekeeper 警告</summary>

应用使用 ad-hoc 签名（未公证）。首次启动时：

**方法 1** — 在 Finder 中右键 `Forge.app` > 打开 > 确认。

**方法 2** — 系统设置 > 隐私与安全性 > 滚动到安全性 > 点击"仍要打开"。

**方法 3** — 在终端运行：
```bash
xattr -cr /Applications/Forge.app
```
</details>

---

## 常见问题

<details>
<summary>找不到 <code>claude</code> 命令</summary>

安装 Claude Code CLI：
```bash
npm install -g @anthropic-ai/claude-code
```
然后运行 `claude login` 认证。确保 `claude --version` 能正常输出后再启动 Forge。
</details>

<details>
<summary>数据存在哪里？</summary>

所有应用数据在 `~/.forge/`：
- `forge.db` — SQLite 数据库（会话、消息、设置）
- `uploads/` — 用户上传和 Agent 生成的文件
- `marketplace/` — 保存的方案模板

项目级 Agent 配置在每个项目的 `.claude/` 目录中。
</details>

<details>
<summary>不安装 Claude Code CLI 能用吗？</summary>

可以，但有限制。你可以在引导页直接输入 Anthropic API Key。但部分功能（OAuth 认证、CLI 配置同步）需要安装 CLI。
</details>

<details>
<summary>IM Bridge 需要公网 IP 吗？</summary>

不需要。三个平台都使用出站连接：
- **飞书**：WebSocket 长连接（出站）
- **Telegram**：HTTP 长轮询（出站）
- **Discord**：Gateway WebSocket（出站）

无需公网 IP、端口转发或 webhook 服务器。
</details>

<details>
<summary>如何重置项目的 Agent 人格？</summary>

删除项目文件夹中的 `.claude/` 目录（或其中特定文件），然后重新运行 `/init`。Forge 会通过新一轮对话重新生成配置文件。
</details>

---

## 技术栈

- **桌面端**：Electron + Next.js 15（Turbopack）
- **数据库**：SQLite（better-sqlite3，WAL 模式）
- **AI**：Claude Agent SDK（`@anthropic-ai/claude-agent-sdk`）
- **样式**：Tailwind CSS
- **包管理**：pnpm

## 项目结构

```
forge/
├── electron/          # Electron 主进程 + preload
├── src/
│   ├── app/           # Next.js App Router（API 路由 + 页面）
│   ├── components/    # React 组件
│   ├── hooks/         # 自定义 React Hooks
│   └── lib/           # 核心逻辑
│       ├── sdk/       # Claude Agent SDK 集成
│       ├── im/        # IM Bridge（adapters、bridge-manager、delivery）
│       ├── cron/      # 定时任务引擎
│       └── ...
├── templates/         # /init 配置模板
└── electron-builder.json
```

<details>
<summary>开发命令</summary>

```bash
pnpm dev               # Next.js 开发服务器 + Electron
pnpm build             # 生产构建（Next.js + Electron）
pnpm package           # 打包 macOS DMG
```

**备注：**
- Electron 在 `127.0.0.1` 上启动 Next.js standalone 服务器，使用随机空闲端口
- SQLite 使用 WAL 模式实现快速并发读取
- `@larksuiteoapi/node-sdk` 从 webpack 外部化（serverExternalPackages）以保留原生 WebSocket 行为
</details>

---

## 致谢

Forge 的设计灵感来自 Peter Steinberger 的 [OpenClaw](https://openclaw.ai/)。工作区架构、记忆系统、IM Bridge 和 Heartbeat 概念均借鉴了 OpenClaw 的开创性设计。

基于 Anthropic 的 [Claude Agent SDK](https://docs.anthropic.com/en/docs/agents-and-tools) 构建。

## 许可证

[Apache License 2.0](LICENSE)

Copyright 2026 FEICAI
