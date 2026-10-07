/**
 * Admin delete AD-2a (T7; SA T-2 / AC2-3): `AuditTrailService.writeNow`, the
 * confirmed single-entry write behind the write-ahead and outcome rows.
 *
 * Proves: the entry is byte-for-byte what the queued path writes (the same
 * `buildLogEntry`, per-entry hash included); the queue is untouched; it never
 * throws; `{ written: false }` on an error, on a timeout and when the service
 * is disabled.
 */

const inserts: unknown[][] = [];
let insertImpl: () => Promise<{ error: unknown }> = async () => ({ error: null });

jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const l: Record<string, unknown> = {};
    for (const level of ['info', 'warn', 'debug', 'error']) l[level] = () => undefined;
    l.child = () => l;
    return l;
  };
  return { createLogger: () => make() };
});

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      insert: (rows: unknown[]) => {
        inserts.push(rows);
        return insertImpl();
      },
    }),
  }),
}));

jest.mock('@/lib/repositories/ArchiveRepository', () => ({ archiveRepository: {} }));

import { AuditTrailService } from '../AuditTrailService';
import { AUDIT_FLUSH_TIMEOUT_MS } from '@/lib/audit/auditTimeouts';
import { AUDIT_FLUSH_TIMEOUT_MS as REEXPORTED } from '@/lib/audit/boundedAuditFlush';
import type { AuditLogInput } from '@/lib/audit/types';

type Internals = {
  logQueue: unknown[];
  isFlushing: boolean;
  config: { enabled: boolean; enableTamperDetection: boolean };
};

/** A fresh, isolated instance (the singleton is shared by the whole file otherwise). */
function freshService(config: { enabled?: boolean; enableTamperDetection?: boolean } = {}) {
  (AuditTrailService as unknown as { instance?: unknown }).instance = undefined;
  return AuditTrailService.getInstance({ batchSize: 100, ...config });
}

const ENTRY: AuditLogInput = {
  action: 'BUSINESS_DELETION_STARTED',
  entityType: 'user',
  entityId: '22222222-2222-4222-8222-222222222222',
  userId: '11111111-1111-4111-8111-111111111111',
  actorId: '11111111-1111-4111-8111-111111111111',
  severity: 'critical',
  details: { correlationId: 'corr', targetId: '22222222-2222-4222-8222-222222222222' },
};

beforeEach(() => {
  inserts.length = 0;
  insertImpl = async () => ({ error: null });
  jest.useRealTimers();
});

describe('AuditTrailService.writeNow', () => {
  it('shares the budget with logAndFlush (one constant, re-exported)', () => {
    expect(REEXPORTED).toBe(AUDIT_FLUSH_TIMEOUT_MS);
  });

  it('writes exactly one entry and reports written: true; the queue is untouched', async () => {
    const svc = freshService();
    const internals = svc as unknown as Internals;
    expect(await svc.writeNow(ENTRY)).toEqual({ written: true });
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toHaveLength(1);
    expect(internals.logQueue).toHaveLength(0);
    expect(internals.isFlushing).toBe(false);
  });

  it('does not disturb entries already queued by log()', async () => {
    const svc = freshService();
    const internals = svc as unknown as Internals;
    await svc.log({ ...ENTRY, action: 'BUSINESS_DATA_PURGE_BLOCKED' });
    expect(internals.logQueue).toHaveLength(1);
    await svc.writeNow(ENTRY);
    expect(internals.logQueue).toHaveLength(1);
    await svc.shutdown();
  });

  it('hash parity: the entry equals what the queued path writes (tamper detection on)', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-06T12:00:00.000Z') });
    const svc = freshService({ enableTamperDetection: true });
    await svc.writeNow(ENTRY);
    await svc.log(ENTRY);
    await svc.flush();
    const [direct] = inserts[0] as Array<Record<string, unknown>>;
    const [queued] = inserts[1] as Array<Record<string, unknown>>;
    expect(direct.hash).toEqual(expect.any(String));
    expect(direct).toEqual(queued);
  });

  it('written: false on a returned error, never a throw', async () => {
    const svc = freshService();
    insertImpl = async () => ({ error: new Error('db down') });
    await expect(svc.writeNow(ENTRY)).resolves.toEqual({ written: false });
  });

  it('written: false on a rejected insert, never a throw', async () => {
    const svc = freshService();
    insertImpl = () => Promise.reject(new Error('socket hang up'));
    await expect(svc.writeNow(ENTRY)).resolves.toEqual({ written: false });
  });

  it('written: false on a timeout (bounded by AUDIT_FLUSH_TIMEOUT_MS)', async () => {
    jest.useFakeTimers();
    const svc = freshService();
    insertImpl = () => new Promise(() => undefined); // never settles
    const pending = svc.writeNow(ENTRY);
    await jest.advanceTimersByTimeAsync(AUDIT_FLUSH_TIMEOUT_MS);
    await expect(pending).resolves.toEqual({ written: false });
  });

  it('written: false when the service is disabled (fail closed), and nothing is written', async () => {
    const svc = freshService({ enabled: false });
    expect(await svc.writeNow(ENTRY)).toEqual({ written: false });
    expect(inserts).toHaveLength(0);
  });
});
