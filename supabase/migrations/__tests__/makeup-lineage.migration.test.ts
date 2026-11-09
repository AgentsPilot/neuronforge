/**
 * Guard over migration 20261109, a moved make-up keeps its lineage.
 *
 * `move_meeting` (20261087) wrote the next attempt at a session by copying the
 * old row's facts and omitting `replaces_meeting_id`. A moved make-up therefore
 * stopped being a make-up, and the rule that stops a replacement being billed
 * for an hour the client already paid reads exactly that column. On package
 * 83e8460c it cost the client a second 400.02 for one delivered hour.
 *
 * This migration adds the column to that INSERT and changes nothing else, which
 * is the thing worth pinning: the lock, the no-op return, the `moved` stamp and
 * the function's security properties all have to survive a CREATE OR REPLACE
 * that was written out by hand.
 *
 * WHY A TEST OVER SQL TEXT: there is no branch database (supabase-ops §4).
 * Absence assertions run over `code()`, because these files quote the defect
 * they fix in their headers.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const MIGRATION = join(ROOT, 'supabase', 'migrations', '20261109_moving_a_makeup_keeps_its_lineage.sql');
const ROLLBACK = join(ROOT, 'supabase', 'SQL Scripts', '20261109_moving_a_makeup_keeps_its_lineage_rollback.sql');
const PRECHECK = join(ROOT, 'scripts', 'precheck-makeup-lineage.sql');
const CHECKER = join(ROOT, 'scripts', 'check-makeup-lineage-migration.sql');
const REPAIR = join(ROOT, 'supabase', 'SQL Scripts', '20261109_restore_moved_makeup_lineage_data.sql');

const read = (file: string) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

/**
 * The SQL with its commentary and its string literals taken out.
 *
 * Block comments go FIRST and that ordering is load-bearing: these files
 * explain the defect in prose, the prose contains apostrophes ("a package's
 * sessions"), and stripping literals first makes one of those open a phantom
 * string that runs to the next real quote and swallows the code between. That
 * is exactly what it did here, and it made the migration look as though it had
 * lost its `FOR UPDATE`.
 *
 * Anything asserted on that contains a quoted SQL literal is therefore checked
 * against the RAW text instead, since this strips those by design.
 */
const code = (sql: string) =>
  sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\n]*/g, '')
    .replace(/'(?:[^']|'')*'/g, "''");

const STAMP = 'c4e8b1f07d3a6295';

describe('20261109: every pasted file exists', () => {
  it.each([
    ['migration', MIGRATION],
    ['rollback', ROLLBACK],
    ['pre-check', PRECHECK],
    ['checker', CHECKER],
    ['data repair', REPAIR],
  ])('%s is on disk', (_label, file) => {
    expect(existsSync(file)).toBe(true);
  });
});

describe('20261109 migration text', () => {
  const migration = read(MIGRATION);
  const body = code(migration);

  it('is one transaction', () => {
    expect(migration).toContain('BEGIN;');
    expect(migration.trimEnd().endsWith('COMMIT;')).toBe(true);
  });

  it('carries the stamp the checker greps for', () => {
    expect(migration).toContain(STAMP);
  });

  it('adds replaces_meeting_id to the INSERT, taken from the row being moved', () => {
    expect(body).toContain('replaces_meeting_id,');
    expect(body).toContain('v_old.replaces_meeting_id,');
  });

  it('keeps every other part of 20261087 that the hand-written replacement could have dropped', () => {
    expect(body).toContain('FOR UPDATE');
    expect(body).toContain('v_old.start_time = p_start AND v_old.end_time = p_end');
    expect(body).toContain('IF v_old.meeting_status IS NULL THEN');
    expect(body).toContain('v_old.occurrence_number + 1');
    /* Quoted literals: checked raw, since `code` strips them. */
    expect(migration).toContain("meeting_status = 'moved'");
    expect(migration).toContain("USING ERRCODE = 'no_data_found'");
  });

  it('keeps the signature, so callers and the grants are untouched', () => {
    expect(body).toContain('p_moved_by text DEFAULT NULL');
    expect(body).toContain('RETURNS uuid');
    expect(body).toContain('LANGUAGE plpgsql');
  });

  it('changes nothing about how the function is secured', () => {
    expect(body).not.toContain('SECURITY DEFINER');
    expect(body).not.toContain('SET search_path');
  });

  it('touches no rows of its own: the repair is a separate opt-in script', () => {
    /*
     * The function body legitimately holds one UPDATE (the `moved` stamp) and
     * one INSERT (the new attempt). Anything beyond those two would be this
     * migration writing data, which is what the repair script is for.
     */
    expect((body.match(/INSERT INTO/g) ?? []).length).toBe(1);
    expect((body.match(/UPDATE public\./g) ?? []).length).toBe(1);
    expect(body).not.toMatch(/\bDELETE FROM\b|\bTRUNCATE\b/);
  });

  it('records in the comment what a new attempt inherits', () => {
    expect(migration).toContain('replaces_meeting_id (20261109)');
  });
});

describe('20261109 rollback text', () => {
  const rollback = read(ROLLBACK);
  const body = code(rollback);

  it('restores the 20261087 body, without the column', () => {
    expect(body).toContain('CREATE OR REPLACE FUNCTION public.move_meeting');
    expect(body).not.toContain('v_old.replaces_meeting_id');
    expect(body).not.toContain(STAMP);
  });

  it('still carries the lock and the stamp logic, so the undo is the old function and not a stub', () => {
    expect(body).toContain('FOR UPDATE');
    expect(rollback).toContain("meeting_status = 'moved'");
  });

  it('touches no rows of its own', () => {
    /* One UPDATE, the `moved` stamp inside the function. Nothing else. */
    expect((body.match(/UPDATE public\./g) ?? []).length).toBe(1);
    expect((body.match(/INSERT INTO/g) ?? []).length).toBe(1);
    expect(body).not.toMatch(/\bDELETE FROM\b|\bTRUNCATE\b/);
  });
});

describe('20261109 pre-check and checker', () => {
  const precheck = read(PRECHECK);
  const checker = read(CHECKER);

  it('both are read-only', () => {
    const WRITES = /\b(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|TRUNCATE|GRANT|REVOKE)\b/;
    expect(code(precheck)).not.toMatch(WRITES);
    expect(code(checker)).not.toMatch(WRITES);
  });

  it('the pre-check proves the live function is still the one without lineage', () => {
    expect(precheck).toContain('does not carry the 20261109 stamp');
    expect(precheck).toContain('does not mention replaces_meeting_id yet');
    expect(precheck).toContain('replaces_meeting_id exists (20261097 is applied)');
  });

  it('the checker can fail before the apply: its gates name the new body', () => {
    expect(checker).toContain(STAMP);
    expect(checker).toContain('v_old.replaces_meeting_id');
  });

  it('the checker also proves the untouched halves survived', () => {
    expect(checker).toContain('FOR UPDATE');
    expect(checker).toContain('prosecdef');
  });

  it('both report ok, FAIL and info per row', () => {
    for (const file of [precheck, checker]) {
      expect(file).toContain("THEN 'ok' ELSE 'FAIL' END");
      expect(file).toContain("'info'");
    }
  });
});

describe('the opt-in data repair', () => {
  const repair = read(REPAIR);

  it('reads before it writes: step 1 is a plain SELECT', () => {
    expect(repair.indexOf('SELECT')).toBeLessThan(repair.indexOf('UPDATE'));
  });

  it('repairs only an attempt whose PREVIOUS attempt carries a link it lacks', () => {
    expect(repair).toContain('prev.occurrence_number = m.occurrence_number - 1');
    expect(repair).toContain('m.replaces_meeting_id IS NULL');
    expect(repair).toContain('prev.replaces_meeting_id IS NOT NULL');
  });

  it('stays inside the owner, per CLAUDE.md rule 4', () => {
    expect(repair).toContain('prev.user_id = m.user_id');
  });

  it('returns what it changed, because that output is the only undo', () => {
    expect(repair).toContain('RETURNING m.id AS attempt_id');
  });

  it('does not write moved_by, which has a CHECK constraint that refused it', () => {
    /* The first version stamped a marker there and failed with 23514. The
       lesson is recorded in the file, so the comment may mention the column;
       the executed UPDATE must not set it. */
    const steps = repair.replace(/--[^\n]*/g, '');
    expect(steps).not.toMatch(/SET[\s\S]{0,200}moved_by\s*=/);
  });
});
