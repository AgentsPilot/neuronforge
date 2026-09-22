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
import { narrateBriefing, PROMPT_VERSION, type BriefingLanguage, type BriefingSource, type BusinessType } from './BriefingNarrator';
import { resolveBosLlmSettings } from '@/lib/business-os/llm/modelSettings';
import type { BriefingFacts } from './BriefingFactsService';
import { bosBriefingGroupId } from '@/lib/business-os/llm/callCatalog';
import { runAiAction, type AiTrigger } from '@/lib/business-os/llm/aiActionAudit';

/** Who asked for the briefing: the daily email job, or the owner on My Day (FR-11, RC-8). */
export type BriefingTrigger = Extract<AiTrigger, 'scheduled' | 'user'>;

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
  language: BriefingLanguage,
  /** Required, so the scheduled path and the My Day path cannot be confused (RC-8, WC-3). */
  trigger: BriefingTrigger,
  businessType: BusinessType = {}
): Promise<StoredBriefing> {
  /*
   * The CONFIGURED model, not the one that ran: this is a cache key computed
   * before any call, and it exists so that changing the area's model starts a
   * new cache rather than serving yesterday's phrasing from the old one.
   */
  const { model: configuredModel } = await resolveBosLlmSettings('briefing', 'daily_narration');
  const hash = hashFacts(facts, language, businessType, configuredModel);

  const cached = await readCached(userId, facts.day.date);
  if (cached && cached.facts_hash === hash) {
    return {
      narrative: cached.narrative,
      source: cached.source as BriefingSource,
      isQuiet: facts.isQuiet,
    };
  }

  // One narration, one AI action and audit entry, grouped by the briefing's
  // day (Layer 3, FR-11). A quiet day or a cached briefing makes no call, so it
  // writes none; a same-day re-narration writes a second entry in the same group.
  const narration = await runAiAction(
    {
      area: 'briefing',
      actionType: 'briefing_narration',
      groupId: bosBriefingGroupId(userId, facts.day.date),
      trigger,
      accountId: userId,
    },
    async (h) => {
      const narrated = await narrateBriefing(facts, language, userId, businessType);
      if (narrated.source === 'fallback') h.markFailed('briefing_fallback');
      return narrated;
    }
  );

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
export function hashFacts(
  facts: BriefingFacts,
  language: BriefingLanguage,
  businessType: BusinessType = {},
  /*
   * Passed in rather than read here.
   *
   * It used to come from `briefingModel()`, which read an env var — a model
   * name written at a call site, which `check:bos-llm-literals` rejects now
   * that the area row is the source of truth. The caller is async and resolves
   * the settings anyway; this function stays synchronous, which is what keeps
   * it cheap to test.
   *
   * Defaulted so the existing tests, which care about facts and language rather
   * than models, need no change.
   */
  model: string = 'default'
): string {
  const { appointments, money, outlook } = facts;

  const material = JSON.stringify({
    language,
    /*
     * The instructions are part of the output, so they are part of the key.
     * Without this a change to the narrator's rules reaches only users who
     * have no cached briefing yet — everyone else keeps the old wording until
     * the next day, with nothing to indicate why.
     */
    prompt: PROMPT_VERSION,
    /*
     * The model is part of the key for the same reason the prompt is: it
     * decides the words. Switching models would otherwise reach only users with
     * no cached briefing yet, and everyone else would keep yesterday's model's
     * phrasing until tomorrow with nothing to say why.
     */
    model,
    /*
     * The business type is part of the fingerprint because it now decides the
     * words. A trainer whose vertical is corrected from 'other' should not keep
     * being served the briefing that called their trainees "clients".
     */
    businessType: [businessType.vertical, businessType.subVertical, businessType.name],
    date: facts.day.date,
    total: appointments.total,
    ready: appointments.ready,
    awaiting: appointments.awaitingIntake.map(p => [p.name, p.timeLocal]),
    first: appointments.first
      ? [appointments.first.name, appointments.first.timeLocal, appointments.first.serviceName, appointments.first.note]
      : null,
    cancelled: appointments.cancelled.map(c => [c.name, c.timeLocal, c.reason]),
    owed: money.owed.map(o => [o.name, o.amount, o.currency, o.overdue]),
    /*
     * Everything the text can say has to be in the fingerprint.
     *
     * These three were added to the facts and not to this hash, so each could
     * change the briefing's words without changing its key — and the cached
     * version from earlier in the day would be served instead. The money one
     * was the visible failure: an invoice settled at 14:49 produced a new
     * "$500 came in today" line that no reader ever saw, because nothing about
     * the fingerprint had moved.
     *
     * The rule this keeps breaking: a fact the narrator may read is a fact this
     * function must hash. Adding one without the other is silent — no error,
     * just yesterday's sentence.
     */
    completed: appointments.completed,
    awaitingPayment: appointments.awaitingPayment.map(p => [p.name, p.timeLocal]),
    received: [money.receivedToday, money.receivedCount],
    /*
     * The currency is hashed separately from the amounts because it can move
     * on its own. With nothing owed it is taken from the day's takings, so
     * $500 and ₪500 produce identical amounts and counts but different text —
     * and the symbol on a money figure is not a detail this dashboard gets to
     * be casual about, having already shipped a ₪ on USD once.
     */
    currency: money.currency,
    /*
     * The outlook is part of the fingerprint because it is part of the text.
     * On an otherwise empty day it is the ONLY content, so leaving it out would
     * pin the first quiet briefing of the day in place: someone books an
     * appointment for next week, or a new person gets in touch at noon, and the
     * card would keep showing the version written before either happened.
     */
    next: outlook.next
      ? [outlook.next.name, outlook.next.dateLocal, outlook.next.timeLocal, outlook.next.serviceName]
      : null,
    newLeads: outlook.newLeads,
    /*
     * The quotes are part of the fingerprint for the same reason the leads are:
     * they are part of the text. Without them a quote request arriving at noon
     * leaves the card showing the version written this morning, which is the
     * exact staleness the comment above warns about.
     */
    quotesWaiting: outlook.quotesWaiting,
    quotesOut: outlook.quotesOut,
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
