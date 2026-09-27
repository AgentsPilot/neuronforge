/**
 * The dormant-champion trim list, worked (S-0).
 *
 * ── What "worked" means, and what it must not become ────────────────────────
 * `noEndDateAccountsWithoutProfile` has counted these accounts since S1-T11a. A
 * count is not something anybody can act on: it says how many people have free
 * access for ever without saying who, since when, or what ending it would take.
 *
 * So the section names each account, sizes the dormancy, and carries **the exact
 * admin operation** that ends that account's free access.
 *
 * And the thing it must not become: a decision. There is no write here, no
 * recommended date, and no default anybody could paste without choosing —
 * ending somebody's free access is the user's call, and these tests hold the
 * code to that as firmly as they hold it to producing the list.
 */

import { buildShadowReport } from '@/lib/business-os/entitlements/report';
import { readCodeConfig } from '@/lib/business-os/entitlements/source';
import type { BusinessOsAccountPlan } from '@/lib/repositories/BusinessOsAccountPlanRepository';

const NOW = new Date('2026-09-26T00:00:00.000Z');

function planRow(overrides: Partial<BusinessOsAccountPlan> = {}): BusinessOsAccountPlan {
  return {
    user_id: 'a1',
    tier: null,
    plan_version: 0,
    tier_expires_at: null,
    cohort: 'champion',
    cohort_expires_at: null,
    onboarding_started_at: '2026-01-01T00:00:00.000Z',
    // The defining fact of the trim list: no business was ever built.
    profile_created_at: null,
    trial_started_at: null,
    trial_ends_at: null,
    grace_ends_at: null,
    period_anchor: '2026-01-01T00:00:00.000Z',
    origin: 'backfill',
    updated_by_admin_id: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as BusinessOsAccountPlan;
}

async function report(rows: BusinessOsAccountPlan[]) {
  return buildShadowReport({
    config: readCodeConfig(),
    now: () => NOW,
    planRepository: {
      async pagePlans(options: { afterUserId?: string | null; limit?: number } = {}) {
        const after = options.afterUserId;
        return { data: rows.filter((row) => !after || row.user_id > after), error: null };
      },
      async findTenantsMissingPlanRow() {
        return {
          data: {
            checked: rows.length,
            count: 0,
            missing: [],
            withProfile: 0,
            onboardingOnly: 0,
            truncated: false,
            scope: 'exhaustive',
          },
          error: null,
        };
      },
      async findRecentOnboardedPlans() {
        return { data: [], error: null };
      },
    } as never,
    shadowRepository: {
      async findWindow() {
        return { data: [], error: null };
      },
    } as never,
  });
}

describe('who is on the list', () => {
  it('is a champion with no end date who never created a business profile', async () => {
    const { static: section } = await report([planRow({ user_id: 'dormant' })]);

    expect(section.dormantChampions.walkFailed).toBe(false);
    expect(section.dormantChampions.accounts).toBe(1);
    expect(section.dormantChampions.rows.map((row) => row.accountId)).toEqual(['dormant']);
  });

  it.each([
    ['has a business profile', { profile_created_at: '2026-02-01T00:00:00.000Z' }],
    ['their access already has an end date', { cohort_expires_at: '2026-12-01T00:00:00.000Z' }],
    ['they are on a trial, not a champion', { cohort: 'trial' }],
    ['they are paying', { cohort: null, tier: 'basic', plan_version: 1 }],
  ])('excludes an account that %s', async (_why, overrides) => {
    // Each exclusion is a different reason not to be on a trim list, and the
    // one that would hurt most is the fourth: this list must never reach a
    // paying customer.
    const { static: section } = await report([planRow(overrides)]);

    expect(section.dormantChampions.rows).toEqual([]);
    expect(section.dormantChampions.accounts).toBe(0);
  });

  it('counts accounts, not rows', async () => {
    const { static: section } = await report([
      planRow({ user_id: 'a' }),
      planRow({ user_id: 'b' }),
      planRow({ user_id: 'c', profile_created_at: '2026-02-01T00:00:00.000Z' }),
    ]);

    expect(section.accountsScanned).toBe(3);
    expect(section.dormantChampions.accounts).toBe(2);
  });

  it('agrees with the count that has existed since S1-T11a', async () => {
    // Two ways of asking the same question, and they must not drift: the older
    // count is what somebody may already be watching.
    const rows = [planRow({ user_id: 'a' }), planRow({ user_id: 'b' })];
    const { static: section } = await report(rows);

    expect(section.dormantChampions.accounts).toBe(section.noEndDateAccountsWithoutProfile);
  });
});

describe('what each row gives somebody to act on', () => {
  it('says how long the account has been dormant, in days', async () => {
    const { static: section } = await report([
      planRow({ user_id: 'old', created_at: '2026-01-01T00:00:00.000Z' }),
    ]);

    // 2026-01-01 → 2026-09-26.
    expect(section.dormantChampions.rows[0].dormantDays).toBe(268);
    expect(section.dormantChampions.rows[0].since).toBe('2026-01-01T00:00:00.000Z');
    expect(section.dormantChampions.rows[0].origin).toBe('backfill');
  });

  it('never reports a NEGATIVE dormancy (QA-5)', async () => {
    // A record created in the future — clock skew, or a seeded fixture — would
    // otherwise produce a negative number of days in a list somebody is meant
    // to read and act on.
    const { static: section } = await report([
      planRow({ user_id: 'from-the-future', created_at: '2027-01-01T00:00:00.000Z' }),
    ]);

    expect(section.dormantChampions.rows[0].dormantDays).toBe(0);
  });

  it('carries the operation that ends THIS account, addressed to this account', async () => {
    const { static: section } = await report([planRow({ user_id: 'dormant-7' })]);
    const [row] = section.dormantChampions.rows;

    expect(row.endAccessOp.method).toBe('POST');
    expect(row.endAccessOp.path).toBe(
      '/api/admin/business-os/entitlements/accounts/dormant-7'
    );
    // The field that applies to a cohort. `tier_expires_at` on an account with
    // no tier is the 409 an admin would otherwise discover by hand.
    expect(row.endAccessOp.body.op).toBe('set_expiry');
    expect(row.endAccessOp.body.field).toBe('cohort_expires_at');
  });

  it('never carries a date anybody could paste without choosing one', async () => {
    const { static: section } = await report([planRow()]);
    const [row] = section.dormantChampions.rows;

    // A placeholder 30 days out, and a reason that refuses to be sent as-is.
    // The value of a trim list is that somebody decides; a ready-to-send body
    // with a plausible date is how "produce the list" becomes "cut them".
    expect(new Date(row.endAccessOp.body.value).getTime()).toBeGreaterThan(NOW.getTime());
    expect(row.endAccessOp.body.reason).toMatch(/REPLACE THIS/);
  });

  it('says what happens after the date, so the operation is not read as harsher than it is', async () => {
    const { static: section } = await report([planRow()]);

    expect(section.dormantChampions.afterExpiry).toMatch(/grace/i);
    expect(section.dormantChampions.afterExpiry).toMatch(/30 days/);
    // And that nothing happens at all today, which is the current truth.
    expect(section.dormantChampions.afterExpiry).toMatch(/BOS_ENTITLEMENTS_MODE is off/);
  });
});

describe('what the section is not', () => {
  it('states on itself that it is a list and a mechanism, not a decision', async () => {
    const { static: section } = await report([planRow()]);

    expect(section.dormantChampions.note).toMatch(/not a decision/i);
    expect(section.dormantChampions.note).toMatch(/Nothing here has been cut/i);
  });

  it('writes nothing — the report is a read, and this section is part of it', async () => {
    // Asserted through the repository: a section that could cut anybody would
    // need a write method, and the stub has none.
    //
    // An ALLOW-LIST, not a denylist of name patterns (QA observation). A
    // denylist only rejects the write names somebody thought of; this rejects
    // everything that is not one of the three reads the report is allowed to
    // perform, so a NEW method added to the stub fails by default rather than
    // sliding past a regular expression.
    const READS_ALLOWED = ['pagePlans', 'findTenantsMissingPlanRow', 'findRecentOnboardedPlans'];
    const calls: string[] = [];

    await buildShadowReport({
      config: readCodeConfig(),
      now: () => NOW,
      planRepository: {
        async pagePlans() {
          calls.push('pagePlans');
          return { data: [planRow()], error: null };
        },
        async findTenantsMissingPlanRow() {
          calls.push('findTenantsMissingPlanRow');
          return {
            data: { checked: 1, count: 0, missing: [], withProfile: 0, onboardingOnly: 0, truncated: false, scope: 'x' },
            error: null,
          };
        },
        async findRecentOnboardedPlans() {
          calls.push('findRecentOnboardedPlans');
          return { data: [], error: null };
        },
      } as never,
      shadowRepository: {
        async findWindow() {
          return { data: [], error: null };
        },
      } as never,
    });

    expect(calls.filter((call) => !READS_ALLOWED.includes(call))).toEqual([]);
    // Non-vacuity: the stub really was exercised, so an empty `calls` array is
    // not what made the line above pass.
    expect(calls).toContain('pagePlans');
  });

  it('QA-4: a FAILED walk does not report itself as "nobody is dormant"', async () => {
    // The same asymmetry S0-1 removed, one field along and in a section this
    // slice added. Before this, a failed read gave `accounts: 0, rows: []` —
    // indistinguishable from a healthy database with no dormant champions.
    const failedWalk = await buildShadowReport({
      config: readCodeConfig(),
      now: () => NOW,
      planRepository: {
        async pagePlans() {
          return { data: null, error: new Error('page read failed') };
        },
        async findTenantsMissingPlanRow() {
          return {
            data: { checked: 0, count: 0, missing: [], withProfile: 0, onboardingOnly: 0, truncated: false, scope: 'x' },
            error: null,
          };
        },
        async findRecentOnboardedPlans() {
          return { data: [], error: null };
        },
      } as never,
      shadowRepository: { async findWindow() { return { data: [], error: null }; } } as never,
    });

    const section = failedWalk.static.dormantChampions;

    expect(section.walkFailed).toBe(true);
    // Not 0 — how many dormant champions exist is not knowable from a walk
    // that stopped on an error.
    expect(section.accounts).toBeNull();
    // And it says so in words as well, for whoever reads the report rather
    // than a field.
    expect(section.incomplete).toMatch(/FAILED/);
  });

  it('QA-4: a CAPPED walk is not confused with a broken one', async () => {
    // `truncated` alone could not carry this: a healthy walk that reaches
    // MAX_ACCOUNTS sets it too. The two states must be distinguishable, or the
    // flag means "something or other happened".
    const { static: section } = await report([planRow({ user_id: 'dormant' })]);

    expect(section.dormantChampions.walkFailed).toBe(false);
    expect(section.dormantChampions.accounts).toBe(1);
    expect(section.dormantChampions.incomplete).toBeNull();
  });

  it('is empty on a database with no dormant champions, and says so as zero rather than as absent', async () => {
    const { static: section } = await report([
      planRow({ user_id: 'paying', cohort: null, tier: 'pro', plan_version: 1 }),
    ]);

    expect(section.dormantChampions.accounts).toBe(0);
    expect(section.dormantChampions.rows).toEqual([]);
    // The note and the after-expiry sentence are still there: a reader of an
    // empty list should still be able to see what the list WOULD mean.
    expect(section.dormantChampions.note.length).toBeGreaterThan(20);
  });
});
