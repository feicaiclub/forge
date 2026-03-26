'use client'

import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { Key, Shield, FolderOpen, Palette, Database, Plus, Trash2, ChevronRight, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useModels } from '@/hooks/use-models'
import { CustomSelect } from '@/components/ui/custom-select'
import { useTheme } from '@/components/providers/theme-provider'
import { useI18n } from '@/components/providers/i18n-provider'
import { useSettings } from '@/hooks/use-settings'
import { useApiProviders } from '@/hooks/use-api-providers'
import type { ApiProvider } from '@/lib/types'

const BUILTIN_PROVIDER_ORDER = ['anthropic', 'minimax', 'zhipu', 'moonshot', 'qwen'] as const
const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Anthropic',
  minimax: 'MiniMax',
  zhipu: 'GLM',
  moonshot: 'Kimi',
  qwen: 'Qwen',
}

const PROVIDER_COLORS: Record<string, string> = {
  anthropic: '#6366F1',
  minimax: '#FF6B35',
  zhipu: '#3B82F6',
  moonshot: '#8B5CF6',
  qwen: '#FF6A00',
}

// MODELS loaded dynamically via useModels() hook inside the component.

type NavSection = 'model' | 'permissions' | 'project' | 'appearance' | 'data'

const NAV_ICONS: Record<NavSection, typeof Key> = {
  model: Key,
  permissions: Shield,
  project: FolderOpen,
  appearance: Palette,
  data: Database,
}

const NAV_I18N_KEYS: Record<NavSection, string> = {
  model: 'settings.modelApi',
  permissions: 'settings.permission',
  project: 'settings.project',
  appearance: 'settings.appearance',
  data: 'settings.data',
}

const NAV_SECTIONS: NavSection[] = ['model', 'permissions', 'project', 'appearance', 'data']

export function SettingsView() {
  const { theme, setTheme } = useTheme()
  const { locale, setLocale, t } = useI18n()
  const { get, updateSettings } = useSettings()
  const { models } = useModels()
  const MODELS = models.map(m => ({ value: m.id, label: m.label }))
  const { providers, updateProvider, testConnection, createProvider, deleteProvider } = useApiProviders()
  const [activeSection, setActiveSection] = useState<NavSection>('model')
  const [clearConfirm, setClearConfirm] = useState(false)
  const [clearing, setClearing] = useState(false)
  const dataPath = typeof window !== 'undefined' ? (window.electronAPI?.forgeDataPath || '') : ''

  const handleSettingChange = useCallback((key: string, value: string) => {
    updateSettings({ [key]: value })
  }, [updateSettings])

  const handleExport = useCallback(async (format: 'json' | 'markdown' = 'json') => {
    try {
      const res = await fetch('/api/data/export')
      if (!res.ok) return
      const data = await res.json()
      const dateSuffix = new Date().toISOString().slice(0, 10)

      if (format === 'markdown') {
        const md = convertExportToMarkdown(data)
        const blob = new Blob([md], { type: 'text/markdown' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `forge-export-${dateSuffix}.md`
        a.click()
        URL.revokeObjectURL(url)
      } else {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `forge-export-${dateSuffix}.json`
        a.click()
        URL.revokeObjectURL(url)
      }
    } catch { /* ignore */ }
  }, [])

  const handleClearAll = useCallback(async () => {
    if (!clearConfirm) {
      setClearConfirm(true)
      return
    }
    setClearing(true)
    try {
      await fetch('/api/data/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      })
      window.location.reload()
    } catch { /* ignore */ }
    setClearing(false)
    setClearConfirm(false)
  }, [clearConfirm])

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center h-[60px] px-8 border-b border-subtle shrink-0">
        <span className="text-[20px] font-bold text-primary">{t('settings.title')}</span>
      </div>

      {/* Body: Nav sidebar + Content panel */}
      <div className="flex flex-1 min-h-0">
        {/* Nav sidebar */}
        <nav className="w-[180px] shrink-0 border-r border-subtle bg-surface py-4 space-y-0.5">
          {NAV_SECTIONS.map((id) => {
            const Icon = NAV_ICONS[id]
            const isActive = activeSection === id
            return (
              <button
                key={id}
                onClick={() => setActiveSection(id)}
                className={cn(
                  'flex items-center gap-2.5 h-9 px-4 text-[13px] font-medium rounded-md mx-1 transition-colors',
                  isActive
                    ? 'bg-surface-active text-primary'
                    : 'text-secondary hover:bg-surface-hover hover:text-primary'
                )}
                style={{ width: 'calc(100% - 8px)' }}
              >
                <Icon size={16} className={isActive ? 'text-indigo' : ''} />
                {t(NAV_I18N_KEYS[id])}
              </button>
            )
          })}
        </nav>

        {/* Content panel */}
        <div className="flex-1 overflow-y-auto px-8 py-6">
          <div key={activeSection} className="animate-fade-in space-y-6">
            {activeSection === 'model' && (
              <ModelApiSection
                get={get}
                handleSettingChange={handleSettingChange}
                providers={providers}
                updateProvider={updateProvider}
                testConnection={testConnection}
                onCreateCustomProvider={createProvider}
                onDeleteProvider={deleteProvider}
              />
            )}
            {activeSection === 'permissions' && (
              <PermissionsSection get={get} handleSettingChange={handleSettingChange} t={t} />
            )}
            {activeSection === 'project' && (
              <ProjectSection get={get} handleSettingChange={handleSettingChange} t={t} />
            )}
            {activeSection === 'appearance' && (
              <AppearanceSection
                get={get}
                handleSettingChange={handleSettingChange}
                theme={theme}
                setTheme={setTheme}
                locale={locale}
                setLocale={setLocale}
                t={t}
              />
            )}
            {activeSection === 'data' && (
              <DataSection
                get={get}
                handleSettingChange={handleSettingChange}
                handleExport={handleExport}
                handleClearAll={handleClearAll}
                clearConfirm={clearConfirm}
                clearing={clearing}
                t={t}
                dataPath={dataPath}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── Section Components ── */

interface SectionProps {
  get: (key: string, defaultValue?: string) => string
  handleSettingChange: (key: string, value: string) => void
  t?: (key: string) => string
}

function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="space-y-1">
      <h2 className="text-[18px] font-bold text-primary">{title}</h2>
      {description && <p className="text-[13px] text-secondary">{description}</p>}
    </div>
  )
}

function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-surface border border-subtle p-5 space-y-4">
      {title && (
        <>
          <h3 className="text-[15px] font-semibold text-primary">{title}</h3>
          <div className="h-px bg-subtle" />
        </>
      )}
      <div className="space-y-4">{children}</div>
    </div>
  )
}

function ModelApiSection({
  get, handleSettingChange,
  providers, updateProvider, testConnection,
  onCreateCustomProvider, onDeleteProvider,
}: SectionProps & {
  providers: ApiProvider[]
  updateProvider: (id: string, updates: Record<string, unknown>) => Promise<ApiProvider>
  testConnection: (id: string) => Promise<ApiProvider | null>
  onCreateCustomProvider?: (data: { name: string; baseUrl: string; apiKey: string; modelName: string }) => Promise<ApiProvider>
  onDeleteProvider?: (id: string) => Promise<void>
}) {
  const { t } = useI18n()
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showAddCustom, setShowAddCustom] = useState(false)
  const customProviders = providers.filter((p) => p.id.startsWith('custom-'))

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id))
    setShowAddCustom(false)
  }

  const allProviders: { id: string; provider: ApiProvider | undefined }[] = [
    ...BUILTIN_PROVIDER_ORDER.map((id) => ({ id, provider: providers.find((p) => p.id === id) })),
    ...customProviders.map((p) => ({ id: p.id, provider: p })),
  ]

  return (
    <>
      <SectionHeader title={t('settings.modelApi')} description={t('settings.modelApiDesc')} />

      <div className="rounded-xl bg-surface border border-subtle overflow-hidden">
        <div className="px-5 pt-4 pb-3">
          <h3 className="text-[15px] font-semibold text-primary">{t('settings.providers')}</h3>
        </div>

        <div className="divide-y divide-subtle">
          {allProviders.map(({ id, provider: prov }) => {
            const isExpanded = expandedId === id
            const isCustom = id.startsWith('custom-')
            const label = isCustom ? (prov?.name || 'Custom') : (PROVIDER_LABELS[id] || id)
            const dotColor = isCustom ? '#6B6B70' : (PROVIDER_COLORS[id] || '#6B6B70')

            return (
              <div key={id} className={isExpanded ? 'bg-elevated' : ''}>
                {/* Provider header row */}
                <button
                  onClick={() => toggleExpand(id)}
                  className={cn(
                    'flex items-center justify-between w-full h-12 px-5 transition-colors',
                    !isExpanded && 'hover:bg-surface-hover'
                  )}
                >
                  <div className="flex items-center gap-2.5">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: dotColor }} />
                    <span className="text-[14px] font-medium text-primary">{label}</span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <ProviderStatusBadge provider={prov} />
                    {isExpanded
                      ? <ChevronDown size={16} className="text-muted shrink-0" />
                      : <ChevronRight size={16} className="text-muted/60 shrink-0" />
                    }
                  </div>
                </button>

                {/* Expanded config panel */}
                {isExpanded && prov && (
                  <div className="px-5 pb-4 space-y-3.5 animate-fade-in">
                    <div className="h-px bg-subtle" />
                    <ProviderConfig
                      provider={prov}
                      onUpdate={updateProvider}
                      onTestConnection={testConnection}
                      onDelete={isCustom ? onDeleteProvider : undefined}
                      settingsGet={get}
                      settingsChange={handleSettingChange}
                    />
                  </div>
                )}
              </div>
            )
          })}

          {/* Add Custom Provider row */}
          <div>
            <button
              onClick={() => { setShowAddCustom((v) => !v); setExpandedId(null) }}
              className="flex items-center gap-2 w-full h-11 px-5 hover:bg-surface-hover transition-colors"
            >
              <Plus size={16} className="text-indigo" />
              <span className="text-[13px] font-medium text-indigo">{t('button.addCustomProvider')}</span>
            </button>
            {showAddCustom && onCreateCustomProvider && (
              <div className="px-5 pb-4 animate-fade-in">
                <AddCustomProviderForm
                  onCreate={async (data) => {
                    const created = await onCreateCustomProvider(data)
                    setShowAddCustom(false)
                    if (created) setExpandedId(created.id)
                  }}
                  onCancel={() => setShowAddCustom(false)}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

/* ── Provider Status Badge ── */

function ProviderStatusBadge({ provider }: { provider: ApiProvider | undefined }) {
  const { t } = useI18n()
  if (!provider) return null
  switch (provider.status) {
    case 'connected':
      return <span className="text-[11px] font-medium text-green bg-green/15 px-2 py-0.5 rounded-full">{t('status.connected')}</span>
    case 'cli_authenticated':
      return <span className="text-[11px] font-medium text-indigo bg-indigo/15 px-2 py-0.5 rounded-full">{t('status.cliAuthenticated')}</span>
    case 'error':
      return <span className="text-[11px] font-medium text-coral bg-coral/15 px-2 py-0.5 rounded-full">{t('im.error')}</span>
    case 'testing':
      return <span className="text-[11px] font-medium text-amber bg-amber/15 px-2 py-0.5 rounded-full">{t('status.testing')}</span>
    default:
      return <span className="text-[12px] text-tertiary">{provider.apiKey ? t('status.notTested') : t('status.notConfigured')}</span>
  }
}

function PermissionsSection({ get, handleSettingChange, t }: SectionProps) {
  const _ = t || ((k: string) => k)
  return (
    <>
      <SectionHeader title={_('settings.permission')} description={_('settings.permissionDesc')} />
      <Card>
        <SettingRow label={_('settings.desktopPermission')} description={_('settings.desktopPermissionDesc')}>
          <Select
            value={get('desktop_permission_mode', 'confirm')}
            onChange={(v) => { handleSettingChange('desktop_permission_mode', v); handleSettingChange('im_permission_mode', v) }}
            options={[
              { value: 'confirm', label: _('permission.confirmMode') },
              { value: 'full', label: _('permission.fullAccess') },
            ]}
            width={180}
          />
        </SettingRow>
        <SettingRow label={_('settings.imPermission')} description={_('settings.imPermissionDesc')}>
          <Select
            value={get('im_permission_mode', 'confirm')}
            onChange={(v) => handleSettingChange('im_permission_mode', v)}
            options={[
              { value: 'confirm', label: _('permission.confirmMode') },
              { value: 'full', label: _('permission.fullAccess') },
            ]}
            width={180}
          />
        </SettingRow>
      </Card>
    </>
  )
}

function ProjectSection({ get, handleSettingChange, t }: SectionProps) {
  const _ = t || ((k: string) => k)
  return (
    <>
      <SectionHeader title={_('settings.project')} description={_('settings.projectDesc')} />
      <Card>
        <SettingRow label={_('settings.memoryRetention')} description={_('settings.memoryRetentionDesc')}>
          <Select
            value={get('memory_retention_days', '7')}
            onChange={(v) => handleSettingChange('memory_retention_days', v)}
            options={[
              { value: '3', label: _('settings.memoryDays3') },
              { value: '7', label: _('settings.memoryDays7') },
              { value: '14', label: _('settings.memoryDays14') },
              { value: '30', label: _('settings.memoryDays30') },
            ]}
            width={120}
          />
        </SettingRow>
      </Card>
    </>
  )
}

function AppearanceSection({ get, handleSettingChange, theme, setTheme, locale, setLocale, t }: SectionProps & {
  theme: string
  setTheme: (t: 'dark' | 'light' | 'system') => void
  locale: string
  setLocale: (l: 'zh' | 'en') => void
}) {
  const _ = t || ((k: string) => k)
  return (
    <>
      <SectionHeader title={_('settings.appearance')} description={_('settings.appearanceDesc')} />
      <Card>
        <SettingRow label={_('settings.theme')} description={_('settings.themeDesc')}>
          <Select
            value={theme}
            onChange={(v) => { setTheme(v as 'dark' | 'light' | 'system'); handleSettingChange('theme', v) }}
            options={[
              { value: 'system', label: _('settings.themeSystem') },
              { value: 'dark', label: _('settings.themeDark') },
              { value: 'light', label: _('settings.themeLight') },
            ]}
            width={180}
          />
        </SettingRow>
        <SettingRow label={_('settings.language')} description={_('settings.languageDesc')}>
          <Select
            value={locale}
            onChange={(v) => { setLocale(v as 'zh' | 'en'); handleSettingChange('language', v) }}
            options={[
              { value: 'zh', label: '中文' },
              { value: 'en', label: 'English' },
            ]}
            width={180}
          />
        </SettingRow>
        <SettingRow label={_('settings.fontSize')} description={_('settings.fontSizeDesc')}>
          <Select
            value={get('font_size', '14')}
            onChange={(v) => handleSettingChange('font_size', v)}
            options={[
              { value: '12', label: '12px' },
              { value: '13', label: '13px' },
              { value: '14', label: '14px' },
              { value: '15', label: '15px' },
              { value: '16', label: '16px' },
            ]}
            width={120}
          />
        </SettingRow>
        <SettingRow label={_('settings.codeTheme')} description={_('settings.codeThemeDesc')}>
          <Select
            value={get('code_theme', 'github-dark')}
            onChange={(v) => handleSettingChange('code_theme', v)}
            options={[
              { value: 'github-dark', label: 'GitHub Dark' },
              { value: 'monokai', label: 'Monokai' },
              { value: 'one-dark-pro', label: 'One Dark Pro' },
              { value: 'dracula', label: 'Dracula' },
              { value: 'nord', label: 'Nord' },
            ]}
            width={180}
          />
        </SettingRow>
      </Card>

      <AppearancePreview get={get} t={_} />
    </>
  )
}

const SYSTEM_MONO = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'

/** Approximate theme colors for the code preview (avoids loading Shiki in settings) */
const CODE_THEME_COLORS: Record<string, { bg: string; keyword: string; string: string; comment: string; variable: string }> = {
  'github-dark': { bg: '#161b22', keyword: '#ff7b72', string: '#a5d6ff', comment: '#8b949e', variable: '#ffa657' },
  'monokai': { bg: '#272822', keyword: '#f92672', string: '#e6db74', comment: '#75715e', variable: '#a6e22e' },
  'one-dark-pro': { bg: '#282c34', keyword: '#c678dd', string: '#98c379', comment: '#5c6370', variable: '#e06c75' },
  'dracula': { bg: '#282a36', keyword: '#ff79c6', string: '#f1fa8c', comment: '#6272a4', variable: '#50fa7b' },
  'nord': { bg: '#2e3440', keyword: '#81a1c1', string: '#a3be8c', comment: '#616e88', variable: '#88c0d0' },
}

function AppearancePreview({ get, t }: { get: (key: string, defaultValue?: string) => string; t: (key: string) => string }) {
  const fontSize = get('font_size', '14')
  const codeTheme = get('code_theme', 'github-dark')

  const previewStyles = useMemo(() => {
    return {
      fontSize: `${fontSize}px`,
      codeFontSize: `${Math.max(Number(fontSize) - 2, 10)}px`,
    }
  }, [fontSize])

  const themeColors = CODE_THEME_COLORS[codeTheme] || CODE_THEME_COLORS['github-dark']

  return (
    <Card title={t('settings.preview')}>
      <p className="text-[11px] text-tertiary -mt-2">{t('settings.previewDesc')}</p>
      <div className="rounded-lg bg-elevated border border-subtle p-4 space-y-3">
        {/* User message — right aligned */}
        <div className="flex justify-end">
          <div
            className="max-w-[80%] px-3 py-2 rounded-2xl rounded-br-md bg-indigo text-white leading-relaxed"
            style={{ fontSize: previewStyles.fontSize }}
          >
            How do I sort an array in JavaScript?
          </div>
        </div>

        {/* Agent reply — left aligned */}
        <div className="flex justify-start">
          <div className="max-w-[80%] space-y-2">
            <div
              className="text-primary leading-relaxed"
              style={{ fontSize: previewStyles.fontSize }}
            >
              You can use the built-in <code
                className="px-1 py-0.5 rounded bg-surface-active text-indigo"
                style={{ fontFamily: SYSTEM_MONO, fontSize: previewStyles.codeFontSize }}
              >sort()</code> method:
            </div>

            {/* Code block with theme-colored syntax highlighting */}
            <div className="rounded-lg overflow-hidden border border-subtle">
              <div
                className="flex items-center px-3 py-1 bg-surface-active border-b border-subtle text-[11px] text-muted"
                style={{ fontFamily: SYSTEM_MONO }}
              >
                javascript
              </div>
              <pre
                className="px-3 py-2 overflow-x-auto"
                style={{ fontFamily: SYSTEM_MONO, fontSize: previewStyles.codeFontSize, backgroundColor: themeColors.bg }}
              >
                <code>
                  <span style={{ color: themeColors.keyword }}>const</span>{' '}
                  <span style={{ color: themeColors.variable }}>numbers</span>{' = ['}
                  <span style={{ color: themeColors.string }}>3</span>{', '}
                  <span style={{ color: themeColors.string }}>1</span>{', '}
                  <span style={{ color: themeColors.string }}>4</span>{', '}
                  <span style={{ color: themeColors.string }}>1</span>{', '}
                  <span style={{ color: themeColors.string }}>5</span>{'];\n'}
                  <span style={{ color: themeColors.variable }}>numbers</span>
                  {'.'}
                  <span style={{ color: themeColors.keyword }}>sort</span>
                  {'(('}
                  <span style={{ color: themeColors.variable }}>a</span>
                  {', '}
                  <span style={{ color: themeColors.variable }}>b</span>
                  {') => '}
                  <span style={{ color: themeColors.variable }}>a</span>
                  {' - '}
                  <span style={{ color: themeColors.variable }}>b</span>
                  {');\n'}
                  <span style={{ color: themeColors.comment }}>{'// [1, 1, 3, 4, 5]'}</span>
                </code>
              </pre>
            </div>

            <div
              className="text-primary leading-relaxed"
              style={{ fontSize: previewStyles.fontSize }}
            >
              {'The callback '}
              <code
                className="px-1 py-0.5 rounded bg-surface-active text-indigo"
                style={{ fontFamily: SYSTEM_MONO, fontSize: previewStyles.codeFontSize }}
              >(a, b) =&gt; a - b</code>
              {' sorts in ascending order.'}
            </div>
          </div>
        </div>
      </div>
    </Card>
  )
}

function DataSection({ get, handleSettingChange, handleExport, handleClearAll, clearConfirm, clearing, t, dataPath }: SectionProps & {
  handleExport: (format: 'json' | 'markdown') => void
  handleClearAll: () => void
  clearConfirm: boolean
  clearing: boolean
  dataPath: string
}) {
  const _ = t || ((k: string) => k)
  const displayPath = dataPath
    ? dataPath.replace(/^\/Users\/[^/]+/, '~')
    : '~/.forge/'
  return (
    <>
      <SectionHeader title={_('settings.data')} description={_('settings.dataDesc')} />
      <Card>
        <SettingRow label={_('settings.dataDir')} description={displayPath}>
          <button
            onClick={() => {
              if (dataPath) {
                window.electronAPI?.openPath(dataPath)
              }
            }}
            className="px-3 h-9 rounded-lg border border-subtle text-[12px] text-secondary font-medium hover:bg-surface-hover transition-colors"
          >
            {_('settings.openFolder')}
          </button>
        </SettingRow>
        <SettingRow label={_('settings.sessionRetention')} description={_('settings.sessionRetentionDesc')}>
          <Select
            value={get('session_retention', 'permanent')}
            onChange={(v) => handleSettingChange('session_retention', v)}
            options={[
              { value: 'permanent', label: _('settings.sessionPermanent') },
              { value: '30', label: _('settings.session30d') },
              { value: '90', label: _('settings.session90d') },
              { value: '180', label: _('settings.session180d') },
            ]}
            width={150}
          />
        </SettingRow>
        <SettingRow label={_('settings.exportSessions')} description={_('settings.exportSessionsDesc')}>
          <div className="flex gap-2">
            <button
              onClick={() => handleExport('json')}
              className="px-3 h-9 rounded-lg border border-subtle text-[12px] text-secondary font-medium hover:bg-surface-hover transition-colors"
            >
              JSON
            </button>
            <button
              onClick={() => handleExport('markdown')}
              className="px-3 h-9 rounded-lg border border-subtle text-[12px] text-secondary font-medium hover:bg-surface-hover transition-colors"
            >
              Markdown
            </button>
          </div>
        </SettingRow>
        <SettingRow
          label={_('settings.clearAll')}
          description={clearConfirm ? _('settings.clearConfirm') : _('settings.clearAllDesc')}
          labelColor="text-coral"
        >
          <button
            onClick={handleClearAll}
            disabled={clearing}
            className={cn(
              'px-3 h-9 rounded-lg text-[12px] font-medium transition-colors',
              clearConfirm
                ? 'bg-coral text-white hover:bg-coral/90'
                : 'bg-coral/10 border border-coral/30 text-coral hover:bg-coral/20',
            )}
          >
            {clearing ? _('settings.clearing') : clearConfirm ? _('settings.confirmClear') : _('settings.clearAll')}
          </button>
        </SettingRow>
      </Card>
    </>
  )
}

/* ── Add Custom Provider Form ── */

function AddCustomProviderForm({ onCreate, onCancel }: {
  onCreate: (data: { name: string; baseUrl: string; apiKey: string; modelName: string }) => Promise<void>
  onCancel: () => void
}) {
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [modelName, setModelName] = useState('')
  const [saving, setSaving] = useState(false)

  const canSave = name.trim() && baseUrl.trim() && apiKey.trim() && modelName.trim()

  return (
    <div className="rounded-lg bg-elevated border border-subtle p-4 space-y-4">
      <h3 className="text-[14px] font-semibold text-primary">{t('button.addCustomProvider')}</h3>
      <p className="text-[11px] text-tertiary">{t('settings.customProviderDesc')}</p>

      <div className="space-y-3">
        <div className="space-y-1.5">
          <label className="text-[12px] font-medium text-secondary">{t('form.providerName')}</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. OpenRouter"
            className="w-full h-9 px-3 rounded-lg bg-page border border-subtle text-[13px] text-primary placeholder:text-muted outline-none focus:border-indigo" />
        </div>
        <div className="space-y-1.5">
          <label className="text-[12px] font-medium text-secondary">{t('form.baseUrl')}</label>
          <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://openrouter.ai/api/v1"
            className="w-full h-9 px-3 rounded-lg bg-page border border-subtle text-[13px] text-primary placeholder:text-muted outline-none focus:border-indigo" />
        </div>
        <div className="space-y-1.5">
          <label className="text-[12px] font-medium text-secondary">{t('form.apiKey')}</label>
          <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..."
            className="w-full h-9 px-3 rounded-lg bg-page border border-subtle text-[13px] text-primary placeholder:text-muted outline-none focus:border-indigo" />
        </div>
        <div className="space-y-1.5">
          <label className="text-[12px] font-medium text-secondary">{t('form.modelName')}</label>
          <input value={modelName} onChange={(e) => setModelName(e.target.value)} placeholder="e.g. gpt-4o, deepseek-chat"
            className="w-full h-9 px-3 rounded-lg bg-page border border-subtle text-[13px] text-primary placeholder:text-muted outline-none focus:border-indigo" />
        </div>
      </div>

      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className="px-3 h-9 rounded-lg border border-subtle text-[12px] font-medium text-secondary hover:bg-surface-hover transition-colors">
          {t('common.cancel')}
        </button>
        <button
          onClick={async () => { setSaving(true); await onCreate({ name: name.trim(), baseUrl: baseUrl.trim(), apiKey: apiKey.trim(), modelName: modelName.trim() }); setSaving(false) }}
          disabled={!canSave || saving}
          className="px-4 h-9 rounded-lg bg-indigo text-white text-[12px] font-medium hover:opacity-90 disabled:opacity-50"
        >
          {saving ? t('button.adding') : t('button.addProvider')}
        </button>
      </div>
    </div>
  )
}

/* ── Provider Config (inline, no outer card) ── */

function ProviderConfig({ provider, onUpdate, onTestConnection, onDelete, settingsGet, settingsChange }: {
  provider: ApiProvider
  onUpdate: (id: string, updates: Record<string, unknown>) => Promise<ApiProvider>
  onTestConnection: (id: string) => Promise<ApiProvider | null>
  onDelete?: (id: string) => Promise<void>
  settingsGet?: (key: string, defaultValue?: string) => string
  settingsChange?: (key: string, value: string) => void
}) {
  const { t } = useI18n()
  const { models } = useModels()
  const MODELS = models.map(m => ({ value: m.id, label: m.label }))
  const [apiKey, setApiKey] = useState(provider.apiKey)
  const [dirty, setDirty] = useState(false)
  const [cliDetected, setCliDetected] = useState(false)
  const [cliAccount, setCliAccount] = useState<{ email: string; displayName: string } | null>(null)
  const [deleting, setDeleting] = useState(false)

  const isAnthropicProvider = provider.id === 'anthropic'
  const isCustomProvider = provider.id.startsWith('custom-')

  const handleSave = useCallback(async () => {
    await onUpdate(provider.id, { api_key: apiKey })
    setDirty(false)
  }, [provider.id, apiKey, onUpdate])

  // Sync when switching providers
  const [prevId, setPrevId] = useState(provider.id)
  if (prevId !== provider.id) {
    setPrevId(provider.id)
    setApiKey(provider.apiKey)
    setDirty(false)
  }

  // Check CLI auth status for Anthropic
  useEffect(() => {
    if (isAnthropicProvider) {
      fetch('/api/api-providers/cli-status')
        .then(r => r.json())
        .then((data: { authenticated: boolean; account: { email: string; displayName: string } | null }) => {
          setCliDetected(data.authenticated)
          if (data.account) setCliAccount(data.account)
        })
        .catch(() => {})
    } else {
      setCliDetected(false)
      setCliAccount(null)
    }
  }, [isAnthropicProvider])

  const hasKey = provider.apiKey.length > 0
  const isAnthropicCli = isAnthropicProvider && cliDetected && !hasKey
  const canTest = (hasKey || isAnthropicCli) && !dirty
  const isTesting = provider.status === 'testing'

  return (
    <div className="space-y-3.5">
      {/* API Key field */}
      <div className="space-y-1.5">
        <label className="text-[12px] text-secondary">
          {t('form.apiKey')}
          {isAnthropicCli && <span className="text-muted font-normal ml-1.5">{t('status.cliActive')}</span>}
        </label>
        <div className="flex gap-2">
          <input
            type="password"
            value={apiKey}
            onChange={(e) => { setApiKey(e.target.value); setDirty(true) }}
            placeholder={isAnthropicProvider ? (isAnthropicCli ? t('onboarding.cliPlaceholder') : 'sk-ant-••••••••••••') : t('settings.enterApiKey')}
            className="flex-1 h-9 px-3 rounded-lg bg-page border border-subtle text-[13px] text-primary placeholder:text-muted outline-none focus:border-indigo"
          />
          {dirty && (
            <button onClick={handleSave} className="px-3 h-9 rounded-lg bg-indigo text-white text-[12px] font-medium hover:opacity-90">{t('common.save')}</button>
          )}
        </div>
      </div>

      {/* CLI Auth notice for Anthropic */}
      {isAnthropicCli && (
        <div className="flex items-center gap-2 text-[12px] text-green">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-green shrink-0" />
          {t('status.cliDetected')}{cliAccount ? ` (${cliAccount.displayName || cliAccount.email})` : ''}
        </div>
      )}

      {/* Status error message */}
      {provider.status === 'error' && provider.statusError && (
        <div className="text-[11px] text-coral bg-coral/10 px-3 py-2 rounded-lg">
          {provider.statusError}
        </div>
      )}

      {/* Custom provider: Base URL + Model Name */}
      {isCustomProvider && (
        <>
          <div className="space-y-1.5">
            <label className="text-[12px] text-secondary">{t('form.baseUrl')}</label>
            <DebouncedInput value={provider.baseUrl || ''} onSave={(v) => onUpdate(provider.id, { base_url: v })} placeholder="https://..." />
          </div>
          <div className="space-y-1.5">
            <label className="text-[12px] text-secondary">{t('form.modelName')}</label>
            <DebouncedInput value={provider.modelName || ''} onSave={(v) => onUpdate(provider.id, { model_name: v })} placeholder="e.g. gpt-4o, deepseek-chat" />
          </div>
        </>
      )}

      {/* Test Connection button — full width */}
      <div className="flex items-center gap-2">
        {canTest && (
          <button
            onClick={() => onTestConnection(provider.id)}
            disabled={isTesting}
            className="flex-1 flex items-center justify-center h-9 rounded-lg border border-subtle text-[13px] font-medium text-secondary hover:bg-surface-hover transition-colors disabled:opacity-50"
          >
            {isTesting ? t('status.testing') : t('settings.testConnection')}
          </button>
        )}
        {onDelete && (
          <button
            onClick={async () => { setDeleting(true); await onDelete(provider.id); setDeleting(false) }}
            disabled={deleting}
            className="flex items-center gap-1 px-3 h-9 rounded-lg text-[12px] font-medium text-coral hover:bg-coral/10 transition-colors disabled:opacity-50"
          >
            <Trash2 size={12} />
            {deleting ? t('status.removing') : t('settings.remove')}
          </button>
        )}
      </div>

      {/* Anthropic-specific: Model Defaults + Base URL */}
      {isAnthropicProvider && settingsGet && settingsChange && (
        <>
          <div className="h-px bg-subtle" />
          <SettingRow label={t('settings.defaultModel')} description={t('settings.defaultModelDesc')}>
            <Select value={settingsGet('default_model', 'claude-sonnet-4-6')} onChange={(v) => settingsChange('default_model', v)} options={MODELS} width={200} />
          </SettingRow>
          <SettingRow label={t('settings.baseUrl')} description={t('settings.baseUrlDesc')}>
            <DebouncedInput value={provider.baseUrl || ''} onSave={(v) => onUpdate(provider.id, { base_url: v })} placeholder="https://api.anthropic.com" width={200} />
          </SettingRow>
        </>
      )}

      {/* Thinking Mode — all providers */}
      {settingsGet && settingsChange && (
        <>
          <div className="h-px bg-subtle" />
          <SettingRow label={t('settings.thinkingMode')} description={t('settings.thinkingModeFullDesc')}>
            <Select
              value={settingsGet(`thinking_mode_${provider.provider}`, settingsGet('thinking_mode', 'auto'))}
              onChange={(v) => settingsChange(`thinking_mode_${provider.provider}`, v)}
              options={[
                { value: 'off', label: t('settings.thinkingOff') },
                { value: 'auto', label: t('settings.thinkingAuto') },
                { value: 'max', label: t('settings.thinkingMax') },
              ]}
              width={200}
            />
          </SettingRow>
        </>
      )}
    </div>
  )
}

/* ── Reusable Components ── */

function SettingRow({ label, description, children, labelColor }: {
  label: string
  description: string
  children: React.ReactNode
  labelColor?: string
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="space-y-0.5">
        <div className={cn('text-[13px] font-medium', labelColor || 'text-primary')}>{label}</div>
        <div className="text-[11px] text-tertiary">{description}</div>
      </div>
      {children}
    </div>
  )
}

function Select({ value, onChange, options, width }: {
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
  width: number
}) {
  return (
    <div style={{ width }}>
      <CustomSelect value={value} onChange={onChange} options={options} size="sm" />
    </div>
  )
}

function DebouncedInput({ value: initialValue, onSave, placeholder, width }: {
  value: string
  onSave: (value: string) => void
  placeholder?: string
  width?: number
}) {
  const [value, setValue] = useState(initialValue)
  const prevInitial = useRef(initialValue)
  if (prevInitial.current !== initialValue) {
    prevInitial.current = initialValue
    setValue(initialValue)
  }

  return (
    <input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => { if (value !== initialValue) onSave(value) }}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.currentTarget.blur() } }}
      placeholder={placeholder}
      style={width ? { width } : undefined}
      className={cn(
        'h-9 px-3 rounded-lg bg-page border border-subtle text-[13px] text-primary placeholder:text-muted outline-none focus:border-indigo',
        !width && 'w-full'
      )}
    />
  )
}

/* ── Markdown Export Helper ── */

interface ExportBlock {
  type: string
  text?: string
  name?: string
  content?: string
  is_error?: boolean
}

interface ExportSession {
  id: string
  title: string
  workspace: string
  model: string
  messages: { role: string; content: string; created_at: string }[]
}

function convertExportToMarkdown(data: { data?: { session: ExportSession; messages: { id: string; role: string; text?: string; blocks?: ExportBlock[]; created_at: string }[] }[] }): string {
  const lines: string[] = ['# Forge Export\n']
  const entries = data.data || []
  for (const entry of entries) {
    const session = entry.session
    lines.push(`## ${session.title}\n`)
    lines.push(`- **Workspace**: ${session.workspace}`)
    lines.push(`- **Model**: ${session.model}\n`)
    for (const msg of entry.messages || []) {
      const role = msg.role === 'user' ? 'User' : 'Assistant'
      lines.push(`### ${role} (${msg.created_at})\n`)
      if (msg.role === 'user') {
        lines.push((msg.text || '') + '\n')
      } else {
        const blocks = msg.blocks || []
        for (const b of blocks) {
          if (b.type === 'text' && b.text) lines.push(b.text + '\n')
          else if (b.type === 'tool_use') lines.push(`> **Tool**: \`${b.name}\`\n`)
          else if (b.type === 'tool_result') lines.push(`> **Result**: ${b.is_error ? '(error) ' : ''}${(b.content || '').slice(0, 200)}\n`)
        }
      }
    }
    lines.push('---\n')
  }
  return lines.join('\n')
}
