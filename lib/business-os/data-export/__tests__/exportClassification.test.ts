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

// sections.ts imports the repositories; only its registry is read here.
jest.mock('@/lib/repositories/UserProfileRepository', () => ({ userProfileRepository: {} }));
jest.mock('@/lib/repositories/BusinessDataExportRepository', () => ({ businessDataExportRepository: {} }));

import { PURGE_DESCRIPTORS, STORAGE_DESCRIPTORS } from '@/lib/business-os/purge/descriptors';
import type { PurgeDescriptor } from '@/lib/business-os/purge/types';
import { EXPORT_SECTIONS } from '@/lib/business-os/data-export/sections';
import { NON_TABLE_SECTIONS } from '@/lib/business-os/data-export/classificationTypes';
import {
  DENY_EXCEPTIONS,
  ExportClassificationError,
  exportClassificationOf,
  exportColumnDrift,
  exportColumnsMissing,
  exportColumnsOf,
  exportDescriptorOfSection,
  isDeniedColumn,
  rowFilterInList,
  rowFilterNullabilityProblems,
  sectionRegistryProblems,
  staleDenyExceptions,
  storageExportProblems,
  tableExportProblems,
} from '@/lib/business-os/data-export/classification';

/**
 * DE-4 U-2 fixture (SA-Q10): the live columns of the eight client_records
 * tables, verbatim and in live order from the T-0 Q1 output (DE-4 workplan
 * §10.1, prod, 2026-10-15). JSON, not .ts: every .ts under __tests__ is a
 * suite. A migration adding a column to one of these tables adds it here AND
 * classifies it in its descriptor. `is_nullable` is carried for the rowFilter
 * column only (SA C-6).
 */
import DE4_LIVE_FIXTURE from './fixtures/de4-live-columns.json';

type LiveColumn = { table_name: string; column_name: string; is_nullable?: string };
const DE4_LIVE_COLUMN_COUNTS: Record<string, number> = DE4_LIVE_FIXTURE.counts;
const DE4_NULLABILITY: Record<string, string> = DE4_LIVE_FIXTURE.is_nullable;
const DE4_LIVE_COLUMNS: LiveColumn[] = Object.entries(DE4_LIVE_FIXTURE.tables as Record<string, string[]>).flatMap(
  ([table_name, columns]) =>
    columns.map((column_name) => {
      const nullable = DE4_NULLABILITY[`${table_name}.${column_name}`];
      return nullable ? { table_name, column_name, is_nullable: nullable } : { table_name, column_name };
    })
);

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

  // DE-4 (user 2026-10-15): driven through stage_key, was plugin_key. The
  // plugin_connections.plugin_key exception left with the connected-apps section.
  it('stage_key passes only through its reviewed exception', () => {
    expect(isDeniedColumn('crm_pipeline_stages', 'stage_key')).toBe(false);
    expect(isDeniedColumn('crm_pipeline_stages', 'stage_key', {})).toBe(true);
    expect(isDeniedColumn('some_other_table', 'stage_key')).toBe(true);
    // DE-4 (user 2026-10-15): plugin_connections.plugin_key removed; it is denied again.
    expect(isDeniedColumn('plugin_connections', 'plugin_key')).toBe(true);
    expect(Object.keys(DENY_EXCEPTIONS)).toEqual(['crm_pipeline_stages.stage_key']);
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
    // DE-4: + the eight client_records sections. DE-4 (user 2026-10-15):
    // plugin_connections removed, so the registry is 2 + 8, was 3 + 8.
    expect(sectionIds).toEqual([
      'account_identity', 'user_profile',
      'pipeline_stages', 'clients', 'client_activities', 'client_tasks', 'client_documents', 'services', 'bookings', 'time_off',
    ]);
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

  // DE-4: the planted table is business_profiles (still planned, DE-3), was
  // crm_tasks, which now backs client_tasks.
  it('negative control: a descriptor naming an unknown section', () => {
    const unknown = PURGE_DESCRIPTORS.map((d) =>
      d.table === 'business_profiles' ? ({ ...d, export: { kind: 'include', section: 'client_records', columns: ['id'] } } as unknown as PurgeDescriptor) : d
    );
    expect(sectionRegistryProblems(unknown, sectionIds, NON_TABLE_SECTIONS)).toEqual([
      'business_profiles: names unknown section client_records',
    ]);
  });

  it('negative control: two descriptors on one section, and an include on a non-table section', () => {
    const two = PURGE_DESCRIPTORS.map((d) =>
      d.table === 'business_profiles' ? { ...d, export: { kind: 'include' as const, section: 'user_profile' as const, columns: ['id'] } } : d
    );
    expect(sectionRegistryProblems(two, sectionIds, NON_TABLE_SECTIONS)).toEqual([
      'user_profile: expected exactly one include descriptor, found 2 (business_profiles, profiles)',
    ]);
    const onIdentity = PURGE_DESCRIPTORS.map((d) =>
      d.table === 'business_profiles' ? { ...d, export: { kind: 'include' as const, section: 'account_identity' as const, columns: ['id'] } } : d
    );
    expect(sectionRegistryProblems(onIdentity, sectionIds, NON_TABLE_SECTIONS)).toEqual([
      'account_identity: a non-table section has include descriptors (business_profiles)',
    ]);
  });

  it('negative control: a non-table section that is no longer registered', () => {
    // DE-4: the registry minus account_identity, was ['user_profile', 'plugin_connections'];
    // DE-4 (user 2026-10-15): plugin_connections is no longer in the registry.
    const withoutIdentity = sectionIds.filter((id) => id !== 'account_identity');
    expect(sectionRegistryProblems(PURGE_DESCRIPTORS, withoutIdentity, NON_TABLE_SECTIONS)).toEqual([
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
  const CONNECTED_APPS_REASON =
    'user 2026-10-15: connected apps dropped from the export (business data only); see lawyer note §0.2 DX-1';

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
    // DE-4 (user 2026-10-15): connected apps are excluded with the user's wording, was include/plugin_connections.
    const conn = get('plugin_connections');
    if (!(conn?.kind === 'exclude' && conn.reason === CONNECTED_APPS_REASON)) problems.push("plugin_connections must be excluded with the user's wording");
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
    // DE-4 (user 2026-10-15): re-including connected apps, or rewording the reason, fails the pin.
    const reincluded = PURGE_DESCRIPTORS.map((d) =>
      d.table === 'plugin_connections'
        ? { ...d, export: { kind: 'include' as const, section: 'user_profile' as const, columns: ['plugin_name'] } }
        : d
    );
    expect(pinProblems(reincluded)).toEqual(["plugin_connections must be excluded with the user's wording"]);
    const connReworded = PURGE_DESCRIPTORS.map((d) =>
      d.table === 'plugin_connections' ? { ...d, export: { kind: 'exclude' as const, reason: 'connected apps' } } : d
    );
    expect(pinProblems(connReworded)).toEqual(["plugin_connections must be excluded with the user's wording"]);
  });
});

// DE-4 (user 2026-10-15): was "T-9 plugin_connections: tokens out, disconnected
// rows in, profile_data allow-listed (SA C-4)". The table is now excluded
// whole, so no column of it (token or not) can be selected.
describe('T-9 plugin_connections: excluded whole, never read by the export (user 2026-10-15)', () => {
  it('is exclude, and exportColumnsOf refuses it (not_included)', () => {
    expect(exportClassificationOf('plugin_connections')?.kind).toBe('exclude');
    expect(() => exportColumnsOf('plugin_connections')).toThrow(ExportClassificationError);
  });

  it('its notes no longer claim the export reads it', () => {
    const notes = byTable.get('plugin_connections')?.notes ?? '';
    expect(notes).not.toMatch(/ACCOUNT_PROFILE_KEYS/);
    expect(notes).toMatch(/never reads this table/);
  });

  it('no section of the registry is backed by it', () => {
    expect(sectionIds as string[]).not.toContain('plugin_connections');
  });
});

describe('T-10 exportColumnsOf fails closed', () => {
  it('returns the include columns in descriptor order', () => {
    // DE-4 (user 2026-10-15): profiles, was plugin_connections (now excluded).
    expect(exportColumnsOf('profiles')[0]).toBe('id');
    expect(exportColumnsOf('profiles')).toHaveLength(17);
  });

  it.each([
    ['audit_logs', 'not_included'],
    // DE-4: was crm_contacts, now included; business_profiles is still planned (DE-3).
    ['business_profiles', 'not_included'],
    ['external_calendar_events', 'not_included'],
    // DE-4 (user 2026-10-15): connected apps left the export.
    ['plugin_connections', 'not_included'],
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
    // And a deny exception is honoured only through the map (DE-4 user 2026-10-15: stage_key, was plugin_key).
    expect(() => exportColumnsOf('crm_pipeline_stages', PURGE_DESCRIPTORS, {})).toThrow(/stage_key/);
  });

  it('throws for a malformed column', () => {
    const planted = PURGE_DESCRIPTORS.map((d) =>
      d.table === 'profiles' ? { ...d, export: { kind: 'include' as const, section: 'user_profile' as const, columns: ['*'] } } : d
    );
    expect(() => exportColumnsOf('profiles', planted)).toThrow(/malformed/);
  });
});

// ── DE-4 (BUSINESS_OS_DATA_EXPORT_DE4_WORKPLAN.md §3, §8; SA review DE-4) ────

/** DE-4 U-1: the eight include lists and the one exclude, pinned literally. */
const DE4_PINS: Record<string, { section: string; columns: string[]; excluded: string[] }> = {
  crm_pipeline_stages: {
    section: 'pipeline_stages',
    columns: ['id', 'vertical', 'stage_key', 'stage_label', 'position', 'color', 'stage_type', 'is_primary_client_stage', 'created_at'],
    excluded: ['user_id'],
  },
  crm_contacts: {
    section: 'clients',
    columns: [
      'id', 'first_name', 'last_name', 'email', 'phone', 'stage', 'stage_entered_at', 'tags', 'custom_fields', 'notes',
      'source', 'source_metadata', 'referrer_domain', 'utm_source', 'utm_medium', 'utm_campaign', 'created_at', 'updated_at',
    ],
    excluded: ['user_id'],
  },
  crm_activities: {
    section: 'client_activities',
    columns: [
      'id', 'contact_id', 'activity_type', 'title', 'description', 'activity_date', 'auto_logged', 'source_capability',
      'source_entity_id', 'created_at',
    ],
    excluded: ['user_id'],
  },
  crm_tasks: {
    section: 'client_tasks',
    columns: [
      'id', 'contact_id', 'title', 'description', 'priority', 'status', 'due_date', 'reminder_at', 'completed_at',
      'created_by', 'source_entity_type', 'source_entity_id', 'tags', 'created_at', 'updated_at',
    ],
    excluded: ['user_id'],
  },
  contact_documents: {
    section: 'client_documents',
    columns: [
      'id', 'contact_id', 'name', 'document_type', 'file_name', 'file_size', 'mime_type', 'description', 'tags', 'status',
      'created_at', 'updated_at',
    ],
    excluded: ['user_id', 'storage_path', 'storage_bucket'],
  },
  scheduling_services: {
    section: 'services',
    columns: [
      'id', 'service_name', 'description', 'duration_minutes', 'price', 'currency', 'buffer_minutes', 'max_bookings_per_day',
      'advance_booking_days', 'min_notice_hours', 'availability', 'is_active', 'status', 'is_scheduled', 'collection',
      'sale_mode', 'payment_type', 'installment_count', 'installment_frequency', 'first_payment_due', 'first_payment_days',
      'source', 'created_at', 'updated_at',
    ],
    excluded: ['user_id', 'ai_suggestions'],
  },
  scheduling_bookings: {
    section: 'bookings',
    columns: [
      'id', 'service_id', 'contact_id', 'parent_booking_id', 'occurrence_number', 'start_time', 'end_time', 'timezone',
      'status', 'cancellation_reason', 'cancel_reason', 'cancel_note', 'cancelled_by', 'booking_source', 'notes',
      'internal_notes', 'payment_status', 'payment_method', 'payment_amount', 'payment_currency', 'payment_id', 'invoice_id',
      'payment_plan_id', 'intake_responses', 'intake_completed_at', 'created_at', 'updated_at',
    ],
    excluded: [
      'user_id', 'reminder_24hr_sent', 'reminder_2hr_sent', 'intake_sent_at', 'intake_reminded_at',
      'external_calendar_event_id', 'calendar_sync_provider', 'calendar_synced_at', 'calendar_sync_error',
    ],
  },
  scheduling_availability_exceptions: {
    section: 'time_off',
    columns: ['id', 'exception_type', 'start_date', 'end_date', 'custom_hours', 'reason', 'created_at'],
    excluded: ['user_id'],
  },
};

const CALENDAR_REASON = "user 2026-10-15: synced copy of the owner's own external calendar, not Business OS data";
const OWNER_ID_REASON = 'always the exporting account; it is in export_metadata.user_id';

/** The DE-4 pins as a pure check, so a planted copy can be run through it (negative control). */
function de4PinProblems(ds: readonly PurgeDescriptor[]): string[] {
  const problems: string[] = [];
  for (const [table, pin] of Object.entries(DE4_PINS)) {
    const e = ds.find((d) => d.table === table)?.export;
    if (e?.kind !== 'include') {
      problems.push(`${table} must be include`);
      continue;
    }
    if (e.section !== pin.section) problems.push(`${table} must be section ${pin.section}`);
    if (JSON.stringify(e.columns) !== JSON.stringify(pin.columns)) problems.push(`${table} columns changed`);
    if (JSON.stringify(Object.keys(e.excludedColumns ?? {})) !== JSON.stringify(pin.excluded)) problems.push(`${table} excludedColumns changed`);
    if (e.excludedColumns?.user_id !== OWNER_ID_REASON) problems.push(`${table} user_id must carry the OWNER_ID reason`);
  }
  const calendar = ds.find((d) => d.table === 'external_calendar_events')?.export;
  if (!(calendar?.kind === 'exclude' && calendar.reason === CALENDAR_REASON)) {
    problems.push("external_calendar_events must be excluded with the user's wording (BC-5)");
  }
  if (ds.some((d) => d.export?.kind === 'planned' && d.export.slice === 'DE-4')) problems.push('a table is still planned for DE-4');
  return problems;
}

describe('DE-4 U-1 the client-record classifications are pinned', () => {
  it('eight include, one exclude, no DE-4 planned row left', () => {
    expect(de4PinProblems(PURGE_DESCRIPTORS)).toEqual([]);
    expect(PURGE_DESCRIPTORS.filter((d) => d.export.kind === 'planned' && d.export.slice === 'DE-4')).toEqual([]);
  });

  it('every excludedColumns reason is non-empty', () => {
    for (const table of Object.keys(DE4_PINS)) {
      const e = exportClassificationOf(table);
      if (e?.kind !== 'include') throw new Error(`${table} not include`);
      for (const reason of Object.values(e.excludedColumns ?? {})) expect(reason.trim().length).toBeGreaterThan(10);
    }
  });

  it('BC-6 / BC-7 / BC-1 decisions: markers and ai_suggestions out, internal_notes and intake answers in', () => {
    const bookings = exportClassificationOf('scheduling_bookings');
    const services = exportClassificationOf('scheduling_services');
    if (bookings?.kind !== 'include' || services?.kind !== 'include') throw new Error('not include');
    for (const c of ['reminder_24hr_sent', 'reminder_2hr_sent', 'intake_sent_at', 'intake_reminded_at']) {
      expect(bookings.excludedColumns?.[c]).toMatch(/BC-6/);
    }
    expect(services.excludedColumns?.ai_suggestions).toMatch(/BC-7/);
    for (const c of ['internal_notes', 'intake_responses', 'intake_completed_at']) expect(bookings.columns).toContain(c);
    expect(services.columns.indexOf('currency')).toBeGreaterThan(-1);
    expect(bookings.columns).toContain('payment_currency');
  });

  it('negative controls: a re-planned table, a column moved into columns, a reworded calendar reason', () => {
    const replanned = PURGE_DESCRIPTORS.map((d) =>
      d.table === 'crm_tasks' ? { ...d, export: { kind: 'planned' as const, slice: 'DE-4' as const } } : d
    );
    expect(de4PinProblems(replanned)).toEqual(['crm_tasks must be include', 'a table is still planned for DE-4']);
    const moved = PURGE_DESCRIPTORS.map((d) => {
      if (d.table !== 'scheduling_bookings' || d.export.kind !== 'include') return d;
      const { calendar_sync_error: _moved, ...rest } = d.export.excludedColumns ?? {};
      void _moved;
      return { ...d, export: { ...d.export, columns: [...d.export.columns, 'calendar_sync_error'], excludedColumns: rest } };
    });
    expect(de4PinProblems(moved)).toEqual(['scheduling_bookings columns changed', 'scheduling_bookings excludedColumns changed']);
    const reworded = PURGE_DESCRIPTORS.map((d) =>
      d.table === 'external_calendar_events' ? { ...d, export: { kind: 'exclude' as const, reason: 'calendar' } } : d
    );
    expect(de4PinProblems(reworded)).toEqual(["external_calendar_events must be excluded with the user's wording (BC-5)"]);
  });
});

describe('DE-4 U-2 the declared lists match the live columns (T-0 Q1 fixture, SA-Q10)', () => {
  const de4Tables = Object.keys(DE4_PINS);

  it('the fixture is the measured state: eight tables, Q2 counts', () => {
    const counts: Record<string, number> = {};
    for (const c of DE4_LIVE_COLUMNS) counts[c.table_name] = (counts[c.table_name] ?? 0) + 1;
    expect(counts).toEqual(DE4_LIVE_COLUMN_COUNTS);
    expect(Object.keys(counts).sort()).toEqual([...de4Tables].sort());
  });

  it('no drift and nothing missing for the eight tables', () => {
    expect(exportColumnDrift(DE4_LIVE_COLUMNS).filter((r) => de4Tables.includes(r.table))).toEqual([]);
    expect(exportColumnsMissing(DE4_LIVE_COLUMNS).filter((r) => de4Tables.includes(r.table))).toEqual([]);
    // Every live column is decided: columns + excludedColumns = the live set, exactly.
    for (const table of de4Tables) {
      const e = exportClassificationOf(table);
      if (e?.kind !== 'include') throw new Error(`${table} not include`);
      const decided = [...e.columns, ...Object.keys(e.excludedColumns ?? {})].sort();
      expect(decided).toEqual(DE4_LIVE_COLUMNS.filter((c) => c.table_name === table).map((c) => c.column_name).sort());
    }
  });

  it('negative controls: an extra live column is drift; a declared column missing live is reported', () => {
    const extra = [...DE4_LIVE_COLUMNS, { table_name: 'crm_contacts', column_name: 'brand_new_column' }];
    expect(exportColumnDrift(extra).filter((r) => de4Tables.includes(r.table))).toEqual([
      { table: 'crm_contacts', column: 'brand_new_column' },
    ]);
    const without = DE4_LIVE_COLUMNS.filter((c) => !(c.table_name === 'scheduling_bookings' && c.column_name === 'cancel_note'));
    expect(exportColumnsMissing(without).filter((r) => de4Tables.includes(r.table))).toEqual([
      { table: 'scheduling_bookings', column: 'cancel_note' },
    ]);
  });
});

describe('DE-4 U-3 stage_key passes only through its reviewed exception (SA-Q5)', () => {
  it('excused by DENY_EXCEPTIONS, and the exception is not stale', () => {
    expect(isDeniedColumn('crm_pipeline_stages', 'stage_key')).toBe(false);
    expect(DENY_EXCEPTIONS['crm_pipeline_stages.stage_key']).toMatch(/not a credential/);
    expect(staleDenyExceptions()).toEqual([]);
  });

  it('negative control: without the entry the T-4 deny check flags it', () => {
    const { 'crm_pipeline_stages.stage_key': _dropped, ...without } = DENY_EXCEPTIONS;
    void _dropped;
    expect(isDeniedColumn('crm_pipeline_stages', 'stage_key', without)).toBe(true);
    expect(tableExportProblems(byTable.get('crm_pipeline_stages')!, { plannedAllowed: true, exceptions: without })).toEqual([
      'crm_pipeline_stages: column stage_key is on the secret deny list',
    ]);
    expect(() => exportColumnsOf('crm_pipeline_stages', PURGE_DESCRIPTORS, without)).toThrow(/stage_key/);
  });
});

describe('DE-4 U-4 rowFilter rules (SA-Q2, C-6)', () => {
  it('only contact_documents has one: status not in (deleted), with a reason', () => {
    const withFilter = PURGE_DESCRIPTORS.filter((d) => d.export.kind === 'include' && d.export.rowFilter);
    expect(withFilter.map((d) => d.table)).toEqual(['contact_documents']);
    const e = exportClassificationOf('contact_documents');
    if (e?.kind !== 'include' || !e.rowFilter) throw new Error('no rowFilter');
    expect(e.rowFilter.column).toBe('status');
    expect(e.rowFilter.notIn).toEqual(['deleted']);
    expect(e.rowFilter.reason).toMatch(/SQ-E5/);
    // Archived is a status, not a delete (BC-3).
    expect(e.rowFilter.notIn).not.toContain('archived');
    expect(rowFilterInList(e.rowFilter)).toBe('("deleted")');
  });

  const docs = (rowFilter: unknown) => {
    const real = exportClassificationOf('contact_documents');
    if (real?.kind !== 'include') throw new Error('not include');
    return withExport('contact_documents', { ...real, rowFilter });
  };

  it.each([
    [{ column: 'storage_path', notIn: ['deleted'], reason: 'r' }, 'contact_documents: rowFilter column "storage_path" is not a declared column'],
    [{ column: 'status', notIn: [], reason: 'r' }, 'contact_documents: rowFilter needs a non-empty notIn list'],
    [{ column: 'status', notIn: ['deleted'], reason: '  ' }, 'contact_documents: rowFilter has no reason'],
    [{ column: 'status', notIn: ['de leted'], reason: 'r' }, 'contact_documents: rowFilter value "de leted" is not a plain word'],
    ['status', 'contact_documents: rowFilter must be { column, notIn, reason }'],
  ])('negative control: %j is flagged', (rowFilter, problem) => {
    expect(tableProblems([docs(rowFilter)])).toEqual([problem]);
  });

  it('rowFilterInList refuses a value that would need escaping', () => {
    expect(() => rowFilterInList({ column: 'status', notIn: ['a,b'], reason: 'r' })).toThrow(ExportClassificationError);
  });

  it('C-6: the filter column is NOT NULL live (fixture, from §10.1)', () => {
    expect(rowFilterNullabilityProblems(DE4_LIVE_COLUMNS)).toEqual([]);
  });

  it('negative controls: a nullable or unknown-nullability filter column is flagged', () => {
    const nullable = DE4_LIVE_COLUMNS.map((c) =>
      c.table_name === 'contact_documents' && c.column_name === 'status' ? { ...c, is_nullable: 'YES' } : c
    );
    expect(rowFilterNullabilityProblems(nullable)).toEqual([
      'contact_documents: rowFilter column status is not NOT NULL live (is_nullable "YES")',
    ]);
    const unknown = DE4_LIVE_COLUMNS.map((c) => ({ table_name: c.table_name, column_name: c.column_name }));
    expect(rowFilterNullabilityProblems(unknown)).toEqual([
      'contact_documents: rowFilter column status is not NOT NULL live (is_nullable null)',
    ]);
  });
});

describe('DE-4 C-4 a section resolves to exactly one include descriptor', () => {
  it.each(Object.entries(DE4_PINS))('%s', (table, pin) => {
    expect(exportDescriptorOfSection(pin.section as never).table).toBe(table);
  });

  it('every table section of the registry resolves (the reader never takes a table name)', () => {
    for (const id of sectionIds) {
      if (id in NON_TABLE_SECTIONS) continue;
      expect(exportDescriptorOfSection(id).export.kind).toBe('include');
    }
  });

  it('negative controls: an unregistered section, and two descriptors on one section, fail closed', () => {
    expect(() => exportDescriptorOfSection('calendar_busy_times' as never)).toThrow(ExportClassificationError);
    const two = PURGE_DESCRIPTORS.map((d) =>
      d.table === 'crm_tasks' ? { ...d, export: { kind: 'include' as const, section: 'clients' as const, columns: ['id'] } } : d
    );
    expect(() => exportDescriptorOfSection('clients', two)).toThrow(/found 2/);
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
