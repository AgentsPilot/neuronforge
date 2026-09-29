/**
 * Guard over the email-delivery migration.
 *
 * WHY A TEST OVER SQL TEXT. Jest cannot run PL/pgSQL and there is no branch
 * database, so these check the properties that can be read from the file and
 * whose loss would be silent.
 *
 * The load-bearing one is the trigger guard. `ALTER COLUMN contact_id DROP NOT
 * NULL` on its own looks complete and is not: `log_email_activity_trigger`
 * inserts into `crm_activities`, whose own `contact_id` is NOT NULL, so the
 * first owner-mail row would abort the caller's transaction. A future rebase
 * that keeps the ALTER and loses the function must fail here rather than in
 * production.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { EMAIL_SEND_STATUSES } from '@/lib/business-os/emailSendStatus';

const sql = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261012_email_sends_delivery_facts.sql'),
  'utf8'
);

/** Comments hold prose that would otherwise satisfy or break these rules. */
const code = sql
  .split('\n')
  .filter(line => !line.trim().startsWith('--'))
  .join('\n');

describe('the status CHECK', () => {
  it('names every status the roster declares', () => {
    for (const status of EMAIL_SEND_STATUSES) {
      expect(code).toContain(`'${status}'`);
    }
  });

  it("includes 'complained', the value the webhook writes and the schema omitted", () => {
    expect(code).toContain("'complained'");
  });

  it('refuses rather than silently dropping a row outside the roster', () => {
    expect(code).toContain('RAISE EXCEPTION');
    expect(code).toMatch(/NOT IN \(/);
  });

  it('is idempotent, so a re-run does not error on an existing constraint', () => {
    expect(code).toContain('pg_constraint');
    expect(code).toContain('email_sends_status_check');
  });
});

describe('contact_id becoming nullable', () => {
  it('drops the constraint', () => {
    expect(code).toMatch(/ALTER TABLE email_sends\s+ALTER COLUMN contact_id DROP NOT NULL/);
  });

  /*
   * The assertion this file exists for. Without the guard the ALTER is a trap:
   * owner mail would throw inside the trigger rather than simply go unrecorded.
   */
  it('replaces the activity trigger AND guards it on contact_id', () => {
    expect(code).toContain('CREATE OR REPLACE FUNCTION log_email_activity');
    expect(code).toContain('NEW.contact_id IS NOT NULL');
  });

  it('guards contact_id BEFORE testing the status, so the null case exits first', () => {
    const guard = code.indexOf('NEW.contact_id IS NOT NULL');
    const status = code.indexOf("NEW.status = 'sent'", guard);
    expect(guard).toBeGreaterThan(-1);
    expect(status).toBeGreaterThan(guard);
  });

  it('leaves user_id alone — it is the tenant boundary', () => {
    expect(code).not.toMatch(/ALTER COLUMN user_id DROP NOT NULL/);
  });
});
