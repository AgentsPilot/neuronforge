/**
 * N-2 to the ISSUING ADMIN (plan payments P-9.2, T10; requirement BQ-P11;
 * workplan BUSINESS_OS_PLAN_PAYMENTS_P9_WORKPLAN.md §6 T10; SA Q-10).
 *
 * The P-5b.1 notifier, with a payer whose lineage `source` is `admin_invite`:
 *   - the admin is found ONLY from the invite named by the payer's own lineage
 *     row (`issuer_admin_id`), never from anything else; the invite must be
 *     admin-issued and redeemed by THIS account, or it is `invite_mismatch`;
 *   - a champion's own first payment (an admin COHORT invite) owes nobody:
 *     no email, no audit, an info line;
 *   - N-1's active-admin check and the admin's LIVE auth email (via
 *     `findUserIdentity`) are reused unchanged; a former admin gets nothing;
 *   - the audit is N-2's shape (`business_os_invite`, `userId`/`actorId` null)
 *     with `recipientKind: 'admin'`; one clock; no address in logs or audits;
 *   - the friend path is unchanged when the lineage says `account_invite`.
 *
 * The existing P-5b.1 suite (`championSubscribedNotification.test.ts`) still
 * covers the champion; this file only adds the admin recipient.
 */

jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrailService: { getInstance: () => ({ log: async () => undefined, flush: async () => undefined }) },
  AuditTrail: { log: async () => undefined, flush: async () => undefined },
}));

import type { AuditLogInput } from '@/lib/audit/types';
import type { FirstPaymentNotifyInput } from '@/lib/business-os/billing/planPaymentApply';
import type { Logger } from '@/lib/logger';
import type { SendEmailParams, SendEmailResult } from '@/lib/notifications/emailTransport';
import type { BusinessOsInviteNotificationFacts } from '@/lib/repositories/types';

import { createFirstPaymentNotifier, type ChampionSubscribedNotifierDeps } from '../championSubscribedNotification';
import { INVITER_ACTION_PATHS, type InviterNotificationDeps } from '../inviterNotification';

const INVITE_ID = '11111111-1111-4111-8111-111111111111';
const PAYER_ID = '22222222-2222-4222-8222-222222222222';
const ADMIN_ID = '33333333-3333-4333-8333-333333333333';
const CHAMPION_ID = '44444444-4444-4444-8444-444444444444';
const OTHER_ID = '66666666-6666-4666-8666-666666666666';
const INVITEE = 'customer@example.com';
const ADMIN_EMAIL = 'admin@example.org';

const adminPaidInvite = (overrides: Partial<BusinessOsInviteNotificationFacts> = {}): BusinessOsInviteNotificationFacts => ({
  issuer_kind: 'admin',
  issuer_account_id: null,
  issuer_admin_id: ADMIN_ID,
  grant_kind: 'tier',
  email: INVITEE,
  redeemed_account_id: PAYER_ID,
  ...overrides,
});

interface Options {
  invite?: BusinessOsInviteNotificationFacts | null;
  activeAdmin?: boolean;
  profileLanguage?: string | null;
}

function harness(options: Options = {}) {
  const audits: AuditLogInput[] = [];
  const sent: SendEmailParams[] = [];
  const inviteReads: string[] = [];
  const identityLookups: string[] = [];
  const adminChecks: string[] = [];
  const logs: Array<{ level: string; ctx: Record<string, unknown>; message: string }> = [];
  const at = (level: string) => (ctx: Record<string, unknown>, message: string) => logs.push({ level, ctx, message });
  const log = { info: at('info'), warn: at('warn'), error: at('error'), debug: at('debug') } as unknown as Logger;

  const deps: ChampionSubscribedNotifierDeps = {
    invites: {
      findInviterNotificationFactsById: jest.fn(async (id: string) => {
        inviteReads.push(id);
        return { data: options.invite === undefined ? adminPaidInvite() : options.invite, error: null };
      }) as unknown as ChampionSubscribedNotifierDeps['invites']['findInviterNotificationFactsById'],
    },
    inviterDeps: ({ logger, audit }): InviterNotificationDeps => ({
      findUserIdentity: async (id) => {
        identityLookups.push(id);
        return { data: { email: id === ADMIN_ID ? ADMIN_EMAIL : id === CHAMPION_ID ? 'champion@example.org' : null }, error: null };
      },
      isActiveAdmin: async (id) => {
        adminChecks.push(id);
        return options.activeAdmin ?? true;
      },
      findProfileLanguage: async () => ({ data: options.profileLanguage === undefined ? 'en' : options.profileLanguage, error: null }),
      findPreferredLanguage: async () => ({ data: null, error: null }),
      senderAddress: () => 'notifications@agentspilot.ai',
      sendEmail: async (params: SendEmailParams): Promise<SendEmailResult> => {
        sent.push(params);
        return { sent: true, provider: 'resend', providerMessageId: 'msg_1' };
      },
      platformUrl: (path) => `https://app.example.test${path}`,
      audit,
      logger,
    }),
    writeAudit: jest.fn(async (entry: AuditLogInput) => {
      audits.push(entry);
    }),
  };

  const input = (overrides: Partial<FirstPaymentNotifyInput> = {}): FirstPaymentNotifyInput => ({
    accountId: PAYER_ID,
    inviteId: INVITE_ID,
    lineageSource: 'admin_invite',
    lineageRead: 'ok',
    remainingMs: 4_000,
    livemode: false,
    stripeEventId: 'evt_T10',
    log,
    ...overrides,
  });

  const logged = (event: string) => logs.filter((line) => line.ctx.event === event);
  return { notifier: createFirstPaymentNotifier(deps), input, audits, sent, inviteReads, identityLookups, adminChecks, logs, logged };
}

function expectNoAddress(h: ReturnType<typeof harness>) {
  expect(JSON.stringify({ logs: h.logs, audits: h.audits })).not.toContain('@');
}

describe('T10 happy path: an admin Paid invitee pays their first invoice', () => {
  it('sends ONE email to the issuing admin (live auth email, active-admin checked) and audits NOTIFIED in N-2\'s shape', async () => {
    const h = harness();
    await h.notifier.notifyChampion(h.input());

    expect(h.inviteReads).toEqual([INVITE_ID]);
    // The admin comes from the invite's issuer_admin_id, and only from there.
    expect(h.adminChecks).toEqual([ADMIN_ID]);
    expect(h.identityLookups).toEqual([ADMIN_ID]);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].to).toEqual([ADMIN_EMAIL]);
    // N-2's approved subject; the admin's heading is that subject too (no "friend").
    expect(h.sent[0].subject).toBe('Your invitation turned into a subscription');
    expect(h.sent[0].text).toContain(`${INVITEE} has subscribed.`);
    expect(h.sent[0].text).not.toContain('Your friend subscribed');
    expect(h.sent[0].text).toContain('Status: Subscribed');
    expect(h.sent[0].text).toContain(`https://app.example.test${INVITER_ACTION_PATHS.admin}`);
    expect(h.sent[0]).toMatchObject({ kind: 'transactional', redactRecipientInLogs: true, redactInLogs: [INVITEE] });
    expect(h.sent[0]).not.toHaveProperty('replyTo');

    expect(h.audits).toEqual([
      {
        action: 'BOS_INVITE_INVITER_NOTIFIED',
        entityType: 'business_os_invite',
        entityId: INVITE_ID,
        userId: null,
        actorId: null,
        details: {
          event: 'subscribed',
          recipientKind: 'admin',
          recipientAccountId: ADMIN_ID,
          status: 'subscribed',
          outcome: 'sent',
          language: 'en',
          reason: null,
          accountId: PAYER_ID,
          stripeEventId: 'evt_T10',
          livemode: false,
          lineageRead: 'ok',
        },
      },
    ]);
    expectNoAddress(h);
  });

  it.each([
    ['he', 'ההזמנה שלך הפכה למנוי', 'נרשם למנוי'],
    ['es', 'Tu invitación se convirtió en una suscripción', 'Suscrito'],
  ] as const)('in the admin\'s language (%s): the approved N-2 subject and the list\'s status word, no new copy', async (language, subject, status) => {
    const h = harness({ profileLanguage: language });
    await h.notifier.notifyChampion(h.input());
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].subject).toBe(subject);
    expect(String(h.sent[0].text).split('\n')[0]).toBe(subject);
    expect(h.sent[0].text).toContain(status);
    if (language === 'he') expect(h.sent[0].html).toContain('dir="rtl"');
  });
});

describe('T10: nobody is emailed when the admin is not owed it, or cannot be trusted', () => {
  it('a former admin (N-1\'s active-admin check): NOT_NOTIFIED recipient_not_admin, no email', async () => {
    const h = harness({ activeAdmin: false });
    await h.notifier.notifyChampion(h.input());
    expect(h.sent).toEqual([]);
    expect(h.audits).toHaveLength(1);
    expect(h.audits[0]).toMatchObject({ action: 'BOS_INVITE_INVITER_NOT_NOTIFIED', entityType: 'business_os_invite', userId: null, actorId: null });
    expect(h.audits[0].details).toMatchObject({ recipientKind: 'admin', recipientAccountId: ADMIN_ID, reason: 'recipient_not_admin', outcome: 'not_sent' });
  });

  it('a champion paying for themself (admin COHORT invite): no email, NO audit, an info line', async () => {
    const h = harness({ invite: adminPaidInvite({ grant_kind: 'cohort' }) });
    await h.notifier.notifyChampion(h.input());
    expect(h.sent).toEqual([]);
    expect(h.audits).toEqual([]);
    expect(h.adminChecks).toEqual([]);
    expect(h.logged('bos_invite_subscribed_not_applicable')).toEqual([
      expect.objectContaining({ level: 'info', ctx: expect.objectContaining({ source: 'admin_invite', grantKind: 'cohort', inviteId: INVITE_ID }) }),
    ]);
  });

  it.each([
    ['a friend invite behind an admin lineage', adminPaidInvite({ issuer_kind: 'account', issuer_account_id: CHAMPION_ID, issuer_admin_id: null }), 'not_an_admin_invite'],
    ['an admin invite with no issuing admin', adminPaidInvite({ issuer_admin_id: null }), 'no_issuing_admin'],
    ['an admin invite redeemed by another account', adminPaidInvite({ redeemed_account_id: OTHER_ID }), 'redeemed_by_another_account'],
    ['no invite row', null, 'invite_not_found'],
  ] as Array<[string, BusinessOsInviteNotificationFacts | null, string]>)('%s: invite_mismatch, alerted, nobody emailed', async (_name, invite, mismatch) => {
    const h = harness({ invite });
    await h.notifier.notifyChampion(h.input());
    expect(h.sent).toEqual([]);
    expect(h.identityLookups).toEqual([]);
    expect(h.logged('bos_invite_subscribed_invite_mismatch')).toEqual([
      expect.objectContaining({ level: 'error', ctx: expect.objectContaining({ mismatch, alert: true }) }),
    ]);
    expect(h.audits).toHaveLength(1);
    expect(h.audits[0]).toMatchObject({ action: 'BOS_INVITE_INVITER_NOT_NOTIFIED', entityType: 'business_os_invite', userId: null, actorId: null });
    expect(h.audits[0].details).toMatchObject({ recipientKind: 'admin', reason: 'invite_mismatch', status: 'subscribed' });
    expectNoAddress(h);
  });

  it('an admin lineage with no invite id: invite_mismatch (admin_lineage_without_invite), no read', async () => {
    const h = harness();
    await h.notifier.notifyChampion(h.input({ inviteId: null }));
    expect(h.inviteReads).toEqual([]);
    expect(h.sent).toEqual([]);
    expect(h.logged('bos_invite_subscribed_invite_mismatch')[0].ctx).toMatchObject({ mismatch: 'admin_lineage_without_invite' });
    expect(h.audits[0].details).toMatchObject({ recipientKind: 'admin', reason: 'invite_mismatch' });
  });

  it('one clock: nothing left after the lineage read → the invite read is not started, audited for the admin, no email', async () => {
    const h = harness();
    await h.notifier.notifyChampion(h.input({ remainingMs: 0 }));
    expect(h.sent).toEqual([]);
    expect(h.adminChecks).toEqual([]);
    expect(h.audits).toHaveLength(1);
    expect(h.audits[0].details).toMatchObject({ recipientKind: 'admin', reason: 'recipient_lookup_failed', inviteRead: 'timed_out', outcome: 'not_sent' });
  });
});

describe('the friend path is unchanged', () => {
  it('lineage account_invite + an admin invite row is still a mismatch (not_a_friend_invite): the lineage decides whom to look for', async () => {
    const h = harness();
    await h.notifier.notifyChampion(h.input({ lineageSource: 'account_invite' }));
    expect(h.sent).toEqual([]);
    expect(h.adminChecks).toEqual([]);
    expect(h.logged('bos_invite_subscribed_invite_mismatch')[0].ctx).toMatchObject({ mismatch: 'not_a_friend_invite' });
    expect(h.audits[0].details).toMatchObject({ recipientKind: 'champion', reason: 'invite_mismatch' });
  });
});
