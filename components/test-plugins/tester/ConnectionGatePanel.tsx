'use client';

// components/test-plugins/tester/ConnectionGatePanel.tsx
//
// FR12/D6 connection-completeness gate UI. Shows per-plugin connected state for the
// active userId and prompts to connect any missing Google Suite plugins. The tester
// form is not rendered until the gate is enabled.

import type { ConnectionGateResult } from '@/lib/plugins/tester/tester-types';

/** Live progress for the sequential "Refresh all tokens" run. */
export interface RefreshAllProgress {
  current: number;
  total: number;
  key: string;
}

interface ConnectionGatePanelProps {
  gate: ConnectionGateResult;
  pluginLabels?: Record<string, string>;
  /** Full-OAuth connect for genuinely disconnected (not-refreshable) plugins. */
  onConnect?: (pluginKey: string) => void;
  /** Simple token refresh (no OAuth popup) for expired-but-refreshable plugins. */
  onRefresh?: (pluginKey: string) => void;
  /** Sequentially refresh every required plugin whose token is expired. */
  onRefreshAll?: () => void;
  /** Disables connect/refresh buttons while an operation is in flight. */
  connectDisabled?: boolean;
  /** Non-null while the sequential refresh-all run is in progress. */
  refreshAllProgress?: RefreshAllProgress | null;
}

export function ConnectionGatePanel({
  gate,
  pluginLabels = {},
  onConnect,
  onRefresh,
  onRefreshAll,
  connectDisabled,
  refreshAllProgress,
}: ConnectionGatePanelProps) {
  if (gate.userIdRequired) {
    return (
      <div
        data-testid="gate-userid-required"
        style={{ padding: 14, border: '1px solid #ffc107', borderRadius: 5, backgroundColor: '#fffbea' }}
      >
        <strong>User ID required.</strong> Set a userId above to check plugin connections and run
        actions.
      </div>
    );
  }

  return (
    <div
      data-testid="connection-gate-panel"
      style={{ padding: 14, border: '1px solid #ccc', borderRadius: 5, marginBottom: 16 }}
    >
      <div style={{ fontWeight: 600, marginBottom: 8 }}>
        Google Suite connection status
        {gate.enabled ? (
          <span style={{ color: '#1a7431' }}> — all connected ✓</span>
        ) : (
          <span style={{ color: '#b02a37' }}> — {gate.missing.length} missing</span>
        )}
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {gate.perPlugin.map((p) => {
          // Three states, aligned with the User Configuration section:
          // connected (green ✓), expired (orange ⚠ — reconnect), not-connected (red ✗).
          const icon = p.connected ? '✓' : p.expired ? '⚠' : '✗';
          const color = p.connected ? '#1a7431' : p.expired ? '#b8860b' : '#dc3545';
          return (
            <li key={p.key} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
              <span style={{ color }}>{icon}</span>
              <span style={{ minWidth: 160 }}>{pluginLabels[p.key] || p.key}</span>
              {p.expired && <span style={{ color: '#b8860b', fontSize: 12 }}>token expired</span>}
              {/* Expired → PRIMARY simple token refresh (no OAuth popup, common case)… */}
              {p.expired && onRefresh && (
                <button
                  onClick={() => onRefresh(p.key)}
                  disabled={connectDisabled}
                  style={{
                    padding: '4px 12px',
                    backgroundColor: '#ffc107',
                    color: 'black',
                    border: 'none',
                    borderRadius: 3,
                    cursor: connectDisabled ? 'not-allowed' : 'pointer',
                    fontSize: 12,
                  }}
                >
                  Refresh token
                </button>
              )}
              {/* …PLUS a full-OAuth escape hatch, since a DEAD refresh token can't be
                  refreshed (it stays `active_expired` forever). Reconnect always recovers. */}
              {p.expired && onConnect && (
                <button
                  onClick={() => onConnect(p.key)}
                  disabled={connectDisabled}
                  style={{
                    padding: '4px 12px',
                    backgroundColor: 'transparent',
                    color: '#0a58ca',
                    border: '1px solid #0a58ca',
                    borderRadius: 3,
                    cursor: connectDisabled ? 'not-allowed' : 'pointer',
                    fontSize: 12,
                  }}
                >
                  Reconnect (OAuth)
                </button>
              )}
              {/* Genuinely disconnected (not refreshable) → full-OAuth connect. */}
              {!p.connected && !p.expired && onConnect && (
                <button
                  onClick={() => onConnect(p.key)}
                  disabled={connectDisabled}
                  style={{
                    padding: '4px 12px',
                    backgroundColor: '#007bff',
                    color: 'white',
                    border: 'none',
                    borderRadius: 3,
                    cursor: connectDisabled ? 'not-allowed' : 'pointer',
                    fontSize: 12,
                  }}
                >
                  Connect
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {/* Refresh all expired required tokens, one by one (sequential). */}
      {gate.expired.length > 0 && onRefreshAll && (
        <div style={{ marginTop: 10 }}>
          <button
            data-testid="refresh-all-tokens"
            onClick={onRefreshAll}
            disabled={connectDisabled}
            style={{
              padding: '6px 14px',
              backgroundColor: connectDisabled ? '#adb5bd' : '#ffc107',
              color: 'black',
              border: 'none',
              borderRadius: 3,
              cursor: connectDisabled ? 'not-allowed' : 'pointer',
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            {refreshAllProgress
              ? `Refreshing ${pluginLabels[refreshAllProgress.key] || refreshAllProgress.key}… (${refreshAllProgress.current}/${refreshAllProgress.total})`
              : `Refresh all tokens (${gate.expired.length})`}
          </button>
        </div>
      )}
      {!gate.enabled && (
        <div style={{ marginTop: 10, fontSize: 12, color: '#666' }}>
          Connect or refresh all five Google Suite plugins to enable the tester.
        </div>
      )}
    </div>
  );
}
