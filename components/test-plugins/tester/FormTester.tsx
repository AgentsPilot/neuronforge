'use client';

// components/test-plugins/tester/FormTester.tsx
//
// Container for the schema-driven Plugin API Tester (FR1-FR12). Mounted as a new mode
// inside the existing /test-plugins-v2 Plugins tab. Fully dependency-injected so it is
// testable in isolation (RTL) with mocked getActionSchema / executeAction (SA decision 3).
//
// Flow: gate (FR12) → plugin+action selectors → schema-derived form (FR3) with an
// advanced raw-JSON toggle (FR4) → destructive confirm gate (FR6/CR1) → live Run via
// the existing executeAction path (FR5) → current-result (FR7) + side-console entry (FR8).
// No plugin/action hardcoding (F5) — everything derives from the fetched schema.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ActionSchema, FormFieldDescriptor } from '@/lib/plugins/tester/tester-types';
import type { ExecutionResult } from '@/lib/types/plugin-types';
import { buildFormFields, getConfirmation } from '@/lib/plugins/tester/schema-to-form';
import {
  assembleParameters,
  canRun,
  computeMissingRequired,
  seedInitialValues,
  setByPath,
  type FormValues,
} from '@/lib/plugins/tester/form-values';
import {
  evaluateConnectionGate,
  REQUIRED_GOOGLE_SUITE_PLUGIN_KEYS,
  INTERNAL_TESTER_PLUGIN_KEYS,
  type ConnectionStatusLike,
} from '@/lib/plugins/tester/connection-gate';
import { useSideConsole } from '@/hooks/useSideConsole';
import { SchemaForm } from './SchemaForm';
import { ConnectionGatePanel, type RefreshAllProgress } from './ConnectionGatePanel';
import { DestructiveConfirm } from './DestructiveConfirm';
import { ResultView } from './ResultView';
import { SideConsole } from './SideConsole';

export interface FormTesterProps {
  userId: string;
  /** Live plugin status from the page (single source of truth — includes active_expired). */
  connectionStatus: ConnectionStatusLike | null;
  /** Fetch per-action schema metadata (backed by GET /api/plugins/action-schema). */
  getActionSchema: (plugin: string, action?: string) => Promise<{ actions: ActionSchema[] }>;
  /** Live execution via the existing executeAction path (FR5). */
  executeAction: (
    userId: string,
    plugin: string,
    action: string,
    params: Record<string, unknown>
  ) => Promise<ExecutionResult>;
  /** Non-blocking per-execution audit (CR2). */
  recordAudit?: (input: {
    targetUserId: string;
    plugin: string;
    action: string;
    outcome: 'success' | 'error';
    durationMs: number;
  }) => void;
  /** Full-OAuth connect for genuinely disconnected plugins. */
  onConnect?: (pluginKey: string) => void;
  /** Simple token refresh (no OAuth) for a single expired-but-refreshable plugin. */
  onRefresh?: (pluginKey: string) => void;
  /** Sequentially refresh all required plugins whose tokens are expired. */
  onRefreshAll?: () => void;
  connectDisabled?: boolean;
  /** Live progress for the sequential refresh-all run. */
  refreshAllProgress?: RefreshAllProgress | null;
  pluginLabels?: Record<string, string>;
  /** PARAMETER_TEMPLATES[plugin][action] — convenience seed only (SA decision 4). */
  parameterTemplates?: Record<string, Record<string, unknown>>;
}

export function FormTester({
  userId,
  connectionStatus,
  getActionSchema,
  executeAction,
  recordAudit,
  onConnect,
  onRefresh,
  onRefreshAll,
  connectDisabled,
  refreshAllProgress,
  pluginLabels = {},
  parameterTemplates = {},
}: FormTesterProps) {
  const gate = useMemo(
    () => evaluateConnectionGate(userId, connectionStatus),
    [userId, connectionStatus]
  );

  const [selectedPlugin, setSelectedPlugin] = useState('');
  const [selectedAction, setSelectedAction] = useState('');
  const [actionSchemas, setActionSchemas] = useState<ActionSchema[]>([]);
  const [values, setValues] = useState<FormValues>({});
  const [advanced, setAdvanced] = useState(false);
  const [rawJson, setRawJson] = useState('{}');
  const [rawJsonError, setRawJsonError] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState(false);
  const [result, setResult] = useState<ExecutionResult | null>(null);
  const [running, setRunning] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const sideConsole = useSideConsole();

  const activeSchema: ActionSchema | undefined = useMemo(
    () => actionSchemas.find((a) => a.name === selectedAction),
    [actionSchemas, selectedAction]
  );

  const fields: FormFieldDescriptor[] = useMemo(
    () => (activeSchema ? buildFormFields(activeSchema) : []),
    [activeSchema]
  );

  const confirmation = useMemo(
    () => (activeSchema ? getConfirmation(activeSchema) : null),
    [activeSchema]
  );

  // Load the plugin's action schemas when a plugin is selected.
  useEffect(() => {
    if (!selectedPlugin) {
      setActionSchemas([]);
      return;
    }
    let cancelled = false;
    setLoadError(null);
    getActionSchema(selectedPlugin)
      .then((res) => {
        if (!cancelled) setActionSchemas(res.actions || []);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to load schema');
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPlugin, getActionSchema]);

  // Track the plugin/action the form was last seeded for, so a background re-fetch of
  // the SAME action (which produces a new activeSchema object identity) never re-seeds
  // and wipes the user's typed input. We only (re)seed when the user actually switches
  // to a DIFFERENT action — keyed off the stable `${plugin}/${action}` string.
  const lastSeededKey = useRef<string | null>(null);
  useEffect(() => {
    // Action deselected → clear the form and reset seed tracking.
    if (!selectedAction) {
      setValues({});
      lastSeededKey.current = null;
      return;
    }
    // Wait until the schema for the selected action is actually available.
    if (!activeSchema) return;

    const seedKey = `${selectedPlugin}/${selectedAction}`;
    if (lastSeededKey.current === seedKey) return; // same action re-fetched → keep input
    lastSeededKey.current = seedKey;

    const template = parameterTemplates[selectedPlugin]?.[selectedAction] as
      | Record<string, unknown>
      | undefined;
    setValues(seedInitialValues(buildFormFields(activeSchema), template));
    setResult(null);
    setPendingConfirm(false);
    setAdvanced(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPlugin, selectedAction, activeSchema]);

  const missingRequired = useMemo(() => computeMissingRequired(fields, values), [fields, values]);

  // Set a nested value by absolute path (supports object groups + row indices).
  const handleChange = useCallback((path: (string | number)[], value: unknown) => {
    setValues((prev) => setByPath(prev, path, value));
  }, []);

  // Assemble the parameters to send: raw JSON in advanced mode, else from the form.
  const assemble = useCallback((): { ok: true; params: Record<string, unknown> } | { ok: false; error: string } => {
    if (advanced) {
      try {
        return { ok: true, params: JSON.parse(rawJson) };
      } catch {
        return { ok: false, error: 'Invalid JSON in advanced editor' };
      }
    }
    try {
      return { ok: true, params: assembleParameters(fields, values) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Failed to assemble parameters' };
    }
  }, [advanced, rawJson, fields, values]);

  const doRun = useCallback(async () => {
    if (!userId.trim() || !selectedPlugin || !selectedAction) return;
    const assembled = assemble();
    if (!assembled.ok) {
      setRawJsonError(assembled.error);
      return;
    }
    setRawJsonError(null);
    setPendingConfirm(false);
    setRunning(true);
    const startedAt = Date.now();
    let outcome: 'success' | 'error' = 'error';
    try {
      const res = await executeAction(userId, selectedPlugin, selectedAction, assembled.params);
      outcome = res.success ? 'success' : 'error';
      setResult(res);
      sideConsole.append({
        userId,
        plugin: selectedPlugin,
        action: selectedAction,
        request: assembled.params,
        response: res.success ? res.data ?? res : { error: res.error, message: res.message },
        outcome,
        durationMs: Date.now() - startedAt,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Execution error';
      setResult({ success: false, error: message, message });
      sideConsole.append({
        userId,
        plugin: selectedPlugin,
        action: selectedAction,
        request: assembled.params,
        response: { error: message },
        outcome: 'error',
        durationMs: Date.now() - startedAt,
      });
    } finally {
      // Non-blocking per-execution audit (CR2).
      recordAudit?.({
        targetUserId: userId,
        plugin: selectedPlugin,
        action: selectedAction,
        outcome,
        durationMs: Date.now() - startedAt,
      });
      setRunning(false);
    }
  }, [assemble, sideConsole, executeAction, recordAudit, selectedAction, selectedPlugin, userId]);

  // Run button: gate destructive actions behind an explicit confirm (FR6/CR1).
  const handleRunClick = useCallback(() => {
    if (advanced ? false : !canRun(fields, values)) return;
    if (confirmation?.requiresConfirm) {
      setPendingConfirm(true);
      return;
    }
    void doRun();
  }, [advanced, confirmation, doRun, fields, values]);

  // ── No userId at all: show the connection panel only ────────────────────────
  // Internal (db_active) plugins are usable with just a userId, so the FULL block is now
  // only "userId required". The Google Suite OAuth completeness gate still governs which
  // Google plugins are selectable (below) — it no longer hides the whole tester, since that
  // would also hide the internal plugins that don't need those connections.
  if (gate.userIdRequired) {
    return (
      <div>
        <SectionTitle />
        <ConnectionGatePanel
          gate={gate}
          pluginLabels={pluginLabels}
          onConnect={onConnect}
          onRefresh={onRefresh}
          onRefreshAll={onRefreshAll}
          connectDisabled={connectDisabled}
          refreshAllProgress={refreshAllProgress}
        />
      </div>
    );
  }

  const connectedGoogleKeys = REQUIRED_GOOGLE_SUITE_PLUGIN_KEYS.filter((k) =>
    gate.perPlugin.find((p) => p.key === k)?.connected
  );

  // Google Suite plugins stay behind the all-five completeness gate (FR12); internal
  // db_active plugins (e.g. crm) are always selectable once a userId is present.
  const selectablePluginKeys: string[] = [
    ...(gate.enabled ? connectedGoogleKeys : []),
    ...INTERNAL_TESTER_PLUGIN_KEYS,
  ];

  const runDisabled = running || (!advanced && !canRun(fields, values));

  return (
    <div>
      <SectionTitle />
      {/* Keep the panel interactive (connect/refresh) until the Google gate is satisfied,
          so Google testing can still be unlocked; read-only once all five are connected. */}
      <ConnectionGatePanel
        gate={gate}
        pluginLabels={pluginLabels}
        {...(gate.enabled
          ? {}
          : { onConnect, onRefresh, onRefreshAll, connectDisabled, refreshAllProgress })}
      />

      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
        {/* Left: selectors + form */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: 13 }} htmlFor="tester-plugin">
              Plugin
            </label>
            <select
              id="tester-plugin"
              value={selectedPlugin}
              onChange={(e) => {
                setSelectedPlugin(e.target.value);
                setSelectedAction('');
                setResult(null);
              }}
              style={{ width: 320, padding: 8, fontSize: 13 }}
            >
              <option value="">-- select plugin --</option>
              {selectablePluginKeys.map((key) => (
                <option key={key} value={key}>
                  {pluginLabels[key] || key}
                </option>
              ))}
            </select>
          </div>

          {selectedPlugin && (
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: 13 }} htmlFor="tester-action">
                Action
              </label>
              <select
                id="tester-action"
                value={selectedAction}
                onChange={(e) => setSelectedAction(e.target.value)}
                style={{ width: 320, padding: 8, fontSize: 13 }}
              >
                <option value="">-- select action --</option>
                {actionSchemas.map((a) => (
                  <option key={a.name} value={a.name}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {loadError && <div style={{ color: '#dc3545', fontSize: 13 }}>{loadError}</div>}

          {activeSchema && (
            <>
              {confirmation?.isDestructiveStyle && (
                <div style={{ marginBottom: 10 }}>
                  <span
                    style={{
                      backgroundColor: '#dc3545',
                      color: 'white',
                      padding: '2px 8px',
                      borderRadius: 3,
                      fontSize: 11,
                      fontWeight: 600,
                    }}
                  >
                    DESTRUCTIVE
                  </span>
                </div>
              )}

              {confirmation && confirmation.advisories.length > 0 && (
                <div
                  style={{
                    marginBottom: 10,
                    padding: 8,
                    backgroundColor: '#fffbea',
                    border: '1px solid #ffe08a',
                    borderRadius: 3,
                    fontSize: 12,
                  }}
                >
                  {confirmation.advisories.map((a, i) => (
                    <div key={i}>ℹ {a}</div>
                  ))}
                </div>
              )}

              <div style={{ marginBottom: 10 }}>
                <label style={{ fontSize: 12 }}>
                  <input
                    type="checkbox"
                    checked={advanced}
                    onChange={(e) => {
                      const next = e.target.checked;
                      if (next) {
                        // Seed the raw editor from the current form assembly.
                        const assembled = assemble();
                        setRawJson(JSON.stringify(assembled.ok ? assembled.params : {}, null, 2));
                      }
                      setAdvanced(next);
                    }}
                  />{' '}
                  Advanced (raw JSON)
                </label>
              </div>

              {advanced ? (
                <div>
                  <textarea
                    aria-label="Raw JSON parameters"
                    rows={12}
                    value={rawJson}
                    onChange={(e) => setRawJson(e.target.value)}
                    style={{ width: '100%', padding: 8, fontFamily: 'monospace', fontSize: 12, border: '1px solid #ccc', borderRadius: 3 }}
                  />
                  {rawJsonError && <div style={{ color: '#dc3545', fontSize: 12 }}>{rawJsonError}</div>}
                </div>
              ) : (
                <SchemaForm fields={fields} values={values} onChange={handleChange} />
              )}

              {!advanced && missingRequired.length > 0 && (
                <div style={{ marginTop: 8, fontSize: 12, color: '#b02a37' }}>
                  Required: {missingRequired.join(', ')}
                </div>
              )}

              <button
                onClick={handleRunClick}
                disabled={runDisabled}
                style={{
                  marginTop: 14,
                  padding: '10px 20px',
                  backgroundColor: runDisabled ? '#adb5bd' : '#28a745',
                  color: 'white',
                  border: 'none',
                  borderRadius: 3,
                  cursor: runDisabled ? 'not-allowed' : 'pointer',
                }}
              >
                {running ? 'Running...' : 'Run'}
              </button>

              {pendingConfirm && confirmation?.message && (
                <DestructiveConfirm
                  message={confirmation.message}
                  onConfirm={() => void doRun()}
                  onCancel={() => setPendingConfirm(false)}
                />
              )}

              <ResultView result={result} />
            </>
          )}
        </div>

        {/* Right: FR8 side console */}
        <div style={{ width: 360, flexShrink: 0 }}>
          <SideConsole entries={sideConsole.entries} onClear={sideConsole.clear} />
        </div>
      </div>
    </div>
  );
}

function SectionTitle() {
  return (
    <h2 style={{ marginTop: 0 }}>
      Form Tester{' '}
      <span style={{ fontSize: 12, fontWeight: 400, color: '#666' }}>
        (schema-driven · live execution)
      </span>
    </h2>
  );
}
