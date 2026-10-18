/**
 * Every new string of the Model pricing comparison (AI model price review
 * slice 4). Flag words are NOT here: they live once, in
 * `lib/ai/pricing-research/lineFlags.ts` (`FLAG_LABELS`, SA RC-3).
 *
 * A plain module: no imports, no 'use client'.
 */

export const PRICE_REVIEW_NOTE =
  'Nothing in the provider column is charged until someone applies it. Check provider prices reads OpenAI’s official pricing page; Anthropic, Google and Kimi prices are entered by hand for now. Apply makes a provider price the live price for that model; Dismiss drops it. History shows every stored price of a model, and who changed it and why.';

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

/** Slice 8: Apply, Dismiss and the margin review prompt (MP-FR-8, MP-FR-10, MP-FR-14; UF-3). */
export const APPLY_WORDS = {
  apply: 'Apply',
  dismiss: 'Dismiss',
  applySelected: 'Apply selected',
  select: 'Select for bulk apply',
  applyTitle: 'Apply provider prices',
  dismissTitle: 'Dismiss provider prices',
  applyIntro:
    'Applying makes each price below the live price for its model. Charges use it on every server within 1 hour; charges already recorded never change. Plans, allowances and credits do not change.',
  dismissIntro: 'Dismissing drops the provider prices below. No charge changes.',
  ours: 'ours',
  provider: 'provider',
  reason: 'Reason',
  reasonHint: 'Pre-filled from the provider page; edit it if needed.',
  dismissReason: 'Reason for dismissing',
  override: 'Override reason (required: this price is flagged)',
  overrideHint: 'Say why it is right to apply this price despite the flag.',
  reasonTooShort: 'Write at least 3 characters.',
  confirmApply: 'Apply now',
  confirmDismiss: 'Dismiss now',
  working: 'Working…',
  cancel: 'Cancel',
  appliedAt: 'Applied at',
  dismissed: 'Dismissed. No charge changed.',
  marginFollows: 'A model Business OS uses changed: check plan margins in the prompt below.',
  imageSetIncomplete:
    'Business OS will keep refusing this image model until every size is priced at low, medium and high.',
  cachedNotCharged: 'stored, not charged: only OpenAI cached reads are charged',
  cachedRemoved: 'the stored cached rate is removed; half of input applies',
  cachedDerived: 'derived (half of input)',
  lines: 'Lines',
  failedLines: 'Lines refused:',
  tooManyLines: 'Apply takes at most 50 prices at a time. Select fewer rows',
  selectedLines: 'prices selected',
} as const;

export const MARGIN_WORDS = {
  title: 'Check plan margins',
  intro:
    'These price changes touch models Business OS uses. Nothing about plans, allowances or credits changed. Review the credit pricing, then mark this done with a note.',
  link: 'Review credit pricing',
  note: 'Note',
  markDone: 'Mark done',
  saving: 'Saving…',
  appliedBy: 'Applied by',
  fallbackDiffers: 'the built-in fallback price differs: update it by PR',
  noChange: 'no earlier price',
  more: 'More margin reviews are open than shown here. Mark these done to see the rest.',
} as const;

/**
 * Slice 9: the per-model price history drawer (MP-FR-17; SA SC9-2, SC9-4,
 * SC9-6, SC9-7, SC9-10, SC9-11). Words only: no colour carries a status alone
 * (MP-NFR-8). A person is an email, "not on the admin list" or "system".
 */
export const HISTORY_WORDS = {
  button: 'History',
  buttonLabel: 'Price history for',
  title: 'Price history',
  reading: 'the price history',
  readOnly: 'Read only: nothing here changes a price.',
  empty: 'No stored price for this model.',
  emptyBuiltIn: 'Charges use the built-in price list.',
  emptyUnpriced: 'Charges use no price: this model is not priced.',
  truncated: 'Showing the newest 200 prices.',
  auditTruncated: 'Older audit events may not be shown.',
  syncTruncated: 'Older Sync runs may not be shown.',
  deletedFootnote: 'Prices deleted before 2026-10-16 are not listed here; the audit trail page shows any recorded deletion.',
  tokens: 'Tokens',
  image: 'Image',
  inEffect: 'In effect',
  input: 'Input /1M',
  output: 'Output /1M',
  cached: 'Cached input /1M',
  perImage: 'Per image',
  status: 'Status',
  current: 'Charged today',
  startsLater: 'Starts',
  notCharged: 'Stored, not charged',
  retired: 'Retired',
  from: 'from',
  until: 'until',
  storedOn: 'Stored',
  notRecorded: 'not recorded',
  neverCharged: 'Never charged: a newer price for the same date took precedence.',
  notReadable: 'not readable',
  cachedHalf: 'not set (charged at half the input price)',
  cachedNotUsed: 'stored, not used for this provider',
  storedAsZero: 'Stored as 0: not treated as a price.',
  appliedBy: 'Applied by',
  on: 'on',
  reason: 'Reason:',
  overrideReason: 'Override reason:',
  source: 'Source:',
  checked: 'checked',
  enteredBy: 'Entered by',
  byHand: 'by hand',
  byCheck: 'by the provider price check',
  howUnknown: 'how it was entered is not recorded',
  batchOne: 'Applied on its own.',
  batchTogether: 'Applied together with',
  batchOthers: 'other prices.',
  batchOther: 'other price.',
  marginNotNeeded: 'Margin review: not needed.',
  marginOpen: 'Margin review: open.',
  marginDone: 'Margin review: done by',
  provenanceMissing: 'The record of this change could not be read.',
  runbook: 'Changed by operator (emergency SQL runbook).',
  runbookReference: 'Reference: emergency SQL runbook, run log entry for row',
  written: 'written',
  auditIntro: 'Before price review. From the live audit trail:',
  created: 'Created',
  updated: 'Edited',
  zeroSet: 'Set to zero',
  by: 'by',
  asRecorded: 'as recorded',
  valuesNotRecorded: 'values not recorded',
  fromValue: 'from',
  toValue: 'to',
  none: 'Before price review: no record in the live audit trail.',
  cleanup: 'Retired in clean-up 2026-10-11 (duplicate or unused alias row; no charge changed).',
  replaced: 'Replaced by the newer price above; who and why are on that row.',
  retiredNoRecord: 'Retired; no record of why.',
  preReview: 'Before 2026-10-16 Sync could overwrite this stored price in place without a per-model record.',
  syncRan: 'Sync ran on',
  syncNote: '(all models; no per-model record; it may or may not have changed this price).',
  syncUpdated: 'updated',
  syncAdded: 'added',
  syncMore: 'and',
  syncMoreTail: 'more Sync runs in this period.',
  actorSystem: 'system',
  actorNotListed: 'not on the admin list',
  /** SA CR9-2: the entry recorded no actor. */
  actorNotRecorded: 'not recorded',
  /** The help drawer's line (replaces "History (coming later)"). */
  helpTitle: 'History.',
  helpBody: 'The History button on a row lists every stored price of that model, current and retired: when each took effect, when it was replaced, and who changed it and why. It changes nothing.',
} as const;
