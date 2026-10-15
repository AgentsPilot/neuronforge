/**
 * Data export classification (DE-2; BUSINESS_OS_DATA_EXPORT_DE2_WORKPLAN.md §8;
 * requirement BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md §0.3.6, FR-E17…FR-E19).
 *
 * THIS is the CI enforcement of the required `export` field. Jest is
 * transpile-only and no type gate covers lib/business-os/purge/descriptors.ts
 * (SA DE-2 review, SA-Q1 declined), so a descriptor without `export` is caught
 * here at runtime, not by `tsc`.
 *
 * Every rule is a pure function (lib/business-os/data-export/classification.ts)
 * run twice: once over the real descriptors, once over a planted bad input
 * (the negative control), so an assertion that cannot fail is visible.
 */

import fs from 'fs';
import path from 'path';

// sections.ts imports the two repositories; only its registry is read here.
jest.mock('@/lib/repositories/UserProfileRepository', () => ({ userProfileRepository: {} }));
jest.mock('@/lib/repositories/PluginConnectionRepository', () => ({ pluginConnectionRepository: {} }));

import { PURGE_DESCRIPTORS, STORAGE_DESCRIPTORS } from '@/lib/business-os/purge/descriptors';
import type { PurgeDescriptor } from '@/lib/business-os/purge/types';
import { EXPORT_SECTIONS } from '@/lib/business-os/data-export/sections';
import { NON_TABLE_SECTIONS } from '@/lib/business-os/data-export/classificationTypes';
import {
  DENY_EXCEPTIONS,
  ExportClassificationError,
  exportClassificationOf,
  exportColumnsOf,
  isDeniedColumn,
  sectionRegistryProblems,
  staleDenyExceptions,
  storageExportProblems,
  tableExportProblems,
} from '@/lib/business-os/data-export/classification';

/**
 * `planned` expires. DE-7 flips the table flag to false (every table is then
 * include or exclude); DE-8b flips the files flag. Two flags because files
 * arrive after DE-7 (SA-Q2).
 */
const PLANNED_TABLES_ALLOWED = true;
const PLANNED_FILES_ALLOWED = true;

const REPO = path.join(__dirname, '..', '..', '..', '..');
const PURGE_DIR = path.join(REPO, 'lib', 'business-os', 'purge');

const tableProblems = (ds: readonly { table: string; export?: unknown }[], plannedAllowed = PLANNED_TABLES_ALLOWED) =>
  ds.flatMap((d) => tableExportProblems(d, { plannedAllowed }));
const bucketProblems = (ds: readonly { bucket: string; export?: unknown }[], plannedAllowed = PLANNED_FILES_ALLOWED) =>
  ds.flatMap((d) => storageExportProblems(d, { plannedAllowed }));

const byTable = new Map(PURGE_DESCRIPTORS.map((d) => [d.table, d] as const));
/** A real descriptor with its `export` replaced, for negative controls. */
const withExport = (table: string, value: unknown) => ({ ...byTable.get(table)!, export: value });
const sectionIds = EXPORT_SECTIONS.map((s) => s.id);

describe('T-1 every descriptor carries a valid export classification', () => {
  it('every table descriptor (non-vacuous)', () => {
    expect(PURGE_DESCRIPTORS.length).toBeGreaterThan(150);
    expect(tableProblems(PURGE_DESCRIPTORS)).toEqual([]);
  });

  it('every storage descriptor (non-vacuous)', () => {
    expect(STORAGE_DESCRIPTORS.length).toBeGreaterThanOrEqual(3);
    expect(bucketProblems(STORAGE_DESCRIPTORS)).toEqual([]);
  });

  it('negative controls: no export, an unknown kind, a bucket shaped like a table', () => {
    const { export: _dropped, ...noExport } = byTable.get('crm_tasks')!;
    void _dropped;
    expect(tableProblems([noExport])).toEqual(['crm_tasks: no export classification']);
    expect(tableProblems([withExport('crm_tasks', { kind: 'maybe' })])).toEqual(['crm_tasks: unknown export kind "maybe"']);
    expect(
      bucketProblems([{ bucket: 'x', export: { kind: 'include', folder: 'f', columns: ['id'] } }])
    ).toEqual(['x: a bucket has no columns or section']);
    expect(bucketProblems([{ bucket: 'x' }])).toEqual(['x: no export classification']);
    expect(bucketProblems([{ bucket: 'x', export: { kind: 'include', folder: ' ' } }])).toEqual(['x: include without a folder']);
  });
});

describe('T-2 an exclude carries a reason', () => {
  it('negative control: a blank reason is flagged, for tables and buckets', () => {
    expect(tableProblems([withExport('email_sends', { kind: 'exclude', reason: '  ' })])).toEqual([
      'email_sends: exclude without a reason',
    ]);
    expect(bucketProblems([{ bucket: 'x', export: { kind: 'exclude', reason: '' } }])).toEqual(['x: exclude without a reason']);
  });
});

describe('T-3 an include lists explicit, well-formed columns', () => {
  it.each([
    [[], 'profiles: include needs a non-empty column list'],
    [['*'], 'profiles: malformed column "*"'],
    [['a, b'], 'profiles: malformed column "a, b"'],
    [['id', 'id'], 'profiles: duplicate column id'],
    [['Id'], 'profiles: malformed column "Id"'],
  ])('negative control: %j is flagged', (columns, problem) => {
    expect(tableProblems([withExport('profiles', { kind: 'include', section: 'user_profile', columns })])).toEqual([problem]);
  });

  it('negative control: an include with no section is flagged', () => {
    expect(tableProblems([withExport('profiles', { kind: 'include', columns: ['id'] })])).toEqual([
      'profiles: include without a section',
    ]);
  });
});

describe('T-4 no secret column is ever in an include list', () => {
  it('the real include lists pass the deny list', () => {
    for (const d of PURGE_DESCRIPTORS) {
      if (d.export.kind !== 'include') continue;
      expect(d.export.columns.filter((c) => isDeniedColumn(d.table, c))).toEqual([]);
    }
  });

  it.each(['access_token', 'stripe_secret_key', 'credentials', 'provider_cost_usd', 'refresh_token', 'password_hash', 'total_cost_usd'])(
    'negative control: a planted %s is flagged',
    (column) => {
      const planted = withExport('profiles', { kind: 'include', section: 'user_profile', columns: ['id', column] });
      expect(tableProblems([planted])).toEqual([`profiles: column ${column} is on the secret deny list`]);
    }
  );

  it('plugin_key passes only through its reviewed exception', () => {
    expect(isDeniedColumn('plugin_connections', 'plugin_key')).toBe(false);
    expect(isDeniedColumn('plugin_connections', 'plugin_key', {})).toBe(true);
    expect(isDeniedColumn('some_other_table', 'plugin_key')).toBe(true);
    expect(Object.keys(DENY_EXCEPTIONS)).toEqual(['plugin_connections.plugin_key']);
  });

  it('no exception is stale, and a stale one is flagged (negative control)', () => {
    expect(staleDenyExceptions()).toEqual([]);
    expect(
      staleDenyExceptions(PURGE_DESCRIPTORS, { ...DENY_EXCEPTIONS, 'profiles.dedupe_key': 'not a real included column' })
    ).toEqual(['profiles.dedupe_key']);
    // An exception for a column that is included but not denied is stale too.
    expect(staleDenyExceptions(PURGE_DESCRIPTORS, { 'profiles.full_name': 'not a deny hit' })).toEqual(['profiles.full_name']);
  });
});

describe('T-5 excludedColumns: disjoint from columns, each with a reason', () => {
  it('negative controls: an overlap and an empty reason are flagged', () => {
    const planted = withExport('profiles', {
      kind: 'include',
      section: 'user_profile',
      columns: ['id', 'full_name'],
      excludedColumns: { full_name: 'overlap', plan: ' ' },
    });
    expect(tableProblems([planted])).toEqual([
      'profiles: full_name is both included and excluded',
      'profiles: excluded column plan has no reason',
    ]);
  });
});

describe('T-6 the section registry and the descriptors agree (SA-Q8)', () => {
  it('real registry: each include names a section, each table section has exactly one include', () => {
    expect(sectionIds).toEqual(['account_identity', 'user_profile', 'plugin_connections']);
    expect(sectionRegistryProblems(PURGE_DESCRIPTORS, sectionIds, NON_TABLE_SECTIONS)).toEqual([]);
  });

  it('negative control: a section with no descriptor', () => {
    const withoutProfileInclude = PURGE_DESCRIPTORS.map((d) =>
      d.table === 'profiles' ? { ...d, export: { kind: 'exclude' as const, reason: 'x' } } : d
    );
    expect(sectionRegistryProblems(withoutProfileInclude, sectionIds, NON_TABLE_SECTIONS)).toEqual([
      'user_profile: expected exactly one include descriptor, found 0',
    ]);
  });

  it('negative control: a descriptor naming an unknown section', () => {
    const unknown = PURGE_DESCRIPTORS.map((d) =>
      d.table === 'crm_tasks' ? ({ ...d, export: { kind: 'include', section: 'client_records', columns: ['id'] } } as unknown as PurgeDescriptor) : d
    );
    expect(sectionRegistryProblems(unknown, sectionIds, NON_TABLE_SECTIONS)).toEqual([
      'crm_tasks: names unknown section client_records',
    ]);
  });

  it('negative control: two descriptors on one section, and an include on a non-table section', () => {
    const two = PURGE_DESCRIPTORS.map((d) =>
      d.table === 'crm_tasks' ? { ...d, export: { kind: 'include' as const, section: 'user_profile' as const, columns: ['id'] } } : d
    );
    expect(sectionRegistryProblems(two, sectionIds, NON_TABLE_SECTIONS)).toEqual([
      'user_profile: expected exactly one include descriptor, found 2 (crm_tasks, profiles)',
    ]);
    const onIdentity = PURGE_DESCRIPTORS.map((d) =>
      d.table === 'crm_tasks' ? { ...d, export: { kind: 'include' as const, section: 'account_identity' as const, columns: ['id'] } } : d
    );
    expect(sectionRegistryProblems(onIdentity, sectionIds, NON_TABLE_SECTIONS)).toEqual([
      'account_identity: a non-table section has include descriptors (crm_tasks)',
    ]);
  });

  it('negative control: a non-table section that is no longer registered', () => {
    expect(sectionRegistryProblems(PURGE_DESCRIPTORS, ['user_profile', 'plugin_connections'], NON_TABLE_SECTIONS)).toEqual([
      'account_identity: listed as a non-table section but not registered',
    ]);
  });
});

describe('T-7 planned expires (DE-7 for tables, DE-8b for files)', () => {
  it('planned rows name a known slice', () => {
    const planned = PURGE_DESCRIPTORS.filter((d) => d.export.kind === 'planned');
    expect(planned.length).toBeGreaterThan(0);
    expect(tableProblems(planned, true)).toEqual([]);
  });

  it('with the table flag false, every planned table is reported (the DE-7 flip will bite)', () => {
    const planned = PURGE_DESCRIPTORS.filter((d) => d.export.kind === 'planned').map((d) => d.table);
    const reported = tableProblems(PURGE_DESCRIPTORS, false);
    expect(reported).toHaveLength(planned.length);
    for (const t of planned) expect(reported.some((p) => p.startsWith(`${t}: still planned`))).toBe(true);
  });

  it('with the files flag false, every planned bucket is reported (the DE-8b flip will bite)', () => {
    const planned = STORAGE_DESCRIPTORS.filter((s) => s.export.kind === 'planned');
    expect(planned.length).toBeGreaterThan(0);
    expect(bucketProblems(STORAGE_DESCRIPTORS, false)).toHaveLength(planned.length);
  });

  it('negative control: a table planned for a file slice, a bucket planned for a table slice', () => {
    expect(tableProblems([withExport('crm_tasks', { kind: 'planned', slice: 'DE-8b' })])).toEqual([
      'crm_tasks: planned for an unknown slice "DE-8b"',
    ]);
    expect(bucketProblems([{ bucket: 'x', export: { kind: 'planned', slice: 'DE-4' } }])).toEqual([
      'x: planned for an unknown slice "DE-4"',
    ]);
  });
});

describe('T-8 the ruled pins', () => {
  const AGENTS_REASON = 'not Business OS data (user 2026-10-14)';

  /** The pinned classifications; a pure check so a flipped copy can be run through it. */
  const pinProblems = (ds: readonly PurgeDescriptor[]): string[] => {
    const get = (t: string) => ds.find((d) => d.table === t)?.export;
    const problems: string[] = [];
    for (const t of ['agents', 'agent_configurations']) {
      const e = get(t);
      if (!(e?.kind === 'exclude' && e.reason === AGENTS_REASON)) problems.push(`${t} must be excluded with the user's wording`);
    }
    const mustExclude = [
      'audit_trail', 'archived_records', 'audit_logs', 'email_sends', 'website_page_views', 'smart_link_clicks',
      'onboarding_conversations', 'user_subscriptions', 'credit_transactions', 'business_os_invites',
      'user_capabilities', 'user_capability_blocks', 'organizations', 'organization_members',
      ...ds.map((d) => d.table).filter((t) => t.startsWith('business_os_credit_') || t.startsWith('business_os_billing_')),
    ];
    for (const t of mustExclude) if (get(t)?.kind !== 'exclude') problems.push(`${t} must be excluded`);
    const profile = get('profiles');
    if (!(profile?.kind === 'include' && profile.section === 'user_profile')) problems.push('profiles must be include/user_profile');
    const conn = get('plugin_connections');
    if (!(conn?.kind === 'include' && conn.section === 'plugin_connections')) problems.push('plugin_connections must be include/plugin_connections');
    return problems;
  };

  it('hold on the real descriptors (and the billing prefixes match real tables)', () => {
    expect(PURGE_DESCRIPTORS.filter((d) => d.table.startsWith('business_os_credit_')).length).toBeGreaterThanOrEqual(4);
    expect(PURGE_DESCRIPTORS.filter((d) => d.table.startsWith('business_os_billing_')).length).toBeGreaterThanOrEqual(2);
    expect(pinProblems(PURGE_DESCRIPTORS)).toEqual([]);
  });

  it('BC-1 / BC-2 user decisions (2026-10-15) carry their reason text', () => {
    expect(exportClassificationOf('user_capabilities')).toEqual({
      kind: 'exclude',
      reason: 'PLATFORM: module setup, not data the owner entered (user 2026-10-15)',
    });
    expect(exportClassificationOf('organizations')).toEqual({
      kind: 'exclude',
      reason: 'PLATFORM: agent-platform organisation record (user 2026-10-15)',
    });
  });

  it('negative control: flipping one pinned row in a copy fails the pin', () => {
    const flipped = PURGE_DESCRIPTORS.map((d) =>
      d.table === 'audit_trail' ? { ...d, export: { kind: 'planned' as const, slice: 'DE-7' as const } } : d
    );
    expect(pinProblems(flipped)).toEqual(['audit_trail must be excluded']);
    const reworded = PURGE_DESCRIPTORS.map((d) =>
      d.table === 'agents' ? { ...d, export: { kind: 'exclude' as const, reason: 'agents' } } : d
    );
    expect(pinProblems(reworded)).toEqual(["agents must be excluded with the user's wording"]);
  });
});

describe('T-9 plugin_connections: tokens out, disconnected rows in, profile_data allow-listed (SA C-4)', () => {
  const conn = exportClassificationOf('plugin_connections');

  it('access_token and refresh_token are excluded with a reason, never included', () => {
    expect(conn?.kind).toBe('include');
    if (conn?.kind !== 'include') return;
    for (const secret of ['access_token', 'refresh_token']) {
      expect(conn.columns).not.toContain(secret);
      expect(conn.excludedColumns?.[secret]).toBeTruthy();
    }
  });

  it('its notes say disconnected rows are a status and name the ACCOUNT_PROFILE_KEYS control', () => {
    const notes = byTable.get('plugin_connections')?.notes ?? '';
    expect(notes).toMatch(/disconnected rows are a STATUS/i);
    expect(notes).toMatch(/ACCOUNT_PROFILE_KEYS/);
    expect(conn?.kind === 'include' && conn.columns.includes('profile_data')).toBe(true);
  });
});

describe('T-10 exportColumnsOf fails closed', () => {
  it('returns the include columns in descriptor order', () => {
    expect(exportColumnsOf('plugin_connections')[0]).toBe('user_id');
    expect(exportColumnsOf('profiles')).toHaveLength(17);
  });

  it.each([
    ['audit_logs', 'not_included'],
    ['crm_contacts', 'not_included'],
    ['no_such_table', 'unknown_table'],
  ])('throws for %s (%s)', (table, code) => {
    expect(() => exportColumnsOf(table)).toThrow(ExportClassificationError);
    try {
      exportColumnsOf(table);
    } catch (err) {
      expect((err as ExportClassificationError).code).toBe(code);
    }
  });

  it('throws for a deny-list column at request time, even if review missed it', () => {
    const planted = PURGE_DESCRIPTORS.map((d) =>
      d.table === 'profiles' ? { ...d, export: { kind: 'include' as const, section: 'user_profile' as const, columns: ['id', 'access_token'] } } : d
    );
    expect(() => exportColumnsOf('profiles', planted)).toThrow(/secret deny list/);
    // And the plugin_key exception is honoured only through the map.
    expect(() => exportColumnsOf('plugin_connections', PURGE_DESCRIPTORS, {})).toThrow(/plugin_key/);
  });

  it('throws for a malformed column', () => {
    const planted = PURGE_DESCRIPTORS.map((d) =>
      d.table === 'profiles' ? { ...d, export: { kind: 'include' as const, section: 'user_profile' as const, columns: ['*'] } } : d
    );
    expect(() => exportColumnsOf('profiles', planted)).toThrow(/malformed/);
  });
});

/** Source with comments and string contents removed, so only code is matched (C-5). */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g, "''");
}

/** True when the source READS a descriptor's `export` (property access or an object key). */
function readsExportField(source: string): boolean {
  const noComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  if (/\[\s*(['"`])export\1\s*\]/.test(noComments)) return true;
  const code = codeOnly(source);
  return /\.export\b/.test(code) || /(^|[{,\s])export\s*:/m.test(code);
}

describe('T-13 the purge engine is blind to export (SA-Q3, C-5)', () => {
  const engineFiles = fs
    .readdirSync(PURGE_DIR, { withFileTypes: true })
    .filter((e) => e.isFile() && /\.tsx?$/.test(e.name))
    .map((e) => e.name)
    .filter((name) => name !== 'descriptors.ts' && name !== 'types.ts');

  it('scanned the engine (non-vacuous, by name)', () => {
    expect(engineFiles).toEqual(expect.arrayContaining(['ResetService.ts', 'SchemaReconciler.ts', 'deleteGraph.ts', 'PreviewService.ts']));
  });

  it('no purge engine file other than descriptors.ts / types.ts reads export', () => {
    const offenders = engineFiles.filter((name) => readsExportField(fs.readFileSync(path.join(PURGE_DIR, name), 'utf-8')));
    expect(offenders).toEqual([]);
  });

  it('negative controls: property access, bracket access and an object key are flagged', () => {
    expect(readsExportField("if (d.export.kind === 'include') remove(d);")).toBe(true);
    expect(readsExportField("const k = d['export'];")).toBe(true);
    expect(readsExportField('const x = { table, export: e };')).toBe(true);
    expect(readsExportField('const k = d?.export;')).toBe(true);
  });

  it('negative controls: export declarations, comments, strings and look-alike names are not flagged', () => {
    expect(readsExportField('export const X = 1;\nexport function f() {}\nexport type T = string;\nexport { a };')).toBe(false);
    expect(readsExportField('// d.export.kind\n/* { export: x } */ const a = 1;')).toBe(false);
    expect(readsExportField("const msg = 'see d.export and { export: 1 }';")).toBe(false);
    expect(readsExportField('const n = result.exportColumnDrift.length; const o = { exportColumnsMissing: [] };')).toBe(false);
  });
});

describe('C-2 classification.ts closes no import cycle', () => {
  const source = fs.readFileSync(path.join(REPO, 'lib', 'business-os', 'data-export', 'classification.ts'), 'utf-8');
  const imports = [...source.matchAll(/^import[\s\S]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);

  it('imports only the descriptors, the purge types and the classification types', () => {
    expect(imports.length).toBeGreaterThan(0);
    expect(imports.filter((i) => /sections|repositories|server-only/.test(i))).toEqual([]);
    expect(new Set(imports)).toEqual(
      new Set([
        '@/lib/business-os/purge/descriptors',
        '@/lib/business-os/purge/types',
        '@/lib/business-os/data-export/classificationTypes',
      ])
    );
  });

  it('classificationTypes.ts imports nothing', () => {
    const types = fs.readFileSync(path.join(REPO, 'lib', 'business-os', 'data-export', 'classificationTypes.ts'), 'utf-8');
    expect(/^import\s/m.test(types)).toBe(false);
  });
});
