/**
 * QA gap tests for the plan cancel / ended-now / kept emails (account deletion
 * lifecycle D4a / SX-3; workplan docs/workplans/BUSINESS_OS_D4_PLAN_CANCEL_EMAILS_WORKPLAN.md
 * §13). Pure: every port is a fake, no timers longer than 50 ms.
 *
 * What the Dev suites did not already pin:
 *   - the email day equals the drawer day in zones on BOTH sides of UTC near
 *     midnight, for all three events and all three languages, and an invalid
 *     stored zone falls back to UTC exactly as the drawer's `safeTimezone`;
 *   - ended_now with invoicesLeftOpen 0 / >0 / null in every language, through
 *     the composer (not just the template);
 *   - DR-6 for every event: a null date looks nothing up and sends nothing;
 *   - a hanging LOOKUP (not only a hanging send) is cut at the deadline;
 *   - a sender reader that throws counts as not configured;
 *   - no address, name or plan name in any log line or audit row, in he;
 *   - D6 safety: the engine never imports the email path, and only the two
 *     routes import the production wiring.
 */

import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

import { formatAccountDay } from '@/components/business-os/settings/planUpgradeCopy';
import type { PlanEndingView } from '@/lib/business-os/entitlements/planEndingView';
import { PLAN_CANCEL_EMAIL_COPY } from '@/lib/email/templates/plan-cancel';
import type { SendEmailParams, SendEmailResult } from '@/lib/notifications/emailTransport';
import { safeTimezone } from '@/lib/scheduling/businessTime';

import {
  sendPlanCancelEmail,
  type PlanCancelEmailAuditEntry,
  type PlanCancelEmailDeps,
  type PlanCancelEmailEvent,
  type PlanCancelEmailInput,
} from '../planCancelEmail';

const USER = '11111111-1111-4111-8111-111111111111';
const OWNER = 'qa.owner+secret@example.com';
const SENDER = 'notifications@agentspilot.ai';
const PLAN_NAME = 'Qa Secret Plan Name';
const LANGS = ['en', 'he', 'es'] as const;
const EVENTS: PlanCancelEmailEvent[] = ['cancelled', 'ended_now', 'kept'];

interface Harness {
  deps: PlanCancelEmailDeps;
  sent: SendEmailParams[];
  audits: PlanCancelEmailAuditEntry[];
  logs: Array<{ level: string; context: Record<string, unknown>; message: string }>;
  calls: string[];
}

function view(endsAt: string): PlanEndingView {
  return {
    kind: 'free_plan',
    endsAt,
    planName: PLAN_NAME,
    until: endsAt,
    credits: 1000,
    loses: [],
    thenReadOnlyDays: 7,
    thenPausedFrom: endsAt,
  };
}

function harness(opts: { zone?: string | null; language?: string; overrides?: Partial<PlanCancelEmailDeps> } = {}): Harness {
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
      return { data: opts.language ?? null, error: null };
    },
    findPreferredLanguage: async (id) => {
      h.calls.push(`preferredLanguage:${id}`);
      return { data: null, error: null };
    },
    findTimezone: async (id) => {
      h.calls.push(`timezone:${id}`);
      return { data: opts.zone === undefined ? 'UTC' : opts.zone, error: null };
    },
    readEndingView: async (userId, endsAt) => {
      h.calls.push(`view:${userId}`);
      return view(endsAt);
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
    ...opts.overrides,
  };
  return h;
}

function input(overrides: Partial<PlanCancelEmailInput> = {}): PlanCancelEmailInput {
  return {
    event: 'cancelled',
    userId: USER,
    date: '2026-12-01T05:30:00.000Z',
    subscriptionId: 'sub_own',
    livemode: false,
    correlationId: 'corr-qa',
    ...overrides,
  };
}

describe('QA: the email day is the drawer day, on both sides of UTC near midnight (DR-8)', () => {
  // 05:30 UTC on 1 Dec is still 30 Nov in Los Angeles; 10:30 UTC on 30 Nov is already 1 Dec on Kiritimati (UTC+14).
  const CASES = [
    { zone: 'America/Los_Angeles', iso: '2026-12-01T05:30:00.000Z' },
    { zone: 'Pacific/Kiritimati', iso: '2026-11-30T10:30:00.000Z' },
    { zone: 'Asia/Jerusalem', iso: '2026-11-30T22:30:00.000Z' },
  ];
  const matrix = CASES.flatMap((c) => EVENTS.flatMap((event) => LANGS.map((lang) => [c.zone, c.iso, event, lang] as const)));

  it.each(matrix)('%s %s %s %s', async (zone, iso, event, lang) => {
    const h = harness({ zone, language: lang });
    const outcome = await sendPlanCancelEmail(input({ event, date: iso, invoicesLeftOpen: 0 }), h.deps);
    expect(outcome).toEqual({ outcome: 'sent' });
    // The drawer: formatAccountDay(iso, language, LanguageContext.timezone = safeTimezone(user_preferences.timezone)).
    const drawerDay = formatAccountDay(iso, lang, safeTimezone(zone)) as string;
    const utcDay = formatAccountDay(iso, lang, 'UTC') as string;
    expect(drawerDay).not.toBe(utcDay); // the case really sits across midnight
    expect(h.sent[0].text).toContain(drawerDay);
    expect(h.sent[0].html).toContain(drawerDay);
    expect(h.sent[0].text).not.toContain(utcDay);
  });

  it.each(LANGS.flatMap((lang) => ['Not/AZone', 'garbage', '+99:00'].map((zone) => [lang, zone] as const)))(
    '%s: invalid stored zone %p → UTC, the same as the drawer, and still sent',
    async (lang, zone) => {
      const iso = '2026-12-01T05:30:00.000Z';
      const h = harness({ zone, language: lang });
      expect(await sendPlanCancelEmail(input({ date: iso }), h.deps)).toEqual({ outcome: 'sent' });
      expect(safeTimezone(zone)).toBe('UTC');
      expect(h.sent[0].text).toContain(formatAccountDay(iso, lang, 'UTC') as string);
    }
  );
});

describe('QA: ended_now and invoicesLeftOpen (DR-7, F-1), through the composer', () => {
  const CHARGED_AGAIN: Record<(typeof LANGS)[number], RegExp> = {
    en: /charged again/i,
    he: /תחויבו שוב/,
    es: /volverá a cobrar/,
  };

  it.each(LANGS.flatMap((lang) => ([0, 1, 3, null, undefined] as const).map((left) => [lang, left] as const)))(
    '%s, invoicesLeftOpen %p',
    async (lang, left) => {
      const h = harness({ language: lang });
      await sendPlanCancelEmail(input({ event: 'ended_now', invoicesLeftOpen: left }), h.deps);
      const { text, html, subject } = h.sent[0];
      const sentence = PLAN_CANCEL_EMAIL_COPY[lang].endedNow.invoicesCancelled;
      const mayBeOpen = PLAN_CANCEL_EMAIL_COPY[lang].endedNow.invoiceMayBeOpen;
      if (left === 0) {
        expect(text).toContain(sentence);
        expect(text).not.toContain(mayBeOpen);
        expect(text).toMatch(CHARGED_AGAIN[lang]);
      } else {
        expect(text).not.toContain(sentence);
        expect(text).toContain(mayBeOpen);
        expect(`${subject}\n${text}\n${html}`).not.toMatch(CHARGED_AGAIN[lang]);
      }
      expect(subject).toBe(PLAN_CANCEL_EMAIL_COPY[lang].endedNow.subject);
    }
  );

  it.each(LANGS)('%s: the cancelled email never carries the invoice sentence, even with invoicesLeftOpen 0', async (lang) => {
    const h = harness({ language: lang });
    await sendPlanCancelEmail(input({ event: 'cancelled', invoicesLeftOpen: 0 }), h.deps);
    expect(h.sent[0].text).not.toContain(PLAN_CANCEL_EMAIL_COPY[lang].endedNow.invoicesCancelled);
  });
});

describe('QA: DR-6 for every event', () => {
  it.each(EVENTS.flatMap((event) => [null, '', '   ', 'tomorrow'].map((date) => [event, date] as const)))(
    '%s with date %p → not sent, no_date, no address read',
    async (event, date) => {
      const h = harness();
      const outcome = await sendPlanCancelEmail(input({ event, date }), h.deps);
      expect(outcome).toEqual({ outcome: 'not_sent', reason: 'no_date' });
      expect(h.sent).toEqual([]);
      expect(h.audits).toHaveLength(1);
      expect(h.audits[0]).toMatchObject({ action: 'BOS_PLAN_CANCEL_EMAIL_NOT_SENT', details: { reason: 'no_date', email: event } });
    }
  );
});

describe('QA: fail closed and bounded', () => {
  it('a sender reader that throws → sender_not_configured, nothing looked up, alert', async () => {
    const h = harness({
      overrides: {
        senderAddress: () => {
          throw new Error('env exploded');
        },
      },
    });
    expect(await sendPlanCancelEmail(input(), h.deps)).toEqual({ outcome: 'not_sent', reason: 'sender_not_configured' });
    expect(h.calls).toEqual([]);
    expect(h.logs.find((line) => line.level === 'error')?.context).toMatchObject({ alert: true });
  });

  it.each([
    ['identity', 'findUserIdentity'],
    ['timezone', 'findTimezone'],
    ['view', 'readEndingView'],
  ] as const)('a hanging %s lookup is cut at the deadline → unknown, audited, never sent late', async (_label, port) => {
    const h = harness({
      overrides: { deadlineMs: 30, [port]: () => new Promise(() => undefined) } as Partial<PlanCancelEmailDeps>,
    });
    const started = Date.now();
    const outcome = await sendPlanCancelEmail(input(), h.deps);
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(outcome).toEqual({ outcome: 'unknown', reason: 'deadline_exceeded' });
    expect(h.audits).toEqual([expect.objectContaining({ action: 'BOS_PLAN_CANCEL_EMAIL_NOT_SENT', details: expect.objectContaining({ outcome: 'unknown' }) })]);
    expect(h.sent).toEqual([]);
  });

  it('the audit port rejecting does not reject the call', async () => {
    const h = harness({ overrides: { audit: () => Promise.reject(new Error('audit down')) } });
    await expect(sendPlanCancelEmail(input(), h.deps)).resolves.toEqual({ outcome: 'sent' });
  });

  it('the switch off reads nothing at all, not even the sender', async () => {
    const senderAddress = jest.fn(() => SENDER);
    const h = harness({ overrides: { isEnabled: () => false, senderAddress } });
    expect(await sendPlanCancelEmail(input(), h.deps)).toEqual({ outcome: 'skipped' });
    expect(senderAddress).not.toHaveBeenCalled();
    expect(h.calls).toEqual([]);
    expect(h.audits).toEqual([]);
    expect(h.logs).toEqual([]);
  });
});

describe('QA: no address, name or plan name in a log line or audit row', () => {
  it.each(EVENTS.flatMap((event) => LANGS.map((lang) => [event, lang] as const)))('%s / %s, sent and refused', async (event, lang) => {
    for (const sent of [true, false]) {
      const h = harness({
        language: lang,
        overrides: { sendEmail: async (params) => (h.sent.push(params), sent ? { sent: true, provider: 'resend' } : { sent: false, provider: 'none', error: `refused ${OWNER}` }) },
      });
      await sendPlanCancelEmail(input({ event, invoicesLeftOpen: 0 }), h.deps);
      // The email itself does carry the plan name (that is its job) …
      if (event !== 'kept') expect(h.sent[0].text).toContain(PLAN_NAME);
      // … but nothing that is logged or audited does.
      const recorded = JSON.stringify({ logs: h.logs, audits: h.audits });
      expect(recorded).not.toContain(OWNER);
      expect(recorded).not.toContain('example.com');
      expect(recorded).not.toContain(PLAN_NAME);
      expect(h.sent[0].subject).not.toContain('@');
      expect(h.sent[0].subject).not.toContain(PLAN_NAME);
      expect(h.sent[0].redactRecipientInLogs).toBe(true);
    }
  });
});

describe('QA: D6 safety — the engine never sends, and only the two routes wire the email', () => {
  const ROOT = process.cwd();
  const read = (file: string) => readFileSync(join(ROOT, file), 'utf8');

  it('planSubscriptionManage.ts imports no email path', () => {
    const engine = read('lib/business-os/billing/planSubscriptionManage.ts');
    expect(engine).not.toMatch(/planCancelEmail|emailTransport|sendEmail|lib\/email\//);
  });

  it('only the cancel and reactivate routes import the email path (the deps file aside; tests aside)', () => {
    const walk = (dir: string): string[] => {
      let names: string[];
      try {
        names = readdirSync(dir);
      } catch {
        return [];
      }
      return names.flatMap((name) => {
        if (name === 'node_modules' || name === '.next' || name === '__tests__') return [];
        const full = join(dir, name);
        if (statSync(full).isDirectory()) return walk(full);
        return /\.(ts|tsx)$/.test(name) ? [full] : [];
      });
    };
    const importers = ['app', 'lib', 'components']
      .flatMap((dir) => walk(join(ROOT, dir)))
      // Import / require statements only: comments may name the files.
      .filter((file) => /(?:from|import|require\()\s*\(?['"][^'"]*planCancelEmail(?:Deps)?['"]/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(ROOT, file).split(sep).join('/'))
      .sort();
    expect(importers).toEqual([
      'app/api/business-os/billing/plan/cancel/route.ts',
      'app/api/business-os/billing/plan/reactivate/route.ts',
      'lib/business-os/billing/planCancelEmailDeps.ts',
    ]);
  });
});
