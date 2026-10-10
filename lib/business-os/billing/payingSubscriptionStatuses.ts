// lib/business-os/billing/payingSubscriptionStatuses.ts
//
// What counts as a PAYING plan subscription on the admin finance & business
// health page (slice 1a, SA-Q5): the account's live billing row has one of
// these statuses AND has not ended. Live mode is the reader's job (the finance
// read filters `livemode = true`).
//
// Deliberately its own set, not derived from the checkout's "live" statuses or
// the deletion refusal's: those answer "may we still be charging?" and include
// trialing, unpaid, incomplete and paused, which are not money received. This
// answers "is this account paying us now?".
//
// A plain literal with no import from the data layer (SA-W2, option B): this
// directory's placement guard allows only listed files to reach the database
// layer, type-only imports included. Instead of a type annotation, the
// co-located test reads the billing-accounts migration and checks every member
// against its `business_os_billing_accounts_status_known` CHECK list, at
// runtime.

/** Subscription statuses that mean the account is paying for its plan now. */
export const PAYING_SUBSCRIPTION_STATUSES = ['active', 'past_due'] as const;

export type PayingSubscriptionStatus = (typeof PAYING_SUBSCRIPTION_STATUSES)[number];

const PAYING: ReadonlySet<string> = new Set<string>(PAYING_SUBSCRIPTION_STATUSES);

/** True when this live billing row is paying now: a paying status and no end. */
export function isPayingBillingRow(row: { subscription_status: string | null; ended_at: string | null }): boolean {
  return row.subscription_status !== null && PAYING.has(row.subscription_status) && row.ended_at === null;
}
