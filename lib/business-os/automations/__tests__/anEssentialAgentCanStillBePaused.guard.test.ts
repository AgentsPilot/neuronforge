/**
 * An essential agent installs itself once, and a pause sticks.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BUG THIS EXISTS FOR WAS WRITTEN AND CAUGHT THE SAME HOUR.
 *
 * `ensureEssentialAutomations` runs on every render of the agents list and on
 * every refund submission. Its first version called `installAutomation`
 * directly — and that function reactivates a paused agent on purpose, because
 * "re-installing a paused one is the owner asking for it back".
 *
 * Correct when a PERSON presses install. Catastrophic here: an owner who
 * paused the refund agent would find it running again seconds later, every
 * time, with no way to make the pause stick. The one decision they are allowed
 * to make about an agent they never chose would have been silently undone.
 *
 * So the ensure looks first and installs only when there is no row at all.
 * This file pins that, because the obvious simplification — "installAutomation
 * is idempotent, just call it" — reintroduces it exactly.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as fs from 'fs';
import * as path from 'path';

const INSTALL = fs.readFileSync(
  path.join(__dirname, '..', 'install.ts'),
  'utf-8'
);

/** The body of `ensureEssentialAutomations`, and nothing around it. */
function ensureBody(): string {
  const start = INSTALL.indexOf('export async function ensureEssentialAutomations');
  const end = INSTALL.indexOf('export async function installedAutomations');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return INSTALL.slice(start, end);
}

describe('an essential agent can still be paused', () => {
  it('skips an automation the owner already has, whatever its status', () => {
    const body = ensureBody();

    /* It reads what exists BEFORE installing anything. */
    expect(body).toContain('agentRepository.findScheduled(userId)');
    /* And skips, rather than installing over the top. */
    expect(body).toMatch(/if \(have\.has\(automation\.id\)\) continue;/);
  });

  it('never filters that check by status', () => {
    const body = ensureBody();

    /*
     * The failure mode in one line: looking only for ACTIVE agents would find
     * none for a paused one, and install — which reactivates it. The set must
     * be built from every row, paused included.
     */
    expect(body).not.toMatch(/status[^\n]*===?[^\n]*'active'/);
    expect(body).not.toMatch(/\.eq\(\s*'status'/);
  });

  it('install still reactivates a paused agent, which is why the check matters', () => {
    /*
     * Pinned as the REASON rather than as behaviour under test. If somebody
     * ever makes `installAutomation` leave a paused agent alone, this test
     * fails and whoever is reading can delete the guard above with confidence
     * instead of guessing whether it is still load-bearing.
     */
    expect(INSTALL).toContain('Re-installing a paused one is the owner asking for it back');
    expect(INSTALL).toMatch(/if \(existing\.status !== 'active'\) \{\s*\n\s*await agentRepository\.activate/);
  });

  it('cannot throw into the two things that call it', () => {
    const body = ensureBody();

    /* One renders the owner's agent list, the other finishes a client's refund
       request. Neither may fail because an install did. */
    expect(body).toContain('try {');
    expect(body).toContain('} catch (err) {');
    expect(body).toContain('non-blocking');
  });

  it('exactly one automation is essential, and it is the refund one', () => {
    /*
     * The bar is deliberately high: an agent that installs itself is the
     * platform deciding how somebody's business works. A second entry here
     * should be an argument somebody had, not a line somebody added.
     */
    const catalog = fs.readFileSync(path.join(__dirname, '..', 'catalog.ts'), 'utf-8');
    const essentials = catalog.match(/^\s*essential: true,$/gm) ?? [];

    expect(essentials).toHaveLength(1);

    const refundEntry = catalog.slice(
      catalog.indexOf("id: 'assess_refund_requests'"),
      catalog.indexOf('steps: assessRefundRequestsSteps')
    );
    expect(refundEntry).toContain('essential: true');
  });
});
