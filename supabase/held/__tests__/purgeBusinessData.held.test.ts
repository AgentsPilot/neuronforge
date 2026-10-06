/**
 * Purge slice 3b (workplan §6.3, T3b-3 / T3b-7) — the INACTIVE proofs and the
 * static shape of the held `purge_business_data`.
 *
 * Slice 3 ships inactive (user decision 2026-10-05): the service-role key is
 * not rotated, so the destructive function must be neither applied nor
 * applicable by a bulk `supabase db push`. These are static file assertions —
 * no database, no network, milliseconds (no added CI time).
 *
 *   I-1  no migration DEFINES or GRANTS the function (SA C-1: not the bare
 *        string — `20260916a` mentions it in a comment)
 *   I-2  the held file exists and the held README lists it
 *   I-3  SECURITY DEFINER, pinned search_path, revokes, service_role-only
 *        grant, the xact lock (never the session lock), controls 5/6/7 before
 *        the lock and before the first DELETE, every parameter `p_`-prefixed
 *   I-4  the function body names no descriptor table (§10.9, B-2 extended to SQL)
 */

import fs from 'fs';
import path from 'path';

import { PURGE_DESCRIPTORS, STORAGE_DESCRIPTORS } from '@/lib/business-os/purge/descriptors';

const SUPABASE = path.join(__dirname, '..', '..');
const MIGRATIONS = path.join(SUPABASE, 'migrations');
const HELD_DIR = path.join(SUPABASE, 'held');
const HELD_FILE = path.join(HELD_DIR, '20260916b_purge_business_data.sql');

function walkSql(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walkSql(full);
    return e.name.toLowerCase().endsWith('.sql') ? [full] : [];
  });
}

/** SA C-1: a definition or a grant, not a mention. Optional schema and quotes. */
const DEFINES = /create\s+(?:or\s+replace\s+)?function\s+(?:"?public"?\s*\.\s*)?"?purge_business_data"?\s*\(/i;
const GRANTS = /grant\s+[^;]*?\bon\s+function\s+(?:"?public"?\s*\.\s*)?"?purge_business_data"?\b/i;

const held = fs.readFileSync(HELD_FILE, 'utf-8').replace(/\r\n/g, '\n');

/** The function body: between `AS $$` and the closing `$$;`. */
const body = (() => {
  const start = held.indexOf('AS $$');
  const end = held.indexOf('$$;', start + 5);
  return start >= 0 && end > start ? held.slice(start + 5, end) : '';
})();

/** The body with SQL line comments removed — for statement-position assertions. */
const code = body.replace(/--.*$/gm, '');

describe('I-1 — the destructive function is not in the apply path', () => {
  const files = walkSql(MIGRATIONS);

  it('scanned the migrations directory (non-vacuity)', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('the matchers are not vacuous: they match the held file, and only a real definition / grant', () => {
    expect(DEFINES.test(held)).toBe(true);
    expect(GRANTS.test(held)).toBe(true);
    // A comment that merely mentions the name is not a definition (C-1).
    expect(DEFINES.test('-- see supabase/held/20260916b_purge_business_data.sql')).toBe(false);
    expect(GRANTS.test('-- purge_business_data is held')).toBe(false);
    expect(DEFINES.test('CREATE FUNCTION public.purge_business_data (p uuid)')).toBe(true);
    expect(GRANTS.test('GRANT ALL ON FUNCTION "public"."purge_business_data" TO anon;')).toBe(true);
  });

  it('no file under supabase/migrations defines or grants purge_business_data', () => {
    const offenders = files.filter((f) => {
      const src = fs.readFileSync(f, 'utf-8');
      return DEFINES.test(src) || GRANTS.test(src);
    });
    expect(offenders.map((f) => path.relative(SUPABASE, f))).toEqual([]);
  });
});

describe('I-2 — the hold is written down', () => {
  it('the held file exists in supabase/held/', () => {
    expect(fs.existsSync(HELD_FILE)).toBe(true);
  });

  it('the README lists it under "Currently held"', () => {
    const readme = fs.readFileSync(path.join(HELD_DIR, 'README.md'), 'utf-8').replace(/\r\n/g, '\n');
    const start = readme.indexOf('## Currently held');
    expect(start).toBeGreaterThan(-1);
    const next = readme.indexOf('\n## ', start + 1);
    const section = readme.slice(start, next === -1 ? undefined : next);
    expect(section).toContain('20260916b_purge_business_data.sql');
  });
});

describe('I-3 — the held function shape', () => {
  it('found the function body (non-vacuity)', () => {
    expect(body.length).toBeGreaterThan(1000);
    expect(code).toMatch(/DELETE FROM/);
  });

  it('is SECURITY DEFINER with a pinned search_path', () => {
    const header = held.slice(held.search(DEFINES), held.indexOf('AS $$'));
    expect(header).toMatch(/SECURITY DEFINER/);
    expect(header).toMatch(/SET search_path\s*=\s*pg_catalog,\s*public/);
  });

  it('every parameter is p_-prefixed (§1.2: no WHERE user_id = user_id)', () => {
    const match = /purge_business_data\s*\(([\s\S]*?)\)\s*RETURNS/i.exec(held);
    expect(match).not.toBeNull();
    const params = match![1]
      .split(',')
      .map((p) => p.trim().split(/\s+/)[0])
      .filter(Boolean);
    expect(params).toEqual(['p_user_id', 'p_level', 'p_options', 'p_tables']);
  });

  it('revokes from PUBLIC, anon and authenticated, and grants only to service_role', () => {
    const sig = 'purge_business_data\\(uuid, text, jsonb, jsonb\\)';
    for (const role of ['PUBLIC', 'anon', 'authenticated']) {
      expect(held).toMatch(new RegExp(`REVOKE ALL ON FUNCTION ${sig} FROM ${role};`));
    }
    const grants = [...held.matchAll(/^\s*GRANT\s+[^;]*;/gim)].map((m) => m[0].trim());
    expect(grants).toEqual(['GRANT EXECUTE ON FUNCTION purge_business_data(uuid, text, jsonb, jsonb) TO service_role;']);
    // Every REVOKE precedes the GRANT, so re-running cannot widen access.
    expect(held.lastIndexOf('REVOKE ALL')).toBeLessThan(held.indexOf(grants[0]));
  });

  it('takes the transaction-scoped lock, never the session-scoped one (FR-28)', () => {
    expect(code).toMatch(/pg_try_advisory_xact_lock\(/);
    expect(code).not.toMatch(/pg_try_advisory_lock\(/);
    expect(held).not.toMatch(/pg_advisory_unlock/);
  });

  describe('slice 3 controls 5, 6 and 7', () => {
    const lockAt = code.indexOf('pg_try_advisory_xact_lock(');
    const firstDeleteAt = code.indexOf('DELETE FROM');
    const preconditionsEnd = code.indexOf('p_tables must be a non-empty ordered array');

    const control5 = code.search(/pc\.confdeltype IN \('r', 'a'\)/);
    const cascadeSelects = [...code.matchAll(/pc\.confdeltype = 'c'/g)].map((m) => m.index ?? -1);
    const control7Row = code.indexOf('c.user_id IS DISTINCT FROM $1');

    it('each control is present', () => {
      expect(control5).toBeGreaterThan(-1);
      // Control 6 and control 7 each select CASCADE keys.
      expect(cascadeSelects.length).toBe(2);
      expect(control7Row).toBeGreaterThan(-1);
      // Control 6 checks closure with NOT EXISTS-style membership, never NOT IN
      // (a NULL in the list would make NOT IN pass every child).
      expect(code).not.toMatch(/NOT\s+IN\s*\(\s*SELECT/i);
      // Control 7 skips keys that map user_id to user_id, and refuses a parent
      // without user_id rather than guessing.
      expect(code).toMatch(/ca\.attname = 'user_id' AND pa\.attname = 'user_id'/);
      expect(code).toMatch(/control 7 — % cascades into % \(%\), but % has no user_id column/);
    });

    it('all three run AFTER the probe preconditions (the probe contract is unchanged)', () => {
      expect(preconditionsEnd).toBeGreaterThan(-1);
      for (const at of [control5, ...cascadeSelects, control7Row]) {
        expect(at).toBeGreaterThan(preconditionsEnd);
      }
      // The null-id rejection is still the first statement (the probe matches it).
      expect(code.indexOf("p_user_id is required")).toBeLessThan(preconditionsEnd);
    });

    it('all three run BEFORE the advisory lock and before the first DELETE', () => {
      expect(lockAt).toBeGreaterThan(-1);
      for (const at of [control5, ...cascadeSelects, control7Row]) {
        expect(at).toBeLessThan(lockAt);
        expect(at).toBeLessThan(firstDeleteAt);
      }
    });

    it('control 7 is widened (SA G-2): SET NULL / SET DEFAULT edges, and no self-reference exclusion', () => {
      const start = code.indexOf('FOR v_edge IN');
      const end = code.indexOf('LOOP', start);
      expect(start).toBeGreaterThan(-1);
      const selection = code.slice(start, end);
      expect(selection).toMatch(/pc\.confdeltype IN \('n', 'd'\)/);
      expect(selection).toMatch(/pc\.confdeltype = 'c'/);
      // Self-referencing keys are checked by control 7 (kept out of 5 and 6 only).
      expect(selection).not.toMatch(/conrelid <> pc\.confrelid/);
      expect(start + selection.indexOf("confdeltype IN ('n', 'd')")).toBeLessThan(lockAt);
    });

    it('control 7 binds the tenant id as a parameter and quotes identifiers with %I', () => {
      const exec = /EXECUTE format\(\s*'SELECT EXISTS[\s\S]*?\)\s*INTO v_found USING p_user_id;/.exec(code);
      expect(exec).not.toBeNull();
      expect(exec![0]).toMatch(/public\.%I c JOIN public\.%I p ON %s/);
      expect(exec![0]).not.toMatch(/\|\|/); // no string concatenation into the statement
    });
  });
});

describe('I-4 — the function body names no descriptor table (§10.9)', () => {
  const names = [
    ...PURGE_DESCRIPTORS.map((d) => d.table),
    ...STORAGE_DESCRIPTORS.map((s) => s.bucket),
  ];

  it('has names to look for (non-vacuity)', () => {
    expect(names.length).toBeGreaterThan(50);
  });

  it('no descriptor table or bucket appears anywhere in the body, comments included', () => {
    const offenders = names.filter((n) => new RegExp(`(^|[^a-z0-9_-])${n}($|[^a-z0-9_-])`, 'i').test(body));
    expect(offenders).toEqual([]);
  });

  it('the check can fail (negative case)', () => {
    const planted = `${body}\n  -- DELETE FROM ${PURGE_DESCRIPTORS[0].table}`;
    const hit = new RegExp(`(^|[^a-z0-9_-])${PURGE_DESCRIPTORS[0].table}($|[^a-z0-9_-])`, 'i').test(planted);
    expect(hit).toBe(true);
  });
});
