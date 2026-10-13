/**
 * Purge slice 3a (T3a-4, workplan §6.1) — the delete-graph check.
 *
 * Runs on a SYNTHETIC graph (alpha/beta names; parent plan C-1, SA OQ-6), so
 * the rules are proven on planted cases rather than on whatever a dump
 * happened to contain. Every blocking verdict has a mutation case: an
 * assertion that cannot fail is indistinguishable from one that always passes.
 */

import fs from 'fs';
import path from 'path';

const introspectSchema = jest.fn();

jest.mock('@/lib/repositories/BusinessPurgeRepository', () => ({
  businessPurgeRepository: {
    introspectSchema: (...args: unknown[]) => introspectSchema(...args),
  },
}));

import {
  checkDeleteGraph,
  isDeleteCapableTrigger,
  isNullableOverwrite,
  runDeleteGraphCheck,
  type ColumnFact,
  type DeleteGraphInput,
  type ForeignKeyFact,
  type TriggerFact,
} from '../deleteGraph';
import { descriptorsForRun } from '../descriptors';

interface Fixture {
  run: string[];
  foreign_keys: ForeignKeyFact[];
  triggers: TriggerFact[];
  reviewed: Array<{ table: string; trigger: string }>;
}

const fixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'delete-graph.fixture.json'), 'utf-8')
) as Fixture;

/** The fixture as a check input, with overrides. Tables become `{ table }` descriptors. */
function input(overrides: Partial<Omit<DeleteGraphInput, 'run'>> & { run?: string[] } = {}): DeleteGraphInput {
  const { run, ...rest } = overrides;
  return {
    run: (run ?? fixture.run).map((table) => ({ table })),
    foreignKeys: fixture.foreign_keys,
    triggers: fixture.triggers,
    reviewedTriggers: fixture.reviewed,
    cascadeCountExempt: [],
    ...rest,
  };
}

describe('checkDeleteGraph — the clean case', () => {
  it('passes the fixture run, reporting only the cascade-after-parent edge', () => {
    const result = checkDeleteGraph(input());

    expect(result.status).toBe('ok');
    expect(result.blockingOrderViolations).toEqual([]);
    expect(result.unlistedCascadeChildren).toEqual([]);
    expect(result.unreviewedDeleteTriggers).toEqual([]);
    // alpha_tail sits after alpha_root: reported, never blocking.
    expect(result.cascadeAfterParent).toEqual([
      { constraint: 'alpha_tail_root_fkey', child: 'alpha_tail', parent: 'alpha_root', exempt: false },
    ]);
  });

  it('marks a cascade-after-parent child exempt when it is on the exemption list', () => {
    const result = checkDeleteGraph(input({ cascadeCountExempt: ['alpha_tail'] }));
    expect(result.cascadeAfterParent).toEqual([expect.objectContaining({ child: 'alpha_tail', exempt: true })]);
    expect(result.status).toBe('ok');
  });

  it('ignores self-references, SET NULL children and FKs to tables outside the run', () => {
    const result = checkDeleteGraph(input());
    const named = JSON.stringify(result);
    expect(named).not.toContain('alpha_root_parent_fkey'); // self-reference
    expect(named).not.toContain('beta_nulled'); // SET NULL child, and its DELETE trigger is never reached
    expect(named).not.toContain('beta_kept'); // cascade child of a table the run does not delete
  });

  it('is deterministic regardless of FK input order', () => {
    const reversed = checkDeleteGraph(input({ foreignKeys: [...fixture.foreign_keys].reverse() }));
    expect(reversed).toEqual(checkDeleteGraph(input()));
  });
});

describe('checkDeleteGraph — each blocking verdict fires on its planted case', () => {
  it('blocking order: a RESTRICT child ordered after its parent is refused', () => {
    const result = checkDeleteGraph(input({ run: ['alpha_leaf', 'alpha_root', 'alpha_blocker', 'alpha_tail'] }));

    expect(result.status).toBe('refused');
    expect(result.blockingOrderViolations).toEqual([
      { constraint: 'alpha_blocker_root_fkey', child: 'alpha_blocker', parent: 'alpha_root' },
    ]);
  });

  it('blocking order: NO ACTION counts as blocking too', () => {
    const fks = fixture.foreign_keys.map((fk) =>
      fk.constraint_name === 'alpha_blocker_root_fkey' ? { ...fk, on_delete: 'a' } : fk
    );
    const result = checkDeleteGraph(input({ foreignKeys: fks, run: ['alpha_root', 'alpha_blocker'] }));
    expect(result.blockingOrderViolations).toHaveLength(1);
  });

  it('unlisted cascade child: removing a cascade child from the run is refused', () => {
    const result = checkDeleteGraph(input({ run: ['alpha_blocker', 'alpha_root', 'alpha_tail'] }));

    expect(result.status).toBe('refused');
    expect(result.unlistedCascadeChildren).toEqual([
      { constraint: 'alpha_leaf_root_fkey', child: 'alpha_leaf', parent: 'alpha_root' },
    ]);
  });

  it('a `never` table reached by cascade is refused, and its DELETE trigger is unreviewed', () => {
    // beta_kept stands in for a `never` table: CASCADE child of a run table, not in the run.
    const fks: ForeignKeyFact[] = [
      ...fixture.foreign_keys,
      { constraint_name: 'beta_kept_root_fkey', table_name: 'beta_kept', references: 'alpha_root', on_delete: 'c' },
    ];
    const result = checkDeleteGraph(input({ foreignKeys: fks }));

    expect(result.status).toBe('refused');
    expect(result.unlistedCascadeChildren.map((e) => e.child)).toEqual(['beta_kept']);
    expect(result.unreviewedDeleteTriggers).toEqual([{ table: 'beta_kept', trigger: 'beta_kept_on_delete' }]);
  });

  it('unreviewed DELETE trigger: dropping a trigger from the reviewed list is refused', () => {
    const result = checkDeleteGraph(input({ reviewedTriggers: [] }));

    expect(result.status).toBe('refused');
    expect(result.unreviewedDeleteTriggers).toEqual([{ table: 'alpha_leaf', trigger: 'alpha_leaf_reviewed' }]);
  });

  it('unreviewed DELETE trigger: a new DELETE trigger on a run table is refused', () => {
    const triggers: TriggerFact[] = [
      ...fixture.triggers,
      { table_name: 'alpha_root', trigger_name: 'alpha_root_new', definition: 'CREATE TRIGGER alpha_root_new BEFORE DELETE ON public.alpha_root FOR EACH ROW EXECUTE FUNCTION g()' },
    ];
    const result = checkDeleteGraph(input({ triggers }));
    expect(result.unreviewedDeleteTriggers).toEqual([{ table: 'alpha_root', trigger: 'alpha_root_new' }]);
  });
});

describe('checkDeleteGraph — SET NULL into a NOT NULL column blocks like NO ACTION (23502, 2026-10-08)', () => {
  // gamma_child.parent_id -> alpha_root, ON DELETE SET NULL. Named in Postgres's
  // default `<table>_<column>_fkey` form so the column can be resolved.
  const setNull = (onDelete = 'n', name = 'gamma_child_parent_id_fkey'): ForeignKeyFact[] => [
    ...fixture.foreign_keys,
    { constraint_name: name, table_name: 'gamma_child', references: 'alpha_root', on_delete: onDelete },
  ];
  const column = (isNullable: string | undefined): ColumnFact[] => [
    { table_name: 'gamma_child', column_name: 'id', is_nullable: 'NO' },
    { table_name: 'gamma_child', column_name: 'parent_id', is_nullable: isNullable },
  ];
  const after = ['alpha_blocker', 'alpha_leaf', 'alpha_root', 'gamma_child', 'alpha_tail'];
  const before = ['alpha_blocker', 'alpha_leaf', 'gamma_child', 'alpha_root', 'alpha_tail'];
  const edge = { constraint: 'gamma_child_parent_id_fkey', child: 'gamma_child', parent: 'alpha_root' };

  it('NOT NULL child ordered after its parent is refused, named as a blocking-order violation', () => {
    const result = checkDeleteGraph(input({ run: after, foreignKeys: setNull(), columns: column('NO') }));
    expect(result.status).toBe('refused');
    expect(result.blockingOrderViolations).toEqual([edge]);
  });

  it('the same edge passes once the child is ordered before its parent', () => {
    const result = checkDeleteGraph(input({ run: before, foreignKeys: setNull(), columns: column('NO') }));
    expect(result.status).toBe('ok');
    expect(result.blockingOrderViolations).toEqual([]);
  });

  it('a NULLABLE child may sit after its parent: SET NULL is harmless there (the graph stays cyclic)', () => {
    const result = checkDeleteGraph(input({ run: after, foreignKeys: setNull(), columns: column('YES') }));
    expect(result.status).toBe('ok');
  });

  it('SET DEFAULT into a NOT NULL column is held to the same rule', () => {
    const result = checkDeleteGraph(input({ run: after, foreignKeys: setNull('d'), columns: column('NO') }));
    expect(result.blockingOrderViolations).toEqual([edge]);
  });

  it.each([
    ['no columns were read', undefined],
    ['the nullability is missing', column(undefined)],
    ['the column is not on the child', [{ table_name: 'gamma_child', column_name: 'other', is_nullable: 'YES' }]],
  ])('fails closed when %s', (_label, columns) => {
    const result = checkDeleteGraph(
      input({ run: after, foreignKeys: setNull(), columns: columns as ColumnFact[] | undefined })
    );
    expect(result.blockingOrderViolations).toEqual([edge]);
  });

  it('fails closed when the constraint name does not name its column', () => {
    const result = checkDeleteGraph(
      input({ run: after, foreignKeys: setNull('n', 'fk_gamma_parent'), columns: column('YES') })
    );
    expect(result.blockingOrderViolations).toEqual([{ ...edge, constraint: 'fk_gamma_parent' }]);
  });

  it('isNullableOverwrite reads only `<child>_<column>_fkey` with a YES column', () => {
    const fk = { constraint_name: 'gamma_child_parent_id_fkey', table_name: 'gamma_child', references: 'alpha_root', on_delete: 'n' };
    expect(isNullableOverwrite(fk, column('YES'))).toBe(true);
    expect(isNullableOverwrite(fk, column('NO'))).toBe(false);
    expect(isNullableOverwrite({ ...fk, constraint_name: 'gamma_child__fkey' }, column('YES'))).toBe(false);
  });
});

describe('checkDeleteGraph — fail closed (SA C-5)', () => {
  it('an empty FK list for a non-empty run is unreadable, never ok', () => {
    const result = checkDeleteGraph(input({ foreignKeys: [] }));
    expect(result.status).toBe('unreadable');
    expect(result.error).toMatch(/no foreign keys/);
  });

  it('a payload without triggers is unreadable, never ok', () => {
    const result = checkDeleteGraph(input({ triggers: undefined }));
    expect(result.status).toBe('unreadable');
    expect(result.error).toMatch(/triggers/);
  });

  it('a missing FK list is unreadable', () => {
    expect(checkDeleteGraph(input({ foreignKeys: undefined })).status).toBe('unreadable');
  });
});

describe('isDeleteCapableTrigger', () => {
  it.each([
    ['CREATE TRIGGER t BEFORE DELETE ON public.x FOR EACH ROW EXECUTE FUNCTION f()', true],
    ['CREATE TRIGGER t AFTER INSERT OR DELETE OR UPDATE ON public.x FOR EACH ROW EXECUTE FUNCTION f()', true],
    ['CREATE CONSTRAINT TRIGGER t AFTER DELETE ON public.x DEFERRABLE FOR EACH ROW EXECUTE FUNCTION f()', true],
    ['CREATE TRIGGER t BEFORE UPDATE ON public.x FOR EACH ROW EXECUTE FUNCTION f()', false],
    ['CREATE TRIGGER t AFTER INSERT ON public.x FOR EACH ROW EXECUTE FUNCTION on_delete_helper()', false],
    ['CREATE TRIGGER t AFTER UPDATE OF deleted_at ON public.x FOR EACH ROW EXECUTE FUNCTION f()', false],
    // Unparseable → treated as DELETE-capable: an unrecognised trigger is the one nobody reviewed.
    ['something unexpected', true],
  ])('%s → %s', (definition, expected) => {
    expect(isDeleteCapableTrigger(definition)).toBe(expected);
  });
});

describe('runDeleteGraphCheck — one repository read, never throws', () => {
  beforeEach(() => introspectSchema.mockReset());

  const options = { integrations: false, agents: false, activityHistory: false };

  it('checks the run resolved from level + options against the live payload', async () => {
    const run = descriptorsForRun('reset', options);
    // A clean graph for this run: one CASCADE edge from the first run table to
    // the last, ordered child-first.
    introspectSchema.mockResolvedValue({
      data: {
        columns: [],
        foreign_keys: [
          { constraint_name: 'k', table_name: run[0].table, references: run[run.length - 1].table, on_delete: 'c' },
        ],
        triggers: [],
      },
      error: null,
    });

    const result = await runDeleteGraphCheck({ level: 'reset', options, correlationId: 'c1' });
    expect(introspectSchema).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('ok');
  });

  it('a repository error is unreadable', async () => {
    introspectSchema.mockResolvedValue({ data: null, error: new Error('permission denied') });
    const result = await runDeleteGraphCheck({ level: 'purge', options });
    expect(result.status).toBe('unreadable');
    // SA F-1: fixed text outside development; the raw error is logged only.
    expect(result.error).toBe('The live schema could not be read');
  });

  it('a rejected read is unreadable, not a throw', async () => {
    introspectSchema.mockRejectedValue(new Error('socket hang up'));
    await expect(runDeleteGraphCheck({ level: 'purge', options })).resolves.toMatchObject({
      status: 'unreadable',
      error: 'The live schema could not be read',
    });
  });

  it('in development only, the raw text is appended for debugging (SA F-1)', async () => {
    const env = process.env as Record<string, string | undefined>;
    const was = env.NODE_ENV;
    env.NODE_ENV = 'development';
    try {
      introspectSchema.mockResolvedValue({ data: null, error: new Error('permission denied') });
      const result = await runDeleteGraphCheck({ level: 'purge', options });
      expect(result.error).toBe('The live schema could not be read: permission denied');
    } finally {
      env.NODE_ENV = was;
    }
  });

  it('a payload without triggers is unreadable (back-compat parse, fail-closed check)', async () => {
    introspectSchema.mockResolvedValue({
      data: { columns: [], foreign_keys: [{ constraint_name: 'k', table_name: 'a', references: 'b', on_delete: 'c' }] },
      error: null,
    });
    const result = await runDeleteGraphCheck({ level: 'reset', options });
    expect(result.status).toBe('unreadable');
  });
});
