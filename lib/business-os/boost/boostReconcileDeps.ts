import 'server-only';

/**
 * Production wiring of the boost reconcile pass (credits boost slice 4b.2).
 * Used by the `bos-billing-reconcile` cron (through `reconcilePasses.ts`) and by
 * the admin trigger route.
 *
 * Service role by design (durable-queue-drain Step 9, tenant-isolation-guard
 * Step 6): a cron has no user session. The reads are cross-account by row, and
 * every effect runs through 2b's functions on the row's own id, which return
 * the row's account (R-6). The repository is loaded lazily, as in the webhook
 * wiring, so importing this module creates no client.
 *
 * @module lib/business-os/boost/boostReconcileDeps
 */

import type { BusinessOsBoostPurchaseRepository } from '@/lib/repositories/BusinessOsBoostPurchaseRepository';
import { logAndFlush } from '@/lib/audit/boundedAuditFlush';
import { getBusinessOsStripeClient } from '@/lib/business-os/billing/stripeClient';
import { currentStripeMode, isLiveMode } from '@/lib/business-os/billing/stripeMode';
import { recordBoostReceipt, type BoostReceiptStripePort } from '@/lib/business-os/boost/boostReceipt';
import { createBoostReconcilePass, type BoostReconcileDeps, type BoostReconcileStripePort } from '@/lib/business-os/boost/boostReconcilePass';

async function repository(): Promise<BusinessOsBoostPurchaseRepository> {
  const module = await import('@/lib/repositories/BusinessOsBoostPurchaseRepository');
  return module.businessOsBoostPurchaseRepository;
}

const purchases: BoostReconcileDeps['purchases'] = {
  listForReconcile: async (input) => (await repository()).listForReconcile(input),
  // C-2's re-read: the row by its own id, which the pass read from our table a
  // moment ago (never an id from a request or from Stripe).
  reread: async (purchaseId) => (await repository()).findByIdForWebhook(purchaseId),
  credit: async (input) => (await repository()).credit(input),
  transition: async (input) => (await repository()).transition(input),
  recordReceipt: async (input) => (await repository()).recordReceipt(input),
};

function stripeClient(): (BoostReconcileStripePort & BoostReceiptStripePort) | null {
  try {
    // The SDK's methods take wider parameter types than these ports name.
    return getBusinessOsStripeClient() as unknown as BoostReconcileStripePort & BoostReceiptStripePort;
  } catch {
    return null;
  }
}

function keyLivemode(): boolean | null {
  try {
    return isLiveMode(currentStripeMode());
  } catch {
    return null;
  }
}

export const boostReconcileDeps: BoostReconcileDeps = {
  purchases,
  stripe: stripeClient,
  keyLivemode,
  audit: (entry, log) => logAndFlush(entry, log, { reason: 'boost reconcile', continues: 'the reconcile outcome is unaffected' }),
  receipt: (input, log) => recordBoostReceipt(input, { stripe: stripeClient, keyIsLive: keyLivemode, purchases }, log),
  clock: () => Date.now(),
  // SA CR-1: a finding on a row that cannot be flagged is audited only once.
  findingRecorded: async (input) => {
    const { auditTrailRepository } = await import('@/lib/repositories/AuditTrailRepository');
    const found = await auditTrailRepository.hasFindingEntry(input);
    return found.error ? null : found.data;
  },
};

/** The boost pass of `bos-billing-reconcile`. */
export const boostReconcilePass = createBoostReconcilePass(boostReconcileDeps);
