/**
 * Pattern Detector
 *
 * Detects patterns in execution progression (last 7 runs):
 * - sudden_drop: Volume drops >40% from stable baseline
 * - sudden_spike: Volume spikes >40% from stable baseline
 * - gradual_decline: Decreasing trend over 7 runs
 * - gradual_increase: Increasing trend over 7 runs
 * - step_change: Sudden shift that persists
 * - volatile: High variability between runs
 * - stable: Normal fluctuations within range
 *
 * This helps LLM distinguish between normal variation and significant changes.
 */

export interface ExecutionRun {
  execution_id: string;
  total_items: number;
  duration_ms: number;
  items_by_field?: Record<string, number>;
  executed_at: string;
}

export interface PatternAnalysis {
  type: 'stable' | 'sudden_drop' | 'sudden_spike' | 'gradual_decline' | 'gradual_increase' | 'step_change' | 'volatile';
  description: string;
  severity: 'normal' | 'attention' | 'critical';
  baseline_avg: number;
  current_value: number;
  change_percent: number;
}

export interface ProgressionContext {
  last7Runs: {
    total_items: number;
    duration_ms: number;
    field_counts: Record<string, number>;
    executed_at: string;
    time_ago: string;
  }[];
  pattern: PatternAnalysis;
  historicalBaseline: {
    avg_items: number;
    typical_range: { min: number; max: number };
    is_current_within_range: boolean;
  };
}

/**
 * Detect pattern in last 7 runs
 */
export function detectPattern(runs: ExecutionRun[]): PatternAnalysis {
  if (runs.length < 2) {
    return {
      type: 'stable',
      description: 'Insufficient data for pattern detection',
      severity: 'normal',
      baseline_avg: runs[0]?.total_items || 0,
      current_value: runs[0]?.total_items || 0,
      change_percent: 0,
    };
  }

  const items = runs.map(r => r.total_items);
  const current = items[0];

  // Calculate volatility (coefficient of variation)
  const mean = items.reduce((a, b) => a + b, 0) / items.length;
  const variance = items.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / items.length;
  const stdDev = Math.sqrt(variance);
  const cv = mean > 0 ? stdDev / mean : 0;

  // High volatility (CV > 0.3)
  if (cv > 0.3) {
    return {
      type: 'volatile',
      description: `Volume fluctuates significantly between runs (avg ${mean.toFixed(1)} ±${stdDev.toFixed(1)})`,
      severity: 'attention',
      baseline_avg: mean,
      current_value: current,
      change_percent: mean > 0 ? ((current - mean) / mean) * 100 : 0,
    };
  }

  // Calculate baseline from runs 2-6 (stable period before current run)
  const recent5Avg = items.slice(1, Math.min(6, items.length)).reduce((a, b) => a + b, 0) / Math.min(5, items.length - 1);

  // Sudden drop (>40% from stable baseline)
  const dropFromBaseline = recent5Avg > 0 ? ((current - recent5Avg) / recent5Avg) * 100 : 0;
  if (dropFromBaseline < -40) {
    return {
      type: 'sudden_drop',
      description: `Volume dropped ${Math.abs(dropFromBaseline).toFixed(0)}% from stable baseline of ${recent5Avg.toFixed(1)} items`,
      severity: 'critical',
      baseline_avg: recent5Avg,
      current_value: current,
      change_percent: dropFromBaseline,
    };
  }

  // Sudden spike (>40% from stable baseline)
  if (dropFromBaseline > 40) {
    return {
      type: 'sudden_spike',
      description: `Volume spiked ${dropFromBaseline.toFixed(0)}% from stable baseline of ${recent5Avg.toFixed(1)} items`,
      severity: 'attention',
      baseline_avg: recent5Avg,
      current_value: current,
      change_percent: dropFromBaseline,
    };
  }

  // Gradual decline (decreasing trend over 7 runs)
  const isDecreasing = items.every((val, i) => i === 0 || val <= items[i - 1]);
  if (isDecreasing && items.length >= 3 && items[0] < items[items.length - 1] * 0.7) {
    const declinePercent = items[items.length - 1] > 0
      ? ((items[0] - items[items.length - 1]) / items[items.length - 1]) * 100
      : 0;
    return {
      type: 'gradual_decline',
      description: `Volume declining steadily from ${items[items.length - 1]} to ${items[0]} over ${items.length} runs (${declinePercent.toFixed(0)}% decline)`,
      severity: 'attention',
      baseline_avg: items[items.length - 1],
      current_value: current,
      change_percent: declinePercent,
    };
  }

  // Gradual increase (increasing trend over 7 runs)
  const isIncreasing = items.every((val, i) => i === 0 || val >= items[i - 1]);
  if (isIncreasing && items.length >= 3 && items[0] > items[items.length - 1] * 1.3) {
    const increasePercent = items[items.length - 1] > 0
      ? ((items[0] - items[items.length - 1]) / items[items.length - 1]) * 100
      : 0;
    return {
      type: 'gradual_increase',
      description: `Volume increasing steadily from ${items[items.length - 1]} to ${items[0]} over ${items.length} runs (+${increasePercent.toFixed(0)}%)`,
      severity: 'normal',
      baseline_avg: items[items.length - 1],
      current_value: current,
      change_percent: increasePercent,
    };
  }

  // Step change (sudden shift that persists)
  if (items.length >= 7) {
    const first3Avg = items.slice(0, 3).reduce((a, b) => a + b, 0) / 3;
    const last3Avg = items.slice(4, 7).reduce((a, b) => a + b, 0) / 3;
    const stepChange = last3Avg > 0 ? ((first3Avg - last3Avg) / last3Avg) * 100 : 0;

    if (Math.abs(stepChange) > 30) {
      return {
        type: 'step_change',
        description: `Volume shifted from ${last3Avg.toFixed(1)} to ${first3Avg.toFixed(1)} (${stepChange > 0 ? '+' : ''}${stepChange.toFixed(0)}%)`,
        severity: 'attention',
        baseline_avg: last3Avg,
        current_value: first3Avg,
        change_percent: stepChange,
      };
    }
  }

  // Stable
  return {
    type: 'stable',
    description: `Volume stable around ${mean.toFixed(1)} items (±${stdDev.toFixed(1)})`,
    severity: 'normal',
    baseline_avg: mean,
    current_value: current,
    change_percent: mean > 0 ? ((current - mean) / mean) * 100 : 0,
  };
}

/**
 * Calculate historical baseline from longer history
 */
export function calculateBaseline(historicalData: { total_items: number }[]): {
  avgItems: number;
  range: { min: number; max: number };
} {
  if (historicalData.length === 0) {
    return { avgItems: 0, range: { min: 0, max: 0 } };
  }

  const items = historicalData.map(d => d.total_items);
  const avgItems = items.reduce((a, b) => a + b, 0) / items.length;
  const min = Math.min(...items);
  const max = Math.max(...items);

  return { avgItems, range: { min, max } };
}

/**
 * Check if current value is within historical range
 */
export function isWithinRange(
  current: { total_items: number },
  baseline: { range: { min: number; max: number } }
): boolean {
  return current.total_items >= baseline.range.min && current.total_items <= baseline.range.max;
}

/**
 * Get human-readable "time ago" string
 */
export function getTimeAgo(executedAt: string): string {
  const now = Date.now();
  const then = new Date(executedAt).getTime();
  const diffMs = now - then;

  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}
