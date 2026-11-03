/**
 * A card goes quiet while a living agent has the work, and comes back when it
 * stops.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE HAND-OFF, AND WHY BOTH HALVES ARE TESTED
 *
 * Business OS ships agents that take work off the owner, and Needs-you predates
 * them: the product offered to chase overdue invoices and then told the owner
 * to chase overdue invoices. The cause was an inference in `invoice_unpaid`:
 *
 *     if (chased.has(id)) { spent.add(id); }   // "chased ⇒ nothing coming"
 *
 * True of the MILESTONE chaser, which schedules its whole round as `pending`
 * up front. False of `chase_overdue_invoices`, which sends one at a time and
 * comes back after a cooldown — so the agent chasing was what marked the
 * invoice `chaserDone`, which is the flag that puts it on the card.
 *
 * The opposite failure is worse and is tested just as hard: an owner whose
 * agent is paused, broken, switched off or past its stop rule must be TOLD.
 * Silence there is never discovered.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { coveredByAgent, NO_COVERAGE, type AgentCoverage } from '../coverage';

const COVERS_60: AgentCoverage = new Map([['invoice_unpaid', 60]]);

describe('coveredByAgent — the far edge is the only edge', () => {
  it('covers an item inside the window', () => {
    expect(coveredByAgent(COVERS_60, 'invoice_unpaid', 20)).toBe(true);
  });

  it('covers one younger than the agent even starts', () => {
    /*
     * `chase_overdue_invoices` begins at day 7, so a three-day-old invoice is
     * before its reach — and still covered, because the agent WILL get to it.
     * "Something is going to act on this again" is already true, which is why
     * no start day is read anywhere and no plan JSON is parsed.
     */
    expect(coveredByAgent(COVERS_60, 'invoice_unpaid', 3)).toBe(true);
  });

  it('stops exactly at the owner stop rule', () => {
    expect(coveredByAgent(COVERS_60, 'invoice_unpaid', 60)).toBe(true);
    expect(coveredByAgent(COVERS_60, 'invoice_unpaid', 61)).toBe(false);
  });

  it('follows the owner when they extend the agent', () => {
    /*
     * THE REASON NO DAY COUNT IS WRITTEN DOWN. "Stops after" is the owner's
     * setting; a 60 copied into gap code would have silently uncovered days
     * 60–120 the moment they extended it, putting the card back while the
     * agent was still working.
     */
    const extended: AgentCoverage = new Map([['invoice_unpaid', 120]]);

    expect(coveredByAgent(COVERS_60, 'invoice_unpaid', 80)).toBe(false);
    expect(coveredByAgent(extended, 'invoice_unpaid', 80)).toBe(true);
  });

  it('covers nothing for a gap no agent claimed', () => {
    expect(coveredByAgent(COVERS_60, 'quote_awaiting_client', 1)).toBe(false);
  });

  it('covers nothing when there are no agents', () => {
    expect(coveredByAgent(NO_COVERAGE, 'invoice_unpaid', 1)).toBe(false);
  });

  it('refuses an age it cannot read', () => {
    /* An invoice with no due date cannot be placed in time, and an item we
       cannot place is one we must not hide. */
    expect(coveredByAgent(COVERS_60, 'invoice_unpaid', NaN)).toBe(false);
  });
});

describe('the source carries no day counts', () => {
  const { readFileSync } = require('fs') as typeof import('fs');
  const { join } = require('path') as typeof import('path');

  it('coverage.ts states no window of its own', () => {
    /*
     * Asserted by reading the source because this is the thing most likely to
     * creep back in: the next person fixing an edge case reaches for a literal.
     * The window must always come from `planInputs`, which is the number the
     * running plan itself is handed.
     */
    const src = readFileSync(join(process.cwd(), 'lib/business-os/gaps/coverage.ts'), 'utf-8');
    const code = src
      .split('\n')
      .filter(line => !/^\s*(\*|\/\*|\/\/)/.test(line))
      .join('\n');

    /* No bare day-like numbers, and no day arithmetic. */
    expect(code).not.toMatch(/\b(?:7|14|30|45|60|90|120)\b/);
    expect(code).not.toMatch(/86_?400_?000/);
    /* It reads the owner's own number instead. */
    expect(code).toContain('planInputs');
  });

  it('the catalogue declares the gap and not the window', () => {
    const src = readFileSync(
      join(process.cwd(), 'lib/business-os/automations/catalog.ts'),
      'utf-8'
    );

    expect(src).toMatch(/coversGap: 'invoice_unpaid'/);
    /* No `fromDays`/`toDays` beside it — the window is never declared here. */
    expect(src).not.toMatch(/coversGap[\s\S]{0,120}(fromDays|toDays)/);
  });
});

describe('the automation sweep must keep seeing everything', () => {
  const { readFileSync } = require('fs') as typeof import('fs');
  const { join } = require('path') as typeof import('path');

  it('suppression is opt-in, so no existing caller changed', () => {
    /*
     * THE BUG THIS PREVENTS IS A DEADLOCK.
     *
     * `LeadResponseDispatchService` builds the automation queue FROM
     * `findGaps` — it asks for an automation's own `gapId` and schedules a send
     * for every item it gets back. Hide those items and the chaser is starved
     * of the work the hiding claims it is doing: the card goes quiet, the robot
     * is handed nothing, and nobody chases anyone.
     */
    const sweep = readFileSync(
      join(process.cwd(), 'lib/services/LeadResponseDispatchService.ts'),
      'utf-8'
    );

    expect(sweep).toContain('findGaps(');
    expect(sweep).not.toContain('hideWhatAgentsHandle');
  });

  it('findGaps does no coverage work unless asked', () => {
    const src = readFileSync(join(process.cwd(), 'lib/business-os/gaps/findGaps.ts'), 'utf-8');

    /* Not merely defaulted to false — the read itself is skipped, so an
       unasked caller pays nothing and cannot be affected. */
    expect(src).toMatch(/hideWhatAgentsHandle\s*\?\s*await agentCoverage\(userId\)\s*:\s*NO_COVERAGE/);
  });

  it('the owner-facing route is the one that asks', () => {
    const route = readFileSync(
      join(process.cwd(), 'app/api/business-os/gaps/route.ts'),
      'utf-8'
    );

    expect(route).toMatch(/hideWhatAgentsHandle: true/);
  });
});
