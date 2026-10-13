/**
 * AuditTrailRepository.hasFindingEntry (credits boost slice 4b.2, SA CR-1).
 *
 * The reconcile pass audits a repeating finding only the first time. This is
 * the one yes / no it asks: scoped to the purchase's own account, a head count
 * (no row, no details), and named only by the reconcile wiring.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: { marker: 'service-role-default' } }));
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

import { AuditTrailRepository } from '@/lib/repositories/AuditTrailRepository';

const ACCOUNT = '22222222-2222-4222-8222-222222222222';
const PURCHASE = '44444444-4444-4444-8444-444444444444';

function client(outcome: { count: number | null; error: unknown }) {
  const calls: Array<[string, unknown[]]> = [];
  const chain: Record<string, unknown> = {
    select: (...args: unknown[]) => {
      calls.push(['select', args]);
      return chain;
    },
    eq: (...args: unknown[]) => {
      calls.push(['eq', args]);
      return chain;
    },
    then: (resolve: (value: unknown) => void) => resolve(outcome),
  };
  const supabase = {
    from: (table: string) => {
      calls.push(['from', [table]]);
      return chain;
    },
  };
  return { repo: new AuditTrailRepository(supabase as unknown as SupabaseClient), calls };
}

describe('hasFindingEntry', () => {
  it('a head count scoped to the account, the purchase, BOS_BOOST_FLAGGED and the reason', async () => {
    const { repo, calls } = client({ count: 1, error: null });
    const result = await repo.hasFindingEntry({ accountId: ACCOUNT, purchaseId: PURCHASE, reason: 'reconcile_dispute_status' });
    expect(result).toEqual({ data: true, error: null });
    expect(calls).toEqual([
      ['from', ['audit_trail']],
      ['select', ['id', { count: 'exact', head: true }]],
      ['eq', ['user_id', ACCOUNT]],
      ['eq', ['entity_type', 'business_os_boost_purchase']],
      ['eq', ['entity_id', PURCHASE]],
      ['eq', ['action', 'BOS_BOOST_FLAGGED']],
      ['eq', ['details->>reason', 'reconcile_dispute_status']],
    ]);
  });

  it('none recorded → false', async () => {
    expect((await client({ count: 0, error: null }).repo.hasFindingEntry({ accountId: ACCOUNT, purchaseId: PURCHASE, reason: 'x' })).data).toBe(false);
  });

  it('a database error, or a bad id or reason, is { data: null, error } and never throws; bad input reads nothing', async () => {
    const failed = await client({ count: null, error: { message: 'down' } }).repo.hasFindingEntry({ accountId: ACCOUNT, purchaseId: PURCHASE, reason: 'x' });
    expect(failed.data).toBeNull();
    expect(failed.error).toBeInstanceOf(Error);
    for (const input of [
      { accountId: 'nope', purchaseId: PURCHASE, reason: 'x' },
      { accountId: ACCOUNT, purchaseId: 'nope', reason: 'x' },
      { accountId: ACCOUNT, purchaseId: PURCHASE, reason: '' },
    ]) {
      const { repo, calls } = client({ count: 1, error: null });
      expect((await repo.hasFindingEntry(input)).data).toBeNull();
      expect(calls).toEqual([]);
    }
  });

  it('only the reconcile wiring names it (app, lib, components)', () => {
    const ROOT = process.cwd();
    const allowed = ['lib/business-os/boost/boostReconcileDeps.ts', 'lib/repositories/AuditTrailRepository.ts'];
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) {
          if (entry.name !== 'node_modules' && entry.name !== '__tests__') walk(rel);
        } else if (/\.tsx?$/.test(entry.name)) {
          if (/\bhasFindingEntry\b/.test(fs.readFileSync(path.join(ROOT, rel), 'utf8')) && !allowed.includes(rel)) offenders.push(rel);
        }
      }
    };
    for (const root of ['app', 'lib', 'components']) walk(root);
    expect(offenders).toEqual([]);
  });
});
