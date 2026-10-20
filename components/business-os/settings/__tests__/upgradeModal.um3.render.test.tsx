/**
 * @jest-environment jsdom
 *
 * Upgrade modal UM-3: the accessibility pass and the phone polish, on the real
 * `UpgradeModal` with REAL payloads (workplan §7 A-5, A-7 to A-12; §8.1 to §8.3;
 * SA Y-5; UM-2 carry-over N-1).
 *
 *   - names: the dialog's description per variant (en / he / es), the X in the
 *     reader's language, the footer close label, column headers, ✕ cells;
 *   - focus order: title → header buttons in column order → footer row →
 *     footer close → X, in English and Hebrew; in a flow, "Back to plans" first;
 *   - the "Back to plans" link: primary text, underlined (not colour alone);
 *   - phone: the band's gradient strip fits the band's end padding (Y-5), and
 *     while a flow is open the band tightens and the subheading leaves the screen
 *     but stays the description; B7 is hidden under an open flow;
 *   - N-1: the "can't be bought" line comes before the table.
 */

import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

type Lang = 'en' | 'he' | 'es';
const mockLang: { language: Lang } = { language: 'en' };
jest.mock('@/lib/business-os/LanguageContext', () => {
  const { translations } = jest.requireActual('@/lib/business-os/LanguageContext');
  const value = () => ({
    language: mockLang.language,
    timezone: 'UTC',
    isRTL: mockLang.language === 'he',
    t: (key: string) => translations[mockLang.language][key] || key,
  });
  return { useLanguage: value, useOptionalLanguage: value };
});
jest.mock('@/lib/supabaseClient', () => ({ supabase: {} }));
jest.mock('next/navigation', () => ({ useRouter: () => ({ replace: jest.fn() }) }));
jest.mock('@/lib/client/stripeJs', () => ({ getStripePromise: () => Promise.resolve({ handleNextAction: async () => ({}) }) }));
jest.mock('@stripe/react-stripe-js', () => ({
  EmbeddedCheckoutProvider: ({ children }: { children: React.ReactNode }) => <div data-testid="fake-provider">{children}</div>,
  EmbeddedCheckout: () => <div data-testid="fake-checkout" />,
}));

import type { PlanPayload } from '@/components/business-os/settings/planPayloadTypes';
import { UpgradeModal, type UpgradeModalFlow } from '@/components/business-os/settings/UpgradeModal';
import type { UpgradeModalContext } from '@/components/business-os/settings/upgradeModalContext';

import { FOUNDING_PARTNER, LOWER, TOP, TRIAL, inSixtyDays, payingRow, payloadFor } from './upgradeModalPayloads';

const { translations } = jest.requireActual('@/lib/business-os/LanguageContext') as {
  translations: Record<Lang, Record<string, string>>;
};
const SLOW = 30_000;
const fill = (template: string, values: Record<string, string>) => template.replace(/\{(\w+)\}/g, (slot, name: string) => values[name] ?? slot);

const CHECKOUT = { success: true, data: { clientSecret: 'cs_test_secret_x', sessionId: 'cs_test_um3', expiresAt: '2026-10-13T10:31:00.000Z', tier: 'x' } };
beforeEach(() => {
  mockLang.language = 'en';
  // The islands' own requests: a checkout start answers; an upgrade preview never does (the quote is not under test).
  global.fetch = jest.fn(async (url: string) =>
    url.endsWith('/preview') ? new Promise<Response>(() => {}) : ({ ok: true, status: 200, json: async () => CHECKOUT } as Response)
  ) as unknown as typeof fetch;
});

const flow = (): UpgradeModalFlow => ({
  checkoutAllowed: true,
  upgradeAllowed: true,
  paymentsConfigured: true,
  onCheckoutComplete: jest.fn(),
  onUpgrading: jest.fn(),
  onUpgradeCheckAgain: jest.fn(async () => undefined),
});

function show(
  payload: PlanPayload,
  { language = 'en', context, footerClose }: { language?: Lang; context?: UpgradeModalContext; footerClose?: 'back_to_plan' | 'close' } = {}
) {
  mockLang.language = language;
  const view = render(<UpgradeModal open onOpenChange={() => undefined} flow={flow()} plan={payload} context={context} footerClose={footerClose} />);
  const dialog = screen.getByRole('dialog');
  return Object.assign(dialog, { unmount: view.unmount });
}

const trial = () => payloadFor({ planId: TRIAL });
const essentials = () => payloadFor({ billingRow: payingRow(LOWER) });

describe('A-8: the dialog is described by the subheading actually shown, in every language', () => {
  it.each(['en', 'he', 'es'] as const)('%s: default, upgrade (CV-5), locked_feature, founding_partner', async (language) => {
    const copy = translations[language];
    const cases: Array<[() => Promise<PlanPayload>, UpgradeModalContext | undefined, string]> = [
      [() => payloadFor({ planId: TRIAL, language }), undefined, copy['upgrade_modal.subheading']],
      [() => payloadFor({ billingRow: payingRow(LOWER), language }), undefined, copy['upgrade_modal.subheading.upgrade']],
      [() => payloadFor({ planId: TRIAL, language }), { kind: 'locked_feature', planId: TOP }, ''],
      [() => payloadFor({ planId: FOUNDING_PARTNER, cohortExpiresAt: inSixtyDays(), language }), { kind: 'founding_partner' }, copy['upgrade_modal.subheading.founding_partner']],
    ];
    for (const [make, context, expected] of cases) {
      const payload = await make();
      const dialog = show(payload, { language, context });
      const description =
        expected || fill(copy['upgrade_modal.subheading.locked_feature'], { plan: payload.plans!.find((choice) => choice.planId === TOP)!.name });
      expect(dialog).toHaveAccessibleDescription(description);
      dialog.unmount();
    }
  }, SLOW);
});

describe('A-9 / A-12: the X, the footer close and every button are named', () => {
  it.each([
    ['he', 'סגירה'],
    ['es', 'Cerrar'],
    ['en', 'Close'],
  ] as const)('%s: the X is named "%s"', async (language, name) => {
    const dialog = show(await payloadFor({ planId: TRIAL, language }), { language });
    const x = within(dialog)
      .getAllByRole('button')
      .find((button) => !button.closest('[data-testid="plan-compare-footer"]') && !button.dataset.testid);
    expect(x).toHaveAccessibleName(name);
  }, SLOW);

  it('the footer reads "Back to your plan" by default (the drawer is behind it) and "Close" with footerClose', async () => {
    const payload = await trial();
    const first = show(payload);
    expect(within(within(first).getByTestId('plan-compare-footer')).getByRole('button')).toHaveAccessibleName(translations.en['upgrade_modal.back_to_plan']);
    first.unmount();
    const dialog = show(payload, { footerClose: 'close' });
    expect(within(within(dialog).getByTestId('plan-compare-footer')).getByRole('button')).toHaveAccessibleName(translations.en['upgrade_modal.close']);
  }, SLOW);
});

describe('A-10 / A-11: column headers and cells', () => {
  it('each column header names its plan; the current column carries "Your plan"; a ✕ cell reads "Not included" in Hebrew', async () => {
    const payload = await payloadFor({ billingRow: payingRow(LOWER), language: 'he' });
    const dialog = show(payload, { language: 'he' });
    const headers = within(dialog).getAllByRole('columnheader');
    for (const header of headers) {
      const name = payload.plans!.find((choice) => header.textContent?.includes(choice.name));
      expect(name).toBeTruthy();
    }
    expect(within(dialog).getByTestId(`plan-compare-col-${LOWER}`)).toHaveTextContent(translations.he['upgrade_modal.your_plan']);
    const hasCross = payload.comparison!.sections.some((section) => section.rows.some((row) => row.cells.some((cell) => cell.value === null && !cell.included)));
    if (hasCross) expect(within(dialog).getAllByText(translations.he['upgrade_modal.not_included'], { exact: false }).length).toBeGreaterThan(0);
  }, SLOW);
});

/** Tab from the title until focus leaves the dialog or comes back; the names in order. */
async function tabOrder(dialog: HTMLElement): Promise<HTMLElement[]> {
  const seen: HTMLElement[] = [];
  for (let i = 0; i < 20; i += 1) {
    await userEvent.tab();
    const active = document.activeElement as HTMLElement;
    if (!dialog.contains(active) || seen.includes(active)) break;
    seen.push(active);
  }
  return seen;
}

describe('A-7: focus order', () => {
  it.each(['en', 'he'] as const)('%s: header buttons in column order, the footer row, the footer close, then the X', async (language) => {
    const payload = await payloadFor({ planId: TRIAL, language });
    const dialog = show(payload, { language });
    await waitFor(() => expect(screen.getByTestId('plan-compare-title')).toHaveFocus());
    const order = await tabOrder(dialog);
    const ids = order.map((element) => element.dataset.testid ?? (element.closest('[data-testid="plan-compare-footer"]') ? 'footer-close' : 'x'));
    const offered = payload.comparison!.planIds.filter((planId) => screen.queryByTestId(`plan-compare-action-${planId}-header`));
    expect(ids).toEqual([
      ...offered.map((planId) => `plan-compare-action-${planId}-header`),
      ...offered.map((planId) => `plan-compare-action-${planId}-footer`),
      'footer-close',
      'x',
    ]);
  }, SLOW);

  it('in a flow: focus on the flow heading, "Back to plans" just before it, then the footer close and the X (A-5)', async () => {
    const dialog = show(await essentials());
    await userEvent.click(within(dialog).getByTestId(`plan-compare-action-${TOP}-header`));
    const back = await within(dialog).findByTestId('plan-compare-back');
    expect(back).toHaveAccessibleName(translations.en['upgrade_modal.back_to_plans']);
    expect(back.className).toContain('text-[var(--v2-text-primary)]');
    expect(back.className).toContain('underline');
    expect(back.className).not.toContain('text-[var(--v2-primary)]');
    await waitFor(() => expect(screen.getByTestId('plan-compare-flow-heading')).toHaveFocus());
    // Back: the element before the heading.
    await userEvent.tab({ shift: true });
    expect(back).toHaveFocus();
    screen.getByTestId('plan-compare-flow-heading').focus();
    // Forward (the quote is still loading, so the island has no control yet): footer close, the X, then the trap wraps to Back.
    const order = await tabOrder(dialog);
    expect(order.map((element) => (element.closest('[data-testid="plan-compare-footer"]') ? 'footer-close' : element.dataset.testid ?? 'x'))).toEqual(['footer-close', 'x', 'plan-compare-back']);
  }, SLOW);
});

describe('§8: the phone band and the flow', () => {
  it('Y-5: below 640 px the gradient is a 48 px strip inside the band\'s 48 px end padding; the text needs no reservation', async () => {
    show(await trial());
    const band = screen.getByTestId('plan-compare-band');
    const gradient = screen.getByTestId('plan-compare-band-gradient');
    expect(band.className).toMatch(/(^|\s)pe-12(\s|$)/);
    expect(gradient.className).toMatch(/(^|\s)w-12(\s|$)/);
    expect(gradient.className).toContain('sm:w-1/4');
    const textColumn = gradient.nextElementSibling as HTMLElement;
    expect(textColumn.className).not.toContain('pe-[25%]');
    expect(textColumn.className).toContain('sm:pe-[22%]');
  }, SLOW);

  it('§8.2 / §8.3: in a checkout flow B7 is hidden, the band tightens, the subheading leaves the screen but stays the description', async () => {
    const payload = await trial();
    expect(payload.whenThisChanges).toBeTruthy();
    const dialog = show(payload);
    expect(within(dialog).getByTestId('plan-compare-when-this-changes')).toBeInTheDocument();
    expect(screen.getByTestId('plan-compare-band').className).not.toContain('max-sm:py-3');

    await userEvent.click(within(dialog).getByTestId(`plan-compare-action-${LOWER}-header`));
    await within(dialog).findByTestId('plan-compare-flow');
    expect(within(dialog).queryByTestId('plan-compare-when-this-changes')).not.toBeInTheDocument();
    expect(screen.getByTestId('plan-compare-band').className).toContain('max-sm:py-3');
    const subheading = within(screen.getByTestId('plan-compare-title')).getByText(translations.en['upgrade_modal.subheading']);
    expect(subheading.className).toContain('max-sm:sr-only');
    expect(dialog).toHaveAccessibleDescription(translations.en['upgrade_modal.subheading']);

    // Back to plans: B7 returns.
    await userEvent.click(within(dialog).getByTestId('plan-compare-back'));
    expect(await within(dialog).findByTestId('plan-compare-when-this-changes')).toBeInTheDocument();
  }, SLOW);
});

/**
 * SA CR-1: under "Payment processing" (a return marker, or a checkout completed
 * in the pop-up, both arrive as the flow's `marker`) B7 "Nothing is charged…" is
 * hidden; back in the table view it returns. CR-2: the status lines are
 * --v2-text-secondary, not muted.
 */
describe('CR-1 / CR-2: the footer under the checkout status', () => {
  const status = (marker: string | null) => ({
    marker,
    succeeded: false,
    checkoutProcessing: marker !== null,
    upgradeSucceeded: false,
    upgradeProcessing: false,
    processing: marker !== null,
    exhausted: false,
  });

  it('a marker (return, or completed here): status body, no B7; marker gone: the table and B7 again', async () => {
    const payload = await trial();
    expect(payload.whenThisChanges).toBeTruthy();
    const element = (marker: string | null) => (
      <UpgradeModal open onOpenChange={() => undefined} flow={flow()} plan={payload} afterCheckout="stay" flowStatus={status(marker)} footerClose="close" />
    );
    const view = render(element('cs_test_cr1'));
    const dialog = screen.getByRole('dialog');
    const processing = await within(dialog).findByTestId('plan-purchase-processing');
    expect(within(dialog).queryByTestId('plan-compare-when-this-changes')).not.toBeInTheDocument();
    expect(within(dialog).queryByTestId('plan-compare-table')).not.toBeInTheDocument();
    expect(processing.className).toContain('text-[var(--v2-text-secondary)]');
    expect(processing.className).not.toContain('text-[var(--v2-text-muted)]');

    view.rerender(element(null));
    await within(dialog).findByTestId('plan-compare-table');
    expect(within(dialog).getByTestId('plan-compare-when-this-changes')).toBeInTheDocument();
  }, SLOW);

  it('without `stay` (the drawer\'s nested instance) a flow marker changes nothing: table and B7 shown', async () => {
    const payload = await trial();
    render(<UpgradeModal open onOpenChange={() => undefined} flow={flow()} plan={payload} flowStatus={status('cs_test_cr1')} />);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByTestId('plan-compare-table')).toBeInTheDocument();
    expect(within(dialog).getByTestId('plan-compare-when-this-changes')).toBeInTheDocument();
  }, SLOW);
});

describe('SA Lows: the strip separators and the "Confirm your payment" link', () => {
  it('each "·" ends the item before it (no line starts with one); B4 is primary text, underlined', async () => {
    const base = await essentials();
    const payload: PlanPayload = {
      ...base,
      purchase: { ...base.purchase!, billing: { state: 'action_required', date: '2099-11-12T22:30:00.000Z', confirmUrl: 'https://invoice.stripe.com/i/x' } },
    };
    render(<UpgradeModal open onOpenChange={() => undefined} flow={flow()} plan={payload} strip="your_plan" />);
    const line = screen.getByTestId('plan-compare-status-name').closest('p') as HTMLElement;
    const items = Array.from(line.children).slice(1) as HTMLElement[];
    for (const item of items) expect(item.textContent!.startsWith('·')).toBe(false);
    // A no-break space before the "·", so it cannot be wrapped away from its item.
    expect(items[0].textContent!.endsWith(' ·')).toBe(true);
    const link = screen.getByTestId('plan-confirm-payment');
    expect(link.className).toContain('text-[var(--v2-text-primary)]');
    expect(link.className).toContain('underline');
    expect(link.className).not.toContain('text-[var(--v2-primary)]');
  }, SLOW);
});

describe('N-1: the "can\'t be bought" line is seen without scrolling', () => {
  it('it comes before the table in the document', async () => {
    const payload = await payloadFor({ planId: FOUNDING_PARTNER });
    show(payload, { context: { kind: 'locked_feature', planId: TOP } });
    const line = screen.getByTestId('plan-compare-locked-not-offered');
    const table = screen.getByTestId('plan-compare-table');
    expect(line.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }, SLOW);
});
