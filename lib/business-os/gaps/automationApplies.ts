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

async function resolve(
  userId: string,
  requirement: NonNullable<OperationalAutomation['requires']>
): Promise<boolean> {
  switch (requirement) {
    case 'intake_reaches_client':
      return intakeReaches(userId);
    case 'takes_bookings':
      return takesBookings(userId);
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
