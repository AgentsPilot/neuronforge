/**
 * Purge slice 3b (SA C-2) — the TypeScript mirror of the held RPC's control 7
 * (cascade tenancy).
 *
 * The SQL cannot run before the service-role key is rotated, and no in-process
 * Postgres is installed (SA OQ-6), so the decision rules are proven here on a
 * SYNTHETIC graph (alpha/beta names, parent plan C-1). The edge shapes mirror
 * the row-id-keyed links SA named (a contact-style parent with a proposal-style
 * child; a three-level subscription -> installment -> reminder chain; an
 * agent-style parent with an execution-style child) without naming any real
 * table. Each verdict has a mutation case.
 */

jest.mock('@/lib/repositories/BusinessPurgeRepository', () => ({ businessPurgeRepository: {} }));

import { crossTenantCascadeViolations, planTenancyCheck, type KeyedForeignKey } from '../deleteGraph';

const ME = 'tenant-me';
const OTHER = 'tenant-other';

const id = (child: string) => [{ child, parent: 'id' }];

/** In-run tables, child-first. */
const RUN = ['alpha_reminder', 'alpha_installment', 'alpha_subscription', 'alpha_child', 'alpha_parent', 'alpha_root'].map(
  (table) => ({ table })
);

const KEYS: KeyedForeignKey[] = [
  // Row-id keyed: NOT tenant-bounded by the schema -> checked.
  { constraint: 'alpha_child_parent_fkey', child: 'alpha_child', parent: 'alpha_parent', onDelete: 'c', columns: id('parent_id') },
  { constraint: 'alpha_installment_sub_fkey', child: 'alpha_installment', parent: 'alpha_subscription', onDelete: 'c', columns: id('subscription_id') },
  { constraint: 'alpha_reminder_inst_fkey', child: 'alpha_reminder', parent: 'alpha_installment', onDelete: 'c', columns: id('installment_id') },
  // Composite (user_id) -> root(user_id): tenant-bounded by the schema -> skipped.
  { constraint: 'alpha_parent_root_fkey', child: 'alpha_parent', parent: 'alpha_root', onDelete: 'c', columns: [{ child: 'user_id', parent: 'user_id' }] },
  // Not CASCADE -> not control 7's concern.
  { constraint: 'alpha_child_root_restrict', child: 'alpha_child', parent: 'alpha_root', onDelete: 'r', columns: id('root_id') },
  // Child outside the run -> control 6's concern, not 7's.
  { constraint: 'beta_out_parent_fkey', child: 'beta_outside', parent: 'alpha_parent', onDelete: 'c', columns: id('parent_id') },
  // Self-referencing CASCADE -> checked (SA G-2).
  { constraint: 'alpha_parent_self_fkey', child: 'alpha_parent', parent: 'alpha_parent', onDelete: 'c', columns: id('previous_id') },
  // SET NULL into a child OUTSIDE the run -> checked (SA G-2: an overwrite is a cross-tenant write).
  { constraint: 'beta_kept_parent_fkey', child: 'beta_kept', parent: 'alpha_parent', onDelete: 'n', columns: id('parent_id') },
  // SET DEFAULT into a listed child -> checked.
  { constraint: 'alpha_child_default_fkey', child: 'alpha_child', parent: 'alpha_parent', onDelete: 'd', columns: id('fallback_id') },
  // SET NULL whose PARENT is outside the run -> not this run's write.
  { constraint: 'beta_kept_other_fkey', child: 'beta_kept', parent: 'beta_other', onDelete: 'n', columns: id('other_id') },
];

const WITH_USER_ID = new Set([
  'alpha_reminder', 'alpha_installment', 'alpha_subscription', 'alpha_child', 'alpha_parent', 'alpha_root',
  'beta_outside', 'beta_kept', 'beta_other',
]);

describe('control 7 mirror — which edges are checked', () => {
  const plan = planTenancyCheck({ run: RUN, foreignKeys: KEYS, tablesWithUserId: WITH_USER_ID });

  it('checks in-run row-id CASCADE edges (self-references included) and SET NULL / DEFAULT edges from a run parent', () => {
    expect(plan.checked.map((k) => k.constraint)).toEqual([
      'alpha_child_default_fkey',
      'alpha_child_parent_fkey',
      'alpha_installment_sub_fkey',
      'alpha_parent_self_fkey',
      'alpha_reminder_inst_fkey',
      'beta_kept_parent_fkey',
    ]);
    expect(plan.refused).toEqual([]);
  });

  it('G-2 mutations: each widened edge kind is selected on its own', () => {
    const only = (fk: KeyedForeignKey) =>
      planTenancyCheck({ run: RUN, foreignKeys: [fk], tablesWithUserId: WITH_USER_ID }).checked.map((k) => k.constraint);
    const selfRef = KEYS.find((k) => k.constraint === 'alpha_parent_self_fkey')!;
    const setNullOut = KEYS.find((k) => k.constraint === 'beta_kept_parent_fkey')!;
    expect(only(selfRef)).toEqual(['alpha_parent_self_fkey']);
    expect(only(setNullOut)).toEqual(['beta_kept_parent_fkey']);
    // The same unlisted child under CASCADE is control 6's, not 7's.
    expect(only({ ...setNullOut, onDelete: 'c' })).toEqual([]);
    // RESTRICT / NO ACTION never write the child.
    expect(only({ ...setNullOut, onDelete: 'r' })).toEqual([]);
    expect(only({ ...setNullOut, onDelete: 'a' })).toEqual([]);
  });

  it('skips a key that maps user_id to user_id (tenant-bounded by the schema)', () => {
    expect(plan.checked.map((k) => k.constraint)).not.toContain('alpha_parent_root_fkey');
  });

  it('skips a child with no user_id column (a via child, scoped through its parent)', () => {
    const noUid = new Set([...WITH_USER_ID].filter((t) => t !== 'alpha_child'));
    const p = planTenancyCheck({ run: RUN, foreignKeys: KEYS, tablesWithUserId: noUid });
    expect(p.checked.map((k) => k.constraint)).not.toContain('alpha_child_parent_fkey');
  });

  it('refuses outright when the parent has no user_id: its rows cannot be bounded (fail closed)', () => {
    const noParentUid = new Set([...WITH_USER_ID].filter((t) => t !== 'alpha_parent'));
    const p = planTenancyCheck({ run: RUN, foreignKeys: KEYS, tablesWithUserId: noParentUid });
    // alpha_parent_self_fkey drops out: its child (alpha_parent) has no user_id either.
    expect(p.refused.map((k) => k.constraint)).toEqual([
      'alpha_child_default_fkey',
      'alpha_child_parent_fkey',
      'beta_kept_parent_fkey',
    ]);
    expect(p.checked.map((k) => k.constraint)).not.toContain('alpha_child_parent_fkey');
  });
});

describe('control 7 mirror — the row check', () => {
  const { checked } = planTenancyCheck({ run: RUN, foreignKeys: KEYS, tablesWithUserId: WITH_USER_ID });

  /** A clean tenant: every child of my rows is mine. */
  const clean = (): Record<string, Array<Record<string, unknown>>> => ({
    alpha_parent: [
      { id: 'p1', user_id: ME },
      { id: 'p2', user_id: OTHER },
      // My row pointing at my row: a self-reference inside the tenant is fine.
      { id: 'p3', user_id: ME, previous_id: 'p1' },
    ],
    // My kept row nulled by SET NULL is my own write, not flagged.
    beta_kept: [{ id: 'k1', user_id: ME, parent_id: 'p1' }],
    alpha_child: [
      { id: 'c1', user_id: ME, parent_id: 'p1' },
      // Another tenant's child of ANOTHER tenant's parent: not this run's business.
      { id: 'c2', user_id: OTHER, parent_id: 'p2' },
    ],
    alpha_subscription: [{ id: 's1', user_id: ME }],
    alpha_installment: [{ id: 'i1', user_id: ME, subscription_id: 's1' }],
    alpha_reminder: [{ id: 'r1', user_id: ME, installment_id: 'i1' }],
  });

  it('a clean tenant passes', () => {
    expect(crossTenantCascadeViolations({ edges: checked, rows: clean(), userId: ME })).toEqual([]);
  });

  it("mutation: another tenant's child row referencing my parent row is refused", () => {
    const rows = clean();
    rows.alpha_child.push({ id: 'c3', user_id: OTHER, parent_id: 'p1' });
    expect(crossTenantCascadeViolations({ edges: checked, rows, userId: ME })).toEqual([
      { constraint: 'alpha_child_parent_fkey', child: 'alpha_child', parent: 'alpha_parent' },
    ]);
  });

  it('mutation: a child with a NULL user_id referencing my parent is refused (IS DISTINCT FROM)', () => {
    const rows = clean();
    rows.alpha_child.push({ id: 'c4', user_id: null as unknown as string, parent_id: 'p1' });
    expect(crossTenantCascadeViolations({ edges: checked, rows, userId: ME }).map((v) => v.constraint)).toEqual([
      'alpha_child_parent_fkey',
    ]);
  });

  it('mutation: a foreign row two levels down the chain is caught at its own edge', () => {
    const rows = clean();
    rows.alpha_reminder.push({ id: 'r2', user_id: OTHER, installment_id: 'i1' });
    expect(crossTenantCascadeViolations({ edges: checked, rows, userId: ME }).map((v) => v.constraint)).toEqual([
      'alpha_reminder_inst_fkey',
    ]);
  });

  it('a child with a NULL key references nothing and is not a violation', () => {
    const rows = clean();
    rows.alpha_child.push({ id: 'c5', user_id: OTHER, parent_id: null as unknown as string });
    expect(crossTenantCascadeViolations({ edges: checked, rows, userId: ME })).toEqual([]);
  });

  it('a composite key matches on every column', () => {
    const composite: KeyedForeignKey = {
      constraint: 'alpha_two_col_fkey',
      child: 'alpha_child',
      parent: 'alpha_parent',
      onDelete: 'c',
      columns: [
        { child: 'parent_id', parent: 'id' },
        { child: 'parent_kind', parent: 'kind' },
      ],
    };
    const rows = {
      alpha_parent: [{ id: 'p1', kind: 'x', user_id: ME }],
      alpha_child: [{ id: 'c1', user_id: OTHER, parent_id: 'p1', parent_kind: 'y' }],
    };
    expect(crossTenantCascadeViolations({ edges: [composite], rows, userId: ME })).toEqual([]);
    rows.alpha_child[0].parent_kind = 'x';
    expect(crossTenantCascadeViolations({ edges: [composite], rows, userId: ME })).toHaveLength(1);
  });

  it("G-2 mutation: another tenant's row that self-references my row is refused (self-referencing CASCADE)", () => {
    const rows = clean();
    rows.alpha_parent.push({ id: 'p4', user_id: OTHER, previous_id: 'p1' });
    expect(crossTenantCascadeViolations({ edges: checked, rows, userId: ME }).map((v) => v.constraint)).toEqual([
      'alpha_parent_self_fkey',
    ]);
  });

  it("G-2 mutation: another tenant's UNLISTED row that SET NULL would overwrite is refused", () => {
    const rows = clean();
    rows.beta_kept.push({ id: 'k2', user_id: OTHER, parent_id: 'p1' });
    expect(crossTenantCascadeViolations({ edges: checked, rows, userId: ME }).map((v) => v.constraint)).toEqual([
      'beta_kept_parent_fkey',
    ]);
  });
});
