/**
 * The export section model (DE-1, BUSINESS_OS_DATA_EXPORT_DE1_WORKPLAN.md §6.1).
 *
 * Pinned: sections come out in registry order with `status`, `row_count` and
 * `rows`; a reader that returns `{ ok: false }` or throws gives a `failed`
 * section with no error text in it (FR-E12, SA C-3); `account_identity` is
 * always there; the registry's ids are unique and complete; the provider
 * profile allow-list; the file name.
 *
 * The two repositories are mocked: their own reads are pinned in
 * lib/repositories/__tests__/userDataExportReads.test.ts.
 *
 * DE-4 (BUSINESS_OS_DATA_EXPORT_DE4_WORKPLAN.md §8 U-7 / U-8): the eight
 * client_records sections, read through the mocked
 * BusinessDataExportRepository (its own reads, paging and the cross-tenant
 * test are in lib/repositories/__tests__/BusinessDataExportRepository.test.ts);
 * the source_metadata allow-list; the row ceiling. `runExportSections` now
 * returns `{ overCeiling, sections }`.
 *
 * DE-4 (user 2026-10-15): the `plugin_connections` section is gone (connected
 * apps are not exported), so its reader, its mapping and the `accountProfile`
 * allow-list cases went with it. The registry is 2 account + 8 client_records,
 * and the account rows that count toward the ceiling are 2, was 3. The file
 * name carries the time on the owner's clock.
 */

const mockFindProfile = jest.fn();
jest.mock('@/lib/repositories/UserProfileRepository', () => ({
  userProfileRepository: { findForUserDataExport: (...args: unknown[]) => mockFindProfile(...args) },
}));
const mockListOwned = jest.fn();
jest.mock('@/lib/repositories/BusinessDataExportRepository', () => ({
  businessDataExportRepository: { listOwnedRowsForExport: (...args: unknown[]) => mockListOwned(...args) },
}));

import {
  EXPORT_SECTIONS,
  SOURCE_METADATA_KEYS,
  runExportSections,
  sourceMetadata,
  type AnyExportSectionDefinition,
  type AnyExportedSection,
  type ExportContext,
  type ExportSectionId,
} from '@/lib/business-os/data-export/sections';
import { EXPORT_GROUPS, buildExportPayload, exportFileName } from '@/lib/business-os/data-export/payload';
import { EXPORT_LIMITS } from '@/lib/business-os/data-export/limits';

/** DE-4: the eight client_records sections, in registry order. */
const DE4_IDS: ExportSectionId[] = [
  'pipeline_stages', 'clients', 'client_activities', 'client_tasks', 'client_documents', 'services', 'bookings', 'time_off',
];
// DE-4 (user 2026-10-15): plugin_connections removed, was the third account section.
const ACCOUNT_IDS: ExportSectionId[] = ['account_identity', 'user_profile'];

/** Runs the registry and returns the sections, failing the test if it came back over the ceiling. */
async function runAll(ctx: ExportContext, sections: readonly AnyExportSectionDefinition[], logger: { error: (f: Record<string, unknown>, m: string) => void }): Promise<AnyExportedSection[]> {
  const run = await runExportSections(ctx, sections, logger);
  if (run.overCeiling) throw new Error('unexpectedly over the ceiling');
  return run.sections;
}

const USER = '2f734ed5-3681-4049-880d-3de7b096bea3';
const CTX: ExportContext = { userId: USER, authUser: { id: USER, email: 'a@example.com', created_at: '2026-01-01T00:00:00Z' } };

function recordingLogger() {
  const lines: Array<{ fields: Record<string, unknown>; msg: string }> = [];
  return { lines, logger: { error: (fields: Record<string, unknown>, msg: string) => lines.push({ fields, msg }) } };
}

beforeEach(() => {
  mockFindProfile.mockReset();
  mockFindProfile.mockResolvedValue({ data: { id: USER, full_name: 'Ada' }, error: null });
  mockListOwned.mockReset();
  mockListOwned.mockResolvedValue({ data: { rows: [], overCeiling: false }, error: null });
});

describe('runExportSections', () => {
  it('all readers ok: sections in registry order, status ok, row_count = rows', async () => {
    const { logger, lines } = recordingLogger();
    const sections = await runAll(CTX, EXPORT_SECTIONS, logger);
    // DE-4: + the eight client_records sections.
    expect(sections.map((s) => s.id)).toEqual([...ACCOUNT_IDS, ...DE4_IDS]);
    for (const s of sections) {
      expect(s.status).toBe('ok');
      expect(s.row_count).toBe(s.rows.length);
      expect(s.group).toBe(DE4_IDS.includes(s.id) ? 'client_records' : 'account');
      expect(s.gdpr_role).toBe(DE4_IDS.includes(s.id) ? 'processor' : 'controller');
    }
    expect(sections[0].rows).toEqual([{ id: USER, email: 'a@example.com', created_at: '2026-01-01T00:00:00Z' }]);
    expect(sections[1].rows).toEqual([{ id: USER, full_name: 'Ada' }]);
    expect(lines).toEqual([]);
    // The readers are keyed on the session's id.
    expect(mockFindProfile).toHaveBeenCalledWith(USER);
    // DE-4: one read per client_records section, by SECTION id (C-4), the session's id, and the budget left.
    expect(mockListOwned.mock.calls.map((c) => c[0])).toEqual(DE4_IDS);
    for (const call of mockListOwned.mock.calls) {
      expect(call[1]).toBe(USER);
      // DE-4 (user 2026-10-15): - 2 account rows, was - 3 (plugin_connections gone).
      expect(call[2]).toEqual({ maxRows: EXPORT_LIMITS.ROW_CEILING - 2 });
    }
  });

  it('no profile row is ok with 0 rows, not failed (SA Q-4)', async () => {
    mockFindProfile.mockResolvedValue({ data: null, error: null });
    const { logger } = recordingLogger();
    const sections = await runAll(CTX, EXPORT_SECTIONS, logger);
    expect(sections[1]).toEqual({ id: 'user_profile', group: 'account', gdpr_role: 'controller', status: 'ok', row_count: 0, rows: [] });
  });

  // DE-4 (user 2026-10-15): driven through user_profile, was plugin_connections.
  it('a repository error gives that section failed with no rows; the others are unaffected', async () => {
    mockFindProfile.mockResolvedValue({ data: null, error: new Error('relation secret_table does not exist') });
    const { logger } = recordingLogger();
    const sections = await runAll(CTX, EXPORT_SECTIONS, logger);
    expect(sections[1]).toEqual({ id: 'user_profile', group: 'account', gdpr_role: 'controller', status: 'failed', row_count: 0, rows: [] });
    expect(sections[0].status).toBe('ok');
    expect(sections.slice(2).every((x) => x.status === 'ok')).toBe(true);
    expect(JSON.stringify(sections)).not.toContain('secret_table');
  });

  it('a reader that throws gives failed, logged at error with { err, sectionId }, no error text in the output', async () => {
    const throwing: AnyExportSectionDefinition = {
      id: 'user_profile',
      group: 'account',
      gdprRole: 'controller',
      read: async () => {
        throw new Error('boom secret detail');
      },
    };
    const { logger, lines } = recordingLogger();
    const sections = await runAll(CTX, [EXPORT_SECTIONS[0], throwing], logger);
    expect(sections[1]).toEqual({ id: 'user_profile', group: 'account', gdpr_role: 'controller', status: 'failed', row_count: 0, rows: [] });
    expect(lines).toHaveLength(1);
    expect(lines[0].msg).toBe('Data export section read threw');
    expect(lines[0].fields.sectionId).toBe('user_profile');
    expect(lines[0].fields.err).toBeInstanceOf(Error);
    expect(JSON.stringify(sections)).not.toContain('boom');
  });

  it('account_identity is ok with the auth fields even when every other section fails', async () => {
    mockFindProfile.mockRejectedValue(new Error('down'));
    // DE-4: and every client_records read.
    mockListOwned.mockResolvedValue({ data: null, error: new Error('down') });
    const { logger } = recordingLogger();
    const sections = await runAll(CTX, EXPORT_SECTIONS, logger);
    expect(sections.map((s) => [s.id, s.status])).toEqual([
      ['account_identity', 'ok'],
      ['user_profile', 'failed'],
      ...DE4_IDS.map((id) => [id, 'failed']),
    ]);
    expect(sections[0].rows).toEqual([CTX.authUser]);
  });
});

describe('DE-4 U-7 client_records sections', () => {
  it('each is group client_records, processor, and passes its rows through as read', async () => {
    mockListOwned.mockImplementation(async (section: string) => ({
      data: { rows: [{ id: `${section}-1`, title: 'x' }], overCeiling: false },
      error: null,
    }));
    const sections = await runAll(CTX, EXPORT_SECTIONS, recordingLogger().logger);
    for (const s of sections.filter((x) => DE4_IDS.includes(x.id))) {
      expect(s).toMatchObject({ group: 'client_records', gdpr_role: 'processor', status: 'ok', row_count: 1 });
      if (s.id === 'clients') expect(s.rows).toEqual([{ id: 'clients-1', title: 'x', source_metadata: {} }]);
      else expect(s.rows).toEqual([{ id: `${s.id}-1`, title: 'x' }]);
    }
  });

  it('one failing reader gives that section failed with no error text; the rest stay ok', async () => {
    mockListOwned.mockImplementation(async (section: string) =>
      section === 'bookings'
        ? { data: null, error: new Error('column scheduling_bookings.secret does not exist') }
        : { data: { rows: [], overCeiling: false }, error: null }
    );
    const sections = await runAll(CTX, EXPORT_SECTIONS, recordingLogger().logger);
    const bookings = sections.find((s) => s.id === 'bookings');
    expect(bookings).toEqual({ id: 'bookings', group: 'client_records', gdpr_role: 'processor', status: 'failed', row_count: 0, rows: [] });
    expect(sections.filter((s) => s.status === 'failed').map((s) => s.id)).toEqual(['bookings']);
    expect(JSON.stringify(sections)).not.toContain('secret');
  });

  it('clients: source_metadata keeps only the BC-4 keys, in place (key order kept)', async () => {
    mockListOwned.mockImplementation(async (section: string) =>
      section === 'clients'
        ? {
            data: {
              rows: [{ id: 'c1', first_name: 'Dana', source_metadata: { capture_channel: 'website', ip_hash: 'IPHASH', user_agent: 'UA', session_id: 'SESS' }, created_at: 't' }],
              overCeiling: false,
            },
            error: null,
          }
        : { data: { rows: [], overCeiling: false }, error: null }
    );
    const sections = await runAll(CTX, EXPORT_SECTIONS, recordingLogger().logger);
    const client = sections.find((s) => s.id === 'clients')!.rows[0] as Record<string, unknown>;
    expect(Object.keys(client)).toEqual(['id', 'first_name', 'source_metadata', 'created_at']);
    expect(client.source_metadata).toEqual({ capture_channel: 'website' });
    for (const leaked of ['IPHASH', 'UA"', 'SESS']) expect(JSON.stringify(sections)).not.toContain(leaked);
  });
});

describe('DE-4 U-7 sourceMetadata (user BC-4, SA C-3)', () => {
  it('the allow-list is exactly the user\'s keys, named one by one', () => {
    expect(SOURCE_METADATA_KEYS).toEqual([
      'capture_page_url', 'referrer_url', 'referrer_domain', 'capture_channel', 'device_type', 'capture_timestamp',
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
    ]);
    for (const out of ['page_type', 'smart_link_code', 'smart_link_name', 'smart_link_id', 'ip_hash', 'session_id', 'user_agent']) {
      expect(SOURCE_METADATA_KEYS).not.toContain(out);
    }
  });

  it('keeps every allow-listed string value', () => {
    const all = Object.fromEntries(SOURCE_METADATA_KEYS.map((k) => [k, `v-${k}`]));
    expect(sourceMetadata(all)).toEqual(all);
  });

  it('negative controls: tracking keys, smart-link keys, a utm_ look-alike, a token, nested and non-string values are dropped', () => {
    expect(
      sourceMetadata({
        capture_channel: 'website',
        device_type: 'mobile',
        ip_hash: 'recoverable-ip-hash',
        session_id: 'our-session-id',
        user_agent: 'Mozilla/5.0',
        smart_link_id: 'sl-id',
        smart_link_code: 'abc',
        smart_link_name: 'Spring promo',
        page_type: 'landing',
        utm_evil: 'pattern-growth',
        access_token: 'tok',
        utm_source: { nested: 'object' },
        utm_medium: ['array'],
        utm_campaign: 5,
        referrer_url: null,
      })
    ).toEqual({ capture_channel: 'website', device_type: 'mobile' });
  });

  it('gives {} for a value that is not an object', () => {
    expect([null, undefined, 'a string', ['capture_channel'], 5].map(sourceMetadata)).toEqual([{}, {}, {}, {}, {}]);
  });
});

describe('DE-4 U-8 the row ceiling (§0.4.1 C)', () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `r${i}` }));

  /** A fake reader that honours its budget the way the repository does. */
  function budgeted(counts: Partial<Record<ExportSectionId, number>>) {
    mockListOwned.mockImplementation(async (section: ExportSectionId, _user: string, opts: { maxRows: number }) => {
      const n = counts[section] ?? 0;
      return n > opts.maxRows ? { data: { rows: [], overCeiling: true }, error: null } : { data: { rows: rows(n), overCeiling: false }, error: null };
    });
  }

  it('exactly at the ceiling is exported', async () => {
    // DE-4 (user 2026-10-15): clients 8, was 7 (plugin_connections gone).
    budgeted({ clients: 8 });
    // account_identity 1 + user_profile 1 + clients 8 = 10.
    const run = await runExportSections(CTX, EXPORT_SECTIONS, recordingLogger().logger, { rowCeiling: 10 });
    expect(run.overCeiling).toBe(false);
  });

  it('over the ceiling: overCeiling, later sections are not read, no partial section', async () => {
    // DE-4 (user 2026-10-15): clients 9, was 8.
    budgeted({ clients: 9 });
    const run = await runExportSections(CTX, EXPORT_SECTIONS, recordingLogger().logger, { rowCeiling: 10 });
    expect(run).toMatchObject({ overCeiling: true, atSection: 'clients' });
    expect(run.sections.map((s) => s.id)).toEqual([...ACCOUNT_IDS, 'pipeline_stages']);
    // pipeline_stages and clients were read; nothing after clients.
    expect(mockListOwned.mock.calls.map((c) => c[0])).toEqual(['pipeline_stages', 'clients']);
    // DE-4 (user 2026-10-15): 8 left, was 7.
    expect(mockListOwned.mock.calls[1][2]).toEqual({ maxRows: 8 });
  });

  it('negative control: ceiling + 1 spread over two sections still trips it', async () => {
    // DE-4 (user 2026-10-15): clients 4 + bookings 5, was 4 + 4.
    budgeted({ clients: 4, bookings: 5 });
    const run = await runExportSections(CTX, EXPORT_SECTIONS, recordingLogger().logger, { rowCeiling: 10 });
    expect(run).toMatchObject({ overCeiling: true, atSection: 'bookings' });
    // bookings was offered the 4 rows left (DE-4, user 2026-10-15: was 3).
    expect(mockListOwned.mock.calls.find((c) => c[0] === 'bookings')?.[2]).toEqual({ maxRows: 4 });
  });

  it('a reader that ignores its budget still counts (the account sections)', async () => {
    // DE-4 (user 2026-10-15): ceiling 1 trips at user_profile, was ceiling 2 at plugin_connections.
    const run = await runExportSections(CTX, EXPORT_SECTIONS, recordingLogger().logger, { rowCeiling: 1 });
    expect(run).toMatchObject({ overCeiling: true, atSection: 'user_profile' });
    expect(mockListOwned).not.toHaveBeenCalled();
  });

  it('defaults to EXPORT_LIMITS.ROW_CEILING (100,000)', async () => {
    expect(EXPORT_LIMITS.ROW_CEILING).toBe(100_000);
    expect(EXPORT_LIMITS.PAGE_SIZE).toBe(1_000);
    expect(EXPORT_LIMITS.JSON_BODY_MAX_BYTES).toBe(4_000_000);
    await runExportSections(CTX, EXPORT_SECTIONS, recordingLogger().logger);
    // DE-4 (user 2026-10-15): - 2, was - 3.
    expect(mockListOwned.mock.calls[0][2]).toEqual({ maxRows: 100_000 - 2 });
  });
});

describe('the registry (guard; DE-2 extends this against the descriptors)', () => {
  // Every ExportSectionId, written out: adding an id to the union without a
  // definition (or the reverse) fails here.
  const ALL_IDS: Record<ExportSectionId, true> = {
    // DE-4 (user 2026-10-15): plugin_connections removed.
    account_identity: true, user_profile: true,
    // DE-4
    pipeline_stages: true, clients: true, client_activities: true, client_tasks: true, client_documents: true,
    services: true, bookings: true, time_off: true,
  };

  it('ids are unique and every ExportSectionId has exactly one definition', () => {
    const ids = EXPORT_SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(Object.keys(ALL_IDS).sort());
  });

  it('every section has a group and a GDPR role', () => {
    for (const s of EXPORT_SECTIONS) {
      expect(['account', 'client_records']).toContain(s.group);
      expect(['controller', 'processor']).toContain(s.gdprRole);
    }
  });

  it('DE-4: registry order is 2 account + 8 client_records; the calendar copy is not a section (BC-5)', () => {
    expect(EXPORT_SECTIONS.map((s) => s.id)).toEqual([...ACCOUNT_IDS, ...DE4_IDS]);
    // DE-4 (user 2026-10-15): connected apps are not a section.
    expect(EXPORT_SECTIONS.map((s) => s.id as string)).not.toContain('plugin_connections');
    expect(EXPORT_SECTIONS.filter((s) => s.group === 'client_records').map((s) => s.id)).toEqual(DE4_IDS);
    expect(EXPORT_SECTIONS.map((s) => s.id as string)).not.toContain('calendar_busy_times');
  });

  it('none of the sections DE-1 removed is back (DX-1, BQ-SA-1)', () => {
    const ids: string[] = EXPORT_SECTIONS.map((s) => s.id);
    for (const removed of ['agents', 'agent_executions', 'agent_configurations', 'subscriptions', 'transactions', 'audit_logs']) {
      expect(ids).not.toContain(removed);
    }
  });
});

describe('payload', () => {
  // DE-4 (user 2026-10-15): the name carries the time, on the owner's clock; was `<UTC date>.json`.
  describe("exportFileName: agentpilot-data-export-YYYY-MM-DD-HHmm.json on the owner's clock", () => {
    const LATE = new Date('2026-07-15T23:30:00.000Z');

    it("the owner's timezone moves the name across midnight (Asia/Jerusalem, UTC+3 in July)", () => {
      expect(exportFileName(LATE, 'Asia/Jerusalem')).toBe('agentpilot-data-export-2026-07-16-0230.json');
      expect(exportFileName(LATE, 'UTC')).toBe('agentpilot-data-export-2026-07-15-2330.json');
      // A zone behind UTC crosses the other way.
      expect(exportFileName(new Date('2026-07-16T01:05:00.000Z'), 'America/New_York')).toBe('agentpilot-data-export-2026-07-15-2105.json');
    });

    it('winter time is honoured (Asia/Jerusalem is UTC+2 in January)', () => {
      expect(exportFileName(new Date('2026-01-15T22:30:00.000Z'), 'Asia/Jerusalem')).toBe('agentpilot-data-export-2026-01-16-0030.json');
    });

    it('midnight is 0000, never 2400', () => {
      expect(exportFileName(new Date('2026-07-15T21:00:00.000Z'), 'Asia/Jerusalem')).toBe('agentpilot-data-export-2026-07-16-0000.json');
    });

    it.each<[string, string | null | undefined]>([
      ['NULL (never set)', null],
      ['blank', '   '],
      ['not an IANA zone', 'Mars/Olympus_Mons'],
      ['no argument', undefined],
    ])('%s falls back to UTC', (_label, zone) => {
      expect(exportFileName(LATE, zone)).toBe('agentpilot-data-export-2026-07-15-2330.json');
    });

    it('no user id in the name', () => {
      expect(exportFileName(LATE, 'Asia/Jerusalem')).not.toContain(USER);
    });
  });

  it('buildExportPayload: format_version 2, provider and per-group controller, counts and failed list', async () => {
    // DE-4 (user 2026-10-15): the failing section is user_profile, was plugin_connections.
    mockFindProfile.mockResolvedValue({ data: null, error: new Error('down') });
    const { logger } = recordingLogger();
    const sections = await runAll(CTX, EXPORT_SECTIONS, logger);
    const payload = buildExportPayload({ userId: USER, now: new Date('2026-07-15T12:00:00.000Z'), sections, durationMs: 7 });
    expect(payload.export_metadata).toEqual({
      format_version: 2,
      user_id: USER,
      export_date: '2026-07-15T12:00:00.000Z',
      export_format: 'JSON',
      gdpr_article: 'Article 15 (Right to Access) & Article 20 (Data Portability)',
      provider: 'AgentPilot',
      groups: {
        account: {
          gdpr_role: 'controller',
          controller: 'AgentPilot',
          description: 'Your own account details. AgentPilot is the controller of this data.',
        },
        // DE-4 (SA-Q13): the account holder is the controller, AgentPilot the processor.
        client_records: {
          gdpr_role: 'processor',
          controller: 'account_holder',
          description:
            'Records you keep about your clients. You, the account holder, are the controller of these records. AgentPilot keeps them on your behalf, as its processor.',
        },
      },
    });
    expect(EXPORT_GROUPS.client_records.gdpr_role).toBe('processor');
    expect(payload.summary.section_counts).toEqual({
      account_identity: 1, user_profile: 0,
      ...Object.fromEntries(DE4_IDS.map((id) => [id, 0])),
    });
    expect(payload.summary.failed_sections).toEqual(['user_profile']);
    expect(payload.summary.export_duration_ms).toBe(7);
    expect(JSON.stringify(payload)).not.toContain('NeuronForge');
  });
});
