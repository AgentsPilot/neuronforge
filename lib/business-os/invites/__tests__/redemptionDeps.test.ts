/**
 * The production wiring of the redemption (Slice 1b): the code email goes from
 * the platform's SYSTEM sender (D-7, SA F-10, R-9): `kind: 'transactional'`,
 * no `from` (`platformSenderAddress()` is only a gate: nothing is sent when it
 * is unset), no `replyTo`, no `ownerUserId`, code in the body only. Audit entries
 * carry the correlation id and the invite as the entity. The not-recognised body
 * is the validate route's, byte for byte.
 */

const sent: Array<Record<string, unknown>> = [];
const transport: { throws: boolean; sender: string | undefined } = { throws: false, sender: 'notifications@agentspilot.ai' };
const audited: Array<Record<string, unknown>> = [];

jest.mock('server-only', () => ({}));
jest.mock('@/lib/notifications/emailTransport', () => ({
  sendEmail: async (params: Record<string, unknown>) => {
    if (transport.throws) throw new Error('transport exploded');
    sent.push(params);
    return { sent: true, provider: 'resend' };
  },
  platformSenderAddress: () => transport.sender,
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
// N-1: the inviter notification's lookups, keyed by id.
const identityLookups: string[] = [];
const adminChecks: string[] = [];
const languageReads: string[] = [];
jest.mock('@/lib/repositories/AuthAccountRepository', () => ({
  authAccountRepository: {
    findUserIdentity: async (id: string) => {
      identityLookups.push(id);
      return { data: { id, email: 'champion@example.org', createdAt: null }, error: null };
    },
  },
}));
jest.mock('@/lib/services/AdminAccessService', () => ({
  AdminAccessService: {
    getInstance: () => ({
      isAdminById: async (id: string) => {
        adminChecks.push(id);
        return true;
      },
    }),
  },
}));
jest.mock('@/lib/repositories/BusinessProfileRepository', () => ({
  businessProfileRepository: {
    findLanguage: async (id: string) => {
      languageReads.push(`profile:${id}`);
      return { data: 'he', error: null };
    },
  },
}));
jest.mock('@/lib/repositories/UserPreferencesRepository', () => ({
  userPreferencesRepository: {
    findPreferredLanguage: async (id: string) => {
      languageReads.push(`preference:${id}`);
      return { data: 'en', error: null };
    },
  },
}));
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

import { readFileSync } from 'fs';
import { join } from 'path';

import { NextRequest } from 'next/server';

import { verifyGoogleIdToken } from '../googleIdToken';
import { NOT_RECOGNISED_BODY, buildRedemptionDeps, refusalToHttp } from '../redemptionDeps';

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
const request = new NextRequest('http://localhost:3000/api/public/invites/signup/code', { method: 'POST' });

beforeEach(() => {
  sent.length = 0;
  audited.length = 0;
  identityLookups.length = 0;
  adminChecks.length = 0;
  languageReads.length = 0;
  transport.sender = 'notifications@agentspilot.ai';
  jest.clearAllMocks();
});

describe('the code email (D-7, F-10, R-9)', () => {
  it('is transactional, from the system sender (no from, replyTo or ownerUserId), to the invite address only', async () => {
    const deps = buildRedemptionDeps({ logger, correlationId: 'corr-1', request });
    expect(await deps.sendCode({ to: 'invitee@example.com', code: '482913', language: 'he' })).toEqual({ sent: true });
    expect(sent).toHaveLength(1);
    const params = sent[0];
    expect(params.kind).toBe('transactional');
    expect(params.to).toEqual(['invitee@example.com']);
    // The sender is only a gate: the transport keeps using RESEND_FROM_EMAIL as configured.
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
    // The sender is only a gate: the transport keeps using RESEND_FROM_EMAIL as configured.
    expect(params).not.toHaveProperty('from');
    expect(params).not.toHaveProperty('replyTo');
    expect(params).not.toHaveProperty('ownerUserId');
    expect(params.redactRecipientInLogs).toBe(true);
    expect(String(params.html)).toContain('dir="rtl"');
    expect(String(params.text)).not.toMatch(/[0-9]{6}/);
    expect(String(params.text)).toMatch(/\/login/);
  });
});

describe('both system emails fail closed without a platform sender (never the transport default)', () => {
  it('the code email is not sent and reports senderNotConfigured, logged without the address', async () => {
    transport.sender = undefined;
    const deps = buildRedemptionDeps({ logger, correlationId: 'corr-1', request });
    expect(await deps.sendCode({ to: 'invitee@example.com', code: '482913', language: 'en' })).toEqual({
      sent: false,
      senderNotConfigured: true,
    });
    expect(sent).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('invitee@example.com');
  });

  it('the existing-account notice is not sent and reports senderNotConfigured, logged without the address', async () => {
    transport.sender = undefined;
    const deps = buildRedemptionDeps({ logger, correlationId: 'corr-1', request });
    expect(await deps.sendExistingAccountNotice({ to: 'friend@example.com', language: 'en' })).toEqual({
      sent: false,
      senderNotConfigured: true,
    });
    expect(sent).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('friend@example.com');
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

describe('N-1: the inviter notification wiring (workplan §5 test 12; SA Q-3, Q-4, C-2, C-3)', () => {
  const friendInput = {
    event: 'accepted' as const,
    inviteId: 'inv',
    issuerKind: 'account' as const,
    issuerAccountId: 'champion-id',
    issuerAdminId: null,
    inviteeEmail: 'friend@example.com',
    landing: 'awaiting_payment' as const,
  };

  it("emails the champion's live auth email in the champion's language, from the system sender", async () => {
    const deps = buildRedemptionDeps({ logger, correlationId: 'corr-1', request });
    await expect(deps.notifyInviter(friendInput)).resolves.toEqual({ outcome: 'sent', recipientKind: 'champion' });
    expect(identityLookups).toEqual(['champion-id']);
    expect(adminChecks).toEqual([]);
    expect(languageReads.sort()).toEqual(['preference:champion-id', 'profile:champion-id']);
    expect(sent).toHaveLength(1);
    const params = sent[0];
    expect(params.to).toEqual(['champion@example.org']);
    expect(params.kind).toBe('transactional');
    expect(params).not.toHaveProperty('from');
    expect(params).not.toHaveProperty('replyTo');
    expect(params).not.toHaveProperty('ownerUserId');
    expect(params.redactRecipientInLogs).toBe(true);
    expect(params.redactInLogs).toEqual(['friend@example.com']);
    // The profile says he: the recipient's language, not the invite's.
    expect(String(params.html)).toContain('dir="rtl"');
  });

  it('an admin invite checks the ISSUING admin, by the id from the row', async () => {
    const deps = buildRedemptionDeps({ logger, correlationId: 'corr-1', request });
    await deps.notifyInviter({ ...friendInput, issuerKind: 'admin', issuerAccountId: null, issuerAdminId: 'admin-id', landing: 'onboarding' });
    expect(adminChecks).toEqual(['admin-id']);
    expect(identityLookups).toEqual(['admin-id']);
  });

  it('audits through the same non-blocking path, with NO owner (SA Q-4) and the correlation id', async () => {
    const deps = buildRedemptionDeps({ logger, correlationId: 'corr-1', request });
    await deps.notifyInviter(friendInput);
    expect(audited).toHaveLength(1);
    expect(audited[0]).toMatchObject({
      action: 'BOS_INVITE_INVITER_NOTIFIED',
      entityType: 'business_os_invite',
      entityId: 'inv',
      userId: null,
      actorId: null,
      details: { correlationId: 'corr-1', recipientKind: 'champion', recipientAccountId: 'champion-id', status: 'not_subscribed_yet' },
    });
    expect(JSON.stringify(audited)).not.toContain('@');
  });

  it('fails closed without a platform sender: nothing looked up or sent, audited as not notified', async () => {
    transport.sender = undefined;
    const deps = buildRedemptionDeps({ logger, correlationId: 'corr-1', request });
    await expect(deps.notifyInviter(friendInput)).resolves.toMatchObject({ outcome: 'not_sent', reason: 'sender_not_configured' });
    expect(sent).toEqual([]);
    expect(identityLookups).toEqual([]);
    expect(audited[0]).toMatchObject({ action: 'BOS_INVITE_INVITER_NOT_NOTIFIED' });
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('@');
  });

  it('C-3: no address of anyone reaches a log line', async () => {
    const deps = buildRedemptionDeps({ logger, correlationId: 'corr-1', request });
    await deps.notifyInviter(friendInput);
    const logged = JSON.stringify([logger.info.mock.calls, logger.warn.mock.calls, logger.error.mock.calls]);
    expect(logged).not.toContain('champion@example.org');
    expect(logged).not.toContain('friend@example.com');
  });

  it('the service-role reads are commented as an intentional RLS bypass (C-2)', () => {
    const source = readFileSync(join(process.cwd(), 'lib', 'business-os', 'invites', 'redemptionDeps.ts'), 'utf8');
    expect(source).toMatch(/INTENTIONAL SERVICE-ROLE READS \(RLS bypass\)/);
  });
});
