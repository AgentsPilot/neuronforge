/**
 * QA edge cases for GET /api/admin/jobs-queues/webhook-events (plan payments
 * P-8b.3b, AM-4; SA P3-SA-3, P3-SA-6, P3-SA-7).
 *
 * Adds to the Dev suite: 401/403 win over an unknown Stripe mode and over a
 * failing read; the 409 for a missing or malformed key; the 409's details in
 * development only; the gate failing closed when the admin check throws; a
 * Stripe customer id planted beside an email, checked in the body and every
 * log call on the 200 AND the 500 paths; and a builder throw on one corrupt
 * row answering 500 with the error name only.
 */

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

const ADMIN = { id: '11111111-1111-4111-8111-11111111111a', email: 'ops@example.com' };
const CUSTOMER = { id: '22222222-2222-4222-8222-22222222222b', email: 'customer@example.com' };
const EMAIL = 'jane.customer@example.com';
const CUS = 'cus_QAplanted123';
const PLANTED = [EMAIL, CUS];
const env = process.env as Record<string, string | undefined>;
/** Assigning `undefined` to process.env stores the string "undefined"; delete instead. */
const setKey = (key: string | undefined) => {
  if (key === undefined) delete env.STRIPE_SECRET_KEY;
  else env.STRIPE_SECRET_KEY = key;
};
const savedKey = env.STRIPE_SECRET_KEY;
const savedNodeEnv = env.NODE_ENV;

const call = (query = '') => GET(new NextRequest(`http://localhost/api/admin/jobs-queues/webhook-events${query}`));
const asAdmin = () => {
  mockGetUser.mockResolvedValue(ADMIN);
  mockIsAdmin.mockResolvedValue(true);
};

function plantedRows(created: number = Math.floor(Date.now() / 1000) - 3600) {
  const message = `No such customer: ${CUS} (${EMAIL})`;
  return {
    failed: [
      {
        event_id: 'evt_Q1',
        event_type: 'customer.subscription.updated',
        status: 'failed',
        processed_at: new Date(Date.now() - 60_000).toISOString(),
        failure_message: message,
        metadata: { created, livemode: false },
      },
    ],
    stuck: [
      {
        event_id: 'evt_Q2',
        event_type: 'invoice.paid',
        status: 'processing',
        processed_at: new Date(Date.now() - 20 * 60_000).toISOString(),
        failure_message: `timed out ${message}`,
        metadata: { created: created - 10, livemode: false },
      },
    ],
  };
}

function readsOk() {
  mockRepo.countUnfinishedAllEvents.mockResolvedValue({ data: { failed: 1, stuck: 1 }, error: null });
  mockRepo.listUnfinishedAllEvents.mockResolvedValue({ data: plantedRows(), error: null });
  mockRepo.countUnfinishedNoModeAllEvents.mockResolvedValue({ data: { failed: 0, stuck: 0 }, error: null });
}

const noRead = () => {
  expect(mockRepo.countUnfinishedAllEvents).not.toHaveBeenCalled();
  expect(mockRepo.listUnfinishedAllEvents).not.toHaveBeenCalled();
  expect(mockRepo.countUnfinishedNoModeAllEvents).not.toHaveBeenCalled();
};

const expectNothingPlanted = (text: string) => {
  for (const p of PLANTED) expect(text).not.toContain(p);
};

beforeEach(() => {
  jest.clearAllMocks();
  logged.length = 0;
  env.STRIPE_SECRET_KEY = 'sk_test_qa';
  env.NODE_ENV = savedNodeEnv;
  readsOk();
});

afterAll(() => {
  setKey(savedKey);
  env.NODE_ENV = savedNodeEnv;
});

describe('QA: the gate wins over everything after it', () => {
  it('signed out with an unknown key → 401, not 409', async () => {
    setKey(undefined);
    mockGetUser.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
    noRead();
  });

  it('non-admin with an unknown key and a query → 403, not 400 or 409', async () => {
    env.STRIPE_SECRET_KEY = 'garbage';
    mockGetUser.mockResolvedValue(CUSTOMER);
    mockIsAdmin.mockResolvedValue(false);
    expect((await call('?x=1')).status).toBe(403);
    noRead();
  });

  it('the admin check throwing fails closed (403), before any read', async () => {
    mockGetUser.mockResolvedValue(ADMIN);
    mockIsAdmin.mockRejectedValue(new Error('admin_users down'));
    const res = await call();
    expect([401, 403]).toContain(res.status);
    noRead();
  });

  it('getUser throwing → 401, before any read', async () => {
    mockGetUser.mockRejectedValue(new Error('cookie jar'));
    expect((await call()).status).toBe(401);
    noRead();
  });
});

describe('QA: 400 after the gate', () => {
  beforeEach(asAdmin);

  it.each(['?x', '?=', '?livemode=true', '?mode=test&mode=live'])('%s → 400, no read', async (q) => {
    const res = await call(q);
    expect(res.status).toBe(400);
    noRead();
  });

  it('the 400 is checked before the mode: a query with an unknown key is 400, not 409', async () => {
    setKey(undefined);
    expect((await call('?a=1')).status).toBe(400);
  });

  it('outside development the 400 has no details', async () => {
    const body = await (await call('?a=1')).json();
    expect(body.details).toBeUndefined();
  });
});

describe('QA: 409 for an unknown Stripe mode', () => {
  beforeEach(asAdmin);

  it.each([[undefined], [''], ['pk_live_x'], ['sk_x'], ['whsec_x']])('key %p → 409 with the shared words, no read', async (key) => {
    setKey(key);
    const res = await call();
    expect(res.status).toBe(409);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = await res.json();
    expect(body).toEqual({ success: false, error: WEBHOOK_EVENTS_MODE_UNKNOWN });
    noRead();
  });

  it('in development the 409 carries a code only, never the key', async () => {
    env.NODE_ENV = 'development';
    env.STRIPE_SECRET_KEY = 'pk_live_secretish';
    const body = await (await call()).json();
    expect(body.details).toEqual({ code: 'stripe_mode_unknown' });
    expect(JSON.stringify(body)).not.toContain('pk_live');
    for (const args of logged) expect(JSON.stringify(args)).not.toContain('pk_live');
  });

  it('rk_ restricted keys resolve a mode (200)', async () => {
    env.STRIPE_SECRET_KEY = 'rk_live_qa';
    const res = await call();
    expect(res.status).toBe(200);
    expect(mockRepo.listUnfinishedAllEvents).toHaveBeenCalledWith({ livemode: true, now: expect.any(Date) });
  });
});

describe('QA: P3-SA-6 with an email AND a customer id planted', () => {
  beforeEach(asAdmin);

  it('200: neither is in the body or any log call', async () => {
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expectNothingPlanted(JSON.stringify(body));
    expect(logged.length).toBeGreaterThan(0);
    for (const args of logged) expectNothingPlanted(JSON.stringify(args));
    expect(body.data.rows.map((r: { failureClass: string }) => r.failureClass).sort()).toEqual(['handler_error', 'stuck']);
  });

  it('500 on a count read failing while the list (with PII) was read: neither the body nor any log call carries it', async () => {
    env.NODE_ENV = 'development';
    mockRepo.countUnfinishedAllEvents.mockResolvedValue({ data: null, error: new Error('connection reset') });
    const res = await call();
    expect(res.status).toBe(500);
    const text = JSON.stringify(await res.json());
    expectNothingPlanted(text);
    for (const args of logged) expectNothingPlanted(JSON.stringify(args));
    const failure = logged.find((a) => a[1] === 'Webhook events read failed');
    expect(Object.keys(failure![0] as object).sort()).toEqual(['err', 'read']);
    expect((failure![0] as { read: string }).read).toBe('counts');
  });

  it('a repo answer of { data: null, error: null } is still a 500, never a crash', async () => {
    mockRepo.countUnfinishedNoModeAllEvents.mockResolvedValue({ data: null, error: null });
    const res = await call();
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Could not read the webhook events. Try again.');
  });

  // Changed after SA/QA (QA Low 2): an out-of-range created time no longer
  // throws, so the builder throw is now provoked by a malformed list instead.
  it('a malformed answer that makes the builder throw → 500 with the error name only, no PII anywhere', async () => {
    env.NODE_ENV = 'development';
    mockRepo.listUnfinishedAllEvents.mockResolvedValue({ data: { failed: null, stuck: plantedRows().stuck }, error: null });
    const res = await call();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      error: 'Could not read the webhook events. Try again.',
      details: { errName: 'TypeError' },
    });
    expectNothingPlanted(JSON.stringify(body));
    for (const args of logged) expectNothingPlanted(JSON.stringify(args));
  });
});
