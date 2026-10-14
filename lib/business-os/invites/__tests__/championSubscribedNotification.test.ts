/**
 * N-2: "{email} has subscribed", to the champion (plan payments P-5b.1;
 * workplan BUSINESS_OS_PLAN_PAYMENTS_P5B_WORKPLAN.md §3.2, §7 "Champion
 * notifier"; SA S5-4, S5-5 c/d, Q-1, Q-5, C-2, C-6, C-7, C-8).
 *
 * What matters:
 *   - the champion is found only through our records, and the invite must be
 *     a friend invite redeemed by THIS account (else `invite_mismatch`, alerted);
 *   - every outcome is audited once, in N-1's shape, and every N-2 entry has
 *     `userId: null`, `actorId: null`, entity `business_os_invite` (C-2);
 *   - an unread lineage is "not notified", may-have-been-owed, no email (C-6);
 *   - one clock: the invite read and the send share `remainingMs`;
 *   - no address of anyone in a log line or an audit entry;
 *   - never throws.
 */

jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrailService: { getInstance: () => ({ log: async () => undefined, flush: async () => undefined }) },
  AuditTrail: { log: async () => undefined, flush: async () => undefined },
}));

import { readFileSync } from 'fs';
import { join } from 'path';

import type { AuditLogInput } from '@/lib/audit/types';
import type { FirstPaymentNotifyInput } from '@/lib/business-os/billing/planPaymentApply';
import type { Logger } from '@/lib/logger';
import type { SendEmailParams, SendEmailResult } from '@/lib/notifications/emailTransport';
import type { BusinessOsInviteNotificationFacts } from '@/lib/repositories/types';

import { createFirstPaymentNotifier, type ChampionSubscribedNotifierDeps } from '../championSubscribedNotification';
import type { InviterNotificationDeps } from '../inviterNotification';

const INVITE_ID = '11111111-1111-4111-8111-111111111111';
const FRIEND_ID = '22222222-2222-4222-8222-222222222222';
const CHAMPION_ID = '44444444-4444-4444-8444-444444444444';
const OTHER_ID = '66666666-6666-4666-8666-666666666666';
const INVITEE = 'friend@example.com';
const CHAMPION_EMAIL = 'champion@example.org';

const friendInvite = (overrides: Partial<BusinessOsInviteNotificationFacts> = {}): BusinessOsInviteNotificationFacts => ({
  issuer_kind: 'account',
  issuer_account_id: CHAMPION_ID,
  email: INVITEE,
  redeemed_account_id: FRIEND_ID,
  ...overrides,
});

interface Options {
  /** `slow`: the friend invite, answered after 1 s (SA code review F-2). */
  invite?: BusinessOsInviteNotificationFacts | null | 'error' | 'throw' | 'hang' | 'slow';
  send?: 'ok' | 'fail' | 'hang' | 'throw';
  sender?: string | undefined;
  profileLanguage?: string | null;
  inviterDepsThrow?: boolean;
}

function harness(options: Options = {}) {
  const audits: AuditLogInput[] = [];
  const sent: SendEmailParams[] = [];
  const inviteReads: string[] = [];
  const logs: Array<{ level: string; ctx: Record<string, unknown>; message: string }> = [];
  const at = (level: string) => (ctx: Record<string, unknown>, message: string) => logs.push({ level, ctx, message });
  const log = { info: at('info'), warn: at('warn'), error: at('error'), debug: at('debug') } as unknown as Logger;

  const deps: ChampionSubscribedNotifierDeps = {
    invites: {
      findInviterNotificationFactsById: jest.fn(async (id: string) => {
        inviteReads.push(id);
        const invite = options.invite === undefined ? friendInvite() : options.invite;
        if (invite === 'throw') throw new Error(`db exploded near ${INVITEE}`);
        if (invite === 'hang') return new Promise(() => undefined);
        if (invite === 'slow') {
          await new Promise((resolve) => setTimeout(resolve, 1_000));
          return { data: friendInvite(), error: null };
        }
        if (invite === 'error') return { data: null, error: new Error(`db failed near ${INVITEE}`) };
        return { data: invite, error: null };
      }) as unknown as ChampionSubscribedNotifierDeps['invites']['findInviterNotificationFactsById'],
    },
    inviterDeps: ({ logger, audit }): InviterNotificationDeps => {
      if (options.inviterDepsThrow) throw new Error('wiring exploded');
      return {
        findUserIdentity: async (id) => ({ data: { email: id === CHAMPION_ID ? CHAMPION_EMAIL : null }, error: null }),
        isActiveAdmin: async () => false,
        findProfileLanguage: async () => ({ data: options.profileLanguage === undefined ? 'he' : options.profileLanguage, error: null }),
        findPreferredLanguage: async () => ({ data: null, error: null }),
        senderAddress: () => ('sender' in options ? options.sender : 'notifications@agentspilot.ai'),
        sendEmail: async (params: SendEmailParams): Promise<SendEmailResult> => {
          sent.push(params);
          switch (options.send ?? 'ok') {
            case 'fail':
              return { sent: false, provider: 'none', error: `rejected ${CHAMPION_EMAIL}` };
            case 'hang':
              return new Promise<SendEmailResult>(() => undefined);
            case 'throw':
              throw new Error(`transport exploded for ${INVITEE}`);
            default:
              return { sent: true, provider: 'resend', providerMessageId: 'msg_1' };
          }
        },
        platformUrl: (path) => `https://app.example.test${path}`,
        audit,
        logger,
      };
    },
    writeAudit: jest.fn(async (entry: AuditLogInput) => {
      audits.push(entry);
    }),
  };

  const input = (overrides: Partial<FirstPaymentNotifyInput> = {}): FirstPaymentNotifyInput => ({
    accountId: FRIEND_ID,
    inviteId: INVITE_ID,
    lineageRead: 'ok',
    remainingMs: 4_000,
    livemode: false,
    stripeEventId: 'evt_N2',
    log,
    ...overrides,
  });

  const logged = (event: string) => logs.filter((line) => line.ctx.event === event);
  return { deps, notifier: createFirstPaymentNotifier(deps), input, audits, sent, inviteReads, logs, logged };
}

/** C-2: the only shape an N-2 entry may take. */
function expectN2Shape(entry: AuditLogInput) {
  expect(entry).toMatchObject({ entityType: 'business_os_invite', userId: null, actorId: null });
  expect(entry.details).toMatchObject({ event: 'subscribed', recipientKind: 'champion', status: 'subscribed', accountId: FRIEND_ID, stripeEventId: 'evt_N2', livemode: false });
}

/** No address of anyone in a log line or an audit entry. */
function expectNoAddress(h: ReturnType<typeof harness>) {
  const text = JSON.stringify({ logs: h.logs, audits: h.audits });
  expect(text).not.toContain('@');
}

describe('the happy path: a friend invite redeemed by this account', () => {
  it('sends ONE email to the champion, in their language, with the list word, and audits NOTIFIED in N-1\'s shape', async () => {
    const h = harness();
    await h.notifier.notifyChampion(h.input());

    expect(h.inviteReads).toEqual([INVITE_ID]);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].to).toEqual([CHAMPION_EMAIL]);
    expect(h.sent[0].subject).toBe('ההזמנה שלך הפכה למנוי');
    expect(h.sent[0].subject).not.toContain('@');
    expect(h.sent[0].text).toContain(INVITEE);
    expect(h.sent[0].text).toContain('נרשם למנוי');
    // S5-5 d: platform sender, no Reply-To, both addresses redacted from transport logs.
    expect(h.sent[0]).toMatchObject({ kind: 'transactional', redactRecipientInLogs: true, redactInLogs: [INVITEE] });
    expect(h.sent[0]).not.toHaveProperty('replyTo');
    expect(h.sent[0]).not.toHaveProperty('from');

    expect(h.audits).toEqual([
      {
        action: 'BOS_INVITE_INVITER_NOTIFIED',
        entityType: 'business_os_invite',
        entityId: INVITE_ID,
        userId: null,
        actorId: null,
        details: {
          event: 'subscribed',
          recipientKind: 'champion',
          recipientAccountId: CHAMPION_ID,
          status: 'subscribed',
          outcome: 'sent',
          language: 'he',
          reason: null,
          accountId: FRIEND_ID,
          stripeEventId: 'evt_N2',
          livemode: false,
          lineageRead: 'ok',
        },
      },
    ]);
    expectNoAddress(h);
  });

  it('exposes N-1\'s 4 s clock as its deadline', () => {
    expect(harness().notifier.deadlineMs).toBe(4_000);
  });
});

describe('C-6: no invite id → not notified, no email, no invite read', () => {
  it.each(['failed', 'timed_out', 'no_row', 'no_port'] as const)('lineage %s: "may have been owed", recipient_lookup_failed, entity id null', async (lineageRead) => {
    const h = harness();
    await h.notifier.notifyChampion(h.input({ inviteId: null, lineageRead }));
    expect(h.inviteReads).toEqual([]);
    expect(h.sent).toEqual([]);
    expect(h.audits).toHaveLength(1);
    expectN2Shape(h.audits[0]);
    expect(h.audits[0]).toMatchObject({ action: 'BOS_INVITE_INVITER_NOT_NOTIFIED', entityId: null });
    expect(h.audits[0].details).toMatchObject({ reason: 'recipient_lookup_failed', outcome: 'not_sent', lineageRead, recipientAccountId: null });
    expect(h.logged('bos_invite_subscribed_source_unknown')).toEqual([
      expect.objectContaining({ level: 'warn', message: expect.stringContaining('may have been owed') }),
    ]);
  });

  it('a lineage row read fine but naming no invite is a mismatch, alerted', async () => {
    const h = harness();
    await h.notifier.notifyChampion(h.input({ inviteId: null, lineageRead: 'ok' }));
    expect(h.sent).toEqual([]);
    expect(h.audits[0].details).toMatchObject({ reason: 'invite_mismatch' });
    expect(h.logged('bos_invite_subscribed_invite_mismatch')).toEqual([expect.objectContaining({ level: 'error', ctx: expect.objectContaining({ alert: true }) })]);
  });
});

describe('the invite read', () => {
  it.each([
    ['returns an error', 'error' as const, 'failed'],
    ['throws', 'throw' as const, 'failed'],
  ])('%s → not notified recipient_lookup_failed, no email, no address logged', async (_name, invite, inviteRead) => {
    const h = harness({ invite });
    await h.notifier.notifyChampion(h.input());
    expect(h.sent).toEqual([]);
    expect(h.audits).toHaveLength(1);
    expectN2Shape(h.audits[0]);
    expect(h.audits[0]).toMatchObject({ action: 'BOS_INVITE_INVITER_NOT_NOTIFIED', entityId: INVITE_ID });
    expect(h.audits[0].details).toMatchObject({ reason: 'recipient_lookup_failed', inviteRead });
    expectNoAddress(h);
  });

  it('hangs → bounded by remainingMs, not notified, no email', async () => {
    jest.useFakeTimers();
    try {
      const h = harness({ invite: 'hang' });
      const running = h.notifier.notifyChampion(h.input({ remainingMs: 1_500 }));
      await jest.advanceTimersByTimeAsync(1_500);
      await running;
      expect(h.sent).toEqual([]);
      expect(h.audits[0].details).toMatchObject({ reason: 'recipient_lookup_failed', inviteRead: 'timed_out' });
    } finally {
      jest.useRealTimers();
    }
  });

  it('no time left at all → nothing is read or sent; not notified', async () => {
    const h = harness();
    await h.notifier.notifyChampion(h.input({ remainingMs: 0 }));
    expect(h.inviteReads).toEqual([]);
    expect(h.sent).toEqual([]);
    expect(h.audits[0].details).toMatchObject({ reason: 'recipient_lookup_failed', inviteRead: 'timed_out' });
  });
});

describe('Q-5: the lineage and the invite must agree (tenant-isolation-guard step 2)', () => {
  it.each([
    ['an admin invite', friendInvite({ issuer_kind: 'admin', issuer_account_id: null }), 'not_a_friend_invite'],
    ['no issuing account', friendInvite({ issuer_account_id: null }), 'no_issuing_account'],
    ['redeemed by another account', friendInvite({ redeemed_account_id: OTHER_ID }), 'redeemed_by_another_account'],
    ['not redeemed at all', friendInvite({ redeemed_account_id: null }), 'redeemed_by_another_account'],
    ['no such invite', null, 'invite_not_found'],
  ])('%s → invite_mismatch, alerted with ids only, nobody emailed', async (_name, invite, mismatch) => {
    const h = harness({ invite });
    await h.notifier.notifyChampion(h.input());
    expect(h.sent).toEqual([]);
    expect(h.audits).toHaveLength(1);
    expectN2Shape(h.audits[0]);
    expect(h.audits[0]).toMatchObject({ action: 'BOS_INVITE_INVITER_NOT_NOTIFIED', entityId: INVITE_ID });
    expect(h.audits[0].details).toMatchObject({ reason: 'invite_mismatch', outcome: 'not_sent' });
    expect(h.logged('bos_invite_subscribed_invite_mismatch')).toEqual([
      expect.objectContaining({ level: 'error', ctx: expect.objectContaining({ alert: true, mismatch, inviteId: INVITE_ID, accountId: FRIEND_ID }) }),
    ]);
    expectNoAddress(h);
  });
});

describe('the send (N-1\'s, reused)', () => {
  it('fails → not notified transport_failed, audited once', async () => {
    const h = harness({ send: 'fail' });
    await h.notifier.notifyChampion(h.input());
    expect(h.audits).toHaveLength(1);
    expectN2Shape(h.audits[0]);
    expect(h.audits[0].details).toMatchObject({ reason: 'transport_failed', recipientAccountId: CHAMPION_ID });
    expectNoAddress(h);
  });

  it('no platform sender → not notified sender_not_configured, nothing sent', async () => {
    const h = harness({ sender: undefined });
    await h.notifier.notifyChampion(h.input());
    expect(h.sent).toEqual([]);
    expect(h.audits[0].details).toMatchObject({ reason: 'sender_not_configured' });
  });

  it('hangs → resolves at what is LEFT of the clock (one clock, O-4), audited unknown deadline_exceeded', async () => {
    jest.useFakeTimers();
    try {
      const h = harness({ send: 'hang' });
      let done = false;
      const running = h.notifier.notifyChampion(h.input({ remainingMs: 2_500 })).then(() => {
        done = true;
      });
      await jest.advanceTimersByTimeAsync(2_499);
      expect(done).toBe(false);
      await jest.advanceTimersByTimeAsync(1);
      await running;
      expect(done).toBe(true);
      expect(h.audits[0]).toMatchObject({ action: 'BOS_INVITE_INVITER_NOT_NOTIFIED' });
      expect(h.audits[0].details).toMatchObject({ outcome: 'unknown', reason: 'deadline_exceeded' });
    } finally {
      jest.useRealTimers();
    }
  });

  // SA code review F-2 (2026-10-14): the invite read's time is charged to the
  // same clock, so N-1 gets only what is left AFTER it, not `remainingMs` again.
  it('a 1 s invite read then a hung send → resolves at remainingMs in total, not remainingMs + the read (one clock, O-4)', async () => {
    jest.useFakeTimers();
    try {
      const h = harness({ invite: 'slow', send: 'hang' });
      let done = false;
      const running = h.notifier.notifyChampion(h.input({ remainingMs: 2_500 })).then(() => {
        done = true;
      });
      await jest.advanceTimersByTimeAsync(2_499);
      expect(h.sent).toHaveLength(1);
      expect(done).toBe(false);
      await jest.advanceTimersByTimeAsync(1);
      await running;
      expect(done).toBe(true);
      expect(h.audits).toHaveLength(1);
      expect(h.audits[0].details).toMatchObject({ outcome: 'unknown', reason: 'deadline_exceeded' });
    } finally {
      jest.useRealTimers();
    }
  });

  // QA P-5b.1 Edge Case 1: step 4. An invite read that leaves the clock spent
  // must stop before `notifyInviter` starts, else a send could still be
  // dispatched in the background after the delivery has returned.
  it('the invite read spends the whole clock → step 4 starts nothing: not notified deadline_exceeded / not_sent, no lookup, no send', async () => {
    let now = 1_000_000;
    const clock = jest.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      const h = harness();
      let wired = false;
      const realInviterDeps = h.deps.inviterDeps;
      h.deps.inviterDeps = (context) => {
        wired = true;
        return realInviterDeps(context);
      };
      (h.deps.invites.findInviterNotificationFactsById as jest.Mock).mockImplementationOnce(async (id: string) => {
        h.inviteReads.push(id);
        now += 2_500; // exactly remainingMs: nothing left once the read returns
        return { data: friendInvite(), error: null };
      });
      const notifier = createFirstPaymentNotifier(h.deps);
      await notifier.notifyChampion(h.input({ remainingMs: 2_500 }));

      expect(h.inviteReads).toEqual([INVITE_ID]);
      expect(wired).toBe(false);
      expect(h.sent).toEqual([]);
      expect(h.audits).toHaveLength(1);
      expectN2Shape(h.audits[0]);
      expect(h.audits[0]).toMatchObject({ action: 'BOS_INVITE_INVITER_NOT_NOTIFIED', entityId: INVITE_ID });
      expect(h.audits[0].details).toMatchObject({
        reason: 'deadline_exceeded',
        outcome: 'not_sent',
        recipientAccountId: CHAMPION_ID,
        language: null,
      });
      expectNoAddress(h);
    } finally {
      clock.mockRestore();
    }
  });

  it('a wiring that throws → never rejects; audited not notified transport_failed', async () => {
    const h = harness({ inviterDepsThrow: true });
    await expect(h.notifier.notifyChampion(h.input())).resolves.toBeUndefined();
    expect(h.audits).toHaveLength(1);
    expect(h.audits[0].details).toMatchObject({ reason: 'transport_failed' });
    expect(h.logged('bos_invite_subscribed_failed')).toEqual([expect.objectContaining({ ctx: expect.objectContaining({ errName: 'Error' }) })]);
  });

  it('an audit writer that rejects is swallowed', async () => {
    const h = harness();
    (h.deps.writeAudit as jest.Mock).mockRejectedValueOnce(new Error('audit down'));
    await expect(h.notifier.notifyChampion(h.input())).resolves.toBeUndefined();
  });
});

describe('C-2: every N-2 entry, on every path, has no owner and is never on the lineage entity', () => {
  const paths: Array<[string, Options, Partial<FirstPaymentNotifyInput>]> = [
    ['sent', {}, {}],
    ['lineage unread', {}, { inviteId: null, lineageRead: 'failed' }],
    ['invite read failed', { invite: 'error' }, {}],
    ['mismatch', { invite: friendInvite({ redeemed_account_id: OTHER_ID }) }, {}],
    ['send failed', { send: 'fail' }, {}],
    ['sender missing', { sender: undefined }, {}],
  ];
  it.each(paths)('%s', async (_name, options, overrides) => {
    const h = harness(options);
    await h.notifier.notifyChampion(h.input(overrides));
    expect(h.audits).toHaveLength(1);
    for (const entry of h.audits) {
      expectN2Shape(entry);
      expect(entry.entityType).not.toBe('business_os_account_lineage');
      expect(entry.userId).toBeNull();
      expect(entry.actorId).toBeNull();
    }
    expectNoAddress(h);
  });
});

describe('source guards', () => {
  const read = (file: string) => readFileSync(join(process.cwd(), file), 'utf8');
  const N2_FILES = ['lib/business-os/invites/championSubscribedNotification.ts', 'lib/business-os/invites/inviterNotificationDeps.ts'];
  const imports = (text: string) => [...text.matchAll(/from\s+['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1] ?? m[2]);

  it.each(N2_FILES)('%s imports nothing from the entitlements module (C-8)', (file) => {
    expect(imports(read(file)).filter((specifier) => /business-os\/entitlements/.test(specifier))).toEqual([]);
  });

  it.each(N2_FILES)('%s never names the lineage entity (C-2)', (file) => {
    expect(read(file)).not.toMatch(/business_os_account_lineage/);
  });

  it('the notifier writes on the invite entity with no owner, in one place', () => {
    const text = read('lib/business-os/invites/championSubscribedNotification.ts');
    expect(text.match(/entityType: '/g)).toHaveLength(1);
    expect(text).toContain("entityType: 'business_os_invite',");
    expect(text).toMatch(/userId: null,\s+actorId: null,/);
  });
});
