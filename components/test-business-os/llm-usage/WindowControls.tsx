'use client';

import type { AutoRefreshInterval, AutoRefreshStatus } from '@/hooks/llmUsageRefreshMachine';
import { AUTO_REFRESH_INTERVALS } from '@/hooks/llmUsageRefreshMachine';
import { isoToLocalInput, localInputToIso, localTimeZoneName } from './formatters';

interface WindowControlsProps {
  startIso: string;
  onStartChange: (iso: string) => void;
  onStartNow: () => void;
  onRefresh: () => void;
  refreshDisabled: boolean;
  hasAccount: boolean;
  loading: boolean;
  autoStatus: AutoRefreshStatus;
  intervalSec: AutoRefreshInterval;
  onToggleAuto: (on: boolean) => void;
  onIntervalChange: (value: AutoRefreshInterval) => void;
}

const AUTO_STATUS_TEXT: Record<AutoRefreshStatus, string> = {
  off: 'off',
  running: 'running',
  paused_hidden: 'paused (browser tab was hidden) — Refresh to resume',
  stopped_input_change: 'stopped (business or start time changed) — Refresh to resume',
};

/** FR-9 and FR-10: start time, Start now, Refresh, auto-refresh. */
export function WindowControls({
  startIso,
  onStartChange,
  onStartNow,
  onRefresh,
  refreshDisabled,
  hasAccount,
  loading,
  autoStatus,
  intervalSec,
  onToggleAuto,
  onIntervalChange,
}: WindowControlsProps) {
  const autoOn = autoStatus !== 'off';

  return (
    <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', fontSize: '13px' }}>
      <label htmlFor="llmUsageStart">Start time ({localTimeZoneName()}):</label>
      <input
        id="llmUsageStart"
        type="datetime-local"
        step={1}
        value={isoToLocalInput(startIso)}
        onChange={(e) => {
          const iso = localInputToIso(e.target.value);
          if (iso) onStartChange(iso);
        }}
        style={{ padding: '6px 8px', fontSize: '13px' }}
      />
      <button type="button" onClick={onStartNow} style={{ padding: '6px 12px', cursor: 'pointer' }}>
        Start now
      </button>
      <button
        type="button"
        onClick={onRefresh}
        disabled={refreshDisabled}
        style={{
          padding: '6px 16px',
          backgroundColor: '#007bff',
          color: 'white',
          border: 'none',
          borderRadius: '3px',
          cursor: refreshDisabled ? 'not-allowed' : 'pointer',
          opacity: refreshDisabled ? 0.6 : 1,
        }}
      >
        {loading ? 'Refreshing…' : 'Refresh'}
      </button>
      <label style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
        <input
          type="checkbox"
          checked={autoOn}
          disabled={!hasAccount}
          onChange={(e) => onToggleAuto(e.target.checked)}
        />
        Auto-refresh every
      </label>
      <select
        aria-label="Auto-refresh interval"
        value={intervalSec}
        onChange={(e) => onIntervalChange(Number(e.target.value) as AutoRefreshInterval)}
        style={{ padding: '4px' }}
      >
        {AUTO_REFRESH_INTERVALS.map((s) => (
          <option key={s} value={s}>
            {s} s
          </option>
        ))}
      </select>
      <span data-testid="llm-usage-auto-status" style={{ color: '#666' }}>
        Auto-refresh: {AUTO_STATUS_TEXT[autoStatus]}
      </span>
    </div>
  );
}
