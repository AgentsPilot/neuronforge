'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import {
  MessageCircle,
  Save,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Zap,
  Settings,
  Brain,
  Database,
  FileText,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

interface HelpBotConfig {
  general: {
    model: string
    temperature: number
    maxTokens: number
  }
  input: {
    model: string
    temperature: number
    maxTokens: number
  }
  semantic: {
    enabled: boolean
    embeddingModel: string
    cacheThreshold: number
    faqThreshold: number
    autoPromoteEnabled: boolean
    autoPromoteThreshold: number
    autoPromoteMinThumbsUp: number
  }
  prompts?: {
    generalPrompt: string | null
    inputPrompt: string | null
  }
  theme?: {
    primaryColor: string
    secondaryColor: string
    borderColor: string
    shadowColor: string
    closeButtonColor: string
  }
  welcomeMessages?: {
    default: string | null
    inputHelp: string | null
  }
  provider: string
  enabled: boolean
  cacheEnabled: boolean
  faqEnabled: boolean
}

const MODEL_OPTIONS = [
  { value: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B (Groq)', provider: 'groq' },
  { value: 'llama-3.1-70b-versatile', label: 'Llama 3.1 70B (Groq)', provider: 'groq' },
  { value: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B (Groq)', provider: 'groq' },
  { value: 'gpt-4o-mini', label: 'GPT-4o Mini', provider: 'openai' },
  { value: 'gpt-4o', label: 'GPT-4o', provider: 'openai' },
  { value: 'claude-3-haiku-20240307', label: 'Claude 3 Haiku', provider: 'anthropic' },
  { value: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet', provider: 'anthropic' },
]

export default function HelpBotConfigPage() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [config, setConfig] = useState<HelpBotConfig>({
    general: { model: 'llama-3.1-8b-instant', temperature: 0.2, maxTokens: 300 },
    input: { model: 'llama-3.1-8b-instant', temperature: 0.3, maxTokens: 400 },
    semantic: {
      enabled: true,
      embeddingModel: 'text-embedding-3-small',
      cacheThreshold: 0.85,
      faqThreshold: 0.80,
      autoPromoteEnabled: false,
      autoPromoteThreshold: 10,
      autoPromoteMinThumbsUp: 3,
    },
    prompts: {
      generalPrompt: null,
      inputPrompt: null,
    },
    theme: {
      primaryColor: '#8b5cf6',
      secondaryColor: '#9333ea',
      borderColor: '#e2e8f0',
      shadowColor: 'rgba(139, 92, 246, 0.2)',
      closeButtonColor: '#ef4444',
    },
    welcomeMessages: {
      default: null,
      inputHelp: null,
    },
    provider: 'groq',
    enabled: true,
    cacheEnabled: true,
    faqEnabled: true,
  })

  useEffect(() => {
    fetchConfig()
  }, [])

  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => setMessage(null), 5000)
      return () => clearTimeout(timer)
    }
  }, [message])

  const fetchConfig = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/admin/helpbot-config')
      const result = await response.json()
      if (result.success) {
        setConfig(result.config)
      } else {
        setMessage({ type: 'error', text: result.error })
      }
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to load configuration' })
    } finally {
      setLoading(false)
    }
  }

  const saveConfig = async () => {
    setSaving(true)
    setMessage(null)
    try {
      const response = await fetch('/api/admin/helpbot-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config }),
      })
      const result = await response.json()
      if (result.success) {
        setMessage({ type: 'success', text: 'Configuration saved successfully!' })
      } else {
        setMessage({ type: 'error', text: result.error })
      }
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to save configuration' })
    } finally {
      setSaving(false)
    }
  }

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
          <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-500 rounded-xl flex items-center justify-center shadow-lg">
            <MessageCircle className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-white">HelpBot Configuration</h1>
            <p className="text-slate-400">Configure AI assistant models and behavior</p>
          </div>
        </div>
        <Button
          onClick={saveConfig}
          disabled={saving}
          className="bg-violet-600 hover:bg-violet-700"
        >
          {saving ? (
            <>
              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="w-4 h-4 mr-2" />
              Save Changes
            </>
          )}
        </Button>
      </div>

      {/* Message Banner */}
      {message && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className={`flex items-center gap-3 p-4 rounded-xl border backdrop-blur-xl ${
            message.type === 'success'
              ? 'bg-green-500/20 border-green-500/30 text-green-300'
              : 'bg-red-500/20 border-red-500/30 text-red-300'
          }`}
        >
          {message.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5" />
          ) : (
            <AlertCircle className="w-5 h-5" />
          )}
          <p className="font-medium">{message.text}</p>
        </motion.div>
      )}

      {/* Feature Toggles */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-slate-800/50 backdrop-blur-xl rounded-xl p-6 border border-white/10"
      >
        <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
          <Settings className="w-5 h-5" />
          Feature Controls
        </h2>
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-slate-700/30 rounded-lg">
            <div>
              <Label className="text-white font-medium">Enable HelpBot</Label>
              <p className="text-sm text-slate-400">Turn the AI assistant on/off globally</p>
            </div>
            <Switch
              checked={config.enabled}
              onCheckedChange={(checked) => setConfig({ ...config, enabled: checked })}
            />
          </div>
          <div className="flex items-center justify-between p-4 bg-slate-700/30 rounded-lg">
            <div>
              <Label className="text-white font-medium">Enable Response Caching</Label>
              <p className="text-sm text-slate-400">Cache responses for faster, cheaper answers</p>
            </div>
            <Switch
              checked={config.cacheEnabled}
              onCheckedChange={(checked) => setConfig({ ...config, cacheEnabled: checked })}
            />
          </div>
          <div className="flex items-center justify-between p-4 bg-slate-700/30 rounded-lg">
            <div>
              <Label className="text-white font-medium">Enable FAQ Lookup</Label>
              <p className="text-sm text-slate-400">Check curated FAQs before calling AI</p>
            </div>
            <Switch
              checked={config.faqEnabled}
              onCheckedChange={(checked) => setConfig({ ...config, faqEnabled: checked })}
            />
          </div>
        </div>
      </motion.div>

      {/* General Help Configuration */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-slate-800/50 backdrop-blur-xl rounded-xl p-6 border border-white/10"
      >
        <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
          <Brain className="w-5 h-5 text-blue-400" />
          General Help Mode
        </h2>
        <p className="text-sm text-slate-400 mb-6">
          Configuration for general page assistance and navigation help
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="md:col-span-2">
            <Label className="text-white">Model</Label>
            <select
              value={config.general.model}
              onChange={(e) =>
                setConfig({
                  ...config,
                  general: { ...config.general, model: e.target.value },
                })
              }
              className="w-full mt-2 px-4 py-2 bg-slate-700/50 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
            >
              {MODEL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-white">Temperature ({config.general.temperature})</Label>
            <p className="text-xs text-slate-400 mb-2">Lower = more deterministic (0.0 - 1.0)</p>
            <Input
              type="number"
              min="0"
              max="1"
              step="0.1"
              value={config.general.temperature}
              onChange={(e) =>
                setConfig({
                  ...config,
                  general: { ...config.general, temperature: parseFloat(e.target.value) },
                })
              }
              className="bg-slate-700/50 border-white/10 text-white"
            />
          </div>
          <div>
            <Label className="text-white">Max Tokens</Label>
            <p className="text-xs text-slate-400 mb-2">Maximum response length</p>
            <Input
              type="number"
              min="100"
              max="4096"
              value={config.general.maxTokens}
              onChange={(e) =>
                setConfig({
                  ...config,
                  general: { ...config.general, maxTokens: parseInt(e.target.value) },
                })
              }
              className="bg-slate-700/50 border-white/10 text-white"
            />
          </div>
        </div>
      </motion.div>

      {/* Input Help Configuration */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="bg-slate-800/50 backdrop-blur-xl rounded-xl p-6 border border-white/10"
      >
        <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
          <Zap className="w-5 h-5 text-purple-400" />
          Input Field Assistance
        </h2>
        <p className="text-sm text-slate-400 mb-6">
          Configuration for helping users fill form fields and extract data from URLs
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="md:col-span-2">
            <Label className="text-white">Model</Label>
            <select
              value={config.input.model}
              onChange={(e) =>
                setConfig({
                  ...config,
                  input: { ...config.input, model: e.target.value },
                })
              }
              className="w-full mt-2 px-4 py-2 bg-slate-700/50 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
            >
              {MODEL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-white">Temperature ({config.input.temperature})</Label>
            <p className="text-xs text-slate-400 mb-2">Lower = more deterministic (0.0 - 1.0)</p>
            <Input
              type="number"
              min="0"
              max="1"
              step="0.1"
              value={config.input.temperature}
              onChange={(e) =>
                setConfig({
                  ...config,
                  input: { ...config.input, temperature: parseFloat(e.target.value) },
                })
              }
              className="bg-slate-700/50 border-white/10 text-white"
            />
          </div>
          <div>
            <Label className="text-white">Max Tokens</Label>
            <p className="text-xs text-slate-400 mb-2">Maximum response length</p>
            <Input
              type="number"
              min="100"
              max="4096"
              value={config.input.maxTokens}
              onChange={(e) =>
                setConfig({
                  ...config,
                  input: { ...config.input, maxTokens: parseInt(e.target.value) },
                })
              }
              className="bg-slate-700/50 border-white/10 text-white"
            />
          </div>
        </div>
      </motion.div>

      {/* Semantic Search Configuration */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="bg-slate-800/50 backdrop-blur-xl rounded-xl p-6 border border-white/10"
      >
        <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
          <Database className="w-5 h-5 text-green-400" />
          Semantic Search & Knowledge Base
        </h2>
        <p className="text-sm text-slate-400 mb-6">
          Use vector embeddings to match similar questions and reduce AI costs
        </p>

        <div className="space-y-6">
          {/* Enable Semantic Search Toggle */}
          <div className="flex items-center justify-between p-4 bg-slate-700/30 rounded-lg">
            <div>
              <Label className="text-white font-medium">Enable Semantic Search</Label>
              <p className="text-sm text-slate-400">Match similar questions using AI embeddings</p>
            </div>
            <Switch
              checked={config.semantic.enabled}
              onCheckedChange={(checked) =>
                setConfig({
                  ...config,
                  semantic: { ...config.semantic, enabled: checked },
                })
              }
            />
          </div>

          {config.semantic.enabled && (
            <>
              {/* Embedding Model */}
              <div>
                <Label className="text-white">Embedding Model</Label>
                <select
                  value={config.semantic.embeddingModel}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      semantic: { ...config.semantic, embeddingModel: e.target.value },
                    })
                  }
                  className="w-full mt-2 px-4 py-2 bg-slate-700/50 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
                >
                  <option value="text-embedding-3-small">text-embedding-3-small (1536 dims, $0.02/1M tokens)</option>
                  <option value="text-embedding-3-large">text-embedding-3-large (3072 dims, $0.13/1M tokens)</option>
                  <option value="text-embedding-ada-002">text-embedding-ada-002 (1536 dims, $0.10/1M tokens)</option>
                </select>
                <p className="text-xs text-slate-400 mt-2">
                  <strong>text-embedding-3-small</strong> offers the best price/performance ratio
                </p>
              </div>

              {/* Similarity Thresholds */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label className="text-white">Cache Similarity Threshold ({config.semantic.cacheThreshold.toFixed(2)})</Label>
                  <p className="text-xs text-slate-400 mb-2">Minimum similarity for cache hits (0.0 - 1.0)</p>
                  <Input
                    type="number"
                    min="0"
                    max="1"
                    step="0.05"
                    value={config.semantic.cacheThreshold}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        semantic: { ...config.semantic, cacheThreshold: parseFloat(e.target.value) },
                      })
                    }
                    className="bg-slate-700/50 border-white/10 text-white"
                  />
                  <p className="text-xs text-slate-500 mt-1">Higher = stricter matching (recommended: 0.85)</p>
                </div>
                <div>
                  <Label className="text-white">FAQ Similarity Threshold ({config.semantic.faqThreshold.toFixed(2)})</Label>
                  <p className="text-xs text-slate-400 mb-2">Minimum similarity for FAQ matches (0.0 - 1.0)</p>
                  <Input
                    type="number"
                    min="0"
                    max="1"
                    step="0.05"
                    value={config.semantic.faqThreshold}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        semantic: { ...config.semantic, faqThreshold: parseFloat(e.target.value) },
                      })
                    }
                    className="bg-slate-700/50 border-white/10 text-white"
                  />
                  <p className="text-xs text-slate-500 mt-1">Slightly lower for broader matches (recommended: 0.80)</p>
                </div>
              </div>

              {/* Auto-Promotion */}
              <div className="border-t border-white/10 pt-6">
                <div className="flex items-center justify-between p-4 bg-slate-700/30 rounded-lg mb-4">
                  <div>
                    <Label className="text-white font-medium">Auto-Promote Popular Questions to FAQ</Label>
                    <p className="text-sm text-slate-400">Automatically promote frequently asked questions</p>
                  </div>
                  <Switch
                    checked={config.semantic.autoPromoteEnabled}
                    onCheckedChange={(checked) =>
                      setConfig({
                        ...config,
                        semantic: { ...config.semantic, autoPromoteEnabled: checked },
                      })
                    }
                  />
                </div>

                {config.semantic.autoPromoteEnabled && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <Label className="text-white">Minimum Hit Count</Label>
                      <p className="text-xs text-slate-400 mb-2">How many times a question must be asked</p>
                      <Input
                        type="number"
                        min="1"
                        max="100"
                        value={config.semantic.autoPromoteThreshold}
                        onChange={(e) =>
                          setConfig({
                            ...config,
                            semantic: { ...config.semantic, autoPromoteThreshold: parseInt(e.target.value) },
                          })
                        }
                        className="bg-slate-700/50 border-white/10 text-white"
                      />
                    </div>
                    <div>
                      <Label className="text-white">Minimum Positive Feedback</Label>
                      <p className="text-xs text-slate-400 mb-2">Thumbs up required for promotion</p>
                      <Input
                        type="number"
                        min="0"
                        max="50"
                        value={config.semantic.autoPromoteMinThumbsUp}
                        onChange={(e) =>
                          setConfig({
                            ...config,
                            semantic: { ...config.semantic, autoPromoteMinThumbsUp: parseInt(e.target.value) },
                          })
                        }
                        className="bg-slate-700/50 border-white/10 text-white"
                      />
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </motion.div>

      {/* System Prompts Configuration */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="bg-slate-800/50 backdrop-blur-xl rounded-xl p-6 border border-white/10"
      >
        <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
          <FileText className="w-5 h-5 text-purple-400" />
          System Prompts
        </h2>
        <p className="text-sm text-slate-400 mb-6">
          Customize AI behavior by editing system prompts. Leave blank to use default prompts.
          Use placeholders: <code className="text-purple-300">{"{{pageTitle}}"}</code>, <code className="text-purple-300">{"{{pageDescription}}"}</code> for general prompt;
          <code className="text-purple-300 ml-1">{"{{agentId}}"}</code>, <code className="text-purple-300">{"{{fieldName}}"}</code>, etc. for input prompt.
        </p>

        <div className="space-y-6">
          {/* General Help Prompt */}
          <div>
            <Label className="text-white font-medium mb-2 block">General Help Prompt</Label>
            <p className="text-xs text-slate-400 mb-3">
              Used for general page assistance and navigation help. Supports markdown formatting.
            </p>
            <Textarea
              value={config.prompts?.generalPrompt || ''}
              onChange={(e) =>
                setConfig({
                  ...config,
                  prompts: { ...config.prompts, generalPrompt: e.target.value || null },
                })
              }
              placeholder="Leave blank to use default general help prompt..."
              rows={12}
              className="bg-slate-700/50 border-white/10 text-white font-mono text-sm"
            />
            <p className="text-xs text-slate-500 mt-2">
              Default prompt includes page context, formatting rules, and available features.
            </p>
          </div>

          {/* Input Field Assistance Prompt */}
          <div>
            <Label className="text-white font-medium mb-2 block">Input Field Assistance Prompt</Label>
            <p className="text-xs text-slate-400 mb-3">
              Used when users need help filling agent input fields. Handles URL extraction and guidance.
            </p>
            <Textarea
              value={config.prompts?.inputPrompt || ''}
              onChange={(e) =>
                setConfig({
                  ...config,
                  prompts: { ...config.prompts, inputPrompt: e.target.value || null },
                })
              }
              placeholder="Leave blank to use default input assistance prompt..."
              rows={12}
              className="bg-slate-700/50 border-white/10 text-white font-mono text-sm"
            />
            <p className="text-xs text-slate-500 mt-2">
              Default prompt handles field types, URL extraction, and JSON response formatting.
            </p>
          </div>
        </div>
      </motion.div>

      {/* Welcome Messages Configuration */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
        className="bg-slate-800/50 backdrop-blur-xl rounded-xl p-6 border border-white/10"
      >
        <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
          <MessageCircle className="w-5 h-5 text-green-400" />
          Welcome Messages
        </h2>
        <p className="text-sm text-slate-400 mb-6">
          Customize the initial greeting messages users see when opening HelpBot. Leave blank to use smart context-aware defaults.
          Use placeholders for dynamic content.
        </p>

        <div className="space-y-6">
          {/* Default Welcome Message */}
          <div>
            <Label className="text-white font-medium mb-2 block">General Help Welcome</Label>
            <p className="text-xs text-slate-400 mb-3">
              Shown when users open HelpBot for general page assistance. Supports <code className="text-purple-300">{"{{pageTitle}}"}</code> placeholder.
            </p>
            <Textarea
              value={config.welcomeMessages?.default || ''}
              onChange={(e) =>
                setConfig({
                  ...config,
                  welcomeMessages: { ...config.welcomeMessages, default: e.target.value || null },
                })
              }
              placeholder="e.g., 👋 Welcome to {{pageTitle}}! How can I help you today?"
              rows={3}
              className="bg-slate-700/50 border-white/10 text-white"
            />
            <p className="text-xs text-slate-500 mt-2">
              Default: Context-aware welcome based on current page
            </p>
          </div>

          {/* Input Help Welcome Message */}
          <div>
            <Label className="text-white font-medium mb-2 block">Input Field Assistance Welcome</Label>
            <p className="text-xs text-slate-400 mb-3">
              Shown when users click help on an input field. Supports <code className="text-purple-300">{"{{fieldName}}"}</code>, <code className="text-purple-300">{"{{agentName}}"}</code> placeholders.
            </p>
            <Textarea
              value={config.welcomeMessages?.inputHelp || ''}
              onChange={(e) =>
                setConfig({
                  ...config,
                  welcomeMessages: { ...config.welcomeMessages, inputHelp: e.target.value || null },
                })
              }
              placeholder="e.g., I'll help you fill the {{fieldName}} field for {{agentName}}. What do you have?"
              rows={3}
              className="bg-slate-700/50 border-white/10 text-white"
            />
            <p className="text-xs text-slate-500 mt-2">
              Default: Field-specific guidance based on input type
            </p>
          </div>
        </div>
      </motion.div>

      {/* UI Theme Configuration */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6 }}
        className="bg-slate-800/50 backdrop-blur-xl rounded-xl p-6 border border-white/10"
      >
        <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
          <Zap className="w-5 h-5 text-pink-400" />
          UI Theme Colors
        </h2>
        <p className="text-sm text-slate-400 mb-6">
          Customize HelpBot's visual appearance with your brand colors. Changes will apply when the component is updated to use theme config.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Primary Color */}
          <div>
            <Label className="text-white font-medium mb-2 block">Primary Color</Label>
            <p className="text-xs text-slate-400 mb-3">Main accent color for buttons and highlights</p>
            <div className="flex items-center gap-3">
              <Input
                type="color"
                value={config.theme?.primaryColor || '#8b5cf6'}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    theme: { ...config.theme, primaryColor: e.target.value },
                  })
                }
                className="w-16 h-16 p-1 cursor-pointer bg-slate-700/50 border-white/10"
              />
              <Input
                type="text"
                value={config.theme?.primaryColor || '#8b5cf6'}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    theme: { ...config.theme, primaryColor: e.target.value },
                  })
                }
                className="flex-1 bg-slate-700/50 border-white/10 text-white font-mono"
                placeholder="#8b5cf6"
              />
            </div>
          </div>

          {/* Secondary Color */}
          <div>
            <Label className="text-white font-medium mb-2 block">Secondary Color</Label>
            <p className="text-xs text-slate-400 mb-3">Secondary gradient color for visual effects</p>
            <div className="flex items-center gap-3">
              <Input
                type="color"
                value={config.theme?.secondaryColor || '#9333ea'}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    theme: { ...config.theme, secondaryColor: e.target.value },
                  })
                }
                className="w-16 h-16 p-1 cursor-pointer bg-slate-700/50 border-white/10"
              />
              <Input
                type="text"
                value={config.theme?.secondaryColor || '#9333ea'}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    theme: { ...config.theme, secondaryColor: e.target.value },
                  })
                }
                className="flex-1 bg-slate-700/50 border-white/10 text-white font-mono"
                placeholder="#9333ea"
              />
            </div>
          </div>

          {/* Border Color */}
          <div>
            <Label className="text-white font-medium mb-2 block">Border Color</Label>
            <p className="text-xs text-slate-400 mb-3">Color for borders and dividers</p>
            <div className="flex items-center gap-3">
              <Input
                type="color"
                value={config.theme?.borderColor || '#e2e8f0'}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    theme: { ...config.theme, borderColor: e.target.value },
                  })
                }
                className="w-16 h-16 p-1 cursor-pointer bg-slate-700/50 border-white/10"
              />
              <Input
                type="text"
                value={config.theme?.borderColor || '#e2e8f0'}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    theme: { ...config.theme, borderColor: e.target.value },
                  })
                }
                className="flex-1 bg-slate-700/50 border-white/10 text-white font-mono"
                placeholder="#e2e8f0"
              />
            </div>
          </div>

          {/* Shadow Color */}
          <div>
            <Label className="text-white font-medium mb-2 block">Shadow Color</Label>
            <p className="text-xs text-slate-400 mb-3">Color for shadows and glows (rgba format)</p>
            <Input
              type="text"
              value={config.theme?.shadowColor || 'rgba(139, 92, 246, 0.2)'}
              onChange={(e) =>
                setConfig({
                  ...config,
                  theme: { ...config.theme, shadowColor: e.target.value },
                })
              }
              className="bg-slate-700/50 border-white/10 text-white font-mono"
              placeholder="rgba(139, 92, 246, 0.2)"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 mt-6">
          {/* Close Button Color */}
          <div>
            <Label className="text-white font-medium mb-2 block">Close Button Color</Label>
            <p className="text-xs text-slate-400 mb-3">Color for the floating close button</p>
            <div className="flex items-center gap-3">
              <Input
                type="color"
                value={config.theme?.closeButtonColor || '#ef4444'}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    theme: { ...config.theme, closeButtonColor: e.target.value },
                  })
                }
                className="w-16 h-16 p-1 cursor-pointer bg-slate-700/50 border-white/10"
              />
              <Input
                type="text"
                value={config.theme?.closeButtonColor || '#ef4444'}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    theme: { ...config.theme, closeButtonColor: e.target.value },
                  })
                }
                className="flex-1 bg-slate-700/50 border-white/10 text-white font-mono"
                placeholder="#ef4444"
              />
            </div>
          </div>
        </div>

        <div className="mt-4 p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg">
          <p className="text-xs text-amber-200">
            <strong>Note:</strong> Theme colors are configured but require frontend implementation in HelpBot component to apply visually.
            See documentation for implementation details.
          </p>
        </div>
      </motion.div>

      {/* Info Panel */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.7 }}
        className="bg-blue-500/20 border border-blue-500/30 rounded-xl p-4 flex items-start gap-3"
      >
        <Database className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-blue-200">
          <p className="font-semibold mb-1">Architecture Overview</p>
          <p>
            HelpBot uses a 3-layer system: FAQ lookup (free) → Cache with semantic search (embeddings cost ~$0.00002/query) → AI model (costs tokens).
            Semantic search improves cache hit rate from 50% to 70%+, significantly reducing AI costs.
          </p>
        </div>
      </motion.div>
    </div>
  )
}
