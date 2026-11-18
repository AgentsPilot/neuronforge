/**
 * Reading a client's standing, and remembering what it looked like today.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO ANSWERS, AND WHY THEY ARE NOT THE SAME ANSWER
 *
 * The LIVE standing is computed from source rows every time it is asked for.
 * Nothing here caches it, because a derived figure written once and never
 * refreshed is exactly the failure the refund insight had on 2026-11-15: a card
 * that said "4 refunds" for three days while the account reached seven.
 *
 * The SNAPSHOT is the memory of that answer, one row per client per day, and it
 * exists for the only question the live computation cannot answer: is this
 * getting worse. `crm_client_standing` keeps it; this module writes it.
 *
 * Written only when the picture CHANGED. A client whose record is identical to
 * yesterday's adds nothing by being recorded again, and a table that grows by
 * every client every day buries the days that meant something.
 *
 * ── SCOPE ───────────────────────────────────────────────────────────────────
 * Every read is `.eq('user_id', userId)` (CLAUDE.md rule 4). The client whose
 * behaviour this describes is a third party; one missing scope would show one
 * business another's people.
 *
 * @module lib/business-os/clients/clientStandingStore
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { createLogger } from '@/lib/logger';

import { buildClientProfiles, type ClientProfile } from './clientProfile';
import { standingFor, type ClientStanding } from './clientStanding';
import { bandFromScore, businessNorm, scoreClient } from './clientScore';

const logger = createLogger({ module: 'ClientStandingStore' });

/**
 * How far back the counts look.
 *
 * Six months rather than a lifetime: a client who missed three sessions two
 * years ago and has turned up ever since is not the person the badge should
 * describe, and several fixes to how this data is RECORDED landed during the
 * last year — attribution of who called a session off among them. A shorter
 * window lets bad history age out rather than being argued with.
 */
export const CLIENT_WINDOW_DAYS = 180;

export interface ClientStandingRow {
  contactId: string;
  profile: ClientProfile;
  standing: ClientStanding;
  /**
   * The raw score behind the band, which this already computes to decide it.
   *
   * Returned rather than thrown away so the badge and the card can show the
   * same figure. Map it through `displayScore` before anybody reads it: raw is
   * an unbounded sum of weighted deviations.
   */
  score: number;
}

/** The five reads, one per table, scoped to the account. */
async function fetchFacts(supabase: SupabaseClient, userId: string, since: Date) {
  const sinceIso = since.toISOString();

  const [meetings, bookings, instalments, transactions, proposals] = await Promise.all([
    supabase
      .from('scheduling_meetings')
      /* `outcome_by` is the attribution that is actually written — see the
         note in `clientProfile`. `cancelled_by` is read beside it for the few
         rows that carry it. */
      .select('booking_id, meeting_status, start_time, outcome_by, cancelled_by')
      .eq('user_id', userId)
      .gte('start_time', sinceIso),
    supabase
      .from('scheduling_bookings')
      .select('id, contact_id, status, meeting_status, cancelled_by, start_time')
      .eq('user_id', userId),
    supabase
      .from('payment_plan_installments')
      .select('contact_id, status, due_date, paid_at')
      .eq('user_id', userId),
    supabase
      .from('payment_transactions')
      .select('contact_id, refund_status, created_at')
      .eq('user_id', userId)
      .gte('created_at', sinceIso),
    supabase
      .from('proposals')
      .select('contact_id, status, updated_at')
      .eq('user_id', userId)
      .gte('updated_at', sinceIso),
  ]);

  const failure = [meetings, bookings, instalments, transactions, proposals].find(r => r.error);
  if (failure?.error) throw failure.error;

  return {
    meetings: meetings.data ?? [],
    /*
     * Bookings are NOT filtered by date: they are read to find out which
     * contact a session belongs to, and a package opened a year ago still owns
     * the session held last week.
     */
    bookings: bookings.data ?? [],
    instalments: instalments.data ?? [],
    transactions: transactions.data ?? [],
    proposals: proposals.data ?? [],
  };
}

/**
 * Every client's standing for this account, computed now.
 *
 * The badge and the detectors both read this. Contacts with no activity in the
 * window simply do not appear — there is nothing to say about them, and a row
 * of zeroes would read as a claim that they did nothing wrong.
 */
export async function computeClientStandings(
  supabase: SupabaseClient,
  userId: string,
  now: Date = new Date(),
  windowDays: number = CLIENT_WINDOW_DAYS
): Promise<ClientStandingRow[]> {
  const since = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
  const facts = await fetchFacts(supabase, userId, since);

  const profiles = buildClientProfiles({ ...facts, now, windowDays } as never);
  const everyone = [...profiles.values()];

  /*
   * ── THE BAND COMES FROM THE SCORE, NOT FROM A THRESHOLD ───────────────────
   *
   * `standingFor` still supplies the counts and the rates — they are facts
   * about one client and need no comparison. What it must no longer decide is
   * the WORD, because a fixed line cannot know what is normal here: on one
   * live account the clients sit at 25%, 23%, 21% and 16% missed, and a client
   * who buys fifty sessions will cancel more of them than one who buys six.
   *
   * `businessNorm` is taken across this account's own clients, so "unusual"
   * means unusual for this business. Persistence is deliberately NOT fed in
   * here: it is read from these very snapshots, and letting it raise the band
   * that produces them would be the measurement feeding itself.
   */
  const norm = businessNorm(everyone);

  return everyone.map(profile => {
    const standing = standingFor(profile);
    const scored = scoreClient({ profile, norm, persistedWeeks: 0 });

    return {
      contactId: profile.contactId,
      profile,
      score: scored.score,
      standing:
        /* `new` survives untouched: below the evidence floor there is no band
           to score, and a flattering word would be worse than none. */
        standing.band === 'new' ? standing : { ...standing, band: bandFromScore(scored.score) },
    };
  });
}

/** The columns a snapshot row holds, from one computed standing. */
function toRow(userId: string, asOf: string, windowDays: number, entry: ClientStandingRow) {
  const { profile, standing } = entry;
  return {
    user_id: userId,
    contact_id: entry.contactId,
    as_of: asOf,
    window_days: windowDays,
    band: standing.band,
    sessions_settled: profile.sessionsSettled,
    sessions_held: profile.sessionsHeld,
    sessions_missed: profile.sessionsMissed,
    sessions_cancelled_by_client: profile.sessionsCancelledByClient,
    sessions_cancelled_by_owner: profile.sessionsCancelledByOwner,
    sessions_cancelled_unknown: profile.sessionsCancelledUnknown,
    instalments_due: profile.instalmentsDue,
    instalments_paid_on_time: profile.instalmentsPaidOnTime,
    instalments_paid_late: profile.instalmentsPaidLate,
    instalments_overdue: profile.instalmentsOverdue,
    refunds: profile.refunds,
    proposals_declined: profile.proposalsDeclined,
    /* Rounded to the column's own precision, so "unchanged" compares equal
       rather than differing in a digit the table cannot store. */
    miss_rate: standing.missRate === null ? null : Number(standing.missRate.toFixed(4)),
    late_rate: standing.lateRate === null ? null : Number(standing.lateRate.toFixed(4)),
  };
}

/** The fields that decide whether anything actually moved. */
const COMPARED = [
  'band',
  'sessions_settled',
  'sessions_held',
  'sessions_missed',
  'sessions_cancelled_by_client',
  'sessions_cancelled_by_owner',
  'sessions_cancelled_unknown',
  'instalments_due',
  'instalments_paid_on_time',
  'instalments_paid_late',
  'instalments_overdue',
  'refunds',
  'proposals_declined',
] as const;

function samePicture(previous: Record<string, unknown> | undefined, next: Record<string, unknown>): boolean {
  if (!previous) return false;
  return COMPARED.every(field => previous[field] === next[field]);
}

/**
 * How often a client's record is worth a row when their BAND has not moved.
 *
 * ── WHY A FLOOR AT ALL ──────────────────────────────────────────────────────
 * The counts are taken over a sliding 180 days, so a session that happened 181
 * days ago drops out of its own accord and every count beneath it shifts. That
 * is a change in the record with no change in behaviour, and without a floor it
 * would write a row a day for a client who did nothing.
 *
 * ── AND WHY NOT SIMPLY WEEKLY ───────────────────────────────────────────────
 * A band moving from `reliable` to `at_risk` is the one thing this table exists
 * to remember, and making it wait up to six days for its turn would lose the
 * day it happened. So the band is recorded the moment it moves; everything
 * else waits.
 */
const QUIET_DAYS = 7;

function daysSince(asOf: unknown, today: string): number {
  const then = new Date(String(asOf));
  const now = new Date(today);
  if (Number.isNaN(then.getTime()) || Number.isNaN(now.getTime())) return Number.POSITIVE_INFINITY;
  return Math.floor((now.getTime() - then.getTime()) / (24 * 60 * 60 * 1000));
}

/** Is this picture worth a row today? */
function worthRecording(
  previous: Record<string, unknown> | undefined,
  next: Record<string, unknown>,
  today: string
): boolean {
  /* Never seen before: the first picture of a client is always worth keeping. */
  if (!previous) return true;

  /* Nothing moved at all. */
  if (samePicture(previous, next)) return false;

  /* The band moved: the story changed, and the day it changed is the point. */
  if (previous.band !== next.band) return true;

  /* Counts drifted inside the same band — worth a row, not worth one daily. */
  return daysSince(previous.as_of, today) >= QUIET_DAYS;
}

export interface SnapshotResult {
  computed: number;
  written: number;
  unchanged: number;
}

/**
 * Record today's picture for every client whose picture changed.
 *
 * Idempotent twice over: unchanged clients are skipped, and a second run on the
 * same day overwrites its own row rather than adding a second opinion about the
 * same afternoon (the table's `(user_id, contact_id, as_of)` key).
 */
export async function snapshotClientStandings(
  supabase: SupabaseClient,
  userId: string,
  now: Date = new Date(),
  windowDays: number = CLIENT_WINDOW_DAYS
): Promise<SnapshotResult> {
  const standings = await computeClientStandings(supabase, userId, now, windowDays);
  if (standings.length === 0) return { computed: 0, written: 0, unchanged: 0 };

  const asOf = now.toISOString().slice(0, 10);

  /*
   * The last picture taken of each of these clients, whenever that was — not
   * "yesterday's", which assumes a run happened yesterday. One read for the
   * account, then the newest row per contact.
   */
  const { data: previousRows, error: previousError } = await supabase
    .from('crm_client_standing')
    .select(`contact_id, as_of, ${COMPARED.join(', ')}`)
    .eq('user_id', userId)
    .order('as_of', { ascending: false });

  if (previousError) throw previousError;

  const latest = new Map<string, Record<string, unknown>>();
  for (const row of previousRows ?? []) {
    const record = row as unknown as Record<string, unknown>;
    const contactId = String(record.contact_id);
    if (!latest.has(contactId)) latest.set(contactId, record);
  }

  const changed = standings
    .map(entry => toRow(userId, asOf, windowDays, entry))
    .filter(row => worthRecording(latest.get(String(row.contact_id)), row, asOf));

  if (changed.length === 0) {
    logger.info({ userId, computed: standings.length }, 'Client standing unchanged for every client');
    return { computed: standings.length, written: 0, unchanged: standings.length };
  }

  const { error } = await supabase
    .from('crm_client_standing')
    .upsert(changed, { onConflict: 'user_id,contact_id,as_of' });

  if (error) throw error;

  logger.info(
    { userId, computed: standings.length, written: changed.length },
    'Client standing snapshot written'
  );

  return {
    computed: standings.length,
    written: changed.length,
    unchanged: standings.length - changed.length,
  };
}
