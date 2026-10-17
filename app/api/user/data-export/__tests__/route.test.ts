/**
 * GET /api/user/data-export (SA W26-7; DE-1).
 *
 * The route's logging is Pino (no console), with a correlation id, `userId` as
 * a field and counts only. The plugin connection's provider profile is
 * allow-listed; the 500 body carries no error text outside development
 * (DATA_EXPORT_FOLLOWUPS_WORKPLAN.md SA C-1, FU-P2).
 *
 * DE-1 (BUSINESS_OS_DATA_EXPORT_DE1_WORKPLAN.md §6.3): the export holds the
 * account sections only. The audit-read cases (BD-26 exclusions, FU-1 audit
 * rows) went with the audit section (DX-1d); BD-26 itself stays covered by
 * lib/audit/__tests__/ownerAuditReads.guard.test.ts, which now also proves this
 * route reads no audit rows. The `DATA_EXPORTED` entry goes through the real
 * `logAndFlush` here, with the AuditTrail singleton mocked, so its
 * never-rejects contract is exercised end to end.
 * The reads now go through repositories (DATA_EXPORT_REPOSITORY_REFACTOR_WORKPLAN.md);
 * the per-method checks live in lib/repositories/__tests__/userDataExportReads.test.ts
 * and the full behaviour pin in route.characterization.test.ts.
 *
 * Supabase, the session cookies and the audit service are mocked; what is
 * asserted is the query the route builds and what it logs. The service-role
 * client (`createClient`, which `supabaseServer` is built with) records under
 * the table name; the browser anon client (`createBrowserClient`, imported via
 * ExecutionRepository's default) records under `anon:<table>` (SA C-1).
 *
 * DE-4 (BUSINESS_OS_DATA_EXPORT_DE4_WORKPLAN.md §8 U-9): the eight
 * client_records sections are paged reads, so the mock now honours
 * `.gt('id')`, `.order('id')` and `.limit()`, and strips the quotes of a
 * PostgREST `in` list. The Phase 1 limits are a mutable mock so a test can
 * lower one: over the row ceiling or the body cap the route answers 413 with
 * no file and no DATA_EXPORTED entry.
 *
 * DE-4 (user 2026-10-15): connected apps left the export. The
 * `plugin_connections` profile allow-list cases went with the section; the
 * DE-0a token test stays, now proving the table is never read and no token
 * reaches the body. The file name carries the time on the owner's clock
 * (`user_preferences.timezone`); NULL, invalid or unreadable gives UTC.
 *
 * DE-3 (BUSINESS_OS_DATA_EXPORT_DE3_WORKPLAN.md §7 X-12 / X-14): four account
 * sections read from tables (preferences, notification settings, business
 * profile, business addresses). `hourly_rate_usd` and `org_id` are no longer
 * in the profile section; `role` is. `user_preferences` is now read twice
 * (the preferences section, then the timezone), so a timezone-only error is
 * seeded under `user_preferences:maybeSingle`.
 *
 * DE-5 (BUSINESS_OS_DATA_EXPORT_DE5_WORKPLAN.md §8 M-5, M-6, M-14, M-15; SA
 * C-5, C-6, C-8): ten money sections. Live currency traps go out byte for byte
 * (no conversion, no default, no case change), `summary` keeps its four keys,
 * the tables of money paid to AgentPilot and the excluded money tables are
 * never read even when seeded, a planted user id changes nothing in the ten
 * reads, and the money rows count toward the Phase 1 ceiling.
 *
 * DE-6 (BUSINESS_OS_DATA_EXPORT_DE6_WORKPLAN.md §8 N-6, N-7, N-14, N-15; SA
 * C-4): ten intake, email marketing and consent sections. Visitor-tracking
 * values in consent evidence and subscriber attribution, and token-like query
 * strings on page URLs, never reach the body (the page path does); the
 * lead-message queue, the derived consent projection and email_sends are never
 * read even when seeded; a planted user id changes nothing in the ten reads;
 * the DE-6 rows count toward the Phase 1 ceiling. Earlier expectations change
 * only by the ten section ids and their tables.
 *
 * DE-7 (BUSINESS_OS_DATA_EXPORT_DE7_WORKPLAN.md §8 D-11, D-12, D-13, D-18;
 * SA review DE-7): five content sections. The mock now honours `.in()` (the
 * blocks are read by the owner's page ids) and the mocked limits carry
 * VIA_PARENT_CHUNK. The smart-link counters, the picture reuse key and our
 * storage key never reach the body (`public_url` does); page views, link
 * clicks and templates are never read; a planted user id or page id changes
 * nothing; the content rows count toward the Phase 1 ceiling. `website_blocks`
 * is queried only when the owner has a page, so a run with no pages touches
 * 37 tables. Earlier expectations change only by the five ids and their tables.
 */

import { NextRequest } from 'next/server';

type Call = [string, ...unknown[]];
const mockCalls: Record<string, Call[]> = {};
/** Per-test table rows; when unset a table returns []. */
const mockSeeds: Record<string, Array<Record<string, unknown>>> = {};
/** Per-test PostgREST errors by table (DE-1, FR-E12). */
const mockErrors: Record<string, unknown> = {};

/**
 * Applies the recorded `.not(column, 'in', '(a,b)')` and `.not(column, 'like',
 * 'PREFIX%')` filters to the rows, as PostgREST would, so a test can prove a
 * hidden row seeded into the table never reaches the export.
 * DE-4: an `in` value may be quoted (`("deleted")`); `.gt`, `.order` and
 * `.limit` are applied too, so the paged reader ends on an empty page.
 */
function mockApplyNotFilters(rows: Array<Record<string, unknown>>, calls: Call[]): Array<Record<string, unknown>> {
  let out = rows.filter((row) =>
    calls.every((c) => {
      if (c[0] === 'gt') return String(row[c[1] as string] ?? '') > String(c[2]);
      // DE-7: `.in(column, values)`, values a plain array (the parent-scoped read).
      if (c[0] === 'in') return (c[2] as unknown[]).includes(row[c[1] as string]);
      if (c[0] !== 'not') return true;
      const value = String(row[c[1] as string] ?? '');
      if (c[2] === 'in') return !String(c[3]).slice(1, -1).split(',').map((v) => v.replace(/^"|"$/g, '')).includes(value);
      if (c[2] === 'like') return !value.startsWith(String(c[3]).replace(/%$/, ''));
      throw new Error(`unsupported not filter ${String(c[2])}`);
    })
  );
  const order = calls.find((c) => c[0] === 'order');
  if (order) out = [...out].sort((a, b) => (String(a[order[1] as string]) < String(b[order[1] as string]) ? -1 : 1));
  const limit = calls.find((c) => c[0] === 'limit');
  return limit ? out.slice(0, Number(limit[1])) : out;
}

// DE-4: the Phase 1 limits, lowered per test.
// DE-7: + VIA_PARENT_CHUNK (without it the parent-scoped read fails closed).
const MOCK_DEFAULT_LIMITS = { ROW_CEILING: 100_000, PAGE_SIZE: 1_000, JSON_BODY_MAX_BYTES: 4_000_000, VIA_PARENT_CHUNK: 100 };
const mockLimits = { ...MOCK_DEFAULT_LIMITS };
jest.mock('@/lib/business-os/data-export/limits', () => ({ EXPORT_LIMITS: mockLimits }));

function mockBuilder(key: string) {
  const table = key.startsWith('anon:') ? key.slice('anon:'.length) : key;
  const recorded: Call[] = (mockCalls[key] = mockCalls[key] ?? []);
  // DE-4: this query's own chain. `recorded` spans every query on the table (a
  // paged read is several), so filters are applied from `calls` only.
  const calls: Call[] = [];
  const seeded = mockSeeds[table] ?? [];
  // Resolved lazily so the filters recorded on the chain are applied. DE-4:
  // the select is honoured, as PostgREST does.
  const result = () => {
    if (mockErrors[table]) return { data: null, error: mockErrors[table] };
    const select = calls.find((c) => c[0] === 'select');
    const columns = String(select?.[1] ?? '').split(',').map((c) => c.trim());
    const rows = mockApplyNotFilters(seeded, calls).map((row) =>
      row && typeof row === 'object' ? Object.fromEntries(columns.filter((c) => c in row).map((c) => [c, row[c]])) : row
    );
    return { data: rows, error: null };
  };
  const builder: Record<string, unknown> = {};
  // DE-7: + `in`.
  for (const method of ['select', 'eq', 'neq', 'not', 'in', 'gt', 'gte', 'order', 'limit']) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      recorded.push([method, ...args]);
      return builder;
    };
  }
  builder.single = () => {
    recorded.push(['single']);
    return Promise.resolve({ data: null, error: null });
  };
  // DE-1: the profile read is maybeSingle. It honours the select, as PostgREST
  // does, so a seeded column the route does not select (e.g. `plan`) cannot
  // reach the body through the mock.
  builder.maybeSingle = () => {
    recorded.push(['maybeSingle']);
    // DE-3: an error on this table's single-row read only (the timezone read), not its paged section read.
    if (mockErrors[`${table}:maybeSingle`]) return Promise.resolve({ data: null, error: mockErrors[`${table}:maybeSingle`] });
    if (mockErrors[table]) return Promise.resolve({ data: null, error: mockErrors[table] });
    const row = seeded[0];
    if (!row) return Promise.resolve({ data: null, error: null });
    const select = calls.find((c) => c[0] === 'select');
    const columns = String(select?.[1] ?? '').split(',').map((c) => c.trim());
    return Promise.resolve({ data: Object.fromEntries(columns.filter((c) => c in row).map((c) => [c, row[c]])), error: null });
  };
  builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(result()).then(resolve, reject);
  return builder;
}

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (table: string) => mockBuilder(table) }),
}));

const mockGetUser = jest.fn();
jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { getUser: () => mockGetUser() } }),
  createBrowserClient: () => ({ from: (table: string) => mockBuilder(`anon:${table}`) }),
}));
jest.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));

// DE-1: the real logAndFlush runs; only the AuditTrail singleton it writes through is mocked.
const mockAuditLog = jest.fn();
const mockAuditFlush = jest.fn();
jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrail: {
    log: (...args: unknown[]) => mockAuditLog(...args),
    flush: () => mockAuditFlush(),
  },
}));

const mockLogged: Array<{ level: string; fields: Record<string, unknown>; msg: string }> = [];
const mockChildBindings: Array<Record<string, unknown>> = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) {
      logger[level] = (first: unknown, second?: unknown) => {
        const fields =
          typeof first === 'object' && first !== null
            ? JSON.parse(JSON.stringify(first, (_k, v) => (v instanceof Error ? { name: v.name, message: v.message } : v)))
            : {};
        mockLogged.push({ level, fields, msg: typeof first === 'string' ? first : String(second ?? '') });
      };
    }
    logger.child = (bindings: Record<string, unknown>) => {
      mockChildBindings.push(bindings);
      return logger;
    };
    return logger;
  };
  return { createLogger: () => make() };
});

import { GET } from '../route';
import { __resetAuditFlushChainForTests } from '@/lib/audit/boundedAuditFlush';
import { userPreferencesRepository } from '@/lib/repositories/UserPreferencesRepository';

const OWNER = { id: '2f734ed5-3681-4049-880d-3de7b096bea3', email: 'a@example.com', created_at: '2026-01-01T00:00:00Z' };

function request(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/user/data-export', { headers });
}

type ExportSection = { id: string; status: string; row_count: number; rows: Array<Record<string, unknown>> };

/** One section of the body, by id (DE-1: the body is a list of sections). */
function sectionOf(body: { sections: ExportSection[] }, id: string): ExportSection {
  const found = body.sections.find((s) => s.id === id);
  if (!found) throw new Error(`no section ${id}`);
  return found;
}

let consoleSpies: jest.SpyInstance[] = [];

beforeEach(() => {
  for (const key of Object.keys(mockCalls)) delete mockCalls[key];
  for (const key of Object.keys(mockSeeds)) delete mockSeeds[key];
  for (const key of Object.keys(mockErrors)) delete mockErrors[key];
  Object.assign(mockLimits, MOCK_DEFAULT_LIMITS);
  mockGetUser.mockReset();
  mockAuditLog.mockReset();
  mockAuditLog.mockResolvedValue(undefined);
  mockAuditFlush.mockReset();
  mockAuditFlush.mockResolvedValue(undefined);
  __resetAuditFlushChainForTests();
  mockLogged.length = 0;
  mockChildBindings.length = 0;
  consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) => jest.spyOn(console, method).mockImplementation(() => undefined));
});

afterEach(() => {
  for (const spy of consoleSpies) {
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  }
});

describe('GET /api/user/data-export', () => {
  it('returns 401 with no session and reads nothing', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await GET(request());
    expect(res.status).toBe(401);
    expect(Object.keys(mockCalls)).toHaveLength(0);
  });

  it('still records the export in the audit trail, and flushes it before responding (WC-7)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    await GET(request());
    expect(mockAuditLog).toHaveBeenCalledTimes(1);
    expect(mockAuditFlush).toHaveBeenCalledTimes(1);
    expect(mockAuditLog.mock.calls[0][0]).toMatchObject({
      action: 'DATA_EXPORTED',
      entityType: 'user',
      entityId: OWNER.id,
      userId: OWNER.id,
      severity: 'info',
      complianceFlags: ['GDPR', 'SOC2'],
    });
  });

  it('logs with Pino: correlation id from the header, userId as a field, counts only (W26-7)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    await GET(request({ 'x-correlation-id': 'corr-123' }));
    expect(mockChildBindings).toContainEqual({ correlationId: 'corr-123' });
    const started = mockLogged.find((l) => l.msg === 'Data export started');
    expect(started).toMatchObject({ level: 'info', fields: { userId: OWNER.id } });
    const completed = mockLogged.find((l) => l.msg === 'Data export completed');
    // DE-1: section counts and the failed list, was total_* counts.
    expect(completed?.fields).toMatchObject({ userId: OWNER.id, failedSections: [] });
    expect(Object.keys(completed?.fields ?? {}).sort()).toEqual(['durationMs', 'exportSizeKb', 'failedSections', 'sectionCounts', 'userId']);
    for (const value of Object.values(completed?.fields.sectionCounts as Record<string, unknown>)) {
      expect(typeof value).toBe('number');
    }
    expect(typeof completed?.fields.exportSizeKb).toBe('number');
    expect(typeof completed?.fields.durationMs).toBe('number');
    // No emoji anywhere in what is logged. The ranges are numeric code points so
    // this file carries no escape sequences (repo rule, QA26-1).
    const emojiRanges: Array<[number, number]> = [
      [0x1f300, 0x1faff],
      [0x2600, 0x27bf],
    ];
    const isEmoji = (ch: string): boolean => {
      const cp = ch.codePointAt(0) ?? 0;
      return emojiRanges.some(([lo, hi]) => cp >= lo && cp <= hi);
    };
    expect(Array.from(JSON.stringify(mockLogged)).filter(isEmoji)).toEqual([]);
    // Negative control: the scan does catch an emoji.
    expect(Array.from(`x${String.fromCodePoint(0x1f600)}y`).some(isEmoji)).toBe(true);
  });

  it('falls back to a generated correlation id', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    await GET(request());
    expect(typeof mockChildBindings[0]?.correlationId).toBe('string');
    expect(String(mockChildBindings[0]?.correlationId).length).toBeGreaterThan(0);
  });

  // DE-1 (WC-7): logAndFlush logs the failure itself and never rejects.
  it('logs a failed audit write as an error with { err } and still returns the export', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    mockAuditFlush.mockRejectedValue(new Error('queue full'));
    const res = await GET(request());
    expect(res.status).toBe(200);
    expect(sectionOf(JSON.parse(await res.text()), 'account_identity').status).toBe('ok');
    const failed = mockLogged.find((l) => l.msg === 'Audit flush on data export failed; the export is still returned');
    expect(failed).toMatchObject({ level: 'error', fields: { err: { message: 'queue full' }, userId: OWNER.id, action: 'DATA_EXPORTED' } });
    expect(mockLogged.find((l) => l.msg === 'Data export failed')).toBeUndefined();
  });

  it('logs an unexpected failure with { err } and returns 500', async () => {
    // OP-4: a repository now catches a rejecting table read and returns
    // `{ error }`, so the only throw that reaches the route's catch is one
    // outside the reads. Driven by a rejecting getUser().
    mockGetUser.mockRejectedValue(new Error('relation "secret_table" does not exist'));
    const res = await GET(request());
    expect(res.status).toBe(500);
    const failed = mockLogged.find((l) => l.msg === 'Data export failed');
    expect(failed).toMatchObject({ level: 'error', fields: { err: { message: 'relation "secret_table" does not exist' } } });
  });

  describe('the 500 body (FU-P2, DATA_EXPORT_FOLLOWUPS_WORKPLAN.md)', () => {
    const env = process.env as Record<string, string | undefined>;
    const originalNodeEnv = env.NODE_ENV;
    afterEach(() => {
      env.NODE_ENV = originalNodeEnv;
    });

    it('in production carries no message, no details and none of the error text', async () => {
      env.NODE_ENV = 'production';
      mockGetUser.mockRejectedValue(new Error('relation "secret_table" does not exist'));
      const res = await GET(request());
      expect(res.status).toBe(500);
      const text = await res.text();
      expect(JSON.parse(text)).toEqual({ success: false, error: 'Data export failed' });
      expect(text).not.toContain('secret_table');
    });

    it('in development carries the message as details', async () => {
      env.NODE_ENV = 'development';
      mockGetUser.mockRejectedValue(new Error('relation "secret_table" does not exist'));
      const res = await GET(request());
      expect(res.status).toBe(500);
      expect(JSON.parse(await res.text())).toEqual({
        success: false,
        error: 'Data export failed',
        details: 'relation "secret_table" does not exist',
      });
    });
  });

  // DE-4 (user 2026-10-15): the two plugin_connections profile_data cases
  // ("exports only the allow-listed provider profile strings", "gives an empty
  // account_profile") were removed with the section; the DE-0a describe below
  // keeps the token assertions.

  it('reads nothing on the browser anon client (C-1)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    await GET(request());
    expect(Object.keys(mockCalls).filter((k) => k.startsWith('anon:'))).toEqual([]);
    // DE-1: was agent_executions, the read that used to default to the anon client.
    // DE-4 (user 2026-10-15): plugin_connections is never read; user_preferences is (the file name's clock).
    expect(mockCalls.plugin_connections).toBeUndefined();
    expect(mockCalls.profiles).toBeDefined();
    expect(mockCalls.user_preferences).toBeDefined();
  });

  it('holds none of the parts DE-1 removed, as a key or as a section (DX-1, BQ-SA-1)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    const body = JSON.parse(await (await GET(request())).text());
    const sectionIds = body.sections.map((s: ExportSection) => s.id);
    for (const removed of ['agents', 'agent_executions', 'agent_configurations', 'subscriptions', 'transactions', 'audit_logs']) {
      expect(Object.keys(body)).not.toContain(removed);
      expect(sectionIds).not.toContain(removed);
    }
    // DE-4: + the eight client_records sections and their tables.
    // DE-4 (user 2026-10-15): plugin_connections removed; + user_preferences (the file name's clock).
    // DE-3: + the four account sections read from tables, after user_profile, and their tables.
    // DE-5: + payment_account, payment_providers after business_addresses; + the eight money sections after time_off.
    // DE-6: + the ten intake, email marketing and consent sections after client_payment_methods.
    expect(sectionIds).toEqual([
      'account_identity', 'user_profile', 'preferences', 'notification_settings', 'business_profile', 'business_addresses',
      'payment_account', 'payment_providers',
      'pipeline_stages', 'clients', 'client_activities', 'client_tasks', 'client_documents', 'services', 'bookings', 'time_off',
      'quotes', 'invoices', 'payments', 'refunds', 'payment_plans', 'client_payment_plans', 'installments', 'client_payment_methods',
      'intake_settings', 'intake_forms', 'email_campaigns', 'email_sequences', 'email_sequence_steps',
      'email_sequence_enrollments', 'newsletter_subscribers', 'consent_records', 'consent_settings', 'email_unsubscribes',
      // DE-7: + the five content sections.
      'website_content', 'website_pages', 'website_blocks', 'smart_links', 'images',
    ]);
    // DE-5: + the ten money tables. DE-6: + the ten DE-6 tables.
    // DE-7: + four content tables; website_blocks is not queried (no page seeded, so no page id to read it by).
    expect(Object.keys(mockCalls).sort()).toEqual([
      'business_addresses', 'business_intake_forms', 'business_profiles', 'business_subscribers',
      'contact_documents', 'crm_activities', 'crm_contacts', 'crm_pipeline_stages', 'crm_tasks',
      'email_campaigns', 'email_sequence_enrollments', 'email_sequence_steps', 'email_sequences', 'email_unsubscribes',
      'marketing_consent_events', 'marketing_consent_settings', 'notification_settings',
      'payment_invoices', 'payment_plan_installments', 'payment_plan_subscriptions', 'payment_plans', 'payment_processors',
      'payment_refunds', 'payment_transactions', 'profiles', 'proposals', 'saved_payment_methods',
      'scheduling_availability_exceptions', 'scheduling_bookings', 'scheduling_services', 'smart_links', 'stripe_connect_accounts',
      'user_intake_settings', 'user_media', 'user_preferences', 'website_content', 'website_pages',
    ]);
    // BC-5: the calendar copy is never read.
    expect(mockCalls.external_calendar_events).toBeUndefined();
  });

  it('never exports profiles.plan, even when the row has one (DE-1, SA Q-3 / C-1)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    // A sentinel, not a tier name: tier literals are forbidden outside the entitlements config.
    // DE-3 (X-12): + org_id and role; hourly_rate_usd and org_id are no longer exported, role is.
    mockSeeds.profiles = [
      { id: OWNER.id, full_name: 'Ada Owner', plan: 'qa-plan-value', hourly_rate_usd: 50, org_id: 'qa-org-id-value', role: 'business_owner' },
    ];
    const text = await (await GET(request())).text();
    const profile = sectionOf(JSON.parse(text), 'user_profile');
    expect(profile.status).toBe('ok');
    // DE-3: was [{ id, full_name, hourly_rate_usd: 50 }].
    expect(profile.rows).toEqual([{ id: OWNER.id, full_name: 'Ada Owner', role: 'business_owner' }]);
    expect(Object.keys(profile.rows[0])).not.toContain('plan');
    expect(text).not.toContain('"plan"');
    expect(text).not.toContain('qa-plan-value');
    // DE-3 (BC-A / BC-G).
    for (const out of ['"hourly_rate_usd"', '"org_id"', 'qa-org-id-value']) expect(text).not.toContain(out);
  });

  // DE-3 (new): the four account sections carry exactly the descriptor columns; the ruled exclusions never reach the file.
  it('exports the profile details: preferences, notifications, business profile, addresses; the ruled columns stay out (DE-3)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    const P = '50000000-0000-4000-8000-000000000005';
    mockSeeds.user_preferences = [
      { id: P, user_id: OWNER.id, timezone: 'Asia/Jerusalem', preferred_language: 'he', default_model: 'QA-MODEL', temperature: 0.7, debug_mode: true },
    ];
    mockSeeds.notification_settings = [
      { id: P, user_id: OWNER.id, email_enabled: true, quiet_hours_timezone: 'Asia/Jerusalem', push_agent_updates: true, email_agent_updates: false },
    ];
    mockSeeds.business_profiles = [
      {
        id: P,
        user_id: OWNER.id,
        company_name: 'Acme Studio',
        invoice_tax_id: '515151515',
        invoice_bank_account: 'QA-IBAN-NEVER',
        invoice_bank_routing: 'QA-ROUTING-NEVER',
        invoice_bank_name: 'QA-BANK-NEVER',
        invoice_payment_instructions: 'QA-PAY-TO-IBAN-NEVER',
        website_analysis: { summary: 'QA-ANALYSIS-NEVER' },
        onboarding_conversation: [{ role: 'user', content: 'QA-CHAT-NEVER' }],
        connected_plugins: ['QA-PLUGIN-NEVER'],
        calendar_sync_provider: 'QA-SYNC-NEVER',
        profile_completeness: 80,
      },
    ];
    mockSeeds.business_addresses = [{ id: P, user_id: OWNER.id, label: 'Studio', parts: { city: 'Tel Aviv' }, is_default: true }];
    const res = await GET(request());
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text);
    expect(sectionOf(body, 'preferences').rows).toEqual([{ id: P, preferred_language: 'he', timezone: 'Asia/Jerusalem' }]);
    expect(sectionOf(body, 'notification_settings').rows).toEqual([{ id: P, email_enabled: true, quiet_hours_timezone: 'Asia/Jerusalem' }]);
    expect(sectionOf(body, 'business_profile').rows).toEqual([{ id: P, company_name: 'Acme Studio', invoice_tax_id: '515151515' }]);
    expect(sectionOf(body, 'business_addresses').rows).toEqual([{ id: P, label: 'Studio', parts: { city: 'Tel Aviv' }, is_default: true }]);
    for (const id of ['preferences', 'notification_settings', 'business_profile', 'business_addresses']) {
      expect(body.sections.find((s: ExportSection & { group: string; gdpr_role: string }) => s.id === id)).toMatchObject({
        group: 'account', gdpr_role: 'controller', status: 'ok', row_count: 1,
      });
    }
    for (const leaked of ['NEVER', 'QA-MODEL', '"temperature"', '"debug_mode"', '"push_agent_updates"', '"email_agent_updates"', '"profile_completeness"']) {
      expect(text).not.toContain(leaked);
    }
    // The owner id is in export_metadata.user_id only, never on a row (OWNER_ID).
    for (const id of ['preferences', 'notification_settings', 'business_profile', 'business_addresses']) {
      for (const row of sectionOf(body, id).rows) expect(Object.keys(row)).not.toContain('user_id');
    }
    // The audit entry gains the four counts, counts only.
    const details = mockAuditLog.mock.calls[0][0].details;
    expect(details.section_counts).toMatchObject({ preferences: 1, notification_settings: 1, business_profile: 1, business_addresses: 1 });
    expect(JSON.stringify(details)).not.toContain('Acme Studio');
  });

  // DE-4 (user 2026-10-15): driven through profiles, was plugin_connections.
  it('marks a failed profiles read as failed, still 200, with no error text (FR-E12)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    mockErrors.profiles = { message: 'relation "secret_table" does not exist', code: '42P01' };
    const res = await GET(request());
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text);
    expect(sectionOf(body, 'user_profile')).toMatchObject({ status: 'failed', row_count: 0, rows: [] });
    expect(body.summary.failed_sections).toEqual(['user_profile']);
    expect(text).not.toContain('secret_table');
    expect(text).not.toContain('42P01');
  });
});

/** DE-5: the ten money tables the export reads, in registry order. */
const DE5_MONEY_TABLES = [
  'stripe_connect_accounts', 'payment_processors', 'proposals', 'payment_invoices', 'payment_transactions', 'payment_refunds',
  'payment_plans', 'payment_plan_subscriptions', 'payment_plan_installments', 'saved_payment_methods',
] as const;

describe('DE-4: client records and the Phase 1 ceiling (U-9)', () => {
  const C1 = '10000000-0000-4000-8000-000000000001';
  const C2 = '20000000-0000-4000-8000-000000000002';

  function seedClients(): void {
    mockSeeds.crm_contacts = [
      {
        id: C1,
        user_id: OWNER.id,
        first_name: 'Dana',
        source_metadata: { capture_channel: 'website', ip_hash: 'QA-IP-HASH', user_agent: 'QA-UA', session_id: 'QA-SESSION' },
      },
      { id: C2, user_id: OWNER.id, first_name: 'Noa', source_metadata: null },
    ];
    mockSeeds.contact_documents = [
      { id: '30000000-0000-4000-8000-000000000003', user_id: OWNER.id, name: 'kept-archived-doc', status: 'archived' },
      { id: '40000000-0000-4000-8000-000000000004', user_id: OWNER.id, name: 'QA-DELETED-DOC', status: 'deleted', storage_path: 'QA-STORAGE-PATH' },
    ];
  }

  it('exports the client records: deleted documents out, archived in, only the BC-4 source keys', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    seedClients();
    const res = await GET(request());
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text);
    expect(sectionOf(body, 'clients').rows.map((r) => r.first_name)).toEqual(['Dana', 'Noa']);
    expect(sectionOf(body, 'clients').rows[0].source_metadata).toEqual({ capture_channel: 'website' });
    expect(sectionOf(body, 'client_documents').rows.map((r) => r.name)).toEqual(['kept-archived-doc']);
    for (const leaked of ['QA-IP-HASH', 'QA-UA', 'QA-SESSION', 'QA-DELETED-DOC', 'QA-STORAGE-PATH', '"storage_path"']) {
      expect(text).not.toContain(leaked);
    }
    expect(body.export_metadata.groups.client_records).toMatchObject({ gdpr_role: 'processor', controller: 'account_holder' });
    // The audit entry gains the eight counts, counts only.
    const details = mockAuditLog.mock.calls[0][0].details;
    expect(details.section_counts).toMatchObject({ clients: 2, client_documents: 1, bookings: 0 });
    expect(JSON.stringify(details)).not.toContain('Dana');
  });

  it('ignores a planted ?userId= and x-user-id: every read is keyed on the session id', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    seedClients();
    const OTHER = '99999999-9999-4999-8999-999999999999';
    const res = await GET(new NextRequest(`http://localhost/api/user/data-export?userId=${OTHER}`, { headers: { 'x-user-id': OTHER } }));
    expect(res.status).toBe(200);
    const eqCalls = Object.values(mockCalls).flat().filter((c) => c[0] === 'eq');
    expect(eqCalls.length).toBeGreaterThan(10);
    for (const c of eqCalls) expect(c[2]).toBe(OWNER.id);
    expect(JSON.stringify(mockCalls)).not.toContain(OTHER);
    // DE-3 (X-14): the four account tables were read, each keyed on the session id.
    for (const table of ['user_preferences', 'notification_settings', 'business_profiles', 'business_addresses']) {
      expect(mockCalls[table]).toContainEqual(['eq', 'user_id', OWNER.id]);
    }
    // DE-5 (M-14, SA C-8): and the ten money tables, each keyed on the session id only.
    for (const table of DE5_MONEY_TABLES) {
      expect(mockCalls[table]).toContainEqual(['eq', 'user_id', OWNER.id]);
      expect(mockCalls[table].filter((c) => c[0] === 'eq').every((c) => c[1] === 'user_id' && c[2] === OWNER.id)).toBe(true);
    }
  });

  const TOO_LARGE = {
    success: false,
    error: 'Your account holds more than the on-screen download can package. Nothing was downloaded. Please contact support and we will prepare your export.',
    code: 'export_too_large',
  };

  it('over the row ceiling: 413, the pinned body, no-store, no file, no DATA_EXPORTED; warn with counts only', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    seedClients();
    // identity 1 + clients 2 = 3 > 2.
    mockLimits.ROW_CEILING = 2;
    const res = await GET(request());
    expect(res.status).toBe(413);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual(TOO_LARGE);
    expect(res.headers.get('Cache-Control')).toBe('no-store, no-cache, must-revalidate');
    expect(res.headers.get('Content-Disposition')).toBeNull();
    expect(text).not.toContain('Dana');
    expect(mockAuditLog).not.toHaveBeenCalled();
    const warn = mockLogged.find((l) => l.msg === 'Data export refused: over the Phase 1 ceiling');
    expect(warn).toMatchObject({ level: 'warn', fields: { event: 'data_export_over_ceiling', userId: OWNER.id, limit: 'rows', rowCeiling: 2, atSection: 'clients' } });
    expect(Object.keys(warn?.fields ?? {}).sort()).toEqual(['atSection', 'durationMs', 'event', 'limit', 'rowCeiling', 'sectionCounts', 'userId']);
    expect(JSON.stringify(mockLogged)).not.toContain('Dana');
    expect(mockLogged.find((l) => l.msg === 'Data export completed')).toBeUndefined();
  });

  it('over the body cap: the same 413, measured on the exact bytes (negative control: a 1 KB cap refuses a normal export)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    seedClients();
    // A frozen Date.now, so export_duration_ms (and so the byte count) is the same on every call.
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-07-15T12:00:00.000Z'));
    try {
      const normal = await GET(request());
      expect(normal.status).toBe(200);
      const bytes = Buffer.byteLength(await normal.text(), 'utf8');
      expect(bytes).toBeGreaterThan(1024);

      mockAuditLog.mockClear();
      mockLimits.JSON_BODY_MAX_BYTES = 1024;
      const res = await GET(request());
      expect(res.status).toBe(413);
      expect(JSON.parse(await res.text())).toEqual(TOO_LARGE);
      expect(res.headers.get('Cache-Control')).toBe('no-store, no-cache, must-revalidate');
      expect(mockAuditLog).not.toHaveBeenCalled();
      const warn = mockLogged.filter((l) => l.msg === 'Data export refused: over the Phase 1 ceiling').pop();
      expect(warn).toMatchObject({ level: 'warn', fields: { event: 'data_export_over_ceiling', limit: 'body', bodyBytes: bytes, bodyMaxBytes: 1024 } });

      // Exactly at the cap is sent: the check is "over", on the same string.
      mockLimits.JSON_BODY_MAX_BYTES = bytes;
      expect((await GET(request())).status).toBe(200);
    } finally {
      nowSpy.mockRestore();
    }
  });
});

describe('DE-0a: plugin_connections tokens never reach the export body (QA)', () => {
  // SA DE-4 F-4: this mock honours `select`, so it would drop a token column the
  // route did not select before any mapper saw it. The raw-row token check, a
  // mock that returns every seeded column unprojected, lives in
  // route.characterization.test.ts (its CONNECTIONS seed and `never-exported`
  // assertions). Keep that mock raw.
  // DE-4 (user 2026-10-15): connected apps left the export. This case now
  // proves the table is never read at all, and that no token string, key or
  // connection field appears anywhere in the body; was "exports one
  // connection with only account_profile { name }".
  it('a connection row carrying access_token / refresh_token / credentials / token-bearing profile_data exports none of them', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    mockSeeds.plugin_connections = [
      {
        user_id: OWNER.id,
        plugin_key: 'google-mail',
        plugin_name: 'Gmail',
        username: 'Ada',
        email: 'a@example.com',
        status: 'active',
        created_at: '2026-02-01T00:00:00Z',
        updated_at: '2026-03-01T00:00:00Z',
        access_token: 'QA-ACCESS-TOKEN-SECRET',
        refresh_token: 'QA-REFRESH-TOKEN-SECRET',
        credentials: { api_key: 'QA-CREDENTIALS-SECRET' },
        expires_at: '2099-01-01',
        settings: { webhook_secret: 'QA-SETTINGS-SECRET' },
        profile_data: { name: 'Ada', access_token: 'QA-PROFILE-ACCESS', refresh_token: 'QA-PROFILE-REFRESH', id_token: 'QA-PROFILE-ID' },
      },
    ];
    const res = await GET(request());
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text);
    // DE-4 (user 2026-10-15): never read, on any client; no section.
    expect(mockCalls.plugin_connections).toBeUndefined();
    expect(mockCalls['anon:plugin_connections']).toBeUndefined();
    expect(body.sections.map((x: ExportSection) => x.id)).not.toContain('plugin_connections');
    for (const key of ['access_token', 'refresh_token', 'credentials', 'profile_data', 'id_token', 'expires_at', 'settings', 'plugin_key', 'account_profile']) {
      expect(text).not.toContain(`"${key}"`);
    }
    for (const secret of ['QA-ACCESS-TOKEN-SECRET', 'QA-REFRESH-TOKEN-SECRET', 'QA-CREDENTIALS-SECRET', 'QA-SETTINGS-SECRET', 'QA-PROFILE-ACCESS', 'QA-PROFILE-REFRESH', 'QA-PROFILE-ID']) {
      expect(text).not.toContain(secret);
    }
    // DE-4 (user 2026-10-15): nor any connection field (the connection had a name and an account).
    expect(text).not.toContain('Gmail');
    expect(text).not.toContain('google-mail');
    // Nor in the audit entry or the logs.
    expect(JSON.stringify(mockAuditLog.mock.calls)).not.toContain('QA-ACCESS-TOKEN-SECRET');
    expect(JSON.stringify(mockLogged)).not.toContain('QA-ACCESS-TOKEN-SECRET');
  });
});

describe("DE-4 (user 2026-10-15): the file name's clock never fails the export", () => {
  it('the owner timezone is read through the repository, keyed on the session id, one explicit column', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    // DE-3: the row carries its id, as live (the preferences section pages on it).
    mockSeeds.user_preferences = [{ id: '50000000-0000-4000-8000-000000000005', user_id: OWNER.id, timezone: 'Asia/Jerusalem', preferred_language: 'he' }];
    const res = await GET(request());
    expect(res.status).toBe(200);
    // DE-3: the preferences section reads the table first; the timezone read is the last three calls.
    expect(mockCalls.user_preferences.slice(-3)).toEqual([['select', 'timezone'], ['eq', 'user_id', OWNER.id], ['maybeSingle']]);
    expect(res.headers.get('Content-Disposition')).toMatch(/^attachment; filename="agentpilot-data-export-\d{4}-\d{2}-\d{2}-\d{4}\.json"$/);
  });

  // SA Low (DE-4 review): a `Date.now` spy does not reach the route's
  // `new Date()`, so the name was never pinned here. A frozen system clock
  // fixes both, and the UTC name is asserted.
  const UTC_NAME = 'attachment; filename="agentpilot-data-export-2026-07-15-2230.json"';
  const freezeClock = () =>
    jest.useFakeTimers({ now: Date.parse('2026-07-15T22:30:00.000Z'), doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] });
  const TZ_WARN = 'Data export: timezone unreadable, file name in UTC';

  it('a timezone read error: still 200 with a UTC name, the error text in no body, a warn line', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    // DE-3: on the timezone read only, was on the whole table (now also the preferences section).
    mockErrors['user_preferences:maybeSingle'] = { message: 'relation "secret_prefs" does not exist', code: '42P01' };
    freezeClock();
    try {
      const res = await GET(request());
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Disposition')).toBe(UTC_NAME);
      const text = await res.text();
      expect(text).not.toContain('secret_prefs');
      expect(JSON.parse(text).summary.failed_sections).toEqual([]);
      expect(mockAuditLog).toHaveBeenCalledTimes(1);
      expect(mockLogged.find((l) => l.msg === TZ_WARN)).toMatchObject({ level: 'warn', fields: { userId: OWNER.id } });
      expect(mockLogged.find((l) => l.msg === 'Data export failed')).toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });

  // QA delta DE-4 Edge case 1: `findTimezone` never throws by contract, so the
  // catch in `ownerTimezone` is defensive. A throw still gives the export, in UTC.
  it('a timezone read that throws: still 200, the UTC name, the same body as a stored UTC, one warn, no failure line', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    freezeClock();
    const throwSpy = jest.spyOn(userPreferencesRepository, 'findTimezone');
    try {
      // Baseline: a stored UTC, at the same frozen instant.
      // DE-3: + the row id, as live.
      mockSeeds.user_preferences = [{ id: '50000000-0000-4000-8000-000000000005', user_id: OWNER.id, timezone: 'UTC' }];
      const baseline = await GET(request());
      expect(baseline.status).toBe(200);
      expect(baseline.headers.get('Content-Disposition')).toBe(UTC_NAME);
      const baselineText = await baseline.text();

      mockLogged.length = 0;
      throwSpy.mockRejectedValueOnce(new Error('prefs exploded: relation "secret_prefs"'));
      const res = await GET(request());
      expect(throwSpy).toHaveBeenCalledWith(OWNER.id);
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Disposition')).toBe(UTC_NAME);
      const text = await res.text();
      expect(text).toBe(baselineText);
      expect(text).not.toContain('secret_prefs');
      const warns = mockLogged.filter((l) => l.msg === TZ_WARN);
      expect(warns).toHaveLength(1);
      // The catch logs { err, userId }: ids and the error object, nothing else.
      expect(warns[0]).toMatchObject({ level: 'warn', fields: { userId: OWNER.id } });
      expect(Object.keys(warns[0].fields).sort()).toEqual(['err', 'userId']);
      expect(mockLogged.find((l) => l.msg === 'Data export failed')).toBeUndefined();
    } finally {
      throwSpy.mockRestore();
      jest.useRealTimers();
    }
  });
});

// ── DE-5: client money (SA C-5, C-6, M-15) ──────────────────────────────────

describe('DE-5 C-5: the live currency traps go out exactly as stored; no total', () => {
  const PAY_ILS_USD_FEE = '61000000-0000-4000-8000-000000000001';
  const PAY_USD_NO_FEE = '62000000-0000-4000-8000-000000000002';
  const REFUND_ILS = '63000000-0000-4000-8000-000000000003';
  const CONNECT = '64000000-0000-4000-8000-000000000004';
  const INVOICE_EUR = '65000000-0000-4000-8000-000000000005';

  function seedTraps(): void {
    // One owner, two (three) currencies: ILS and USD payments, a EUR invoice.
    mockSeeds.payment_transactions = [
      // ILS payment, fees in USD (39 such rows live).
      { id: PAY_ILS_USD_FEE, user_id: OWNER.id, amount: 350.5, currency: 'ILS', status: 'succeeded', processor_fee: 3.21, net_amount: 91.04, fee_currency: 'USD', refunded_amount: 120, charge_account_kind: 'connect', account_resolution: 'resolved' },
      // USD payment, fee not recorded: NULL fee and NULL fee_currency (58 live), never zero, never filled in.
      { id: PAY_USD_NO_FEE, user_id: OWNER.id, amount: 80, currency: 'USD', status: 'failed', processor_fee: null, net_amount: null, fee_currency: null },
    ];
    // An ILS refund under the USD-fee payment, with fee_returned set: it gains NO currency key.
    mockSeeds.payment_refunds = [
      { id: REFUND_ILS, user_id: OWNER.id, transaction_id: PAY_ILS_USD_FEE, amount: 120, amount_minor: 12000, currency: 'ILS', status: 'succeeded', fee_returned: 1.1, refund_fee: null, idempotency_key: 'QA-IDEMPOTENCY-NEVER' },
    ];
    // Connect currency is stored lower case live: exported as stored.
    mockSeeds.stripe_connect_accounts = [{ id: CONNECT, user_id: OWNER.id, stripe_account_id: 'acct_1', currency: 'usd', country: 'IL' }];
    mockSeeds.payment_invoices = [{ id: INVOICE_EUR, user_id: OWNER.id, amount: 99.99, currency: 'EUR', status: 'draft', refunded_amount: 0 }];
  }

  it('every amount and currency is byte-equal to the seed; NULL stays NULL; usd stays lower case', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    seedTraps();
    const res = await GET(request());
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text);
    expect(JSON.stringify(sectionOf(body, 'payments').rows)).toBe(JSON.stringify([
      { id: PAY_ILS_USD_FEE, amount: 350.5, currency: 'ILS', status: 'succeeded', refunded_amount: 120, processor_fee: 3.21, net_amount: 91.04, fee_currency: 'USD', metadata: {} },
      // No metadata in the seed: the allow-list still writes an object, as clients.source_metadata.
      { id: PAY_USD_NO_FEE, amount: 80, currency: 'USD', status: 'failed', processor_fee: null, net_amount: null, fee_currency: null, metadata: {} },
    ]));
    // The refund keeps its own currency (ILS) and gets no fee currency from its USD-fee payment.
    const [refund] = sectionOf(body, 'refunds').rows;
    expect(JSON.stringify(refund)).toBe(JSON.stringify({
      id: REFUND_ILS, transaction_id: PAY_ILS_USD_FEE, amount: 120, amount_minor: 12000, currency: 'ILS', status: 'succeeded', fee_returned: 1.1, refund_fee: null,
    }));
    expect(Object.keys(refund).filter((k) => /currency/.test(k))).toEqual(['currency']);
    expect(sectionOf(body, 'payment_account').rows).toEqual([{ id: CONNECT, stripe_account_id: 'acct_1', country: 'IL', currency: 'usd' }]);
    expect(sectionOf(body, 'invoices').rows).toEqual([{ id: INVOICE_EUR, amount: 99.99, currency: 'EUR', status: 'draft', refunded_amount: 0 }]);
    // BC-11: no total of any kind; the summary keeps exactly its four keys.
    expect(Object.keys(body.summary)).toEqual(['section_counts', 'failed_sections', 'export_size_kb', 'export_duration_ms']);
    expect(Object.values(body.summary.section_counts).every((v) => Number.isInteger(v))).toBe(true);
    expect(text).not.toMatch(/"(total|totals|money_total|revenue|revenue_by_currency|sum|amount_total)"\s*:/);
    // Out columns stay out.
    for (const leaked of ['QA-IDEMPOTENCY-NEVER', '"charge_account_kind"', '"account_resolution"', '"user_id"']) {
      expect(JSON.stringify(body.sections)).not.toContain(leaked);
    }
    // The audit entry carries counts only: no amount, no currency.
    const details = mockAuditLog.mock.calls[0][0].details;
    expect(details.section_counts).toMatchObject({ payments: 2, refunds: 1, payment_account: 1, invoices: 1 });
    const audit = JSON.stringify(details);
    for (const s of ['ILS', 'USD', 'EUR', '350.5', '99.99']) expect(audit).not.toContain(s);
  });

  it('negative control: a planted money total in the summary would be seen', () => {
    const planted = { section_counts: {}, failed_sections: [], export_size_kb: 1, export_duration_ms: 0, money_total: 430.5 };
    expect(Object.keys(planted)).not.toEqual(['section_counts', 'failed_sections', 'export_size_kb', 'export_duration_ms']);
    expect(JSON.stringify({ summary: planted })).toMatch(/"(total|totals|money_total|revenue|revenue_by_currency|sum|amount_total)"\s*:/);
  });
});

describe('DE-5 C-6 (a): money paid to AgentPilot is never read, even when seeded', () => {
  // SA F-1 (2026-10-16): `subscriptions` is not a live table, so it is not seeded.
  const MONEY_TO_US = [
    'billing_events', 'boost_pack_purchases', 'user_subscriptions', 'credit_transactions', 'subscription_invoices',
    'business_os_account_plans', 'business_os_billing_accounts', 'business_os_billing_events', 'business_os_credit_charges',
    'business_os_credit_totals', 'business_os_credit_lots', 'business_os_credit_lot_draws', 'business_os_boost_purchases',
  ];
  const EXCLUDED_MONEY = ['payment_events', 'payment_reminders', 'payment_automation_rules', 'payment_automation_executions', 'payment_methods'];

  /** Billing or excluded tables among the tables a run touched. */
  const touchedForbidden = (touched: readonly string[]): string[] =>
    touched.map((k) => k.replace(/^anon:/, '')).filter((t) => MONEY_TO_US.includes(t) || EXCLUDED_MONEY.includes(t));

  // DE-6: 33 section tables, was 23.
  // DE-7: 37, was 33: + four content tables (website_blocks is queried only when the owner has a page).
  it('the run touches exactly the 37 section tables (+ the timezone read on user_preferences); none of these', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    for (const t of [...MONEY_TO_US, ...EXCLUDED_MONEY]) {
      mockSeeds[t] = [{ id: '70000000-0000-4000-8000-000000000007', user_id: OWNER.id, amount: 49, currency: 'USD', note: `QA-${t}-NEVER` }];
    }
    const res = await GET(request());
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(touchedForbidden(Object.keys(mockCalls))).toEqual([]);
    expect(Object.keys(mockCalls)).toHaveLength(37);
    expect(text).not.toContain('NEVER');
  });

  it('negative control: a run that touched a billing table is red', () => {
    expect(touchedForbidden(['payment_transactions', 'billing_events', 'anon:payment_events'])).toEqual(['billing_events', 'payment_events']);
  });
});

describe('DE-5 M-15: the money sections draw on the Phase 1 row ceiling', () => {
  it('payments over the remaining budget: 413, no file, no DATA_EXPORTED', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    mockSeeds.payment_transactions = Array.from({ length: 3 }, (_, n) => ({ id: `8000000${n}-0000-4000-8000-000000000000`, user_id: OWNER.id, amount: 10, currency: 'ILS' }));
    // identity 1 + payments 3 = 4 > 3.
    mockLimits.ROW_CEILING = 3;
    const res = await GET(request());
    expect(res.status).toBe(413);
    expect(res.headers.get('Content-Disposition')).toBeNull();
    expect(mockAuditLog).not.toHaveBeenCalled();
    const warn = mockLogged.find((l) => l.msg === 'Data export refused: over the Phase 1 ceiling');
    expect(warn).toMatchObject({ level: 'warn', fields: { limit: 'rows', rowCeiling: 3, atSection: 'payments' } });
  });
});

// ── DE-6 (BUSINESS_OS_DATA_EXPORT_DE6_WORKPLAN.md §8; SA review DE-6 C-2, C-4) ──

describe('DE-6: intake, email marketing and consent through the route', () => {
  const DE6_TABLES = [
    'user_intake_settings', 'business_intake_forms', 'email_campaigns', 'email_sequences', 'email_sequence_steps',
    'email_sequence_enrollments', 'business_subscribers', 'marketing_consent_events', 'marketing_consent_settings',
    'email_unsubscribes',
  ];

  function seedDe6(): void {
    mockSeeds.marketing_consent_events = [
      {
        id: '60000000-0000-4000-8000-000000000001',
        user_id: OWNER.id,
        email: 'dana@example.com',
        decision: 'granted',
        source_page_url: 'https://x.test/p?token=TOK-XYZ&sid=SID-XYZ',
        privacy_policy_url: 'https://x.test/privacy',
        evidence: { client_statement: 'Yes', confirmed_via: 'email_link', ip: 'EVIDENCE-IP-XYZ' },
        ip_hash: 'IPHASH-XYZ',
        ip_hash_salt: 'SALT-XYZ',
        user_agent: 'UA-XYZ',
        session_id: 'SESS-XYZ',
        recorded_by: 'RECORDED-BY-XYZ',
        email_normalized: 'NORMALIZED-XYZ',
      },
    ];
    mockSeeds.business_subscribers = [
      {
        id: '60000000-0000-4000-8000-000000000002',
        user_id: OWNER.id,
        email: 'lee@example.com',
        status: 'pending',
        attribution: {
          capture_page_url: 'https://x.test/join?code=CODE-XYZ',
          capture_channel: 'website',
          ip_hash: 'SUB-IPHASH-XYZ',
          user_agent: 'SUB-UA-XYZ',
          session_id: 'SUB-SESS-XYZ',
          smart_link_id: 'SUB-SL-XYZ',
        },
      },
    ];
    mockSeeds.marketing_consent_settings = [{ user_id: OWNER.id, capture_enabled: true, statement_en: 'Email me offers' }];
    mockSeeds.business_intake_forms = [
      { id: '60000000-0000-4000-8000-000000000003', user_id: OWNER.id, status: 'archived', generated_from: { model: 'GEN-MODEL-XYZ' } },
    ];
    mockSeeds.email_sequence_enrollments = [
      { id: '60000000-0000-4000-8000-000000000004', user_id: OWNER.id, status: 'cancelled', next_send_at: 'NEXT-SEND-XYZ' },
    ];
  }

  it('N-6: no tracking value and no token-like query string reaches the body; the page path and the consent do', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    seedDe6();
    const res = await GET(request());
    expect(res.status).toBe(200);
    const text = await res.text();
    for (const leaked of [
      'IPHASH-XYZ', 'SALT-XYZ', 'UA-XYZ', 'SESS-XYZ', 'RECORDED-BY-XYZ', 'NORMALIZED-XYZ', 'EVIDENCE-IP-XYZ',
      'TOK-XYZ', 'SID-XYZ', 'CODE-XYZ', 'SUB-SL-XYZ', 'GEN-MODEL-XYZ', 'NEXT-SEND-XYZ',
    ]) {
      expect(text).not.toContain(leaked);
    }
    expect(text).toContain('https://x.test/p');
    const body = JSON.parse(text);
    const consent = sectionOf(body, 'consent_records').rows[0];
    expect(consent.source_page_url).toBe('https://x.test/p');
    expect(consent.privacy_policy_url).toBe('https://x.test/privacy');
    expect(consent.evidence).toEqual({ client_statement: 'Yes', confirmed_via: 'email_link' });
    expect(sectionOf(body, 'newsletter_subscribers').rows[0].attribution).toEqual({ capture_page_url: 'https://x.test/join', capture_channel: 'website' });
    expect(sectionOf(body, 'consent_settings').rows).toEqual([{ capture_enabled: true, statement_en: 'Email me offers' }]);
    // N-10 through the route: an archived form and a cancelled enrollment are in.
    expect(sectionOf(body, 'intake_forms').rows.map((r) => r.status)).toEqual(['archived']);
    expect(sectionOf(body, 'email_sequence_enrollments').rows.map((r) => r.status)).toEqual(['cancelled']);
    // The audit entry gains the ten counts, counts only.
    const details = mockAuditLog.mock.calls[0][0].details;
    expect(details.section_counts).toMatchObject({ consent_records: 1, newsletter_subscribers: 1, consent_settings: 1, intake_forms: 1 });
    expect(JSON.stringify(details)).not.toContain('dana@example.com');
  });

  it('N-7: lead_responses, marketing_consent_state and email_sends are never read, even when seeded', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    for (const t of ['lead_responses', 'marketing_consent_state', 'email_sends']) {
      mockSeeds[t] = [{ id: '70000000-0000-4000-8000-000000000008', user_id: OWNER.id, note: `QA-${t}-NEVER` }];
    }
    const res = await GET(request());
    const text = await res.text();
    for (const t of ['lead_responses', 'marketing_consent_state', 'email_sends']) {
      expect(mockCalls[t]).toBeUndefined();
      expect(mockCalls[`anon:${t}`]).toBeUndefined();
    }
    expect(text).not.toContain('NEVER');
    for (const t of DE6_TABLES) expect(mockCalls[t]).toBeDefined();
  });

  it('N-14: a planted ?userId= and x-user-id change nothing in the ten reads', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    seedDe6();
    const OTHER = '99999999-9999-4999-8999-999999999999';
    const res = await GET(new NextRequest(`http://localhost/api/user/data-export?userId=${OTHER}`, { headers: { 'x-user-id': OTHER } }));
    expect(res.status).toBe(200);
    for (const table of DE6_TABLES) {
      expect(mockCalls[table]).toContainEqual(['eq', 'user_id', OWNER.id]);
      expect(mockCalls[table].filter((c) => c[0] === 'eq').every((c) => c[1] === 'user_id' && c[2] === OWNER.id)).toBe(true);
    }
    expect(JSON.stringify(mockCalls)).not.toContain(OTHER);
    // The single-row read is one query: eq user_id, limit 2, no order, no gt.
    expect(mockCalls.marketing_consent_settings.map((c) => c[0])).toEqual(['select', 'eq', 'limit']);
    expect(mockCalls.marketing_consent_settings).toContainEqual(['limit', 2]);
  });

  it('N-15: the DE-6 rows draw on the Phase 1 row ceiling: 413, no file, no DATA_EXPORTED', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    mockSeeds.marketing_consent_events = Array.from({ length: 3 }, (_, n) => ({ id: `6100000${n}-0000-4000-8000-000000000000`, user_id: OWNER.id, decision: 'granted' }));
    // identity 1 + consent records 3 = 4 > 3.
    mockLimits.ROW_CEILING = 3;
    const res = await GET(request());
    expect(res.status).toBe(413);
    expect(res.headers.get('Content-Disposition')).toBeNull();
    expect(mockAuditLog).not.toHaveBeenCalled();
    const warn = mockLogged.find((l) => l.msg === 'Data export refused: over the Phase 1 ceiling');
    expect(warn).toMatchObject({ level: 'warn', fields: { limit: 'rows', rowCeiling: 3, atSection: 'consent_records' } });
  });

  it('N-15: the single-row consent settings counts too (identity 1 + settings 1 > 1)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    mockSeeds.marketing_consent_settings = [{ user_id: OWNER.id, capture_enabled: true }];
    mockLimits.ROW_CEILING = 1;
    const res = await GET(request());
    expect(res.status).toBe(413);
    const warn = mockLogged.find((l) => l.msg === 'Data export refused: over the Phase 1 ceiling');
    expect(warn).toMatchObject({ fields: { atSection: 'consent_settings' } });
  });
});

// ── DE-7 (BUSINESS_OS_DATA_EXPORT_DE7_WORKPLAN.md §8 D-11, D-12, D-13, D-18; SA review DE-7) ──

describe('DE-7: website and content through the route', () => {
  const PAGE_1 = '71000000-0000-4000-8000-000000000001';
  const PAGE_2 = '71000000-0000-4000-8000-000000000002';
  const OTHER = '99999999-9999-4999-8999-999999999999';
  const OTHER_PAGE = '79000000-0000-4000-8000-000000000009';
  const CONTENT_TABLES = ['website_content', 'website_pages', 'website_blocks', 'smart_links', 'user_media'];

  function seedDe7(): void {
    mockSeeds.website_content = [{ id: '70000000-0000-4000-8000-000000000001', user_id: OWNER.id, hero: { title: 'Welcome' } }];
    mockSeeds.website_pages = [
      { id: PAGE_1, user_id: OWNER.id, slug: 'home', status: 'archived', page_type: 'homepage' },
      { id: PAGE_2, user_id: OWNER.id, slug: 'spring', status: 'draft', page_type: 'landing' },
    ];
    // This mock does not apply `.eq`, so another owner's page row is not seeded here (the
    // cross-tenant cases are in BusinessDataExportRepository.test.ts, D-8). The block below
    // sits on a page that is not the owner's: the `.in` on the owner's page ids keeps it out.
    mockSeeds.website_blocks = [
      { id: '72000000-0000-4000-8000-000000000001', page_id: PAGE_1, block_type: 'hero', enabled: false, content: { headline: 'Hi' } },
      { id: '72000000-0000-4000-8000-000000000002', page_id: PAGE_2, block_type: 'faq', enabled: true, content: { q: 'When?' } },
      // A block whose page is not one of the owner's (it even names the owner's page in its text).
      { id: '79000000-0000-4000-8000-000000000001', page_id: OTHER_PAGE, block_type: 'hero', content: { note: `OTHER-BLOCK-XYZ on ${PAGE_1}` } },
    ];
    mockSeeds.smart_links = [
      {
        id: '73000000-0000-4000-8000-000000000001',
        user_id: OWNER.id,
        code: 'ig-bio',
        destination_url: 'https://x.test/book?utm_source=ig',
        is_active: false,
        click_count: 918273,
        conversion_count: 645372,
        revenue_cents: 5647382,
      },
    ];
    mockSeeds.user_media = [
      {
        id: '74000000-0000-4000-8000-000000000001',
        user_id: OWNER.id,
        public_url: 'https://cdn.test/website-images/owner/generated/1.png',
        source: 'generated',
        description: 'a calm therapy room with plants',
        source_ref: 'openai:REUSE-KEY-XYZ',
        storage_path: 'owner/generated/STORAGE-PATH-XYZ.png',
      },
    ];
  }

  it('D-12: counters, the reuse key and the storage key never reach the body; public_url, the description and code do', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    seedDe7();
    const res = await GET(request());
    expect(res.status).toBe(200);
    const text = await res.text();
    for (const leaked of ['918273', '645372', '5647382', 'REUSE-KEY-XYZ', 'STORAGE-PATH-XYZ', 'OTHER-BLOCK-XYZ', OTHER_PAGE, OTHER]) {
      expect(text).not.toContain(leaked);
    }
    for (const key of ['click_count', 'conversion_count', 'revenue_cents', 'source_ref', 'storage_path']) {
      expect(text).not.toContain(`"${key}"`);
    }
    const body = JSON.parse(text);
    // The owner id is in export_metadata only, never on a content row.
    for (const id of ['website_content', 'website_pages', 'website_blocks', 'smart_links', 'images']) {
      for (const row of sectionOf(body, id).rows) expect(Object.keys(row)).not.toContain('user_id');
    }
    expect(sectionOf(body, 'images').rows).toEqual([
      { id: '74000000-0000-4000-8000-000000000001', public_url: 'https://cdn.test/website-images/owner/generated/1.png', source: 'generated', description: 'a calm therapy room with plants' },
    ]);
    expect(sectionOf(body, 'smart_links').rows).toEqual([
      { id: '73000000-0000-4000-8000-000000000001', code: 'ig-bio', destination_url: 'https://x.test/book?utm_source=ig', is_active: false },
    ]);
    // All history: archived and draft pages, a hidden block (D-14 through the route).
    expect(sectionOf(body, 'website_pages').rows.map((r) => r.status)).toEqual(['archived', 'draft']);
    expect(sectionOf(body, 'website_blocks').rows.map((r) => [r.page_id, r.enabled])).toEqual([[PAGE_1, false], [PAGE_2, true]]);
    expect(sectionOf(body, 'website_content').rows).toHaveLength(1);
    expect(body.export_metadata.groups.content).toMatchObject({ gdpr_role: 'processor', controller: 'account_holder' });
    // The audit entry gains the five counts, counts only.
    const details = mockAuditLog.mock.calls[0][0].details;
    expect(details.section_counts).toMatchObject({ website_content: 1, website_pages: 2, website_blocks: 2, smart_links: 1, images: 1 });
    expect(JSON.stringify(details)).not.toContain('ig-bio');
  });

  it('D-11: website_page_views, smart_link_clicks and website_templates are never read, even when seeded; website_pages twice', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    seedDe7();
    for (const t of ['website_page_views', 'smart_link_clicks', 'website_templates']) {
      mockSeeds[t] = [{ id: '70000000-0000-4000-8000-000000000009', user_id: OWNER.id, page_id: PAGE_1, note: `QA-${t}-NEVER` }];
    }
    const text = await (await GET(request())).text();
    for (const t of ['website_page_views', 'smart_link_clicks', 'website_templates']) {
      expect(mockCalls[t]).toBeUndefined();
      expect(mockCalls[`anon:${t}`]).toBeUndefined();
    }
    expect(text).not.toContain('NEVER');
    for (const t of CONTENT_TABLES) expect(mockCalls[t]).toBeDefined();
    // With pages seeded the run touches all 38 section tables.
    expect(Object.keys(mockCalls)).toHaveLength(38);
    // website_pages: its section read (data + empty page), then the parent ids (data + empty page).
    expect(mockCalls.website_pages.filter((c) => c[0] === 'select').map((c) => c[1])).toEqual([
      expect.stringMatching(/^id, page_type, /), expect.stringMatching(/^id, page_type, /), 'id', 'id',
    ]);
  });

  it('D-13: a planted ?userId=, x-user-id and ?pageId= change nothing in the five reads', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    seedDe7();
    const res = await GET(
      new NextRequest(`http://localhost/api/user/data-export?userId=${OTHER}&pageId=${OTHER_PAGE}`, { headers: { 'x-user-id': OTHER } })
    );
    expect(res.status).toBe(200);
    for (const table of ['website_content', 'website_pages', 'smart_links', 'user_media']) {
      expect(mockCalls[table]).toContainEqual(['eq', 'user_id', OWNER.id]);
      expect(mockCalls[table].filter((c) => c[0] === 'eq').every((c) => c[1] === 'user_id' && c[2] === OWNER.id)).toBe(true);
    }
    // The blocks are read only by the owner's own page ids, never by an id from the request.
    expect(mockCalls.website_blocks.filter((c) => c[0] === 'eq')).toEqual([]);
    for (const c of mockCalls.website_blocks.filter((x) => x[0] === 'in')) expect(c).toEqual(['in', 'page_id', [PAGE_1, PAGE_2]]);
    expect(JSON.stringify(mockCalls)).not.toContain(OTHER);
    expect(JSON.stringify(mockCalls)).not.toContain(OTHER_PAGE);
    const text = await res.text();
    expect(text).not.toContain('OTHER-BLOCK-XYZ');
  });

  it('D-18: the content rows draw on the Phase 1 row ceiling: 413, no file, no DATA_EXPORTED', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    seedDe7();
    // identity 1 + content 1 + pages 2 + blocks 2 = 6 > 5.
    mockLimits.ROW_CEILING = 5;
    const res = await GET(request());
    expect(res.status).toBe(413);
    expect(res.headers.get('Content-Disposition')).toBeNull();
    expect(mockAuditLog).not.toHaveBeenCalled();
    const warn = mockLogged.find((l) => l.msg === 'Data export refused: over the Phase 1 ceiling');
    expect(warn).toMatchObject({ level: 'warn', fields: { limit: 'rows', rowCeiling: 5, atSection: 'website_blocks' } });
  });
});
