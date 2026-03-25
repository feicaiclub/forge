'use client'

import { useState, useEffect, useCallback } from 'react'
import { Folder, Save, WrapText } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CodeEditor } from '@/components/ui/code-editor'
import { useWordWrap } from '@/hooks/use-word-wrap'
import { MarkdownPreview } from '@/components/ui/markdown-preview'
import { CustomSelect } from '@/components/ui/custom-select'
import { useI18n } from '@/components/providers/i18n-provider'
import type { AgentSelection, SubAgentInfo } from '@/hooks/use-agent-config'

const TOOL_LIST = [
  { id: 'Read', label: 'Read', desc: 'Read files' },
  { id: 'Write', label: 'Write', desc: 'Write/create files' },
  { id: 'Edit', label: 'Edit', desc: 'Edit existing files' },
  { id: 'Bash', label: 'Bash', desc: 'Execute shell commands' },
  { id: 'Glob', label: 'Glob', desc: 'Search file patterns' },
  { id: 'Grep', label: 'Grep', desc: 'Search file contents' },
  { id: 'WebSearch', label: 'Web Search', desc: 'Search the web' },
  { id: 'WebFetch', label: 'Web Fetch', desc: 'Fetch web pages' },
]

const TOOL_PRESETS = [
  { id: 'minimal', label: 'Minimal', disallow: ['Write', 'Edit', 'Bash', 'WebSearch', 'WebFetch'] },
  { id: 'coding', label: 'Coding', disallow: ['WebSearch', 'WebFetch'] },
  { id: 'full', label: 'Full', disallow: [] as string[] },
]

const MODEL_OPTIONS = [
  { value: 'inherit', label: 'Inherit (default)' },
  { value: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
  { value: 'kimi-k2.5', label: 'Kimi K2.5' },
  { value: 'glm-5', label: 'GLM-5' },
  { value: 'MiniMax-M2.7', label: 'MiniMax M2.7' },
  { value: 'qwen3.5-plus', label: 'Qwen 3.5 Plus' },
]

interface AgentEditorProps {
  selection: AgentSelection
  workspacePath: string
  subAgents: SubAgentInfo[]
  readFile: (filename: string) => Promise<string>
  writeFile: (filename: string, content: string) => Promise<void>
  readSubAgent: (filename: string) => Promise<string>
  writeSubAgent: (filename: string, content: string) => Promise<void>
  updateSubAgentField: (filename: string, field: string, value: string | string[]) => Promise<void>
}

export function AgentEditor({
  selection,
  workspacePath,
  subAgents,
  readFile,
  writeFile,
  readSubAgent,
  writeSubAgent,
  updateSubAgentField,
}: AgentEditorProps) {
  if (selection.type === 'file') {
    return (
      <FileEditor
        key={selection.filename}
        filename={selection.filename}
        workspacePath={workspacePath}
        readFile={readFile}
        writeFile={writeFile}
      />
    )
  }

  if (selection.type === 'subagent') {
    const agent = subAgents.find(a => a.filename === selection.filename)
    return (
      <SubAgentEditor
        key={selection.filename}
        filename={selection.filename}
        workspacePath={workspacePath}
        agent={agent}
        readSubAgent={readSubAgent}
        writeSubAgent={writeSubAgent}
        updateSubAgentField={updateSubAgentField}
      />
    )
  }

  return null
}

// ── Main config file editor (Edit/Preview/Split) ──

function FileEditor({
  filename,
  workspacePath,
  readFile,
  writeFile,
}: {
  filename: string
  workspacePath: string
  readFile: (filename: string) => Promise<string>
  writeFile: (filename: string, content: string) => Promise<void>
}) {
  const { t } = useI18n()
  const [mode, setMode] = useState<'edit' | 'preview' | 'split'>('edit')
  const [content, setContent] = useState('')
  const [dirty, setDirty] = useState(false)
  const [loading, setLoading] = useState(true)
  const { wordWrap, toggleWordWrap } = useWordWrap()

  useEffect(() => {
    setLoading(true)
    setDirty(false)
    readFile(filename).then(c => {
      setContent(c)
      setLoading(false)
    })
  }, [filename, readFile])

  const handleSave = useCallback(async () => {
    await writeFile(filename, content)
    setDirty(false)
  }, [filename, content, writeFile])

  const filePath = `${workspacePath}/${filename}`

  return (
    <div
      className="flex flex-col h-full"
      onKeyDown={e => {
        if ((e.metaKey || e.ctrlKey) && e.key === 's') {
          e.preventDefault()
          handleSave()
        }
      }}
    >
      {/* Header */}
      <div className="px-6 pt-4 pb-3 border-b border-subtle shrink-0">
        <div className="flex items-center justify-between">
          <span className="text-[20px] font-semibold text-primary font-heading tracking-tight">{filename}</span>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center h-10 px-6 border-b border-subtle shrink-0">
        {(['edit', 'preview', 'split'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setMode(tab)}
            className={cn(
              'h-full px-3.5 text-[12px] font-medium transition-colors border-b-2',
              mode === tab
                ? 'text-primary font-semibold border-indigo'
                : 'text-tertiary hover:text-secondary border-transparent'
            )}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
        <div className="flex-1" />
        <button
          onClick={toggleWordWrap}
          className={cn('p-1.5 rounded-md hover:bg-surface-hover transition-colors mr-2', wordWrap ? 'text-muted' : 'text-tertiary')}
          title={wordWrap ? 'Word wrap: on' : 'Word wrap: off'}
        >
          <WrapText size={14} />
        </button>
        {dirty && <div className="w-2 h-2 rounded-full bg-amber mr-2" />}
        <button
          onClick={handleSave}
          disabled={!dirty}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo text-white text-[12px] font-medium hover:opacity-90 disabled:opacity-40"
        >
          <Save size={12} /> {t('button.save')}
        </button>
      </div>

      {/* Editor Content */}
      <div className="flex-1 overflow-hidden flex">
        {loading ? (
          <div className="flex items-center justify-center flex-1 text-muted text-[13px]">{t('status.loading')}</div>
        ) : (
          <>
            {(mode === 'edit' || mode === 'split') && (
              <div className={cn('flex-1 overflow-hidden', mode === 'split' && 'border-r border-subtle')}>
                <CodeEditor
                  value={content}
                  onChange={v => { setContent(v); setDirty(true) }}
                  language="markdown"
                  wordWrap={wordWrap}
                />
              </div>
            )}
            {(mode === 'preview' || mode === 'split') && (
              <div className="flex-1 overflow-y-auto bg-page">
                <MarkdownPreview content={content} />
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center h-8 px-6 border-t border-subtle shrink-0 bg-surface">
        <Folder size={12} className="text-muted" />
        <span className="text-[11px] text-muted ml-1.5 font-mono truncate">{filePath}</span>
        <div className="flex-1" />
        <span className="text-[11px] text-muted">{t('hint.cmdSToSave')}</span>
      </div>
    </div>
  )
}

// ── Sub-Agent editor (Instructions + Settings tabs) ──

function SubAgentEditor({
  filename,
  workspacePath,
  agent,
  readSubAgent,
  writeSubAgent,
  updateSubAgentField,
}: {
  filename: string
  workspacePath: string
  agent?: SubAgentInfo
  readSubAgent: (filename: string) => Promise<string>
  writeSubAgent: (filename: string, content: string) => Promise<void>
  updateSubAgentField: (filename: string, field: string, value: string | string[]) => Promise<void>
}) {
  const { t } = useI18n()
  const [activeTab, setActiveTab] = useState<'instructions' | 'settings'>('instructions')
  const [mode, setMode] = useState<'edit' | 'preview' | 'split'>('edit')
  const [content, setContent] = useState('')
  const [dirty, setDirty] = useState(false)
  const [loading, setLoading] = useState(true)
  const [disallowed, setDisallowed] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const { wordWrap, toggleWordWrap } = useWordWrap()

  // Load file content
  useEffect(() => {
    setLoading(true)
    setDirty(false)
    readSubAgent(filename).then(c => {
      setContent(c)
      setLoading(false)
    })
  }, [filename, readSubAgent])

  // Load disallowedTools from agent
  useEffect(() => {
    if (agent) {
      setDisallowed(new Set(agent.disallowedTools || []))
    }
  }, [agent])

  const handleSave = useCallback(async () => {
    await writeSubAgent(filename, content)
    setDirty(false)
  }, [filename, content, writeSubAgent])

  const handleModelChange = useCallback(async (model: string) => {
    setSaving(true)
    try {
      await updateSubAgentField(filename, 'model', model)
    } catch { /* handled */ } finally {
      setSaving(false)
    }
  }, [filename, updateSubAgentField])

  const toggleTool = useCallback(async (toolId: string) => {
    setSaving(true)
    const next = new Set(disallowed)
    if (next.has(toolId)) next.delete(toolId)
    else next.add(toolId)
    setDisallowed(next)
    try {
      await updateSubAgentField(filename, 'disallowedTools', Array.from(next))
    } catch {
      setDisallowed(disallowed)
    } finally {
      setSaving(false)
    }
  }, [filename, disallowed, updateSubAgentField])

  const applyPreset = useCallback(async (preset: typeof TOOL_PRESETS[number]) => {
    setSaving(true)
    const next = new Set(preset.disallow)
    setDisallowed(next)
    try {
      await updateSubAgentField(filename, 'disallowedTools', Array.from(next))
    } catch {
      if (agent) setDisallowed(new Set(agent.disallowedTools || []))
    } finally {
      setSaving(false)
    }
  }, [filename, agent, updateSubAgentField])

  const filePath = `${workspacePath}/agents/${filename}`
  const currentModel = agent?.model || 'inherit'

  return (
    <div
      className="flex flex-col h-full"
      onKeyDown={e => {
        if ((e.metaKey || e.ctrlKey) && e.key === 's') {
          e.preventDefault()
          handleSave()
        }
      }}
    >
      {/* Header */}
      <div className="px-6 pt-4 pb-3 border-b border-subtle shrink-0">
        <div className="flex items-center justify-between">
          <span className="text-[20px] font-semibold text-primary font-heading tracking-tight">{filename}</span>
        </div>
      </div>

      {/* Top-level tabs: Instructions | Settings */}
      <div className="flex items-center h-10 px-6 border-b border-subtle shrink-0">
        {(['instructions', 'settings'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              'h-full px-3.5 text-[12px] font-medium transition-colors border-b-2',
              activeTab === tab
                ? 'text-primary font-semibold border-indigo'
                : 'text-tertiary hover:text-secondary border-transparent'
            )}
          >
            {tab === 'instructions' ? t('agent.instructions') : t('agent.settings')}
          </button>
        ))}
        <div className="flex-1" />
        {activeTab === 'instructions' && (
          <>
            {dirty && <div className="w-2 h-2 rounded-full bg-amber mr-2" />}
            <button
              onClick={handleSave}
              disabled={!dirty}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo text-white text-[12px] font-medium hover:opacity-90 disabled:opacity-40"
            >
              <Save size={12} /> {t('button.save')}
            </button>
          </>
        )}
        {activeTab === 'settings' && saving && (
          <span className="text-[11px] text-tertiary">{t('status.saving')}</span>
        )}
      </div>

      {/* Tab Content */}
      {activeTab === 'instructions' ? (
        <>
          {/* Sub-toolbar: Edit/Preview/Split */}
          <div className="flex items-center h-9 px-6 border-b border-subtle shrink-0 bg-surface">
            {(['edit', 'preview', 'split'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setMode(tab)}
                className={cn(
                  'h-full px-3 text-[11px] font-medium transition-colors border-b-2',
                  mode === tab
                    ? 'text-primary font-semibold border-indigo'
                    : 'text-tertiary hover:text-secondary border-transparent'
                )}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
            <div className="flex-1" />
            <button
              onClick={toggleWordWrap}
              className={cn('p-1 rounded-md hover:bg-surface-hover transition-colors', wordWrap ? 'text-muted' : 'text-tertiary')}
              title={wordWrap ? 'Word wrap: on' : 'Word wrap: off'}
            >
              <WrapText size={13} />
            </button>
          </div>

          {/* Editor Content */}
          <div className="flex-1 overflow-hidden flex">
            {loading ? (
              <div className="flex items-center justify-center flex-1 text-muted text-[13px]">{t('status.loading')}</div>
            ) : (
              <>
                {(mode === 'edit' || mode === 'split') && (
                  <div className={cn('flex-1 overflow-hidden', mode === 'split' && 'border-r border-subtle')}>
                    <CodeEditor
                      value={content}
                      onChange={v => { setContent(v); setDirty(true) }}
                      language="markdown"
                      wordWrap={wordWrap}
                    />
                  </div>
                )}
                {(mode === 'preview' || mode === 'split') && (
                  <div className="flex-1 overflow-y-auto bg-page">
                    <MarkdownPreview content={content} />
                  </div>
                )}
              </>
            )}
          </div>
        </>
      ) : (
        /* Settings Tab */
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {/* Model Section */}
          <div className="mb-8">
            <h3 className="text-[14px] font-semibold text-primary mb-1">{t('form.model')}</h3>
            <p className="text-[12px] text-tertiary mb-3">{t('agent.selectModel')}</p>
            <CustomSelect
              value={currentModel}
              onChange={handleModelChange}
              options={MODEL_OPTIONS}
              size="sm"
              className="max-w-[320px]"
            />
          </div>

          {/* Tools Section */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-[14px] font-semibold text-primary mb-1">{t('form.tools')}</h3>
                <p className="text-[12px] text-tertiary">{t('agent.configureTools')}</p>
              </div>
              <div className="flex gap-2">
                {TOOL_PRESETS.map(preset => (
                  <button
                    key={preset.id}
                    onClick={() => applyPreset(preset)}
                    className="px-3 py-1.5 rounded-lg bg-elevated text-[12px] text-secondary hover:bg-surface-hover transition-colors"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="divide-y divide-subtle rounded-lg border border-subtle">
              {TOOL_LIST.map(tool => {
                const enabled = !disallowed.has(tool.id)
                return (
                  <button
                    key={tool.id}
                    type="button"
                    onClick={() => toggleTool(tool.id)}
                    disabled={saving}
                    className="flex items-center justify-between w-full h-12 px-4 text-left transition-colors hover:bg-surface-hover disabled:opacity-60"
                  >
                    <div className="min-w-0">
                      <div className={cn('text-[13px] font-semibold', enabled ? 'text-primary' : 'text-tertiary')}>
                        {tool.label}
                      </div>
                      <div className="text-[11px] text-muted truncate">{tool.desc}</div>
                    </div>
                    <div
                      className={cn(
                        'relative w-9 h-5 rounded-full shrink-0 ml-4 transition-colors',
                        enabled ? 'bg-green' : 'bg-elevated'
                      )}
                    >
                      <div
                        className={cn(
                          'absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform',
                          enabled ? 'translate-x-[18px]' : 'translate-x-0.5'
                        )}
                      />
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center h-8 px-6 border-t border-subtle shrink-0 bg-surface">
        <Folder size={12} className="text-muted" />
        <span className="text-[11px] text-muted ml-1.5 font-mono truncate">{filePath}</span>
        <div className="flex-1" />
        {activeTab === 'instructions' && <span className="text-[11px] text-muted">{t('hint.cmdSToSave')}</span>}
      </div>
    </div>
  )
}
