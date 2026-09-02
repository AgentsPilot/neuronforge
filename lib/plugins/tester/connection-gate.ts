// lib/plugins/tester/connection-gate.ts
//
// PURE helper for the FR12/D6 connection-completeness access gate.
// The tester is enabled ONLY when the active userId has OAuth connections to all
// five Google Suite plugins. This is v1 coverage scoping (D2), isolated in ONE
// named constant — it is a scope boundary, NOT behavioral per-plugin hardcoding.
// The form/gate logic itself stays schema-generic.

import type { ConnectionGateResult } from './tester-types';

/**
 * v1 required plugin coverage (D2). Extending coverage later is a one-line edit here.
 * Keys match plugin definition keys (see lib/plugins/definitions/*-plugin-v2.json).
 */
export const REQUIRED_GOOGLE_SUITE_PLUGIN_KEYS = [
  'google-drive',
  'google-sheets',
  'google-docs',
  'google-mail',
  'google-calendar',
] as const;

/**
 * Minimal shape of the connection status the gate needs (subset of UserPluginStatus).
 * `active_expired` mirrors the page's `userStatus.active_expired` so the panel aligns
 * with the User Configuration section's "expired" count (single source of truth).
 */
export interface ConnectionStatusLike {
  connected: Array<{ key: string }>;
  active_expired?: string[];
}

/**
 * Sequentially refresh a set of plugin keys, ONE BY ONE (awaiting each before the
 * next), reporting progress. Pure orchestration helper — the caller supplies the
 * per-key refresh (reusing the page's existing refreshPluginToken path) and a progress
 * sink. Keeps the "refresh all" loop testable without the page/DOM. F5-generic: it just
 * iterates the given keys, no per-plugin logic.
 *
 * @returns the keys that failed to refresh (refreshOne threw), in order.
 */
export async function runSequentialRefresh(
  keys: readonly string[],
  refreshOne: (key: string) => Promise<void>,
  onProgress?: (progress: { current: number; total: number; key: string }) => void
): Promise<string[]> {
  const failed: string[] = [];
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    onProgress?.({ current: i + 1, total: keys.length, key });
    try {
      await refreshOne(key);
    } catch {
      // Surface as a failed key; continue with the rest (don't wedge the run).
      failed.push(key);
    }
  }
  return failed;
}

/**
 * Evaluate the connection-completeness gate.
 *
 * A required plugin is only "genuinely connected" (runnable) when it is in `connected`
 * and NOT in `active_expired`. Expired plugins are surfaced distinctly (reconnect) and
 * keep the gate locked — this keeps the panel consistent with User Configuration, which
 * reports connected / expired / disconnected separately.
 *
 * @param userId    active userId from the test page (FR11). Empty → gate short-circuits.
 * @param status    the user's plugin connection status, or null if not yet loaded.
 * @param requiredKeys required plugin keys (defaults to the five Google Suite keys).
 */
export function evaluateConnectionGate(
  userId: string | null | undefined,
  status: ConnectionStatusLike | null | undefined,
  requiredKeys: readonly string[] = REQUIRED_GOOGLE_SUITE_PLUGIN_KEYS
): ConnectionGateResult {
  // FR11: empty userId blocks — no status fetch, no run.
  if (!userId || !userId.trim()) {
    return {
      enabled: false,
      perPlugin: requiredKeys.map((key) => ({ key, connected: false, expired: false })),
      missing: [...requiredKeys],
      expired: [],
      userIdRequired: true,
    };
  }

  const connectedSet = new Set((status?.connected || []).map((p) => p.key));
  const expiredSet = new Set(status?.active_expired || []);

  const perPlugin = requiredKeys.map((key) => {
    const expired = expiredSet.has(key);
    // Expired tokens are not runnable → not "connected" for gate purposes.
    const connected = connectedSet.has(key) && !expired;
    return { key, connected, expired };
  });

  const missing = perPlugin.filter((p) => !p.connected).map((p) => p.key);
  const expired = perPlugin.filter((p) => p.expired).map((p) => p.key);

  return {
    enabled: missing.length === 0,
    perPlugin,
    missing,
    expired,
    userIdRequired: false,
  };
}
