/**
 * PATCH /api/business-os/leads/[id]: the owner's "Cancel" and "Send now" on a
 * queued lead reply (BL-7a part 2, P2; SA ruling on OP-2, L-1..L-5).
 *
 * The rule this file exists for: "Send now" AWAITS its drain, under
 * `maxDuration = 60`, so the runner it starts is dead before the 90 s lease
 * ends and an admin retry of a dead-lettered row cannot race it into a second
 * send. A failed drain is still the owner's success: the row stays due and
 * the cron sends it.
 */

import * as fs from 'fs';
import * as path from 'path';
import { NextRequest } from 'next/server';

const getUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => getUser() }));

const warn = jest.fn();
jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = {
    info: jest.fn(),
    warn: (...a: unknown[]) => warn(...a),
    error: jest.fn(),
    debug: jest.fn(),
  };
  logger.child = () => logger;
  return { createLogger: () => logger };
});

const cancelPending = jest.fn();
const sendNow = jest.fn();
jest.mock('@/lib/repositories/LeadResponseRepository', () => ({
  leadResponseRepository: {
    cancelPending: (...a: unknown[]) => cancelPending(...a),
    sendNow: (...a: unknown[]) => sendNow(...a),
  },
}));

const dispatchLeadResponses = jest.fn();
jest.mock('@/lib/services/LeadResponseDispatchService', () => ({
  dispatchLeadResponses: (...a: unknown[]) => dispatchLeadResponses(...a),
}));

import { PATCH } from '../route';

const SESSION_USER = { id: 'session-user-id', email: 'owner@example.com' };
const CONTACT_ID = 'contact-1';
const ROUTE_FILE = 'app/api/business-os/leads/[id]/route.ts';

function req(body: unknown, raw = false): NextRequest {
  return new NextRequest(`http://localhost/api/business-os/leads/${CONTACT_ID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

const ctx = () => ({ params: Promise.resolve({ id: CONTACT_ID }) });

/** Strip comments, so a comment cannot satisfy a source pin. */
function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const DRAINED = { reaped: 0, enqueued: 0, claimed: 1, sent: 1, skipped: 0 };

beforeEach(() => {
  jest.clearAllMocks();
  getUser.mockResolvedValue(SESSION_USER);
  cancelPending.mockResolvedValue({ cancelled: true });
  sendNow.mockResolvedValue({ scheduled: true });
  dispatchLeadResponses.mockResolvedValue(DRAINED);
});

describe('PATCH /api/business-os/leads/[id]', () => {
  it('L-1 send_now waits for the drain: a held drain keeps the response pending', async () => {
    let releaseDrain: () => void = () => undefined;
    dispatchLeadResponses.mockReturnValue(
      new Promise((resolve) => {
        releaseDrain = () => resolve(DRAINED);
      })
    );

    let settled = false;
    const pending = PATCH(req({ action: 'send_now' }), ctx()).then((r) => {
      settled = true;
      return r;
    });

    // Let everything ahead of the drain run; the response must still wait.
    for (let i = 0; i < 5; i += 1) await new Promise((r) => setImmediate(r));
    expect(dispatchLeadResponses).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);

    releaseDrain();
    const res = await pending;
    expect(settled).toBe(true);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
  });

  it('L-1 send_now drains a small batch, not a full cron batch', async () => {
    await PATCH(req({ action: 'send_now' }), ctx());
    expect(dispatchLeadResponses).toHaveBeenCalledWith({ batch: 5, sweep: false });
  });

  it('L-2 a failed drain is still 200 success, with one warn carrying { err }', async () => {
    const boom = new Error('drain exploded');
    dispatchLeadResponses.mockRejectedValue(boom);

    const res = await PATCH(req({ action: 'send_now' }), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toEqual({ err: boom });
  });

  it('L-3 cancel never drains, whether or not it cancelled', async () => {
    let res = await PATCH(req({ action: 'cancel' }), ctx());
    expect(await res.json()).toEqual({ success: true });

    cancelPending.mockResolvedValue({ cancelled: false });
    res = await PATCH(req({ action: 'cancel' }), ctx());
    expect(await res.json()).toEqual({ success: false, reason: 'already_sending' });

    expect(dispatchLeadResponses).not.toHaveBeenCalled();
    expect(sendNow).not.toHaveBeenCalled();
  });

  it('L-3 send_now that scheduled nothing (already_sending) never drains', async () => {
    sendNow.mockResolvedValue({ scheduled: false });
    const res = await PATCH(req({ action: 'send_now' }), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: false, reason: 'already_sending' });
    expect(dispatchLeadResponses).not.toHaveBeenCalled();
  });

  it('L-4 401 without a user: no repository call, no drain', async () => {
    getUser.mockResolvedValue(null);
    const res = await PATCH(req({ action: 'send_now' }), ctx());
    expect(res.status).toBe(401);
    expect(sendNow).not.toHaveBeenCalled();
    expect(cancelPending).not.toHaveBeenCalled();
    expect(dispatchLeadResponses).not.toHaveBeenCalled();
  });

  it.each([
    ['an unknown action', { action: 'send_later' }],
    ['an unknown kind', { action: 'send_now', kind: 'spam' }],
    ['no action', {}],
  ])('L-4 400 on %s: no repository call, no drain', async (_label, body) => {
    const res = await PATCH(req(body), ctx());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, error: 'Invalid request' });
    expect(sendNow).not.toHaveBeenCalled();
    expect(cancelPending).not.toHaveBeenCalled();
    expect(dispatchLeadResponses).not.toHaveBeenCalled();
  });

  it('L-4 400 on a body that is not JSON', async () => {
    const res = await PATCH(req('{not json', true), ctx());
    expect(res.status).toBe(400);
    expect(dispatchLeadResponses).not.toHaveBeenCalled();
  });

  it('scopes every repository call to the SESSION user, never a body field', async () => {
    await PATCH(req({ action: 'send_now', kind: 'chase', user_id: 'someone-else', userId: 'someone-else' }), ctx());
    expect(sendNow).toHaveBeenCalledWith(CONTACT_ID, 'chase', SESSION_USER.id);

    await PATCH(req({ action: 'cancel', user_id: 'someone-else' }), ctx());
    expect(cancelPending).toHaveBeenCalledWith(CONTACT_ID, 'invite', SESSION_USER.id);
  });

  it('500 with no detail when the repository throws, and no drain', async () => {
    sendNow.mockRejectedValue(new Error('db down'));
    const res = await PATCH(req({ action: 'send_now' }), ctx());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: 'Failed' });
    expect(dispatchLeadResponses).not.toHaveBeenCalled();
  });
});

describe('L-5 source pin: the lead route is the P2 shape', () => {
  const code = codeOf(fs.readFileSync(path.join(process.cwd(), ROUTE_FILE), 'utf8'));

  it('exports maxDuration = 60', () => {
    expect(code).toMatch(/^export const maxDuration\s*=\s*60\s*;?\s*$/m);
  });

  it('awaits every dispatchLeadResponses( call, and has at least one', () => {
    const calls = [...code.matchAll(/\bdispatchLeadResponses\s*\(/g)];
    expect(calls.length).toBeGreaterThan(0);
    const unawaited = calls.filter((m) => !/\bawait\s+$/.test(code.slice(0, m.index)));
    expect(unawaited.map((m) => m.index)).toEqual([]);
    expect(code).not.toMatch(/dispatchLeadResponses\s*\([^)]*\)\s*\.(catch|then)\s*\(/);
  });
});
