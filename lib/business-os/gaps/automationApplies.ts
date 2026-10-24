/**
 * Could this business use this automation at all?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Separate from the registry because the registry is pure data and this asks
 * the database. Separate from the advisor route because the dispatcher has to
 * ask the same question: an owner can say yes today and unpublish their intake
 * form tomorrow, and the sweep must not go on chasing clients about a form that
 * no longer reaches them.
 *
 * WHAT THIS IS NOT
 *
 * It is not "is there anything waiting". A business with an intake form and
 * nobody currently late is still a business that should be asked — the offer is
 * about what happens from now on, and `waiting: 0` already says the queue is
 * empty. This answers the prior question: is the machinery this automation
 * drives even present.
 *
 * FAILING TOWARDS NOT ASKING
 *
 * An unreadable settings row reports false — the automation is hidden rather
 * than offered. Hiding a usable automation costs the owner a feature they can
 * still turn on from the intake screen; offering an unusable one costs their
 * trust in every other thing this card asks them.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/business-os/gaps/automationApplies
 */

import { schedulingServiceRepository } from '@/lib/repositories/SchedulingRepository';
import { intakeRepository } from '@/lib/repositories/IntakeRepository';
import { intakeFormRepository } from '@/lib/repositories/IntakeFormRepository';
import { intakeReachesClient } from '@/lib/business-os/intakeReach';
import { auditTrailRepository } from '@/lib/repositories/AuditTrailRepository';
import { supabaseServer } from '@/lib/supabaseServer';
import { createLogger } from '@/lib/logger';
import type { OperationalAutomation } from './automations';

const logger = createLogger({ module: 'AutomationApplies' });

/**
 * Answer `requires` for one business.
 *
 * One read per distinct requirement, cached for the life of the call so a
 * caller looping the whole registry pays for each fact once.
 */
export async function automationApplies(
  userId: string,
  automation: OperationalAutomation,
  cache: Map<string, Promise<boolean>> = new Map()
): Promise<boolean> {
  if (!automation.requires) return true;

  const key = automation.requires;
  if (!cache.has(key)) cache.set(key, resolve(userId, key));
  return cache.get(key)!;
}

/**
 * Every automation in the registry that this business could actually use.
 *
 * The cache is what makes this one read rather than one per entry.
 */
export async function applicableAutomations(
  userId: string,
  automations: OperationalAutomation[]
): Promise<OperationalAutomation[]> {
  const cache = new Map<string, Promise<boolean>>();
  const verdicts = await Promise.all(
    automations.map(automation => automationApplies(userId, automation, cache))
  );
  return automations.filter((_, index) => verdicts[index]);
}

/**
 * How often this owner has lately done the work each automation would take.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The database half of `offerOnEvidence`, kept here for the same reason
 * `requires` is: the registry is pure data and must not import a repository.
 *
 * Counted once per distinct ACTION rather than once per automation, so two
 * entries earning themselves on the same owner action cost one read. Returns a
 * count for every automation, zero for the ones that declare no evidence rule
 * — `offerIsEarned` ignores the number in that case, and a map with a hole in
 * it is a worse thing for a caller to hold.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export async function automationEvidence(
  userId: string,
  automations: OperationalAutomation[]
): Promise<Map<string, number>> {
  const wanted = new Map<string, { action: string; windowDays: number }>();
  for (const automation of automations) {
    if (automation.offerOnEvidence) wanted.set(automation.offerOnEvidence.action, automation.offerOnEvidence);
  }

  const counts = new Map<string, number>();
  await Promise.all(
    [...wanted.values()].map(async rule => {
      const since = new Date(Date.now() - rule.windowDays * 24 * 60 * 60 * 1000).toISOString();
      counts.set(rule.action, await auditTrailRepository.countActionSince(userId, rule.action, since));
    })
  );

  return new Map(
    automations.map(automation => [
      automation.id,
      automation.offerOnEvidence ? counts.get(automation.offerOnEvidence.action) ?? 0 : 0,
    ])
  );
}

async function resolve(
  userId: string,
  requirement: NonNullable<OperationalAutomation['requires']>
): Promise<boolean> {
  switch (requirement) {
    case 'intake_reaches_client':
      return intakeReaches(userId);
    case 'takes_bookings':
      return takesBookings(userId);
    case 'sends_quotes':
      return sendsQuotes(userId);
    case 'bills_for_anything':
      return billsForAnything(userId);
    default:
      return true;
  }
}

/**
 * Is there anything anyone could book?
 *
 * Asked of the services, not of the diary. A business that published a service
 * last week and has no appointments yet is exactly the one that should be
 * offered this — the question is what happens from the first booking on, and
 * gating on existing bookings would hide the automation until it was too late
 * to have helped.
 *
 * `activeOnly` carries both halves of bookable — the Power toggle and the
 * draft/published status — from `SchedulingServiceRepository.BOOKABLE`, so a
 * business whose only service is switched off reads as taking no bookings.
 */
async function takesBookings(userId: string): Promise<boolean> {
  try {
    const { data, error } = await schedulingServiceRepository.listAll(userId, true);
    if (error) throw error;
    return (data ?? []).length > 0;
  } catch (err) {
    logger.warn({ err, userId }, 'Could not resolve bookable services; not offering the meeting reminder');
    return false;
  }
}

/**
 * Intake is on AND a form has been published.
 *
 * Both halves, from `intakeReachesClient`, which is the one place that rule is
 * written. A generated-but-unapproved form does not count: it holds questions
 * the owner has never read, and the automation exists to send reminders about a
 * form the client has actually been given.
 */
async function intakeReaches(userId: string): Promise<boolean> {
  try {
    const [settings, published] = await Promise.all([
      intakeRepository.getSettings(userId),
      intakeFormRepository.getPublished(userId),
    ]);

    return intakeReachesClient({
      is_enabled: settings.data?.is_enabled ?? false,
      hasPublishedForm: !!published.data,
    });
  } catch (err) {
    logger.warn({ err, userId }, 'Could not resolve intake reach; not offering the intake chase');
    return false;
  }
}

/**
 * Has this business ever raised a bill?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Asked of the INVOICES, not of the services, for the same reason
 * `sendsQuotes` is asked of proposals: a service with a price on it says the
 * business could bill, while an invoice that exists is the only proof it does.
 * A practice whose catalogue is a single free consultation has nothing for an
 * invoice chaser to chase, and so does a business using the platform as a
 * website and a CRM with no catalogue at all.
 *
 * Any status counts, paid included. The question is whether billing is
 * something they do, not whether anything is outstanding right now —
 * `waiting: 0` already says the queue is empty, and the offer is about what
 * happens from here.
 *
 * Unreadable counts as no, hiding the offer: the same direction every gate in
 * this file fails in.
 * ─────────────────────────────────────────────────────────────────────────────
 */
async function billsForAnything(userId: string): Promise<boolean> {
  try {
    /*
     * `payment_invoices`, which is the table. There is no `invoices` table —
     * naming one returns an error rather than an empty count, and because this
     * fails closed that would have hidden the automation from every business
     * on the platform instead of from the ones with nothing to chase.
     * `invoice_unpaid` in `./definitions` reads the same table.
     */
    const { count, error } = await supabaseServer
      .from('payment_invoices')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);

    if (error) throw error;
    return (count ?? 0) > 0;
  } catch (err) {
    logger.warn({ err, userId }, 'Could not resolve whether this business bills; not offering the invoice chase');
    return false;
  }
}

/**
 * Has this business ever put a price in front of anybody?
 *
 * Asked of the proposals themselves rather than of the services, and the
 * difference matters: `sale_mode: 'proposal'` says a service COULD be quoted,
 * while a quote that was actually sent is the only proof the business works
 * that way. A practice that priced one service as "on request" two years ago
 * and has never sent a quote has nothing for this automation to follow up.
 *
 * Any status counts, including declined and expired. The question is whether
 * quoting is something they do, not whether the last one went well.
 *
 * Unreadable counts as no, which hides the offer — the same direction the two
 * gates above fail in, and for the same reason.
 */
async function sendsQuotes(userId: string): Promise<boolean> {
  try {
    const { count, error } = await supabaseServer
      .from('proposals')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .not('sent_at', 'is', null);

    if (error) throw error;
    return (count ?? 0) > 0;
  } catch (err) {
    logger.warn({ err, userId }, 'Could not resolve whether this business sends quotes; not offering the quote chase');
    return false;
  }
}
