/**
 * Fan-out: apply one action to every row a previous step returned.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS IS THE MOST DANGEROUS CODE IN THE SYSTEM.
 *
 * Everything else is recoverable. A wrong read shows wrong rows; a wrong single
 * write affects one row you can fix. A wrong fan-out emails 200 of your clients,
 * and there is no undo for that.
 *
 * So the guards are layered, and each covers a different failure:
 *
 *   catalog allowBulk   — fan-out is opt-in per action, defaulting to false.
 *   maxFanout           — a hard ceiling; over it we refuse rather than truncate.
 *   dry run             — the preview genuinely performs nothing.
 *   frozen targets      — confirmation replays resolved ids, never a re-query.
 *   idempotency claim   — a UNIQUE insert per item, so a retry cannot double-send.
 *   daily quota         — a durable per-user ceiling that a restart cannot reset.
 *   honest reporting    — 45 of 47 is reported as 45 of 47, with the failures.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/business-os/bizql/mutate
 */

import { createLogger } from '@/lib/logger';
import { sendEmail } from '@/lib/notifications/emailTransport';
import {
  wrapInBrandedTemplate,
  type BrandingData,
} from '@/lib/email/templates/base-template';
import { CATALOG, type ResolvedEntity } from '@/lib/business-os/catalog';
import {
  BizQLValidationError,
  isItemRef,
  type ForEachQuery,
  type ForEachResult,
  type QueryContext,
  type QueryRow,
} from '../types';
import { getActionLog } from './ActionLog';
import { performEmail } from './emailSend';
import { executeMutate } from './MutateExecutor';

const logger = createLogger({ module: 'BizQLForEach' });

/** Concurrency. Enough to be quick, low enough not to trip provider rate limits. */
const CONCURRENCY = 5;

export interface ForEachOptions {
  dryRun?: boolean;
  language?: string;
  /** Identifies this execution for idempotency. Must be stable across a retry. */
  planId: string;
  /**
   * Branding for the outgoing email, resolved by the caller.
   *
   * Passed in rather than looked up here on purpose: this module is covered by
   * tests that guarantee no network and no database, and a lookup inside would
   * break that. Omitted, the body is sent exactly as it was before — so a caller
   * that has not been updated degrades to the previous behaviour, not to an error.
   */
  branding?: BrandingData;
}

/**
 * Resolve `{"$item":"email"}` against the current row.
 *
 * The ONLY interpolation permitted in a fan-out body. A body cannot reference
 * another step, the wider plan, or anything outside the row being processed —
 * which is what keeps each iteration independently previewable.
 */
function resolveParams(
  params: Record<string, unknown> | undefined,
  row: QueryRow,
  entity: ResolvedEntity
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(params ?? {})) {
    if (!isItemRef(value)) {
      resolved[key] = value;
      continue;
    }

    const field = entity.fields[value.$item];
    if (!field) {
      throw new BizQLValidationError([
        `{"$item":"${value.$item}"} is not a field of '${entity.key}'.`,
      ]);
    }

    resolved[key] = row[field.column];
  }

  return resolved;
}

/** Run tasks with bounded concurrency, preserving order. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index], index);
    }
  });

  await Promise.all(workers);
  return results;
}

export async function executeForEach(
  query: ForEachQuery,
  rows: QueryRow[],
  ctx: QueryContext,
  options: ForEachOptions
): Promise<ForEachResult> {
  const entity = CATALOG.entities[query.entity];
  if (!entity) throw new BizQLValidationError([`unknown entity '${query.entity}'.`]);

  const action = entity.actions?.[query.action];
  if (!action) {
    throw new BizQLValidationError([
      `'${query.entity}' has no action '${query.action}'. ` +
        `Available: ${Object.keys(entity.actions ?? {}).join(', ') || 'none'}.`,
    ]);
  }

  // Opt-in, and it defaults to false. Deleting in bulk is never permitted.
  if (!action.allowBulk) {
    throw new BizQLValidationError([
      `'${query.entity}.${query.action}' may not be applied in bulk. ` +
        `Show the user the matching rows and let them act on one.`,
    ]);
  }

  const ceiling = action.maxFanout ?? 0;
  if (ceiling <= 0) {
    throw new BizQLValidationError([
      `'${query.entity}.${query.action}' has no fan-out limit configured; refusing.`,
    ]);
  }

  // Over the ceiling we REFUSE rather than silently doing the first N. Quietly
  // truncating would report success while leaving most of the job undone.
  if (rows.length > ceiling) {
    throw new BizQLValidationError([
      `This would affect ${rows.length} rows, above the ${ceiling} limit for ` +
        `'${query.entity}.${query.action}'. Narrow it down, or set it up as a ` +
        `scheduled automation instead.`,
    ]);
  }

  const requested = Math.min(query.max ?? rows.length, rows.length);
  const requestedRows = rows.slice(0, requested);

  // De-duplicate by RECIPIENT, not by row id.
  //
  // "email everyone who owes me money" legitimately finds 13 unpaid invoices —
  // 12 of which belong to the same person. Acting per row would send them 12
  // identical emails. The per-item idempotency key cannot catch this: those are
  // 13 genuinely distinct rows.
  //
  // Reaching the same address twice from one instruction is never the intent, so
  // the first occurrence wins and the rest are reported as deduplicated. It also
  // makes the confirmation honest — "2 recipients", not "13".
  const seen = new Set<string>();
  const deduplicated: QueryRow[] = [];
  let duplicates = 0;

  for (const row of requestedRows) {
    let key: string;
    try {
      const params = resolveParams(query.params, row, entity);
      key = typeof params.to === 'string' ? params.to.toLowerCase() : String(row.id ?? '');
    } catch {
      // Let a bad row through so it fails visibly per-item rather than silently
      // vanishing from the count here.
      deduplicated.push(row);
      continue;
    }

    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    deduplicated.push(row);
  }

  if (duplicates > 0) {
    logger.info(
      { entity: query.entity, action: query.action, duplicates },
      'Collapsed duplicate recipients before fan-out'
    );
  }

  const targets = deduplicated;

  const log = getActionLog();

  // ---- preview -------------------------------------------------------------
  if (options.dryRun) {
    return {
      op: 'for_each',
      entity: query.entity,
      action: query.action,
      applied: false,
      attempted: targets.length,
      succeeded: 0,
      failed: 0,
      skipped: duplicates,
      items: targets.map((row) => ({
        id: String(row.id ?? ''),
        target: (() => {
          try {
            const params = resolveParams(query.params, row, entity);
            return typeof params.to === 'string' ? params.to : undefined;
          } catch {
            return undefined;
          }
        })(),
        ok: true,
      })),
      cappedAt: ceiling,
    };
  }

  // ---- quota ---------------------------------------------------------------
  const limit = await log.dailyLimit(`${query.entity}.${query.action}`);
  const already = await log.countToday(ctx.userId, `${query.entity}.${query.action}`);

  if (already + targets.length > limit) {
    throw new BizQLValidationError([
      `This would take today's ${query.action} total to ${already + targets.length}, ` +
        `over the daily limit of ${limit}. Try again tomorrow or raise the limit.`,
    ]);
  }

  if (!log.isAvailable()) {
    logger.warn(
      { entity: query.entity, action: query.action, count: targets.length },
      'Running a fan-out WITHOUT idempotency protection — action log table missing'
    );
  }

  // ---- execute -------------------------------------------------------------
  const outcomes = await mapLimit(targets, CONCURRENCY, async (row) => {
    const itemId = String(row.id ?? '');

    let params: Record<string, unknown>;
    try {
      params = resolveParams(query.params, row, entity);
    } catch (err) {
      return { id: itemId, ok: false, error: (err as Error).message, skipped: false };
    }

    const target = typeof params.to === 'string' ? params.to : itemId;

    // Claim BEFORE doing anything irreversible. Losing this race means someone
    // else already handled this item.
    const claim = await log.claim({
      userId: ctx.userId,
      planId: options.planId,
      stepId: query.id ?? 'for_each',
      itemId,
      entity: query.entity,
      action: query.action,
      target,
    });

    if (!claim.proceed) {
      return { id: itemId, target, ok: true, skipped: true };
    }

    try {
      const result =
        query.action === 'send'
          ? await performEmail(params, options.branding)
          : await executeMutate(
              {
                op: 'mutate',
                entity: query.entity,
                action: query.action,
                target: { id: itemId },
                data: params as never,
              },
              ctx,
              { language: options.language }
            ).then(() => ({ ok: true, provider: undefined, error: undefined }));

      await log.complete(claim.entryId, {
        status: result.ok ? 'succeeded' : 'failed',
        provider: result.provider,
        error: result.error,
      });

      return { id: itemId, target, ok: result.ok, error: result.error, skipped: false };
    } catch (err) {
      const message = (err as Error).message;
      await log.complete(claim.entryId, { status: 'failed', error: message });
      return { id: itemId, target, ok: false, error: message, skipped: false };
    }
  });

  const succeeded = outcomes.filter((o) => o.ok && !o.skipped).length;
  // Both reasons for not acting count as skipped: already-claimed (idempotency)
  // and collapsed duplicate recipients. Counting only the former would make the
  // execution total disagree with the preview the user approved.
  const skipped = outcomes.filter((o) => o.skipped).length + duplicates;
  const failed = outcomes.filter((o) => !o.ok).length;

  logger.info(
    {
      userId: ctx.userId,
      entity: query.entity,
      action: query.action,
      attempted: targets.length,
      succeeded,
      failed,
      skipped,
    },
    'Fan-out completed'
  );

  return {
    op: 'for_each',
    entity: query.entity,
    action: query.action,
    applied: true,
    attempted: targets.length,
    succeeded,
    failed,
    skipped,
    items: outcomes.map(({ id, target, ok, error }) => ({ id, target, ok, error })),
    cappedAt: ceiling,
  };
}
