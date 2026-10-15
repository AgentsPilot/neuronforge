/**
 * The admin price comparison: what we charge today versus the newest pending
 * provider price, per model and unit, with the coverage colour (RR-4) and the
 * Business OS areas using each model (RR-3). Computed on the server on every
 * request; nothing is cached and nothing is written (AI model price review
 * slice 3, workplan §4).
 *
 * "CURRENT" IS WHAT WE CHARGE TODAY (RR-4), unit by unit:
 *   - input and output: the newest active `ai_model_pricing` row (the same rule
 *     as `listActive()`), else the in-code outage table, else nothing;
 *   - cached input: OpenAI only, half the current input, labelled "derived"
 *     (the rule in `openaiProvider.ts`). Until slice 7 no charge reads the
 *     cached-input column, so a stored value there is NOT current. Other
 *     providers: "not compared" (SA O-8);
 *   - image: `resolveImagePrice` (setting, then in-code table), called only for
 *     a key that exists in one of them (SA C-7). `ai_model_image_pricing` has no
 *     reader until slice 7, so it is not current either.
 *
 * EXACT: prices stay decimal strings end to end (`decimal.ts`). The in-code
 * tables hold JS number literals; they are turned back to the decimal they
 * were written as, never computed with.
 *
 * Read-only imports from the charging modules: `inCodeTokenPrices`,
 * `isInputOnlyPricedModel` (lib/ai/pricing.ts), `conservativeRateDerivation`
 * (chargePricing.ts), `resolveImagePrice` and `IMAGE_FALLBACK_PRICING`. None of
 * those files is edited by this slice (SA C-6).
 */

import 'server-only';

import { inCodeTokenPrices, isInputOnlyPricedModel } from '@/lib/ai/pricing';
import { conservativeRateDerivation } from '@/lib/business-os/llm/chargePricing';
import { IMAGE_PRICE_REQUIRED_QUALITIES } from '@/lib/business-os/llm/modelSettingsPolicy';
import { aiModelPricingRepository } from '@/lib/repositories/AiModelPricingRepository';
import { aiPriceProposalRepository } from '@/lib/repositories/AiPriceProposalRepository';
import { adminUserRepository } from '@/lib/repositories/AdminUserRepository';
import { IMAGE_FALLBACK_PRICING, systemConfigRepository } from '@/lib/repositories/SystemConfigRepository';
import type { AiModelPricingExactRow, AiPricePendingLine, AiPriceSubmitLine } from '@/lib/repositories/types';
import { resolveImagePrice } from '@/lib/services/GeneratedImageService';

import { buildAreaTags, modelKey, type AreaTag, type AreaTagResult, type EmbeddingSettingState } from './areaTags';
import { compareUnit, rowCoverage, type CoverageColour, type CurrentBasis, type UnitComparison } from './coverageColour';
import {
  decimalFromNumberLiteral,
  formatDecimal,
  halveDecimal,
  parseDecimal,
  perTokenToPerMillion,
  shiftDecimal,
} from './decimal';
import { FLAG_LABELS, type LineFlagContext, type PendingLineFlag, type UnitPrices } from './lineFlags';
import type { PendingLineInput } from './pendingLineSchema';

/** Shown beside a stored price: the billing reader caches for up to an hour. */
export const STORED_PRICE_NOTE = 'stored price; charges pick a change up within 1 h';

export interface PricingSnapshot {
  activeByKey: Map<string, AiModelPricingExactRow>;
  /** `provider:model` → per-token decimal strings from the in-code outage table. */
  inCodeByKey: Map<string, { input: string; output: string }>;
  areas: AreaTagResult;
  imagePricesUsd: Record<string, number>;
  imageSizes: string[];
  pending: AiPricePendingLine[];
  adminEmailById: Map<string, string>;
}

export interface TokenCurrent {
  basis: 'table' | 'in_code_fallback' | 'unpriced';
  rowId?: string;
  /** Per token. */
  input?: string;
  output?: string;
  /** Per token, derived (OpenAI 50% rule). */
  cachedInput?: string;
}

export interface ImageCurrent {
  basis: 'image_setting' | 'in_code_fallback' | 'unpriced';
  perImage?: string;
}

export interface PendingView {
  lineId: string;
  proposalId: string;
  unit: string;
  sourceUrl: string;
  checkedOn: string;
  flags: string[];
  /** Human labels for the flags that have one, e.g. `new_model` → "not used yet" (user decision). */
  flagLabels: Array<{ flag: string; label: string }>;
  crossCheck: string;
  /**
   * Slice 5 (SA O-12): the cross-check in words, with the second list's
   * reading and date. Always set by the server; optional only so read-model
   * doubles written before slice 5 stay valid.
   */
  crossCheckDetail?: string;
  createdAt: string;
  createdBy: string;
}

export interface ComparisonRow {
  kind: 'token' | 'image';
  /** Null for an image model known only from a price key (image prices are keyed by model). */
  provider: string | null;
  modelName: string;
  /**
   * The stored `ai_model_pricing` row behind `current` (slice 4, SA N-1): the
   * admin table joins its Edit control to this id. Null unless the basis is
   * `table`; always null for image rows. Read model only, no charge reads it.
   */
  currentRowId: string | null;
  areas: AreaTag[];
  usedByBusinessOs: boolean;
  usageLabel: string;
  currentBasis: CurrentBasis;
  currentNote: string | null;
  units: UnitComparison[];
  colour: CoverageColour;
  redUnits: string[];
  summary: string;
  /** The lowest (most negative) unit gap in basis points, for sorting by gap. */
  worstGapBasisPoints: number | null;
  pending: PendingView[];
}

export interface ComparisonModel {
  generatedAt: string;
  embedding: EmbeddingSettingState;
  rows: ComparisonRow[];
}

const NOT_USED_LABEL = 'not used by Business OS';

function perTokenFromPer1k(value: number): string {
  return formatDecimal(shiftDecimal(decimalFromNumberLiteral(value), -3));
}

function imageKey(model: string, size: string, quality: string): string {
  return `${model}:${size}:${quality}`;
}

function parseImageKey(key: string): { model: string; size: string; quality: string } | null {
  const parts = key.split(':');
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) return null;
  return { model: parts[0], size: parts[1], quality: parts[2] };
}

async function buildAdminEmailById(): Promise<Map<string, string>> {
  const byId = new Map<string, string>();
  const { data, error } = await adminUserRepository.listActive();
  if (error || !data) return byId;
  for (const admin of data) {
    if (admin.user_id) byId.set(admin.user_id, admin.email);
  }
  return byId;
}

/** Everything the comparison and the flag context read, in one round of queries. */
export async function loadPricingSnapshot(): Promise<PricingSnapshot> {
  const [active, areas, imageConfig, pending, adminEmailById] = await Promise.all([
    aiModelPricingRepository.listActiveExact(),
    buildAreaTags(),
    systemConfigRepository.getImageGenerationConfig(),
    aiPriceProposalRepository.listPendingLines(),
    buildAdminEmailById(),
  ]);
  if (active.error || !active.data) throw active.error ?? new Error('Active prices unreadable');
  if (pending.error || !pending.data) throw pending.error ?? new Error('Pending prices unreadable');

  // Newest first from the repository: the first row per model is the one charged.
  const activeByKey = new Map<string, AiModelPricingExactRow>();
  for (const row of active.data) {
    const key = modelKey(row.provider, row.model_name);
    if (!activeByKey.has(key)) activeByKey.set(key, row);
  }

  const inCodeByKey = new Map<string, { input: string; output: string }>();
  for (const [provider, models] of Object.entries(inCodeTokenPrices())) {
    for (const [model, price] of Object.entries(models)) {
      inCodeByKey.set(modelKey(provider, model), {
        input: perTokenFromPer1k(price.input),
        output: perTokenFromPer1k(price.output),
      });
    }
  }

  return {
    activeByKey,
    inCodeByKey,
    areas,
    imagePricesUsd: imageConfig.pricesUsd,
    imageSizes: Array.from(new Set(Object.values(imageConfig.sizes))),
    pending: pending.data,
    adminEmailById,
  };
}

export function tokenCurrent(snapshot: PricingSnapshot, provider: string, model: string): TokenCurrent {
  const key = modelKey(provider, model);
  const row = snapshot.activeByKey.get(key);
  let current: TokenCurrent;
  if (row) {
    current = {
      basis: 'table',
      rowId: row.id,
      input: formatDecimal(parseDecimal(row.input_cost_per_token)),
      output: formatDecimal(parseDecimal(row.output_cost_per_token)),
    };
  } else {
    const inCode = snapshot.inCodeByKey.get(key);
    current = inCode ? { basis: 'in_code_fallback', input: inCode.input, output: inCode.output } : { basis: 'unpriced' };
  }
  // Today's cached-read rule exists for OpenAI only (openaiProvider.ts).
  if (provider === 'openai' && current.input !== undefined) {
    current.cachedInput = formatDecimal(halveDecimal(parseDecimal(current.input)));
  }
  return current;
}

export function imageCurrent(snapshot: PricingSnapshot, model: string, size: string, quality: string): ImageCurrent {
  const key = imageKey(model, size, quality);
  // Known only when the setting holds a usable price (a finite number above 0)
  // or the in-code table has the key; a configured 0 or non-number with no
  // fallback would otherwise reach the resolver's "recording $0" error log.
  const configured = snapshot.imagePricesUsd[key];
  const known =
    (typeof configured === 'number' && Number.isFinite(configured) && configured > 0) || key in IMAGE_FALLBACK_PRICING;
  // SA C-7: resolveImagePrice logs "recording $0" for an unknown key, so it is
  // only asked about a key that exists in the setting or the in-code table.
  if (!known) return { basis: 'unpriced' };
  const resolved = resolveImagePrice(snapshot.imagePricesUsd, model, size, quality);
  if (resolved.source === 'unpriced' || !(resolved.usdPerImage > 0)) return { basis: 'unpriced' };
  return {
    basis: resolved.source === 'config' ? 'image_setting' : 'in_code_fallback',
    perImage: formatDecimal(decimalFromNumberLiteral(resolved.usdPerImage)),
  };
}

/** The token models in the coverage set (SA finding 9), excluding pending lines. */
/** Token coverage keys (`provider:model`); exported for the slice 5 fetch, which proposes only these (RR-1). */
export function tokenCoverage(snapshot: PricingSnapshot): Set<string> {
  const keys = new Set<string>([...snapshot.activeByKey.keys(), ...snapshot.inCodeByKey.keys()]);
  for (const key of snapshot.areas.tagsByModel.keys()) {
    if (!snapshot.areas.imageModelKeys.has(key)) keys.add(key);
  }
  for (const key of snapshot.areas.defaultModelKeys) keys.add(key);
  for (const key of snapshot.areas.imageModelKeys) keys.delete(key);
  return keys;
}

/** Image model names in the coverage set, excluding pending lines. */
function imageCoverage(snapshot: PricingSnapshot): Set<string> {
  const models = new Set<string>();
  for (const key of [...Object.keys(IMAGE_FALLBACK_PRICING), ...Object.keys(snapshot.imagePricesUsd)]) {
    const parsed = parseImageKey(key);
    if (parsed) models.add(parsed.model);
  }
  for (const key of snapshot.areas.imageModelKeys) models.add(key.slice(key.indexOf(':') + 1));
  return models;
}

function conservativeFor(provider: string, kind: 'text' | 'embedding' | 'image'): UnitPrices {
  const rates = conservativeRateDerivation().filter((rate) => rate.kind === kind);
  const rate =
    rates.find((candidate) => candidate.scope === 'provider' && candidate.provider === provider) ??
    rates.find((candidate) => candidate.scope === 'all_providers');
  if (!rate) return {};
  if (kind === 'image') {
    return rate.perImage === undefined ? {} : { perImage: formatDecimal(decimalFromNumberLiteral(rate.perImage)) };
  }
  return {
    input: rate.inputPer1k === undefined ? undefined : perTokenFromPer1k(rate.inputPer1k),
    output: rate.outputPer1k === undefined ? undefined : perTokenFromPer1k(rate.outputPer1k),
  };
}

/** The flag context and the current snapshot for one validated line (manual entry). */
export function lineContextFor(
  snapshot: PricingSnapshot,
  line: PendingLineInput
): { context: LineFlagContext; snapshotFields: Omit<AiPriceSubmitLine, 'kind' | 'provider' | 'model_name' | 'source_url' | 'checked_on' | 'flags'> } {
  if (line.kind === 'image') {
    const current = imageCurrent(snapshot, line.model_name, line.image_size, line.image_quality);
    const fallbackPrice = IMAGE_FALLBACK_PRICING[imageKey(line.model_name, line.image_size, line.image_quality)];
    return {
      context: {
        current: { perImage: current.perImage },
        fallback: fallbackPrice === undefined ? {} : { perImage: formatDecimal(decimalFromNumberLiteral(fallbackPrice)) },
        conservative: conservativeFor(line.provider, 'image'),
        inCoverage: imageCoverage(snapshot).has(line.model_name),
        inputOnly: false,
      },
      snapshotFields: {
        image_size: line.image_size,
        image_quality: line.image_quality,
        price_per_image: line.price_per_image,
        current_basis: current.basis,
        current_cost_per_image: current.perImage,
      },
    };
  }

  const current = tokenCurrent(snapshot, line.provider, line.model_name);
  const inputOnly = isInputOnlyPricedModel(line.provider, line.model_name);
  const inCode = snapshot.inCodeByKey.get(modelKey(line.provider, line.model_name));
  return {
    context: {
      current: { input: current.input, output: current.output, cachedInput: current.cachedInput },
      fallback: inCode ? { input: inCode.input, output: inCode.output } : {},
      conservative: conservativeFor(line.provider, inputOnly ? 'embedding' : 'text'),
      inCoverage: tokenCoverage(snapshot).has(modelKey(line.provider, line.model_name)),
      inputOnly,
    },
    snapshotFields: {
      input_per_1m: line.input_per_1m,
      output_per_1m: line.output_per_1m,
      cached_input_per_1m: line.cached_input_per_1m,
      current_basis: current.basis,
      current_row_id: current.rowId,
      current_input_cost_per_token: current.input,
      current_output_cost_per_token: current.output,
      current_cached_input_cost_per_token: current.cachedInput,
    },
  };
}

function normalisePrice(text: string | null): string | null {
  return text === null ? null : formatDecimal(parseDecimal(text));
}

/** The cross-check in words. The second list is LiteLLM; its reading is text, never a price (MP-FR-6a). */
export function crossCheckDetail(line: Pick<AiPricePendingLine, 'cross_check_verdict' | 'cross_check_value' | 'cross_check_diff_pct' | 'cross_check_fetched_at'>): string {
  const read = line.cross_check_fetched_at ? `, read ${line.cross_check_fetched_at.slice(0, 10)}` : '';
  const value = line.cross_check_value ? `; second price list (LiteLLM): ${line.cross_check_value}` : '';
  switch (line.cross_check_verdict) {
    case 'agrees':
      return `agrees with the second price list${read}${value}`;
    case 'differs': {
      const diff = line.cross_check_diff_pct === null || line.cross_check_diff_pct === undefined ? '' : ` by up to ${Number(line.cross_check_diff_pct).toFixed(2)}%`;
      return `differs from the second price list${diff}${read}${value}`;
    }
    case 'not_listed':
      return `not on the second price list${read}${value}`;
    case 'unavailable':
      return `second price list could not be read${read}`;
    default:
      return 'not run';
  }
}

function pendingView(snapshot: PricingSnapshot, line: AiPricePendingLine, unit: string): PendingView {
  return {
    lineId: line.id,
    proposalId: line.proposal_id,
    unit,
    sourceUrl: line.source_url,
    checkedOn: line.checked_on,
    flags: line.flags,
    flagLabels: line.flags.flatMap((flag) => {
      const label = FLAG_LABELS[flag as PendingLineFlag];
      return label ? [{ flag, label }] : [];
    }),
    crossCheck: line.cross_check_verdict ?? 'not run',
    crossCheckDetail: crossCheckDetail(line),
    createdAt: line.created_at,
    createdBy: snapshot.adminEmailById.get(line.created_by) ?? 'former admin',
  };
}

function usage(snapshot: PricingSnapshot, key: string | null): { areas: AreaTag[]; used: boolean; label: string } {
  const areas = key ? snapshot.areas.tagsByModel.get(key) ?? [] : [];
  return {
    areas,
    used: areas.length > 0,
    label: areas.length > 0 ? areas.map((tag) => tag.label).join(', ') : NOT_USED_LABEL,
  };
}

function finishRow(
  base: Omit<ComparisonRow, 'colour' | 'redUnits' | 'summary' | 'worstGapBasisPoints'>
): ComparisonRow {
  const coverage = rowCoverage(base.units);
  const gaps = base.units.map((unit) => unit.gapBasisPoints).filter((gap): gap is number => gap !== null);
  return {
    ...base,
    colour: coverage.colour,
    redUnits: coverage.redUnits,
    summary: coverage.summary,
    worstGapBasisPoints: gaps.length > 0 ? Math.min(...gaps) : null,
  };
}

function tokenRows(snapshot: PricingSnapshot): ComparisonRow[] {
  const pendingByKey = new Map<string, AiPricePendingLine>();
  for (const line of snapshot.pending) {
    if (line.kind !== 'token') continue;
    const key = modelKey(line.provider, line.model_name);
    if (!pendingByKey.has(key)) pendingByKey.set(key, line);
  }
  const keys = new Set<string>([...tokenCoverage(snapshot), ...pendingByKey.keys()]);
  if (snapshot.areas.embedding.status === 'set') {
    keys.add(modelKey(snapshot.areas.embedding.provider, snapshot.areas.embedding.model));
  }

  const rows: ComparisonRow[] = [];
  for (const key of keys) {
    const separator = key.indexOf(':');
    const provider = key.slice(0, separator);
    const model = key.slice(separator + 1);
    const current = tokenCurrent(snapshot, provider, model);
    const line = pendingByKey.get(key);
    const { areas, used, label } = usage(snapshot, key);
    const toPer1m = (perToken: string | undefined) => (perToken === undefined ? null : perTokenToPerMillion(perToken));

    const units = [
      compareUnit(
        { unit: 'input', current: toPer1m(current.input), currentBasis: current.basis, pending: normalisePrice(line?.input_per_1m ?? null) },
        { usedByBusinessOs: used }
      ),
      compareUnit(
        { unit: 'output', current: toPer1m(current.output), currentBasis: current.basis, pending: normalisePrice(line?.output_per_1m ?? null) },
        { usedByBusinessOs: used }
      ),
      compareUnit(
        {
          unit: 'cached_input',
          current: toPer1m(current.cachedInput),
          currentBasis: current.cachedInput === undefined ? 'unpriced' : 'derived',
          pending: normalisePrice(line?.cached_input_per_1m ?? null),
        },
        { usedByBusinessOs: used }
      ),
    ];

    rows.push(
      finishRow({
        kind: 'token',
        provider,
        modelName: model,
        currentRowId: current.basis === 'table' ? current.rowId ?? null : null,
        areas,
        usedByBusinessOs: used,
        usageLabel: label,
        currentBasis: current.basis,
        currentNote: current.basis === 'table' ? STORED_PRICE_NOTE : null,
        units,
        pending: line ? [pendingView(snapshot, line, 'tokens')] : [],
      })
    );
  }
  return rows;
}

function imageRows(snapshot: PricingSnapshot): ComparisonRow[] {
  // model → (size:quality → pending line); the provider is taken from the areas or the pending line.
  const unitsByModel = new Map<string, Set<string>>();
  const providerByModel = new Map<string, string>();
  const addUnit = (model: string, size: string, quality: string) => {
    const units = unitsByModel.get(model) ?? new Set<string>();
    units.add(`${size}:${quality}`);
    unitsByModel.set(model, units);
  };

  for (const key of [...Object.keys(IMAGE_FALLBACK_PRICING), ...Object.keys(snapshot.imagePricesUsd)]) {
    const parsed = parseImageKey(key);
    if (parsed) addUnit(parsed.model, parsed.size, parsed.quality);
  }
  for (const key of snapshot.areas.imageModelKeys) {
    const separator = key.indexOf(':');
    const model = key.slice(separator + 1);
    providerByModel.set(model, key.slice(0, separator));
    for (const size of snapshot.imageSizes) {
      for (const quality of IMAGE_PRICE_REQUIRED_QUALITIES) addUnit(model, size, quality);
    }
  }
  const pendingByUnit = new Map<string, AiPricePendingLine>();
  for (const line of snapshot.pending) {
    if (line.kind !== 'image' || !line.image_size || !line.image_quality) continue;
    const key = imageKey(line.model_name, line.image_size, line.image_quality);
    if (!pendingByUnit.has(key)) pendingByUnit.set(key, line);
    if (!providerByModel.has(line.model_name)) providerByModel.set(line.model_name, line.provider);
    addUnit(line.model_name, line.image_size, line.image_quality);
  }

  const rows: ComparisonRow[] = [];
  for (const [model, unitKeys] of unitsByModel) {
    const provider = providerByModel.get(model) ?? null;
    const { areas, used, label } = usage(snapshot, provider ? modelKey(provider, model) : null);
    const units: UnitComparison[] = [];
    const pending: PendingView[] = [];
    let basis: CurrentBasis = 'unpriced';
    for (const unitKey of [...unitKeys].sort()) {
      const [size, quality] = unitKey.split(':');
      const current = imageCurrent(snapshot, model, size, quality);
      if (current.basis !== 'unpriced') basis = current.basis;
      const line = pendingByUnit.get(imageKey(model, size, quality));
      const unit = `image ${size} ${quality}`;
      units.push(
        compareUnit(
          { unit, current: current.perImage ?? null, currentBasis: current.basis, pending: normalisePrice(line?.price_per_image ?? null) },
          { usedByBusinessOs: used }
        )
      );
      if (line) pending.push(pendingView(snapshot, line, unit));
    }
    rows.push(
      finishRow({
        kind: 'image',
        provider,
        modelName: model,
        currentRowId: null,
        areas,
        usedByBusinessOs: used,
        usageLabel: label,
        currentBasis: basis,
        currentNote: null,
        units,
        pending,
      })
    );
  }
  return rows;
}

const COLOUR_ORDER: Record<CoverageColour, number> = { red: 0, green: 1, grey: 2 };

/** Red first, then models Business OS uses, then the worst gap, then by name. */
export function sortRows(rows: ComparisonRow[]): ComparisonRow[] {
  return [...rows].sort(
    (a, b) =>
      COLOUR_ORDER[a.colour] - COLOUR_ORDER[b.colour] ||
      Number(b.usedByBusinessOs) - Number(a.usedByBusinessOs) ||
      (a.worstGapBasisPoints ?? Number.POSITIVE_INFINITY) - (b.worstGapBasisPoints ?? Number.POSITIVE_INFINITY) ||
      `${a.provider ?? ''}:${a.modelName}`.localeCompare(`${b.provider ?? ''}:${b.modelName}`)
  );
}

export function buildComparisonFromSnapshot(snapshot: PricingSnapshot, now: Date = new Date()): ComparisonModel {
  return {
    generatedAt: now.toISOString(),
    embedding: snapshot.areas.embedding,
    rows: sortRows([...tokenRows(snapshot), ...imageRows(snapshot)]),
  };
}

export async function buildComparison(): Promise<ComparisonModel> {
  return buildComparisonFromSnapshot(await loadPricingSnapshot());
}
