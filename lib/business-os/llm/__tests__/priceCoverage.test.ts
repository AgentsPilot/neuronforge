/**
 * Deduction layer slice 2: price coverage of every Business OS code default
 * (SA-S2, FR-12e), adding ONLY what is not already proven elsewhere.
 *
 * Already proven, and cited rather than copied:
 *   - every token default passes the DEC-7 price guardrail (> 0 on both
 *     sides), and every default image size x low/medium/high has a fallback
 *     price > 0: `modelSettingsPolicy.test.ts` ("code defaults are themselves
 *     valid", T1-3);
 *   - a DB-selected model is refused at runtime unless priced > 0 on both
 *     sides: DEC-7, `modelSettings.test.ts`.
 *
 * SA-S2's residual holes, and which this file closes:
 *   1. the embedding default behind the four excluded chat calls is a literal
 *      in EmbeddingService, outside the policy: CLOSED here (item 1);
 *   2. the new price signal could drift from the DEC-7 guardrail: CLOSED here
 *      (item 2 ties `getPriceStatusSync` to every token default);
 *   3. the image signal assumes "a resolver price of 0 means unpriced": PINNED
 *      here (item 3, through the real resolver);
 *   4. the conservative fallback could be cheaper than a default it stands in
 *      for: CLOSED here (item 4);
 *   5. a model priced only in the DB on a cold instance whose load failed: NOT
 *      closable by a test; it is caught at charge time by rule 7 + SA C-1
 *      (`zero_cost_with_tokens`) and logged by `reportUnpricedCalls`.
 */

jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

// The REAL pricing module, with the database read returning nothing, so every
// assertion is against the in-code table the product ships.
jest.mock('@/lib/repositories/AiModelPricingRepository', () => ({
  aiModelPricingRepository: { listActive: jest.fn().mockResolvedValue({ data: [], error: null }) },
}));

import * as fs from 'fs';
import * as path from 'path';

import { getPriceStatusSync, inCodeTokenPrices, isInputOnlyPricedModel } from '@/lib/ai/pricing';
import { BOS_LLM_AREAS } from '../callCatalog';
import {
  bosLlmSettingsCallNames,
  getBosLlmCallPolicy,
  IMAGE_PRICE_REQUIRED_QUALITIES,
  type BosLlmCallPolicy,
} from '../modelSettingsPolicy';
import { IMAGE_FALLBACK_PRICING, IMAGE_GENERATION_CONFIG_DEFAULTS } from '@/lib/repositories/SystemConfigRepository';
import { resolveImagePrice } from '@/lib/services/GeneratedImageService';
import { conservativeRateDerivation } from '../chargePricing';

const ROOT = path.resolve(__dirname, '../../../..');
const EMBEDDING_DEFAULT_KEY = 'helpbot_embedding_model';

/** Every configurable default, with its policy. */
function defaults(): Array<{ area: string; callName: string; policy: BosLlmCallPolicy }> {
  return BOS_LLM_AREAS.flatMap((area) =>
    bosLlmSettingsCallNames(area).map((callName) => ({
      area,
      callName,
      policy: getBosLlmCallPolicy(area, callName) as BosLlmCallPolicy,
    }))
  );
}

/**
 * The string-literal default after EACH occurrence of the key in
 * EmbeddingService (`getSetting('helpbot_embedding_model', '<default>')`).
 * Returns one entry per occurrence, `null` where the default is not a plain
 * literal, so a refactor to an identifier fails loudly (D-0 S-4).
 */
function embeddingDefaults(): Array<string | null> {
  const source = fs.readFileSync(path.join(ROOT, 'lib/services/EmbeddingService.ts'), 'utf8');
  const occurrences = source.split(`'${EMBEDDING_DEFAULT_KEY}'`).length - 1;
  const found: Array<string | null> = [];
  let from = 0;
  for (let i = 0; i < occurrences; i++) {
    const at = source.indexOf(`'${EMBEDDING_DEFAULT_KEY}'`, from);
    from = at + EMBEDDING_DEFAULT_KEY.length + 2;
    const match = source.slice(from).match(/^\s*,\s*'([^']+)'\s*\)/);
    found.push(match ? match[1] : null);
  }
  return found;
}

describe('1. the embedding default (the excluded chat calls) is priced', () => {
  it('is a plain literal at every occurrence of the key, and every one is priced', () => {
    const found = embeddingDefaults();
    // Two today (EmbeddingService.ts:113, :170). A count mismatch means the
    // parse no longer sees every default: fix the test, do not relax it.
    expect(found.length).toBeGreaterThanOrEqual(1);
    expect(found).not.toContain(null);
    for (const model of found as string[]) {
      expect({ model, status: getPriceStatusSync('openai', model) }).toEqual({ model, status: 'priced' });
      expect(isInputOnlyPricedModel('openai', model)).toBe(true);
    }
  });
});

describe('2. the price signal agrees with the defaults (ties getPriceStatusSync to DEC-7)', () => {
  it('every token default is priced', () => {
    const tokenDefaults = defaults().filter((d) => d.policy.kind === 'token');
    expect(tokenDefaults.length).toBeGreaterThan(0);
    for (const { area, callName, policy } of tokenDefaults) {
      const status = getPriceStatusSync(policy.default.provider, policy.default.model);
      expect({ area, callName, status }).toEqual({ area, callName, status: 'priced' });
    }
  });
});

describe('3. images, through the real resolver', () => {
  it('the default model at every default size and required quality resolves to a price > 0, never unpriced', () => {
    const model = IMAGE_GENERATION_CONFIG_DEFAULTS.model;
    const sizes = Array.from(new Set(Object.values(IMAGE_GENERATION_CONFIG_DEFAULTS.sizes)));
    for (const size of sizes) {
      for (const quality of IMAGE_PRICE_REQUIRED_QUALITIES) {
        const price = resolveImagePrice({}, model, size, quality);
        expect({ size, quality, source: price.source }).not.toEqual({ size, quality, source: 'unpriced' });
        expect(price.usdPerImage).toBeGreaterThan(0);
      }
    }
  });

  it('every IMAGE_FALLBACK_PRICING value is finite and > 0 (the image signal reads 0 as unpriced, D-0 S-2)', () => {
    const values = Object.entries(IMAGE_FALLBACK_PRICING);
    expect(values.length).toBeGreaterThan(0);
    for (const [key, value] of values) {
      expect({ key, ok: Number.isFinite(value) && value > 0 }).toEqual({ key, ok: true });
    }
  });
});

describe('4. the conservative rates are real, and never cheaper than a default they stand in for', () => {
  it('every derived rate is > 0 on every side it has', () => {
    for (const rate of conservativeRateDerivation()) {
      for (const side of [rate.inputPer1k, rate.outputPer1k, rate.perImage]) {
        if (side !== undefined) expect(side).toBeGreaterThan(0);
      }
    }
  });

  it('text: >= every token default of that provider, per side', () => {
    const table = inCodeTokenPrices();
    for (const { area, callName, policy } of defaults().filter((d) => d.policy.kind === 'token')) {
      const { provider, model } = policy.default;
      const price = table[provider]?.[model];
      expect({ area, callName, hasPrice: !!price }).toEqual({ area, callName, hasPrice: true });
      const rate = conservativeRateDerivation().find((r) => r.kind === 'text' && r.provider === provider)!;
      expect(rate.inputPer1k!).toBeGreaterThanOrEqual(price.input);
      expect(rate.outputPer1k!).toBeGreaterThanOrEqual(price.output);
    }
  });

  it('embedding: >= the embedding default', () => {
    const table = inCodeTokenPrices();
    const rate = conservativeRateDerivation().find((r) => r.kind === 'embedding' && r.provider === 'openai')!;
    for (const model of embeddingDefaults() as string[]) {
      expect(rate.inputPer1k!).toBeGreaterThanOrEqual(table.openai[model].input);
    }
  });

  it('image: >= every default size x quality price', () => {
    const rate = conservativeRateDerivation().find((r) => r.kind === 'image')!;
    const model = IMAGE_GENERATION_CONFIG_DEFAULTS.model;
    for (const size of Object.values(IMAGE_GENERATION_CONFIG_DEFAULTS.sizes)) {
      for (const quality of IMAGE_PRICE_REQUIRED_QUALITIES) {
        expect(rate.perImage!).toBeGreaterThanOrEqual(resolveImagePrice({}, model, size, quality).usdPerImage);
      }
    }
  });
});
