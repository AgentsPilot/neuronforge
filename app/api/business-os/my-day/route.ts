/**
 * The dashboard's opening card: who the owner is, and what their day looks like.
 *
 * This route used to build four `storyBeats` from five hand-rolled queries and
 * hand them to the client, which forwarded only `userName` and `greeting` to
 * the dashboard and dropped the rest on the floor. The beats are gone; the
 * queries they needed now live behind BriefingFactsService, which serves a
 * narrative the dashboard actually renders.
 *
 * Two correctness notes carried over deliberately:
 *  - "Today" is the BUSINESS's today. The old code used `setHours(0,0,0,0)`,
 *    which on Vercel is UTC midnight and gives a Jerusalem business a day that
 *    began at 03:00 local.
 *  - The greeting followed the server clock for the same reason. It now follows
 *    the business's wall clock.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { businessDayFor, resolveBusinessTimezone } from '@/lib/business-os/businessDay';
import { buildBriefingFacts } from '@/lib/business-os/briefing/BriefingFactsService';
import { getBriefing } from '@/lib/business-os/briefing/BriefingStore';
import type { BriefingLanguage } from '@/lib/business-os/briefing/BriefingNarrator';

const logger = createLogger({ module: 'MyDayAPI' });

function greetingFor(localHour: number): 'morning' | 'afternoon' | 'evening' {
  if (localHour < 12) return 'morning';
  if (localHour < 17) return 'afternoon';
  return 'evening';
}

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    /*
     * Profile and preferences in one pass.
     *
     * The timezone is on user_preferences, NOT business_profiles — that column
     * has never existed there, and reading it from the profile is a live bug
     * elsewhere in this codebase (chat-v4 resolves every date in UTC because
     * of it). Both reads are tolerant: a missing preferences row is normal.
     */
    const [profileResult, briefingPrefResult, preferencesResult] = await Promise.all([
      supabaseServer
        .from('business_profiles')
        .select('business_name, owner_name, language')
        .eq('user_id', user.id)
        .maybeSingle(),
      /*
       * The email opt-in, read on its own.
       *
       * Deliberately not added to the select above: Postgres rejects the whole
       * select for one unknown column, and folding a freshly-migrated column in
       * would take the entire dashboard header down anywhere the migration has
       * not run. Its own read fails alone and the switch shows as off.
       */
      supabaseServer
        .from('business_profiles')
        .select('daily_briefing_email_enabled')
        .eq('user_id', user.id)
        .maybeSingle(),
      supabaseServer
        .from('user_preferences')
        .select('timezone, preferred_language')
        .eq('user_id', user.id)
        .maybeSingle(),
    ]);

    const profile = profileResult.data as
      | { business_name?: string | null; owner_name?: string | null; language?: string | null }
      | null;
    const preferences = preferencesResult.data as
      | { timezone?: string | null; preferred_language?: string | null }
      | null;

    const userName =
      profile?.owner_name?.split(' ')[0] ||
      user.user_metadata?.full_name?.split(' ')[0] ||
      user.email?.split('@')[0] ||
      'there';

    const { timezone } = resolveBusinessTimezone({ preferencesTimezone: preferences?.timezone });
    const day = businessDayFor(new Date(), timezone);

    const language = normaliseLanguage(preferences?.preferred_language ?? profile?.language);

    /*
     * The briefing is best-effort. It involves a model call and a cache table
     * that may not be migrated yet, and neither is worth failing the whole
     * dashboard header over — the greeting alone is still useful.
     */
    let briefing = null;
    try {
      const facts = await buildBriefingFacts(user.id, day);
      briefing = await getBriefing(user.id, facts, language);
    } catch (briefingError) {
      requestLogger.warn({ err: briefingError, userId: user.id }, 'Briefing unavailable');
    }

    return NextResponse.json({
      success: true,
      data: {
        userName,
        greeting: greetingFor(day.localHour),
        briefing: briefing && {
          narrative: briefing.narrative,
          date: day.date,
          // Undefined rather than 'UTC' when nothing is stored, so the card can
          // tell "no timezone set" from "the timezone is UTC" and gate the
          // morning email on the difference.
          timezone: preferences?.timezone ? day.timezone : undefined,
          isQuiet: briefing.isQuiet,
          source: briefing.source,
          emailEnabled: Boolean(
            (briefingPrefResult.data as { daily_briefing_email_enabled?: boolean } | null)
              ?.daily_briefing_email_enabled
          ),
        },
      },
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to fetch My Day data');
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

function normaliseLanguage(value: string | null | undefined): BriefingLanguage {
  const code = value?.toLowerCase().slice(0, 2);
  return code === 'he' || code === 'es' ? code : 'en';
}
