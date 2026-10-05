/**
 * The sender's settled guard — the last thing between a reminder row and the
 * client's inbox.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS
 *
 * INV-00011 was paid on 29 Sep and refunded the same evening. It was then
 * chased twice: `due_today` on 30 Sep, `overdue` on 1 Oct. The client got two
 * demands for ₪300 they had already paid and been given back, each linking to a
 * Stripe page that read PAID.
 *
 * The guard was there. It read:
 *
 *   ['paid', 'cancelled', 'refunded', 'void'].includes(invoice.status)
 *
 * and `status` is a projection — the migration that introduced refund state says
 * so outright. An invoice refunded without first being marked paid keeps
 * `status: 'sent'`, so it walked straight through a check whose own comment
 * named a refund as the reason it existed.
 *
 * The fix reads the ledger: `paid_at`, `refund_status`, `refunded_amount`. Every
 * case below is a row shape taken from that incident or adjacent to it, and the
 * first test is the live row verbatim.
 *
 * These assert on SKIPPING, which is the whole point: a test that only proves
 * ordinary reminders still send would have passed before the fix too.
 * ─────────────────────────────────────────────────────────────────────────────
 */

jest.mock('@/lib/services/PaymentEventService', () => ({
  emitPaymentEvent: jest.fn().mockResolvedValue({ data: null, error: null }),
}));

import { PaymentReminderService } from '@/lib/services/PaymentReminderService';
import { crmContactRepository } from '@/lib/repositories/CRMContactRepository';

/** A supabase double that returns one `payment_invoices` row for `.single()`. */
function supabaseReturning(invoice: Record<string, unknown>) {
  const chain: Record<string, unknown> = {};
  for (const method of ['from', 'select', 'eq', 'order', 'limit', 'in', 'is', 'not']) {
    chain[method] = jest.fn(() => chain);
  }
  chain.single = jest.fn().mockResolvedValue({ data: invoice, error: null });
  chain.maybeSingle = jest.fn().mockResolvedValue({ data: invoice, error: null });
  return chain as any;
}

function reminderFor(invoiceId: string, type = 'due_today') {
  return {
    id: 'rem-1',
    user_id: 'u1',
    invoice_id: invoiceId,
    installment_id: null,
    contact_id: 'c1',
    reminder_type: type,
    scheduled_at: '2026-09-30T09:00:00.000Z',
    sent_at: null,
    channel: 'email',
    template_id: null,
    status: 'processing',
    metadata: {},
    error_message: null,
    created_at: '2026-09-29T14:19:00.000Z',
  } as any;
}

/** The ledger fields a real row carries, so each case states only its difference. */
const OUTSTANDING = {
  id: '06d2eeae-2e2e-4e40-94ab-fd4e8cd97b0b',
  user_id: 'u1',
  invoice_number: 'INV-00011',
  status: 'sent',
  // `amount`, not `total_amount` — the latter does not exist on
  // `payment_invoices`, and naming it in a `.select()` makes PostgREST reject
  // the whole query with 42703.
  amount: 300,
  currency: 'ILS',
  due_date: '2026-09-30',
  paid_at: null,
  refunded_at: null,
  refund_status: 'none',
  refunded_amount: 0,
  contact_id: 'c1',
};

describe("the sender's settled guard reads the money, not the projection", () => {
  let service: PaymentReminderService;

  beforeEach(() => {
    jest.restoreAllMocks();
    jest
      .spyOn(crmContactRepository, 'findById')
      .mockResolvedValue({ data: { id: 'c1', email: 'client@example.com', full_name: 'Client' }, error: null } as any);
  });

  async function dispatch(invoice: Record<string, unknown>, type?: string) {
    service = new PaymentReminderService(supabaseReturning(invoice));
    // The email sender is never reached on a skip. Spying on it proves that,
    // rather than taking the return value's word for it.
    const send = jest.spyOn(service as any, 'sendEmailReminder').mockResolvedValue(true);
    const result = await (service as any).dispatchReminderRow(reminderFor('inv-11', type));
    return { result, send };
  }

  it('INV-00011 verbatim: refunded while status still reads `sent` — skipped, no email', async () => {
    // The live row. refund_status/refunded_amount say the money went back;
    // status never moved, because it was refunded without being marked paid.
    const { result, send } = await dispatch({
      ...OUTSTANDING,
      refund_status: 'full',
      refunded_amount: 300,
      refunded_at: '2026-09-29T14:42:00.000Z',
    });

    expect(result.skipped).toBe(true);
    expect(result.sent).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('the second email it sent — `overdue`, a day later — is skipped by the same guard', async () => {
    // Both emails went out, so both reminder types have to be covered: the guard
    // must not depend on which scan queued the row.
    const { result, send } = await dispatch(
      { ...OUTSTANDING, status: 'overdue', refund_status: 'full', refunded_amount: 300 },
      'overdue'
    );

    expect(result.skipped).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  it('INV-00012, chased the same day: a second row with the identical shape', async () => {
    /*
     * Not a hypothetical. While this fix was being written, the 1 Oct cron sent
     * a `due_today` reminder for INV-00012 — paid 29 Sep 07:51, refunded
     * 29 Sep 16:28, `refund_status: 'full'`, `refunded_amount: 150`, and
     * `status` still 'sent'.
     *
     * So two different refunded invoices were chased on the same day by the same
     * blind spot. One row is an incident; two is the guard being wrong.
     */
    const { result, send } = await dispatch({
      ...OUTSTANDING,
      id: '8bf16343-728a-4a9f-ae70-2b1d8dd88883',
      invoice_number: 'INV-00012',
      status: 'sent',
      amount: 150,
      paid_at: '2026-09-29T07:51:03.969+00:00',
      refunded_at: '2026-09-29T16:28:26.881+00:00',
      refund_status: 'full',
      refunded_amount: 150,
      due_date: '2026-10-01',
    });

    expect(result.skipped).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  it('a partial refund also stops the chase', async () => {
    const { result, send } = await dispatch({
      ...OUTSTANDING,
      refund_status: 'partial',
      refunded_amount: 100,
    });

    expect(result.skipped).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  it('paid_at set while the status transition has not landed yet — skipped', async () => {
    // A webhook stamps the ledger before the projection catches up. Reading
    // status alone chases someone who has just paid.
    const { result, send } = await dispatch({ ...OUTSTANDING, paid_at: '2026-09-29T14:30:00.000Z' });

    expect(result.skipped).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  it('drifted row: ledger clean but the projection says refunded — still skipped', async () => {
    // Whichever of the two noticed is enough. Being wrong in this direction
    // costs a missed reminder; the other direction is the bug above.
    const { result, send } = await dispatch({ ...OUTSTANDING, status: 'partially_refunded' });

    expect(result.skipped).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  it.each(['paid', 'cancelled', 'void'])('a `%s` invoice is still skipped', async (status) => {
    // The statuses the original guard covered must keep working — the fix
    // widened the net and must not have moved it.
    const { result, send } = await dispatch({ ...OUTSTANDING, status });

    expect(result.skipped).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  it('a genuinely outstanding invoice is NOT skipped — the guard stays narrow', async () => {
    // Without this, a guard that skipped everything would pass every test above.
    const { result } = await dispatch(OUTSTANDING);

    expect(result.skipped).toBeFalsy();
  });
});
