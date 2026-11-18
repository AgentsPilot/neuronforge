/**
 * The tab bar is told whether the owner is being WALKED THROUGH.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS FOR, AND WHAT IT COST TO LEARN
 *
 * `bos_setup_complete` has one writer, `LiveDashboard`, and one reader,
 * `BusinessOSTabs`. The value was briefly written from `everyPhaseAnswered`,
 * and that was wrong in a way no type can catch.
 *
 * `everyPhaseAnswered` asks whether the owner pressed through every phase of
 * the walkthrough, and one phase is "my catalogue is finished", recorded as
 * `services` in `dismissed_setup_steps`. An account that predates the
 * walkthrough, or that simply never pressed that button, has an empty list and
 * can therefore NEVER satisfy it. Written as the bar's authority, that
 * permanently removed People, Money, Online presence and Business overview
 * from a live business with 10 contacts, 63 bookings and 52 payments behind
 * it, in production, minutes after a deploy.
 *
 * `setupMode` is the question the bar is actually asking:
 * `nobodyHasArrived && !everyPhaseAnswered`. Once anybody has touched, booked
 * or paid, the account is not being walked through whatever the phases say.
 *
 * Asserted at source because the failure is a wiring mistake inside one
 * `useEffect`: every piece behaves correctly on its own, and no render test
 * reaches the combination of "established account, phases unpressed".
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const read = (relative: string) =>
  readFileSync(join(process.cwd(), relative), 'utf8');

const DASHBOARD = 'components/business-os/insight/LiveDashboard.tsx';
const TABS = 'components/business-os/BusinessOSTabs.tsx';

/** Source with comments removed, so the notes above do not satisfy a match. */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('who writes the setup key, and from what', () => {
  const dashboard = code(read(DASHBOARD));

  it('the dashboard is the only writer', () => {
    expect(dashboard).toContain("window.sessionStorage.setItem('bos_setup_complete'");
    /* One call, not two: a second would be a second opinion. */
    expect(dashboard.match(/setItem\('bos_setup_complete'/g) ?? []).toHaveLength(1);
  });

  it('writes from setupMode, never from everyPhaseAnswered', () => {
    const write = dashboard.slice(
      dashboard.indexOf("setItem('bos_setup_complete'"),
      dashboard.indexOf("setItem('bos_setup_complete'") + 120
    );

    expect(write).toContain('setupMode');
    /*
     * The regression, named so it cannot return: an account that never pressed
     * through the phases is not the same as an account still in setup.
     */
    expect(write).not.toContain('everyPhaseAnswered');
  });

  it('and the effect is keyed on the same thing it writes', () => {
    /* A stale dependency would freeze the bar on whatever the first render
       said, which on a cold load is the restrictive answer. */
    expect(dashboard).toMatch(/\}, \[setupMode\]\);/);
  });

  it('setupMode is still the arrival question, so trading reopens the bar', () => {
    /*
     * The half that makes this safe. If `setupMode` ever stopped consulting
     * arrivals, writing it here would reintroduce the same outage by another
     * route.
     */
    expect(dashboard).toContain('const setupMode = Boolean(nobodyHasArrived && !everyPhaseAnswered)');
  });
});

describe('how the bar reads it', () => {
  const tabs = code(read(TABS));

  it('treats an unknown answer as "show everything"', () => {
    /*
     * The asymmetry that matters: hiding four tabs from a business that has
     * traded for a year because one request was slow is far worse than briefly
     * offering a new account a tab it cannot use yet.
     */
    expect(tabs).toContain("const value = window.sessionStorage.getItem(SETUP_DONE_KEY)");
    expect(tabs).toContain("value === '1' ? true : value === '0' ? false : null");
    expect(tabs).toMatch(/setupDone === null \? byCapability/);
  });

  it('never decides the answer for itself on a failed read', () => {
    /* Every failure path re-reads the key rather than assuming either way. */
    expect(tabs).not.toMatch(/setSetupDone\(true\)/);
    expect(tabs).not.toMatch(/setSetupDone\(false\)/);
  });
});
