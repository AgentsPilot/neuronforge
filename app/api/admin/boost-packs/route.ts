/**
 * GET / POST / PUT / DELETE /api/admin/boost-packs — the agent-platform boost
 * pack catalog (`boost_packs`) behind `/admin/agentspilot-billing`.
 *
 * ADMIN ONLY: `requireAdmin` is the first statement of every handler
 * (middleware does not protect `/api`); nothing touches the body or the
 * database before it returns.
 *
 * Data access goes through `boostPackRepository` (CLAUDE.md rule 1). The route
 * holds no Supabase client: the service role, and why `boost_packs` has no
 * `user_id` to scope by, are documented in the repository's header.
 *
 * Bodies are Zod-validated (rule 2). The schemas keep exactly what the route
 * accepted before this refactor: POST needs the four text fields non-empty, PUT
 * is a partial update keyed by `id`, DELETE takes `{ id }` in the body. Unknown
 * keys are STRIPPED, not rejected, because the admin page posts the whole row
 * it read (including `id`, `created_at`, ...).
 *
 * Response shapes are unchanged — `{ success, data }` (DELETE: `{ success }`) —
 * so the admin page needs no change. Internal error text is returned only in
 * development (`details`).
 *
 * No audit trail is written here today; adding one is out of scope for this
 * standards refactor.
 *
 * @module app/api/admin/boost-packs
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAdmin } from '@/lib/admin/requireAdminRoute';
import { createLogger } from '@/lib/logger';
import { boostPackRepository } from '@/lib/repositories/BoostPackRepository';

const logger = createLogger({ module: 'BoostPacksAdminAPI' });

const numberField = z.number().finite();

/**
 * Fields every write may carry; all optional (PUT is a partial update).
 * `null` is accepted exactly where the column is nullable in the table
 * definition (docs/BOOST_PACK_ADMIN_INTERFACE.md): `badge_text` and `is_active`.
 * A stored row with `is_active = null` posted back by the page must still save.
 */
const packFields = {
  pack_key: z.string(),
  pack_name: z.string(),
  display_name: z.string(),
  description: z.string(),
  price_usd: numberField,
  bonus_percentage: numberField,
  credits_amount: numberField,
  bonus_credits: numberField,
  badge_text: z.string().nullable(),
  is_active: z.boolean().nullable(),
};

const optionalPackFields = z.object(packFields).partial();

/** POST: the four text fields were required (non-empty) before; still are. */
const postBodySchema = optionalPackFields.extend({
  pack_key: z.string().min(1),
  pack_name: z.string().min(1),
  display_name: z.string().min(1),
  description: z.string().min(1),
});

const idSchema = z.string().min(1);

const putBodySchema = optionalPackFields.extend({ id: idSchema });

const deleteBodySchema = z.object({ id: idSchema });

/** Internal error text is for the server log and for development only. */
function devDetails(error: unknown): string | undefined {
  if (process.env.NODE_ENV !== 'development') return undefined;
  return error instanceof Error ? error.message : String(error);
}

function invalidInput(issues?: unknown) {
  return NextResponse.json(
    {
      success: false,
      error: 'Invalid input',
      details: process.env.NODE_ENV === 'development' ? issues : undefined,
    },
    { status: 400 }
  );
}

function serverError(message: string, error: unknown) {
  return NextResponse.json(
    { success: false, error: message, details: devDetails(error) },
    { status: 500 }
  );
}

async function readJson(request: NextRequest): Promise<{ ok: true; body: unknown } | { ok: false }> {
  try {
    return { ok: true, body: await request.json() };
  } catch {
    return { ok: false };
  }
}

// GET - Fetch all boost packs
export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // Admin gate. Nothing above this line may touch a request body,
    // the database, a job queue, or an outbound message (FR-5).
    const gate = await requireAdmin(requestLogger);
    if (gate instanceof NextResponse) return gate;

    const { data, error } = await boostPackRepository.listAll();
    if (error) {
      requestLogger.error({ err: error, userId: gate.user.id }, 'Failed to fetch boost packs');
      return serverError('Failed to fetch boost packs', error);
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    requestLogger.error({ err: error }, 'Unexpected error fetching boost packs');
    return serverError('Unexpected error occurred', error);
  }
}

// POST - Create new boost pack
export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // Admin gate. Nothing above this line may touch a request body,
    // the database, a job queue, or an outbound message (FR-5).
    const gate = await requireAdmin(requestLogger);
    if (gate instanceof NextResponse) return gate;

    const json = await readJson(request);
    if (!json.ok) return invalidInput('Request body is not valid JSON');
    const parsed = postBodySchema.safeParse(json.body);
    if (!parsed.success) {
      requestLogger.warn({ userId: gate.user.id, issues: parsed.error.flatten() }, 'Invalid boost pack create body');
      return invalidInput(parsed.error.flatten());
    }

    const { data, error } = await boostPackRepository.create(parsed.data);
    if (error) {
      requestLogger.error(
        { err: error, userId: gate.user.id, packKey: parsed.data.pack_key },
        'Failed to create boost pack'
      );
      return serverError('Failed to create boost pack', error);
    }

    requestLogger.info(
      { userId: gate.user.id, packId: data?.id, packKey: parsed.data.pack_key },
      'Boost pack created'
    );
    return NextResponse.json({ success: true, data });
  } catch (error) {
    requestLogger.error({ err: error }, 'Unexpected error creating boost pack');
    return serverError('Unexpected error occurred', error);
  }
}

// PUT - Update boost pack
export async function PUT(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // Admin gate. Nothing above this line may touch a request body,
    // the database, a job queue, or an outbound message (FR-5).
    const gate = await requireAdmin(requestLogger);
    if (gate instanceof NextResponse) return gate;

    const json = await readJson(request);
    if (!json.ok) return invalidInput('Request body is not valid JSON');
    const parsed = putBodySchema.safeParse(json.body);
    if (!parsed.success) {
      requestLogger.warn({ userId: gate.user.id, issues: parsed.error.flatten() }, 'Invalid boost pack update body');
      return invalidInput(parsed.error.flatten());
    }

    const { id, ...fields } = parsed.data;
    const { data, error } = await boostPackRepository.update(id, fields);
    if (error) {
      requestLogger.error({ err: error, userId: gate.user.id, packId: id }, 'Failed to update boost pack');
      return serverError('Failed to update boost pack', error);
    }

    requestLogger.info({ userId: gate.user.id, packId: id, packKey: data?.pack_key }, 'Boost pack updated');
    return NextResponse.json({ success: true, data });
  } catch (error) {
    requestLogger.error({ err: error }, 'Unexpected error updating boost pack');
    return serverError('Unexpected error occurred', error);
  }
}

// DELETE - Delete boost pack
export async function DELETE(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // Admin gate. Nothing above this line may touch a request body,
    // the database, a job queue, or an outbound message (FR-5).
    const gate = await requireAdmin(requestLogger);
    if (gate instanceof NextResponse) return gate;

    const json = await readJson(request);
    if (!json.ok) return invalidInput('Request body is not valid JSON');
    const parsed = deleteBodySchema.safeParse(json.body);
    if (!parsed.success) {
      requestLogger.warn({ userId: gate.user.id, issues: parsed.error.flatten() }, 'Invalid boost pack delete body');
      return invalidInput(parsed.error.flatten());
    }

    const { id } = parsed.data;
    const { error } = await boostPackRepository.deleteById(id);
    if (error) {
      requestLogger.error({ err: error, userId: gate.user.id, packId: id }, 'Failed to delete boost pack');
      return serverError('Failed to delete boost pack', error);
    }

    requestLogger.info({ userId: gate.user.id, packId: id }, 'Boost pack deleted');
    return NextResponse.json({ success: true });
  } catch (error) {
    requestLogger.error({ err: error }, 'Unexpected error deleting boost pack');
    return serverError('Unexpected error occurred', error);
  }
}
