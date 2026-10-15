/**
 * Every automation the dashboard OFFERS must be one the route ACCEPTS.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE REPORT: "I click handle for me, nothing is happening."
 *
 * The card offering to chase unanswered quotes sent `id: 'chase_quotes'`. The
 * route validated the id against a hand-written list of four, the registry held
 * six, and so two automations — `chase_quotes` and `auto_complete_meetings` —
 * were refused with a 400.
 *
 * Nothing surfaced that. `handleOperationalDecide` discarded the response, so a
 * refusal and a success were the same gesture: the carousel moved on, the list
 * refreshed, and the switch was exactly as it had been. Two of the six cards on
 * that carousel were inert and there was no way to tell from the screen.
 *
 * THE FIX IS THE DERIVATION, NOT THE TWO IDS. A registry and a copy of a
 * registry drift the moment somebody adds the seventh — this test exists to
 * fail then, not to pin today's six.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { OPERATIONAL_AUTOMATIONS } from '@/lib/business-os/gaps/automations';

const route = readFileSync(join(__dirname, '..', 'route.ts'), 'utf8');

describe('the ids the route will accept', () => {
  it('come from the registry rather than a second list', () => {
    expect(route).toMatch(/OPERATIONAL_AUTOMATIONS\.map\(automation => automation\.id\)/);
    expect(route).toMatch(/z\.enum\(AUTOMATION_IDS\)/);
  });

  it('are not written out by hand', () => {
    /*
     * The shape that caused this: `z.enum(['reply_to_enquiries', ...])`. Any
     * literal list of automation ids here is the bug returning.
     */
    expect(route).not.toMatch(/z\.enum\(\s*\[\s*'reply_to_enquiries'/);
  });

  it('cover every automation the carousel can show', () => {
    // The real invariant, stated against the registry itself.
    const offered = OPERATIONAL_AUTOMATIONS.map(a => a.id);

    expect(offered).toContain('chase_quotes');
    expect(offered).toContain('auto_complete_meetings');
    expect(offered.length).toBeGreaterThanOrEqual(6);
  });

  it('and every one of them resolves to a column to write', () => {
    /*
     * Accepting an id the route cannot act on would move the silence one step
     * later rather than remove it.
     */
    for (const automation of OPERATIONAL_AUTOMATIONS) {
      expect(typeof automation.column).toBe('string');
      expect(automation.column.length).toBeGreaterThan(0);
    }
  });
});

describe('and a refusal reaches someone', () => {
  const dashboard = readFileSync(
    join(__dirname, '..', '..', '..', '..', '..', '..', 'components', 'business-os', 'insight', 'LiveDashboard.tsx'),
    'utf8'
  );

  it('the decision response is read, not discarded', () => {
    // `await fetch(...)` with no `response.ok` check is what made two broken
    // cards indistinguishable from four working ones.
    expect(dashboard).toMatch(/if \(!response\.ok\)/);
  });

  it('and says which automation was refused', () => {
    expect(dashboard).toMatch(/'The operational automation decision was refused'/);
  });
});
