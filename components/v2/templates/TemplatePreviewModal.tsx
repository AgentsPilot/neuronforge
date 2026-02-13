'use client'

import React, { useState } from 'react'
import { SharedAgentTemplate } from './AgentTemplateCard'
import {
  X,
  Download,
  Calendar,
  Zap,
  Activity,
  Sparkles,
  Bot,
  Code,
  FileText,
  Settings,
  Copy,
  CheckCircle,
  Info,
  List as ListIcon,
  Mail,
  Globe
} from 'lucide-react'
import {
  SiGithub,
  SiTwilio,
  SiAmazon
} from 'react-icons/si'
import { PluginIcon } from '@/components/PluginIcon'

type TemplatePreviewModalProps = {
  template: SharedAgentTemplate | null
  isOpen: boolean
  onClose: () => void
  onImport?: (templateId: string) => Promise<void>
  isImporting?: boolean
}

export function TemplatePreviewModal({
  template,
  isOpen,
  onClose,
  onImport,
  isImporting = false
}: TemplatePreviewModalProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'prompt' | 'plugins' | 'input_schema' | 'output_schema' | 'steps'>('overview')
  const [copied, setCopied] = useState(false)

  if (!isOpen || !template) return null

  // Plugin icon mapping - using PluginIcon for local SVG files
  const pluginIcons: Record<string, React.ReactNode> = {
    'google-mail': <PluginIcon pluginId="google-mail" className="w-5 h-5" alt="Gmail" />,
    'gmail': <PluginIcon pluginId="google-mail" className="w-5 h-5" alt="Gmail" />,
    'google-calendar': <PluginIcon pluginId="google-calendar" className="w-5 h-5" alt="Google Calendar" />,
    'google-drive': <PluginIcon pluginId="google-drive" className="w-5 h-5" alt="Google Drive" />,
    'google-docs': <PluginIcon pluginId="google-docs" className="w-5 h-5" alt="Google Docs" />,
    'google-sheets': <PluginIcon pluginId="google-sheets" className="w-5 h-5" alt="Google Sheets" />,
    'github': <SiGithub className="w-5 h-5" style={{ color: '#FFFFFF' }} />,
    'slack': <PluginIcon pluginId="slack" className="w-5 h-5" alt="Slack" />,
    'hubspot': <PluginIcon pluginId="hubspot" className="w-5 h-5" alt="HubSpot" />,
    'outlook': <Mail className="w-5 h-5" style={{ color: '#0078D4' }} />,
    'whatsapp-business': <PluginIcon pluginId="whatsapp" className="w-5 h-5" alt="WhatsApp Business" />,
    'twilio': <SiTwilio className="w-5 h-5" style={{ color: '#F22F46' }} />,
    'aws': <SiAmazon className="w-5 h-5" style={{ color: '#FF9900' }} />,
    'airtable': <PluginIcon pluginId="airtable" className="w-5 h-5" alt="Airtable" />,
    'chatgpt-research': <PluginIcon pluginId="chatgpt-research" className="w-5 h-5" alt="ChatGPT Research" />,
  }

  const getPluginIcon = (pluginKey: string) => {
    return pluginIcons[pluginKey] || <Globe className="w-5 h-5 text-slate-400" />
  }

  const getPluginDisplayName = (pluginKey: string) => {
    const nameMap: Record<string, string> = {
      'google-mail': 'Google Mail',
      'gmail': 'Gmail',
      'google-calendar': 'Google Calendar',
      'google-drive': 'Google Drive',
      'google-docs': 'Google Docs',
      'google-sheets': 'Google Sheets',
      'github': 'GitHub',
      'slack': 'Slack',
      'hubspot': 'HubSpot',
      'outlook': 'Outlook',
      'whatsapp-business': 'WhatsApp Business',
      'twilio': 'Twilio',
      'aws': 'AWS',
      'airtable': 'Airtable',
      'chatgpt-research': 'ChatGPT Research',
      'linkedin': 'LinkedIn',
    }

    if (nameMap[pluginKey]) {
      return nameMap[pluginKey]
    }

    // Fallback: convert "google-mail" -> "Google Mail"
    return pluginKey
      .split(/[-_]/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  }

  // Use quality_score if available (0-100 scale), otherwise fall back to ai_confidence (0-1 scale)
  const hasQualityScore = template.quality_score !== undefined && template.quality_score !== null && template.quality_score > 0
  const qualityValue = hasQualityScore ? template.quality_score : (template.ai_confidence || 0) * 100
  const qualityLabel = qualityValue >= 70 ? 'High Quality' : qualityValue >= 50 ? 'Good Quality' : 'Standard'

  const categories = template.detected_categories || []
  const pluginsRequired = template.plugins_required || []

  const sharedDate = new Date(template.shared_at).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  })

  // Parse schemas - they might be stored as JSON strings
  const parseSchema = (schema: any) => {
    if (!schema) return null
    if (typeof schema === 'string') {
      try {
        return JSON.parse(schema)
      } catch {
        return null
      }
    }
    return schema
  }

  const inputSchema = parseSchema(template.input_schema)
  const outputSchema = parseSchema(template.output_schema)

  const handleImport = async () => {
    if (onImport && !isImporting) {
      await onImport(template.id)
    }
  }

  const handleCopyPrompt = () => {
    if (template.user_prompt) {
      navigator.clipboard.writeText(template.user_prompt)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const tabs = [
    { id: 'overview', label: 'Overview', icon: Info },
    { id: 'prompt', label: 'Prompt', icon: Sparkles },
    { id: 'plugins', label: 'Plugins', icon: Zap },
    { id: 'input_schema', label: 'Input Schema', icon: Code },
    { id: 'output_schema', label: 'Output Schema', icon: FileText },
    { id: 'steps', label: 'Agent Steps', icon: ListIcon }
  ] as const

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[70] animate-in fade-in duration-200"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 overflow-y-auto">
        <div
          className="bg-[var(--v2-surface)] w-full max-w-4xl max-h-[90vh] flex flex-col animate-in slide-in-from-bottom-4 duration-300"
          style={{
            borderRadius: 'var(--v2-radius-card)',
            border: '1px solid var(--v2-border)',
            boxShadow: 'var(--v2-shadow-card)'
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div
            className="flex items-start justify-between p-6 border-b border-[var(--v2-border)] bg-gradient-to-r from-[var(--v2-primary)] to-[var(--v2-secondary)]"
            style={{ borderTopLeftRadius: 'var(--v2-radius-card)', borderTopRightRadius: 'var(--v2-radius-card)' }}
          >
            <div className="flex items-start gap-4 flex-1">
              <div
                className="flex-shrink-0 w-14 h-14 flex items-center justify-center text-white bg-white/20"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                <Bot className="w-7 h-7" />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-2xl font-semibold text-white mb-2">
                  {template.agent_name}
                </h2>
                <p className="text-sm text-white/90">
                  {template.description || template.created_from_prompt || 'No description'}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="flex-shrink-0 w-10 h-10 flex items-center justify-center text-white hover:bg-white/20 transition-colors"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Meta bar */}
          <div className="flex items-center justify-between px-6 py-4 bg-[var(--v2-bg)] border-b border-[var(--v2-border)]">
            <div className="flex items-center gap-4 text-sm text-[var(--v2-text-secondary)]">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                <span>{sharedDate}</span>
              </div>
              {template.import_count !== undefined && template.import_count > 0 && (
                <div className="flex items-center gap-2">
                  <Download className="w-4 h-4" />
                  <span>{template.import_count} imports</span>
                </div>
              )}
              {pluginsRequired.length > 0 && (
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4" />
                  <span>{pluginsRequired.length} plugins required</span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
                  qualityValue >= 70
                    ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                    : qualityValue >= 50
                    ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300'
                }`}
                title={hasQualityScore ? `Quality Score: ${Math.round(qualityValue)}/100` : `AI Confidence: ${Math.round(qualityValue)}%`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    qualityValue >= 70
                      ? 'bg-green-600 dark:bg-green-400'
                      : qualityValue >= 50
                      ? 'bg-yellow-600 dark:bg-yellow-400'
                      : 'bg-gray-500'
                  }`}
                />
                <Sparkles className="w-3.5 h-3.5" />
                {qualityLabel}
                {hasQualityScore && <span className="ml-1 opacity-75">{Math.round(qualityValue)}</span>}
              </span>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-1 px-6 pt-4 border-b border-[var(--v2-border)]">
            {tabs.map((tab) => {
              const Icon = tab.icon
              const isActive = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors relative ${
                    isActive
                      ? 'text-[var(--v2-primary)]'
                      : 'text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)]'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                  {isActive && (
                    <div
                      className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--v2-primary)]"
                    />
                  )}
                </button>
              )
            })}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {activeTab === 'overview' && (
              <div className="space-y-6">
                {/* Template Description */}
                <div>
                  <h3 className="text-sm font-semibold text-[var(--v2-text-primary)] mb-3">
                    Description
                  </h3>
                  <div
                    className="p-4 bg-[var(--v2-bg)]"
                    style={{
                      borderRadius: 'var(--v2-radius-button)',
                      border: '1px solid var(--v2-border)'
                    }}
                  >
                    <p className="text-sm text-[var(--v2-text-secondary)]">
                      {template.description || template.created_from_prompt || 'No description available'}
                    </p>
                  </div>
                </div>

                {/* Template Details Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Quality Score */}
                  <div
                    className="p-4 bg-[var(--v2-bg)]"
                    style={{
                      borderRadius: 'var(--v2-radius-button)',
                      border: '1px solid var(--v2-border)'
                    }}
                  >
                    <h4 className="text-xs font-semibold text-[var(--v2-text-muted)] mb-2 uppercase tracking-wide">
                      Quality Score
                    </h4>
                    {qualityValue > 0 ? (
                      <div className="flex items-center gap-3">
                        <div className="flex-1">
                          <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                            <div
                              className="h-full transition-all duration-500"
                              style={{
                                width: `${qualityValue}%`,
                                background: qualityValue >= 70
                                  ? '#10b981'
                                  : qualityValue >= 50
                                  ? '#f59e0b'
                                  : '#6b7280'
                              }}
                            />
                          </div>
                        </div>
                        <span className="text-lg font-semibold text-[var(--v2-text-primary)]">
                          {Math.round(qualityValue)}
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center justify-center py-2">
                        <span className="text-sm text-[var(--v2-text-muted)] italic">
                          Not yet rated
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Import Count */}
                  <div
                    className="p-4 bg-[var(--v2-bg)]"
                    style={{
                      borderRadius: 'var(--v2-radius-button)',
                      border: '1px solid var(--v2-border)'
                    }}
                  >
                    <h4 className="text-xs font-semibold text-[var(--v2-text-muted)] mb-2 uppercase tracking-wide">
                      Import Count
                    </h4>
                    <div className="flex items-center gap-2">
                      <Download className="w-5 h-5 text-[var(--v2-text-secondary)]" />
                      <span className="text-lg font-semibold text-[var(--v2-text-primary)]">
                        {template.import_count || 0}
                      </span>
                    </div>
                  </div>

                  {/* Shared Date */}
                  <div
                    className="p-4 bg-[var(--v2-bg)]"
                    style={{
                      borderRadius: 'var(--v2-radius-button)',
                      border: '1px solid var(--v2-border)'
                    }}
                  >
                    <h4 className="text-xs font-semibold text-[var(--v2-text-muted)] mb-2 uppercase tracking-wide">
                      Shared Date
                    </h4>
                    <div className="flex items-center gap-2">
                      <Calendar className="w-5 h-5 text-[var(--v2-text-secondary)]" />
                      <span className="text-sm font-medium text-[var(--v2-text-primary)]">
                        {sharedDate}
                      </span>
                    </div>
                  </div>

                  {/* Mode */}
                  {template.mode && (
                    <div
                      className="p-4 bg-[var(--v2-bg)]"
                      style={{
                        borderRadius: 'var(--v2-radius-button)',
                        border: '1px solid var(--v2-border)'
                      }}
                    >
                      <h4 className="text-xs font-semibold text-[var(--v2-text-muted)] mb-2 uppercase tracking-wide">
                        Agent Mode
                      </h4>
                      <div className="flex items-center gap-2">
                        <Settings className="w-5 h-5 text-[var(--v2-text-secondary)]" />
                        <span className="text-sm font-semibold text-[var(--v2-text-primary)]">
                          {template.mode === 'on_demand' ? 'On Demand' :
                           template.mode === 'scheduled' ? 'Scheduled' :
                           template.mode === 'workflow' ? 'Workflow' :
                           template.mode.split('_').map((word: string) =>
                             word.charAt(0).toUpperCase() + word.slice(1)
                           ).join(' ')}
                        </span>
                      </div>
                      <p className="text-xs text-[var(--v2-text-muted)] mt-2">
                        {template.mode === 'on_demand' ? 'Runs when manually triggered' :
                         template.mode === 'scheduled' ? 'Runs automatically on a schedule' :
                         template.mode === 'workflow' ? 'Part of a multi-step workflow' :
                         'Custom execution mode'}
                      </p>
                    </div>
                  )}
                </div>

                {/* Categories */}
                {categories.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-[var(--v2-text-primary)] mb-3">
                      Categories
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {categories.map((category, idx) => (
                        <span
                          key={idx}
                          className="text-xs px-3 py-1.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-medium"
                        >
                          {category}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Plugins Required */}
                {pluginsRequired.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-[var(--v2-text-primary)] mb-3">
                      Required Plugins
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {pluginsRequired.map((plugin, idx) => (
                        <div
                          key={idx}
                          className="p-3 bg-[var(--v2-bg)] flex items-center gap-3"
                          style={{
                            borderRadius: 'var(--v2-radius-button)',
                            border: '1px solid var(--v2-border)'
                          }}
                        >
                          <div className="w-8 h-8 bg-[var(--v2-surface)] flex items-center justify-center flex-shrink-0"
                            style={{
                              borderRadius: 'var(--v2-radius-button)',
                              border: '1px solid var(--v2-border)'
                            }}>
                            {getPluginIcon(plugin)}
                          </div>
                          <span className="text-sm font-medium text-[var(--v2-text-primary)]">
                            {getPluginDisplayName(plugin)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* AI Analysis */}
                {template.ai_reasoning && (
                  <div>
                    <h3 className="text-sm font-semibold text-[var(--v2-text-primary)] mb-3">
                      AI Analysis
                    </h3>
                    <div
                      className="p-4 bg-[var(--v2-bg)]"
                      style={{
                        borderRadius: 'var(--v2-radius-button)',
                        border: '1px solid var(--v2-border)'
                      }}
                    >
                      <p className="text-sm text-[var(--v2-text-secondary)] whitespace-pre-wrap">
                        {template.ai_reasoning}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'prompt' && (
              <div className="space-y-6">
                {/* User Prompt */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-[var(--v2-text-primary)]">
                      User Prompt
                    </h3>
                    <button
                      onClick={handleCopyPrompt}
                      className="px-3 py-1.5 text-sm font-medium bg-transparent text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] hover:bg-gray-100 dark:hover:bg-gray-800 transition-all flex items-center gap-2"
                      style={{ borderRadius: 'var(--v2-radius-button)' }}
                    >
                      {copied ? (
                        <>
                          <CheckCircle className="w-4 h-4" />
                          Copied!
                        </>
                      ) : (
                        <>
                          <Copy className="w-4 h-4" />
                          Copy
                        </>
                      )}
                    </button>
                  </div>
                  <div
                    className="p-4 bg-[var(--v2-bg)]"
                    style={{
                      borderRadius: 'var(--v2-radius-button)',
                      border: '1px solid var(--v2-border)'
                    }}
                  >
                    <p className="text-sm text-[var(--v2-text-secondary)] whitespace-pre-wrap">
                      {template.user_prompt}
                    </p>
                  </div>
                </div>

                {/* AI Analysis */}
                {template.ai_reasoning && (
                  <div>
                    <h3 className="text-sm font-semibold text-[var(--v2-text-primary)] mb-3">
                      AI Analysis
                    </h3>
                    <div
                      className="p-4 bg-[var(--v2-bg)]"
                      style={{
                        borderRadius: 'var(--v2-radius-button)',
                        border: '1px solid var(--v2-border)'
                      }}
                    >
                      <p className="text-sm text-[var(--v2-text-secondary)] whitespace-pre-wrap">
                        {template.ai_reasoning}
                      </p>
                    </div>
                  </div>
                )}

                {/* Generated Plan */}
                {template.generated_plan && (
                  <div>
                    <h3 className="text-sm font-semibold text-[var(--v2-text-primary)] mb-3">
                      Generated Plan
                    </h3>
                    <div
                      className="p-4 bg-[var(--v2-bg)]"
                      style={{
                        borderRadius: 'var(--v2-radius-button)',
                        border: '1px solid var(--v2-border)'
                      }}
                    >
                      <p className="text-sm text-[var(--v2-text-secondary)] whitespace-pre-wrap">
                        {template.generated_plan}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'plugins' && (
              <div className="space-y-6">
                {/* Plugins Required */}
                {pluginsRequired.length > 0 ? (
                  <div>
                    <h3 className="text-sm font-semibold text-[var(--v2-text-primary)] mb-3">
                      Required Plugins ({pluginsRequired.length})
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {pluginsRequired.map((plugin, idx) => (
                        <div
                          key={idx}
                          className="p-4 bg-[var(--v2-bg)] flex items-center gap-3"
                          style={{
                            borderRadius: 'var(--v2-radius-button)',
                            border: '1px solid var(--v2-border)'
                          }}
                        >
                          <div className="w-10 h-10 bg-[var(--v2-surface)] flex items-center justify-center flex-shrink-0"
                            style={{
                              borderRadius: 'var(--v2-radius-button)',
                              border: '1px solid var(--v2-border)'
                            }}>
                            {getPluginIcon(plugin)}
                          </div>
                          <span className="text-sm font-medium text-[var(--v2-text-primary)]">
                            {getPluginDisplayName(plugin)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-12 text-[var(--v2-text-muted)]">
                    <Zap className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p>No plugins required for this template</p>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'input_schema' && (
              <div className="space-y-6">
                {/* Input Schema */}
                {inputSchema && Array.isArray(inputSchema) && inputSchema.length > 0 ? (
                  <div>
                    <div className="mb-4">
                      <h3 className="text-sm font-semibold text-[var(--v2-text-primary)] mb-1">
                        What You'll Provide
                      </h3>
                      <p className="text-xs text-[var(--v2-text-secondary)]">
                        When running this template, you'll need to fill in these fields
                      </p>
                    </div>

                    {/* User-Friendly Input Form Preview */}
                    <div className="space-y-4">
                      {inputSchema.map((field: any, idx: number) => {
                        const fieldName = field.name || `field_${idx}`
                        const fieldType = field.type || 'text'
                        const isRequired = field.required || false
                        const placeholder = field.placeholder || `Enter ${fieldName.replace(/_/g, ' ')}...`

                        return (
                          <div
                            key={idx}
                            className="p-4 bg-[var(--v2-bg)]"
                            style={{
                              borderRadius: 'var(--v2-radius-button)',
                              border: '1px solid var(--v2-border)'
                            }}
                          >
                            <div className="mb-2 flex items-center gap-2">
                              <label className="text-sm font-semibold text-[var(--v2-text-primary)]">
                                {fieldName.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                              </label>
                              {isRequired && (
                                <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 font-medium">
                                  Required
                                </span>
                              )}
                            </div>

                            {field.description && (
                              <p className="text-xs text-[var(--v2-text-muted)] mb-3">
                                {field.description}
                              </p>
                            )}

                            {/* Input Field Preview */}
                            {field.enum ? (
                              <select
                                disabled
                                className="w-full px-3 py-2 bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] border border-[var(--v2-border)] text-sm"
                                style={{ borderRadius: 'var(--v2-radius-button)' }}
                              >
                                <option>{field.enum[0]}</option>
                                {field.enum.slice(1, 3).map((option: string, idx: number) => (
                                  <option key={idx}>{option}</option>
                                ))}
                              </select>
                            ) : fieldType === 'boolean' ? (
                              <div className="flex items-center gap-3">
                                <label className="flex items-center gap-2 cursor-not-allowed">
                                  <input type="radio" disabled checked className="w-4 h-4" />
                                  <span className="text-sm text-[var(--v2-text-secondary)]">Yes</span>
                                </label>
                                <label className="flex items-center gap-2 cursor-not-allowed">
                                  <input type="radio" disabled className="w-4 h-4" />
                                  <span className="text-sm text-[var(--v2-text-secondary)]">No</span>
                                </label>
                              </div>
                            ) : fieldType === 'number' ? (
                              <input
                                type="number"
                                disabled
                                placeholder={placeholder}
                                className="w-full px-3 py-2 bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] border border-[var(--v2-border)] text-sm"
                                style={{ borderRadius: 'var(--v2-radius-button)' }}
                              />
                            ) : (
                              <input
                                type="text"
                                disabled
                                placeholder={placeholder}
                                className="w-full px-3 py-2 bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] border border-[var(--v2-border)] text-sm"
                                style={{ borderRadius: 'var(--v2-radius-button)' }}
                              />
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-12 text-[var(--v2-text-muted)]">
                    <Code className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p className="text-sm font-medium mb-1">No Input Required</p>
                    <p className="text-xs">This template runs without any input from you</p>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'output_schema' && (
              <div className="space-y-6">
                {/* Output Schema */}
                {outputSchema && Array.isArray(outputSchema) && outputSchema.length > 0 ? (
                  <div>
                    <div className="mb-4">
                      <h3 className="text-sm font-semibold text-[var(--v2-text-primary)] mb-1">
                        What You'll Receive
                      </h3>
                      <p className="text-xs text-[var(--v2-text-secondary)]">
                        After the template completes, you'll receive these results
                      </p>
                    </div>

                    {/* User-Friendly Output Display Preview */}
                    <div className="space-y-4">
                      {outputSchema.map((field: any, idx: number) => {
                        const fieldName = field.name || `output_${idx}`
                        const fieldType = field.type || 'string'
                        const isPluginAction = fieldType === 'PluginAction'
                        const category = field.category || ''

                        // Generate example value based on field type
                        const exampleValue = field.examples && field.examples.length > 0 ? field.examples[0] :
                                          fieldType === 'string' ? `Your ${fieldName.toLowerCase()} will appear here` :
                                          fieldType === 'number' ? '42' :
                                          fieldType === 'boolean' ? 'True' :
                                          fieldType === 'PluginAction' ? `Action will be performed via ${field.plugin || 'plugin'}` :
                                          'Result data...'

                        return (
                          <div
                            key={idx}
                            className="p-4 bg-[var(--v2-bg)]"
                            style={{
                              borderRadius: 'var(--v2-radius-button)',
                              border: '1px solid var(--v2-border)'
                            }}
                          >
                            <div className="mb-2 flex items-center gap-2">
                              {isPluginAction ? (
                                <Zap className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                              ) : (
                                <FileText className="w-4 h-4 text-green-600 dark:text-green-400" />
                              )}
                              <label className="text-sm font-semibold text-[var(--v2-text-primary)]">
                                {fieldName}
                              </label>
                              {category === 'human-facing' && (
                                <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 font-medium">
                                  User Visible
                                </span>
                              )}
                              {isPluginAction && field.plugin && (
                                <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium">
                                  {field.plugin}
                                </span>
                              )}
                            </div>

                            {field.description && (
                              <p className="text-xs text-[var(--v2-text-muted)] mb-3">
                                {field.description}
                              </p>
                            )}

                            {/* Output Field Preview */}
                            <div
                              className="w-full px-3 py-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] text-sm text-[var(--v2-text-secondary)] italic"
                              style={{ borderRadius: 'var(--v2-radius-button)' }}
                            >
                              {exampleValue}
                            </div>

                            {field.examples && field.examples.length > 1 && (
                              <div className="mt-2">
                                <div className="text-xs text-[var(--v2-text-muted)] mb-1">Example outputs:</div>
                                <div className="flex flex-wrap gap-1">
                                  {field.examples.slice(1, 4).map((example: string, idx: number) => (
                                    <span key={idx} className="text-xs px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
                                      {example}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-12 text-[var(--v2-text-muted)]">
                    <FileText className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p className="text-sm font-medium mb-1">No Structured Output</p>
                    <p className="text-xs">This template returns unstructured text results</p>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'steps' && (
              <div className="space-y-6">
                {/* Workflow Steps */}
                {template.workflow_steps && template.workflow_steps.length > 0 ? (
                  <div>
                    <h3 className="text-sm font-semibold text-[var(--v2-text-primary)] mb-3">
                      Workflow Steps ({template.workflow_steps.length})
                    </h3>
                    <div className="space-y-4">
                      {template.workflow_steps.map((step: any, idx: number) => (
                        <div
                          key={idx}
                          className="p-5 bg-[var(--v2-bg)]"
                          style={{
                            borderRadius: 'var(--v2-radius-button)',
                            border: '1px solid var(--v2-border)'
                          }}
                        >
                          <div className="flex items-start gap-4">
                            <div className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-[var(--v2-primary)] text-white text-sm font-semibold">
                              {idx + 1}
                            </div>
                            <div className="flex-1 min-w-0 space-y-3">
                              {/* Step Name */}
                              <div>
                                <h4 className="text-base font-semibold text-[var(--v2-text-primary)] mb-1">
                                  {step.step_name || step.action || `Step ${idx + 1}`}
                                </h4>
                                {step.description && (
                                  <p className="text-sm text-[var(--v2-text-secondary)]">
                                    {step.description}
                                  </p>
                                )}
                              </div>

                              {/* Step Details */}
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                {/* Step Type */}
                                {step.type && (
                                  <div className="flex items-start gap-2">
                                    <Code className="w-4 h-4 text-[var(--v2-primary)] flex-shrink-0 mt-0.5" />
                                    <div>
                                      <div className="text-xs text-[var(--v2-text-muted)] mb-1">Step Type</div>
                                      <div className="text-xs px-2 py-1 rounded bg-[var(--v2-primary)]/10 text-[var(--v2-primary)] font-medium inline-block">
                                        {step.type.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())}
                                      </div>
                                    </div>
                                  </div>
                                )}

                                {/* Action Type */}
                                {step.action && (
                                  <div className="flex items-start gap-2">
                                    <Settings className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                                    <div>
                                      <div className="text-xs text-[var(--v2-text-muted)] mb-1">Action</div>
                                      <div className="text-xs px-2 py-1 rounded bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 font-medium inline-block">
                                        {step.action}
                                      </div>
                                    </div>
                                  </div>
                                )}

                                {/* Plugin */}
                                {step.plugin && (
                                  <div className="flex items-start gap-2">
                                    <Zap className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
                                    <div>
                                      <div className="text-xs text-[var(--v2-text-muted)] mb-1">Plugin</div>
                                      <div className="flex items-center gap-2">
                                        <div className="w-5 h-5 flex items-center justify-center">
                                          {getPluginIcon(step.plugin)}
                                        </div>
                                        <span className="text-xs font-medium text-[var(--v2-text-primary)]">
                                          {getPluginDisplayName(step.plugin)}
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                )}

                                {/* Model */}
                                {step.model && (
                                  <div className="flex items-start gap-2">
                                    <Bot className="w-4 h-4 text-purple-500 flex-shrink-0 mt-0.5" />
                                    <div>
                                      <div className="text-xs text-[var(--v2-text-muted)] mb-1">AI Model</div>
                                      <div className="text-xs font-medium text-[var(--v2-text-primary)]">
                                        {step.model}
                                      </div>
                                    </div>
                                  </div>
                                )}

                                {/* Timeout */}
                                {step.timeout && (
                                  <div className="flex items-start gap-2">
                                    <Calendar className="w-4 h-4 text-orange-500 flex-shrink-0 mt-0.5" />
                                    <div>
                                      <div className="text-xs text-[var(--v2-text-muted)] mb-1">Timeout</div>
                                      <div className="text-xs font-medium text-[var(--v2-text-primary)]">
                                        {step.timeout}s
                                      </div>
                                    </div>
                                  </div>
                                )}

                                {/* Max Retries */}
                                {(step.max_retries !== undefined || step.retries !== undefined) && (
                                  <div className="flex items-start gap-2">
                                    <RefreshCw className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
                                    <div>
                                      <div className="text-xs text-[var(--v2-text-muted)] mb-1">Max Retries</div>
                                      <div className="text-xs font-medium text-[var(--v2-text-primary)]">
                                        {step.max_retries ?? step.retries}
                                      </div>
                                    </div>
                                  </div>
                                )}

                                {/* Temperature */}
                                {step.temperature !== undefined && (
                                  <div className="flex items-start gap-2">
                                    <Bot className="w-4 h-4 text-pink-500 flex-shrink-0 mt-0.5" />
                                    <div>
                                      <div className="text-xs text-[var(--v2-text-muted)] mb-1">Temperature</div>
                                      <div className="text-xs font-medium text-[var(--v2-text-primary)]">
                                        {step.temperature}
                                      </div>
                                    </div>
                                  </div>
                                )}

                                {/* Max Tokens */}
                                {step.max_tokens !== undefined && (
                                  <div className="flex items-start gap-2">
                                    <Code className="w-4 h-4 text-indigo-500 flex-shrink-0 mt-0.5" />
                                    <div>
                                      <div className="text-xs text-[var(--v2-text-muted)] mb-1">Max Tokens</div>
                                      <div className="text-xs font-medium text-[var(--v2-text-primary)]">
                                        {step.max_tokens}
                                      </div>
                                    </div>
                                  </div>
                                )}

                                {/* Scatter (parallel execution) */}
                                {step.scatter && (
                                  <div className="flex items-start gap-2">
                                    <Zap className="w-4 h-4 text-yellow-500 flex-shrink-0 mt-0.5" />
                                    <div>
                                      <div className="text-xs text-[var(--v2-text-muted)] mb-1">Execution Mode</div>
                                      <div className="text-xs px-2 py-1 rounded bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 font-medium inline-block">
                                        Parallel
                                      </div>
                                    </div>
                                  </div>
                                )}

                                {/* Continue On Error */}
                                {step.continueOnError && (
                                  <div className="flex items-start gap-2">
                                    <CheckCircle className="w-4 h-4 text-teal-500 flex-shrink-0 mt-0.5" />
                                    <div>
                                      <div className="text-xs text-[var(--v2-text-muted)] mb-1">Error Handling</div>
                                      <div className="text-xs px-2 py-1 rounded bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 font-medium inline-block">
                                        Continue On Error
                                      </div>
                                    </div>
                                  </div>
                                )}

                                {/* Step ID */}
                                {step.id && (
                                  <div className="flex items-start gap-2">
                                    <Info className="w-4 h-4 text-slate-500 flex-shrink-0 mt-0.5" />
                                    <div>
                                      <div className="text-xs text-[var(--v2-text-muted)] mb-1">Step ID</div>
                                      <div className="text-xs font-mono text-[var(--v2-text-primary)]">
                                        {step.id}
                                      </div>
                                    </div>
                                  </div>
                                )}
                              </div>

                              {/* Dependencies */}
                              {step.dependencies && step.dependencies.length > 0 && (
                                <div className="p-3 bg-[var(--v2-surface)] rounded-lg border border-[var(--v2-border)]">
                                  <div className="text-xs text-[var(--v2-text-muted)] mb-2 font-semibold">Dependencies</div>
                                  <div className="flex flex-wrap gap-2">
                                    {step.dependencies.map((dep: string, depIdx: number) => (
                                      <span key={depIdx} className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-mono">
                                        {dep}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Prompt (if present) */}
                              {step.prompt && (
                                <div className="p-3 bg-[var(--v2-surface)] rounded-lg border border-[var(--v2-border)]">
                                  <div className="text-xs text-[var(--v2-text-muted)] mb-1.5 font-semibold">Prompt</div>
                                  <p className="text-xs text-[var(--v2-text-secondary)] whitespace-pre-wrap">
                                    {step.prompt}
                                  </p>
                                </div>
                              )}

                              {/* Conditions (if present) */}
                              {step.conditions && step.conditions.length > 0 && (
                                <div className="p-3 bg-[var(--v2-surface)] rounded-lg border border-[var(--v2-border)]">
                                  <div className="text-xs text-[var(--v2-text-muted)] mb-2 font-semibold">Conditions</div>
                                  <div className="space-y-1">
                                    {step.conditions.map((condition: any, cIdx: number) => (
                                      <div key={cIdx} className="text-xs text-[var(--v2-text-secondary)] font-mono">
                                        {condition.field} {condition.operator} {condition.value}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Params (if present) */}
                              {step.params && Object.keys(step.params).length > 0 && (
                                <div className="p-3 bg-[var(--v2-surface)] rounded-lg border border-[var(--v2-border)]">
                                  <div className="text-xs text-[var(--v2-text-muted)] mb-2 font-semibold">Params</div>
                                  <div className="space-y-1">
                                    {Object.entries(step.params).map(([key, value]: [string, any]) => (
                                      <div key={key} className="flex gap-2 text-xs">
                                        <span className="text-[var(--v2-text-muted)] font-mono">{key}:</span>
                                        <span className="text-[var(--v2-text-secondary)] font-mono break-all">
                                          {typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Parameters (if present) */}
                              {step.parameters && Object.keys(step.parameters).length > 0 && (
                                <div className="p-3 bg-[var(--v2-surface)] rounded-lg border border-[var(--v2-border)]">
                                  <div className="text-xs text-[var(--v2-text-muted)] mb-2 font-semibold">Parameters</div>
                                  <div className="space-y-1">
                                    {Object.entries(step.parameters).map(([key, value]: [string, any]) => (
                                      <div key={key} className="flex gap-2 text-xs">
                                        <span className="text-[var(--v2-text-muted)] font-mono">{key}:</span>
                                        <span className="text-[var(--v2-text-secondary)] font-mono break-all">
                                          {typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Operation & Input (for transform steps) */}
                              {step.operation && (
                                <div className="p-3 bg-[var(--v2-surface)] rounded-lg border border-[var(--v2-border)]">
                                  <div className="text-xs text-[var(--v2-text-muted)] mb-2 font-semibold">Transform Operation</div>
                                  <div className="space-y-1">
                                    <div className="flex gap-2 text-xs">
                                      <span className="text-[var(--v2-text-muted)] font-mono">Operation:</span>
                                      <span className="text-[var(--v2-text-secondary)] font-mono">{step.operation}</span>
                                    </div>
                                    {step.input && (
                                      <div className="flex gap-2 text-xs">
                                        <span className="text-[var(--v2-text-muted)] font-mono">Input:</span>
                                        <span className="text-[var(--v2-text-secondary)] font-mono">{step.input}</span>
                                      </div>
                                    )}
                                    {step.config && (
                                      <div className="flex gap-2 text-xs">
                                        <span className="text-[var(--v2-text-muted)] font-mono">Config:</span>
                                        <span className="text-[var(--v2-text-secondary)] font-mono break-all">
                                          {typeof step.config === 'object' ? JSON.stringify(step.config, null, 2) : String(step.config)}
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}

                              {/* Execute If (conditional execution) */}
                              {step.executeIf && (
                                <div className="p-3 bg-amber-50 dark:bg-amber-900/10 rounded-lg border border-amber-200 dark:border-amber-800">
                                  <div className="text-xs text-amber-700 dark:text-amber-400 mb-2 font-semibold">Conditional Execution</div>
                                  <p className="text-xs text-amber-600 dark:text-amber-300 font-mono">
                                    {typeof step.executeIf === 'object' ? JSON.stringify(step.executeIf, null, 2) : String(step.executeIf)}
                                  </p>
                                </div>
                              )}

                              {/* Expected Output (if present) */}
                              {step.expected_output && (
                                <div className="p-3 bg-[var(--v2-surface)] rounded-lg border border-[var(--v2-border)]">
                                  <div className="text-xs text-[var(--v2-text-muted)] mb-1.5 font-semibold">Expected Output</div>
                                  <p className="text-xs text-[var(--v2-text-secondary)]">
                                    {step.expected_output}
                                  </p>
                                </div>
                              )}

                              {/* Input Mapping (if present) */}
                              {step.input_mapping && Object.keys(step.input_mapping).length > 0 && (
                                <div className="p-3 bg-[var(--v2-surface)] rounded-lg border border-[var(--v2-border)]">
                                  <div className="text-xs text-[var(--v2-text-muted)] mb-2 font-semibold">Input Mapping</div>
                                  <div className="space-y-1">
                                    {Object.entries(step.input_mapping).map(([key, value]: [string, any]) => (
                                      <div key={key} className="flex gap-2 text-xs">
                                        <span className="text-[var(--v2-text-muted)] font-mono">{key}:</span>
                                        <span className="text-[var(--v2-text-secondary)] font-mono">
                                          {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Output Mapping (if present) */}
                              {step.output_mapping && Object.keys(step.output_mapping).length > 0 && (
                                <div className="p-3 bg-[var(--v2-surface)] rounded-lg border border-[var(--v2-border)]">
                                  <div className="text-xs text-[var(--v2-text-muted)] mb-2 font-semibold">Output Mapping</div>
                                  <div className="space-y-1">
                                    {Object.entries(step.output_mapping).map(([key, value]: [string, any]) => (
                                      <div key={key} className="flex gap-2 text-xs">
                                        <span className="text-[var(--v2-text-muted)] font-mono">{key}:</span>
                                        <span className="text-[var(--v2-text-secondary)] font-mono">
                                          {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Validation Rules (if present) */}
                              {step.validation && (
                                <div className="p-3 bg-[var(--v2-surface)] rounded-lg border border-[var(--v2-border)]">
                                  <div className="text-xs text-[var(--v2-text-muted)] mb-2 font-semibold">Validation Rules</div>
                                  <div className="space-y-1">
                                    {typeof step.validation === 'object' ? (
                                      Object.entries(step.validation).map(([key, value]: [string, any]) => (
                                        <div key={key} className="flex gap-2 text-xs">
                                          <span className="text-[var(--v2-text-muted)] font-mono">{key}:</span>
                                          <span className="text-[var(--v2-text-secondary)] font-mono">
                                            {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                                          </span>
                                        </div>
                                      ))
                                    ) : (
                                      <p className="text-xs text-[var(--v2-text-secondary)]">{step.validation}</p>
                                    )}
                                  </div>
                                </div>
                              )}

                              {/* Error Handling (if present) */}
                              {step.on_error && (
                                <div className="p-3 bg-red-50 dark:bg-red-900/10 rounded-lg border border-red-200 dark:border-red-800">
                                  <div className="text-xs text-red-700 dark:text-red-400 mb-1.5 font-semibold">Error Handling</div>
                                  <p className="text-xs text-red-600 dark:text-red-300">
                                    {step.on_error}
                                  </p>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-12 text-[var(--v2-text-muted)]">
                    <ListIcon className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p>No workflow steps defined for this template</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between gap-4 p-6 border-t border-[var(--v2-border)] bg-[var(--v2-bg)]">
            <div className="text-sm text-[var(--v2-text-muted)]">
              Template ID: <code className="text-xs font-mono">{template.id.slice(0, 8)}...</code>
            </div>
            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] border border-gray-200 dark:border-slate-700 transition-all"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                Close
              </button>
              <button
                onClick={handleImport}
                disabled={isImporting}
                className="px-4 py-2 text-sm font-medium bg-[var(--v2-primary)] text-white hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                {isImporting ? (
                  <>
                    <Activity className="w-4 h-4 animate-spin" />
                    Importing...
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    Import Template
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
