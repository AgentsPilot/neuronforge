/**
 * QA probe (slice 5 PR-2, uncommitted): the run recorder never changes what a
 * cron route answers, for any caller, in any environment.
 *
 * VERSION-AGNOSTIC on purpose: the same file runs on base 609635ff (no
 * recorder) and on the PR-2 tree. Each run writes, per route and scenario, the
 * status and the body (timings stripped) to QA_OUT; QA diffs the two files.
 * On the PR-2 tree it also asserts that ONLY the proven Vercel call is recorded.
 */

import fs from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';

const HAS_RECORDER = fs.existsSync(path.join(process.cwd(), 'lib/cron/cronRunRecorder.ts'));
const SECRET = 'qa-probe-secret-0123456789';
const env = process.env as Record<string, string | undefined>;
const saved = { NODE_ENV: env.NODE_ENV, VERCEL_ENV: env.VERCEL_ENV, CRON_SECRET: env.CRON_SECRET };

const mockStartRun = jest.fn();
const mockFinishRun = jest.fn();
const mockPrune = jest.fn();

jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});
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
jest.mock('@/lib/services/PaymentReminderService', () => ({
  paymentReminderService: {
    billDueDatedStages: async () => ({ billed: 0, skipped: 0, failed: 0 }),
    processOverdueItems: async () => ({ overdueInvoices: 0, overdueInstallments: 0, remindersScheduled: 0 }),
    processDueReminders: async () => ({ processed: 0, sent: 0, failed: 0 }),
  },
}));
jest.mock('@/lib/repositories/PaymentRepository', () => ({
  paymentInvoiceRepository: { markAllOverdueInvoices: async () => ({ data: 0, error: null }) },
}));

const ROUTES = [
  'calendar-sync',
  'lead-response',
  'insight-automations',
  'insight-actions',
  'payment-retry',
  'daily-briefing',
  'intake-reminders',
  'abandoned-proposal-invoices',
  'channel-metrics-sync',
  'insight-metrics',
  'insight-detect',
  'payment-reminders',
];

interface Scenario {
  name: string;
  nodeEnv: string;
  vercelEnv: string | undefined;
  secret: string | undefined;
  authorization: string | null;
  userAgent: string;
  method: 'GET' | 'POST';
  /** Only the proven Vercel cron call (or a manual call carrying the secret) may be recorded. */
  recorded: boolean;
}

const PROD = { nodeEnv: 'production', vercelEnv: 'production', secret: SECRET, userAgent: 'vercel-cron/1.0', method: 'GET' as const };
const SCENARIOS: Scenario[] = [
  { name: 'A proven vercel cron', ...PROD, authorization: `Bearer ${SECRET}`, recorded: true },
  { name: 'A2 manual call with the secret', ...PROD, userAgent: 'curl/8', authorization: `Bearer ${SECRET}`, recorded: true },
  { name: 'B wrong secret, same length', ...PROD, authorization: `Bearer ${'x'.repeat(SECRET.length)}`, recorded: false },
  { name: 'C wrong secret, different length', ...PROD, authorization: 'Bearer short', recorded: false },
  { name: 'C2 secret with a suffix', ...PROD, authorization: `Bearer ${SECRET}x`, recorded: false },
  { name: 'C3 lower-case bearer', ...PROD, authorization: `bearer ${SECRET}`, recorded: false },
  { name: 'D no authorization header', ...PROD, authorization: null, recorded: false },
  { name: 'E CRON_SECRET unset, no header', ...PROD, secret: undefined, authorization: null, recorded: false },
  { name: 'E2 CRON_SECRET unset, "Bearer undefined"', ...PROD, secret: undefined, authorization: 'Bearer undefined', recorded: false },
  { name: 'E3 CRON_SECRET empty, "Bearer "', ...PROD, secret: '', authorization: 'Bearer ', recorded: false },
  { name: 'F NODE_ENV development, right secret', ...PROD, nodeEnv: 'development', authorization: `Bearer ${SECRET}`, recorded: false },
  { name: 'F2 NODE_ENV test, right secret', ...PROD, nodeEnv: 'test', authorization: `Bearer ${SECRET}`, recorded: false },
  { name: 'G VERCEL_ENV preview, right secret', ...PROD, vercelEnv: 'preview', authorization: `Bearer ${SECRET}`, recorded: false },
  { name: 'G2 VERCEL_ENV unset, right secret', ...PROD, vercelEnv: undefined, authorization: `Bearer ${SECRET}`, recorded: false },
  { name: 'P1 dev POST, right secret', ...PROD, nodeEnv: 'development', method: 'POST', authorization: `Bearer ${SECRET}`, recorded: false },
  { name: 'P2 dev POST, no header', ...PROD, nodeEnv: 'development', method: 'POST', authorization: null, recorded: false },
  { name: 'P3 production POST, right secret', ...PROD, method: 'POST', authorization: `Bearer ${SECRET}`, recorded: false },
];

type RouteModule = { GET: (r: NextRequest) => Promise<Response>; POST?: (r: NextRequest) => Promise<Response> };

function setEnv(s: Scenario) {
  env.NODE_ENV = s.nodeEnv;
  if (s.vercelEnv === undefined) delete env.VERCEL_ENV;
  else env.VERCEL_ENV = s.vercelEnv;
  if (s.secret === undefined) delete env.CRON_SECRET;
  else env.CRON_SECRET = s.secret;
}

function loadRoute(id: string): RouteModule {
  let mod: RouteModule | undefined;
  jest.isolateModules(() => {
    if (HAS_RECORDER) {
      jest.doMock('@/lib/repositories/BosCronRunRepository', () => ({
        ...jest.requireActual('@/lib/repositories/supabaseErrorCodes'),
        bosCronRunRepository: {
          startRun: (...a: unknown[]) => mockStartRun(...a),
          finishRun: (...a: unknown[]) => mockFinishRun(...a),
          deleteRunsStartedBefore: (...a: unknown[]) => mockPrune(...a),
        },
      }));
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the env is set, per route
    mod = require(`@/app/api/cron/${id}/route`) as RouteModule;
  });
  return mod!;
}

function strip(body: unknown): unknown {
  if (!body || typeof body !== 'object') return body;
  const copy = JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
  delete copy.duration_ms;
  if (copy.data && typeof copy.data === 'object') {
    delete (copy.data as Record<string, unknown>).duration;
    delete (copy.data as Record<string, unknown>).runId;
  }
  return copy;
}

const results: Record<string, { status: number | 'threw'; body: unknown }> = {};

beforeEach(() => {
  jest.clearAllMocks();
  mockStartRun.mockResolvedValue({ data: true, error: null });
  mockFinishRun.mockResolvedValue({ data: true, error: null });
  mockPrune.mockResolvedValue({ data: true, error: null });
});

afterAll(() => {
  env.NODE_ENV = saved.NODE_ENV;
  if (saved.VERCEL_ENV === undefined) delete env.VERCEL_ENV;
  else env.VERCEL_ENV = saved.VERCEL_ENV;
  if (saved.CRON_SECRET === undefined) delete env.CRON_SECRET;
  else env.CRON_SECRET = saved.CRON_SECRET;
  if (process.env.QA_OUT) fs.writeFileSync(process.env.QA_OUT, JSON.stringify(results, null, 1));
});

describe.each(ROUTES)('%s', (id) => {
  it.each(SCENARIOS.map((s) => [s.name, s] as const))('%s', async (_name, s) => {
    setEnv(s);
    const route = loadRoute(id);
    const headers: Record<string, string> = { 'user-agent': s.userAgent };
    if (s.authorization !== null) headers.authorization = s.authorization;
    const request = new NextRequest(`http://localhost/api/cron/${id}`, { method: s.method, headers });
    const handler = s.method === 'POST' ? route.POST : route.GET;
    if (!handler) {
      results[`${id} | ${s.name}`] = { status: 405, body: 'no POST export' };
      expect(mockStartRun).not.toHaveBeenCalled();
      return;
    }
    let status: number | 'threw';
    let body: unknown;
    try {
      const response = await handler(request);
      status = response.status;
      body = strip(await response.json().catch(() => 'non-json'));
    } catch {
      status = 'threw';
      body = null;
    }
    results[`${id} | ${s.name}`] = { status, body };

    if (HAS_RECORDER) {
      if (s.recorded) {
        expect(mockStartRun).toHaveBeenCalledTimes(1);
        const [start] = mockStartRun.mock.calls[0] as [Record<string, unknown>];
        expect(start.job).toBe(id);
        expect(start.source).toBe(s.userAgent.startsWith('vercel-cron/') ? 'vercel_cron' : 'other');
        expect(mockFinishRun).toHaveBeenCalledTimes(1);
      } else {
        expect(mockStartRun).not.toHaveBeenCalled();
        expect(mockFinishRun).not.toHaveBeenCalled();
        expect(mockPrune).not.toHaveBeenCalled();
      }
    }
  });
});
