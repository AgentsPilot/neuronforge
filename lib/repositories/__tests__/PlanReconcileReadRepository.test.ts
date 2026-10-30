/**
 * PlanReconcileReadRepository (plan payments P-8b.2; SA rulings 8, 9): the
 * three read-only reads of the nightly plan reconcile pass. A recording fake
 * client: no database, no network.
 */

import fs from 'fs';
import path from 'path';
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

import {
  PLAN_RECONCILE_BILLING_COLUMNS,
  PLAN_RECONCILE_EVENT_COLUMNS,
  PLAN_RECONCILE_JOB,
  PLAN_RECONCILE_READ_LIMITS,
  PlanReconcileReadCeilingError,
  PlanReconcileReadRepository,
  planReconcileReadRepository,
  RECONCILE_RUN_COLUMNS,
} from '@/lib/repositories/PlanReconcileReadRepository';
import { findBosCronJob } from '@/lib/cron/bosCronJobs';

type Call = [method: string, ...args: unknown[]];

/** Each query records its calls; `answer(n)` gives the n-th query's result. */
function recordingClient(answer: (index: number) => { data: unknown; error: unknown }) {
  const queries: Call[][] = [];
  const client = {
    from: (table: string) => {
      const calls: Call[] = [['from', table]];
      const index = queries.length;
      queries.push(calls);
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'neq', 'in', 'is', 'not', 'or', 'order', 'limit', 'gt', 'gte', 'lt']) {
        builder[method] = (...args: unknown[]) => {
          calls.push([method, ...args]);
          return builder;
        };
      }
      builder.then = (onF: (v: unknown) => unknown, onR: (e: unknown) => unknown) => Promise.resolve(answer(index)).then(onF, onR);
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, queries };
}

const SINCE = '2026-10-21T05:41:00.000Z';

describe('listRecentReconcileRunsAllJobs', () => {
  it('reads finished runs of the billing reconcile job since the cutoff, newest first, bounded', async () => {
    const rows = [{ started_at: SINCE, outcome: 'succeeded', counts: { planEventsSeen: 1 } }];
    const { client, queries } = recordingClient(() => ({ data: rows, error: null }));
    const result = await new PlanReconcileReadRepository(client).listRecentReconcileRunsAllJobs(SINCE);
    expect(result).toEqual({ data: rows, error: null });
    expect(queries[0]).toEqual([
      ['from', 'bos_cron_runs'],
      ['select', RECONCILE_RUN_COLUMNS],
      ['eq', 'job', 'bos-billing-reconcile'],
      ['in', 'outcome', ['succeeded', 'partial']],
      ['gte', 'started_at', SINCE],
      ['order', 'started_at', { ascending: false }],
      ['limit', PLAN_RECONCILE_READ_LIMITS.RUNS],
    ]);
  });

  it('the job name is the registry id', () => {
    expect(findBosCronJob(PLAN_RECONCILE_JOB)?.id).toBe(PLAN_RECONCILE_JOB);
  });

  it('refuses a cutoff that is not an ISO UTC time before any query', async () => {
    const { client, queries } = recordingClient(() => ({ data: [], error: null }));
    const result = await new PlanReconcileReadRepository(client).listRecentReconcileRunsAllJobs("2026-10-21' or 1=1");
    expect(result.data).toBeNull();
    expect(queries).toHaveLength(0);
  });

  it('returns the error, never throws', async () => {
    const { client } = recordingClient(() => ({ data: null, error: { message: 'down' } }));
    const result = await new PlanReconcileReadRepository(client).listRecentReconcileRunsAllJobs(SINCE);
    expect(result.data).toBeNull();
    expect(result.error).toBeTruthy();
  });
});

describe('listPlanSubscriptionRowsAllAccounts', () => {
  const row = (id: string) => ({ id, user_id: null, livemode: false, stripe_subscription_id: `sub_${id}` });

  it('one mode, only rows holding a subscription, keyset-paged on id', async () => {
    const pages = [[row('a'), row('b')], [row('c')]];
    const { client, queries } = recordingClient((i) => ({ data: pages[i] ?? [], error: null }));
    const result = await new PlanReconcileReadRepository(client).listPlanSubscriptionRowsAllAccounts(false, { pageSize: 2 });
    expect(result.data?.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(queries[0]).toEqual([
      ['from', 'business_os_billing_accounts'],
      ['select', PLAN_RECONCILE_BILLING_COLUMNS],
      ['eq', 'livemode', false],
      ['not', 'stripe_subscription_id', 'is', null],
      ['order', 'id', { ascending: true }],
      ['limit', 2],
    ]);
    expect(queries[1]).toContainEqual(['gt', 'id', 'b']);
  });

  it('reaching the ceiling is an error, never a partial list', async () => {
    const { client } = recordingClient(() => ({ data: [row('a'), row('b')], error: null }));
    const result = await new PlanReconcileReadRepository(client).listPlanSubscriptionRowsAllAccounts(true, { pageSize: 2, ceiling: 2 });
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(PlanReconcileReadCeilingError);
  });

  it('refuses a mode that is not a boolean', async () => {
    const { client, queries } = recordingClient(() => ({ data: [], error: null }));
    const result = await new PlanReconcileReadRepository(client).listPlanSubscriptionRowsAllAccounts('live' as unknown as boolean);
    expect(result.data).toBeNull();
    expect(queries).toHaveLength(0);
  });

  it('selects no checkout lock, no bearer link, no money', () => {
    expect(PLAN_RECONCILE_BILLING_COLUMNS).not.toMatch(/open_checkout|action_required_invoice_url|amount|stripe_customer_id/);
  });
});

describe('findRecordedPlanPaymentsAllAccounts', () => {
  it('reads by event id, then invoice_paid rows by invoice id, in one mode', async () => {
    const answers = [
      { data: [{ stripe_event_id: 'evt_1', stripe_invoice_id: 'in_1', kind: 'invoice_paid' }], error: null },
      { data: [{ stripe_event_id: 'evt_1', stripe_invoice_id: 'in_1', kind: 'invoice_paid' }], error: null },
    ];
    const { client, queries } = recordingClient((i) => answers[i]);
    const result = await new PlanReconcileReadRepository(client).findRecordedPlanPaymentsAllAccounts(false, {
      eventIds: ['evt_1', 'evt_2', 'evt_1'],
      invoiceIds: ['in_1', 'in_2'],
    });
    expect(result).toEqual({ data: { eventIds: ['evt_1'], invoiceIds: ['in_1'] }, error: null });
    expect(queries[0]).toEqual([
      ['from', 'business_os_billing_events'],
      ['select', PLAN_RECONCILE_EVENT_COLUMNS],
      ['eq', 'livemode', false],
      ['in', 'stripe_event_id', ['evt_1', 'evt_2']],
    ]);
    expect(queries[1]).toEqual([
      ['from', 'business_os_billing_events'],
      ['select', PLAN_RECONCILE_EVENT_COLUMNS],
      ['eq', 'livemode', false],
      ['eq', 'kind', 'invoice_paid'],
      ['in', 'stripe_invoice_id', ['in_1', 'in_2']],
    ]);
  });

  it('chunks at 100 ids per query', async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `evt_${i}`);
    const { client, queries } = recordingClient(() => ({ data: [], error: null }));
    await new PlanReconcileReadRepository(client).findRecordedPlanPaymentsAllAccounts(true, { eventIds: ids, invoiceIds: [] });
    expect(queries.map((q) => (q.find((c) => c[0] === 'in')?.[2] as string[]).length)).toEqual([100, 100, 50]);
  });

  it('an empty input makes no query', async () => {
    const { client, queries } = recordingClient(() => ({ data: [], error: null }));
    const result = await new PlanReconcileReadRepository(client).findRecordedPlanPaymentsAllAccounts(true, { eventIds: [], invoiceIds: [] });
    expect(result.data).toEqual({ eventIds: [], invoiceIds: [] });
    expect(queries).toHaveLength(0);
  });

  it.each([
    ['an event id carrying a filter', { eventIds: ['evt_1,kind.neq.x'], invoiceIds: [] }],
    ['an invoice id that is not one', { eventIds: [], invoiceIds: ['sub_1'] }],
  ])('refuses %s before any query', async (_name, ids) => {
    const { client, queries } = recordingClient(() => ({ data: [], error: null }));
    const result = await new PlanReconcileReadRepository(client).findRecordedPlanPaymentsAllAccounts(true, ids);
    expect(result.data).toBeNull();
    expect(queries).toHaveLength(0);
  });
});

describe('source rules', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'lib/repositories/PlanReconcileReadRepository.ts'), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('never writes: no insert, update, upsert, delete or rpc', () => {
    expect(code).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(/);
  });

  it('opens exactly its three tables, never selects *', () => {
    expect([...code.matchAll(/\.from\(\s*'([a-z_]+)'\s*\)/g)].map((m) => m[1])).toEqual([
      'bos_cron_runs',
      'business_os_billing_accounts',
      'business_os_billing_events',
      'business_os_billing_events',
    ]);
    expect(code).not.toMatch(/select\(\s*['"]\*['"]/);
  });

  it('names neither billing writer repository nor the cron recorder repository', () => {
    expect(code).not.toMatch(/BusinessOsBillingAccountRepository|BusinessOsBillingEventRepository|BosCronRunRepository/);
  });

  it('defaults to the service-role client and logs with Pino, never console', () => {
    expect((planReconcileReadRepository as unknown as { supabase: unknown }).supabase).toEqual({ marker: 'service-role-default' });
    expect(source).not.toMatch(/console\./);
  });

  it('its only caller is the plan pass wiring', () => {
    const ROOT = process.cwd();
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (['node_modules', '.next', '.claude', 'coverage', '__tests__'].includes(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry.name) && fs.readFileSync(full, 'utf8').includes('PlanReconcileReadRepository')) {
          found.push(path.relative(ROOT, full).split(path.sep).join('/'));
        }
      }
    };
    for (const dir of ['app', 'lib', 'components', 'hooks']) walk(path.join(ROOT, dir));
    expect(found.sort()).toEqual(['lib/business-os/billing/planReconcileDeps.ts', 'lib/repositories/PlanReconcileReadRepository.ts']);
  });
});
