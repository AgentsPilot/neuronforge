/**
 * BizQL — shared business query layer for AgentsPilot.
 *
 * One IR, one compiler, one tenant boundary, three consumers:
 *
 *   ┌─ chat AI worker ──── LLM emits BizQL ───────┐
 *   ├─ insight detectors ─ hand-authored BizQL ───┼──► compiler ──► Supabase
 *   └─ automation kernel ─ stored BizQL (jsonb) ──┘     (user_id forced here)
 *
 * WHY THIS IS SHARED RATHER THAN CHAT-SPECIFIC
 *
 * The ~29 insight detectors each hand-write their own Supabase query and their
 * own `.eq('user_id', …)`. Since every repository uses the service-role client
 * (RLS bypassed), that is 29 independent chances to forget the only tenant
 * boundary the product has. Routing them through one compiler removes the whole
 * risk class, and it means facts are defined once: "which invoice statuses count
 * as unpaid" currently lives in a detector, in semantic-schema.ts and in the v2
 * chat prompt, free to drift. Here it is `semanticTerms.open` in the catalog.
 *
 * For the kernel specifically: BizQL is plain JSON, so a standing automation is
 * a stored query plus an action rather than a bespoke hand-written process. A
 * stored `{ $date: 'today' }` re-resolves on every run instead of freezing a
 * date at authoring time.
 *
 * USAGE
 *
 *   import { runBusinessQuery } from '@/lib/business-os/bizql';
 *
 *   const result = await runBusinessQuery(
 *     { op: 'find', entity: 'invoices',
 *       where: [
 *         { field: 'status', op: 'eq', value: { $semantic: 'open' } },
 *         { field: 'amount', op: 'gt', value: 100 },
 *       ],
 *       include: [{ relation: 'contact', select: ['first_name','last_name','email'] }] },
 *     { userId, consumer: 'kernel' }
 *   );
 *
 * @module lib/business-os/bizql
 */

import { supabaseServer } from '@/lib/supabaseServer';
import type { SupabaseClient } from '@supabase/supabase-js';
import { runQuery } from './compiler';
import type { ComputeQuery, FindQuery, Query, QueryContext, QueryResult } from './types';

export * from './types';
export { runQuery, compileAndRunFind, compileAndRunCompute } from './compiler';
export { resolveDateExpr } from './dates';

/**
 * Run a BizQL query against the caller's own data.
 *
 * Uses the service-role client because that is what every repository in this
 * codebase uses; the compiler compensates by forcing `user_id` scoping on the
 * outer query and every sub-query. `userId` is taken from the context and is
 * never readable from the query itself, so an LLM-authored query cannot reach
 * another tenant's rows.
 */
export async function runBusinessQuery(
  query: Query,
  ctx: QueryContext,
  client: SupabaseClient = supabaseServer
): Promise<QueryResult> {
  return runQuery(client, query, ctx);
}

/** Convenience wrapper returning rows directly. Throws on a compute query. */
export async function findRows(
  query: FindQuery,
  ctx: QueryContext,
  client: SupabaseClient = supabaseServer
) {
  const result = await runQuery(client, query, ctx);
  if (result.op !== 'find') throw new Error('Expected a find query');
  return result;
}

/** Convenience wrapper for aggregates. */
export async function computeValue(
  query: ComputeQuery,
  ctx: QueryContext,
  client: SupabaseClient = supabaseServer
) {
  const result = await runQuery(client, query, ctx);
  if (result.op !== 'compute') throw new Error('Expected a compute query');
  return result;
}
