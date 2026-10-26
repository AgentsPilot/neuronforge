/**
 * Guard over 20261092_money_promotes_a_client_whenever_it_is_attached.sql.
 *
 * WHY A TEST OVER SQL TEXT. Jest cannot run PL/pgSQL and there is no branch
 * database: the migration is pasted into the Supabase SQL editor and verified
 * against live rows. What the files alone CAN prove is pinned here.
 *
 * THE BUG. `promote_contact_on_payment_trigger` (20260920) fired on
 * `AFTER INSERT OR UPDATE OF status`, with a WHEN clause requiring
 * `NEW.contact_id IS NOT NULL`. For a smart-link sale those two never
 * coincide: the client pays before any contact exists, so the webhook INSERTs
 * the transaction with `contact_id` NULL and the WHEN clause is false; the
 * contact is attached seconds later by an UPDATE of `contact_id`, which the
 * trigger was not watching. The client stage was therefore unreachable through
 * payment for every website sale.
 *
 * Measured 2026-10-25: contact fc2b2153 created 21:54:13 on `inquiry`,
 * transaction 3da56294 (ILS 150, succeeded) attached at 21:54:15, contact
 * `updated_at` still 21:54:13. After this migration: `family_enrolled`.
 *
 * HOW IT COMES BACK. Any later migration that re-declares this trigger from
 * the 20260920 original — a copy-paste, or a mechanical "restore the triggers"
 * pass — drops `contact_id` from the column list and silently restores the
 * bug, because nothing about it is visible in behaviour until somebody checks
 * a paying client's stage. This test is what fails then.
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations');
const read = (file: string) => readFileSync(join(MIGRATIONS, file), 'utf8');

const THIS = '20261092_money_promotes_a_client_whenever_it_is_attached.sql';

/** Whitespace-insensitive, so reformatting the SQL cannot fail the guard. */
const flat = (sql: string) => sql.replace(/\s+/g, ' ');

describe('20261092: money promotes a client whenever it is attached', () => {
  const sql = read(THIS);

  it('fires on contact_id as well as status', () => {
    /*
     * The entire fix. `status` must stay: a row inserted pending and updated to
     * succeeded is the invoice path, and it still has to promote.
     */
    expect(flat(sql)).toContain(
      'AFTER INSERT OR UPDATE OF status, contact_id ON payment_transactions'
    );
  });

  it('leaves the WHEN clause alone', () => {
    /*
     * The guard against over-correcting. Widening the trigger is safe only
     * because the WHEN clause still decides everything — succeeded, above zero,
     * against a known contact. Dropping `amount > 0` here would promote on a
     * free booking's zero-amount bookkeeping row.
     */
    expect(flat(sql)).toContain(
      "WHEN (NEW.status = 'succeeded' AND NEW.amount > 0 AND NEW.contact_id IS NOT NULL)"
    );
  });

  it('reuses advance_contact_stage rather than writing a stage itself', () => {
    /*
     * One rule in one place. The function resolves the business's OWN client
     * stage by `stage_type`, refuses to move a contact who is already a client
     * or past client, and writes nothing when the stage already matches — so
     * the trigger firing twice is harmless. A migration that promoted by
     * `UPDATE crm_contacts SET stage = 'client'` would both invent a key most
     * pipelines do not contain and lose every one of those safeguards.
     */
    expect(flat(sql)).toContain('EXECUTE FUNCTION promote_contact_on_payment()');
    expect(flat(sql)).toContain("advance_contact_stage(paid.user_id, paid.contact_id, 'client'");
    expect(flat(sql)).not.toMatch(/UPDATE\s+crm_contacts\s+SET\s+stage\s*=\s*'client'/i);
  });

  it('repairs the backlog through the same function', () => {
    /* The trigger only governs what happens next; every website sale since
       20260920 left its buyer short of the client stage. */
    expect(flat(sql)).toContain("WHERE t.status = 'succeeded'");
    expect(flat(sql)).toContain('AND t.amount > 0');
    expect(flat(sql)).toContain('AND t.contact_id IS NOT NULL');
  });

  it('is the last word on this trigger', () => {
    /*
     * The regression path, caught structurally rather than by hoping nobody
     * copies the old declaration: if a LATER migration re-declares this
     * trigger, it must also name `contact_id`.
     */
    const later = readdirSync(MIGRATIONS)
      .filter(name => name.endsWith('.sql') && name > THIS)
      .filter(name => flat(read(name)).includes('CREATE TRIGGER promote_contact_on_payment_trigger'));

    for (const name of later) {
      expect(flat(read(name))).toContain('UPDATE OF status, contact_id');
    }
  });
});
