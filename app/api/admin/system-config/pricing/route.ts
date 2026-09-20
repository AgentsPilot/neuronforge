/**
 * GET / PUT / POST / DELETE /api/admin/system-config/pricing — the
 * `ai_model_pricing` table behind the admin System Config screen.
 *
 * ADMIN ONLY, gated here in the route (middleware does not protect `/api`)
 * through `requireAdmin` → AdminAccessService (the `admin_users` table), never
 * the user-writable profile role field. Before Layer 2 Step 0 these handlers
 * were unauthenticated: anyone could rewrite or delete the prices every credit
 * charge is computed from.
 *
 * Data access goes through `aiModelPricingRepository` (the repository pattern —
 * CLAUDE.md mandatory rule 1). The route holds no Supabase client: the service
 * role, and why `ai_model_pricing` has no `user_id` to scope by, are documented
 * in the repository's header. Authorisation for this platform-wide table is this
 * route's `requireAdmin` gate.
 *
 * Audit: the write handlers log through `lib/audit/admin-helpers` with the acting
 * admin's id (it used to be `null`, RC-W10) and never let an audit failure turn a
 * write that already succeeded into a 500. Saving a $0 cost additionally logs at
 * error level and writes an `AI_PRICING_ZERO_SET` entry — a zero price is allowed
 * (user decision, 2026-09-20) but it means that model is billed at nothing.
 *
 * Response shapes are unchanged from the pre-Step-0 route, so
 * `app/admin/system-config/page.tsx` needs no change.
 *
 * @module app/api/admin/system-config/pricing
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/admin/requireAdminRoute';
import {
  logAIPricingCreated,
  logAIPricingUpdated,
  logAIPricingDeleted,
  logAIPricingZeroCost
} from '@/lib/audit/admin-helpers';
import { createLogger, type Logger } from '@/lib/logger';
import { aiModelPricingRepository } from '@/lib/repositories/AiModelPricingRepository';
import type { AiModelPricing } from '@/lib/repositories/types';

const logger = createLogger({ module: 'AdminPricingAPI' });

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `ai_model_pricing.id` is a **uuid** on the live database (workplan §4.4, query
 * R-3, read 2026-09-20), so the schema is narrowed to a uuid string (D-1). A
 * mistyped id is now a 400 from here rather than a PostgREST 500 out of
 * `.single()` (SA S-3/S-5), and nothing else can reach the `.eq('id', ...)`.
 */
const pricingIdSchema = z.string().trim().uuid();

const costSchema = z.number().finite().min(0);

const putBodySchema = z
  .object({
    id: pricingIdSchema,
    input_cost_per_token: costSchema.optional(),
    output_cost_per_token: costSchema.optional()
  })
  .refine(
    (body) => body.input_cost_per_token !== undefined || body.output_cost_per_token !== undefined,
    { message: 'At least one cost field must be provided' }
  );

const postBodySchema = z.object({
  provider: z.string().trim().min(1).max(50),
  model_name: z.string().trim().min(1).max(100),
  input_cost_per_token: costSchema,
  output_cost_per_token: costSchema,
  effective_date: z.string().datetime().optional()
});

/** Internal error text is for the server log and for development only. */
function devDetails(error: unknown): string | undefined {
  if (process.env.NODE_ENV !== 'development') return undefined;
  return error instanceof Error ? error.message : String(error);
}

function invalidBody(message: string, issues?: unknown) {
  return NextResponse.json(
    {
      success: false,
      error: message,
      details: process.env.NODE_ENV === 'development' ? issues : undefined
    },
    { status: 400 }
  );
}

async function readJson(request: NextRequest): Promise<{ ok: true; body: unknown } | { ok: false }> {
  try {
    return { ok: true, body: await request.json() };
  } catch {
    return { ok: false };
  }
}

function notFound() {
  return NextResponse.json({ success: false, error: 'Pricing row not found' }, { status: 404 });
}

/** `numeric` can arrive as a string from PostgREST, so compare numerically. */
function toNumber(value: number | string): number {
  return typeof value === 'number' ? value : Number(value);
}

/**
 * A saved $0 is allowed but never silent (user decision, 2026-09-20): it is a
 * revenue event, so it is logged at error level and gets its own critical audit
 * entry naming the admin who saved it, on top of the normal update/create entry.
 * The Step 1 resolver guardrail is what stops an area from POINTING at such a
 * model; this half is attribution.
 */
async function reportZeroPrice(
  row: AiModelPricing,
  userId: string,
  source: 'update' | 'create',
  requestLogger: Logger
): Promise<void> {
  const input = toNumber(row.input_cost_per_token);
  const output = toNumber(row.output_cost_per_token);
  if (input !== 0 && output !== 0) return;

  requestLogger.error(
    {
      userId,
      pricingId: row.id,
      provider: row.provider,
      model_name: row.model_name,
      input_cost_per_token: input,
      output_cost_per_token: output,
      source
    },
    'Zero price saved for an AI model — usage of this model will be billed at $0'
  );

  await logAIPricingZeroCost(userId, row.id, {
    provider: row.provider,
    model_name: row.model_name,
    input_cost_per_token: input,
    output_cost_per_token: output,
    source
  }).catch((err) =>
    requestLogger.error({ err, pricingId: row.id }, 'Audit failed (non-blocking)')
  );
}

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const gate = await requireAdmin(requestLogger);
    if (gate instanceof NextResponse) return gate;

    const { data: pricing, error } = await aiModelPricingRepository.listAll();

    if (error) throw error;

    requestLogger.info(
      { userId: gate.user.id, count: pricing?.length ?? 0 },
      'Fetched AI model pricing'
    );

    return NextResponse.json({ success: true, data: pricing || [] });
  } catch (error) {
    requestLogger.error({ err: error }, 'Error fetching pricing');
    return NextResponse.json(
      { success: false, error: 'Failed to fetch pricing information', details: devDetails(error) },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const gate = await requireAdmin(requestLogger);
    if (gate instanceof NextResponse) return gate;

    const json = await readJson(request);
    if (!json.ok) return invalidBody('Invalid request body');

    const parsed = putBodySchema.safeParse(json.body);
    if (!parsed.success) {
      return invalidBody(
        parsed.error.issues[0]?.message || 'Invalid request body',
        parsed.error.flatten()
      );
    }

    const { id, input_cost_per_token, output_cost_per_token } = parsed.data;

    // Read the row before the update, so the audit entry carries before/after.
    const { data: oldPricing, error: readError } = await aiModelPricingRepository.findById(id);
    if (readError) throw readError;

    const costs = { input_cost_per_token, output_cost_per_token };

    const { data, error } = await aiModelPricingRepository.updateCosts(id, costs);

    if (error) throw error;

    // No row matched: a missing id is the caller's mistake, not a server fault
    // (this used to surface as a 500 out of PostgREST's `.single()`).
    if (!data) return notFound();

    const fields = Object.keys(costs).filter(
      (key) => costs[key as keyof typeof costs] !== undefined
    );

    requestLogger.info(
      {
        userId: gate.user.id,
        pricingId: id,
        model: data.model_name,
        fields
      },
      'Updated AI model pricing'
    );

    // Awaited so the serverless invocation does not end mid-write, but a
    // rejection can never 500 a write that already succeeded (RC-W10).
    await logAIPricingUpdated(gate.user.id, id, data.model_name, {
      before: oldPricing,
      after: data
    }).catch((err) => requestLogger.error({ err, pricingId: id }, 'Audit failed (non-blocking)'));

    await reportZeroPrice(data, gate.user.id, 'update', requestLogger);

    return NextResponse.json({ success: true, data, message: 'Pricing updated successfully' });
  } catch (error) {
    requestLogger.error({ err: error }, 'Error updating pricing');
    return NextResponse.json(
      { success: false, error: 'Failed to update pricing', details: devDetails(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const gate = await requireAdmin(requestLogger);
    if (gate instanceof NextResponse) return gate;

    const json = await readJson(request);
    if (!json.ok) return invalidBody('Invalid request body');

    const parsed = postBodySchema.safeParse(json.body);
    if (!parsed.success) {
      return invalidBody(
        parsed.error.issues[0]?.message || 'Invalid request body',
        parsed.error.flatten()
      );
    }

    const { provider, model_name, input_cost_per_token, output_cost_per_token, effective_date } =
      parsed.data;

    // The route owns the clock, as it does today; the repository holds no date policy.
    const { data, error } = await aiModelPricingRepository.create({
      provider,
      model_name,
      input_cost_per_token,
      output_cost_per_token,
      effective_date: effective_date || new Date().toISOString()
    });

    if (error) throw error;
    if (!data) throw new Error('Insert returned no row');

    requestLogger.info(
      { userId: gate.user.id, pricingId: data.id, provider, model: model_name },
      'Created AI model pricing'
    );

    await logAIPricingCreated(gate.user.id, {
      id: data.id,
      provider: data.provider,
      model_name: data.model_name,
      input_cost_per_token: toNumber(data.input_cost_per_token),
      output_cost_per_token: toNumber(data.output_cost_per_token)
    }).catch((err) => requestLogger.error({ err }, 'Audit failed (non-blocking)'));

    await reportZeroPrice(data, gate.user.id, 'create', requestLogger);

    return NextResponse.json({ success: true, data, message: 'Pricing created successfully' });
  } catch (error) {
    requestLogger.error({ err: error }, 'Error creating pricing');
    return NextResponse.json(
      { success: false, error: 'Failed to create pricing', details: devDetails(error) },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const gate = await requireAdmin(requestLogger);
    if (gate instanceof NextResponse) return gate;

    const parsed = pricingIdSchema.safeParse(new URL(request.url).searchParams.get('id'));
    if (!parsed.success) {
      return invalidBody('Missing or malformed parameter: id', parsed.error.flatten());
    }

    const id = parsed.data;

    // Read the row before the delete, so the audit entry carries what was lost.
    const { data: pricingToDelete, error: readError } = await aiModelPricingRepository.findById(id);
    if (readError) throw readError;

    const { data: deleted, error } = await aiModelPricingRepository.deleteById(id);

    if (error) throw error;

    // Nothing matched: answer 404 rather than today's cheerful 200, and write no
    // audit entry for a delete that did not happen.
    if (!deleted) return notFound();

    requestLogger.info({ userId: gate.user.id, pricingId: id }, 'Deleted AI model pricing');

    if (pricingToDelete) {
      await logAIPricingDeleted(gate.user.id, id, pricingToDelete.model_name, pricingToDelete).catch(
        (err) => requestLogger.error({ err, pricingId: id }, 'Audit failed (non-blocking)')
      );
    }

    return NextResponse.json({ success: true, message: 'Pricing deleted successfully' });
  } catch (error) {
    requestLogger.error({ err: error }, 'Error deleting pricing');
    return NextResponse.json(
      { success: false, error: 'Failed to delete pricing', details: devDetails(error) },
      { status: 500 }
    );
  }
}
