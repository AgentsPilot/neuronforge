/**
 * Static checks on the Layer 3 Step 1 migration (OQ-11 option a) that narrows the
 * owner RLS policy on audit_trail. It is applied manually after SA review, so
 * this pins what the file does before anyone runs it (same pattern as
 * lib/website-builder/__tests__/archetypeSeed.test.ts). The live effect is
 * checked with the post-check query in the file's header and QA's L-3.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { AI_ACTION_ENTITY_TYPE } from '../requestSchemas';

const FILE = '20260930_audit_trail_owner_policy_hides_ai_actions.sql';
const sql = readFileSync(join(__dirname, '../../../supabase/migrations', FILE), 'utf8');

/** The executable statements: comment lines removed, whitespace collapsed. */
const body = sql
  .split(/\r?\n/)
  .filter((line) => !line.trim().startsWith('--'))
  .join(' ')
  .replace(/\s+/g, ' ')
  .trim();

describe(`${FILE}`, () => {
  it('runs as one transaction', () => {
    expect(body.startsWith('BEGIN;')).toBe(true);
    expect(body.endsWith('COMMIT;')).toBe(true);
  });

  it('alters exactly the owner policy, by name, with no DROP or CREATE (SA CR-S1-1)', () => {
    expect(body.match(/ALTER POLICY/g)).toHaveLength(1);
    expect(body).toContain('ALTER POLICY "Users can view their own audit logs" ON public.audit_trail USING');
    expect(body).not.toMatch(/\b(DROP|CREATE)\b/);
  });

  it('changes only the USING expression: no roles (TO), no command (FOR), no WITH CHECK, no rename', () => {
    expect(body).not.toMatch(/\bTO\b/);
    expect(body).not.toMatch(/\bFOR\b/);
    expect(body).not.toMatch(/WITH CHECK/);
    expect(body).not.toMatch(/RENAME/);
  });

  it('keeps the owner scope and hides only ai_action, null-safely', () => {
    expect(body).toContain(
      `USING (auth.uid() = user_id AND entity_type IS DISTINCT FROM '${AI_ACTION_ENTITY_TYPE}');`
    );
    expect(body).not.toMatch(/entity_type\s*<>/);
  });

  it('never touches the service-role policy or anything else', () => {
    expect(body).not.toContain('service_role_bypass_rls');
    expect(body).not.toMatch(/\b(DELETE|UPDATE|INSERT|TRUNCATE|GRANT|REVOKE)\b/);
    expect(body).not.toMatch(/ALTER (TABLE|ROLE|FUNCTION)/);
  });

  it('documents the pre-check (with the {0} = PUBLIC note), the post-check and an ALTER POLICY rollback', () => {
    expect(sql).toMatch(/PRE-CHECK/);
    expect(sql).toMatch(/\{0\} means PUBLIC/);
    expect(sql).toMatch(/STOP only if/);
    expect(sql).toMatch(/POST-CHECK/);
    expect(sql).toMatch(
      /-- ROLLBACK[\s\S]*--\s+ALTER POLICY "Users can view their own audit logs" ON public\.audit_trail\s*\n--\s+USING \(auth\.uid\(\) = user_id\);/
    );
  });
});
