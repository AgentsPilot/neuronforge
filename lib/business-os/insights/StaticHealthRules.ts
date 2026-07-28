/**
 * Static Health Rules for Business Story
 *
 * Provides fast, rule-based health assessments for story cards.
 * Used for card status colors (green/yellow/red) and basic labels.
 *
 * LLM handles: Big picture narrative, focus list recommendations
 * Static rules handle: Card health indicators, status labels
 */

export type HealthStatus = 'healthy' | 'watch' | 'action';
export type OverallHealth = 'thriving' | 'healthy' | 'watch' | 'starting';

export interface BusinessStats {
  payments: {
    revenue_30d: number;
    pending_invoices: number;
  };
  crm: {
    total_contacts: number;
    new_this_week: number;
    became_clients_this_week: number;
    went_quiet: number;
  };
  scheduling: {
    bookings_30d: number;
    upcoming_count: number;
  };
}

export interface CardHealth {
  status: HealthStatus;
  statusLabel: string; // Will be translated by component
}

/**
 * Assess overall business health from stats
 */
export function assessOverallHealth(stats: BusinessStats): OverallHealth {
  const positives = [
    stats.payments.revenue_30d > 0,
    stats.crm.became_clients_this_week > 0,
    stats.scheduling.bookings_30d > 0
  ].filter(Boolean).length;

  const concerns = [
    stats.crm.went_quiet > 3,
    stats.payments.pending_invoices > 2
  ].filter(Boolean).length;

  // New business with little data
  if (stats.crm.total_contacts < 3 && stats.scheduling.bookings_30d < 2) {
    return 'starting';
  }

  if (positives >= 2 && concerns === 0) return 'thriving';
  if (positives >= 2) return 'healthy';
  if (concerns >= 2) return 'watch';
  return 'healthy';
}

/**
 * Assess money/revenue health
 */
export function assessMoneyHealth(stats: BusinessStats): CardHealth {
  const { revenue_30d, pending_invoices } = stats.payments;

  // Has revenue and few pending invoices
  if (revenue_30d > 0 && pending_invoices <= 1) {
    return { status: 'healthy', statusLabel: 'growing' };
  }

  // Has revenue but some pending invoices
  if (revenue_30d > 0) {
    return { status: 'watch', statusLabel: 'collect_pending' };
  }

  // No revenue yet
  if (pending_invoices > 0) {
    return { status: 'action', statusLabel: 'needs_attention' };
  }

  // New business, no transactions yet
  return { status: 'healthy', statusLabel: 'just_starting' };
}

/**
 * Assess people/CRM health
 */
export function assessPeopleHealth(stats: BusinessStats): CardHealth {
  const { total_contacts, new_this_week, became_clients_this_week, went_quiet } = stats.crm;

  // New clients and low quiet rate
  if (became_clients_this_week > 0 && went_quiet <= 2) {
    return { status: 'healthy', statusLabel: 'growing' };
  }

  // New contacts coming in, but some went quiet
  if (new_this_week > 0 && went_quiet > 2) {
    return { status: 'watch', statusLabel: 'reach_out' };
  }

  // Many went quiet
  if (went_quiet > 3) {
    return { status: 'action', statusLabel: 'many_quiet' };
  }

  // Stable or new
  if (total_contacts > 0) {
    return { status: 'healthy', statusLabel: 'stable' };
  }

  return { status: 'healthy', statusLabel: 'just_starting' };
}

/**
 * Assess calendar/scheduling health
 */
export function assessCalendarHealth(stats: BusinessStats): CardHealth {
  const { bookings_30d, upcoming_count } = stats.scheduling;

  // Active calendar with upcoming bookings
  if (bookings_30d > 5 && upcoming_count > 0) {
    return { status: 'healthy', statusLabel: 'busy' };
  }

  // Some activity
  if (bookings_30d > 0 || upcoming_count > 0) {
    return { status: 'healthy', statusLabel: 'active' };
  }

  // No bookings
  return { status: 'watch', statusLabel: 'quiet' };
}

/**
 * Assess payments collection health
 */
export function assessCollectionHealth(stats: BusinessStats): CardHealth {
  const { pending_invoices } = stats.payments;

  if (pending_invoices === 0) {
    return { status: 'healthy', statusLabel: 'all_collected' };
  }

  if (pending_invoices <= 2) {
    return { status: 'watch', statusLabel: 'some_pending' };
  }

  return { status: 'action', statusLabel: 'many_pending' };
}

/**
 * Get all card health assessments
 */
export function assessAllCards(stats: BusinessStats) {
  return {
    overall: assessOverallHealth(stats),
    money: assessMoneyHealth(stats),
    people: assessPeopleHealth(stats),
    calendar: assessCalendarHealth(stats),
    collection: assessCollectionHealth(stats)
  };
}
