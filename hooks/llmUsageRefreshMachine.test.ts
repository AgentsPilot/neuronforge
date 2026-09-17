/**
 * LLM Usage tab refresh state machine — Layer 1.1 FR-10 / AC-18, WC-6, WC-7.
 */

import type { LlmUsageReport } from '@/lib/business-os/usage/llmUsageReportTypes';
import {
  canStartRequest,
  initialRefreshState,
  refreshReducer,
  type RefreshEvent,
  type RefreshState,
} from './llmUsageRefreshMachine';

const ACCOUNT = '2f734ed5-3681-4049-880d-3de7b096bea3';
const OTHER = '99999999-9999-4999-8999-999999999999';
const START = '2026-09-17T11:00:00.000Z';

function report(companyName: string | null, profileLookup: LlmUsageReport['account']['profileLookup']): LlmUsageReport {
  return { account: { userId: ACCOUNT, companyName, profileLookup } } as unknown as LlmUsageReport;
}

function run(state: RefreshState, ...events: RefreshEvent[]): RefreshState {
  return events.reduce(refreshReducer, state);
}

const selected = () => run(initialRefreshState(START), { type: 'SELECT_ACCOUNT', accountId: ACCOUNT });

describe('refreshReducer', () => {
  it('starts not checked, with auto-refresh off', () => {
    const s = initialRefreshState(START);
    expect(s).toMatchObject({ accountId: null, startIso: START, phase: 'not_checked', inFlight: null });
    expect(s.auto.status).toBe('off');
    expect(canStartRequest(s, 'manual')).toBe(false);
  });

  it('runs a manual request to ready', () => {
    const s = run(selected(), { type: 'REQUEST_START', requestId: 1, trigger: 'manual' });
    expect(s.phase).toBe('loading');
    expect(canStartRequest(s, 'manual')).toBe(false);
    const done = run(s, { type: 'REQUEST_OK', requestId: 1, report: report('Acme', 'found') });
    expect(done).toMatchObject({ phase: 'ready', inFlight: null, companyName: 'Acme' });
  });

  it('never overlaps: a second start while in flight is ignored', () => {
    const s = run(
      selected(),
      { type: 'TOGGLE_AUTO', on: true },
      { type: 'REQUEST_START', requestId: 1, trigger: 'manual' },
      { type: 'REQUEST_START', requestId: 2, trigger: 'auto' }
    );
    expect(s.inFlight).toEqual({ requestId: 1, trigger: 'manual' });
  });

  it('ignores a stale response', () => {
    const s = run(selected(), { type: 'REQUEST_START', requestId: 2, trigger: 'manual' });
    expect(run(s, { type: 'REQUEST_OK', requestId: 1, report: report('Old', 'found') })).toBe(s);
    expect(run(s, { type: 'REQUEST_FAIL', requestId: 1, status: 500, message: 'x' })).toBe(s);
  });

  it('only starts auto requests while auto-refresh is running', () => {
    const s = selected();
    expect(canStartRequest(s, 'auto')).toBe(false);
    expect(run(s, { type: 'REQUEST_START', requestId: 1, trigger: 'auto' }).inFlight).toBeNull();
    expect(canStartRequest(run(s, { type: 'TOGGLE_AUTO', on: true }), 'auto')).toBe(true);
  });

  it('cannot turn auto-refresh on before a business is selected', () => {
    expect(run(initialRefreshState(START), { type: 'TOGGLE_AUTO', on: true }).auto.status).toBe('off');
  });

  it('keeps the name from the last manual report on an automatic refresh (WC-6)', () => {
    const s = run(
      selected(),
      { type: 'TOGGLE_AUTO', on: true },
      { type: 'REQUEST_START', requestId: 1, trigger: 'manual' },
      { type: 'REQUEST_OK', requestId: 1, report: report('Acme', 'found') },
      { type: 'REQUEST_START', requestId: 2, trigger: 'auto' },
      { type: 'REQUEST_OK', requestId: 2, report: report(null, 'skipped') }
    );
    expect(s.companyName).toBe('Acme');
    expect(s.report?.account.profileLookup).toBe('skipped');
  });

  it('changing the business clears the report and name and stops auto until a manual refresh', () => {
    const running = run(
      selected(),
      { type: 'TOGGLE_AUTO', on: true },
      { type: 'REQUEST_START', requestId: 1, trigger: 'manual' },
      { type: 'REQUEST_OK', requestId: 1, report: report('Acme', 'found') }
    );
    const changed = run(running, { type: 'SELECT_ACCOUNT', accountId: OTHER });
    expect(changed).toMatchObject({ accountId: OTHER, phase: 'not_checked', report: null, companyName: null });
    expect(changed.auto.status).toBe('stopped_input_change');
    expect(canStartRequest(changed, 'auto')).toBe(false);

    const resumed = run(
      changed,
      { type: 'REQUEST_START', requestId: 2, trigger: 'manual' },
      { type: 'REQUEST_OK', requestId: 2, report: report('Other', 'found') }
    );
    expect(resumed.auto.status).toBe('running');
  });

  it('changing the start time stops auto the same way, and drops the in-flight request', () => {
    const s = run(
      selected(),
      { type: 'TOGGLE_AUTO', on: true },
      { type: 'REQUEST_START', requestId: 1, trigger: 'auto' },
      { type: 'SET_START', startIso: '2026-09-17T11:30:00.000Z' }
    );
    expect(s).toMatchObject({ startIso: '2026-09-17T11:30:00.000Z', inFlight: null, phase: 'not_checked' });
    expect(s.auto.status).toBe('stopped_input_change');
    // The old request's late answer is ignored.
    expect(run(s, { type: 'REQUEST_OK', requestId: 1, report: report('x', 'found') }).report).toBeNull();
  });

  it('pauses while hidden and resumes only on the next manual refresh', () => {
    const hidden = run(selected(), { type: 'TOGGLE_AUTO', on: true }, { type: 'VISIBILITY_HIDDEN' });
    expect(hidden.auto.status).toBe('paused_hidden');
    expect(canStartRequest(hidden, 'auto')).toBe(false);
    const resumed = run(
      hidden,
      { type: 'REQUEST_START', requestId: 1, trigger: 'manual' },
      { type: 'REQUEST_OK', requestId: 1, report: report('Acme', 'found') }
    );
    expect(resumed.auto.status).toBe('running');
  });

  it('turns auto-refresh off on any failure, including a 400 (WC-7)', () => {
    for (const status of [400, 500, 0]) {
      const s = run(
        selected(),
        { type: 'TOGGLE_AUTO', on: true },
        { type: 'REQUEST_START', requestId: 1, trigger: 'auto' },
        { type: 'REQUEST_FAIL', requestId: 1, status, message: 'Start time is more than 7 days ago; the maximum window is 7 days' }
      );
      expect(s.auto.status).toBe('off');
      expect(s.phase).toBe('error');
      expect(s.error).toMatch(/7 days/);
    }
  });

  it('maps 403 to forbidden and 401 to unauthenticated', () => {
    const base = run(selected(), { type: 'REQUEST_START', requestId: 1, trigger: 'manual' });
    expect(run(base, { type: 'REQUEST_FAIL', requestId: 1, status: 403, message: 'Forbidden' }).phase).toBe('forbidden');
    expect(run(base, { type: 'REQUEST_FAIL', requestId: 1, status: 401, message: 'Unauthorized' }).phase).toBe('unauthenticated');
  });

  it('changes the interval without changing the auto status', () => {
    const s = run(selected(), { type: 'TOGGLE_AUTO', on: true }, { type: 'SET_INTERVAL', intervalSec: 10 });
    expect(s.auto).toEqual({ status: 'running', intervalSec: 10 });
  });
});
