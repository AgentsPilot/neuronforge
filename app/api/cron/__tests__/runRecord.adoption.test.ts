/**
 * Every one of the Business OS jobs records every authorised run, including
 * a run with nothing to do; an unauthorised call records nothing (admin
 * reorganisation slice 5; requirement §S5.13 part B, tested per job).
 *
 * Each route's services are mocked to "nothing to do". The run record
 * repository is mocked; the recorder itself is real.
 */

import { NextRequest } from 'next/server';

// ── Environment: the production runtime, as Vercel calls the cron ───────────
const SECRET = 'adoption-test-secret';
const env = process.env as Record<string, string | undefined>;
const saved = { NODE_ENV: env.NODE_ENV, VERCEL_ENV: env.VERCEL_ENV, CRON_SECRET: env.CRON_SECRET };

// ── The run record ──────────────────────────────────────────────────────────
const mockStartRun = jest.fn();
const mockFinishRun = jest.fn();
const mockPrune = jest.fn();
jest.mock('@/lib/repositories/BosCronRunRepository', () => ({
  ...jest.requireActual('@/lib/repositories/supabaseErrorCodes'),
  bosCronRunRepository: {
    startRun: (...a: unknown[]) => mockStartRun(...a),
    finishRun: (...a: unknown[]) => mockFinishRun(...a),
    deleteRunsStartedBefore: (...a: unknown[]) => mockPrune(...a),
  },
}));

jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

// ── "Nothing to do" for every job ──────────────────────────────────────────
jest.mock('@/lib/supabaseServer', () => {
  const chain = (): unknown =>
    new Proxy(function () {} as unknown as object, {
      get(_t, prop) {
        if (prop === 'then') return (resolve: (v: unknown) => void) => resolve({ data: [], error: null, count: 0 });
        return () => chain();
      },
      apply() {
        return chain();
      },
    });
  return { supabaseServer: chain() };
});
jest.mock('@/lib/services/CalendarSyncService', () => ({ CalendarSyncService: { syncExternalEvents: jest.fn() } }));
jest.mock('@/lib/repositories/BusinessProfileRepository', () => ({
  businessProfileRepository: { getUsersWithCalendarSyncEnabled: async () => ({ data: [], error: null }) },
}));
jest.mock('@/lib/services/LeadResponseDispatchService', () => ({
  dispatchLeadResponses: async () => ({ reaped: 0, enqueued: 0, claimed: 0, sent: 0, skipped: 0 }),
}));
jest.mock('@/lib/business-os/insight/automation', () => ({
  AutomationManager: class {
    async runDueAutomations() {
      return [];
    }
  },
}));
jest.mock('@/lib/services/InsightActionDispatchService', () => ({
  drainInsightActions: async () => ({ reaped: 0, claimed: 0, sent: 0, skipped: 0, failed: 0 }),
}));
jest.mock('@/lib/services/PaymentRetryService', () => ({
  paymentRetryService: {
    processDueRetries: async () => ({ processedInvoices: 0, processedInstallments: 0, successCount: 0, failureCount: 0 }),
  },
}));
jest.mock('@/lib/services/PaymentAutomationEngine', () => ({
  paymentAutomationEngine: { processScheduledExecutions: async () => undefined },
}));
jest.mock('@/lib/services/DailyBriefingDispatchService', () => ({
  processDueBriefings: async () => ({ enqueued: 0, sent: 0, skipped: 0, failed: 0 }),
}));
jest.mock('@/lib/services/IntakeReminderService', () => ({
  intakeReminderService: { sendDue: async () => ({ considered: 0, sent: 0, skipped: 0, failed: 0 }) },
}));
jest.mock('@/lib/services/InvoiceDeliveryService', () => ({ sendInvoice: jest.fn() }));
jest.mock('@/lib/business-os/channel-insights/ChannelMetricsSyncService', () => ({
  channelMetricsSyncService: { syncDue: async () => [] },
}));
jest.mock('@/lib/business-os/insight/metrics', () => ({
  MetricsComputeService: class {
    static getPeriodBoundaries() {
      return { start: new Date(), end: new Date() };
    }
    async computeAllMetrics() {
      return { data: [] };
    }
  },
}));
jest.mock('@/lib/business-os/insight/detectors', () => ({ DetectorEngine: class {} }));
jest.mock('@/lib/business-os/insight/prioritizer', () => ({ InsightPrioritizer: class {} }));
jest.mock('@/lib/business-os/insight/repository', () => ({ InsightRepository: class {} }));
jest.mock('@/lib/business-os/insight/correlation', () => ({ getCorrelationEngine: () => ({}) }));
jest.mock('@/lib/business-os/llm/aiActionAudit', () => ({ runAiAction: jest.fn() }));
const mockBillDueDatedStages = jest.fn();
const mockProcessOverdueItems = jest.fn();
const mockProcessDueReminders = jest.fn();
jest.mock('@/lib/services/PaymentReminderService', () => ({
  paymentReminderService: {
    billDueDatedStages: (...a: unknown[]) => mockBillDueDatedStages(...a),
    processOverdueItems: (...a: unknown[]) => mockProcessOverdueItems(...a),
    processDueReminders: (...a: unknown[]) => mockProcessDueReminders(...a),
  },
}));
jest.mock('@/lib/repositories/PaymentRepository', () => ({
  paymentInvoiceRepository: { markAllOverdueInvoices: async () => ({ data: 0, error: null }) },
}));

import { BOS_CRON_JOBS } from '@/lib/cron/bosCronJobs';
import { resetCronRunRecorderState } from '@/lib/cron/cronRunRecorder';

type RouteModule = { GET: (request: NextRequest) => Promise<Response> };

/** Load a route AFTER the environment is set (two routes read CRON_SECRET at module load). */
function loadRoute(id: string): RouteModule {
  let mod: RouteModule | undefined;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the env is set, per route
    mod = require(`@/app/api/cron/${id}/route`) as RouteModule;
  });
  return mod!;
}

function cronRequest(id: string, authorization: string | null) {
  const headers: Record<string, string> = { 'user-agent': 'vercel-cron/1.0' };
  if (authorization !== null) headers.authorization = authorization;
  return new NextRequest(`http://localhost/api/cron/${id}`, { headers });
}

beforeEach(() => {
  env.NODE_ENV = 'production';
  env.VERCEL_ENV = 'production';
  env.CRON_SECRET = SECRET;
  jest.clearAllMocks();
  resetCronRunRecorderState();
  mockStartRun.mockResolvedValue({ data: true, error: null });
  mockFinishRun.mockResolvedValue({ data: true, error: null });
  mockPrune.mockResolvedValue({ data: true, error: null });
  mockBillDueDatedStages.mockResolvedValue({ billed: 0, skipped: 0, failed: 0 });
  mockProcessOverdueItems.mockResolvedValue({ overdueInvoices: 0, overdueInstallments: 0, remindersScheduled: 0 });
  mockProcessDueReminders.mockResolvedValue({ processed: 0, sent: 0, failed: 0 });
});

afterAll(() => {
  env.NODE_ENV = saved.NODE_ENV;
  env.VERCEL_ENV = saved.VERCEL_ENV;
  env.CRON_SECRET = saved.CRON_SECRET;
});

describe.each(BOS_CRON_JOBS.map((job) => [job.id, job] as const))('%s', (id, job) => {
  it('an authorised run with nothing to do is recorded: start, then finish as succeeded, with numeric counts', async () => {
    const { GET } = loadRoute(id);
    const response = await GET(cronRequest(id, `Bearer ${SECRET}`));
    expect(response.status).toBe(200);

    expect(mockStartRun).toHaveBeenCalledTimes(1);
    const [start] = mockStartRun.mock.calls[0] as [Record<string, unknown>];
    expect(start).toMatchObject({ job: id, source: 'vercel_cron' });

    expect(mockFinishRun).toHaveBeenCalledTimes(1);
    const [runId, finish] = mockFinishRun.mock.calls[0] as [string, Record<string, unknown>];
    expect(runId).toBe(start.id);
    expect(finish).toMatchObject({ outcome: 'succeeded', httpStatus: 200, errorClass: null });
    const counts = finish.counts as Record<string, unknown>;
    expect(Object.keys(counts).length).toBeGreaterThan(0);
    for (const [key, value] of Object.entries(counts)) {
      expect(job.counts.map((c) => c.key)).toContain(key);
      expect(typeof value).toBe('number');
    }
    expect(mockPrune).toHaveBeenCalledTimes(1);
  });

  it('an unauthorised call records nothing and is refused by the route itself', async () => {
    const { GET } = loadRoute(id);
    const response = await GET(cronRequest(id, 'Bearer wrong-secret'));
    expect(response.status).toBe(401);
    expect(mockStartRun).not.toHaveBeenCalled();
    expect(mockFinishRun).not.toHaveBeenCalled();
  });

  it('a failing record write leaves the job\'s work and response unchanged', async () => {
    mockStartRun.mockResolvedValue({ data: null, error: new Error('db down') });
    mockFinishRun.mockResolvedValue({ data: null, error: new Error('db down') });
    const { GET } = loadRoute(id);
    const recorded = await GET(cronRequest(id, `Bearer ${SECRET}`));

    // The same job with the recorder out of the picture (a preview deployment).
    env.VERCEL_ENV = 'preview';
    const plain = await loadRoute(id).GET(cronRequest(id, `Bearer ${SECRET}`));

    expect(recorded.status).toBe(plain.status);
    const strip = (body: Record<string, unknown>) => {
      const copy = JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
      delete copy.duration_ms;
      if (copy.data && typeof copy.data === 'object') {
        delete (copy.data as Record<string, unknown>).duration;
        delete (copy.data as Record<string, unknown>).runId;
      }
      return copy;
    };
    expect(strip(await recorded.json())).toEqual(strip(await plain.json()));
  });
});

describe('payment-reminders: every step of the job', () => {
  const steps = [
    ['billDueDatedStages', mockBillDueDatedStages],
    ['processOverdueItems', mockProcessOverdueItems],
    ['processDueReminders', mockProcessDueReminders],
  ] as const;

  it('runs each step once, billing before the overdue scan and the scan before the sender', async () => {
    const { GET } = loadRoute('payment-reminders');
    const response = await GET(cronRequest('payment-reminders', `Bearer ${SECRET}`));
    expect(response.status).toBe(200);

    for (const [, mock] of steps) expect(mock).toHaveBeenCalledTimes(1);
    const order = steps.map(([, mock]) => mock.mock.invocationCallOrder[0]);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it.each(steps)('a throw from %s fails the run and is recorded as failed, like any other step', async (_name, mock) => {
    mock.mockRejectedValue(new Error('step down'));
    const { GET } = loadRoute('payment-reminders');
    const response = await GET(cronRequest('payment-reminders', `Bearer ${SECRET}`));
    expect(response.status).toBe(500);

    expect(mockFinishRun).toHaveBeenCalledTimes(1);
    const [, finish] = mockFinishRun.mock.calls[0] as [string, Record<string, unknown>];
    expect(finish).toMatchObject({ outcome: 'failed', httpStatus: 500, errorClass: 'http_error', counts: {} });
  });
});
