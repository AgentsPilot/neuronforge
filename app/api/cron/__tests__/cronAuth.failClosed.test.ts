/**
 * PROD-1b (A5), workplan 11.6 (with SA condition 5): the cron entry points that
 * ran open, plus the ones the adoption suite does not reach, refuse a request
 * without the right secret before any work.
 *
 * Covered: #6 calendar-sync, #7 channel-metrics-sync, #22 memory-consolidation
 * (GET and POST), #27 update-template-scores, #28 run-scheduled-agents,
 * #29 run-scheduled-agents-direct, and the job-running POSTs of #3
 * booking-money-reconcile and #17 insight-hypotheses. The 23 scheduled
 * Business OS GETs are covered by runRecord.adoption.test.ts.
 *
 * Each route's work is mocked; "work" below is the first thing the route does
 * after its auth check.
 */

import { NextRequest } from 'next/server';

jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

jest.mock('@/lib/repositories/BosCronRunRepository', () => ({
  ...jest.requireActual('@/lib/repositories/supabaseErrorCodes'),
  bosCronRunRepository: {
    startRun: jest.fn(async () => ({ data: null, error: null })),
    finishRun: jest.fn(async () => ({ data: null, error: null })),
    deleteRunsStartedBefore: jest.fn(async () => ({ data: 0, error: null })),
  },
}));

// ── The work each route does after its auth check ───────────────────────────
const work = {
  calendarUsers: jest.fn(async () => ({ data: [], error: null })),
  channelSync: jest.fn(async () => []),
  memoryConsolidate: jest.fn(async () => undefined),
  supabaseJsFrom: jest.fn(),
  scheduledRunner: jest.fn(async () => ({ due: 0, ran: 0 })),
  reconcileMoney: jest.fn(async () => ({ unresolved: [], repaired: 0 })),
  supabaseServerFrom: jest.fn(),
};

jest.mock('@/lib/repositories/BusinessProfileRepository', () => ({
  businessProfileRepository: { getUsersWithCalendarSyncEnabled: () => work.calendarUsers() },
}));
jest.mock('@/lib/services/CalendarSyncService', () => ({ CalendarSyncService: { syncExternalEvents: jest.fn() } }));
jest.mock('@/lib/business-os/channel-insights/ChannelMetricsSyncService', () => ({
  channelMetricsSyncService: { syncDue: () => work.channelSync() },
}));
jest.mock('@/lib/memory/MemoryConsolidationScheduler', () => ({
  MemoryConsolidationScheduler: class {
    triggerConsolidation() {
      return work.memoryConsolidate();
    }
  },
}));
jest.mock('@supabase/ssr', () => ({ createServerClient: jest.fn(() => ({})) }));

/** A chain that answers `{ data: [], error: null }` to anything awaited. */
function emptyChain(): unknown {
  return new Proxy(function () {} as unknown as object, {
    get(_t, prop) {
      if (prop === 'then') return (resolve: (v: unknown) => void) => resolve({ data: [], error: null, count: 0 });
      return () => emptyChain();
    },
    apply() {
      return emptyChain();
    },
  });
}
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (...args: unknown[]) => {
      work.supabaseJsFrom(...args);
      return emptyChain();
    },
  }),
}));
jest.mock('@/lib/supabaseServer', () => ({
  supabaseServer: {
    from: (...args: unknown[]) => {
      work.supabaseServerFrom(...args);
      return emptyChain();
    },
  },
}));
jest.mock('@/lib/execution/scheduledAgentRunner', () => ({ runScheduledAgents: () => work.scheduledRunner() }));
jest.mock('@/lib/utils/runAgentWithContext', () => ({ runAgentWithContext: jest.fn() }));
jest.mock('@/lib/payments/reconcileBookingMoney', () => ({ reconcileBookingMoney: () => work.reconcileMoney() }));
jest.mock('@/lib/business-os/llm/callCatalog', () => ({ newBosGroupId: () => 'group-1' }));
jest.mock('@/lib/business-os/llm/aiActionAudit', () => ({ runAiAction: jest.fn() }));
jest.mock('@/lib/business-os/insight/hypothesis/HypothesisService', () => ({ generateHypotheses: jest.fn() }));
jest.mock('@/lib/repositories/InsightHypothesisRepository', () => ({ insightHypothesisRepository: {} }));

const SECRET = 'fail-closed-test-secret-0123456789';
const ENV = { ...process.env };

type Handler = (request: NextRequest) => Promise<Response>;
interface EntryPoint {
  name: string;
  load: () => Handler;
  method: 'GET' | 'POST';
  workCalled: () => boolean;
}

/* eslint-disable @typescript-eslint/no-require-imports -- each route is loaded lazily, after its mocks */
const ENTRY_POINTS: EntryPoint[] = [
  { name: '#6 calendar-sync GET', method: 'GET', load: () => require('@/app/api/cron/calendar-sync/route').GET, workCalled: () => work.calendarUsers.mock.calls.length > 0 },
  { name: '#7 channel-metrics-sync GET', method: 'GET', load: () => require('@/app/api/cron/channel-metrics-sync/route').GET, workCalled: () => work.channelSync.mock.calls.length > 0 },
  { name: '#22 memory-consolidation GET', method: 'GET', load: () => require('@/app/api/cron/memory-consolidation/route').GET, workCalled: () => work.memoryConsolidate.mock.calls.length > 0 },
  { name: '#22 memory-consolidation POST', method: 'POST', load: () => require('@/app/api/cron/memory-consolidation/route').POST, workCalled: () => work.memoryConsolidate.mock.calls.length > 0 },
  { name: '#27 update-template-scores GET', method: 'GET', load: () => require('@/app/api/cron/update-template-scores/route').GET, workCalled: () => work.supabaseJsFrom.mock.calls.length > 0 },
  { name: '#28 run-scheduled-agents GET', method: 'GET', load: () => require('@/app/api/run-scheduled-agents/route').GET, workCalled: () => work.scheduledRunner.mock.calls.length > 0 },
  { name: '#29 run-scheduled-agents-direct GET', method: 'GET', load: () => require('@/app/api/run-scheduled-agents-direct/route').GET, workCalled: () => work.supabaseJsFrom.mock.calls.length > 0 },
  { name: '#3 booking-money-reconcile POST', method: 'POST', load: () => require('@/app/api/cron/booking-money-reconcile/route').POST, workCalled: () => work.reconcileMoney.mock.calls.length > 0 },
  { name: '#17 insight-hypotheses POST', method: 'POST', load: () => require('@/app/api/cron/insight-hypotheses/route').POST, workCalled: () => work.supabaseServerFrom.mock.calls.length > 0 },
];
/* eslint-enable @typescript-eslint/no-require-imports */

/** As Vercel runs them: NODE_ENV production. VERCEL_ENV preview, so the run recorder stays out of the way. */
function setEnv(secret: string | undefined): void {
  process.env = { ...ENV };
  (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
  process.env.VERCEL_ENV = 'preview';
  if (secret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = secret;
}

function call(entry: EntryPoint, authorization: string | undefined): Promise<Response> {
  const headers: Record<string, string> = authorization === undefined ? {} : { authorization };
  return entry.load()(new NextRequest(`https://app.example/api/x`, { method: entry.method, headers }));
}

afterEach(() => {
  process.env = { ...ENV };
  jest.clearAllMocks();
});

describe.each(ENTRY_POINTS.map((entry) => [entry.name, entry] as const))('%s', (_name, entry) => {
  it.each([
    ['secret unset, no header', undefined, undefined],
    ['secret unset, "Bearer undefined"', undefined, 'Bearer undefined'],
    ['secret set, wrong header', SECRET, 'Bearer wrong'],
    ['secret set, no header', SECRET, undefined],
  ])('%s: 401 and no work (fail closed)', async (_label, secret, header) => {
    setEnv(secret);
    const response = await call(entry, header);
    expect(response.status).toBe(401);
    expect(entry.workCalled()).toBe(false);
  });

  it('the right secret reaches the work (positive control)', async () => {
    setEnv(SECRET);
    const response = await call(entry, `Bearer ${SECRET}`);
    expect(response.status).not.toBe(401);
    expect(entry.workCalled()).toBe(true);
  });
});
