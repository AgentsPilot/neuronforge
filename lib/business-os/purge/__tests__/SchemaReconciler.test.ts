/**
 * AD-1a (SC-7, SC-12) — the SchemaReconciler.
 *
 * `reconcileSchema` is pure, so most cases run against a small fixture of the
 * real `purge_schema_introspect()` payload shape. `runSchemaReconciler` is
 * tested through a mocked repository: the property that matters there is that
 * a failure becomes `unreadable` and never throws (SA further condition 3).
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
  computeSchemaFingerprint,
  reconcileSchema,
  runSchemaReconciler,
} from '../SchemaReconciler';
import { PURGE_DESCRIPTORS } from '../descriptors';
import type { PurgeDescriptor } from '../types';
import type { PurgeSchemaSnapshot } from '@/lib/repositories/BusinessPurgeRepository';

const fixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'schema-introspect.fixture.json'), 'utf-8')
) as PurgeSchemaSnapshot;

const d = (
  table: string,
  level: PurgeDescriptor['level'],
  scope: PurgeDescriptor['scope'] = { kind: 'user_id' }
): PurgeDescriptor => ({ table, level, scope, order: 300, snapshot: 'rows' });

/** A descriptor set that classifies every tenant table in the fixture. */
const FIXTURE_DESCRIPTORS: PurgeDescriptor[] = [
  d('alpha_rows', 'reset'),
  d('alpha_children', 'reset', { kind: 'via', parent: 'alpha_rows', fk: 'alpha_id' }),
  d('kept_ledger', 'never'),
  d('owned_orgs', 'never'),
  d('platform_config', 'never', { kind: 'global' }),
];

const without = (table: string) => FIXTURE_DESCRIPTORS.filter((x) => x.table !== table);

describe('reconcileSchema — the union predicate, applied in TypeScript', () => {
  it('is ok when every tenant table is classified and every descriptor is live', () => {
    const r = reconcileSchema(fixture, FIXTURE_DESCRIPTORS);
    expect(r.status).toBe('ok');
    expect(r.unclassified).toEqual([]);
    expect(r.missingDeletable).toEqual([]);
    expect(r.missingNever).toEqual([]);
    expect(r.tenantTables).toEqual(['alpha_rows', 'kept_ledger', 'owned_orgs', 'platform_config']);
  });

  it('finds an unclassified table through a user_id column', () => {
    const r = reconcileSchema(fixture, without('kept_ledger'));
    expect(r.status).toBe('drift');
    expect(r.unclassified).toEqual(['kept_ledger']);
  });

  it('finds an unclassified table through an owner_user_id column alone', () => {
    const r = reconcileSchema(fixture, without('owned_orgs'));
    expect(r.status).toBe('drift');
    expect(r.unclassified).toEqual(['owned_orgs']);
  });

  it('finds an unclassified table through an FK to users alone', () => {
    // platform_config has no user_id / owner_user_id — only updated_by -> users.
    // The RPC's own user_scoped_tables misses it; the predicate here must not.
    expect(fixture.columns.some((c) => c.table_name === 'platform_config' && c.column_name === 'user_id')).toBe(false);
    const r = reconcileSchema(fixture, without('platform_config'));
    expect(r.status).toBe('drift');
    expect(r.unclassified).toEqual(['platform_config']);
  });

  it('ignores a table that matches none of the three (and a via child without a tenant column)', () => {
    const r = reconcileSchema(fixture, without('alpha_children'));
    expect(r.tenantTables).not.toContain('global_catalog');
    expect(r.tenantTables).not.toContain('alpha_children');
    expect(r.unclassified).toEqual([]);
    expect(r.status).toBe('ok');
  });

  it.each(['reset', 'purge', 'optional:agents', 'optional:integrations', 'optional:activityHistory'] as const)(
    'a missing %s descriptor is drift (missingDeletable)',
    (level) => {
      const r = reconcileSchema(fixture, [...FIXTURE_DESCRIPTORS, d('gone_table', level)]);
      expect(r.status).toBe('drift');
      expect(r.missingDeletable).toEqual(['gone_table']);
      expect(r.missingNever).toEqual([]);
    }
  );

  it('a missing never descriptor is listed but is NOT drift', () => {
    const r = reconcileSchema(fixture, [...FIXTURE_DESCRIPTORS, d('dead_never', 'never')]);
    expect(r.status).toBe('ok');
    expect(r.missingNever).toEqual(['dead_never']);
    expect(r.missingDeletable).toEqual([]);
  });

  it('a public.users table makes the verdict ambiguous, even when nothing else is wrong', () => {
    const snapshot: PurgeSchemaSnapshot = {
      ...fixture,
      columns: [...fixture.columns, { table_name: 'users', column_name: 'id' }],
    };
    const r = reconcileSchema(snapshot, FIXTURE_DESCRIPTORS);
    expect(r.status).toBe('ambiguous');
    // `users` itself is not reported as an unclassified tenant table.
    expect(r.unclassified).not.toContain('users');
  });

  it('ambiguous wins over drift', () => {
    const snapshot: PurgeSchemaSnapshot = {
      ...fixture,
      columns: [...fixture.columns, { table_name: 'users', column_name: 'id' }],
    };
    expect(reconcileSchema(snapshot, without('kept_ledger')).status).toBe('ambiguous');
  });
});

describe('fingerprint', () => {
  it('does not depend on input order', () => {
    const a = reconcileSchema(fixture, FIXTURE_DESCRIPTORS);
    const reversed: PurgeSchemaSnapshot = {
      ...fixture,
      columns: [...fixture.columns].reverse(),
      foreign_keys: [...fixture.foreign_keys].reverse(),
    };
    const b = reconcileSchema(reversed, [...FIXTURE_DESCRIPTORS].reverse());
    expect(a.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(b.fingerprint).toBe(a.fingerprint);
  });

  it('changes when an FK ON DELETE action changes', () => {
    const a = reconcileSchema(fixture, FIXTURE_DESCRIPTORS);
    const changed: PurgeSchemaSnapshot = {
      ...fixture,
      foreign_keys: fixture.foreign_keys.map((fk) =>
        fk.table_name === 'alpha_children' ? { ...fk, on_delete: 'n' } : fk
      ),
    };
    expect(reconcileSchema(changed, FIXTURE_DESCRIPTORS).fingerprint).not.toBe(a.fingerprint);
  });

  it('changes when a descriptor level changes', () => {
    const a = reconcileSchema(fixture, FIXTURE_DESCRIPTORS);
    const relevelled = FIXTURE_DESCRIPTORS.map((x) => (x.table === 'alpha_rows' ? { ...x, level: 'purge' as const } : x));
    expect(reconcileSchema(fixture, relevelled).fingerprint).not.toBe(a.fingerprint);
  });

  it('does not collide when tuple boundaries shift', () => {
    const base = { tenantTables: [], descriptors: [] };
    const x = computeSchemaFingerprint({ ...base, foreignKeys: [{ table_name: 'ab', references: 'c', on_delete: 'a' }] });
    const y = computeSchemaFingerprint({ ...base, foreignKeys: [{ table_name: 'a', references: 'bc', on_delete: 'a' }] });
    expect(x).not.toBe(y);
  });
});

describe('the real descriptor set (non-vacuity)', () => {
  it('reconciles ok against a schema made of exactly its own tables', () => {
    // Each deletable/never descriptor becomes a live table; user_id-scoped ones
    // carry a user_id column. If the reconciler mis-read the real descriptor
    // shape, this would report drift instead of ok.
    const columns = PURGE_DESCRIPTORS.flatMap((x) => [
      { table_name: x.table, column_name: 'id' },
      ...(x.scope.kind === 'user_id' ? [{ table_name: x.table, column_name: 'user_id' }] : []),
    ]);
    const r = reconcileSchema({ columns, foreign_keys: [] }, PURGE_DESCRIPTORS);
    expect(r.status).toBe('ok');
    expect(r.tenantTables.length).toBeGreaterThan(100);
  });

  it('reports a real deletable descriptor as missing when its table is dropped', () => {
    const columns = PURGE_DESCRIPTORS.filter((x) => x.table !== 'insight_actions').map((x) => ({
      table_name: x.table,
      column_name: 'id',
    }));
    const r = reconcileSchema({ columns, foreign_keys: [] }, PURGE_DESCRIPTORS);
    expect(r.status).toBe('drift');
    expect(r.missingDeletable).toEqual(['insight_actions']);
  });
});

describe('runSchemaReconciler — failure isolation', () => {
  beforeEach(() => introspectSchema.mockReset());

  it('reconciles what the repository returns', async () => {
    introspectSchema.mockResolvedValue({ data: fixture, error: null });
    const r = await runSchemaReconciler({ descriptors: FIXTURE_DESCRIPTORS, correlationId: 'c-1' });
    expect(introspectSchema).toHaveBeenCalledTimes(1);
    expect(r.status).toBe('ok');
  });

  it('a repository error becomes unreadable, with no fingerprint', async () => {
    introspectSchema.mockResolvedValue({ data: null, error: new Error('permission denied') });
    const r = await runSchemaReconciler({ descriptors: FIXTURE_DESCRIPTORS });
    expect(r.status).toBe('unreadable');
    expect(r.fingerprint).toBeNull();
    expect(r.error).toBe('permission denied');
    expect(r.unclassified).toEqual([]);
  });

  it('a repository that throws becomes unreadable — it never rejects', async () => {
    introspectSchema.mockRejectedValue(new Error('socket hang up'));
    await expect(runSchemaReconciler()).resolves.toMatchObject({ status: 'unreadable', error: 'socket hang up' });
  });
});
