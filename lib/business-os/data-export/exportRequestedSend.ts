// lib/business-os/data-export/exportRequestedSend.ts
//
// The one "Export requested" send, shared by the owner route
// (`app/api/business-os/export-requests/route.ts`, MX-1b) and the admin
// "Send export to owner" route (`app/api/admin/users/[id]/export-sends/route.ts`,
// MX-5). Moved verbatim from the owner route (MX-5 workplan §4.5; SA-Q3):
//
// (a) it takes the caller's logger, so the caller's correlationId is kept, and
//     it never throws: every path ends in an outcome;
// (b) the 10 s guard lives here; the owner route re-exports it as
//     `REQUESTED_EMAIL_TIMEOUT_MS` with the same value;
// (c) `origin` picks the wording: the owner's own email, or support's (BQ-E8-1).
//
// The guard does not cancel the send (C-7): a send that loses the race may
// still arrive while `requested_email_sent_at` stays NULL, so the outcome says
// `email_timeout`, not `email_failed`.
//
// The recipient goes to the transport only (redacted in its logs); it is never
// logged here. WHO MAY IMPORT the request repository is pinned by
// lib/repositories/__tests__/exportRequestRepositories.callers.guard.test.ts.

import type { Logger } from '@/lib/logger';
import type { ExportModuleId } from '@/lib/business-os/data-export/exportModules';
import { buildExportRequestedEmail, type ExportEmailLanguage } from '@/lib/business-os/data-export/exportRequestedEmail';
import { ownerClock } from '@/lib/business-os/data-export/ownerClock';
import { platformSenderAddress, sendEmail } from '@/lib/notifications/emailTransport';
import { BusinessOsExportRequestRepository } from '@/lib/repositories/BusinessOsExportRequestRepository';
import { userPreferencesRepository } from '@/lib/repositories/UserPreferencesRepository';

/** The "Export requested" email gets this long before the route answers anyway (C-7). */
export const EXPORT_REQUESTED_EMAIL_TIMEOUT_MS = 10_000;

export type ExportRequestedEmailOutcome = 'sent' | 'email_failed' | 'email_timeout';

export interface ExportRequestedSendArgs {
  /** The OWNER: the account the export is of, whose language and clock the email uses. */
  userId: string;
  requestId: string;
  /** The owner's login email. */
  to: string;
  modules: ExportModuleId[];
  /** Who started it (MX-5). Default `'owner'`. */
  origin?: 'owner' | 'admin';
}

/** The one "Export requested" email. Never throws (SA-Q3 a). */
export async function sendExportRequestedEmail(
  args: ExportRequestedSendArgs,
  requestLogger: Logger
): Promise<ExportRequestedEmailOutcome> {
  try {
    return await send(args, requestLogger);
  } catch (err) {
    requestLogger.warn({ err, requestId: args.requestId }, 'Export requested email threw');
    return 'email_failed';
  }
}

async function send(args: ExportRequestedSendArgs, requestLogger: Logger): Promise<ExportRequestedEmailOutcome> {
  const requests = new BusinessOsExportRequestRepository();

  const [language, clock, stored] = await Promise.all([
    userPreferencesRepository.findPreferredLanguage(args.userId).then(
      (result): ExportEmailLanguage => {
        if (result.error) requestLogger.warn({ userId: args.userId, code: 'language_unreadable' }, 'Export requested email: language unreadable, sent in English');
        // `SupportedLanguage` is the same three-language union, so no cast is needed (SA CR-5).
        return result.data ?? 'en';
      },
      (): ExportEmailLanguage => 'en'
    ),
    ownerClock(args.userId, requestLogger),
    // The database time of the request, not this server's clock.
    requests.findByIdForUser(args.requestId, args.userId),
  ]);
  let requestedAt = new Date();
  if (stored.data) requestedAt = new Date(stored.data.requested_at);
  else requestLogger.warn({ requestId: args.requestId, code: 'requested_at_unreadable' }, 'Export requested email: request time unreadable, server time used');

  const email = buildExportRequestedEmail({
    language,
    modules: args.modules,
    requestedAt,
    timezone: clock.timezone,
    isTimezoneSet: clock.isSet,
    origin: args.origin ?? 'owner',
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), EXPORT_REQUESTED_EMAIL_TIMEOUT_MS);
  });
  try {
    const sending = sendEmail({
      kind: 'transactional',
      to: [args.to],
      from: platformSenderAddress(),
      subject: email.subject,
      html: email.html,
      text: email.text,
      redactRecipientInLogs: true,
    }).catch(() => ({ sent: false as const, provider: 'none' as const }));
    const result = await Promise.race([sending, timeout]);
    if (result === 'timeout') return 'email_timeout';
    return result.sent ? 'sent' : 'email_failed';
  } finally {
    if (timer) clearTimeout(timer);
  }
}
