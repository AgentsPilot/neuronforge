'use client';

import { LucideIcon, AlertCircle, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import type { HealthStatus } from '@/lib/business-os/insights/StaticHealthRules';

// Trend data point for the mini graph
export interface TrendPoint {
  value: number;
  label?: string;
}

// Different trend graph types based on card context
export type TrendType = 'revenue' | 'people' | 'calendar' | 'collection';

interface StoryCardProps {
  icon: LucideIcon;
  iconColor: string;
  iconBgColor: string;
  title: string;
  mainValue: string;
  details?: Array<{ label: string; value: string | number; highlight?: boolean }>;
  explanation: string;
  health: HealthStatus;
  statusLabel: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  // Trend graph props
  trendType?: TrendType;
  trendData?: TrendPoint[];
  currentValue?: number;
  previousValue?: number;
}

// Health status colors
const healthColors: Record<HealthStatus, { bg: string; text: string; dot: string }> = {
  healthy: {
    bg: 'bg-green-100 dark:bg-green-900/30',
    text: 'text-green-700 dark:text-green-400',
    dot: 'bg-green-500'
  },
  watch: {
    bg: 'bg-amber-100 dark:bg-amber-900/30',
    text: 'text-amber-700 dark:text-amber-400',
    dot: 'bg-amber-500'
  },
  action: {
    bg: 'bg-red-100 dark:bg-red-900/30',
    text: 'text-red-700 dark:text-red-400',
    dot: 'bg-red-500'
  }
};

// Colors for each trend type
const trendColors: Record<TrendType, string> = {
  revenue: '#22C58B',    // Green
  people: '#8B5CF6',     // Purple
  calendar: '#14B8A6',   // Teal
  collection: '#F59E0B'  // Amber
};

// Mini trend graph component
function TrendGraph({
  type,
  data,
  currentValue,
  previousValue
}: {
  type: TrendType;
  data: TrendPoint[];
  currentValue: number;
  previousValue: number;
}) {
  const color = trendColors[type];
  const trend = currentValue > previousValue ? 'up' : currentValue < previousValue ? 'down' : 'neutral';
  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus;
  const trendColorClass = trend === 'up' ? 'text-green-500' : trend === 'down' ? 'text-red-500' : 'text-[var(--v2-text-muted)]';

  // Calculate percentage change
  const percentChange = previousValue > 0
    ? Math.round(((currentValue - previousValue) / previousValue) * 100)
    : currentValue > 0 ? 100 : 0;

  // Find max value for scaling
  const maxValue = Math.max(...data.map(d => d.value), 1);

  // Generate SVG path for area chart
  const width = 100;
  const height = 24;
  const padding = 2;
  const graphWidth = width - padding * 2;
  const graphHeight = height - padding * 2;

  const points = data.map((d, i) => {
    const x = padding + (i / (data.length - 1)) * graphWidth;
    const y = padding + graphHeight - (d.value / maxValue) * graphHeight;
    return { x, y };
  });

  // Create line path
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  // Create area path (for fill)
  const areaPath = `${linePath} L ${points[points.length - 1].x} ${height - padding} L ${padding} ${height - padding} Z`;

  return (
    <div className="flex items-center gap-2 mb-2">
      {/* Mini area chart */}
      <div className="flex-1">
        <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
          {/* Area fill */}
          <path
            d={areaPath}
            fill={color}
            fillOpacity={0.15}
          />
          {/* Line */}
          <path
            d={linePath}
            fill="none"
            stroke={color}
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Current value dot */}
          <circle
            cx={points[points.length - 1].x}
            cy={points[points.length - 1].y}
            r={2.5}
            fill={color}
          />
        </svg>
      </div>

      {/* Trend indicator */}
      <div className={`flex items-center gap-0.5 ${trendColorClass}`}>
        <TrendIcon className="w-3 h-3" />
        {percentChange !== 0 && (
          <span className="text-[10px] font-medium">
            {percentChange > 0 ? '+' : ''}{percentChange}%
          </span>
        )}
      </div>
    </div>
  );
}

export function StoryCard({
  icon: Icon,
  iconColor,
  iconBgColor,
  title,
  mainValue,
  details,
  explanation,
  health,
  statusLabel,
  action,
  trendType,
  trendData,
  currentValue = 0,
  previousValue = 0
}: StoryCardProps) {
  const { language } = useLanguage();
  const colors = healthColors[health];
  const isRTL = language === 'he';

  // Default trend data if not provided (simulated weekly data)
  const defaultTrendData: TrendPoint[] = [
    { value: Math.max(previousValue * 0.7, 1) },
    { value: Math.max(previousValue * 0.85, 1) },
    { value: Math.max(previousValue * 0.9, 1) },
    { value: Math.max(previousValue, 1) },
    { value: Math.max(currentValue * 0.95, 1) },
    { value: Math.max(currentValue, 1) }
  ];

  const graphData = trendData && trendData.length > 0 ? trendData : defaultTrendData;

  return (
    <div
      className="bg-[var(--v2-surface)] border border-[var(--v2-border)] p-3 flex flex-col h-full"
      style={{ borderRadius: 'var(--v2-radius-card)' }}
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      {/* Header with icon and title */}
      <div className="flex items-center gap-2 mb-2">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: iconBgColor }}
        >
          <Icon className="w-4 h-4" style={{ color: iconColor }} />
        </div>
        <h3 className="text-sm font-semibold text-[var(--v2-text-primary)]">
          {title}
        </h3>
      </div>

      {/* Trend graph - contextual to card type */}
      {trendType && (
        <TrendGraph
          type={trendType}
          data={graphData}
          currentValue={currentValue}
          previousValue={previousValue}
        />
      )}

      {/* Main value */}
      <div className="mb-2">
        <p className="text-xl font-bold text-[var(--v2-text-primary)]">
          {mainValue}
        </p>
      </div>

      {/* Details list */}
      {details && details.length > 0 && (
        <ul className="space-y-0.5 mb-2">
          {details.map((detail, index) => (
            <li
              key={index}
              className={`text-xs flex items-center gap-1.5 ${
                detail.highlight
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-[var(--v2-text-secondary)]'
              }`}
            >
              {detail.highlight ? (
                <AlertCircle className="w-3 h-3 flex-shrink-0" />
              ) : (
                <span className="text-[var(--v2-text-muted)]">•</span>
              )}
              <span>
                {detail.value} {detail.label}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Explanation - grows to fill space */}
      <p className="text-xs text-[var(--v2-text-secondary)] leading-relaxed flex-grow mb-2">
        "{explanation}"
      </p>

      {/* Footer with status and action */}
      <div className="flex items-center justify-between mt-auto pt-2 border-t border-[var(--v2-border)]">
        {/* Health status badge */}
        <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full ${colors.bg}`}>
          <div className={`w-1.5 h-1.5 rounded-full ${colors.dot}`} />
          <span className={`text-xs font-medium ${colors.text}`}>
            {statusLabel}
          </span>
        </div>

        {/* Action button */}
        {action && (
          <button
            onClick={action.onClick}
            className="text-xs font-medium text-[var(--v2-primary)] hover:underline"
          >
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}
