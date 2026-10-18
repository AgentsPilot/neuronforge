/**
 * The price adapter registry (AI model price review slice 10; SA O-4, SC10-7).
 * Pure: provider → parser, nothing else. Never a model name (RR-1).
 *
 * Keyed by `AdapterProvider`, which is derived from `PROVIDER_FETCH_MODE`, so
 * the type checker refuses a registry that misses an `'adapter'` provider or
 * names a `'manual'` one; a test pins the same at run time. Each provider's
 * fetched URL lives in `PRICE_SOURCES` and its stored page URL in
 * `PRICE_PAGE_URLS` (`fetchSources.ts`, the one outbound door).
 */

import { parseAnthropicPricing, type AnthropicAnchorId } from './anthropicPricingAdapter';
import type { AdapterProvider, NameNote, NeedsManualEntry } from './fetchOutcomes';
import { parseOpenAiPricing, type AnchorId as OpenAiAnchorId } from './openaiPricingAdapter';

/** One token price as the page writes it (digits as text, never a float). */
export interface AdapterTokenPrice {
  model_name: string;
  input_per_1m: string;
  output_per_1m: string;
  cached_input_per_1m?: string;
}

export interface AdapterParseResult {
  outcome: 'ok' | 'layout_changed';
  failedAnchor?: OpenAiAnchorId | AnthropicAnchorId;
  lines: AdapterTokenPrice[];
  needsManual: NeedsManualEntry[];
  notFound: string[];
  nameNotes: NameNote[];
  /** Models whose row lists a cache price that is deliberately not proposed (SA O-3). */
  cacheListed: string[];
}

export interface AdapterParseOptions {
  coverage: ReadonlySet<string>;
  isInputOnly: (model: string) => boolean;
}

export interface PriceAdapter {
  parse: (text: string, options: AdapterParseOptions) => AdapterParseResult;
}

export const PRICE_ADAPTERS: { readonly [P in AdapterProvider]: PriceAdapter } = {
  openai: {
    // OpenAI's cached price IS proposed (it is charged), so nothing is listed-only.
    parse: (text, options) => ({ ...parseOpenAiPricing(text, options), cacheListed: [] }),
  },
  anthropic: {
    parse: (text, options) => parseAnthropicPricing(text, { coverage: options.coverage }),
  },
};
