'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/components/UserProvider';
import {
  Settings, Zap, TrendingUp, Database, CheckCircle,
  AlertCircle, RefreshCw, BarChart3, Lock, Unlock, ChevronUp, ChevronDown, Save, Brain
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
    tokens: 0.30,
    execution: 0.25,
    plugins: 0.20,
    workflow: 0.15,
    memory: 0.10,
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
    workflow_parallel: 0.15,
    // Memory subdimensions (must sum to 1.0)
    memory_ratio: 0.5,
    memory_diversity: 0.3,
    memory_volume: 0.2
  });

  // Combined Score Weights state
  const [combinedWeightsExpanded, setCombinedWeightsExpanded] = useState(false);
  const [savingCombinedWeights, setSavingCombinedWeights] = useState(false);
  const [combinedWeightsError, setCombinedWeightsError] = useState<string | null>(null);
  const [combinedWeightsSuccess, setCombinedWeightsSuccess] = useState<string | null>(null);
  const [combinedWeights, setCombinedWeights] = useState({
    creation: 0.3,
    execution: 0.7
  });

  // Creation Component Weights state (Phase 5)
  const [creationWeightsExpanded, setCreationWeightsExpanded] = useState(false);
  const [savingCreationWeights, setSavingCreationWeights] = useState(false);
  const [creationWeightsError, setCreationWeightsError] = useState<string | null>(null);
  const [creationWeightsSuccess, setCreationWeightsSuccess] = useState<string | null>(null);
  const [creationComponentWeights, setCreationComponentWeights] = useState({
    workflow: 0.5,
    plugins: 0.3,
    io_schema: 0.2
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
            tokens: w.tokens || 0.30,
            execution: w.execution || 0.25,
            plugins: w.plugins || 0.20,
            workflow: w.workflow || 0.15,
            memory: w.memory || 0.10,
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
            workflow_parallel: w.workflow_parallel || 0.15,
            memory_ratio: w.memory_ratio || 0.5,
            memory_diversity: w.memory_diversity || 0.3,
            memory_volume: w.memory_volume || 0.2
          });
        }

        // Load Creation Component Weights (Phase 5)
        if (data.config.creationWeights) {
          console.log('🔄 [Frontend] Updating creationComponentWeights state');
          const cw = data.config.creationWeights;
          setCreationComponentWeights({
            workflow: cw.workflow || 0.5,
            plugins: cw.plugins || 0.3,
            io_schema: cw.io_schema || 0.2
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
      const dimensionSum = aisWeights.tokens + aisWeights.execution + aisWeights.plugins + aisWeights.workflow + aisWeights.memory;
      if (Math.abs(dimensionSum - 1.0) > 0.001) {
        setWeightsError(`Dimension weights must sum to 1.0 (currently ${dimensionSum.toFixed(3)})`);
        setSavingWeights(false);
        return;
      }

      // Validate subdimension weights sum to 1.0
      const executionSum = aisWeights.execution_iterations + aisWeights.execution_duration +
                          aisWeights.execution_failure + aisWeights.execution_retry;
      const pluginSum = aisWeights.plugin_count + aisWeights.plugin_usage + aisWeights.plugin_overhead;
      const workflowSum = aisWeights.workflow_steps + aisWeights.workflow_branches +
                         aisWeights.workflow_loops + aisWeights.workflow_parallel;
      const memorySum = aisWeights.memory_ratio + aisWeights.memory_diversity + aisWeights.memory_volume;

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
      if (Math.abs(memorySum - 1.0) > 0.001) {
        setWeightsError(`Memory subdimension weights must sum to 1.0 (currently ${memorySum.toFixed(3)})`);
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

  const handleSaveCombinedWeights = async () => {
    try {
      console.log('🔧 [Frontend] Starting combined weights save...');
      console.log('🔧 [Frontend] Current combinedWeights state:', combinedWeights);

      setSavingCombinedWeights(true);
      setCombinedWeightsError(null);
      setCombinedWeightsSuccess(null);

      // Validate combined weights sum to 1.0
      const combinedSum = combinedWeights.creation + combinedWeights.execution;
      if (Math.abs(combinedSum - 1.0) > 0.001) {
        setCombinedWeightsError(`Combined weights must sum to 1.0 (currently ${combinedSum.toFixed(3)})`);
        setSavingCombinedWeights(false);
        return;
      }

      const payload = {
        weights: {
          creation: combinedWeights.creation,
          execution_blend: combinedWeights.execution
        }
      };
      console.log('🔧 [Frontend] Request payload:', JSON.stringify(payload, null, 2));

      const response = await fetch('/api/admin/ais-weights/combined', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      console.log('🔧 [Frontend] Response status:', response.status);
      const data = await response.json();
      console.log('🔧 [Frontend] Response data:', data);

      if (data.success) {
        setCombinedWeightsSuccess('✅ Combined score weights updated successfully!');
        await fetchConfig();

        // Keep the card expanded so user can see the updated values
        setCombinedWeightsExpanded(true);

        setTimeout(() => setCombinedWeightsSuccess(null), 5000);
      } else {
        setCombinedWeightsError(data.error || 'Failed to update combined weights');
      }
    } catch (err) {
      setCombinedWeightsError('Failed to update combined weights');
      console.error(err);
    } finally {
      setSavingCombinedWeights(false);
    }
  };

  const handleSaveCreationWeights = async () => {
    try {
      console.log('🔧 [Frontend] Starting creation component weights save...');
      console.log('🔧 [Frontend] Current creationComponentWeights state:', creationComponentWeights);

      setSavingCreationWeights(true);
      setCreationWeightsError(null);
      setCreationWeightsSuccess(null);

      // Validate creation component weights sum to 1.0
      const creationSum = creationComponentWeights.workflow + creationComponentWeights.plugins + creationComponentWeights.io_schema;
      if (Math.abs(creationSum - 1.0) > 0.001) {
        setCreationWeightsError(`Creation component weights must sum to 1.0 (currently ${creationSum.toFixed(3)})`);
        setSavingCreationWeights(false);
        return;
      }

      const payload = {
        weights: {
          workflow: creationComponentWeights.workflow,
          plugins: creationComponentWeights.plugins,
          io_schema: creationComponentWeights.io_schema
        }
      };
      console.log('🔧 [Frontend] Request payload:', JSON.stringify(payload, null, 2));

      const response = await fetch('/api/admin/ais-weights/creation', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      console.log('🔧 [Frontend] Response status:', response.status);
      const data = await response.json();
      console.log('🔧 [Frontend] Response data:', data);

      if (data.success) {
        setCreationWeightsSuccess('✅ Creation component weights updated successfully!');
        await fetchConfig();
        setCreationWeightsExpanded(true);
        setTimeout(() => setCreationWeightsSuccess(null), 5000);
      } else {
        setCreationWeightsError(data.error || 'Failed to update creation component weights');
      }
    } catch (err) {
      setCreationWeightsError('Failed to update creation component weights');
      console.error(err);
    } finally {
      setSavingCreationWeights(false);
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
      case 'memory_complexity': return <Brain className="w-5 h-5" />;
      default: return <Settings className="w-5 h-5" />;
    }
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'token_complexity': return 'from-blue-500 to-blue-600';
      case 'execution_complexity': return 'from-purple-500 to-purple-600';
      case 'plugin_complexity': return 'from-green-500 to-green-600';
      case 'workflow_complexity': return 'from-orange-500 to-orange-600';
      case 'memory_complexity': return 'from-pink-500 to-rose-600';
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
      'parallel': 'Parallel Executions',
      'memory_ratio': 'Memory Token Ratio',
      'memory_diversity': 'Memory Type Diversity',
      'memory_volume': 'Memory Entry Count'
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
                  <div className="space-y-3">
                    <div>
                      <p className="text-emerald-400 font-medium text-sm mb-1">System Limits Configuration</p>
                      <p className="text-slate-300 text-sm leading-relaxed">
                        These three parameters control the Agent Intensity System scoring boundaries and routing behavior. They act as guardrails to ensure consistent, reliable agent performance across your entire platform.
                      </p>
                    </div>
                    <div className="grid grid-cols-1 gap-3">
                      <div className="bg-slate-700/30 rounded-lg p-3">
                        <div className="flex items-center gap-2 mb-1">
                          <BarChart3 className="w-4 h-4 text-slate-400" />
                          <p className="text-white text-sm font-medium">Min/Max Intensity</p>
                        </div>
                        <p className="text-slate-300 text-xs leading-relaxed">
                          Define the scoring range (typically 0-10). Agents below the minimum get capped at the floor. Agents above the maximum get capped at the ceiling. This prevents outlier scores from breaking model routing logic.
                        </p>
                      </div>
                      <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
                        <div className="flex items-center gap-2 mb-1">
                          <TrendingUp className="w-4 h-4 text-blue-400" />
                          <p className="text-blue-300 text-sm font-medium">Min Executions For Score (Critical)</p>
                        </div>
                        <p className="text-slate-300 text-xs leading-relaxed mb-2">
                          <strong className="text-white">This is the most important setting.</strong> It determines how many times an agent must run before its score becomes "trusted" for model routing decisions.
                        </p>
                        <ul className="text-slate-300 text-xs space-y-1 ml-4">
                          <li>• <strong className="text-emerald-300">Before threshold:</strong> Score = 100% creation analysis only. System uses cheap models (gpt-4o-mini) conservatively.</li>
                          <li>• <strong className="text-emerald-300">After threshold:</strong> Score = blended formula (30% creation + 70% execution data). System routes to optimal model tier based on actual complexity.</li>
                        </ul>
                        <div className="flex items-start gap-2 mt-2">
                          <AlertCircle className="w-3 h-3 text-yellow-400 flex-shrink-0 mt-0.5" />
                          <p className="text-slate-300 text-xs leading-relaxed">
                            <strong className="text-yellow-300">Recommendation:</strong> Set to 5-10 executions. Lower values switch to execution-based routing sooner (more aggressive). Higher values require more data before trusting the score (more conservative).
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300 flex items-center gap-2">
                    Minimum Agent Intensity
                    <span className="text-slate-400 text-xs font-normal">(Floor)</span>
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
                  <p className="text-xs text-slate-500 leading-relaxed">
                    <strong className="text-slate-300">Scoring floor (0-10 scale).</strong> Any agent scoring below this value will be capped at this minimum.
                    <span className="text-slate-400"> Default: 0.0.</span> Only change if you want to prevent ultra-simple agents from scoring too low.
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300 flex items-center gap-2">
                    Maximum Agent Intensity
                    <span className="text-slate-400 text-xs font-normal">(Ceiling)</span>
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
                  <p className="text-xs text-slate-500 leading-relaxed">
                    <strong className="text-slate-300">Scoring ceiling (0-10 scale).</strong> Any agent scoring above this value will be capped at this maximum.
                    <span className="text-slate-400"> Default: 10.0.</span> Prevents extremely complex agents from breaking routing tier logic.
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300 flex items-center gap-2">
                    Min Executions For Score
                    <span className="bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded text-xs font-semibold">CRITICAL</span>
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
                  <p className="text-xs text-slate-500 leading-relaxed">
                    <strong className="text-slate-300">Number of executions required before score becomes "trusted."</strong> This single value controls BOTH score calculation formula AND when model routing activates.
                  </p>
                  <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-2 mt-2">
                    <p className="text-xs text-slate-300 leading-relaxed">
                      <strong className="text-emerald-300">Before reaching this threshold:</strong>
                      <br/>• Score = 100% creation analysis (prompt + structure)
                      <br/>• Model = GPT-4o-mini (conservative/cheap)
                    </p>
                    <p className="text-xs text-slate-300 leading-relaxed mt-2">
                      <strong className="text-emerald-300">After reaching this threshold:</strong>
                      <br/>• Score = 30% creation + 70% execution (real data)
                      <br/>• Model = Routed by complexity (tier 1/2/3)
                    </p>
                  </div>
                  <p className="text-xs text-yellow-300 mt-2">
                    <strong>Recommendation:</strong> 3-5 for development, 5-10 for production. Lower = faster routing activation. Higher = more conservative.
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

        {/* AIS Creation Score Components (Phase 5) */}
        <div className="bg-gradient-to-br from-slate-800/90 to-slate-900/90 backdrop-blur-xl rounded-2xl border border-white/10">
          <div className="p-6 border-b border-white/10">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold text-white flex items-center gap-3">
                  <Settings className="w-6 h-6 text-blue-400" />
                  AIS Creation Score Components
                </h2>
                <p className="text-slate-400 text-sm mt-1">
                  Configure how workflow, plugins, and I/O schema contribute to AIS creation score (design complexity). Must sum to 1.0.
                </p>
              </div>
              <button
                onClick={() => setCreationWeightsExpanded(!creationWeightsExpanded)}
                className="p-2 bg-slate-700/50 hover:bg-slate-600/50 rounded-lg transition-colors"
              >
                {creationWeightsExpanded ? (
                  <ChevronUp className="w-4 h-4 text-slate-400" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-slate-400" />
                )}
              </button>
            </div>
          </div>

          {creationWeightsExpanded && (
            <div className="p-6 space-y-6">
              {/* Error/Success Messages */}
              {creationWeightsError && (
                <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-3 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                  <p className="text-red-400 text-sm">{creationWeightsError}</p>
                </div>
              )}
              {creationWeightsSuccess && (
                <div className="bg-green-500/10 border border-green-500/50 rounded-lg p-3 flex items-start gap-2">
                  <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0 mt-0.5" />
                  <p className="text-green-400 text-sm">{creationWeightsSuccess}</p>
                </div>
              )}

              {/* Info Box */}
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <Brain className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
                  <div className="space-y-3">
                    <div>
                      <p className="text-blue-400 font-medium text-sm mb-1">AIS Creation Score = Agent Design Complexity</p>
                      <p className="text-slate-300 text-sm leading-relaxed">
                        The AIS creation score is calculated immediately when an agent is created, based purely on its structural design characteristics. It does NOT include creation tokens (which are tracked separately for billing).
                      </p>
                    </div>
                    <div className="bg-slate-700/30 rounded-lg p-3">
                      <ul className="text-slate-300 text-xs space-y-1.5">
                        <li className="flex items-start gap-2">
                          <span className="text-blue-300">•</span>
                          <span><strong className="text-blue-300">Workflow Structure (50%):</strong> Number and complexity of workflow steps</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="text-green-300">•</span>
                          <span><strong className="text-green-300">Plugin Diversity (30%):</strong> Number of different plugins connected</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="text-purple-300">•</span>
                          <span><strong className="text-purple-300">I/O Schema (20%):</strong> Total input + output field count</span>
                        </li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>

              {/* Creation Component Weights */}
              <div className="space-y-4">
                <div className="flex items-center justify-between pb-2 border-b border-white/10">
                  <h3 className="font-medium text-white flex items-center gap-2">
                    <Settings className="w-4 h-4 text-blue-400" />
                    Creation Component Weights (must sum to 1.0)
                  </h3>
                  <span className="text-xs text-slate-400">
                    Current sum: {(creationComponentWeights.workflow + creationComponentWeights.plugins + creationComponentWeights.io_schema).toFixed(3)}
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-blue-300 flex items-center gap-1.5">
                      <BarChart3 className="w-3.5 h-3.5" />
                      Workflow Structure
                    </label>
                    <input
                      type="number"
                      value={creationComponentWeights.workflow}
                      onChange={(e) => setCreationComponentWeights({ ...creationComponentWeights, workflow: parseFloat(e.target.value) || 0 })}
                      min="0"
                      max="1"
                      step="0.05"
                      className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                    />
                    <div className="text-xs text-slate-400 leading-relaxed">
                      <p className="text-blue-300 font-medium mb-1">Agent Architecture (default: 0.5)</p>
                      <p className="text-slate-400">Measures the number and complexity of workflow steps in the agent's design. Higher values emphasize architectural sophistication in scoring.</p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-green-300 flex items-center gap-1.5">
                      <Database className="w-3.5 h-3.5" />
                      Plugin Diversity
                    </label>
                    <input
                      type="number"
                      value={creationComponentWeights.plugins}
                      onChange={(e) => setCreationComponentWeights({ ...creationComponentWeights, plugins: parseFloat(e.target.value) || 0 })}
                      min="0"
                      max="1"
                      step="0.05"
                      className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-green-500"
                    />
                    <div className="text-xs text-slate-400 leading-relaxed">
                      <p className="text-green-300 font-medium mb-1">Integration Breadth (default: 0.3)</p>
                      <p className="text-slate-400">Counts the number of different plugins/integrations connected to the agent. More diverse integrations indicate higher design complexity.</p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-purple-300 flex items-center gap-1.5">
                      <Zap className="w-3.5 h-3.5" />
                      I/O Schema
                    </label>
                    <input
                      type="number"
                      value={creationComponentWeights.io_schema}
                      onChange={(e) => setCreationComponentWeights({ ...creationComponentWeights, io_schema: parseFloat(e.target.value) || 0 })}
                      min="0"
                      max="1"
                      step="0.05"
                      className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-purple-500"
                    />
                    <div className="text-xs text-slate-400 leading-relaxed">
                      <p className="text-purple-300 font-medium mb-1">Data Complexity (default: 0.2)</p>
                      <p className="text-slate-400">Sum of input and output fields defined in the agent's schema. More fields indicate more complex data handling requirements.</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Save Button */}
              <div className="flex justify-end pt-4 border-t border-white/10">
                <button
                  onClick={handleSaveCreationWeights}
                  disabled={savingCreationWeights}
                  className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors flex items-center gap-2"
                >
                  {savingCreationWeights ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4" />
                      Save Creation Weights
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* AIS Execution Score Dimensions */}
        <div className="bg-gradient-to-br from-slate-800/90 to-slate-900/90 backdrop-blur-xl rounded-2xl border border-white/10">
          <div className="p-6 border-b border-white/10">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold text-white flex items-center gap-3">
                  <BarChart3 className="w-6 h-6 text-purple-400" />
                  AIS Execution Score Dimensions
                </h2>
                <p className="text-slate-400 text-sm mt-1">
                  Control how much each runtime factor (tokens, execution, plugins, workflow, memory) influences the AIS execution score. All weights must add up to 1.0.
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
              <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <Zap className="w-5 h-5 text-purple-400 flex-shrink-0 mt-0.5" />
                  <div className="space-y-3">
                    <div>
                      <p className="text-purple-400 font-medium text-sm mb-1">AIS Execution Score = Runtime Performance</p>
                      <p className="text-slate-300 text-sm leading-relaxed">
                        The AIS execution score is calculated after agents run, based on actual runtime metrics. This score is calculated from five main dimensions with configurable subdimensions. Adjust these weights to reflect what matters most for runtime complexity in your use case.
                      </p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="bg-slate-700/30 rounded-lg p-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <Zap className="w-4 h-4 text-blue-400" />
                          <p className="text-white text-sm font-medium">Main Dimensions (5 total)</p>
                        </div>
                        <ul className="text-slate-300 text-xs space-y-1 ml-6">
                          <li>• <strong className="text-blue-300">Tokens (30%):</strong> AI model usage and cost</li>
                          <li>• <strong className="text-purple-300">Execution (25%):</strong> Runtime performance metrics</li>
                          <li>• <strong className="text-green-300">Plugins (20%):</strong> External integration complexity</li>
                          <li>• <strong className="text-orange-300">Workflow (15%):</strong> Logic flow patterns</li>
                          <li>• <strong className="text-pink-300">Memory (10%):</strong> Context usage (NEW)</li>
                        </ul>
                      </div>
                      <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <Settings className="w-4 h-4 text-emerald-400" />
                          <p className="text-emerald-300 text-sm font-medium">How Weights Work</p>
                        </div>
                        <p className="text-slate-300 text-xs leading-relaxed mb-2">
                          Each dimension weight (0.0 - 1.0) represents its percentage contribution to the final score. All five must sum to exactly 1.0 (100%).
                        </p>
                        <p className="text-slate-300 text-xs leading-relaxed">
                          <strong className="text-white">Example:</strong> If Tokens = 0.30, then token usage accounts for 30% of the agent's complexity score. Higher token usage will push the agent toward more powerful (expensive) models.
                        </p>
                      </div>
                    </div>
                    <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3">
                      <div className="flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="text-yellow-300 text-xs font-medium mb-1">Subdimensions Control Details</p>
                          <p className="text-slate-300 text-xs leading-relaxed">
                            Each main dimension has subdimensions below (e.g., Execution → iterations, duration, failure, retry). These subdimension weights control how that dimension's score is calculated internally. They also must sum to 1.0 within each dimension. Note: Token complexity uses a growth-based algorithm and does not have configurable subdimensions.
                          </p>
                        </div>
                      </div>
                    </div>
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
                    Current sum: {(aisWeights.tokens + aisWeights.execution + aisWeights.plugins + aisWeights.workflow + aisWeights.memory).toFixed(3)}
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-blue-300 flex items-center gap-1.5">
                      <Zap className="w-3.5 h-3.5" />
                      Tokens
                    </label>
                    <input
                      type="number"
                      value={aisWeights.tokens}
                      onChange={(e) => setAisWeights({ ...aisWeights, tokens: parseFloat(e.target.value) || 0 })}
                      min="0"
                      max="1"
                      step="0.05"
                      className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                    />
                    <div className="text-xs text-slate-400 leading-relaxed">
                      <p className="text-blue-300 font-medium mb-1">AI Model Usage (default: 0.30)</p>
                      <p className="text-slate-400">Measures token consumption across volume, peak usage, and I/O ratio. Higher weight prioritizes cost efficiency in routing decisions.</p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-purple-300 flex items-center gap-1.5">
                      <TrendingUp className="w-3.5 h-3.5" />
                      Execution
                    </label>
                    <input
                      type="number"
                      value={aisWeights.execution}
                      onChange={(e) => setAisWeights({ ...aisWeights, execution: parseFloat(e.target.value) || 0 })}
                      min="0"
                      max="1"
                      step="0.05"
                      className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                    />
                    <div className="text-xs text-slate-400 leading-relaxed">
                      <p className="text-purple-300 font-medium mb-1">Runtime Performance (default: 0.25)</p>
                      <p className="text-slate-400">Tracks iterations, duration, failures, and retries. Higher weight emphasizes execution stability and performance patterns.</p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-green-300 flex items-center gap-1.5">
                      <Database className="w-3.5 h-3.5" />
                      Plugins
                    </label>
                    <input
                      type="number"
                      value={aisWeights.plugins}
                      onChange={(e) => setAisWeights({ ...aisWeights, plugins: parseFloat(e.target.value) || 0 })}
                      min="0"
                      max="1"
                      step="0.05"
                      className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                    />
                    <div className="text-xs text-slate-400 leading-relaxed">
                      <p className="text-green-300 font-medium mb-1">External Integrations (default: 0.20)</p>
                      <p className="text-slate-400">Evaluates plugin count, usage frequency, and coordination overhead. Higher weight accounts for integration complexity.</p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-orange-300 flex items-center gap-1.5">
                      <BarChart3 className="w-3.5 h-3.5" />
                      Workflow
                    </label>
                    <input
                      type="number"
                      value={aisWeights.workflow}
                      onChange={(e) => setAisWeights({ ...aisWeights, workflow: parseFloat(e.target.value) || 0 })}
                      min="0"
                      max="1"
                      step="0.05"
                      className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                    />
                    <div className="text-xs text-slate-400 leading-relaxed">
                      <p className="text-orange-300 font-medium mb-1">Logic Flow Patterns (default: 0.15)</p>
                      <p className="text-slate-400">Analyzes steps, branches, loops, and parallel execution. Higher weight reflects workflow structural complexity.</p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-pink-300 flex items-center gap-2">
                      <Brain className="w-3.5 h-3.5" />
                      Memory
                      <span className="px-2 py-0.5 bg-pink-500/20 text-pink-300 text-xs rounded-full font-semibold">NEW</span>
                    </label>
                    <input
                      type="number"
                      value={aisWeights.memory}
                      onChange={(e) => setAisWeights({ ...aisWeights, memory: parseFloat(e.target.value) || 0 })}
                      min="0"
                      max="1"
                      step="0.05"
                      className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-pink-500"
                    />
                    <div className="text-xs text-slate-400 leading-relaxed">
                      <p className="text-pink-300 font-medium mb-1">Context Usage (default: 0.10)</p>
                      <p className="text-slate-400">Tracks memory token ratio, type diversity, and entry volume. Higher weight recognizes memory-intensive agent patterns.</p>
                    </div>
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

                {/* Execution Subdimensions Info Box */}
                <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <TrendingUp className="w-5 h-5 text-purple-400 flex-shrink-0 mt-0.5" />
                    <div className="space-y-3">
                      <div>
                        <p className="text-purple-400 font-medium text-sm mb-1">Execution Performance Breakdown</p>
                        <p className="text-slate-300 text-sm leading-relaxed">
                          Execution complexity evaluates runtime performance and stability patterns. The <strong className="text-white">25% Execution weight</strong> is distributed across four performance metrics:
                        </p>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="bg-slate-700/30 rounded-lg p-3">
                          <div className="flex items-center gap-2 mb-2">
                            <RefreshCw className="w-4 h-4 text-purple-400" />
                            <p className="text-white text-sm font-medium">Iterations (40%)</p>
                          </div>
                          <p className="text-slate-300 text-xs leading-relaxed">
                            Number of execution loops/cycles. Higher iterations indicate complex reasoning chains. <strong className="text-purple-300">Example:</strong> Multi-step agents that iterate 5-10 times vs single-shot agents.
                          </p>
                        </div>
                        <div className="bg-slate-700/30 rounded-lg p-3">
                          <div className="flex items-center gap-2 mb-2">
                            <BarChart3 className="w-4 h-4 text-purple-400" />
                            <p className="text-white text-sm font-medium">Duration (30%)</p>
                          </div>
                          <p className="text-slate-300 text-xs leading-relaxed">
                            Total runtime in milliseconds. Captures computational intensity. <strong className="text-purple-300">Example:</strong> Long-running data processing vs quick Q&A responses.
                          </p>
                        </div>
                        <div className="bg-slate-700/30 rounded-lg p-3">
                          <div className="flex items-center gap-2 mb-2">
                            <AlertCircle className="w-4 h-4 text-purple-400" />
                            <p className="text-white text-sm font-medium">Failure Rate (20%)</p>
                          </div>
                          <p className="text-slate-300 text-xs leading-relaxed">
                            Percentage of executions that fail. Higher failures suggest unstable or challenging tasks. <strong className="text-purple-300">Impact:</strong> Unreliable agents get higher complexity scores.
                          </p>
                        </div>
                        <div className="bg-slate-700/30 rounded-lg p-3">
                          <div className="flex items-center gap-2 mb-2">
                            <RefreshCw className="w-4 h-4 text-purple-400" />
                            <p className="text-white text-sm font-medium">Retry Rate (10%)</p>
                          </div>
                          <p className="text-slate-300 text-xs leading-relaxed">
                            Frequency of retry attempts needed. Indicates self-healing complexity. <strong className="text-purple-300">Impact:</strong> Agents requiring multiple attempts score higher.
                          </p>
                        </div>
                      </div>
                      <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3">
                        <div className="flex items-start gap-2">
                          <AlertCircle className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
                          <div>
                            <p className="text-yellow-300 text-xs font-medium mb-1">Stability vs Performance Tradeoff</p>
                            <p className="text-slate-300 text-xs leading-relaxed">
                              <strong className="text-white">High Iterations/Duration:</strong> Captures computational complexity.
                              <strong className="text-white ml-2">High Failure/Retry:</strong> Flags unstable agents that might benefit from better models.
                              Adjust weights based on whether you prioritize routing for performance efficiency or reliability.
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
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

                {/* Plugin Subdimensions Info Box */}
                <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <Database className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
                    <div className="space-y-3">
                      <div>
                        <p className="text-green-400 font-medium text-sm mb-1">Plugin Integration Breakdown</p>
                        <p className="text-slate-300 text-sm leading-relaxed">
                          Plugin complexity measures external integration sophistication. The <strong className="text-white">20% Plugins weight</strong> is split across three integration factors:
                        </p>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div className="bg-slate-700/30 rounded-lg p-3">
                          <div className="flex items-center gap-2 mb-2">
                            <BarChart3 className="w-4 h-4 text-green-400" />
                            <p className="text-white text-sm font-medium">Count (40%)</p>
                          </div>
                          <p className="text-slate-300 text-xs leading-relaxed">
                            Number of unique plugins connected. More plugins = broader integration surface. <strong className="text-green-300">Example:</strong> Simple agent uses 1-2 plugins, complex agent orchestrates 5+ tools.
                          </p>
                        </div>
                        <div className="bg-slate-700/30 rounded-lg p-3">
                          <div className="flex items-center gap-2 mb-2">
                            <TrendingUp className="w-4 h-4 text-green-400" />
                            <p className="text-white text-sm font-medium">Usage (40%)</p>
                          </div>
                          <p className="text-slate-300 text-xs leading-relaxed">
                            How frequently plugins are actually invoked. Measures active integration vs passive availability. <strong className="text-green-300">Example:</strong> Agent calls APIs 20 times vs having them configured but unused.
                          </p>
                        </div>
                        <div className="bg-slate-700/30 rounded-lg p-3">
                          <div className="flex items-center gap-2 mb-2">
                            <Settings className="w-4 h-4 text-green-400" />
                            <p className="text-white text-sm font-medium">Overhead (20%)</p>
                          </div>
                          <p className="text-slate-300 text-xs leading-relaxed">
                            Time spent coordinating between plugins. Data transformation, sequencing, error handling. <strong className="text-green-300">Example:</strong> Complex workflows requiring plugin output chaining.
                          </p>
                        </div>
                      </div>
                      <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
                        <div className="flex items-start gap-2">
                          <Settings className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
                          <div>
                            <p className="text-blue-300 text-xs font-medium mb-1">Integration Complexity Patterns</p>
                            <p className="text-slate-300 text-xs leading-relaxed">
                              <strong className="text-white">High Count + Low Usage:</strong> Plugin-rich but simple logic (score stays low).
                              <strong className="text-white ml-2">High Usage + High Overhead:</strong> Integration-heavy workflows (score increases significantly).
                              Balance weights based on whether plugin availability or actual integration depth matters more.
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
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

                {/* Workflow Subdimensions Info Box */}
                <div className="bg-orange-500/10 border border-orange-500/20 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <BarChart3 className="w-5 h-5 text-orange-400 flex-shrink-0 mt-0.5" />
                    <div className="space-y-3">
                      <div>
                        <p className="text-orange-400 font-medium text-sm mb-1">Workflow Logic Breakdown</p>
                        <p className="text-slate-300 text-sm leading-relaxed">
                          Workflow complexity analyzes control flow patterns and structural sophistication. The <strong className="text-white">15% Workflow weight</strong> is divided across four logic structures:
                        </p>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="bg-slate-700/30 rounded-lg p-3">
                          <div className="flex items-center gap-2 mb-2">
                            <BarChart3 className="w-4 h-4 text-orange-400" />
                            <p className="text-white text-sm font-medium">Steps (40%)</p>
                          </div>
                          <p className="text-slate-300 text-xs leading-relaxed">
                            Total sequential actions in the workflow. More steps = longer execution chains. <strong className="text-orange-300">Example:</strong> 3-step workflow (fetch → process → respond) vs 10-step pipeline.
                          </p>
                        </div>
                        <div className="bg-slate-700/30 rounded-lg p-3">
                          <div className="flex items-center gap-2 mb-2">
                            <TrendingUp className="w-4 h-4 text-orange-400" />
                            <p className="text-white text-sm font-medium">Branches (30%)</p>
                          </div>
                          <p className="text-slate-300 text-xs leading-relaxed">
                            Conditional decision points (if/else logic). Higher branches = more sophisticated routing. <strong className="text-orange-300">Example:</strong> Simple linear flow vs multi-path conditional logic.
                          </p>
                        </div>
                        <div className="bg-slate-700/30 rounded-lg p-3">
                          <div className="flex items-center gap-2 mb-2">
                            <RefreshCw className="w-4 h-4 text-orange-400" />
                            <p className="text-white text-sm font-medium">Loops (20%)</p>
                          </div>
                          <p className="text-slate-300 text-xs leading-relaxed">
                            Repeated cycles and iterations within workflow structure. <strong className="text-orange-300">Example:</strong> Batch processing or retry logic patterns that iterate over data.
                          </p>
                        </div>
                        <div className="bg-slate-700/30 rounded-lg p-3">
                          <div className="flex items-center gap-2 mb-2">
                            <Database className="w-4 h-4 text-orange-400" />
                            <p className="text-white text-sm font-medium">Parallel (10%)</p>
                          </div>
                          <p className="text-slate-300 text-xs leading-relaxed">
                            Concurrent actions running simultaneously. Advanced orchestration requiring coordination. <strong className="text-orange-300">Example:</strong> Fan-out/fan-in patterns, parallel API calls.
                          </p>
                        </div>
                      </div>
                      <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3">
                        <div className="flex items-start gap-2">
                          <Settings className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                          <div>
                            <p className="text-emerald-300 text-xs font-medium mb-1">Structural Complexity Insights</p>
                            <p className="text-slate-300 text-xs leading-relaxed">
                              <strong className="text-white">High Steps:</strong> Long sequential chains (higher baseline complexity).
                              <strong className="text-white ml-2">High Branches:</strong> Decision-heavy logic (requires reasoning models).
                              <strong className="text-white ml-2">High Loops/Parallel:</strong> Advanced orchestration (benefits from premium models).
                              Adjust weights based on which structural pattern best predicts agent difficulty.
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
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

              {/* Memory Subdimensions */}
              <div className="space-y-4">
                <div className="flex items-center justify-between pb-2 border-b border-white/10">
                  <div className="flex-1">
                    <h3 className="font-medium text-white flex items-center gap-2">
                      <Brain className="w-4 h-4 text-pink-400" />
                      Memory Subdimension Weights (must sum to 1.0)
                      <span className="ml-2 px-2 py-0.5 bg-pink-500/20 text-pink-300 text-xs rounded-full font-semibold">NEW</span>
                    </h3>
                    <p className="text-xs text-slate-500 mt-1">Control memory complexity factors: token ratio vs type diversity vs entry volume.</p>
                  </div>
                  <span className="text-xs text-slate-400">
                    Current sum: {(aisWeights.memory_ratio + aisWeights.memory_diversity + aisWeights.memory_volume).toFixed(3)}
                  </span>
                </div>

                {/* Memory Subdimensions Info Box */}
                <div className="bg-pink-500/10 border border-pink-500/20 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <Brain className="w-5 h-5 text-pink-400 flex-shrink-0 mt-0.5" />
                    <div className="space-y-3">
                      <div>
                        <p className="text-pink-400 font-medium text-sm mb-1">Memory Context Usage Breakdown</p>
                        <p className="text-slate-300 text-sm leading-relaxed">
                          Memory complexity measures how agents leverage historical context and learned patterns. The <strong className="text-white">10% Memory weight</strong> is split across three context factors:
                        </p>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div className="bg-slate-700/30 rounded-lg p-3">
                          <div className="flex items-center gap-2 mb-2">
                            <BarChart3 className="w-4 h-4 text-pink-400" />
                            <p className="text-white text-sm font-medium">Ratio (50%)</p>
                          </div>
                          <p className="text-slate-300 text-xs leading-relaxed">
                            Memory tokens as percentage of total input (0-90%). Higher ratio = memory-dependent agent. <strong className="text-pink-300">Example:</strong> Agent loading 5K tokens of context in 10K total input = 50% ratio.
                          </p>
                        </div>
                        <div className="bg-slate-700/30 rounded-lg p-3">
                          <div className="flex items-center gap-2 mb-2">
                            <Database className="w-4 h-4 text-pink-400" />
                            <p className="text-white text-sm font-medium">Diversity (30%)</p>
                          </div>
                          <p className="text-slate-300 text-xs leading-relaxed">
                            Number of memory types used (summaries, user_context, patterns, etc.). More types = sophisticated context orchestration. <strong className="text-pink-300">Example:</strong> Using 1 type vs 4 different memory types.
                          </p>
                        </div>
                        <div className="bg-slate-700/30 rounded-lg p-3">
                          <div className="flex items-center gap-2 mb-2">
                            <TrendingUp className="w-4 h-4 text-pink-400" />
                            <p className="text-white text-sm font-medium">Volume (20%)</p>
                          </div>
                          <p className="text-slate-300 text-xs leading-relaxed">
                            Total number of memory entries loaded. More entries = larger context window and retrieval complexity. <strong className="text-pink-300">Example:</strong> Loading 50 memory entries vs 5.
                          </p>
                        </div>
                      </div>
                      <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
                        <div className="flex items-start gap-2">
                          <Brain className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
                          <div>
                            <p className="text-blue-300 text-xs font-medium mb-1">Memory-Intensive Agent Patterns</p>
                            <p className="text-slate-300 text-xs leading-relaxed">
                              <strong className="text-white">High Ratio:</strong> Agent relies heavily on historical context (conversational agents, personalized assistants).
                              <strong className="text-white ml-2">High Diversity:</strong> Complex multi-source memory orchestration (research agents, knowledge synthesis).
                              <strong className="text-white ml-2">High Volume:</strong> Large-scale context retrieval (document Q&A, comprehensive analysis).
                              Memory-intensive agents often benefit from models with larger context windows and better reasoning.
                            </p>
                          </div>
                        </div>
                      </div>
                      <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3">
                        <div className="flex items-start gap-2">
                          <AlertCircle className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
                          <div>
                            <p className="text-yellow-300 text-xs font-medium mb-1">New Feature - Beta</p>
                            <p className="text-slate-300 text-xs leading-relaxed">
                              Memory complexity is a newly added dimension (default 10% weight). Monitor agent scores over the next few weeks and adjust weights if memory usage doesn't correlate with expected routing behavior. Consider increasing to 15% if memory patterns strongly predict complexity.
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-300">Ratio</label>
                    <input
                      type="number"
                      value={aisWeights.memory_ratio}
                      onChange={(e) => setAisWeights({ ...aisWeights, memory_ratio: parseFloat(e.target.value) || 0 })}
                      min="0"
                      max="1"
                      step="0.05"
                      className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-pink-500"
                    />
                    <p className="text-xs text-slate-500">Memory tokens / total input tokens (0-90%). Higher = more memory-dependent.</p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-300">Diversity</label>
                    <input
                      type="number"
                      value={aisWeights.memory_diversity}
                      onChange={(e) => setAisWeights({ ...aisWeights, memory_diversity: parseFloat(e.target.value) || 0 })}
                      min="0"
                      max="1"
                      step="0.05"
                      className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-pink-500"
                    />
                    <p className="text-xs text-slate-500">Number of memory types used (summaries, user_context, patterns). More types = sophisticated.</p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-300">Volume</label>
                    <input
                      type="number"
                      value={aisWeights.memory_volume}
                      onChange={(e) => setAisWeights({ ...aisWeights, memory_volume: parseFloat(e.target.value) || 0 })}
                      min="0"
                      max="1"
                      step="0.05"
                      className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-pink-500"
                    />
                    <p className="text-xs text-slate-500">Total memory entries loaded. More entries = larger context window.</p>
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

        {/* AIS Combined Score Weights Configuration */}
        <div className="bg-gradient-to-br from-slate-800/90 to-slate-900/90 backdrop-blur-xl rounded-2xl border border-white/10">
          <div className="p-6 border-b border-white/10">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold text-white flex items-center gap-3">
                  <TrendingUp className="w-6 h-6 text-indigo-400" />
                  AIS Combined Score Weights
                </h2>
                <p className="text-slate-400 text-sm mt-1">
                  Control how AIS creation score and execution score are blended into the final combined score used for routing decisions
                </p>
              </div>
              <button
                onClick={() => setCombinedWeightsExpanded(!combinedWeightsExpanded)}
                className="p-2 bg-slate-700/50 hover:bg-slate-600/50 rounded-lg transition-colors"
              >
                {combinedWeightsExpanded ? (
                  <ChevronUp className="w-4 h-4 text-slate-400" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-slate-400" />
                )}
              </button>
            </div>
          </div>

          {combinedWeightsExpanded && (
            <div className="p-6 space-y-6">
              {/* Error/Success Messages */}
              {combinedWeightsError && (
                <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-3 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                  <p className="text-red-400 text-sm">{combinedWeightsError}</p>
                </div>
              )}
              {combinedWeightsSuccess && (
                <div className="bg-green-500/10 border border-green-500/50 rounded-lg p-3 flex items-start gap-2">
                  <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0 mt-0.5" />
                  <p className="text-green-400 text-sm">{combinedWeightsSuccess}</p>
                </div>
              )}

              {/* Info Box */}
              <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <TrendingUp className="w-5 h-5 text-indigo-400 flex-shrink-0 mt-0.5" />
                  <div className="space-y-3">
                    <div>
                      <p className="text-indigo-400 font-medium text-sm mb-1">Three-Score System</p>
                      <p className="text-slate-300 text-sm leading-relaxed">
                        The AIS uses three scores: <strong className="text-white">Creation Score</strong> (0-10, based on agent design), <strong className="text-white">Execution Score</strong> (0-10, based on runtime data from 5 dimensions above), and <strong className="text-white">Combined Score</strong> (0-10, the blend of both used for routing).
                      </p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="bg-slate-700/30 rounded-lg p-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <Brain className="w-4 h-4 text-indigo-400" />
                          <p className="text-white text-sm font-medium">Maturity Gate (5 executions)</p>
                        </div>
                        <ul className="text-slate-300 text-xs space-y-1 ml-6">
                          <li>• <strong className="text-blue-300">Before 5 runs:</strong> Uses creation score only (trust design estimate)</li>
                          <li>• <strong className="text-green-300">After 5+ runs:</strong> Blends creation + execution using these weights</li>
                        </ul>
                      </div>
                      <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <BarChart3 className="w-4 h-4 text-emerald-400" />
                          <p className="text-emerald-300 text-sm font-medium">Default Blend</p>
                        </div>
                        <p className="text-slate-300 text-xs leading-relaxed mb-2">
                          <strong className="text-white">Creation: 30%</strong> - Agent design complexity<br/>
                          <strong className="text-white">Execution: 70%</strong> - Real runtime behavior
                        </p>
                        <p className="text-slate-300 text-xs leading-relaxed">
                          This heavily weights actual performance data once enough executions have been recorded.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* AIS Combined Score Blend */}
              <div className="space-y-4">
                <div className="flex items-center justify-between pb-2 border-b border-white/10">
                  <h3 className="font-medium text-white flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-indigo-400" />
                    AIS Combined Score Blend (must sum to 1.0)
                  </h3>
                  <span className="text-xs text-slate-400">
                    Current sum: {(combinedWeights.creation + combinedWeights.execution).toFixed(3)}
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-blue-300 flex items-center gap-1.5">
                      <Settings className="w-3.5 h-3.5" />
                      Creation Weight
                    </label>
                    <input
                      type="number"
                      value={combinedWeights.creation}
                      onChange={(e) => setCombinedWeights({ ...combinedWeights, creation: parseFloat(e.target.value) || 0 })}
                      min="0"
                      max="1"
                      step="0.05"
                      className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                    />
                    <div className="text-xs text-slate-400 leading-relaxed">
                      <p className="text-blue-300 font-medium mb-1">Agent Design Complexity (default: 0.3)</p>
                      <p className="text-slate-400">How much the agent's design characteristics (workflow complexity, plugins, I/O fields) contribute to routing decisions after maturity threshold.</p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-purple-300 flex items-center gap-1.5">
                      <Zap className="w-3.5 h-3.5" />
                      Execution Weight
                    </label>
                    <input
                      type="number"
                      value={combinedWeights.execution}
                      onChange={(e) => setCombinedWeights({ ...combinedWeights, execution: parseFloat(e.target.value) || 0 })}
                      min="0"
                      max="1"
                      step="0.05"
                      className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-purple-500"
                    />
                    <div className="text-xs text-slate-400 leading-relaxed">
                      <p className="text-purple-300 font-medium mb-1">Runtime Performance Blend (default: 0.7)</p>
                      <p className="text-slate-400">How much actual execution data (tokens, iterations, plugins usage, workflow patterns, memory) drives routing once the agent is mature.</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Save Button */}
              <div className="flex justify-end pt-4 border-t border-white/10">
                <button
                  onClick={handleSaveCombinedWeights}
                  disabled={savingCombinedWeights}
                  className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors flex items-center gap-2"
                >
                  {savingCombinedWeights ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4" />
                      Save Combined Weights
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
              {/* Enhanced Info Box */}
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <Zap className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                  <div className="space-y-3">
                    <div>
                      <p className="text-emerald-400 font-medium text-sm mb-1">Agent Creation Ranges Overview</p>
                      <p className="text-slate-300 text-sm leading-relaxed">
                        Creation ranges normalize agent complexity scores based on <strong className="text-white">design characteristics</strong> (configuration, not runtime behavior). These ranges are evaluated <strong className="text-white">immediately when an agent is created</strong>, before it ever executes. This provides an initial complexity estimate based purely on how the agent is structured.
                      </p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="bg-slate-700/30 rounded-lg p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <BarChart3 className="w-4 h-4 text-blue-400" />
                          <p className="text-white text-sm font-medium">Best Practice Ranges</p>
                        </div>
                        <p className="text-slate-300 text-xs leading-relaxed">
                          Manually defined boundaries based on <strong className="text-blue-300">industry standards and research</strong>. These represent ideal/typical ranges observed across diverse agent systems. Use when you don't have enough data or want consistent, predictable scoring.
                        </p>
                      </div>
                      <div className="bg-slate-700/30 rounded-lg p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <TrendingUp className="w-4 h-4 text-green-400" />
                          <p className="text-white text-sm font-medium">Dynamic (Learned) Ranges</p>
                        </div>
                        <p className="text-slate-300 text-xs leading-relaxed">
                          Automatically calculated from <strong className="text-green-300">your actual agent portfolio</strong>. System analyzes all created agents and learns what "normal" ranges are for your specific use cases. Adapts as you create more agents, providing personalized scoring.
                        </p>
                      </div>
                    </div>
                    <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
                      <div className="flex items-start gap-2">
                        <Settings className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="text-blue-300 text-xs font-medium mb-1">How Normalization Works</p>
                          <p className="text-slate-300 text-xs leading-relaxed">
                            Raw metrics (e.g., "agent has 5 plugins") are converted to standardized 0-10 sub-scores using these ranges. <strong className="text-white">Example:</strong> If plugin_count best practice range is 1-10, an agent with 3 plugins scores ~3.0. If your dynamic range learns 1-5 is typical, that same agent scores ~6.0. These sub-scores feed into the overall AIS calculation.
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3">
                      <div className="flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="text-yellow-300 text-xs font-medium mb-1">When to Use Each Mode</p>
                          <p className="text-slate-300 text-xs leading-relaxed">
                            <strong className="text-white">Best Practice:</strong> Recommended for new deployments, consistent cross-team scoring, or when your agent patterns differ significantly from your needs.
                            <strong className="text-white ml-2">Dynamic:</strong> Recommended once you have 50+ agents created, want scoring tailored to your specific use cases, and prefer adaptive boundaries that reflect your actual complexity distribution.
                          </p>
                        </div>
                      </div>
                    </div>
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
              {/* Enhanced Info Box */}
              <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <TrendingUp className="w-5 h-5 text-purple-400 flex-shrink-0 mt-0.5" />
                  <div className="space-y-3">
                    <div>
                      <p className="text-purple-400 font-medium text-sm mb-1">Agent Execution Ranges Overview</p>
                      <p className="text-slate-300 text-sm leading-relaxed">
                        Execution ranges normalize agent complexity scores based on <strong className="text-white">actual runtime behavior</strong> (performance metrics collected during execution). These ranges are calculated <strong className="text-white">after agents have run</strong>, capturing real-world usage patterns. This provides accurate complexity scoring based on observed behavior rather than design assumptions.
                      </p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="bg-slate-700/30 rounded-lg p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <Zap className="w-4 h-4 text-blue-400" />
                          <p className="text-white text-sm font-medium">The 5 Execution Categories</p>
                        </div>
                        <ul className="text-slate-300 text-xs space-y-1">
                          <li>• <strong className="text-blue-300">Token Complexity:</strong> AI model usage (volume, peaks, I/O)</li>
                          <li>• <strong className="text-purple-300">Execution Complexity:</strong> Runtime patterns (iterations, duration, failures)</li>
                          <li>• <strong className="text-green-300">Plugin Complexity:</strong> Integration usage (count, frequency, overhead)</li>
                          <li>• <strong className="text-orange-300">Workflow Complexity:</strong> Logic flow (steps, branches, loops, parallel)</li>
                          <li>• <strong className="text-pink-300">Memory Complexity:</strong> Context usage (ratio, diversity, volume) <span className="text-xs bg-pink-500/20 px-1 rounded">NEW</span></li>
                        </ul>
                      </div>
                      <div className="bg-slate-700/30 rounded-lg p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <Settings className="w-4 h-4 text-purple-400" />
                          <p className="text-white text-sm font-medium">Range Modes</p>
                        </div>
                        <p className="text-slate-300 text-xs leading-relaxed mb-2">
                          <strong className="text-blue-300">Best Practice:</strong> Industry-standard ranges validated across thousands of agents. Consistent, predictable scoring.
                        </p>
                        <p className="text-slate-300 text-xs leading-relaxed">
                          <strong className="text-green-300">Dynamic:</strong> Learned from your execution history. Adapts to your specific agent behavior patterns and workload characteristics.
                        </p>
                      </div>
                    </div>
                    <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3">
                      <div className="flex items-start gap-2">
                        <BarChart3 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="text-emerald-300 text-xs font-medium mb-1">Creation vs Execution Ranges</p>
                          <p className="text-slate-300 text-xs leading-relaxed">
                            <strong className="text-white">Creation ranges</strong> score agents based on design (what you built). <strong className="text-white">Execution ranges</strong> score based on behavior (how it actually runs). Both contribute to the final AIS: creation provides initial estimates, execution provides ground truth. Over time, execution data becomes more influential as the system learns actual complexity patterns.
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3">
                      <div className="flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="text-yellow-300 text-xs font-medium mb-1">Dynamic Range Requirements</p>
                          <p className="text-slate-300 text-xs leading-relaxed">
                            Dynamic execution ranges require <strong className="text-white">sufficient execution history</strong> to be accurate. The system needs to observe enough runs to understand typical patterns. If you see "Not calculated yet", run more agents to build up the dataset. Best practice mode works immediately with no data requirements.
                          </p>
                        </div>
                      </div>
                    </div>
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

            {/* Memory Complexity */}
            {config.ranges?.memory_complexity && (
              <div>
                <div className="mb-3">
                  <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                    <Brain className="w-5 h-5 text-pink-400" />
                    Memory Complexity
                    <span className="ml-2 px-2 py-0.5 bg-pink-500/20 text-pink-300 text-xs rounded-full font-semibold">
                      NEW
                    </span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-1 ml-7">
                    Tracks memory context usage: token ratio, type diversity, and entry volume. Memory-heavy agents require more powerful models for context understanding.
                  </p>
                </div>
                <div className="space-y-4">
                  {config.ranges.memory_complexity.map((range) => (
                    <div key={range.id} className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 hover:border-pink-500/30 transition-colors">
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
          !['creation', 'token_complexity', 'execution_complexity', 'plugin_complexity', 'workflow_complexity', 'memory_complexity'].includes(category)
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
