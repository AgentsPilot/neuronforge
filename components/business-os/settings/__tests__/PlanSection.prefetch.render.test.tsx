/**
 * @jest-environment jsdom
 */

/**
 * `PlanSection` takes the read the settings page started before the click
 * (settings drawer review C-2, slice C-b; workplan P-1..P-13; B-1..B-3; SA
 * Q-1..Q-4, SA-CB-4, SA-CB-10; SA condition C-11).
 *
 * The real component. `fetch` is routed by URL with deferred replies; the
 * prefetched set is built by hand (no `fetch`), so every `my-plan` GET counted
 * here is one the SECTION made. The warm answer and the fresh answer carry
 * different plan names (WARM / FRESH), so each test can tell which one is on
 * screen. Nothing asserts on elapsed time: fake time is used only to step the
 * existing 4 s re-read interval (P-9).
 *
 * Payloads are hand-built in the route's wire shape, so this file imports
 * nothing from the entitlements module (SA-CB-8); the real builder is pinned
 * against the component by the four Plan render suites, which C-b leaves
 * unedited.
 */

import '@testing-library/jest-dom';
import React from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('@/lib/supabaseClient', () => ({ supabase: {} }));

type Lang = 'en' | 'he';
const mockLang: { language: Lang } = { language: 'en' };
jest.mock('@/lib/business-os/LanguageContext', () => {
  const { translations } = jest.requireActual('@/lib/business-os/LanguageContext');
  return {
    useLanguage: () => ({
      language: mockLang.language,
      timezone: 'UTC',
      isRTL: mockLang.language === 'he',
      t: (key: string) => translations[mockLang.language][key] || key,
    }),
  };
});

jest.mock('@/lib/logger', () => {
  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    trace: jest.fn(),
    fatal: jest.fn(),
  };
  return {
    ...jest.requireActual('@/lib/logger'),
    createLogger: () => ({ ...logger, child: () => logger }),
    __logger: logger,
  };
});

const router = { replace: jest.fn() };
jest.mock('next/navigation', () => ({ useRouter: () => router }));
jest.mock('@/lib/client/stripeJs', () => ({ getStripePromise: () => Promise.resolve({ handleNextAction: async () => ({}) }) }));
jest.mock('@stripe/react-stripe-js', () => ({
  EmbeddedCheckoutProvider: ({ children }: { children: unknown }) => <div data-testid="fake-provider">{children as never}</div>,
  EmbeddedCheckout: () => <div data-testid="fake-checkout" />,
}));

import { PlanSection, type PlanPayload } from '@/components/business-os/settings/PlanSection';
import type { PlanDrawerRead, PlanRead } from '@/components/business-os/settings/planDrawerReads';
import { PROCESSING_REFRESH_INTERVAL_MS } from '@/components/business-os/billing/checkoutProcessing';

const { translations } = jest.requireActual('@/lib/business-os/LanguageContext') as {
  translations: Record<Lang, Record<string, string>>;
};
const COPY = translations.en;
const mockLogger = (jest.requireMock('@/lib/logger') as { __logger: Record<'debug' | 'info' | 'warn' | 'error', jest.Mock> }).__logger;

const MY_PLAN = '/api/business-os/entitlements/my-plan';
const WARM = 'WARM-PLAN';
const FRESH = 'FRESH-PLAN';
const VALID_MARKER = 'cs_test_abc123';
const LOW = 'plan-low';
const TOP = 'plan-top';
const TOP_NAME = 'Top plan';

/** A plan in the route's wire shape, named so the screen tells warm from fresh. */
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
  });
}

interface FakeResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}
const respond = (body: unknown, status = 200): FakeResponse => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const planBody = (plan: PlanPayload) => ({ success: true, data: plan });

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

type Reply = FakeResponse | Promise<FakeResponse> | 'network';
let planReplies: Reply[];
let postReplies: FakeResponse[];
const NETWORK_ERROR = new TypeError('Failed to fetch');
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
    if (next === 'network') return Promise.reject(NETWORK_ERROR);
    return Promise.resolve(next);
  }
  throw new Error(`Unrouted fetch: ${url}`);
}

const planGets = () => mockFetch.mock.calls.filter(([url, init]) => url === MY_PLAN && (init as { method?: string } | undefined)?.method !== 'POST').length;

/** A prefetched set, built by hand: no `fetch`, so it is never counted as the section's. */
const warmSet = (read: Promise<PlanRead> | PlanRead, language: string = 'en'): PlanDrawerRead => ({
  language,
  plan: Promise.resolve(read),
});
const answered = (plan: PlanPayload): PlanRead => ({ kind: 'answered', status: 200, body: planBody(plan) });

/** A `takePrefetched` that hands `set` over once, then nothing (the hook's rule 1). */
function takeOnce(set: PlanDrawerRead | null) {
  let held = set;
  return jest.fn(() => {
    const value = held;
    held = null;
    return value;
  });
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

beforeAll(() => {
  (global as unknown as { fetch: typeof mockFetch }).fetch = mockFetch;
});

beforeEach(() => {
  mockLang.language = 'en';
  mockFetch.mockReset();
  mockFetch.mockImplementation(route);
  planReplies = [];
  postReplies = [];
  router.replace.mockReset();
  for (const fn of Object.values(mockLogger)) fn.mockReset();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('the first read (B-1)', () => {
  it('P-1: a warm open with a resolved set → zero my-plan requests; the warm plan shows', async () => {
    const take = takeOnce(warmSet(answered(payload(WARM))));
    render(<PlanSection takePrefetched={take} />);
    await screen.findByText(WARM);
    await settle();
    expect(planGets()).toBe(0);
    expect(take).toHaveBeenCalledTimes(1);
  });

  it('P-2: the warm read still in flight → zero requests; the plan appears when it resolves', async () => {
    const pending = deferred<PlanRead>();
    const take = takeOnce({ language: 'en', plan: pending.promise });
    render(<PlanSection takePrefetched={take} />);
    await settle();
    expect(screen.getByText(COPY['plan.loading'])).toBeInTheDocument();
    expect(planGets()).toBe(0);

    await act(async () => pending.resolve(answered(payload(WARM))));
    await screen.findByText(WARM);
    await settle();
    expect(planGets()).toBe(0);
  });

  it.each([
    ['no prop', undefined],
    ['a prop that hands over nothing', () => null],
  ] as const)('P-3: a cold open (%s) → exactly one request', async (_label, takePrefetched) => {
    planReplies.push(respond(planBody(payload(FRESH))));
    render(<PlanSection takePrefetched={takePrefetched} />);
    await screen.findByText(FRESH);
    await settle();
    expect(planGets()).toBe(1);
  });
});

describe('StrictMode (B-1, SA Q-2)', () => {
  it('P-4: a warm open → take called ONCE, zero requests, the warm plan shows', async () => {
    const take = takeOnce(warmSet(answered(payload(WARM))));
    render(
      <React.StrictMode>
        <PlanSection takePrefetched={take} />
      </React.StrictMode>
    );
    await screen.findByText(WARM);
    await settle();
    expect(take).toHaveBeenCalledTimes(1);
    expect(planGets()).toBe(0);
  });

  it('P-4: a cold open → exactly ONE request (the cancelled run and the kept run share it)', async () => {
    planReplies.push(respond(planBody(payload(FRESH))));
    render(
      <React.StrictMode>
        <PlanSection takePrefetched={() => null} />
      </React.StrictMode>
    );
    await screen.findByText(FRESH);
    await settle();
    expect(planGets()).toBe(1);
  });
});

describe('the checkout return reads fresh (B-2, SA condition C-11)', () => {
  it('P-5: a valid marker plus a warm set → one fresh request; the fresh answer shows and the warm one never does', async () => {
    planReplies.push(respond(planBody(payload(FRESH))));
    const take = takeOnce(warmSet(answered(payload(WARM))));
    render(<PlanSection checkoutMarker={VALID_MARKER} takePrefetched={take} />);
    await screen.findByText(FRESH);
    await settle();
    expect(planGets()).toBe(1);
    expect(take).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(WARM)).not.toBeInTheDocument();
    // Today's display: not yet renewing, so "Payment processing".
    expect(screen.getByTestId('plan-purchase-processing')).toBeInTheDocument();
  });

  it('P-5b: a malformed marker is no marker (today\'s display rule) → the warm read is used, zero requests', async () => {
    const take = takeOnce(warmSet(answered(payload(WARM))));
    render(<PlanSection checkoutMarker="not-a-session-id" takePrefetched={take} />);
    await screen.findByText(WARM);
    await settle();
    expect(planGets()).toBe(0);
  });
});

describe('the language (B-2, B-3)', () => {
  it('P-6: a set started in another language is ignored → one request', async () => {
    planReplies.push(respond(planBody(payload(FRESH))));
    const take = takeOnce(warmSet(answered(payload(WARM)), 'he'));
    render(<PlanSection takePrefetched={take} />);
    await screen.findByText(FRESH);
    await settle();
    expect(planGets()).toBe(1);
    expect(screen.queryByText(WARM)).not.toBeInTheDocument();
  });

  it('P-7: a warm open, then he → one new request; then back to en → one more (the first read is spent)', async () => {
    planReplies.push(respond(planBody(payload('HE-PLAN'))), respond(planBody(payload('EN-AGAIN'))));
    const take = takeOnce(warmSet(answered(payload(WARM))));
    const { rerender } = render(<PlanSection takePrefetched={take} />);
    await screen.findByText(WARM);
    await settle();
    expect(planGets()).toBe(0);

    mockLang.language = 'he';
    rerender(<PlanSection takePrefetched={take} />);
    await screen.findByText('HE-PLAN');
    expect(planGets()).toBe(1);

    mockLang.language = 'en';
    rerender(<PlanSection takePrefetched={take} />);
    await screen.findByText('EN-AGAIN');
    await settle();
    expect(planGets()).toBe(2);
  });

  it('P-7b: the language changes while the warm read is still in flight → the new language reads fresh; the warm answer is never shown (MB-7)', async () => {
    const pending = deferred<PlanRead>();
    planReplies.push(respond(planBody(payload('HE-PLAN'))));
    const take = takeOnce({ language: 'en', plan: pending.promise });
    const { rerender } = render(<PlanSection takePrefetched={take} />);
    await settle();
    expect(planGets()).toBe(0);

    mockLang.language = 'he';
    rerender(<PlanSection takePrefetched={take} />);
    await screen.findByText('HE-PLAN');
    expect(planGets()).toBe(1);

    await act(async () => pending.resolve(answered(payload(WARM))));
    await settle();
    expect(screen.queryByText(WARM)).not.toBeInTheDocument();
    expect(screen.getByText('HE-PLAN')).toBeInTheDocument();
    expect(planGets()).toBe(1);
    expect(take).toHaveBeenCalledTimes(1);
  });
});

describe('success only from a server read after the action (M-6, U-5)', () => {
  it('P-8: a warm renewing paid plan with no marker → no "You\'re on" of either kind', async () => {
    const take = takeOnce(warmSet(answered(paying(WARM))));
    render(<PlanSection takePrefetched={take} />);
    await screen.findByText(WARM);
    await settle();
    expect(screen.queryByTestId('plan-purchase-done')).not.toBeInTheDocument();
    expect(screen.queryByTestId('plan-upgrade-done')).not.toBeInTheDocument();
    expect(planGets()).toBe(0);
  });

  it('P-9: after a warm open, a marker arriving (router.replace after onComplete) → processing; one interval → exactly one new request, whose answer drives "You\'re on"', async () => {
    // The owner can choose: not paying yet.
    const choosing = payload(WARM, {
      kind: 'cohort',
      planId: 'trial',
      plans: [{ planId: LOW, name: 'Low plan', monthlyPriceUsd: 29, availableToBuy: true }],
      purchase: { offer: { kind: 'choose', tiers: [LOW] }, billing: null, endsFreeAccessOnPurchase: 'trial', upgrade: null },
    });
    const take = takeOnce(warmSet(answered(choosing)));
    const { rerender } = render(<PlanSection takePrefetched={take} />);
    await screen.findByText(WARM);
    await settle();
    expect(planGets()).toBe(0);

    jest.useFakeTimers();
    planReplies.push(respond(planBody(paying(FRESH))));
    rerender(<PlanSection checkoutMarker={VALID_MARKER} takePrefetched={take} />);
    expect(screen.getByTestId('plan-purchase-processing')).toBeInTheDocument();
    expect(planGets()).toBe(0);

    await act(async () => {
      jest.advanceTimersByTime(PROCESSING_REFRESH_INTERVAL_MS);
    });
    // Let the routed reply, its json() and the state update land (microtasks
    // only: the fake clock is not moved again).
    for (let i = 0; i < 5; i += 1) {
      await act(async () => {
        await Promise.resolve();
      });
    }
    expect(planGets()).toBe(1);
    expect(screen.getByTestId('plan-purchase-done')).toHaveTextContent(FRESH);
    expect(take).toHaveBeenCalledTimes(1);
  });

  it('P-10: "Check again" after a warm open → exactly one new request', async () => {
    const take = takeOnce(warmSet(answered(paying(WARM))));
    render(<PlanSection takePrefetched={take} />);
    await screen.findByText(WARM);
    postReplies.push(
      respond({
        success: true,
        data: { fromTier: LOW, tier: TOP, amountDueMinor: 3387, taxMinor: 0, currency: 'usd', prorationDate: 1_792_766_146, renewsOn: '2026-11-13T09:30:00.000Z', monthlyPriceMinor: 12900 },
      }),
      // The confirm: a 500 with no code, so the outcome is unknown.
      respond({ success: false, error: 'Internal server error' }, 500)
    );
    const upgradeLabel = COPY['plan.upgrade.button'].replace('{plan}', TOP_NAME);
    await userEvent.click(screen.getByRole('button', { name: upgradeLabel }));
    await screen.findByTestId('plan-upgrade-quote');
    await userEvent.click(screen.getByRole('button', { name: COPY['plan.upgrade.confirm'] }));
    const unknown = await screen.findByTestId('plan-upgrade-unknown');
    expect(planGets()).toBe(0);

    planReplies.push(respond(planBody(paying(FRESH))));
    await userEvent.click(within(unknown).getByRole('button', { name: COPY['plan.purchase.check_again'] }));
    await waitFor(() => expect(planGets()).toBe(1));
    await screen.findByText(FRESH);
    await settle();
    expect(planGets()).toBe(1);
  });
});

describe('an unusable warm answer is never shown (SA Q-3, SA-CB-4)', () => {
  it.each([
    ['a throw', { kind: 'threw', err: new Error('warm offline') } as PlanRead],
    ['a 500 with { success: false }', { kind: 'answered', status: 500, body: { success: false } } as PlanRead],
    ['an unavailable plan', answered(payload(WARM, { status: 'unavailable' }))],
    ['no plan record', answered(payload(WARM, { status: 'no_plan_record' }))],
  ])('P-11: %s → exactly one fresh request; only its answer shows; one debug line, no warn or error', async (_label, read) => {
    planReplies.push(respond(planBody(payload(FRESH))));
    render(<PlanSection takePrefetched={takeOnce(warmSet(read))} />);
    await screen.findByText(FRESH);
    await settle();
    expect(planGets()).toBe(1);
    expect(screen.queryByText(WARM)).not.toBeInTheDocument();
    expect(mockLogger.debug).toHaveBeenCalledTimes(1);
    const [context, message] = mockLogger.debug.mock.calls[0];
    expect(message).toBe('Prefetched plan read unusable; reading again');
    expect(Object.keys(context).sort()).toEqual(read.kind === 'threw' ? ['err', 'reason'] : ['reason', 'status']);
    // No payload, no plan name (MB-12).
    expect(JSON.stringify(context)).not.toContain(WARM);
    expect(context).not.toHaveProperty('body');
    expect(mockLogger.warn).not.toHaveBeenCalled();
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it('P-11: then a fresh failure → the "unavailable" notice and exactly one error({ err }) with the original error (logging parity)', async () => {
    planReplies.push('network');
    render(<PlanSection takePrefetched={takeOnce(warmSet({ kind: 'threw', err: new Error('warm offline') }))} />);
    await screen.findByText(COPY['plan.problem.unavailable']);
    await settle();
    expect(planGets()).toBe(1);
    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    expect(mockLogger.error).toHaveBeenCalledWith({ err: NETWORK_ERROR }, 'Could not load the plan section');
    expect(mockLogger.error.mock.calls[0][0].err).toBe(NETWORK_ERROR);
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('a cold first read that fails logs exactly as before: one error({ err }), and no debug line', async () => {
    planReplies.push('network');
    render(<PlanSection />);
    await screen.findByText(COPY['plan.problem.unavailable']);
    await settle();
    expect(planGets()).toBe(1);
    expect(mockLogger.error).toHaveBeenCalledWith({ err: NETWORK_ERROR }, 'Could not load the plan section');
    expect(mockLogger.debug).not.toHaveBeenCalled();
  });
});

describe('the set is taken once per mount (SA Q-4, SA-CB-10)', () => {
  it('P-12: take is called once, including across a language change (the re-run never takes again)', async () => {
    planReplies.push(respond(planBody(payload('HE-PLAN'))));
    const take = takeOnce(warmSet(answered(payload(WARM))));
    const { rerender } = render(<PlanSection takePrefetched={take} />);
    await screen.findByText(WARM);
    mockLang.language = 'he';
    rerender(<PlanSection takePrefetched={take} />);
    await screen.findByText('HE-PLAN');
    await settle();
    expect(take).toHaveBeenCalledTimes(1);
  });

  it('P-12: with a valid checkout marker, take is still called once and its set is not used (MB-23)', async () => {
    planReplies.push(respond(planBody(payload(FRESH))));
    const take = takeOnce(warmSet(answered(payload(WARM))));
    render(<PlanSection checkoutMarker={VALID_MARKER} takePrefetched={take} />);
    await screen.findByText(FRESH);
    await settle();
    expect(take).toHaveBeenCalledTimes(1);
    expect(planGets()).toBe(1);
    expect(screen.queryByText(WARM)).not.toBeInTheDocument();
  });
});

describe('unmount before the warm read settles', () => {
  it('P-13: nothing is applied or logged after unmount, and no request is made', async () => {
    const pending = deferred<PlanRead>();
    const { unmount } = render(<PlanSection takePrefetched={takeOnce({ language: 'en', plan: pending.promise })} />);
    await settle();
    unmount();
    // An unusable answer would log and read again if the cancelled run went on.
    await act(async () => pending.resolve({ kind: 'threw', err: new Error('late') }));
    await settle();
    expect(planGets()).toBe(0);
    expect(mockLogger.debug).not.toHaveBeenCalled();
    expect(mockLogger.error).not.toHaveBeenCalled();
  });
});
