import 'server-only';

/**
 * Email the owner that their plan was cancelled, ended now, or kept (account
 * deletion lifecycle D4a / SX-3; workplan
 * docs/workplans/BUSINESS_OS_D4_PLAN_CANCEL_EMAILS_WORKPLAN.md §3.2, §3.3, §3.6;
 * SA S-6, S-7, S-8, S-9, S-11, DR-6, DR-7, DR-8, DR-10, DR-11; user U-2).
 *
 * Pure orchestration over ports, in the shape of `inviterNotification.ts`.
 * The production wiring is `planCancelEmailDeps.ts`.
 *
 * ── Who calls it (S-6) ──────────────────────────────────────────────────────
 * The cancel and reactivate ROUTES only, after their own audit flush, and only
 * on a real change (`cancelled` → `cancelled` / `ended_now`, `reactivated` →
 * `kept`). Never the engine (`managePlanSubscription`): D6's deletion request
 * calls the same engine and must not send these. Never the webhook mirror or a
 * dashboard change.
 *
 * ── Never throws, never changes the response (S-11) ─────────────────────────
 * Every dependency call is guarded, and the run (lookups, view, template,
 * send) sits under ONE deadline (4 s, as the inviter email). It is awaited by
 * the route, because an un-awaited promise can be frozen with the instance;
 * a late send is left to finish and its result is ignored (`unknown`).
 *
 * ── The switch (S-15) ───────────────────────────────────────────────────────
 * Off: returns `skipped` before anything is looked up, composed, sent, logged
 * or audited. On without a platform sender: `sender_not_configured`, audited,
 * and logged `error` with `alert: true`, because an operator must act (S-9).
 *
 * ── Sources (SA-9 as ruled in S-7) ──────────────────────────────────────────
 *   recipient  the account's LIVE auth email, `findUserIdentity(userId)`; the
 *              id is the session user's, never a request value
 *   language   `resolveUserLanguage` (business profile, then preference), the
 *              server email standard. The my-plan route behind the drawer reads
 *              the preference only, so in a rare mismatch the email and the
 *              drawer use different words. They never show a different day:
 *   timezone   `safeTimezone(user_preferences.timezone)`, else UTC, exactly as
 *              the drawer does (DR-8), and the day is formatted with the
 *              drawer's own `formatAccountDay` (S-8)
 *
 * ── What it says (C-9) ──────────────────────────────────────────────────────
 * No date (`endsOn` / `renewsOn` null) → nothing is sent, reason `no_date`
 * (DR-6). The "after that" paragraph comes from `planEndingView` only; an
 * unknown or unreadable view drops it, and a null field drops its clause
 * (DR-11). The unpaid-invoice sentence only when `invoicesLeftOpen === 0`
 * (DR-7); otherwise (left open, or could not tell) the "may still be unpaid"
 * sentence.
 *
 * ── Logs and audit ──────────────────────────────────────────────────────────
 * Ids, the email kind, the outcome, a reason class, language and its source,
 * the provider. Never an address, a name or a plan name. The transport gets
 * `redactRecipientInLogs: true`. Audit: the SENT / NOT_SENT pair (S-9), both
 * `info` in the registry, written through the caller's `audit` port.
 *
 * ── Entitlements ────────────────────────────────────────────────────────────
 * Imports the `PlanEndingView` TYPE only (a declared non-gate importer, S-16).
 */

import { formatAccountDay, localeFor } from '@/components/business-os/settings/planUpgradeCopy';
import type { PlanEndingView } from '@/lib/business-os/entitlements/planEndingView';
import { resolveUserLanguage, type LanguageSource, type SupportedLanguage } from '@/lib/business-os/userLanguage';
import { generatePlanCancelEmail, type PlanCancelAfter, type PlanCancelEmailEvent } from '@/lib/email/templates/plan-cancel';
import type { SendEmailParams, SendEmailResult } from '@/lib/notifications/emailTransport';
import type { AgentRepositoryResult as RepositoryResult } from '@/lib/repositories/types';
import { safeTimezone } from '@/lib/scheduling/businessTime';

export type { PlanCancelEmailEvent };

/** One deadline for the whole email (S-11). A test pins it. */
export const PLAN_CANCEL_EMAIL_POLICY = {
  deadlineMs: 4_000,
} as const;

/** Where the button goes: Settings → Plan (the same path the plan banner uses). */
export const PLAN_CANCEL_EMAIL_ACTION_PATH = '/business-os/settings?section=plan';

/** Why the email was not sent. A reason class only: never an address. */
export const PLAN_CANCEL_EMAIL_NOT_SENT_REASONS = {
  /** `RESEND_FROM_EMAIL` unset or unparseable while the switch is on. */
  senderNotConfigured: 'sender_not_configured',
  /** The engine returned no date, or it could not be formatted (DR-6). */
  noDate: 'no_date',
  /** The account no longer exists, or has no email. */
  recipientNotFound: 'recipient_not_found',
  /** The recipient lookup failed: no email is guessed. */
  recipientLookupFailed: 'recipient_lookup_failed',
  /** Every configured transport refused or failed, or the send threw. */
  transportFailed: 'transport_failed',
  /** The whole email did not finish within the deadline; a send may still land. */
  deadlineExceeded: 'deadline_exceeded',
} as const;
export type PlanCancelEmailNotSentReason =
  (typeof PLAN_CANCEL_EMAIL_NOT_SENT_REASONS)[keyof typeof PLAN_CANCEL_EMAIL_NOT_SENT_REASONS];

export const PLAN_CANCEL_EMAIL_AUDIT_ACTIONS = {
  sent: 'BOS_PLAN_CANCEL_EMAIL_SENT',
  notSent: 'BOS_PLAN_CANCEL_EMAIL_NOT_SENT',
} as const;

export interface PlanCancelEmailInput {
  event: PlanCancelEmailEvent;
  /** The session user. Never a request value. */
  userId: string;
  /** `endsOn` (cancelled / ended_now) or `renewsOn` (kept), as the engine returned it. */
  date: string | null;
  /** ended_now only: the engine's `invoicesLeftOpen` (`null` = could not tell). */
  invoicesLeftOpen?: number | null;
  subscriptionId: string | null;
  livemode: boolean | null;
  correlationId: string;
}

export interface PlanCancelEmailAuditEntry {
  action: (typeof PLAN_CANCEL_EMAIL_AUDIT_ACTIONS)[keyof typeof PLAN_CANCEL_EMAIL_AUDIT_ACTIONS];
  details: Record<string, string | number | boolean | null>;
}

export interface PlanCancelEmailLogger {
  info: (context: Record<string, unknown>, message: string) => void;
  warn: (context: Record<string, unknown>, message: string) => void;
  error: (context: Record<string, unknown>, message: string) => void;
}

export interface PlanCancelEmailDeps {
  /** `isPlanCancelEmailsEnabled` in production. */
  isEnabled: () => boolean;
  /** `findUserIdentity`: `{ data: null }` only on a definite "no such user". */
  findUserIdentity: (id: string) => Promise<RepositoryResult<{ email: string | null } | null>>;
  /** `business_profiles.language`, raw. */
  findProfileLanguage: (id: string) => Promise<RepositoryResult<string | null>>;
  /** `user_preferences.preferred_language`. */
  findPreferredLanguage: (id: string) => Promise<RepositoryResult<string | null>>;
  /** `user_preferences.timezone`, raw (`null` = not asked). */
  findTimezone: (id: string) => Promise<RepositoryResult<string | null>>;
  /** `readPlanEndingView` through the account seam. `null` = unreadable. */
  readEndingView: (userId: string, endsAt: string, locale: SupportedLanguage) => Promise<PlanEndingView | null>;
  /** `platformSenderAddress`: `undefined` when not configured. */
  senderAddress: () => string | undefined;
  sendEmail: (params: SendEmailParams) => Promise<SendEmailResult>;
  /** Builds the button's absolute URL (`platformUrl`). */
  platformUrl: (path: string) => string;
  audit: (entry: PlanCancelEmailAuditEntry) => Promise<void>;
  logger: PlanCancelEmailLogger;
  /** Overrides `PLAN_CANCEL_EMAIL_POLICY.deadlineMs` (tests). */
  deadlineMs?: number;
}

export type PlanCancelEmailOutcome =
  | { outcome: 'skipped' }
  | { outcome: 'sent' }
  | { outcome: 'not_sent'; reason: PlanCancelEmailNotSentReason }
  | { outcome: 'unknown'; reason: typeof PLAN_CANCEL_EMAIL_NOT_SENT_REASONS.deadlineExceeded };

interface RunResult {
  outcome: Exclude<PlanCancelEmailOutcome, { outcome: 'skipped' }>;
  language: SupportedLanguage | null;
  languageSource: LanguageSource | null;
  provider: SendEmailResult['provider'] | null;
}

/** A promise that never rejects: a rejection becomes `fallback`. */
async function settle<T>(promise: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await promise();
  } catch {
    return fallback;
  }
}

const LOOKUP_FAILED = { data: null, error: new Error('lookup threw') };

/**
 * The view as sentences' inputs, formatted for the reader. `null` when the
 * view is unknown or a date it needs cannot be formatted: never a guess.
 */
export function afterFromView(
  view: PlanEndingView | null,
  language: SupportedLanguage,
  timeZone: string
): PlanCancelAfter | null {
  if (!view || view.kind === 'unknown') return null;
  const date = formatAccountDay(view.endsAt, language, timeZone);
  if (!date) return null;
  if (view.kind === 'back_to_plan') {
    const until = view.until === null ? null : formatAccountDay(view.until, language, timeZone);
    // A stored end that will not format is dropped with the clause, not shown as "open-ended".
    if (view.until !== null && until === null) return null;
    return { kind: 'back_to_plan', date, plan: view.planName, until };
  }
  const until = formatAccountDay(view.until, language, timeZone);
  if (!until) return null;
  return {
    kind: 'free_plan',
    date,
    plan: view.planName,
    until,
    // The figure is the server's (the free cohort's config value); only its number format is ours, as in the drawer.
    credits: typeof view.credits === 'number' ? view.credits.toLocaleString(localeFor(language)) : null,
    readOnlyDays: view.thenReadOnlyDays !== null ? String(view.thenReadOnlyDays) : null,
  };
}

async function run(input: PlanCancelEmailInput, deps: PlanCancelEmailDeps): Promise<RunResult> {
  const base: RunResult = {
    outcome: { outcome: 'not_sent', reason: PLAN_CANCEL_EMAIL_NOT_SENT_REASONS.transportFailed },
    language: null,
    languageSource: null,
    provider: null,
  };
  const notSent = (reason: PlanCancelEmailNotSentReason, extra: Partial<RunResult> = {}): RunResult => ({
    ...base,
    ...extra,
    outcome: { outcome: 'not_sent', reason },
  });

  // Fail closed before anything is looked up, composed or sent.
  let supportAddress: string | undefined;
  try {
    supportAddress = deps.senderAddress();
  } catch {
    supportAddress = undefined;
  }
  if (!supportAddress) return notSent(PLAN_CANCEL_EMAIL_NOT_SENT_REASONS.senderNotConfigured);

  // DR-6: never an empty date.
  if (!input.date) return notSent(PLAN_CANCEL_EMAIL_NOT_SENT_REASONS.noDate);

  const [identity, profileLanguage, preferredLanguage, zone] = await Promise.all([
    settle(() => deps.findUserIdentity(input.userId), LOOKUP_FAILED),
    settle(() => deps.findProfileLanguage(input.userId), LOOKUP_FAILED),
    settle(() => deps.findPreferredLanguage(input.userId), LOOKUP_FAILED),
    settle(() => deps.findTimezone(input.userId), LOOKUP_FAILED),
  ]);

  if (identity.error) return notSent(PLAN_CANCEL_EMAIL_NOT_SENT_REASONS.recipientLookupFailed);
  const to = identity.data?.email?.trim();
  if (!to) return notSent(PLAN_CANCEL_EMAIL_NOT_SENT_REASONS.recipientNotFound);

  // A failed read counts as absent.
  const resolved = resolveUserLanguage({
    profileLanguage: profileLanguage.error ? null : profileLanguage.data,
    preferredLanguage: preferredLanguage.error ? null : preferredLanguage.data,
  });
  const withLanguage = { language: resolved.language, languageSource: resolved.source };
  // DR-8: the drawer's zone rule. An unreadable or invalid zone is UTC, never a throw.
  const timeZone = safeTimezone(zone.error ? null : zone.data);

  const date = formatAccountDay(input.date, resolved.language, timeZone);
  if (!date) return notSent(PLAN_CANCEL_EMAIL_NOT_SENT_REASONS.noDate, withLanguage);

  // The kept email needs no view. A failed view drops the paragraph (C-9).
  const view =
    input.event === 'kept'
      ? null
      : await settle(() => deps.readEndingView(input.userId, input.date as string, resolved.language), null);

  let result: SendEmailResult;
  try {
    const email = generatePlanCancelEmail({
      event: input.event,
      locale: resolved.language,
      date,
      after: afterFromView(view, resolved.language, timeZone),
      unpaidInvoicesCancelled: input.event === 'ended_now' && input.invoicesLeftOpen === 0,
      actionUrl: deps.platformUrl(PLAN_CANCEL_EMAIL_ACTION_PATH),
      supportAddress,
    });
    result = await deps.sendEmail({
      kind: 'transactional',
      to: [to],
      subject: email.subject,
      html: email.html,
      text: email.text,
      redactRecipientInLogs: true,
    });
  } catch {
    return notSent(PLAN_CANCEL_EMAIL_NOT_SENT_REASONS.transportFailed, withLanguage);
  }

  if (!result.sent) return notSent(PLAN_CANCEL_EMAIL_NOT_SENT_REASONS.transportFailed, { ...withLanguage, provider: result.provider });
  return { ...withLanguage, provider: result.provider, outcome: { outcome: 'sent' } };
}

/**
 * Send one plan-cancel email. See the file header for every rule.
 * Never throws; resolves within the deadline (plus the audit port's own bound).
 */
export async function sendPlanCancelEmail(input: PlanCancelEmailInput, deps: PlanCancelEmailDeps): Promise<PlanCancelEmailOutcome> {
  let enabled = false;
  try {
    enabled = deps.isEnabled();
  } catch {
    enabled = false;
  }
  if (!enabled) return { outcome: 'skipped' };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<'timedOut'>((resolve) => {
    timer = setTimeout(() => resolve('timedOut'), deps.deadlineMs ?? PLAN_CANCEL_EMAIL_POLICY.deadlineMs);
  });

  const running = run(input, deps).catch(
    (): RunResult => ({
      outcome: { outcome: 'not_sent', reason: PLAN_CANCEL_EMAIL_NOT_SENT_REASONS.transportFailed },
      language: null,
      languageSource: null,
      provider: null,
    })
  );

  let settled: RunResult;
  try {
    const first = await Promise.race([running, deadline]);
    settled =
      first === 'timedOut'
        ? {
            outcome: { outcome: 'unknown', reason: PLAN_CANCEL_EMAIL_NOT_SENT_REASONS.deadlineExceeded },
            language: null,
            languageSource: null,
            provider: null,
          }
        : first;
  } finally {
    clearTimeout(timer);
  }

  const { outcome } = settled;
  const reason = outcome.outcome === 'sent' ? null : outcome.reason;

  // Ids and reason classes only. Never an address, a name or a plan name.
  const logContext = {
    event: 'bos_plan_cancel_email',
    email: input.event,
    userId: input.userId,
    subscriptionId: input.subscriptionId,
    outcome: outcome.outcome,
    reason,
    language: settled.language,
    languageSource: settled.languageSource,
    provider: settled.provider,
  };
  try {
    if (outcome.outcome === 'sent') deps.logger.info(logContext, 'Plan cancel email sent');
    else if (reason === PLAN_CANCEL_EMAIL_NOT_SENT_REASONS.senderNotConfigured) {
      // S-9: the switch is on and there is no sender. An operator must act.
      deps.logger.error({ ...logContext, alert: true }, 'Plan cancel email not sent: the platform sender is not configured');
    } else deps.logger.warn(logContext, 'Plan cancel email not sent');
  } catch {
    // A logger that throws must not fail the route either.
  }

  try {
    await deps.audit({
      action: outcome.outcome === 'sent' ? PLAN_CANCEL_EMAIL_AUDIT_ACTIONS.sent : PLAN_CANCEL_EMAIL_AUDIT_ACTIONS.notSent,
      details: {
        email: input.event,
        outcome: outcome.outcome,
        reason,
        provider: settled.provider,
        language: settled.language,
        languageSource: settled.languageSource,
        subscriptionId: input.subscriptionId,
        periodEnd: input.date,
        livemode: input.livemode,
        actor: 'owner',
        correlationId: input.correlationId,
      },
    });
  } catch {
    // Non-blocking by contract (CLAUDE.md § Audit Trail).
  }

  return outcome;
}
