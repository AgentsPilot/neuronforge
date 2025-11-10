'use client'

import React, { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import {
  Palette,
  Monitor,
  Moon,
  Sun,
  Eye,
  Settings,
  Save,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Sparkles,
  RotateCcw,
  Edit3,
  Type,
  Maximize,
  BoxSelect
} from 'lucide-react'
import { v2Tokens } from '@/lib/design-system-v2/tokens'

type UIVersion = 'v1' | 'v2'

interface DesignToken {
  name: string
  value: string
  description: string
  category: 'color' | 'radius' | 'shadow' | 'typography' | 'spacing'
  editable?: boolean
}

interface CustomTokens {
  colors?: Record<string, string>
  borderRadius?: Record<string, string>
  shadows?: Record<string, string>
  typography?: Record<string, string>
  spacing?: Record<string, string>
}

export default function UIConfigPage() {
  const [currentVersion, setCurrentVersion] = useState<UIVersion>('v1')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)
  const [editMode, setEditMode] = useState(false)
  const [customTokens, setCustomTokens] = useState<CustomTokens>({})
  const [customInputs, setCustomInputs] = useState<Record<string, boolean>>({})
  const [showResetConfirm, setShowResetConfirm] = useState(false)

  // Build complete token list from v2Tokens + custom overrides
  const getDesignTokens = (): DesignToken[] => {
    const tokens: DesignToken[] = []

    // Colors
    tokens.push(
      { name: 'background', value: customTokens.colors?.background || v2Tokens.colors.background, description: 'Page background', category: 'color', editable: true },
      { name: 'surface', value: customTokens.colors?.surface || v2Tokens.colors.surface, description: 'Panel/card background', category: 'color', editable: true },
      { name: 'primary', value: customTokens.colors?.primary || v2Tokens.colors.brand.primary, description: 'Primary brand color', category: 'color', editable: true },
      { name: 'primaryDark', value: customTokens.colors?.primaryDark || v2Tokens.colors.brand.primaryDark, description: 'Primary dark variant', category: 'color', editable: true },
      { name: 'secondary', value: customTokens.colors?.secondary || v2Tokens.colors.brand.secondary, description: 'Secondary brand color', category: 'color', editable: true },
      { name: 'textPrimary', value: customTokens.colors?.textPrimary || v2Tokens.colors.text.primary, description: 'Primary text color', category: 'color', editable: true },
      { name: 'textSecondary', value: customTokens.colors?.textSecondary || v2Tokens.colors.text.secondary, description: 'Secondary text color', category: 'color', editable: true },
    )

    // Border Radius
    tokens.push(
      { name: 'panel', value: customTokens.borderRadius?.panel || v2Tokens.borderRadius.panel, description: 'Large container radius', category: 'radius', editable: true },
      { name: 'card', value: customTokens.borderRadius?.card || v2Tokens.borderRadius.card, description: 'Card radius', category: 'radius', editable: true },
      { name: 'button', value: customTokens.borderRadius?.button || v2Tokens.borderRadius.button, description: 'Button radius', category: 'radius', editable: true },
      { name: 'input', value: customTokens.borderRadius?.input || v2Tokens.borderRadius.input, description: 'Input radius', category: 'radius', editable: true },
    )

    // Shadows
    tokens.push(
      { name: 'card', value: customTokens.shadows?.card || v2Tokens.shadows.card, description: 'Card shadow', category: 'shadow', editable: true },
      { name: 'cardHover', value: customTokens.shadows?.cardHover || v2Tokens.shadows.cardHover, description: 'Card hover shadow', category: 'shadow', editable: true },
      { name: 'button', value: customTokens.shadows?.button || v2Tokens.shadows.button, description: 'Button shadow', category: 'shadow', editable: true },
    )

    // Spacing
    tokens.push(
      { name: 'panel', value: customTokens.spacing?.panel || v2Tokens.spacing.panel, description: 'Main panel padding', category: 'spacing', editable: true },
      { name: 'card', value: customTokens.spacing?.card || v2Tokens.spacing.card, description: 'Card padding', category: 'spacing', editable: true },
      { name: 'section', value: customTokens.spacing?.section || v2Tokens.spacing.section, description: 'Section spacing', category: 'spacing', editable: true },
    )

    // Typography
    tokens.push(
      { name: 'fontSizeBase', value: customTokens.typography?.fontSizeBase || v2Tokens.typography.fontSize.base, description: 'Base font size', category: 'typography', editable: true },
      { name: 'fontSizeLg', value: customTokens.typography?.fontSizeLg || v2Tokens.typography.fontSize.lg, description: 'Large font size', category: 'typography', editable: true },
      { name: 'fontSizeXl', value: customTokens.typography?.fontSizeXl || v2Tokens.typography.fontSize.xl, description: 'Extra large font size', category: 'typography', editable: true },
    )

    return tokens
  }

  useEffect(() => {
    fetchCurrentVersion()
    loadCustomTokens()
  }, [])

  const fetchCurrentVersion = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/admin/ui-config', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        throw new Error('Failed to fetch UI configuration')
      }

      const result = await response.json()

      if (!result.success) {
        throw new Error(result.error || 'Failed to load configuration')
      }

      setCurrentVersion(result.data.uiVersion || 'v1')
      setCustomTokens(result.data.customTokens || {})
    } catch (err) {
      console.error('Error:', err)
      setMessage({ type: 'error', text: 'Failed to load configuration' })
    } finally {
      setLoading(false)
    }
  }

  const loadCustomTokens = async () => {
    // Tokens are now loaded in fetchCurrentVersion
  }

  const saveCustomTokens = async () => {
    setSaving(true)
    setMessage(null)

    try {
      const response = await fetch('/api/admin/ui-config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'save_tokens',
          data: { tokens: customTokens }
        })
      })

      if (!response.ok) {
        throw new Error('Failed to save custom tokens')
      }

      const result = await response.json()

      if (!result.success) {
        throw new Error(result.error || 'Failed to save tokens')
      }

      setMessage({ type: 'success', text: 'Custom tokens saved successfully! Refresh V2 pages to see changes.' })
      setEditMode(false)
    } catch (err) {
      console.error('Error:', err)
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'An error occurred while saving' })
    } finally {
      setSaving(false)
    }
  }

  const resetToDefaults = async () => {
    setSaving(true)
    setMessage(null)
    setShowResetConfirm(false)

    try {
      const response = await fetch('/api/admin/ui-config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'reset_tokens',
          data: {}
        })
      })

      if (!response.ok) {
        throw new Error('Failed to reset tokens')
      }

      const result = await response.json()

      if (!result.success) {
        throw new Error(result.error || 'Failed to reset tokens')
      }

      setCustomTokens({})
      setMessage({ type: 'success', text: 'Tokens reset to defaults successfully!' })
      setEditMode(false)
    } catch (err) {
      console.error('Error:', err)
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'An error occurred while resetting' })
    } finally {
      setSaving(false)
    }
  }

  const getCustomTokenCount = () => {
    let count = 0
    if (customTokens.colors) count += Object.keys(customTokens.colors).length
    if (customTokens.borderRadius) count += Object.keys(customTokens.borderRadius).length
    if (customTokens.shadows) count += Object.keys(customTokens.shadows).length
    if (customTokens.spacing) count += Object.keys(customTokens.spacing).length
    if (customTokens.typography) count += Object.keys(customTokens.typography).length
    return count
  }

  const handleVersionToggle = async (checked: boolean) => {
    const newVersion: UIVersion = checked ? 'v2' : 'v1'
    setSaving(true)
    setMessage(null)

    try {
      const response = await fetch('/api/admin/ui-config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'update_version',
          data: { version: newVersion }
        })
      })

      if (!response.ok) {
        throw new Error('Failed to update UI version')
      }

      const result = await response.json()

      if (!result.success) {
        throw new Error(result.error || 'Failed to update version')
      }

      setCurrentVersion(newVersion)
      setMessage({
        type: 'success',
        text: `Successfully switched to ${newVersion.toUpperCase()}! Refresh your browser to see changes.`
      })
    } catch (err) {
      console.error('Error:', err)
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'An error occurred while saving' })
    } finally {
      setSaving(false)
    }
  }

  const handleTokenChange = (category: string, name: string, value: string) => {
    setCustomTokens(prev => ({
      ...prev,
      [category]: {
        ...prev[category as keyof CustomTokens],
        [name]: value,
      },
    }))
  }

  const handleSelectChange = (category: string, name: string, value: string, options: string[]) => {
    const key = `${category}-${name}`
    if (value === 'custom') {
      setCustomInputs(prev => ({ ...prev, [key]: true }))
    } else {
      setCustomInputs(prev => ({ ...prev, [key]: false }))
      handleTokenChange(category, name, value)
    }
  }

  const isCustomValue = (value: string, options: string[]) => {
    return !options.includes(value)
  }

  // Predefined options for each token type
  const radiusOptions = ['4px', '8px', '12px', '16px', '20px', '24px', '32px', 'custom']
  const shadowOptions = [
    '0 1px 2px rgba(0,0,0,0.05)',
    '0 2px 4px rgba(0,0,0,0.1)',
    '0 4px 8px rgba(0,0,0,0.12)',
    '0 8px 16px rgba(0,0,0,0.15)',
    '0 2px 16px rgba(0,0,0,0.06)',
    '0 8px 24px rgba(0,0,0,0.12)',
    'custom'
  ]
  const spacingOptions = ['4px', '8px', '12px', '16px', '20px', '24px', '32px', '40px', '48px', 'custom']
  const fontSizeOptions = ['0.75rem', '0.875rem', '1rem', '1.125rem', '1.25rem', '1.5rem', '1.875rem', '2.25rem', 'custom']

  const designTokens = getDesignTokens()
  const colorTokens = designTokens.filter(t => t.category === 'color')
  const radiusTokens = designTokens.filter(t => t.category === 'radius')
  const shadowTokens = designTokens.filter(t => t.category === 'shadow')
  const spacingTokens = designTokens.filter(t => t.category === 'spacing')
  const typographyTokens = designTokens.filter(t => t.category === 'typography')

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-slate-400">Loading configuration...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-gradient-to-br from-violet-500 to-purple-500 rounded-xl flex items-center justify-center shadow-lg">
            <Palette className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-white">UI Configuration</h1>
            <p className="text-slate-400">Control design system and UI version</p>
          </div>
        </div>
        <div className={`px-4 py-2 rounded-lg border flex items-center gap-2 ${
          currentVersion === 'v2'
            ? 'bg-violet-500/20 border-violet-500/30 text-violet-300'
            : 'bg-slate-700/50 border-white/10 text-slate-300'
        }`}>
          {currentVersion === 'v2' ? (
            <>
              <Sparkles className="w-4 h-4" />
              <span className="font-medium">V2 Active</span>
            </>
          ) : (
            <>
              <Monitor className="w-4 h-4" />
              <span className="font-medium">V1 Active</span>
            </>
          )}
        </div>
      </div>

      {/* Message Banner */}
      {message && (
        <div className={`flex items-center gap-3 p-4 rounded-xl border backdrop-blur-xl ${
          message.type === 'success'
            ? 'bg-green-500/20 border-green-500/30 text-green-300'
            : 'bg-red-500/20 border-red-500/30 text-red-300'
        }`}>
          {message.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
          ) : (
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
          )}
          <p className="font-medium">{message.text}</p>
        </div>
      )}

      {/* Version Control Card */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-slate-800/50 backdrop-blur-xl rounded-xl p-6 border border-white/10"
      >
        <div className="mb-6">
          <h2 className="text-xl font-semibold text-white flex items-center gap-2 mb-2">
            <Monitor className="w-5 h-5" />
            UI Version Control
          </h2>
          <p className="text-sm text-slate-400">
            Switch between V1 (current) and V2 (new design system) interfaces
          </p>
        </div>
        <div className="space-y-6">
          <div className="flex items-center justify-between p-6 bg-violet-500/10 rounded-xl border border-violet-500/20">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 bg-violet-500/20 rounded-xl shadow-sm flex items-center justify-center">
                <Settings className="w-7 h-7 text-violet-400" />
              </div>
              <div>
                <Label htmlFor="version-toggle" className="text-lg font-semibold text-white cursor-pointer">
                  Enable V2 Design System
                </Label>
                <p className="text-sm text-slate-400 mt-1">
                  {currentVersion === 'v2'
                    ? 'Users are seeing the new V2 interface with modern design'
                    : 'Users are seeing the classic V1 interface'}
                </p>
              </div>
            </div>
            <Switch
              id="version-toggle"
              checked={currentVersion === 'v2'}
              onCheckedChange={handleVersionToggle}
              disabled={saving}
              className="data-[state=checked]:bg-violet-600"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* V1 Info */}
            <div className={`p-5 rounded-xl border-2 transition-all ${
              currentVersion === 'v1'
                ? 'border-violet-500/50 bg-violet-500/10'
                : 'border-white/10 bg-slate-700/30'
            }`}>
              <div className="flex items-center gap-3 mb-3">
                <Monitor className="w-5 h-5 text-slate-300" />
                <h3 className="font-semibold text-white">V1 (Classic)</h3>
              </div>
              <ul className="space-y-2 text-sm text-slate-300">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-400" />
                  Current stable version
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-400" />
                  Existing gradient design
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-400" />
                  All features working
                </li>
              </ul>
            </div>

            {/* V2 Info */}
            <div className={`p-5 rounded-xl border-2 transition-all ${
              currentVersion === 'v2'
                ? 'border-violet-500/50 bg-violet-500/10'
                : 'border-white/10 bg-slate-700/30'
            }`}>
              <div className="flex items-center gap-3 mb-3">
                <Sparkles className="w-5 h-5 text-violet-400" />
                <h3 className="font-semibold text-white">V2 (Modern)</h3>
              </div>
              <ul className="space-y-2 text-sm text-slate-300">
                <li className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-violet-400" />
                  Mockup-inspired design
                </li>
                <li className="flex items-center gap-2">
                  <Moon className="w-4 h-4 text-violet-400" />
                  Dark mode support
                </li>
                <li className="flex items-center gap-2">
                  <Palette className="w-4 h-4 text-violet-400" />
                  Clean, modern aesthetics
                </li>
              </ul>
            </div>
          </div>

          <div className="flex items-center gap-3 p-4 bg-blue-500/20 border border-blue-500/30 rounded-xl">
            <Eye className="w-5 h-5 text-blue-400 flex-shrink-0" />
            <p className="text-sm text-blue-200">
              <strong>Preview V2:</strong> Add <code className="px-2 py-1 bg-blue-500/30 rounded text-xs">?ui=v2</code> to any URL to temporarily view V2 without changing the global setting
            </p>
          </div>
        </div>
      </motion.div>

      {/* V2 Design Tokens Card */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-slate-800/50 backdrop-blur-xl rounded-xl p-6 border border-white/10"
      >
        <div className="mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-white flex items-center gap-2 mb-2">
                <Palette className="w-5 h-5" />
                V2 Design System Tokens
              </h2>
              <p className="text-sm text-slate-400">
                Customize design tokens for the V2 interface
              </p>
            </div>
            <div className="flex items-center gap-2">
              {getCustomTokenCount() > 0 && (
                <Button
                  onClick={() => setShowResetConfirm(true)}
                  variant="outline"
                  size="sm"
                  disabled={saving}
                  className="text-red-300 border-red-500/30 hover:bg-red-500/20 hover:text-red-200 hover:border-red-500/50 transition-all"
                >
                  <RotateCcw className="w-4 h-4 mr-2" />
                  Reset ({getCustomTokenCount()})
                </Button>
              )}
              <Button
                onClick={() => {
                  if (editMode) {
                    saveCustomTokens()
                  } else {
                    setEditMode(true)
                  }
                }}
                variant={editMode ? "default" : "outline"}
                size="sm"
                disabled={saving}
                className={editMode ? "bg-violet-600 hover:bg-violet-700 text-white" : "text-slate-200 border-slate-600 hover:bg-slate-700 hover:text-white"}
              >
                {editMode ? (
                  <>
                    <Save className="w-4 h-4 mr-2" />
                    Save Changes
                  </>
                ) : (
                  <>
                    <Edit3 className="w-4 h-4 mr-2" />
                    Edit Tokens
                  </>
                )}
              </Button>
              {editMode && (
                <Button
                  onClick={() => {
                    setEditMode(false)
                    loadCustomTokens()
                  }}
                  variant="ghost"
                  size="sm"
                  className="text-slate-300 hover:bg-slate-700 hover:text-white"
                >
                  Cancel
                </Button>
              )}
            </div>
          </div>
        </div>
        <div className="space-y-6">
          {/* Color Tokens */}
          <div>
            <h3 className="font-semibold text-white mb-4 flex items-center gap-2">
              <div className="w-8 h-8 bg-gradient-to-br from-pink-500 to-purple-500 rounded-lg"></div>
              Color Tokens
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {colorTokens.map((token) => (
                <div key={token.name} className="p-4 bg-slate-700/30 rounded-xl border border-white/10">
                  <div className="flex items-center gap-3 mb-2">
                    <div
                      className="w-10 h-10 rounded-lg border-2 border-slate-600 shadow-sm flex-shrink-0"
                      style={{ backgroundColor: token.value }}
                    ></div>
                    <div className="flex-1 min-w-0">
                      <code className="text-xs font-mono text-slate-200 block truncate">{token.name}</code>
                      <p className="text-xs text-slate-400 mt-1">{token.description}</p>
                    </div>
                  </div>
                  {editMode ? (
                    <div className="mt-2 flex gap-2">
                      <Input
                        type="color"
                        value={token.value}
                        onChange={(e) => handleTokenChange('colors', token.name, e.target.value)}
                        className="w-16 h-10 p-1 bg-slate-700/50 border-slate-600 cursor-pointer"
                      />
                      <Input
                        type="text"
                        value={token.value}
                        onChange={(e) => handleTokenChange('colors', token.name, e.target.value)}
                        className="flex-1 font-mono text-xs bg-slate-700/50 border-slate-600 text-white"
                        placeholder="#000000"
                      />
                    </div>
                  ) : (
                    <div className="mt-2 px-2 py-1 bg-slate-700/50 rounded border border-slate-600">
                      <code className="text-xs font-mono text-violet-400">{token.value}</code>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Radius Tokens */}
          <div>
            <h3 className="font-semibold text-white mb-4 flex items-center gap-2">
              <BoxSelect className="w-5 h-5 text-blue-400" />
              Border Radius Tokens
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {radiusTokens.map((token) => (
                <div key={token.name} className="p-4 bg-slate-700/30 rounded-xl border border-white/10">
                  <div className="flex items-center gap-3 mb-3">
                    <div
                      className="w-12 h-12 bg-gradient-to-br from-violet-500 to-purple-500 shadow-sm flex-shrink-0"
                      style={{ borderRadius: token.value }}
                    ></div>
                    <div className="flex-1 min-w-0">
                      <code className="text-xs font-mono text-slate-200 block truncate">{token.name}</code>
                      <p className="text-xs text-slate-400 mt-1">{token.description}</p>
                    </div>
                  </div>
                  {editMode ? (
                    <div className="space-y-2">
                      <select
                        value={isCustomValue(token.value, radiusOptions.filter(o => o !== 'custom')) ? 'custom' : token.value}
                        onChange={(e) => handleSelectChange('borderRadius', token.name, e.target.value, radiusOptions)}
                        className="w-full px-3 py-2 font-mono text-xs bg-slate-700/50 border border-slate-600 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
                      >
                        {radiusOptions.map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                      {(customInputs[`borderRadius-${token.name}`] || isCustomValue(token.value, radiusOptions.filter(o => o !== 'custom'))) && (
                        <Input
                          type="text"
                          value={token.value}
                          onChange={(e) => handleTokenChange('borderRadius', token.name, e.target.value)}
                          className="font-mono text-xs bg-slate-700/50 border-slate-600 text-white"
                          placeholder="12px"
                        />
                      )}
                    </div>
                  ) : (
                    <div className="px-2 py-1 bg-slate-700/50 rounded border border-slate-600">
                      <code className="text-xs font-mono text-violet-400">{token.value}</code>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Shadow Tokens */}
          <div>
            <h3 className="font-semibold text-white mb-4 flex items-center gap-2">
              <BoxSelect className="w-5 h-5 text-purple-400" />
              Shadow Tokens
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {shadowTokens.map((token) => (
                <div key={token.name} className="p-4 bg-slate-700/30 rounded-xl border border-white/10">
                  <div className="mb-3">
                    <div
                      className="w-full h-16 bg-slate-800 rounded-lg flex items-center justify-center border border-white/5"
                      style={{ boxShadow: token.value }}
                    >
                      <code className="text-xs font-mono text-slate-400">{token.name}</code>
                    </div>
                  </div>
                  <p className="text-xs text-slate-400 mb-2">{token.description}</p>
                  {editMode ? (
                    <div className="space-y-2">
                      <select
                        value={isCustomValue(token.value, shadowOptions.filter(o => o !== 'custom')) ? 'custom' : token.value}
                        onChange={(e) => handleSelectChange('shadows', token.name, e.target.value, shadowOptions)}
                        className="w-full px-3 py-2 font-mono text-xs bg-slate-700/50 border border-slate-600 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
                      >
                        {shadowOptions.map((option) => (
                          <option key={option} value={option}>{option === 'custom' ? 'Custom' : option}</option>
                        ))}
                      </select>
                      {(customInputs[`shadows-${token.name}`] || isCustomValue(token.value, shadowOptions.filter(o => o !== 'custom'))) && (
                        <Input
                          type="text"
                          value={token.value}
                          onChange={(e) => handleTokenChange('shadows', token.name, e.target.value)}
                          className="font-mono text-xs bg-slate-700/50 border-slate-600 text-white"
                          placeholder="0 2px 4px rgba(0,0,0,0.1)"
                        />
                      )}
                    </div>
                  ) : (
                    <div className="px-2 py-1 bg-slate-700/50 rounded border border-slate-600">
                      <code className="text-xs font-mono text-violet-400 break-all">{token.value}</code>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Spacing Tokens */}
          <div>
            <h3 className="font-semibold text-white mb-4 flex items-center gap-2">
              <Maximize className="w-5 h-5 text-green-400" />
              Spacing Tokens
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {spacingTokens.map((token) => (
                <div key={token.name} className="p-4 bg-slate-700/30 rounded-xl border border-white/10">
                  <div className="mb-3">
                    <div className="bg-slate-800 rounded-lg p-2 border border-white/10">
                      <div
                        className="bg-gradient-to-br from-green-500 to-emerald-500 rounded"
                        style={{ padding: token.value }}
                      >
                        <div className="bg-slate-800 rounded text-center text-xs py-1 text-white">
                          {token.value}
                        </div>
                      </div>
                    </div>
                  </div>
                  <code className="text-xs font-mono text-slate-200 block mb-1">{token.name}</code>
                  <p className="text-xs text-slate-400 mb-2">{token.description}</p>
                  {editMode ? (
                    <div className="space-y-2">
                      <select
                        value={isCustomValue(token.value, spacingOptions.filter(o => o !== 'custom')) ? 'custom' : token.value}
                        onChange={(e) => handleSelectChange('spacing', token.name, e.target.value, spacingOptions)}
                        className="w-full px-3 py-2 font-mono text-xs bg-slate-700/50 border border-slate-600 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
                      >
                        {spacingOptions.map((option) => (
                          <option key={option} value={option}>{option === 'custom' ? 'Custom' : option}</option>
                        ))}
                      </select>
                      {(customInputs[`spacing-${token.name}`] || isCustomValue(token.value, spacingOptions.filter(o => o !== 'custom'))) && (
                        <Input
                          type="text"
                          value={token.value}
                          onChange={(e) => handleTokenChange('spacing', token.name, e.target.value)}
                          className="font-mono text-xs bg-slate-700/50 border-slate-600 text-white"
                          placeholder="24px"
                        />
                      )}
                    </div>
                  ) : (
                    <div className="px-2 py-1 bg-slate-700/50 rounded border border-slate-600">
                      <code className="text-xs font-mono text-violet-400">{token.value}</code>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Typography Tokens */}
          <div>
            <h3 className="font-semibold text-white mb-4 flex items-center gap-2">
              <Type className="w-5 h-5 text-indigo-400" />
              Typography Tokens
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {typographyTokens.map((token) => (
                <div key={token.name} className="p-4 bg-slate-700/30 rounded-xl border border-white/10">
                  <div className="mb-3 bg-slate-800 rounded-lg p-3 border border-white/10">
                    <div style={{ fontSize: token.value }} className="text-white font-medium">
                      Aa
                    </div>
                  </div>
                  <code className="text-xs font-mono text-slate-200 block mb-1">{token.name}</code>
                  <p className="text-xs text-slate-400 mb-2">{token.description}</p>
                  {editMode ? (
                    <div className="space-y-2">
                      <select
                        value={isCustomValue(token.value, fontSizeOptions.filter(o => o !== 'custom')) ? 'custom' : token.value}
                        onChange={(e) => handleSelectChange('typography', token.name, e.target.value, fontSizeOptions)}
                        className="w-full px-3 py-2 font-mono text-xs bg-slate-700/50 border border-slate-600 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
                      >
                        {fontSizeOptions.map((option) => (
                          <option key={option} value={option}>{option === 'custom' ? 'Custom' : option}</option>
                        ))}
                      </select>
                      {(customInputs[`typography-${token.name}`] || isCustomValue(token.value, fontSizeOptions.filter(o => o !== 'custom'))) && (
                        <Input
                          type="text"
                          value={token.value}
                          onChange={(e) => handleTokenChange('typography', token.name, e.target.value)}
                          className="font-mono text-xs bg-slate-700/50 border-slate-600 text-white"
                          placeholder="1rem"
                        />
                      )}
                    </div>
                  ) : (
                    <div className="px-2 py-1 bg-slate-700/50 rounded border border-slate-600">
                      <code className="text-xs font-mono text-violet-400">{token.value}</code>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {!editMode && (
            <div className="flex items-center gap-3 p-4 bg-blue-500/20 border border-blue-500/30 rounded-xl">
              <AlertCircle className="w-5 h-5 text-blue-400 flex-shrink-0" />
              <p className="text-sm text-blue-200">
                <strong>Tip:</strong> Click "Edit Tokens" to customize any design token. Changes will be applied to all V2 pages after saving.
              </p>
            </div>
          )}
        </div>
      </motion.div>

      {/* Quick Actions */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="bg-slate-800/50 backdrop-blur-xl rounded-xl p-6 border border-white/10"
      >
        <div className="mb-6">
          <h2 className="text-xl font-semibold text-white flex items-center gap-2">
            <RefreshCw className="w-5 h-5" />
            Quick Actions
          </h2>
        </div>
        <div className="space-y-3">
          <Button
            onClick={() => window.open('/?ui=v2', '_blank')}
            variant="outline"
            className="w-full justify-start text-slate-200 border-slate-600 hover:bg-slate-700 hover:text-white"
          >
            <Eye className="w-4 h-4 mr-2" />
            Preview V2 Dashboard (New Tab)
          </Button>
          <Button
            onClick={() => window.open('/?ui=v1', '_blank')}
            variant="outline"
            className="w-full justify-start text-slate-200 border-slate-600 hover:bg-slate-700 hover:text-white"
          >
            <Monitor className="w-4 h-4 mr-2" />
            Preview V1 Dashboard (New Tab)
          </Button>
          <Button
            onClick={fetchCurrentVersion}
            variant="outline"
            className="w-full justify-start text-slate-200 border-slate-600 hover:bg-slate-700 hover:text-white"
            disabled={loading}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh Configuration
          </Button>
        </div>
      </motion.div>

      {/* Reset Confirmation Modal */}
      <AnimatePresence>
        {showResetConfirm && (
          <>
            {/* Backdrop */}
            <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowResetConfirm(false)}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          >
            {/* Modal */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-slate-800 border border-red-500/30 rounded-2xl shadow-2xl max-w-md w-full overflow-hidden"
            >
              {/* Header */}
              <div className="bg-gradient-to-r from-red-500/20 to-orange-500/20 border-b border-red-500/30 p-6">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-red-500/20 rounded-xl flex items-center justify-center">
                    <AlertCircle className="w-6 h-6 text-red-400" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-white">Reset to Defaults?</h3>
                    <p className="text-sm text-slate-300 mt-1">This action cannot be undone</p>
                  </div>
                </div>
              </div>

              {/* Content */}
              <div className="p-6 space-y-4">
                <p className="text-slate-300">
                  You are about to reset <strong className="text-white">{getCustomTokenCount()} customized token{getCustomTokenCount() !== 1 ? 's' : ''}</strong> back to their default values.
                </p>

                <div className="bg-slate-900/50 border border-slate-700 rounded-xl p-4 space-y-2">
                  <p className="text-sm font-semibold text-slate-200 mb-2">Tokens to be reset:</p>
                  {customTokens.colors && Object.keys(customTokens.colors).length > 0 && (
                    <div className="flex items-center gap-2 text-sm text-slate-300">
                      <div className="w-2 h-2 bg-pink-500 rounded-full"></div>
                      <span>{Object.keys(customTokens.colors).length} Color token{Object.keys(customTokens.colors).length !== 1 ? 's' : ''}</span>
                    </div>
                  )}
                  {customTokens.borderRadius && Object.keys(customTokens.borderRadius).length > 0 && (
                    <div className="flex items-center gap-2 text-sm text-slate-300">
                      <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                      <span>{Object.keys(customTokens.borderRadius).length} Border radius token{Object.keys(customTokens.borderRadius).length !== 1 ? 's' : ''}</span>
                    </div>
                  )}
                  {customTokens.shadows && Object.keys(customTokens.shadows).length > 0 && (
                    <div className="flex items-center gap-2 text-sm text-slate-300">
                      <div className="w-2 h-2 bg-purple-500 rounded-full"></div>
                      <span>{Object.keys(customTokens.shadows).length} Shadow token{Object.keys(customTokens.shadows).length !== 1 ? 's' : ''}</span>
                    </div>
                  )}
                  {customTokens.spacing && Object.keys(customTokens.spacing).length > 0 && (
                    <div className="flex items-center gap-2 text-sm text-slate-300">
                      <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                      <span>{Object.keys(customTokens.spacing).length} Spacing token{Object.keys(customTokens.spacing).length !== 1 ? 's' : ''}</span>
                    </div>
                  )}
                  {customTokens.typography && Object.keys(customTokens.typography).length > 0 && (
                    <div className="flex items-center gap-2 text-sm text-slate-300">
                      <div className="w-2 h-2 bg-indigo-500 rounded-full"></div>
                      <span>{Object.keys(customTokens.typography).length} Typography token{Object.keys(customTokens.typography).length !== 1 ? 's' : ''}</span>
                    </div>
                  )}
                </div>

                <div className="bg-orange-500/10 border border-orange-500/30 rounded-xl p-4 flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-orange-400 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-orange-200">
                    All V2 pages will revert to using the default design system tokens after this reset.
                  </p>
                </div>
              </div>

              {/* Actions */}
              <div className="bg-slate-900/50 border-t border-slate-700 p-6 flex gap-3">
                <Button
                  onClick={() => setShowResetConfirm(false)}
                  variant="outline"
                  className="flex-1 text-slate-200 border-slate-600 hover:bg-slate-700 hover:text-white"
                  disabled={saving}
                >
                  Cancel
                </Button>
                <Button
                  onClick={resetToDefaults}
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white border-0"
                  disabled={saving}
                >
                  {saving ? (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                      Resetting...
                    </>
                  ) : (
                    <>
                      <RotateCcw className="w-4 h-4 mr-2" />
                      Reset to Defaults
                    </>
                  )}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        </>
        )}
      </AnimatePresence>
    </div>
  )
}
