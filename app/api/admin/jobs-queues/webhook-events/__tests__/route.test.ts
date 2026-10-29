/**
 * GET /api/admin/jobs-queues/webhook-events (plan payments P-8b.3b, AM-4;
 * SA P3-SA-3, P3-SA-5, P3-SA-6).
 *
 * The admin gate is real (with `getUser` and the access service mocked); the
 * read repository is mocked; the builder is REAL, so the body is exactly what
 * the route sends. Every log call is captured for the PII check.
 */

import * as fs from 'fs';
import * as path from 'path';
import { NextRequest } from 'next/server';

const mockGetUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => mockGetUser() }));

const mockIsAdmin = jest.fn();
jest.mock('@/lib/services/AdminAccessService', () => ({
  AdminAccessService: { getInstance: () => ({ isAdmin: (...args: unknown[]) => mockIsAdmin(...args) }) },
}));
jest.mock('@/lib/audit/recordRefusedAccess', () => ({ recordRefusedAccess: jest.fn(async () => undefined) }));

const logged: unknown[][] = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const rec = (...a: unknown[]) => void logged.push(a);
    const logger: Record<string, unknown> = { info: rec, warn: rec, error: rec, debug: rec };
    logger.child = (...a: unknown[]) => {
      logged.push(['child', ...a]);
      return logger;
    };
    return logger;
  };
  return { createLogger: () => make() };
});

const mockRepo = {
  countUnfinishedAllEvents: jest.fn(),
  listUnfinishedAllEvents: jest.fn(),
  countUnfinishedNoModeAllEvents: jest.fn(),
};
jest.mock('@/lib/repositories/AdminWebhookEventReadRepository', () => ({
  ADMIN_WEBHOOK_READ_PER_STATE: 200,
  ADMIN_WEBHOOK_STALE_AFTER_MS: 15 * 60 * 1000,
  adminWebhookEventReadRepository: mockRepo,
}));
jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));

import { GET } from '../route';
import { WEBHOOK_EVENTS_MODE_UNKNOWN } from '@/lib/admin/jobs/webhookEventsTypes';
import { STRIPE_MODE_UNKNOWN } from '@/lib/admin/billing/subscriptionsTypes';
import type { WebhookEventsPayload } from '@/lib/admin/jobs/webhookEventsTypes';

const ADMIN = { id: '11111111-1111-4111-8111-11111111111a', email: 'ops@example.com' };
const CUSTOMER = { id: '22222222-2222-4222-8222-22222222222b', email: 'customer@example.com' };
const PII = 'jane.customer@example.com';
const env = process.env as Record<string, string | undefined>;
const savedKey = env.STRIPE_SECRET_KEY;
const savedNodeEnv = env.NODE_ENV;

const call = (query = '') => GET(new NextRequest(`http://localhost/api/admin/jobs-queues/webhook-events${query}`));

const asAdmin = () => {
  mockGetUser.mockResolvedValue(ADMIN);
  mockIsAdmin.mockResolvedValue(true);
};

const createdSecondsAgo = (minutes: number) => Math.floor((Date.now() - minutes * 60_000) / 1000);

function failedRow(id: string, message: string | null, livemode = false) {
  return {
    event_id: id,
    event_type: 'invoice.payment_failed',
    status: 'failed',
    processed_at: new Date(Date.now() - 5 * 60_000).toISOString(),
    failure_message: message,
    metadata: { created: createdSecondsAgo(90), livemode },
  };
}

function readsOk(livemode = false) {
  mockRepo.countUnfinishedAllEvents.mockResolvedValue({ data: { failed: 2, stuck: 0 }, error: null });
  mockRepo.listUnfinishedAllEvents.mockResolvedValue({
    data: {
      failed: [failedRow('evt_A1', `No such customer: ${PII}`, livemode), failedRow('evt_A2', `timed out for ${PII}`, livemode)],
      stuck: [],
    },
    error: null,
  });
  mockRepo.countUnfinishedNoModeAllEvents.mockResolvedValue({ data: { failed: 0, stuck: 0 }, error: null });
}

const noRead = () => {
  expect(mockRepo.countUnfinishedAllEvents).not.toHaveBeenCalled();
  expect(mockRepo.listUnfinishedAllEvents).not.toHaveBeenCalled();
  expect(mockRepo.countUnfinishedNoModeAllEvents).not.toHaveBeenCalled();
};

beforeEach(() => {
  jest.clearAllMocks();
  logged.length = 0;
  env.STRIPE_SECRET_KEY = 'sk_test_only_value';
  env.NODE_ENV = savedNodeEnv;
  readsOk();
});

afterAll(() => {
  env.STRIPE_SECRET_KEY = savedKey;
  env.NODE_ENV = savedNodeEnv;
});

describe('the admin gate (P3-SA-3)', () => {
  it('401 without a session, before any read, no-store', async () => {
    mockGetUser.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(401);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    noRead();
  });

  it('403 for a signed-in non-admin, before any read', async () => {
    mockGetUser.mockResolvedValue(CUSTOMER);
    mockIsAdmin.mockResolvedValue(false);
    const res = await call();
    expect(res.status).toBe(403);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    noRead();
  });

  it('a query parameter from a signed-out caller is still 401, never 400 (the gate runs first)', async () => {
    mockGetUser.mockResolvedValue(null);
    expect((await call('?mode=live')).status).toBe(401);
  });

  it('a query parameter from a non-admin is still 403, never 400', async () => {
    mockGetUser.mockResolvedValue(CUSTOMER);
    mockIsAdmin.mockResolvedValue(false);
    expect((await call('?mode=live')).status).toBe(403);
  });

  it('source: requireAdmin is the first statement of GET', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'app/api/admin/jobs-queues/webhook-events/route.ts'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const body = code.slice(code.indexOf('export async function GET('));
    const first = body.slice(body.indexOf('{') + 1).trim().split(';')[0];
    expect(first).toMatch(/^const gate = await requireAdmin\(/);
    expect(code).not.toMatch(/profiles|app_metadata|AdminAccessService/);
  });
});

describe('input (P3-SA-3: strict, the 400 after the gate)', () => {
  beforeEach(asAdmin);

  it.each(['?mode=live', '?limit=500', '?status=failed', '?a=1&a=2'])('%s → 400, no read', async (query) => {
    const res = await call(query);
    expect(res.status).toBe(400);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = await res.json();
    expect(body).toMatchObject({ success: false, error: 'This endpoint takes no parameters' });
    noRead();
  });
});

describe('the mode', () => {
  beforeEach(asAdmin);

  it('409 with the WEBHOOK_EVENTS_MODE_UNKNOWN words when the key mode cannot be read, no read', async () => {
    env.STRIPE_SECRET_KEY = 'pk_test_not_a_secret';
    const res = await call();
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe(WEBHOOK_EVENTS_MODE_UNKNOWN);
    // The user's G-5 wording: this page's own ending; Finance's sentence is unchanged.
    expect(WEBHOOK_EVENTS_MODE_UNKNOWN).toBe('The server’s Stripe key mode could not be read, so no webhook events are shown.');
    expect(STRIPE_MODE_UNKNOWN).toBe('The server’s Stripe key mode could not be read, so no subscription figures are shown.');
    expect(body.error).not.toBe(STRIPE_MODE_UNKNOWN);
    expect(JSON.stringify(body)).not.toContain('pk_test');
    noRead();
  });

  it.each([
    ['sk_test_x', 'test', false, 'https://dashboard.stripe.com/test/events/evt_A1'],
    ['sk_live_x', 'live', true, 'https://dashboard.stripe.com/events/evt_A1'],
  ] as const)('%s → mode %s, every read filtered on livemode %p, links in that mode', async (key, mode, livemode, link) => {
    env.STRIPE_SECRET_KEY = key;
    readsOk(livemode);
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const { success, data } = (await res.json()) as { success: boolean; data: WebhookEventsPayload };
    expect(success).toBe(true);
    expect(data.mode).toBe(mode);
    expect(mockRepo.countUnfinishedAllEvents).toHaveBeenCalledWith({ livemode, now: expect.any(Date) });
    expect(mockRepo.listUnfinishedAllEvents).toHaveBeenCalledWith({ livemode, now: expect.any(Date) });
    expect(mockRepo.countUnfinishedNoModeAllEvents).toHaveBeenCalledWith({ now: expect.any(Date) });
    // One clock for every read.
    const [[a], [b], [c]] = [
      mockRepo.countUnfinishedAllEvents.mock.calls[0],
      mockRepo.listUnfinishedAllEvents.mock.calls[0],
      mockRepo.countUnfinishedNoModeAllEvents.mock.calls[0],
    ];
    expect(a.now).toBe(b.now);
    expect(b.now).toBe(c.now);
    expect(data.rows.map((r) => r.dashboardUrl)).toContain(link);
    expect(data.tiles.failed).toBe(2);
    expect(data.rows.map((r) => r.failureClass).sort()).toEqual(['handler_error', 'timeout']);
  });
});

describe('P3-SA-6: no PII in the response or any log call', () => {
  beforeEach(asAdmin);

  it('an email planted in failure_message reaches neither the body nor a log line', async () => {
    const res = await call();
    expect(res.status).toBe(200);
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain(PII);
    expect(text).not.toContain('No such customer');
    expect(logged.length).toBeGreaterThan(0);
    for (const args of logged) expect(JSON.stringify(args)).not.toContain(PII);
    // The served line carries counts and the mode only.
    const served = logged.find((args) => args[1] === 'Webhook events served');
    expect(served).toBeDefined();
    expect(Object.keys(served![0] as object).sort()).toEqual(
      ['durationMs', 'failed', 'listed', 'matching', 'mode', 'noMode', 'oldestAtLeast', 'stuck'].sort()
    );
  });

  it.each(['countUnfinishedAllEvents', 'listUnfinishedAllEvents', 'countUnfinishedNoModeAllEvents'] as const)(
    'a failed %s read → 500 with fixed words; development details carry the error name only',
    async (method) => {
      env.NODE_ENV = 'development';
      const err = Object.assign(new Error(`row content ${PII}`), { name: 'PostgrestError' });
      mockRepo[method].mockResolvedValue({ data: null, error: err });
      const res = await call();
      expect(res.status).toBe(500);
      expect(res.headers.get('Cache-Control')).toBe('no-store');
      const body = await res.json();
      expect(body).toEqual({
        success: false,
        error: 'Could not read the webhook events. Try again.',
        details: { errName: 'PostgrestError' },
      });
      expect(JSON.stringify(body)).not.toContain(PII);
    }
  );

  it('a throw after the gate → 500 with fixed words; details are the error name only, and absent outside development', async () => {
    mockRepo.listUnfinishedAllEvents.mockRejectedValue(new TypeError(`bad ${PII}`));
    let res = await call();
    expect(res.status).toBe(500);
    let body = await res.json();
    expect(body).toEqual({ success: false, error: 'Could not read the webhook events. Try again.' });

    env.NODE_ENV = 'development';
    mockRepo.listUnfinishedAllEvents.mockRejectedValue(new TypeError(`bad ${PII}`));
    res = await call();
    body = await res.json();
    expect(body.details).toEqual({ errName: 'TypeError' });
    expect(JSON.stringify(body)).not.toContain(PII);
  });
});

describe('fixes after SA/QA (P-8b.3b): QA Low 2 at the route', () => {
  beforeEach(asAdmin);

  it('an out-of-range created time is a 200, the row says not recorded, and the other rows still show', async () => {
    mockRepo.listUnfinishedAllEvents.mockResolvedValue({
      data: {
        failed: [{ ...failedRow('evt_Bad1', null), metadata: { created: 1e13, livemode: false } }, failedRow('evt_Ok1', null)],
        stuck: [],
      },
      error: null,
    });
    const res = await call();
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: WebhookEventsPayload };
    expect(data.rows.map((r) => r.eventId).sort()).toEqual(['evt_Bad1', 'evt_Ok1']);
    expect(data.rows.find((r) => r.eventId === 'evt_Bad1')!.createdAt).toBeNull();
    expect(data.rows.find((r) => r.eventId === 'evt_Bad1')!.ageMinutes).toBe(5);
    expect(data.rows.find((r) => r.eventId === 'evt_Ok1')!.createdAt).not.toBeNull();
  });
});
