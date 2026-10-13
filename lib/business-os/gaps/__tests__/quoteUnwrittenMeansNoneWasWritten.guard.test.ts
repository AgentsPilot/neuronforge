/**
 * "They asked for a price and nothing has been written" must be TRUE.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE REPORT: the Needs-you card led with a client who had nothing waiting on
 * him. He had two quotes, both titled "הצעת מחיר לשיפוץ", both `stopped`.
 *
 * `stopped` means ACCEPTED, started, and ended early — the migration that added
 * it says so outright: "Acceptance stays a historical fact… this records how the
 * job ENDED, never that it was not agreed." The gap's set of statuses counted
 * only `draft`, `sent`, `viewed` and `accepted` as a price being in front of
 * the client, so a job that had been agreed AND delivered came back around as
 * somebody still waiting for a first quote.
 *
 * It is not an edge case. On the reporting account `stopped` is the single most
 * common proposal status — 12 rows of 35, more than `accepted` — so the most
 * finished jobs in the business were the ones most likely to be reported as
 * un-started work.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE TEST IS SHAPED THIS WAY
 *
 * The detector reads five tables and cross-references them; standing that up in
 * Jest would be a fixture larger than the thing it checks, and it would still
 * not catch the defect, which is one missing string in a list. What has to hold
 * is a CLASSIFICATION: every status a proposal can have is either "a price was
 * written" or deliberately not, and no status may be unaccounted for. A new one
 * added to the database without a decision here is exactly how this happened.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const definitions = readFileSync(join(__dirname, '..', 'definitions.ts'), 'utf8');

/** The statuses the gap treats as "a price has already been written". */
const written = (): string[] => {
  const line = definitions.match(/const LIVE_PROPOSAL = \[([^\]]*)\]/);
  if (!line) return [];
  return [...line[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
};

/**
 * Every status the database allows, from the CHECK constraint that defines them.
 *
 * Read from the migration rather than retyped, so a status added there without a
 * decision here fails this suite instead of silently joining the wrong side.
 */
const allStatuses = (): string[] => {
  const sql = readFileSync(
    join(__dirname, '..', '..', '..', '..', 'supabase', 'migrations', '20260928b_proposal_stopped_state.sql'),
    'utf8'
  );
  const check = sql.match(/CHECK \(status IN \(([\s\S]*?)\)\)/);
  if (!check) return [];
  return [...check[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
};

/*
 * The statuses deliberately NOT counted as written, each for a stated reason.
 * Listing them here is the decision: anything outside both lists is unclassified.
 */
const DELIBERATELY_NOT_WRITTEN: Record<string, string> = {
  declined: 'a refused price is a different conversation from one never given',
  expired: 'the price lapsed; the client is owed a fresh one',
  superseded: 'a revision replaced it, and the successor is what counts',
};

describe('a quote that was written', () => {
  it('counts a job that was agreed and later stopped', () => {
    // The reported case. `stopped` is acceptance plus an ending, never a denial
    // that it was agreed.
    expect(written()).toContain('stopped');
  });

  it('counts one the owner withdrew', () => {
    // Taking a quote back is a decision about a price that exists, not an
    // absence of one.
    expect(written()).toContain('withdrawn');
  });

  it('still counts the four live states', () => {
    for (const status of ['draft', 'sent', 'viewed', 'accepted']) {
      expect(written()).toContain(status);
    }
  });
});

describe('and every status is accounted for', () => {
  it('reads a real list from the database constraint', () => {
    // Guard against the guard passing because it found nothing.
    expect(allStatuses().length).toBeGreaterThanOrEqual(9);
  });

  it.each(allStatuses())('%s is either written or deliberately excluded', status => {
    const classified =
      written().includes(status) || Object.hasOwn(DELIBERATELY_NOT_WRITTEN, status);

    /*
     * If this fails, a proposal status exists that nobody has decided about.
     * The default for an unknown status is to be treated as "not written",
     * which means the card will tell an owner that a client is waiting for a
     * price they may already have — the exact failure this file is named for.
     */
    expect(classified).toBe(true);
  });

  it('and the exclusions are only the three with reasons', () => {
    // Keeps the two lists from being "fixed" by quietly widening the exclusions.
    expect(Object.keys(DELIBERATELY_NOT_WRITTEN).sort()).toEqual([
      'declined',
      'expired',
      'superseded',
    ]);
  });
});
