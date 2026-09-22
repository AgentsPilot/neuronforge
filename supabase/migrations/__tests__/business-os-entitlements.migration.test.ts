/**
 * Guard over the Business OS entitlements migrations (component 1).
 *
 * WHY A TEST OVER SQL TEXT. The real proof is
 * `scripts/verify-bos-entitlements-migration.sql`, which runs the behaviour
 * against a database — but it needs a database, so nothing runs it in CI. These
 * are the properties that can be checked from the files alone, and they are the
 * ones whose loss is silent: a backfill quietly moved back into the DDL
 * transaction, a `REVOKE` dropped during a rebase, a reset that starts deleting
 * override rows again.
 *
 * Each assertion names the decision it protects (SA re-check M-1 to M-5).
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations');
const DDL_FILE = '20261005_business_os_entitlements.sql';
const BACKFILL_FILE = '20261005b_business_os_entitlements_backfill.sql';

const ddl = readFileSync(join(MIGRATIONS, DDL_FILE), 'utf8');
const backfill = readFileSync(join(MIGRATIONS, BACKFILL_FILE), 'utf8');

/** SQL with `--` comments removed, so prose about a rule cannot satisfy it. */
function stripComments(sql: string): string {
  return sql
    .split('\n')
    .map((line) => {
      const i = line.indexOf('--');
      return i === -1 ? line : line.slice(0, i);
    })
    .join('\n');
}

/**
 * The same SQL with every `$$ … $$` function body removed.
 *
 * This is the distinction QA's Q-2 exposed. M-1 is about the migration's
 * TOP-LEVEL statements: `CREATE TRIGGER` holds ACCESS EXCLUSIVE locks on the
 * parent tables until COMMIT, so a scan of those tables in the same transaction
 * blocks product writes for its whole duration. A `SELECT` inside a function
 * BODY is not part of that transaction at all — it runs later, when someone
 * calls the function — and forbidding it cost the reset its fact recovery.
 *
 * So the M-1 assertions below run against this stripped text, and the function
 * bodies are checked by their own assertions further down.
 */
function stripFunctionBodies(sql: string): string {
  // A replacer FUNCTION, not a string: in a replacement string `$$` means an
  // escaped `$`, so the literal form silently produced `$<<…>>$`. Nothing
  // depended on it, but the next reader should not have to work that out.
  // Note: only `$$`-quoted bodies are stripped. A `$tag$`-quoted body would be
  // left in place, which fails safe — the guard would then be stricter, not
  // weaker.
  return sql.replace(/\$\$[\s\S]*?\$\$/g, () => '$$<<function body omitted>>$$');
}

/**
 * The migration's statements, with comments and function bodies removed.
 *
 * Splits on `;` — but only outside single-quoted strings. `COMMENT ON TABLE …
 * IS '… no cron moves accounts between states; …'` contains semicolons, and a
 * naive split tore those comments into fragments that looked like unknown
 * statements. Function bodies are already gone, so quoted strings are the only
 * remaining place a semicolon can hide.
 */
function topLevelStatements(sql: string): string[] {
  const text = stripFunctionBodies(stripComments(sql));
  const statements: string[] = [];
  let current = '';
  let inString = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (char === "'") {
      // '' inside a string is an escaped quote, not a close-then-open.
      if (inString && text[i + 1] === "'") {
        current += "''";
        i += 1;
        continue;
      }
      inString = !inString;
      current += char;
      continue;
    }

    if (char === ';' && !inString) {
      statements.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  statements.push(current.trim());
  return statements.filter(Boolean);
}

/**
 * What a schema migration is allowed to start a statement with.
 *
 * Everything else — `INSERT`, `UPDATE`, `DELETE`, `SELECT`, `DO`, `CALL` — is
 * data manipulation, and this file is not allowed to manipulate data.
 */
const SCHEMA_ONLY_STATEMENT = /^(BEGIN|COMMIT|SET|CREATE|ALTER|DROP|REVOKE|GRANT|COMMENT)\b/i;

const ddlCode = stripComments(ddl);
const backfillCode = stripComments(backfill);
/** Top-level DDL/DML only: no comments, no function bodies. */
const ddlTopLevel = stripFunctionBodies(ddlCode);

describe('M-1 — the backfill is not inside the DDL transaction', () => {
  it('the DDL migration creates both triggers, bound to the right table and event', () => {
    // CREATE TRIGGER takes ACCESS EXCLUSIVE on both parent tables until COMMIT.
    // Asserting the whole binding, not just the name: a trigger of the right
    // name on the wrong table would otherwise pass (QA Q-8).
    expect(ddlCode).toMatch(
      /CREATE TRIGGER business_os_plan_on_onboarding\s+AFTER INSERT ON public\.onboarding_conversations\s+FOR EACH ROW EXECUTE FUNCTION public\.business_os_plan_fact_onboarding\(\)/
    );
    expect(ddlCode).toMatch(
      /CREATE TRIGGER business_os_plan_on_profile\s+AFTER INSERT ON public\.business_profiles\s+FOR EACH ROW EXECUTE FUNCTION public\.business_os_plan_fact_profile\(\)/
    );
  });

  it('the DDL migration does not scan the parent tables at the top level', () => {
    // A SELECT over business_profiles / onboarding_conversations in a TOP-LEVEL
    // statement would hold the trigger's exclusive locks for the whole scan,
    // blocking every onboarding message and profile write in the product.
    // Function bodies are excluded deliberately (see stripFunctionBodies).
    expect(ddlTopLevel).not.toMatch(/FROM\s+public\.business_profiles/i);
    expect(ddlTopLevel).not.toMatch(/FROM\s+public\.onboarding_conversations/i);
  });

  it('the schema migration contains no top-level DML at all (QA Q-18)', () => {
    // The rule this file actually lives by: it changes schema and nothing else.
    //
    // This closes the hole the Q-2 narrowing opened. Stripping function bodies
    // is right for a DEFINITION, but a future edit could define a scanning
    // function AND CALL IT — `SELECT public.business_os_backfill();` — at the
    // top level, running the scan inside the transaction that holds the
    // triggers' ACCESS EXCLUSIVE locks. The body is stripped, and a call is not
    // an `INSERT … SELECT`, so neither earlier check would see it. A statement
    // whitelist sees anything.
    const offenders = topLevelStatements(ddl)
      .filter((statement) => !SCHEMA_ONLY_STATEMENT.test(statement))
      .map((statement) => statement.slice(0, 80));

    expect(offenders).toEqual([]);
  });

  it('that rule can actually fail — the two shapes it exists to catch', () => {
    // A guard nobody has seen fail is a guess. Both of these are the M-1 harm.
    const hiddenBehindACall = `
      BEGIN;
      CREATE FUNCTION public.tmp_backfill() RETURNS void LANGUAGE sql AS $$
        SELECT count(*) FROM public.onboarding_conversations;
      $$;
      SELECT public.tmp_backfill();
      COMMIT;
    `;
    const plainScan = `
      BEGIN;
      INSERT INTO public.business_os_account_plans (user_id)
      SELECT user_id FROM public.business_profiles;
      COMMIT;
    `;

    for (const sample of [hiddenBehindACall, plainScan]) {
      expect(topLevelStatements(sample).some((s) => !SCHEMA_ONLY_STATEMENT.test(s))).toBe(true);
    }
  });

  it('the guard still sees inside function bodies when it should', () => {
    // A guard that strips too much would pass vacuously. The reset's fact
    // recovery (QA Q-2) reads both parent tables from inside its body, so the
    // un-stripped text must contain what the stripped text does not.
    expect(ddlCode).toMatch(/FROM\s+public\.onboarding_conversations/i);
    expect(ddlCode).toMatch(/FROM\s+public\.business_profiles/i);
    expect(stripFunctionBodies(ddlCode)).not.toMatch(/FROM\s+public\.onboarding_conversations/i);
  });

  it('the backfill lives in its own migration, and creates no schema', () => {
    expect(backfillCode).toMatch(/INSERT INTO public\.business_os_account_plans/);
    expect(backfillCode).toMatch(/ON CONFLICT \(user_id\) DO NOTHING/);
    expect(backfillCode).not.toMatch(/CREATE\s+(TABLE|TRIGGER|FUNCTION)/i);
  });

  it('both transactions bound how long they will wait for a lock', () => {
    expect(ddlCode).toMatch(/SET LOCAL lock_timeout/);
    expect(backfillCode).toMatch(/SET LOCAL lock_timeout/);
  });

  it('the backfill produces open-ended champions, not trials', () => {
    // Existing accounts become champions with no end date (rollout decision
    // U-2/UD-4). A trial here would start a clock on every live customer.
    expect(backfillCode).toMatch(/'champion'/);
    expect(backfillCode).not.toMatch(/'trial'/);
  });

  it('the verification script\'s copy of the backfill has not drifted (QA Q-23)', () => {
    // C0 in scripts/verify-bos-entitlements-migration.sql proves the backfill
    // against a real pre-existing tenant — but it proves a HAND-KEPT COPY of the
    // statement. If the migration's SELECT changes and the copy does not, C0
    // keeps passing while proving the old statement: exactly the vacuity class
    // this review has been about. So compare them here, where drift is cheap to
    // notice.
    const verifyScript = stripComments(
      readFileSync(join(process.cwd(), 'scripts', 'verify-bos-entitlements-migration.sql'), 'utf8')
    );

    /** The INSERT … ON CONFLICT statement, whitespace-normalised. */
    const extract = (sql: string, from: number): string => {
      const start = sql.indexOf('INSERT INTO public.business_os_account_plans', from);
      const end = sql.indexOf('ON CONFLICT', start);
      return sql
        .slice(start, end)
        // The one documented difference: the migration covers every tenant, the
        // copy narrows to the probe account.
        .replace(/WHERE\s+tenants\.user_id\s*(IS NOT NULL|=\s*v_user)/i, 'WHERE <scope>')
        .replace(/\s+/g, ' ')
        .trim();
    };

    // Anchored on the C0 block's probe account rather than the string "C0",
    // which after comment-stripping survives only inside its RAISE messages —
    // and those come AFTER the statement being compared.
    const c0Anchor = verifyScript.indexOf("_bos_probe WHERE kind = 'tenant3'");

    const fromMigration = extract(backfillCode, 0);
    const fromScript = extract(verifyScript, c0Anchor);

    expect(c0Anchor).toBeGreaterThan(-1);
    expect(fromMigration).not.toHaveLength(0);
    expect(fromScript).not.toHaveLength(0);
    // If this fails: the migration's statement changed. Update C0 in the
    // verification script to match, or C0 is testing something that no longer
    // ships.
    expect(fromScript).toBe(fromMigration);
  });

  it('the backfill heals a fact the trigger could not fill, and stays inert (QA Q-5)', () => {
    // Between the two migrations the triggers are live, so a pre-existing
    // tenant can end up with a trigger-created row carrying only one fact, which
    // the insert then skips. AFTER INSERT triggers can never fill the other one.
    const heal = backfillCode.slice(backfillCode.indexOf('UPDATE public.business_os_account_plans'));

    expect(heal).toMatch(/onboarding_started_at\s*=\s*COALESCE\(/);
    expect(heal).toMatch(/profile_created_at\s*=\s*COALESCE\(/);
    // Only where the fact is missing AND recoverable — otherwise a re-run would
    // rewrite updated_at for every account with no profile yet, and the
    // migration would stop being inert on a second run.
    expect(heal).toMatch(/WHERE \(p\.onboarding_started_at IS NULL/);
    expect(heal).toMatch(/AND EXISTS \(SELECT 1 FROM public\.onboarding_conversations/);
    expect(heal).toMatch(/AND EXISTS \(SELECT 1 FROM public\.business_profiles/);
    // It heals facts only: never a cohort, tier or pin.
    expect(heal).not.toMatch(/\bcohort\s*=/);
    expect(heal).not.toMatch(/\btier\s*=/);
    expect(heal).not.toMatch(/trial_\w+\s*=/);
  });
});

describe('RC-8 — RLS on, no policies, no client privileges', () => {
  const tables = [
    'business_os_account_plans',
    'business_os_entitlement_overrides',
    'business_os_entitlement_shadow_events',
  ];

  it.each(tables)('%s enables row level security', (table) => {
    expect(ddlCode).toMatch(new RegExp(`ALTER TABLE public\\.${table}\\s+ENABLE ROW LEVEL SECURITY`));
  });

  it('defines no policy at all', () => {
    // Also satisfies the admin-authz guard's R5 (no RLS policy may reference
    // profiles.role) by construction, and keeps admin `reason` text out of
    // anything a user session could read.
    expect(ddlCode).not.toMatch(/CREATE POLICY/i);
  });

  it('revokes the client roles explicitly', () => {
    expect(ddlCode).toMatch(/REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER/);
    expect(ddlCode).toMatch(/FROM anon, authenticated;/);
  });

  it('states the service_role grant rather than inheriting it (QA Q-4)', () => {
    // Relying on ALTER DEFAULT PRIVILEGES means the access depends on which role
    // applied the DDL; if it differs, every repository call fails with
    // "permission denied" weeks later, when component 3 first reads a row.
    expect(ddlCode).toMatch(/GRANT SELECT, INSERT, UPDATE[\s\S]{0,400}TO service_role;/);
  });

  it('never references the user-writable profile role', () => {
    expect(ddlCode).not.toMatch(/profiles\.role/i);
  });
});

describe('RC-9 / A-1 / M-3 / S-4 — the plan table shape', () => {
  it('keys to auth.users, never to business_profiles', () => {
    // Cascading from business_profiles would make "start over" a way to get a
    // fresh trial.
    expect(ddlCode).toMatch(/user_id\s+uuid PRIMARY KEY REFERENCES auth\.users\(id\) ON DELETE CASCADE/);
    expect(ddlCode).not.toMatch(/REFERENCES public\.business_profiles/);
  });

  it('A-1: the tier assignment has its own end date', () => {
    expect(ddlCode).toMatch(/tier_expires_at\s+timestamptz NULL/);
    expect(ddlCode).not.toMatch(/access_ends_at/);
  });

  it('RC-9: actor columns carry no foreign key', () => {
    expect(ddlCode).toMatch(/updated_by_admin_id\s+uuid NULL,/);
    expect(ddlCode).toMatch(/actor_admin_id\s+uuid NOT NULL,/);
    expect(ddlCode).not.toMatch(/admin_id\s+uuid[^,\n]*REFERENCES/);
  });

  it('M-3: an end date cannot exist without the assignment it ends', () => {
    expect(ddlCode).toMatch(/CHECK \(tier IS NOT NULL OR tier_expires_at IS NULL\)/);
    expect(ddlCode).toMatch(/CHECK \(cohort IS NOT NULL OR cohort_expires_at IS NULL\)/);
  });

  it('S-4: a tier always carries a real matrix version', () => {
    expect(ddlCode).toMatch(/CHECK \(tier IS NULL OR plan_version > 0\)/);
  });

  it('FR-12: no tier name appears in SQL', () => {
    // Tier names live in the entitlements config alone. A CHECK listing them
    // would make a pricing change a migration.
    expect(ddlCode).not.toMatch(/'(basic|growth|pro)'/i);
  });
});

describe('S-8 — the provisioning triggers can only record a fact', () => {
  const functions = ['business_os_plan_fact_onboarding', 'business_os_plan_fact_profile'];

  it.each(functions)('%s is DEFINER, pins search_path and lock_timeout, and never raises', (fn) => {
    const body = ddlCode.slice(ddlCode.indexOf(`FUNCTION public.${fn}`));
    const definition = body.slice(0, body.indexOf('$$;') + 3);

    expect(definition).toMatch(/SECURITY DEFINER/);
    expect(definition).toMatch(/SET search_path = ''/);
    expect(definition).toMatch(/SET lock_timeout = '2s'/);
    // A failure to create a plan row must never fail a signup.
    expect(definition).toMatch(/EXCEPTION WHEN OTHERS THEN/);
    expect(definition).toMatch(/RAISE WARNING/);
    expect(definition).not.toMatch(/RAISE EXCEPTION/);
  });

  it('the fact upsert cannot touch cohort, tier or the pins', () => {
    const onboarding = ddlCode.slice(ddlCode.indexOf('FUNCTION public.business_os_plan_fact_onboarding'));
    const definition = onboarding.slice(0, onboarding.indexOf('$$;') + 3);
    const doUpdate = definition.slice(definition.indexOf('DO UPDATE'));

    // Only the fact and updated_at may be written on conflict, and only while
    // the fact is still NULL — so replaying onboarding cannot restart a trial.
    expect(doUpdate).toMatch(/SET onboarding_started_at = EXCLUDED\.onboarding_started_at/);
    expect(doUpdate).toMatch(/WHERE p\.onboarding_started_at IS NULL/);
    expect(doUpdate).not.toMatch(/\bcohort\b/);
    expect(doUpdate).not.toMatch(/\btier\b/);
    expect(doUpdate).not.toMatch(/trial_/);
  });

  it('EXECUTE is revoked from the client roles', () => {
    for (const fn of functions) {
      expect(ddlCode).toMatch(new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${fn}\\(\\)\\s+FROM public, anon, authenticated`));
    }
  });
});

describe('WC-9 — the callable functions are service-role only', () => {
  it('the shadow recorder folds duplicate keys before inserting (QA Q-1)', () => {
    const start = ddlCode.indexOf('FUNCTION public.business_os_record_shadow_events');
    const body = ddlCode.slice(start, ddlCode.indexOf('$$;', start) + 3);

    // Without the GROUP BY, a payload carrying the same key twice raises
    // SQLSTATE 21000 ("cannot affect row a second time") and the whole batch is
    // lost — silently, because shadow errors are swallowed by design.
    expect(body).toMatch(/GROUP BY r\.user_id, r\.capability, r\.surface, r\.outcome, r\.rule, 6/);
    expect(body).toMatch(/SUM\(GREATEST\(COALESCE\(r\.hits, 1\), 0\)\)/);
    expect(body).toMatch(/SUM\(GREATEST\(COALESCE\(r\.items_total, 0\), 0\)\)/);
    expect(body).toMatch(/MAX\(GREATEST\(COALESCE\(r\.items_max, 0\), 0\)\)/);
    // …and it still sums onto whatever a previous call stored.
    expect(body).toMatch(/ON CONFLICT[\s\S]*hits\s*=\s*e\.hits \+ EXCLUDED\.hits/);
  });

  it('the shadow recorder is INVOKER, revoked, and granted to service_role only', () => {
    const fn = ddlCode.slice(ddlCode.indexOf('FUNCTION public.business_os_record_shadow_events'));
    expect(fn).toMatch(/SECURITY INVOKER/);
    expect(fn).toMatch(/SET search_path = ''/);
    expect(ddlCode).toMatch(/REVOKE EXECUTE ON FUNCTION public\.business_os_record_shadow_events\(jsonb\)\s+FROM public, anon, authenticated/);
    expect(ddlCode).toMatch(/GRANT EXECUTE ON FUNCTION public\.business_os_record_shadow_events\(jsonb\)\s+TO service_role/);
  });

  it('the reset function is INVOKER, revoked, and granted to service_role only', () => {
    const fn = ddlCode.slice(ddlCode.indexOf('FUNCTION public.business_os_reset_plan_state'));
    expect(fn).toMatch(/SECURITY INVOKER/);
    expect(fn).toMatch(/SET search_path = ''/);
    expect(ddlCode).toMatch(/REVOKE EXECUTE ON FUNCTION public\.business_os_reset_plan_state\([^)]*\)\s+FROM public, anon, authenticated/);
    expect(ddlCode).toMatch(/GRANT EXECUTE ON FUNCTION public\.business_os_reset_plan_state\([^)]*\)\s+TO service_role/);
  });
});

describe('M-2 / M-4 / M-5 — the reset keeps the record', () => {
  const reset = (() => {
    const start = ddlCode.indexOf('FUNCTION public.business_os_reset_plan_state');
    const body = ddlCode.slice(start);
    return body.slice(0, body.indexOf('$$;') + 3);
  })();

  it('M-2: it ends overrides instead of deleting them', () => {
    expect(reset).toMatch(/UPDATE public\.business_os_entitlement_overrides/);
    expect(reset).toMatch(/ended_reason\s*=\s*'plan_state_reset: '/);
    // The whole point: the durable admin record survives a reset.
    expect(reset).not.toMatch(/DELETE FROM/i);
  });

  it('M-2: it rewrites the plan row in place, so there is never no row', () => {
    expect(reset).toMatch(/INSERT INTO public\.business_os_account_plans/);
    expect(reset).toMatch(/ON CONFLICT \(user_id\) DO UPDATE/);
  });

  it('Q-2: the repair branch recovers the facts from the tenant\'s own history', () => {
    // The INSERT branch runs for an account whose trigger never fired. Its facts
    // can never be filled afterwards (the triggers are AFTER INSERT only), and
    // the trial clock is derived from them — so the repair must read history.
    const insertBranch = reset.slice(reset.indexOf('INSERT INTO public.business_os_account_plans'), reset.indexOf('ON CONFLICT'));

    expect(insertBranch).toMatch(/onboarding_started_at, profile_created_at/);
    expect(insertBranch).toMatch(/SELECT min\(oc\.created_at\) FROM public\.onboarding_conversations oc WHERE oc\.user_id = p_user_id/);
    expect(insertBranch).toMatch(/SELECT bp\.created_at FROM public\.business_profiles bp WHERE bp\.user_id = p_user_id/);
  });

  it('M-2: it clears the old assignment but keeps created_at and the facts', () => {
    expect(reset).toMatch(/tier\s*=\s*NULL/);
    expect(reset).toMatch(/tier_expires_at\s*=\s*NULL/);
    expect(reset).toMatch(/trial_ends_at\s*=\s*NULL/);
    expect(reset).toMatch(/grace_ends_at\s*=\s*NULL/);
    expect(reset).not.toMatch(/created_at\s*=/);
    expect(reset).not.toMatch(/onboarding_started_at\s*=/);
    expect(reset).not.toMatch(/profile_created_at\s*=/);
  });

  it('M-4: a blank cohort is refused, not only a NULL one', () => {
    expect(reset).toMatch(/btrim\(COALESCE\(p_cohort, ''\)\)/);
    expect(reset).toMatch(/IF v_cohort = '' THEN/);
    expect(reset).toMatch(/RAISE EXCEPTION 'business_os_reset_plan_state requires an explicit cohort'/);
  });

  it('M-4: an acting admin and a reason are required', () => {
    expect(reset).toMatch(/p_admin_id IS NULL/);
    expect(reset).toMatch(/length\(v_reason\) < 3/);
  });

  it('M-5: updated_at is written explicitly', () => {
    expect(reset).toMatch(/updated_at\s*=\s*EXCLUDED\.updated_at/);
  });
});
