/**
 * @jest-environment jsdom
 *
 * QA additions for upgrade modal UM-1a (view only). Gaps found against the
 * workplan §9.4 / the QA brief and not pinned by `UpgradeModal.render`:
 *   - states: Essentials cancelling, paused subscription, payment failed (the
 *     drawer keeps B3 while the modal does not), unreadable plan (no button);
 *   - keyboard: open with Enter, focus trapped on the two buttons, Escape
 *     returns focus to "Compare plans";
 *   - money unchanged (C-1): after opening and closing the modal, the drawer's
 *     "Upgrade to …" and "Choose …" still POST exactly as before;
 *   - he / es screen-reader text "{plan}: {state}" in the reader's language.
 *
 * Real payloads (`upgradeModalPayloads`), fakes only at `fetch`.
 */

import '@testing-library/jest-dom';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

type Lang = 'en' | 'he' | 'es';
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
jest.mock('@/lib/stripe/StripeService', () => ({
  getStripeService: () => {
    throw new Error('the plan screen never talks to Stripe');
  },
}));
jest.mock('next/navigation', () => ({ useRouter: () => ({ replace: jest.fn() }) }));
jest.mock('@/lib/client/stripeJs', () => ({ getStripePromise: () => Promise.resolve({}) }));
jest.mock('@stripe/react-stripe-js', () => ({
  EmbeddedCheckoutProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  EmbeddedCheckout: () => <div data-testid="fake-checkout" />,
}));

import { PlanSection } from '@/components/business-os/settings/PlanSection';
import type { PlanPayload } from '@/components/business-os/settings/planPayloadTypes';
import { UpgradeModal } from '@/components/business-os/settings/UpgradeModal';

import { LOWER, TOP, TRIAL, payingRow, payloadFor } from './upgradeModalPayloads';

const { translations } = jest.requireActual('@/lib/business-os/LanguageContext') as {
  translations: Record<Lang, Record<string, string>>;
};
const COPY = translations.en;
const fill = (template: string, values: Record<string, string>) => template.replace(/\{(\w+)\}/g, (slot, name: string) => values[name] ?? slot);
const nameOf = (payload: PlanPayload, planId: string) => payload.plans!.find((plan) => plan.planId === planId)!.name;
const SLOW = 20_000;

function buttonNames(modal: HTMLElement) {
  return within(modal)
    .getAllByRole('button')
    .map((button) => button.textContent?.trim())
    .sort();
}

const server: { plans: Array<PlanPayload | 'fail'>; reads: number; posts: Array<{ url: string; body: unknown }> } = {
  plans: [],
  reads: 0,
  posts: [],
};

beforeEach(() => {
  mockLang.language = 'en';
  server.plans = [];
  server.reads = 0;
  server.posts = [];
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      server.posts.push({ url, body: JSON.parse(String(init.body)) });
      // Held open: the test only needs to see that the drawer's control still posts.
      return new Promise<Response>(() => {});
    }
    const next = server.plans[Math.min(server.reads, server.plans.length - 1)];
    server.reads += 1;
    if (next === 'fail') throw new Error('offline');
    return { ok: true, status: 200, json: async () => ({ success: true, data: next }) } as Response;
  }) as unknown as typeof fetch;
});

async function showSection(payloads: Array<PlanPayload | 'fail'>) {
  server.plans = payloads;
  render(<PlanSection />);
  await waitFor(() => expect(screen.queryByText(translations[mockLang.language]['plan.loading'])).not.toBeInTheDocument());
}

async function openAndClose() {
  await userEvent.click(screen.getByTestId('plan-compare-open'));
  await screen.findByRole('dialog');
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
}

describe('QA: more account states', () => {
  it('Essentials, cancelling: the "will not renew" ending in the status strip; ribbon only if the server offers the upgrade', async () => {
    const payload = await payloadFor({ billingRow: payingRow(LOWER, { cancelAtPeriodEnd: true }) });
    render(<UpgradeModal open onOpenChange={() => {}} plan={payload} />);
    const modal = screen.getByTestId('plan-compare-modal');
    const status = screen.getByTestId('plan-compare-status');
    expect(status).toHaveTextContent(nameOf(payload, LOWER));
    expect(payload.endsWhen).not.toBeNull();
    const offered = (payload.purchase?.upgrade?.tiers ?? []).includes(TOP);
    expect(within(modal).queryAllByText(COPY['upgrade_modal.recommended'])).toHaveLength(offered ? 1 : 0);
    expect(within(screen.getByTestId(`plan-compare-col-${LOWER}`)).getByText(COPY['upgrade_modal.your_plan'])).toBeInTheDocument();
    expect(buttonNames(modal)).toEqual(['Close', COPY['upgrade_modal.back_to_plan']].sort());
  });

  it('paused subscription: renders the server table, no dead button', async () => {
    const payload = await payloadFor({ billingRow: payingRow(LOWER, { subscriptionStatus: 'paused' }) });
    render(<UpgradeModal open onOpenChange={() => {}} plan={payload} />);
    const modal = screen.getByTestId('plan-compare-modal');
    expect(screen.getByRole('table', { name: COPY['upgrade_modal.plans_label'] })).toBeInTheDocument();
    expect(buttonNames(modal)).toEqual(['Close', COPY['upgrade_modal.back_to_plan']].sort());
  });

  it('payment failed: B3 stays in the drawer while the modal is open, and never inside the modal', async () => {
    // Note: payingRow(..., { subscriptionStatus: 'past_due' }) alone yields billing null (no
    // notice fields), so it does NOT reach payment_failed. The PlanPaymentState fixture does.
    const FAILED_AT = '2099-11-12T22:30:00.000Z';
    const payload = await payloadFor({
      billingRow: payingRow(LOWER, {
        livemode: false,
        subscriptionStatus: 'past_due',
        currentPeriodEnd: FAILED_AT,
        failedAttempts: 2,
        lastPaymentFailedAt: FAILED_AT,
        actionRequiredInvoiceUrl: null,
      }),
    });
    expect(payload.purchase?.billing?.state).toBe('payment_failed');
    await showSection([payload]);
    expect(screen.getByTestId('plan-update-card-email')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('plan-compare-open'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByTestId('plan-update-card-email')).not.toBeInTheDocument();
  }, SLOW);

  it('unreadable plan (failed read): no "Compare plans"', async () => {
    await showSection(['fail']);
    expect(screen.getByText(COPY['plan.problem.unavailable'])).toBeInTheDocument();
    expect(screen.queryByTestId('plan-compare-open')).not.toBeInTheDocument();
  });

  it('plan status not ok (unavailable): no "Compare plans"', async () => {
    const payload = await payloadFor();
    await showSection([{ ...payload, status: 'unavailable', problem: null } as PlanPayload]);
    expect(screen.queryByTestId('plan-compare-open')).not.toBeInTheDocument();
  });
});

describe('QA: keyboard', () => {
  it('Enter opens; Tab stays on the two buttons; Escape closes and focus returns to "Compare plans"', async () => {
    await showSection([await payloadFor({ billingRow: payingRow(LOWER) })]);
    const opener = screen.getByTestId('plan-compare-open');
    opener.focus();
    await userEvent.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog');
    const back = within(dialog).getByRole('button', { name: COPY['upgrade_modal.back_to_plan'] });
    const close = within(dialog).getByRole('button', { name: 'Close' });
    // Focus lands inside the modal on open.
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    const seen = new Set<Element | null>();
    for (let i = 0; i < 6; i += 1) {
      await userEvent.tab();
      seen.add(document.activeElement);
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    // Only the two buttons are tabbable (the "Current plan" labels are not).
    expect(seen).toEqual(new Set([back, close]));
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(opener).toHaveFocus());
  }, SLOW);
});

describe('QA: money behaviour unchanged after the modal (C-1)', () => {
  it('Essentials: after open / close, the drawer\'s "Upgrade to …" still posts the preview', async () => {
    const payload = await payloadFor({ billingRow: payingRow(LOWER) });
    await showSection([payload]);
    await openAndClose();
    const upgrade = screen.getByRole('button', { name: fill(COPY['plan.upgrade.button'], { plan: nameOf(payload, TOP) }) });
    await userEvent.click(upgrade);
    await waitFor(() => expect(server.posts).toHaveLength(1));
    expect(server.posts[0].url).toMatch(/\/preview$/);
    expect(server.posts[0].body).toMatchObject({ tier: TOP });
  }, SLOW);

  it('Trial: after open / close, the drawer\'s "Choose …" still posts the checkout', async () => {
    const payload = await payloadFor({ planId: TRIAL });
    await showSection([payload]);
    await openAndClose();
    const choose = screen.getByRole('button', { name: fill(COPY['plan.choose.button'], { plan: nameOf(payload, LOWER) }) });
    await userEvent.click(choose);
    await waitFor(() => expect(server.posts).toHaveLength(1));
    expect(server.posts[0].body).toEqual({ tier: LOWER, returnTo: 'settings_plan' });
  }, SLOW);
});

describe('QA: screen-reader cell text in he / es', () => {
  it.each(['he', 'es'] as const)('%s: every cell reads "{plan}: {state}" in the reader\'s language', async (language) => {
    mockLang.language = language;
    const payload = await payloadFor({ billingRow: payingRow(LOWER), language });
    render(<UpgradeModal open onOpenChange={() => {}} plan={payload} />);
    const L = translations[language];
    const cells = screen.getAllByTestId('plan-compare-cell');
    const expected = payload.comparison!.sections.flatMap((section) => section.rows).flatMap((row) => row.cells);
    expect(cells).toHaveLength(expected.length);
    expected.forEach((cell, index) => {
      const state = cell.value ?? L[cell.included ? 'upgrade_modal.included' : 'upgrade_modal.not_included'];
      const sr = cells[index].querySelector('.sr-only');
      expect(sr?.textContent).toBe(fill(L['upgrade_modal.cell_label'], { plan: nameOf(payload, cell.planId), state }));
    });
  });
});
