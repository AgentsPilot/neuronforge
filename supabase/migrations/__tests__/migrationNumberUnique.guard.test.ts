/**
 * Duplicate migration numbers (SR-7; DL-1a workplan T-1 with SA W-9).
 *
 * Migrations are applied by hand on prod, and the reservation record is the
 * coordination file plus origin/main. Two streams that both take the next free
 * number would ship two files with one version, and nothing would notice until
 * a reviewer applied the wrong one. 20261077 to 20261081 already exist twice
 * each. From 20261093 on, this guard refuses that:
 *
 *   - the version is the whole leading token before the first `_`;
 *   - a file whose first 8 digits are 20261093 or later must have EXACTLY 8
 *     digits as its version, with no letter suffix (`20261095b_`) and no
 *     timestamp form (`20261101120000_`);
 *   - each such version appears once in supabase/migrations;
 *   - a supabase/held file may not share such a version with supabase/migrations.
 *
 * The real duplicates below 20261093 stay out of scope, and a fixture proves it.
 * One readdirSync per directory: no added CI time.
 */

import { readdirSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
/** The first version this guard governs (SR-7). */
export const FIRST_GUARDED_VERSION = 20261093;

const sqlFiles = (dir: string): string[] => {
  try {
    return readdirSync(join(ROOT, ...dir.split('/'))).filter((name) => name.endsWith('.sql'));
  } catch {
    return [];
  }
};

/** Every rule break, as readable lines. Empty means compliant. */
export function migrationNumberViolations(migrations: ReadonlyArray<string>, held: ReadonlyArray<string>): string[] {
  const out: string[] = [];
  const seen = new Map<string, string[]>();
  const guarded = (name: string): boolean => {
    const digits = /^(\d{8})/.exec(name);
    return digits !== null && Number(digits[1]) >= FIRST_GUARDED_VERSION;
  };
  const version = (name: string): string => name.split('_', 1)[0].replace(/\.sql$/, '');

  for (const name of migrations) {
    if (!guarded(name)) continue;
    const v = version(name);
    if (!/^\d{8}$/.test(v)) out.push(`${name}: the version ${v} is not exactly 8 digits`);
    seen.set(v, [...(seen.get(v) ?? []), name]);
  }
  for (const [v, names] of seen) {
    if (names.length > 1) out.push(`${v} is used by ${names.length} migrations: ${[...names].sort().join(', ')}`);
  }
  for (const name of held) {
    if (!guarded(name)) continue;
    const v = version(name);
    if (!/^\d{8}$/.test(v)) out.push(`supabase/held/${name}: the version ${v} is not exactly 8 digits`);
    if (seen.has(v)) out.push(`supabase/held/${name} shares the version ${v} with ${seen.get(v)?.join(', ')}`);
  }
  return out;
}

describe('migration numbers are unique from 20261093 on (SR-7, SA W-9)', () => {
  const migrations = sqlFiles('supabase/migrations');
  const held = sqlFiles('supabase/held');

  it('the scan found the migrations, including the guarded ones', () => {
    expect(migrations.length).toBeGreaterThan(100);
    expect(migrations).toContain('20261093_business_os_account_closures.sql');
  });

  it('no two migrations share a guarded version, each is exactly 8 digits, and no held file collides', () => {
    expect(migrationNumberViolations(migrations, held)).toEqual([]);
  });

  it('negative fixture: a planted pair at a guarded version fails', () => {
    expect(migrationNumberViolations(['20261095_a.sql', '20261095_b.sql'], [])).toEqual([
      '20261095 is used by 2 migrations: 20261095_a.sql, 20261095_b.sql',
    ]);
  });

  it('negative fixture: a letter suffix and a 14 digit timestamp fail', () => {
    expect(migrationNumberViolations(['20261095b_suffix.sql'], [])).toEqual(['20261095b_suffix.sql: the version 20261095b is not exactly 8 digits']);
    expect(migrationNumberViolations(['20261101120000_timestamp.sql'], [])).toEqual([
      '20261101120000_timestamp.sql: the version 20261101120000 is not exactly 8 digits',
    ]);
  });

  it('negative fixture: a held file sharing a guarded version with a migration fails', () => {
    expect(migrationNumberViolations(['20261096_real.sql'], ['20261096_parked.sql'])).toEqual([
      'supabase/held/20261096_parked.sql shares the version 20261096 with 20261096_real.sql',
    ]);
  });

  it('the known duplicates below 20261093 stay out of scope', () => {
    const known = migrations.filter((name) => /^2026107[7-9]_|^2026108[01]_/.test(name));
    expect(known.length).toBeGreaterThanOrEqual(10);
    expect(migrationNumberViolations(known, [])).toEqual([]);
    expect(migrationNumberViolations(['20261092_a.sql', '20261092_b.sql', '20260916b_x.sql'], [])).toEqual([]);
  });
});
