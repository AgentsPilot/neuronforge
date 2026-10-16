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
): PurgeDescriptor => ({ table, level, scope, order: 300, snapshot: 'rows', export: { kind: 'exclude', reason: 'fixture' } });

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

describe('export column drift (data export DE-2, FR-E19): report-only', () => {
  // alpha_rows becomes an exported table with an explicit list.
  const included = (
    columns: string[],
    excludedColumns?: Record<string, string>
  ): PurgeDescriptor[] =>
    FIXTURE_DESCRIPTORS.map((x) =>
      x.table === 'alpha_rows'
        ? { ...x, export: { kind: 'include', section: 'user_profile', columns, ...(excludedColumns ? { excludedColumns } : {}) } }
        : x
    );

  it('lists a live column on an include table that is in neither list', () => {
    const r = reconcileSchema(fixture, included(['id']));
    expect(r.exportColumnDrift).toEqual([{ table: 'alpha_rows', column: 'user_id' }]);
    expect(r.exportColumnsMissing).toEqual([]);
  });

  it('excludedColumns suppresses the drift for the columns it names', () => {
    const r = reconcileSchema(fixture, included(['id'], { user_id: 'fixture reason' }));
    expect(r.exportColumnDrift).toEqual([]);
  });

  it('ignores exclude and planned tables, whatever their live columns', () => {
    const planned = FIXTURE_DESCRIPTORS.map((x) =>
      x.table === 'kept_ledger' ? { ...x, export: { kind: 'planned' as const, slice: 'DE-4' as const } } : x
    );
    const r = reconcileSchema(fixture, planned);
    expect(r.exportColumnDrift).toEqual([]);
    expect(r.exportColumnsMissing).toEqual([]);
  });

  it('lists a declared column that is not live', () => {
    const r = reconcileSchema(fixture, included(['id', 'user_id', 'gone_column']));
    expect(r.exportColumnsMissing).toEqual([{ table: 'alpha_rows', column: 'gone_column' }]);
    expect(r.exportColumnDrift).toEqual([]);
  });

  it('a drift-only result keeps status ok (it never blocks a delete)', () => {
    const r = reconcileSchema(fixture, included(['gone_column']));
    expect(r.exportColumnDrift.length).toBeGreaterThan(0);
    expect(r.exportColumnsMissing.length).toBeGreaterThan(0);
    expect(r.status).toBe('ok');
  });

  it('swapping every export classification leaves the purge verdict and the fingerprint unchanged (T-12)', () => {
    const asIs = reconcileSchema(fixture, FIXTURE_DESCRIPTORS);
    const swapped = reconcileSchema(fixture, included(['gone_column']).map((x) =>
      x.table === 'alpha_rows' ? x : { ...x, export: { kind: 'planned' as const, slice: 'DE-7' as const } }
    ));
    for (const key of ['status', 'unclassified', 'missingDeletable', 'missingNever', 'tenantTables', 'fingerprint'] as const) {
      expect(swapped[key]).toEqual(asIs[key]);
    }
    // And on the real set: every real descriptor relabelled `exclude`.
    const columns = PURGE_DESCRIPTORS.map((x) => ({ table_name: x.table, column_name: 'id' }));
    const real = reconcileSchema({ columns, foreign_keys: [] }, PURGE_DESCRIPTORS);
    const relabelled = reconcileSchema(
      { columns, foreign_keys: [] },
      PURGE_DESCRIPTORS.map((x) => ({ ...x, export: { kind: 'exclude' as const, reason: 'swapped' } }))
    );
    for (const key of ['status', 'unclassified', 'missingDeletable', 'missingNever', 'tenantTables', 'fingerprint'] as const) {
      expect(relabelled[key]).toEqual(real[key]);
    }
  });

  // DE-4: ten included tables, was two (profiles, plugin_connections).
  // DE-4 (user 2026-10-15): nine, plugin_connections is excluded (connected apps out).
  // DE-3: thirteen, + business_addresses, business_profiles, notification_settings, user_preferences.
  it('the real set: drift is computed for every included table', () => {
    // Every real include column live, plus one unclassified live column each.
    const columns = PURGE_DESCRIPTORS.flatMap((x) =>
      x.export.kind === 'include'
        ? [...x.export.columns, ...Object.keys(x.export.excludedColumns ?? {}), 'zz_unclassified'].map((c) => ({ table_name: x.table, column_name: c }))
        : [{ table_name: x.table, column_name: 'id' }]
    );
    const r = reconcileSchema({ columns, foreign_keys: [] }, PURGE_DESCRIPTORS);
    const included = PURGE_DESCRIPTORS.filter((x) => x.export.kind === 'include').map((x) => x.table).sort();
    expect(included).toEqual([
      'business_addresses', 'business_profiles',
      'contact_documents', 'crm_activities', 'crm_contacts', 'crm_pipeline_stages', 'crm_tasks', 'notification_settings', 'profiles',
      'scheduling_availability_exceptions', 'scheduling_bookings', 'scheduling_services', 'user_preferences',
    ]);
    expect(r.exportColumnDrift).toEqual(included.map((table) => ({ table, column: 'zz_unclassified' })));
    expect(r.exportColumnsMissing).toEqual([]);
  });

  it('an unreadable result carries empty drift lists', async () => {
    introspectSchema.mockResolvedValueOnce({ data: null, error: new Error('nope') });
    const r = await runSchemaReconciler({ descriptors: FIXTURE_DESCRIPTORS });
    expect(r.status).toBe('unreadable');
    expect(r.exportColumnDrift).toEqual([]);
    expect(r.exportColumnsMissing).toEqual([]);
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

  // QA AD-1a edge case 1: no data AND no error is not an empty schema.
  it('a repository reply with no data and no error becomes unreadable, never ok', async () => {
    introspectSchema.mockResolvedValue({ data: null, error: null });
    const r = await runSchemaReconciler();
    expect(r.status).toBe('unreadable');
    expect(r.fingerprint).toBeNull();
    expect(r.error).toBe('schema introspection returned no data');
  });
});
