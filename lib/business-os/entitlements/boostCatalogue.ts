// lib/business-os/entitlements/boostCatalogue.ts
//
// THE BOOST CATALOGUE LOADER SEAM — the one way to read what an owner can buy.
//
// Business OS credits boost, slice 1 (requirement FR-1 to FR-5, FR-42, SA T-3
// (b)–(c), workplan BUSINESS_OS_CREDITS_BOOST_SLICE_1_WORKPLAN.md §3.4).
//
// ── WHAT LIVES HERE ─────────────────────────────────────────────────────────
// The data is `config/boostPackages.ts` (data only, RC-7). This file holds the
// Zod schema, the integer derivation of credits, the computed bonus %, the
// whole-catalogue validation and the `BoostPackageSource` seam — the pairing
// `source.ts` + `schema.ts` already uses for the entitlement config.
//
// ── WHY A SEAM ──────────────────────────────────────────────────────────────
// Packages are code today. When they move to a table, a DB-backed source runs
// the same `validateBoostCatalogue` and implements the same two methods; the
// checkout, the webhook, the UI and the ledger do not change (FR-3).
//
// ── FAILS CLOSED, LAZILY ────────────────────────────────────────────────────
// Nothing is validated at import time, so a bad catalogue cannot break a cold
// start (RC-7). The first `listActive` / `getActive` call validates; an invalid
// catalogue REJECTS with `BoostCatalogueInvalidError` (an empty list would make
// a broken catalogue look like "nothing to sell"). The caller logs and refuses
// the checkout. The result is memoised per source instance; a memoised failure
// is acceptable because the catalogue is code and the fix is a deploy (SA C-3).
//
// Every resolved package is a deep-frozen copy, its labels copied rather than
// shared with the config, so no caller can change a price, credits or a label
// for the rest of the instance through the memo (SA CR-1).
//
// An invalid INACTIVE package still fails the whole catalogue, on purpose: a
// retired package that no longer resolves is still a config defect, and the
// snapshot keeps its released record anyway (SA CR-3).
//
// Pure apart from that memo: no I/O, no logging (the caller logs).

import { z } from 'zod';
import type { Labels } from './types';
import {
  BOOST_PACKAGES,
  BOOST_PURCHASE_CAP_DEFAULT,
  type BoostPackageConfig,
} from './config/boostPackages';
import { baseCreditsFor, currentRetailRate, type RetailRate, type RetailRateResult } from './retailRate';

/** What every consumer reads: the config plus everything derived from it. */
export interface BoostPackage {
  id: string;
  version: number;
  priceMinor: number;
  currency: 'USD';
  taxExclusive: true;
  /** Credits the price buys at the standard rate. Derived. */
  baseCredits: number;
  /** Credits added on top by the bonus. Derived. */
  bonusCredits: number;
  /** base + bonus: what the lot is credited with. Derived. */
  totalCredits: number;
  /** The bonus shown to the owner, recomputed from the credits (FR-42). */
  bonusPercent: number;
  active: boolean;
  order: number;
  labels: { name: Labels; description: Labels; badge: Labels | null };
  /** FR-4: recorded with each purchase so a later change never rewrites it. */
  retailVersion: number;
  creditValueVersion: number;
}

/** The highest bonus a package may carry; catches a 150-for-15 typo (SA Q-4). */
export const BOOST_BONUS_PERCENT_MAX = 50;

// ── Schema ───────────────────────────────────────────────────────────────────

/**
 * Any numeric character (digits in any script, fractions such as ½, Roman
 * numerals) or a percent sign (ASCII, Arabic, fullwidth, small): a figure typed
 * into copy. Number WORDS cannot be caught by a pattern; review covers them.
 */
const FIGURE_IN_COPY = /[\p{N}%\u066A\uFF05\uFE6A]/u;

const labelTextSchema = z
  .string()
  .trim()
  .min(1, 'label is empty')
  .refine((text) => !FIGURE_IN_COPY.test(text), {
    message: 'label contains a digit or "%" (figures are computed, never typed, FR-42)',
  });

const labelsSchema = z.object({ en: labelTextSchema, he: labelTextSchema, es: labelTextSchema }).strict();

const positiveInt = z.number().int().positive();

/**
 * Strict: a hand-typed `baseCredits`, `totalCredits` or bonus label is refused.
 * Typed against the config interface so the compiler checks the pairing (SA CR-2).
 */
export const boostPackageConfigSchema: z.ZodType<BoostPackageConfig> = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]{1,31}$/, 'id must be a lowercase slug'),
    version: positiveInt,
    priceMinor: positiveInt,
    currency: z.literal('USD'),
    taxExclusive: z.literal(true),
    bonusPercent: z.number().int().min(0).max(BOOST_BONUS_PERCENT_MAX),
    active: z.boolean(),
    order: z.number().int(),
    labels: z
      .object({ name: labelsSchema, description: labelsSchema, badge: labelsSchema.optional() })
      .strict(),
    retailVersion: positiveInt,
  })
  .strict();

export const boostPurchaseCapSchema = z
  .object({ amountMinor: positiveInt, currency: z.literal('USD'), windowDays: positiveInt })
  .strict();

// ── Derivation ───────────────────────────────────────────────────────────────

/**
 * The bonus % from credits alone: (total − base) ÷ base × 100, to 2 dp.
 * It takes no rate on purpose: the purchase history computes the shown bonus
 * from the credits stored on the purchase, so a later rate change never
 * rewrites a past purchase (FR-4). `null` for figures that are not credits.
 */
export function bonusPercentFromCredits(baseCredits: number, totalCredits: number): number | null {
  if (!Number.isFinite(baseCredits) || !Number.isFinite(totalCredits)) return null;
  if (baseCredits <= 0 || totalCredits < baseCredits) return null;
  return Math.round(((totalCredits - baseCredits) * 10000) / baseCredits) / 100;
}

/** A copy of locale labels, never the config's own object. */
const copyLabels = (labels: Labels): Labels => ({ en: labels.en, he: labels.he, es: labels.es });

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
    Object.freeze(value);
  }
  return value;
}

export type ResolveResult = { ok: true; package: BoostPackage } | { ok: false; issue: string };

/** One validated config entry at one rate, or the reason it has no whole-credit form. */
export function resolveBoostPackage(config: BoostPackageConfig, rate: RetailRate): ResolveResult {
  const where = `package "${config.id}" v${config.version}`;
  if (config.retailVersion !== rate.retailVersion) {
    return {
      ok: false,
      issue: `${where} is priced against retail version ${config.retailVersion}, current is ${rate.retailVersion}`,
    };
  }
  const baseCredits = baseCreditsFor(config.priceMinor, config.currency, rate);
  if (baseCredits === null) {
    return { ok: false, issue: `${where}: price does not convert to a whole number of credits` };
  }
  const scaledTotal = baseCredits * (100 + config.bonusPercent);
  if (scaledTotal % 100 !== 0) {
    return { ok: false, issue: `${where}: bonus does not give a whole number of credits` };
  }
  const totalCredits = scaledTotal / 100;
  const shownBonus = bonusPercentFromCredits(baseCredits, totalCredits);
  // FR-2's two identities and FR-42's formula in one check: the bonus shown,
  // recomputed from the credits, is the bonus configured.
  if (shownBonus !== config.bonusPercent) {
    return { ok: false, issue: `${where}: computed bonus ${shownBonus}% differs from ${config.bonusPercent}%` };
  }
  return {
    ok: true,
    package: deepFreeze<BoostPackage>({
      id: config.id,
      version: config.version,
      priceMinor: config.priceMinor,
      currency: config.currency,
      taxExclusive: config.taxExclusive,
      baseCredits,
      bonusCredits: totalCredits - baseCredits,
      totalCredits,
      bonusPercent: shownBonus,
      active: config.active,
      order: config.order,
      labels: {
        name: copyLabels(config.labels.name),
        description: copyLabels(config.labels.description),
        badge: config.labels.badge ? copyLabels(config.labels.badge) : null,
      },
      retailVersion: rate.retailVersion,
      creditValueVersion: rate.creditValueVersion,
    }),
  };
}

export type CatalogueValidation = { ok: true; packages: BoostPackage[] } | { ok: false; issues: string[] };

/** The whole catalogue, at a rate, against a cap. Every rule names its issue. */
export function validateBoostCatalogue(
  packages: readonly unknown[],
  rateResult: RetailRateResult,
  cap: unknown
): CatalogueValidation {
  const issues: string[] = [];

  const capParse = boostPurchaseCapSchema.safeParse(cap);
  if (!capParse.success) {
    issues.push(...capParse.error.issues.map((issue) => `cap: ${issue.path.join('.') || '(root)'} ${issue.message}`));
  }
  if (!rateResult.ok) issues.push(`rate: ${rateResult.issue}`);

  const configs: BoostPackageConfig[] = [];
  packages.forEach((raw, index) => {
    const parsed = boostPackageConfigSchema.safeParse(raw);
    if (parsed.success) {
      configs.push(parsed.data);
    } else {
      for (const issue of parsed.error.issues) {
        issues.push(`package[${index}]: ${issue.path.join('.') || '(root)'} ${issue.message}`);
      }
    }
  });

  const seenIds = new Set<string>();
  const seenOrders = new Set<number>();
  for (const config of configs) {
    if (seenIds.has(config.id)) issues.push(`package "${config.id}": duplicate id`);
    seenIds.add(config.id);
    if (config.active) {
      if (seenOrders.has(config.order)) issues.push(`package "${config.id}": duplicate order ${config.order}`);
      seenOrders.add(config.order);
    }
    if (capParse.success && config.priceMinor > capParse.data.amountMinor) {
      issues.push(`package "${config.id}": price is above the purchase cap, so it could never be bought`);
    }
  }
  if (!configs.some((config) => config.active)) issues.push('catalogue has no active package');

  const resolved: BoostPackage[] = [];
  if (rateResult.ok) {
    for (const config of configs) {
      const result = resolveBoostPackage(config, rateResult.rate);
      if (result.ok) resolved.push(result.package);
      else issues.push(result.issue);
    }
  }

  return issues.length > 0 ? { ok: false, issues } : { ok: true, packages: resolved };
}

// ── The seam ─────────────────────────────────────────────────────────────────

/** T-3c. Async so a database-backed source is an implementation swap (FR-3). */
export interface BoostPackageSource {
  /** Active packages only, in display order. Rejects on an invalid catalogue. */
  listActive(): Promise<BoostPackage[]>;
  /** The active package with this id; `null` when unknown or inactive (FR-5). Rejects on an invalid catalogue. */
  getActive(id: string): Promise<BoostPackage | null>;
}

export class BoostCatalogueInvalidError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`Boost catalogue is invalid: ${issues.length} issue(s)`);
    this.name = 'BoostCatalogueInvalidError';
    this.issues = issues;
  }
}

/** What a source validates: the raw packages, the rate and the cap. */
export interface BoostCatalogueInputs {
  packages: readonly unknown[];
  rateResult: RetailRateResult;
  cap: unknown;
}

/**
 * A source over any inputs. `load` runs on first use, never at construction.
 * Each instance has its own memo (SA C-3), so tests build fresh ones.
 */
export function createBoostPackageSource(load: () => BoostCatalogueInputs): BoostPackageSource {
  let memo: CatalogueValidation | null = null;
  const validated = (): BoostPackage[] => {
    if (memo === null) {
      const inputs = load();
      memo = validateBoostCatalogue(inputs.packages, inputs.rateResult, inputs.cap);
    }
    if (!memo.ok) throw new BoostCatalogueInvalidError(memo.issues);
    return memo.packages;
  };
  return {
    async listActive() {
      return validated()
        .filter((pkg) => pkg.active)
        .sort((a, b) => a.order - b.order);
    },
    async getActive(id: string) {
      return validated().find((pkg) => pkg.active && pkg.id === id) ?? null;
    },
  };
}

let codeSource: BoostPackageSource | null = null;

/** The shipped catalogue (`config/boostPackages.ts`) at the current rate. One per process. */
export function codeBoostPackageSource(): BoostPackageSource {
  if (codeSource === null) {
    codeSource = createBoostPackageSource(() => ({
      packages: BOOST_PACKAGES,
      rateResult: currentRetailRate(),
      cap: BOOST_PURCHASE_CAP_DEFAULT,
    }));
  }
  return codeSource;
}

