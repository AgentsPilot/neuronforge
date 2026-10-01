/**
 * The production wiring of the redemption (Slice 1b): the code email goes from
 * the platform's SYSTEM sender (D-7, SA F-10, R-9): `kind: 'transactional'`,
 * no `from`, no `replyTo`, no `ownerUserId`, code in the body only. Audit entries
 * carry the correlation id and the invite as the entity. The not-recognised body
 * is the validate route's, byte for byte.
 */

const sent: Array<Record<string, unknown>> = [];
const transport: { throws: boolean } = { throws: false };
const audited: Array<Record<string, unknown>> = [];

jest.mock('server-only', () => ({}));
jest.mock('@/lib/notifications/emailTransport', () => ({
  sendEmail: async (params: Record<string, unknown>) => {
    if (transport.throws) throw new Error('transport exploded');
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
const provisionFriend = jest.fn(async () => ({ data: { outcome: 'finalised', inviteId: 'inv', level: 2 }, error: null }));
const findEntitlementInputs = jest.fn(async () => ({ data: { plan: null, overrides: [] }, error: null }));
jest.mock('@/lib/repositories/BusinessOsAccountPlanRepository', () => ({
  businessOsAccountPlanRepository: {
    provisionFromInvite: (...args: unknown[]) => provision(...(args as [])),
    provisionFromFriendInvite: (...args: unknown[]) => provisionFriend(...(args as [])),
    findEntitlementInputs: (...args: unknown[]) => findEntitlementInputs(...(args as [])),
  },
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

describe('the existing-account notice (Slice 5b; F5b-3, SA R-5)', () => {
  it('is transactional, from the system sender (no from, replyTo or ownerUserId), with no code and nothing from the champion', async () => {
    const deps = buildRedemptionDeps({ logger, correlationId: 'corr-1', request });
    expect(await deps.sendExistingAccountNotice({ to: 'friend@example.com', language: 'he' })).toEqual({ sent: true });
    expect(sent).toHaveLength(1);
    const params = sent[0];
    expect(params.kind).toBe('transactional');
    expect(params.to).toEqual(['friend@example.com']);
    expect(params).not.toHaveProperty('from');
    expect(params).not.toHaveProperty('replyTo');
    expect(params).not.toHaveProperty('ownerUserId');
    expect(params.redactRecipientInLogs).toBe(true);
    expect(String(params.html)).toContain('dir="rtl"');
    expect(String(params.text)).not.toMatch(/[0-9]{6}/);
    expect(String(params.text)).toMatch(/\/login/);
  });
});

describe('the existing-account notice never throws (SA N-1)', () => {
  it('QA-1: a malformed NEXT_PUBLIC_MARKETING_URL does not throw: the notice is sent WITHOUT a link', async () => {
    const saved = process.env.NEXT_PUBLIC_MARKETING_URL;
    process.env.NEXT_PUBLIC_MARKETING_URL = 'javascript:alert(1)';
    try {
      const deps = buildRedemptionDeps({ logger, correlationId: 'corr-1', request });
      await expect(deps.sendExistingAccountNotice({ to: 'friend@example.com', language: 'en' })).resolves.toEqual({ sent: true });
      expect(sent).toHaveLength(1);
      expect(String(sent[0].html)).not.toContain('javascript:');
    } finally {
      if (saved === undefined) delete process.env.NEXT_PUBLIC_MARKETING_URL;
      else process.env.NEXT_PUBLIC_MARKETING_URL = saved;
    }
  });

  it('SA N-1: a transport that throws is { sent: false }, logged, never a throw', async () => {
    transport.throws = true;
    try {
      const deps = buildRedemptionDeps({ logger, correlationId: 'corr-1', request });
      await expect(deps.sendExistingAccountNotice({ to: 'friend@example.com', language: 'en' })).resolves.toEqual({ sent: false });
      expect(logger.error).toHaveBeenCalled();
    } finally {
      transport.throws = false;
    }
  });

  it('issuerPlans exposes only the one read method (SA N-3)', () => {
    const deps = buildRedemptionDeps({ logger, correlationId: 'corr-1', request });
    expect(Object.keys(deps.issuerPlans)).toEqual(['findEntitlementInputs']);
  });
});

describe('audit and finalise wiring', () => {
  it('Slice 5b: finaliseFriend is the plan repository provisionFromFriendInvite, and issuerPlans reads the plan row', async () => {
    const deps = buildRedemptionDeps({ logger, correlationId: 'corr-1', request });
    const input = { inviteId: 'inv', accountId: 'acct', email: 'friend@example.com', tierId: 't', issuerCohort: 'c' };
    await deps.finaliseFriend(input);
    expect(provisionFriend).toHaveBeenCalledWith(input);
    await deps.issuerPlans.findEntitlementInputs('issuer');
    expect(findEntitlementInputs).toHaveBeenCalledWith('issuer');
  });

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
