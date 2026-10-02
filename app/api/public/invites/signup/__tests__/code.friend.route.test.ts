/**
 * QA-1 (Slice 5b): the friend code route, end to end through the REAL
 * redemption flow and the REAL production wiring, with only the database, the
 * auth lookup and the mail transport faked.
 *
 * With a malformed `NEXT_PUBLIC_MARKETING_URL` (so the "you already have an
 * account" notice cannot carry a sign-in link), an address that HAS an account
 * and one that does not must get byte-identical HTTP answers: the champion
 * holds the link and must not learn which is which (F5b-3).
 */

import { hashInviteToken, generateInviteToken } from '@/lib/business-os/invites/inviteToken';
import { INVITE_ISSUANCE_POLICY } from '@/lib/business-os/entitlements/config/invites';
import type { BusinessOsInviteRedemptionView } from '@/lib/repositories/types';

const TOKEN = generateInviteToken();
const CHAMPION = '44444444-4444-4444-8444-444444444444';
const NOW = new Date('2026-10-01T12:00:00.000Z');

const world: { row: BusinessOsInviteRedemptionView | null; hasAccount: boolean; sent: Array<Record<string, unknown>> } = {
  row: null,
  hasAccount: false,
  sent: [],
};

jest.mock('server-only', () => ({}));
jest.mock('@/lib/auth', () => ({ getUser: async () => null }));
jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = {};
  for (const level of ['info', 'warn', 'error', 'debug']) logger[level] = () => undefined;
  logger.child = () => logger;
  return { createLogger: () => logger };
});
jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrailService: { getInstance: () => ({ log: async () => undefined, flush: async () => undefined }) },
}));
jest.mock('@/lib/notifications/emailTransport', () => ({
  sendEmail: async (params: Record<string, unknown>) => {
    world.sent.push(params);
    return { sent: true, provider: 'resend' };
  },
  // The platform sender is configured (prod): both system emails fail closed without it.
  platformSenderAddress: () => 'notifications@agentspilot.ai',
}));
jest.mock('@/lib/repositories/AuthAccountRepository', () => ({
  authAccountRepository: { emailHasAccount: async () => ({ data: world.hasAccount, error: null }) },
}));
jest.mock('@/lib/repositories/BusinessOsAccountPlanRepository', () => ({
  businessOsAccountPlanRepository: {
    findEntitlementInputs: async () => ({ data: { plan: { cohort: 'champion', cohort_expires_at: null }, overrides: [] }, error: null }),
  },
}));
jest.mock('@/lib/repositories/BusinessOsInviteRepository', () => ({
  businessOsInviteRepository: {
    findByTokenHashForRedemption: async (hash: string) => ({ data: hash === hashInviteToken(TOKEN) ? world.row : null, error: null }),
    issueSignupCode: async () => ({ data: true, error: null }),
    markOpenedByExistingAccount: async () => ({ data: true, error: null }),
  },
}));

import { NextRequest } from 'next/server';

import { POST } from '../code/route';

function friendRow(): BusinessOsInviteRedemptionView {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'friend@example.com',
    invite_type: INVITE_ISSUANCE_POLICY.account.inviteType,
    issuer_kind: 'account',
    issuer_account_id: CHAMPION,
    grant_kind: 'tier',
    grant_id: INVITE_ISSUANCE_POLICY.account.grantId,
    access_open_ended: null,
    access_months: null,
    language: 'en',
    link_expires_at: '2026-10-30T12:00:00.000Z',
    revoked_at: null,
    redeemed_at: null,
    signup_code_hash: null,
    signup_code_expires_at: null,
    signup_code_attempts: 0,
    signup_code_sent_count: 0,
    signup_code_window_started_at: null,
    signup_code_last_sent_at: null,
    claimed_at: null,
    claimed_account_id: null,
  };
}

async function ask(hasAccount: boolean): Promise<{ status: number; body: string; sent: Array<Record<string, unknown>> }> {
  world.row = friendRow();
  world.hasAccount = hasAccount;
  world.sent = [];
  const response = await POST(
    new NextRequest('http://localhost:3000/api/public/invites/signup/code', { method: 'POST', body: JSON.stringify({ token: TOKEN }) })
  );
  return { status: response.status, body: await response.text(), sent: world.sent };
}

const switchable = INVITE_ISSUANCE_POLICY as unknown as { accountInvitesAvailable: boolean };
const savedMarketing = process.env.NEXT_PUBLIC_MARKETING_URL;

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  switchable.accountInvitesAvailable = true;
  process.env.NEXT_PUBLIC_MARKETING_URL = 'javascript:alert(1)';
});

afterEach(() => {
  jest.useRealTimers();
  switchable.accountInvitesAvailable = false;
  if (savedMarketing === undefined) delete process.env.NEXT_PUBLIC_MARKETING_URL;
  else process.env.NEXT_PUBLIC_MARKETING_URL = savedMarketing;
});

describe('QA-1: the friend code route never tells an existing account from a new address', () => {
  it('with a malformed marketing URL, both answers are byte-identical 200s', async () => {
    const existing = await ask(true);
    const fresh = await ask(false);

    expect(existing.status).toBe(200);
    expect(existing.status).toBe(fresh.status);
    expect(existing.body).toBe(fresh.body);

    // The new address got its code; the existing account got the notice,
    // without a link (the URL was unusable) and without any code.
    expect(fresh.sent).toHaveLength(1);
    expect(existing.sent).toHaveLength(1);
    expect(String(existing.sent[0].subject)).toBe('You already have an AgentPilot account');
    expect(String(existing.sent[0].html)).not.toContain('javascript:');
  });
});
