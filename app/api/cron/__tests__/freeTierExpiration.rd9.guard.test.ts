/**
 * RD-9, settled (S-0): `check-free-tier-expiration` stays unscheduled, and
 * cannot be scheduled without first excluding Business OS payers.
 *
 * ── The trap, in one paragraph ──────────────────────────────────────────────
 * The cron freezes accounts whose `free_tier_expires_at` has passed and who
 * never bought credits. Those are agent-platform ideas. A Business OS customer
 * paying $79 a month has never bought a credit and carries whatever
 * `free_tier_expires_at` their signup wrote — so the day this cron is scheduled,
 * it freezes **paying Business OS customers**. `account_frozen` is additionally
 * read by `generate-agent`, so the freeze is not cosmetic.
 *
 * It is harmless today only because nothing schedules it (F-16). That is a
 * property of a JSON file, held in place by nothing.
 *
 * ── Why this is a test and not a note ───────────────────────────────────────
 * The plan asked for RD-9 to be recorded "where a future reader of
 * `vercel.json` will find it". `vercel.json` is JSON: it cannot carry a comment,
 * so there is nowhere in that file to write the warning. A comment in the route
 * would be read after the schedule was added, which is too late.
 *
 * So the rule is executable. Adding the path to `vercel.json` fails this suite
 * until the route excludes Business OS accounts — and the failure message says
 * what to do. A reader who never opens this file still meets the rule, because
 * CI does.
 *
 * ── What this does NOT do ───────────────────────────────────────────────────
 * It does not decide TK-3 (S-4a), which chooses between replacing
 * `free_tier_expires_at`'s semantics and keeping RD-9 for ever. Either way the
 * rule below holds: whatever the field comes to mean, this cron may not freeze a
 * Business OS payer.
 *
 * @see docs/requirements/BUSINESS_OS_TIER_BILLING_REUSE_PLAN.md RD-9, F-17, TK-3
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const CRON_PATH = '/api/cron/check-free-tier-expiration';
const ROUTE_FILE = 'app/api/cron/check-free-tier-expiration/route.ts';

const vercelConfig = JSON.parse(readFileSync(join(process.cwd(), 'vercel.json'), 'utf8')) as {
  crons?: Array<{ path: string; schedule: string }>;
};
const routeSource = readFileSync(join(process.cwd(), ROUTE_FILE), 'utf8');

/**
 * Does the route exclude Business OS accounts?
 *
 * The only honest signal is that it consults something that knows what a
 * Business OS account is. Anything else — a comment, a variable named
 * `skipBusinessOs` — is a claim rather than an exclusion.
 *
 * Two signals, and they are exhaustive because of a *different* guard. There is
 * a third way a route could reach entitlement state: importing the account-plan
 * repository from the repository barrel, which names neither string below. It is
 * deliberately not checked here, because RC-15
 * (`lib/repositories/__tests__/businessOsEntitlements.imports.guard.test.ts`)
 * forbids application code from naming those symbols at all — a cron that tried
 * it fails that suite rather than this one. So the third path cannot exist
 * silently. This comment exists because naming the symbol here tripped RC-15
 * on the first run, which is the guard working.
 */
function excludesBusinessOsPayers(source: string): boolean {
  // A MENTION is not an exclusion (QA observation). The first version of this
  // accepted `source.includes('business_os_account_plans')`, which a comment
  // reading "TODO: skip business_os_account_plans" satisfies — and a TODO is
  // the single most likely thing to be sitting in a route somebody is about to
  // schedule. So the table has to appear where it is being QUERIED, and the
  // module where it is being IMPORTED.
  const queriesThePlanTable = /\.from\(\s*['"`]business_os_account_plans['"`]\s*\)/.test(source);
  const importsTheModule = /from\s+['"`][^'"`]*business-os\/entitlements[^'"`]*['"`]/.test(source);

  return queriesThePlanTable || importsTheModule;
}

const scheduled = (vercelConfig.crons ?? []).some((cron) => cron.path === CRON_PATH);

describe('RD-9 — the free-tier expiration cron', () => {
  it('is either unscheduled, or excludes Business OS payers — never scheduled and blind', () => {
    // Written as one assertion on purpose: the two safe states are different,
    // and the failure message should name which one is missing rather than
    // reporting "expected false to be true" about a boolean nobody can read.
    const state = scheduled
      ? excludesBusinessOsPayers(routeSource)
        ? 'scheduled, and excludes Business OS accounts'
        : 'SCHEDULED WITHOUT EXCLUDING BUSINESS OS ACCOUNTS'
      : 'unscheduled';

    expect({
      cron: CRON_PATH,
      state,
      whatToDo:
        state === 'SCHEDULED WITHOUT EXCLUDING BUSINESS OS ACCOUNTS'
          ? `Remove ${CRON_PATH} from vercel.json, or make ${ROUTE_FILE} skip accounts with a Business OS plan row before it freezes anything. It freezes accounts that never bought credits — which is every paying Business OS customer.`
          : 'nothing',
    }).toEqual({ cron: CRON_PATH, state, whatToDo: 'nothing' });
  });

  it('records today: unscheduled, and still blind — so the schedule is the only thing protecting anyone', () => {
    // Both halves of the current truth, asserted so a change to either is
    // visible in a diff rather than discovered by a customer.
    expect(scheduled).toBe(false);
    expect(excludesBusinessOsPayers(routeSource)).toBe(false);
  });

  it('still reads the two fields that make it dangerous', () => {
    // If these ever disappear, the hazard is gone and this guard should be
    // revisited rather than left as folklore about a cron that no longer does
    // anything. TK-3 may be what removes them.
    expect(routeSource).toContain('free_tier_expires_at');
    expect(routeSource).toContain('account_frozen');
  });

  it('the rule rejects the dangerous state — not just today\'s safe one', () => {
    // The negative control. Without it this suite passes because the cron
    // happens to be absent, which is a fact about `vercel.json` rather than a
    // rule about it.
    const blindRoute = "const { data } = await supabase.from('credits').select('free_tier_expires_at');";
    const viaTheTable =
      blindRoute + "\nconst plans = await supabase.from('business_os_account_plans').select('user_id');";
    const viaTheModule = blindRoute + "\nimport { EntitlementService } from '@/lib/business-os/entitlements';";

    expect(excludesBusinessOsPayers(blindRoute)).toBe(false);
    // Both accepted signals, so neither half of the condition is dead code.
    expect(excludesBusinessOsPayers(viaTheTable)).toBe(true);
    expect(excludesBusinessOsPayers(viaTheModule)).toBe(true);

    // And the reason the rule is not a substring search: each of these MENTIONS
    // the right thing and excludes nobody. The first is the realistic one — a
    // TODO left in a route that is then scheduled.
    for (const decorative of [
      blindRoute + "\n// TODO: skip accounts in business_os_account_plans",
      blindRoute + "\nconst TABLE = 'business_os_account_plans';",
      blindRoute + "\n/* see lib/business-os/entitlements for the plan model */",
    ]) {
      expect(excludesBusinessOsPayers(decorative)).toBe(false);
    }
  });

  it('every other cron in vercel.json is left alone', () => {
    // Non-vacuity on the config read: a parse that returned no crons would make
    // the first assertion pass for the wrong reason.
    expect((vercelConfig.crons ?? []).length).toBeGreaterThan(3);
  });
});
