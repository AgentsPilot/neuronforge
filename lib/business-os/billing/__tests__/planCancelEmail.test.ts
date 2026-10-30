/**
 * The plan-cancel email composer (account deletion lifecycle D4a / SX-3;
 * workplan §3.2, §8 row 3; SA S-7, S-8, S-9, S-11, DR-6, DR-7, DR-8, DR-11).
 *
 * Pure: every dependency is a fake. Proves the switch, the fail-closed sender,
 * the no-date rule, the recipient and language sources, the timezone rule
 * (the email's day is the drawer's day), the view handling, the deadline,
 * that it never throws, and that no address reaches a log or an audit row.
 */

import { formatAccountDay } from '@/components/business-os/settings/planUpgradeCopy';
import type { PlanEndingView } from '@/lib/business-os/entitlements/planEndingView';
import type { SendEmailParams, SendEmailResult } from '@/lib/notifications/emailTransport';
import { safeTimezone } from '@/lib/scheduling/businessTime';

import {
  PLAN_CANCEL_EMAIL_ACTION_PATH,
  PLAN_CANCEL_EMAIL_POLICY,
  afterFromView,
  sendPlanCancelEmail,
  type PlanCancelEmailAuditEntry,
  type PlanCancelEmailDeps,
  type PlanCancelEmailInput,
} from '../planCancelEmail';

const USER = '11111111-1111-4111-8111-111111111111';
const OWNER = 'owner@example.com';
const SENDER = 'notifications@agentspilot.ai';
// 23:30 UTC on 30 Nov is already 1 Dec in Jerusalem: the zone decides the day.
const ENDS = '2026-11-30T23:30:00.000Z';

const FREE_VIEW: PlanEndingView = {
  kind: 'free_plan',
  endsAt: ENDS,
  planName: 'Test Flight',
  until: '2026-12-14T23:30:00.000Z',
  credits: 1000,
  loses: [],
  thenReadOnlyDays: 7,
  thenPausedFrom: '2026-12-21T23:30:00.000Z',
};

interface Harness {
  deps: PlanCancelEmailDeps;
  sent: SendEmailParams[];
  audits: PlanCancelEmailAuditEntry[];
  logs: Array<{ level: string; context: Record<string, unknown>; message: string }>;
  calls: string[];
}

function harness(overrides: Partial<PlanCancelEmailDeps> = {}): Harness {
  const h: Harness = { sent: [], audits: [], logs: [], calls: [], deps: undefined as unknown as PlanCancelEmailDeps };
  const log = (level: string) => (context: Record<string, unknown>, message: string) => {
    h.logs.push({ level, context, message });
  };
  h.deps = {
    isEnabled: () => true,
    findUserIdentity: async (id) => {
      h.calls.push(`identity:${id}`);
      return { data: { email: OWNER }, error: null };
    },
    findProfileLanguage: async (id) => {
      h.calls.push(`profileLanguage:${id}`);
      return { data: null, error: null };
    },
    findPreferredLanguage: async (id) => {
      h.calls.push(`preferredLanguage:${id}`);
      return { data: null, error: null };
    },
    findTimezone: async (id) => {
      h.calls.push(`timezone:${id}`);
      return { data: 'Asia/Jerusalem', error: null };
    },
    readEndingView: async (userId, endsAt, locale) => {
      h.calls.push(`view:${userId}:${endsAt}:${locale}`);
      return FREE_VIEW;
    },
    senderAddress: () => SENDER,
    sendEmail: async (params): Promise<SendEmailResult> => {
      h.sent.push(params);
      return { sent: true, provider: 'resend' };
    },
    platformUrl: (path) => `https://app.example.test${path}`,
    audit: async (entry) => {
      h.audits.push(entry);
    },
    logger: { info: log('info'), warn: log('warn'), error: log('error') },
    ...overrides,
  };
  return h;
}

function input(overrides: Partial<PlanCancelEmailInput> = {}): PlanCancelEmailInput {
  return {
    event: 'cancelled',
    userId: USER,
    date: ENDS,
    subscriptionId: 'sub_own',
    livemode: false,
    correlationId: 'corr-1',
    ...overrides,
  };
}

describe('the switch (S-15)', () => {
  it('off → skipped: nothing looked up, composed, sent, logged or audited', async () => {
    const h = harness({ isEnabled: () => false });
    expect(await sendPlanCancelEmail(input(), h.deps)).toEqual({ outcome: 'skipped' });
    expect(h.calls).toEqual([]);
    expect(h.sent).toEqual([]);
    expect(h.audits).toEqual([]);
    expect(h.logs).toEqual([]);
  });

  it('a switch reader that throws counts as off', async () => {
    const h = harness({
      isEnabled: () => {
        throw new Error('boom');
      },
    });
    expect(await sendPlanCancelEmail(input(), h.deps)).toEqual({ outcome: 'skipped' });
    expect(h.sent).toEqual([]);
  });
});

describe('happy path', () => {
  it('cancelled: one transactional send to the live address, redacted in logs, audited SENT', async () => {
    const h = harness();
    expect(await sendPlanCancelEmail(input(), h.deps)).toEqual({ outcome: 'sent' });
    expect(h.sent).toHaveLength(1);
    const [params] = h.sent;
    expect(params).toMatchObject({ kind: 'transactional', to: [OWNER], redactRecipientInLogs: true });
    // No sender, reply-to or owner id: the transport's platform sender is used.
    expect(params).not.toHaveProperty('from');
    expect(params).not.toHaveProperty('replyTo');
    expect(params).not.toHaveProperty('ownerUserId');
    expect(params.html).toContain(`https://app.example.test${PLAN_CANCEL_EMAIL_ACTION_PATH}`);
    expect(params.text).toContain(SENDER);
    expect(h.audits).toEqual([
      {
        action: 'BOS_PLAN_CANCEL_EMAIL_SENT',
        details: {
          email: 'cancelled',
          outcome: 'sent',
          reason: null,
          provider: 'resend',
          language: 'en',
          languageSource: 'default',
          subscriptionId: 'sub_own',
          periodEnd: ENDS,
          livemode: false,
          actor: 'owner',
          correlationId: 'corr-1',
        },
      },
    ]);
    // Every read is the session user's.
    expect(h.calls.every((call) => call.includes(USER))).toBe(true);
  });

  it('kept: no view read; "renews on"', async () => {
    const h = harness();
    await sendPlanCancelEmail(input({ event: 'kept' }), h.deps);
    expect(h.calls.some((call) => call.startsWith('view:'))).toBe(false);
    expect(h.sent[0].subject).toBe('Your plan continues');
    expect(h.sent[0].text).toContain('renews on');
  });

  it('ended_now: the invoice sentence only when invoicesLeftOpen === 0 (DR-7)', async () => {
    const sentence = 'Any unpaid invoice for it was cancelled, and you will not be charged again.';
    for (const [left, shown] of [
      [0, true],
      [1, false],
      [null, false],
      [undefined, false],
    ] as const) {
      const h = harness();
      await sendPlanCancelEmail(input({ event: 'ended_now', invoicesLeftOpen: left }), h.deps);
      expect({ left, shown: h.sent[0].text?.includes(sentence) }).toEqual({ left, shown });
    }
  });
});

describe('fails closed', () => {
  it('sender not configured → not sent, audited NOT_SENT, an error with alert: true (S-9)', async () => {
    const h = harness({ senderAddress: () => undefined });
    expect(await sendPlanCancelEmail(input(), h.deps)).toEqual({ outcome: 'not_sent', reason: 'sender_not_configured' });
    expect(h.calls).toEqual([]);
    expect(h.sent).toEqual([]);
    expect(h.audits).toHaveLength(1);
    expect(h.audits[0]).toMatchObject({ action: 'BOS_PLAN_CANCEL_EMAIL_NOT_SENT', details: { outcome: 'not_sent', reason: 'sender_not_configured' } });
    const errors = h.logs.filter((line) => line.level === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].context).toMatchObject({ alert: true, reason: 'sender_not_configured' });
  });

  it.each([null, ''])('DR-6: date %p → not sent, reason no_date, nothing looked up', async (date) => {
    const h = harness();
    expect(await sendPlanCancelEmail(input({ date }), h.deps)).toEqual({ outcome: 'not_sent', reason: 'no_date' });
    expect(h.sent).toEqual([]);
    expect(h.calls).toEqual([]);
    expect(h.audits[0]).toMatchObject({ action: 'BOS_PLAN_CANCEL_EMAIL_NOT_SENT', details: { reason: 'no_date' } });
  });

  it('DR-6: an unparsable date → no_date, never an empty date', async () => {
    const h = harness();
    expect(await sendPlanCancelEmail(input({ date: 'not-a-date' }), h.deps)).toEqual({ outcome: 'not_sent', reason: 'no_date' });
    expect(h.sent).toEqual([]);
  });

  it('no such account / no email → recipient_not_found', async () => {
    for (const data of [null, { email: null }, { email: '  ' }]) {
      const h = harness({ findUserIdentity: async () => ({ data, error: null }) });
      expect(await sendPlanCancelEmail(input(), h.deps)).toEqual({ outcome: 'not_sent', reason: 'recipient_not_found' });
      expect(h.sent).toEqual([]);
    }
  });

  it('identity lookup failed or threw → recipient_lookup_failed', async () => {
    const failed = harness({ findUserIdentity: async () => ({ data: null, error: new Error('down') }) });
    expect(await sendPlanCancelEmail(input(), failed.deps)).toEqual({ outcome: 'not_sent', reason: 'recipient_lookup_failed' });
    const threw = harness({
      findUserIdentity: async () => {
        throw new Error('boom');
      },
    });
    expect(await sendPlanCancelEmail(input(), threw.deps)).toEqual({ outcome: 'not_sent', reason: 'recipient_lookup_failed' });
  });

  it('the transport refused → transport_failed, provider recorded', async () => {
    const h = harness({ sendEmail: async () => ({ sent: false, provider: 'none', error: 'nope' }) });
    expect(await sendPlanCancelEmail(input(), h.deps)).toEqual({ outcome: 'not_sent', reason: 'transport_failed' });
    expect(h.audits[0].details).toMatchObject({ reason: 'transport_failed', provider: 'none' });
  });

  it('never throws: the transport, the logger and the audit port all throw', async () => {
    const h = harness({
      sendEmail: async () => {
        throw new Error('smtp exploded');
      },
      audit: async () => {
        throw new Error('audit down');
      },
      logger: {
        info: () => {
          throw new Error('log');
        },
        warn: () => {
          throw new Error('log');
        },
        error: () => {
          throw new Error('log');
        },
      },
    });
    await expect(sendPlanCancelEmail(input(), h.deps)).resolves.toEqual({ outcome: 'not_sent', reason: 'transport_failed' });
  });

  it('S-11: the deadline → unknown, audited NOT_SENT, resolves without waiting for the send', async () => {
    const h = harness({
      deadlineMs: 20,
      sendEmail: () => new Promise<SendEmailResult>(() => undefined),
    });
    const started = Date.now();
    expect(await sendPlanCancelEmail(input(), h.deps)).toEqual({ outcome: 'unknown', reason: 'deadline_exceeded' });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(h.audits[0]).toMatchObject({ action: 'BOS_PLAN_CANCEL_EMAIL_NOT_SENT', details: { outcome: 'unknown', reason: 'deadline_exceeded' } });
  });

  it('the deadline is 4 s, as the inviter email', () => {
    expect(PLAN_CANCEL_EMAIL_POLICY.deadlineMs).toBe(4_000);
  });
});

describe('S-7: language and timezone sources', () => {
  it('the business profile language wins over the preference', async () => {
    const h = harness({
      findProfileLanguage: async () => ({ data: 'he', error: null }),
      findPreferredLanguage: async () => ({ data: 'es', error: null }),
    });
    await sendPlanCancelEmail(input(), h.deps);
    expect(h.sent[0].subject).toBe('התוכנית שלכם בוטלה');
    expect(h.sent[0].html).toContain('dir="rtl"');
    expect(h.audits[0].details).toMatchObject({ language: 'he', languageSource: 'business_profiles' });
  });

  it('the preference when the profile has none; a failed read counts as absent', async () => {
    const h = harness({
      findProfileLanguage: async () => ({ data: null, error: new Error('down') }),
      findPreferredLanguage: async () => ({ data: 'es', error: null }),
    });
    await sendPlanCancelEmail(input(), h.deps);
    expect(h.sent[0].subject).toBe('Tu plan está cancelado');
    expect(h.audits[0].details).toMatchObject({ language: 'es', languageSource: 'user_preferences' });
  });

  it.each([
    ['null (not asked)', { data: null, error: null }],
    ['unreadable', { data: null, error: new Error('down') }],
    ['invalid', { data: 'Mars/Olympus_Mons', error: null }],
  ])('timezone %s → UTC, never a throw (DR-8)', async (_label, zone) => {
    const h = harness({ findTimezone: async () => zone, readEndingView: async () => null });
    expect(await sendPlanCancelEmail(input(), h.deps)).toEqual({ outcome: 'sent' });
    expect(h.sent[0].text).toContain(formatAccountDay(ENDS, 'en', 'UTC') as string);
    expect(h.sent[0].text).toContain('November 30, 2026');
  });

  it.each(['en', 'he', 'es'] as const)('DR-8: the email day string equals the drawer day string (%s, Asia/Jerusalem)', async (language) => {
    const h = harness({ findProfileLanguage: async () => ({ data: language, error: null }) });
    await sendPlanCancelEmail(input(), h.deps);
    // The drawer: formatAccountDay(iso, language, LanguageContext.timezone = safeTimezone(user_preferences.timezone)).
    const drawerDay = formatAccountDay(ENDS, language, safeTimezone('Asia/Jerusalem')) as string;
    expect(drawerDay).toMatch(/1/); // 1 December on the account's clock, not 30 November (UTC).
    expect(h.sent[0].text).toContain(drawerDay);
    expect(h.sent[0].text).toContain(formatAccountDay(FREE_VIEW.until, language, 'Asia/Jerusalem') as string);
  });
});

describe('the view (C-9, DR-11)', () => {
  it('passes the engine date and the resolved language to the view', async () => {
    const h = harness({ findPreferredLanguage: async () => ({ data: 'he', error: null }) });
    await sendPlanCancelEmail(input(), h.deps);
    expect(h.calls).toContain(`view:${USER}:${ENDS}:he`);
  });

  it.each([
    ['null', async () => null],
    ['unknown', async (): Promise<PlanEndingView> => ({ kind: 'unknown', endsAt: ENDS })],
    [
      'a throw',
      async (): Promise<PlanEndingView> => {
        throw new Error('resolver down');
      },
    ],
  ])('a %s view → sent without the "after that" paragraph', async (_label, readEndingView) => {
    const h = harness({ readEndingView });
    expect(await sendPlanCancelEmail(input(), h.deps)).toEqual({ outcome: 'sent' });
    expect(h.sent[0].text).not.toContain('Test Flight');
    expect(h.sent[0].text).toContain('you will not be charged again');
  });

  it('afterFromView: null fields stay null; numbers in the reader format', () => {
    expect(afterFromView(FREE_VIEW, 'en', 'UTC')).toEqual({
      kind: 'free_plan',
      date: 'November 30, 2026',
      plan: 'Test Flight',
      until: 'December 14, 2026',
      credits: '1,000',
      readOnlyDays: '7',
    });
    expect(afterFromView({ ...FREE_VIEW, credits: null, thenReadOnlyDays: null, thenPausedFrom: null }, 'en', 'UTC')).toMatchObject({
      credits: null,
      readOnlyDays: null,
    });
    expect(afterFromView({ kind: 'back_to_plan', endsAt: ENDS, planName: 'Founding Partner', until: null, loses: [] }, 'en', 'UTC')).toEqual({
      kind: 'back_to_plan',
      date: 'November 30, 2026',
      plan: 'Founding Partner',
      until: null,
    });
    // A stored end that will not format drops the paragraph; it is never shown as open-ended.
    expect(afterFromView({ kind: 'back_to_plan', endsAt: ENDS, planName: 'X', until: 'garbage', loses: [] }, 'en', 'UTC')).toBeNull();
    expect(afterFromView({ kind: 'unknown', endsAt: ENDS }, 'en', 'UTC')).toBeNull();
  });
});

describe('no address in a log or an audit row', () => {
  it.each([
    ['sent', {}],
    ['transport failed', { sendEmail: async (): Promise<SendEmailResult> => ({ sent: false, provider: 'resend', error: `rejected ${OWNER}` }) }],
    ['sender missing', { senderAddress: () => undefined }],
  ] as const)('%s', async (_label, overrides) => {
    const h = harness(overrides as Partial<PlanCancelEmailDeps>);
    await sendPlanCancelEmail(input(), h.deps);
    const written = JSON.stringify({ logs: h.logs, audits: h.audits });
    expect(written).not.toContain(OWNER);
    expect(written).not.toContain(SENDER);
    expect(written).not.toContain('Test Flight');
  });
});
