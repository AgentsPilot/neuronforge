// lib/business-os/entitlements/config/boostPackages.ts
//
// THE BOOST PACKAGE CATALOGUE — what an owner can buy on top of their plan.
//
// Business OS credits boost, slice 1 (requirement FR-1 to FR-5, FR-42, §8.2,
// SA T-3b, T-10). "Option A", approved by the user 2026-09-30.
//
// ── THE ONLY TYPED NUMBERS ARE THE PRICE AND THE BONUS % ────────────────────
// Base, bonus and total credits are DERIVED (boostCatalogue.ts) from the price
// and the computed retail rate (retailRate.ts), and the bonus % shown to the
// owner is recomputed from those credits (FR-42). Do not add a credits field or
// a bonus label here: the schema refuses unknown keys, and labels may not
// contain a digit or "%".
//
// ── CHANGING A PACKAGE ──────────────────────────────────────────────────────
// Any change to a package (price, bonus, labels, active) bumps its `version`,
// and the new `(id, version)` is appended to `boostPackages.snapshot.json` in the
// same PR. Released snapshot records are never edited or removed (FR-4: a past
// purchase keeps the meaning it was sold under). A markup change (a new entry in
// creditRetail.ts) means re-pointing every package's `retailVersion` and bumping
// its version; until then the catalogue is invalid and the checkout refuses.
//
// Labels: English in all three locales for now (FR-1); native he/es copy is a
// slice 5 item. Data only: type imports only (RC-7). Read it through the loader
// seam in boostCatalogue.ts, never directly.

import type { Labels } from '../types';

export interface BoostPackageLabels {
  name: Labels;
  description: Labels;
  /** Optional marketing badge ("Most popular"). Never carries a figure. */
  badge?: Labels;
}

export interface BoostPackageConfig {
  /** Stable slug. */
  id: string;
  /** Bumped on any change to this package (FR-4). */
  version: number;
  /** Price in minor units (cents). */
  priceMinor: number;
  currency: 'USD';
  /** Prices exclude tax (§9 TX-1). */
  taxExclusive: true;
  /** Whole-number bonus over the standard rate, 0 to 50. */
  bonusPercent: number;
  active: boolean;
  /** Display order among active packages. */
  order: number;
  labels: BoostPackageLabels;
  /** The CREDIT_RETAIL_HISTORY version the package was priced against; must be current. */
  retailVersion: number;
}

const en = (text: string): Labels => ({ en: text, he: text, es: text });

/**
 * Freezes every nested object, so no caller can change a price, a label or the
 * cap for the life of a server instance (SA CR-1). Local on purpose: this file
 * stays free of run-time imports (RC-7).
 */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
    Object.freeze(value);
  }
  return value;
}

export const BOOST_PACKAGES = deepFreeze([
  {
    id: 'starter',
    version: 1,
    priceMinor: 1000,
    currency: 'USD',
    taxExclusive: true,
    bonusPercent: 0,
    active: true,
    order: 1,
    labels: {
      name: en('Starter'),
      description: en('A one-off top-up of credits at the standard rate.'),
    },
    retailVersion: 1,
  },
  {
    id: 'plus',
    version: 1,
    priceMinor: 2500,
    currency: 'USD',
    taxExclusive: true,
    bonusPercent: 10,
    active: true,
    order: 2,
    labels: {
      name: en('Plus'),
      description: en('A one-off top-up of credits with a bonus.'),
      badge: en('Most popular'),
    },
    retailVersion: 1,
  },
  {
    id: 'max',
    version: 1,
    priceMinor: 5000,
    currency: 'USD',
    taxExclusive: true,
    bonusPercent: 15,
    active: true,
    order: 3,
    labels: {
      name: en('Max'),
      description: en('A one-off top-up of credits with the largest bonus.'),
      badge: en('Best value'),
    },
    retailVersion: 1,
  },
] as const satisfies readonly BoostPackageConfig[]);

/**
 * The default purchase cap: pre-tax package prices per account per rolling
 * window (FR-20). Per-account overrides are boost slices 2 and 6 (FR-22).
 */
export interface BoostPurchaseCap {
  amountMinor: number;
  currency: 'USD';
  windowDays: number;
}

export const BOOST_PURCHASE_CAP_DEFAULT = deepFreeze({
  amountMinor: 15000,
  currency: 'USD',
  windowDays: 30,
} as const satisfies BoostPurchaseCap);
