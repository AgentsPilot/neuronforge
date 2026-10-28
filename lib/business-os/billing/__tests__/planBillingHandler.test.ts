/**
 * The `plan` flow handler (plan payments P-3b.2, workplan §3.1, §3.3 row 1):
 * PF-15 first (an event from the other Stripe mode writes nothing and alerts),
 * then one use case per event type. Returning = done (claim completed);
 * throwing = could not tell (claim released).
 */

const mockApplyPaid = jest.fn();
const mockRecordFailed = jest.fn();
const mockRecordActionRequired = jest.fn();
const mockSessionCompleted = jest.fn();
const mockSessionExpired = jest.fn();
const mockMirror = jest.fn();

jest.mock('@/lib/business-os/billing/planPaymentApply', () => ({
  applyPaidPlanInvoice: (...args: unknown[]) => mockApplyPaid(...args),
  recordFailedPlanInvoice: (...args: unknown[]) => mockRecordFailed(...args),
  recordActionRequiredPlanInvoice: (...args: unknown[]) => mockRecordActionRequired(...args),
}));
jest.mock('@/lib/business-os/billing/planCheckoutSessionEvents', () => ({
  onPlanCheckoutSessionCompleted: (...args: unknown[]) => mockSessionCompleted(...args),
  onPlanCheckoutSessionExpired: (...args: unknown[]) => mockSessionExpired(...args),
}));
jest.mock('@/lib/business-os/billing/planSubscriptionMirror', () => ({
  mirrorPlanSubscription: (...args: unknown[]) => mockMirror(...args),
}));
// D3.1 (SX-2b): the production after-plan move port, a sentinel so the
// production handler's ports can be inspected without reaching the plan table.
const mockAfterPlanMove = jest.fn();
jest.mock('@/lib/business-os/billing/afterPlanMoveDeps', () => ({
  afterPlanMove: (...args: unknown[]) => mockAfterPlanMove(...args),
}));
// The production handler reads the server key mode; pinned to test here.
jest.mock('@/lib/business-os/billing/stripeMode', () => ({
  ...jest.requireActual('@/lib/business-os/billing/stripeMode'),
  currentStripeMode: () => 'test',
}));
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

import type Stripe from 'stripe';

import {
  createPlanBillingHandler,
  handlePlanBillingEvent,
  type PlanBillingHandlerDeps,
} from '@/lib/business-os/billing/planBillingHandler';
import type { StripeMode } from '@/lib/business-os/billing/stripeMode';
import type { Logger } from '@/lib/logger';

function harness(mode: StripeMode | (() => StripeMode) = 'test') {
  const lines: Array<{ level: string; ctx: Record<string, unknown> }> = [];
  const at = (level: string) => (ctx: Record<string, unknown>) => {
    lines.push({ level, ctx });
  };
  const log: Record<string, unknown> = { info: at('info'), warn: at('warn'), error: at('error') };
  const childArgs: unknown[] = [];
  log.child = (bindings: unknown) => {
    childArgs.push(bindings);
    return log;
  };
  // Every port throws if touched: the handler itself must never reach them.
  const untouchable = new Proxy({}, { get: () => { throw new Error('port touched by the handler itself'); } });
  const deps = {
    billingAccounts: untouchable,
    billingEvents: untouchable,
    stripe: () => untouchable,
    catalog: untouchable,
    entitlementConfig: () => untouchable,
    recordPlanChange: jest.fn(),
    now: () => new Date(),
    stripeMode: typeof mode === 'function' ? mode : () => mode,
  } as unknown as PlanBillingHandlerDeps;
  return { handler: createPlanBillingHandler(deps), deps, log: log as unknown as Logger, lines, childArgs };
}

const event = (type: string, livemode = false) =>
  ({ id: 'evt_H1', type, livemode, data: { object: { id: 'x' } } }) as unknown as Stripe.Event;

beforeEach(() => {
  for (const mock of [mockApplyPaid, mockRecordFailed, mockRecordActionRequired, mockSessionCompleted, mockSessionExpired, mockMirror, mockAfterPlanMove]) {
    mock.mockReset();
    mock.mockResolvedValue(undefined);
  }
});

describe('PF-15: the event mode must equal the server key mode', () => {
  it.each([
    ['a live event on a test-key server', 'test' as StripeMode, true],
    ['a test event on a live-key server (a sandbox forwarding to production)', 'live' as StripeMode, false],
  ])('%s: error + alert, NOTHING written, claim completed (returns)', async (_label, mode, livemode) => {
    const h = harness(mode);
    for (const type of ['invoice.paid', 'invoice.payment_failed', 'invoice.payment_action_required', 'checkout.session.completed', 'checkout.session.expired', 'customer.subscription.updated', 'customer.subscription.deleted']) {
      await expect(h.handler(event(type, livemode), h.log)).resolves.toBeUndefined();
    }
    for (const mock of [mockApplyPaid, mockRecordFailed, mockRecordActionRequired, mockSessionCompleted, mockSessionExpired, mockMirror]) {
      expect(mock).not.toHaveBeenCalled();
    }
    expect(h.lines.filter((l) => l.ctx.event === 'bos_billing_mode_mismatch')).toHaveLength(7);
    expect(h.lines.every((l) => l.level === 'error' && l.ctx.alert === true)).toBe(true);
  });

  it('a key whose mode cannot be read throws (claim released), nothing called', async () => {
    const h = harness(() => {
      throw new Error('stripe_key_mode_unknown');
    });
    await expect(h.handler(event('invoice.paid'), h.log)).rejects.toThrow('stripe_key_mode_unknown');
    expect(mockApplyPaid).not.toHaveBeenCalled();
  });

  it('a live event on a live-key server goes through', async () => {
    const h = harness('live');
    await h.handler(event('invoice.paid', true), h.log);
    expect(mockApplyPaid).toHaveBeenCalledTimes(1);
  });
});

describe('one use case per event type', () => {
  it.each([
    ['invoice.paid', mockApplyPaid],
    ['invoice.payment_failed', mockRecordFailed],
    // P-6a.2 (workplan §5.4).
    ['invoice.payment_action_required', mockRecordActionRequired],
    ['checkout.session.completed', mockSessionCompleted],
    ['checkout.session.expired', mockSessionExpired],
    ['customer.subscription.updated', mockMirror],
    ['customer.subscription.deleted', mockMirror],
  ])('%s', async (type, expected) => {
    const h = harness();
    const e = event(type);
    await h.handler(e, h.log);
    expect(expected).toHaveBeenCalledTimes(1);
    expect(expected).toHaveBeenCalledWith(e, h.log, h.deps);
    const others = [mockApplyPaid, mockRecordFailed, mockRecordActionRequired, mockSessionCompleted, mockSessionExpired, mockMirror].filter((m) => m !== expected);
    for (const other of others) expect(other).not.toHaveBeenCalled();
    expect(h.childArgs).toEqual([{ flow: 'plan', eventType: type }]);
  });

  it('a use case that throws propagates (the route releases the claim)', async () => {
    const h = harness();
    mockApplyPaid.mockRejectedValueOnce(new Error('plan_row_missing'));
    await expect(h.handler(event('invoice.paid'), h.log)).rejects.toThrow('plan_row_missing');
  });

  it('an event type the router never routes here throws, with an alert (code drift is never guessed)', async () => {
    const h = harness();
    await expect(h.handler(event('charge.refunded'), h.log)).rejects.toThrow('plan_handler_unhandled_event_type');
    expect(h.lines.find((l) => l.ctx.event === 'bos_billing_plan_event_type_unhandled')?.ctx.alert).toBe(true);
  });
});

describe('the production handler', () => {
  it('is exported for the route registration', () => {
    expect(typeof handlePlanBillingEvent).toBe('function');
  });

  it('D3.1: its ports include the after-plan move, handed to the mirror (not called by the handler itself)', async () => {
    const h = harness();
    await handlePlanBillingEvent(event('customer.subscription.deleted'), h.log);
    expect(mockMirror).toHaveBeenCalledTimes(1);
    const ports = mockMirror.mock.calls[0][2] as PlanBillingHandlerDeps;
    expect(typeof ports.afterPlanMove).toBe('function');
    expect(mockAfterPlanMove).not.toHaveBeenCalled();
    const input = { accountId: 'a', subscriptionId: 'sub_1', livemode: false, stripeEventId: 'evt_1', endedAt: null, cancellationReason: null };
    await ports.afterPlanMove(input, h.log);
    expect(mockAfterPlanMove).toHaveBeenCalledWith(input, h.log);
  });

  it('D3.1: PF-15 still first: an event from the other mode reaches neither the mirror nor the move', async () => {
    const h = harness();
    await expect(handlePlanBillingEvent(event('customer.subscription.deleted', true), h.log)).resolves.toBeUndefined();
    expect(mockMirror).not.toHaveBeenCalled();
    expect(mockAfterPlanMove).not.toHaveBeenCalled();
    expect(h.lines.find((l) => l.ctx.event === 'bos_billing_mode_mismatch')).toMatchObject({ level: 'error', ctx: { alert: true } });
  });
});
