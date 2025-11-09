// components/agents/AgentIntensityCard.tsx
// Card component to display agent complexity score in agent details page

'use client';

import { useState, useEffect } from 'react';
import { Activity, ChevronDown, ChevronUp, Zap, Settings } from 'lucide-react';
import { useAuth } from '@/components/UserProvider';
import type { IntensityBreakdown } from '@/lib/types/intensity';
import {
  getIntensityBadgeColor,
  classifyIntensityRange,
} from '@/lib/types/intensity';

interface AgentIntensityCardProps {
  agentId: string;
}

export function AgentIntensityCard({ agentId }: AgentIntensityCardProps) {
  const { user } = useAuth();
  const [breakdown, setBreakdown] = useState<IntensityBreakdown | null>(null);
  const [routingConfig, setRoutingConfig] = useState<{ lowThreshold: number; mediumThreshold: number; anthropicEnabled: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    console.log('[AgentIntensityCard] useEffect triggered with agentId:', agentId, 'user:', user?.id);
    if (!agentId) {
      console.error('[AgentIntensityCard] No agentId provided!');
      setLoading(false);
      return;
    }
    if (!user) {
      console.log('[AgentIntensityCard] Waiting for user authentication...');
      return; // Wait for user to be loaded
    }
    fetchIntensity();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, user]);

  const fetchIntensity = async () => {
    if (!user) {
      console.log('[AgentIntensityCard] No user yet, waiting...');
      return;
    }

    try {
      console.log('[AgentIntensityCard] Fetching intensity data from API endpoint');

      const response = await fetch(`/api/agents/${agentId}/intensity`, {
        headers: {
          'x-user-id': user.id,
        },
      });

      console.log('[AgentIntensityCard] Response status:', response.status);

      if (!response.ok) {
        const errorData = await response.json();
        console.error('[AgentIntensityCard] API error:', response.status, errorData);
        setLoading(false);
        return;
      }

      const data = await response.json();
      console.log('[AgentIntensityCard] Received data:', data);

      setBreakdown(data);
      setRoutingConfig(data.routing_config);

      console.log('[AgentIntensityCard] Data loaded successfully');
    } catch (err) {
      console.error('[AgentIntensityCard] Error fetching intensity:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg border border-slate-200 p-6">
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-slate-200 rounded w-32"></div>
          <div className="h-8 bg-slate-200 rounded w-24"></div>
        </div>
      </div>
    );
  }

  if (!breakdown) {
    console.log('[AgentIntensityCard] No breakdown data, rendering error state');
    return (
      <div className="bg-red-50 rounded-lg border border-red-200 p-6">
        <div className="flex items-center gap-3 mb-2">
          <Activity className="h-5 w-5 text-red-600" />
          <h3 className="text-sm font-semibold text-red-700">Unable to Load Complexity Data</h3>
        </div>
        <p className="text-xs text-red-600">
          The agent complexity score could not be loaded. Check the browser console for details.
        </p>
      </div>
    );
  }

  const combinedScore = breakdown.combined_score;
  const intensityRange = classifyIntensityRange(combinedScore);
  const badgeColorClass = getIntensityBadgeColor(combinedScore);
  const hasExecutions = breakdown.details.execution_stats.total_executions > 0;

  // Determine model based on AIS score (matches ModelRouter thresholds from database)
  const getModelInfo = (score: number) => {
    // Use dynamic thresholds from database or fallback to defaults
    const lowThreshold = routingConfig?.lowThreshold ?? 3.9;
    const mediumThreshold = routingConfig?.mediumThreshold ?? 6.9;
    const anthropicEnabled = routingConfig?.anthropicEnabled ?? true;

    if (score <= lowThreshold) {
      return { name: 'GPT-4o-mini', color: 'text-green-600', bg: 'bg-green-50', border: 'border-green-200' };
    } else if (score <= mediumThreshold) {
      // Show Claude Haiku if Anthropic is enabled, otherwise GPT-4o-mini
      if (anthropicEnabled) {
        return { name: 'Claude Haiku', color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200' };
      } else {
        return { name: 'GPT-4o-mini', color: 'text-green-600', bg: 'bg-green-50', border: 'border-green-200' };
      }
    } else {
      return { name: 'GPT-4o', color: 'text-purple-600', bg: 'bg-purple-50', border: 'border-purple-200' };
    }
  };

  const modelInfo = getModelInfo(combinedScore);

  return (
    <div className="bg-gradient-to-br from-purple-50 via-white to-indigo-50 rounded-2xl border border-gray-200 shadow-lg p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-lg flex items-center justify-center flex-shrink-0 shadow-md">
            <Activity className="h-5 w-5 text-white" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-700">Agent Complexity</h3>
            <p className="text-[10px] text-gray-500">AIS Score & Model Selection</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs px-3 py-1 rounded-full ${modelInfo.bg} ${modelInfo.color} font-semibold border ${modelInfo.border}`}>
            {modelInfo.name}
          </span>
          <span className={`text-xs px-3 py-1 rounded-full ${badgeColorClass} font-medium`}>
            {intensityRange} {!hasExecutions && '(estimated)'}
          </span>
        </div>
      </div>

      {/* Main Score Display - Compact */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-end gap-1.5">
            <div className="text-3xl font-bold text-slate-900">
              {combinedScore.toFixed(1)}
            </div>
            <div className="text-sm text-slate-500 mb-1">/10</div>
            {!hasExecutions && (
              <div className="text-xs text-amber-600 mb-1 font-medium">estimated</div>
            )}
          </div>
          <div className="text-xs text-slate-600">
            Multiplier: <span className="font-semibold text-slate-900">{breakdown.combined_multiplier.toFixed(2)}x</span>
          </div>
        </div>

        {/* Progress Bar - Compact */}
        <div className="relative h-2 bg-slate-100 rounded-full overflow-hidden">
          <div
            className={`absolute inset-y-0 left-0 transition-all duration-500 ${
              combinedScore < 3
                ? 'bg-green-500'
                : combinedScore < 6
                ? 'bg-yellow-500'
                : combinedScore < 8
                ? 'bg-orange-500'
                : 'bg-red-500'
            }`}
            style={{ width: `${(combinedScore / 10) * 100}%` }}
          />
        </div>

        {/* Warning for agents not yet run - Compact */}
        {!hasExecutions && (
          <div className="mt-3 bg-blue-50 border border-blue-200 rounded-lg p-2">
            <div className="text-[10px] text-blue-800">
              <span className="font-semibold">Estimated:</span> Design (30%) + predicted runtime (70% at 5.0). Updates after first run.
            </div>
          </div>
        )}
      </div>

      {/* Score Breakdown - More Compact */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        {/* Creation Complexity */}
        <div className="bg-slate-50 rounded-lg p-3">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Settings className="h-3 w-3 text-slate-600" />
            <div className="text-[10px] font-medium text-slate-600">Creation</div>
          </div>
          <div className="text-xl font-bold text-slate-900 mb-0.5">
            {breakdown.creation_score.toFixed(1)}
          </div>
          <div className="text-[10px] text-slate-500">
            30% weight
          </div>
        </div>

        {/* Runtime Complexity */}
        <div className="bg-slate-50 rounded-lg p-3">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Zap className="h-3 w-3 text-slate-600" />
            <div className="text-[10px] font-medium text-slate-600">Runtime</div>
          </div>
          <div className="text-xl font-bold text-slate-900 mb-0.5">
            {breakdown.execution_score.toFixed(1)}
          </div>
          <div className="text-[10px] text-slate-500">
            70% weight{!hasExecutions && <span className="text-amber-600"> (est.)</span>}
          </div>
        </div>
      </div>

      {/* Pilot Credits - More Compact */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        {/* Creation Pilot Credits */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-2">
          <div className="text-[10px] text-blue-700 mb-0.5">Creation Credits</div>
          <div className="text-base font-bold text-blue-900">
            {breakdown.details.creation_stats?.creation_tokens_used
              ? Math.ceil(breakdown.details.creation_stats.creation_tokens_used / 10).toLocaleString()
              : '0'}
          </div>
        </div>

        {/* Execution Pilot Credits */}
        <div className="bg-green-50 border border-green-200 rounded-lg p-2">
          <div className="text-[10px] text-green-700 mb-0.5">Execution Credits</div>
          <div className="text-base font-bold text-green-900">
            {breakdown.details.token_stats?.total_tokens
              ? Math.ceil(breakdown.details.token_stats.total_tokens / 10).toLocaleString()
              : '0'}
          </div>
        </div>
      </div>

      {/* Expand/Collapse Button - Compact */}
      <div className="flex justify-center">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 px-2.5 py-1.5 bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 font-semibold text-[10px] transition-all duration-200"
        >
          {expanded ? (
            <>
              <ChevronUp className="h-3 w-3" />
              Hide
            </>
          ) : (
            <>
              <ChevronDown className="h-3 w-3" />
              Details
            </>
          )}
        </button>
      </div>

      {/* Expanded Technical Details - Compact */}
      {expanded && (
        <div className="mt-3 pt-3 border-t border-slate-200 space-y-4">
          {/* Creation Complexity Breakdown - 4 Dimensions */}
          <div>
            <h4 className="text-xs font-semibold text-slate-700 mb-2">
              Creation Complexity - 4 Dimensions
              <span className="text-[10px] font-normal text-slate-500 ml-1.5">(Score: {breakdown.creation_score.toFixed(1)}/10)</span>
            </h4>
            <div className="space-y-2">
              <MetricRow
                label="Workflow Structure"
                score={breakdown.creation_components.workflow_structure.score}
                weight={breakdown.creation_components.workflow_structure.weight}
              >
                {breakdown.details.design_stats.workflow_steps} step{breakdown.details.design_stats.workflow_steps !== 1 ? 's' : ''} in sequence
              </MetricRow>

              <MetricRow
                label="Plugin Diversity"
                score={breakdown.creation_components.plugin_diversity.score}
                weight={breakdown.creation_components.plugin_diversity.weight}
              >
                {breakdown.details.design_stats.connected_plugins} plugin{breakdown.details.design_stats.connected_plugins !== 1 ? 's' : ''} connected
              </MetricRow>

              <MetricRow
                label="Input/Output Schema"
                score={breakdown.creation_components.io_schema.score}
                weight={breakdown.creation_components.io_schema.weight}
              >
                {breakdown.details.design_stats.input_fields + breakdown.details.design_stats.output_fields} total field{(breakdown.details.design_stats.input_fields + breakdown.details.design_stats.output_fields) !== 1 ? 's' : ''}
                ({breakdown.details.design_stats.input_fields} input, {breakdown.details.design_stats.output_fields} output)
              </MetricRow>

              <MetricRow
                label="Trigger Type"
                score={breakdown.creation_components.trigger_type.score}
                weight={0.0}
              >
                {breakdown.details.design_stats.trigger_type.charAt(0).toUpperCase() + breakdown.details.design_stats.trigger_type.slice(1)}
                {breakdown.creation_components.trigger_type.score > 0 && ` (+${breakdown.creation_components.trigger_type.score} bonus)`}
              </MetricRow>
            </div>
            <div className="mt-2 pt-2 border-t border-slate-200 text-[10px] text-slate-600">
              <span className="font-medium">Formula:</span> Workflow (50%) + Plugins (30%) + I/O (20%) + Trigger bonus
            </div>
          </div>

          {/* Runtime Complexity Breakdown - 5 Dimensions */}
          <div>
            <h4 className="text-xs font-semibold text-slate-700 mb-2">
              Runtime Complexity - 5 Dimensions
              <span className="text-[10px] font-normal text-slate-500 ml-1.5">(Score: {breakdown.execution_score.toFixed(1)}/10)</span>
              {!hasExecutions && <span className="text-[10px] font-normal text-amber-600 ml-1.5">(defaults)</span>}
            </h4>
            <div className="space-y-2">
              <MetricRow
                label="Token Usage"
                score={breakdown.execution_components.token_complexity.score}
                weight={breakdown.execution_components.token_complexity.weight}
              >
                {hasExecutions ? (
                  <>
                    Avg: {Math.ceil(breakdown.details.token_stats.avg_tokens_per_run / 10)} credits/run •
                    Peak: {Math.ceil(breakdown.details.token_stats.peak_tokens / 10)} credits •
                    Total: {Math.ceil(breakdown.details.token_stats.total_tokens / 10).toLocaleString()} credits
                  </>
                ) : (
                  <span className="text-slate-400">No runs yet - using default value</span>
                )}
              </MetricRow>

              <MetricRow
                label="Execution Pattern"
                score={breakdown.execution_components.execution_complexity.score}
                weight={breakdown.execution_components.execution_complexity.weight}
              >
                {hasExecutions ? (
                  <>
                    {breakdown.details.execution_stats.total_executions} run{breakdown.details.execution_stats.total_executions !== 1 ? 's' : ''} •
                    {breakdown.details.execution_stats.success_rate.toFixed(0)}% success rate •
                    {breakdown.details.execution_stats.avg_duration_ms}ms avg duration
                  </>
                ) : (
                  <span className="text-slate-400">No runs yet - using default value</span>
                )}
              </MetricRow>

              <MetricRow
                label="Plugin Calls"
                score={breakdown.execution_components.plugin_complexity.score}
                weight={breakdown.execution_components.plugin_complexity.weight}
              >
                {hasExecutions ? (
                  <>
                    {breakdown.details.plugin_stats.unique_plugins} plugin{breakdown.details.plugin_stats.unique_plugins !== 1 ? 's' : ''} used •
                    {breakdown.details.plugin_stats.total_calls} total call{breakdown.details.plugin_stats.total_calls !== 1 ? 's' : ''} •
                    {breakdown.details.plugin_stats.avg_plugins_per_run.toFixed(1)} avg/run
                  </>
                ) : (
                  <span className="text-slate-400">No runs yet - using default value</span>
                )}
              </MetricRow>

              <MetricRow
                label="Workflow Execution"
                score={breakdown.execution_components.workflow_complexity.score}
                weight={breakdown.execution_components.workflow_complexity.weight}
              >
                {hasExecutions ? (
                  breakdown.details.workflow_stats.loops > 0 || breakdown.details.workflow_stats.branches > 0 ? (
                    <>
                      {breakdown.details.workflow_stats.branches > 0 && `${breakdown.details.workflow_stats.branches} conditional branch${breakdown.details.workflow_stats.branches !== 1 ? 'es' : ''}`}
                      {breakdown.details.workflow_stats.branches > 0 && breakdown.details.workflow_stats.loops > 0 && ' • '}
                      {breakdown.details.workflow_stats.loops > 0 && `${breakdown.details.workflow_stats.loops} loop iteration${breakdown.details.workflow_stats.loops !== 1 ? 's' : ''}`}
                    </>
                  ) : (
                    <span className="text-slate-400">Linear sequential execution</span>
                  )
                ) : (
                  <span className="text-slate-400">No runs yet - using default value</span>
                )}
              </MetricRow>

              <MetricRow
                label="Memory Complexity"
                score={breakdown.execution_components.memory_complexity.score}
                weight={breakdown.execution_components.memory_complexity.weight}
              >
                {hasExecutions && breakdown.details.memory_stats.memory_entry_count > 0 ? (
                  <>
                    {breakdown.details.memory_stats.memory_entry_count.toFixed(0)} avg entries •
                    {breakdown.details.memory_stats.avg_memory_tokens_per_run.toFixed(0)} tokens/run •
                    {(breakdown.details.memory_stats.memory_token_ratio * 100).toFixed(1)}% of input
                  </>
                ) : breakdown.details.memory_stats.memory_entry_count > 0 ? (
                  <>
                    {breakdown.details.memory_stats.memory_entry_count.toFixed(0)} avg entries loaded
                  </>
                ) : (
                  <span className="text-slate-400">No memory usage detected</span>
                )}
              </MetricRow>
            </div>
            <div className="mt-2 pt-2 border-t border-slate-200 text-[10px] text-slate-600">
              <span className="font-medium">Formula:</span> Token (30%) + Execution (25%) + Plugin (20%) + Workflow (15%) + Memory (10%)
            </div>
          </div>

          {/* Formula - Compact */}
          <div className="bg-slate-50 rounded-lg p-2">
            <div className="text-[10px] text-slate-600 text-center">
              <span className="font-semibold">Combined</span> = (Creation × 30%) + (Runtime × 70%) = <span className="font-bold text-slate-900">{combinedScore.toFixed(1)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Helper component for metric rows (with score bars) - Compact version
function MetricRow({
  label,
  score,
  weight,
  children
}: {
  label: string;
  score: number;
  weight: number;
  children: React.ReactNode;
}) {
  const percentage = (score / 10) * 100;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-700 font-medium">
          {label} <span className="text-slate-400 text-[10px]">({(weight * 100).toFixed(0)}%)</span>
        </span>
        <span className="font-mono font-semibold text-slate-900 text-xs">{score.toFixed(1)}/10</span>
      </div>
      <div className="relative h-1 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={`absolute inset-y-0 left-0 transition-all duration-300 ${
            score < 3
              ? 'bg-green-400'
              : score < 6
              ? 'bg-yellow-400'
              : score < 8
              ? 'bg-orange-400'
              : 'bg-red-400'
          }`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <div className="text-[10px] text-slate-500 ml-1">
        {children}
      </div>
    </div>
  );
}
