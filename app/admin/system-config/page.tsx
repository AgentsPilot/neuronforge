'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Settings,
  Save,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  DollarSign,
  Zap,
  Sliders,
  Database,
  Edit,
  X,
  Check,
  Download,
  ChevronUp,
  ChevronDown,
  Brain
} from 'lucide-react';

interface SystemSetting {
  id: string;
  key: string;
  value: any;
  category: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
}

interface ModelPricing {
  id: string;
  provider: string;
  model_name: string;
  input_cost_per_token: number;
  output_cost_per_token: number;
  effective_date: string;
}

export default function SystemConfigPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [pricingModels, setPricingModels] = useState<ModelPricing[]>([]);

  // Routing configuration state
  const [routingEnabled, setRoutingEnabled] = useState(false);
  const [lowThreshold, setLowThreshold] = useState(3.9);
  const [mediumThreshold, setMediumThreshold] = useState(6.9);
  const [minSuccessRate, setMinSuccessRate] = useState(85);
  const [anthropicEnabled, setAnthropicEnabled] = useState(true);

  // Pricing editing state
  const [editingPricing, setEditingPricing] = useState<string | null>(null);
  const [editedInputCost, setEditedInputCost] = useState<number>(0);
  const [editedOutputCost, setEditedOutputCost] = useState<number>(0);

  // Collapse state for sections (all collapsed by default)
  const [routingExpanded, setRoutingExpanded] = useState(false);
  const [pricingExpanded, setPricingExpanded] = useState(false);
  const [calcExpanded, setCalcExpanded] = useState(false);
  const [memoryExpanded, setMemoryExpanded] = useState(false);
  const [advancedExpanded, setAdvancedExpanded] = useState(false);

  // Calculator configuration state (loaded from database)
  const [calcConfig, setCalcConfig] = useState({
    // Token estimation
    baseTokens: 0,
    tokensPerPlugin: 0,
    peakMultiplier: 0,
    pluginUsageRate: 0,
    orchestrationOverheadMs: 0,
    estimatedDurationMs: 0,
    estimatedFailureRate: 0,
    estimatedRetryRate: 0,
    ioRatio: 0,
    // Execution parameters
    baseIterations: 0,
    maxIterations: 0,
    // Pricing parameters
    runsPerAgentPerMonth: 0,
    agentCreationCost: 0,
    creditCostUsd: 0,
    minimumMonthlyCostUsd: 0,
    baseCreditsPerRun: 0,
    pluginOverheadPerRun: 0,
    systemOverheadPerRun: 0,
    executionStepMultiplier: 0,
    freeTierCredits: 0
  });

  // Memory configuration state (loaded from database)
  const [memoryConfig, setMemoryConfig] = useState({
    summarization: {
      model: '',
      temperature: 0,
      max_tokens: 0,
      async: false
    },
    embedding: {
      model: '',
      batch_size: 0,
      dimensions: 0
    },
    injection: {
      max_tokens: 0,
      min_recent_runs: 0,
      max_recent_runs: 0,
      semantic_search_limit: 0,
      semantic_threshold: 0
    },
    importance: {
      base_score: 0,
      error_bonus: 0,
      pattern_bonus: 0,
      user_feedback_bonus: 0,
      first_run_bonus: 0,
      milestone_bonus: 0
    },
    retention: {
      run_memories_days: 0,
      low_importance_days: 0,
      consolidation_threshold: 0,
      consolidation_frequency_days: 0
    }
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async (silent = false) => {
    try {
      if (!silent) {
        setLoading(true);
      }
      setError(null);

      // Fetch system settings
      const settingsResponse = await fetch('/api/admin/system-config', {
        method: 'GET',
        cache: 'no-store'
      });

      console.log('[SystemConfig] API response status:', settingsResponse.status);

      if (!settingsResponse.ok) {
        const errorText = await settingsResponse.text();
        console.error('[SystemConfig] API error response:', errorText);
        throw new Error(`Failed to fetch system settings: ${settingsResponse.status} ${errorText}`);
      }

      const settingsResult = await settingsResponse.json();
      console.log('[SystemConfig] Settings result:', settingsResult);

      if (!settingsResult.success) {
        throw new Error(settingsResult.error || 'API returned unsuccessful response');
      }

      // Parse routing settings
      const routingSettings = settingsResult.data.filter((s: SystemSetting) => s.category === 'routing');
      routingSettings.forEach((setting: SystemSetting) => {
        switch (setting.key) {
          case 'intelligent_routing_enabled':
            setRoutingEnabled(setting.value === true || setting.value === 'true');
            break;
          case 'routing_low_threshold':
            setLowThreshold(parseFloat(setting.value));
            break;
          case 'routing_medium_threshold':
            setMediumThreshold(parseFloat(setting.value));
            break;
          case 'routing_min_success_rate':
            setMinSuccessRate(parseInt(setting.value));
            break;
          case 'anthropic_provider_enabled':
            setAnthropicEnabled(setting.value === true || setting.value === 'true');
            break;
        }
      });

      // Fetch AI model pricing
      try {
        const pricingResponse = await fetch('/api/admin/system-config/pricing', {
          method: 'GET',
          cache: 'no-store'
        });

        if (!pricingResponse.ok) {
          console.error('Pricing API error:', pricingResponse.status, pricingResponse.statusText);
          const errorText = await pricingResponse.text();
          console.error('Pricing API response:', errorText);
        } else {
          const pricingResult = await pricingResponse.json();
          console.log('Pricing API result:', pricingResult);

          if (pricingResult.success) {
            setPricingModels(pricingResult.data);
            console.log('Loaded pricing models:', pricingResult.data.length);
          } else {
            console.error('Pricing API returned unsuccessful:', pricingResult.error);
          }
        }
      } catch (pricingError) {
        console.error('Failed to fetch pricing:', pricingError);
        // Don't fail the entire page if pricing fails - it's supplementary data
      }

      // Fetch calculator configuration
      try {
        const calcResponse = await fetch('/api/pricing/config', {
          method: 'GET',
          cache: 'no-store'
        });

        if (calcResponse.ok) {
          const calcResult = await calcResponse.json();
          console.log('Calculator config result:', calcResult);

          if (calcResult.success && calcResult.config) {
            const c = calcResult.config;
            setCalcConfig({
              // Token estimation
              baseTokens: c.calculatorEstimation?.baseTokens ?? 0,
              tokensPerPlugin: c.calculatorEstimation?.tokensPerPlugin ?? 0,
              peakMultiplier: c.calculatorEstimation?.peakMultiplier ?? 0,
              pluginUsageRate: c.calculatorEstimation?.pluginUsageRate ?? 0,
              orchestrationOverheadMs: c.calculatorEstimation?.orchestrationOverheadMs ?? 0,
              estimatedDurationMs: c.calculatorEstimation?.estimatedDurationMs ?? 0,
              estimatedFailureRate: c.calculatorEstimation?.estimatedFailureRate ?? 0,
              estimatedRetryRate: c.calculatorEstimation?.estimatedRetryRate ?? 0,
              ioRatio: c.calculatorEstimation?.ioRatio ?? 0,
              // Execution parameters
              baseIterations: c.calculatorEstimation?.baseIterations ?? 0,
              maxIterations: c.calculatorEstimation?.maxIterations ?? 0,
              // Pricing parameters
              runsPerAgentPerMonth: c.runsPerAgentPerMonth ?? 0,
              agentCreationCost: c.agentCreationCost ?? 0,
              creditCostUsd: c.creditCostUsd ?? 0,
              minimumMonthlyCostUsd: c.minimumMonthlyCostUsd ?? 0,
              baseCreditsPerRun: c.baseCreditsPerRun ?? 0,
              pluginOverheadPerRun: c.pluginOverheadPerRun ?? 0,
              systemOverheadPerRun: c.systemOverheadPerRun ?? 0,
              executionStepMultiplier: c.executionStepMultiplier ?? 0,
              freeTierCredits: c.freeTierCredits ?? 0
            });
            console.log('Loaded calculator config:', calcResult.config);
          }
        }
      } catch (calcError) {
        console.error('Failed to fetch calculator config:', calcError);
      }

      // Fetch memory configuration
      try {
        const memoryResponse = await fetch('/api/admin/memory-config', {
          method: 'GET',
          cache: 'no-store'
        });

        if (memoryResponse.ok) {
          const memoryResult = await memoryResponse.json();
          console.log('[SystemConfig] Memory config API response:', memoryResult);

          if (memoryResult.success && memoryResult.configs) {
            console.log('[SystemConfig] Setting memory config state:', memoryResult.configs);
            setMemoryConfig(memoryResult.configs);
            console.log('[SystemConfig] ✅ Memory config loaded successfully');
          } else {
            console.error('[SystemConfig] ❌ Memory config API returned unsuccessful or missing configs');
          }
        } else {
          console.error('[SystemConfig] ❌ Memory config API returned non-OK status:', memoryResponse.status);
        }
      } catch (memoryError) {
        console.error('[SystemConfig] ❌ Failed to fetch memory config:', memoryError);
      }

    } catch (error) {
      console.error('Error fetching data:', error);
      setError(error instanceof Error ? error.message : 'Unknown error occurred');
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  };

  const handleSaveRoutingConfig = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);

      const updates = {
        intelligent_routing_enabled: routingEnabled,
        routing_low_threshold: lowThreshold,
        routing_medium_threshold: mediumThreshold,
        routing_min_success_rate: minSuccessRate,
        anthropic_provider_enabled: anthropicEnabled
      };

      const response = await fetch('/api/admin/system-config', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ updates })
      });

      if (!response.ok) {
        throw new Error('Failed to update system configuration');
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to update configuration');
      }

      setSuccess('Configuration saved successfully!');

      // Note: Don't refresh data after save - local state already has updated values

      setTimeout(() => setSuccess(null), 3000);

    } catch (error) {
      console.error('Error saving configuration:', error);
      setError(error instanceof Error ? error.message : 'Unknown error occurred');
    } finally {
      setSaving(false);
    }
  };

  const handleEditPricing = (model: ModelPricing) => {
    setEditingPricing(model.id);
    setEditedInputCost(model.input_cost_per_token);
    setEditedOutputCost(model.output_cost_per_token);
  };

  const handleCancelEditPricing = () => {
    setEditingPricing(null);
    setEditedInputCost(0);
    setEditedOutputCost(0);
  };

  const handleSavePricing = async (modelId: string) => {
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);

      const response = await fetch('/api/admin/system-config/pricing', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: modelId,
          input_cost_per_token: editedInputCost,
          output_cost_per_token: editedOutputCost
        })
      });

      if (!response.ok) {
        throw new Error('Failed to update pricing');
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to update pricing');
      }

      setSuccess('Pricing updated successfully!');
      setEditingPricing(null);

      // Note: Don't refresh data after save - local state already has updated values

      setTimeout(() => setSuccess(null), 3000);

    } catch (error) {
      console.error('Error updating pricing:', error);
      setError(error instanceof Error ? error.message : 'Unknown error occurred');
    } finally {
      setSaving(false);
    }
  };

  const handleSyncPricing = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);

      const response = await fetch('/api/admin/system-config/pricing/sync', {
        method: 'POST'
      });

      if (!response.ok) {
        throw new Error('Failed to sync pricing');
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to sync pricing');
      }

      setSuccess(result.message || 'Pricing synced successfully!');

      // Refresh pricing data after sync since it fetches from external API
      await fetchData(true);

      setTimeout(() => setSuccess(null), 5000);

    } catch (error) {
      console.error('Error syncing pricing:', error);
      setError(error instanceof Error ? error.message : 'Unknown error occurred');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveCalculatorConfig = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);

      const response = await fetch('/api/admin/calculator-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates: calcConfig })
      });

      if (!response.ok) {
        throw new Error('Failed to update calculator configuration');
      }

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error || 'Failed to update calculator configuration');
      }

      setSuccess('Calculator configuration saved successfully!');

      // Note: Don't refresh data after save because:
      // 1. Local state already has the updated values
      // 2. Database view (calculator_config) may have caching delays
      // 3. Refreshing would overwrite user's changes with potentially stale view data

      setTimeout(() => setSuccess(null), 3000);
    } catch (error) {
      console.error('Error saving calculator config:', error);
      setError(error instanceof Error ? error.message : 'Unknown error occurred');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveMemoryConfig = async (configKey: string) => {
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);

      const configValue = (memoryConfig as any)[configKey];
      console.log(`[SystemConfig] 💾 Saving memory config: ${configKey}`, configValue);

      const response = await fetch('/api/admin/memory-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update',
          configKey,
          configValue
        })
      });

      console.log(`[SystemConfig] Response status: ${response.status}`);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[SystemConfig] ❌ API error:`, errorText);
        throw new Error(`Failed to update ${configKey} configuration: ${response.status}`);
      }

      const result = await response.json();
      console.log(`[SystemConfig] API result:`, result);

      if (!result.success) {
        throw new Error(result.error || `Failed to update ${configKey} configuration`);
      }

      const successMessage = `Memory ${configKey} configuration saved successfully!`;
      console.log(`[SystemConfig] ✅ ${successMessage}`);
      setSuccess(successMessage);

      // Note: Don't refresh data after save - local state already has updated values
      // and database may have caching delays

      setTimeout(() => setSuccess(null), 3000);
    } catch (error) {
      console.error('[SystemConfig] ❌ Error saving memory config:', error);
      setError(error instanceof Error ? error.message : 'Unknown error occurred');
    } finally {
      setSaving(false);
    }
  };

  const formatCost = (cost: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 8,
      maximumFractionDigits: 8
    }).format(cost);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-slate-400">Loading configuration...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2 flex items-center gap-3">
            <Settings className="w-8 h-8 text-blue-400" />
            System Configuration
          </h1>
          <p className="text-slate-400">Manage system-wide settings and AI model routing</p>
        </div>

        <button
          onClick={fetchData}
          disabled={loading}
          className="p-2 bg-slate-800/50 hover:bg-slate-700/50 rounded-lg transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Success/Error Messages */}
      {success && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-green-500/10 border border-green-500/50 rounded-lg p-4 flex items-center gap-3"
        >
          <CheckCircle className="w-5 h-5 text-green-400" />
          <p className="text-green-400">{success}</p>
        </motion.div>
      )}

      {error && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-red-500/10 border border-red-500/50 rounded-lg p-4 flex items-center gap-3"
        >
          <AlertCircle className="w-5 h-5 text-red-400" />
          <p className="text-red-400">{error}</p>
        </motion.div>
      )}

      {/* Intelligent Routing Configuration */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-slate-800/50 backdrop-blur-xl rounded-xl border border-white/10"
      >
        <div className="p-6 border-b border-white/10">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                <Zap className="w-5 h-5 text-yellow-400" />
                Intelligent Model Routing
              </h2>
              <p className="text-sm text-slate-400 mt-1">
                Route agents to cost-efficient AI models based on complexity scores. Reduces costs by up to 94%.
              </p>
            </div>
            <button
              onClick={() => setRoutingExpanded(!routingExpanded)}
              className="p-2 bg-slate-700/50 hover:bg-slate-600/50 rounded-lg transition-colors"
            >
              {routingExpanded ? (
                <ChevronUp className="w-4 h-4 text-slate-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-400" />
              )}
            </button>
          </div>
        </div>

        {routingExpanded && (
          <div className="p-6 space-y-6">
          {/* Info Box */}
          <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <Zap className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
              <div className="space-y-2">
                <p className="text-yellow-400 font-medium text-sm">How Intelligent Routing Works</p>
                <p className="text-slate-300 text-sm leading-relaxed">
                  The system analyzes each agent's complexity score (0-10) and routes it to the most cost-effective AI model.
                  <strong className="text-white"> Low complexity agents</strong> (≤ threshold) use cheap models like GPT-4o-mini (94% savings).
                  <strong className="text-white"> Medium complexity</strong> uses mid-tier models like Claude Haiku (88% savings).
                  <strong className="text-white"> High complexity</strong> uses premium GPT-4o for reliability.
                  New agents default to cheap models until they reach the minimum execution count, then the system routes based on actual performance data.
                </p>
              </div>
            </div>
          </div>

          {/* Master Toggle */}
          <div className="flex items-center justify-between p-4 bg-slate-700/30 rounded-lg">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="font-medium text-white">Enable Intelligent Routing</h3>
                {routingEnabled ? (
                  <span className="px-2 py-0.5 bg-green-500/20 text-green-400 text-xs rounded-full">Active</span>
                ) : (
                  <span className="px-2 py-0.5 bg-slate-600/50 text-slate-400 text-xs rounded-full">Disabled</span>
                )}
              </div>
              <p className="text-sm text-slate-400">
                When enabled, the system will automatically select the most cost-effective AI model based on agent complexity scores
              </p>
            </div>
            <button
              onClick={() => setRoutingEnabled(!routingEnabled)}
              className={`relative w-16 h-8 rounded-full transition-colors duration-300 ${
                routingEnabled ? 'bg-green-500' : 'bg-slate-600'
              }`}
            >
              <motion.div
                className="absolute top-1 left-1 w-6 h-6 bg-white rounded-full shadow-lg"
                animate={{ x: routingEnabled ? 32 : 0 }}
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              />
            </button>
          </div>

          {/* Routing Thresholds */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-300">
                Low Complexity Threshold
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  value={lowThreshold}
                  onChange={(e) => setLowThreshold(parseFloat(e.target.value))}
                  step="0.1"
                  min="0"
                  max="10"
                  className="flex-1 px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                />
                <span className="text-slate-400 text-sm">≤ {lowThreshold}</span>
              </div>
              <p className="text-xs text-slate-500">Agents scoring below this use the cheapest model (GPT-4o-mini). Higher = more agents use cheap model.</p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-300">
                Medium Complexity Threshold
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  value={mediumThreshold}
                  onChange={(e) => setMediumThreshold(parseFloat(e.target.value))}
                  step="0.1"
                  min="0"
                  max="10"
                  className="flex-1 px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                />
                <span className="text-slate-400 text-sm">≤ {mediumThreshold}</span>
              </div>
              <p className="text-xs text-slate-500">Agents scoring below this use mid-tier model (Claude Haiku). Scores above use premium GPT-4o.</p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-300">
                Minimum Success Rate (%)
              </label>
              <input
                type="number"
                value={minSuccessRate}
                onChange={(e) => setMinSuccessRate(parseInt(e.target.value))}
                min="0"
                max="100"
                className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
              />
              <p className="text-xs text-slate-500">Failing agents (below this %) automatically upgrade to premium model for better reliability.</p>
            </div>
          </div>

          {/* Anthropic Provider Toggle */}
          <div className="flex items-center justify-between p-4 bg-slate-700/30 rounded-lg">
            <div className="flex-1">
              <h3 className="font-medium text-white mb-1">Enable Anthropic Claude</h3>
              <p className="text-sm text-slate-400">
                Use Claude 3 Haiku for medium complexity tasks (88% savings vs GPT-4o)
              </p>
            </div>
            <button
              onClick={() => setAnthropicEnabled(!anthropicEnabled)}
              className={`relative w-16 h-8 rounded-full transition-colors duration-300 ${
                anthropicEnabled ? 'bg-green-500' : 'bg-slate-600'
              }`}
            >
              <motion.div
                className="absolute top-1 left-1 w-6 h-6 bg-white rounded-full shadow-lg"
                animate={{ x: anthropicEnabled ? 32 : 0 }}
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              />
            </button>
          </div>

          {/* Routing Tier Visualization */}
          <div className="bg-slate-700/30 rounded-lg p-4">
            <h3 className="font-medium text-white mb-4 flex items-center gap-2">
              <Sliders className="w-4 h-4 text-blue-400" />
              Routing Strategy
            </h3>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-32 text-sm text-slate-300">Low (0-{lowThreshold})</div>
                <div className="flex-1 h-8 bg-green-500/20 border border-green-500/50 rounded-lg flex items-center px-3">
                  <span className="text-sm text-green-400 font-medium">gpt-4o-mini</span>
                  <span className="ml-auto text-xs text-green-400">94% savings</span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-32 text-sm text-slate-300">Medium ({lowThreshold + 0.1}-{mediumThreshold})</div>
                <div className="flex-1 h-8 bg-blue-500/20 border border-blue-500/50 rounded-lg flex items-center px-3">
                  <span className="text-sm text-blue-400 font-medium">claude-3-haiku</span>
                  <span className="ml-auto text-xs text-blue-400">88% savings</span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-32 text-sm text-slate-300">High ({mediumThreshold + 0.1}-10.0)</div>
                <div className="flex-1 h-8 bg-purple-500/20 border border-purple-500/50 rounded-lg flex items-center px-3">
                  <span className="text-sm text-purple-400 font-medium">gpt-4o</span>
                  <span className="ml-auto text-xs text-purple-400">Premium quality</span>
                </div>
              </div>
            </div>
          </div>

          {/* Save Button */}
          <div className="flex justify-end pt-4 border-t border-white/10">
            <button
              onClick={handleSaveRoutingConfig}
              disabled={saving}
              className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors flex items-center gap-2"
            >
              {saving ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Save Configuration
                </>
              )}
            </button>
          </div>
        </div>
        )}
      </motion.div>

      {/* AI Model Pricing Table */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-slate-800/50 backdrop-blur-xl rounded-xl border border-white/10"
      >
        <div className="p-6 border-b border-white/10">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-green-400" />
                AI Model Pricing
              </h2>
              <p className="text-sm text-slate-400 mt-1">
                Token costs for all AI models. Sync to get latest pricing from providers.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleSyncPricing}
                disabled={saving}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
              >
                {saving ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Syncing...
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    Sync Latest Pricing
                  </>
                )}
              </button>
              <button
                onClick={() => setPricingExpanded(!pricingExpanded)}
                className="p-2 bg-slate-700/50 hover:bg-slate-600/50 rounded-lg transition-colors"
              >
                {pricingExpanded ? (
                  <ChevronUp className="w-4 h-4 text-slate-400" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-slate-400" />
                )}
              </button>
            </div>
          </div>
        </div>

        {pricingExpanded && (
          <div className="p-6 space-y-4">
            {/* Info Box */}
            <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <DollarSign className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
                <div className="space-y-2">
                  <p className="text-green-400 font-medium text-sm">About Model Pricing</p>
                  <p className="text-slate-300 text-sm leading-relaxed">
                    This table shows the cost per token for each AI model's input (prompts) and output (responses). Prices are measured in fractions of a cent.
                    <strong className="text-white"> Sync Latest Pricing</strong> updates costs from OpenAI and Anthropic APIs automatically.
                    You can manually edit prices if needed. Lower costs enable more aggressive intelligent routing to save money.
                  </p>
                </div>
              </div>
            </div>

          <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-700/30">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                  Provider
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                  Model
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">
                  Input Cost/Token
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">
                  Output Cost/Token
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">
                  Effective Date
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {pricingModels.map((model) => {
                const isEditing = editingPricing === model.id;

                return (
                  <tr key={model.id} className="hover:bg-slate-700/20 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="px-2 py-1 bg-blue-500/20 text-blue-400 text-xs rounded-full capitalize">
                        {model.provider}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-white font-mono">
                      {model.model_name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-300 text-right">
                      {isEditing ? (
                        <div className="flex items-center justify-end gap-1">
                          <input
                            type="text"
                            value={editedInputCost.toFixed(10)}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              if (!isNaN(val)) setEditedInputCost(val);
                            }}
                            className="w-40 px-2 py-1 bg-slate-700 border border-slate-600 rounded text-white text-sm font-mono text-right"
                            placeholder="0.00000000"
                          />
                          <div className="flex flex-col">
                            <button
                              onClick={() => setEditedInputCost(editedInputCost + 0.00000001)}
                              className="p-0.5 bg-slate-600 hover:bg-slate-500 text-white rounded-t transition-colors"
                              title="Increase"
                            >
                              <ChevronUp className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => setEditedInputCost(Math.max(0, editedInputCost - 0.00000001))}
                              className="p-0.5 bg-slate-600 hover:bg-slate-500 text-white rounded-b transition-colors"
                              title="Decrease"
                            >
                              <ChevronDown className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <span className="font-mono">{formatCost(model.input_cost_per_token)}</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-300 text-right">
                      {isEditing ? (
                        <div className="flex items-center justify-end gap-1">
                          <input
                            type="text"
                            value={editedOutputCost.toFixed(10)}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              if (!isNaN(val)) setEditedOutputCost(val);
                            }}
                            className="w-40 px-2 py-1 bg-slate-700 border border-slate-600 rounded text-white text-sm font-mono text-right"
                            placeholder="0.00000000"
                          />
                          <div className="flex flex-col">
                            <button
                              onClick={() => setEditedOutputCost(editedOutputCost + 0.00000001)}
                              className="p-0.5 bg-slate-600 hover:bg-slate-500 text-white rounded-t transition-colors"
                              title="Increase"
                            >
                              <ChevronUp className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => setEditedOutputCost(Math.max(0, editedOutputCost - 0.00000001))}
                              className="p-0.5 bg-slate-600 hover:bg-slate-500 text-white rounded-b transition-colors"
                              title="Decrease"
                            >
                              <ChevronDown className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <span className="font-mono">{formatCost(model.output_cost_per_token)}</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-400 text-right">
                      {new Date(model.effective_date).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      {isEditing ? (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleSavePricing(model.id)}
                            disabled={saving}
                            className="p-1.5 bg-green-600 hover:bg-green-700 disabled:bg-slate-600 text-white rounded transition-colors"
                            title="Save"
                          >
                            <Check className="w-4 h-4" />
                          </button>
                          <button
                            onClick={handleCancelEditPricing}
                            disabled={saving}
                            className="p-1.5 bg-slate-600 hover:bg-slate-700 disabled:bg-slate-700 text-white rounded transition-colors"
                            title="Cancel"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleEditPricing(model)}
                          className="p-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
                          title="Edit pricing"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
        )}
      </motion.div>

      {/* Calculator Configuration */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="bg-slate-800/50 backdrop-blur-xl rounded-xl border border-white/10"
      >
        <div className="p-6 border-b border-white/10">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                <Sliders className="w-5 h-5 text-purple-400" />
                Calculator Configuration
              </h2>
              <p className="text-sm text-slate-400 mt-1">
                Estimation parameters for the Pilot Credit usage calculator shown to users
              </p>
            </div>
            <button
              onClick={() => setCalcExpanded(!calcExpanded)}
              className="p-2 bg-slate-700/50 hover:bg-slate-600/50 rounded-lg transition-colors"
            >
              {calcExpanded ? (
                <ChevronUp className="w-4 h-4 text-slate-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-400" />
              )}
            </button>
          </div>
        </div>

        {calcExpanded && (
          <div className="p-6 space-y-6">
            {/* Info Box */}
            <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <Sliders className="w-5 h-5 text-purple-400 flex-shrink-0 mt-0.5" />
                <div className="space-y-2">
                  <p className="text-purple-400 font-medium text-sm">About Calculator Configuration</p>
                  <p className="text-slate-300 text-sm leading-relaxed">
                    These parameters power the Pilot Credit calculator that estimates usage costs for users when they design agents.
                    <strong className="text-white"> Token parameters</strong> estimate AI model costs.
                    <strong className="text-white"> Execution parameters</strong> estimate runtime complexity.
                    <strong className="text-white"> Pricing parameters</strong> convert estimates into Pilot Credit costs.
                    Adjust these values to match your actual infrastructure costs and desired pricing model. Changes affect what users see in the calculator, not actual billing.
                  </p>
                </div>
              </div>
            </div>

            {/* Token Estimation */}
            <div className="space-y-4">
              <h3 className="font-medium text-white flex items-center gap-2 pb-2 border-b border-white/10">
                <Database className="w-4 h-4 text-blue-400" />
                Token Estimation
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">
                    Base Tokens
                  </label>
                  <input
                    type="number"
                    value={calcConfig.baseTokens}
                    onChange={(e) => setCalcConfig({ ...calcConfig, baseTokens: parseFloat(e.target.value) })}
                    min="0"
                    step="100"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  <p className="text-xs text-slate-500">Starting token count for basic agent with no plugins. Affects cost estimation.</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">
                    Tokens Per Plugin
                  </label>
                  <input
                    type="number"
                    value={calcConfig.tokensPerPlugin}
                    onChange={(e) => setCalcConfig({ ...calcConfig, tokensPerPlugin: parseFloat(e.target.value) })}
                    min="0"
                    step="50"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  <p className="text-xs text-slate-500">How many extra tokens each connected plugin adds to the agent's usage.</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">
                    Peak Multiplier
                  </label>
                  <input
                    type="number"
                    value={calcConfig.peakMultiplier}
                    onChange={(e) => setCalcConfig({ ...calcConfig, peakMultiplier: parseFloat(e.target.value) })}
                    min="1"
                    max="3"
                    step="0.1"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  <p className="text-xs text-slate-500">Burst factor when agent hits maximum usage (e.g., 1.5 = 50% spike above average).</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">
                    Plugin Usage Rate
                  </label>
                  <input
                    type="number"
                    value={calcConfig.pluginUsageRate}
                    onChange={(e) => setCalcConfig({ ...calcConfig, pluginUsageRate: parseFloat(e.target.value) })}
                    min="0"
                    max="1"
                    step="0.1"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  <p className="text-xs text-slate-500">What % of connected plugins actually get used per run (0.8 = 80% active usage rate).</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">
                    Orchestration Overhead (ms)
                  </label>
                  <input
                    type="number"
                    value={calcConfig.orchestrationOverheadMs}
                    onChange={(e) => setCalcConfig({ ...calcConfig, orchestrationOverheadMs: parseFloat(e.target.value) })}
                    min="0"
                    step="100"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  <p className="text-xs text-slate-500">Extra time (in ms) spent coordinating between plugins during execution.</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">
                    Estimated Duration (ms)
                  </label>
                  <input
                    type="number"
                    value={calcConfig.estimatedDurationMs}
                    onChange={(e) => setCalcConfig({ ...calcConfig, estimatedDurationMs: parseFloat(e.target.value) })}
                    min="0"
                    step="1000"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  <p className="text-xs text-slate-500">How long (in ms) a typical agent execution takes from start to finish.</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">
                    Estimated Failure Rate (%)
                  </label>
                  <input
                    type="number"
                    value={calcConfig.estimatedFailureRate}
                    onChange={(e) => setCalcConfig({ ...calcConfig, estimatedFailureRate: parseFloat(e.target.value) })}
                    min="0"
                    max="100"
                    step="1"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  <p className="text-xs text-slate-500">Expected % of agent runs that fail. Used to calculate retry overhead in cost estimates.</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">
                    Estimated Retry Rate
                  </label>
                  <input
                    type="number"
                    value={calcConfig.estimatedRetryRate}
                    onChange={(e) => setCalcConfig({ ...calcConfig, estimatedRetryRate: parseFloat(e.target.value) })}
                    min="0"
                    step="0.1"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  <p className="text-xs text-slate-500">How many times agents retry on failure (0.5 = half of failures retry once).</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">
                    I/O Ratio
                  </label>
                  <input
                    type="number"
                    value={calcConfig.ioRatio}
                    onChange={(e) => setCalcConfig({ ...calcConfig, ioRatio: parseFloat(e.target.value) })}
                    min="0"
                    step="0.1"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  <p className="text-xs text-slate-500">Ratio of tokens generated vs consumed (2.0 = agent generates twice as much as it reads).</p>
                </div>
              </div>
            </div>

            {/* Execution Parameters */}
            <div className="space-y-4">
              <h3 className="font-medium text-white flex items-center gap-2 pb-2 border-b border-white/10">
                <Zap className="w-4 h-4 text-yellow-400" />
                Execution Parameters
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">
                    Base Iterations
                  </label>
                  <input
                    type="number"
                    value={calcConfig.baseIterations}
                    onChange={(e) => setCalcConfig({ ...calcConfig, baseIterations: parseFloat(e.target.value) })}
                    min="1"
                    max="20"
                    step="1"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  <p className="text-xs text-slate-500">Fewest loops/cycles a simple agent runs before completing its task.</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">
                    Max Iterations
                  </label>
                  <input
                    type="number"
                    value={calcConfig.maxIterations}
                    onChange={(e) => setCalcConfig({ ...calcConfig, maxIterations: parseFloat(e.target.value) })}
                    min="1"
                    max="50"
                    step="1"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  <p className="text-xs text-slate-500">Safety limit: max loops/cycles before stopping complex agents to prevent infinite runs.</p>
                </div>
              </div>
            </div>

            {/* Pricing Parameters */}
            <div className="space-y-4">
              <h3 className="font-medium text-white flex items-center gap-2 pb-2 border-b border-white/10">
                <DollarSign className="w-4 h-4 text-green-400" />
                Pricing Parameters
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">
                    Runs Per Agent Per Month
                  </label>
                  <input
                    type="number"
                    value={calcConfig.runsPerAgentPerMonth}
                    onChange={(e) => setCalcConfig({ ...calcConfig, runsPerAgentPerMonth: parseFloat(e.target.value) })}
                    min="1"
                    max="1000"
                    step="1"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  <p className="text-xs text-slate-500">Average monthly usage: How many times users run each agent per month.</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">
                    Agent Creation Cost (Pilot Credits)
                  </label>
                  <input
                    type="number"
                    value={calcConfig.agentCreationCost}
                    onChange={(e) => setCalcConfig({ ...calcConfig, agentCreationCost: parseFloat(e.target.value) })}
                    min="0"
                    step="100"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  <p className="text-xs text-slate-500">Pilot Credits charged when user first creates an agent (one-time fee).</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">
                    Credit Cost (USD)
                  </label>
                  <input
                    type="number"
                    value={calcConfig.creditCostUsd}
                    onChange={(e) => setCalcConfig({ ...calcConfig, creditCostUsd: parseFloat(e.target.value) })}
                    min="0"
                    step="0.00001"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500 font-mono"
                  />
                  <p className="text-xs text-slate-500">Real money value: How much 1 Pilot Credit costs in actual USD (e.g., $0.00048).</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">
                    Minimum Monthly Cost (USD)
                  </label>
                  <input
                    type="number"
                    value={calcConfig.minimumMonthlyCostUsd}
                    onChange={(e) => setCalcConfig({ ...calcConfig, minimumMonthlyCostUsd: parseFloat(e.target.value) })}
                    min="0"
                    step="1"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  <p className="text-xs text-slate-500">Floor price: Minimum USD charged per month regardless of usage (e.g., $10).</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">
                    Base Credits Per Run
                  </label>
                  <input
                    type="number"
                    value={calcConfig.baseCreditsPerRun}
                    onChange={(e) => setCalcConfig({ ...calcConfig, baseCreditsPerRun: parseFloat(e.target.value) })}
                    min="0"
                    step="10"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  <p className="text-xs text-slate-500">Flat Pilot Credit cost for every agent run, before adding plugin overhead.</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">
                    Plugin Overhead Per Run
                  </label>
                  <input
                    type="number"
                    value={calcConfig.pluginOverheadPerRun}
                    onChange={(e) => setCalcConfig({ ...calcConfig, pluginOverheadPerRun: parseFloat(e.target.value) })}
                    min="0"
                    step="10"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  <p className="text-xs text-slate-500">Extra Pilot Credits charged for each active plugin used during a run.</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">
                    System Overhead Per Run
                  </label>
                  <input
                    type="number"
                    value={calcConfig.systemOverheadPerRun}
                    onChange={(e) => setCalcConfig({ ...calcConfig, systemOverheadPerRun: parseFloat(e.target.value) })}
                    min="0"
                    step="5"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  <p className="text-xs text-slate-500">Platform infrastructure fee: Credits for hosting, monitoring, and system resources per run.</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">
                    Execution Step Multiplier
                  </label>
                  <input
                    type="number"
                    value={calcConfig.executionStepMultiplier}
                    onChange={(e) => setCalcConfig({ ...calcConfig, executionStepMultiplier: parseFloat(e.target.value) })}
                    min="1"
                    step="0.1"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  <p className="text-xs text-slate-500">Complexity multiplier: Increases cost per iteration (1.3 = 30% more credits per loop).</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">
                    Free Tier Credits
                  </label>
                  <input
                    type="number"
                    value={calcConfig.freeTierCredits}
                    onChange={(e) => setCalcConfig({ ...calcConfig, freeTierCredits: parseFloat(e.target.value) })}
                    min="0"
                    step="100"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  <p className="text-xs text-slate-500">Welcome bonus: Pilot Credits given to each new user for free trial (e.g., 1000 credits).</p>
                </div>
              </div>
            </div>

            {/* Save Button */}
            <div className="flex justify-end pt-4 border-t border-white/10">
              <button
                onClick={handleSaveCalculatorConfig}
                disabled={saving}
                className="px-6 py-2.5 bg-purple-600 hover:bg-purple-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors flex items-center gap-2"
              >
                {saving ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    Save Calculator Config
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </motion.div>

      {/* Memory System Configuration */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="bg-slate-800/50 backdrop-blur-xl rounded-xl border border-white/10"
      >
        <div className="p-6 border-b border-white/10">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                <Brain className="w-5 h-5 text-teal-400" />
                Memory System Configuration
              </h2>
              <p className="text-sm text-slate-400 mt-1">
                Configure AI memory system for agent execution context, summarization, and learning
              </p>
            </div>
            <button
              onClick={() => setMemoryExpanded(!memoryExpanded)}
              className="p-2 bg-slate-700/50 hover:bg-slate-600/50 rounded-lg transition-colors"
            >
              {memoryExpanded ? (
                <ChevronUp className="w-4 h-4 text-slate-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-400" />
              )}
            </button>
          </div>
        </div>

        {memoryExpanded && (
          <div className="p-6 space-y-6">
            {/* Info Box */}
            <div className="bg-teal-500/10 border border-teal-500/20 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <Brain className="w-5 h-5 text-teal-400 flex-shrink-0 mt-0.5" />
                <div className="space-y-2">
                  <p className="text-teal-400 font-medium text-sm">How Memory System Works</p>
                  <p className="text-slate-300 text-sm leading-relaxed">
                    The memory system enhances agent executions with context from past runs.
                    <strong className="text-white"> Before execution</strong>, relevant memories are loaded (recent runs, user preferences, learned patterns) within a token budget.
                    <strong className="text-white"> After execution</strong>, gpt-4o-mini asynchronously creates a concise summary for future reference.
                    <strong className="text-white"> Integration</strong>: Works seamlessly with ModelRouter - memory context helps agents make better decisions while AIS routes to cost-efficient models.
                  </p>
                </div>
              </div>
            </div>

            {/* Token Budget & Injection Settings */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium text-white">Memory Injection Settings</h3>
                <button
                  onClick={() => handleSaveMemoryConfig('injection')}
                  disabled={saving}
                  className="px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:bg-slate-600 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                >
                  {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Save
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">
                    Max Memory Tokens
                  </label>
                  <input
                    type="number"
                    value={memoryConfig.injection.max_tokens}
                    onChange={(e) => setMemoryConfig({
                      ...memoryConfig,
                      injection: { ...memoryConfig.injection, max_tokens: parseInt(e.target.value) }
                    })}
                    min="100"
                    max="2000"
                    step="50"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-teal-500"
                  />
                  <p className="text-xs text-slate-500">Maximum tokens allocated for memory context. Higher values provide more context but consume more of the model's context window (recommended: 800).</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">
                    Min Recent Runs
                  </label>
                  <input
                    type="number"
                    value={memoryConfig.injection.min_recent_runs}
                    onChange={(e) => setMemoryConfig({
                      ...memoryConfig,
                      injection: { ...memoryConfig.injection, min_recent_runs: parseInt(e.target.value) }
                    })}
                    min="1"
                    max="10"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-teal-500"
                  />
                  <p className="text-xs text-slate-500">Minimum number of recent execution memories to always include, even if token budget is tight (recommended: 3).</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">
                    Max Recent Runs
                  </label>
                  <input
                    type="number"
                    value={memoryConfig.injection.max_recent_runs}
                    onChange={(e) => setMemoryConfig({
                      ...memoryConfig,
                      injection: { ...memoryConfig.injection, max_recent_runs: parseInt(e.target.value) }
                    })}
                    min="3"
                    max="20"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-teal-500"
                  />
                  <p className="text-xs text-slate-500">Maximum number of recent runs to fetch and consider for injection (space permitting within token budget).</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">
                    Semantic Search Limit
                  </label>
                  <input
                    type="number"
                    value={memoryConfig.injection.semantic_search_limit}
                    onChange={(e) => setMemoryConfig({
                      ...memoryConfig,
                      injection: { ...memoryConfig.injection, semantic_search_limit: parseInt(e.target.value) }
                    })}
                    min="0"
                    max="10"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-teal-500"
                  />
                  <p className="text-xs text-slate-500">Maximum number of semantically similar memories to retrieve using vector search (requires embeddings to be generated).</p>
                </div>
              </div>
            </div>

            {/* Summarization Settings */}
            <div className="space-y-4 pt-6 border-t border-white/10">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium text-white">Memory Summarization Settings</h3>
                <button
                  onClick={() => handleSaveMemoryConfig('summarization')}
                  disabled={saving}
                  className="px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:bg-slate-600 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                >
                  {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Save
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">
                    Summarization Model
                  </label>
                  <select
                    value={memoryConfig.summarization.model}
                    onChange={(e) => setMemoryConfig({
                      ...memoryConfig,
                      summarization: { ...memoryConfig.summarization, model: e.target.value }
                    })}
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-teal-500"
                  >
                    <option value="gpt-4o-mini">gpt-4o-mini (recommended)</option>
                    <option value="gpt-4o">gpt-4o</option>
                    <option value="gpt-3.5-turbo">gpt-3.5-turbo</option>
                  </select>
                  <p className="text-xs text-slate-500">LLM model used to analyze executions and create concise memory summaries. gpt-4o-mini provides good quality at ~$0.0003 per run.</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">
                    Temperature
                  </label>
                  <input
                    type="number"
                    value={memoryConfig.summarization.temperature}
                    onChange={(e) => setMemoryConfig({
                      ...memoryConfig,
                      summarization: { ...memoryConfig.summarization, temperature: parseFloat(e.target.value) }
                    })}
                    min="0"
                    max="1"
                    step="0.1"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-teal-500"
                  />
                  <p className="text-xs text-slate-500">Controls randomness in summary generation. Lower values (0.3) produce more consistent, focused summaries. Higher values (0.7+) add creativity.</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">
                    Max Tokens
                  </label>
                  <input
                    type="number"
                    value={memoryConfig.summarization.max_tokens}
                    onChange={(e) => setMemoryConfig({
                      ...memoryConfig,
                      summarization: { ...memoryConfig.summarization, max_tokens: parseInt(e.target.value) }
                    })}
                    min="100"
                    max="1000"
                    step="50"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-teal-500"
                  />
                  <p className="text-xs text-slate-500">Maximum length of generated memory summaries in tokens. Higher values allow more detailed summaries but increase cost (recommended: 500).</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300 flex items-center gap-2">
                    Async Summarization
                  </label>
                  <div className="flex items-center h-[42px]">
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={memoryConfig.summarization.async}
                        onChange={(e) => setMemoryConfig({
                          ...memoryConfig,
                          summarization: { ...memoryConfig.summarization, async: e.target.checked }
                        })}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-teal-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-teal-600"></div>
                      <span className="ml-3 text-sm text-slate-300">{memoryConfig.summarization.async ? 'Enabled' : 'Disabled'}</span>
                    </label>
                  </div>
                  <p className="text-xs text-slate-500">When enabled, memory summarization runs in the background after agent execution completes. Prevents blocking user response (recommended: enabled).</p>
                </div>
              </div>
            </div>

            {/* Importance Scoring Settings */}
            <div className="space-y-4 pt-6 border-t border-white/10">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium text-white">Importance Scoring Weights</h3>
                <button
                  onClick={() => handleSaveMemoryConfig('importance')}
                  disabled={saving}
                  className="px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:bg-slate-600 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                >
                  {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Save
                </button>
              </div>
              <p className="text-xs text-slate-400">These weights determine memory importance scores (1-10), which affect retention and priority. Higher importance memories are kept longer and loaded first.</p>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">Base Score</label>
                  <input
                    type="number"
                    value={memoryConfig.importance.base_score}
                    onChange={(e) => setMemoryConfig({
                      ...memoryConfig,
                      importance: { ...memoryConfig.importance, base_score: parseInt(e.target.value) }
                    })}
                    min="1"
                    max="10"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-teal-500"
                  />
                  <p className="text-xs text-slate-500">Starting importance for all memories</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">Error Bonus</label>
                  <input
                    type="number"
                    value={memoryConfig.importance.error_bonus}
                    onChange={(e) => setMemoryConfig({
                      ...memoryConfig,
                      importance: { ...memoryConfig.importance, error_bonus: parseInt(e.target.value) }
                    })}
                    min="0"
                    max="5"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-teal-500"
                  />
                  <p className="text-xs text-slate-500">Added for failed executions (learn from errors)</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">Pattern Bonus</label>
                  <input
                    type="number"
                    value={memoryConfig.importance.pattern_bonus}
                    onChange={(e) => setMemoryConfig({
                      ...memoryConfig,
                      importance: { ...memoryConfig.importance, pattern_bonus: parseInt(e.target.value) }
                    })}
                    min="0"
                    max="5"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-teal-500"
                  />
                  <p className="text-xs text-slate-500">Added when recurring patterns detected</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">User Feedback Bonus</label>
                  <input
                    type="number"
                    value={memoryConfig.importance.user_feedback_bonus}
                    onChange={(e) => setMemoryConfig({
                      ...memoryConfig,
                      importance: { ...memoryConfig.importance, user_feedback_bonus: parseInt(e.target.value) }
                    })}
                    min="0"
                    max="5"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-teal-500"
                  />
                  <p className="text-xs text-slate-500">Added when user provides explicit feedback</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">First Run Bonus</label>
                  <input
                    type="number"
                    value={memoryConfig.importance.first_run_bonus}
                    onChange={(e) => setMemoryConfig({
                      ...memoryConfig,
                      importance: { ...memoryConfig.importance, first_run_bonus: parseInt(e.target.value) }
                    })}
                    min="0"
                    max="5"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-teal-500"
                  />
                  <p className="text-xs text-slate-500">Added for agent's first execution (baseline)</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">Milestone Bonus</label>
                  <input
                    type="number"
                    value={memoryConfig.importance.milestone_bonus}
                    onChange={(e) => setMemoryConfig({
                      ...memoryConfig,
                      importance: { ...memoryConfig.importance, milestone_bonus: parseInt(e.target.value) }
                    })}
                    min="0"
                    max="5"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-teal-500"
                  />
                  <p className="text-xs text-slate-500">Added every 10th run (checkpoints)</p>
                </div>
              </div>
            </div>

            {/* Retention Policy */}
            <div className="space-y-4 pt-6 border-t border-white/10">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium text-white">Memory Retention Policy</h3>
                <button
                  onClick={() => handleSaveMemoryConfig('retention')}
                  disabled={saving}
                  className="px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:bg-slate-600 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                >
                  {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Save
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">
                    Run Memories (Days)
                  </label>
                  <input
                    type="number"
                    value={memoryConfig.retention.run_memories_days}
                    onChange={(e) => setMemoryConfig({
                      ...memoryConfig,
                      retention: { ...memoryConfig.retention, run_memories_days: parseInt(e.target.value) }
                    })}
                    min="7"
                    max="365"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-teal-500"
                  />
                  <p className="text-xs text-slate-500">Retention period for medium-importance memories (score 5-7). Balances context availability with database growth (recommended: 90 days).</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">
                    Low Importance (Days)
                  </label>
                  <input
                    type="number"
                    value={memoryConfig.retention.low_importance_days}
                    onChange={(e) => setMemoryConfig({
                      ...memoryConfig,
                      retention: { ...memoryConfig.retention, low_importance_days: parseInt(e.target.value) }
                    })}
                    min="1"
                    max="90"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-teal-500"
                  />
                  <p className="text-xs text-slate-500">Retention period for low-importance memories (score 1-4). Routine successes without insights cleaned up sooner (recommended: 30 days).</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">
                    Consolidation Threshold
                  </label>
                  <input
                    type="number"
                    value={memoryConfig.retention.consolidation_threshold}
                    onChange={(e) => setMemoryConfig({
                      ...memoryConfig,
                      retention: { ...memoryConfig.retention, consolidation_threshold: parseInt(e.target.value) }
                    })}
                    min="10"
                    max="200"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-teal-500"
                  />
                  <p className="text-xs text-slate-500">Number of memories that triggers consolidation. When agent accumulates this many memories, similar patterns merge into consolidated insights (recommended: 50).</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">
                    Consolidation Frequency (Days)
                  </label>
                  <input
                    type="number"
                    value={memoryConfig.retention.consolidation_frequency_days}
                    onChange={(e) => setMemoryConfig({
                      ...memoryConfig,
                      retention: { ...memoryConfig.retention, consolidation_frequency_days: parseInt(e.target.value) }
                    })}
                    min="1"
                    max="30"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-teal-500"
                  />
                  <p className="text-xs text-slate-500">How often to run memory consolidation job. Lower frequency keeps memories fresher but uses more compute (recommended: 7 days).</p>
                </div>
              </div>
              <p className="text-xs text-slate-400">Note: High-importance memories (score 8-10) with critical patterns, errors, or user feedback are kept indefinitely.</p>
            </div>

            {/* Embedding Settings */}
            <div className="space-y-4 pt-6 border-t border-white/10">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium text-white">Embedding Configuration</h3>
                <button
                  onClick={() => handleSaveMemoryConfig('embedding')}
                  disabled={saving}
                  className="px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:bg-slate-600 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                >
                  {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Save
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">
                    Embedding Model
                  </label>
                  <select
                    value={memoryConfig.embedding.model}
                    onChange={(e) => setMemoryConfig({
                      ...memoryConfig,
                      embedding: { ...memoryConfig.embedding, model: e.target.value }
                    })}
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-teal-500"
                  >
                    <option value="text-embedding-3-small">text-embedding-3-small (recommended)</option>
                    <option value="text-embedding-3-large">text-embedding-3-large</option>
                    <option value="text-embedding-ada-002">text-embedding-ada-002</option>
                  </select>
                  <p className="text-xs text-slate-500">OpenAI model for generating vector embeddings. Used for semantic search to find similar memories based on meaning (recommended: text-embedding-3-small).</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">
                    Batch Size
                  </label>
                  <input
                    type="number"
                    value={memoryConfig.embedding.batch_size}
                    onChange={(e) => setMemoryConfig({
                      ...memoryConfig,
                      embedding: { ...memoryConfig.embedding, batch_size: parseInt(e.target.value) }
                    })}
                    min="1"
                    max="500"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-teal-500"
                  />
                  <p className="text-xs text-slate-500">Number of memories to process in a single batch when generating embeddings. Higher values are more efficient but use more memory (recommended: 100).</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">
                    Dimensions
                  </label>
                  <input
                    type="number"
                    value={memoryConfig.embedding.dimensions}
                    onChange={(e) => setMemoryConfig({
                      ...memoryConfig,
                      embedding: { ...memoryConfig.embedding, dimensions: parseInt(e.target.value) }
                    })}
                    min="256"
                    max="3072"
                    step="256"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-teal-500"
                  />
                  <p className="text-xs text-slate-500">Vector embedding dimension size. Higher dimensions provide better semantic accuracy but require more storage (recommended: 1536 for text-embedding-3-small).</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </motion.div>

      {/* Advanced System Configuration */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="bg-slate-800/50 backdrop-blur-xl rounded-xl border border-white/10"
      >
        <div className="p-6 border-b border-white/10">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                <Database className="w-5 h-5 text-orange-400" />
                Advanced Configuration
              </h2>
              <p className="text-sm text-slate-400 mt-1">
                Complete system configuration in JSON format. Use with caution - incorrect values may affect platform stability.
              </p>
            </div>
            <button
              onClick={() => setAdvancedExpanded(!advancedExpanded)}
              className="p-2 bg-slate-700/50 hover:bg-slate-600/50 rounded-lg transition-colors"
            >
              {advancedExpanded ? (
                <ChevronUp className="w-4 h-4 text-slate-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-400" />
              )}
            </button>
          </div>
        </div>
        {advancedExpanded && (
          <div className="p-6">
            <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-700">
              <div className="flex items-start gap-3 mb-3">
                <AlertCircle className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-yellow-400 text-sm font-medium">Advanced Settings</p>
                  <p className="text-slate-400 text-xs mt-1">
                    This is a read-only view of all system settings. To modify values, use the specific configuration sections above.
                  </p>
                </div>
              </div>
              <pre className="text-xs text-slate-300 bg-slate-950 p-4 rounded-lg overflow-x-auto border border-slate-800">
                {JSON.stringify({
                  routing: {
                    intelligent_routing_enabled: routingEnabled,
                    routing_low_threshold: lowThreshold,
                    routing_medium_threshold: mediumThreshold,
                    routing_min_success_rate: minSuccessRate,
                    anthropic_provider_enabled: anthropicEnabled,
                    note: "Routing threshold controlled by min_executions_for_score in AIS Config"
                  },
                  calculator: calcConfig,
                  pricing_models: pricingModels.map(m => ({
                    provider: m.provider,
                    model: m.model_name,
                    input_cost: m.input_cost_per_token,
                    output_cost: m.output_cost_per_token
                  }))
                }, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </motion.div>

    </div>
  );
}
