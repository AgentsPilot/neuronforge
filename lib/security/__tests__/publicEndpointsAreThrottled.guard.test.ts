/**
 * Every route reachable without a session counts its callers.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PREVENTS
 *
 * Sixteen routes under `/api/book/manage`, `/api/public` and `/api/proposal`
 * answer with no session: the signed token or the id in the URL is the whole
 * authorisation. None of them had any throttle at all, and the gap was invisible
 * because nothing fails when a throttle is missing — it just never fires.
 *
 * The ones that matter most are not the reads. They are:
 *
 *   · `invites/signup/*`, which creates accounts for strangers;
 *   · `intake/upload`, which puts a stranger's file in object storage;
 *   · `cancel`, `reschedule`, `proposal` POST, which change real bookings and
 *     commit real money.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE LIST IS THE TEST
 *
 * A new public route is the thing that will go unthrottled, so this enumerates
 * the directory rather than a hand-written list: add a route under one of those
 * trees and this fails until somebody decides what its allowance is. Routes
 * deliberately left open are named in `UNGATED` with the reason, so the
 * decision is recorded rather than implied by absence.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const ROOTS = ['app/api/book/manage', 'app/api/public', 'app/api/proposal'];

/** Routes that answer without a session and are deliberately not throttled. */
const UNGATED: Record<string, string> = {
  'app/api/book/manage/[token]/calendar/route.ts':
    'Returns an .ics file for a booking the caller already holds a token for. ' +
    'No write, no secret beyond the booking itself, and calendar clients refetch it on their own schedule.',
  'app/api/public/consent-copy/route.ts':
    'Returns the business’s own published consent wording. Public by intent and identical for every caller.',
  'app/api/public/invoice/[id]/pay/route.ts':
    'A redirect with no body of its own. The page and the intent endpoint it leads to are both gated.',
};

function routeFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === 'route.ts') found.push(full);
    }
  };
  for (const root of ROOTS) walk(path.join(process.cwd(), root));
  return found.map(f => path.relative(process.cwd(), f)).sort();
}

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

describe('the unauthenticated surface', () => {
  const files = routeFiles();

  it('is found at all, so an empty sweep cannot pass as a clean one', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(routeFiles())('%s is throttled, or named as deliberately open', file => {
    if (UNGATED[file]) {
      // Recorded, with a reason. Silence would be indistinguishable from an
      // oversight.
      expect(UNGATED[file].length).toBeGreaterThan(40);
      return;
    }
    expect(read(file)).toMatch(/rateLimit\(request,/);
  });
});

describe('the writes carry a failure budget, not just a volume one', () => {
  /*
   * Counting a rejected token alongside a successful reload means the only
   * limit you can set is one loose enough for the reload. These are the routes
   * where somebody working through tokens would actually get somewhere, so
   * each counts its rejections separately and refuses once that budget is
   * spent.
   */
  it.each([
    'app/api/book/manage/[token]/route.ts',
    'app/api/book/manage/[token]/cancel/route.ts',
    'app/api/book/manage/[token]/reschedule/route.ts',
  ])('%s counts rejected credentials apart', file => {
    expect(read(file)).toMatch(/rateLimit\(request, '[a-z-]+', RATE_LIMITS\.\w+, 'failure'\)/);
  });
});

describe('the counter behind it', () => {
  it('increments atomically in the database, not in TypeScript', () => {
    /*
     * A select-then-write would let two requests arriving together both read
     * "4 of 5" — the same race the durable queue drain exists to avoid, and it
     * bites under exactly the load that makes a throttle worth having.
     */
    const repo = read('lib/repositories/RateLimitRepository.ts');
    expect(repo).toMatch(/rpc\('rate_limit_hit'/);
    expect(repo).not.toMatch(/\.select\(/);

    const migration = read('supabase/migrations/20261047_rate_limit_counters.sql');
    expect(migration).toMatch(/ON CONFLICT \(key, window_start\)/);
    expect(migration).toMatch(/RETURNING c\.count INTO v_count/);
  });

  it('is unreadable by anon and authenticated', () => {
    const migration = read('supabase/migrations/20261047_rate_limit_counters.sql');
    expect(migration).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(migration).toMatch(/REVOKE ALL ON TABLE public\.rate_limit_counters/);
  });

  it('does not reach for SECURITY DEFINER', () => {
    // 20261044_secdef_lockdown is removing DEFINER where it is not required;
    // every caller here holds the service role already.
    const migration = read('supabase/migrations/20261047_rate_limit_counters.sql');
    expect(migration).toMatch(/SECURITY INVOKER/);
    expect(migration).not.toMatch(/SECURITY DEFINER/);
  });

  it('prunes closed windows rather than growing without bound', () => {
    expect(read('supabase/migrations/20261047_rate_limit_counters.sql')).toMatch(
      /FUNCTION public\.rate_limit_prune/
    );
  });
});
