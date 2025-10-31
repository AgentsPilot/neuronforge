'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/components/UserProvider';
import {
  Settings, Zap, TrendingUp, Database, CheckCircle,
  AlertCircle, RefreshCw, BarChart3, Lock, Unlock, ChevronUp, ChevronDown, Save
} from 'lucide-react';

interface RangeConfig {
  id: string;
  range_key: string;
  best_practice_min: number;
  best_practice_max: number;
  dynamic_min: number | null;
  dynamic_max: number | null;
  description: string;
  category: string;
  data_points_analyzed: number;
  last_updated_at: string;
}

interface Statistics {
  totalAgents: number;
  totalCreations?: number;
  totalExecutions: number;
  totalTokens: number;
  creationTokens?: number;
  executionTokens?: number;
  dataPointsAvailable: boolean;
}

interface AISConfig {
  mode: 'best_practice' | 'dynamic';
  minExecutionsRequired: number;
  canSwitchToDynamic: boolean;
  statistics: Statistics;
  ranges: Record<string, RangeConfig[]>;
}

export default function AISConfigPage() {
  console.log('🎯 [AIS Config] Component rendering');
  const { user } = useAuth();
  console.log('🎯 [AIS Config] User:', user ? 'Logged in' : 'Not logged in');
  const [config, setConfig] = useState<AISConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editingThreshold, setEditingThreshold] = useState(false);
  const [newThreshold, setNewThreshold] = useState<number>(10);

  // System Limits state
  const [limitsExpanded, setLimitsExpanded] = useState(false);
  const [savingLimits, setSavingLimits] = useState(false);
  const [limitsError, setLimitsError] = useState<string | null>(null);
  const [limitsSuccess, setLimitsSuccess] = useState<string | null>(null);
  const [systemLimits, setSystemLimits] = useState({
    minAgentIntensity: 0.0,
    maxAgentIntensity: 10.0,
    minExecutionsForScore: 5
  });

  // Ranges collapse state
  const [creationRangesExpanded, setCreationRangesExpanded] = useState(false);
  const [executionRangesExpanded, setExecutionRangesExpanded] = useState(false);

  // AIS Weights state
  const [weightsExpanded, setWeightsExpanded] = useState(false);
  const [savingWeights, setSavingWeights] = useState(false);
  const [weightsError, setWeightsError] = useState<string | null>(null);
  const [weightsSuccess, setWeightsSuccess] = useState<string | null>(null);
  const [aisWeights, setAisWeights] = useState({
    // Dimension weights (must sum to 1.0)
    tokens: 0.35,
    execution: 0.25,
    plugins: 0.25,
    workflow: 0.15,
    // Token subdimensions (must sum to 1.0)
    token_volume: 0.5,
    token_peak: 0.3,
    token_io: 0.2,
    // Execution subdimensions (must sum to 1.0)
    execution_iterations: 0.35,
    execution_duration: 0.30,
    execution_failure: 0.20,
    execution_retry: 0.15,
    // Plugin subdimensions (must sum to 1.0)
    plugin_count: 0.4,
    plugin_usage: 0.35,
    plugin_overhead: 0.25,
    // Workflow subdimensions (must sum to 1.0)
    workflow_steps: 0.4,
    workflow_branches: 0.25,
    workflow_loops: 0.20,
    workflow_parallel: 0.15
  });

  const fetchConfig = async () => {
    try {
      console.log('🔍 [AIS Config UI] Fetching configuration...');
      setLoading(true);
      const response = await fetch('/api/admin/ais-config');
      console.log('🔍 [AIS Config UI] Response status:', response.status);

      const data = await response.json();
      console.log('🔍 [AIS Config UI] Response data:', data);

      if (data.success) {
        console.log('✅ [AIS Config UI] Config loaded successfully');
        setConfig(data.config);

        // Load system limits and AIS weights from the same response
        if (data.config.systemLimits) {
          const newLimits = data.config.systemLimits;
          console.log('🔄 [Frontend] Updating systemLimits state to:', newLimits);
          setSystemLimits(newLimits);
        }

        if (data.config.aisWeights) {
          const w = data.config.aisWeights;
          console.log('🔄 [Frontend] Updating aisWeights state');
          setAisWeights({
            tokens: w.tokens || 0.35,
            execution: w.execution || 0.25,
            plugins: w.plugins || 0.25,
            workflow: w.workflow || 0.15,
            token_volume: w.token_volume || 0.5,
            token_peak: w.token_peak || 0.3,
            token_io: w.token_io || 0.2,
            execution_iterations: w.execution_iterations || 0.35,
            execution_duration: w.execution_duration || 0.30,
            execution_failure: w.execution_failure || 0.20,
            execution_retry: w.execution_retry || 0.15,
            plugin_count: w.plugin_count || 0.4,
            plugin_usage: w.plugin_usage || 0.35,
            plugin_overhead: w.plugin_overhead || 0.25,
            workflow_steps: w.workflow_steps || 0.4,
            workflow_branches: w.workflow_branches || 0.25,
            workflow_loops: w.workflow_loops || 0.20,
            workflow_parallel: w.workflow_parallel || 0.15
          });
        }
      } else {
        console.error('❌ [AIS Config UI] Failed:', data.error);
        setError(data.error || 'Failed to fetch configuration');
      }
    } catch (err) {
      console.error('❌ [AIS Config UI] Exception:', err);
      setError('Failed to load configuration');
    } finally {
      setLoading(false);
      console.log('✅ [AIS Config UI] Loading complete');
    }
  };

  useEffect(() => {
    console.log('🎯 [AIS Config] useEffect triggered, fetching config...');
    fetchConfig();
  }, []);

  const handleSwitchMode = async (newMode: 'best_practice' | 'dynamic') => {
    if (!config) return;

    if (newMode === 'dynamic' && !config.canSwitchToDynamic) {
      setError(`Not enough data to switch to dynamic mode. Need at least ${config.minExecutionsRequired} agent executions.`);
      return;
    }

    try {
      setSwitching(true);
      setError(null);

      const response = await fetch('/api/admin/ais-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'switch_mode',
          mode: newMode
        })
      });

      const data = await response.json();

      if (data.success) {
        await fetchConfig(); // Refresh config
      } else {
        setError(data.error || 'Failed to switch mode');
      }
    } catch (err) {
      setError('Failed to switch mode');
      console.error(err);
    } finally {
      setSwitching(false);
    }
  };

  const handleRefreshRanges = async () => {
    if (!config) return;

    if (!config.canSwitchToDynamic) {
      setError(`Not enough data to calculate dynamic ranges. Need at least ${config.minExecutionsRequired} agent executions.`);
      return;
    }

    try {
      setSwitching(true);
      setError(null);
      setSuccess(null);

      const response = await fetch('/api/admin/ais-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'refresh_ranges'
        })
      });

      const data = await response.json();

      if (data.success) {
        await fetchConfig(); // Refresh config to show updated ranges
        const auditInfo = data.audit ? ` (Captured ${data.audit.before_snapshot} agents, ${data.audit.old_ranges} ranges)` : '';
        setSuccess(`✅ Dynamic ranges refreshed successfully!${auditInfo}`);
        // Auto-clear success message after 5 seconds
        setTimeout(() => setSuccess(null), 5000);
      } else {
        setError(data.error || 'Failed to refresh ranges');
      }
    } catch (err) {
      setError('Failed to refresh ranges');
      console.error(err);
    } finally {
      setSwitching(false);
    }
  };

  const handleUpdateThreshold = async () => {
    if (!config || newThreshold < 1) return;

    try {
      setSwitching(true);
      setError(null);

      const response = await fetch('/api/admin/ais-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_threshold',
          threshold: newThreshold
        })
      });

      const data = await response.json();

      if (data.success) {
        await fetchConfig();
        setEditingThreshold(false);
      } else {
        setError(data.error || 'Failed to update threshold');
      }
    } catch (err) {
      setError('Failed to update threshold');
      console.error(err);
    } finally {
      setSwitching(false);
    }
  };

  const handleSaveAISWeights = async () => {
    try {
      console.log('🔧 [Frontend] Starting AIS weights save...');
      console.log('🔧 [Frontend] Current aisWeights state:', aisWeights);

      setSavingWeights(true);
      setWeightsError(null);
      setWeightsSuccess(null);

      // Validate dimension weights sum to 1.0
      const dimensionSum = aisWeights.tokens + aisWeights.execution + aisWeights.plugins + aisWeights.workflow;
      if (Math.abs(dimensionSum - 1.0) > 0.001) {
        setWeightsError(`Dimension weights must sum to 1.0 (currently ${dimensionSum.toFixed(3)})`);
        setSavingWeights(false);
        return;
      }

      // Validate subdimension weights sum to 1.0
      const tokenSum = aisWeights.token_volume + aisWeights.token_peak + aisWeights.token_io;
      const executionSum = aisWeights.execution_iterations + aisWeights.execution_duration +
                          aisWeights.execution_failure + aisWeights.execution_retry;
      const pluginSum = aisWeights.plugin_count + aisWeights.plugin_usage + aisWeights.plugin_overhead;
      const workflowSum = aisWeights.workflow_steps + aisWeights.workflow_branches +
                         aisWeights.workflow_loops + aisWeights.workflow_parallel;

      if (Math.abs(tokenSum - 1.0) > 0.001) {
        setWeightsError(`Token subdimension weights must sum to 1.0 (currently ${tokenSum.toFixed(3)})`);
        setSavingWeights(false);
        return;
      }
      if (Math.abs(executionSum - 1.0) > 0.001) {
        setWeightsError(`Execution subdimension weights must sum to 1.0 (currently ${executionSum.toFixed(3)})`);
        setSavingWeights(false);
        return;
      }
      if (Math.abs(pluginSum - 1.0) > 0.001) {
        setWeightsError(`Plugin subdimension weights must sum to 1.0 (currently ${pluginSum.toFixed(3)})`);
        setSavingWeights(false);
        return;
      }
      if (Math.abs(workflowSum - 1.0) > 0.001) {
        setWeightsError(`Workflow subdimension weights must sum to 1.0 (currently ${workflowSum.toFixed(3)})`);
        setSavingWeights(false);
        return;
      }

      const payload = { weights: aisWeights };
      console.log('🔧 [Frontend] Request payload:', JSON.stringify(payload, null, 2));

      const response = await fetch('/api/admin/ais-weights', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      console.log('🔧 [Frontend] Response status:', response.status);
      const data = await response.json();
      console.log('🔧 [Frontend] Response data:', data);

      if (data.success) {
        setWeightsSuccess('✅ AIS weights updated successfully!');
        await fetchConfig();

        // Keep the card expanded so user can see the updated values
        setWeightsExpanded(true);

        setTimeout(() => setWeightsSuccess(null), 5000);
      } else {
        setWeightsError(data.error || 'Failed to update AIS weights');
      }
    } catch (err) {
      setWeightsError('Failed to update AIS weights');
      console.error(err);
    } finally {
      setSavingWeights(false);
    }
  };

  const handleSaveSystemLimits = async () => {
    try {
      console.log('🔧 [Frontend] Starting system limits save...');
      console.log('🔧 [Frontend] Current systemLimits state:', systemLimits);

      setSavingLimits(true);
      setLimitsError(null);
      setLimitsSuccess(null);

      const payload = { limits: systemLimits };
      console.log('🔧 [Frontend] Request payload:', JSON.stringify(payload, null, 2));

      const response = await fetch('/api/admin/system-limits', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      console.log('🔧 [Frontend] Response status:', response.status);
      console.log('🔧 [Frontend] Response ok:', response.ok);

      const data = await response.json();
      console.log('🔧 [Frontend] Response data:', data);

      if (data.success) {
        setLimitsSuccess('✅ System limits updated successfully!');
        console.log('✅ [Frontend] Refreshing config after successful save...');

        // Refresh config to get latest values from database
        await fetchConfig();

        // Keep the card expanded so user can see the updated values
        setLimitsExpanded(true);

        setTimeout(() => setLimitsSuccess(null), 5000);
      } else {
        console.error('❌ [Frontend] Save failed:', data.error);
        setLimitsError(data.error || 'Failed to update system limits');
      }
    } catch (err) {
      console.error('❌ [Frontend] Exception during save:', err);
      setLimitsError('Failed to update system limits');
      console.error(err);
    } finally {
      setSavingLimits(false);
      console.log('🔧 [Frontend] Save operation completed');
    }
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'token_complexity': return <Zap className="w-5 h-5" />;
      case 'execution_complexity': return <TrendingUp className="w-5 h-5" />;
      case 'plugin_complexity': return <Database className="w-5 h-5" />;
      case 'workflow_complexity': return <BarChart3 className="w-5 h-5" />;
      default: return <Settings className="w-5 h-5" />;
    }
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'token_complexity': return 'from-blue-500 to-blue-600';
      case 'execution_complexity': return 'from-purple-500 to-purple-600';
      case 'plugin_complexity': return 'from-green-500 to-green-600';
      case 'workflow_complexity': return 'from-orange-500 to-orange-600';
      default: return 'from-gray-500 to-gray-600';
    }
  };

  const formatRangeLabel = (rangeKey: string) => {
    const labels: Record<string, string> = {
      'token_volume': 'Token Volume (Avg)',
      'token_peak': 'Token Peak (Max)',
      'token_io_ratio_min': 'Token I/O Ratio (Min)',
      'token_io_ratio_max': 'Token I/O Ratio (Max)',
      'iterations': 'Iterations per Run',
      'duration_ms': 'Execution Duration (ms)',
      'failure_rate': 'Failure Rate (%)',
      'retry_rate': 'Retry Rate',
      'plugin_count': 'Unique Plugins',
      'plugins_per_run': 'Plugins per Run',
      'orchestration_overhead_ms': 'Orchestration Overhead (ms)',
      'workflow_steps': 'Workflow Steps',
      'branches': 'Conditional Branches',
      'loops': 'Loop Iterations',
      'parallel': 'Parallel Executions'
    };
    return labels[rangeKey] || rangeKey.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-8">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-center h-64">
            <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
          </div>
        </div>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-8">
        <div className="max-w-7xl mx-auto">
          <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-6">
            <p className="text-red-400">{error || 'Failed to load configuration'}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-black text-white flex items-center gap-3">
              <Settings className="w-10 h-10" />
              AIS Configuration
            </h1>
            <p className="text-slate-400 mt-2">
              Manage Agent Intensity System normalization ranges and learning mode
            </p>
          </div>
          {config?.mode === 'dynamic' && config.canSwitchToDynamic && (
            <button
              onClick={handleRefreshRanges}
              disabled={switching}
              className="px-4 py-2 bg-gradient-to-r from-green-500 to-emerald-600 rounded-lg hover:from-green-600 hover:to-emerald-700 transition-all duration-200 flex items-center gap-2 disabled:opacity-50"
            >
              <RefreshCw className={`w-5 h-5 ${switching ? 'animate-spin' : ''}`} />
              Refresh Dynamic Ranges
            </button>
          )}
        </div>

        {/* Error Display */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-red-400 font-medium">Error</p>
              <p className="text-red-300 text-sm mt-1">{error}</p>
            </div>
          </div>
        )}

        {/* Success Display */}
        {success && (
          <div className="bg-green-500/10 border border-green-500/50 rounded-lg p-4 flex items-start gap-3">
            <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-green-400 font-medium">Success</p>
              <p className="text-green-300 text-sm mt-1">{success}</p>
            </div>
          </div>
        )}

        {/* Mode Toggle Card */}
        <div className="bg-gradient-to-br from-slate-800/90 to-slate-900/90 backdrop-blur-xl rounded-2xl border border-white/10 p-8">
          <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-3">
            <Settings className="w-6 h-6" />
            Learning Mode
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Best Practice Mode */}
            <div
              className={`relative rounded-xl border-2 p-6 cursor-pointer transition-all ${
                config.mode === 'best_practice'
                  ? 'border-blue-500 bg-blue-500/10'
                  : 'border-slate-700 bg-slate-800/50 hover:border-slate-600'
              }`}
              onClick={() => !switching && handleSwitchMode('best_practice')}
            >
              <div className="flex items-start justify-between mb-4">
                <Lock className={`w-8 h-8 ${config.mode === 'best_practice' ? 'text-blue-400' : 'text-slate-500'}`} />
                {config.mode === 'best_practice' && (
                  <CheckCircle className="w-6 h-6 text-green-400" />
                )}
              </div>
              <h3 className="text-xl font-bold text-white mb-2">Best Practice Mode</h3>
              <p className="text-slate-400 text-sm mb-4">
                Uses industry-standard ranges. Recommended for launch and when you have limited data.
              </p>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <Database className="w-4 h-4" />
                <span>Hardcoded ranges from production systems</span>
              </div>
            </div>

            {/* Dynamic Mode */}
            <div
              className={`relative rounded-xl border-2 p-6 transition-all ${
                config.mode === 'dynamic'
                  ? 'border-green-500 bg-green-500/10 cursor-pointer'
                  : config.canSwitchToDynamic
                  ? 'border-slate-700 bg-slate-800/50 hover:border-slate-600 cursor-pointer'
                  : 'border-slate-800 bg-slate-900/50 cursor-not-allowed opacity-60'
              }`}
              onClick={() => !switching && config.canSwitchToDynamic && handleSwitchMode('dynamic')}
            >
              <div className="flex items-start justify-between mb-4">
                <Unlock className={`w-8 h-8 ${config.mode === 'dynamic' ? 'text-green-400' : 'text-slate-500'}`} />
                {config.mode === 'dynamic' && (
                  <CheckCircle className="w-6 h-6 text-green-400" />
                )}
              </div>
              <h3 className="text-xl font-bold text-white mb-2">Dynamic Mode</h3>
              <p className="text-slate-400 text-sm mb-4">
                Learns from your actual production data. Ranges automatically adjust based on 95th percentile.
              </p>
              {!config.canSwitchToDynamic && (
                <div className="flex items-center gap-2 text-xs text-yellow-500 bg-yellow-500/10 rounded px-2 py-1">
                  <AlertCircle className="w-4 h-4" />
                  <span>Need {config.minExecutionsRequired - config.statistics.totalExecutions} more executions</span>
                </div>
              )}
              {config.canSwitchToDynamic && (
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <TrendingUp className="w-4 h-4" />
                  <span>Auto-updates from real agent data</span>
                </div>
              )}
            </div>
          </div>

          {switching && (
            <div className="mt-6 flex items-center justify-center gap-2 text-blue-400">
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span>Switching mode...</span>
            </div>
          )}
        </div>

        {/* Statistics Card */}
        <div className="bg-gradient-to-br from-slate-800/90 to-slate-900/90 backdrop-blur-xl rounded-2xl border border-white/10 p-8">
          <h2 className="text-2xl font-bold text-white mb-6">Production Statistics</h2>

          {/* Single row with 4 cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4">
              <div className="text-blue-400 text-sm font-medium mb-2">Total Agents</div>
              <div className="text-3xl font-black text-white">{config.statistics.totalAgents}</div>
            </div>
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4">
              <div className="text-emerald-400 text-sm font-medium mb-2">Creation LLM Tokens</div>
              <div className="text-3xl font-black text-white">
                {((config.statistics.creationTokens || 0) / 1000).toFixed(0)}K
              </div>
            </div>
            <div className="bg-purple-500/10 border border-purple-500/20 rounded-xl p-4">
              <div className="text-purple-400 text-sm font-medium mb-2">Execution LLM Tokens</div>
              <div className="text-3xl font-black text-white">
                {((config.statistics.executionTokens || 0) / 1000).toFixed(0)}K
              </div>
            </div>
            <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-4">
              <div className="text-green-400 text-sm font-medium mb-2">Total Tokens</div>
              <div className="text-3xl font-black text-white">
                {((config.statistics.totalTokens || 0) / 1000000).toFixed(2)}M
              </div>
            </div>
          </div>
        </div>

        {/* Min Executions Required - Only show in Dynamic Mode */}
        {config.mode === 'dynamic' && (
          <div className="bg-gradient-to-br from-slate-800/90 to-slate-900/90 backdrop-blur-xl rounded-2xl border border-white/10 p-8">
            <div className="bg-orange-500/10 border border-orange-500/20 rounded-xl p-4">
              <div className="text-orange-400 text-sm font-medium mb-2 flex items-center justify-between">
                <span>Min Executions Required (Dynamic Mode)</span>
                <button
                  onClick={() => {
                    setEditingThreshold(true);
                    setNewThreshold(config.minExecutionsRequired);
                  }}
                  className="text-xs px-2 py-1 bg-orange-500/20 hover:bg-orange-500/30 rounded transition-colors"
                >
                  Edit
                </button>
              </div>
              <p className="text-xs text-slate-500 mb-2">
                Minimum agent executions required before switching to dynamic mode or recalculating dynamic ranges
              </p>
              {editingThreshold ? (
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    value={newThreshold}
                    onChange={(e) => setNewThreshold(parseInt(e.target.value))}
                    className="w-20 px-2 py-1 bg-slate-900 border border-orange-500/30 rounded text-white text-lg font-bold"
                  />
                  <button
                    onClick={handleUpdateThreshold}
                    disabled={switching}
                    className="text-sm px-2 py-1 bg-green-500 hover:bg-green-600 rounded disabled:opacity-50"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setEditingThreshold(false)}
                    className="text-sm px-2 py-1 bg-slate-700 hover:bg-slate-600 rounded"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="text-3xl font-black text-white">{config.minExecutionsRequired}</div>
              )}
            </div>
          </div>
        )}

        {/* System Limits Configuration */}
        <div className="bg-gradient-to-br from-slate-800/90 to-slate-900/90 backdrop-blur-xl rounded-2xl border border-white/10">
          <div className="p-6 border-b border-white/10">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold text-white flex items-center gap-3">
                  <Settings className="w-6 h-6 text-orange-400" />
                  System Limits
                </h2>
                <p className="text-slate-400 text-sm mt-1">
                  Set boundaries for agent complexity scores and execution requirements
                </p>
              </div>
              <button
                onClick={() => setLimitsExpanded(!limitsExpanded)}
                className="p-2 bg-slate-700/50 hover:bg-slate-600/50 rounded-lg transition-colors"
              >
                {limitsExpanded ? (
                  <ChevronUp className="w-4 h-4 text-slate-400" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-slate-400" />
                )}
              </button>
            </div>
          </div>

          {limitsExpanded && (
            <div className="p-6 space-y-6">
              {/* Error/Success Messages */}
              {limitsError && (
                <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-3 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                  <p className="text-red-400 text-sm">{limitsError}</p>
                </div>
              )}
              {limitsSuccess && (
                <div className="bg-green-500/10 border border-green-500/50 rounded-lg p-3 flex items-start gap-2">
                  <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0 mt-0.5" />
                  <p className="text-green-400 text-sm">{limitsSuccess}</p>
                </div>
              )}

              {/* Info Box */}
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <Settings className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                  <div className="space-y-2">
                    <p className="text-emerald-400 font-medium text-sm">🔒 System Protection: Single Source of Truth</p>
                    <p className="text-slate-300 text-sm leading-relaxed">
                      These limits control the boundaries of agent complexity scoring. The
                      <strong className="text-white"> min/max intensity</strong> values prevent scores from being too extreme (usually 0-10).
                    </p>
                    <div className="bg-blue-500/10 border border-blue-500/30 rounded p-3 mt-2">
                      <p className="text-blue-300 text-sm font-medium mb-1">✅ Min Executions For Score Controls Routing</p>
                      <p className="text-slate-300 text-xs leading-relaxed">
                        <strong className="text-emerald-400">Protection Enabled:</strong> Model routing now uses
                        <strong className="text-white"> min_executions_for_score</strong> as its threshold. This
                        <strong className="text-emerald-300"> guarantees</strong> routing only starts when combined_score has switched to the blended formula (30% creation + 70% execution).
                      </p>
                      <p className="text-slate-300 text-xs leading-relaxed mt-2">
                        <strong className="text-white">Before threshold:</strong> Agents use cheap model (GPT-4o-mini) conservatively.
                        <strong className="text-white"> After threshold:</strong> Routing uses accurate blended scores for optimal cost/performance.
                        No more misconfigurations possible!
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">
                    Minimum Agent Intensity
                  </label>
                  <input
                    type="number"
                    value={systemLimits.minAgentIntensity}
                    onChange={(e) => setSystemLimits({ ...systemLimits, minAgentIntensity: parseFloat(e.target.value) || 0 })}
                    min="0"
                    max="10"
                    step="0.1"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  <p className="text-xs text-slate-500">Lowest possible complexity score (0-10 scale). Prevents scores from going below this floor.</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">
                    Maximum Agent Intensity
                  </label>
                  <input
                    type="number"
                    value={systemLimits.maxAgentIntensity}
                    onChange={(e) => setSystemLimits({ ...systemLimits, maxAgentIntensity: parseFloat(e.target.value) || 0 })}
                    min="0"
                    max="100"
                    step="0.1"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  <p className="text-xs text-slate-500">Highest possible complexity score (0-10 scale). Caps extremely complex agents at this ceiling.</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300 flex items-center gap-2">
                    Min Executions For Score
                    <span className="text-emerald-400 text-xs font-normal">(Controls Routing)</span>
                  </label>
                  <input
                    type="number"
                    value={systemLimits.minExecutionsForScore}
                    onChange={(e) => setSystemLimits({ ...systemLimits, minExecutionsForScore: parseInt(e.target.value) || 0 })}
                    min="1"
                    max="100"
                    step="1"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  <p className="text-xs text-slate-500">
                    <strong className="text-emerald-400">🔒 Single Source of Truth:</strong> Controls both score blending AND routing threshold.
                    <strong className="text-white"> Before:</strong> 100% creation score, uses cheap model.
                    <strong className="text-white"> After:</strong> 30% creation + 70% execution, routes by complexity.
                    Recommended: 3 for dev, 5 for production.
                  </p>
                </div>
              </div>

              {/* Save Button */}
              <div className="flex justify-end pt-4 border-t border-white/10">
                <button
                  onClick={handleSaveSystemLimits}
                  disabled={savingLimits}
                  className="px-6 py-2.5 bg-orange-600 hover:bg-orange-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors flex items-center gap-2"
                >
                  {savingLimits ? (
                    <>
                      <RefreshCw className={`w-4 h-4 ${savingLimits ? 'animate-spin' : ''}`} />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4" />
                      Save System Limits
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* AIS Dimension Weights Configuration */}
        <div className="bg-gradient-to-br from-slate-800/90 to-slate-900/90 backdrop-blur-xl rounded-2xl border border-white/10">
          <div className="p-6 border-b border-white/10">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold text-white flex items-center gap-3">
                  <BarChart3 className="w-6 h-6 text-blue-400" />
                  AIS Dimension Weights
                </h2>
                <p className="text-slate-400 text-sm mt-1">
                  Control how much each factor (tokens, execution, plugins, workflow) influences an agent's complexity score. All weights must add up to 1.0.
                </p>
              </div>
              <button
                onClick={() => setWeightsExpanded(!weightsExpanded)}
                className="p-2 bg-slate-700/50 hover:bg-slate-600/50 rounded-lg transition-colors"
              >
                {weightsExpanded ? (
                  <ChevronUp className="w-4 h-4 text-slate-400" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-slate-400" />
                )}
              </button>
            </div>
          </div>

          {weightsExpanded && (
            <div className="p-6 space-y-6">
              {/* Error/Success Messages */}
              {weightsError && (
                <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-3 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                  <p className="text-red-400 text-sm">{weightsError}</p>
                </div>
              )}
              {weightsSuccess && (
                <div className="bg-green-500/10 border border-green-500/50 rounded-lg p-3 flex items-start gap-2">
                  <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0 mt-0.5" />
                  <p className="text-green-400 text-sm">{weightsSuccess}</p>
                </div>
              )}

              {/* Info Box */}
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <BarChart3 className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
                  <div className="space-y-2">
                    <p className="text-blue-400 font-medium text-sm">How Dimension Weights Work</p>
                    <p className="text-slate-300 text-sm leading-relaxed">
                      The Agent Intensity Score (0-10) determines which AI model routes each agent. Four main factors contribute to this score:
                      <strong className="text-white"> Tokens</strong> (AI usage),
                      <strong className="text-white"> Execution</strong> (runtime performance),
                      <strong className="text-white"> Plugins</strong> (integrations), and
                      <strong className="text-white"> Workflow</strong> (logic complexity).
                      Each factor has subdimensions that you can fine-tune below. Higher weights mean that factor has more influence on the final score.
                    </p>
                  </div>
                </div>
              </div>

              {/* Dimension Weights */}
              <div className="space-y-4">
                <div className="flex items-center justify-between pb-2 border-b border-white/10">
                  <h3 className="font-medium text-white flex items-center gap-2">
                    <Zap className="w-4 h-4 text-yellow-400" />
                    Main Dimension Weights (must sum to 1.0)
                  </h3>
                  <span className="text-xs text-slate-400">
                    Current sum: {(aisWeights.tokens + aisWeights.execution + aisWeights.plugins + aisWeights.workflow).toFixed(3)}
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-300">Tokens</label>
                    <input
                      type="number"
                      value={aisWeights.tokens}
                      onChange={(e) => setAisWeights({ ...aisWeights, tokens: parseFloat(e.target.value) || 0 })}
                      min="0"
                      max="1"
                      step="0.05"
                      className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                    />
                    <p className="text-xs text-slate-500">AI model usage weight. Higher = token consumption matters more in complexity score.</p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-300">Execution</label>
                    <input
                      type="number"
                      value={aisWeights.execution}
                      onChange={(e) => setAisWeights({ ...aisWeights, execution: parseFloat(e.target.value) || 0 })}
                      min="0"
                      max="1"
                      step="0.05"
                      className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                    />
                    <p className="text-xs text-slate-500">Runtime performance weight. Higher = iterations/duration matter more.</p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-300">Plugins</label>
                    <input
                      type="number"
                      value={aisWeights.plugins}
                      onChange={(e) => setAisWeights({ ...aisWeights, plugins: parseFloat(e.target.value) || 0 })}
                      min="0"
                      max="1"
                      step="0.05"
                      className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                    />
                    <p className="text-xs text-slate-500">Integration weight. Higher = plugin count/usage impacts score more.</p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-300">Workflow</label>
                    <input
                      type="number"
                      value={aisWeights.workflow}
                      onChange={(e) => setAisWeights({ ...aisWeights, workflow: parseFloat(e.target.value) || 0 })}
                      min="0"
                      max="1"
                      step="0.05"
                      className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                    />
                    <p className="text-xs text-slate-500">Logic complexity weight. Higher = branches/loops matter more in score.</p>
                  </div>
                </div>
              </div>

              {/* Token Subdimensions */}
              <div className="space-y-4">
                <div className="flex items-center justify-between pb-2 border-b border-white/10">
                  <div className="flex-1">
                    <h3 className="font-medium text-white flex items-center gap-2">
                      <Zap className="w-4 h-4 text-blue-400" />
                      Token Subdimension Weights (must sum to 1.0)
                    </h3>
                    <p className="text-xs text-slate-500 mt-1">Fine-tune how token usage is measured: average consumption vs peak spikes vs input/output ratio.</p>
                  </div>
                  <span className="text-xs text-slate-400">
                    Current sum: {(aisWeights.token_volume + aisWeights.token_peak + aisWeights.token_io).toFixed(3)}
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-300">Volume</label>
                    <input
                      type="number"
                      value={aisWeights.token_volume}
                      onChange={(e) => setAisWeights({ ...aisWeights, token_volume: parseFloat(e.target.value) || 0 })}
                      min="0"
                      max="1"
                      step="0.05"
                      className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                    />
                    <p className="text-xs text-slate-500">Average token usage per run.</p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-300">Peak</label>
                    <input
                      type="number"
                      value={aisWeights.token_peak}
                      onChange={(e) => setAisWeights({ ...aisWeights, token_peak: parseFloat(e.target.value) || 0 })}
                      min="0"
                      max="1"
                      step="0.05"
                      className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                    />
                    <p className="text-xs text-slate-500">Maximum burst usage (spikes).</p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-300">I/O Ratio</label>
                    <input
                      type="number"
                      value={aisWeights.token_io}
                      onChange={(e) => setAisWeights({ ...aisWeights, token_io: parseFloat(e.target.value) || 0 })}
                      min="0"
                      max="1"
                      step="0.05"
                      className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                    />
                    <p className="text-xs text-slate-500">Output vs input token ratio.</p>
                  </div>
                </div>
              </div>

              {/* Execution Subdimensions */}
              <div className="space-y-4">
                <div className="flex items-center justify-between pb-2 border-b border-white/10">
                  <div className="flex-1">
                    <h3 className="font-medium text-white flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-purple-400" />
                      Execution Subdimension Weights (must sum to 1.0)
                    </h3>
                    <p className="text-xs text-slate-500 mt-1">Balance runtime factors: loop count vs total time vs failure/retry rates.</p>
                  </div>
                  <span className="text-xs text-slate-400">
                    Current sum: {(aisWeights.execution_iterations + aisWeights.execution_duration + aisWeights.execution_failure + aisWeights.execution_retry).toFixed(3)}
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-300">Iterations</label>
                    <input
                      type="number"
                      value={aisWeights.execution_iterations}
                      onChange={(e) => setAisWeights({ ...aisWeights, execution_iterations: parseFloat(e.target.value) || 0 })}
                      min="0"
                      max="1"
                      step="0.05"
                      className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                    />
                    <p className="text-xs text-slate-500">How many loops/cycles the agent runs.</p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-300">Duration</label>
                    <input
                      type="number"
                      value={aisWeights.execution_duration}
                      onChange={(e) => setAisWeights({ ...aisWeights, execution_duration: parseFloat(e.target.value) || 0 })}
                      min="0"
                      max="1"
                      step="0.05"
                      className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                    />
                    <p className="text-xs text-slate-500">Total runtime in milliseconds.</p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-300">Failure Rate</label>
                    <input
                      type="number"
                      value={aisWeights.execution_failure}
                      onChange={(e) => setAisWeights({ ...aisWeights, execution_failure: parseFloat(e.target.value) || 0 })}
                      min="0"
                      max="1"
                      step="0.05"
                      className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                    />
                    <p className="text-xs text-slate-500">Percentage of runs that fail.</p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-300">Retry Rate</label>
                    <input
                      type="number"
                      value={aisWeights.execution_retry}
                      onChange={(e) => setAisWeights({ ...aisWeights, execution_retry: parseFloat(e.target.value) || 0 })}
                      min="0"
                      max="1"
                      step="0.05"
                      className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                    />
                    <p className="text-xs text-slate-500">How often retries are needed.</p>
                  </div>
                </div>
              </div>

              {/* Plugin Subdimensions */}
              <div className="space-y-4">
                <div className="flex items-center justify-between pb-2 border-b border-white/10">
                  <div className="flex-1">
                    <h3 className="font-medium text-white flex items-center gap-2">
                      <Database className="w-4 h-4 text-green-400" />
                      Plugin Subdimension Weights (must sum to 1.0)
                    </h3>
                    <p className="text-xs text-slate-500 mt-1">Adjust plugin impact: total number vs actual usage vs coordination overhead.</p>
                  </div>
                  <span className="text-xs text-slate-400">
                    Current sum: {(aisWeights.plugin_count + aisWeights.plugin_usage + aisWeights.plugin_overhead).toFixed(3)}
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-300">Count</label>
                    <input
                      type="number"
                      value={aisWeights.plugin_count}
                      onChange={(e) => setAisWeights({ ...aisWeights, plugin_count: parseFloat(e.target.value) || 0 })}
                      min="0"
                      max="1"
                      step="0.05"
                      className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                    />
                    <p className="text-xs text-slate-500">Number of unique plugins connected.</p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-300">Usage</label>
                    <input
                      type="number"
                      value={aisWeights.plugin_usage}
                      onChange={(e) => setAisWeights({ ...aisWeights, plugin_usage: parseFloat(e.target.value) || 0 })}
                      min="0"
                      max="1"
                      step="0.05"
                      className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                    />
                    <p className="text-xs text-slate-500">How actively plugins are called.</p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-300">Overhead</label>
                    <input
                      type="number"
                      value={aisWeights.plugin_overhead}
                      onChange={(e) => setAisWeights({ ...aisWeights, plugin_overhead: parseFloat(e.target.value) || 0 })}
                      min="0"
                      max="1"
                      step="0.05"
                      className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                    />
                    <p className="text-xs text-slate-500">Coordination time between plugins.</p>
                  </div>
                </div>
              </div>

              {/* Workflow Subdimensions */}
              <div className="space-y-4">
                <div className="flex items-center justify-between pb-2 border-b border-white/10">
                  <div className="flex-1">
                    <h3 className="font-medium text-white flex items-center gap-2">
                      <BarChart3 className="w-4 h-4 text-orange-400" />
                      Workflow Subdimension Weights (must sum to 1.0)
                    </h3>
                    <p className="text-xs text-slate-500 mt-1">Control workflow complexity factors: sequential steps vs decision branches vs loops vs parallel tasks.</p>
                  </div>
                  <span className="text-xs text-slate-400">
                    Current sum: {(aisWeights.workflow_steps + aisWeights.workflow_branches + aisWeights.workflow_loops + aisWeights.workflow_parallel).toFixed(3)}
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-300">Steps</label>
                    <input
                      type="number"
                      value={aisWeights.workflow_steps}
                      onChange={(e) => setAisWeights({ ...aisWeights, workflow_steps: parseFloat(e.target.value) || 0 })}
                      min="0"
                      max="1"
                      step="0.05"
                      className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                    />
                    <p className="text-xs text-slate-500">Total sequential actions in workflow.</p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-300">Branches</label>
                    <input
                      type="number"
                      value={aisWeights.workflow_branches}
                      onChange={(e) => setAisWeights({ ...aisWeights, workflow_branches: parseFloat(e.target.value) || 0 })}
                      min="0"
                      max="1"
                      step="0.05"
                      className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                    />
                    <p className="text-xs text-slate-500">If/else conditional decision points.</p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-300">Loops</label>
                    <input
                      type="number"
                      value={aisWeights.workflow_loops}
                      onChange={(e) => setAisWeights({ ...aisWeights, workflow_loops: parseFloat(e.target.value) || 0 })}
                      min="0"
                      max="1"
                      step="0.05"
                      className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                    />
                    <p className="text-xs text-slate-500">Repeated cycles within workflow.</p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-300">Parallel</label>
                    <input
                      type="number"
                      value={aisWeights.workflow_parallel}
                      onChange={(e) => setAisWeights({ ...aisWeights, workflow_parallel: parseFloat(e.target.value) || 0 })}
                      min="0"
                      max="1"
                      step="0.05"
                      className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                    />
                    <p className="text-xs text-slate-500">Concurrent actions running simultaneously.</p>
                  </div>
                </div>
              </div>

              {/* Save Button */}
              <div className="flex justify-end pt-4 border-t border-white/10">
                <button
                  onClick={handleSaveAISWeights}
                  disabled={savingWeights}
                  className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors flex items-center gap-2"
                >
                  {savingWeights ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4" />
                      Save AIS Weights
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Ranges Display - Organized by Phase */}

        {/* Creation Phase Section */}
        <div className="bg-gradient-to-br from-slate-800/90 to-slate-900/90 backdrop-blur-xl rounded-2xl border border-white/10 overflow-hidden">
          <div className="bg-gradient-to-r from-emerald-500/10 to-green-500/10 border-b border-white/10 p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center text-white shadow-lg">
                  <Zap className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-white">Agent Creation Ranges</h2>
                  <p className="text-slate-400 text-sm mt-1">
                    Scoring boundaries for agents at creation time. These ranges normalize design complexity before the agent has run.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setCreationRangesExpanded(!creationRangesExpanded)}
                className="p-2 bg-slate-700/50 hover:bg-slate-600/50 rounded-lg transition-colors"
              >
                {creationRangesExpanded ? (
                  <ChevronUp className="w-5 h-5 text-slate-400" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-slate-400" />
                )}
              </button>
            </div>
          </div>

          {creationRangesExpanded && (
            <div className="p-6 space-y-6">
              {/* Info Box */}
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <Zap className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                  <div className="space-y-2">
                    <p className="text-emerald-400 font-medium text-sm">About Creation Ranges</p>
                    <p className="text-slate-300 text-sm leading-relaxed">
                      Creation ranges normalize agent complexity scores based on design characteristics (before any execution).
                      <strong className="text-white"> Best Practice</strong> ranges are manually defined based on industry standards.
                      <strong className="text-white"> Dynamic</strong> ranges are learned from your actual agent data and automatically adjust as more agents are created.
                      These ranges ensure fair scoring by converting raw metrics (like plugin count) into standardized 0-10 scores.
                    </p>
                  </div>
                </div>
              </div>

            {config.ranges?.creation && config.ranges.creation.map((range) => (
              <div key={range.id} className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 hover:border-emerald-500/30 transition-colors">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="text-white font-semibold">{formatRangeLabel(range.range_key)}</h3>
                    <p className="text-slate-400 text-sm mt-1">{range.description}</p>
                  </div>
                  {range.data_points_analyzed > 0 && (
                    <div className="text-xs text-slate-500">
                      {range.data_points_analyzed} data points
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-blue-500/5 border border-blue-500/20 rounded p-3">
                    <div className="text-xs text-blue-400 font-medium mb-2">Best Practice</div>
                    <div className="flex items-center gap-2">
                      <span className="text-white font-mono">
                        {range.best_practice_min} - {range.best_practice_max}
                      </span>
                      {config.mode === 'best_practice' && (
                        <span className="text-xs text-green-400">(Active)</span>
                      )}
                    </div>
                  </div>

                  <div className="bg-green-500/5 border border-green-500/20 rounded p-3">
                    <div className="text-xs text-green-400 font-medium mb-2">Dynamic (Learned)</div>
                    <div className="flex items-center gap-2">
                      {range.dynamic_min !== null && range.dynamic_max !== null ? (
                        <>
                          <span className="text-white font-mono">
                            {range.dynamic_min} - {range.dynamic_max}
                          </span>
                          {config.mode === 'dynamic' && (
                            <span className="text-xs text-green-400">(Active)</span>
                          )}
                        </>
                      ) : (
                        <span className="text-slate-500 text-sm">Not calculated yet</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          )}
        </div>

        {/* Execution Phase Section */}
        <div className="bg-gradient-to-br from-slate-800/90 to-slate-900/90 backdrop-blur-xl rounded-2xl border border-white/10 overflow-hidden">
          <div className="bg-gradient-to-r from-purple-500/10 to-blue-500/10 border-b border-white/10 p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center text-white shadow-lg">
                  <TrendingUp className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-white">Agent Execution Ranges</h2>
                  <p className="text-slate-400 text-sm mt-1">
                    Scoring boundaries for agents during runtime. These ranges normalize performance metrics after agents have executed.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setExecutionRangesExpanded(!executionRangesExpanded)}
                className="p-2 bg-slate-700/50 hover:bg-slate-600/50 rounded-lg transition-colors"
              >
                {executionRangesExpanded ? (
                  <ChevronUp className="w-5 h-5 text-slate-400" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-slate-400" />
                )}
              </button>
            </div>
          </div>

          {executionRangesExpanded && (
            <div className="p-6 space-y-6">
              {/* Info Box */}
              <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <TrendingUp className="w-5 h-5 text-purple-400 flex-shrink-0 mt-0.5" />
                  <div className="space-y-2">
                    <p className="text-purple-400 font-medium text-sm">About Execution Ranges</p>
                    <p className="text-slate-300 text-sm leading-relaxed">
                      Execution ranges normalize agent complexity based on actual runtime behavior (after agents have run).
                      These cover four categories:
                      <strong className="text-white"> Token Complexity</strong> (AI model usage),
                      <strong className="text-white"> Execution Complexity</strong> (loops/duration),
                      <strong className="text-white"> Plugin Complexity</strong> (integration usage), and
                      <strong className="text-white"> Workflow Complexity</strong> (logic patterns).
                      <strong className="text-white"> Best Practice</strong> ranges are industry standards while
                      <strong className="text-white"> Dynamic</strong> ranges learn from your production data.
                    </p>
                  </div>
                </div>
              </div>

            {/* Token Complexity */}
            {config.ranges?.token_complexity && (
              <div>
                <div className="mb-3">
                  <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                    <Zap className="w-5 h-5 text-blue-400" />
                    Token Complexity
                  </h3>
                  <p className="text-xs text-slate-400 mt-1 ml-7">Measures AI model usage: average tokens, peak bursts, and input/output ratios during execution.</p>
                </div>
                <div className="space-y-4">
                  {config.ranges.token_complexity.map((range) => (
                    <div key={range.id} className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 hover:border-blue-500/30 transition-colors">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <h4 className="text-white font-semibold">{formatRangeLabel(range.range_key)}</h4>
                          <p className="text-slate-400 text-sm mt-1">{range.description}</p>
                        </div>
                        {range.data_points_analyzed > 0 && (
                          <div className="text-xs text-slate-500">
                            {range.data_points_analyzed} data points
                          </div>
                        )}
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="bg-blue-500/5 border border-blue-500/20 rounded p-3">
                          <div className="text-xs text-blue-400 font-medium mb-2">Best Practice</div>
                          <div className="flex items-center gap-2">
                            <span className="text-white font-mono">
                              {range.best_practice_min} - {range.best_practice_max}
                            </span>
                            {config.mode === 'best_practice' && (
                              <span className="text-xs text-green-400">(Active)</span>
                            )}
                          </div>
                        </div>

                        <div className="bg-green-500/5 border border-green-500/20 rounded p-3">
                          <div className="text-xs text-green-400 font-medium mb-2">Dynamic (Learned)</div>
                          <div className="flex items-center gap-2">
                            {range.dynamic_min !== null && range.dynamic_max !== null ? (
                              <>
                                <span className="text-white font-mono">
                                  {range.dynamic_min} - {range.dynamic_max}
                                </span>
                                {config.mode === 'dynamic' && (
                                  <span className="text-xs text-green-400">(Active)</span>
                                )}
                              </>
                            ) : (
                              <span className="text-slate-500 text-sm">Not calculated yet</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Execution Complexity */}
            {config.ranges?.execution_complexity && (
              <div>
                <div className="mb-3">
                  <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-purple-400" />
                    Execution Complexity
                  </h3>
                  <p className="text-xs text-slate-400 mt-1 ml-7">Tracks runtime performance: iteration counts, execution duration, failure rates, and retry patterns.</p>
                </div>
                <div className="space-y-4">
                  {config.ranges.execution_complexity.map((range) => (
                    <div key={range.id} className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 hover:border-purple-500/30 transition-colors">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <h4 className="text-white font-semibold">{formatRangeLabel(range.range_key)}</h4>
                          <p className="text-slate-400 text-sm mt-1">{range.description}</p>
                        </div>
                        {range.data_points_analyzed > 0 && (
                          <div className="text-xs text-slate-500">
                            {range.data_points_analyzed} data points
                          </div>
                        )}
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="bg-blue-500/5 border border-blue-500/20 rounded p-3">
                          <div className="text-xs text-blue-400 font-medium mb-2">Best Practice</div>
                          <div className="flex items-center gap-2">
                            <span className="text-white font-mono">
                              {range.best_practice_min} - {range.best_practice_max}
                            </span>
                            {config.mode === 'best_practice' && (
                              <span className="text-xs text-green-400">(Active)</span>
                            )}
                          </div>
                        </div>

                        <div className="bg-green-500/5 border border-green-500/20 rounded p-3">
                          <div className="text-xs text-green-400 font-medium mb-2">Dynamic (Learned)</div>
                          <div className="flex items-center gap-2">
                            {range.dynamic_min !== null && range.dynamic_max !== null ? (
                              <>
                                <span className="text-white font-mono">
                                  {range.dynamic_min} - {range.dynamic_max}
                                </span>
                                {config.mode === 'dynamic' && (
                                  <span className="text-xs text-green-400">(Active)</span>
                                )}
                              </>
                            ) : (
                              <span className="text-slate-500 text-sm">Not calculated yet</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Plugin Complexity */}
            {config.ranges?.plugin_complexity && (
              <div>
                <div className="mb-3">
                  <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                    <Database className="w-5 h-5 text-green-400" />
                    Plugin Complexity
                  </h3>
                  <p className="text-xs text-slate-400 mt-1 ml-7">Evaluates integration usage: how many plugins are active, usage frequency, and coordination overhead.</p>
                </div>
                <div className="space-y-4">
                  {config.ranges.plugin_complexity.map((range) => (
                    <div key={range.id} className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 hover:border-green-500/30 transition-colors">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <h4 className="text-white font-semibold">{formatRangeLabel(range.range_key)}</h4>
                          <p className="text-slate-400 text-sm mt-1">{range.description}</p>
                        </div>
                        {range.data_points_analyzed > 0 && (
                          <div className="text-xs text-slate-500">
                            {range.data_points_analyzed} data points
                          </div>
                        )}
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="bg-blue-500/5 border border-blue-500/20 rounded p-3">
                          <div className="text-xs text-blue-400 font-medium mb-2">Best Practice</div>
                          <div className="flex items-center gap-2">
                            <span className="text-white font-mono">
                              {range.best_practice_min} - {range.best_practice_max}
                            </span>
                            {config.mode === 'best_practice' && (
                              <span className="text-xs text-green-400">(Active)</span>
                            )}
                          </div>
                        </div>

                        <div className="bg-green-500/5 border border-green-500/20 rounded p-3">
                          <div className="text-xs text-green-400 font-medium mb-2">Dynamic (Learned)</div>
                          <div className="flex items-center gap-2">
                            {range.dynamic_min !== null && range.dynamic_max !== null ? (
                              <>
                                <span className="text-white font-mono">
                                  {range.dynamic_min} - {range.dynamic_max}
                                </span>
                                {config.mode === 'dynamic' && (
                                  <span className="text-xs text-green-400">(Active)</span>
                                )}
                              </>
                            ) : (
                              <span className="text-slate-500 text-sm">Not calculated yet</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Workflow Complexity */}
            {config.ranges?.workflow_complexity && (
              <div>
                <div className="mb-3">
                  <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                    <BarChart3 className="w-5 h-5 text-orange-400" />
                    Workflow Complexity
                  </h3>
                  <p className="text-xs text-slate-400 mt-1 ml-7">Analyzes logic patterns: sequential steps, conditional branches, loops, and parallel task execution.</p>
                </div>
                <div className="space-y-4">
                  {config.ranges.workflow_complexity.map((range) => (
                    <div key={range.id} className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 hover:border-orange-500/30 transition-colors">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <h4 className="text-white font-semibold">{formatRangeLabel(range.range_key)}</h4>
                          <p className="text-slate-400 text-sm mt-1">{range.description}</p>
                        </div>
                        {range.data_points_analyzed > 0 && (
                          <div className="text-xs text-slate-500">
                            {range.data_points_analyzed} data points
                          </div>
                        )}
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="bg-blue-500/5 border border-blue-500/20 rounded p-3">
                          <div className="text-xs text-blue-400 font-medium mb-2">Best Practice</div>
                          <div className="flex items-center gap-2">
                            <span className="text-white font-mono">
                              {range.best_practice_min} - {range.best_practice_max}
                            </span>
                            {config.mode === 'best_practice' && (
                              <span className="text-xs text-green-400">(Active)</span>
                            )}
                          </div>
                        </div>

                        <div className="bg-green-500/5 border border-green-500/20 rounded p-3">
                          <div className="text-xs text-green-400 font-medium mb-2">Dynamic (Learned)</div>
                          <div className="flex items-center gap-2">
                            {range.dynamic_min !== null && range.dynamic_max !== null ? (
                              <>
                                <span className="text-white font-mono">
                                  {range.dynamic_min} - {range.dynamic_max}
                                </span>
                                {config.mode === 'dynamic' && (
                                  <span className="text-xs text-green-400">(Active)</span>
                                )}
                              </>
                            ) : (
                              <span className="text-slate-500 text-sm">Not calculated yet</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          )}
        </div>

        {/* Old ranges display for any uncategorized items */}
        {Object.entries(config.ranges).filter(([category]) =>
          !['creation', 'token_complexity', 'execution_complexity', 'plugin_complexity', 'workflow_complexity'].includes(category)
        ).map(([category, ranges]) => (
          <div
            key={category}
            className="bg-gradient-to-br from-slate-800/90 to-slate-900/90 backdrop-blur-xl rounded-2xl border border-white/10 p-8"
          >
            <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${getCategoryColor(category)} flex items-center justify-center text-white`}>
                {getCategoryIcon(category)}
              </div>
              {category === null ? 'Other Metrics' : category.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
            </h2>

            <div className="space-y-4">
              {ranges.map((range) => (
                <div
                  key={range.id}
                  className="bg-slate-800/50 border border-slate-700 rounded-lg p-4"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="text-white font-semibold">{formatRangeLabel(range.range_key)}</h3>
                      <p className="text-slate-400 text-sm mt-1">{range.description}</p>
                    </div>
                    {range.data_points_analyzed > 0 && (
                      <div className="text-xs text-slate-500">
                        {range.data_points_analyzed} data points
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Best Practice Range */}
                    <div className="bg-blue-500/5 border border-blue-500/20 rounded p-3">
                      <div className="text-xs text-blue-400 font-medium mb-2">Best Practice</div>
                      <div className="flex items-center gap-2">
                        <span className="text-white font-mono">
                          {range.best_practice_min} - {range.best_practice_max}
                        </span>
                        {config.mode === 'best_practice' && (
                          <span className="text-xs text-green-400">(Active)</span>
                        )}
                      </div>
                    </div>

                    {/* Dynamic Range */}
                    <div className="bg-green-500/5 border border-green-500/20 rounded p-3">
                      <div className="text-xs text-green-400 font-medium mb-2">Dynamic (Learned)</div>
                      <div className="flex items-center gap-2">
                        {range.dynamic_min !== null && range.dynamic_max !== null ? (
                          <>
                            <span className="text-white font-mono">
                              {range.dynamic_min} - {range.dynamic_max}
                            </span>
                            {config.mode === 'dynamic' && (
                              <span className="text-xs text-green-400">(Active)</span>
                            )}
                          </>
                        ) : (
                          <span className="text-slate-500 text-sm">Not calculated yet</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
