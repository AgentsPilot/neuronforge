'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Save,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  Sparkles,
  ChevronUp,
  ChevronDown,
  Brain,
  Code,
  GitBranch
} from 'lucide-react';

interface PhaseConfig {
  provider: 'openai' | 'anthropic';
  model: string;
  temperature: number;
}

interface AgentGenerationConfig {
  requirements: PhaseConfig;
  semantic: PhaseConfig;
  formalization: PhaseConfig;
}

interface ModelOption {
  provider: string;
  model_name: string;
  input_cost_per_token: string;
  output_cost_per_token: string;
}

export default function AgentGenerationConfigPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Section collapse states
  const [requirementsExpanded, setRequirementsExpanded] = useState(true);
  const [semanticExpanded, setSemanticExpanded] = useState(true);
  const [formalizationExpanded, setFormalizationExpanded] = useState(true);

  const [availableModels, setAvailableModels] = useState<ModelOption[]>([]);
  const [config, setConfig] = useState<AgentGenerationConfig>({
    requirements: {
      provider: 'openai',
      model: 'gpt-4o-mini',
      temperature: 0.0
    },
    semantic: {
      provider: 'anthropic',
      model: 'claude-opus-4-6',
      temperature: 0.3
    },
    formalization: {
      provider: 'anthropic',
      model: 'claude-opus-4-6',
      temperature: 0.0
    }
  });

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch('/api/admin/agent-generation-config');
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch configuration');
      }

      if (data.success && data.config) {
        setConfig(data.config);
        setAvailableModels(data.available_models || []);
      }
    } catch (err) {
      console.error('Error fetching agent generation config:', err);
      setError(err instanceof Error ? err.message : 'Failed to load configuration');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);

      const response = await fetch('/api/admin/agent-generation-config', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ config }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to save configuration');
      }

      setSuccess('Configuration saved successfully!');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      console.error('Error saving config:', err);
      setError(err instanceof Error ? err.message : 'Failed to save configuration');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setConfig({
      requirements: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        temperature: 0.0
      },
      semantic: {
        provider: 'anthropic',
        model: 'claude-opus-4-6',
        temperature: 0.3
      },
      formalization: {
        provider: 'anthropic',
        model: 'claude-opus-4-6',
        temperature: 0.0
      }
    });
    setSuccess('Configuration reset to defaults');
    setTimeout(() => setSuccess(null), 3000);
  };

  // Group models by provider
  const modelsByProvider = availableModels.reduce((acc, model) => {
    if (!acc[model.provider]) {
      acc[model.provider] = [];
    }
    acc[model.provider].push(model);
    return acc;
  }, {} as Record<string, ModelOption[]>);

  /**
   * Infer provider from model name
   */
  const inferProvider = (modelName: string): 'openai' | 'anthropic' => {
    const modelLower = modelName.toLowerCase();
    if (modelLower.includes('claude') || modelLower.includes('opus') || modelLower.includes('sonnet') || modelLower.includes('haiku')) {
      return 'anthropic';
    }
    return 'openai';
  };

  const renderModelDropdown = (phase: 'requirements' | 'semantic' | 'formalization') => {
    return (
      <div>
        <label className="block text-sm font-medium text-gray-200 mb-2">Model</label>
        <select
          value={config[phase].model}
          onChange={(e) => {
            const newModel = e.target.value;
            const newProvider = inferProvider(newModel);
            setConfig({
              ...config,
              [phase]: {
                ...config[phase],
                model: newModel,
                provider: newProvider
              }
            });
          }}
          className="w-full px-4 py-2 bg-gray-700/50 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
        >
          {Object.entries(modelsByProvider).map(([provider, models]) => (
            <optgroup key={provider} label={provider.toUpperCase()}>
              {models.map((model) => (
                <option key={`${provider}-${model.model_name}`} value={model.model_name}>
                  {model.model_name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <p className="text-xs text-gray-500 mt-1">
          Provider: <span className="text-gray-400 font-medium">{config[phase].provider}</span>
        </p>
      </div>
    );
  };

  const renderTemperatureSlider = (phase: 'requirements' | 'semantic' | 'formalization', min: number, max: number) => {
    return (
      <div>
        <label className="block text-sm font-medium text-gray-200 mb-2">
          Temperature: {config[phase].temperature.toFixed(1)}
        </label>
        <input
          type="range"
          min={min}
          max={max}
          step="0.1"
          value={config[phase].temperature}
          onChange={(e) => setConfig({ ...config, [phase]: { ...config[phase], temperature: parseFloat(e.target.value) } })}
          className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
        />
        <div className="flex justify-between text-xs text-gray-400 mt-1">
          <span>{min.toFixed(1)}</span>
          <span>{max.toFixed(1)}</span>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 p-8">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="w-8 h-8 text-purple-500 animate-spin" />
            <span className="ml-3 text-gray-300">Loading configuration...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 p-8">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <Sparkles className="w-8 h-8 text-purple-500" />
            <h1 className="text-3xl font-bold text-white">Agent Generation Configuration</h1>
          </div>
          <p className="text-gray-400">
            Configure LLM models and parameters for each phase of the agent generation pipeline
          </p>
        </div>

        {/* Error/Success Messages */}
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-lg flex items-start gap-3"
          >
            <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-red-200 font-medium">Error</p>
              <p className="text-red-300/80 text-sm">{error}</p>
            </div>
          </motion.div>
        )}

        {success && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 p-4 bg-green-500/10 border border-green-500/30 rounded-lg flex items-start gap-3"
          >
            <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-green-200 font-medium">Success</p>
              <p className="text-green-300/80 text-sm">{success}</p>
            </div>
          </motion.div>
        )}

        {/* Configuration Sections */}
        <div className="space-y-6">
          {/* Phase 0: Requirements Extraction */}
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg overflow-hidden">
            <button
              onClick={() => setRequirementsExpanded(!requirementsExpanded)}
              className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-700/30 transition-colors"
            >
              <div className="flex items-center gap-3">
                <Brain className="w-5 h-5 text-blue-400" />
                <div className="text-left">
                  <h3 className="text-lg font-semibold text-white">Phase 0: Requirements Extraction</h3>
                  <p className="text-sm text-gray-400">Extract machine-checkable constraints from user prompts</p>
                </div>
              </div>
              {requirementsExpanded ? (
                <ChevronUp className="w-5 h-5 text-gray-400" />
              ) : (
                <ChevronDown className="w-5 h-5 text-gray-400" />
              )}
            </button>

            {requirementsExpanded && (
              <div className="px-6 py-4 border-t border-gray-700 space-y-4">
                {renderModelDropdown('requirements')}
                {renderTemperatureSlider('requirements', 0.0, 0.3)}
                <p className="text-xs text-gray-500">
                  ℹ️ Low temperature (0.0) ensures deterministic, reliable extraction
                </p>
              </div>
            )}
          </div>

          {/* Phase 1: Semantic Planning */}
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg overflow-hidden">
            <button
              onClick={() => setSemanticExpanded(!semanticExpanded)}
              className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-700/30 transition-colors"
            >
              <div className="flex items-center gap-3">
                <GitBranch className="w-5 h-5 text-purple-400" />
                <div className="text-left">
                  <h3 className="text-lg font-semibold text-white">Phase 1: Semantic Planning</h3>
                  <p className="text-sm text-gray-400">Generate high-level semantic workflow plan with reasoning</p>
                </div>
              </div>
              {semanticExpanded ? (
                <ChevronUp className="w-5 h-5 text-gray-400" />
              ) : (
                <ChevronDown className="w-5 h-5 text-gray-400" />
              )}
            </button>

            {semanticExpanded && (
              <div className="px-6 py-4 border-t border-gray-700 space-y-4">
                {renderModelDropdown('semantic')}
                {renderTemperatureSlider('semantic', 0.2, 0.5)}
                <p className="text-xs text-gray-500">
                  ℹ️ Higher temperature (0.3) enables creative reasoning and semantic understanding
                </p>
              </div>
            )}
          </div>

          {/* Phase 3: IR Formalization */}
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg overflow-hidden">
            <button
              onClick={() => setFormalizationExpanded(!formalizationExpanded)}
              className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-700/30 transition-colors"
            >
              <div className="flex items-center gap-3">
                <Code className="w-5 h-5 text-green-400" />
                <div className="text-left">
                  <h3 className="text-lg font-semibold text-white">Phase 3: IR Formalization</h3>
                  <p className="text-sm text-gray-400">Transform semantic plan into executable intermediate representation</p>
                </div>
              </div>
              {formalizationExpanded ? (
                <ChevronUp className="w-5 h-5 text-gray-400" />
              ) : (
                <ChevronDown className="w-5 h-5 text-gray-400" />
              )}
            </button>

            {formalizationExpanded && (
              <div className="px-6 py-4 border-t border-gray-700 space-y-4">
                {renderModelDropdown('formalization')}
                {renderTemperatureSlider('formalization', 0.0, 0.2)}
                <p className="text-xs text-gray-500">
                  ℹ️ Very low temperature (0.0) ensures mechanical precision in IR mapping
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="mt-8 flex gap-4">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 px-6 py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded-lg font-medium flex items-center justify-center gap-2 transition-colors"
          >
            {saving ? (
              <>
                <RefreshCw className="w-5 h-5 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="w-5 h-5" />
                Save Configuration
              </>
            )}
          </button>

          <button
            onClick={handleReset}
            disabled={saving}
            className="px-6 py-3 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:cursor-not-allowed text-white rounded-lg font-medium flex items-center justify-center gap-2 transition-colors"
          >
            <RefreshCw className="w-5 h-5" />
            Reset to Defaults
          </button>
        </div>
      </div>
    </div>
  );
}
