/**
 * Guard over 20261088_a_partial_refund_says_so.sql.
 *
 * WHY A TEST OVER SQL TEXT. Jest cannot run PL/pgSQL and there is no branch
 * database: the migration is pasted into the Supabase SQL editor and verified
 * against live rows. What the files alone CAN prove is pinned here, and it is
 * the part most likely to be lost by accident.
 *
 * The bug this guards against is not a wrong value, it is a race. Two AFTER
 * triggers on `payment_transactions` write the same invoice, Postgres fires
 * them in alphabetical order of trigger name, and `update_invoice_on_payment`
 * (u) used to overwrite the refund state that `propagate_refund_to_invoice` (p)
 * had just computed. For two years every partial refund was derived correctly
 * and then thrown away, so the client's own PDF read PAID over money half of
 * which had gone back.
 *
 * It was reintroduced once already, in effect: `20260905_refire_refund_triggers`
 * was written to repair exactly these rows and could not, because refiring runs
 * both triggers again in the same order. A plain `CREATE OR REPLACE FUNCTION
 * update_invoice_on_payment()` in some future migration, copied from the 20260722
 * original, brings the whole thing back silently. This test is what fails then.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations');
const read = (file: string) => readFileSync(join(MIGRATIONS, file), 'utf8');

const THIS = '20261088_a_partial_refund_says_so.sql';

/** Whitespace-insensitive, so reformatting the SQL cannot fail the guard. */
const flat = (sql: string) => sql.replace(/\s+/g, ' ');

describe('20261088: a partial refund keeps its own status', () => {
  const sql = read(THIS);

  it('replaces update_invoice_on_payment rather than renaming the other trigger', () => {
    expect(flat(sql)).toContain(
      'CREATE OR REPLACE FUNCTION update_invoice_on_payment()'
    );
    /*
     * Renaming `propagate_refund_to_invoice_trigger` to sort last would also
     * work and would leave the behaviour resting on a trigger NAME. If someone
     * later decides to do it that way, this expectation is the conversation.
     */
    expect(sql).not.toMatch(/ALTER TRIGGER\s+propagate_refund_to_invoice_trigger/i);
  });

  it('guards the paid write on there being no refund', () => {
    const body = flat(sql);

    // The guard itself. COALESCE matters: rows written before 20260828d carry
    // NULL in `refund_status`, and `NULL = 'none'` is NULL, which would exclude
    // every one of them.
    expect(body).toContain("AND COALESCE(refund_status, 'none') = 'none'");
    expect(body).toMatch(/WHERE id = NEW\.invoice_id\s*.*COALESCE\(refund_status/);
  });

  it('still marks an unrefunded invoice paid, which is the whole point of the trigger', () => {
    const body = flat(sql);

    expect(body).toContain("IF NEW.status = 'succeeded' AND NEW.invoice_id IS NOT NULL THEN");
    expect(body).toContain("status = 'paid'");
    expect(body).toContain('paid_at = NEW.paid_at');
  });

  it('keeps the trigger on the same event, so nothing else changes about when it runs', () => {
    const body = flat(sql);

    expect(body).toContain(
      'AFTER INSERT OR UPDATE OF status ON payment_transactions FOR EACH ROW EXECUTE FUNCTION update_invoice_on_payment()'
    );
  });

  it('refires the refund triggers so the rows already refunded are repaired', () => {
    const body = flat(sql);

    /*
     * `CREATE OR REPLACE FUNCTION` replaces the function; it does not re-run
     * it. Without this the fix applies only to refunds taken from then on, and
     * the two live rows that prompted it stay wrong for ever.
     *
     * Writing `refunded_amount` back to itself changes no value: it exists
     * only to make the three refund triggers fire.
     */
    expect(body).toContain('UPDATE payment_transactions t SET refunded_amount = t.refunded_amount');
    expect(body).toContain("r.status = 'succeeded'");
  });

  it('does not touch payment_plan_installments or scheduling_bookings', () => {
    /*
     * Both are downstream of the invoice by their own triggers, and both have
     * deliberate behaviour on a partial refund: the stage stays `paid` with its
     * `paid_at`, and the booking stays `paid` because
     * `20260903_propagate_refund_to_booking` argues at length against a fourth
     * value there. A migration about invoice status must not reach either.
     */
    expect(sql).not.toMatch(/\b(UPDATE|ALTER TABLE)\s+payment_plan_installments\b/i);
    expect(sql).not.toMatch(/\b(UPDATE|ALTER TABLE)\s+scheduling_bookings\b/i);
  });
});

describe("the status this unlocks is declared where it is read", () => {
  it('is a value the invoice CHECK constraint already allowed', () => {
    /*
     * The migration writes no constraint of its own, because 20260829 declared
     * `partially_refunded` long before anything could produce it. If that file
     * ever stops allowing it, this migration starts raising 23514 on every
     * partial refund, and the failure would surface at the worst moment: in the
     * owner's refund dialog.
     */
    expect(flat(read('20260829_payment_status_checks.sql'))).toContain(
      "CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'cancelled', 'refunded', 'partially_refunded'))"
    );
  });

  it('is declared to the chat, so a partly refunded invoice is not invisible to it', () => {
    /*
     * The catalog's own comment records this bug for `refunded`: "a real,
     * reachable status that was never declared: a refunded invoice was
     * invisible to any status filter and rendered its raw value with no label".
     * `partially_refunded` was the same omission, hidden until now because the
     * trigger race meant no row ever carried the value.
     */
    const catalog = readFileSync(
      join(process.cwd(), 'lib', 'business-os', 'catalog', 'catalog.ts'),
      'utf8'
    );

    expect(catalog).toContain('partially_refunded');
    expect(catalog).toContain("en: 'partly refunded'");
    // Money returned is not money owed, and the part kept is not owed either.
    expect(flat(catalog)).toContain("unpaid: ['sent', 'overdue'],");
  });

  it('is counted by the figures that counted it while it read "paid"', () => {
    /*
     * These rows have been inside both of these filters all along, because the
     * race left them reading `paid`. Giving them their real status without
     * naming it here would quietly drop revenue and shrink the Paid card the
     * day the migration ran.
     */
    const stats = readFileSync(
      join(process.cwd(), 'app', 'api', 'business-os', 'stats', 'route.ts'),
      'utf8'
    );
    expect(flat(stats)).toContain(
      "in('status', ['pending', 'sent', 'overdue', 'paid', 'partially_refunded'])"
    );

    const repo = readFileSync(
      join(process.cwd(), 'lib', 'repositories', 'PaymentRepository.ts'),
      'utf8'
    );
    expect(flat(repo)).toContain(
      "const bucket = status === 'partially_refunded' ? 'paid' : status;"
    );
  });
});
