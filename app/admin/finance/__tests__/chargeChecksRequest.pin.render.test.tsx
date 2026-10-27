/**
 * @jest-environment jsdom
 *
 * Money M-5, Pin C (AC-188, SA-WP-M5 SA-W2, M5-R4): the requests the cost
 * report and its Leak check send are byte-identical across the move from the
 * Business OS AI "Costs & credits" tab to the Charge checks page.
 *
 * Written FIRST and run green on the unchanged tree (98735db9), then never
 * edited again. Its SHA-256, and its helper's, are recorded in the M-5
 * workplan's Implementation Notes at Step 0 and at handover; they must be equal.
 *
 * Only `Date` is faked (no timer faking, the #399 lesson), and every wait has an
 * explicit 10 s timeout (the F-4 amendment lesson).
 *
 * RE-FROZEN ONCE by Money MK-3a (SA-WP-MK3 condition 2, SA-Q-MK3-11): the
 * report and its Leak check moved again, to the AI cost page's Summary &
 * checks tab, so the file now mounts `app/admin/ai-cost/page.tsx` at
 * `/admin/ai-cost?tab=checks&<state>`. Its two older sides (the Charge checks
 * page and the Business OS AI `tab=costs` tab) are removed: neither exists any
 * more. Nothing else changed: the table `chargeChecksRequestPins.ts` is
 * byte-identical (`64a565e9`), which is the proof that the merge sends the
 * same requests. Old and new SHA-256 of this file are in
 * docs/workplans/ADMIN_MONEY_MK3_AI_COST_PAGE_WORKPLAN.md.
 */

import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentType } from 'react';

jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

import { LEAK_PATH, PIN_NOW, PINNED_CHARGE_REQUESTS, REPORT_PATH } from './chargeChecksRequestPins';

const WAIT = { timeout: 10_000 };
/** The page that serves the report (MK-3a: the AI cost page), and the address a state opens at. */
function target(state: string): { Page: ComponentType; href: string } {
  const { default: Page } = jest.requireActual<{ default: ComponentType }>('@/app/admin/ai-cost/page');
  return { Page, href: `/admin/ai-cost?tab=checks${state ? `&${state}` : ''}` };
}

function stub() {
  const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const base = url.split('?')[0];
    // The report and the leak check answer with a refusal (only their URLs are
    // pinned); anything else answers empty.
    const body =
      base === REPORT_PATH
        ? { success: false, error: 'pinned' }
        : base === LEAK_PATH
          ? { success: false, error: 'pinned' }
          : { success: true, data: { areas: [], generatedAt: '2026-10-16T09:00:00.000Z' } };
    const status = base === REPORT_PATH || base === LEAK_PATH ? 400 : 200;
    return { ok: status === 200, status, json: async () => body } as Response;
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

const callsTo = (fetchMock: jest.Mock, base: string) =>
  fetchMock.mock.calls.map((c) => String(c[0])).filter((url) => url.split('?')[0] === base);

beforeEach(() => {
  jest.useFakeTimers({
    now: PIN_NOW,
    doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'queueMicrotask', 'nextTick'],
  });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('Pin C: the report and Leak check requests (AC-188)', () => {
  it.each(PINNED_CHARGE_REQUESTS.map((pin) => [pin.row, pin] as const))('row %i', async (_row, pin) => {
    const fetchMock = stub();
    const { Page, href } = target(pin.state);
    window.history.replaceState(null, '', href);
    const view = render(<Page />);

    await waitFor(() => expect(callsTo(fetchMock, REPORT_PATH)).toHaveLength(1), WAIT);
    await act(async () => {});
    expect(callsTo(fetchMock, REPORT_PATH)).toEqual([pin.report]);

    if (pin.leak !== null) {
      fireEvent.click(await screen.findByRole('button', { name: 'Run leak check' }, WAIT));
      await waitFor(() => expect(callsTo(fetchMock, LEAK_PATH)).toHaveLength(1), WAIT);
      expect(callsTo(fetchMock, LEAK_PATH)).toEqual([pin.leak]);
    } else {
      expect(callsTo(fetchMock, LEAK_PATH)).toEqual([]);
    }
    view.unmount();
  });
});
