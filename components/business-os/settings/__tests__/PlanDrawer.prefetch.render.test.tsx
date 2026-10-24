/**
 * @jest-environment jsdom
 */

/**
 * The prefetch hook, the real drawer and the real `PlanSection` together (C-b
 * workplan D-1..D-8; settings drawer review C-2; SA Q-1 (b), SA-CB-1).
 *
 * A small harness plays the settings page exactly as it wires the plan drawer:
 * `useDrawerPrefetch` with the real starter, `paused` while the drawer is open,
 * and the render-derived spent flag (no warm after the first close, rule 7).
 * A Warm button stands in for the row's hover / focus / press, the idle
 * callback is run by hand, and `fetch` is routed by URL with deferred replies.
 * The warm read is the page's own `startPlanDrawerRead`, so every `my-plan` GET
 * is counted, warm or fresh. Nothing asserts on elapsed time: `Date.now()` is
 * moved only for the maximum age (D-4).
 */

import '@testing-library/jest-dom';
import React, { useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('@/lib/supabaseClient', () => ({ supabase: {} }));
jest.mock('@/lib/business-os/LanguageContext', () => {
  const { translations } = jest.requireActual('@/lib/business-os/LanguageContext');
  return {
    useLanguage: () => ({
      language: 'en',
      timezone: 'UTC',
      isRTL: false,
      t: (key: string) => translations.en[key] || key,
    }),
  };
});
jest.mock('@/lib/logger', () => {
  const noop = () => undefined;
  const logger = { error: noop, warn: noop, info: noop, debug: noop, trace: noop, fatal: noop };
  return { ...jest.requireActual('@/lib/logger'), createLogger: () => ({ ...logger, child: () => logger }) };
});
jest.mock('next/navigation', () => ({ useRouter: () => ({ replace: jest.fn() }) }));
jest.mock('@/lib/client/stripeJs', () => ({ getStripePromise: () => Promise.resolve({ handleNextAction: async () => ({}) }) }));
jest.mock('@stripe/react-stripe-js', () => ({
  EmbeddedCheckoutProvider: ({ children }: { children: unknown }) => <div data-testid="fake-provider">{children as never}</div>,
  EmbeddedCheckout: () => <div data-testid="fake-checkout" />,
}));

import { PlanSection, type PlanPayload } from '@/components/business-os/settings/PlanSection';
import { SettingsDrawer } from '@/components/business-os/settings/SettingsDrawer';
import { startPlanDrawerRead } from '@/components/business-os/settings/planDrawerReads';
import { DRAWER_PREFETCH_MAX_AGE_MS, useDrawerPrefetch } from '@/components/business-os/settings/useDrawerPrefetch';

const { translations } = jest.requireActual('@/lib/business-os/LanguageContext') as {
  translations: Record<'en', Record<string, string>>;
};
const COPY = translations.en;
const DRAWER = 'settings-plan-drawer';
const MY_PLAN = '/api/business-os/entitlements/my-plan';
const WARM = 'WARM-PLAN';
const FRESH = 'FRESH-PLAN';
const LOW = 'plan-low';
const TOP = 'plan-top';
const TOP_NAME = 'Top plan';

function payload(name: string, overrides: Partial<PlanPayload> = {}): PlanPayload {
  return {
    status: 'ok',
    planId: LOW,
    name,
    kind: 'tier',
    monthlyPriceUsd: 29,
    free: false,
    state: null,
    accessEndsAt: null,
    endsWhen: null,
    whenThisChanges: null,
    included: [],
    nextPlanUp: null,
    problem: null,
    ...overrides,
  };
}

/** A paying owner on LOW, renewing, offered TOP as an upgrade. */
function paying(name: string): PlanPayload {
  return payload(name, {
    plans: [
      { planId: LOW, name, monthlyPriceUsd: 29, availableToBuy: true },
      { planId: TOP, name: TOP_NAME, monthlyPriceUsd: 129, availableToBuy: true },
    ],
    purchase: {
      offer: { kind: 'none', reason: 'paying' },
      billing: { state: 'renewing', date: '2026-11-13T09:30:00.000Z' },
      endsFreeAccessOnPurchase: null,
      upgrade: { tiers: [TOP] },
    },
    // Upgrade modal UM-1b: the "Upgrade to" button lives in the plan comparison modal,
    // which opens only on a server comparison (C-21); no rows are needed here.
    comparison: { planIds: [LOW, TOP], sections: [] },
  });
}

interface FakeResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}
const respond = (body: unknown, status = 200): FakeResponse => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const planReply = (plan: PlanPayload) => respond({ success: true, data: plan });

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

type Reply = FakeResponse | Promise<FakeResponse>;
let planReplies: Reply[];
let postReplies: Reply[];
const mockFetch = jest.fn();

function route(url: string, init?: { method?: string }): Promise<FakeResponse> {
  if (init?.method === 'POST') {
    const next = postReplies.shift();
    if (!next) throw new Error(`Unexpected POST ${url}`);
    return Promise.resolve(next);
  }
  if (url === MY_PLAN) {
    const next = planReplies.shift();
    if (!next) throw new Error('Unexpected my-plan GET');
    return Promise.resolve(next);
  }
  throw new Error(`Unrouted fetch: ${url}`);
}

const planGets = () => mockFetch.mock.calls.filter(([url, init]) => url === MY_PLAN && (init as { method?: string } | undefined)?.method !== 'POST').length;

let now: number;
let idleCallbacks: Array<() => void>;

beforeAll(() => {
  (global as unknown as { fetch: typeof mockFetch }).fetch = mockFetch;
});

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockImplementation(route);
  planReplies = [];
  postReplies = [];
  now = Date.parse('2026-10-16T10:00:00Z');
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  idleCallbacks = [];
  (window as unknown as { requestIdleCallback: unknown }).requestIdleCallback = (cb: () => void) => {
    idleCallbacks.push(cb);
    return idleCallbacks.length;
  };
  // Never cancels: a browser that runs a late callback anyway is the worst case.
  (window as unknown as { cancelIdleCallback: unknown }).cancelIdleCallback = () => undefined;
});

afterEach(() => {
  jest.restoreAllMocks();
  delete (window as unknown as { requestIdleCallback?: unknown }).requestIdleCallback;
  delete (window as unknown as { cancelIdleCallback?: unknown }).cancelIdleCallback;
});

/** The settings page's plan wiring, as `page.tsx` has it (P-G1, P-G6 pin the page to this form). */
function Page({ checkoutMarker = null }: { checkoutMarker?: string | null }) {
  const [open, setOpen] = useState(false);
  const [planDrawerOpened, setPlanDrawerOpened] = useState(false);
  if (open && !planDrawerOpened) setPlanDrawerOpened(true);
  const planWarmSpent = planDrawerOpened && !open;
  const prefetch = useDrawerPrefetch({
    start: () => startPlanDrawerRead('en'),
    key: 'user-1:en',
    enabled: !planWarmSpent,
    paused: open,
    maxAgeMs: DRAWER_PREFETCH_MAX_AGE_MS,
    warmOnIdle: true,
  });
  return (
    <>
      <button type="button" onClick={prefetch.warm}>
        Warm
      </button>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <SettingsDrawer open={open} onOpenChange={setOpen} title={COPY['plan.section_title']} isRTL={false} closeLabel={COPY['common.close']} testId={DRAWER}>
        <PlanSection checkoutMarker={checkoutMarker} takePrefetched={prefetch.take} />
      </SettingsDrawer>
    </>
  );
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

const warm = () => fireEvent.click(screen.getByRole('button', { name: 'Warm' }));
const runIdle = () => act(() => idleCallbacks.forEach((cb) => cb()));

async function openDrawer() {
  fireEvent.click(screen.getByRole('button', { name: 'Open' }));
  return screen.findByTestId(DRAWER);
}

async function closeDrawer() {
  const own = within(screen.getByTestId(DRAWER))
    .getAllByRole('button', { name: COPY['common.close'] })
    .find((b) => !b.className.includes('absolute')) as HTMLButtonElement;
  fireEvent.click(own);
  await waitFor(() => expect(screen.queryByTestId(DRAWER)).toBeNull());
}

describe('warm, then open', () => {
  it('D-1: warmed and answered, then open → zero new requests; the warm plan shows (the portal hand-over works while paused)', async () => {
    planReplies.push(planReply(payload(WARM)));
    render(<Page />);
    warm();
    await settle();
    expect(planGets()).toBe(1);

    const sheet = await openDrawer();
    await within(sheet).findByText(WARM);
    await settle();
    expect(planGets()).toBe(1);
  });

  it('D-2: warm still in flight, then open → zero new requests; the plan appears when the read lands', async () => {
    const reply = deferred<FakeResponse>();
    planReplies.push(reply.promise);
    render(<Page />);
    warm();

    const sheet = await openDrawer();
    await settle();
    expect(within(sheet).queryByText(WARM)).toBeNull();
    expect(planGets()).toBe(1);

    await act(async () => reply.resolve(planReply(payload(WARM))));
    await within(sheet).findByText(WARM);
    await settle();
    expect(planGets()).toBe(1);
  });

  it('D-4: warm, 61 s pass, then open → one fresh request; the old read is not used', async () => {
    planReplies.push(planReply(payload(WARM)), planReply(payload(FRESH)));
    render(<Page />);
    warm();
    await settle();

    now += 61_000;
    const sheet = await openDrawer();
    await within(sheet).findByText(FRESH);
    await settle();
    expect(within(sheet).queryByText(WARM)).toBeNull();
    expect(planGets()).toBe(2);
  });
});

describe('rule 7 (SA Q-1 (b), SA-CB-1): no warm after the first close', () => {
  it('D-3: open, close, then hover, focus return and the idle callback → no request; the reopen → exactly one fresh request', async () => {
    planReplies.push(planReply(payload(WARM)), planReply(payload(FRESH)));
    render(<Page />);
    warm();
    await settle();
    const first = await openDrawer();
    await within(first).findByText(WARM);
    await settle();
    await closeDrawer();
    await settle();
    expect(planGets()).toBe(1);

    warm(); // hover
    warm(); // focus returning to the row
    runIdle(); // every idle callback ever scheduled, run late
    await settle();
    expect(planGets()).toBe(1);

    const second = await openDrawer();
    await within(second).findByText(FRESH);
    await settle();
    expect(within(second).queryByText(WARM)).toBeNull();
    expect(planGets()).toBe(2);
  });

  /*
   * D-8, re-shaped by upgrade modal UM-1b (workplan §13, SA Q-10). The upgrade
   * now runs in the plan comparison modal, whose busy lock refuses every close
   * while the confirm is in flight, so "close mid-upgrade" is unreachable: the
   * close attempt is refused (new assertion), the answer lands, the modal hands
   * off to the drawer ("Upgrading…"), and the owner closes the drawer then. The
   * intent is kept: no warm read is ever reused after an upgrade made in this
   * mount.
   */
  it('D-8: a close during the upgrade confirm is refused; after the hand-off, close and reopen within 60 s → one fresh request (no warm exists)', async () => {
    planReplies.push(planReply(paying(WARM)), planReply(paying(FRESH)));
    const confirm = deferred<FakeResponse>();
    postReplies.push(
      respond({
        success: true,
        data: { fromTier: LOW, tier: TOP, amountDueMinor: 3387, taxMinor: 0, currency: 'usd', prorationDate: 1_792_766_146, renewsOn: '2026-11-13T09:30:00.000Z', monthlyPriceMinor: 12900 },
      }),
      confirm.promise
    );
    render(<Page />);
    warm();
    await settle();
    const sheet = await openDrawer();
    await within(sheet).findByText(WARM);
    expect(planGets()).toBe(1);

    await userEvent.click(within(sheet).getByTestId('plan-compare-open'));
    const modal = await screen.findByTestId('plan-compare-modal');
    await userEvent.click(within(modal).getAllByRole('button', { name: COPY['plan.upgrade.button'].replace('{plan}', TOP_NAME) })[0]);
    await within(modal).findByTestId('plan-upgrade-quote');
    await userEvent.click(within(modal).getByRole('button', { name: COPY['plan.upgrade.confirm'] }));
    // The confirm is in flight (preview + confirm POSTed) when the owner tries to close.
    await waitFor(() => expect(mockFetch.mock.calls.filter(([, init]) => (init as { method?: string } | undefined)?.method === 'POST')).toHaveLength(2));
    fireEvent.keyDown(modal, { key: 'Escape' });
    // UM-1b busy lock (UM-FR11): refused; the modal and the drawer both stay.
    expect(screen.getByTestId('plan-compare-modal')).toBeInTheDocument();
    expect(screen.getByTestId(DRAWER)).toBeInTheDocument();

    await act(async () => confirm.resolve(respond({ success: true, data: { outcome: 'upgraded' } })));
    // Hand-off (SA W-2): the modal closes itself and the drawer says "Upgrading…".
    await waitFor(() => expect(screen.queryByTestId('plan-compare-modal')).toBeNull());
    expect(within(screen.getByTestId(DRAWER)).getByTestId('plan-upgrade-upgrading')).toBeInTheDocument();
    await closeDrawer();
    now += 5_000;
    warm(); // focus returns to the row
    runIdle();
    await settle();
    expect(planGets()).toBe(1);

    const again = await openDrawer();
    await within(again).findByText(FRESH);
    await settle();
    expect(within(again).queryByText(WARM)).toBeNull();
    expect(planGets()).toBe(2);
  });
});

describe('rule 6: nothing warms while the drawer is open', () => {
  it('D-5: the idle callback fires while the drawer is open → zero requests while open', async () => {
    planReplies.push(planReply(payload(FRESH)));
    render(<Page />);
    expect(idleCallbacks.length).toBeGreaterThan(0);

    const sheet = await openDrawer(); // a cold open: the section reads for itself
    await within(sheet).findByText(FRESH);
    await settle();
    expect(planGets()).toBe(1);

    runIdle();
    await settle();
    expect(planGets()).toBe(1);
  });
});

describe('StrictMode', () => {
  it('D-6: warm, then open → zero new requests; the warm plan shows', async () => {
    planReplies.push(planReply(payload(WARM)));
    render(
      <React.StrictMode>
        <Page />
      </React.StrictMode>
    );
    warm();
    await settle();
    expect(planGets()).toBe(1);

    const sheet = await openDrawer();
    await within(sheet).findByText(WARM);
    await settle();
    expect(planGets()).toBe(1);
  });
});

describe('the checkout return reads fresh (B-2, SA condition C-11)', () => {
  it('D-7: a valid marker, warm, open → one fresh request; the warm plan is never shown', async () => {
    planReplies.push(planReply(payload(WARM)), planReply(payload(FRESH)));
    render(<Page checkoutMarker="cs_test_abc123" />);
    warm();
    await settle();
    expect(planGets()).toBe(1);

    const sheet = await openDrawer();
    await within(sheet).findByText(FRESH);
    await settle();
    expect(within(sheet).queryByText(WARM)).toBeNull();
    expect(within(sheet).getByTestId('plan-purchase-processing')).toBeInTheDocument();
    expect(planGets()).toBe(2);
  });
});
