/**
 * N-1: the inviter's "your invitation was accepted" email (workplan §5 tests 4
 * to 9; SA Q-3, Q-4, Q-5, C-1, C-2, C-3).
 *
 * Who is told (the champion, or only the issuing admin while still an admin),
 * fail closed on the sender, the send parameters, privacy (no address of
 * anyone in a log or an audit entry; nothing from the invitee's account in
 * the email), the recipient's language, and the 4 s deadline.
 */

import type { SendEmailParams, SendEmailResult } from '@/lib/notifications/emailTransport';

import { INVITER_NOTIFICATION_POLICY } from '../inviteEmailPolicy';
import {
  INVITER_ACTION_PATHS,
  notifyInviter,
  type InviterNotificationAuditEntry,
  type InviterNotificationDeps,
  type NotifyInviterInput,
} from '../inviterNotification';

const INVITE_ID = '11111111-1111-4111-8111-111111111111';
const CHAMPION_ID = '44444444-4444-4444-8444-444444444444';
const ADMIN_ID = '55555555-5555-4555-8555-555555555555';
const INVITEE = 'friend@example.com';
const CHAMPION_EMAIL = 'champion@example.org';
const ADMIN_EMAIL = 'issuing.admin@agentspilot.ai';
// Things the deps "know" that must never reach the email (N3): if the module
// ever read them in, they would show up in the output.
const INVITEE_ACCOUNT_ID = '33333333-3333-4333-8333-333333333333';
const GOOGLE_NAME = 'Dana Googleuser';
const INVITER_NAME = 'Founding Fran';
const PLAN_PRICE = '$29';

const friendInput: NotifyInviterInput = {
  event: 'accepted',
  inviteId: INVITE_ID,
  issuerKind: 'account',
  issuerAccountId: CHAMPION_ID,
  issuerAdminId: null,
  inviteeEmail: INVITEE,
  landing: 'awaiting_payment',
};

const adminInput: NotifyInviterInput = {
  event: 'accepted',
  inviteId: INVITE_ID,
  issuerKind: 'admin',
  issuerAccountId: null,
  issuerAdminId: ADMIN_ID,
  inviteeEmail: INVITEE,
  landing: 'onboarding',
};

interface Options {
  sender?: string | undefined;
  identity?: { email: string | null } | null | 'error' | 'throw';
  isAdmin?: boolean | 'throw';
  profileLanguage?: string | null | 'error';
  preferredLanguage?: string | null | 'error';
  send?: 'ok' | 'fail' | 'throw' | 'hang';
  deadlineMs?: number;
}

function harness(options: Options = {}) {
  const sent: SendEmailParams[] = [];
  const audits: InviterNotificationAuditEntry[] = [];
  const logs: Array<{ level: string; context: Record<string, unknown>; message: string }> = [];
  const lookedUp: string[] = [];
  const adminChecks: string[] = [];

  const result = <T,>(value: T | 'error') =>
    value === 'error' ? { data: null, error: new Error(`db failed near ${CHAMPION_EMAIL}`) } : { data: value, error: null };

  const deps: InviterNotificationDeps = {
    findUserIdentity: jest.fn(async (id: string) => {
      lookedUp.push(id);
      const identity = options.identity;
      if (identity === 'throw') throw new Error('identity threw');
      if (identity !== undefined) return result(identity);
      const email = id === ADMIN_ID ? ADMIN_EMAIL : id === CHAMPION_ID ? CHAMPION_EMAIL : null;
      // Extra fields a real identity carries; none may reach the email.
      return { data: { id, email, createdAt: '2026-01-01T00:00:00Z', name: INVITER_NAME } as { email: string | null }, error: null };
    }),
    isActiveAdmin: jest.fn(async (id: string) => {
      adminChecks.push(id);
      if (options.isAdmin === 'throw') throw new Error('admin check threw');
      return options.isAdmin ?? true;
    }),
    findProfileLanguage: jest.fn(async () => result(options.profileLanguage === undefined ? null : options.profileLanguage)),
    findPreferredLanguage: jest.fn(async () => result(options.preferredLanguage === undefined ? null : options.preferredLanguage)),
    senderAddress: () => ('sender' in options ? options.sender : 'notifications@agentspilot.ai'),
    sendEmail: jest.fn(async (params: SendEmailParams): Promise<SendEmailResult> => {
      sent.push(params);
      switch (options.send ?? 'ok') {
        case 'fail':
          return { sent: false, provider: 'none', error: `rejected ${CHAMPION_EMAIL}` };
        case 'throw':
          throw new Error(`transport exploded for ${INVITEE}`);
        case 'hang':
          return new Promise<SendEmailResult>(() => undefined);
        default:
          return { sent: true, provider: 'resend', providerMessageId: 'msg_1' };
      }
    }),
    platformUrl: (path: string) => `https://app.example.test${path}`,
    audit: jest.fn(async (entry: InviterNotificationAuditEntry) => {
      audits.push(entry);
    }),
    logger: {
      info: (context, message) => logs.push({ level: 'info', context, message }),
      warn: (context, message) => logs.push({ level: 'warn', context, message }),
    },
    ...(options.deadlineMs !== undefined ? { deadlineMs: options.deadlineMs } : {}),
  };
  return { deps, sent, audits, logs, lookedUp, adminChecks };
}

/** C-3: no address of anyone in a log context, a log message or an audit entry. */
function expectNoAddressInLogsOrAudit(h: ReturnType<typeof harness>) {
  const text = JSON.stringify({ logs: h.logs, audits: h.audits });
  expect(text).not.toContain('@');
  expect(text).not.toContain(INVITEE);
  expect(text).not.toContain(CHAMPION_EMAIL);
  expect(text).not.toContain(ADMIN_EMAIL);
}

describe('who is told (test 4; N4, SA Q-3)', () => {
  it("a friend invite: the champion's live auth email", async () => {
    const h = harness();
    expect(await notifyInviter(friendInput, h.deps)).toEqual({ outcome: 'sent', recipientKind: 'champion' });
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].to).toEqual([CHAMPION_EMAIL]);
    expect(h.lookedUp).toEqual([CHAMPION_ID]);
    expect(h.adminChecks).toEqual([]);
  });

  it('an admin invite: ONLY the issuing admin (no other admin is looked up or emailed)', async () => {
    const h = harness();
    expect(await notifyInviter(adminInput, h.deps)).toEqual({ outcome: 'sent', recipientKind: 'admin' });
    expect(h.sent[0].to).toEqual([ADMIN_EMAIL]);
    expect(h.lookedUp).toEqual([ADMIN_ID]);
    expect(h.adminChecks).toEqual([ADMIN_ID]);
  });

  it.each([
    ['no longer an admin', { isAdmin: false }],
    ['an admin check that throws (fails closed)', { isAdmin: 'throw' as const }],
  ])('an issuing admin %s: not sent, recipient_not_admin, audited', async (_label, options) => {
    const h = harness(options);
    expect(await notifyInviter(adminInput, h.deps)).toEqual({ outcome: 'not_sent', recipientKind: 'admin', reason: 'recipient_not_admin' });
    expect(h.sent).toEqual([]);
    expect(h.audits).toEqual([
      expect.objectContaining({ action: 'BOS_INVITE_INVITER_NOT_NOTIFIED', details: expect.objectContaining({ reason: 'recipient_not_admin' }) }),
    ]);
  });

  it.each([
    ['a definite "no such account"', { identity: null }, 'recipient_not_found'],
    ['an account with no email', { identity: { email: null } }, 'recipient_not_found'],
    ['a failed lookup', { identity: 'error' as const }, 'recipient_lookup_failed'],
    ['a lookup that throws', { identity: 'throw' as const }, 'recipient_lookup_failed'],
  ])('%s: not sent, audited with the reason', async (_label, options, reason) => {
    const h = harness(options as Options);
    expect(await notifyInviter(friendInput, h.deps)).toMatchObject({ outcome: 'not_sent', reason });
    expect(h.sent).toEqual([]);
    expect(h.audits[0]).toMatchObject({ action: 'BOS_INVITE_INVITER_NOT_NOTIFIED', details: { reason } });
    expectNoAddressInLogsOrAudit(h);
  });

  it.each([
    ['a friend invite with no champion id', { ...friendInput, issuerAccountId: null }],
    ['an admin invite with no admin id', { ...adminInput, issuerAdminId: null }],
    // C-2: an admin invite never falls back to the other id, and vice versa.
    ['an admin invite carrying only an account id', { ...adminInput, issuerAdminId: null, issuerAccountId: CHAMPION_ID }],
  ])('%s: nothing looked up, not sent (no_issuer)', async (_label, input) => {
    const h = harness();
    expect(await notifyInviter(input, h.deps)).toMatchObject({ outcome: 'not_sent', reason: 'no_issuer' });
    expect(h.lookedUp).toEqual([]);
    expect(h.sent).toEqual([]);
  });
});

describe('fails closed on the sender (test 5)', () => {
  it('no platform sender: nothing looked up, composed or sent; one warning with no address; audited', async () => {
    const h = harness({ sender: undefined });
    expect(await notifyInviter(friendInput, h.deps)).toEqual({ outcome: 'not_sent', recipientKind: 'champion', reason: 'sender_not_configured' });
    expect(h.deps.sendEmail).not.toHaveBeenCalled();
    expect(h.deps.findUserIdentity).not.toHaveBeenCalled();
    expect(h.logs.filter((log) => log.level === 'warn')).toHaveLength(1);
    expect(h.audits[0]).toMatchObject({ action: 'BOS_INVITE_INVITER_NOT_NOTIFIED', details: { reason: 'sender_not_configured' } });
    expectNoAddressInLogsOrAudit(h);
  });
});

describe('the send (test 6; FR-15 does not apply, SA C-3)', () => {
  it('transactional, no from, no replyTo, no ownerUserId, both addresses redacted, no @ in the subject', async () => {
    const h = harness();
    await notifyInviter(friendInput, h.deps);
    const params = h.sent[0] as SendEmailParams & Record<string, unknown>;
    expect(params.kind).toBe('transactional');
    expect(params).not.toHaveProperty('from');
    expect(params).not.toHaveProperty('replyTo');
    expect(params).not.toHaveProperty('ownerUserId');
    expect(params.redactRecipientInLogs).toBe(true);
    expect(params.redactInLogs).toEqual([INVITEE]);
    expect(params.subject).not.toContain('@');
    expect(params.subject).toBe('Your invitation was accepted');
  });

  it.each([
    ['refused by every transport', { send: 'fail' as const }],
    ['a transport that throws', { send: 'throw' as const }],
  ])('%s: not_sent, transport_failed, never throws', async (_label, options) => {
    const h = harness(options);
    await expect(notifyInviter(friendInput, h.deps)).resolves.toMatchObject({ outcome: 'not_sent', reason: 'transport_failed' });
    expectNoAddressInLogsOrAudit(h);
  });

  it('buttons: the champion to their invite list, the admin to the admin invites page', async () => {
    const champion = harness();
    await notifyInviter(friendInput, champion.deps);
    expect(champion.sent[0].html).toContain(`https://app.example.test${INVITER_ACTION_PATHS.champion}`);
    const admin = harness();
    await notifyInviter(adminInput, admin.deps);
    expect(admin.sent[0].html).toContain(`https://app.example.test${INVITER_ACTION_PATHS.admin}`);
  });
});

describe('privacy (test 7; N3, SA C-3)', () => {
  it.each([
    ['friend', friendInput],
    ['admin', adminInput],
  ])('%s: the email carries the typed address and the status, nothing from either account', async (_label, input) => {
    const h = harness();
    await notifyInviter(input, h.deps);
    const { html, text } = h.sent[0];
    expect(html).toContain(INVITEE);
    expect(text).toContain(INVITEE);
    for (const leak of [INVITEE_ACCOUNT_ID, GOOGLE_NAME, INVITER_NAME, PLAN_PRICE, CHAMPION_ID, ADMIN_ID]) {
      expect(html).not.toContain(leak);
      expect(text ?? '').not.toContain(leak);
    }
  });

  it.each([
    ['sent', {}],
    ['not sent', { send: 'fail' as const }],
    ['no recipient', { identity: null }],
  ])('%s: no address of anyone (invitee OR inviter) in any log context or audit entry', async (_label, options) => {
    const h = harness(options as Options);
    await notifyInviter(friendInput, h.deps);
    await notifyInviter(adminInput, h.deps);
    expect(h.logs.length).toBeGreaterThan(0);
    expectNoAddressInLogsOrAudit(h);
  });

  it('the audit entry: ids, status, language and outcome; the recipient account id in details (SA Q-4)', async () => {
    const h = harness({ profileLanguage: 'he' });
    await notifyInviter(friendInput, h.deps);
    expect(h.audits).toEqual([
      {
        action: 'BOS_INVITE_INVITER_NOTIFIED',
        inviteId: INVITE_ID,
        details: {
          event: 'accepted',
          recipientKind: 'champion',
          recipientAccountId: CHAMPION_ID,
          status: 'not_subscribed_yet',
          outcome: 'sent',
          language: 'he',
          reason: null,
        },
      },
    ]);
  });
});

describe('status (SA Q-5): from the landing, worded with the FR-31 list label', () => {
  it('a held friend reads "Signed up — not subscribed yet"', async () => {
    const h = harness();
    await notifyInviter(friendInput, h.deps);
    expect(h.sent[0].text).toContain('Signed up — not subscribed yet');
    expect(h.sent[0].text).not.toContain('payment pending');
  });

  it('an admin invitee (onboarding) reads "Joined"', async () => {
    const h = harness();
    await notifyInviter(adminInput, h.deps);
    expect(h.sent[0].text).toContain('Status: Joined');
  });
});

describe('language (test 8; N7)', () => {
  it.each([
    ['profile he beats preference en', { profileLanguage: 'he', preferredLanguage: 'en' }, 'he', 'business_profiles'],
    ['preference es when there is no profile language', { profileLanguage: null, preferredLanguage: 'es' }, 'es', 'user_preferences'],
    ['both missing → en', {}, 'en', 'default'],
    ['both failing → en (a failed read counts as absent)', { profileLanguage: 'error' as const, preferredLanguage: 'error' as const }, 'en', 'default'],
    ['a failed profile read falls through to the preference', { profileLanguage: 'error' as const, preferredLanguage: 'he' }, 'he', 'user_preferences'],
  ])('%s', async (_label, options, language, source) => {
    const h = harness(options as Options);
    expect(await notifyInviter(friendInput, h.deps)).toMatchObject({ outcome: 'sent' });
    expect(h.audits[0].details.language).toBe(language);
    expect(h.logs.find((log) => log.context.outcome === 'sent')?.context.languageSource).toBe(source);
    if (language === 'he') expect(h.sent[0].html).toContain('dir="rtl"');
  });
});

describe('the deadline (test 9; SA C-1)', () => {
  afterEach(() => jest.useRealTimers());

  it('is 4 s', () => {
    expect(INVITER_NOTIFICATION_POLICY.deadlineMs).toBe(4_000);
  });

  it('leaves the signup routes (maxDuration 60 s) a wide margin', () => {
    expect(INVITER_NOTIFICATION_POLICY.deadlineMs * 10).toBeLessThanOrEqual(60_000);
  });

  it('a hanging send resolves at the deadline as unknown, never throws, and is audited', async () => {
    jest.useFakeTimers();
    const h = harness({ send: 'hang' });
    let settled: unknown;
    const pending = notifyInviter(friendInput, h.deps).then((outcome) => {
      settled = outcome;
    });
    await jest.advanceTimersByTimeAsync(INVITER_NOTIFICATION_POLICY.deadlineMs - 1);
    expect(settled).toBeUndefined();
    await jest.advanceTimersByTimeAsync(1);
    await pending;
    expect(settled).toEqual({ outcome: 'unknown', recipientKind: 'champion', reason: 'deadline_exceeded' });
    expect(h.audits[0]).toMatchObject({ action: 'BOS_INVITE_INVITER_NOT_NOTIFIED', details: { outcome: 'unknown', reason: 'deadline_exceeded' } });
    expectNoAddressInLogsOrAudit(h);
  });

  it('a hanging lookup is covered by the same deadline', async () => {
    jest.useFakeTimers();
    const h = harness();
    (h.deps.findUserIdentity as jest.Mock).mockImplementation(() => new Promise(() => undefined));
    const pending = notifyInviter(adminInput, h.deps);
    await jest.advanceTimersByTimeAsync(INVITER_NOTIFICATION_POLICY.deadlineMs);
    await expect(pending).resolves.toMatchObject({ outcome: 'unknown' });
    expect(h.sent).toEqual([]);
  });

  it('C-1: the independent lookups run together (all started before any resolves)', async () => {
    const h = harness();
    const started: string[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const gated = <T,>(name: string, value: T) => async () => {
      started.push(name);
      await gate;
      return value;
    };
    (h.deps.isActiveAdmin as jest.Mock).mockImplementation(gated('admin', true));
    (h.deps.findUserIdentity as jest.Mock).mockImplementation(gated('identity', { data: { email: ADMIN_EMAIL }, error: null }));
    (h.deps.findProfileLanguage as jest.Mock).mockImplementation(gated('profile', { data: null, error: null }));
    (h.deps.findPreferredLanguage as jest.Mock).mockImplementation(gated('preference', { data: null, error: null }));
    const pending = notifyInviter(adminInput, h.deps);
    await new Promise((resolve) => setImmediate(resolve));
    expect(started.sort()).toEqual(['admin', 'identity', 'preference', 'profile']);
    release();
    await expect(pending).resolves.toMatchObject({ outcome: 'sent' });
  });
});

describe('never throws, whatever a dependency does', () => {
  it('a throwing audit and a throwing logger still resolve', async () => {
    const h = harness();
    (h.deps.audit as jest.Mock).mockImplementation(() => {
      throw new Error('audit exploded');
    });
    h.deps.logger.info = () => {
      throw new Error('logger exploded');
    };
    await expect(notifyInviter(friendInput, h.deps)).resolves.toMatchObject({ outcome: 'sent' });
  });

  it('a throwing sender lookup counts as not configured', async () => {
    const h = harness();
    h.deps.senderAddress = () => {
      throw new Error('env exploded');
    };
    await expect(notifyInviter(friendInput, h.deps)).resolves.toMatchObject({ outcome: 'not_sent', reason: 'sender_not_configured' });
  });
});
