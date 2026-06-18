'use client'

/**
 * ManageGoalsDrawer Component
 *
 * A slide-out drawer for managing goals (SLAs).
 * Allows creating, editing, and deleting performance goals.
 *
 * Uses V2 theme design system for colors, dark mode support, and fonts.
 */

import React, { useEffect, useState, useCallback } from 'react'
import {
  X,
  Plus,
  Pencil,
  Trash2,
  Save,
  Target,
  Loader2,
  Check,
  AlertCircle
} from 'lucide-react'

interface SLA {
  id: string
  name: string
  description: string | null
  metric_name: string
  target_value: number
  threshold_type: 'above' | 'below' | 'between'
  threshold_max?: number | null
  status: 'active' | 'paused' | 'violated' | 'meeting'
  agent_id?: string | null
  group_id?: string | null
  applies_to_all: boolean
  current_value?: number | null
}

interface Agent {
  id: string
  agent_name: string
}

interface Group {
  id: string
  name: string
}

interface ManageGoalsDrawerProps {
  isOpen: boolean
  onClose: () => void
  onGoalsChanged?: () => void
}

const METRIC_OPTIONS = [
  { value: 'success_rate', label: 'Success Rate', unit: '%', description: 'Percentage of successful executions' },
  { value: 'avg_duration_ms', label: 'Average Duration', unit: 'ms', description: 'Average execution time' },
  { value: 'items_processed', label: 'Items Processed', unit: '', description: 'Total items processed' },
  { value: 'time_saved_seconds', label: 'Time Saved', unit: 's', description: 'Total time saved' },
  { value: 'execution_count', label: 'Execution Count', unit: '', description: 'Number of executions' },
]

const THRESHOLD_OPTIONS = [
  { value: 'above', label: 'At least', description: 'Value should be greater than or equal to target' },
  { value: 'below', label: 'At most', description: 'Value should be less than or equal to target' },
]

export function ManageGoalsDrawer({
  isOpen,
  onClose,
  onGoalsChanged
}: ManageGoalsDrawerProps) {
  const [slas, setSlas] = useState<SLA[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  // Edit mode
  const [editingSLA, setEditingSLA] = useState<SLA | null>(null)
  const [isCreating, setIsCreating] = useState(false)

  // Form state
  const [formName, setFormName] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formMetric, setFormMetric] = useState('success_rate')
  const [formTargetValue, setFormTargetValue] = useState<number>(95)
  const [formThresholdType, setFormThresholdType] = useState<'above' | 'below'>('above')
  const [formScope, setFormScope] = useState<'all' | 'agent' | 'group'>('all')
  const [formAgentId, setFormAgentId] = useState<string>('')
  const [formGroupId, setFormGroupId] = useState<string>('')

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [slasRes, agentsRes, groupsRes] = await Promise.all([
        fetch('/api/v2/slas'),
        fetch('/api/v2/agents?limit=100'),
        fetch('/api/v2/groups')
      ])

      const slasData = await slasRes.json()
      const agentsData = await agentsRes.json()
      const groupsData = await groupsRes.json()

      if (slasData.success) {
        setSlas(slasData.data?.slas || [])
      }

      if (agentsData.success) {
        setAgents(agentsData.data || [])
      }

      if (groupsData.success) {
        setGroups(groupsData.data || [])
      }
    } catch (err) {
      console.error('Failed to fetch data:', err)
      setError('Failed to load goals')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (isOpen) {
      fetchData()
    }
  }, [isOpen, fetchData])

  const resetForm = () => {
    setFormName('')
    setFormDescription('')
    setFormMetric('success_rate')
    setFormTargetValue(95)
    setFormThresholdType('above')
    setFormScope('all')
    setFormAgentId('')
    setFormGroupId('')
    setEditingSLA(null)
    setIsCreating(false)
    setError(null)
  }

  const startCreating = () => {
    resetForm()
    setIsCreating(true)
  }

  const startEditing = (sla: SLA) => {
    setEditingSLA(sla)
    setFormName(sla.name)
    setFormDescription(sla.description || '')
    setFormMetric(sla.metric_name)
    setFormTargetValue(sla.target_value)
    setFormThresholdType(sla.threshold_type === 'between' ? 'above' : sla.threshold_type)

    if (sla.agent_id) {
      setFormScope('agent')
      setFormAgentId(sla.agent_id)
    } else if (sla.group_id) {
      setFormScope('group')
      setFormGroupId(sla.group_id)
    } else {
      setFormScope('all')
    }

    setIsCreating(false)
  }

  const handleSave = async () => {
    if (!formName.trim()) {
      setError('Goal name is required')
      return
    }

    if (formTargetValue <= 0) {
      setError('Target value must be greater than 0')
      return
    }

    setSaving(true)
    setError(null)

    try {
      const payload = {
        name: formName.trim(),
        description: formDescription.trim() || null,
        metric_name: formMetric,
        target_value: formTargetValue,
        threshold_type: formThresholdType,
        agent_id: formScope === 'agent' && formAgentId ? formAgentId : null,
        group_id: formScope === 'group' && formGroupId ? formGroupId : null,
        applies_to_all: formScope === 'all',
      }

      if (isCreating) {
        const res = await fetch('/api/v2/slas', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })

        const data = await res.json()
        if (!data.success) {
          throw new Error(data.error || 'Failed to create goal')
        }

        setSuccessMessage('Goal created successfully')
      } else if (editingSLA) {
        const res = await fetch(`/api/v2/slas/${editingSLA.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })

        const data = await res.json()
        if (!data.success) {
          throw new Error(data.error || 'Failed to update goal')
        }

        setSuccessMessage('Goal updated successfully')
      }

      await fetchData()
      resetForm()
      onGoalsChanged?.()

      setTimeout(() => setSuccessMessage(null), 2000)
    } catch (err) {
      console.error('Save failed:', err)
      setError(err instanceof Error ? err.message : 'Failed to save goal')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (slaId: string, slaName: string) => {
    if (!confirm(`Are you sure you want to delete "${slaName}"?`)) {
      return
    }

    setSaving(true)
    setError(null)

    try {
      const res = await fetch(`/api/v2/slas/${slaId}`, {
        method: 'DELETE',
      })

      const data = await res.json()
      if (!data.success) {
        throw new Error(data.error || 'Failed to delete goal')
      }

      setSuccessMessage('Goal deleted')
      await fetchData()
      resetForm()
      onGoalsChanged?.()

      setTimeout(() => setSuccessMessage(null), 2000)
    } catch (err) {
      console.error('Delete failed:', err)
      setError(err instanceof Error ? err.message : 'Failed to delete goal')
    } finally {
      setSaving(false)
    }
  }

  const getMetricLabel = (metricName: string): string => {
    return METRIC_OPTIONS.find(m => m.value === metricName)?.label || metricName
  }

  const getMetricUnit = (metricName: string): string => {
    return METRIC_OPTIONS.find(m => m.value === metricName)?.unit || ''
  }

  const formatTargetDisplay = (sla: SLA): string => {
    const unit = getMetricUnit(sla.metric_name)
    const prefix = sla.threshold_type === 'above' ? '≥' : '≤'
    return `${prefix} ${sla.target_value}${unit}`
  }

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'meeting':
        return 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400'
      case 'violated':
        return 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-400'
      case 'paused':
        return 'bg-gray-100 dark:bg-gray-500/20 text-gray-700 dark:text-gray-400'
      default:
        return 'bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-400'
    }
  }

  if (!isOpen) return null

  const isEditing = isCreating || editingSLA !== null

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/50 z-40 transition-opacity"
        onClick={onClose}
      />

      {/* Drawer Panel */}
      <div className="fixed top-0 right-0 h-screen w-full max-w-xl bg-[var(--v2-surface)] shadow-2xl z-50 flex flex-col border-l border-[var(--v2-border)]">
        {/* Header */}
        <div className="flex-shrink-0 bg-[var(--v2-surface)] border-b border-[var(--v2-border)] px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-indigo-100 dark:bg-indigo-500/20 rounded-lg">
                <Target className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-[var(--v2-text-primary)]">
                  Manage Goals
                </h2>
                <p className="text-sm text-[var(--v2-text-muted)]">
                  Set performance targets for your automations
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] hover:bg-[var(--v2-surface-hover)] transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Messages */}
        {error && (
          <div className="mx-6 mt-4 p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-lg flex items-center gap-2 text-red-700 dark:text-red-400">
            <AlertCircle className="w-4 h-4" />
            <span className="text-sm">{error}</span>
          </div>
        )}
        {successMessage && (
          <div className="mx-6 mt-4 p-3 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 rounded-lg flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
            <Check className="w-4 h-4" />
            <span className="text-sm">{successMessage}</span>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-[var(--v2-text-muted)]" />
            </div>
          ) : isEditing ? (
            /* Edit/Create Form */
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="font-medium text-[var(--v2-text-primary)]">
                  {isCreating ? 'Create New Goal' : `Edit "${editingSLA?.name}"`}
                </h3>
                <button
                  onClick={resetForm}
                  className="text-sm text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)]"
                >
                  Cancel
                </button>
              </div>

              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-[var(--v2-text-primary)] mb-1">
                  Goal Name *
                </label>
                <input
                  type="text"
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  placeholder="e.g., High Success Rate, Fast Processing"
                  className="w-full px-3 py-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg text-[var(--v2-text-primary)] placeholder:text-[var(--v2-text-muted)] focus:outline-none focus:border-[var(--v2-primary)]"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-[var(--v2-text-primary)] mb-1">
                  Description
                </label>
                <textarea
                  value={formDescription}
                  onChange={e => setFormDescription(e.target.value)}
                  placeholder="Optional description for this goal"
                  rows={2}
                  className="w-full px-3 py-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg text-[var(--v2-text-primary)] placeholder:text-[var(--v2-text-muted)] focus:outline-none focus:border-[var(--v2-primary)] resize-none"
                />
              </div>

              {/* Metric */}
              <div>
                <label className="block text-sm font-medium text-[var(--v2-text-primary)] mb-1">
                  Metric to Track
                </label>
                <select
                  value={formMetric}
                  onChange={e => setFormMetric(e.target.value)}
                  className="w-full px-3 py-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg text-[var(--v2-text-primary)] focus:outline-none focus:border-[var(--v2-primary)]"
                >
                  {METRIC_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-[var(--v2-text-muted)]">
                  {METRIC_OPTIONS.find(m => m.value === formMetric)?.description}
                </p>
              </div>

              {/* Threshold Type & Value */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--v2-text-primary)] mb-1">
                    Condition
                  </label>
                  <select
                    value={formThresholdType}
                    onChange={e => setFormThresholdType(e.target.value as 'above' | 'below')}
                    className="w-full px-3 py-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg text-[var(--v2-text-primary)] focus:outline-none focus:border-[var(--v2-primary)]"
                  >
                    {THRESHOLD_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--v2-text-primary)] mb-1">
                    Target Value
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      value={formTargetValue}
                      onChange={e => setFormTargetValue(Number(e.target.value))}
                      min={0}
                      className="w-full px-3 py-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg text-[var(--v2-text-primary)] focus:outline-none focus:border-[var(--v2-primary)]"
                    />
                    {getMetricUnit(formMetric) && (
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--v2-text-muted)]">
                        {getMetricUnit(formMetric)}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Scope */}
              <div>
                <label className="block text-sm font-medium text-[var(--v2-text-primary)] mb-2">
                  Apply To
                </label>
                <div className="space-y-2">
                  <label className="flex items-center gap-3 p-3 rounded-lg border border-[var(--v2-border)] cursor-pointer hover:bg-[var(--v2-surface-hover)]">
                    <input
                      type="radio"
                      name="scope"
                      value="all"
                      checked={formScope === 'all'}
                      onChange={() => setFormScope('all')}
                      className="w-4 h-4 text-[var(--v2-primary)]"
                    />
                    <div>
                      <p className="text-sm font-medium text-[var(--v2-text-primary)]">All Automations</p>
                      <p className="text-xs text-[var(--v2-text-muted)]">Track across all your workflows</p>
                    </div>
                  </label>

                  <label className="flex items-center gap-3 p-3 rounded-lg border border-[var(--v2-border)] cursor-pointer hover:bg-[var(--v2-surface-hover)]">
                    <input
                      type="radio"
                      name="scope"
                      value="agent"
                      checked={formScope === 'agent'}
                      onChange={() => setFormScope('agent')}
                      className="w-4 h-4 text-[var(--v2-primary)]"
                    />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-[var(--v2-text-primary)]">Specific Automation</p>
                      {formScope === 'agent' && (
                        <select
                          value={formAgentId}
                          onChange={e => setFormAgentId(e.target.value)}
                          className="mt-2 w-full px-3 py-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg text-sm text-[var(--v2-text-primary)] focus:outline-none focus:border-[var(--v2-primary)]"
                        >
                          <option value="">Select automation...</option>
                          {agents.map(agent => (
                            <option key={agent.id} value={agent.id}>
                              {agent.agent_name}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  </label>

                  {groups.length > 0 && (
                    <label className="flex items-center gap-3 p-3 rounded-lg border border-[var(--v2-border)] cursor-pointer hover:bg-[var(--v2-surface-hover)]">
                      <input
                        type="radio"
                        name="scope"
                        value="group"
                        checked={formScope === 'group'}
                        onChange={() => setFormScope('group')}
                        className="w-4 h-4 text-[var(--v2-primary)]"
                      />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-[var(--v2-text-primary)]">Category</p>
                        {formScope === 'group' && (
                          <select
                            value={formGroupId}
                            onChange={e => setFormGroupId(e.target.value)}
                            className="mt-2 w-full px-3 py-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg text-sm text-[var(--v2-text-primary)] focus:outline-none focus:border-[var(--v2-primary)]"
                          >
                            <option value="">Select category...</option>
                            {groups.map(group => (
                              <option key={group.id} value={group.id}>
                                {group.name}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    </label>
                  )}
                </div>
              </div>

              {/* Save Button */}
              <button
                onClick={handleSave}
                disabled={saving || !formName.trim()}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-[var(--v2-primary)] text-white rounded-lg font-medium hover:opacity-90 transition disabled:opacity-50"
              >
                {saving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                {isCreating ? 'Create Goal' : 'Save Changes'}
              </button>
            </div>
          ) : (
            /* Goal List */
            <div className="space-y-4">
              {/* Create Button */}
              <button
                onClick={startCreating}
                className="w-full flex items-center justify-center gap-2 p-4 border-2 border-dashed border-[var(--v2-border)] rounded-xl text-[var(--v2-text-secondary)] hover:text-[var(--v2-primary)] hover:border-[var(--v2-primary)] transition"
              >
                <Plus className="w-5 h-5" />
                Create New Goal
              </button>

              {/* Existing Goals */}
              {slas.length === 0 ? (
                <div className="text-center py-8 text-[var(--v2-text-muted)]">
                  <p>No goals defined yet.</p>
                  <p className="text-sm">Create one to track your automation performance.</p>
                </div>
              ) : (
                slas.map(sla => (
                  <div
                    key={sla.id}
                    className="bg-[var(--v2-surface-hover)] rounded-xl p-4"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h4 className="font-medium text-[var(--v2-text-primary)]">
                            {sla.name}
                          </h4>
                          <span className={`px-2 py-0.5 rounded text-xs capitalize ${getStatusColor(sla.status)}`}>
                            {sla.status === 'meeting' ? 'On Track' : sla.status}
                          </span>
                        </div>
                        <p className="text-sm text-[var(--v2-text-secondary)] mt-1">
                          {getMetricLabel(sla.metric_name)}: {formatTargetDisplay(sla)}
                        </p>
                        {sla.description && (
                          <p className="text-xs text-[var(--v2-text-muted)] mt-1">
                            {sla.description}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => startEditing(sla)}
                          className="p-2 rounded-lg text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] hover:bg-[var(--v2-surface)] transition"
                          title="Edit goal"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(sla.id, sla.name)}
                          className="p-2 rounded-lg text-[var(--v2-text-muted)] hover:text-red-600 dark:hover:text-red-400 hover:bg-[var(--v2-surface)] transition"
                          title="Delete goal"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
