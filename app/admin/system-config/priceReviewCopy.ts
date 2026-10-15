/**
 * Every new string of the Model pricing comparison (AI model price review
 * slice 4). Flag words are NOT here: they live once, in
 * `lib/ai/pricing-research/lineFlags.ts` (`FLAG_LABELS`, SA RC-3).
 *
 * A plain module: no imports, no 'use client'.
 */

export const PRICE_REVIEW_NOTE =
  'Nothing in the provider column is charged yet. Applying a new price, checking provider prices automatically, and each model’s price history come in later releases. Until then, Sync and Edit still change live prices directly.';

export const NO_PENDING_NOTICE =
  'No provider prices entered yet, so every row reads No new price. Use Enter provider price to add one.';

export const NO_MODELS_LINE = 'No models to show.';

export const ENTER_PROVIDER_PRICE = 'Enter provider price';

export const NEEDS_A_REASON = 'needs a reason to apply';

export const SORT_LABEL = 'Sort';

export type PriceSortMode = 'recommended' | 'undercharged' | 'above';

export const SORT_OPTIONS: ReadonlyArray<{ value: PriceSortMode; label: string }> = [
  { value: 'recommended', label: 'Recommended (undercharged first)' },
  { value: 'undercharged', label: 'Most undercharged first' },
  { value: 'above', label: 'Furthest above provider first' },
];

/** How "ours" is set, in words; nothing is shown for a stored table price. */
export const BASIS_WORDS: Readonly<Record<string, string>> = {
  in_code_fallback: 'built-in fallback',
  image_setting: 'image setting',
  derived: 'derived: half of input',
  unpriced: 'not priced',
};

export const STATUS_WORDS = {
  undercharging: 'Undercharging',
  covered: 'Covered',
  noNewPrice: 'No new price',
  newModel: 'New model',
  notCompared: 'Not compared',
} as const;

export const ROW_STATE_WORDS = {
  retired: 'Retired',
  startsLater: 'Starts',
  superseded: 'Superseded by a newer row, not charged',
} as const;

export const SOURCE_WORDS = {
  link: 'Provider page',
  checked: 'Checked',
  enteredBy: 'Entered by',
  crossCheck: 'Cross-check:',
} as const;

export const CACHED_PREFIX = 'cached:';

/** Under the model of a charged stored row (SA F-1): when its price took effect. */
export const IN_EFFECT_SINCE = 'In effect since';

export const EDIT_UNIT_WORDS = 'per token';

export const FORM_WORDS = {
  title: 'Enter a provider price',
  intro:
    'Saved as a pending price only. No charge changes until it is applied. Prices are in USD per 1M tokens, or per image.',
  kindLegend: 'Price for',
  kindToken: 'Tokens',
  kindImage: 'Image',
  provider: 'Provider',
  providerPlaceholder: 'Choose a provider',
  providerRequired: 'Choose a provider',
  model: 'Model id',
  input: 'Input per 1M',
  output: 'Output per 1M',
  cached: 'Cached input per 1M (optional)',
  size: 'Image size',
  quality: 'Quality',
  price: 'Price per image',
  source: 'Official source URL',
  sourceHint: 'Must be an https page on:',
  checkedOn: 'Checked on',
  save: 'Save as pending',
  saving: 'Saving…',
  close: 'Close',
  saved: 'Saved as a pending price. No charge changes until it is applied.',
  replaced: 'It replaced an earlier pending price for the same model.',
  fallbackError: 'Could not save the price. Try again in a moment.',
  refusedLine: 'This price',
  /** A refusal found in the browser, before anything is sent (SA F-2). */
  checkFields: 'Check the fields marked below.',
} as const;

/** The field names a server problem path can name (`lines.0.<field>`). */
export const FIELD_WORDS: Readonly<Record<string, string>> = {
  provider: 'Provider',
  model_name: 'Model id',
  input_per_1m: 'Input per 1M',
  output_per_1m: 'Output per 1M',
  cached_input_per_1m: 'Cached input per 1M',
  image_size: 'Image size',
  image_quality: 'Quality',
  price_per_image: 'Price per image',
  source_url: 'Official source URL',
  checked_on: 'Checked on',
  kind: 'Price for',
};
