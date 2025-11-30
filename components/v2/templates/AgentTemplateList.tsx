'use client'

import React from 'react'
import { AgentTemplateCard, SharedAgentTemplate } from './AgentTemplateCard'
import { Loader2, Search, Inbox } from 'lucide-react'

type AgentTemplateListProps = {
  templates: SharedAgentTemplate[]
  onImport?: (templateId: string) => Promise<void>
  onPreview?: (template: SharedAgentTemplate) => void
  importingTemplates?: Set<string>
  viewType?: 'grid' | 'list'
  loading?: boolean
  emptyMessage?: string
}

export function AgentTemplateList({
  templates,
  onImport,
  onPreview,
  importingTemplates = new Set(),
  viewType = 'grid',
  loading = false,
  emptyMessage = 'No templates found'
}: AgentTemplateListProps) {
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Loader2 className="w-12 h-12 text-[var(--v2-primary)] animate-spin mb-4" />
        <p className="text-base text-[var(--v2-text-secondary)]">Loading templates...</p>
      </div>
    )
  }

  if (templates.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div
          className="w-20 h-20 flex items-center justify-center text-[var(--v2-text-muted)] mb-6"
          style={{
            borderRadius: 'var(--v2-radius-card)',
            background: 'var(--v2-surface)',
            border: '2px dashed var(--v2-border)'
          }}
        >
          <Inbox className="w-10 h-10" />
        </div>
        <h3 className="text-lg font-semibold text-[var(--v2-text-primary)] mb-2">
          No Templates Found
        </h3>
        <p className="text-sm text-[var(--v2-text-secondary)] max-w-md text-center">
          {emptyMessage}
        </p>
      </div>
    )
  }

  if (viewType === 'list') {
    return (
      <div className="space-y-3">
        {templates.map((template) => (
          <AgentTemplateCard
            key={template.id}
            template={template}
            onImport={onImport}
            onPreview={onPreview}
            isImporting={importingTemplates.has(template.id)}
            viewType="list"
          />
        ))}
      </div>
    )
  }

  // Grid view
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5 lg:gap-6">
      {templates.map((template) => (
        <AgentTemplateCard
          key={template.id}
          template={template}
          onImport={onImport}
          onPreview={onPreview}
          isImporting={importingTemplates.has(template.id)}
          viewType="grid"
        />
      ))}
    </div>
  )
}
