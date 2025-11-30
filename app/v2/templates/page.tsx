'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { useAuth } from '@/components/UserProvider'
import { V2Logo, V2Controls } from '@/components/v2/V2Header'
import { Card } from '@/components/v2/ui/card'
import { Input } from '@/components/v2/ui/input'
import {
  AgentTemplateList,
  TemplatePreviewModal,
  SharedAgentTemplate
} from '@/components/v2/templates'
import {
  Search,
  Grid3X3,
  List,
  ArrowUpDown,
  CheckCircle,
  AlertCircle,
  RefreshCw,
  ArrowLeft
} from 'lucide-react'

type FilterType = 'all' | 'high_confidence' | 'recent' | 'popular'
type ViewType = 'grid' | 'list'
type SortType = 'shared_desc' | 'shared_asc' | 'name_asc' | 'name_desc' | 'quality_desc'

export default function TemplatesPage() {
  const router = useRouter()
  const { user } = useAuth()

  // Data state
  const [templates, setTemplates] = useState<SharedAgentTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [importingTemplates, setImportingTemplates] = useState<Set<string>>(new Set())

  // Filter/sort state
  const [searchQuery, setSearchQuery] = useState('')
  const [filterType, setFilterType] = useState<FilterType>('all')
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [viewType, setViewType] = useState<ViewType>('grid')
  const [sortBy, setSortBy] = useState<SortType>('quality_desc')
  const [availableCategories, setAvailableCategories] = useState<string[]>([])

  // Preview modal state
  const [previewTemplate, setPreviewTemplate] = useState<SharedAgentTemplate | null>(null)
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)

  // Import status
  const [importStatus, setImportStatus] = useState<{
    type: 'success' | 'error'
    message: string
  } | null>(null)

  // Load templates
  useEffect(() => {
    loadTemplates()
  }, [])

  // Auto-hide status messages
  useEffect(() => {
    if (importStatus) {
      const timer = setTimeout(() => {
        setImportStatus(null)
      }, 5000)
      return () => clearTimeout(timer)
    }
  }, [importStatus])

  // Extract categories when templates load
  useEffect(() => {
    const categories = new Set<string>()
    templates.forEach((template) => {
      template.detected_categories?.forEach((cat) => categories.add(cat))
    })
    setAvailableCategories(Array.from(categories).sort())
  }, [templates])

  async function loadTemplates() {
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('shared_agents')
        .select(`
          *,
          quality_score,
          reliability_score,
          efficiency_score,
          adoption_score,
          complexity_score,
          base_executions,
          base_success_rate
        `)
        .order('shared_at', { ascending: false })

      if (error) throw error
      setTemplates(data || [])
    } catch (error) {
      console.error('Error loading templates:', error)
      setImportStatus({
        type: 'error',
        message: 'Failed to load templates. Please try again.'
      })
    } finally {
      setLoading(false)
    }
  }

  async function handleImport(templateId: string) {
    if (!user) {
      router.push('/login')
      return
    }

    try {
      setImportingTemplates((prev) => new Set(prev).add(templateId))

      const response = await fetch('/api/agents/import-shared', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sharedAgentId: templateId })
      })

      const result = await response.json()

      if (result.success) {
        setImportStatus({
          type: 'success',
          message: `Template imported successfully! Redirecting...`
        })

        // Close preview modal if open
        setIsPreviewOpen(false)

        // Redirect to the newly imported agent
        setTimeout(() => {
          router.push(`/v2/agents/${result.agentId}`)
        }, 1500)
      } else {
        throw new Error(result.error || 'Import failed')
      }
    } catch (error) {
      console.error('Error importing template:', error)
      setImportStatus({
        type: 'error',
        message: error instanceof Error ? error.message : 'Failed to import template'
      })
    } finally {
      setImportingTemplates((prev) => {
        const next = new Set(prev)
        next.delete(templateId)
        return next
      })
    }
  }

  function handlePreview(template: SharedAgentTemplate) {
    setPreviewTemplate(template)
    setIsPreviewOpen(true)
  }

  // Filter templates
  const filteredTemplates = templates
    .filter((template) => {
      // Search query
      if (searchQuery) {
        const query = searchQuery.toLowerCase()
        const matchesName = template.agent_name.toLowerCase().includes(query)
        const matchesDescription = template.description?.toLowerCase().includes(query)
        const matchesPrompt = template.created_from_prompt?.toLowerCase().includes(query)
        if (!matchesName && !matchesDescription && !matchesPrompt) return false
      }

      // Filter type
      // Use quality_score if available (0-100), otherwise fall back to ai_confidence (0-1)
      const qualityValue = template.quality_score !== undefined && template.quality_score !== null
        ? template.quality_score
        : (template.ai_confidence || 0) * 100

      if (filterType === 'high_confidence' && qualityValue < 70) return false
      if (filterType === 'recent') {
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
        if (new Date(template.shared_at) <= oneDayAgo) return false
      }
      if (filterType === 'popular' && qualityValue < 50) return false

      // Category filter
      if (selectedCategory !== 'all') {
        if (!template.detected_categories?.includes(selectedCategory)) return false
      }

      return true
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'shared_desc':
          return new Date(b.shared_at).getTime() - new Date(a.shared_at).getTime()
        case 'shared_asc':
          return new Date(a.shared_at).getTime() - new Date(b.shared_at).getTime()
        case 'name_asc':
          return a.agent_name.localeCompare(b.agent_name)
        case 'name_desc':
          return b.agent_name.localeCompare(a.agent_name)
        case 'quality_desc': {
          const qualityA = a.quality_score !== undefined && a.quality_score !== null
            ? a.quality_score
            : (a.ai_confidence || 0) * 100
          const qualityB = b.quality_score !== undefined && b.quality_score !== null
            ? b.quality_score
            : (b.ai_confidence || 0) * 100
          return qualityB - qualityA
        }
        default:
          return 0
      }
    })

  const filterOptions = [
    { value: 'all' as const, label: 'All Templates', count: templates.length },
    {
      value: 'high_confidence' as const,
      label: 'High Quality',
      count: templates.filter((t) => {
        const qualityValue = t.quality_score !== undefined && t.quality_score !== null
          ? t.quality_score
          : (t.ai_confidence || 0) * 100
        return qualityValue >= 70
      }).length
    },
    {
      value: 'recent' as const,
      label: 'Recent',
      count: templates.filter((t) => {
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
        return new Date(t.shared_at) > oneDayAgo
      }).length
    },
    {
      value: 'popular' as const,
      label: 'Popular',
      count: templates.filter((t) => {
        const qualityValue = t.quality_score !== undefined && t.quality_score !== null
          ? t.quality_score
          : (t.ai_confidence || 0) * 100
        return qualityValue >= 50
      }).length
    }
  ]

  const sortOptions = [
    { value: 'quality_desc' as const, label: 'Highest Quality' },
    { value: 'shared_desc' as const, label: 'Newest First' },
    { value: 'shared_asc' as const, label: 'Oldest First' },
    { value: 'name_asc' as const, label: 'A to Z' },
    { value: 'name_desc' as const, label: 'Z to A' }
  ]

  return (
    <div className="space-y-4 sm:space-y-5 lg:space-y-6">
      {/* Logo */}
      <div className="mb-3">
        <V2Logo />
      </div>

      {/* Back Button and Controls */}
      <div className="flex items-center justify-between mb-2">
        <button
          onClick={() => router.push('/v2/dashboard')}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] hover:scale-105 transition-all duration-200 text-sm font-medium shadow-[var(--v2-shadow-card)]"
          style={{ borderRadius: 'var(--v2-radius-button)' }}
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </button>
        <V2Controls />
      </div>

      {/* Header */}
      <div>
        <h1 className="text-2xl sm:text-3xl lg:text-4xl font-semibold text-[var(--v2-text-primary)] mb-1 leading-tight">
          Agent Templates
        </h1>
        <p className="text-base sm:text-lg lg:text-xl text-[var(--v2-text-secondary)]">
          Browse and import shared agent templates from the community
        </p>
      </div>

      {/* Import Status Banner */}
      {importStatus && (
        <div
          className={`p-4 flex items-center gap-3 animate-in slide-in-from-top-2 duration-300 ${
            importStatus.type === 'success'
              ? 'bg-[var(--v2-success-bg)] border-[var(--v2-success-border)] text-[var(--v2-success-text)]'
              : 'bg-[var(--v2-error-bg)] border-[var(--v2-error-border)] text-[var(--v2-error-text)]'
          }`}
          style={{
            borderRadius: 'var(--v2-radius-button)',
            border: '1px solid'
          }}
        >
          {importStatus.type === 'success' ? (
            <CheckCircle className="w-5 h-5 flex-shrink-0" />
          ) : (
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
          )}
          <p className="text-sm font-medium flex-1">{importStatus.message}</p>
          <button
            onClick={() => setImportStatus(null)}
            className="text-current hover:opacity-70 transition-opacity"
          >
            ×
          </button>
        </div>
      )}

      {/* Filters and Controls */}
      <Card className="!p-5">
        <div className="space-y-4">
          {/* Search and View Toggle */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <Input
                type="text"
                placeholder="Search templates..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                icon={<Search className="w-4 h-4" />}
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setViewType('grid')}
                className={`w-10 h-10 flex items-center justify-center transition-all duration-200 ${
                  viewType === 'grid'
                    ? 'bg-[var(--v2-primary)] text-white'
                    : 'bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] border border-gray-200 dark:border-slate-700'
                }`}
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                <Grid3X3 className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewType('list')}
                className={`w-10 h-10 flex items-center justify-center transition-all duration-200 ${
                  viewType === 'list'
                    ? 'bg-[var(--v2-primary)] text-white'
                    : 'bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] border border-gray-200 dark:border-slate-700'
                }`}
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                <List className="w-4 h-4" />
              </button>
              <button
                onClick={loadTemplates}
                disabled={loading}
                className="w-10 h-10 flex items-center justify-center bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] border border-gray-200 dark:border-slate-700 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {/* Filter and Sort Buttons */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            {/* Filter Buttons */}
            <div className="flex flex-wrap gap-2">
              {filterOptions.map((option) => (
                <button
                  key={option.value}
                  onClick={() => setFilterType(option.value)}
                  className={`px-3 py-2 text-sm font-medium transition-all duration-200 flex items-center gap-2 ${
                    filterType === option.value
                      ? 'bg-[var(--v2-primary)] text-white'
                      : 'bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] border border-gray-200 dark:border-slate-700'
                  }`}
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  {option.label}
                  <span className={`text-xs px-1.5 py-0.5 rounded ${
                    filterType === option.value
                      ? 'bg-white/20'
                      : 'bg-gray-100 dark:bg-gray-800 text-[var(--v2-text-muted)]'
                  }`}>
                    {option.count}
                  </span>
                </button>
              ))}
            </div>

            {/* Sort Options */}
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-[var(--v2-text-secondary)] flex items-center gap-2">
                <ArrowUpDown className="w-4 h-4" />
                Sort:
              </span>
              <div className="flex flex-wrap gap-2">
                {sortOptions.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => setSortBy(option.value)}
                    className={`px-3 py-1.5 text-sm font-medium transition-all duration-200 ${
                      sortBy === option.value
                        ? 'bg-[var(--v2-primary)] text-white'
                        : 'bg-transparent text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] hover:bg-gray-100 dark:hover:bg-gray-800'
                    }`}
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Category Filter */}
          {availableCategories.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-2 border-t border-[var(--v2-border)]">
              <span className="text-sm font-medium text-[var(--v2-text-secondary)] flex items-center mr-2">
                Categories:
              </span>
              <button
                onClick={() => setSelectedCategory('all')}
                className={`px-3 py-1.5 text-sm font-medium transition-all duration-200 ${
                  selectedCategory === 'all'
                    ? 'bg-[var(--v2-primary)] text-white'
                    : 'bg-transparent text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                All
              </button>
              {availableCategories.map((category) => (
                <button
                  key={category}
                  onClick={() => setSelectedCategory(category)}
                  className={`px-3 py-1.5 text-sm font-medium transition-all duration-200 ${
                    selectedCategory === category
                      ? 'bg-[var(--v2-primary)] text-white'
                      : 'bg-transparent text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  {category}
                </button>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* Results Count */}
      <div className="flex items-center justify-between text-sm text-[var(--v2-text-secondary)]">
        <span>
          Showing <strong className="text-[var(--v2-text-primary)]">{filteredTemplates.length}</strong> of{' '}
          <strong className="text-[var(--v2-text-primary)]">{templates.length}</strong> templates
        </span>
      </div>

      {/* Template List */}
      <AgentTemplateList
        templates={filteredTemplates}
        onImport={handleImport}
        onPreview={handlePreview}
        importingTemplates={importingTemplates}
        viewType={viewType}
        loading={loading}
        emptyMessage={
          searchQuery || filterType !== 'all' || selectedCategory !== 'all'
            ? 'No templates match your filters. Try adjusting your search criteria.'
            : 'No templates available yet. Check back soon!'
        }
      />

      {/* Preview Modal */}
      <TemplatePreviewModal
        template={previewTemplate}
        isOpen={isPreviewOpen}
        onClose={() => {
          setIsPreviewOpen(false)
          setPreviewTemplate(null)
        }}
        onImport={handleImport}
        isImporting={previewTemplate ? importingTemplates.has(previewTemplate.id) : false}
      />
    </div>
  )
}
