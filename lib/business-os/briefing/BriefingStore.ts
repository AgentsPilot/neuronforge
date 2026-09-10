/**
 * One narration per business day, not one per page load.
 *
 * Without this the dashboard pays for a model call every time it is opened, and
 * a user who reloads ten times in a morning pays ten times for the same
 * sentences. The cache is keyed by the business's own local date.
 *
 * It is a cache, not a daily snapshot: the stored row carries a hash of the
 * facts it was written from, so a booking cancelled at 11am changes the hash
 * and the story is rewritten. An idle reload changes nothing and costs nothing.
 */

import { createHash } from 'crypto';
import { supabaseServer } from '@/lib/supabaseServer';
import { createLogger } from '@/lib/logger';
import { narrateBriefing, type BriefingLanguage, type BriefingSource } from './BriefingNarrator';
import type { BriefingFacts } from './BriefingFactsService';

const logger = createLogger({ service: 'BriefingStore' });

export interface StoredBriefing {
  narrative: string;
  source: BriefingSource;
  isQuiet: boolean;
}

/**
 * The briefing for this day, from cache when the facts have not moved.
 *
 * Never throws. Every storage failure falls through to narrating fresh, so a
 * missing table or a revoked grant degrades cost, not availability — which
 * matters here because this repo has shipped unapplied migrations before.
 */
export async function getBriefing(
  userId: string,
  facts: BriefingFacts,
  language: BriefingLanguage
): Promise<StoredBriefing> {
  const hash = hashFacts(facts, language);

  const cached = await readCached(userId, facts.day.date);
  if (cached && cached.facts_hash === hash) {
    return {
      narrative: cached.narrative,
      source: cached.source as BriefingSource,
      isQuiet: facts.isQuiet,
    };
  }

  const narration = await narrateBriefing(facts, language, userId);

  // Written after the fact so a storage outage cannot stop the card rendering.
  await writeCached(userId, facts, language, hash, narration.narrative, narration.source);

  return { narrative: narration.narrative, source: narration.source, isQuiet: facts.isQuiet };
}

/**
 * A fingerprint of everything the narration depends on.
 *
 * Language is part of it: the same day told in Hebrew and in English are two
 * different rows' worth of text, and a user who switches language should not
 * be served the previous one from cache.
 */
export function hashFacts(facts: BriefingFacts, language: BriefingLanguage): string {
  const { appointments, money } = facts;

  const material = JSON.stringify({
    language,
    date: facts.day.date,
    total: appointments.total,
    ready: appointments.ready,
    awaiting: appointments.awaitingIntake.map(p => [p.name, p.timeLocal]),
    first: appointments.first
      ? [appointments.first.name, appointments.first.timeLocal, appointments.first.serviceName, appointments.first.note]
      : null,
    cancelled: appointments.cancelled.map(c => [c.name, c.timeLocal, c.reason]),
    owed: money.owed.map(o => [o.name, o.amount, o.currency, o.overdue]),
  });

  return createHash('sha256').update(material).digest('hex').slice(0, 32);
}

/* ------------------------------------------------------------------ storage */

interface CachedRow {
  facts_hash: string;
  narrative: string;
  source: string;
}

async function readCached(userId: string, date: string): Promise<CachedRow | null> {
  try {
    const { data, error } = await supabaseServer
      .from('daily_briefings')
      .select('facts_hash, narrative, source')
      .eq('user_id', userId)
      .eq('briefing_date', date)
      .maybeSingle();

    if (error) throw error;
    return (data as CachedRow) ?? null;
  } catch (error) {
    // Most likely cause: 20260911_daily_briefing.sql has not been applied.
    logger.warn({ err: error, userId }, 'Briefing cache unreadable; narrating fresh');
    return null;
  }
}

async function writeCached(
  userId: string,
  facts: BriefingFacts,
  language: BriefingLanguage,
  hash: string,
  narrative: string,
  source: BriefingSource
): Promise<void> {
  try {
    const { error } = await supabaseServer.from('daily_briefings').upsert(
      {
        user_id: userId,
        briefing_date: facts.day.date,
        timezone: facts.day.timezone,
        facts_hash: hash,
        facts: facts as unknown as Record<string, unknown>,
        narrative,
        source,
        language,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,briefing_date' }
    );

    if (error) throw error;
  } catch (error) {
    logger.warn({ err: error, userId }, 'Could not cache briefing; it will be narrated again');
  }
}
