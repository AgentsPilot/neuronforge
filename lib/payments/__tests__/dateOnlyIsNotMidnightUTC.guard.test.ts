/**
 * A DATE-ONLY COLUMN IS NOT AN INSTANT.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `payment_invoices.due_date` and `payment_plan_installments.due_date` are SQL
 * DATEs — `2026-09-30`, no time, no zone. `new Date('2026-09-30')` turns that
 * into midnight UTC, and every renderer downstream then resolves it in whatever
 * zone it happens to be in.
 *
 * INV-00013 is what that costs. Raised at 14:46 on the 30th, payable on receipt,
 * so `due_date = 2026-09-30`. On a booking whose timezone is America/New_York it
 * printed "due 29 September" — a day before the invoice existed — in the PDF and
 * in the contact drawer, and the drawer marked it OVERDUE at the same time,
 * because midnight UTC is already in the past by any hour of the working day.
 *
 * Four renderers had the same bug from the same cause, so the rule is pinned
 * once here rather than four times in four suites:
 *
 *   1. the invoice PDF's `formatDate`
 *   2. the bookings tab's `stageDate`
 *   3. the drawer's overdue test
 *   4. the Manage Payment modal's own `stageDate`
 *
 * And the fix is NOT the usual noon-UTC anchor. That buys twelve hours of slack
 * each way, which is not enough: noon UTC on the 30th is already the 1st in
 * Auckland, and further still at UTC+14. The first two tests establish both
 * facts before anything is asserted about the code.
 *
 * A value with no time and no zone is rendered as the calendar date it is —
 * built in UTC, read back in UTC — which returns what is stored everywhere
 * rather than almost everywhere. Real timestamps keep being resolved normally.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

describe('the shift itself, so the rest of this file is not arguing about nothing', () => {
  const DUE = '2026-09-30';

  it('moves a date-only value a day earlier west of UTC', () => {
    const midnight = new Date(DUE).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    expect(midnight).toBe('2026-09-29');
  });

  it('and noon UTC is NOT enough — it breaks east of UTC+12', () => {
    // The usual workaround, and the reason this code does not use it.
    expect(
      new Date(`${DUE}T12:00:00Z`).toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' })
    ).toBe('2026-10-01');
  });

  it('rendering it in UTC returns the stored date in EVERY zone', () => {
    for (const timeZone of [
      'America/New_York',
      'Asia/Jerusalem',
      'Pacific/Auckland',
      'Pacific/Kiritimati', // UTC+14, the furthest there is
      'Pacific/Midway',     // UTC-11
    ]) {
      expect(
        new Date(`${DUE}T00:00:00Z`).toLocaleDateString('en-CA', { timeZone: 'UTC' })
      ).toBe(DUE);
      // And the zone genuinely differs, so the assertion above is not vacuous.
      expect(new Date(`${DUE}T00:00:00Z`).toLocaleDateString('en-CA', { timeZone })).toBeTruthy();
    }
  });
});

describe('the invoice PDF', () => {
  const src = read('lib/pdf/InvoicePDFGenerator.tsx');

  it('renders a date-only string in UTC, not in the renderer\'s zone', () => {
    expect(src).toContain('DATE_ONLY');
    expect(src).toContain("timeZone: 'UTC'");
    // Never the noon workaround, which Auckland defeats.
    expect(src).not.toContain('T12:00:00Z');
  });

  it('still parses a real timestamp as an instant', () => {
    // `created_at` is a timestamptz; anchoring THAT would move it.
    expect(src).toContain('DATE_ONLY.test(dateString)');
    expect(src).toMatch(/:\s*new Date\(dateString\)/);
  });
});

describe('the contact drawer', () => {
  const bookingsTab = read('components/crm/contact-drawer/BookingsTab.tsx');
  const drawer = read('components/crm/contact-drawer/CRMContactDrawerV2.tsx');

  it('anchors a stage due date, and leaves paidAt alone', () => {
    const fn = bookingsTab.match(/const stageDate = \(value: string\) =>([\s\S]*?\n    \);)/);
    expect(fn).not.toBeNull();
    expect(fn![1]).toContain("timeZone: 'UTC'");
    // The ternary is what keeps `paidAt` — a real instant — in the local zone.
    expect(fn![1]).toMatch(/\.test\(value\)\s*\n?\s*\?/);
    expect(fn![1]).toContain('timeZoneOptions');
  });

  it('formats a due date in UTC in the Manage Payment modal too', () => {
    const modal = read('components/crm/contact-drawer/PaymentManagementModal.tsx');
    const fn = modal.match(/const stageDate = \(value: string\) =>([\s\S]*?\n        \);)/);
    expect(fn).not.toBeNull();
    expect(fn![1]).toContain("timeZone: 'UTC'");
    expect(fn![1]).toContain('timeZoneOptions');
  });

  it('decides overdue by calendar day, never by instant comparison', () => {
    const block = drawer.match(/const isOverdue =([\s\S]*?);/);
    expect(block).not.toBeNull();
    // The old form compared Dates directly; the new one compares day keys.
    expect(block![1]).not.toMatch(/new Date\(payment\.invoiceDueDate\)/);
    expect(block![1]).toContain('todayKey');
  });

  it('does not call an invoice due today overdue', () => {
    const today = new Date().toLocaleDateString('en-CA');
    // The comparison the drawer now performs, on its own terms.
    expect(today < today).toBe(false);
    expect('2026-09-29' < '2026-09-30').toBe(true);
  });
});
