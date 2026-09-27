/**
 * The quiet plan pill: who gets one, and what happens when we cannot tell.
 *
 * ── What this suite is really protecting ────────────────────────────────────
 * The constraint was "no second opinion about who is a champion". The pill and
 * the plan section must never disagree, so the decision is made from a
 * **resolution** — the same snapshot the section reads — rather than from a
 * cohort string a component could compare.
 *
 * The failure that matters is not a crash. It is a **wrong label in the chrome of
 * every screen**: "Founding Partner" beside the logo of somebody whose free
 * access lapsed last week is a claim about what they are paying for, made
 * everywhere at once.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { planBadgeFor, PLAN_SECTION_HREF } from '@/lib/business-os/entitlements/planBadge';
import { previewAccountFor } from '@/lib/business-os/entitlements/planPresentation';
import { resolveEntitlements } from '@/lib/business-os/entitlements/resolver';
import { readCodeConfig } from '@/lib/business-os/entitlements/source';

const NOW = new Date('2026-09-27T00:00:00.000Z');
const config = readCodeConfig();

function resolutionFor(planId: string, overrides: Record<string, unknown> = {}) {
  return resolveEntitlements({
    config,
    account: { ...previewAccountFor(config, planId, NOW), ...overrides },
    overrides: [],
    addons: [],
    now: NOW,
  });
}

describe('who gets a pill', () => {
  it('a Founding Partner does, with the name from config', () => {
    const badge = planBadgeFor(resolutionFor('champion'), config);

    // The customer-facing name, never the internal id.
    expect(badge?.label).toBe('Founding Partner');
    expect(badge?.label).not.toBe('champion');
    expect(badge?.href).toBe(PLAN_SECTION_HREF);
  });

  it('the label is READ from config, not written here (QA-11)', () => {
    // The interface promises "from config — never an internal id", and nothing
    // held it: replacing `planLabel(config, basis.cohort)` with the literal
    // 'Founding Partner' passed all ten tests, because that is what the config
    // says today. Renaming the plan is a config edit, so the pill must follow it.
    const renamed = {
      ...config,
      cohorts: {
        ...config.cohorts,
        champion: {
          ...config.cohorts.champion,
          labels: { en: 'Charter Member', he: 'Charter Member', es: 'Charter Member' },
        },
      },
    } as typeof config;

    expect(planBadgeFor(resolutionFor('champion'), renamed)?.label).toBe('Charter Member');
  });

  it('the accessible name says WHY it is there, not just the plan name', () => {
    // "Founding Partner" alone tells a screen-reader user nothing about what
    // following the link does. The reason travels with the label.
    const badge = planBadgeFor(resolutionFor('champion'), config);

    expect(badge?.title).toMatch(/no end date/i);
    expect(badge?.title.length).toBeGreaterThan(20);
  });

  it('a paid plan does NOT — its name is not news', () => {
    for (const tier of ['basic', 'pro']) {
      expect(planBadgeFor(resolutionFor(tier), config)).toBeNull();
    }
  });

  it('a trial does NOT, and that is a decision rather than an oversight', () => {
    // A trial has an END DATE, so its pill would be a countdown — which is
    // something to act on, and this pill is deliberately quiet. The chrome also
    // stays mounted across navigations, so a trial pill would show a stale number
    // until a full reload. A champion's open-ended state cannot go stale that way.
    expect(planBadgeFor(resolutionFor('trial'), config)).toBeNull();
  });

  it('a LAPSED champion does not keep the pill', () => {
    // The reason the decision reads `resolution.state` and not the stored cohort
    // column: a champion whose access ended resolves to grace or paused, and a
    // component comparing `cohort === 'champion'` would still badge them.
    const lapsed = resolutionFor('champion', { cohortExpiresAt: '2026-09-01T00:00:00.000Z' });

    expect(lapsed.state).not.toBe('champion');
    expect(planBadgeFor(lapsed, config)).toBeNull();
  });

  it('the stored cohort is not what decides it — proved on the same account', () => {
    // Non-vacuity for the test above: the account's cohort column says champion in
    // both cases, and only the RESOLVED state differs.
    const live = resolutionFor('champion');
    const lapsed = resolutionFor('champion', { cohortExpiresAt: '2026-09-01T00:00:00.000Z' });

    expect(live.basis).toEqual({ kind: 'cohort', cohort: 'champion' });
    expect(planBadgeFor(live, config)).not.toBeNull();
    expect(planBadgeFor(lapsed, config)).toBeNull();
  });
});

describe('when we cannot tell', () => {
  it('a null resolution renders nothing — there is no error state by design', () => {
    // Every failure path in the layout funnels to `null`: no session, an
    // unreadable plan, a thrown error. The chrome of every screen is the last
    // place to surface a problem with a decorative label.
    expect(planBadgeFor(null, config)).toBeNull();
  });

  it('an account the resolver granted nothing gets no pill', () => {
    const anomalous = resolveEntitlements({ config, account: null, overrides: [], addons: [], now: NOW });

    expect(anomalous.basis.kind).toBe('none');
    expect(planBadgeFor(anomalous, config)).toBeNull();
  });
});

describe('one destination', () => {
  it('both renderings point at the same place, because there is one constant', () => {
    // The pill appears twice. Two hard-coded hrefs would eventually differ, and
    // one of them would be the broken one.
    expect(PLAN_SECTION_HREF).toContain('/business-os/settings');
    expect(PLAN_SECTION_HREF).toContain('section=plan');
  });

  it('the settings page honours that section, or the link does nothing visible', () => {
    // `?section=plan` had to be added to the page's allow-list: without it the
    // pill landed somebody on settings with every section collapsed, which reads
    // as a broken link rather than a quiet one.
    const source = readFileSync(join(process.cwd(), 'app/business-os/settings/page.tsx'), 'utf8');

    expect(source).toMatch(/requested !== 'plan'|requested === 'plan'/);
  });
});

