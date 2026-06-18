'use client'

/**
 * ManageCategoriesDrawer Component
 *
 * A slide-out drawer for managing workflow categories (groups).
 * Allows creating, editing, deleting categories and assigning agents.
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
  FolderPlus,
  Loader2,
  Check,
  AlertCircle
} from 'lucide-react'

interface WorkflowGroup {
  id: string
  name: string
  description: string | null
  color: string | null
  icon: string | null
  display_order: number
  agent_ids?: string[]
}

interface Agent {
  id: string
  agent_name: string
  status: string
}

interface ManageCategoriesDrawerProps {
  isOpen: boolean
  onClose: () => void
  onCategoriesChanged?: () => void
}

// Preset colors for categories
const COLOR_PRESETS = [
  '#6366F1', // Indigo
  '#8B5CF6', // Purple
  '#EC4899', // Pink
  '#EF4444', // Red
  '#F59E0B', // Amber
  '#10B981', // Emerald
  '#06B6D4', // Cyan
  '#3B82F6', // Blue
]

export function ManageCategoriesDrawer({
  isOpen,
  onClose,
  onCategoriesChanged
}: ManageCategoriesDrawerProps) {
  const [groups, setGroups] = useState<WorkflowGroup[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  // Edit mode
  const [editingGroup, setEditingGroup] = useState<WorkflowGroup | null>(null)
  const [isCreating, setIsCreating] = useState(false)

  // Form state
  const [formName, setFormName] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formColor, setFormColor] = useState(COLOR_PRESETS[0])
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([])

  // Memberships map: agent_id -> group_id
  const [memberships, setMemberships] = useState<Map<string, string>>(new Map())

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [groupsRes, agentsRes, membershipsRes] = await Promise.all([
        fetch('/api/v2/groups'),
        fetch('/api/v2/agents?limit=100&includeInactive=true'),
        fetch('/api/v2/groups/memberships')
      ])

      const groupsData = await groupsRes.json()
      const agentsData = await agentsRes.json()
      const membershipsData = await membershipsRes.json()

      if (groupsData.success) {
        setGroups(groupsData.data || [])
      }

      if (agentsData.success) {
        setAgents(agentsData.data || [])
      }

      if (membershipsData.success) {
        const membershipMap = new Map<string, string>()
        membershipsData.data?.forEach((m: { agent_id: string; group_id: string }) => {
          membershipMap.set(m.agent_id, m.group_id)
        })
        setMemberships(membershipMap)
      }
    } catch (err) {
      console.error('Failed to fetch data:', err)
      setError('Failed to load categories')
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
    setFormColor(COLOR_PRESETS[0])
    setSelectedAgentIds([])
    setEditingGroup(null)
    setIsCreating(false)
    setError(null)
  }

  const startCreating = () => {
    resetForm()
    setIsCreating(true)
  }

  const startEditing = (group: WorkflowGroup) => {
    setEditingGroup(group)
    setFormName(group.name)
    setFormDescription(group.description || '')
    setFormColor(group.color || COLOR_PRESETS[0])

    // Get agents in this group
    const groupAgentIds: string[] = []
    memberships.forEach((groupId, agentId) => {
      if (groupId === group.id) {
        groupAgentIds.push(agentId)
      }
    })
    setSelectedAgentIds(groupAgentIds)
    setIsCreating(false)
  }

  const handleSave = async () => {
    if (!formName.trim()) {
      setError('Category name is required')
      return
    }

    setSaving(true)
    setError(null)

    try {
      if (isCreating) {
        // Create new group
        const res = await fetch('/api/v2/groups', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: formName.trim(),
            description: formDescription.trim() || null,
            color: formColor,
            display_order: groups.length,
          }),
        })

        const data = await res.json()
        if (!data.success) {
          throw new Error(data.error || 'Failed to create category')
        }

        const newGroupId = data.data.id

        // Add agent memberships
        if (selectedAgentIds.length > 0) {
          await fetch(`/api/v2/groups/${newGroupId}/agents`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agent_ids: selectedAgentIds }),
          })
        }

        setSuccessMessage('Category created successfully')
      } else if (editingGroup) {
        // Update existing group
        const res = await fetch(`/api/v2/groups/${editingGroup.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: formName.trim(),
            description: formDescription.trim() || null,
            color: formColor,
          }),
        })

        const data = await res.json()
        if (!data.success) {
          throw new Error(data.error || 'Failed to update category')
        }

        // Update memberships
        // Get current members
        const currentMembers: string[] = []
        memberships.forEach((groupId, agentId) => {
          if (groupId === editingGroup.id) {
            currentMembers.push(agentId)
          }
        })

        // Remove agents no longer in the group
        const toRemove = currentMembers.filter(id => !selectedAgentIds.includes(id))
        const toAdd = selectedAgentIds.filter(id => !currentMembers.includes(id))

        // Remove and add agents in batches
        if (toRemove.length > 0) {
          await fetch(`/api/v2/groups/${editingGroup.id}/agents`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agent_ids: toRemove }),
          })
        }
        if (toAdd.length > 0) {
          await fetch(`/api/v2/groups/${editingGroup.id}/agents`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agent_ids: toAdd }),
          })
        }

        setSuccessMessage('Category updated successfully')
      }

      // Refresh data
      await fetchData()
      resetForm()
      onCategoriesChanged?.()

      // Clear success message after 2 seconds
      setTimeout(() => setSuccessMessage(null), 2000)
    } catch (err) {
      console.error('Save failed:', err)
      setError(err instanceof Error ? err.message : 'Failed to save category')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (groupId: string, groupName: string) => {
    if (!confirm(`Are you sure you want to delete "${groupName}"? Agents will be unassigned but not deleted.`)) {
      return
    }

    setSaving(true)
    setError(null)

    try {
      const res = await fetch(`/api/v2/groups/${groupId}`, {
        method: 'DELETE',
      })

      const data = await res.json()
      if (!data.success) {
        throw new Error(data.error || 'Failed to delete category')
      }

      setSuccessMessage('Category deleted')
      await fetchData()
      resetForm()
      onCategoriesChanged?.()

      setTimeout(() => setSuccessMessage(null), 2000)
    } catch (err) {
      console.error('Delete failed:', err)
      setError(err instanceof Error ? err.message : 'Failed to delete category')
    } finally {
      setSaving(false)
    }
  }

  const toggleAgentSelection = (agentId: string) => {
    setSelectedAgentIds(prev =>
      prev.includes(agentId)
        ? prev.filter(id => id !== agentId)
        : [...prev, agentId]
    )
  }

  if (!isOpen) return null

  const isEditing = isCreating || editingGroup !== null

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
                <FolderPlus className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-[var(--v2-text-primary)]">
                  Manage Categories
                </h2>
                <p className="text-sm text-[var(--v2-text-muted)]">
                  Organize your automations into groups
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
                  {isCreating ? 'Create New Category' : `Edit "${editingGroup?.name}"`}
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
                  Category Name *
                </label>
                <input
                  type="text"
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  placeholder="e.g., Marketing, Sales, Operations"
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
                  placeholder="Optional description for this category"
                  rows={2}
                  className="w-full px-3 py-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg text-[var(--v2-text-primary)] placeholder:text-[var(--v2-text-muted)] focus:outline-none focus:border-[var(--v2-primary)] resize-none"
                />
              </div>

              {/* Color */}
              <div>
                <label className="block text-sm font-medium text-[var(--v2-text-primary)] mb-2">
                  Color
                </label>
                <div className="flex gap-2">
                  {COLOR_PRESETS.map(color => (
                    <button
                      key={color}
                      onClick={() => setFormColor(color)}
                      className={`w-8 h-8 rounded-full transition ${
                        formColor === color ? 'ring-2 ring-offset-2 ring-[var(--v2-primary)]' : ''
                      }`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>

              {/* Assign Agents */}
              <div>
                <label className="block text-sm font-medium text-[var(--v2-text-primary)] mb-2">
                  Assign Automations
                </label>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {agents.length === 0 ? (
                    <p className="text-sm text-[var(--v2-text-muted)]">No automations available</p>
                  ) : (
                    agents.map(agent => {
                      const isSelected = selectedAgentIds.includes(agent.id)
                      const currentGroup = memberships.get(agent.id)
                      const otherGroupName = currentGroup && currentGroup !== editingGroup?.id
                        ? groups.find(g => g.id === currentGroup)?.name
                        : null

                      return (
                        <button
                          key={agent.id}
                          onClick={() => toggleAgentSelection(agent.id)}
                          className={`w-full flex items-center justify-between p-3 rounded-lg border transition ${
                            isSelected
                              ? 'border-[var(--v2-primary)] bg-indigo-50 dark:bg-indigo-500/10'
                              : 'border-[var(--v2-border)] bg-[var(--v2-surface-hover)] hover:border-[var(--v2-primary)]'
                          }`}
                        >
                          <div className="text-left">
                            <p className="text-sm font-medium text-[var(--v2-text-primary)]">
                              {agent.agent_name}
                            </p>
                            {otherGroupName && !isSelected && (
                              <p className="text-xs text-[var(--v2-text-muted)]">
                                Currently in: {otherGroupName}
                              </p>
                            )}
                          </div>
                          {isSelected && (
                            <Check className="w-4 h-4 text-[var(--v2-primary)]" />
                          )}
                        </button>
                      )
                    })
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
                {isCreating ? 'Create Category' : 'Save Changes'}
              </button>
            </div>
          ) : (
            /* Category List */
            <div className="space-y-4">
              {/* Create Button */}
              <button
                onClick={startCreating}
                className="w-full flex items-center justify-center gap-2 p-4 border-2 border-dashed border-[var(--v2-border)] rounded-xl text-[var(--v2-text-secondary)] hover:text-[var(--v2-primary)] hover:border-[var(--v2-primary)] transition"
              >
                <Plus className="w-5 h-5" />
                Create New Category
              </button>

              {/* Existing Groups */}
              {groups.length === 0 ? (
                <div className="text-center py-8 text-[var(--v2-text-muted)]">
                  <p>No categories yet.</p>
                  <p className="text-sm">Create one to organize your automations.</p>
                </div>
              ) : (
                groups.map(group => {
                  const agentCount = Array.from(memberships.values()).filter(gid => gid === group.id).length
                  return (
                    <div
                      key={group.id}
                      className="bg-[var(--v2-surface-hover)] rounded-xl p-4"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div
                            className="w-4 h-4 rounded-full"
                            style={{ backgroundColor: group.color || COLOR_PRESETS[0] }}
                          />
                          <div>
                            <h4 className="font-medium text-[var(--v2-text-primary)]">
                              {group.name}
                            </h4>
                            <p className="text-xs text-[var(--v2-text-muted)]">
                              {agentCount} automation{agentCount !== 1 ? 's' : ''}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => startEditing(group)}
                            className="p-2 rounded-lg text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] hover:bg-[var(--v2-surface)] transition"
                            title="Edit category"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(group.id, group.name)}
                            className="p-2 rounded-lg text-[var(--v2-text-muted)] hover:text-red-600 dark:hover:text-red-400 hover:bg-[var(--v2-surface)] transition"
                            title="Delete category"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      {group.description && (
                        <p className="mt-2 text-sm text-[var(--v2-text-secondary)]">
                          {group.description}
                        </p>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
