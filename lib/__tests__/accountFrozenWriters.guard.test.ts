/**
 * No code can freeze an account (plan payments P-10, TK-3 / RD-15, BQ-P8).
 *
 * `account_frozen = true` blocks agent runs (`CreditService.checkExecutionAllowed`
 * from `run-agent`) and agent creation (`generate-agent`). Its only writer was
 * the free-tier expiration job, which would have frozen every paying Business
 * OS customer (RD-9). BQ-P8 retired that job for good and P-10 made its route
 * an inert 410. What keeps RD-15 true is that NOTHING else sets the flag: the
 * readers are left as they are, and with no writer they can only read `false`
 * or `null` for an account that was not already frozen.
 *
 * This suite scans application code and migrations (tests excluded) for any
 * statement setting the flag to true. Two manual dev tools under `scripts/`
 * are known and are not application code:
 *   - `scripts/test-free-tier-expiration.sql` (the line is commented out)
 *   - `scripts/test-free-tier-ui.ts` (a manual UI test tool)
 *
 * If you need to freeze an account, that is a product decision against BQ-P8:
 * take it to the user and SA first, and exclude Business OS accounts.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const REPO_ROOT = join(__dirname, '..', '..');
const SCAN_DIRS = ['app', 'lib', 'components', 'hooks', 'supabase/migrations'];
const SKIP_DIR = /^(node_modules|\.next|\.claude|__tests__|coverage)$/;
const SKIP_FILE = /\.(test|spec)\.(ts|tsx|js)$/;
const SOURCE_FILE = /\.(ts|tsx|js|sql)$/;

/** `account_frozen: true`, `account_frozen = true`, `"account_frozen": true`, SQL `= TRUE`. Not `===`. */
const SETS_FROZEN = /account_frozen['"]?\s*[:=]\s*true\b/i;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIR.test(entry)) walk(full, out);
    } else if (SOURCE_FILE.test(entry) && !SKIP_FILE.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const rel = (f: string) => f.slice(REPO_ROOT.length + 1).replace(/\\/g, '/');

function writersIn(files: Array<{ name: string; source: string }>): string[] {
  const hits: string[] = [];
  for (const { name, source } of files) {
    source.split(/\r?\n/).forEach((line, i) => {
      if (SETS_FROZEN.test(line)) hits.push(`${name}:${i + 1}`);
    });
  }
  return hits;
}

describe('no code sets account_frozen to true (P-10, TK-3)', () => {
  const files = SCAN_DIRS.flatMap((d) => walk(join(REPO_ROOT, d))).map((f) => ({
    name: rel(f),
    source: readFileSync(f, 'utf8'),
  }));

  it('scans a real tree (non-vacuity)', () => {
    expect(files.length).toBeGreaterThan(500);
    expect(files.some((f) => f.name === 'lib/services/CreditService.ts')).toBe(true);
    // The readers are still there: this guard protects them, it does not replace them.
    expect(files.find((f) => f.name === 'lib/services/CreditService.ts')?.source).toContain('account_frozen');
  });

  it('finds no writer in app/, lib/, components/, hooks/ or supabase/migrations/', () => {
    expect(writersIn(files)).toEqual([]);
  });

  it('negative control: each shape of the write is caught, a comparison is not', () => {
    const caught = writersIn([
      { name: 'object', source: "await db.from('user_subscriptions').update({ balance: 0, account_frozen: true })" },
      { name: 'assignment', source: 'updateData.account_frozen = true' },
      { name: 'quoted', source: 'const patch = { "account_frozen": true };' },
      { name: 'sql', source: 'UPDATE public.user_subscriptions SET account_frozen = TRUE WHERE user_id = x;' },
    ]);
    expect(caught).toEqual(['object:1', 'assignment:1', 'quoted:1', 'sql:1']);

    expect(
      writersIn([
        { name: 'reader', source: 'if (subscription.account_frozen === true) return;' },
        { name: 'unfreeze', source: 'update({ account_frozen: false })' },
      ])
    ).toEqual([]);
  });
});
