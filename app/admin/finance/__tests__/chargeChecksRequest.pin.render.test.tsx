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
 * The same file runs on either side: when `app/admin/finance/charges/page.tsx`
 * exists it mounts that page at `/admin/finance/charges?<state>`; otherwise it
 * mounts the Business OS AI page at `/admin/business-os-llm?tab=costs&<state>`.
 * Only `Date` is faked (no timer faking, the #399 lesson), and every wait has an
 * explicit 10 s timeout (the F-4 amendment lesson).
 */

import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as fs from 'fs';
import * as path from 'path';
import type { ComponentType } from 'react';

jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

import { LEAK_PATH, PIN_NOW, PINNED_CHARGE_REQUESTS, REPORT_PATH } from './chargeChecksRequestPins';

const WAIT = { timeout: 10_000 };
const NEW_PAGE_FILE = path.join(process.cwd(), 'app', 'admin', 'finance', 'charges', 'page.tsx');
const isNewSide = fs.existsSync(NEW_PAGE_FILE);

/** The page that serves the report on this tree, and the address a state opens at. */
function target(state: string): { Page: ComponentType; href: string } {
  if (isNewSide) {
    const { default: Page } = jest.requireActual<{ default: ComponentType }>('@/app/admin/finance/charges/page');
    return { Page, href: `/admin/finance/charges${state ? `?${state}` : ''}` };
  }
  const { default: Page } = jest.requireActual<{ default: ComponentType }>('@/app/admin/business-os-llm/page');
  return { Page, href: `/admin/business-os-llm?tab=costs${state ? `&${state}` : ''}` };
}

function stub() {
  const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const base = url.split('?')[0];
    // The report and the leak check answer with a refusal (only their URLs are
    // pinned); anything else (the settings read on the old side) answers empty.
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
