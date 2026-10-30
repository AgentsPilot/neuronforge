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
 *
 * DE-3 (BUSINESS_OS_DATA_EXPORT_DE3_WORKPLAN.md §7 X-6 / X-7): four account
 * sections read from tables (preferences, notification settings, business
 * profile, business addresses), after user_profile and before the
 * client_records sections, through the same mocked repository method. They
 * are group account, controller. DE-4's expectations are unchanged apart from
 * the four ids appearing ahead of them.
 *
 * DE-5 (BUSINESS_OS_DATA_EXPORT_DE5_WORKPLAN.md §8 M-9, M-11; SA C-3, C-7):
 * two account sections (payment_account, payment_providers) after
 * business_addresses and eight client_records money sections after time_off.
 * `payments.metadata` keeps only `notes` and `source`, through the new
 * `pickStringKeys`; `sourceMetadata` is now a call to it and its DE-4 cases
 * below are unchanged. Earlier expectations change only by the ten ids.
 *
 * DE-6 (BUSINESS_OS_DATA_EXPORT_DE6_WORKPLAN.md §8 N-4, N-5, N-11; SA C-2,
 * C-4): ten client_records sections after client_payment_methods. Consent
 * `evidence` keeps only CONSENT_EVIDENCE_KEYS; subscriber `attribution` goes
 * through `sourceMetadata` (the same SOURCE_METADATA_KEYS); page URLs lose
 * their query string and fragment (`withoutQueryOrFragment`). F-DE6-1 (TL
 * 2026-10-16): `sourceMetadata` now cuts `capture_page_url` / `referrer_url`
 * too, the one deliberate change to DE-4 output; for a value without `?` or
 * `#` it is byte-identical to DE-4 (the C-7 cases below). Earlier
 * expectations change only by the ten ids.
 *
 * DE-7 (BUSINESS_OS_DATA_EXPORT_DE7_WORKPLAN.md §8 D-15; SA-Q3, SA-Q4): five
 * sections in the new `content` group (processor; the account holder the
 * controller) after email_unsubscribes, no row mapper (every cell as read).
 * Earlier expectations change only by the five ids and the third group.
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
  CONSENT_EVIDENCE_KEYS,
  EXPORT_SECTIONS,
  PAYMENT_METADATA_KEYS,
  SOURCE_METADATA_KEYS,
  SOURCE_METADATA_URL_KEYS,
  consentEvidence,
  paymentMetadata,
  pickStringKeys,
  runExportSections,
  sourceMetadata,
  withoutQueryOrFragment,
  type AnyExportSectionDefinition,
  type AnyExportedSection,
  type ExportContext,
  type ExportSectionId,
} from '@/lib/business-os/data-export/sections';
import { EXPORT_LIMITS } from '@/lib/business-os/data-export/limits';

/** DE-4: the eight client_records sections, in registry order. */
const DE4_IDS: ExportSectionId[] = [
  'pipeline_stages', 'clients', 'client_activities', 'client_tasks', 'client_documents', 'services', 'bookings', 'time_off',
];
// DE-4 (user 2026-10-15): plugin_connections removed, was the third account section.
const ACCOUNT_IDS: ExportSectionId[] = ['account_identity', 'user_profile'];
/** DE-3: the account sections read from tables, after user_profile, in registry order. */
const DE3_IDS: ExportSectionId[] = ['preferences', 'notification_settings', 'business_profile', 'business_addresses'];
/** DE-5: the two account sections after business_addresses (SA-Q1). */
const DE5_ACCOUNT_IDS: ExportSectionId[] = ['payment_account', 'payment_providers'];
/** DE-5: the eight client-money sections after time_off, in registry order. */
const DE5_IDS: ExportSectionId[] = [
  'quotes', 'invoices', 'payments', 'refunds', 'payment_plans', 'client_payment_plans', 'installments', 'client_payment_methods',
];
/** DE-6: the ten intake, email marketing and consent sections after client_payment_methods (§2.3). */
const DE6_IDS: ExportSectionId[] = [
  'intake_settings', 'intake_forms', 'email_campaigns', 'email_sequences', 'email_sequence_steps',
  'email_sequence_enrollments', 'newsletter_subscribers', 'consent_records', 'consent_settings', 'email_unsubscribes',
];
/** DE-7: the five content sections after email_unsubscribes (§2.3, SA-Q4). */
const DE7_IDS: ExportSectionId[] = ['website_content', 'website_pages', 'website_blocks', 'smart_links', 'images'];
/** DE-5: every client_records section (DE-4 + DE-5). DE-6: + DE6_IDS. */
const CLIENT_IDS: ExportSectionId[] = [...DE4_IDS, ...DE5_IDS, ...DE6_IDS];
/** DE-5: every section read through the repository, in registry order. DE-6: + DE6_IDS. DE-7: + DE7_IDS. */
const OWNED_IDS: ExportSectionId[] = [...DE3_IDS, ...DE5_ACCOUNT_IDS, ...DE4_IDS, ...DE5_IDS, ...DE6_IDS, ...DE7_IDS];
/** DE-7: the group of a section id (three groups now). */
const groupOf = (id: ExportSectionId): string => (DE7_IDS.includes(id) ? 'content' : CLIENT_IDS.includes(id) ? 'client_records' : 'account');

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
    // DE-4: + the eight client_records sections. DE-3: + the four account sections from tables.
    // DE-5: + the two account and eight client-money sections. DE-6: + the ten DE-6 sections.
    // DE-7: + the five content sections.
    expect(sections.map((s) => s.id)).toEqual([...ACCOUNT_IDS, ...DE3_IDS, ...DE5_ACCOUNT_IDS, ...DE4_IDS, ...DE5_IDS, ...DE6_IDS, ...DE7_IDS]);
    for (const s of sections) {
      expect(s.status).toBe('ok');
      expect(s.row_count).toBe(s.rows.length);
      // DE-5: CLIENT_IDS, was DE4_IDS. DE-7: groupOf (content is processor too).
      expect(s.group).toBe(groupOf(s.id));
      expect(s.gdpr_role).toBe(groupOf(s.id) === 'account' ? 'controller' : 'processor');
    }
    expect(sections[0].rows).toEqual([{ id: USER, email: 'a@example.com', created_at: '2026-01-01T00:00:00Z' }]);
    expect(sections[1].rows).toEqual([{ id: USER, full_name: 'Ada' }]);
    expect(lines).toEqual([]);
    // The readers are keyed on the session's id.
    expect(mockFindProfile).toHaveBeenCalledWith(USER);
    // DE-4: one read per client_records section, by SECTION id (C-4), the session's id, and the budget left.
    // DE-3 X-7: the four account sections from tables read the same way, first.
    // DE-5: OWNED_IDS, was [...DE3_IDS, ...DE4_IDS].
    expect(mockListOwned.mock.calls.map((c) => c[0])).toEqual(OWNED_IDS);
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
      ...DE3_IDS.map((id) => [id, 'failed']),
      // DE-5: + the two account and eight client-money sections.
      ...DE5_ACCOUNT_IDS.map((id) => [id, 'failed']),
      ...DE4_IDS.map((id) => [id, 'failed']),
      ...DE5_IDS.map((id) => [id, 'failed']),
      // DE-6: + the ten DE-6 sections.
      ...DE6_IDS.map((id) => [id, 'failed']),
      // DE-7: + the five content sections.
      ...DE7_IDS.map((id) => [id, 'failed']),
    ]);
    expect(sections[0].rows).toEqual([CTX.authUser]);
  });
});

describe('DE-3 X-6 / X-7 the account sections read from tables', () => {
  it('each is group account, controller, and passes its rows through as read (no reshaping)', async () => {
    mockListOwned.mockImplementation(async (section: string) => ({
      data: { rows: [{ id: `${section}-1`, source_metadata: { ip_hash: 'kept-as-read' } }], overCeiling: false },
      error: null,
    }));
    const sections = await runAll(CTX, EXPORT_SECTIONS, recordingLogger().logger);
    for (const id of DE3_IDS) {
      const s = sections.find((x) => x.id === id);
      expect(s).toMatchObject({ group: 'account', gdpr_role: 'controller', status: 'ok', row_count: 1 });
      // Only `clients` reshapes a cell; a DE-3 section returns the repository's row as is.
      expect(s?.rows).toEqual([{ id: `${id}-1`, source_metadata: { ip_hash: 'kept-as-read' } }]);
    }
  });

  it('one failing DE-3 reader gives that section failed with no error text; the rest stay ok', async () => {
    mockListOwned.mockImplementation(async (section: string) =>
      section === 'business_profile'
        ? { data: null, error: new Error('column business_profiles.secret does not exist') }
        : { data: { rows: [], overCeiling: false }, error: null }
    );
    const sections = await runAll(CTX, EXPORT_SECTIONS, recordingLogger().logger);
    expect(sections.find((s) => s.id === 'business_profile')).toEqual({
      id: 'business_profile', group: 'account', gdpr_role: 'controller', status: 'failed', row_count: 0, rows: [],
    });
    expect(sections.filter((s) => s.status === 'failed').map((s) => s.id)).toEqual(['business_profile']);
    expect(JSON.stringify(sections)).not.toContain('secret');
  });

  it('the DE-3 rows count toward the ceiling, before the client records (SA C-3)', async () => {
    mockListOwned.mockImplementation(async (section: ExportSectionId, _user: string, opts: { maxRows: number }) => {
      const n = section === 'business_addresses' ? 3 : DE3_IDS.includes(section) ? 1 : 0;
      return n > opts.maxRows
        ? { data: { rows: [], overCeiling: true }, error: null }
        : { data: { rows: Array.from({ length: n }, (_, i) => ({ id: `${section}-${i}` })), overCeiling: false }, error: null };
    });
    await runExportSections(CTX, EXPORT_SECTIONS, recordingLogger().logger, { rowCeiling: 100 });
    // 2 account rows, then 1 + 1 + 1 + 3 from DE-3: the first client_records section is offered 92.
    const offered = Object.fromEntries(mockListOwned.mock.calls.map((c) => [c[0], c[2].maxRows]));
    expect(offered).toMatchObject({ preferences: 98, notification_settings: 97, business_profile: 96, business_addresses: 95, pipeline_stages: 92 });
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
    // DE-3: the four (empty) account sections from tables come first.
    // DE-5: + the two (empty) account money sections, before pipeline_stages.
    expect(run.sections.map((s) => s.id)).toEqual([...ACCOUNT_IDS, ...DE3_IDS, ...DE5_ACCOUNT_IDS, 'pipeline_stages']);
    // pipeline_stages and clients were read; nothing after clients.
    expect(mockListOwned.mock.calls.map((c) => c[0])).toEqual([...DE3_IDS, ...DE5_ACCOUNT_IDS, 'pipeline_stages', 'clients']);
    // DE-4 (user 2026-10-15): 8 left, was 7. DE-3: clients is call 5, was 1.
    expect(mockListOwned.mock.calls.find((c) => c[0] === 'clients')?.[2]).toEqual({ maxRows: 8 });
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
    // DE-9 (SA C-11 / DE-8b Q-1): the JSON route and its 4 MB body cap are retired.
    expect(EXPORT_LIMITS).not.toHaveProperty('JSON_BODY_MAX_BYTES');
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
    // DE-3
    preferences: true, notification_settings: true, business_profile: true, business_addresses: true,
    // DE-4
    pipeline_stages: true, clients: true, client_activities: true, client_tasks: true, client_documents: true,
    services: true, bookings: true, time_off: true,
    // DE-5
    payment_account: true, payment_providers: true, quotes: true, invoices: true, payments: true, refunds: true,
    payment_plans: true, client_payment_plans: true, installments: true, client_payment_methods: true,
    // DE-6
    intake_settings: true, intake_forms: true, email_campaigns: true, email_sequences: true, email_sequence_steps: true,
    email_sequence_enrollments: true, newsletter_subscribers: true, consent_records: true, consent_settings: true,
    email_unsubscribes: true,
    // DE-7
    website_content: true, website_pages: true, website_blocks: true, smart_links: true, images: true,
  };

  it('ids are unique and every ExportSectionId has exactly one definition', () => {
    const ids = EXPORT_SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(Object.keys(ALL_IDS).sort());
  });

  it('every section has a group and a GDPR role', () => {
    for (const s of EXPORT_SECTIONS) {
      // DE-7: + content.
      expect(['account', 'client_records', 'content']).toContain(s.group);
      expect(['controller', 'processor']).toContain(s.gdprRole);
    }
  });

  // DE-3: 6 account (2 + the four from tables) + 8 client_records, was 2 + 8.
  // DE-5: 8 account + 16 client_records, was 6 + 8.
  // DE-6: 8 account + 26 client_records, was 8 + 16 (N-11).
  it('DE-4: registry order is 8 account + 26 client_records; the calendar copy is not a section (BC-5)', () => {
    // DE-5: + DE5_ACCOUNT_IDS after DE3_IDS, + DE5_IDS after DE4_IDS. DE-6: + DE6_IDS after DE5_IDS.
    // DE-7: + DE7_IDS after DE6_IDS (asserted in its own block below).
    expect(EXPORT_SECTIONS.map((s) => s.id)).toEqual([...ACCOUNT_IDS, ...DE3_IDS, ...DE5_ACCOUNT_IDS, ...DE4_IDS, ...DE5_IDS, ...DE6_IDS, ...DE7_IDS]);
    expect(EXPORT_SECTIONS.filter((s) => s.group === 'account').map((s) => s.id)).toEqual([...ACCOUNT_IDS, ...DE3_IDS, ...DE5_ACCOUNT_IDS]);
    for (const s of EXPORT_SECTIONS.filter((x) => DE3_IDS.includes(x.id))) expect(s.gdprRole).toBe('controller');
    // DE-5 M-9 (SA-Q1): the Stripe account and providers are account / controller.
    for (const s of EXPORT_SECTIONS.filter((x) => DE5_ACCOUNT_IDS.includes(x.id))) expect(s.gdprRole).toBe('controller');
    // DE-4 (user 2026-10-15): connected apps are not a section.
    expect(EXPORT_SECTIONS.map((s) => s.id as string)).not.toContain('plugin_connections');
    // DE-5: CLIENT_IDS (DE-4 + the eight money sections, processor), was DE4_IDS.
    expect(EXPORT_SECTIONS.filter((s) => s.group === 'client_records').map((s) => s.id)).toEqual(CLIENT_IDS);
    for (const s of EXPORT_SECTIONS.filter((x) => DE5_IDS.includes(x.id))) expect(s.gdprRole).toBe('processor');
    // DE-6 N-11 (SA-Q2): all ten are client_records / processor, intake and consent settings included.
    for (const s of EXPORT_SECTIONS.filter((x) => DE6_IDS.includes(x.id))) {
      expect(s.group).toBe('client_records');
      expect(s.gdprRole).toBe('processor');
    }
    expect(EXPORT_SECTIONS.map((s) => s.id as string)).not.toContain('calendar_busy_times');
  });

  it('none of the sections DE-1 removed is back (DX-1, BQ-SA-1)', () => {
    const ids: string[] = EXPORT_SECTIONS.map((s) => s.id);
    for (const removed of ['agents', 'agent_executions', 'agent_configurations', 'subscriptions', 'transactions', 'audit_logs']) {
      expect(ids).not.toContain(removed);
    }
  });
});

// ── DE-5 (BUSINESS_OS_DATA_EXPORT_DE5_WORKPLAN.md §8; SA review DE-5 C-3, C-7) ──

describe('DE-5 the money sections', () => {
  it('each is in its group and role, and passes its rows through as read (payments aside)', async () => {
    mockListOwned.mockImplementation(async (section: string) => ({
      data: { rows: [{ id: `${section}-1`, amount: 120.5, currency: 'ILS', metadata: { raw: 'kept-as-read' } }], overCeiling: false },
      error: null,
    }));
    const sections = await runAll(CTX, EXPORT_SECTIONS, recordingLogger().logger);
    for (const id of [...DE5_ACCOUNT_IDS, ...DE5_IDS]) {
      const s = sections.find((x) => x.id === id);
      const client = DE5_IDS.includes(id);
      expect(s).toMatchObject({ group: client ? 'client_records' : 'account', gdpr_role: client ? 'processor' : 'controller', status: 'ok', row_count: 1 });
      if (id === 'payments') expect(s?.rows).toEqual([{ id: 'payments-1', amount: 120.5, currency: 'ILS', metadata: {} }]);
      else expect(s?.rows).toEqual([{ id: `${id}-1`, amount: 120.5, currency: 'ILS', metadata: { raw: 'kept-as-read' } }]);
    }
  });

  it('the ten money sections draw on the shared row budget, after the earlier sections (M-15)', async () => {
    mockListOwned.mockImplementation(async (section: ExportSectionId, _user: string, opts: { maxRows: number }) => {
      const n = section === 'payment_account' ? 1 : section === 'payments' ? 4 : section === 'time_off' ? 2 : 0;
      return n > opts.maxRows
        ? { data: { rows: [], overCeiling: true }, error: null }
        : { data: { rows: Array.from({ length: n }, (_, i) => ({ id: `${section}-${i}` })), overCeiling: false }, error: null };
    });
    await runExportSections(CTX, EXPORT_SECTIONS, recordingLogger().logger, { rowCeiling: 100 });
    const offered = Object.fromEntries(mockListOwned.mock.calls.map((c) => [c[0], c[2].maxRows]));
    // 2 account rows; payment_account 1 (before the client records); time_off 2; payments 4.
    expect(offered).toMatchObject({ payment_account: 98, payment_providers: 97, pipeline_stages: 97, quotes: 95, payments: 95, refunds: 91 });
    const over = await runExportSections(CTX, EXPORT_SECTIONS, recordingLogger().logger, { rowCeiling: 8 });
    expect(over).toMatchObject({ overCeiling: true, atSection: 'payments' });
  });

  it('a failing money reader gives that section failed with no error text; the rest stay ok', async () => {
    mockListOwned.mockImplementation(async (section: string) =>
      section === 'refunds'
        ? { data: null, error: new Error('column payment_refunds.secret does not exist') }
        : { data: { rows: [], overCeiling: false }, error: null }
    );
    const sections = await runAll(CTX, EXPORT_SECTIONS, recordingLogger().logger);
    expect(sections.find((s) => s.id === 'refunds')).toEqual({
      id: 'refunds', group: 'client_records', gdpr_role: 'processor', status: 'failed', row_count: 0, rows: [],
    });
    expect(sections.filter((s) => s.status === 'failed').map((s) => s.id)).toEqual(['refunds']);
    expect(JSON.stringify(sections)).not.toContain('secret');
  });
});

describe('DE-5 C-3 payments.metadata keeps only notes and source (SA-Q3, user BC-7)', () => {
  const RAW = {
    checkout_session_id: 'cs_QA_NEVER',
    notes: 'Paid in cash at the studio',
    connect_account_id: 'acct_QA_NEVER',
    source: 'manual_mark_paid',
    client_secret: 'pi_QA_secret_NEVER',
    some_unknown_key: 'QA-UNKNOWN-NEVER',
  };

  /** The rows the registry's `payments` and `refunds` sections write for one seeded raw metadata. */
  async function exported(metadata: unknown): Promise<Record<string, Record<string, unknown>>> {
    mockListOwned.mockImplementation(async (section: string) =>
      section === 'payments' || section === 'refunds'
        ? { data: { rows: [{ id: `${section}-1`, amount: 50, metadata, currency: 'USD' }], overCeiling: false }, error: null }
        : { data: { rows: [], overCeiling: false }, error: null }
    );
    const sections = await runAll(CTX, EXPORT_SECTIONS, recordingLogger().logger);
    return {
      payments: sections.find((s) => s.id === 'payments')!.rows[0] as Record<string, unknown>,
      refunds: sections.find((s) => s.id === 'refunds')!.rows[0] as Record<string, unknown>,
    };
  }

  it('the section from the registry exports only { notes, source } as strings, in place (key order kept)', async () => {
    const { payments } = await exported(RAW);
    expect(Object.keys(payments)).toEqual(['id', 'amount', 'metadata', 'currency']);
    expect(payments.metadata).toEqual({ notes: 'Paid in cash at the studio', source: 'manual_mark_paid' });
    expect(Object.keys(payments.metadata as object)).toEqual(['notes', 'source']);
    expect(JSON.stringify(payments)).not.toContain('NEVER');
  });

  it('a non-string notes is dropped; a missing source is simply absent; NULL gives {}', async () => {
    expect((await exported({ notes: { nested: 'x' }, source: 'website_booking' })).payments.metadata).toEqual({ source: 'website_booking' });
    expect((await exported({ notes: 42 })).payments.metadata).toEqual({});
    expect((await exported(null)).payments.metadata).toEqual({});
  });

  it('negative control: a section built without the mapper (refunds has none) passes the raw keys through', async () => {
    const { refunds } = await exported(RAW);
    // The assertion above can see a leak: without the mapRow every raw key would reach the file.
    expect(refunds.metadata).toEqual(RAW);
    expect(JSON.stringify(refunds)).toContain('cs_QA_NEVER');
  });

  it('the allow-list is exactly the two keys; a prefix in the list matches nothing (no pattern growth)', () => {
    expect(PAYMENT_METADATA_KEYS).toEqual(['notes', 'source']);
    expect(paymentMetadata(RAW)).toEqual({ notes: 'Paid in cash at the studio', source: 'manual_mark_paid' });
    // Negative control: widening the list by a prefix ('connect_', 'checkout') exports nothing more.
    expect(pickStringKeys(RAW, [...PAYMENT_METADATA_KEYS, 'connect_', 'checkout', 'client_'])).toEqual(paymentMetadata(RAW));
    // And an inherited property is not an own key.
    const inherited = Object.create({ notes: 'from-prototype' }) as Record<string, unknown>;
    expect(paymentMetadata(inherited)).toEqual({});
  });
});

describe('DE-5 C-7 pickStringKeys keeps sourceMetadata byte-identical', () => {
  const CASES: unknown[] = [
    Object.fromEntries(SOURCE_METADATA_KEYS.map((k) => [k, `v-${k}`])),
    { utm_content: 'last', capture_page_url: 'first', ip_hash: 'h', utm_source: 5, referrer_url: null },
    { capture_channel: ['array'], device_type: 'mobile', session_id: 'SESS' },
    null, undefined, 'a string', ['capture_channel'], 5, {},
  ];

  /** The DE-4 implementation, verbatim, as the reference. */
  function de4SourceMetadata(value: unknown): Record<string, string> {
    const kept: Record<string, string> = {};
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return kept;
    const source = value as Record<string, unknown>;
    for (const key of SOURCE_METADATA_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
      const item = source[key];
      if (typeof item === 'string') kept[key] = item;
    }
    return kept;
  }

  it.each(CASES.map((c, i) => [i, c]))('case %i: same JSON text as the DE-4 implementation', (_i, value) => {
    expect(JSON.stringify(sourceMetadata(value))).toBe(JSON.stringify(de4SourceMetadata(value)));
    expect(JSON.stringify(pickStringKeys(value, SOURCE_METADATA_KEYS))).toBe(JSON.stringify(de4SourceMetadata(value)));
  });
});

// ── DE-6 (BUSINESS_OS_DATA_EXPORT_DE6_WORKPLAN.md §8; SA review DE-6 C-2, C-4; TL F-DE6-1) ──

describe('DE-6 C-4 withoutQueryOrFragment (SA-Q7)', () => {
  it.each([
    ['https://x.test/p?token=TOK', 'https://x.test/p'],
    ['https://x.test/p?session=S1', 'https://x.test/p'],
    ['https://x.test/p?sid=SID', 'https://x.test/p'],
    ['https://x.test/p?code=C0DE', 'https://x.test/p'],
    ['https://x.test/p#frag', 'https://x.test/p'],
    ['https://x.test/p?a=1#b', 'https://x.test/p'],
    // A fragment that comes first cuts there too, whichever comes first.
    ['https://x.test/p#b?a=1', 'https://x.test/p'],
    // No query: unchanged, byte for byte.
    ['https://x.test/a/b/', 'https://x.test/a/b/'],
    // A relative or malformed value is sliced, never parsed or rewritten.
    ['/book/now?ref=abc', '/book/now'],
    ['not a url ? at all', 'not a url '],
    ['?only=query', ''],
  ])('%j -> %j', (input, expected) => {
    expect(withoutQueryOrFragment(input)).toBe(expected);
  });

  it('a value that is not a string passes through as is (NULL stays NULL)', () => {
    expect(withoutQueryOrFragment(null)).toBeNull();
    expect(withoutQueryOrFragment(undefined)).toBeUndefined();
    expect(withoutQueryOrFragment(5)).toBe(5);
    const obj = { url: 'https://x.test/p?token=T' };
    expect(withoutQueryOrFragment(obj)).toBe(obj);
  });
});

describe('DE-6 N-4 consent evidence keeps only the three written keys (SA-Q4)', () => {
  it('the allow-list is exactly client_statement, confirmed_via, note', () => {
    expect(CONSENT_EVIDENCE_KEYS).toEqual(['client_statement', 'confirmed_via', 'note']);
  });

  it('a seeded evidence yields exactly the three strings, in list order; every other key and shape is dropped', () => {
    const raw = {
      note: 'Agreed by phone',
      ip: '203.0.113.7',
      confirmed_via: 'email_link',
      nested: { client_statement: 'deep' },
      count: 3,
      client_statement: 'Yes, email me offers',
    };
    const kept = consentEvidence(raw);
    expect(kept).toEqual({ client_statement: 'Yes, email me offers', confirmed_via: 'email_link', note: 'Agreed by phone' });
    expect(Object.keys(kept)).toEqual(['client_statement', 'confirmed_via', 'note']);
    expect(consentEvidence({ client_statement: 7, note: null })).toEqual({});
    expect([null, ['note'], 'note', 5].map(consentEvidence)).toEqual([{}, {}, {}, {}]);
  });

  it('negative control: a widened list (an ip key) would export the ip; the real list does not', () => {
    const raw = { client_statement: 's', ip: '203.0.113.7' };
    expect(pickStringKeys(raw, [...CONSENT_EVIDENCE_KEYS, 'ip'])).toHaveProperty('ip');
    expect(consentEvidence(raw)).not.toHaveProperty('ip');
    // A prefix in the list matches nothing (no pattern growth).
    expect(pickStringKeys({ client_statement_extra: 'x' }, CONSENT_EVIDENCE_KEYS)).toEqual({});
  });
});

describe('DE-6 the consent_records and newsletter_subscribers rows from the registry', () => {
  const EVENT = {
    id: 'e1',
    email: 'dana@example.com',
    privacy_policy_url: 'https://biz.test/privacy',
    source_page_url: 'https://x.test/p?token=TOK-XYZ&sid=SID-XYZ#frag',
    evidence: { client_statement: 'Yes please', confirmed_via: 'confirm_button', ip: 'IP-XYZ' },
    occurred_at: 't',
  };
  const SUBSCRIBER = {
    id: 's1',
    email: 'lee@example.com',
    attribution: {
      capture_page_url: 'https://x.test/join?code=CODE-XYZ',
      referrer_url: 'https://ref.test/r?session=SESSREF-XYZ#top',
      capture_channel: 'website',
      ip_hash: 'IPHASH-XYZ',
      user_agent: 'UA-XYZ',
      session_id: 'SESS-XYZ',
      smart_link_id: 'SL-XYZ',
    },
    created_at: 't',
  };

  async function rowsOf(): Promise<Record<string, Record<string, unknown>>> {
    mockListOwned.mockImplementation(async (section: string) => {
      const rows = section === 'consent_records' ? [EVENT] : section === 'newsletter_subscribers' ? [SUBSCRIBER] : [];
      return { data: { rows, overCeiling: false }, error: null };
    });
    const sections = await runAll(CTX, EXPORT_SECTIONS, recordingLogger().logger);
    return {
      consent: sections.find((s) => s.id === 'consent_records')!.rows[0] as Record<string, unknown>,
      subscriber: sections.find((s) => s.id === 'newsletter_subscribers')!.rows[0] as Record<string, unknown>,
    };
  }

  it('consent_records: evidence allow-listed, source_page_url cut, privacy_policy_url as held; key order kept', async () => {
    const { consent } = await rowsOf();
    expect(Object.keys(consent)).toEqual(Object.keys(EVENT));
    expect(consent.source_page_url).toBe('https://x.test/p');
    expect(consent.privacy_policy_url).toBe('https://biz.test/privacy');
    expect(consent.evidence).toEqual({ client_statement: 'Yes please', confirmed_via: 'confirm_button' });
    for (const leaked of ['TOK-XYZ', 'SID-XYZ', 'frag', 'IP-XYZ']) expect(JSON.stringify(consent)).not.toContain(leaked);
  });

  it('N-5: newsletter_subscribers attribution keeps only SOURCE_METADATA_KEYS, URLs cut (SA-Q7 C-2)', async () => {
    const { subscriber } = await rowsOf();
    expect(Object.keys(subscriber)).toEqual(Object.keys(SUBSCRIBER));
    expect(subscriber.attribution).toEqual({
      capture_page_url: 'https://x.test/join',
      referrer_url: 'https://ref.test/r',
      capture_channel: 'website',
    });
    for (const leaked of ['CODE-XYZ', 'SESSREF-XYZ', 'IPHASH-XYZ', 'UA-XYZ', 'SESS-XYZ', 'SL-XYZ']) {
      expect(JSON.stringify(subscriber)).not.toContain(leaked);
    }
  });

  it('N-5: the subscriber list IS SOURCE_METADATA_KEYS (one list for one shape), and the URL keys are two of it', () => {
    expect(SOURCE_METADATA_URL_KEYS).toEqual(['capture_page_url', 'referrer_url']);
    for (const key of SOURCE_METADATA_URL_KEYS) expect(SOURCE_METADATA_KEYS).toContain(key);
    // Identity: a copied list with one extra key exports the extra key; sourceMetadata does not.
    const copy = [...SOURCE_METADATA_KEYS, 'smart_link_id'];
    expect(copy).not.toBe(SOURCE_METADATA_KEYS);
    expect(pickStringKeys(SUBSCRIBER.attribution, copy)).toHaveProperty('smart_link_id');
    expect(sourceMetadata(SUBSCRIBER.attribution)).not.toHaveProperty('smart_link_id');
  });

  it('the other eight DE-6 sections pass their rows through as read (no mapper)', async () => {
    const RAW = { id: 'r1', trigger_config: { tag: 'vip' }, page: 'https://x.test/p?keep=1' };
    mockListOwned.mockImplementation(async () => ({ data: { rows: [RAW], overCeiling: false }, error: null }));
    const sections = await runAll(CTX, EXPORT_SECTIONS, recordingLogger().logger);
    for (const id of DE6_IDS.filter((x) => x !== 'consent_records' && x !== 'newsletter_subscribers')) {
      expect(sections.find((s) => s.id === id)?.rows).toEqual([RAW]);
    }
  });
});

describe('DE-6 (F-DE6-1) clients.source_metadata page URLs lose their query string (TL 2026-10-16)', () => {
  it('capture_page_url and referrer_url are cut; every other key is as DE-4 left it', async () => {
    const raw = {
      capture_page_url: 'https://biz.test/book?token=TOK-F1&sid=SID-F1#frag',
      referrer_url: 'https://ref.test/x?code=CODE-F1',
      capture_channel: 'website',
      utm_source: 'news?letter',
      ip_hash: 'IPHASH-F1',
    };
    mockListOwned.mockImplementation(async (section: string) =>
      section === 'clients'
        ? { data: { rows: [{ id: 'c1', source_metadata: raw }], overCeiling: false }, error: null }
        : { data: { rows: [], overCeiling: false }, error: null }
    );
    const sections = await runAll(CTX, EXPORT_SECTIONS, recordingLogger().logger);
    const client = sections.find((s) => s.id === 'clients')!.rows[0] as Record<string, unknown>;
    // Key order of the allow-list is kept; only the two URL keys are cut (a utm value is not a URL key).
    expect(client.source_metadata).toEqual({
      capture_page_url: 'https://biz.test/book',
      referrer_url: 'https://ref.test/x',
      capture_channel: 'website',
      utm_source: 'news?letter',
    });
    expect(Object.keys(client.source_metadata as object)).toEqual(['capture_page_url', 'referrer_url', 'capture_channel', 'utm_source']);
    for (const leaked of ['TOK-F1', 'SID-F1', 'CODE-F1', 'frag', 'IPHASH-F1']) expect(JSON.stringify(sections)).not.toContain(leaked);
  });
});

// ── DE-7 (BUSINESS_OS_DATA_EXPORT_DE7_WORKPLAN.md §2.3, §8 D-15; SA-Q3, SA-Q4) ──

describe('DE-7 D-15 the content sections', () => {
  it('five sections after email_unsubscribes, group content, processor; website_blocks after its parent', () => {
    const ids = EXPORT_SECTIONS.map((s) => s.id);
    expect(ids.slice(-6)).toEqual(['email_unsubscribes', ...DE7_IDS]);
    expect(ids.indexOf('website_blocks')).toBe(ids.indexOf('website_pages') + 1);
    expect(EXPORT_SECTIONS.filter((s) => s.group === 'content').map((s) => s.id)).toEqual(DE7_IDS);
    for (const s of EXPORT_SECTIONS.filter((x) => DE7_IDS.includes(x.id))) expect(s.gdprRole).toBe('processor');
  });

  it('no row mapper: every content row is passed through exactly as read (jsonb whole, URLs as held; SA-Q7, SA-Q8)', async () => {
    const raw = {
      id: 'x-1',
      content: { headline: 'Hi', images: ['https://cdn.test/a.png?w=400'] },
      destination_url: 'https://biz.test/book?utm_source=ig',
      metadata: { journeyType: 'booking', serviceIds: ['s-1'] },
      payment_button: { amount: 120, currency: 'USD' },
    };
    mockListOwned.mockImplementation(async () => ({ data: { rows: [raw], overCeiling: false }, error: null }));
    const sections = await runAll(CTX, EXPORT_SECTIONS, recordingLogger().logger);
    for (const id of DE7_IDS) {
      const s = sections.find((x) => x.id === id)!;
      expect(s).toMatchObject({ group: 'content', gdpr_role: 'processor', status: 'ok', row_count: 1 });
      expect(s.rows).toEqual([raw]);
      expect(JSON.stringify(s.rows)).toBe(JSON.stringify([raw]));
    }
  });

  it('a failing content reader gives that section failed with no error text; the rest stay ok', async () => {
    mockListOwned.mockImplementation(async (section: string) =>
      section === 'website_blocks'
        ? { data: null, error: new Error('Data export parent-scoped read returned 2 rows outside the owned parents') }
        : { data: { rows: [], overCeiling: false }, error: null }
    );
    const sections = await runAll(CTX, EXPORT_SECTIONS, recordingLogger().logger);
    expect(sections.find((x) => x.id === 'website_blocks')).toEqual({
      id: 'website_blocks', group: 'content', gdpr_role: 'processor', status: 'failed', row_count: 0, rows: [],
    });
    expect(sections.filter((x) => x.status === 'failed').map((x) => x.id)).toEqual(['website_blocks']);
    expect(JSON.stringify(sections)).not.toContain('outside the owned parents');
  });

  it('the content rows draw on the same ceiling (each reader is offered what is left)', async () => {
    mockListOwned.mockImplementation(async (section: string) => ({
      data: { rows: section === 'website_pages' ? [{ id: 'p-1' }, { id: 'p-2' }] : [], overCeiling: false },
      error: null,
    }));
    await runExportSections(CTX, EXPORT_SECTIONS, recordingLogger().logger, { rowCeiling: 100 });
    const offered = Object.fromEntries(mockListOwned.mock.calls.map((c) => [c[0], (c[2] as { maxRows: number }).maxRows]));
    // 2 account rows; the pages' 2 rows come off the budget of the sections after them.
    expect(offered.website_content).toBe(98);
    expect(offered.website_pages).toBe(98);
    expect(offered.website_blocks).toBe(96);
    expect(offered.images).toBe(96);
  });
});
