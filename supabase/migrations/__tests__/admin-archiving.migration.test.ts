/**
 * Guard over the Admin Archiving migration M1 (Slice 2a): M-1 to M-8, M-10, M-11.
 *
 * WHY A TEST OVER SQL TEXT. Jest cannot run PL/pgSQL, and there is no branch
 * database. The behaviour is proven by the dry run in the migration header,
 * which the user runs on PROD inside a block that always rolls back. These are
 * the properties that can be checked from the file alone, and whose loss would
 * be silent: a data-modifying CTE that deletes nothing, a dropped EXISTS guard
 * that deletes rows it never copied, a REVOKE lost in a rebase.
 *
 * Every assertion runs on the SQL with comments removed, because the header
 * holds the runbook queries and prose that would otherwise satisfy (or break)
 * a rule.
 *
 * @see docs/workplans/ADMIN_ARCHIVING_SLICE_2_RUNS_WORKPLAN.md §8.1
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { ARCHIVE_RUN_STATUSES, RETENTION_DAYS_OPTIONS } from '@/lib/archiving/config';

const FILE = join(process.cwd(), 'supabase', 'migrations', '20261010_admin_archiving_runs.sql');
const raw = readFileSync(FILE, 'utf8');

/** SQL without `/* … *\/` blocks or `--` comments. */
function stripComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      const i = line.indexOf('--');
      return i === -1 ? line : line.slice(0, i);
    })
    .join('\n');
}

const sql = stripComments(raw);
const flat = sql.replace(/\s+/g, ' ');

/** The move function's body, between `AS $$` and `$$;`. */
const body = (() => {
  const start = sql.indexOf('AS $$');
  const end = sql.indexOf('$$;', start + 5);
  return sql.slice(start + 5, end);
})();
const flatBody = body.replace(/\s+/g, ' ');

/** One CREATE TABLE statement, up to its first `);`. */
function createTable(name: string): string {
  const start = sql.indexOf(`CREATE TABLE public.${name} (`);
  expect(start).toBeGreaterThanOrEqual(0);
  return sql.slice(start, sql.indexOf(');', start) + 2);
}

describe('M-1 — INVOKER, empty search_path, PL/pgSQL', () => {
  it('declares the function as plpgsql SECURITY INVOKER with an empty search_path', () => {
    const header = flat.slice(flat.indexOf('CREATE OR REPLACE FUNCTION public.archive_audit_trail_batch'));
    const signature = header.slice(0, header.indexOf('AS $$'));
    expect(signature).toContain('LANGUAGE plpgsql');
    expect(signature).toContain('SECURITY INVOKER');
    expect(signature).toContain("SET search_path = ''");
    expect(signature).toContain("SET lock_timeout = '5s'");
  });

  it('contains no SECURITY DEFINER anywhere', () => {
    expect(flat).not.toMatch(/SECURITY DEFINER/i);
  });
});

describe('M-2 — select, copy and delete are three separate statements (C-3)', () => {
  it('appear in order: SELECT … FOR UPDATE, then INSERT … ON CONFLICT DO NOTHING, then DELETE … AND EXISTS', () => {
    const select = flatBody.indexOf('FOR UPDATE');
    const insert = flatBody.indexOf('INSERT INTO public.archived_records');
    const conflict = flatBody.indexOf('ON CONFLICT (source, source_id) DO NOTHING');
    const del = flatBody.indexOf('DELETE FROM public.audit_trail');

    expect(select).toBeGreaterThan(0);
    expect(insert).toBeGreaterThan(select);
    expect(conflict).toBeGreaterThan(insert);
    expect(del).toBeGreaterThan(conflict);
  });

  it('locks the batch with a blocking FOR UPDATE, never SKIP LOCKED (Q-3)', () => {
    expect(flatBody).not.toMatch(/SKIP LOCKED|NOWAIT/i);
  });

  it('deletes only rows that now exist in the archive', () => {
    const del = flatBody.slice(flatBody.indexOf('DELETE FROM public.audit_trail'));
    const statement = del.slice(0, del.indexOf(';'));
    expect(statement).toMatch(
      /AND EXISTS \( SELECT 1 FROM public\.archived_records r WHERE r\.source = 'audit_trail' AND r\.source_id = a\.id::text \)/
    );
  });

  it('uses no data-modifying CTE (one snapshot would hide the copied rows from the delete)', () => {
    // The body needs no CTE at all, so any `WITH name AS (` is a regression
    // worth a look. (The shape, not the word: an error message says "with".)
    expect(flatBody).not.toMatch(/\bWITH\s+(RECURSIVE\s+)?\w+\s*(\([^)]*\)\s*)?AS\s*(NOT\s+)?(MATERIALIZED\s+)?\(/i);
  });
});

describe('M-3 — the final UPDATE is the only run-state guard, and the invariant raises', () => {
  const update = flatBody.slice(flatBody.indexOf('UPDATE public.archive_runs'));

  it('guards on run, source, running status and exactly this cutoff, then raises when nothing matched', () => {
    const where = update.slice(update.indexOf('WHERE'), update.indexOf(';'));
    expect(where).toContain('r.id = p_run_id');
    expect(where).toContain("r.source = 'audit_trail'");
    expect(where).toContain("r.status = 'running'");
    expect(where).toContain('r.cutoff = p_cutoff');
    expect(update).toMatch(/;\s*IF NOT FOUND THEN RAISE EXCEPTION/);
  });

  it('comes after the delete', () => {
    expect(flatBody.indexOf('UPDATE public.archive_runs')).toBeGreaterThan(
      flatBody.indexOf('DELETE FROM public.audit_trail')
    );
  });

  it('raises when deleted differs from selected', () => {
    expect(flatBody).toMatch(/IF v_deleted <> v_selected THEN RAISE EXCEPTION/);
  });
});

describe('M-4 — EXECUTE is for service_role only', () => {
  it('revokes everything from every API role, then grants EXECUTE to service_role alone', () => {
    expect(flat).toContain(
      'REVOKE ALL ON FUNCTION public.archive_audit_trail_batch(uuid, timestamptz, integer) FROM PUBLIC, anon, authenticated, service_role;'
    );
    expect(flat).toContain(
      'GRANT EXECUTE ON FUNCTION public.archive_audit_trail_batch(uuid, timestamptz, integer) TO service_role;'
    );
  });

  it('grants the function to nobody else', () => {
    const grants = flat.match(/GRANT [A-Z, ]+ ON FUNCTION [^;]+;/g) ?? [];
    expect(grants).toHaveLength(1);
  });
});

describe('M-5 — RLS on, no policy, every API role revoked, service_role granted back exactly (SA CR-1)', () => {
  it('enables RLS on both tables and creates no policy', () => {
    expect(flat).toContain('ALTER TABLE public.archive_runs ENABLE ROW LEVEL SECURITY;');
    expect(flat).toContain('ALTER TABLE public.archived_records ENABLE ROW LEVEL SECURITY;');
    expect(flat).not.toMatch(/CREATE POLICY/i);
  });

  it('revokes with REVOKE ALL from every API role, service_role included', () => {
    expect(flat).toContain(
      'REVOKE ALL ON TABLE public.archive_runs, public.archived_records FROM PUBLIC, anon, authenticated, service_role;'
    );
  });

  it('never revokes by enumeration: a list leaves whatever it forgot (REFERENCES, TRIGGER, MAINTAIN)', () => {
    const revokes = flat.match(/REVOKE [^;]+;/g) ?? [];
    expect(revokes.length).toBeGreaterThan(0);
    for (const statement of revokes) {
      expect(statement).toMatch(/^REVOKE ALL ON /);
    }
  });

  it('grants service_role back exactly what the module uses, and nothing else', () => {
    const tableGrants = flat.match(/GRANT [^;]+ ON TABLE [^;]+;/g) ?? [];
    expect(tableGrants.sort()).toEqual(
      [
        'GRANT SELECT, INSERT, DELETE ON TABLE public.archived_records TO service_role;',
        'GRANT SELECT, INSERT, UPDATE ON TABLE public.archive_runs TO service_role;',
      ].sort()
    );
  });
});

describe('M-6 / M-7 — the CHECKs match the TypeScript constants', () => {
  it('retention_days allows exactly RETENTION_DAYS_OPTIONS', () => {
    const match = /CHECK \(retention_days IN \(([^)]*)\)\)/.exec(flat);
    expect(match).not.toBeNull();
    const values = (match?.[1] ?? '').split(',').map((v) => Number(v.trim()));
    expect(values).toEqual([...RETENTION_DAYS_OPTIONS]);
  });

  it('status allows exactly ARCHIVE_RUN_STATUSES', () => {
    const match = /CHECK \(status IN \(([^)]*)\)\)/.exec(flat);
    expect(match).not.toBeNull();
    const values = (match?.[1] ?? '').split(',').map((v) => v.trim().replace(/'/g, ''));
    expect(values).toEqual([...ARCHIVE_RUN_STATUSES]);
  });
});

describe('M-8 — one running run per source', () => {
  it('has the partial unique index', () => {
    expect(flat).toContain(
      "CREATE UNIQUE INDEX archive_runs_one_running_per_source ON public.archive_runs (source) WHERE status = 'running';"
    );
  });
});

describe('M-10 — archived_records keys (amended by SA R-1)', () => {
  it('is unique on (source, source_id)', () => {
    expect(createTable('archived_records').replace(/\s+/g, ' ')).toContain('UNIQUE (source, source_id)');
  });

  it('has NO foreign key to auth.users, so erasure by user_id still finds rows after account deletion', () => {
    expect(flat).not.toMatch(/REFERENCES auth\.users/i);
    expect(createTable('archived_records')).toMatch(/user_id\s+uuid\s+NULL,/);
  });
});

describe('M-11 — the ownership scan stays honest', () => {
  it('the archive_runs CREATE TABLE never mentions user_id, even in a comment', () => {
    // businessOwnedTables.test.ts reads each CREATE TABLE up to its first `);`
    // in the RAW file and flags any `user_id`. archive_runs has none.
    const start = raw.indexOf('CREATE TABLE public.archive_runs (');
    const statement = raw.slice(start, raw.indexOf(');', start) + 2);
    expect(statement).not.toMatch(/\buser_id\b/);
  });
});
