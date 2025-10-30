'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/components/UserProvider';
import {
  Settings, Zap, TrendingUp, Database, CheckCircle,
  AlertCircle, RefreshCw, BarChart3, Lock, Unlock
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

        {/* Min Executions Required - Separate Card */}
        <div className="bg-gradient-to-br from-slate-800/90 to-slate-900/90 backdrop-blur-xl rounded-2xl border border-white/10 p-8">
          <div className="bg-orange-500/10 border border-orange-500/20 rounded-xl p-4">
            <div className="text-orange-400 text-sm font-medium mb-2 flex items-center justify-between">
              <span>Min Executions Required</span>
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

        {/* Ranges Display */}
        {Object.entries(config.ranges).map(([category, ranges]) => (
          <div
            key={category}
            className="bg-gradient-to-br from-slate-800/90 to-slate-900/90 backdrop-blur-xl rounded-2xl border border-white/10 p-8"
          >
            <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${getCategoryColor(category)} flex items-center justify-center text-white`}>
                {getCategoryIcon(category)}
              </div>
              {category.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
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
