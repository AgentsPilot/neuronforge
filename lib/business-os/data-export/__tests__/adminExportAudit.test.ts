/**
 * DE-10a (workplan §3.2, T-14, T-16; SA-1, SA-3, W10-4, W10-5, W10-9): the one
 * builder of the admin export routes' audit inputs.
 *
 * T-14: every builder places the row on the ADMIN (user and actor), with the
 * target as the entity and in details, never on the target's account.
 * T-16: the owner's in-app audit reader cannot return such a row, because it
 * reads only rows whose user id is the owner's (the RLS side is pinned by
 * lib/audit/__tests__/ownerPolicyMigration.test.ts and the guard
 * lib/audit/__tests__/ownerAuditReads.guard.test.ts, not duplicated here).
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));
jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  logger.child = () => logger;
  return { createLogger: () => logger };
});

import {
  adminExportDownloadedEntry,
  adminExportFailedEntry,
  adminExportReadyEntry,
  adminExportReplacedEntry,
  adminExportRequestedEntry,
  type AdminExportAuditBase,
} from '../adminExportAudit';
import { AuditTrailRepository, type OwnerAuditQuery } from '@/lib/repositories/AuditTrailRepository';

const FIRST_PAGE: OwnerAuditQuery = { page: 1, limit: 50 };
import type { AuditLogInput } from '@/lib/audit/types';

const ADMIN = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';
const JOB = '33333333-3333-4333-8333-333333333333';
const OLD = '44444444-4444-4444-8444-444444444444';
const BASE: AdminExportAuditBase = { adminId: ADMIN, targetId: OWNER, correlationId: 'corr-1' };

const ALL: Array<[string, AuditLogInput]> = [
  ['requested', adminExportRequestedEntry(BASE, { jobId: JOB, reason: 'Owner asked by phone' })],
  [
    'ready',
    adminExportReadyEntry(BASE, {
      jobId: JOB,
      sectionCounts: { crm_contacts: 2 },
      failedSections: [],
      bytes: 10,
      fileCount: 1,
      rowCount: 2,
      missingFiles: 0,
      ceilingUsePct: 1,
      durationMs: 5,
    }),
  ],
  [
    'failed',
    adminExportFailedEntry(BASE, { jobId: JOB, reason: 'over_ceiling', bytes: 1, fileCount: 2, rowCount: 3, ceilingOver: ['fileBytes'], durationMs: 4 }),
  ],
  ['replaced', adminExportReplacedEntry(BASE, { replacedJobId: OLD, byJobId: JOB })],
  ['downloaded', adminExportDownloadedEntry(BASE, { jobId: JOB, requestedByKind: 'owner', reason: 'Hand over before delete' })],
];

describe('T-14 placement: admin-owned, the target as entity (SA-1, SA-3)', () => {
  it.each(ALL)('%s: user and actor are the admin, never the target', (_name, entry) => {
    expect(entry.userId).toBe(ADMIN);
    expect(entry.actorId).toBe(ADMIN);
    expect(entry.userId).not.toBe(OWNER);
    expect(entry.entityType).toBe('user');
    expect(entry.entityId).toBe(OWNER);
    expect(entry.details).toMatchObject({ target_user_id: OWNER, surface: 'admin', correlationId: 'corr-1' });
  });

  it.each(ALL)('%s: carries no URL, file name, business name or email (W10-5)', (_name, entry) => {
    const text = JSON.stringify(entry);
    expect(text).not.toMatch(/https?:|\.zip|token|@/i);
  });

  it('the downloaded row is critical with GDPR and SOC2, the reason and the job kind (W10-9: the Health tile counts critical)', () => {
    const entry = ALL[4][1];
    expect(entry.action).toBe('DATA_EXPORT_DOWNLOADED_BY_ADMIN');
    expect(entry.severity).toBe('critical');
    expect(entry.complianceFlags).toEqual(['GDPR', 'SOC2']);
    expect(entry.details).toMatchObject({ job_id: JOB, part_no: 1, requested_by_kind: 'owner', reason: 'Hand over before delete' });
  });

  it('only the downloaded row is critical', () => {
    expect(ALL.filter(([, entry]) => entry.severity === 'critical').map(([name]) => name)).toEqual(['downloaded']);
  });

  it('a per-event detail cannot replace the target (the shared fields are written last)', () => {
    const entry = adminExportRequestedEntry(BASE, { jobId: JOB, reason: 'x'.repeat(5) });
    expect((entry.details as Record<string, unknown>).target_user_id).toBe(OWNER);
  });

  it('the request is passed through when given, for IP and user agent', () => {
    const request = { headers: new Headers() } as never;
    expect(adminExportDownloadedEntry({ ...BASE, request }, { jobId: JOB, requestedByKind: 'admin', reason: 'abcde' }).request).toBe(request);
    expect(adminExportRequestedEntry(BASE, { jobId: JOB, reason: 'abcde' })).not.toHaveProperty('request');
  });
});

describe('W10-4: the builder module', () => {
  const source = readFileSync(join(process.cwd(), 'lib/business-os/data-export/adminExportAudit.ts'), 'utf8');

  it('never names the audit table (the owner-read guard would rightly fail it)', () => {
    expect(source).not.toContain('audit_trail');
  });

  it('is pure: no I/O, no logger, no repository instance', () => {
    expect(source).not.toMatch(/from '@\/lib\/(logger|supabase|services)/);
    expect(source).not.toMatch(/import \{[^}]*Repository\b/);
    expect(source).not.toMatch(/console\./);
  });
});

/** A fake client that APPLIES the eq filters, so the test proves the reader's own scope. */
function filteringClient(rows: Array<Record<string, unknown>>): SupabaseClient {
  const eqs: Array<[string, unknown]> = [];
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'not', 'order']) builder[method] = () => builder;
  builder.eq = (column: string, value: unknown) => (eqs.push([column, value]), builder);
  builder.range = () => {
    const data = rows.filter((row) => eqs.every(([column, value]) => row[column] === value));
    return Promise.resolve({ data, error: null, count: data.length });
  };
  return { from: () => builder } as unknown as SupabaseClient;
}

const stored = (entry: AuditLogInput) => ({
  user_id: entry.userId,
  actor_id: entry.actorId,
  action: entry.action,
  entity_type: entry.entityType,
  entity_id: entry.entityId,
  details: entry.details,
});

describe('T-16: the owner reader cannot return an admin-path row', () => {
  const OWN_ROW = { user_id: OWNER, actor_id: OWNER, action: 'DATA_EXPORT_REQUESTED', entity_type: 'user', entity_id: OWNER, details: {} };
  const SWEEP_ROW = { user_id: null, actor_id: null, action: 'DATA_EXPORT_EXPIRED', entity_type: 'user', entity_id: OWNER, details: {} };

  it('listOwnerEntries(owner) returns the owner row only, none of the five admin rows nor a null-user sweep row', async () => {
    const repo = new AuditTrailRepository(filteringClient([OWN_ROW, SWEEP_ROW, ...ALL.map(([, entry]) => stored(entry))]));
    const page = await repo.listOwnerEntries(OWNER, FIRST_PAGE);
    expect(page.error).toBeNull();
    expect(page.data?.logs).toEqual([OWN_ROW]);
  });

  it('negative control: the same fake read by the admin id returns the admin rows (the fake does filter)', async () => {
    const repo = new AuditTrailRepository(filteringClient([OWN_ROW, ...ALL.map(([, entry]) => stored(entry))]));
    const page = await repo.listOwnerEntries(ADMIN, FIRST_PAGE);
    expect(page.data?.logs).toHaveLength(ALL.length);
  });
});
