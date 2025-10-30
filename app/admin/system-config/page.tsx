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
  ChevronDown
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

  const [settings, setSettings] = useState<SystemSetting[]>([]);
  const [pricingModels, setPricingModels] = useState<ModelPricing[]>([]);

  // Routing configuration state
  const [routingEnabled, setRoutingEnabled] = useState(false);
  const [lowThreshold, setLowThreshold] = useState(3.9);
  const [mediumThreshold, setMediumThreshold] = useState(6.9);
  const [minExecutions, setMinExecutions] = useState(3);
  const [minSuccessRate, setMinSuccessRate] = useState(85);
  const [anthropicEnabled, setAnthropicEnabled] = useState(true);

  // Pricing editing state
  const [editingPricing, setEditingPricing] = useState<string | null>(null);
  const [editedInputCost, setEditedInputCost] = useState<number>(0);
  const [editedOutputCost, setEditedOutputCost] = useState<number>(0);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
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

      setSettings(settingsResult.data);

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
          case 'routing_min_executions':
            setMinExecutions(parseInt(setting.value));
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

    } catch (error) {
      console.error('Error fetching data:', error);
      setError(error instanceof Error ? error.message : 'Unknown error occurred');
    } finally {
      setLoading(false);
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
        routing_min_executions: minExecutions,
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

      // Refresh data
      await fetchData();

      // Clear success message after 3 seconds
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

      // Refresh pricing data
      await fetchData();

      // Clear success message after 3 seconds
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

      // Refresh pricing data
      await fetchData();

      // Clear success message after 5 seconds
      setTimeout(() => setSuccess(null), 5000);

    } catch (error) {
      console.error('Error syncing pricing:', error);
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
          <h2 className="text-xl font-semibold text-white flex items-center gap-2">
            <Zap className="w-5 h-5 text-yellow-400" />
            Intelligent Model Routing
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Automatically route agent requests to cost-efficient AI models based on complexity
          </p>
        </div>

        <div className="p-6 space-y-6">
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
              <p className="text-xs text-slate-500">Uses gpt-4o-mini (94% savings)</p>
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
              <p className="text-xs text-slate-500">Uses claude-3-haiku (88% savings)</p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-300">
                Minimum Executions
              </label>
              <input
                type="number"
                value={minExecutions}
                onChange={(e) => setMinExecutions(parseInt(e.target.value))}
                min="1"
                max="20"
                className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
              />
              <p className="text-xs text-slate-500">New agents use gpt-4o-mini until this threshold</p>
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
              <p className="text-xs text-slate-500">Auto-upgrade to premium below this rate</p>
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
                Current pricing for all available AI models
              </p>
            </div>
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
      </motion.div>

      {/* System Settings Debug Info (Development Only) */}
      {process.env.NODE_ENV === 'development' && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-slate-800/50 backdrop-blur-xl rounded-xl border border-white/10"
        >
          <div className="p-6 border-b border-white/10">
            <h2 className="text-xl font-semibold text-white flex items-center gap-2">
              <Database className="w-5 h-5 text-orange-400" />
              All System Settings (Dev Only)
            </h2>
          </div>
          <div className="p-6">
            <pre className="text-xs text-slate-300 bg-slate-900/50 p-4 rounded-lg overflow-x-auto">
              {JSON.stringify(settings, null, 2)}
            </pre>
          </div>
        </motion.div>
      )}
    </div>
  );
}
