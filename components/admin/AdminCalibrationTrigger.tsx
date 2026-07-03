'use client';

// components/admin/AdminCalibrationTrigger.tsx
// ADMIN-ONLY test tool: trigger a calibration run on ANY agent (not just ones
// you own) to exercise the full flow — the resolver auto-fixes, the managed
// user email (IMP-1), and the admin failure alert (IMP-2).
//
// Self-gating: on mount it probes GET /api/admin/agents; if that returns 401/403
// the component renders nothing, so non-admins never see the entry point. The
// backend is the real gate — this is just UX.
//
// Runs on behalf of the OWNER (owner's plugin connections) via the batch route's
// admin-impersonation path; the result email is routed to YOU (the admin).

import { useCallback, useEffect, useRef, useState } from 'react';

interface AdminAgentItem {
  id: string;
  agent_name: string | null;
  user_id: string;
  owner_email: string | null;
  calibration_status: string | null;
  is_calibrated: boolean | null;
  production_ready: boolean | null;
  status: string | null;
  updated_at: string | null;
}

interface RunResult {
  success?: boolean;
  status?: string;
  sessionId?: string;
  executionId?: string;
  autoCalibration?: { iterations?: number; autoFixesApplied?: number; message?: string };
  summary?: Record<string, number>;
  error?: string;
  message?: string;
}

export function AdminCalibrationTrigger() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null); // null = probing
  const [open, setOpen] = useState(false);

  const [search, setSearch] = useState('');
  const [agents, setAgents] = useState<AdminAgentItem[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [selected, setSelected] = useState<AdminAgentItem | null>(null);

  const [inputJson, setInputJson] = useState('');
  const [force, setForce] = useState(false);

  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- admin probe -----------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/admin/agents?limit=1');
        if (!cancelled) setIsAdmin(res.ok);
      } catch {
        if (!cancelled) setIsAdmin(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // --- agent search ----------------------------------------------------------
  const fetchAgents = useCallback(async (q: string) => {
    setLoadingAgents(true);
    try {
      const res = await fetch(`/api/admin/agents?limit=100${q ? `&search=${encodeURIComponent(q)}` : ''}`);
      const json = await res.json();
      setAgents(res.ok && json?.data ? json.data : []);
    } catch {
      setAgents([]);
    } finally {
      setLoadingAgents(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchAgents(search), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [open, search, fetchAgents]);

  const openModal = () => { setOpen(true); setResult(null); setError(null); };
  const closeModal = () => { if (!running) setOpen(false); };

  const run = async () => {
    if (!selected) return;
    setError(null);
    setResult(null);

    let inputValues: Record<string, any> = {};
    if (inputJson.trim()) {
      try {
        inputValues = JSON.parse(inputJson);
      } catch {
        setError('Input overrides must be valid JSON (or leave empty).');
        return;
      }
    }

    setRunning(true);
    try {
      const res = await fetch('/api/v2/calibrate/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: selected.id, inputValues, background: true, force }),
      });
      const json: RunResult = await res.json();
      setResult(json);
      if (!res.ok && !json?.status) setError(json?.error || json?.message || `Request failed (${res.status})`);
    } catch (e: any) {
      setError(e?.message || 'Request failed');
    } finally {
      setRunning(false);
    }
  };

  if (isAdmin !== true) return null; // hidden for non-admins (and while probing)

  const passed = result?.success === true && result?.status === 'success';

  return (
    <>
      <button
        onClick={openModal}
        className="px-4 py-2 rounded-lg bg-purple-600 text-white text-sm font-medium hover:bg-purple-700"
        title="Admin-only: run calibration on any agent"
      >
        🧪 Run Calibration (Admin)
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={closeModal}
        >
          <div
            className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Run Calibration (Admin)</h2>
                <p className="text-xs text-gray-500">Runs on behalf of the owner. The result email is sent to you.</p>
              </div>
              <button onClick={closeModal} className="text-gray-400 hover:text-gray-600" disabled={running}>✕</button>
            </div>

            <div className="space-y-4 p-5">
              {/* Agent picker */}
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Agent</label>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name, agent id, or owner id…"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
                <div className="mt-2 max-h-52 overflow-y-auto rounded-lg border border-gray-200">
                  {loadingAgents ? (
                    <div className="p-3 text-sm text-gray-500">Loading…</div>
                  ) : agents.length === 0 ? (
                    <div className="p-3 text-sm text-gray-500">No agents found.</div>
                  ) : (
                    agents.map((a) => (
                      <button
                        key={a.id}
                        onClick={() => setSelected(a)}
                        className={`flex w-full items-center justify-between gap-2 border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-gray-50 ${selected?.id === a.id ? 'bg-purple-50' : ''}`}
                      >
                        <span className="min-w-0 flex-1 truncate">
                          <span className="font-medium text-gray-900">{a.agent_name || '(unnamed)'}</span>
                          <span className="ml-2 text-xs text-gray-500">{a.owner_email || a.user_id.slice(0, 8)}</span>
                        </span>
                        <span className="flex shrink-0 items-center gap-1">
                          {a.production_ready && <Badge tone="amber">prod</Badge>}
                          {a.is_calibrated && <Badge tone="green">calibrated</Badge>}
                          <Badge tone="gray">{a.calibration_status || 'none'}</Badge>
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </div>

              {selected && (
                <div className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                  Selected: <span className="font-medium">{selected.agent_name || selected.id}</span>
                  {' · '}owner {selected.owner_email || selected.user_id}
                </div>
              )}

              {/* Input overrides */}
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Input overrides (JSON, optional)</label>
                <textarea
                  value={inputJson}
                  onChange={(e) => setInputJson(e.target.value)}
                  placeholder='e.g. { "spreadsheet_id": "…" }  — leave empty to use the agent defaults'
                  rows={3}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs"
                />
              </div>

              {/* Force */}
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
                Force re-calibrate (bypass production-ready / already-calibrated guards)
              </label>

              {/* Email note */}
              <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
                The calibration result email is routed to <strong>you</strong> (not the owner). If the run fails, an
                admin failure alert is also sent to all admins. Check your inbox after the run.
              </div>

              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
              )}

              {result && (
                <div className={`rounded-lg border px-3 py-3 text-sm ${passed ? 'border-green-200 bg-green-50 text-green-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
                  <div className="font-semibold">{passed ? '✅ Passed calibration' : `⚠️ ${result.status || 'Did not pass'}`}</div>
                  {result.autoCalibration?.message && <div className="mt-1">{result.autoCalibration.message}</div>}
                  <div className="mt-2 grid grid-cols-2 gap-1 text-xs">
                    <span>Iterations: {result.autoCalibration?.iterations ?? '—'}</span>
                    <span>Auto-fixes: {result.autoCalibration?.autoFixesApplied ?? '—'}</span>
                    {result.sessionId && <span className="col-span-2 truncate">Session: {result.sessionId}</span>}
                    {result.executionId && <span className="col-span-2 truncate">Execution: {result.executionId}</span>}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t px-5 py-4">
              <button onClick={closeModal} disabled={running} className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100">
                Close
              </button>
              <button
                onClick={run}
                disabled={!selected || running}
                className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
              >
                {running ? 'Running…' : 'Run calibration'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone: 'green' | 'amber' | 'gray' }) {
  const tones: Record<string, string> = {
    green: 'bg-green-100 text-green-700',
    amber: 'bg-amber-100 text-amber-700',
    gray: 'bg-gray-100 text-gray-600',
  };
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${tones[tone]}`}>{children}</span>;
}
