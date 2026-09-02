'use client';

// components/test-business-os/BosModuleTester.tsx
//
// Schema-driven tester for Business OS internal MODULES (the `visibility: 'business_os'`
// plugins — CRM first). A session-model sibling of the /test-plugins-v2 Form Tester, with two
// differences: (1) NO OAuth/connection gate — internal modules use the db_active access
// strategy, enforced server-side, so eligibility is a runtime check not a UI gate; (2) it runs
// as the page's logged-in SESSION user (the page threads its id into executeAction). Reuses the
// generic schema→form building blocks, so there is no plugin/action hardcoding here.

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
import { SchemaForm } from '@/components/test-plugins/tester/SchemaForm';
import { ResultView } from '@/components/test-plugins/tester/ResultView';
import { DestructiveConfirm } from '@/components/test-plugins/tester/DestructiveConfirm';

export interface BosModule {
  key: string;
  name: string;
  description?: string;
}

export interface BosModuleTesterProps {
  /** Logged-in session user id — modules run as this user (db_active gate applies server-side). */
  sessionUserId: string | null;
  /** The business_os-visibility plugins to expose (fetched by the page). */
  modules: BosModule[];
  /** Load an action's schema (GET /api/plugins/action-schema). */
  getActionSchema: (pluginKey: string) => Promise<{ actions: ActionSchema[] }>;
  /** Run an operation as the session user (POST /api/plugins/execute). */
  executeAction: (
    pluginKey: string,
    actionName: string,
    params: Record<string, unknown>
  ) => Promise<ExecutionResult | null>;
}

export function BosModuleTester({
  sessionUserId,
  modules,
  getActionSchema,
  executeAction,
}: BosModuleTesterProps) {
  const [selectedModule, setSelectedModule] = useState('');
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

  const missingRequired = useMemo(() => computeMissingRequired(fields, values), [fields, values]);

  // Load the module's action schemas when a module is selected.
  useEffect(() => {
    if (!selectedModule) {
      setActionSchemas([]);
      return;
    }
    let cancelled = false;
    setLoadError(null);
    getActionSchema(selectedModule)
      .then((res) => {
        if (!cancelled) setActionSchemas(res.actions || []);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to load schema');
      });
    return () => {
      cancelled = true;
    };
  }, [selectedModule, getActionSchema]);

  // Seed the form when the selected action changes. Keyed off `${module}/${action}` so a
  // background re-fetch of the SAME action never re-seeds and wipes the user's typed input.
  const lastSeededKey = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedAction) {
      setValues({});
      lastSeededKey.current = null;
      return;
    }
    if (!activeSchema) return;
    const seedKey = `${selectedModule}/${selectedAction}`;
    if (lastSeededKey.current === seedKey) return;
    lastSeededKey.current = seedKey;
    setValues(seedInitialValues(buildFormFields(activeSchema)));
    setResult(null);
    setPendingConfirm(false);
    setAdvanced(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedModule, selectedAction, activeSchema]);

  const handleChange = useCallback((path: (string | number)[], value: unknown) => {
    setValues((prev) => setByPath(prev, path, value));
  }, []);

  const assemble = useCallback(():
    | { ok: true; params: Record<string, unknown> }
    | { ok: false; error: string } => {
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
    if (!sessionUserId || !selectedModule || !selectedAction) return;
    const assembled = assemble();
    if (!assembled.ok) {
      setRawJsonError(assembled.error);
      return;
    }
    setRawJsonError(null);
    setPendingConfirm(false);
    setRunning(true);
    try {
      const res = await executeAction(selectedModule, selectedAction, assembled.params);
      setResult(res);
    } finally {
      setRunning(false);
    }
  }, [assemble, executeAction, selectedAction, selectedModule, sessionUserId]);

  const handleRunClick = useCallback(() => {
    if (!advanced && !canRun(fields, values)) return;
    if (confirmation?.requiresConfirm) {
      setPendingConfirm(true);
      return;
    }
    void doRun();
  }, [advanced, confirmation, doRun, fields, values]);

  if (!sessionUserId) {
    return (
      <div style={{ color: '#dc3545', fontSize: 14 }}>
        Sign in first — Business OS modules run as your session user (and require an active
        Business OS profile; seed one with <strong>Account Setup</strong> on the{' '}
        <strong>Overview</strong> tab).
      </div>
    );
  }

  const runDisabled = running || (!advanced && !canRun(fields, values));

  return (
    <div>
      <p style={{ color: '#666', fontSize: 13, marginTop: 0 }}>
        Runs the selected module operation as <strong>your session user</strong> via{' '}
        <code>POST /api/plugins/execute</code>. Internal modules are gated by the{' '}
        <code>db_active</code> access strategy — a non-tenant returns <code>access_denied</code>.
      </p>

      {/* Module selector */}
      <div style={{ marginBottom: 14 }}>
        <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: 13 }} htmlFor="bos-module">
          Module
        </label>
        <select
          id="bos-module"
          value={selectedModule}
          onChange={(e) => {
            setSelectedModule(e.target.value);
            setSelectedAction('');
            setResult(null);
          }}
          style={{ width: 320, padding: 8, fontSize: 13 }}
        >
          <option value="">-- select module --</option>
          {modules.map((m) => (
            <option key={m.key} value={m.key}>
              {m.name || m.key}
            </option>
          ))}
        </select>
        {modules.length === 0 && (
          <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
            No Business OS modules found. (Click “Load modules”.)
          </div>
        )}
      </div>

      {/* Action selector */}
      {selectedModule && (
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: 13 }} htmlFor="bos-action">
            Operation
          </label>
          <select
            id="bos-action"
            value={selectedAction}
            onChange={(e) => setSelectedAction(e.target.value)}
            style={{ width: 320, padding: 8, fontSize: 13 }}
          >
            <option value="">-- select operation --</option>
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
  );
}
