/**
 * Closing one conversation must not silence everything else that person said.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FOUND ON LIVE DATA, 2026-11-12.
 *
 * `client_reply_waiting` excluded a contact from the card when ANY
 * `reply_handled` row existed for them — and that lookup is deliberately
 * unbounded in time, so one closed thread silenced that person for ever. The
 * comment above it said "a closure recorded at any time settles the thread".
 * It settled the contact. Intent and implementation disagreed and the code won.
 *
 * One receptionist run on the live account wrote five rows for one contact:
 * three `reply_needs_owner` — a refund request and two questions about overdue
 * invoices — and two `reply_handled` for unrelated threads. All three
 * escalations disappeared from the card. A second contact in the same run, one
 * escalation and no closure, rendered normally. The set was the only
 * difference between them.
 *
 * The owner was told nothing, while the agent had correctly found and recorded
 * three things that needed them. That is the failure this agent's own history
 * keeps naming: "the owner believes the agent is watching their mail."
 *
 * Source-level, because the behaviour lives in a closure over a Supabase query
 * that a unit test cannot reach without standing up the whole gap registry.
 */

import fs from 'fs';
import path from 'path';

const SOURCE = fs
  .readFileSync(path.join(process.cwd(), 'lib/business-os/gaps/definitions.ts'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

/** The `client_reply_waiting` finder, and nothing either side of it. */
const FINDER = (() => {
  const from = SOURCE.indexOf("safely('client_reply_waiting'");
  const to = SOURCE.indexOf("safely('", from + 10);
  return SOURCE.slice(from, to > from ? to : from + 9000);
})();

describe('a closure settles the thread it closed', () => {
  it('reads the thread the closure named', () => {
    expect(FINDER).toMatch(/\.select\('contact_id, source_thread_id'\)/);
    expect(FINDER).toMatch(/\.eq\('activity_type', 'reply_handled'\)/);
  });

  it('and excludes by thread', () => {
    expect(FINDER).toMatch(/const settledThreads = new Set\(/);
    expect(FINDER).toMatch(
      /\.filter\(r => !\(r\.source_thread_id && settledThreads\.has\(r\.source_thread_id as string\)\)\)/
    );
  });

  it('the contact-wide set now holds ONLY closures that cannot name a thread', () => {
    /*
     * The whole bug in one expression. Before: every `reply_handled` row.
     * After: only the ones with no `source_thread_id` — rows written before
     * 20261118, which was not backfilled. Reading those any other way would
     * resurrect every card closed before that migration.
     */
    expect(FINDER).toMatch(
      /const settled = new Set\(\s*\(closed \|\| \[\]\)\.filter\(r => !r\.source_thread_id\)\.map\(r => r\.contact_id as string\)\s*\)/
    );
  });

  it('and the old unconditional contact set is gone', () => {
    expect(FINDER).not.toMatch(
      /new Set\(\(closed \|\| \[\]\)\.map\(r => r\.contact_id as string\)\)/
    );
  });
});

describe('the rows it reads can still answer the question', () => {
  it('escalations carry the thread the closure is compared against', () => {
    /* Without `source_thread_id` on the raised rows there is nothing to match,
       and the filter would silently never exclude anything. */
    expect(FINDER).toMatch(/source_thread_id/);
    expect(FINDER).toMatch(/\.in\('activity_type', \['reply_drafted', 'reply_needs_owner'\]\)/);
  });
});
