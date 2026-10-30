/**
 * checkConnectExit and isStripeAccountShared (self-service exit SX-5 / D5;
 * SA-14, BQ-12; SA W-1, W-2, W-10). The check and the counts are injected; the
 * mapping to blocker codes and the shared `decideLocalPrecondition` are real.
 */

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = {};
  for (const level of ['info', 'warn', 'error', 'debug']) logger[level] = jest.fn();
  logger.child = () => logger;
  return { createLogger: () => logger };
});
// The defaults are never used here; keep their modules (service role, cleanup engine) out of the test.
jest.mock('@/lib/business-os/account-deletion/selfServiceDeletion', () => ({ runAccountDeletionCheck: jest.fn() }));
jest.mock('@/lib/repositories/BusinessPurgeRepository', () => ({ businessPurgeRepository: {} }));
jest.mock('@/lib/repositories/PaymentRepository', () => ({ stripeConnectRepository: {} }));
jest.mock('@/lib/repositories/PluginConnectionRepository', () => ({ pluginConnectionRepository: {} }));

import {
  checkConnectExit,
  isStripeAccountShared,
  verdictFromCheckRows,
  type ConnectExitDeps,
  type LocalCount,
} from '@/lib/business-os/account-deletion/connectExitGuard';
import { LOCAL_BLOCKING_CONDITIONS } from '@/lib/business-os/purge/localPrecondition';
import type { AccountDeletionCheckOutcome } from '@/lib/business-os/account-deletion/selfServiceDeletion';
import type { GuardRowLike } from '@/lib/business-os/account-deletion/blockerCopy';

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SUBJECT = { id: USER, email: 'owner@example.org' };

/** The four real conditions with the given counts by table (C1 plans, C2 payments + refunds, C3 invoices). */
function counts(byTable: Partial<Record<string, number | null>>): LocalCount[] {
  return LOCAL_BLOCKING_CONDITIONS.map((condition) => ({
    ...condition,
    count: condition.table in byTable ? (byTable[condition.table] as number | null) : 0,
  }));
}

function checked(canDelete: boolean, blockers: GuardRowLike[]): AccountDeletionCheckOutcome {
  return { kind: 'checked', canDelete, targetUserId: USER, blockers, notes: [], guards: [], serverMs: 1 };
}

function deps(check: AccountDeletionCheckOutcome | Error, local: LocalCount[] = counts({})): ConnectExitDeps & { check: jest.Mock; countLocal: jest.Mock } {
  return {
    check: check instanceof Error ? jest.fn().mockRejectedValue(check) : jest.fn().mockResolvedValue(check),
    countLocal: jest.fn().mockResolvedValue(local),
  };
}

describe('Delete: the G-9 rows of runAccountDeletionCheck (SA-14)', () => {
  it('running client plans block, with their count', async () => {
    const d = deps(checked(false, [{ guard: 'G-8', item: 'no Stripe account connected', found: 1 }, { guard: 'G-9', item: 'money in flight: recurring payment plan(s) still running', found: 2 }]));
    await expect(checkConnectExit(SUBJECT, 'delete', d)).resolves.toEqual({
      kind: 'blocked',
      blockers: [{ code: 'client_plans_running', count: 2 }],
      source: 'check',
    });
    expect(d.check).toHaveBeenCalledWith({ email: SUBJECT.email, subject: USER });
    expect(d.countLocal).not.toHaveBeenCalled();
  });

  it('pending payments and refunds block', async () => {
    const d = deps(checked(false, [{ guard: 'G-9', item: 'money in flight: payment(s) still pending', found: 1 }, { guard: 'G-9', item: 'money in flight: refund(s) still in flight', found: 1 }]));
    await expect(checkConnectExit(SUBJECT, 'delete', d)).resolves.toEqual({
      kind: 'blocked',
      blockers: [{ code: 'client_payments_pending', count: 2 }],
      source: 'check',
    });
  });

  it('a G-9 row the copy cannot name still blocks (fail safe)', async () => {
    const d = deps(checked(false, [{ guard: 'G-9', item: 'something new', found: 1 }]));
    await expect(checkConnectExit(SUBJECT, 'delete', d)).resolves.toMatchObject({ kind: 'blocked', blockers: [{ code: 'contact_support' }] });
  });

  it('G-8, G-6 and G-4 alone are not this button’s business: clear', async () => {
    const d = deps(checked(false, [{ guard: 'G-8', item: 'x', found: 1 }, { guard: 'G-6', item: 'plan', found: 1 }, { guard: 'G-4', item: 'admin', found: 1 }]));
    await expect(checkConnectExit(SUBJECT, 'delete', d)).resolves.toEqual({ kind: 'clear', source: 'check' });
  });

  it('a check that allows the delete is clear', async () => {
    await expect(checkConnectExit(SUBJECT, 'delete', deps(checked(true, [])))).resolves.toEqual({ kind: 'clear', source: 'check' });
  });

  it('W-1: an "unknown"-only blocker list is a parse failure, so unreadable, not clear', async () => {
    const d = deps(checked(false, [{ guard: 'unknown' }]));
    await expect(checkConnectExit(SUBJECT, 'delete', d)).resolves.toEqual({ kind: 'unreadable', reason: 'check_unparsed' });
    expect(verdictFromCheckRows([{ guard: 'unknown' }]).kind).toBe('unreadable');
  });

  it('W-2: a FAILED check refuses and never falls back', async () => {
    const d = deps({ kind: 'failed', error: new Error('db') });
    await expect(checkConnectExit(SUBJECT, 'delete', d)).resolves.toEqual({ kind: 'unreadable', reason: 'check_failed' });
    expect(d.countLocal).not.toHaveBeenCalled();
  });

  it('W-2: an UNAVAILABLE check falls back to the local C1 + C2 counts (C3 ignored)', async () => {
    const d = deps({ kind: 'unavailable', reason: 'not_configured', error: null }, counts({ payment_invoices: 5, payment_transactions: 1 }));
    await expect(checkConnectExit(SUBJECT, 'delete', d)).resolves.toEqual({
      kind: 'blocked',
      blockers: [{ code: 'client_payments_pending', count: 1 }],
      source: 'local',
    });
  });

  it('W-2: a login with no email cannot be checked, so it uses the local counts', async () => {
    const d = deps(checked(true, []), counts({ payment_invoices: 3 }));
    await expect(checkConnectExit({ id: USER, email: null }, 'delete', d)).resolves.toEqual({ kind: 'clear', source: 'local' });
    expect(d.check).not.toHaveBeenCalled();
  });

  it('a local read failure (count: null) is unreadable', async () => {
    const d = deps({ kind: 'unavailable', reason: 'not_configured', error: null }, counts({ payment_refunds: null }));
    await expect(checkConnectExit(SUBJECT, 'delete', d)).resolves.toEqual({ kind: 'unreadable', reason: 'local_unreadable' });
  });

  it('a check that throws is unreadable', async () => {
    await expect(checkConnectExit(SUBJECT, 'delete', deps(new Error('boom')))).resolves.toEqual({ kind: 'unreadable', reason: 'threw' });
  });
});

describe('Disconnect: running client plans only (BQ-12 = block)', () => {
  it('running plans block, with their count; the engine is not called', async () => {
    const d = deps(checked(true, []), counts({ payment_plan_subscriptions: 3 }));
    await expect(checkConnectExit(SUBJECT, 'disconnect', d)).resolves.toEqual({
      kind: 'blocked',
      blockers: [{ code: 'client_plans_running', count: 3 }],
      source: 'local',
    });
    expect(d.check).not.toHaveBeenCalled();
  });

  it('pending payments alone do not block a disconnect', async () => {
    const d = deps(checked(true, []), counts({ payment_transactions: 4, payment_refunds: 1 }));
    await expect(checkConnectExit(SUBJECT, 'disconnect', d)).resolves.toEqual({ kind: 'clear', source: 'local' });
  });

  it('an unreadable plan count refuses', async () => {
    const d = deps(checked(true, []), counts({ payment_plan_subscriptions: null }));
    await expect(checkConnectExit(SUBJECT, 'disconnect', d)).resolves.toMatchObject({ kind: 'unreadable' });
  });
});

describe('isStripeAccountShared (W-10)', () => {
  const ACCOUNT = 'acct_1Shared';

  it('another user in the Connect table → shared, and the plugin count is not needed', async () => {
    const pluginOthers = jest.fn();
    await expect(
      isStripeAccountShared(ACCOUNT, USER, { connectOthers: async () => ({ data: 1, error: null }), pluginOthers })
    ).resolves.toBe('shared');
    expect(pluginOthers).not.toHaveBeenCalled();
  });

  it('another user’s plugin row → shared', async () => {
    await expect(
      isStripeAccountShared(ACCOUNT, USER, { connectOthers: async () => ({ data: 0, error: null }), pluginOthers: async () => ({ data: 1, error: null }) })
    ).resolves.toBe('shared');
  });

  it('only our own rows → not shared', async () => {
    const pluginOthers = jest.fn().mockResolvedValue({ data: 0, error: null });
    await expect(isStripeAccountShared(ACCOUNT, USER, { connectOthers: async () => ({ data: 0, error: null }), pluginOthers })).resolves.toBe('not_shared');
    expect(pluginOthers).toHaveBeenCalledWith(ACCOUNT, USER);
  });

  it('a read error is unreadable, never "not shared"', async () => {
    await expect(
      isStripeAccountShared(ACCOUNT, USER, { connectOthers: async () => ({ data: null, error: { code: 'XX' } }), pluginOthers: async () => ({ data: 0, error: null }) })
    ).resolves.toBe('unreadable');
    await expect(
      isStripeAccountShared(ACCOUNT, USER, { connectOthers: async () => ({ data: 0, error: null }), pluginOthers: async () => ({ data: null, error: new Error('x') }) })
    ).resolves.toBe('unreadable');
  });
});
