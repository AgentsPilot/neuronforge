/**
 * Refresh state machine for the LLM Usage tab (Layer 1.1 FR-10, §3.10).
 *
 * A pure reducer, so every transition is unit-tested without timers or fetch.
 * `useLlmUsageAutoRefresh` owns the side effects (timers, visibility, fetch)
 * and drives this reducer.
 *
 * Rules:
 * - Auto-refresh is OFF by default.
 * - A request never starts while another is in flight (no overlap).
 * - A late response from an older request is ignored (request-id guard).
 * - Changing the business or the start time clears the report and stops
 *   auto-refresh until the next manual refresh.
 * - A hidden browser tab pauses auto-refresh; becoming visible does NOT resume
 *   it — the next manual refresh does.
 * - ANY failed request, including a 400 (e.g. the 7-day bound crossed during a
 *   long session), turns auto-refresh off (WC-7).
 *
 * Lives in `hooks/` next to its only user (SA optimisation note). Imports types
 * only, so nothing server-side reaches the client bundle (RC-8).
 */

import type { LlmUsageReport, ReportTrigger } from '@/lib/business-os/usage/llmUsageReportTypes';

export type AutoRefreshStatus = 'off' | 'running' | 'paused_hidden' | 'stopped_input_change';
export type AutoRefreshInterval = 10 | 30 | 60;
export const AUTO_REFRESH_INTERVALS: readonly AutoRefreshInterval[] = [10, 30, 60];

export type RefreshPhase = 'not_checked' | 'loading' | 'ready' | 'error' | 'forbidden' | 'unauthenticated';

export interface RefreshState {
  /** The selected business account, or null before one is chosen. */
  accountId: string | null;
  /** The window start, UTC ISO 8601. */
  startIso: string;
  phase: RefreshPhase;
  report: LlmUsageReport | null;
  error: string | null;
  /** The business name from the last manual report for this account (auto refreshes skip the lookup, WC-6). */
  companyName: string | null;
  inFlight: { requestId: number; trigger: ReportTrigger } | null;
  /**
   * Increments whenever a request finishes. The auto-refresh timer re-arms on
   * it: a response fast enough to be batched with its own start leaves
   * `inFlight` looking unchanged, and the timer must still re-arm.
   */
  settledRequests: number;
  auto: { status: AutoRefreshStatus; intervalSec: AutoRefreshInterval };
}

export type RefreshEvent =
  | { type: 'SELECT_ACCOUNT'; accountId: string | null }
  | { type: 'SET_START'; startIso: string }
  | { type: 'REQUEST_START'; requestId: number; trigger: ReportTrigger }
  | { type: 'REQUEST_OK'; requestId: number; report: LlmUsageReport }
  | { type: 'REQUEST_FAIL'; requestId: number; status: number; message: string }
  | { type: 'TOGGLE_AUTO'; on: boolean }
  | { type: 'SET_INTERVAL'; intervalSec: AutoRefreshInterval }
  | { type: 'VISIBILITY_HIDDEN' };

export function initialRefreshState(startIso: string): RefreshState {
  return {
    accountId: null,
    startIso,
    phase: 'not_checked',
    report: null,
    error: null,
    companyName: null,
    inFlight: null,
    settledRequests: 0,
    auto: { status: 'off', intervalSec: 30 },
  };
}

/** Whether a request of this kind may start now. The hook asks before dispatching REQUEST_START. */
export function canStartRequest(state: RefreshState, trigger: ReportTrigger): boolean {
  if (!state.accountId || state.inFlight) return false;
  if (trigger === 'auto') return state.auto.status === 'running';
  return true;
}

function selectionChanged(state: RefreshState, accountId: string | null, startIso: string): RefreshState {
  const stopAuto = state.auto.status === 'running' || state.auto.status === 'paused_hidden';
  return {
    ...state,
    accountId,
    startIso,
    phase: 'not_checked',
    report: null,
    error: null,
    companyName: accountId && state.accountId === accountId ? state.companyName : null,
    // A response to the old selection must not land on the new one.
    inFlight: null,
    auto: stopAuto ? { ...state.auto, status: accountId ? 'stopped_input_change' : 'off' } : state.auto,
  };
}

export function refreshReducer(state: RefreshState, event: RefreshEvent): RefreshState {
  switch (event.type) {
    case 'SELECT_ACCOUNT':
      if (state.accountId === event.accountId) return state;
      return selectionChanged(state, event.accountId, state.startIso);

    case 'SET_START':
      if (state.startIso === event.startIso) return state;
      return selectionChanged(state, state.accountId, event.startIso);

    case 'REQUEST_START': {
      if (!canStartRequest(state, event.trigger)) return state;
      return {
        ...state,
        phase: 'loading',
        inFlight: { requestId: event.requestId, trigger: event.trigger },
      };
    }

    case 'REQUEST_OK': {
      if (state.inFlight?.requestId !== event.requestId) return state;
      const manual = state.inFlight.trigger === 'manual';
      const resume = manual && (state.auto.status === 'paused_hidden' || state.auto.status === 'stopped_input_change');
      return {
        ...state,
        phase: 'ready',
        report: event.report,
        error: null,
        companyName: manual ? event.report.account.companyName : state.companyName,
        inFlight: null,
        settledRequests: state.settledRequests + 1,
        auto: resume ? { ...state.auto, status: 'running' } : state.auto,
      };
    }

    case 'REQUEST_FAIL': {
      if (state.inFlight?.requestId !== event.requestId) return state;
      const phase: RefreshPhase =
        event.status === 403 ? 'forbidden' : event.status === 401 ? 'unauthenticated' : 'error';
      return {
        ...state,
        phase,
        error: event.message,
        inFlight: null,
        settledRequests: state.settledRequests + 1,
        auto: { ...state.auto, status: 'off' },
      };
    }

    case 'TOGGLE_AUTO': {
      if (event.on && !state.accountId) return state;
      return { ...state, auto: { ...state.auto, status: event.on ? 'running' : 'off' } };
    }

    case 'SET_INTERVAL':
      return { ...state, auto: { ...state.auto, intervalSec: event.intervalSec } };

    case 'VISIBILITY_HIDDEN':
      if (state.auto.status !== 'running') return state;
      return { ...state, auto: { ...state.auto, status: 'paused_hidden' } };

    default:
      return state;
  }
}
