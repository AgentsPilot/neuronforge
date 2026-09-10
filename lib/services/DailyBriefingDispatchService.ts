/**
 * Sends the morning briefing to the businesses that asked for it.
 *
 * The hard part is not the email, it is "morning". One cron cannot fire at 7am
 * in every timezone, so it wakes hourly, and each run asks each opted-in
 * business what time it is where they are. Those inside their morning window
 * get a ledger row; UNIQUE(user_id, briefing_date) means the other twenty-three
 * wake-ups do nothing.
 *
 * Shape follows PaymentReminderService.processDueReminders — reap, enqueue,
 * claim, dispatch, mark terminal — per §8.1 of the event-driven migration plan.
 */

import { randomUUID } from 'crypto';
import { supabaseServer } from '@/lib/supabaseServer';
import { createLogger } from '@/lib/logger';
import { dailyBriefingSendRepository } from '@/lib/repositories/DailyBriefingSendRepository';
import {
  businessDayFor,
  resolveBusinessTimezone,
  type BusinessDay,
} from '@/lib/business-os/businessDay';
import { buildBriefingFacts } from '@/lib/business-os/briefing/BriefingFactsService';
import { getBriefing } from '@/lib/business-os/briefing/BriefingStore';
import { briefingLines, type BriefingLanguage } from '@/lib/business-os/briefing/BriefingNarrator';
import { generateDailyBriefingEmail } from '@/lib/email/templates/daily-briefing';
import { resolveEmailBranding } from '@/lib/email/branding';
import { sendEmail } from '@/lib/notifications/emailTransport';

const logger = createLogger({ service: 'DailyBriefingDispatchService' });

/**
 * A window, not an hour.
 *
 * Vercel crons drift and can be skipped entirely; an exact `hour === 7` test
 * silently loses a business its whole day. The unique constraint makes the
 * extra chances free — the second and third attempts find the row already
 * there and stop.
 */
const SEND_WINDOW_START = 7;
const SEND_WINDOW_END = 10;

/** Must exceed the cron route's maxDuration (60s) so a killed run is provably dead. */
const LEASE_SECONDS = 90;
const MAX_ATTEMPTS = 3;
const BATCH = 25;

export interface DispatchSummary {
  enqueued: number;
  sent: number;
  skipped: number;
  failed: number;
}

export async function processDueBriefings(now = new Date()): Promise<DispatchSummary> {
  const runnerId = randomUUID();
  const summary: DispatchSummary = { enqueued: 0, sent: 0, skipped: 0, failed: 0 };

  // 1. Recover anything a dead runner left claimed.
  const reaped = await dailyBriefingSendRepository.reapStale(LEASE_SECONDS, MAX_ATTEMPTS);
  if (reaped.data?.length) {
    logger.info({ count: reaped.data.length }, 'Reclaimed stale briefing sends');
  }

  // 2. Queue everyone whose local morning it is.
  summary.enqueued = await enqueueDueBusinesses(now);

  // 3. Take a batch and send.
  const claimed = await dailyBriefingSendRepository.claimDue(runnerId, BATCH);
  if (claimed.error || !claimed.data) return summary;

  for (const row of claimed.data) {
    try {
      const outcome = await dispatchOne(row.user_id, row.timezone, now);

      if (outcome.sent) {
        await dailyBriefingSendRepository.markSent(row.id);
        summary.sent += 1;
      } else {
        await dailyBriefingSendRepository.markSkipped(row.id, outcome.reason);
        summary.skipped += 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ err: error, userId: row.user_id }, 'Briefing send failed');

      /*
       * Left in `processing`, not marked failed. The reaper decides: back to
       * pending with backoff while attempts remain, dead-lettered after that.
       * Marking failed here would burn the day's only chance on one timeout.
       */
      if (row.attempts >= MAX_ATTEMPTS) {
        await dailyBriefingSendRepository.markFailed(row.id, message);
      }
      summary.failed += 1;
    }
  }

  return summary;
}

/* ------------------------------------------------------------------ queueing */

async function enqueueDueBusinesses(now: Date): Promise<number> {
  const { data, error } = await supabaseServer
    .from('business_profiles')
    .select('user_id')
    .eq('daily_briefing_email_enabled', true);

  if (error) {
    logger.error({ err: error }, 'Could not list businesses opted into the briefing');
    return 0;
  }

  const userIds = (data || []).map(row => row.user_id as string);
  if (userIds.length === 0) return 0;

  // One read for every subscriber's timezone rather than one per business.
  const { data: preferences } = await supabaseServer
    .from('user_preferences')
    .select('user_id, timezone')
    .in('user_id', userIds);

  const zoneByUser = new Map<string, string | null>(
    (preferences || []).map(row => [row.user_id as string, row.timezone as string | null])
  );

  let enqueued = 0;

  for (const userId of userIds) {
    const { timezone, source } = resolveBusinessTimezone({
      preferencesTimezone: zoneByUser.get(userId),
    });

    /*
     * No timezone means no morning. Defaulting to UTC would email a Los
     * Angeles business at midnight, which is worse than not emailing at all —
     * the settings switch is gated on this for the same reason.
     */
    if (source === 'default') {
      logger.debug({ userId }, 'Skipping briefing: no timezone set');
      continue;
    }

    const day = businessDayFor(now, timezone);
    if (day.localHour < SEND_WINDOW_START || day.localHour > SEND_WINDOW_END) continue;

    const result = await dailyBriefingSendRepository.enqueue(userId, day.date, timezone);
    if (result.data) enqueued += 1;
  }

  return enqueued;
}

/* ---------------------------------------------------------------- dispatching */

interface DispatchOutcome {
  sent: boolean;
  reason: string;
}

async function dispatchOne(
  userId: string,
  timezone: string,
  now: Date
): Promise<DispatchOutcome> {
  const day: BusinessDay = businessDayFor(now, timezone);

  const facts = await buildBriefingFacts(userId, day);

  /*
   * A quiet day is not emailed.
   *
   * "Nothing happened today" arriving every morning is the fastest route to an
   * unsubscribe, and it spends sending reputation that the booking
   * confirmations actually need. Terminal `skipped`, so the reaper leaves it.
   */
  if (facts.isQuiet) return { sent: false, reason: 'quiet_day' };

  const [profile, preferences, authUser] = await Promise.all([
    supabaseServer
      .from('business_profiles')
      .select('owner_name, language')
      .eq('user_id', userId)
      .maybeSingle(),
    supabaseServer
      .from('user_preferences')
      .select('preferred_language')
      .eq('user_id', userId)
      .maybeSingle(),
    supabaseServer.auth.admin.getUserById(userId),
  ]);

  /*
   * The account's own address, not business_profiles.email — that column is the
   * PUBLIC address clients write to, and sending the owner's private briefing
   * there could put it in front of whoever staffs the inbox.
   */
  const ownerEmail = authUser.data?.user?.email;
  if (!ownerEmail) return { sent: false, reason: 'no_owner_email' };

  const language = normaliseLanguage(
    (preferences.data?.preferred_language as string | null) ??
      (profile.data?.language as string | null)
  );

  const briefing = await getBriefing(userId, facts, language);
  const lines = briefingLines(briefing.narrative);
  if (lines.length === 0) return { sent: false, reason: 'nothing_to_say' };

  const branding = await resolveEmailBranding(userId, language);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || '';

  const { subject, html } = generateDailyBriefingEmail({
    lines,
    date: day.date,
    timezone: day.timezone,
    ownerFirstName: (profile.data?.owner_name as string | null)?.split(' ')[0],
    dashboardUrl: `${appUrl}/business-os`,
    settingsUrl: `${appUrl}/business-os/settings?section=preferences`,
    branding,
    locale: language,
  });

  await sendEmail({
    to: [ownerEmail],
    subject,
    html,
    // Presents the business as the sender rather than the platform.
    ownerUserId: userId,
  });

  logger.info({ userId, date: day.date, lines: lines.length }, 'Morning briefing sent');
  return { sent: true, reason: 'sent' };
}

function normaliseLanguage(value: string | null | undefined): BriefingLanguage {
  const code = value?.toLowerCase().slice(0, 2);
  return code === 'he' || code === 'es' ? code : 'en';
}
