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
import { UpgradeModal, type UpgradeModalFlow } from '@/components/business-os/settings/UpgradeModal';

import { LOWER, TOP, TRIAL, payingRow, payloadFor } from './upgradeModalPayloads';

const { translations } = jest.requireActual('@/lib/business-os/LanguageContext') as {
  translations: Record<Lang, Record<string, string>>;
};
const COPY = translations.en;
const fill = (template: string, values: Record<string, string>) => template.replace(/\{(\w+)\}/g, (slot, name: string) => values[name] ?? slot);
const nameOf = (payload: PlanPayload, planId: string) => payload.plans!.find((plan) => plan.planId === planId)!.name;
const SLOW = 20_000;

/** `PlanSection`'s flow instance as the modal receives it (UM-1b): everything may start. */
const FLOW: UpgradeModalFlow = {
  checkoutAllowed: true,
  upgradeAllowed: true,
  paymentsConfigured: true,
  onCheckoutComplete: () => {},
  onUpgrading: () => {},
  onUpgradeCheckAgain: async () => {},
};

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
    render(<UpgradeModal open onOpenChange={() => {}} plan={payload} flow={FLOW} />);
    const modal = screen.getByTestId('plan-compare-modal');
    const status = screen.getByTestId('plan-compare-status');
    expect(status).toHaveTextContent(nameOf(payload, LOWER));
    expect(payload.endsWhen).not.toBeNull();
    const offered = (payload.purchase?.upgrade?.tiers ?? []).includes(TOP);
    expect(within(modal).queryAllByText(COPY['upgrade_modal.recommended'])).toHaveLength(offered ? 1 : 0);
    expect(within(screen.getByTestId(`plan-compare-col-${LOWER}`)).getByText(COPY['upgrade_modal.your_plan'])).toBeInTheDocument();
    // UM-1b: an "Upgrade to" pair exactly when the server offers the upgrade.
    const upgradeName = fill(COPY['plan.upgrade.button'], { plan: nameOf(payload, TOP) });
    expect(buttonNames(modal)).toEqual(['Close', COPY['upgrade_modal.back_to_plan'], ...(offered ? [upgradeName, upgradeName] : [])].sort());
  });

  it('paused subscription: renders the server table, no dead button', async () => {
    const payload = await payloadFor({ billingRow: payingRow(LOWER, { subscriptionStatus: 'paused' }) });
    render(<UpgradeModal open onOpenChange={() => {}} plan={payload} flow={FLOW} />);
    const modal = screen.getByTestId('plan-compare-modal');
    expect(screen.getByRole('table', { name: COPY['upgrade_modal.plans_label'] })).toBeInTheDocument();
    // UM-1b: a column button only where the server offers that plan.
    const offered = new Set(payload.purchase?.upgrade?.tiers ?? []);
    const extra = Array.from(offered).flatMap((tier) => {
      const name = fill(COPY['plan.upgrade.button'], { plan: nameOf(payload, tier) });
      return [name, name];
    });
    expect(buttonNames(modal)).toEqual(['Close', COPY['upgrade_modal.back_to_plan'], ...extra].sort());
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
  it('Enter opens; focus starts on the title (SA Q-6); Tab cycles the column buttons, Back and X in DOM order; Escape returns focus to "See plans"', async () => {
    const payload = await payloadFor({ billingRow: payingRow(LOWER) });
    await showSection([payload]);
    const opener = screen.getByTestId('plan-compare-open');
    opener.focus();
    await userEvent.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog');
    const back = within(dialog).getByRole('button', { name: COPY['upgrade_modal.back_to_plan'] });
    const close = within(dialog).getByRole('button', { name: 'Close' });
    const header = within(dialog).getByTestId(`plan-compare-action-${TOP}-header`);
    const footer = within(dialog).getByTestId(`plan-compare-action-${TOP}-footer`);
    // UM-1b SA Q-6: focus lands on the title, never on a money button.
    await waitFor(() => expect(within(dialog).getByTestId('plan-compare-title')).toHaveFocus());
    const order: Array<Element | null> = [];
    for (let i = 0; i < 8; i += 1) {
      await userEvent.tab();
      order.push(document.activeElement);
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    // Visual and focus order agree (UM-1a Q-8): header button, footer button, Back, X, then around.
    expect(order.slice(0, 4)).toEqual([header, footer, back, close]);
    // The "Current plan" labels are never tabbable.
    expect(new Set(order)).toEqual(new Set([header, footer, back, close]));
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(opener).toHaveFocus());
  }, SLOW);
});

describe('QA: the money requests are unchanged, now from the modal (UM-1b §13; was C-1 "drawer after open / close")', () => {
  it('Essentials: after open / close, the modal\'s "Upgrade to …" still posts the preview', async () => {
    const payload = await payloadFor({ billingRow: payingRow(LOWER) });
    await showSection([payload]);
    await openAndClose();
    await userEvent.click(screen.getByTestId('plan-compare-open'));
    const upgrade = await screen.findByTestId(`plan-compare-action-${TOP}-header`);
    expect(upgrade).toHaveAccessibleName(fill(COPY['plan.upgrade.button'], { plan: nameOf(payload, TOP) }));
    await userEvent.click(upgrade);
    await waitFor(() => expect(server.posts).toHaveLength(1));
    expect(server.posts[0].url).toMatch(/\/preview$/);
    expect(server.posts[0].body).toMatchObject({ tier: TOP });
  }, SLOW);

  it('Trial: after open / close, the modal\'s "Choose …" still posts the checkout', async () => {
    const payload = await payloadFor({ planId: TRIAL });
    await showSection([payload]);
    await openAndClose();
    await userEvent.click(screen.getByTestId('plan-compare-open'));
    const choose = await screen.findByTestId(`plan-compare-action-${LOWER}-footer`);
    expect(choose).toHaveAccessibleName(fill(COPY['plan.choose.button'], { plan: nameOf(payload, LOWER) }));
    await userEvent.click(choose);
    await waitFor(() => expect(server.posts).toHaveLength(1));
    expect(server.posts[0].body).toEqual({ tier: LOWER, returnTo: 'settings_plan' });
  }, SLOW);
});

describe('QA: screen-reader cell text in he / es', () => {
  it.each(['he', 'es'] as const)('%s: every cell reads "{plan}: {state}" in the reader\'s language', async (language) => {
    mockLang.language = language;
    const payload = await payloadFor({ billingRow: payingRow(LOWER), language });
    render(<UpgradeModal open onOpenChange={() => {}} plan={payload} flow={FLOW} />);
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
