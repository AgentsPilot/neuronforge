/**
 * The shadow report.
 *
 * Two things are worth testing hard: the **replay** (does "what would tier X
 * cost?" discriminate, or does it just repeat the matrix back?) and the **data
 * exposure** (RC-16 — a report that leaks names or reason text is one nobody can
 * paste into a ticket).
 *
 * Everything is fed through injected repositories, so the numbers are the
 * report's arithmetic and nothing else.
 */

import { buildShadowReport } from '@/lib/business-os/entitlements/report';
import { fixtureConfig } from '@/lib/business-os/entitlements/__fixtures__/fixtureSource';
import { readCodeConfig } from '@/lib/business-os/entitlements/source';
import type { BusinessOsAccountPlan } from '@/lib/repositories/BusinessOsAccountPlanRepository';
import type { BusinessOsShadowEvent } from '@/lib/repositories/BusinessOsEntitlementShadowRepository';

const NOW = new Date('2026-09-22T00:00:00.000Z');
const now = () => NOW;

function planRow(overrides: Partial<BusinessOsAccountPlan> = {}): BusinessOsAccountPlan {
  return {
    user_id: 'acct-1',
    tier: null,
    plan_version: 0,
    tier_expires_at: null,
    cohort: 'champion',
    cohort_expires_at: null,
    onboarding_started_at: '2026-01-01T00:00:00.000Z',
    profile_created_at: '2026-01-02T00:00:00.000Z',
    trial_started_at: null,
    trial_ends_at: null,
    grace_ends_at: null,
    period_anchor: '2026-01-01T00:00:00.000Z',
    origin: 'backfill',
    updated_by_admin_id: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function event(overrides: Partial<BusinessOsShadowEvent> = {}): BusinessOsShadowEvent {
  return {
    user_id: 'acct-1',
    capability: 'chat.search',
    surface: 'owner_read',
    outcome: 'allowed',
    rule: 'domain_group',
    day: '2026-09-01',
    hits: 1,
    items_total: 1,
    items_max: 1,
    last_seen_at: '2026-09-01T00:00:00.000Z',
    sample_correlation_id: null,
    ...overrides,
  };
}

function repositories(rows: BusinessOsAccountPlan[], events: BusinessOsShadowEvent[] = [], missing: string[] = []) {
  return {
    planRepository: {
      async pagePlans(options: { afterUserId?: string | null; limit?: number } = {}) {
        const after = options.afterUserId;
        const page = rows.filter((row) => !after || row.user_id > after).slice(0, options.limit ?? 500);
        return { data: page, error: null };
      },
      async findTenantsMissingPlanRow() {
        return { data: { checked: rows.length + missing.length, missing, truncated: false }, error: null };
      },
      async findRecentOnboardedPlans(options: { limit?: number } = {}) {
        // Mirrors the repository: onboarded only, newest first, capped.
        const onboarded = rows
          .filter((row) => row.onboarding_started_at !== null)
          .sort((a, b) => (b.onboarding_started_at as string).localeCompare(a.onboarding_started_at as string));
        return { data: onboarded.slice(0, options.limit ?? 200), error: null };
      },
    },
    shadowRepository: {
      async findWindow() {
        return { data: events, error: null };
      },
    },
  };
}

describe('the static section', () => {
  it('counts states and cohorts across every page', async () => {
    const rows = [
      planRow({ user_id: 'a1' }),
      planRow({ user_id: 'a2' }),
      planRow({ user_id: 'a3', cohort: 'trial', onboarding_started_at: '2026-09-20T00:00:00.000Z' }),
    ];

    const report = await buildShadowReport({ config: readCodeConfig(), now, ...repositories(rows) });

    expect(report.static.accountsScanned).toBe(3);
    expect(report.static.byState).toEqual({ champion: 2, trial: 1 });
    expect(report.static.byCohort).toEqual({ champion: 2, trial: 1 });
  });

  it('lists BOTH kinds of open-ended access, each saying which it is (A-1)', async () => {
    const rows = [
      planRow({ user_id: 'a1' }), // champion, no end date
      planRow({ user_id: 'a2', cohort: null, tier: 'growth', plan_version: 1, tier_expires_at: null }),
      planRow({ user_id: 'a3', cohort: 'champion', cohort_expires_at: '2027-01-01T00:00:00.000Z' }), // has an end
    ];

    const report = await buildShadowReport({ config: fixtureConfig(), now, ...repositories(rows) });

    expect(report.static.noEndDate).toHaveLength(2);
    expect(report.static.noEndDate.find((r) => r.accountId === 'a1')).toMatchObject({ kind: 'cohort', name: 'champion' });
    expect(report.static.noEndDate.find((r) => r.accountId === 'a2')).toMatchObject({ kind: 'tier', name: 'growth' });
    // The one WITH an end date is absent — the control that stops this list
    // from being "every account".
    expect(report.static.noEndDate.some((r) => r.accountId === 'a3')).toBe(false);
  });

  it('flags open-ended accounts that never created a business profile (S1-T11a)', async () => {
    // These are the onboarding-only accounts the backfill made champions: they
    // opened the product once and never came back, and they are the set to trim
    // before enforcement. Counting them is what makes trimming deliberate.
    const rows = [
      planRow({ user_id: 'a1', profile_created_at: '2026-02-01T00:00:00.000Z' }),
      planRow({ user_id: 'a2', profile_created_at: null }),
      planRow({ user_id: 'a3', profile_created_at: null }),
    ];

    const report = await buildShadowReport({ config: readCodeConfig(), now, ...repositories(rows) });

    expect(report.static.noEndDate).toHaveLength(3);
    expect(report.static.noEndDateAccountsWithoutProfile).toBe(2);
    expect(report.static.noEndDate.filter((r) => !r.hasBusinessProfile).map((r) => r.accountId)).toEqual(['a2', 'a3']);
  });

  it('reports anomalies and tenants with no plan row', async () => {
    const rows = [planRow({ user_id: 'a1', cohort: null, tier: null })];
    const report = await buildShadowReport({
      config: readCodeConfig(),
      now,
      ...repositories(rows, [], ['ghost-1', 'ghost-2']),
    });

    expect(report.static.anomalies).toEqual([{ accountId: 'a1', anomaly: 'no_assignment' }]);
    expect(report.static.tenantsWithoutPlanRow).toMatchObject({ count: 2, sample: ['ghost-1', 'ghost-2'] });
  });

  it('pages rather than reading everything at once (RC-12)', async () => {
    const rows = Array.from({ length: 1200 }, (_, i) => planRow({ user_id: `a${String(i).padStart(5, '0')}` }));
    let pages = 0;

    const report = await buildShadowReport({
      config: readCodeConfig(),
      now,
      planRepository: {
        async pagePlans(options: { afterUserId?: string | null; limit?: number } = {}) {
          pages += 1;
          const after = options.afterUserId;
          const page = rows.filter((row) => !after || row.user_id > after).slice(0, options.limit ?? 500);
          return { data: page, error: null };
        },
        async findTenantsMissingPlanRow() {
          return { data: { checked: 0, missing: [], truncated: false }, error: null };
        },
        async findRecentOnboardedPlans() {
          return { data: [], error: null };
        },
      },
      shadowRepository: { async findWindow() { return { data: [], error: null }; } },
    });

    expect(report.static.accountsScanned).toBe(1200);
    expect(pages).toBe(3); // 500 + 500 + 200
  });

  it('a failed page degrades to a partial section rather than throwing', async () => {
    const report = await buildShadowReport({
      config: readCodeConfig(),
      now,
      planRepository: {
        async pagePlans() {
          return { data: null, error: new Error('timeout') };
        },
        async findTenantsMissingPlanRow() {
          return { data: null, error: new Error('timeout') };
        },
        async findRecentOnboardedPlans() {
          return { data: null, error: new Error('timeout') };
        },
      },
      shadowRepository: { async findWindow() { return { data: [], error: null }; } },
    });

    expect(report.static.truncated).toBe(true);
    expect(report.static.accountsScanned).toBe(0);
    expect(report.static.tenantsWithoutPlanRow.scope).toContain('unavailable');
  });
});

describe('the observed section', () => {
  it('aggregates by capability, surface, outcome and rule, counting distinct accounts', async () => {
    const events = [
      event({ user_id: 'a1', hits: 3 }),
      event({ user_id: 'a2', hits: 2 }),
      event({ user_id: 'a1', capability: 'chat.bulk', surface: 'owner_write', rule: 'both', hits: 1, items_total: 40, items_max: 40 }),
    ];

    const report = await buildShadowReport({
      config: readCodeConfig(),
      now,
      from: '2026-09-01',
      to: '2026-09-30',
      ...repositories([planRow()], events),
    });

    const search = report.observed?.rows.find((r) => r.capability === 'chat.search');
    expect(search).toMatchObject({ accounts: 2, hits: 5 });

    const bulk = report.observed?.rows.find((r) => r.capability === 'chat.bulk');
    expect(bulk).toMatchObject({ accounts: 1, hits: 1, plannedItemsTotal: 40, plannedItemsMax: 40 });
  });

  it('is omitted entirely without a window', async () => {
    const report = await buildShadowReport({ config: readCodeConfig(), now, ...repositories([planRow()]) });
    expect(report.observed).toBeUndefined();
  });
});

describe('asTier — "what would tier X cost this account?" (AC-7)', () => {
  const events = [
    // Two accounts using `chat.search`, which only Pro includes in the fixture.
    event({ user_id: 'a1', capability: 'chat.search', hits: 10 }),
    event({ user_id: 'a2', capability: 'chat.search', hits: 4 }),
    // One using `chat.marketing`, which Growth includes.
    event({ user_id: 'a1', capability: 'chat.marketing', surface: 'owner_write', rule: 'both', hits: 7 }),
    // One using `crm.core`, which every tier includes.
    event({ user_id: 'a3', capability: 'crm.core', surface: 'owner_read', rule: 'both', hits: 99 }),
  ];

  it('names what would be refused, who, and how often — not just what the matrix says', async () => {
    const report = await buildShadowReport({
      config: fixtureConfig(),
      now,
      from: '2026-09-01',
      to: '2026-09-30',
      asTier: 'growth',
      ...repositories([planRow()], events),
    });

    expect(report.asTier?.tier).toBe('growth');
    const search = report.asTier?.wouldLose.find((l) => l.capability === 'chat.search');
    expect(search).toMatchObject({ accounts: 2, hits: 14, tierValue: false });

    // Growth HAS chat.marketing and crm.core, so neither is a loss.
    expect(report.asTier?.wouldLose.map((l) => l.capability)).toEqual(['chat.search']);
    expect(report.asTier?.accountsAffectedCount).toBe(2);
    expect(report.asTier?.keptCapabilitySurfaceCount).toBeGreaterThan(0);
  });

  it('discriminates between tiers — the same usage costs less on Pro', async () => {
    // The control that matters: if the replay returned the same answer for
    // every tier, every assertion above would pass for the wrong reason.
    const options = { config: fixtureConfig(), now, from: '2026-09-01', to: '2026-09-30', ...repositories([planRow()], events) };

    const basic = await buildShadowReport({ ...options, asTier: 'basic' });
    const growth = await buildShadowReport({ ...options, asTier: 'growth' });
    const pro = await buildShadowReport({ ...options, asTier: 'pro' });

    expect(basic.asTier?.wouldLose.map((l) => l.capability).sort()).toEqual(['chat.marketing', 'chat.search']);
    expect(growth.asTier?.wouldLose.map((l) => l.capability)).toEqual(['chat.search']);
    expect(pro.asTier?.wouldLose).toEqual([]);
  });

  it('ignores observations that were already refused', async () => {
    // An account that was refused for another reason says nothing about the
    // tier, and counting it would inflate the cost of every plan.
    const report = await buildShadowReport({
      config: fixtureConfig(),
      now,
      from: '2026-09-01',
      to: '2026-09-30',
      asTier: 'basic',
      ...repositories([planRow()], [event({ capability: 'chat.search', outcome: 'not_entitled', hits: 500 })]),
    });

    expect(report.asTier?.wouldLose).toEqual([]);
  });

  /**
   * SA R4-1. Every look-up is recorded TWICE — once per reading of Q-B1 — and
   * the tests above use only `rule: 'both'` events, so they never exercised the
   * dual recording this component introduced. Replaying both readings at once
   * describes a world that cannot exist: one look-up becomes two losses, and an
   * account is counted as affected if it would lose under EITHER reading.
   */
  describe('the replay assumes ONE reading of the chat read rule (R4-1)', () => {
    // The SAME contacts look-up, by the same account, as the recorder writes it:
    // `crm.core` under domain_group, `chat.search` under the other reading.
    const dualRecorded = [
      event({ user_id: 'a1', capability: 'crm.core', surface: 'owner_read', rule: 'domain_group', hits: 6 }),
      event({ user_id: 'a1', capability: 'chat.search', surface: 'owner_read', rule: 'read_only_plans_need_search', hits: 6 }),
    ];

    const options = {
      config: fixtureConfig(),
      now,
      from: '2026-09-01',
      to: '2026-09-30',
      ...repositories([planRow()], dualRecorded),
    };

    it('under `domain_group`, a Basic account loses nothing: every tier has crm.core', async () => {
      const report = await buildShadowReport({ ...options, asTier: 'basic', asTierReadRule: 'domain_group' });

      expect(report.asTier?.reading).toBe('domain_group');
      expect(report.asTier?.wouldLose).toEqual([]);
      expect(report.asTier?.accountsAffectedCount).toBe(0);
    });

    it('under the other reading, the same account loses chat.search', async () => {
      const report = await buildShadowReport({
        ...options,
        asTier: 'basic',
        asTierReadRule: 'read_only_plans_need_search',
      });

      expect(report.asTier?.reading).toBe('read_only_plans_need_search');
      expect(report.asTier?.wouldLose.map((l) => l.capability)).toEqual(['chat.search']);
      expect(report.asTier?.accountsAffectedCount).toBe(1);
    });

    it('never counts ONE look-up as TWO losses — the bug, stated as a test', async () => {
      // A `proposals` look-up is `chat.quotes` under domain_group and
      // `chat.search` under the other reading, and **Basic has neither**. So
      // without the filter this one question by one account produced TWO
      // losses — which is what would have made Basic look twice as expensive as
      // it is. With it, exactly one, whichever reading is assumed.
      const oneLookupBothWays = [
        event({ user_id: 'a1', capability: 'chat.quotes', surface: 'owner_read', rule: 'domain_group', hits: 5 }),
        event({ user_id: 'a1', capability: 'chat.search', surface: 'owner_read', rule: 'read_only_plans_need_search', hits: 5 }),
      ];
      const base = { ...options, ...repositories([planRow()], oneLookupBothWays), asTier: 'basic' };

      const byDomain = await buildShadowReport({ ...base, asTierReadRule: 'domain_group' });
      expect(byDomain.asTier?.wouldLose.map((l) => l.capability)).toEqual(['chat.quotes']);
      expect(byDomain.asTier?.accountsAffectedCount).toBe(1);

      const bySearch = await buildShadowReport({ ...base, asTierReadRule: 'read_only_plans_need_search' });
      expect(bySearch.asTier?.wouldLose.map((l) => l.capability)).toEqual(['chat.search']);
      expect(bySearch.asTier?.accountsAffectedCount).toBe(1);
    });

    it('defaults to the configured reading, and gives that reading\'s answer', async () => {
      const config = fixtureConfig();
      const report = await buildShadowReport({ ...options, config, asTier: 'basic' });

      expect(report.asTier?.reading).toBe(config.chatActionMap.readRule);
      // `domain_group` is configured, so the contacts look-up is `crm.core`,
      // which Basic has — asserting the reading alone would not have noticed a
      // replay that ignored it.
      expect(report.asTier?.wouldLose).toEqual([]);
    });

    it('still counts `both` events under either reading', async () => {
      // A mutate maps identically under both readings and is tagged `both`; it
      // must not vanish because a reading was selected.
      const withBoth = {
        ...options,
        ...repositories([planRow()], [
          ...dualRecorded,
          event({ user_id: 'a2', capability: 'chat.quotes', surface: 'owner_write', rule: 'both', hits: 3 }),
        ]),
      };

      for (const reading of ['domain_group', 'read_only_plans_need_search'] as const) {
        const report = await buildShadowReport({ ...withBoth, asTier: 'basic', asTierReadRule: reading });
        expect(report.asTier?.wouldLose.map((l) => l.capability)).toContain('chat.quotes');
      }
    });
  });

  it('refuses to replay when there are no tiers, and says which error it is', async () => {
    // Production today. The report is still useful; the replay simply has
    // nothing to replay against.
    const report = await buildShadowReport({
      config: readCodeConfig(),
      now,
      from: '2026-09-01',
      to: '2026-09-30',
      asTier: 'growth',
      ...repositories([planRow()], events),
    });

    expect(report.asTier).toBeUndefined();
    expect(report.asTierError).toBe('no_tiers_configured');
    expect(report.observed?.rows.length).toBeGreaterThan(0); // …and the rest still works
  });

  it('rejects a tier name the config does not have', async () => {
    const report = await buildShadowReport({
      config: fixtureConfig(),
      now,
      from: '2026-09-01',
      to: '2026-09-30',
      asTier: 'platinum',
      ...repositories([planRow()], events),
    });

    expect(report.asTierError).toBe('unknown_tier');
  });
});

describe('setup AI cost (S1-T15 / B-12)', () => {
  it('counts distinct action GROUPS in the setup areas, not calls', async () => {
    const rows = [planRow({ user_id: 'a1', onboarding_started_at: '2026-09-01T00:00:00.000Z' })];

    const report = await buildShadowReport({
      config: readCodeConfig(),
      now,
      includeSetupAi: true,
      ...repositories(rows),
      usageRepository: {
        async listCallsInWindow() {
          return {
            data: {
              rows: [
                // Two calls, ONE action group.
                { id: 'c1', created_at: '', feature: 'business-os-onboarding', component: 'x', session_id: 'g1', input_tokens: 1, output_tokens: 1, cost_usd: 0, success: true, error_code: null },
                { id: 'c2', created_at: '', feature: 'business-os-onboarding', component: 'y', session_id: 'g1', input_tokens: 1, output_tokens: 1, cost_usd: 0, success: true, error_code: null },
                // A second group, in another setup area.
                { id: 'c3', created_at: '', feature: 'business-os-website', component: 'z', session_id: 'g2', input_tokens: 1, output_tokens: 1, cost_usd: 0, success: true, error_code: null },
                // Chat is NOT setup: it must not inflate the number the trial
                // allowance is sized against.
                { id: 'c4', created_at: '', feature: 'business-os-chat', component: 'q', session_id: 'g3', input_tokens: 1, output_tokens: 1, cost_usd: 0, success: true, error_code: null },
              ],
              reachedCeiling: false,
            },
            error: null,
          };
        },
      },
    });

    expect(report.setupAi).toMatchObject({ sampleSize: 1, median: 2, max: 2, days: 14, accountsAtReadCeiling: 0, accountsUnread: 0 });
    expect(report.setupAi?.areas).toContain('business-os-onboarding');
  });

  it('is omitted unless asked for — it is the slow section', async () => {
    const report = await buildShadowReport({ config: readCodeConfig(), now, ...repositories([planRow()]) });
    expect(report.setupAi).toBeUndefined();
  });

  it('samples the most recently ONBOARDED accounts, and says so (QA B-1)', async () => {
    // It used to page by uuid and take the last 200 — neither recent nor
    // random, and above 500 plan rows most accounts could never be sampled.
    const rows = [
      planRow({ user_id: 'old', onboarding_started_at: '2024-01-01T00:00:00.000Z' }),
      planRow({ user_id: 'new', onboarding_started_at: '2026-09-01T00:00:00.000Z' }),
      planRow({ user_id: 'never', onboarding_started_at: null }),
    ];
    const seen: string[] = [];

    const report = await buildShadowReport({
      config: readCodeConfig(),
      now,
      includeSetupAi: true,
      ...repositories(rows),
      usageRepository: {
        async listCallsInWindow(userId: string) {
          seen.push(userId);
          return { data: { rows: [], reachedCeiling: false }, error: null };
        },
      },
    });

    // Newest first, and the account that never started onboarding is not in it:
    // a sample of accounts that never set up would measure nothing.
    expect(seen).toEqual(['new', 'old']);
    expect(report.setupAi?.sampleBasis).toContain('most recently onboarded');
    expect(report.setupAi?.sampleOnboardedBetween).toEqual({
      earliest: '2024-01-01T00:00:00.000Z',
      latest: '2026-09-01T00:00:00.000Z',
    });
  });

  it('asks the database for the setup areas rather than filtering in JS (QA B-2)', async () => {
    // The bug: it read EVERY Business OS call newest-first under a 1,000-row
    // ceiling and filtered in JS, so a chat-heavy account's setup calls — which
    // sit at the START of the window — fell off the end and it reported 0.
    // That biases the trial allowance DOWNWARDS, the one direction B-12 exists
    // to prevent.
    let filter: { featurePrefix: string; features: readonly string[] } | null = null;

    await buildShadowReport({
      config: readCodeConfig(),
      now,
      includeSetupAi: true,
      ...repositories([planRow({ user_id: 'a1', onboarding_started_at: '2026-09-01T00:00:00.000Z' })]),
      usageRepository: {
        async listCallsInWindow(_userId: string, _window: unknown, f: { featurePrefix: string; features: readonly string[] }) {
          filter = f;
          return { data: { rows: [], reachedCeiling: false }, error: null };
        },
      },
    });

    // Every setup area is named in the query, and nothing else is asked for.
    const asked = [filter!.featurePrefix, ...filter!.features].sort();
    expect(asked).toEqual(['business-os-intake', 'business-os-onboarding', 'business-os-website']);
    expect(asked).not.toContain('business-os-');
  });

  it('says when a count is a LOWER BOUND rather than reporting it as proven (QA B-2)', async () => {
    const report = await buildShadowReport({
      config: readCodeConfig(),
      now,
      includeSetupAi: true,
      ...repositories([planRow({ user_id: 'a1', onboarding_started_at: '2026-09-01T00:00:00.000Z' })]),
      usageRepository: {
        async listCallsInWindow() {
          return {
            data: {
              rows: [{ id: 'c1', created_at: '', feature: 'business-os-onboarding', component: 'x', session_id: 'g1', input_tokens: 1, output_tokens: 1, cost_usd: 0, success: true, error_code: null }],
              // The repository's own doc says a caller must not report a
              // ceiling-capped number as proven.
              reachedCeiling: true,
            },
            error: null,
          };
        },
      },
    });

    expect(report.setupAi?.accountsAtReadCeiling).toBe(1);
    expect(report.setupAi?.note).toContain('LOWER BOUNDS');
  });

  it('counts accounts it could not read rather than silently dropping them', async () => {
    const report = await buildShadowReport({
      config: readCodeConfig(),
      now,
      includeSetupAi: true,
      ...repositories([
        planRow({ user_id: 'a1', onboarding_started_at: '2026-09-02T00:00:00.000Z' }),
        planRow({ user_id: 'a2', onboarding_started_at: '2026-09-01T00:00:00.000Z' }),
      ]),
      usageRepository: {
        async listCallsInWindow(userId: string) {
          if (userId === 'a2') return { data: null, error: new Error('timeout') };
          return { data: { rows: [], reachedCeiling: false }, error: null };
        },
      },
    });

    expect(report.setupAi).toMatchObject({ sampleSize: 1, accountsUnread: 1 });
    expect(report.setupAi?.note).toContain('could not be read');
  });
});

describe('units and qualifiers a reader would not supply themselves', () => {
  it('counts ACCOUNTS in the no-end-date list, not rows (QA B-4)', async () => {
    // One account can appear twice — an open-ended cohort AND an open-ended
    // tier — and this is the list someone acts on when trimming free access.
    const rows = [
      planRow({ user_id: 'both', tier: 'growth', plan_version: 1, tier_expires_at: null, profile_created_at: null }),
      planRow({ user_id: 'cohortOnly', profile_created_at: null }),
    ];

    const report = await buildShadowReport({ config: fixtureConfig(), now, ...repositories(rows) });

    expect(report.static.noEndDate).toHaveLength(3); // 'both' contributes two rows
    expect(report.static.noEndDateAccountCount).toBe(2);
    expect(report.static.noEndDateAccountsWithoutProfile).toBe(2);
  });

  it('carries the replay truncation flag its sibling has (QA B-3)', async () => {
    const truncatedWindow = {
      shadowRepository: {
        async findWindow() {
          // 20,000 rows is the cap `findWindow` reports truncation at.
          return { data: Array.from({ length: 20000 }, () => event({ rule: 'both' })), error: null };
        },
      },
    };

    const report = await buildShadowReport({
      config: fixtureConfig(),
      now,
      from: '2026-09-01',
      to: '2026-09-30',
      asTier: 'basic',
      ...repositories([planRow()]),
      ...truncatedWindow,
    });

    expect(report.observed?.truncated).toBe(true);
    // The replay is the number a price list gets built from; it must carry the
    // same warning rather than reading as a complete answer.
    expect(report.asTier?.windowTruncated).toBe(true);
  });

  it('states what is hooked, what absence means, and what a count is (QA D-1, SA caveat)', async () => {
    const report = await buildShadowReport({ config: readCodeConfig(), now, ...repositories([planRow()]) });

    // Chat is the only hooked surface in Slice 1, so "no rows for X" does not
    // mean "nobody uses X" — and a reader pricing a plan will not supply that
    // qualifier for themselves.
    expect(report.limitations.hookedSurfaces).toContain('Chat');
    expect(report.limitations.absentCapabilities).toContain('not used');
    // A retried POST counts twice.
    expect(report.limitations.countingUnit).toContain('REQUESTS');
  });
});

describe('RC-16 — what the report may not contain', () => {
  it('emits account ids and aggregates, and nothing else', async () => {
    const rows = [
      planRow({ user_id: 'a1', updated_by_admin_id: 'admin-7', origin: 'admin' }),
      planRow({ user_id: 'a2', cohort: 'trial', onboarding_started_at: '2026-09-20T00:00:00.000Z' }),
    ];

    const report = await buildShadowReport({
      config: fixtureConfig(),
      now,
      from: '2026-09-01',
      to: '2026-09-30',
      asTier: 'basic',
      ...repositories(rows, [event({ user_id: 'a1' })]),
    });

    const serialised = JSON.stringify(report);

    // The admin id is on the plan row the report read, and it must not travel.
    expect(serialised).not.toContain('admin-7');
    // Nor may any of these field names appear anywhere in the output.
    for (const forbidden of ['reason', 'ended_reason', 'business_name', 'email', 'updated_by_admin_id', 'actor_admin_id']) {
      expect(serialised).not.toContain(forbidden);
    }

    // Non-vacuity: the report DID contain the account it read, so the
    // assertions above are not passing over an empty document.
    expect(serialised).toContain('a1');
    expect(report.static.accountsScanned).toBe(2);
  });

  it('every no-end-date row carries only the five fields it is allowed', async () => {
    const report = await buildShadowReport({ config: readCodeConfig(), now, ...repositories([planRow()]) });

    for (const row of report.static.noEndDate) {
      expect(Object.keys(row).sort()).toEqual(['accountId', 'hasBusinessProfile', 'kind', 'name', 'origin', 'since']);
    }
  });
});
