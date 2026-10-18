/**
 * The price history query and response (AI model price review slice 9;
 * MP-FR-17, SA RR-6). One schema for both ends: the route validates its query
 * with it, the route test validates the response with it, and the page's read
 * (`app/admin/system-config/priceHistoryRead.ts`) checks the body with it.
 *
 * CLIENT-SAFE ON PURPOSE (SA SC9-8): a browser file imports this module, so it
 * imports only `zod` and the client-safe pricing-research pieces
 * (`officialSources`, `pendingLineSchema`); never a logger, a repository or a
 * server module, directly or through another import. Pinned by
 * `priceReview.source.test.ts`.
 *
 * Prices are decimal STRINGS end to end (a JSON number is refused), and no
 * admin id ever appears: a person is an email, "not on the admin list" or
 * "system" (`ActorSchema`).
 */

import { z } from 'zod';

import { PRICE_PROVIDERS } from './officialSources';
import { MODEL_ID_REGEX } from './pendingLineSchema';

/** The most stored rows one history shows; the newest are kept (SA O-5). */
export const HISTORY_ROW_LIMIT = 200;

/** The most Sync runs listed under one row (SA SC9-11); the rest are counted. */
export const SYNC_RUNS_PER_ROW = 10;

/** A model name the history accepts: the pending-line model id rule (lowercase, digits, dots, hyphens). */
export const HistoryModelNameSchema = z.string().min(1).max(100).regex(MODEL_ID_REGEX);

export const PriceHistoryQuerySchema = z
  .object({
    kind: z.enum(['token', 'image']),
    provider: z.enum(PRICE_PROVIDERS),
    model: HistoryModelNameSchema,
  })
  .strict();

export type PriceHistoryQuery = z.infer<typeof PriceHistoryQuerySchema>;

/**
 * SA SC9-8: the page shows a History button only for a row this returns true
 * for, so the button can never produce a 400.
 */
export function isHistoryQueryable(kind: string, provider: string | null, modelName: string): boolean {
  if (provider === null) return false;
  return PriceHistoryQuerySchema.safeParse({ kind, provider, model: modelName }).success;
}

/** A decimal as text ("0.075"); a JSON number is refused. */
const decimalText = z.string().regex(/^-?[0-9]+([.][0-9]+)?$/);
/** Null when the stored value could not be read (SA SC9-5: "not readable", never a throw). */
const priceOrUnreadable = decimalText.nullable();
const isoDate = z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/);

/** Who did something, without an id (SA SC9-2). */
export const ActorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('admin'), email: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('not_on_admin_list') }).strict(),
  z.object({ kind: z.literal('system') }).strict(),
  /** SA CR9-2: the entry recorded no actor id (never guessed as "system"). */
  z.object({ kind: z.literal('not_recorded') }).strict(),
]);
export type HistoryActor = z.infer<typeof ActorSchema>;

const TokenPricesSchema = z
  .object({
    kind: z.literal('token'),
    inputPer1m: priceOrUnreadable,
    outputPer1m: priceOrUnreadable,
    cachedInputPer1m: priceOrUnreadable,
    /**
     * SA SC9-7, the comparison's rule: OpenAI charges a stored cached rate above
     * 0 (`stored`), otherwise half the input (`half_of_input`); other providers
     * never charge a stored cached rate (`stored_not_used`).
     */
    cachedNote: z.enum(['stored', 'half_of_input', 'stored_not_used', 'none', 'unreadable']),
    /** Stored at 0 on a side charging needs: not treated as a price (`lib/ai/pricing.ts` D-0 C-1). */
    storedAsZero: z.boolean(),
  })
  .strict();

const ImagePricesSchema = z
  .object({
    kind: z.literal('image'),
    perImage: priceOrUnreadable,
    storedAsZero: z.boolean(),
  })
  .strict();

const BatchSchema = z
  .object({
    lineCount: z.number().int(),
    marginReview: z.enum(['not_needed', 'open', 'done']),
    reviewedBy: ActorSchema.nullable(),
    reviewedAt: z.string().nullable(),
    reviewNote: z.string().nullable(),
  })
  .strict();

const AuditEventSchema = z
  .object({
    action: z.enum(['created', 'updated', 'zero_set']),
    by: ActorSchema,
    at: z.string(),
    /** Per 1M, as recorded; null when the event recorded no readable value. */
    inputPer1m: priceOrUnreadable,
    outputPer1m: priceOrUnreadable,
    beforeInputPer1m: priceOrUnreadable,
    beforeOutputPer1m: priceOrUnreadable,
  })
  .strict();

const ProvenanceSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('applied'),
      appliedBy: ActorSchema,
      appliedAt: z.string(),
      reason: z.string(),
      overrideReason: z.string().nullable(),
      sourceUrl: z.string(),
      checkedOn: z.string(),
      enteredBy: ActorSchema,
      entrySource: z.enum(['manual', 'fetch', 'unknown']),
      batch: BatchSchema.nullable(),
    })
    .strict(),
  z.object({ kind: z.literal('provenance_missing') }).strict(),
  z.object({ kind: z.literal('runbook') }).strict(),
  z.object({ kind: z.literal('audit'), events: z.array(AuditEventSchema) }).strict(),
  z.object({ kind: z.literal('none') }).strict(),
]);

const SyncRunSchema = z
  .object({
    at: z.string(),
    by: ActorSchema,
    modelsUpdated: z.number().int().nullable(),
    modelsAdded: z.number().int().nullable(),
  })
  .strict();

const HistoryRowSchema = z
  .object({
    rowId: z.string(),
    status: z.enum(['current', 'starts_later', 'not_charged', 'retired']),
    prices: z.discriminatedUnion('kind', [TokenPricesSchema, ImagePricesSchema]),
    effectiveDate: isoDate,
    /** SA SC9-6: when a newer in-effect price or the retirement ended it; null while it is charged or not started. */
    replacedOn: isoDate.nullable(),
    /** `replacedOn` equals `effectiveDate`: a newer price for the same date took precedence. */
    neverCharged: z.boolean(),
    retiredOn: isoDate.nullable(),
    createdAt: z.string().nullable(),
    provenance: ProvenanceSchema,
    retirement: z.object({ kind: z.enum(['cleanup', 'replaced', 'no_record']) }).strict().nullable(),
    preReviewNote: z.boolean(),
    syncRuns: z.array(SyncRunSchema),
    moreSyncRuns: z.number().int(),
  })
  .strict();

const HistoryUnitSchema = z
  .object({
    size: z.string().nullable(),
    quality: z.string().nullable(),
    rows: z.array(HistoryRowSchema),
  })
  .strict();

export const PriceHistoryDataSchema = z
  .object({
    generatedAt: z.string(),
    kind: z.enum(['token', 'image']),
    provider: z.string(),
    modelName: z.string(),
    /** More than HISTORY_ROW_LIMIT stored rows: the newest are shown. */
    truncated: z.boolean(),
    /** The audit event read reached its cap: older events may be missing (SA SC9-4). */
    auditTruncated: z.boolean(),
    /** The Sync run read reached its cap: older runs may be missing (SA SC9-11). */
    syncTruncated: z.boolean(),
    units: z.array(HistoryUnitSchema),
  })
  .strict();

export const PriceHistoryResponseSchema = z
  .object({
    success: z.literal(true),
    data: PriceHistoryDataSchema,
  })
  .strict();

export type PriceHistoryData = z.infer<typeof PriceHistoryDataSchema>;
export type PriceHistoryUnit = z.infer<typeof HistoryUnitSchema>;
export type PriceHistoryRow = z.infer<typeof HistoryRowSchema>;
export type PriceHistoryProvenance = z.infer<typeof ProvenanceSchema>;
export type PriceHistoryAuditEvent = z.infer<typeof AuditEventSchema>;
export type PriceHistorySyncRun = z.infer<typeof SyncRunSchema>;
export type PriceHistoryBatch = z.infer<typeof BatchSchema>;
