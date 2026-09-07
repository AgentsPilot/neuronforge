// app/test-business-os/page.tsx
'use client';

/**
 * Business OS Testing Interface
 * -----------------------------
 * A dedicated internal test harness for the Business OS surface, mirroring the
 * infrastructure of /test-plugins-v2 (tab switcher + shared response viewer +
 * debug-log panel), but adapted to how Business OS actually runs:
 *
 *   Account model: SESSION-BASED.
 *   Every /api/business-os/* (and /api/onboarding/*) route authenticates via
 *   getUser() (the logged-in Supabase session) and has NO userId override. So
 *   this page acts as whoever you are currently logged in as — the current-user
 *   panel below shows exactly which account that is. To test a different persona,
 *   log in as them. This removes the "typed userId vs session user" mismatch that
 *   the Form Tester on /test-plugins-v2 has to manage.
 *
 *   Profile prerequisite: most Business OS features need a business profile +
 *   seeded CRM pipeline stages. The "Account setup" helper seeds both in one call
 *   (POST /api/onboarding/build) for the logged-in session user.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HOW TO ADD A TAB (kept deliberately simple so tabs are one-liners):
 *   1. Add an entry to the TABS array: `{ id: 'my-tab', label: 'My Tab' }`.
 *      (the `TabId` union widens automatically from `typeof TABS`).
 *   2. Add a `{activeTab === 'my-tab' && ( ...content... )}` block in the tab
 *      content region below.
 *   3. Use the shared `callApi(...)` helper for requests — it logs to the debug
 *      panel and populates the shared "Last API Response" viewer for you.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState, useCallback, useEffect } from 'react';
import { useAuth } from '@/components/UserProvider';
import { BosModuleTester, type BosModule } from '@/components/test-business-os/BosModuleTester';
import type { ActionSchema } from '@/lib/plugins/tester/tester-types';
import type { ExecutionResult } from '@/lib/types/plugin-types';

// ── Tabs ─────────────────────────────────────────────────────────────────────
// Add tabs here. The first real tab will replace/extend this list.
const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'modules', label: 'Modules' },
] as const;

type TabId = (typeof TABS)[number]['id'];

// ── Account-setup (profile seeding) options ──────────────────────────────────
// `vertical` decides which default CRM pipeline stages get seeded. 'generic'
// omits the vertical and seeds the default stage set.
const VERTICAL_OPTIONS: { value: string; label: string }[] = [
  { value: 'coach', label: 'Coach' },
  { value: 'consultant', label: 'Consultant' },
  { value: 'therapist', label: 'Therapist' },
  { value: 'sales', label: 'Sales' },
  { value: 'generic', label: 'Generic (no vertical)' },
];

interface DebugLog {
  timestamp: string;
  type: 'info' | 'error' | 'success';
  message: string;
}

export default function TestBusinessOSPage() {
  const { user, loading: authLoading } = useAuth();

  // ── Shared chrome state ────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [isLoading, setIsLoading] = useState(false);
  const [lastResponse, setLastResponse] = useState<unknown>(null);
  const [debugLogs, setDebugLogs] = useState<DebugLog[]>([]);
  const [copySuccess, setCopySuccess] = useState(false);

  // ── Account-setup state ────────────────────────────────────────────────────
  const [seedVertical, setSeedVertical] = useState<string>('coach');
  const [seedCompanyName, setSeedCompanyName] = useState<string>('Test Co');

  // ── Modules tab state ──────────────────────────────────────────────────────
  const [modules, setModules] = useState<BosModule[]>([]);
  const [modulesLoaded, setModulesLoaded] = useState(false);

  const addDebugLog = useCallback((type: DebugLog['type'], message: string) => {
    setDebugLogs((prev) => [
      ...prev.slice(-49), // keep last 50
      { timestamp: new Date().toLocaleTimeString(), type, message },
    ]);
  }, []);

  const clearLogs = () => setDebugLogs([]);

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(lastResponse, null, 2));
      setCopySuccess(true);
      addDebugLog('success', 'Response copied to clipboard');
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (error) {
      addDebugLog('error', `Failed to copy: ${(error as Error).message}`);
    }
  };

  /**
   * Shared request helper. Cookies (the Supabase session) are sent automatically
   * for same-origin requests, so getUser() on the server resolves the logged-in
   * user — no userId needs to be passed. Logs to the debug panel and populates
   * the shared "Last API Response" viewer.
   */
  const callApi = useCallback(
    async (
      path: string,
      opts: { method?: string; body?: unknown; label?: string } = {}
    ): Promise<unknown> => {
      const { method = 'POST', body, label } = opts;
      const what = label || `${method} ${path}`;
      setIsLoading(true);
      try {
        addDebugLog('info', `Calling ${what}...`);
        const response = await fetch(path, {
          method,
          headers: {
            'Content-Type': 'application/json',
            'x-correlation-id': crypto.randomUUID(),
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });

        let data: unknown;
        const text = await response.text();
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          data = text; // non-JSON response (e.g. HTML error page)
        }

        setLastResponse(data);

        const ok =
          response.ok &&
          (data == null || (data as { success?: boolean }).success !== false);
        if (ok) {
          addDebugLog('success', `${what} → ${response.status}`);
        } else {
          const errMsg =
            (data as { error?: string })?.error || `HTTP ${response.status}`;
          addDebugLog('error', `${what} → ${errMsg}`);
        }
        return data;
      } catch (error) {
        const message = (error as Error).message;
        addDebugLog('error', `${what} failed: ${message}`);
        setLastResponse({ success: false, error: message });
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [addDebugLog]
  );

  // ── Account setup: seed profile + CRM pipeline stages ──────────────────────
  const seedProfile = async () => {
    if (!user) {
      addDebugLog('error', 'You must be logged in to seed a profile.');
      return;
    }
    const profile: Record<string, unknown> = {};
    if (seedVertical && seedVertical !== 'generic') profile.vertical = seedVertical;
    if (seedCompanyName.trim()) profile.company_name = seedCompanyName.trim();

    await callApi('/api/onboarding/build', {
      method: 'POST',
      body: { profile },
      label: `Seed profile (${seedVertical})`,
    });
  };

  // ── Modules tab: list business_os modules + run operations as the session user ──
  // Reuses the existing plugin endpoints (Option A — no new APIs):
  //   list    → GET /api/plugins/available?includeBusinessOs=true (filtered to business_os)
  //   schema  → GET /api/plugins/action-schema?plugin=<key>
  //   execute → POST /api/plugins/execute (session user's id in the body)
  const loadModules = useCallback(async () => {
    const data = await callApi('/api/plugins/available?includeBusinessOs=true', {
      method: 'GET',
      label: 'List Business OS modules',
    });
    const plugins =
      (data as { plugins?: Array<{ key: string; name: string; description?: string; visibility?: string }> })
        ?.plugins || [];
    setModules(
      plugins
        .filter((p) => p.visibility === 'business_os')
        .map((p) => ({ key: p.key, name: p.name, description: p.description }))
    );
    setModulesLoaded(true);
  }, [callApi]);

  // Load modules the first time the Modules tab is opened (once signed in).
  useEffect(() => {
    if (activeTab === 'modules' && !modulesLoaded && user) {
      void loadModules();
    }
  }, [activeTab, modulesLoaded, user, loadModules]);

  const getModuleActionSchema = useCallback(
    async (pluginKey: string): Promise<{ actions: ActionSchema[] }> => {
      const data = await callApi(
        `/api/plugins/action-schema?plugin=${encodeURIComponent(pluginKey)}`,
        { method: 'GET', label: `Schema: ${pluginKey}` }
      );
      return { actions: (data as { actions?: ActionSchema[] })?.actions || [] };
    },
    [callApi]
  );

  const executeModuleAction = useCallback(
    async (
      pluginKey: string,
      actionName: string,
      params: Record<string, unknown>
    ): Promise<ExecutionResult | null> => {
      if (!user) return null;
      const data = await callApi('/api/plugins/execute', {
        method: 'POST',
        body: { userId: user.id, pluginName: pluginKey, actionName, parameters: params },
        label: `Run ${pluginKey}.${actionName}`,
      });
      return (data as ExecutionResult | null) ?? null;
    },
    [callApi, user]
  );

  // ── Styling helpers (inline, matching /test-plugins-v2) ────────────────────
  const panelStyle: React.CSSProperties = {
    marginBottom: '30px',
    padding: '15px',
    border: '1px solid #ccc',
    borderRadius: '5px',
  };

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '20px', fontFamily: 'monospace' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
        <h1>Business OS Testing Interface</h1>
      </div>
      <p style={{ color: '#666', marginTop: 0 }}>
        All requests run as your <strong>logged-in session user</strong> (no userId override).
      </p>

      {/* Tab Navigation */}
      <div style={{ marginBottom: '30px', borderBottom: '2px solid #ccc' }}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '10px 20px',
              marginRight: '5px',
              backgroundColor: activeTab === tab.id ? '#007bff' : '#f8f9fa',
              color: activeTab === tab.id ? 'white' : '#333',
              border: 'none',
              borderBottom: activeTab === tab.id ? '3px solid #0056b3' : 'none',
              cursor: 'pointer',
              fontSize: '16px',
              fontWeight: activeTab === tab.id ? 'bold' : 'normal',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Current User + Account Setup live on the Overview tab only — they are
          account-level setup, not repeated on every feature tab. Seed a profile from
          Overview, then switch to a feature tab (e.g. Modules) to use it. */}
      {activeTab === 'overview' && (
        <>
      {/* Current User (session) panel */}
      <div style={panelStyle}>
        <h2 style={{ marginTop: 0 }}>Current User (session)</h2>
        {authLoading ? (
          <div style={{ color: '#666' }}>Loading session…</div>
        ) : user ? (
          <div style={{ fontSize: '14px' }}>
            <div>
              <span style={{ color: '#666' }}>User ID:</span>{' '}
              <strong>{user.id}</strong>
            </div>
            <div>
              <span style={{ color: '#666' }}>Email:</span>{' '}
              <strong>{user.email || '(none)'}</strong>
            </div>
          </div>
        ) : (
          <div style={{ color: '#dc3545' }}>
            Not signed in. Log in to the app first — Business OS APIs require an
            authenticated session.
          </div>
        )}
      </div>

      {/* Account setup: seed profile + CRM pipeline stages */}
      <div style={panelStyle}>
        <h2 style={{ marginTop: 0 }}>Account Setup</h2>
        <p style={{ color: '#666', fontSize: '14px', marginTop: 0 }}>
          Seed a business profile and default CRM pipeline stages for the session
          user (POST <code>/api/onboarding/build</code>). Most Business OS
          features need this before they work.
        </p>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <label htmlFor="seedVertical" style={{ display: 'block', marginBottom: '5px' }}>
              Vertical:
            </label>
            <select
              id="seedVertical"
              value={seedVertical}
              onChange={(e) => setSeedVertical(e.target.value)}
              style={{ padding: '8px', fontSize: '14px' }}
            >
              {VERTICAL_OPTIONS.map((v) => (
                <option key={v.value} value={v.value}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="seedCompany" style={{ display: 'block', marginBottom: '5px' }}>
              Company name (optional):
            </label>
            <input
              id="seedCompany"
              type="text"
              value={seedCompanyName}
              onChange={(e) => setSeedCompanyName(e.target.value)}
              placeholder="Test Co"
              style={{ width: '220px', padding: '8px', fontSize: '14px' }}
            />
          </div>
          <button
            onClick={seedProfile}
            disabled={isLoading || !user}
            style={{
              padding: '10px 20px',
              backgroundColor: '#28a745',
              color: 'white',
              border: 'none',
              borderRadius: '3px',
              cursor: isLoading || !user ? 'not-allowed' : 'pointer',
              opacity: isLoading || !user ? 0.6 : 1,
            }}
          >
            Seed Profile
          </button>
        </div>
      </div>
        </>
      )}

      {/* ── Tab content region ─────────────────────────────────────────────── */}
      {activeTab === 'overview' && (
        <div style={panelStyle}>
          <h2 style={{ marginTop: 0 }}>Overview</h2>
          <p style={{ fontSize: '14px', lineHeight: 1.6 }}>
            This is the shared shell for testing the Business OS surface. It gives
            you the same infrastructure as <code>/test-plugins-v2</code>:
          </p>
          <ul style={{ fontSize: '14px', lineHeight: 1.7 }}>
            <li>A <strong>tab switcher</strong> for each area you want to test.</li>
            <li>A <strong>current-user panel</strong> so you always know which account you&apos;re acting as.</li>
            <li>An <strong>account-setup helper</strong> to seed a profile + CRM pipeline stages.</li>
            <li>A shared <strong>&quot;Last API Response&quot;</strong> viewer and <strong>debug log</strong> panel below.</li>
          </ul>
          <p style={{ fontSize: '14px', color: '#666' }}>
            The <strong>Modules</strong> tab exercises the internal Business OS
            modules (repository-backed plugins) as your session user.
          </p>
        </div>
      )}

      {/* Tab: Modules — run internal Business OS module operations */}
      {activeTab === 'modules' && (
        <div style={panelStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ marginTop: 0 }}>Business OS Modules</h2>
            <button
              onClick={() => void loadModules()}
              disabled={isLoading || !user}
              style={{
                padding: '8px 16px',
                backgroundColor: '#007bff',
                color: 'white',
                border: 'none',
                borderRadius: '3px',
                cursor: isLoading || !user ? 'not-allowed' : 'pointer',
                opacity: isLoading || !user ? 0.6 : 1,
                fontSize: '14px',
              }}
            >
              {modulesLoaded ? 'Reload modules' : 'Load modules'}
            </button>
          </div>
          <p style={{ color: '#666', fontSize: '14px', marginTop: 0 }}>
            Internal, repository-backed modules — hidden from the general plugin
            list (<code>visibility: business_os</code>) but runnable here by key.
            CRM is the first. Each operation runs against your seeded profile;
            without one you&apos;ll get <code>access_denied</code> (seed via
            <strong> Account Setup</strong> on the <strong>Overview</strong> tab).
          </p>
          <BosModuleTester
            sessionUserId={user?.id ?? null}
            modules={modules}
            getActionSchema={getModuleActionSchema}
            executeAction={executeModuleAction}
          />
        </div>
      )}

      {/* Shared: Last API Response */}
      {lastResponse != null && (
        <div style={panelStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <h2 style={{ margin: 0 }}>Last API Response</h2>
            <button
              onClick={copyToClipboard}
              style={{
                padding: '8px 16px',
                backgroundColor: copySuccess ? '#28a745' : '#007bff',
                color: 'white',
                border: 'none',
                borderRadius: '3px',
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              {copySuccess ? '✓ Copied!' : 'Copy to Clipboard'}
            </button>
          </div>
          <pre
            style={{
              backgroundColor: '#f8f9fa',
              padding: '15px',
              borderRadius: '3px',
              overflow: 'auto',
              fontSize: '12px',
              maxHeight: '300px',
            }}
          >
            {JSON.stringify(lastResponse, null, 2)}
          </pre>
        </div>
      )}

      {/* Shared: Debug Logs */}
      <div style={{ marginBottom: '20px' }}>
        <button
          onClick={clearLogs}
          style={{
            padding: '10px 20px',
            backgroundColor: '#dc3545',
            color: 'white',
            border: 'none',
            borderRadius: '3px',
            cursor: 'pointer',
          }}
        >
          Clear Debug Logs
        </button>
      </div>
      <div style={{ padding: '15px', border: '1px solid #ccc', borderRadius: '5px' }}>
        <h2 style={{ marginTop: 0 }}>Debug Logs</h2>
        <div
          style={{
            backgroundColor: '#f8f9fa',
            padding: '15px',
            borderRadius: '3px',
            height: '300px',
            overflow: 'auto',
            fontSize: '12px',
            fontFamily: 'monospace',
          }}
        >
          {debugLogs.length === 0 ? (
            <div style={{ color: '#666' }}>No debug logs yet...</div>
          ) : (
            debugLogs.map((log, index) => (
              <div
                key={index}
                style={{
                  marginBottom: '5px',
                  color:
                    log.type === 'error'
                      ? '#dc3545'
                      : log.type === 'success'
                      ? '#28a745'
                      : '#666',
                }}
              >
                [{log.timestamp}] {log.type.toUpperCase()}: {log.message}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
