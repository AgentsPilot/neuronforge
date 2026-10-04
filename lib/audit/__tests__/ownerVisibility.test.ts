/**
 * The owner-visibility registry (credit deduction BD-26, KI-25; workplan
 * BUSINESS_OS_BD26_OWNER_AUDIT_HIDING_WORKPLAN.md §2, SA W26-3, W26-4).
 *
 * Two guards keep the rule in one place:
 *   1. every AUDIT_ENTITY_TYPES value is classified, with no stale key. ts-jest
 *      does not type-check here and lib/audit is outside `typecheck:bos-llm`, so
 *      the `satisfies` on the registry is not enforced by CI on its own;
 *   2. the latest migration that alters the owner policy hides exactly the
 *      registry's hidden set, so the database and the code cannot drift.
 *
 * Comparisons are SETS (W26-3 c): a duplicate entry left by a textual merge with
 * slice 8b must not turn main red. Nothing here imports an 8b event constant
 * (W26-3 a, d), so it passes on today's main shape.
 */

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { AUDIT_ENTITY_TYPES } from '../types';
import { AUDIT_ENTITY_OWNER_VISIBILITY, OWNER_HIDDEN_ENTITY_TYPES, isOwnerHiddenFilter } from '../ownerVisibility';

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');
const OWNER_POLICY_ALTER = 'ALTER POLICY "Users can view their own audit logs"';

// + bos_queue_item: ADMIN_BOS_CLEANUP slice 7b (SA OP-2 option 1, W7B-1; migration 20261035).
const EXPECTED_HIDDEN = [
  'ai_action',
  'bos_queue_item',
  'business_os_account_plan',
  'business_os_credit_lot',
  'business_os_credit_period',
];

/** SQL with `--` comment lines removed and line endings normalised. */
function executable(sql: string): string {
  return sql
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
}

/** The latest migration (by filename) whose executable text alters the owner policy. */
function latestOwnerPolicyMigration(): { file: string; sql: string } {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  const hits = files
    .map((file) => ({ file, sql: executable(readFileSync(join(MIGRATIONS_DIR, file), 'utf8')) }))
    .filter((entry) => entry.sql.includes(OWNER_POLICY_ALTER));
  expect(hits.length).toBeGreaterThan(0);
  return hits[hits.length - 1];
}

/**
 * Only the literals inside the policy's `NOT IN ( … )` (W26-4): the policy name
 * and any other quoted text must not count. Returns null when there is no list.
 */
function hiddenTypesInPolicySql(sql: string): string[] | null {
  const at = sql.indexOf(OWNER_POLICY_ALTER);
  if (at < 0) return null;
  const match = sql.slice(at).match(/NOT\s+IN\s*\(([^)]*)\)/i);
  if (!match) return null;
  return [...match[1].matchAll(/'([^']*)'/g)].map((literal) => literal[1]);
}

const sortedSet = (values: readonly string[]) => [...new Set(values)].sort();

describe('AUDIT_ENTITY_OWNER_VISIBILITY: forced classification', () => {
  it('classifies every AUDIT_ENTITY_TYPES value, with no stale key', () => {
    expect(sortedSet(Object.keys(AUDIT_ENTITY_OWNER_VISIBILITY))).toEqual(sortedSet(AUDIT_ENTITY_TYPES));
  });

  it('uses only the two values owner / operator', () => {
    for (const value of Object.values(AUDIT_ENTITY_OWNER_VISIBILITY)) {
      expect(['owner', 'operator']).toContain(value);
    }
  });

  it('hides exactly the four BD-26 types plus slice 7b\'s bos_queue_item (set equality)', () => {
    expect(sortedSet(OWNER_HIDDEN_ENTITY_TYPES)).toEqual(EXPECTED_HIDDEN);
  });

  it('OWNER_HIDDEN_ENTITY_TYPES is sorted, duplicate-free and frozen', () => {
    expect([...OWNER_HIDDEN_ENTITY_TYPES]).toEqual(sortedSet(OWNER_HIDDEN_ENTITY_TYPES));
    expect(Object.isFrozen(OWNER_HIDDEN_ENTITY_TYPES)).toBe(true);
  });

  it('registers business_os_credit_period as an entity type (BD-26 ahead of slice 8b, W26-1)', () => {
    expect(AUDIT_ENTITY_TYPES).toContain('business_os_credit_period');
  });
});

describe('the owner policy mirrors the registry (W26-4)', () => {
  it('the latest owner-policy migration is 20261035 or later (slice 7b)', () => {
    const { file } = latestOwnerPolicyMigration();
    expect(file >= '20261035').toBe(true);
  });

  it("its NOT IN list equals OWNER_HIDDEN_ENTITY_TYPES, as sets", () => {
    const { file, sql } = latestOwnerPolicyMigration();
    const listed = hiddenTypesInPolicySql(sql);
    expect({ file, listed: listed && sortedSet(listed) }).toEqual({ file, listed: sortedSet(OWNER_HIDDEN_ENTITY_TYPES) });
  });

  it('the parser ignores the policy name and literals outside the NOT IN list', () => {
    const sql = `BEGIN; SET LOCAL lock_timeout = '5s'; ${OWNER_POLICY_ALTER} ON public.audit_trail USING (auth.uid() = user_id AND (entity_type IS NULL OR entity_type NOT IN ('a_type', 'b_type'))); COMMIT;`;
    expect(hiddenTypesInPolicySql(sql)).toEqual(['a_type', 'b_type']);
  });

  it('would fail if a type were missing from the SQL (negative control)', () => {
    const { sql } = latestOwnerPolicyMigration();
    const dropped = sql.replace(/,\s*'business_os_credit_period'/, '');
    expect(dropped).not.toEqual(sql);
    expect(sortedSet(hiddenTypesInPolicySql(dropped) ?? [])).not.toEqual(sortedSet(OWNER_HIDDEN_ENTITY_TYPES));
  });
});

describe('isOwnerHiddenFilter', () => {
  it.each(EXPECTED_HIDDEN.map((entityType) => [{ entityType }]))('hides %j', (filter) => {
    expect(isOwnerHiddenFilter(filter)).toBe(true);
  });

  it.each([[{ action: 'BUSINESS_AI_ACTION_COMPLETED' }], [{ action: 'BUSINESS_AI_ACTION_FAILED', entityType: 'settings' }]])(
    'hides an AI action event whatever its type: %j',
    (filter) => {
      expect(isOwnerHiddenFilter(filter)).toBe(true);
    }
  );

  it.each([
    [{}],
    [{ entityType: 'settings' }],
    [{ entityType: 'stripe_connect_account' }],
    [{ action: 'USER_LOGIN' }],
    // An action filter for a hidden event still queries; the NOT IN empties it.
    [{ action: 'BOS_CREDIT_LOT_GRANTED' }],
    [{ action: 'BOS_CREDIT_LOW_LINE_CROSSED' }],
    [{ entityType: 'business_os_credit' }],
  ])('does not short-circuit %j', (filter) => {
    expect(isOwnerHiddenFilter(filter)).toBe(false);
  });
});
