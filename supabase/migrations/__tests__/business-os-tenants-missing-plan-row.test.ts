/**
 * The exhaustive missing-plan-row scan (S-0), checked the two ways it can be
 * checked without a database — and honest about the third.
 *
 * ── Why this matters more than a normal repository change ───────────────────
 * Under enforcement, a tenant with no plan row resolves to the `no_plan_row`
 * anomaly, which DENIES owner-paid capabilities. The old scan read
 * `business_profiles` only, because an anti-join across that and
 * `onboarding_conversations` cannot be expressed through PostgREST — so an
 * onboarding-only tenant with no plan row was invisible. SA made closing it
 * binding **before** switch-on, because at that point our invisible bookkeeping
 * failure becomes a real customer refused something they paid for.
 *
 * ── What CAN be checked here ────────────────────────────────────────────────
 *   1. **The SQL says what it must say** — both tables in the union, the
 *      anti-join against the plan table, INVOKER, `search_path` pinned, revoked
 *      from client roles, granted to `service_role`, and no write of any kind.
 *   2. **The gap itself, modelled** — the set semantics the SQL implements,
 *      compared against the algorithm it replaces, on the case that separates
 *      them. This tests the DEFECT, which is what nobody had written down.
 *
 * ── What cannot, and who closes it ──────────────────────────────────────────
 * Nothing here executes SQL: there is no database in CI. So the function's
 * behaviour on real data is verified by the operator, against production, with
 * the two queries in
 * `docs/BUSINESS_OS_ENTITLEMENTS_APPLY_RUNBOOK.md` step 10 — the RPC's answer
 * against the checker's row B1, which performs the same anti-join by hand. If
 * those two numbers ever differ, one of them is wrong and neither should be
 * trusted until it is known which.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations');
const FILE = '20261010_business_os_tenants_missing_plan_row.sql';
const sql = readFileSync(join(MIGRATIONS, FILE), 'utf8');
const checker = readFileSync(
  join(process.cwd(), 'scripts', 'check-bos-entitlements-migration.sql'),
  'utf8'
);

describe('the SQL says what it has to say', () => {
  it('is exhaustive: BOTH tables are in the tenant set', () => {
    // The whole point. `business_profiles` alone is the old behaviour.
    expect(sql).toMatch(/FROM public\.business_profiles/);
    expect(sql).toMatch(/FROM public\.onboarding_conversations/);
    expect(sql).toMatch(/\bUNION\b/);
  });

  it('folds the union to one row per tenant before counting', () => {
    // `onboarding_conversations` holds one row per MESSAGE. Without the fold, a
    // chatty account is counted many times and `checked` becomes meaningless —
    // which is the reason this could not be done through PostgREST at all.
    expect(sql).toMatch(/GROUP BY tenants\.user_id/);
    expect(sql).toMatch(/bool_or\(tenants\.has_business_profile\)/);
  });

  it('is an anti-join against the plan table, not a join', () => {
    expect(sql).toMatch(/NOT EXISTS/);
    expect(sql).toMatch(/FROM public\.business_os_account_plans AS plans/);
    expect(sql).toMatch(/plans\.user_id = folded\.user_id/);
  });

  it('answers with exact counts and a BOUNDED sample', () => {
    // A report that printed every id would not be read; a count derived from a
    // truncated sample would be wrong. Both are answered separately.
    expect(sql).toMatch(/missing_count bigint/);
    expect(sql).toMatch(/missing_sample uuid\[\]/);
    expect(sql).toMatch(/truncated boolean/);
    expect(sql).toMatch(/LIMIT \(SELECT bounded\.cap FROM bounded\)/);
  });

  it('separates the half the old scan could not see', () => {
    expect(sql).toMatch(/missing_with_profile bigint/);
    expect(sql).toMatch(/missing_onboarding_only bigint/);
  });

  it('computes each half from the RIGHT side of the predicate', () => {
    // The fourth member of the S0-1 family (QA-1), and the one that matters
    // most for the reason section 11 gives: `missing_onboarding_only` is the
    // number nobody knows yet, and the whole argument for this migration is
    // that it is the population the old scan could not see.
    //
    // Swapped, both numbers stay plausible and their sum is unchanged, so
    // `missing_count` is unaffected and the three-way agreement in steps 3 and
    // 4 of the runbook passes. The evidence would then say the opposite of
    // what happened, and nothing downstream could tell.
    //
    // QA proved the gap by swapping them: all 22 tests stayed green.
    expect(sql).toMatch(
      /\(SELECT count\(\*\) FROM missing WHERE missing\.has_business_profile\) AS missing_with_profile/
    );
    expect(sql).toMatch(
      /\(SELECT count\(\*\) FROM missing WHERE NOT missing\.has_business_profile\) AS missing_onboarding_only/
    );
  });

  /**
   * The three arithmetic properties (QA, 2026-09-26).
   *
   * The tests above pin the SHAPE: that a count exists, that a sample is
   * bounded, that a flag is returned. None of them pinned what each value is
   * computed FROM — and all three of those are one-token edits that leave the
   * file looking entirely correct.
   *
   * This is not hypothetical. A mutation batch left exactly these three changes
   * in the file and every structural test above stayed green.
   */
  it('counts the MISSING, not the sample — or the count is capped at p_limit', () => {
    // `count(*) FROM sampled` is bounded by `LIMIT cap`, so on a database with
    // more missing tenants than the cap it would report `cap` and stop. The
    // whole point of returning a count beside a sample is that the count is not
    // the sample length.
    expect(sql).toMatch(/\(SELECT count\(\*\) FROM missing\) AS missing_count/);
    expect(sql).not.toMatch(/FROM sampled\) AS missing_count/);
  });

  it('counts tenants from the FOLDED set — accounts, not rows', () => {
    // `tenants` is the raw union, one row per onboarding message. Counting it
    // would report an account that sent 40 messages as 40 tenants, which is the
    // units mistake the fold exists to prevent — and it would make
    // `tenants_checked` disagree with the checker for a reason nobody could see.
    expect(sql).toMatch(/\(SELECT count\(\*\) FROM folded\) AS tenants_checked/);
    expect(sql).not.toMatch(/FROM tenants\) AS tenants_checked/);
  });

  it('flags truncation in the right DIRECTION', () => {
    // `truncated` means the SAMPLE was cut, so it is true when there are MORE
    // missing tenants than the cap. Reversed, it reads `true` on a healthy
    // database and `false` on the one database where the sample is genuinely
    // incomplete — the single worst way for this flag to be wrong.
    expect(sql).toMatch(
      /\(SELECT count\(\*\) FROM missing\) > \(SELECT bounded\.cap FROM bounded\) AS truncated/
    );
  });

  it('cannot count a NULL user_id as a tenant', () => {
    // Both tenant tables declare `user_id UUID ... NOT NULL` today
    // (`20260721_create_business_profiles.sql`,
    // `20260721_create_onboarding_conversations.sql`), so this is unreachable
    // as things stand — which is exactly why it is worth pinning rather than
    // arguing. A NULL would survive the UNION, fold to its own group, match no
    // plan record, and be reported as a missing tenant that does not exist.
    // The constraint lives in a different migration that a different change
    // could alter; the filter costs nothing and does not depend on it.
    const unionArms = sql.split('UNION')[0] + sql.split('UNION')[1];
    expect((unionArms.match(/user_id IS NOT NULL/g) ?? []).length).toBe(2);
  });

  it('clamps the caller-supplied limit rather than trusting it', () => {
    // `p_limit` comes from a caller. Unclamped, a report can ask for the whole
    // table; at zero or negative it would answer nothing and look healthy.
    expect(sql).toMatch(/least\(greatest\(coalesce\(p_limit, 2000\), 1\), 20000\)/);
  });

  it('is SECURITY INVOKER with a pinned search_path', () => {
    // INVOKER because the only caller holds the service-role key: definer
    // rights would buy nothing and would make the function worth reaching.
    expect(sql).toMatch(/SECURITY INVOKER/);
    expect(sql).not.toMatch(/SECURITY DEFINER/);
    expect(sql).toMatch(/SET search_path = ''/);
  });

  it('is revoked from every client role and granted only to service_role', () => {
    for (const role of ['PUBLIC', 'anon', 'authenticated']) {
      expect(sql).toMatch(
        new RegExp(`REVOKE ALL ON FUNCTION public\\.business_os_tenants_missing_plan_row\\(integer\\)\\s+FROM ${role};`)
      );
    }
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION[\s\S]*TO service_role;/);
    // REVOKE ALL, never an enumeration: the lesson from 2026-09-24, when a
    // seven-privilege list predated PostgreSQL 17's MAINTAIN and both client
    // roles kept it.
    expect(sql).not.toMatch(/REVOKE EXECUTE ON FUNCTION/);
  });

  it('writes nothing at all', () => {
    // A read wearing a migration's clothes. It is `STABLE`, it creates one
    // function, and it touches no row.
    expect(sql).toMatch(/\bSTABLE\b/);
    for (const write of [/\bINSERT\s+INTO\b/i, /\bUPDATE\s+public\./i, /\bDELETE\s+FROM\b/i, /\bDROP\b/i, /\bALTER\s+TABLE\b/i, /\bTRUNCATE\b/i]) {
      expect({ pattern: String(write), matched: write.test(sql) }).toEqual({
        pattern: String(write),
        matched: false,
      });
    }
  });

  it('is safe to re-run', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION/);
  });

  it('pastes under the rules the operator applies by hand', () => {
    // No comments, and no punctuation inside a string that a naive statement
    // splitter could read as a boundary (the 2026-09-23 paste failures).
    expect(sql).not.toMatch(/--/);
    const literals = [...sql.matchAll(/'([^']*)'/g)].map((match) => match[1]);
    for (const literal of literals) {
      expect({ literal, hasSemicolon: literal.includes(';') }).toEqual({ literal, hasSemicolon: false });
    }
  });

  it('cannot disagree with the checker script, which does the same anti-join', () => {
    // Row B1 of `check-…` counts the same thing at apply time. Two answers to
    // one question is how a report and a check end up contradicting each other
    // in front of an operator, so both must be the same shape.
    expect(checker).toMatch(/FROM public\.business_profiles/);
    expect(checker).toMatch(/FROM public\.onboarding_conversations/);
    expect(checker).toMatch(/NOT EXISTS \(SELECT 1 FROM public\.business_os_account_plans/);
  });
});

/**
 * The defect, modelled.
 *
 * Neither function is the shipped code — they are the two ALGORITHMS, written
 * in the smallest form that can tell them apart. The value is not that they
 * agree with the SQL (nothing here can prove that); it is that the difference
 * between them is stated, and is exactly the difference SA required closing.
 */
interface Fixture {
  profiles: string[];
  /** One row per message, deliberately: that is the shape of the real table. */
  onboardingMessages: string[];
  plans: string[];
  /**
   * The old scan's fetch limit (`maxAccounts`, default 2,000).
   *
   * Modelled because it is the **second** half of the defect (SA): the old code
   * read `business_profiles` with `.order('user_id').limit(maxAccounts + 1)` and
   * then sliced, so on a database with more profiles than that, tenants later in
   * the id ordering were never examined at all — the same ones, every run.
   */
  oldScanLimit?: number;
}

/**
 * What the scan did until S-0: profiles only, **and only the first N of them**.
 *
 * Both bounds matter. The union was the headline gap; the fetch limit means the
 * old number was a partial even for tenants it was looking in the right table
 * for. The new SQL's `p_limit` bounds the returned SAMPLE and never the count.
 */
function oldScan(fixture: Fixture): string[] {
  const limit = fixture.oldScanLimit ?? 2000;
  const tenants = [...new Set(fixture.profiles)].sort().slice(0, limit);
  return tenants.filter((id) => !fixture.plans.includes(id)).sort();
}

/** What the SQL does now: the union of both tables, folded, anti-joined. */
function exhaustiveScan(fixture: Fixture): string[] {
  const tenants = [...new Set([...fixture.profiles, ...fixture.onboardingMessages])];
  return tenants.filter((id) => !fixture.plans.includes(id)).sort();
}

describe('the gap the new scan closes', () => {
  it('an onboarding-only tenant with no plan row was INVISIBLE, and is not now', async () => {
    const fixture: Fixture = {
      profiles: ['has-profile'],
      // Three messages, one account — the shape that defeats a PostgREST
      // `DISTINCT` and is why this had to move into SQL.
      onboardingMessages: ['chatty', 'chatty', 'chatty'],
      plans: ['has-profile'],
    };

    expect(oldScan(fixture)).toEqual([]);
    expect(exhaustiveScan(fixture)).toEqual(['chatty']);
  });

  it('they agree when every tenant has a profile — the case that hid the defect', () => {
    // This is why the old scan looked correct for as long as it did.
    const fixture: Fixture = {
      profiles: ['a', 'b'],
      onboardingMessages: ['a', 'b'],
      plans: ['a'],
    };

    expect(oldScan(fixture)).toEqual(['b']);
    expect(exhaustiveScan(fixture)).toEqual(['b']);
  });

  it('counts an account once however many messages it sent', () => {
    const fixture: Fixture = {
      profiles: [],
      onboardingMessages: Array.from({ length: 40 }, () => 'one-account'),
      plans: [],
    };

    expect(exhaustiveScan(fixture)).toEqual(['one-account']);
  });

  it('reports nothing missing when every tenant has a row, from either table', () => {
    const fixture: Fixture = {
      profiles: ['a'],
      onboardingMessages: ['b', 'b'],
      plans: ['a', 'b'],
    };

    expect(exhaustiveScan(fixture)).toEqual([]);
  });

  it('the widening is STRICT BY CONSTRUCTION — the new result is a superset', () => {
    // SA's confirmation, made executable. The profile side of the union is
    // unchanged, so the new scan cannot MISS anyone the old one caught — it can
    // only add. That is the property that makes this a safe replacement rather
    // than a different answer, and it is stronger than the agreement test above,
    // which holds for one fixture.
    const fixtures: Fixture[] = [
      { profiles: ['a', 'b', 'c'], onboardingMessages: ['b', 'd'], plans: ['a'] },
      { profiles: [], onboardingMessages: ['x', 'y'], plans: [] },
      { profiles: ['p'], onboardingMessages: [], plans: [] },
      { profiles: ['m', 'n'], onboardingMessages: ['m', 'n'], plans: ['m', 'n'] },
      { profiles: ['z'], onboardingMessages: ['z', 'z', 'z'], plans: ['other'] },
    ];

    for (const fixture of fixtures) {
      const before = oldScan(fixture);
      const after = exhaustiveScan(fixture);

      for (const id of before) expect(after).toContain(id);
      expect(after.length).toBeGreaterThanOrEqual(before.length);
    }
  });

  it('the old count was bounded by its FETCH LIMIT too, so it under-reported', () => {
    // The part that makes this more than "it now sees onboarding-only tenants".
    // Every one of these 2,500 tenants has a business profile and no plan row,
    // so the old scan was reading the right table — and still could not report
    // more than 2,000 of them, always the same 2,000, because the ordering is
    // stable. The 500 after the cut were unreportable on every run.
    const profiles = Array.from({ length: 2500 }, (_, i) => `t${String(i).padStart(5, '0')}`);
    const fixture: Fixture = { profiles, onboardingMessages: [], plans: [] };

    expect(oldScan(fixture)).toHaveLength(2000);
    expect(exhaustiveScan(fixture)).toHaveLength(2500);

    // And the ones it dropped are deterministic, not a random sample — which is
    // why re-running it never surfaced them.
    expect(oldScan(fixture)).not.toContain('t02499');
    expect(oldScan({ ...fixture })).not.toContain('t02499');
  });
});
