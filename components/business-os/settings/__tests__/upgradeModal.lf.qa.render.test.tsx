/**
 * @jest-environment jsdom
 *
 * QA, live-test fixes LF-1 / LF-2 (2026-10-21): one matrix over every account
 * type the user named, on REAL `my-plan` payloads:
 *   trial, Founding Partner (no end date / with an end date), Essentials,
 *   Autopilot, Essentials cancelling.
 * For each: which surface opens, which columns in which order, which badge on
 * which column, which buttons; "Recommended" never on the account's own column;
 * the own column's cells are exactly the server's `row.current`; Hebrew labels.
 */

import '@testing-library/jest-dom';
import { render, screen, within } from '@testing-library/react';
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
import { planSurfaceFor } from '@/components/business-os/settings/upgradeModalView';

import { FOUNDING_PARTNER, LOWER, TOP, TRIAL, inSixtyDays, payingRow, payloadFor } from './upgradeModalPayloads';

const { translations } = jest.requireActual('@/lib/business-os/LanguageContext') as {
  translations: Record<Lang, Record<string, string>>;
};
const SLOW = 30_000;

const flow = (): UpgradeModalFlow => ({
  checkoutAllowed: true,
  upgradeAllowed: true,
  paymentsConfigured: true,
  onCheckoutComplete: jest.fn(),
  onUpgrading: jest.fn(),
  onUpgradeCheckAgain: jest.fn(async () => undefined),
});

interface Expect {
  surface: 'modal' | 'drawer';
  /** Column order as rendered (header cells). */
  columns: string[];
  /** The column marked "Your plan". */
  own: string;
  /** Columns with a buy / upgrade button. */
  buttons: string[];
}

type Case = [name: string, make: () => Promise<PlanPayload>, expected: Expect];

const CASES: Case[] = [
  ['trial', () => payloadFor({ planId: TRIAL }), { surface: 'modal', columns: [TRIAL, LOWER, TOP], own: TRIAL, buttons: [LOWER, TOP] }],
  [
    'Founding Partner, no end date',
    () => payloadFor({ planId: FOUNDING_PARTNER, cohortExpiresAt: null }),
    { surface: 'drawer', columns: [FOUNDING_PARTNER, LOWER, TOP], own: FOUNDING_PARTNER, buttons: [] },
  ],
  [
    'Founding Partner, with an end date',
    () => payloadFor({ planId: FOUNDING_PARTNER, cohortExpiresAt: inSixtyDays() }),
    { surface: 'modal', columns: [FOUNDING_PARTNER, LOWER, TOP], own: FOUNDING_PARTNER, buttons: [LOWER, TOP] },
  ],
  ['Essentials (paying)', () => payloadFor({ billingRow: payingRow(LOWER) }), { surface: 'modal', columns: [LOWER, TOP], own: LOWER, buttons: [TOP] }],
  [
    'Autopilot (paying)',
    () => payloadFor({ planId: TOP, billingRow: payingRow(TOP) }),
    { surface: 'drawer', columns: [LOWER, TOP], own: TOP, buttons: [] },
  ],
  [
    'Essentials cancelling',
    () => payloadFor({ billingRow: payingRow(LOWER, { cancelAtPeriodEnd: true }) }),
    { surface: 'drawer', columns: [LOWER, TOP], own: LOWER, buttons: [] },
  ],
];

const headerIds = (modal: HTMLElement) =>
  within(within(modal).getByTestId('plan-compare-thead'))
    .getAllByRole('columnheader')
    .map((cell) => cell.getAttribute('data-testid')!.replace('plan-compare-col-', ''));

function showModal(payload: PlanPayload, language: Lang = 'en') {
  mockLang.language = language;
  render(<UpgradeModal open onOpenChange={jest.fn()} plan={payload} flow={flow()} />);
  return screen.getByTestId('plan-compare-modal');
}

beforeEach(() => {
  mockLang.language = 'en';
});

describe('QA LF-2: account matrix (surface, columns, badges, buttons)', () => {
  it.each(CASES)('%s', async (_name, make, expected) => {
    const payload = await make();
    expect(planSurfaceFor(payload, false)).toBe(expected.surface);

    const modal = showModal(payload);
    const copy = translations.en;
    expect(headerIds(modal)).toEqual(expected.columns);

    // Exactly one "Your plan" marker in the table, on the account's own column.
    for (const id of expected.columns) {
      const header = within(modal).getByTestId(`plan-compare-col-${id}`);
      const marked = within(header).queryAllByText(copy['upgrade_modal.your_plan']).length;
      expect({ id, marked }).toEqual({ id, marked: id === expected.own ? 1 : 0 });
    }
    // "Recommended" never on the own column; when shown it sits on a column with a button.
    const recommended = within(modal).queryAllByTestId('plan-compare-badge-recommended');
    for (const badge of recommended) {
      const column = badge.closest('[data-testid^="plan-compare-col-"]')!.getAttribute('data-testid')!.replace('plan-compare-col-', '');
      expect(column).not.toBe(expected.own);
      expect(expected.buttons).toContain(column);
    }
    if (expected.buttons.length > 0) expect(recommended).toHaveLength(1);

    // Buttons: only on the offered columns; none on the own cohort column.
    const withButton = expected.columns.filter((id) => within(modal).queryByTestId(`plan-compare-action-${id}-header`)?.tagName === 'BUTTON');
    expect(withButton).toEqual(expected.buttons);
    if (expected.own !== LOWER && expected.own !== TOP) {
      const ownHeader = within(modal).getByTestId(`plan-compare-col-${expected.own}`);
      expect(within(ownHeader).queryByRole('button')).not.toBeInTheDocument();
      expect(ownHeader).toHaveTextContent(payload.name!);
      expect(ownHeader).toHaveTextContent(copy['plan.price.free']);
    }

    // Phone grid: three columns with an own column, else two.
    expect(within(modal).getByTestId('plan-compare-table')).toHaveAttribute('data-columns', String(expected.columns.length));
  }, SLOW);
});

describe('QA LF-2: own-column cells are the server cells', () => {
  it.each([
    ['trial', () => payloadFor({ planId: TRIAL })],
    ['Founding Partner', () => payloadFor({ planId: FOUNDING_PARTNER, cohortExpiresAt: null })],
  ] as const)('%s: one own cell per row, in row order, ✓ / ✕ / value as `row.current`', async (_name, make) => {
    const payload = await make();
    const modal = showModal(payload);
    const rows = (payload.comparison?.sections ?? []).flatMap((section) => section.rows);
    const ownCells = within(modal)
      .getAllByTestId('plan-compare-cell')
      .filter((cell) => cell.getAttribute('data-own-plan') === 'true');
    expect(ownCells).toHaveLength(rows.length);
    rows.forEach((row, index) => {
      const cell = ownCells[index];
      expect(row.current).toBeTruthy();
      if (row.current!.value) expect(cell).toHaveTextContent(row.current!.value);
      expect(cell.textContent).toContain(payload.name!);
    });
    // Non-vacuity: the cohort really differs from some tier somewhere.
    expect(rows.some((row) => row.cells.some((cell) => cell.included !== row.current!.included || cell.value !== row.current!.value))).toBe(true);
  }, SLOW);
});

describe('QA LF-2: Founding Partner with no end date, through the drawer', () => {
  it('the drawer shows "Compare plans"; it opens own → Essentials → Autopilot, no buy buttons', async () => {
    const payload = await payloadFor({ planId: FOUNDING_PARTNER, cohortExpiresAt: null });
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true, data: payload }) })) as unknown as typeof fetch;
    render(<PlanSection />);
    const opener = await screen.findByTestId('plan-compare-open');
    expect(opener).toHaveAccessibleName(translations.en['upgrade_modal.open_compare']);
    await userEvent.click(opener);
    const modal = await screen.findByTestId('plan-compare-modal');
    expect(headerIds(modal)).toEqual([FOUNDING_PARTNER, LOWER, TOP]);
    for (const id of [LOWER, TOP]) {
      expect(within(modal).queryByTestId(`plan-compare-action-${id}-header`)?.tagName ?? 'none').not.toBe('BUTTON');
      expect(within(modal).queryByTestId(`plan-compare-action-${id}-footer`)?.tagName ?? 'none').not.toBe('BUTTON');
    }
    expect(within(modal).queryByTestId('plan-compare-badge-recommended')).not.toBeInTheDocument();
  }, SLOW);
});

describe('QA LF-2: Hebrew', () => {
  it.each([
    ['trial', () => payloadFor({ planId: TRIAL, language: 'he' })],
    ['Founding Partner', () => payloadFor({ planId: FOUNDING_PARTNER, cohortExpiresAt: null, language: 'he' })],
  ] as const)('%s: own column first with Hebrew "Your plan" and "Free"; no English left in the own header', async (_name, make) => {
    const payload = await make();
    const modal = showModal(payload, 'he');
    const he = translations.he;
    const ids = headerIds(modal);
    expect(ids[0]).toBe(payload.planId);
    const ownHeader = within(modal).getByTestId(`plan-compare-col-${ids[0]}`);
    expect(ownHeader).toHaveTextContent(he['upgrade_modal.your_plan']);
    expect(ownHeader).toHaveTextContent(he['plan.price.free']);
    expect(ownHeader).not.toHaveTextContent(translations.en['upgrade_modal.your_plan']);
    expect(ownHeader).not.toHaveTextContent(translations.en['plan.price.free']);
  }, SLOW);
});
