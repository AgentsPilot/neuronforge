// components/agents/AgentIntensityCard.tsx
// Card component to display agent complexity score in agent details page

'use client';

import { useState, useEffect } from 'react';
import { Activity, ChevronDown, ChevronUp, Zap, Settings } from 'lucide-react';
import type { IntensityBreakdown } from '@/lib/types/intensity';
import {
  getIntensityBadgeColor,
  classifyIntensityRange,
} from '@/lib/types/intensity';

interface AgentIntensityCardProps {
  agentId: string;
}

export function AgentIntensityCard({ agentId }: AgentIntensityCardProps) {
  const [breakdown, setBreakdown] = useState<IntensityBreakdown | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    fetchIntensity();
  }, [agentId]);

  const fetchIntensity = async () => {
    try {
      const response = await fetch(`/api/agents/${agentId}/intensity`);
      if (response.ok) {
        const data = await response.json();
        setBreakdown(data);
      }
    } catch (err) {
      console.error('Error fetching intensity:', err);
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

  if (!breakdown) return null;

  const combinedScore = breakdown.combined_score;
  const intensityRange = classifyIntensityRange(combinedScore);
  const badgeColorClass = getIntensityBadgeColor(combinedScore);
  const hasExecutions = breakdown.details.execution_stats.total_executions > 0;

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-slate-700" />
          <h3 className="text-lg font-semibold text-slate-900">Agent Complexity</h3>
        </div>
        <span className={`text-xs px-3 py-1 rounded-full ${badgeColorClass} font-medium`}>
          {intensityRange}
        </span>
      </div>

      {/* Main Score Display */}
      <div className="mb-6">
        <div className="flex items-end gap-2 mb-2">
          <div className="text-5xl font-bold text-slate-900">
            {combinedScore.toFixed(1)}
          </div>
          <div className="text-lg text-slate-500 mb-2">/10</div>
        </div>
        <div className="text-sm text-slate-600 mb-3">
          Credit multiplier: <span className="font-semibold text-slate-900">{breakdown.combined_multiplier.toFixed(2)}x</span>
        </div>

        {/* Progress Bar */}
        <div className="relative h-3 bg-slate-100 rounded-full overflow-hidden">
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
      </div>

      {/* Score Breakdown - Compact */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        {/* Creation Complexity */}
        <div className="bg-slate-50 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <Settings className="h-4 w-4 text-slate-600" />
            <div className="text-xs font-medium text-slate-600">Creation Complexity</div>
          </div>
          <div className="text-2xl font-bold text-slate-900 mb-1">
            {breakdown.creation_score.toFixed(1)}
          </div>
          <div className="text-xs text-slate-500">
            Weight: 30% of total
          </div>
        </div>

        {/* Runtime Complexity */}
        <div className="bg-slate-50 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="h-4 w-4 text-slate-600" />
            <div className="text-xs font-medium text-slate-600">Runtime Complexity</div>
          </div>
          <div className="text-2xl font-bold text-slate-900 mb-1">
            {breakdown.execution_score.toFixed(1)}
          </div>
          <div className="text-xs text-slate-500">
            Weight: 70% of total
            {!hasExecutions && <span className="text-amber-600"> (not run yet)</span>}
          </div>
        </div>
      </div>

      {/* Pilot Credits - Creation and Execution */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        {/* Creation Pilot Credits */}
        {breakdown.details.creation_stats && breakdown.details.creation_stats.creation_tokens_used > 0 && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <div className="text-xs text-blue-700 mb-1">Creation Credits</div>
            <div className="text-lg font-bold text-blue-900">
              {Math.ceil(breakdown.details.creation_stats.creation_tokens_used / 10).toLocaleString()}
            </div>
          </div>
        )}

        {/* Execution Pilot Credits */}
        {breakdown.details.token_stats && breakdown.details.token_stats.total_tokens > 0 && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-3">
            <div className="text-xs text-green-700 mb-1">Execution Credits</div>
            <div className="text-lg font-bold text-green-900">
              {Math.ceil(breakdown.details.token_stats.total_tokens / 10).toLocaleString()}
            </div>
          </div>
        )}
      </div>

      {/* Expand/Collapse Button */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full py-2 text-sm text-slate-600 hover:text-slate-900 flex items-center justify-center gap-2 border-t border-slate-200 mt-4 pt-4"
      >
        {expanded ? (
          <>
            <span>Hide technical details</span>
            <ChevronUp className="h-4 w-4" />
          </>
        ) : (
          <>
            <span>Show technical details</span>
            <ChevronDown className="h-4 w-4" />
          </>
        )}
      </button>

      {/* Expanded Technical Details */}
      {expanded && (
        <div className="mt-4 pt-4 border-t border-slate-200 space-y-6">
          {/* Creation Complexity Breakdown - 4 Dimensions */}
          <div>
            <h4 className="text-sm font-semibold text-slate-700 mb-3">
              Creation Complexity - 4 Dimensions
              <span className="text-xs font-normal text-slate-500 ml-2">(Creation Score: {breakdown.creation_score.toFixed(1)}/10)</span>
            </h4>
            <div className="space-y-3">
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
            <div className="mt-3 pt-3 border-t border-slate-200 text-xs text-slate-600">
              <span className="font-medium">Weighted calculation:</span> Workflow (50%) + Plugins (30%) + I/O (20%) + Trigger bonus
            </div>
          </div>

          {/* Runtime Complexity Breakdown - 4 Dimensions */}
          <div>
            <h4 className="text-sm font-semibold text-slate-700 mb-3">
              Runtime Complexity - 4 Dimensions
              <span className="text-xs font-normal text-slate-500 ml-2">(Runtime Score: {breakdown.execution_score.toFixed(1)}/10)</span>
              {!hasExecutions && <span className="text-xs font-normal text-amber-600 ml-2">(defaults until first run)</span>}
            </h4>
            <div className="space-y-3">
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
            </div>
            <div className="mt-3 pt-3 border-t border-slate-200 text-xs text-slate-600">
              <span className="font-medium">Weighted calculation:</span> Token (35%) + Execution (25%) + Plugin (25%) + Workflow (15%)
            </div>
          </div>

          {/* Formula */}
          <div className="bg-slate-50 rounded-lg p-4">
            <div className="text-xs text-slate-600 text-center">
              <span className="font-semibold">Combined Score</span> =
              (Creation × 30%) + (Runtime × 70%) =
              <span className="font-bold text-slate-900"> {combinedScore.toFixed(1)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Helper component for metric rows (with score bars)
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
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-700 font-medium">
          {label} <span className="text-slate-400 text-xs">({(weight * 100).toFixed(0)}%)</span>
        </span>
        <span className="font-mono font-semibold text-slate-900 text-sm">{score.toFixed(1)}/10</span>
      </div>
      <div className="relative h-1.5 bg-slate-100 rounded-full overflow-hidden">
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
      <div className="text-xs text-slate-500 ml-1">
        {children}
      </div>
    </div>
  );
}
