'use client'

import { useState, useCallback, useEffect } from 'react'
import { ArrowRight, ChevronDown, ChevronUp, FolderOpen, Folder, CircleCheck, Terminal, LogIn, Loader2, Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useI18n } from '@/components/providers/i18n-provider'

interface OnboardingProps {
  onComplete: (workspaceId?: string) => void
}

type Step = 'connect' | 'project'

const OTHER_PROVIDERS = [
  { id: 'minimax', label: 'MiniMax' },
  { id: 'zhipu', label: 'GLM' },
  { id: 'moonshot', label: 'Kimi' },
  { id: 'qwen', label: 'Qwen' },
  { id: 'bailian-codingplan', label: 'Bailian CodingPlan' },
]

export function Onboarding({ onComplete }: OnboardingProps) {
  const { t } = useI18n()
  const [step, setStep] = useState<Step>('connect')
  // Step 1: Connect AI
  const [apiKey, setApiKey] = useState('')
  const [otherKeys, setOtherKeys] = useState<Record<string, string>>({})
  const [showOtherProviders, setShowOtherProviders] = useState(false)
  // CLI detection: installed (binary exists) vs authenticated (logged in)
  const [cliInstalled, setCliInstalled] = useState(false)
  const [cliDetected, setCliDetected] = useState(false)
  const [cliAccount, setCliAccount] = useState<{ email: string; displayName: string } | null>(null)
  const [cliLoading, setCliLoading] = useState(true)
  const [oauthInProgress, setOauthInProgress] = useState(false)
  const [oauthError, setOauthError] = useState('')
  // Step 2: Project Folder
  const [projectPath, setProjectPath] = useState('')
  const [projectWorkspaceId, setProjectWorkspaceId] = useState('')
  // General
  const [saving, setSaving] = useState(false)

  const stepIndex = step === 'connect' ? 0 : 1

  // Detect CLI installation + authentication on mount
  useEffect(() => {
    fetch('/api/api-providers/cli-status')
      .then(r => r.json())
      .then((data: { installed: boolean; authenticated: boolean; account: { email: string; displayName: string } | null }) => {
        setCliInstalled(data.installed)
        setCliDetected(data.authenticated)
        if (data.account) setCliAccount(data.account)
        setCliLoading(false)
      })
      .catch(() => setCliLoading(false))
  }, [])

  // Handle CLI OAuth login
  const handleCliLogin = useCallback(async () => {
    setOauthInProgress(true)
    setOauthError('')
    try {
      const res = await fetch('/api/api-providers/cli-login', { method: 'POST' })
      const data = await res.json()
      if (data.ok) {
        setCliDetected(true)
        if (data.account) setCliAccount(data.account)
        setOauthInProgress(false)
      } else {
        setOauthError(data.error || 'Authentication failed')
        setOauthInProgress(false)
      }
    } catch {
      setOauthError('Network error. Please try again.')
      setOauthInProgress(false)
    }
  }, [])

  const handleSelectFolder = useCallback(async () => {
    const folderPath = await window.electronAPI?.openDirectoryDialog()
    if (!folderPath) return
    setProjectPath(folderPath)
    try {
      const res = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: folderPath }),
      })
      if (res.ok) {
        const data = await res.json()
        setProjectWorkspaceId(data.id)
      }
    } catch { /* Will handle in finish step */ }
  }, [])

  const handleFinish = useCallback(async () => {
    setSaving(true)
    try {
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ onboarding_completed: 'true', default_model: 'claude-sonnet-4-6' }),
      })

      if (apiKey.trim()) {
        await fetch('/api/api-providers/anthropic', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: apiKey.trim(), status: 'connected' }),
        })
      } else if (cliDetected) {
        // CLI authenticated but no API key entered — sync status to DB
        // so Settings page shows correct state without needing manual Test Connection
        await fetch('/api/api-providers/anthropic', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'cli_authenticated' }),
        })
      }

      for (const [providerId, key] of Object.entries(otherKeys)) {
        if (key.trim()) {
          await fetch(`/api/api-providers/${providerId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ api_key: key.trim() }),
          })
        }
      }

      if (projectWorkspaceId) {
        await fetch('/api/onboarding', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workspaceId: projectWorkspaceId }),
        })
      }

      onComplete(projectWorkspaceId || undefined)
    } catch {
      onComplete()
    }
    setSaving(false)
  }, [apiKey, otherKeys, onComplete, projectWorkspaceId])

  return (
    <div className="fixed inset-0 z-50 bg-page flex items-center justify-center">
      {/* Single card — all content inside, matching Pencil design */}
      <div className="w-[560px] rounded-2xl bg-surface border border-subtle p-10 flex flex-col gap-8">

        {/* ── headerArea ── */}
        <div className="flex flex-col items-center gap-2">
          <img src="/mascot.png" alt="Forge" className="w-12 h-12 object-contain" />
          <h1 className="text-[28px] font-bold text-primary tracking-tight" style={{ fontFamily: 'Fraunces, serif' }}>
            {t('onboarding.welcome')}
          </h1>
          <p className="text-[14px] text-secondary text-center max-w-[400px]">
            {t('onboarding.subtitle')}
          </p>
        </div>

        {/* ── progressArea ── */}
        <div className="flex flex-col items-center gap-3">
          <span className="text-[12px] font-semibold text-indigo">
            {t('onboarding.step')} {stepIndex + 1} / 2 — {step === 'connect' ? t('onboarding.connectAi') : t('onboarding.project')}
          </span>
          <div className="w-full h-1 rounded-sm bg-elevated overflow-hidden">
            <div
              className="h-full bg-indigo rounded-sm transition-all duration-300"
              style={{ width: step === 'connect' ? '50%' : '100%' }}
            />
          </div>
        </div>

        {/* ── formArea ── */}
        <div className="flex flex-col gap-5 animate-fade-in" key={step}>

          {step === 'connect' && !oauthInProgress && (
            <>
              {/* CLI Banner — 3 states: installed+logged in, installed+not logged in, not installed */}
              {cliLoading ? (
                <div className="text-[12px] text-muted">{t('onboarding.checkingCli')}</div>
              ) : cliInstalled && cliDetected ? (
                /* State A: CLI installed + logged in → green banner */
                <div className="rounded-lg bg-green/10 border border-green/20 p-3 flex flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <CircleCheck size={16} className="text-green shrink-0" />
                    <span className="text-[13px] font-semibold text-green">{t('onboarding.cliConnected')}</span>
                  </div>
                  <p className="text-[11px] text-green/80 pl-6">
                    {cliAccount ? `${t('onboarding.loggedInAs')}${cliAccount.displayName || cliAccount.email}` : t('onboarding.cliDetected')}
                    {t('onboarding.cliReady')}
                  </p>
                </div>
              ) : cliInstalled && !cliDetected ? (
                /* State B: CLI installed + NOT logged in → purple banner + Sign In button */
                <div className="rounded-lg bg-indigo/10 border border-indigo/20 p-4 flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <Terminal size={16} className="text-indigo shrink-0" />
                    <span className="text-[13px] font-semibold text-indigo">Claude Code CLI Detected</span>
                  </div>
                  <p className="text-[12px] text-secondary">
                    CLI is installed but not logged in. Sign in with your Claude subscription to get started.
                  </p>
                  {oauthError && (
                    <p className="text-[11px] text-coral">{oauthError}</p>
                  )}
                  <button
                    onClick={handleCliLogin}
                    className="inline-flex items-center gap-1.5 px-5 h-9 rounded-md bg-indigo text-white text-[13px] font-semibold hover:opacity-90 transition-opacity w-fit"
                  >
                    <LogIn size={14} /> Sign In with Claude
                  </button>
                </div>
              ) : !cliInstalled ? (
                /* State C: CLI NOT installed → no banner, just a hint below API key */
                null
              ) : null}

              {/* Anthropic API Key */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[13px] font-semibold text-primary">
                  {cliInstalled && !cliDetected
                    ? 'Or enter an Anthropic API Key'
                    : cliDetected
                      ? <>{t('onboarding.anthropicApiKey')} <span className="text-muted font-normal ml-1">({t('onboarding.cliActive')})</span></>
                      : <>{t('onboarding.anthropicApiKey')} <span className="text-coral font-normal ml-1">*</span></>
                  }
                </label>
                <p className="text-[11px] text-tertiary">
                  {cliDetected
                    ? t('onboarding.cliActive')
                    : cliInstalled
                      ? "If you don't have a Claude subscription, enter your API key instead."
                      : t('onboarding.getApiKey')
                  }
                </p>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={cliDetected ? t('onboarding.cliPlaceholder') : 'sk-ant-...'}
                  autoFocus={!cliDetected && !cliInstalled}
                  className="w-full h-10 px-3 rounded-lg bg-elevated border border-subtle text-[13px] text-primary placeholder:text-muted outline-none focus:border-indigo font-mono"
                />
              </div>

              {/* CLI install hint — only when CLI is NOT installed */}
              {!cliLoading && !cliInstalled && (
                <div className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-elevated">
                  <Info size={14} className="text-tertiary shrink-0" />
                  <span className="text-[11px] text-tertiary">
                    Tip: Install Claude Code CLI to use your subscription instead of API key
                  </span>
                </div>
              )}

              {/* Other AI Providers — collapsible */}
              <div className="flex flex-col gap-1.5">
                <button
                  onClick={() => setShowOtherProviders(!showOtherProviders)}
                  className="flex items-center gap-1.5 text-[13px] font-semibold text-primary hover:text-indigo transition-colors text-left"
                >
                  {t('onboarding.otherProviders')}
                  {showOtherProviders ? <ChevronUp size={14} className="text-muted" /> : <ChevronDown size={14} className="text-muted" />}
                </button>
                <p className="text-[11px] text-tertiary">
                  {t('onboarding.providerInfo')}
                </p>
                {showOtherProviders && (
                  <div className="flex flex-col gap-2 pt-1 animate-fade-in">
                    {OTHER_PROVIDERS.map((p) => (
                      <div key={p.id} className="flex items-center gap-2">
                        <label className="text-[12px] font-medium text-secondary w-[80px] shrink-0">{p.label}</label>
                        <input
                          type="password"
                          value={otherKeys[p.id] || ''}
                          onChange={(e) => setOtherKeys({ ...otherKeys, [p.id]: e.target.value })}
                          placeholder={t('input.notConfigured')}
                          className="flex-1 h-9 px-3 rounded-lg bg-elevated border border-subtle text-[12px] text-primary placeholder:text-muted outline-none focus:border-indigo font-mono"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {/* OAuth waiting state */}
          {step === 'connect' && oauthInProgress && (
            <div className="flex flex-col items-center gap-6 py-8">
              <Loader2 size={48} className="text-indigo animate-spin" />
              <h2 className="text-[22px] font-bold text-primary tracking-tight" style={{ fontFamily: 'Fraunces, serif' }}>
                Waiting for authentication...
              </h2>
              <p className="text-[14px] text-secondary text-center max-w-[380px]">
                A browser window has opened for you to sign in with your Claude account. Complete the login there and come back here.
              </p>
              <button
                onClick={() => setOauthInProgress(false)}
                className="inline-flex items-center justify-center px-6 h-10 rounded-lg border border-subtle text-[14px] font-medium text-secondary hover:bg-hover transition-colors"
              >
                Cancel
              </button>
              <p className="text-[12px] text-muted text-center">
                Having trouble? You can also enter an API key manually.
              </p>
            </div>
          )}

          {step === 'project' && (
            <>
              {/* Folder section */}
              <div className="flex flex-col gap-2">
                <label className="text-[13px] font-semibold text-primary">{t('onboarding.selectFolder')}</label>
                <p className="text-[11px] text-tertiary leading-relaxed">
                  {t('onboarding.folderDesc')}
                </p>
              </div>

              {/* Folder picker */}
              {projectPath ? (
                <div className="rounded-lg bg-elevated border border-subtle p-4 flex flex-col gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-green/20 flex items-center justify-center shrink-0">
                      <Folder size={20} className="text-green" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[14px] font-semibold text-primary truncate">
                        {projectPath.split('/').pop()}
                      </div>
                      <div className="text-[11px] text-muted truncate">{projectPath}</div>
                    </div>
                  </div>
                  <button
                    onClick={handleSelectFolder}
                    className="text-[12px] text-indigo hover:text-indigo/80 transition-colors text-left"
                  >
                    {t('button.changeFolder')}
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleSelectFolder}
                  className="w-full rounded-lg border-2 border-dashed border-subtle hover:border-indigo/50 p-8 flex flex-col items-center gap-3 transition-colors group"
                >
                  <div className="w-12 h-12 rounded-xl bg-indigo/10 flex items-center justify-center group-hover:bg-indigo/20 transition-colors">
                    <FolderOpen size={24} className="text-indigo" />
                  </div>
                  <div className="text-center flex flex-col gap-1">
                    <div className="text-[14px] font-semibold text-primary">{t('onboarding.chooseFolder')}</div>
                    <div className="text-[11px] text-tertiary">{t('onboarding.clickToSelect')}</div>
                  </div>
                </button>
              )}

              {/* Manual path input (web-only fallback) */}
              {!window.electronAPI && (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-px bg-subtle" />
                    <span className="text-[11px] text-muted">{t('onboarding.orEnterPath')}</span>
                    <div className="flex-1 h-px bg-subtle" />
                  </div>
                  <input
                    value={projectPath}
                    onChange={(e) => setProjectPath(e.target.value)}
                    placeholder={t('input.projectPath')}
                    className="w-full h-10 px-4 rounded-lg bg-elevated border border-subtle text-[13px] text-primary placeholder:text-muted outline-none focus:border-indigo font-mono"
                    onBlur={async () => {
                      if (projectPath.trim()) {
                        try {
                          const res = await fetch('/api/workspaces', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ path: projectPath.trim() }),
                          })
                          if (res.ok) {
                            const data = await res.json()
                            setProjectWorkspaceId(data.id)
                          }
                        } catch { /* ignore */ }
                      }
                    }}
                  />
                </div>
              )}
            </>
          )}
        </div>

        {/* ── skipForNow (Step 2 only, between formArea and buttonArea) ── */}
        {step === 'project' && (
          <p className="text-[11px] text-muted text-center -mt-4">
            {t('onboarding.skipForNow')}
          </p>
        )}

        {/* ── buttonArea ── */}
        <div className="flex items-center justify-between">
          {step === 'connect' ? (
            <>
              <button
                onClick={() => handleFinish()}
                className="text-[13px] font-medium text-tertiary hover:text-secondary transition-colors px-1"
              >
                {t('onboarding.skipForNow')}
              </button>
              <button
                onClick={() => setStep('project')}
                className="inline-flex items-center gap-2 px-6 h-10 rounded-lg bg-indigo text-white text-[14px] font-semibold hover:opacity-90 transition-opacity"
              >
                {t('onboarding.nextStep')} <ArrowRight size={16} />
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setStep('connect')}
                className="text-[13px] font-medium text-tertiary hover:text-secondary transition-colors px-1"
              >
                {t('onboarding.back')}
              </button>
              <button
                onClick={handleFinish}
                disabled={saving}
                className="inline-flex items-center gap-2 px-6 h-10 rounded-lg bg-indigo text-white text-[14px] font-semibold hover:opacity-90 transition-opacity disabled:opacity-40"
              >
                {saving ? t('onboarding.settingUp') : t('onboarding.startUsing')} <ArrowRight size={16} />
              </button>
            </>
          )}
        </div>

        {/* ── stepsRow (display only, not clickable) ── */}
        <div className="flex justify-center gap-6">
          <div className={cn(
            'flex items-center gap-1.5 text-[11px] font-semibold',
            step === 'connect' ? 'text-indigo' : 'text-green'
          )}>
            <span className={cn(
              'w-2 h-2 rounded-full',
              step === 'connect' ? 'bg-indigo' : 'bg-green'
            )} />
            {t('onboarding.connectAi')}
          </div>
          <div className={cn(
            'flex items-center gap-1.5 text-[11px]',
            step === 'project' ? 'text-indigo font-semibold' : 'text-muted font-normal'
          )}>
            <span className={cn(
              'w-2 h-2 rounded-full',
              step === 'project' ? 'bg-indigo' : 'bg-elevated'
            )} />
            {t('onboarding.project')}
          </div>
        </div>

      </div>
    </div>
  )
}
