/**
 * Read the facts each health category is measured from.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The arithmetic lives in `businessHealth.ts` and is pure. This is the half
 * that touches the database, kept separate so every rule about what counts as
 * enough data is testable without a fixture.
 *
 * Every measure reads a MODULE table — invoices, bookings, contacts, activities,
 * page views. Deliberately not `derived_metrics`, which is computed from an
 * event rail that only partially emits: `operations.calendar_utilization` is
 * `value: 0, sampleSize: 0` on every account, and a detector that trusted it
 * told owners their calendar was 100% empty while they had appointments booked.
 *
 * Two periods of equal length, so the comparison is like for like. Each returns
 * a rate and the size of the sample behind it; `scoreCategory` decides whether
 * that sample is enough to say anything.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/business-os/insight/health/resolveBusinessHealth
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';
import {
  scoreCategory,
  summariseHealth,
  rate,
  type BusinessHealth,
  type CategoryHealth,
  type HealthCategory,
  type Measure,
} from './businessHealth';

const logger = createLogger({ module: 'ResolveBusinessHealth' });

/** The window each rate covers, and the length of the one before it. */
const PERIOD_DAYS = 28;

/** Booking states that occupied the slot. A cancellation freed the time. */
const OCCUPIED = ['confirmed', 'completed'];

/** An activity the OWNER performed, as opposed to one the platform logged. */
const REPLY_ACTIVITIES = ['email', 'call', 'note', 'booking_link_sent'];

interface Window { from: string; to: string }

function windows(now = Date.now()): { current: Window; previous: Window } {
  const day = 86_400_000;
  return {
    current: { from: new Date(now - PERIOD_DAYS * day).toISOString(), to: new Date(now).toISOString() },
    previous: {
      from: new Date(now - 2 * PERIOD_DAYS * day).toISOString(),
      to: new Date(now - PERIOD_DAYS * day).toISOString(),
    },
  };
}

/**
 * Every category, measured. Never throws.
 *
 * A category whose source is unreadable reports `too_little_data` rather than
 * taking the summary down — the same failing-towards-silence the detectors use.
 */
export async function resolveBusinessHealth(
  supabase: SupabaseClient,
  userId: string,
  now = Date.now()
): Promise<BusinessHealth> {
  const { current, previous } = windows(now);

  const categories: CategoryHealth[] = [];

  for (const [category, measureFn] of MEASURES) {
    try {
      const measure = await measureFn(supabase, userId, current, previous);
      categories.push(scoreCategory(category, measure));
    } catch (error) {
      logger.warn({ err: error, userId, category }, 'Health measure unreadable; reporting it as unknown');
      categories.push(
        scoreCategory(category, { current: null, previous: null, sample: 0, previousSample: 0 })
      );
    }
  }

  return summariseHealth(categories);
}

type MeasureFn = (
  supabase: SupabaseClient,
  userId: string,
  current: Window,
  previous: Window
) => Promise<Measure>;

/** Invoices settled by their due date. 100% genuinely is the target here. */
const cashFlow: MeasureFn = async (supabase, userId, current, previous) => {
  const { data, error } = await supabase
    .from('payment_invoices')
    .select('status, due_date, paid_at, created_at')
    .eq('user_id', userId)
    .gte('created_at', previous.from);

  if (error) throw error;

  const inWindow = (w: Window) =>
    (data ?? []).filter(r => String(r.created_at) >= w.from && String(r.created_at) < w.to);

  const onTimeRate = (rows: typeof data) => {
    const issued = (rows ?? []).filter(r => r.due_date);
    const onTime = issued.filter(
      r => r.paid_at && String(r.paid_at) <= `${String(r.due_date)}T23:59:59Z`
    );
    return { value: rate(onTime.length, issued.length), sample: issued.length };
  };

  const now = onTimeRate(inWindow(current));
  const before = onTimeRate(inWindow(previous));

  return { current: now.value, previous: before.value, sample: now.sample, previousSample: before.sample };
};

/** Clients who came back: more than one completed booking in the window. */
const retention: MeasureFn = async (supabase, userId, current, previous) => {
  const { data, error } = await supabase
    .from('scheduling_bookings')
    .select('contact_id, status, start_time')
    .eq('user_id', userId)
    .eq('status', 'completed')
    .gte('start_time', previous.from);

  if (error) throw error;

  const repeatRate = (w: Window) => {
    const perContact = new Map<string, number>();
    for (const row of data ?? []) {
      const at = String(row.start_time);
      if (at < w.from || at >= w.to || !row.contact_id) continue;
      perContact.set(String(row.contact_id), (perContact.get(String(row.contact_id)) ?? 0) + 1);
    }
    const returned = [...perContact.values()].filter(n => n > 1).length;
    return { value: rate(returned, perContact.size), sample: perContact.size };
  };

  const now = repeatRate(current);
  const before = repeatRate(previous);

  return { current: now.value, previous: before.value, sample: now.sample, previousSample: before.sample };
};

/** Contacts who went on to book something. */
const conversion: MeasureFn = async (supabase, userId, current, previous) => {
  const [contacts, bookings] = await Promise.all([
    supabase.from('crm_contacts').select('id, created_at').eq('user_id', userId).gte('created_at', previous.from),
    supabase.from('scheduling_bookings').select('contact_id').eq('user_id', userId),
  ]);

  if (contacts.error) throw contacts.error;
  if (bookings.error) throw bookings.error;

  const booked = new Set((bookings.data ?? []).map(b => String(b.contact_id)));

  const convertedRate = (w: Window) => {
    const cohort = (contacts.data ?? []).filter(
      c => String(c.created_at) >= w.from && String(c.created_at) < w.to
    );
    const converted = cohort.filter(c => booked.has(String(c.id))).length;
    return { value: rate(converted, cohort.length), sample: cohort.length };
  };

  const now = convertedRate(current);
  const before = convertedRate(previous);

  return { current: now.value, previous: before.value, sample: now.sample, previousSample: before.sample };
};

/**
 * Enquiries the owner answered themselves.
 *
 * `auto_logged = false` is what separates a person writing from the platform
 * writing — every automated touch in this codebase sets it true.
 */
const sales: MeasureFn = async (supabase, userId, current, previous) => {
  const [contacts, activities] = await Promise.all([
    supabase.from('crm_contacts').select('id, created_at').eq('user_id', userId).gte('created_at', previous.from),
    supabase
      .from('crm_activities')
      .select('contact_id, activity_type, auto_logged')
      .eq('user_id', userId)
      .eq('auto_logged', false)
      .in('activity_type', REPLY_ACTIVITIES),
  ]);

  if (contacts.error) throw contacts.error;
  if (activities.error) throw activities.error;

  const replied = new Set((activities.data ?? []).map(a => String(a.contact_id)));

  const repliedRate = (w: Window) => {
    const cohort = (contacts.data ?? []).filter(
      c => String(c.created_at) >= w.from && String(c.created_at) < w.to
    );
    return {
      value: rate(cohort.filter(c => replied.has(String(c.id))).length, cohort.length),
      sample: cohort.length,
    };
  };

  const now = repliedRate(current);
  const before = repliedRate(previous);

  return { current: now.value, previous: before.value, sample: now.sample, previousSample: before.sample };
};

/**
 * How much of the calendar was actually used.
 *
 * Bookings against the owner's stated availability — the same measurement
 * `OpsUtilizationLowDetector` was rewritten to make, for the same reason: the
 * metric that used to answer this is always zero.
 */
const operations: MeasureFn = async (supabase, userId, current, previous) => {
  const [profile, bookings] = await Promise.all([
    supabase.from('business_profiles').select('scheduling_availability').eq('user_id', userId).maybeSingle(),
    supabase
      .from('scheduling_bookings')
      .select('start_time, end_time, status')
      .eq('user_id', userId)
      .in('status', OCCUPIED)
      .gte('start_time', previous.from),
  ]);

  if (bookings.error) throw bookings.error;

  const availability = (profile.data as { scheduling_availability?: Record<string, Array<{ start?: string; end?: string }>> } | null)
    ?.scheduling_availability;

  const hoursPerWeek = weeklyHours(availability);
  // No stated hours, no denominator. Never assume a working week.
  if (hoursPerWeek === null) {
    return { current: null, previous: null, sample: 0, previousSample: 0 };
  }

  const available = hoursPerWeek * (PERIOD_DAYS / 7);

  const filled = (w: Window) => {
    let booked = 0;
    let count = 0;
    for (const row of bookings.data ?? []) {
      const at = String(row.start_time);
      if (at < w.from || at >= w.to) continue;
      const start = Date.parse(at);
      const end = Date.parse(String(row.end_time));
      if (Number.isNaN(start) || Number.isNaN(end) || end <= start) continue;
      booked += (end - start) / 3_600_000;
      count += 1;
    }
    const value = rate(booked, available);
    return { value: value === null ? null : Math.min(100, value), sample: count };
  };

  const now = filled(current);
  const before = filled(previous);

  return { current: now.value, previous: before.value, sample: now.sample, previousSample: before.sample };
};

/** Unique visitors who went on to get in touch. */
const acquisition: MeasureFn = async (supabase, userId, current, previous) => {
  const [views, contacts] = await Promise.all([
    supabase
      .from('website_page_views')
      .select('session_id, viewed_at, is_owner_view')
      .eq('user_id', userId)
      .eq('is_owner_view', false)
      .gte('viewed_at', previous.from),
    supabase.from('crm_contacts').select('created_at').eq('user_id', userId).gte('created_at', previous.from),
  ]);

  if (views.error) throw views.error;
  if (contacts.error) throw contacts.error;

  const enquiryRate = (w: Window) => {
    const sessions = new Set(
      (views.data ?? [])
        .filter(v => String(v.viewed_at) >= w.from && String(v.viewed_at) < w.to && v.session_id)
        .map(v => String(v.session_id))
    );
    const enquiries = (contacts.data ?? []).filter(
      c => String(c.created_at) >= w.from && String(c.created_at) < w.to
    ).length;

    return { value: rate(enquiries, sessions.size), sample: sessions.size };
  };

  const now = enquiryRate(current);
  const before = enquiryRate(previous);

  return { current: now.value, previous: before.value, sample: now.sample, previousSample: before.sample };
};

/** Nothing records a discount, so there is nothing to measure. */
const pricing: MeasureFn = async () => ({ current: null, previous: null, sample: 0, previousSample: 0 });

const MEASURES: Array<[HealthCategory, MeasureFn]> = [
  ['cash_flow', cashFlow],
  ['retention', retention],
  ['conversion', conversion],
  ['sales', sales],
  ['operations', operations],
  ['acquisition', acquisition],
  ['pricing', pricing],
];

/**
 * Hours a week the owner said they work, or null.
 *
 * Null rather than a default: `calculateAvailableHours` answers 40 for missing
 * input, which is right for its caller and wrong as a denominator — it would
 * turn "we do not know your hours" into "you are 8% full".
 */
function weeklyHours(
  availability: Record<string, Array<{ start?: string; end?: string }>> | undefined
): number | null {
  if (!availability || typeof availability !== 'object') return null;

  let total = 0;
  for (const intervals of Object.values(availability)) {
    if (!Array.isArray(intervals)) continue;
    for (const interval of intervals) {
      const start = minutes(interval?.start);
      const end = minutes(interval?.end);
      if (start === null || end === null || end <= start) continue;
      total += (end - start) / 60;
    }
  }

  return total > 0 ? total : null;
}

function minutes(value: unknown): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? '').trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59 ? h * 60 + m : null;
}
