/**
 * Guard over migration 20261035: the owner policy on `audit_trail` also hides
 * `bos_queue_item` (ADMIN_BOS_CLEANUP slice 7b; SA OP-2 option 1, condition
 * W7B-1; user confirmation UC-9).
 *
 * WHY. Slice 7b's `BOS_QUEUE_ITEM_CANCELLED` audit row is written against the
 * item's account (`user_id` = the account, `actor_id` = the admin) and carries
 * the admin's internal reason. Under BD-26 an owner reads back every row
 * written against their account unless its entity type is classified
 * `'operator'`; the app reads follow lib/audit/ownerVisibility.ts in code, but
 * the owner RLS policy holds a literal list that changes only by migration.
 * This one adds the one literal. It is a copy of the BD-26 package
 * (20261018), whose guard documents the shape, the null arm and the
 * SQL-editor rules; the shared checker and probe are pinned there.
 *
 * THE FILES (no comments inside: the user pastes them into the Supabase SQL
 * editor on PROD by hand)
 *   supabase/migrations/20261035_audit_trail_owner_policy_hides_queue_items.sql
 *   supabase/SQL Scripts/20261035_audit_trail_owner_policy_hides_queue_items_rollback.sql
 *     Restores exactly the 20261018 USING expression.
 *
 * APPLY ORDER (W7B-1 f). The user applies 20261035, then runs
 * scripts/check-audit-owner-policy-migration.sql (VERDICT PASS) and
 * scripts/probe-audit-owner-policy-migration.sql (PROBE PASS) BEFORE the PR
 * merges. Applied first, it hides a type nobody writes yet, which is harmless.
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { OWNER_HIDDEN_ENTITY_TYPES } from '../../../lib/audit/ownerVisibility';

const ROOT = process.cwd();
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations');
const SQL_SCRIPTS_DIR = join(ROOT, 'supabase', 'SQL Scripts');
const MIGRATION = join(MIGRATIONS_DIR, '20261035_audit_trail_owner_policy_hides_queue_items.sql');
const ROLLBACK = join(SQL_SCRIPTS_DIR, '20261035_audit_trail_owner_policy_hides_queue_items_rollback.sql');
const PREVIOUS = join(MIGRATIONS_DIR, '20261018_audit_trail_owner_policy_hides_admin_entries.sql');

const read = (file: string) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const flatOf = (text: string) => text.replace(/\s+/g, ' ').trim();
const POLICY = '"Users can view their own audit logs"';
const HIDDEN = [...OWNER_HIDDEN_ENTITY_TYPES].sort();

function literalsOf(sql: string): string[] {
  return [...sql.matchAll(/'([^']*)'/g)].map((match) => match[1]);
}

/** The USING clause of a migration that alters the owner policy. */
function usingOf(file: string): string {
  const match = flatOf(read(file)).match(/ALTER POLICY "Users can view their own audit logs" ON public\.audit_trail (USING \(.*\));/);
  expect(match).not.toBeNull();
  return match ? match[1] : '';
}

describe('SQL-editor safety (pasted by hand)', () => {
  const files: Array<[string, string]> = [
    ['migration', MIGRATION],
    ['rollback', ROLLBACK],
  ];

  it.each(files)('%s exists', (_name, file) => {
    expect(existsSync(file)).toBe(true);
  });

  it.each(files)('%s has no line comment and no block comment', (_name, file) => {
    const text = read(file);
    expect(text).not.toContain('--');
    expect(text).not.toContain('/*');
  });

  it.each(files)('%s holds only letters, digits, underscores and spaces inside string literals', (_name, file) => {
    for (const literal of literalsOf(read(file))) {
      expect({ literal, ok: /^[A-Za-z0-9_ ]*$/.test(literal) }).toEqual({ literal, ok: true });
    }
  });

  it('20261035 is used by exactly one migration file', () => {
    expect(readdirSync(MIGRATIONS_DIR).filter((name) => name.startsWith('20261035'))).toEqual([
      '20261035_audit_trail_owner_policy_hides_queue_items.sql',
    ]);
  });
});

describe('the migration', () => {
  const flat = flatOf(read(MIGRATION));

  it('is one transaction with a local lock timeout', () => {
    expect(flat.startsWith("BEGIN; SET LOCAL lock_timeout = '5s';")).toBe(true);
    expect(flat.endsWith('COMMIT;')).toBe(true);
    expect(flat.match(/\bBEGIN;/g)).toHaveLength(1);
    expect(flat.match(/\bCOMMIT;/g)).toHaveLength(1);
  });

  it('alters exactly the owner policy, by name, and nothing else', () => {
    expect(flat.match(/ALTER POLICY/g)).toHaveLength(1);
    expect(flat).toContain(`ALTER POLICY ${POLICY} ON public.audit_trail USING (`);
    expect(flat).not.toMatch(/\b(DROP|CREATE|RENAME|DELETE|UPDATE|INSERT|TRUNCATE|GRANT|REVOKE)\b/);
    expect(flat).not.toMatch(/\b(?:TO|FOR)\b|WITH CHECK/);
    expect(flat).not.toMatch(/ALTER (TABLE|ROLE|FUNCTION)/);
    expect(flat).not.toContain('service_role_bypass_rls');
  });

  it('keeps the owner scope and the null arm; its NOT IN list is the five types, sorted', () => {
    expect(flat).toContain(
      "USING ( auth.uid() = user_id AND (entity_type IS NULL OR entity_type NOT IN ('ai_action', 'bos_queue_item', 'business_os_account_plan', 'business_os_credit_lot', 'business_os_credit_period')) );"
    );
    const listed = flat.match(/NOT IN \(([^)]*)\)/);
    const literals = literalsOf(listed ? listed[1] : '');
    expect(literals).toEqual([...literals].sort());
    expect(literals).toHaveLength(5);
  });

  it('its NOT IN list equals OWNER_HIDDEN_ENTITY_TYPES (the registry)', () => {
    const listed = flat.match(/NOT IN \(([^)]*)\)/);
    expect(literalsOf(listed ? listed[1] : '').sort()).toEqual(HIDDEN);
  });

  it('differs from 20261018 by exactly the one added literal', () => {
    const previous = usingOf(PREVIOUS);
    const current = usingOf(MIGRATION);
    expect(current.replace("'bos_queue_item', ", '')).toBe(previous);
    expect(current).not.toBe(previous);
  });
});

describe('the rollback', () => {
  const flat = flatOf(read(ROLLBACK));

  it('is one transaction with a local lock timeout and one ALTER POLICY by name', () => {
    expect(flat.startsWith("BEGIN; SET LOCAL lock_timeout = '5s';")).toBe(true);
    expect(flat.endsWith('COMMIT;')).toBe(true);
    expect(flat.match(/ALTER POLICY/g)).toHaveLength(1);
    expect(flat).not.toMatch(/\b(DROP|CREATE|RENAME|DELETE|UPDATE|INSERT|TRUNCATE|GRANT|REVOKE)\b/);
    expect(flat).not.toMatch(/\b(?:TO|FOR)\b|WITH CHECK/);
    expect(flat).not.toContain('service_role_bypass_rls');
  });

  it('restores exactly the 20261018 USING expression (the four BD-26 types stay hidden)', () => {
    expect(usingOf(ROLLBACK)).toBe(usingOf(PREVIOUS));
    expect(flat).not.toContain('bos_queue_item');
  });
});
