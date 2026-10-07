/**
 * recordPlanChange (plan payments P-3b.1; workplan §3.4, SA-P3 c, Q-4, Q-5, C-8).
 *
 * What matters: the order is invalidate → log → flush, all before the caller
 * continues; an admin change is written exactly as the admin route always wrote
 * it (no extra key); a system change is never written with a null actor (the
 * service would turn that into the OWNER) but with the platform actor and
 * `details.actor`; a hung flush releases the caller after the 2 s bound; and
 * nothing ever throws, because the plan row is already written.
 */

const events: string[] = [];
const logged: Array<Record<string, unknown>> = [];
const sink = {
  logFails: false,
  flushHangs: false,
};

jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrailService: {
    getInstance: () => ({
      log: async (entry: Record<string, unknown>) => {
        events.push('log');
        if (sink.logFails) throw new Error('audit insert failed');
        logged.push(entry);
      },
      flush: () => {
        events.push('flush');
        return sink.flushHangs ? new Promise<void>(() => undefined) : Promise.resolve();
      },
    }),
  },
  // The default sink of logAndFlush. recordPlanChange must never use it.
  AuditTrail: {
    log: async () => {
      events.push('DEFAULT SINK');
    },
    flush: async () => {
      events.push('DEFAULT SINK');
    },
  },
}));

const invalidateMock = jest.fn((accountId: string) => {
  events.push(`invalidate:${accountId}`);
});
jest.mock('@/lib/business-os/entitlements/EntitlementService', () => ({
  getEntitlementService: () => ({ invalidate: invalidateMock }),
}));

const PLATFORM = '00000000-0000-4000-8000-0000000000aa';
jest.mock('@/lib/business-os/llm/aiActionAudit', () => ({
  platformActorId: () => PLATFORM,
}));

import { NextRequest } from 'next/server';
import { __resetAuditFlushChainForTests, AUDIT_FLUSH_TIMEOUT_MS } from '@/lib/audit/boundedAuditFlush';
import { recordPlanChange, type RecordPlanChangeInput } from '../recordPlanChange';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const ADMIN = '22222222-2222-4222-8222-222222222222';

const logLines: Array<{ level: string; msg: string }> = [];
const log = {
  warn: (_ctx: Record<string, unknown>, msg: string) => logLines.push({ level: 'warn', msg }),
  error: (_ctx: Record<string, unknown>, msg: string) => logLines.push({ level: 'error', msg }),
};

function input(overrides: Partial<RecordPlanChangeInput> = {}): RecordPlanChangeInput {
  return {
    accountId: ACCOUNT,
    action: 'BOS_ENTITLEMENT_TIER_ASSIGNED',
    actor: { kind: 'admin', adminId: ADMIN },
    entityType: 'business_os_account_plan',
    entityId: ACCOUNT,
    changes: { before: { tier: null }, after: { tier: 'tier_a' } },
    details: { reason: 'support case', op: 'assign_tier', correlationId: 'corr-1' },
    severity: 'warning',
    invalidatesEntitlements: true,
    log,
    ...overrides,
  };
}

beforeEach(() => {
  events.length = 0;
  logged.length = 0;
  logLines.length = 0;
  sink.logFails = false;
  sink.flushHangs = false;
  invalidateMock.mockClear();
  __resetAuditFlushChainForTests();
});

describe('order and content', () => {
  it('invalidates, then logs, then flushes, all before it resolves', async () => {
    await recordPlanChange(input());
    expect(events).toEqual([`invalidate:${ACCOUNT}`, 'log', 'flush']);
  });

  it('an admin change is written exactly as the admin route wrote it: the admin as actor, no actor detail, the request kept', async () => {
    const request = new NextRequest(new URL('http://localhost/api/admin/x'));
    await recordPlanChange(input({ request }));
    expect(logged).toHaveLength(1);
    expect(logged[0]).toStrictEqual({
      action: 'BOS_ENTITLEMENT_TIER_ASSIGNED',
      entityType: 'business_os_account_plan',
      entityId: ACCOUNT,
      userId: ACCOUNT,
      actorId: ADMIN,
      changes: { before: { tier: null }, after: { tier: 'tier_a' } },
      details: { reason: 'support case', op: 'assign_tier', correlationId: 'corr-1' },
      severity: 'warning',
      request,
    });
  });

  it('Q-4: a system change carries the platform actor and details.actor, never a null actor', async () => {
    await recordPlanChange(
      input({
        action: 'BOS_BILLING_INVOICE_PAID',
        actor: { kind: 'system', source: 'stripe_webhook' },
        details: { invoiceId: 'in_1', planWritten: true },
        severity: 'info',
      })
    );
    expect(logged[0].actorId).toBe(PLATFORM);
    expect(logged[0].actorId).not.toBe(ACCOUNT);
    expect(logged[0].details).toEqual({ invoiceId: 'in_1', planWritten: true, actor: 'stripe_webhook' });
    expect(logged[0].action).toBe('BOS_BILLING_INVOICE_PAID');
    expect(logged[0]).not.toHaveProperty('request');
  });

  it('a system change cannot overwrite details.actor with a caller value', async () => {
    await recordPlanChange(input({ actor: { kind: 'system', source: 'stripe_webhook' }, details: { actor: 'owner' } }));
    expect((logged[0].details as { actor: string }).actor).toBe('stripe_webhook');
  });

  it('maps a registered action through AUDIT_EVENTS and keeps an unregistered one under its own name', async () => {
    await recordPlanChange(input({ action: 'NOT_A_REGISTERED_ACTION' }));
    expect(logged[0].action).toBe('NOT_A_REGISTERED_ACTION');
  });

  it('does not invalidate when told the change touches no entitlement input (credit ops)', async () => {
    await recordPlanChange(input({ invalidatesEntitlements: false }));
    expect(invalidateMock).not.toHaveBeenCalled();
    expect(events).toEqual(['log', 'flush']);
  });

  it('writes through AuditTrailService.getInstance(), never the default singleton export', async () => {
    await recordPlanChange(input());
    expect(events).not.toContain('DEFAULT SINK');
  });
});

describe('never throws (the plan row is already written)', () => {
  it('an audit failure is logged at error and resolves', async () => {
    sink.logFails = true;
    await expect(recordPlanChange(input())).resolves.toBeUndefined();
    expect(logLines.some((line) => line.level === 'error' && line.msg.includes('plan change'))).toBe(true);
  });

  it('an invalidation failure is logged and the audit is still written', async () => {
    invalidateMock.mockImplementationOnce(() => {
      throw new Error('cache gone');
    });
    await expect(recordPlanChange(input())).resolves.toBeUndefined();
    expect(logged).toHaveLength(1);
    expect(logLines.some((line) => line.level === 'error' && line.msg.includes('invalidation'))).toBe(true);
  });

  it('Q-5: a hung flush releases the caller after the 2 s bound, with a warning', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    try {
      sink.flushHangs = true;
      let settled = false;
      const pending = recordPlanChange(input()).then(() => {
        settled = true;
      });
      await jest.advanceTimersByTimeAsync(AUDIT_FLUSH_TIMEOUT_MS - 1);
      expect(settled).toBe(false);
      await jest.advanceTimersByTimeAsync(2);
      await pending;
      expect(settled).toBe(true);
      expect(logLines.some((line) => line.level === 'warn' && line.msg.includes('timed out'))).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});
