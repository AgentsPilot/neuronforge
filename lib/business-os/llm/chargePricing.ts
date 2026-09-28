// lib/business-os/llm/chargePricing.ts
//
// Business OS credit deduction, slice 2 ("No $0 cost"): the price of one AI
// action FOR A CHARGE, pure and unwired. Slice 3 writes its result to the
// charge row; in slice 2 nothing outside tests imports this module.
//
// Each call is classified by `classifyCallForCharge` (chargeClassification.ts).
// A measured call is charged its recorded cost, unrounded (SQ-8). A call
// without a usable price is charged the CONSERVATIVE rate: the highest in-code
// rate for the same provider and kind, so the fallback can over-charge but
// never give an action away (SQ-9, KI-2). The rates are computed from the
// in-code tables, never typed, and lazily, on first use (SA S-2), so a test
// that partially mocks `SystemConfigRepository` cannot break on import.
//
// Server-only: `SystemConfigRepository` loads `supabaseServer` at import.

import { inCodeTokenPrices, isInputOnlyPricedModel } from '@/lib/ai/pricing';
import type { UsageCallRecord } from '@/lib/ai/usageScope';
import { IMAGE_FALLBACK_PRICING } from '@/lib/repositories/SystemConfigRepository';
import { classifyCallForCharge, type ChargeKind, type ClassifiedCall } from './chargeClassification';

/** One call, priced for a charge. */
export interface PricedCall extends ClassifiedCall {
  /** USD, unrounded. The recorded cost when measured; the conservative figure otherwise. */
  costUsd: number;
}

/** One action, priced for a charge. */
export interface PricedAction {
  /** USD, the unrounded sum of every call's `costUsd`. Never read from the audit entry (SQ-8). */
  costUsd: number;
  /** True when any call was charged at the conservative rate. Slice 3 writes it on the charge row. */
  isFallbackPriced: boolean;
  fallbackCallCount: number;
  calls: readonly PricedCall[];
}

/**
 * One conservative rate and where it came from, per side (D-0 S-3), so SA can
 * sign the figures off (N-5) and slice 4 can explain an adjustment.
 */
export interface ConservativeRate {
  kind: ChargeKind;
  /** The provider the rate is for; `*` for a rate that serves every provider. */
  provider: string;
  /** `provider`: from that provider's own rows. `all_providers`: the maximum across every provider. */
  scope: 'provider' | 'all_providers';
  /** USD per 1,000 input tokens (text, embedding). */
  inputPer1k?: number;
  /** USD per 1,000 output tokens (text). */
  outputPer1k?: number;
  /** USD per image (image). */
  perImage?: number;
  inputFrom?: string;
  outputFrom?: string;
  imageFrom?: string;
}

interface RateTable {
  /** Per provider, per token kind. */
  byProvider: Map<string, Partial<Record<'text' | 'embedding', ConservativeRate>>>;
  allText: ConservativeRate;
  allEmbedding: ConservativeRate;
  image: ConservativeRate;
  derivation: readonly ConservativeRate[];
}

let rates: RateTable | undefined;

/** The largest entry, the first in table order on a tie. */
function maxOf(entries: Array<[string, number]>): { value: number; from: string } | undefined {
  let best: { value: number; from: string } | undefined;
  for (const [from, value] of entries) {
    if (Number.isFinite(value) && value > 0 && (!best || value > best.value)) best = { value, from };
  }
  return best;
}

function textRate(provider: string, scope: ConservativeRate['scope'], models: Array<[string, { input: number; output: number }]>): ConservativeRate | undefined {
  const input = maxOf(models.map(([m, p]) => [m, p.input]));
  const output = maxOf(models.map(([m, p]) => [m, p.output]));
  if (!input || !output) return undefined;
  return Object.freeze({
    kind: 'text',
    provider,
    scope,
    inputPer1k: input.value,
    outputPer1k: output.value,
    inputFrom: input.from,
    outputFrom: output.from,
  });
}

function embeddingRate(provider: string, scope: ConservativeRate['scope'], models: Array<[string, { input: number; output: number }]>): ConservativeRate | undefined {
  const input = maxOf(models.map(([m, p]) => [m, p.input]));
  if (!input) return undefined;
  return Object.freeze({ kind: 'embedding', provider, scope, inputPer1k: input.value, inputFrom: input.from });
}

function buildRates(): RateTable {
  const table = inCodeTokenPrices();
  const byProvider: RateTable['byProvider'] = new Map();
  const allTextModels: Array<[string, { input: number; output: number }]> = [];
  const allEmbeddingModels: Array<[string, { input: number; output: number }]> = [];
  const derivation: ConservativeRate[] = [];

  for (const [provider, models] of Object.entries(table)) {
    const text: Array<[string, { input: number; output: number }]> = [];
    const embedding: Array<[string, { input: number; output: number }]> = [];
    for (const [model, price] of Object.entries(models)) {
      // D-0 Q-7: input-only models are their own class, never part of the text maximum.
      (isInputOnlyPricedModel(provider, model) ? embedding : text).push([model, price]);
    }
    allTextModels.push(...text.map(([m, p]): [string, { input: number; output: number }] => [`${provider}:${m}`, p]));
    allEmbeddingModels.push(...embedding.map(([m, p]): [string, { input: number; output: number }] => [`${provider}:${m}`, p]));

    const entry: Partial<Record<'text' | 'embedding', ConservativeRate>> = {};
    const t = textRate(provider, 'provider', text);
    const e = embeddingRate(provider, 'provider', embedding);
    if (t) {
      entry.text = t;
      derivation.push(t);
    }
    if (e) {
      entry.embedding = e;
      derivation.push(e);
    }
    byProvider.set(provider, entry);
  }

  const allText = textRate('*', 'all_providers', allTextModels);
  if (!allText) {
    // The in-code table ships priced chat models; an empty one is a build defect.
    throw new Error('chargePricing: the in-code token price table has no priced text model');
  }
  // With no input-only model anywhere, the text rate is the conservative stand-in (it is higher).
  const allEmbedding =
    embeddingRate('*', 'all_providers', allEmbeddingModels) ??
    Object.freeze({ kind: 'embedding' as const, provider: '*', scope: 'all_providers' as const, inputPer1k: allText.inputPer1k, inputFrom: allText.inputFrom });

  const imageMax = maxOf(Object.entries(IMAGE_FALLBACK_PRICING));
  if (!imageMax) throw new Error('chargePricing: IMAGE_FALLBACK_PRICING has no positive price');
  // OpenAI is the only image provider, and the fallback prices are keyed by
  // model, size and quality, not provider: one rate serves every image.
  const image: ConservativeRate = Object.freeze({
    kind: 'image',
    provider: '*',
    scope: 'all_providers',
    perImage: imageMax.value,
    imageFrom: imageMax.from,
  });

  derivation.push(allText, allEmbedding, image);
  return { byProvider, allText, allEmbedding, image, derivation: Object.freeze(derivation) };
}

function getRates(): RateTable {
  if (!rates) rates = buildRates();
  return rates;
}

/** The conservative rate for a kind and provider: the provider's own, else the all-providers maximum (D-0 Q-2). */
function rateFor(kind: ChargeKind, provider: unknown): ConservativeRate {
  const table = getRates();
  if (kind === 'image') return table.image;
  const own = typeof provider === 'string' ? table.byProvider.get(provider)?.[kind] : undefined;
  if (own) return own;
  return kind === 'text' ? table.allText : table.allEmbedding;
}

/** A usable token count, or 0: a malformed count never raises or lowers a charge by itself. */
function tokens(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * The conservative figure for one call. The FULL recorded input tokens, the
 * cached-input discount deliberately ignored: this path is meant to
 * over-charge, never under-charge (SA N-6, KI-9). An image is one image per
 * call (the provider refuses any other `n`).
 */
function conservativeCost(call: UsageCallRecord, kind: ChargeKind): number {
  const rate = rateFor(kind, call?.provider);
  if (kind === 'image') return rate.perImage ?? 0;
  const input = (tokens(call?.inputTokens) / 1000) * (rate.inputPer1k ?? 0);
  // An embedding has no completion side.
  const output = kind === 'text' ? (tokens(call?.outputTokens) / 1000) * (rate.outputPer1k ?? 0) : 0;
  return input + output;
}

/**
 * Price one action for a charge. Pure and silent (the loud log is
 * `reportUnpricedCalls`, already live in `runAiAction`); never throws on a
 * record. Slice 3 wires it.
 */
export function priceActionForCharge(calls: readonly UsageCallRecord[]): PricedAction {
  const priced: PricedCall[] = calls.map((call) => {
    const classified = classifyCallForCharge(call);
    const costUsd =
      classified.basis === 'conservative_fallback'
        ? conservativeCost(call, classified.kind)
        : call.costUsd;
    return { ...classified, costUsd };
  });
  const fallbackCallCount = priced.filter((c) => c.basis === 'conservative_fallback').length;
  return {
    // Unrounded: a 2e-7 USD embedding must stay non-zero (SQ-8).
    costUsd: priced.reduce((sum, c) => sum + c.costUsd, 0),
    isFallbackPriced: fallbackCallCount > 0,
    fallbackCallCount,
    calls: priced,
  };
}

/** Every conservative rate and its source models, for SA sign-off (N-5) and slice 4. */
export function conservativeRateDerivation(): readonly ConservativeRate[] {
  return getRates().derivation;
}
