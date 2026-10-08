/**
 * The §7 step 6 recovery statement in the slice 4a workplan (SA C-6 b, QA
 * I-2, R-6). The user pastes it into the Supabase SQL editor, so its text is a
 * contract: paste-safe, test mode only, one claim row, never auth.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const WORKPLAN = readFileSync(join(process.cwd(), 'docs/workplans/BUSINESS_OS_CREDITS_BOOST_SLICE_4A_WORKPLAN.md'), 'utf8');

function recoverySql(): string {
  const step = WORKPLAN.slice(WORKPLAN.indexOf('6. **If a test payment ever does not credit**'));
  const match = step.match(/```sql\s*\n([\s\S]*?)\n\s*```/);
  if (!match) throw new Error('the recovery SQL block was not found');
  return match[1].trim();
}

describe('the §7 step 6 recovery statement', () => {
  const sql = recoverySql();
  const literals = [...sql.matchAll(/'([^']*)'/g)].map((m) => m[1]);

  it('is one statement with no comments', () => {
    expect(sql.split(';').filter((part) => part.trim() !== '')).toHaveLength(1);
    expect(sql).not.toMatch(/--|\/\*/);
  });

  it('paste rules: every literal is letters, digits and spaces only (underscores and dots come from chr)', () => {
    expect(literals.length).toBeGreaterThan(5);
    for (const literal of literals) expect(literal).toMatch(/^[A-Za-z0-9 ]*$/);
    expect(sql).toContain('chr(95)');
    expect(sql).toContain('chr(46)');
  });

  it('never contains the word "into", and never names auth', () => {
    expect(sql.toLowerCase()).not.toMatch(/\binto\b/);
    expect(sql.toLowerCase()).not.toContain('auth');
  });

  it('updates only a processing, test-mode claim of the two crediting event types, setting it to failed', () => {
    expect(sql).toMatch(/^update public\.processed_webhook_events as claim_row set status = 'failed' where /);
    expect(sql).toContain("claim_row.status = 'processing'");
    expect(sql).toContain("(claim_row.metadata ->> 'livemode') = 'false'");
    expect(sql).toContain(
      "claim_row.event_type in ('checkout' || chr(46) || 'session' || chr(46) || 'completed', 'checkout' || chr(46) || 'session' || chr(46) || 'async' || chr(95) || 'payment' || chr(95) || 'succeeded')"
    );
  });

  it('requires a TEST-mode purchase (cs_test_ only) that is still pending or awaiting payment', () => {
    expect(sql).toContain("purchase_row.stripe_checkout_session_id = 'cs' || chr(95) || 'test' || chr(95) || 'PASTESESSION'");
    expect(sql).toContain('purchase_row.livemode = false');
    expect(sql).toContain("purchase_row.status in ('pending', 'awaiting' || chr(95) || 'payment')");
    // A live session (cs_live_…) can never match: the only session literal is the test prefix.
    expect(literals).not.toContain('live');
    expect(sql).not.toMatch(/livemode = true/);
  });
});
