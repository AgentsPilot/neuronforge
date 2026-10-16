/**
 * Every new string of the Model pricing comparison (AI model price review
 * slice 4). Flag words are NOT here: they live once, in
 * `lib/ai/pricing-research/lineFlags.ts` (`FLAG_LABELS`, SA RC-3).
 *
 * A plain module: no imports, no 'use client'.
 */

export const PRICE_REVIEW_NOTE =
  'Nothing in the provider column is charged yet. Check provider prices reads OpenAI’s official pricing page; Anthropic, Google and Kimi prices are entered by hand for now. Applying a new price and each model’s price history come in later releases. Until then, no live price can be changed on this page.';

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

/** Slice 5: the "Check provider prices" button and its status lines. */
export const PRICE_CHECK_WORDS = {
  button: 'Check provider prices',
  busy: 'Checking provider prices…',
  heading: 'Provider price check',
  statusUnavailable: 'The last check could not be loaded.',
  notChecked: 'not checked yet.',
  pricesRead: 'prices read',
  needManual: 'need manual entry',
  notOnPage: 'not on the page',
  refused: 'refused by the safety limits',
  enterByHand: 'Enter prices by hand.',
  lastSuccess: 'Last successful check:',
  lastFailure: 'Last failure:',
  at: 'at',
  crossCheckName: 'Second price list (LiteLLM):',
  agree: 'agree',
  differ: 'differ',
  notListed: 'not listed',
  crossCheckUnavailable: 'unavailable; prices still loaded',
  manualForNow: 'manual entry for now.',
  images: 'Image prices: manual entry (OpenAI publishes them only in a calculator).',
  stored: 'Saved as pending prices. Nothing is charged until a price is applied.',
  needsManualList: 'Needs manual entry',
  notFoundList: 'Not on the provider page',
} as const;

export const PROVIDER_NAMES: Readonly<Record<string, string>> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  kimi: 'Kimi',
};

/** A failed source's outcome, in words. `http_<status>` is read by prefix, never parsed. */
export function sourceOutcomeWords(outcome: string): string {
  switch (outcome) {
    case 'timeout':
      return 'the page did not answer within 10 seconds';
    case 'network_error':
      return 'the page could not be reached';
    case 'blocked':
      return 'the provider blocked the check';
    case 'layout_changed':
      return 'the pricing page layout changed; no prices were read';
    case 'too_large':
      return 'the page was larger than expected';
    default:
      return outcome.startsWith('http_') ? `the page answered with status ${outcome.slice('http_'.length)}` : 'the stored result could not be read';
  }
}

export const NEEDS_MANUAL_WORDS: Readonly<Record<string, string>> = {
  cell_not_single_price: 'the price cell is not exactly one price',
  missing_price: 'a price is missing',
  listed_twice: 'listed more than once',
  wrong_cell_count: 'the row has an unexpected number of cells',
  ambiguous_match: 'the name matches more than one model',
};

/** Page layout slice (UF-7, 2026-10-16): the KPI strip. */
export const KPI_WORDS = {
  undercharging: 'Undercharging',
  pending: 'Pending prices',
  lastCheck: 'Last provider check',
  modelsInUse: 'Models in use',
  noneUndercharging: 'no model is undercharged',
  worst: 'worst',
  notPriced: 'not priced',
  awaitingApply: 'awaiting Apply',
  of: 'of',
  compared: 'compared',
  reading: 'Reading…',
  unavailable: 'Unavailable',
  statusUnavailable: 'The last check could not be loaded.',
  neverChecked: 'Never checked',
  runCheck: 'never checked; use Check provider prices',
  ageUnknown: 'age unknown',
  today: 'today',
  dayAgo: 'day ago',
  daysAgo: 'days ago',
  stale: 'older than 90 days',
} as const;

/** Page layout slice (UF-7): the retired filter. Superseded rows follow it too. */
export const RETIRED_FILTER_WORDS = {
  toggle: 'Show retired',
  hidden: 'retired or superseded rows hidden.',
  hiddenOne: 'retired or superseded row hidden.',
} as const;

/** Page layout slice (UF-7): the help button and drawer title. */
export const HELP_WORDS = {
  button: 'About model pricing',
  title: 'About model pricing',
} as const;
