/**
 * @jest-environment jsdom
 */

/**
 * The Health landing as the Admin Layout Standard L-1a pilot (§7.1): the "As of"
 * line through the shared formatter (F-58), the Refresh bar, the shared error
 * state with "Try again", and the §5.10 error copy precedence. The strict
 * Health pins (region count, single fetch, green, "Forbidden" on a 500) stay in
 * `health.render.test.tsx`.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const logError = jest.fn();
// RC-1: HealthGrid logs through `clientLogger.child`.
jest.mock('@/lib/logger/client', () => {
  const noop = () => undefined;
  const child = () => ({ error: (...args: unknown[]) => logError(...args), warn: noop, info: noop, debug: noop });
  return { clientLogger: { child } };
});

import AdminHealthPage from '../page';
import type { HealthSummary } from '@/lib/admin/health/healthTypes';

const SUMMARY: HealthSummary = {
  generatedAt: '2026-09-26T10:30:12.000Z',
  windows: {
    end: '2026-09-26T10:30:00.000Z',
    last24hStart: '2026-09-25T10:30:00.000Z',
    previous24hStart: '2026-09-24T10:30:00.000Z',
    last7dStart: '2026-09-19T10:30:00.000Z',
    previous7dStart: '2026-09-12T10:30:00.000Z',
  },
  tiles: [
    {
      id: 'bos_ai_failures',
      title: 'AI failures',
      status: 'red',
      headline: '5+ AI failures in the last 24 hours',
      matchedRuleId: null,
      figures: [],
      rules: [],
      otherwise: null,
      footnote: null,
      pageLink: null,
    },
  ],
};

type Step =
  | { kind: 'json'; status: number; body: unknown }
  | { kind: 'html'; status: number }
  | { kind: 'network' };

/** One fetch mock answering each call with the next step; the last step repeats. */
function mockFetch(...steps: Step[]): jest.Mock {
  let call = 0;
  const fetchMock = jest.fn(async () => {
    const step = steps[Math.min(call, steps.length - 1)];
    call += 1;
    if (step.kind === 'network') throw new TypeError('Failed to fetch');
    const ok = step.status >= 200 && step.status < 300;
    if (step.kind === 'html') {
      return {
        ok,
        status: step.status,
        json: async () => {
          throw new SyntaxError("Unexpected token '<' in JSON at position 0");
        },
      };
    }
    return { ok, status: step.status, json: async () => step.body };
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom has no fetch; standard test stub
  (global as any).fetch = fetchMock;
  return fetchMock;
}

const OK_STEP: Step = { kind: 'json', status: 200, body: { success: true, data: SUMMARY } };
const FALLBACK = 'Could not read the health summary. Try again in a moment.';
const NETWORK = 'Could not reach the server. Check your connection and try again.';

beforeEach(() => jest.clearAllMocks());

describe('Health on the shared layout (L-1a pilot)', () => {
  it('prints As of through the shared UTC formatter', async () => {
    mockFetch(OK_STEP);
    render(<AdminHealthPage />);
    const asOf = await screen.findByTestId('as-of');
    expect(asOf.textContent).toBe(
      'As of 10:30 UTC. Last 24 h = 2026-09-25 10:30 UTC to 2026-09-26 10:30 UTC; ' +
        'last 7 days from 2026-09-19 10:30 UTC.'
    );
    expect(asOf.className).toContain('text-slate-400');
  });

  it('shows the em dash, never an empty "As of .", when the end instant is unreadable (W-4)', async () => {
    mockFetch({
      kind: 'json',
      status: 200,
      body: { success: true, data: { ...SUMMARY, windows: { ...SUMMARY.windows, end: 'not a date' } } },
    });
    render(<AdminHealthPage />);
    const asOf = await screen.findByTestId('as-of');
    expect(asOf.textContent?.startsWith('As of —.')).toBe(true);
    expect(asOf.textContent).not.toContain('As of .');
  });

  it('shows the loading state while the first read is in flight, and drops it once loaded', async () => {
    mockFetch(OK_STEP);
    render(<AdminHealthPage />);
    expect(screen.getByRole('status').textContent).toBe('Reading the health summary…');
    await screen.findByTestId('health-tile-bos_ai_failures');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('an HTML error page shows the fixed fallback, never the parser text', async () => {
    mockFetch({ kind: 'html', status: 502 });
    render(<AdminHealthPage />);
    const error = await screen.findByTestId('health-error');
    expect(error.textContent).toBe(FALLBACK);
    expect(logError).toHaveBeenCalled();
  });

  it('a rejected fetch shows the network copy and logs the error', async () => {
    mockFetch({ kind: 'network' });
    render(<AdminHealthPage />);
    expect((await screen.findByTestId('health-error')).textContent).toBe(NETWORK);
    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError.mock.calls[0][0]).toEqual({ err: expect.any(TypeError) });
  });

  it('a 403 with "Forbidden" shows "Forbidden", not the session copy (RC-4)', async () => {
    mockFetch({ kind: 'json', status: 403, body: { success: false, error: 'Forbidden' } });
    render(<AdminHealthPage />);
    const error = await screen.findByTestId('health-error');
    expect(error.textContent).toBe('Forbidden');
    expect(error.textContent).not.toContain('session');
  });

  it('"Try again" after a failure refreshes once (fetch count 2) and clears the error', async () => {
    const fetchMock = mockFetch({ kind: 'network' }, OK_STEP);
    render(<AdminHealthPage />);
    await screen.findByTestId('health-error');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByTestId('health-tile-bos_ai_failures');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]).toEqual(['/api/admin/health-summary', { cache: 'no-store' }]);
    expect(screen.queryByTestId('health-error')).toBeNull();
  });

  it('a failed Refresh keeps the tiles on screen and shows the error', async () => {
    const fetchMock = mockFetch(OK_STEP, { kind: 'html', status: 500 });
    render(<AdminHealthPage />);
    await screen.findByTestId('health-tile-bos_ai_failures');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh the health summary' }));
    expect((await screen.findByTestId('health-error')).textContent).toBe(FALLBACK);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const tile = screen.getByTestId('health-tile-bos_ai_failures');
    expect(within(tile).getByTestId('headline').textContent).toBe('5+ AI failures in the last 24 hours');
  });

  it('the tile grid is aria-busy during a Refresh', async () => {
    mockFetch(OK_STEP);
    render(<AdminHealthPage />);
    const tile = await screen.findByTestId('health-tile-bos_ai_failures');
    const grid = tile.parentElement as HTMLElement;
    expect(grid.getAttribute('aria-busy')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh the health summary' }));
    expect(grid.getAttribute('aria-busy')).toBe('true');
    await waitFor(() => expect(grid.getAttribute('aria-busy')).toBe('false'));
  });
});
