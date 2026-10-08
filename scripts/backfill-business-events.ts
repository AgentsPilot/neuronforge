/**
 * Reconstruct the event rail from the module tables that already recorded it.
 *
 * WHY THIS EXISTS
 *
 * The rail records what happened, and until now it recorded only five event
 * types from two places. The money spine (payments, invoices, proposals,
 * booking creation) started emitting on 2026-10-06, which means a baseline
 * detector asking "is this worse than it used to be" has one day of history to
 * reason from and will have one month of history in a month.
 *
 * It does not have to. Every event on the spine is derivable from a timestamp
 * that is ALREADY in the module tables: an invoice knows when it was created
 * and when it was paid, a transaction knows when it was refunded, a proposal
 * knows when it was sent and when it was decided. So the history can be built
 * backwards instead of waited for.
 *
 * WHY IT INSERTS DIRECTLY INSTEAD OF CALLING THE SERVICE
 *
 * `BusinessEventService.emit` deliberately does not accept a timestamp -- it
 * omits `created_at` so the column default stamps `now()`. That is right for
 * its job, which is recording that something is happening at this moment, and
 * it is exactly wrong here: emitting 400 historical events through it would
 * stamp all of them today and destroy the only thing this script exists to
 * produce. So the insert is direct, with an explicit `created_at`, and that is
 * the whole reason for the exception.
 *
 * IDEMPOTENCY
 *
 * Re-runnable by construction. The rail is fire-and-forget, so a cold start can
 * drop an event, and re-running this is the repair -- which only works if
 * running it twice is harmless. There is no unique constraint on
 * `business_events`, so this reads what is already there and keys on
 * `event_type|entity_id`: one event of a given type per entity. Every type here
 * is a once-per-entity transition, so that key is exact rather than approximate.
 *
 * USAGE
 *
 *   npx tsx --env-file=.env.local scripts/backfill-business-events.ts --check
 *   npx tsx --env-file=.env.local scripts/backfill-business-events.ts --user=<uuid>
 *   npx tsx --env-file=.env.local scripts/backfill-business-events.ts --all
 *
 * `--check` reports what it would write and writes nothing. Run it first.
 */

import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  console.error('Run with: npx tsx --env-file=.env.local scripts/backfill-business-events.ts --check');
  process.exit(1);
}

const supabase = createClient(url, key);

/**
 * Just enough of the client to read a table.
 *
 * Structural rather than the real `SupabaseClient` so the exported derivation
 * does not drag the library's generics into every caller.
 */
export type SupabaseLike = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => Promise<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>;
    };
  };
};

const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const ALL = args.includes('--all');
const ONE_USER = args.find(a => a.startsWith('--user='))?.slice('--user='.length);

/** One row destined for `business_events`. */
export interface Candidate {
  user_id: string;
  event_type: string;
  category: string;
  entity_type: string;
  entity_id: string;
  contact_id: string | null;
  value_usd: number | null;
  metadata: Record<string, unknown>;
  source_capability: string;
  created_at: string;
}

/**
 * The money is nullable on purpose.
 *
 * A zero would be a claim that the thing was worth nothing, and null is the
 * claim that we do not know what it was worth -- the same distinction the
 * narration prompt now makes for `estimatedImpactUsd`.
 */
const money = (raw: unknown): number | null => {
  const n = Number(raw);
  return Number.isFinite(n) && n !== 0 ? n : null;
};

/** `created_at` must be a real instant or the row is worse than absent. */
const at = (...candidates: unknown[]): string | null => {
  for (const c of candidates) {
    if (typeof c !== 'string' || !c) continue;
    const t = new Date(c).getTime();
    if (Number.isFinite(t)) return new Date(t).toISOString();
  }
  return null;
};

/**
 * Every event derivable from this account's module tables.
 *
 * Exported and client-injected so `verify-business-events.ts` can ask the SAME
 * function what SHOULD exist. A verifier with its own copy of the derivation
 * proves only that two copies agree.
 */
export async function derivableEvents(
  supabase: SupabaseLike,
  userId: string
): Promise<Candidate[]> {
  const out: Candidate[] = [];
  const push = (
    eventType: string,
    category: string,
    entityType: string,
    entityId: string | null | undefined,
    createdAt: string | null,
    extra: Partial<Candidate> = {}
  ) => {
    // No entity or no instant means no event. Both are the identity of the row.
    if (!entityId || !createdAt) return;
    out.push({
      user_id: userId,
      event_type: eventType,
      category,
      entity_type: entityType,
      entity_id: entityId,
      contact_id: null,
      value_usd: null,
      metadata: {},
      source_capability: 'insight',
      created_at: createdAt,
      ...extra,
    });
  };

  // ---- Bookings: created, plus the three ways one ends -------------------
  const { data: bookings, error: bookingsError } = await supabase
    .from('scheduling_bookings')
    .select('id, contact_id, service_id, status, created_at, updated_at, booking_source, payment_amount, parent_booking_id, cancel_reason, cancelled_by')
    .eq('user_id', userId);
  if (bookingsError) throw new Error(`bookings: ${bookingsError.message}`);

  for (const b of bookings ?? []) {
    push('booking.created', 'retention', 'booking', b.id, at(b.created_at), {
      contact_id: b.contact_id ?? null,
      metadata: {
        service_id: b.service_id ?? null,
        booking_source: b.booking_source ?? null,
        is_recurrence_child: Boolean(b.parent_booking_id),
        backfilled: true,
      },
    });

    if (['cancelled', 'completed', 'no_show'].includes(String(b.status))) {
      /*
       * `updated_at` is the best available instant for the transition and is
       * not the same thing as when it happened: a later edit moves it. It is
       * recorded as approximate rather than silently presented as exact.
       */
      push(`booking.${b.status}`, 'retention', 'booking', b.id, at(b.updated_at, b.created_at), {
        contact_id: b.contact_id ?? null,
        value_usd: money(b.payment_amount),
        metadata: {
          service_id: b.service_id ?? null,
          cancel_reason: b.cancel_reason ?? null,
          cancelled_by: b.cancelled_by ?? null,
          backfilled: true,
          timestamp_is_approximate: true,
        },
      });
    }
  }

  // ---- Invoices: created, paid, overdue ----------------------------------
  const { data: invoices, error: invoicesError } = await supabase
    .from('payment_invoices')
    .select('id, contact_id, status, amount, currency, created_at, paid_at, due_date, sent_at')
    .eq('user_id', userId);
  if (invoicesError) throw new Error(`invoices: ${invoicesError.message}`);

  for (const i of invoices ?? []) {
    // `amount`, never `total` -- there is no `total` column on this table.
    const value = money(i.amount);

    push('invoice.created', 'cash_flow', 'invoice', i.id, at(i.created_at), {
      contact_id: i.contact_id ?? null,
      value_usd: value,
      metadata: { currency: i.currency ?? null, due_date: i.due_date ?? null, backfilled: true },
    });

    if (i.status === 'paid') {
      push('invoice.paid', 'cash_flow', 'invoice', i.id, at(i.paid_at, i.created_at), {
        contact_id: i.contact_id ?? null,
        value_usd: value,
        metadata: { currency: i.currency ?? null, backfilled: true },
      });
    }

    if (i.status === 'overdue') {
      /*
       * Dated at the due date, which is when it BECAME overdue, not when a
       * sweep noticed. For a backfill that is the more accurate of the two and
       * the only one that survives re-running.
       */
      push('invoice.overdue', 'cash_flow', 'invoice', i.id, at(i.due_date, i.created_at), {
        contact_id: i.contact_id ?? null,
        value_usd: value,
        metadata: { currency: i.currency ?? null, due_date: i.due_date ?? null, backfilled: true },
      });
    }
  }

  // ---- Transactions: payments and refunds --------------------------------
  const { data: txs, error: txError } = await supabase
    .from('payment_transactions')
    .select('id, contact_id, invoice_id, amount, currency, status, refund_status, refunded_amount, refunded_at, refund_reason, created_at')
    .eq('user_id', userId);
  if (txError) throw new Error(`transactions: ${txError.message}`);

  for (const t of txs ?? []) {
    /*
     * A partial refund leaves `status: 'succeeded'`, so a row can be BOTH a
     * completed payment and a completed refund. Both are emitted, which is why
     * the dedupe key includes the event type.
     */
    if (t.status === 'succeeded' || t.status === 'refunded') {
      push('payment.completed', 'cash_flow', 'invoice', t.id, at(t.created_at), {
        contact_id: t.contact_id ?? null,
        value_usd: money(t.amount),
        metadata: { invoice_id: t.invoice_id ?? null, currency: t.currency ?? null, backfilled: true },
      });
    }

    if (t.refund_status === 'full' || t.refund_status === 'partial') {
      push('refund.completed', 'cash_flow', 'invoice', t.id, at(t.refunded_at, t.created_at), {
        contact_id: t.contact_id ?? null,
        // What went back, not what was charged.
        value_usd: money(t.refunded_amount ?? t.amount),
        metadata: {
          reason: t.refund_reason ?? null,
          is_full_refund: t.refund_status === 'full',
          original_amount: money(t.amount),
          invoice_id: t.invoice_id ?? null,
          backfilled: true,
        },
      });
    }
  }

  // ---- Proposals: sent, accepted, rejected -------------------------------
  const { data: proposals, error: proposalsError } = await supabase
    .from('proposals')
    .select('id, contact_id, service_id, status, total, currency, sent_at, viewed_at, decided_at, decline_reason, created_at')
    .eq('user_id', userId);
  if (proposalsError) throw new Error(`proposals: ${proposalsError.message}`);

  for (const p of proposals ?? []) {
    // `proposals` DOES have `total`, unlike `payment_invoices`. Checked, not assumed.
    const value = money(p.total);

    // Anything past draft was sent, whatever it became afterwards.
    if (p.sent_at) {
      push('proposal.sent', 'sales', 'proposal', p.id, at(p.sent_at), {
        contact_id: p.contact_id ?? null,
        value_usd: value,
        metadata: { currency: p.currency ?? null, service_id: p.service_id ?? null, backfilled: true },
      });
    }

    if (p.status === 'accepted') {
      push('proposal.accepted', 'sales', 'proposal', p.id, at(p.decided_at, p.sent_at), {
        contact_id: p.contact_id ?? null,
        value_usd: value,
        metadata: { currency: p.currency ?? null, service_id: p.service_id ?? null, backfilled: true },
      });
    }

    if (p.status === 'declined') {
      // `proposal.rejected` is the taxonomy's name; the column is `decline_reason`.
      push('proposal.rejected', 'sales', 'proposal', p.id, at(p.decided_at, p.sent_at), {
        contact_id: p.contact_id ?? null,
        value_usd: value,
        metadata: {
          decline_reason: p.decline_reason ?? null,
          currency: p.currency ?? null,
          service_id: p.service_id ?? null,
          backfilled: true,
        },
      });
    }
  }

  // ---- Proposals viewed ---------------------------------------------------
  for (const p of proposals ?? []) {
    if (!p.viewed_at) continue;
    // Keyed on the column being set, so a quote opened twice is one event --
    // the same rule the trigger applies on NULL -> NOT NULL.
    push('proposal.viewed', 'sales', 'proposal', p.id, at(p.viewed_at), {
      contact_id: p.contact_id ?? null,
      value_usd: money(p.total),
      metadata: { currency: p.currency ?? null, service_id: p.service_id ?? null, backfilled: true },
    });
  }

  // ---- Invoices sent ------------------------------------------------------
  for (const i of invoices ?? []) {
    if (!i.sent_at) continue;
    /*
     * The AR clock. Without this, "how long did that take to get paid" can only
     * be measured from `invoice.created`, which is when it was drafted rather
     * than when the client first saw it.
     */
    push('invoice.sent', 'cash_flow', 'invoice', i.id, at(i.sent_at), {
      contact_id: i.contact_id ?? null,
      value_usd: money(i.amount),
      metadata: { currency: i.currency ?? null, due_date: i.due_date ?? null, backfilled: true },
    });
  }

  // ---- Bookings confirmed -------------------------------------------------
  for (const b of bookings ?? []) {
    if (b.status !== 'confirmed') continue;
    /*
     * `updated_at` is the best instant available and is not exact: a later edit
     * moves it. Flagged rather than presented as precise, the same way the
     * booking end-states are.
     */
    push('booking.confirmed', 'retention', 'booking', b.id, at(b.updated_at, b.created_at), {
      contact_id: b.contact_id ?? null,
      value_usd: money(b.payment_amount),
      metadata: { service_id: b.service_id ?? null, backfilled: true, timestamp_is_approximate: true },
    });
  }

  // ---- Contacts: created, and the stage they are in now -------------------
  const { data: contacts, error: contactsError } = await supabase
    .from('crm_contacts')
    .select('id, stage, stage_entered_at, source, created_at')
    .eq('user_id', userId);
  if (contactsError) throw new Error(`contacts: ${contactsError.message}`);

  for (const c of contacts ?? []) {
    push('contact.created', 'conversion', 'contact', c.id, at(c.created_at), {
      contact_id: c.id,
      metadata: { stage: c.stage ?? null, source: c.source ?? null, backfilled: true },
    });

    /*
     * Only the CURRENT stage, and only when it differs from where a contact
     * starts. `stage_entered_at` records when the latest move happened and the
     * row keeps no history, so earlier moves are genuinely unrecoverable --
     * `from_stage` is therefore omitted rather than guessed.
     */
    if (c.stage_entered_at && c.stage) {
      push('contact.stage_changed', 'conversion', 'contact', c.id, at(c.stage_entered_at), {
        contact_id: c.id,
        metadata: { to_stage: c.stage, from_stage: null, backfilled: true, history_incomplete: true },
      });
    }
  }

  // ---- Services created ---------------------------------------------------
  const { data: services, error: servicesError } = await supabase
    .from('scheduling_services')
    .select('id, service_name, price, currency, status, created_at')
    .eq('user_id', userId);
  if (servicesError) throw new Error(`services: ${servicesError.message}`);

  for (const sv of services ?? []) {
    push('service.created', 'operations', 'service', sv.id, at(sv.created_at), {
      value_usd: money(sv.price),
      metadata: { service_name: sv.service_name ?? null, currency: sv.currency ?? null, backfilled: true },
    });
  }

  /*
   * `pricing.changed` is deliberately absent.
   *
   * Nothing has ever recorded a price change -- there is no price history
   * column and no prior event -- so its history starts the moment the trigger
   * was applied. Deriving one from `updated_at` would invent a change that may
   * never have happened.
   */

  // ---- Replies to enquiries ----------------------------------------------
  const { data: activities, error: activitiesError } = await supabase
    .from('crm_activities')
    .select('id, contact_id, activity_type, auto_logged, activity_date, created_at')
    .eq('user_id', userId);
  if (activitiesError) throw new Error(`activities: ${activitiesError.message}`);

  /*
   * The same outbound set the trigger uses, which is the set
   * `SalesReplySlowDetector` already treats as "the owner got back to them".
   * Three copies of this list now exist (detector, trigger, here) and they must
   * agree or the metric and the detector will disagree about what a reply is.
   */
  const OUTBOUND = new Set([
    'email',
    'booking_link_sent',
    'booking_confirmation_sent',
    'proposal_sent',
    'invoice_sent',
  ]);

  /*
   * How long the client waited, carried on the event.
   *
   * `MetricsComputeService.computeAvgMetric` reads `metadata.reply_time_seconds`
   * and averages it -- that is the ONLY input `sales.avg_reply_time_hours` has.
   * Without it the metric averaged 148 real reply events to zero, which is why
   * a baseline on it was flat.
   *
   * Measured from the CONTACT's creation, which is the same definition
   * `SalesReplySlowDetector` uses (`Date.parse(replied) - Date.parse(c.created_at)`).
   * Two definitions of "reply time" on one platform would be worse than none.
   */
  const contactCreatedAt = new Map<string, string>();
  for (const c of contacts ?? []) {
    if (c.created_at) contactCreatedAt.set(String(c.id), String(c.created_at));
  }

  /*
   * Only the FIRST reply to each contact gets a duration.
   *
   * The tenth email to a client who has been around for months is not a slow
   * reply, it is a long relationship, and averaging that in would make the
   * metric meaningless. `firstTouch` in the detector takes the earliest
   * outbound activity for exactly this reason, so the sort below matches it.
   */
  const outbound = (activities ?? [])
    .filter(a => OUTBOUND.has(String(a.activity_type)) && a.contact_id)
    .sort((x, y) => String(x.activity_date ?? x.created_at).localeCompare(String(y.activity_date ?? y.created_at)));

  const firstRepliedTo = new Set<string>();

  for (const a of outbound) {
    const when = at(a.activity_date, a.created_at);
    if (!when) continue;

    const contactId = String(a.contact_id);
    const metadata: Record<string, unknown> = {
      activity_type: a.activity_type,
      auto_logged: a.auto_logged ?? null,
      backfilled: true,
    };

    if (!firstRepliedTo.has(contactId)) {
      firstRepliedTo.add(contactId);
      const created = contactCreatedAt.get(contactId);
      if (created) {
        const seconds = Math.round((new Date(when).getTime() - new Date(created).getTime()) / 1000);
        // A reply dated before the contact existed is bad data, not a negative
        // wait. Omitted rather than averaged in as a figure below zero.
        if (Number.isFinite(seconds) && seconds >= 0) {
          metadata.reply_time_seconds = seconds;
          metadata.is_first_reply = true;
        }
      }
    }

    push('enquiry.replied', 'sales', 'activity', a.id, when, {
      contact_id: a.contact_id,
      metadata,
    });
  }

  // ---- Page views ---------------------------------------------------------
  const { data: views, error: viewsError } = await supabase
    .from('website_page_views')
    .select('id, page_id, subdomain, device_type, country_code, utm_source, session_id, is_owner_view, viewed_at')
    .eq('user_id', userId);
  if (viewsError) throw new Error(`page views: ${viewsError.message}`);

  /*
   * The owner checking their own page is not an audience, and the trigger skips
   * those too. `countUniqueVisitors` in InsightRepository applies the same rule;
   * all three must agree or the visitor metric and the conversion vector will
   * disagree about who the audience is.
   *
   * NOTE the entity here is the PAGE, not the view row, so a page accumulates
   * one `page.viewed` event per view and the dedupe key cannot separate them.
   * Backfilled page views are therefore capped at one per page per day, which
   * is the finest granularity the key can express without lying.
   */
  const seenPageDay = new Set<string>();
  for (const v of views ?? []) {
    if (v.is_owner_view === true) continue;
    const when = at(v.viewed_at);
    if (!when) continue;

    const dayKey = `${v.page_id}|${when.slice(0, 10)}`;
    if (seenPageDay.has(dayKey)) continue;
    seenPageDay.add(dayKey);

    push('page.viewed', 'acquisition', 'page', v.page_id, when, {
      metadata: {
        subdomain: v.subdomain ?? null,
        device_type: v.device_type ?? null,
        backfilled: true,
        one_per_page_per_day: true,
      },
    });
  }

  return out;
}

/**
 * One event of a given type per entity.
 *
 * Exact rather than approximate, because every type this script derives is a
 * once-per-entity transition: an invoice is created once and paid once, a
 * proposal is decided once. A transaction and its own refund share an entity
 * id, which is why the type is half the key.
 */
export const eventKey = (c: { event_type: string; entity_id: string }) =>
  `${c.event_type}|${c.entity_id}`;

/**
 * What is left to write, given what the rail already holds.
 *
 * Exported and pure so the re-runnability this script depends on is testable
 * without a database. The rail is fire-and-forget, so a cold start can drop an
 * event and re-running is the repair -- a repair that is only safe if running
 * twice writes nothing the second time.
 *
 * Deduped against `existingKeys` AND against itself as it goes: two rows of the
 * same table can yield the same event, so the in-batch set matters as much as
 * the one read from the database.
 */
export function freshCandidates<T extends { event_type: string; entity_id: string }>(
  candidates: T[],
  existingKeys: Iterable<string>
): T[] {
  const seen = new Set(existingKeys);
  const fresh: T[] = [];
  for (const c of candidates) {
    const k = eventKey(c);
    if (seen.has(k)) continue;
    seen.add(k);
    fresh.push(c);
  }
  return fresh;
}

async function runForUser(userId: string): Promise<{ wrote: number; skipped: number }> {
  const candidates = await derivableEvents(supabase, userId);

  const { data: existing, error } = await supabase
    .from('business_events')
    .select('event_type, entity_id')
    .eq('user_id', userId);
  if (error) throw new Error(`existing events: ${error.message}`);

  const fresh = freshCandidates(candidates, (existing ?? []).map(eventKey));

  const byType = fresh.reduce<Record<string, number>>((acc, c) => {
    acc[c.event_type] = (acc[c.event_type] ?? 0) + 1;
    return acc;
  }, {});

  console.log(`\n  ${userId}`);
  console.log(`    derivable ${candidates.length}, already on the rail ${candidates.length - fresh.length}, to write ${fresh.length}`);
  for (const [type, n] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    console.log(`      ${String(n).padStart(4)}  ${type}`);
  }

  if (CHECK || fresh.length === 0) {
    return { wrote: 0, skipped: candidates.length - fresh.length };
  }

  // Chunked: one oversized insert is the difference between a partial
  // backfill and a failed one, and this is re-runnable either way.
  let wrote = 0;
  for (let i = 0; i < fresh.length; i += 200) {
    const chunk = fresh.slice(i, i + 200);
    const { error: insertError } = await supabase.from('business_events').insert(chunk);
    if (insertError) throw new Error(`insert: ${insertError.message}`);
    wrote += chunk.length;
  }

  return { wrote, skipped: candidates.length - fresh.length };
}

async function main() {
  if (!ONE_USER && !ALL) {
    console.error('Pass --user=<uuid> or --all. Add --check to write nothing.');
    process.exit(1);
  }

  let users: string[];
  if (ONE_USER) {
    users = [ONE_USER];
  } else {
    // Anyone with a booking or an invoice: the two tables every other event
    // type hangs off.
    const [{ data: b }, { data: i }] = await Promise.all([
      supabase.from('scheduling_bookings').select('user_id'),
      supabase.from('payment_invoices').select('user_id'),
    ]);
    users = [...new Set([...(b ?? []), ...(i ?? [])].map(r => r.user_id).filter(Boolean))];
  }

  console.log(CHECK ? 'DRY RUN - nothing will be written' : 'Backfilling the event rail');
  console.log(`users: ${users.length}`);

  let wrote = 0;
  let skipped = 0;
  let failed = 0;

  for (const userId of users) {
    try {
      const r = await runForUser(userId);
      wrote += r.wrote;
      skipped += r.skipped;
    } catch (err) {
      // One account's bad data must not strand the rest; the run is repeatable.
      failed++;
      console.error(`    FAILED ${userId}: ${(err as Error).message}`);
    }
  }

  console.log(`\n${CHECK ? 'would write' : 'wrote'} ${wrote}, already present ${skipped}, failed accounts ${failed}`);
  if (CHECK) console.log('Re-run without --check to apply.');
}

/*
 * Guarded so the exported helpers above can be imported by a test without the
 * script connecting to anything or writing anything.
 */
if (require.main === module) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
