/**
 * One recovery email per person, not one per abandoned attempt.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The claim was per ATTEMPT — `recovery_email_sent_at` on the row — so every
 * attempt earned its own email. Somebody who cannot get through a checkout
 * produces one attempt per try, and the sweep mailed each of them.
 *
 * Found on a live account: 13 attempts from one address and EIGHT recovery
 * emails sent to it, plus 4 to another. It predates the agent; the agent would
 * have added a weekly one on top.
 *
 * Asserted against the source, because the failure is an ABSENCE — there is no
 * wrong value to catch, only a check that stopped being made. The behaviour
 * itself needs a database.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const source = readFileSync(
  join(process.cwd(), 'lib', 'scheduling', 'abandonedRecovery.ts'),
  'utf-8'
);

describe('the per-address window', () => {
  it('is checked before anything is composed', () => {
    /* Before the template, the branding and the token — all of which are
       thrown away otherwise. */
    const deliver = source.slice(source.indexOf('async function deliverRecovery'));

    const check = deliver.indexOf('mailedRecently');
    const compose = deliver.indexOf('generateBookingRecoveryEmail');

    expect(check).toBeGreaterThan(-1);
    expect(compose).toBeGreaterThan(check);
  });

  it('matches the ADDRESS, case-insensitively, and not the attempt', () => {
    /*
     * `ilike` with the shared pattern: an address stored as the visitor typed
     * it would otherwise miss, which is exactly the person who keeps retrying.
     * `.neq('id', attempt.id)` so a row cannot block itself.
     */
    const fn = source.slice(source.indexOf('async function mailedRecently'));

    expect(fn).toContain("ilike('email', emailLikePattern(");
    expect(fn).toContain(".neq('id', attempt.id)");
    expect(fn).toContain("gte('recovery_email_sent_at'");
  });

  it('fails closed when it cannot tell', () => {
    /*
     * A lookup that errors must not become permission to send. A missed
     * recovery costs one email nobody reads; the other mistake costs the eight
     * this exists to stop.
     */
    const fn = source.slice(
      source.indexOf('async function mailedRecently'),
      source.indexOf('async function deliverRecovery')
    );

    expect(fn).toMatch(/if \(error\) \{[\s\S]*return true;/);
  });

  it('lives in the shared path, so the cron and the agent cannot disagree', () => {
    /* Both `sendAbandonedRecoveries` and `sendOneRecovery` end at
       `deliverRecovery`, which is the only place that sends. */
    const sends = source.match(/await sendEmail\(/g) ?? [];

    expect(sends).toHaveLength(1);
  });
});
