'use client'

import React, { useState } from 'react'
import { Card } from '@/components/v2/ui/card'
import {
  Download,
  Zap,
  Calendar,
  Activity,
  Eye,
  Mail,
  Globe
} from 'lucide-react'
import {
  SiGithub,
  SiTwilio,
  SiAmazon
} from 'react-icons/si'
import { PluginIcon } from '@/components/PluginIcon'

export type SharedAgentTemplate = {
  id: string
  agent_name: string
  description?: string
  system_prompt?: string
  user_prompt: string
  input_schema?: any
  output_schema?: any
  plugins_required?: string[]
  workflow_steps?: any
  mode?: string
  generated_plan?: string
  ai_reasoning?: string
  ai_confidence?: number
  detected_categories?: string[]
  created_from_prompt?: string
  ai_generated_at?: string
  connected_plugins?: any
  original_agent_id: string
  user_id: string
  shared_at: string
  created_at?: string
  updated_at?: string
  import_count?: number
  average_score?: number
  total_ratings?: number
  // New quality score fields (data-driven)
  quality_score?: number
  reliability_score?: number
  efficiency_score?: number
  adoption_score?: number
  complexity_score?: number
  base_executions?: number
  base_success_rate?: number
}

type AgentTemplateCardProps = {
  template: SharedAgentTemplate
  onImport?: (templateId: string) => Promise<void>
  onPreview?: (template: SharedAgentTemplate) => void
  isImporting?: boolean
  viewType?: 'grid' | 'list'
}

// Plugin icon mapping
const pluginIcons: Record<string, React.ReactNode> = {
  'google-mail': <PluginIcon pluginId="google-mail" className="w-4 h-4" alt="Gmail" />,
  'gmail': <PluginIcon pluginId="google-mail" className="w-4 h-4" alt="Gmail" />,
  'github': <SiGithub className="w-4 h-4" style={{ color: '#FFFFFF' }} />,
  'slack': <PluginIcon pluginId="slack" className="w-4 h-4" alt="Slack" />,
  'twilio': <SiTwilio className="w-4 h-4" style={{ color: '#F22F46' }} />,
  'aws-ses': <SiAmazon className="w-4 h-4" style={{ color: '#FF9900' }} />,
  'sendgrid': <Mail className="w-4 h-4 text-blue-600" />,
  'stripe': <PluginIcon pluginId="stripe" className="w-4 h-4" alt="Stripe" />,
  'openai': <PluginIcon pluginId="openai" className="w-4 h-4" alt="OpenAI" />,
  'anthropic': <PluginIcon pluginId="anthropic" className="w-4 h-4" alt="Anthropic" />,
  'sheets': <PluginIcon pluginId="google-sheets" className="w-4 h-4" alt="Google Sheets" />,
  'google-sheets': <PluginIcon pluginId="google-sheets" className="w-4 h-4" alt="Google Sheets" />,
  'airtable': <PluginIcon pluginId="airtable" className="w-4 h-4" alt="Airtable" />,
  'notion': <PluginIcon pluginId="notion" className="w-4 h-4" alt="Notion" />,
  'calendar': <PluginIcon pluginId="google-calendar" className="w-4 h-4" alt="Calendar" />,
  'google-calendar': <PluginIcon pluginId="google-calendar" className="w-4 h-4" alt="Calendar" />,
  'zapier': <Zap className="w-4 h-4 text-orange-500" />,
}

const getPluginIcon = (pluginKey: string) => {
  return pluginIcons[pluginKey] || <Globe className="w-4 h-4 text-slate-400" />
}

const getPluginDisplayName = (pluginKey: string) => {
  const names: Record<string, string> = {
    'google-mail': 'Gmail',
    'gmail': 'Gmail',
    'github': 'GitHub',
    'slack': 'Slack',
    'twilio': 'Twilio',
    'aws-ses': 'AWS SES',
    'sendgrid': 'SendGrid',
    'stripe': 'Stripe',
    'openai': 'OpenAI',
    'anthropic': 'Anthropic',
    'sheets': 'Google Sheets',
    'google-sheets': 'Google Sheets',
    'airtable': 'Airtable',
    'notion': 'Notion',
    'calendar': 'Google Calendar',
    'google-calendar': 'Google Calendar',
    'zapier': 'Zapier',
  }
  return names[pluginKey] || pluginKey.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
}

export function AgentTemplateCard({
  template,
  onImport,
  onPreview,
  isImporting = false,
  viewType = 'grid'
}: AgentTemplateCardProps) {
  const [isHovered, setIsHovered] = useState(false)

  // Use quality_score if available (0-100 scale), otherwise fall back to ai_confidence (0-1 scale)
  const hasQualityScore = template.quality_score !== undefined && template.quality_score !== null
  const qualityValue = hasQualityScore ? template.quality_score : (template.ai_confidence || 0) * 100

  const qualityLabel = qualityValue >= 70 ? 'High Quality' : qualityValue >= 50 ? 'Good Quality' : 'Standard'
  const qualityColor = qualityValue >= 70 ? 'green' : qualityValue >= 50 ? 'yellow' : 'gray'

  const categories = template.detected_categories || []
  const pluginsRequired = template.plugins_required || []

  const handleImport = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (onImport && !isImporting) {
      await onImport(template.id)
    }
  }

  const handlePreview = () => {
    if (onPreview) {
      onPreview(template)
    }
  }

  // Format dates
  const sharedDate = new Date(template.shared_at).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  })

  const isNew = () => {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
    return new Date(template.shared_at) > oneDayAgo
  }

  if (viewType === 'list') {
    return (
      <Card
        hoverable
        onClick={handlePreview}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className="cursor-pointer transition-all duration-200"
      >
        <div className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4 flex-1 min-w-0">
              {/* Left side: Quality score badge */}
              <div className="flex-shrink-0 pt-1">
                <div
                  className={`px-2.5 py-1.5 rounded-lg border-2 flex items-center gap-1.5 ${
                    qualityColor === 'green'
                      ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                      : qualityColor === 'yellow'
                      ? 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800'
                      : 'bg-gray-50 dark:bg-gray-900/20 border-gray-200 dark:border-gray-800'
                  }`}
                  title={hasQualityScore ? `Quality Score: ${Math.round(qualityValue)}/100` : `AI Confidence: ${Math.round(qualityValue)}%`}
                >
                  <div className={`text-lg font-bold ${
                    qualityColor === 'green'
                      ? 'text-green-700 dark:text-green-300'
                      : qualityColor === 'yellow'
                      ? 'text-yellow-700 dark:text-yellow-300'
                      : 'text-gray-700 dark:text-gray-300'
                  }`}>{Math.round(qualityValue)}</div>
                </div>
              </div>

              {/* Main content */}
              <div className="flex-1 min-w-0">
                {/* Title row */}
                <div className="flex items-center gap-2 mb-2">
                  <h3 className="text-lg font-semibold text-[var(--v2-text-primary)] truncate">
                    {template.agent_name}
                  </h3>
                  {isNew() && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 flex-shrink-0 font-medium">
                      New
                    </span>
                  )}
                </div>

                {/* Description */}
                <p className="text-sm text-[var(--v2-text-secondary)] line-clamp-2 mb-3">
                  {template.description || template.created_from_prompt || 'No description'}
                </p>

                {/* Categories */}
                {categories.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {categories.slice(0, 4).map((category, idx) => (
                      <span
                        key={idx}
                        className="text-xs px-2.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-medium"
                      >
                        {category}
                      </span>
                    ))}
                    {categories.length > 4 && (
                      <span className="text-xs px-2.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-medium">
                        +{categories.length - 4} more
                      </span>
                    )}
                  </div>
                )}

                {/* Meta info */}
                <div className="flex items-center gap-4 text-xs text-[var(--v2-text-muted)]">
                  <div className="flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5" />
                    <span>{sharedDate}</span>
                  </div>
                  {template.import_count !== undefined && template.import_count > 0 && (
                    <div className="flex items-center gap-1.5">
                      <Download className="w-3.5 h-3.5" />
                      <span>{template.import_count} {template.import_count === 1 ? 'import' : 'imports'}</span>
                    </div>
                  )}
                  {pluginsRequired.length > 0 && (
                    <div className="flex items-center gap-2">
                      <div className="flex -space-x-1.5">
                        {pluginsRequired.slice(0, 4).map((plugin, idx) => (
                          <div
                            key={idx}
                            className="w-5 h-5 bg-white dark:bg-gray-900 rounded-full flex items-center justify-center border-2 border-[var(--v2-bg)] shadow-sm"
                            title={getPluginDisplayName(plugin)}
                          >
                            {getPluginIcon(plugin)}
                          </div>
                        ))}
                        {pluginsRequired.length > 4 && (
                          <div className="w-5 h-5 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center border-2 border-[var(--v2-bg)] shadow-sm">
                            <span className="text-[10px] font-semibold text-gray-600 dark:text-gray-400">
                              +{pluginsRequired.length - 4}
                            </span>
                          </div>
                        )}
                      </div>
                      <span>{pluginsRequired.length} {pluginsRequired.length === 1 ? 'plugin' : 'plugins'}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Right side: Actions */}
            <div className="flex gap-2 flex-shrink-0">
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  handlePreview()
                }}
                className="px-4 py-2 text-sm font-medium bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] border border-gray-200 dark:border-slate-700 transition-all flex items-center justify-center gap-2 whitespace-nowrap"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                <Eye className="w-4 h-4" />
                Preview
              </button>
              <button
                onClick={handleImport}
                disabled={isImporting}
                className="px-4 py-2 text-sm font-medium bg-[var(--v2-primary)] text-white hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 whitespace-nowrap"
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
                    Import
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </Card>
    )
  }

  // Grid view
  return (
    <Card
      hoverable
      onClick={handlePreview}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="cursor-pointer transition-all duration-200 h-full flex flex-col"
    >
      <div className="p-5 flex flex-col h-full">
        {/* Header with quality score badge */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div
            className={`px-2.5 py-1.5 rounded-lg border-2 flex items-center gap-1.5 ${
              qualityColor === 'green'
                ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                : qualityColor === 'yellow'
                ? 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800'
                : 'bg-gray-50 dark:bg-gray-900/20 border-gray-200 dark:border-gray-800'
            }`}
            title={hasQualityScore ? `Quality Score: ${Math.round(qualityValue)}/100` : `AI Confidence: ${Math.round(qualityValue)}%`}
          >
            <div className={`text-base font-bold ${
              qualityColor === 'green'
                ? 'text-green-700 dark:text-green-300'
                : qualityColor === 'yellow'
                ? 'text-yellow-700 dark:text-yellow-300'
                : 'text-gray-700 dark:text-gray-300'
            }`}>{Math.round(qualityValue)}</div>
            <div className={`text-[10px] font-semibold uppercase tracking-wide ${
              qualityColor === 'green'
                ? 'text-green-600 dark:text-green-400'
                : qualityColor === 'yellow'
                ? 'text-yellow-600 dark:text-yellow-400'
                : 'text-gray-600 dark:text-gray-400'
            }`}>
              {qualityLabel.split(' ')[0]}
            </div>
          </div>

          <div className="flex flex-col items-end gap-2">
            {isNew() && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                New
              </span>
            )}
          </div>
        </div>

        {/* Title and description */}
        <div className="flex-1 mb-4">
          <h3 className="text-lg font-semibold text-[var(--v2-text-primary)] mb-2 line-clamp-2">
            {template.agent_name}
          </h3>
          <p className="text-sm text-[var(--v2-text-secondary)] line-clamp-3 mb-3">
            {template.description || template.created_from_prompt || 'No description available'}
          </p>

          {/* Categories */}
          {categories.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {categories.slice(0, 3).map((category, idx) => (
                <span
                  key={idx}
                  className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300"
                >
                  {category}
                </span>
              ))}
              {categories.length > 3 && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
                  +{categories.length - 3}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Meta information */}
        <div className="flex items-center justify-between text-xs text-[var(--v2-text-muted)] mb-4 pb-4 border-b border-[var(--v2-border)]">
          <div className="flex items-center gap-1">
            <Calendar className="w-3.5 h-3.5" />
            <span>{sharedDate}</span>
          </div>
          {template.import_count !== undefined && template.import_count > 0 && (
            <div className="flex items-center gap-1">
              <Download className="w-3.5 h-3.5" />
              <span>{template.import_count}</span>
            </div>
          )}
          {pluginsRequired.length > 0 && (
            <div className="flex items-center gap-1.5">
              <div className="flex -space-x-1">
                {pluginsRequired.slice(0, 3).map((plugin, idx) => (
                  <div
                    key={idx}
                    className="w-3.5 h-3.5 bg-[var(--v2-surface)] rounded-full flex items-center justify-center border border-[var(--v2-bg)]"
                    title={getPluginDisplayName(plugin)}
                  >
                    {getPluginIcon(plugin)}
                  </div>
                ))}
              </div>
              <span>{pluginsRequired.length}</span>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation()
              handlePreview()
            }}
            className="flex-1 px-4 py-2 text-sm font-medium bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] border border-gray-200 dark:border-slate-700 transition-all flex items-center justify-center gap-2"
            style={{ borderRadius: 'var(--v2-radius-button)' }}
          >
            <Eye className="w-4 h-4" />
            Preview
          </button>
          <button
            onClick={handleImport}
            disabled={isImporting}
            className="flex-1 px-4 py-2 text-sm font-medium bg-[var(--v2-primary)] text-white hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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
                Import
              </>
            )}
          </button>
        </div>
      </div>
    </Card>
  )
}
