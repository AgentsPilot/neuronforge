/**
 * Write execution for BizQL.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS DOES NOT USE THE QUERY COMPILER
 *
 * Reads go through a generic compiler because a generic read is safe: the worst
 * outcome is the wrong rows come back. A generic WRITE is a different animal —
 * an LLM-authored `UPDATE ... WHERE` with a missing predicate is unrecoverable.
 *
 * So writes route through the existing repositories instead. That buys their
 * validation, their soft-delete semantics, their cascade handling and their
 * `user_id` filtering, all of which are already reviewed and in production. The
 * cost is a small dispatch table per entity; the benefit is that the AI cannot
 * invent a write path that nobody has looked at.
 *
 * Everything here is also gated by the catalog: an action that is not declared
 * simply does not exist, and a field that is not `writable: true` cannot be set.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/business-os/bizql/mutate
 */

import { createLogger } from '@/lib/logger';
import { crmContactRepository } from '@/lib/repositories/CRMContactRepository';
import { paymentInvoiceRepository } from '@/lib/repositories/PaymentRepository';
import { schedulingBookingRepository } from '@/lib/repositories/SchedulingRepository';
import { CATALOG, type ResolvedEntity } from '@/lib/business-os/catalog';
import {
  BizQLValidationError,
  type MutateQuery,
  type MutateResult,
  type QueryContext,
  type QueryRow,
} from '../types';

const logger = createLogger({ module: 'BizQLMutate' });

/** Result shape shared by every repository in this codebase. */
type RepoResult<T> = { data: T | null; error: Error | null };

type Handler = (
  query: MutateQuery,
  data: Record<string, unknown>,
  ctx: QueryContext
) => Promise<RepoResult<unknown>>;

function requireTargetId(query: MutateQuery): string {
  const id = query.target?.id;
  if (!id) {
    throw new BizQLValidationError([
      `'${query.entity}.${query.action}' needs an explicit target id.`,
    ]);
  }
  return id;
}

/**
 * Dispatch table: catalog action → repository call.
 *
 * Adding an action means adding it to the catalog AND here. That is deliberate
 * friction: it forces a human to decide which reviewed repository method a new
 * write maps onto, rather than letting one be synthesised.
 */
const HANDLERS: Record<string, Record<string, Handler>> = {
  contacts: {
    create: async (_q, data, ctx) =>
      crmContactRepository.create({
        user_id: ctx.userId,
        ...data,
      } as Parameters<typeof crmContactRepository.create>[0]) as Promise<RepoResult<unknown>>,

    update: async (q, data, ctx) =>
      crmContactRepository.update(requireTargetId(q), ctx.userId, data) as Promise<
        RepoResult<unknown>
      >,

    delete: async (q, _data, ctx) =>
      crmContactRepository.delete(requireTargetId(q), ctx.userId) as Promise<
        RepoResult<unknown>
      >,
  },

  invoices: {
    mark_paid: async (q, data, ctx) =>
      paymentInvoiceRepository.markAsPaid(requireTargetId(q), ctx.userId, {
        // The repository requires a method; 'manual' is the honest default when
        // a person marks an invoice paid from the chat rather than a processor
        // webhook doing it.
        paymentMethod: (data.payment_method as string) ?? 'manual',
        notes: data.notes as string | undefined,
      }) as Promise<RepoResult<unknown>>,

    update: async (q, data, ctx) =>
      paymentInvoiceRepository.update(requireTargetId(q), ctx.userId, data) as Promise<
        RepoResult<unknown>
      >,
  },

  bookings: {
    cancel: async (q, data, ctx) =>
      schedulingBookingRepository.cancel(
        requireTargetId(q),
        ctx.userId,
        (data.cancellation_reason as string) ?? undefined
      ) as Promise<RepoResult<unknown>>,

    complete: async (q, _data, ctx) =>
      schedulingBookingRepository.complete(requireTargetId(q), ctx.userId) as Promise<
        RepoResult<unknown>
      >,
  },
};

/**
 * Translate catalog field names to column names, rejecting anything not
 * declared writable.
 *
 * This is the check that stops a plan setting `stage` on an entity where it is
 * read-only, or writing to a column the catalog never exposed.
 */
function mapWritableData(
  entity: ResolvedEntity,
  data: Record<string, unknown> | undefined
): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data ?? {})) {
    const field = entity.fields[key];

    if (!field) {
      throw new BizQLValidationError([
        `unknown field '${entity.key}.${key}'. ` +
          `Writable: ${Object.keys(entity.fields)
            .filter((f) => entity.fields[f].writable)
            .join(', ')}.`,
      ]);
    }
    if (!field.writable) {
      throw new BizQLValidationError([`field '${entity.key}.${key}' is not writable.`]);
    }

    mapped[field.column] = value;
  }

  return mapped;
}

/** Short description of what a write will do, for the confirmation card. */
function describe(
  entity: ResolvedEntity,
  query: MutateQuery,
  data: Record<string, unknown>,
  language: string
): string {
  const action = entity.actions?.[query.action];
  const label =
    action?.labels[language as 'en'] ?? action?.labels.en ?? `${query.action} ${entity.key}`;

  const fields = Object.keys(data);
  return fields.length > 0 ? `${label} (${fields.join(', ')})` : label;
}

/**
 * Execute — or preview — a write.
 *
 * `dryRun` returns exactly what would happen without touching the database. The
 * confirmation flow depends on that being genuinely side-effect free, so no
 * handler is invoked on this path at all.
 */
export async function executeMutate(
  query: MutateQuery,
  ctx: QueryContext,
  options: { dryRun?: boolean; language?: string } = {}
): Promise<MutateResult> {
  const entity = CATALOG.entities[query.entity];
  if (!entity) {
    throw new BizQLValidationError([`unknown entity '${query.entity}'.`]);
  }

  const action = entity.actions?.[query.action];
  if (!action) {
    throw new BizQLValidationError([
      `'${query.entity}' has no action '${query.action}'. ` +
        `Available: ${Object.keys(entity.actions ?? {}).join(', ') || 'none'}.`,
    ]);
  }

  const handler = HANDLERS[query.entity]?.[query.action];
  if (!handler) {
    // Declared in the catalog but not wired to a repository. Fail loudly: a
    // silent success here is the exact bug that made the old chat claim it had
    // sent emails it never sent.
    throw new BizQLValidationError([
      `'${query.entity}.${query.action}' is declared but not implemented yet.`,
    ]);
  }

  const data = mapWritableData(entity, query.data);

  for (const required of action.requiredFields ?? []) {
    const column = entity.fields[required]?.column;
    if (column && data[column] === undefined) {
      throw new BizQLValidationError([
        `'${query.entity}.${query.action}' requires '${required}'.`,
      ]);
    }
  }

  const preview = describe(entity, query, data, options.language ?? 'en');

  if (options.dryRun) {
    return { op: 'mutate', entity: query.entity, action: query.action, applied: false, preview };
  }

  const result = await handler(query, data, ctx);

  if (result.error) {
    logger.error(
      { err: result.error, entity: query.entity, action: query.action },
      'Write failed'
    );
    throw result.error;
  }

  logger.info(
    { userId: ctx.userId, entity: query.entity, action: query.action, consumer: ctx.consumer },
    'Write applied'
  );

  return {
    op: 'mutate',
    entity: query.entity,
    action: query.action,
    applied: true,
    row: (result.data as QueryRow) ?? undefined,
    preview,
  };
}

/** Whether the catalog says this write must be confirmed before it runs. */
export function requiresConfirmation(query: MutateQuery): boolean {
  const action = CATALOG.entities[query.entity]?.actions?.[query.action];
  // Unknown actions default to requiring confirmation. Failing safe matters
  // more than convenience on a write path.
  if (!action) return true;
  return action.requiresConfirmation || action.risk === 'delete' || action.risk === 'send';
}
