/**
 * The production wiring of the redemption (Slice 1b): the code email goes from
 * the platform's SYSTEM sender (D-7, SA F-10, R-9): `kind: 'transactional'`,
 * no `from`, no `replyTo`, no `ownerUserId`, code in the body only. Audit entries
 * carry the correlation id and the invite as the entity. The not-recognised body
 * is the validate route's, byte for byte.
 */

const sent: Array<Record<string, unknown>> = [];
const audited: Array<Record<string, unknown>> = [];

jest.mock('server-only', () => ({}));
jest.mock('@/lib/notifications/emailTransport', () => ({
  sendEmail: async (params: Record<string, unknown>) => {
    sent.push(params);
    return { sent: true, provider: 'resend' };
  },
}));
jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrailService: {
    getInstance: () => ({
      log: async (entry: Record<string, unknown>) => {
        audited.push(entry);
      },
      flush: async () => undefined,
    }),
  },
}));
jest.mock('@/lib/repositories/AuthAccountRepository', () => ({ authAccountRepository: {} }));
jest.mock('@/lib/repositories/BusinessOsInviteRepository', () => ({ businessOsInviteRepository: {} }));
const provision = jest.fn(async () => ({ data: 'inv', error: null }));
jest.mock('@/lib/repositories/BusinessOsAccountPlanRepository', () => ({
  businessOsAccountPlanRepository: { provisionFromInvite: (...args: unknown[]) => provision(...(args as [])) },
}));

import { NextRequest } from 'next/server';

import { verifyGoogleIdToken } from '../googleIdToken';
import { NOT_RECOGNISED_BODY, buildRedemptionDeps, refusalToHttp } from '../redemptionDeps';

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
const request = new NextRequest('http://localhost:3000/api/public/invites/signup/code', { method: 'POST' });

beforeEach(() => {
  sent.length = 0;
  audited.length = 0;
});

describe('the code email (D-7, F-10, R-9)', () => {
  it('is transactional, from the system sender (no from, replyTo or ownerUserId), to the invite address only', async () => {
    const deps = buildRedemptionDeps({ logger, correlationId: 'corr-1', request });
    expect(await deps.sendCode({ to: 'invitee@example.com', code: '482913', language: 'he' })).toEqual({ sent: true });
    expect(sent).toHaveLength(1);
    const params = sent[0];
    expect(params.kind).toBe('transactional');
    expect(params.to).toEqual(['invitee@example.com']);
    expect(params).not.toHaveProperty('from');
    expect(params).not.toHaveProperty('replyTo');
    expect(params).not.toHaveProperty('ownerUserId');
    // SA MF-1: the recipient is kept out of the transport's log lines.
    expect(params.redactRecipientInLogs).toBe(true);
    expect(String(params.subject)).not.toContain('482913');
    expect(String(params.html)).toContain('482913');
    expect(String(params.html)).toContain('dir="rtl"');
  });

  it('an unknown language falls back to English', async () => {
    const deps = buildRedemptionDeps({ logger, correlationId: 'corr-1', request });
    await deps.sendCode({ to: 'invitee@example.com', code: '482913', language: 'fr' });
    expect(sent[0].subject).toBe('Your AgentPilot sign-up code');
  });
});

describe('audit and finalise wiring', () => {
  it('writes the invite as the entity, the new account as user and actor, and the correlation id', async () => {
    const deps = buildRedemptionDeps({ logger, correlationId: 'corr-1', request });
    await deps.audit({ action: 'BOS_INVITE_REDEEMED', inviteId: 'inv', accountId: 'acct', details: { level: 1 } });
    expect(audited[0]).toMatchObject({
      action: 'BOS_INVITE_REDEEMED',
      entityType: 'business_os_invite',
      entityId: 'inv',
      userId: 'acct',
      actorId: 'acct',
      details: { correlationId: 'corr-1', level: 1 },
    });
  });

  it('finalise is the plan repository provisionFromInvite, with the arguments unchanged', async () => {
    const deps = buildRedemptionDeps({ logger, correlationId: 'corr-1', request });
    const input = { inviteId: 'inv', accountId: 'acct', email: 'invitee@example.com', cohort: 'champion' };
    await deps.finalise(input);
    expect(provision).toHaveBeenCalledWith(input);
  });

  it('Slice 3b: wires the production Google verifier, which is off (no network) while the client id is unset', async () => {
    const deps = buildRedemptionDeps({ logger, correlationId: 'corr-1', request });
    expect(deps.verifyGoogleIdToken).toBe(verifyGoogleIdToken);
    const saved = process.env.NEXT_PUBLIC_GOOGLE_SIGNIN_CLIENT_ID;
    delete process.env.NEXT_PUBLIC_GOOGLE_SIGNIN_CLIENT_ID;
    try {
      expect(await deps.verifyGoogleIdToken({ idToken: 'a.b.c', rawNonce: 'n'.repeat(43) })).toEqual({ kind: 'not_configured' });
    } finally {
      if (saved !== undefined) process.env.NEXT_PUBLIC_GOOGLE_SIGNIN_CLIENT_ID = saved;
    }
  });

  it('generates a fresh UUID per account id (I-3)', () => {
    const deps = buildRedemptionDeps({ logger, correlationId: 'corr-1', request });
    const first = deps.newAccountId();
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(deps.newAccountId()).not.toBe(first);
  });
});

describe('refusalToHttp', () => {
  it('not_recognised is the validate route body, 200', () => {
    expect(refusalToHttp({ kind: 'not_recognised' })).toEqual({ status: 200, body: NOT_RECOGNISED_BODY });
    expect(JSON.stringify(NOT_RECOGNISED_BODY)).toBe(JSON.stringify({ success: true, data: { state: 'not_recognised' } }));
  });

  it('includes attemptsRemaining and retryAfterSeconds only when present', () => {
    expect(refusalToHttp({ kind: 'refused', status: 409, error: 'used' })).toEqual({ status: 409, body: { success: false, error: 'used' } });
    expect(refusalToHttp({ kind: 'refused', status: 409, error: 'code_invalid', attemptsRemaining: 0 }).body).toEqual({
      success: false,
      error: 'code_invalid',
      attemptsRemaining: 0,
    });
  });
});
