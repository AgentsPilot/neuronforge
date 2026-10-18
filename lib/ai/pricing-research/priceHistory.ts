/**
 * The per-model price history (AI model price review slice 9; MP-FR-17, UF-4,
 * SA RR-6): every stored price of one model, current and retired, newest
 * first, with when it took effect, when it was replaced, and WHO changed it and
 * WHY, read from the database. Read-only: nothing here writes or prices a call.
 *
 * WHO AND WHY, first match wins (workplan §2.3, SA SC9-2, SC9-10):
 *   A1 applied        the row names a pending line and the line is `applied`:
 *                     applied by, when, reason, override reason, source, checked
 *                     date, entered by and how, the apply batch and its margin
 *                     review.
 *   A2 record missing the row names a line but the line is absent or not
 *                     applied (impossible under the FK and CHECKs): said, logged,
 *                     and NEVER falls through to a guess.
 *   R  runbook        a token row with no provenance created at or after
 *                     `RUNBOOK_ERA_STARTS_AT`: the emergency SQL runbook.
 *   P1 old audit      no provenance, and the old per-row audit recorded events.
 *   P2 no record      otherwise: "before price review — no record".
 * Never an invented actor: a person is an email, "not on the admin list" (an id
 * with no `admin_users` row at all) or "system".
 *
 * "CURRENT" IS THE CHARGING RULE, NOT A COPY (workplan §2.4): among rows not
 * retired and already in effect, in the repository's `listActive()` order, the
 * token price charged is the first row (no zero skip, as `comparisonModel`'s
 * `currentRowId`), and the image price charged is `selectActiveImagePrices`'s
 * pick (first row priced above 0).
 *
 * EXACT: prices stay decimal strings (`decimal.ts`). A stored value that cannot
 * be read (Postgres `numeric` can hold NaN) prints "not readable" and logs a
 * warning with the row id only; the builder never throws on data (SA SC9-5).
 *
 * The route injects every read (`PriceHistoryDeps`), so the admin-only
 * repository methods are called from `app/api/admin/**` only
 * (`adminReadMethods.guard.test.ts`) and this module is testable offline.
 */

import 'server-only';

import { z } from 'zod';

import { selectActiveImagePrices } from '@/lib/ai/imagePricing';
import { createLogger } from '@/lib/logger';
import { ALL_ZERO_UUID } from '@/lib/platformAccount';
import type { AdminCappedRows, AdminPricingRowEvent, AdminPricingSyncRun } from '@/lib/repositories/AuditTrailRepository';
import type {
  AgentRepositoryResult as RepositoryResult,
  AiModelImagePricingHistoryRow,
  AiModelPricingHistoryRow,
  AiPriceApplyBatchRecord,
  AiPriceAppliedLineRecord,
  PriceHistoryRowsPage,
} from '@/lib/repositories/types';

import { decimalFromNumberLiteral, formatDecimal, isPlainDecimal, parseDecimal, shiftDecimal, signOfDecimal, type Decimal } from './decimal';
import {
  SYNC_RUNS_PER_ROW,
  type HistoryActor,
  type PriceHistoryAuditEvent,
  type PriceHistoryData,
  type PriceHistoryProvenance,
  type PriceHistoryQuery,
  type PriceHistoryRow,
  type PriceHistorySyncRun,
  type PriceHistoryUnit,
} from './priceHistorySchema';

const logger = createLogger({ module: 'PriceHistory' });

/**
 * The emergency-runbook era starts at the slice 6 MERGE (commit `ac674ceb`,
 * 2026-10-16 18:52:20 UTC): from then on no app path writes a live price, so a
 * token row with no provenance created at or after it was written by the
 * emergency SQL runbook (its run log, section 8, names the row). The merge, not
 * the deploy, is the conservative choice only because the T-0 read of
 * 2026-10-18 found exactly one such row (`549fcc6e-…`, 19:56 UTC, the logged
 * runbook run), so no Sync write fell in the merge-to-deploy gap (SA O-2,
 * SC9-9). Pinned by test.
 */
export const RUNBOOK_ERA_STARTS_AT = '2026-10-16T18:52:20Z';

/**
 * The date the slice 2 clean-up retired its 12 duplicate or alias rows
 * (`supabase/SQL Scripts/20261010_ai_model_pricing_retire_duplicate_rows.sql`,
 * applied 2026-10-11, `retired_date = (now() AT TIME ZONE 'utc')::date`).
 * Before slice 8 nothing else could retire a row; T-0 2026-10-18: 12
 * no-provenance rows retired on this date and none on any other. Pinned by test.
 */
export const CLEANUP_RETIRED_ON = '2026-10-11';

const RUNBOOK_ERA_MS = Date.parse(RUNBOOK_ERA_STARTS_AT);

/** Image quality order inside a model: the three charged tiers first, then any other alphabetically. */
const QUALITY_RANK: Record<string, number> = { low: 0, medium: 1, high: 2 };

/** A read failed; the route answers 500 with its generic words. */
export class PriceHistoryReadError extends Error {
  constructor(
    public readonly what: string,
    public readonly readError?: unknown
  ) {
    super(`Price history read failed: ${what}`);
    this.name = 'PriceHistoryReadError';
  }
}

/** Every read the history needs, injected by the route (the admin-only methods stay in `app/api/admin/**`). */
export interface PriceHistoryDeps {
  listTokenHistory: (key: { provider: string; modelName: string }) => Promise<RepositoryResult<PriceHistoryRowsPage<AiModelPricingHistoryRow>>>;
  listImageHistory: (key: { provider: string; modelName: string }) => Promise<RepositoryResult<PriceHistoryRowsPage<AiModelImagePricingHistoryRow>>>;
  findLines: (ids: string[]) => Promise<RepositoryResult<AiPriceAppliedLineRecord[]>>;
  findBatches: (ids: string[]) => Promise<RepositoryResult<AiPriceApplyBatchRecord[]>>;
  listRowEvents: (rowIds: string[]) => Promise<RepositoryResult<AdminCappedRows<AdminPricingRowEvent>>>;
  listSyncRuns: () => Promise<RepositoryResult<AdminCappedRows<AdminPricingSyncRun>>>;
  findAdminEmails: (userIds: string[]) => Promise<RepositoryResult<Array<{ user_id: string; email: string }>>>;
  /** `isInputOnlyPricedModel` (lib/ai/pricing.ts): an embedding is priced on input only. */
  isInputOnly: (provider: string, modelName: string) => boolean;
  /** Ids that mean "the platform", never a person: `SYSTEM_ADMIN_USER_ID` and the all-zero id. */
  systemActorIds: readonly string[];
}

/** The ids that mean "system" (SA SC9-2): the configured platform account and the all-zero id. */
export function systemActorIdsFromEnv(): string[] {
  const configured = process.env.SYSTEM_ADMIN_USER_ID;
  return [ALL_ZERO_UUID, ...(configured ? [configured] : [])];
}

/** Everything the pure builder needs, already read. */
export interface PriceHistoryInputs {
  query: PriceHistoryQuery;
  now: Date;
  tokenRows: AiModelPricingHistoryRow[];
  imageRows: AiModelImagePricingHistoryRow[];
  truncated: boolean;
  lines: AiPriceAppliedLineRecord[];
  batches: AiPriceApplyBatchRecord[];
  events: AdminPricingRowEvent[];
  auditTruncated: boolean;
  syncRuns: AdminPricingSyncRun[];
  syncTruncated: boolean;
  emailByUserId: ReadonlyMap<string, string>;
  systemActorIds: readonly string[];
  inputOnly: boolean;
}

// ─── Small exact helpers that never throw ─────────────────────────────────────

/** A stored decimal text, or null when it is not a plain decimal (NaN, garbage). */
function readStoredDecimal(text: string | null | undefined): Decimal | null {
  if (typeof text !== 'string' || !isPlainDecimal(text)) return null;
  return parseDecimal(text);
}

/** Per token → per 1M as text; null (and a warning with the row id) when unreadable. */
function perMillionOrNull(text: string, rowId: string, column: string): string | null {
  const value = readStoredDecimal(text);
  if (value === null) {
    logger.warn({ rowId, column }, 'Stored price is not a readable decimal; shown as not readable');
    return null;
  }
  return formatDecimal(shiftDecimal(value, 6));
}

/** A legacy audit value (per token): a finite JSON number or a plain-decimal string, as per 1M text; else null. */
function legacyPerMillion(value: unknown): string | null {
  let decimal: Decimal | null = null;
  if (typeof value === 'number' && Number.isFinite(value)) decimal = decimalFromNumberLiteral(value);
  else if (typeof value === 'string' && isPlainDecimal(value)) decimal = parseDecimal(value);
  return decimal === null ? null : formatDecimal(shiftDecimal(decimal, 6));
}

const LegacyPriceValues = z
  .object({ input_cost_per_token: z.unknown().optional(), output_cost_per_token: z.unknown().optional() })
  .passthrough();
const LegacyChanges = z.object({ before: LegacyPriceValues.optional(), after: LegacyPriceValues.optional() }).passthrough();
const LegacyDetails = z
  .object({
    input_cost_per_token: z.unknown().optional(),
    output_cost_per_token: z.unknown().optional(),
    system_action: z.unknown().optional(),
    models_updated: z.unknown().optional(),
    models_added: z.unknown().optional(),
  })
  .passthrough();

function lenientDetails(value: unknown): z.infer<typeof LegacyDetails> {
  const parsed = LegacyDetails.safeParse(value);
  return parsed.success ? parsed.data : {};
}

function wholeNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}

function dateOnly(value: string): string {
  return value.slice(0, 10);
}

// ─── Who ──────────────────────────────────────────────────────────────────────

function actorFor(
  id: string | null | undefined,
  inputs: Pick<PriceHistoryInputs, 'emailByUserId' | 'systemActorIds'>,
  systemFlag = false
): HistoryActor {
  // SA CR9-2: "system" only for a platform id or an entry flagged `system_action`. A missing id
  // (e.g. nulled by ON DELETE SET NULL when the admin's auth user was deleted) is "not recorded".
  if (systemFlag || (id && inputs.systemActorIds.includes(id))) return { kind: 'system' };
  if (!id) return { kind: 'not_recorded' };
  const email = inputs.emailByUserId.get(id);
  return email ? { kind: 'admin', email } : { kind: 'not_on_admin_list' };
}

function eventActorId(row: { actor_id: string | null; user_id: string | null }): string | null {
  return row.actor_id ?? row.user_id ?? null;
}

// ─── Rows ─────────────────────────────────────────────────────────────────────

interface StoredRow {
  id: string;
  unitKey: string;
  size: string | null;
  quality: string | null;
  effectiveDate: string;
  retiredDate: string | null;
  createdAt: string | null;
  lineId: string | null;
  token: AiModelPricingHistoryRow | null;
  image: AiModelImagePricingHistoryRow | null;
}

type RowClass = 'line' | 'runbook' | 'legacy';

function classify(row: { created_at: string | null; proposal_line_id: string | null }, kind: 'token' | 'image'): RowClass {
  if (row.proposal_line_id) return 'line';
  // SA SC9-10: R never applies to a null `created_at` or to an image row (the runbook has no image paste).
  if (kind === 'token' && row.created_at !== null) {
    const created = Date.parse(row.created_at);
    if (Number.isFinite(created) && created >= RUNBOOK_ERA_MS) return 'runbook';
  }
  return 'legacy';
}

function toStored(inputs: PriceHistoryInputs): StoredRow[] {
  if (inputs.query.kind === 'token') {
    return inputs.tokenRows.map((row) => ({
      id: row.id,
      unitKey: '',
      size: null,
      quality: null,
      effectiveDate: dateOnly(row.effective_date),
      retiredDate: row.retired_date ? dateOnly(row.retired_date) : null,
      createdAt: row.created_at,
      lineId: row.proposal_line_id,
      token: row,
      image: null,
    }));
  }
  return inputs.imageRows.map((row) => ({
    id: row.id,
    unitKey: `${row.size}|${row.quality}`,
    size: row.size,
    quality: row.quality,
    effectiveDate: dateOnly(row.effective_date),
    retiredDate: row.retired_date ? dateOnly(row.retired_date) : null,
    createdAt: row.created_at,
    lineId: row.proposal_line_id,
    token: null,
    image: row,
  }));
}

function compareUnits(a: StoredRow, b: StoredRow): number {
  const size = (a.size ?? '').localeCompare(b.size ?? '');
  if (size !== 0) return size;
  const rankA = QUALITY_RANK[a.quality ?? ''] ?? 3;
  const rankB = QUALITY_RANK[b.quality ?? ''] ?? 3;
  return rankA - rankB || (a.quality ?? '').localeCompare(b.quality ?? '');
}

/** The charged row of one unit, by the charging rule (see the header). */
function currentRowId(unitRows: StoredRow[], today: string): string | null {
  const inEffect = unitRows.filter((row) => row.retiredDate === null && row.effectiveDate <= today);
  if (inEffect.length === 0) return null;
  if (inEffect[0].token) return inEffect[0].id;
  const picked = selectActiveImagePrices(inEffect.map((row) => row.image as AiModelImagePricingHistoryRow));
  const [first] = [...picked.values()];
  return first ? first.id : null;
}

function tokenPrices(row: AiModelPricingHistoryRow, inputs: PriceHistoryInputs): PriceHistoryRow['prices'] {
  const input = readStoredDecimal(row.input_cost_per_token);
  const output = readStoredDecimal(row.output_cost_per_token);
  const inputPer1m = perMillionOrNull(row.input_cost_per_token, row.id, 'input');
  const outputPer1m = perMillionOrNull(row.output_cost_per_token, row.id, 'output');

  // SA SC9-7: the comparison's cached-input rule (`comparisonModel.tokenCurrent`, SA F-1). Only the
  // OpenAI provider charges a stored cached rate, and only above 0; other providers never read it.
  let cachedInputPer1m: string | null = null;
  let cachedNote: 'stored' | 'half_of_input' | 'stored_not_used' | 'none' | 'unreadable';
  const rawCached = row.cached_input_cost_per_token;
  const cached = rawCached === null ? null : readStoredDecimal(rawCached);
  if (rawCached !== null && cached === null) {
    logger.warn({ rowId: row.id, column: 'cached_input' }, 'Stored price is not a readable decimal; shown as not readable');
    cachedNote = 'unreadable';
  } else if (row.provider === 'openai') {
    if (cached !== null && signOfDecimal(cached) > 0) {
      cachedInputPer1m = formatDecimal(shiftDecimal(cached, 6));
      cachedNote = 'stored';
    } else {
      cachedNote = 'half_of_input';
    }
  } else if (cached !== null) {
    cachedInputPer1m = formatDecimal(shiftDecimal(cached, 6));
    cachedNote = 'stored_not_used';
  } else {
    cachedNote = 'none';
  }

  // `lib/ai/pricing.ts` D-0 C-1: a row at 0 is not a price (input > 0, and output > 0 unless input-only).
  const storedAsZero =
    (input !== null && signOfDecimal(input) <= 0) || (output !== null && signOfDecimal(output) <= 0 && !inputs.inputOnly);

  return { kind: 'token', inputPer1m, outputPer1m, cachedInputPer1m, cachedNote, storedAsZero };
}

function imagePrices(row: AiModelImagePricingHistoryRow): PriceHistoryRow['prices'] {
  const value = readStoredDecimal(row.cost_per_image);
  if (value === null) logger.warn({ rowId: row.id, column: 'cost_per_image' }, 'Stored price is not a readable decimal; shown as not readable');
  return { kind: 'image', perImage: value === null ? null : formatDecimal(value), storedAsZero: value !== null && signOfDecimal(value) <= 0 };
}

function auditEventFor(event: AdminPricingRowEvent, inputs: PriceHistoryInputs): PriceHistoryAuditEvent | null {
  const details = lenientDetails(event.details);
  const by = actorFor(eventActorId(event), inputs, details.system_action === true);
  if (event.action === 'AI_PRICING_UPDATED') {
    const parsed = LegacyChanges.safeParse(event.changes);
    const after = parsed.success ? parsed.data.after : undefined;
    const before = parsed.success ? parsed.data.before : undefined;
    return {
      action: 'updated',
      by,
      at: event.created_at,
      inputPer1m: legacyPerMillion(after?.input_cost_per_token),
      outputPer1m: legacyPerMillion(after?.output_cost_per_token),
      beforeInputPer1m: legacyPerMillion(before?.input_cost_per_token),
      beforeOutputPer1m: legacyPerMillion(before?.output_cost_per_token),
    };
  }
  const action = event.action === 'AI_PRICING_CREATED' ? 'created' : event.action === 'AI_PRICING_ZERO_SET' ? 'zero_set' : null;
  if (action === null) return null;
  return {
    action,
    by,
    at: event.created_at,
    inputPer1m: legacyPerMillion(details.input_cost_per_token),
    outputPer1m: legacyPerMillion(details.output_cost_per_token),
    beforeInputPer1m: null,
    beforeOutputPer1m: null,
  };
}

function appliedProvenance(
  row: StoredRow,
  linesById: ReadonlyMap<string, AiPriceAppliedLineRecord>,
  batchesById: ReadonlyMap<string, AiPriceApplyBatchRecord>,
  inputs: PriceHistoryInputs
): PriceHistoryProvenance {
  const line = row.lineId ? linesById.get(row.lineId) : undefined;
  if (!line || line.state !== 'applied') {
    // A2: impossible under the FK and CHECKs. Said, logged, never guessed.
    logger.warn({ rowId: row.id, lineId: row.lineId, found: Boolean(line), state: line?.state }, 'Price row names a line that is missing or not applied');
    return { kind: 'provenance_missing' };
  }
  const batch = line.apply_batch_id ? batchesById.get(line.apply_batch_id) : undefined;
  if (line.apply_batch_id && !batch) logger.warn({ rowId: row.id, batchId: line.apply_batch_id }, 'Applied line names a batch that was not found');
  const embedded = Array.isArray(line.ai_price_proposals) ? line.ai_price_proposals[0] : line.ai_price_proposals;
  const sourceKind = embedded?.source_kind;
  return {
    kind: 'applied',
    appliedBy: actorFor(line.decided_by ?? batch?.applied_by, inputs),
    appliedAt: line.decided_at ?? batch?.applied_at ?? '',
    reason: line.decision_reason ?? '',
    overrideReason: line.override_reason,
    sourceUrl: line.source_url,
    checkedOn: line.checked_on,
    enteredBy: actorFor(line.created_by, inputs),
    entrySource: sourceKind === 'manual' || sourceKind === 'fetch' ? sourceKind : 'unknown',
    batch: batch
      ? {
          lineCount: batch.line_count,
          marginReview: !batch.margin_review_needed ? 'not_needed' : batch.margin_review_done ? 'done' : 'open',
          reviewedBy: batch.margin_review_by ? actorFor(batch.margin_review_by, inputs) : null,
          reviewedAt: batch.margin_review_at,
          reviewNote: batch.margin_review_note,
        }
      : null,
  };
}

/** SA SC9-11: the Sync runs whose time falls inside the row's stored life, newest first. */
function syncRunsFor(row: StoredRow, replacedOn: string | null, inputs: PriceHistoryInputs): PriceHistorySyncRun[] {
  const startMs = row.createdAt ? Date.parse(row.createdAt) : Number.NEGATIVE_INFINITY;
  // The replacement date is a calendar date: the whole day counts, since a run that day may precede it.
  const endMs = replacedOn ? Date.parse(`${replacedOn}T23:59:59.999Z`) : inputs.now.getTime();
  return inputs.syncRuns
    .filter((run) => {
      const at = Date.parse(run.created_at);
      return Number.isFinite(at) && at >= (Number.isFinite(startMs) ? startMs : Number.NEGATIVE_INFINITY) && at <= endMs;
    })
    .map((run) => {
      const details = lenientDetails(run.details);
      return {
        at: run.created_at,
        by: actorFor(eventActorId(run), inputs, details.system_action === true),
        modelsUpdated: wholeNumberOrNull(details.models_updated),
        modelsAdded: wholeNumberOrNull(details.models_added),
      };
    });
}

/** The pure builder: rows, lines, batches, audit and names already read. Never throws on data. */
export function buildPriceHistory(inputs: PriceHistoryInputs): PriceHistoryData {
  const today = inputs.now.toISOString().slice(0, 10);
  const linesById = new Map(inputs.lines.map((line) => [line.id, line] as const));
  const batchesById = new Map(inputs.batches.map((batch) => [batch.id, batch] as const));
  const eventsByRow = new Map<string, AdminPricingRowEvent[]>();
  for (const event of inputs.events) {
    const key = (event.entity_id ?? '').toLowerCase();
    const list = eventsByRow.get(key) ?? [];
    list.push(event);
    eventsByRow.set(key, list);
  }

  // Units in display order; rows inside a unit keep the repository order.
  const stored = toStored(inputs);
  const unitOrder: StoredRow[] = [];
  const rowsByUnit = new Map<string, StoredRow[]>();
  for (const row of stored) {
    const list = rowsByUnit.get(row.unitKey);
    if (list) list.push(row);
    else {
      rowsByUnit.set(row.unitKey, [row]);
      unitOrder.push(row);
    }
  }
  unitOrder.sort(compareUnits);

  const units: PriceHistoryUnit[] = unitOrder.map((first) => {
    const unitRows = rowsByUnit.get(first.unitKey) ?? [];
    const chargedId = currentRowId(unitRows, today);
    const rows: PriceHistoryRow[] = unitRows.map((row, index) => {
      const status: PriceHistoryRow['status'] =
        row.retiredDate !== null ? 'retired' : row.effectiveDate > today ? 'starts_later' : row.id === chargedId ? 'current' : 'not_charged';

      // SA SC9-6: the earlier of the next newer in-effect row's date and the retirement.
      // The successor is found for every row (SA CR9-1: the retirement words use it too).
      let successorDate: string | null = null;
      for (let at = index - 1; at >= 0; at -= 1) {
        if (unitRows[at].effectiveDate <= today) {
          successorDate = unitRows[at].effectiveDate;
          break;
        }
      }
      let replacedOn: string | null = null;
      let neverCharged = false;
      if (status !== 'current' && status !== 'starts_later') {
        const candidates = [successorDate, row.retiredDate].filter((value): value is string => value !== null).sort();
        replacedOn = candidates[0] ?? null;
        neverCharged = successorDate !== null && replacedOn === row.effectiveDate;
      }

      const rowClass = classify({ created_at: row.createdAt, proposal_line_id: row.lineId }, inputs.query.kind);
      let provenance: PriceHistoryProvenance;
      if (rowClass === 'line') {
        provenance = appliedProvenance(row, linesById, batchesById, inputs);
      } else if (rowClass === 'runbook') {
        provenance = { kind: 'runbook' };
      } else {
        const events = (eventsByRow.get(row.id.toLowerCase()) ?? [])
          .map((event) => auditEventFor(event, inputs))
          .filter((event): event is PriceHistoryAuditEvent => event !== null);
        provenance = events.length > 0 ? { kind: 'audit', events } : { kind: 'none' };
      }

      let retirement: PriceHistoryRow['retirement'] = null;
      if (row.retiredDate !== null) {
        if (row.lineId === null && row.retiredDate === CLEANUP_RETIRED_ON) retirement = { kind: 'cleanup' };
        // SA CR9-1: "replaced" only when a newer row has started; a starts-later sibling replaced nothing.
        else if (successorDate !== null) retirement = { kind: 'replaced' };
        else retirement = { kind: 'no_record' };
      }

      const allRuns = rowClass === 'legacy' ? syncRunsFor(row, replacedOn, inputs) : [];

      return {
        rowId: row.id,
        status,
        prices: row.token ? tokenPrices(row.token, inputs) : imagePrices(row.image as AiModelImagePricingHistoryRow),
        effectiveDate: row.effectiveDate,
        replacedOn,
        neverCharged,
        retiredOn: row.retiredDate,
        createdAt: row.createdAt,
        provenance,
        retirement,
        // Pre-review rows (no provenance, created before the cut-over or with no date) may have been
        // overwritten in place by Sync (SA SC9-10).
        preReviewNote:
          rowClass === 'legacy' && (row.createdAt === null || !(Date.parse(row.createdAt) >= RUNBOOK_ERA_MS)),
        syncRuns: allRuns.slice(0, SYNC_RUNS_PER_ROW),
        moreSyncRuns: Math.max(0, allRuns.length - SYNC_RUNS_PER_ROW),
      };
    });
    return { size: first.size, quality: first.quality, rows };
  });

  return {
    generatedAt: inputs.now.toISOString(),
    kind: inputs.query.kind,
    provider: inputs.query.provider,
    modelName: inputs.query.model,
    truncated: inputs.truncated,
    auditTruncated: inputs.auditTruncated,
    syncTruncated: inputs.syncTruncated,
    units,
  };
}

function unwrap<T>(result: RepositoryResult<T>, what: string): T {
  if (result.error || result.data === null || result.data === undefined) throw new PriceHistoryReadError(what, result.error);
  return result.data;
}

/**
 * Read everything for one model through the injected deps, then build. Throws
 * `PriceHistoryReadError` when any read fails, INCLUDING the name lookup (SA
 * SC9-2): a failed lookup is a 500, never everyone labelled "not on the list".
 */
export async function loadPriceHistory(query: PriceHistoryQuery, deps: PriceHistoryDeps, now: Date = new Date()): Promise<PriceHistoryData> {
  const key = { provider: query.provider, modelName: query.model };
  let tokenRows: AiModelPricingHistoryRow[] = [];
  let imageRows: AiModelImagePricingHistoryRow[] = [];
  let truncated = false;
  if (query.kind === 'token') {
    const page = unwrap(await deps.listTokenHistory(key), 'price rows');
    tokenRows = page.rows;
    truncated = page.truncated;
  } else {
    const page = unwrap(await deps.listImageHistory(key), 'image price rows');
    imageRows = page.rows;
    truncated = page.truncated;
  }

  const rows: Array<{ id: string; created_at: string | null; proposal_line_id: string | null }> = query.kind === 'token' ? tokenRows : imageRows;
  const lineIds = [...new Set(rows.flatMap((row) => (row.proposal_line_id ? [row.proposal_line_id] : [])))];
  const legacyIds = rows.filter((row) => classify(row, query.kind) === 'legacy').map((row) => row.id);

  const [linesResult, eventsResult, syncResult] = await Promise.all([
    lineIds.length > 0 ? deps.findLines(lineIds) : Promise.resolve({ data: [] as AiPriceAppliedLineRecord[], error: null }),
    legacyIds.length > 0
      ? deps.listRowEvents(legacyIds)
      : Promise.resolve({ data: { rows: [] as AdminPricingRowEvent[], reachedLimit: false }, error: null }),
    legacyIds.length > 0
      ? deps.listSyncRuns()
      : Promise.resolve({ data: { rows: [] as AdminPricingSyncRun[], reachedLimit: false }, error: null }),
  ]);
  const lines = unwrap(linesResult, 'applied lines');
  const events = unwrap(eventsResult, 'price audit events');
  const sync = unwrap(syncResult, 'Sync runs');

  const batchIds = [...new Set(lines.flatMap((line) => (line.apply_batch_id ? [line.apply_batch_id] : [])))];
  const batches = batchIds.length > 0 ? unwrap(await deps.findBatches(batchIds), 'apply batches') : [];

  // One de-duplicated name lookup per request (SA SC9-2).
  const systemIds = new Set(deps.systemActorIds);
  const peopleIds = new Set<string>();
  const addPerson = (id: string | null | undefined) => {
    if (id && !systemIds.has(id)) peopleIds.add(id);
  };
  for (const line of lines) {
    addPerson(line.decided_by);
    addPerson(line.created_by);
  }
  for (const batch of batches) {
    addPerson(batch.applied_by);
    addPerson(batch.margin_review_by);
  }
  for (const event of events.rows) addPerson(eventActorId(event));
  for (const run of sync.rows) addPerson(eventActorId(run));
  const emails = peopleIds.size > 0 ? unwrap(await deps.findAdminEmails([...peopleIds]), 'admin names') : [];

  return buildPriceHistory({
    query,
    now,
    tokenRows,
    imageRows,
    truncated,
    lines,
    batches,
    events: events.rows,
    auditTruncated: events.reachedLimit,
    syncRuns: sync.rows,
    syncTruncated: sync.reachedLimit,
    emailByUserId: new Map(emails.map((entry) => [entry.user_id, entry.email] as const)),
    systemActorIds: deps.systemActorIds,
    inputOnly: deps.isInputOnly(query.provider, query.model),
  });
}
