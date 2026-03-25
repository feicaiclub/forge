'use client'

import { useState, useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { CustomSelect } from '@/components/ui/custom-select'
import { useI18n } from '@/components/providers/i18n-provider'
import { useImChannels } from '@/hooks/use-im-channels'
import { useSettings } from '@/hooks/use-settings'
import { LayoutDashboard, Send, MessageCircle, Gamepad2, ChevronRight } from 'lucide-react'
import type { ImChannel, ImChannelType, ImDmPolicy, ImGroupPolicy, ImTriggerMode } from '@/lib/types'

import type { LucideIcon } from 'lucide-react'

type SubPage = 'overview' | ImChannelType

interface PlatformMeta {
  label: string
  Icon: LucideIcon
  color: string
  credentialFields: { key: string; label?: string; labelKey?: string; placeholder: string; placeholderKey?: string; hintKey: string; type?: string }[]
  setupStepKeys: string[]
}

const PLATFORM_META: Record<ImChannelType, PlatformMeta> = {
  telegram: {
    label: 'Telegram',
    Icon: Send,
    color: 'text-indigo',
    credentialFields: [
      { key: 'bot_token', label: 'Bot Token', placeholder: '123456:ABC-DEF1234ghIkl-zyx57W2v...', hintKey: 'im.hint.tgBotToken', type: 'password' },
      { key: 'chat_id', label: 'Chat ID', placeholder: '-1001234567890', hintKey: 'im.hint.tgChatId' },
    ],
    setupStepKeys: ['im.setup.tg1', 'im.setup.tg2', 'im.setup.tg3', 'im.setup.tg4'],
  },
  feishu: {
    label: 'Feishu',
    Icon: MessageCircle,
    color: 'text-green',
    credentialFields: [
      { key: 'app_id', label: 'App ID', placeholder: 'cli_xxxxxxxxxx', hintKey: 'im.hint.fsAppId' },
      { key: 'app_secret', label: 'App Secret', placeholder: 'xxxxxxxxxxxxxxxxxxxxxxxx', hintKey: 'im.hint.fsAppSecret', type: 'password' },
      { key: 'platform', labelKey: 'im.label.platform', placeholder: '', hintKey: 'im.hint.fsPlatform' },
    ],
    setupStepKeys: ['im.setup.fs1', 'im.setup.fs2', 'im.setup.fs3', 'im.setup.fs4', 'im.setup.fs5'],
  },
  discord: {
    label: 'Discord',
    Icon: Gamepad2,
    color: 'text-coral',
    credentialFields: [
      { key: 'bot_token', label: 'Bot Token', placeholder: 'MTIzNDU2...XXXXXX.XXXXXXXXXX', hintKey: 'im.hint.dcBotToken', type: 'password' },
      { key: 'server_id', label: 'Server ID', placeholder: '123456789012345678', hintKey: 'im.hint.dcServerId' },
      { key: 'channel_id', labelKey: 'im.label.channelIdOptional', placeholder: '', placeholderKey: 'im.placeholder.dcChannelId', hintKey: 'im.hint.dcChannelId' },
    ],
    setupStepKeys: ['im.setup.dc1', 'im.setup.dc2', 'im.setup.dc3', 'im.setup.dc4'],
  },
}

export function ImView() {
  const { t } = useI18n()
  const { channels, updateChannel } = useImChannels()
  const [activePage, setActivePage] = useState<SubPage>('overview')

  const getChannel = (type: ImChannelType) => channels.find((c) => c.type === type)

  const NAV_ITEMS: { key: SubPage; label: string; Icon: LucideIcon }[] = [
    { key: 'overview', label: t('im.overview'), Icon: LayoutDashboard },
    { key: 'telegram', label: 'Telegram', Icon: Send },
    { key: 'feishu', label: 'Feishu', Icon: MessageCircle },
    { key: 'discord', label: 'Discord', Icon: Gamepad2 },
  ]

  return (
    <div className="flex h-full">
      {/* Sub Navigation */}
      <div className="w-[200px] shrink-0 bg-surface border-r border-subtle flex flex-col pt-4">
        <span className="px-4 text-[11px] font-semibold text-muted tracking-wider uppercase">{t('im.bridgeTitle')}</span>
        <nav className="flex flex-col gap-0.5 px-2 mt-2">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.key}
              onClick={() => setActivePage(item.key)}
              className={cn(
                'flex items-center gap-2 h-9 px-3 rounded-md text-[13px] transition-colors text-left',
                activePage === item.key
                  ? 'bg-surface-active text-primary font-medium'
                  : 'text-secondary hover:bg-surface-hover'
              )}
            >
              <item.Icon className={cn('w-4 h-4', activePage === item.key ? 'text-indigo' : 'text-muted')} />
              {item.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {activePage === 'overview' ? (
          <OverviewPage channels={channels} onToggle={updateChannel} onNavigate={setActivePage} />
        ) : (
          <PlatformPage
            key={activePage}
            channel={getChannel(activePage)}
            type={activePage}
            onUpdate={updateChannel}
          />
        )}
      </div>
    </div>
  )
}

/* ---------- Overview Page ---------- */

const BRIDGE_MODELS = [
  { value: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
  { value: 'kimi-k2.5', label: 'Kimi K2.5' },
  { value: 'kimi-k2-thinking', label: 'Kimi K2 Thinking' },
  { value: 'glm-5', label: 'GLM-5' },
  { value: 'glm-5-turbo', label: 'GLM-5 Turbo' },
  { value: 'MiniMax-M2.7', label: 'MiniMax M2.7' },
  { value: 'MiniMax-M2.7-highspeed', label: 'MiniMax M2.7 Highspeed' },
  { value: 'qwen3.5-plus', label: 'Qwen 3.5 Plus' },
  { value: 'qwen3.5-flash', label: 'Qwen 3.5 Flash' },
]

function OverviewPage({
  channels,
  onToggle,
  onNavigate,
}: {
  channels: ImChannel[]
  onToggle: (id: string, updates: Record<string, unknown>) => Promise<ImChannel>
  onNavigate: (page: SubPage) => void
}) {
  const { t } = useI18n()
  const { get, updateSettings } = useSettings()

  const [workDir, setWorkDir] = useState('')
  const [workspaces, setWorkspaces] = useState<{ id: string; path: string }[]>([])

  useEffect(() => {
    setWorkDir(get('bridge_default_work_dir', ''))
    // Fetch workspaces for dropdown
    fetch('/api/workspaces').then(r => r.json()).then((data: { id: string; path: string }[]) => {
      if (Array.isArray(data)) setWorkspaces(data)
    }).catch(() => {})
  }, [get])

  return (
    <>
      <div>
        <h1 className="text-[22px] font-semibold text-primary font-heading tracking-tight">{t('im.bridgeTitle')}</h1>
        <p className="text-[14px] text-secondary mt-1">
          {t('im.bridgeDesc')}
        </p>
      </div>

      {/* Bridge Defaults */}
      <div className="rounded-[10px] bg-surface border border-subtle p-5 space-y-4">
        <h2 className="text-[15px] font-semibold text-primary">{t('im.bridgeDefaults')}</h2>
        <p className="text-[12px] text-muted -mt-2">{t('im.bridgeDefaultsDesc')}</p>

        <div className="flex items-center gap-4">
          <div className="flex-1">
            <label className="text-[12px] font-medium text-secondary mb-1.5 block">{t('im.defaultWorkDir')}</label>
            {workspaces.length > 0 ? (
              <CustomSelect
                value={workDir}
                onChange={(v) => { setWorkDir(v); updateSettings({ bridge_default_work_dir: v }) }}
                options={[
                  { value: '', label: t('im.autoWorkspace') },
                  ...workspaces.map(ws => ({ value: ws.path, label: ws.path })),
                ]}
              />
            ) : (
              <input
                type="text"
                value={workDir}
                onChange={(e) => setWorkDir(e.target.value)}
                onBlur={() => updateSettings({ bridge_default_work_dir: workDir })}
                placeholder={t('im.autoWorkspace')}
                className="w-full h-9 px-3 rounded-md border border-subtle bg-elevated text-[13px] text-primary placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-indigo"
              />
            )}
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="w-[200px]">
            <label className="text-[12px] font-medium text-secondary mb-1.5 block">{t('im.defaultModel')}</label>
            <CustomSelect
              value={get('bridge_default_model', 'claude-sonnet-4-6')}
              onChange={(v) => updateSettings({ bridge_default_model: v })}
              options={BRIDGE_MODELS}
            />
          </div>
        </div>
      </div>

      {/* Channel cards */}
      <div className="space-y-3">
        {(['telegram', 'feishu', 'discord'] as ImChannelType[]).map((type) => {
          const channel = channels.find((c) => c.type === type)
          const meta = PLATFORM_META[type]
          if (!channel) return null

          const statusText = channel.status === 'connected' ? t('im.connected') : channel.status === 'error' ? t('im.error') : channel.status === 'disconnected' ? t('im.disconnected') : t('im.notConfigured')
          const statusClass = channel.status === 'connected' ? 'text-green font-medium' : channel.status === 'error' ? 'text-coral font-medium' : 'text-muted'

          return (
            <button
              key={type}
              onClick={() => onNavigate(type)}
              className="w-full flex items-center justify-between p-4 rounded-[10px] bg-surface border border-subtle hover:border-strong transition-colors group"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-[10px] bg-elevated flex items-center justify-center">
                  <meta.Icon className={cn('w-5 h-5', meta.color)} />
                </div>
                <div className="text-left">
                  <div className="text-[15px] font-semibold text-primary">{meta.label}</div>
                  <div className={cn('text-[12px]', statusClass)}>{statusText}</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div
                  onClick={(e) => { e.stopPropagation(); onToggle(channel.id, { enabled: !channel.enabled }) }}
                  className={cn(
                    'w-10 h-[22px] rounded-full p-0.5 transition-colors cursor-pointer',
                    channel.enabled ? 'bg-green' : 'bg-surface-active'
                  )}
                >
                  <div className={cn('w-[18px] h-[18px] rounded-full bg-white transition-transform duration-200', channel.enabled ? 'translate-x-[18px]' : 'translate-x-0')} />
                </div>
                <ChevronRight className="w-4 h-4 text-muted group-hover:text-secondary transition-colors" />
              </div>
            </button>
          )
        })}
      </div>
    </>
  )
}

/* ---------- Platform Settings Page ---------- */

function PlatformPage({
  channel,
  type,
  onUpdate,
}: {
  channel: ImChannel | undefined
  type: ImChannelType
  onUpdate: (id: string, updates: Record<string, unknown>) => Promise<ImChannel>
}) {
  const { t } = useI18n()
  const meta = PLATFORM_META[type]
  const [creds, setCreds] = useState<Record<string, string>>({})
  const [dmPolicy, setDmPolicy] = useState<ImDmPolicy>('open')
  const [groupPolicy, setGroupPolicy] = useState<ImGroupPolicy>('open')
  const [triggerMode, setTriggerMode] = useState<ImTriggerMode>('mention')
  const [senderWl, setSenderWl] = useState('')
  const [groupWl, setGroupWl] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)
  const [connectSuccess, setConnectSuccess] = useState(false)
  const [autoDetecting, setAutoDetecting] = useState(false)

  useEffect(() => {
    if (!channel) return
    setCreds(channel.credentials)
    setDmPolicy(channel.dmPolicy)
    setGroupPolicy(channel.groupPolicy)
    setTriggerMode(channel.triggerMode)
    setSenderWl(channel.senderWhitelist.join(', '))
    setGroupWl(channel.groupWhitelist.join(', '))
    setDirty(false)
  }, [channel])

  const handleSave = useCallback(async () => {
    if (!channel) return
    setSaving(true)
    try {
      await onUpdate(channel.id, {
        credentials: creds,
        dm_policy: dmPolicy,
        group_policy: groupPolicy,
        trigger_mode: triggerMode,
        sender_whitelist: senderWl.split(',').map((s) => s.trim()).filter(Boolean),
        group_whitelist: groupWl.split(',').map((s) => s.trim()).filter(Boolean),
      })
      setDirty(false)
    } finally {
      setSaving(false)
    }
  }, [channel, creds, dmPolicy, groupPolicy, triggerMode, senderWl, groupWl, onUpdate])

  const handleTestConnection = async () => {
    if (!channel) return
    setConnecting(true)
    setConnectError(null)
    setConnectSuccess(false)
    try {
      const res = await fetch(`/api/im-channels/${channel.id}/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'connect' }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Connection failed')
      }
      await onUpdate(channel.id, { status: 'connected' })
      setConnectSuccess(true)
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : 'Connection failed')
    } finally {
      setConnecting(false)
    }
  }

  const handleDisconnect = async () => {
    if (!channel) return
    setDisconnecting(true)
    setConnectError(null)
    setConnectSuccess(false)
    try {
      const res = await fetch(`/api/im-channels/${channel.id}/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'disconnect' }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Disconnect failed')
      }
      await onUpdate(channel.id, { status: 'disconnected' })
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : 'Disconnect failed')
    } finally {
      setDisconnecting(false)
    }
  }

  const handleAutoDetect = async () => {
    if (!channel) return
    setAutoDetecting(true)
    try {
      const res = await fetch(`/api/im-channels/${channel.id}/auto-detect`, { method: 'POST' })
      if (res.ok) {
        const data = await res.json()
        if (data.chat_id) {
          setCreds((prev) => ({ ...prev, chat_id: data.chat_id }))
          setDirty(true)
        }
      }
    } catch { /* ignore */ } finally {
      setAutoDetecting(false)
    }
  }

  const updateCred = (key: string, value: string) => {
    setCreds((prev) => ({ ...prev, [key]: value }))
    setDirty(true)
  }

  if (!channel) return <div className="text-secondary text-sm">{t('im.channelNotFound')}</div>

  return (
    <div className="space-y-6" onKeyDown={(e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); handleSave() }
    }}>
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-[22px] font-semibold text-primary font-heading tracking-tight">{meta.label}</h1>
          <p className="text-[14px] text-secondary mt-1">
            {t('im.connectBotDesc').replace('{platform}', meta.label)}
          </p>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-[12px] text-secondary">{channel.enabled ? t('common.enabled') : t('common.disabled')}</span>
          <div
            onClick={() => onUpdate(channel.id, { enabled: !channel.enabled })}
            className={cn(
              'w-10 h-[22px] rounded-full p-0.5 transition-colors cursor-pointer',
              channel.enabled ? 'bg-green' : 'bg-surface-active'
            )}
          >
            <div className={cn('w-[18px] h-[18px] rounded-full bg-white transition-transform duration-200', channel.enabled ? 'translate-x-[18px]' : 'translate-x-0')} />
          </div>
        </div>
      </div>

      {/* Credentials Card */}
      <div className="rounded-xl bg-surface border border-subtle p-5 space-y-4">
        <span className="text-[14px] font-semibold text-primary block">{t('im.credentials')}</span>

        {meta.credentialFields.map((field) => (
          <div key={field.key} className="space-y-1.5">
            <label className="block text-[12px] font-medium text-secondary">{field.labelKey ? t(field.labelKey) : field.label}</label>
            {field.key === 'platform' ? (
              <CustomSelect
                value={creds.platform || 'feishu'}
                onChange={(v) => updateCred('platform', v)}
                options={[{ value: 'feishu', label: t('im.platform.feishu') }, { value: 'lark', label: t('im.platform.lark') }]}
                size="sm"
              />
            ) : (
              <div className={cn('flex gap-2', field.key === 'chat_id' && type === 'telegram' ? 'items-center' : '')}>
                <input
                  type={field.type || 'text'}
                  value={creds[field.key] || ''}
                  onChange={(e) => updateCred(field.key, e.target.value)}
                  placeholder={field.placeholderKey ? t(field.placeholderKey) : field.placeholder}
                  className="w-full h-9 px-3 rounded-lg bg-elevated border border-subtle text-[13px] text-primary placeholder:text-muted outline-none focus:border-indigo"
                />
                {field.key === 'chat_id' && type === 'telegram' && (
                  <button
                    onClick={handleAutoDetect}
                    disabled={autoDetecting}
                    className="shrink-0 h-9 px-3 rounded-lg border border-indigo text-indigo text-[12px] font-medium hover:bg-indigo/10 transition-colors disabled:opacity-50"
                  >
                    {autoDetecting ? t('status.detecting') : t('button.autoDetect')}
                  </button>
                )}
              </div>
            )}
            <p className="text-[11px] text-tertiary">{field.hintKey ? t(field.hintKey) : ''}</p>
          </div>
        ))}

        {/* Action buttons */}
        <div className="flex items-center justify-between pt-1">
          {/* Connection status */}
          <div className="flex items-center gap-2">
            <div className={cn(
              'w-2 h-2 rounded-full',
              connecting || disconnecting ? 'bg-amber animate-pulse' : channel.status === 'connected' ? 'bg-green' : channel.status === 'error' ? 'bg-coral' : 'bg-muted'
            )} />
            <span className={cn(
              'text-[12px] font-medium',
              connecting || disconnecting ? 'text-amber' : channel.status === 'connected' ? 'text-green' : channel.status === 'error' ? 'text-coral' : 'text-muted'
            )}>
              {connecting ? t('status.connecting') : disconnecting ? t('status.disconnecting') : channel.status === 'connected' ? t('im.connected') : channel.status === 'error' ? t('im.error') : t('im.disconnected')}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={saving || !dirty}
              className={cn(
                'h-9 px-4 rounded-lg text-[13px] font-medium transition-colors',
                dirty ? 'bg-indigo text-white hover:opacity-90' : 'bg-indigo/50 text-white/50 cursor-not-allowed'
              )}
            >
              {saving ? t('status.saving') : t('common.save')}
            </button>
            {channel.status === 'connected' ? (
              <button
                onClick={handleDisconnect}
                disabled={disconnecting}
                className="h-9 px-4 rounded-lg border border-coral text-coral text-[13px] font-medium hover:bg-coral/10 transition-colors disabled:opacity-50"
              >
                {disconnecting ? t('status.disconnecting') : t('button.disconnect')}
              </button>
            ) : (
              <button
                onClick={handleTestConnection}
                disabled={connecting || !channel.enabled}
                className="h-9 px-4 rounded-lg border border-strong text-[13px] font-medium text-secondary hover:bg-surface-hover transition-colors disabled:opacity-50"
              >
                {connecting ? t('status.connecting') : t('button.connect')}
              </button>
            )}
          </div>
        </div>

        {connectError && (
          <div className="px-3 py-2 rounded-lg bg-coral/10 text-coral text-[12px]">
            {t('error.connectionError')} {connectError}
          </div>
        )}
        {connectSuccess && !connectError && (
          <div className="px-3 py-2 rounded-lg bg-green/10 text-green text-[12px]">
            {t('message.connectedSuccess')}
          </div>
        )}
      </div>

      {/* Access Control Card */}
      <div className="rounded-xl bg-surface border border-subtle p-5 space-y-4">
        <span className="text-[14px] font-semibold text-primary block">{t('im.accessControl')}</span>

        <div className="grid grid-cols-2 gap-4">
          <Field label={t('im.dmPolicy')}>
            <CustomSelect value={dmPolicy} onChange={(v) => { setDmPolicy(v as ImDmPolicy); setDirty(true) }}
              options={[{ value: 'pairing', label: t('im.policy.pairing') }, { value: 'allowlist', label: t('im.policy.allowlist') }, { value: 'open', label: t('im.policy.open') }, { value: 'disabled', label: t('im.policy.disabled') }]} size="sm" />
          </Field>
          <Field label={t('im.groupPolicy')}>
            <CustomSelect value={groupPolicy} onChange={(v) => { setGroupPolicy(v as ImGroupPolicy); setDirty(true) }}
              options={[{ value: 'allowlist', label: t('im.policy.allowlist') }, { value: 'open', label: t('im.policy.open') }, { value: 'disabled', label: t('im.policy.disabled') }]} size="sm" />
          </Field>
        </div>

        {/* Require @mention toggle */}
        <div className="flex items-center justify-between py-1">
          <div>
            <span className="text-[13px] font-medium text-primary">{t('im.requireMention')}</span>
            <p className="text-[11px] text-muted mt-0.5">{t('im.requireMentionDesc')}</p>
          </div>
          <div
            onClick={async () => {
              const newMode = triggerMode === 'mention' ? 'all' : 'mention'
              setTriggerMode(newMode)
              if (channel) { await onUpdate(channel.id, { trigger_mode: newMode }) }
            }}
            className={cn(
              'w-10 h-[22px] rounded-full p-0.5 transition-colors cursor-pointer',
              triggerMode === 'mention' ? 'bg-green' : 'bg-surface-active'
            )}
          >
            <div className={cn('w-[18px] h-[18px] rounded-full bg-white transition-transform duration-200', triggerMode === 'mention' ? 'translate-x-[18px]' : 'translate-x-0')} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label={t('im.senderWhitelist')}>
            <input
              value={senderWl}
              onChange={(e) => { setSenderWl(e.target.value); setDirty(true) }}
              placeholder={t('im.placeholder.senderWl').replace('{platform}', meta.label)}
              className="w-full h-9 px-3 rounded-lg bg-elevated border border-subtle text-[13px] text-primary placeholder:text-muted outline-none focus:border-indigo"
            />
          </Field>
          <Field label={t('im.groupWhitelist')}>
            <input
              value={groupWl}
              onChange={(e) => { setGroupWl(e.target.value); setDirty(true) }}
              placeholder={t('im.placeholder.groupWl')}
              className="w-full h-9 px-3 rounded-lg bg-elevated border border-subtle text-[13px] text-primary placeholder:text-muted outline-none focus:border-indigo"
            />
          </Field>
        </div>
      </div>

      {/* IM Commands Card */}
      <div className="rounded-xl bg-surface border border-subtle p-5 space-y-3">
        <span className="text-[14px] font-semibold text-primary block">{t('im.commands')}</span>
        <p className="text-[12px] text-secondary">{t('im.commandsDesc').replace('{platform}', meta.label)}</p>
        <div className="space-y-1.5">
          {[
            { cmd: '/new', descKey: 'im.cmd.new' },
            { cmd: '/bind <id>', descKey: 'im.cmd.bind' },
            { cmd: '/sessions', descKey: 'im.cmd.sessions' },
            { cmd: '/clear', descKey: 'im.cmd.clear' },
            { cmd: '/compact', descKey: 'im.cmd.compact' },
            { cmd: '/projects', descKey: 'im.cmd.projects' },
            { cmd: '/switch <name>', descKey: 'im.cmd.switch' },
            { cmd: '/newproject <path>', descKey: 'im.cmd.newproject' },
            { cmd: '/model [name]', descKey: 'im.cmd.model' },
            { cmd: '/mode [confirm|full]', descKey: 'im.cmd.mode' },
            { cmd: '/status', descKey: 'im.cmd.status' },
            { cmd: '/stop', descKey: 'im.cmd.stop' },
            { cmd: '/help', descKey: 'im.cmd.help' },
          ].map(({ cmd, descKey }) => (
            <div key={cmd} className="flex gap-2 text-[12px]">
              <code className="shrink-0 px-1.5 py-0.5 rounded bg-elevated text-indigo font-mono">{cmd}</code>
              <span className="text-secondary">{t(descKey)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Setup Guide Card */}
      <div className="rounded-xl bg-surface border border-subtle p-5 space-y-3">
        <span className="text-[14px] font-semibold text-primary block">{t('im.setupGuide')}</span>
        {meta.setupStepKeys.map((key, i) => (
          <p key={i} className="text-[13px] text-secondary leading-relaxed">{t(key)}</p>
        ))}
      </div>
    </div>
  )
}

/* ---------- Shared Components ---------- */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[12px] font-medium text-secondary mb-1.5">{label}</label>
      {children}
    </div>
  )
}
