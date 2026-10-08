/**
 * `dispatchLeadResponses({ batch, sweep })` (BL-7a part 2, P2).
 *
 * The owner's "Send now" now waits for the drain, so it claims a small batch.
 * The cron and the admin "Drain now" call with no argument and must keep
 * claiming the full 25, and no caller may widen a run past it.
 */

const reapStale = jest.fn();
const claimDue = jest.fn();
jest.mock('@/lib/repositories/LeadResponseRepository', () => ({
  leadResponseRepository: {
    reapStale: (...a: unknown[]) => reapStale(...a),
    claimDue: (...a: unknown[]) => claimDue(...a),
  },
}));

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  logger.child = () => logger;
  return { createLogger: () => logger };
});

// The sweep's only query: list the approved businesses. Returns none, so the
// sweep touches nothing else, but a call to `from` proves the sweep ran.
const from = jest.fn();
jest.mock('@/lib/supabaseServer', () => ({
  supabaseServer: { from: (...a: unknown[]) => from(...a) },
}));
// One sweeping automation, so the sweep has a query to make (CR-P2-2).
jest.mock('@/lib/business-os/gaps/automations', () => ({
  OPERATIONAL_AUTOMATIONS: [
    { id: 'intake_chase', column: 'chase_intake_enabled', gapId: 'intake_outstanding', sweepQueues: 'intake_chase' },
  ],
}));
jest.mock('@/lib/business-os/gaps/whenDue', () => ({ whenDue: jest.fn() }));
jest.mock('@/lib/business-os/gaps/automationApplies', () => ({ automationApplies: jest.fn() }));
jest.mock('@/lib/business-os/gaps/findGaps', () => ({ findGaps: jest.fn() }));
jest.mock('@/lib/services/LeadBookingLinkService', () => ({ sendBookingLink: jest.fn() }));
jest.mock('@/lib/services/InvoiceDeliveryService', () => ({ sendInvoice: jest.fn() }));
jest.mock('@/lib/services/BookingEmailService', () => ({ BookingEmailService: jest.fn() }));

import { dispatchLeadResponses } from '../LeadResponseDispatchService';

beforeEach(() => {
  jest.clearAllMocks();
  reapStale.mockResolvedValue(0);
  claimDue.mockResolvedValue([]);
  type Chain = { select: jest.Mock; eq: jest.Mock; limit: jest.Mock };
  const chain: Chain = {
    select: jest.fn((): Chain => chain),
    eq: jest.fn((): Chain => chain),
    limit: jest.fn(() => Promise.resolve({ data: [], error: null })),
  };
  from.mockReturnValue(chain);
});

const claimedBatch = () => claimDue.mock.calls[0][1];

describe('dispatchLeadResponses batch size', () => {
  it('claims 25 with no argument (the cron and Drain now)', async () => {
    await dispatchLeadResponses();
    expect(claimDue).toHaveBeenCalledTimes(1);
    expect(claimedBatch()).toBe(25);
  });

  it('claims 25 with an empty options object', async () => {
    await dispatchLeadResponses({});
    expect(claimedBatch()).toBe(25);
  });

  it.each([1, 5, 25])('claims exactly %i when asked', async (batch) => {
    await dispatchLeadResponses({ batch });
    expect(claimedBatch()).toBe(batch);
  });

  it.each([0, -3, 26, 1000, 2.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'falls back to 25 for %p: no caller can widen or zero a run',
    async (batch) => {
      await dispatchLeadResponses({ batch });
      expect(claimedBatch()).toBe(25);
    }
  );

  it('keeps the reap-then-claim order and the lease constants', async () => {
    await dispatchLeadResponses({ batch: 5 });
    expect(reapStale).toHaveBeenCalledWith(90, 3);
    expect(reapStale.mock.invocationCallOrder[0]).toBeLessThan(claimDue.mock.invocationCallOrder[0]);
  });
});

describe('dispatchLeadResponses sweep option (CR-P2-2)', () => {
  it('(i) sweeps with no argument (the cron and Drain now)', async () => {
    await dispatchLeadResponses();
    expect(from).toHaveBeenCalledWith('business_profiles');
  });

  it('(ii) { sweep: false } skips the sweep, but still reaps and claims', async () => {
    await dispatchLeadResponses({ batch: 5, sweep: false });
    expect(from).not.toHaveBeenCalled();
    expect(reapStale).toHaveBeenCalledTimes(1);
    expect(claimDue).toHaveBeenCalledTimes(1);
    expect(claimedBatch()).toBe(5);
  });

  it('(iii) { batch: 5 } alone still sweeps: only an explicit false skips', async () => {
    await dispatchLeadResponses({ batch: 5 });
    expect(from).toHaveBeenCalledWith('business_profiles');
    expect(claimDue).toHaveBeenCalledTimes(1);
  });
});
