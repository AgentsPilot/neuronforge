/**
 * @jest-environment jsdom
 *
 * The plan comparison modal (upgrade modal UM-1a, workplan §9.4; UM-1b §12:
 * the columns now carry the server's buttons — the flows themselves are
 * `upgradeModal.flow.render`).
 *
 * Fed REAL payloads (`upgradeModalPayloads`: the real plan view + the real
 * purchase view, through JSON), so what is asserted is the server's table as
 * a customer would see it:
 *   - per account state: the markers, the "Current plan" label, the headline,
 *     the footer sentences, and NO dead button (the X, "Back to your plan", and
 *     a column button only for a plan the server offers this account);
 *   - C-21: rows, labels, ✓ / ✕, values and highlight follow the payload exactly;
 *   - C-22 / C-23: "Current plan" is not a control; every cell names its plan;
 *   - semantics, phone classes (C-24, W-8), C-8 / C-9 classes, RTL, es;
 *   - through `PlanSection`: open / close / focus return, no read on open, a
 *     plan change while open shows in the modal (W-2), hidden while processing.
 */

import '@testing-library/jest-dom';
import { act, render, screen, waitFor, within } from '@testing-library/react';
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
  EmbeddedCheckout: () => <div />,
}));

import { PlanSection } from '@/components/business-os/settings/PlanSection';
import type { PlanPayload } from '@/components/business-os/settings/planPayloadTypes';
import { UpgradeModal, type UpgradeModalFlow } from '@/components/business-os/settings/UpgradeModal';

import { FOUNDING_PARTNER, LOWER, TOP, TRIAL, inSixtyDays, payingRow, payloadFor } from './upgradeModalPayloads';

const { translations } = jest.requireActual('@/lib/business-os/LanguageContext') as {
  translations: Record<Lang, Record<string, string>>;
};
const COPY = translations.en;
const fill = (template: string, values: Record<string, string>) => template.replace(/\{(\w+)\}/g, (slot, name: string) => values[name] ?? slot);

beforeEach(() => {
  mockLang.language = 'en';
});

/** `PlanSection`'s flow instance, as the modal receives it (UM-1b, C-3): everything may start. */
const openFlow = (): UpgradeModalFlow => ({
  checkoutAllowed: true,
  upgradeAllowed: true,
  paymentsConfigured: true,
  onCheckoutComplete: jest.fn(),
  onUpgrading: jest.fn(),
  onUpgradeCheckAgain: jest.fn(async () => undefined),
});

function showModal(payload: PlanPayload, language: Lang = 'en', flow: UpgradeModalFlow = openFlow()) {
  mockLang.language = language;
  const onOpenChange = jest.fn();
  render(<UpgradeModal open onOpenChange={onOpenChange} plan={payload} flow={flow} />);
  return { modal: screen.getByTestId('plan-compare-modal'), onOpenChange };
}

const nameOf = (payload: PlanPayload, planId: string) => payload.plans!.find((plan) => plan.planId === planId)!.name;
const columnHeader = (planId: string) => screen.getByTestId(`plan-compare-col-${planId}`);
const allRows = (payload: PlanPayload) => payload.comparison!.sections.flatMap((section) => section.rows);

/** The plan ids the server offers this account (to choose, or to upgrade to). */
const offeredIds = (payload: PlanPayload) =>
  new Set([...(payload.purchase?.offer.kind === 'choose' ? payload.purchase.offer.tiers : []), ...(payload.purchase?.upgrade?.tiers ?? [])]);

/**
 * No dead button (UM-FR3; UM-1b §12.1): every button is Radix's X, "Back to your
 * plan", or a column button for a plan the SERVER offers — two per offered
 * column (header and footer). Checked against the payload, never config.
 */
function expectNoDeadButton(modal: HTMLElement, payload: PlanPayload, language: Lang = 'en') {
  const offered = offeredIds(payload);
  const columnButtons: string[] = [];
  for (const button of within(modal).getAllByRole('button')) {
    const match = /^plan-compare-action-(.+)-(header|footer)$/.exec(button.getAttribute('data-testid') ?? '');
    if (match) {
      expect({ planId: match[1], offered: offered.has(match[1]) }).toEqual({ planId: match[1], offered: true });
      columnButtons.push(match[1]);
      continue;
    }
    expect(['Close', translations[language]['upgrade_modal.back_to_plan']]).toContain(button.textContent?.trim());
  }
  const shownOffered = payload.comparison!.planIds.filter((planId) => offered.has(planId));
  expect(columnButtons.sort()).toEqual([...shownOffered, ...shownOffered].sort());
}

/** The column's two buttons (header, footer), and their shared accessible name. */
function expectColumnButtons(planId: string, name: string) {
  for (const where of ['header', 'footer']) expect(screen.getByTestId(`plan-compare-action-${planId}-${where}`)).toHaveAccessibleName(name);
}

describe('per account state (§9.4)', () => {
  it('Trial: no "Your plan", no label, a ribbon, headline choose, Choose ×2 per column and the trial sentence', async () => {
    const payload = await payloadFor({ planId: TRIAL });
    const { modal } = showModal(payload);
    expect(screen.getByRole('dialog', { name: COPY['upgrade_modal.headline.choose'] })).toBe(modal);
    expect(within(modal).queryByText(COPY['upgrade_modal.your_plan'])).not.toBeInTheDocument();
    expect(within(modal).queryAllByTestId('plan-compare-current-label')).toHaveLength(0);
    expect(within(modal).getAllByText(COPY['upgrade_modal.recommended'])).toHaveLength(1);
    // UM-BQ4: the ribbon is on the top plan's column.
    expect(within(columnHeader(TOP)).getByText(COPY['upgrade_modal.recommended'])).toBeInTheDocument();
    // UM-1b: both columns offered, so each carries "Choose {plan}" in header and footer
    // (was: empty slots + the view-only note, removed per UM-1a Q-6).
    for (const plan of payload.plans!) expectColumnButtons(plan.planId, fill(COPY['plan.choose.button'], { plan: plan.name }));
    expect(within(modal).queryAllByTestId('plan-compare-slot-empty')).toHaveLength(0);
    expect(screen.queryByTestId('plan-compare-view-only-note')).not.toBeInTheDocument();
    expect(screen.getByTestId('plan-compare-ends-free-access')).toHaveTextContent(COPY['plan.choose.trial_ends_today']);
    expectNoDeadButton(modal, payload);
  });

  it('Founding Partner, no end date: no marker of any kind, headline compare, no note, no ends-today', async () => {
    const payload = await payloadFor({ planId: FOUNDING_PARTNER });
    const { modal } = showModal(payload);
    expect(screen.getByRole('dialog', { name: COPY['upgrade_modal.headline.compare'] })).toBe(modal);
    expect(within(modal).queryByText(COPY['upgrade_modal.your_plan'])).not.toBeInTheDocument();
    expect(within(modal).queryByText(COPY['upgrade_modal.recommended'])).not.toBeInTheDocument();
    expect(within(modal).queryAllByTestId('plan-compare-current-label')).toHaveLength(0);
    expect(screen.queryByTestId('plan-compare-ends-free-access')).not.toBeInTheDocument();
    // BQ-P10: nothing offered, so no column button at all.
    expect(within(modal).queryAllByTestId(/^plan-compare-action-/)).toHaveLength(0);
    expectNoDeadButton(modal, payload);
  });

  it('Founding Partner with an end date: a ribbon, headline choose, the free-access sentence', async () => {
    const payload = await payloadFor({ planId: FOUNDING_PARTNER, cohortExpiresAt: inSixtyDays() });
    const { modal } = showModal(payload);
    expect(screen.getByRole('dialog', { name: COPY['upgrade_modal.headline.choose'] })).toBe(modal);
    expect(within(modal).getAllByText(COPY['upgrade_modal.recommended'])).toHaveLength(1);
    // UM-BQ4: the ribbon is on the top plan's column.
    expect(within(columnHeader(TOP)).getByText(COPY['upgrade_modal.recommended'])).toBeInTheDocument();
    expect(screen.getByTestId('plan-compare-ends-free-access')).toHaveTextContent(COPY['plan.choose.free_access_ends_today']);
    for (const plan of payload.plans!) expectColumnButtons(plan.planId, fill(COPY['plan.choose.button'], { plan: plan.name }));
    expectNoDeadButton(modal, payload);
  });

  it('Essentials, renewing: "Your plan" + Current plan twice on that column, the plan above recommended, headline choose', async () => {
    const payload = await payloadFor({ billingRow: payingRow(LOWER) });
    const { modal } = showModal(payload);
    expect(screen.getByRole('dialog', { name: COPY['upgrade_modal.headline.choose'] })).toBe(modal);
    expect(within(columnHeader(LOWER)).getByText(COPY['upgrade_modal.your_plan'])).toBeInTheDocument();
    expect(within(columnHeader(TOP)).getByText(COPY['upgrade_modal.recommended'])).toBeInTheDocument();
    // Header and footer (C-22: the label appears twice for the current column).
    expect(within(modal).getAllByTestId('plan-compare-current-label')).toHaveLength(2);
    expect(within(columnHeader(LOWER)).getByTestId('plan-compare-current-label')).toHaveTextContent(COPY['upgrade_modal.current_plan']);
    // The status strip: "You're on {plan} · {price} · {renews}".
    const status = screen.getByTestId('plan-compare-status');
    expect(status).toHaveTextContent(fill(COPY['upgrade_modal.status_on'], { plan: nameOf(payload, LOWER) }));
    expect(status).toHaveTextContent(/Renews on/);
    // UM-1b: the plan above carries "Upgrade to {plan}" twice; the current column none.
    expectColumnButtons(TOP, fill(COPY['plan.upgrade.button'], { plan: nameOf(payload, TOP) }));
    expect(within(columnHeader(LOWER)).queryByRole('button')).not.toBeInTheDocument();
    expectNoDeadButton(modal, payload);
  });

  it('Autopilot, renewing: "Your plan" + label ×2, no ribbon, headline top_plan, no "Coming soon"', async () => {
    const payload = await payloadFor({ planId: TOP, billingRow: payingRow(TOP) });
    const { modal } = showModal(payload);
    expect(screen.getByRole('dialog', { name: COPY['upgrade_modal.headline.top_plan'] })).toBe(modal);
    expect(within(columnHeader(TOP)).getByText(COPY['upgrade_modal.your_plan'])).toBeInTheDocument();
    expect(within(modal).queryByText(COPY['upgrade_modal.recommended'])).not.toBeInTheDocument();
    expect(within(modal).getAllByTestId('plan-compare-current-label')).toHaveLength(2);
    expect(within(modal).queryByText(COPY['plan.next.coming_soon'])).not.toBeInTheDocument();
    expect(within(modal).queryAllByTestId(/^plan-compare-action-/)).toHaveLength(0);
    expectNoDeadButton(modal, payload);
  });

  it('C-22: an admin-assigned tier offered only its own plan: "Your plan", "Pay for" ×2 (no Current plan label), headline top_plan, the own-plan note', async () => {
    const payload = await payloadFor({ planId: TOP, buyable: [TOP] });
    const { modal } = showModal(payload);
    expect(screen.getByRole('dialog', { name: COPY['upgrade_modal.headline.top_plan'] })).toBe(modal);
    expect(within(columnHeader(TOP)).getByText(COPY['upgrade_modal.your_plan'])).toBeInTheDocument();
    expect(within(modal).queryAllByTestId('plan-compare-current-label')).toHaveLength(0);
    // UM-1b: the slot UM-1a left empty is the server's "Pay for {plan}" (plan payments Q-5 / Q-7).
    expectColumnButtons(TOP, fill(COPY['plan.choose.button_own'], { plan: nameOf(payload, TOP) }));
    expect(screen.getByTestId('plan-compare-own-plan-note')).toHaveTextContent(fill(COPY['plan.choose.own_plan_note'], { plan: nameOf(payload, TOP) }));
    expectNoDeadButton(modal, payload);
  });

  it('nextPlanUp not available to buy: "Coming soon" and the server reason in that column, no control', async () => {
    const base = await payloadFor({ billingRow: payingRow(LOWER) });
    const nextId = base.nextPlanUp!.planId;
    const reason = { key: 'plan.next.coming_soon_reason_probe' };
    const payload: PlanPayload = {
      ...base,
      plans: base.plans!.map((choice) => (choice.planId === nextId ? { ...choice, availableToBuy: false } : choice)),
      nextPlanUp: { ...base.nextPlanUp!, availableToBuy: false, actionUnavailableBecause: reason },
      // As the server would send it: a plan that cannot be bought is not offered as an upgrade either.
      purchase: { ...base.purchase!, upgrade: null },
    };
    const { modal } = showModal(payload);
    expect(within(columnHeader(nextId)).getByText(COPY['plan.next.coming_soon'])).toBeInTheDocument();
    // The sentence key renders through the dictionary; an unknown key echoes, which is enough to find it.
    expect(within(columnHeader(nextId)).getByText(reason.key)).toBeInTheDocument();
    expect(within(columnHeader(nextId)).queryByRole('button')).not.toBeInTheDocument();
    expectNoDeadButton(modal, payload);
  });
});

describe('C-21: the table follows the payload', () => {
  it('semantics: a named table, one columnheader per plan, one rowheader per row, a heading per section', async () => {
    const payload = await payloadFor({ billingRow: payingRow(LOWER) });
    showModal(payload);
    const table = screen.getByRole('table', { name: COPY['upgrade_modal.plans_label'] });
    const headers = within(table).getAllByRole('columnheader');
    expect(headers).toHaveLength(payload.comparison!.planIds.length);
    payload.comparison!.planIds.forEach((planId, index) => {
      expect(headers[index]).toHaveAccessibleName(new RegExp(nameOf(payload, planId)));
    });
    const rowHeaders = within(table).getAllByRole('rowheader');
    const sections = within(table).getAllByTestId('plan-compare-section');
    expect(sections.map((heading) => heading.textContent)).toEqual(payload.comparison!.sections.map((section) => COPY[section.labelKey]));
    for (const heading of sections) expect(heading).toHaveAttribute('scope', 'rowgroup');
    const featureHeaders = rowHeaders.filter((header) => header.getAttribute('scope') === 'row');
    expect(featureHeaders.map((header) => header.textContent)).toEqual(allRows(payload).map((row) => row.label));
  });

  it('every cell: ✓ / ✕ / value and the sr text "{plan}: {state}", exactly as sent (C-23)', async () => {
    const payload = await payloadFor({ billingRow: payingRow(LOWER) });
    showModal(payload);
    const cells = screen.getAllByTestId('plan-compare-cell');
    const expected = allRows(payload).flatMap((row) => row.cells);
    expect(cells).toHaveLength(expected.length);
    // Non-vacuity: the server table has both a ✕ and a value somewhere.
    expect(expected.some((cell) => !cell.included)).toBe(true);
    expect(expected.some((cell) => cell.value !== null)).toBe(true);
    expected.forEach((cell, index) => {
      const state = cell.value ?? COPY[cell.included ? 'upgrade_modal.included' : 'upgrade_modal.not_included'];
      expect(cells[index]).toHaveTextContent(fill(COPY['upgrade_modal.cell_label'], { plan: nameOf(payload, cell.planId), state }));
      const mark = cells[index].querySelector('[data-mark]')?.getAttribute('data-mark') ?? null;
      expect(mark).toBe(cell.value !== null ? null : cell.included ? 'included' : 'not_included');
    });
  });

  it('flipping one cell flips exactly that cell; a planted row appears; a removed section disappears', async () => {
    const base = await payloadFor({ billingRow: payingRow(LOWER) });
    const copy: PlanPayload = JSON.parse(JSON.stringify(base));
    const target = copy.comparison!.sections[0].rows[0].cells[0];
    target.included = !target.included;
    target.value = null;
    copy.comparison!.sections[0].rows.push({
      row: 'planted',
      label: 'A planted row',
      cells: copy.comparison!.planIds.map((planId) => ({ planId, included: true, value: null, highlight: false })),
    });
    const removed = copy.comparison!.sections.pop()!;
    showModal(copy);

    const first = screen.getAllByTestId('plan-compare-cell')[0];
    expect(first.querySelector('[data-mark]')).toHaveAttribute('data-mark', target.included ? 'included' : 'not_included');
    expect(screen.getByRole('rowheader', { name: 'A planted row' })).toBeInTheDocument();
    expect(screen.queryByText(COPY[removed.labelKey])).not.toBeInTheDocument();
  });

  it('highlight: only the cells the server highlights carry the highlight style', async () => {
    const payload = await payloadFor({ billingRow: payingRow(LOWER) });
    showModal(payload);
    const expected = allRows(payload).flatMap((row) => row.cells);
    // Non-vacuity: the server highlights at least one amount.
    expect(expected.some((cell) => cell.highlight)).toBe(true);
    screen.getAllByTestId('plan-compare-cell').forEach((cell, index) => {
      const styled = cell.querySelector('[data-highlight="true"].font-semibold') !== null;
      expect(styled).toBe(expected[index].highlight && expected[index].value !== null);
    });
  });
});

describe('C-22: "Current plan" is a label, not a control', () => {
  it('no button by that name; no role, no tabIndex, no aria-disabled', async () => {
    showModal(await payloadFor({ billingRow: payingRow(LOWER) }));
    expect(screen.queryAllByRole('button', { name: new RegExp(COPY['upgrade_modal.current_plan']) })).toEqual([]);
    for (const label of screen.getAllByTestId('plan-compare-current-label')) {
      expect(label.tagName).toBe('SPAN');
      expect(label).not.toHaveAttribute('role');
      expect(label).not.toHaveAttribute('tabindex');
      expect(label).not.toHaveAttribute('aria-disabled');
    }
  });
});

describe('layout classes (C-8, C-9, C-24, W-8)', () => {
  it('C-8: the flex variant, one sm: width, no base max-w, the X recoloured by a child selector', async () => {
    const { modal } = showModal(await payloadFor());
    const classes = modal.className.split(/\s+/);
    for (const token of ['flex', 'flex-col', 'p-0', 'h-[100dvh]', 'sm:h-auto', 'sm:max-w-4xl', '[&>button]:text-white']) {
      expect(classes).toContain(token);
    }
    // dialog.tsx's own base `max-w-lg` is the only un-prefixed max-w (C-8: no second base max-w).
    expect(classes.filter((token) => /^max-w-/.test(token))).toEqual(['max-w-lg']);
  });

  it('C-9: every white text sits on solid --v2-primary-dark; the gradient is aria-hidden and holds no text', async () => {
    const { modal } = showModal(await payloadFor({ billingRow: payingRow(LOWER) }));
    for (const element of Array.from(modal.querySelectorAll('.text-white'))) {
      expect(element.closest('.bg-\\[var\\(--v2-primary-dark\\)\\]')).not.toBeNull();
    }
    const gradient = screen.getByTestId('plan-compare-band-gradient');
    expect(gradient).toHaveAttribute('aria-hidden', 'true');
    expect(gradient.textContent).toBe('');
    expect(gradient.className).toContain('bg-gradient-to-r');
  });

  it('F-2: --v2-primary-dark text only inside the band or a ribbon (it has no dark-mode override)', async () => {
    const { modal } = showModal(await payloadFor({ billingRow: payingRow(LOWER) }));
    const band = screen.getByTestId('plan-compare-band');
    for (const element of Array.from(modal.querySelectorAll('[class*="text-[var(--v2-primary-dark)]"]'))) {
      expect(band.contains(element)).toBe(true);
    }
  });

  it('QA: the scroll container has no top padding, so the sticky plan header sits flush at the scroll top', async () => {
    const { modal } = showModal(await payloadFor({ billingRow: payingRow(LOWER) }));
    const scroller = modal.querySelector('.overflow-y-auto');
    expect(scroller).not.toBeNull();
    expect(scroller!.contains(screen.getByTestId('plan-compare-thead'))).toBe(true);
    const tokens = scroller!.className.split(/\s+/);
    expect(tokens.filter((token) => /^(sm:)?(p|pt|py)-/.test(token))).toEqual([]);
  });

  it('C-24 / W-8: phone rows are two-column grids, labels span above, thead sticky on a phone, header cells sticky from sm', async () => {
    showModal(await payloadFor({ billingRow: payingRow(LOWER) }));
    const table = screen.getByTestId('plan-compare-table');
    expect(table.className).toContain('max-sm:block');
    for (const part of Array.from(table.querySelectorAll('thead, tbody, tfoot'))) expect(part.className).toContain('max-sm:block');
    for (const row of Array.from(table.querySelectorAll('tr'))) {
      expect(row.className).toContain('max-sm:grid');
      expect(row.className).toContain('max-sm:grid-cols-2');
      expect(row).toHaveAttribute('role', 'row');
    }
    for (const header of within(table).getAllByRole('rowheader')) expect(header.className).toContain('max-sm:col-span-2');
    const thead = screen.getByTestId('plan-compare-thead');
    for (const token of ['max-sm:sticky', 'max-sm:top-0']) expect(thead.className).toContain(token);
    for (const header of within(table).getAllByRole('columnheader')) {
      expect(header.className).toContain('sm:sticky');
      expect(header.className).toContain('sm:top-0');
    }
    // Explicit roles on every part (R-12).
    expect(table).toHaveAttribute('role', 'table');
    for (const part of Array.from(table.querySelectorAll('thead, tbody, tfoot'))) expect(part).toHaveAttribute('role', 'rowgroup');
    for (const cell of screen.getAllByTestId('plan-compare-cell')) expect(cell).toHaveAttribute('role', 'cell');
    // No sideways scroll: no min width, no horizontal overflow, no fixed pixel width.
    const everything = [table, ...Array.from(table.querySelectorAll('*'))].map((element) => element.getAttribute('class') ?? '').join(' ');
    expect(everything).not.toMatch(/min-w-|overflow-x-auto|\bw-\[\d+px\]/);
  });
});

describe('languages', () => {
  it('Hebrew: right to left, Hebrew words, the gradient mirrored, prices in digits, columns in payload order', async () => {
    const payload = await payloadFor({ billingRow: payingRow(LOWER), language: 'he' });
    const { modal } = showModal(payload, 'he');
    const HE = translations.he;
    expect(modal).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('dialog', { name: HE['upgrade_modal.headline.choose'] })).toBe(modal);
    expect(within(modal).getByText(HE['upgrade_modal.your_plan'])).toBeInTheDocument();
    expect(within(modal).getByText(HE['upgrade_modal.recommended'])).toBeInTheDocument();
    expect(screen.getByTestId('plan-compare-band-gradient').className).toContain('bg-gradient-to-l');
    for (const plan of payload.plans!) expect(within(modal).getByText(`$${plan.monthlyPriceUsd}`)).toBeInTheDocument();
    const headers = within(screen.getByTestId('plan-compare-table')).getAllByRole('columnheader');
    expect(headers.map((header) => header.getAttribute('data-testid'))).toEqual(payload.comparison!.planIds.map((id) => `plan-compare-col-${id}`));
    expectNoDeadButton(modal, payload, 'he');
  });

  it.each(['he', 'es'] as const)('%s: no English upgrade_modal word left in the modal', async (language) => {
    const { modal } = showModal(await payloadFor({ billingRow: payingRow(LOWER), language }), language);
    const text = modal.textContent ?? '';
    const english = Object.entries(COPY)
      .filter(([key, value]) => key.startsWith('upgrade_modal.') && value !== translations[language][key])
      .map(([, value]) => value);
    expect(english.length).toBeGreaterThan(10);
    for (const value of english) expect(text).not.toContain(value);
  });
});

describe('through PlanSection (C-3, W-2, AC-UM1 view-only part)', () => {
  const server: { plans: PlanPayload[]; reads: number } = { plans: [], reads: 0 };

  beforeEach(() => {
    server.plans = [];
    server.reads = 0;
    global.fetch = jest.fn(async () => {
      const next = server.plans[Math.min(server.reads, server.plans.length - 1)];
      server.reads += 1;
      return { ok: true, status: 200, json: async () => ({ success: true, data: next }) } as Response;
    }) as unknown as typeof fetch;
  });

  async function showSection(payloads: PlanPayload[], props: { checkoutMarker?: string | null } = {}) {
    server.plans = payloads;
    const view = render(<PlanSection {...props} />);
    await waitFor(() => expect(screen.queryByText(translations[mockLang.language]['plan.loading'])).not.toBeInTheDocument());
    return view;
  }

  /** Rendering the real section and the real dialog is slow under a full parallel run. */
  const SLOW = 20_000;

  it.each(['escape', 'x', 'back'] as const)(
    'opens from "See plans" with no read; %s closes it and focus returns to the button',
    async (close) => {
      await showSection([await payloadFor({ billingRow: payingRow(LOWER) })]);
      const opener = screen.getByTestId('plan-compare-open');
      expect(opener).toHaveAttribute('aria-haspopup', 'dialog');
      // UM-1b §8.2: the server offers this owner an upgrade, so the button reads "See plans".
      expect(opener).toHaveAccessibleName(COPY['upgrade_modal.open_see_plans']);
      const readsBefore = server.reads;

      await userEvent.click(opener);
      const dialog = await screen.findByRole('dialog', { name: COPY['upgrade_modal.headline.choose'] });
      expect(dialog).toHaveAccessibleDescription(COPY['upgrade_modal.subheading']);
      if (close === 'escape') await userEvent.keyboard('{Escape}');
      if (close === 'x') await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
      if (close === 'back') await userEvent.click(within(dialog).getByRole('button', { name: COPY['upgrade_modal.back_to_plan'] }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      await waitFor(() => expect(opener).toHaveFocus());
      // C-3: opening the modal never reads.
      expect(server.reads).toBe(readsBefore);
    },
    SLOW
  );

  it('W-2: a plan change while the modal is open (the [language] re-read) shows in the modal', async () => {
    const view = await showSection([await payloadFor({ billingRow: payingRow(LOWER) }), await payloadFor({ planId: TOP, billingRow: payingRow(TOP) })]);
    await userEvent.click(screen.getByTestId('plan-compare-open'));
    expect(await screen.findByRole('dialog', { name: COPY['upgrade_modal.headline.choose'] })).toBeInTheDocument();
    const readsAfterOpen = server.reads;

    mockLang.language = 'es';
    view.rerender(<PlanSection />);
    expect(await screen.findByRole('dialog', { name: translations.es['upgrade_modal.headline.top_plan'] })).toBeInTheDocument();
    // Exactly the section's own re-read, none from the modal.
    expect(server.reads).toBe(readsAfterOpen + 1);
  }, SLOW);

  /** A test-mode billing row whose renewal failed (the `PlanPaymentState.render` shape). */
  const failedRow = (overrides: Record<string, unknown> = {}) => ({
    livemode: false,
    stripeSubscriptionId: 'sub_probe',
    subscriptionStatus: 'past_due',
    boughtTier: null,
    cancelAtPeriodEnd: false,
    currentPeriodEnd: '2099-11-12T09:30:00.000Z',
    failedAttempts: 2,
    lastPaymentFailedAt: '2099-11-12T09:30:00.000Z',
    actionRequiredInvoiceUrl: null,
    endedAt: null,
    ...overrides,
  });

  it.each([
    ['payment_failed', {}, 'plan-update-card-email'],
    ['action_required', { actionRequiredInvoiceUrl: 'https://invoice.stripe.com/i/probe', failedAttempts: 1 }, 'plan-confirm-payment'],
  ] as const)(
    '%s: the drawer keeps the account matter; the modal names the state in its status strip and holds no account control',
    async (state, overrides, drawerTestId) => {
      const payload = await payloadFor({ billingRow: failedRow(overrides) });
      // Non-vacuity: the fixture really is in that state.
      expect(payload.purchase?.billing?.state).toBe(state);
      await showSection([payload]);
      expect(screen.getByTestId(drawerTestId)).toBeInTheDocument();

      await userEvent.click(screen.getByTestId('plan-compare-open'));
      const modal = await screen.findByTestId('plan-compare-modal');
      expect(within(modal).queryByTestId('plan-update-card-email')).not.toBeInTheDocument();
      expect(within(modal).queryByTestId('plan-confirm-payment')).not.toBeInTheDocument();
      expect(within(modal).queryByRole('link')).not.toBeInTheDocument();
      // The status strip carries the server's own ending sentence for that state.
      const sentenceStart = COPY[payload.endsWhen!.key].split('{')[0].trim();
      expect(sentenceStart.length).toBeGreaterThan(0);
      expect(screen.getByTestId('plan-compare-status')).toHaveTextContent(sentenceStart);
      expectNoDeadButton(modal, payload);
    },
    SLOW
  );

  it('SA Q-3: hidden while a payment is landing (processing)', async () => {
    jest.useFakeTimers({ advanceTimers: true });
    try {
      await showSection([await payloadFor()], { checkoutMarker: 'cs_test_landing' });
      expect(screen.getByTestId('plan-purchase-processing')).toBeInTheDocument();
      expect(screen.queryByTestId('plan-compare-open')).not.toBeInTheDocument();
    } finally {
      await act(async () => {
        jest.clearAllTimers();
      });
      jest.useRealTimers();
    }
  });

  it('C-21: no comparison from the server → no "Compare plans" (the UI never builds one)', async () => {
    await showSection([{ ...(await payloadFor()), comparison: null }]);
    expect(screen.queryByTestId('plan-compare-open')).not.toBeInTheDocument();
  });
});
