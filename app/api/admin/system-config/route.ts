/**
 * GET / PUT /api/admin/system-config — read and update system settings.
 *
 * ADMIN ONLY, gated here in the route (middleware does not protect `/api`)
 * through `requireAdmin` → AdminAccessService (the `admin_users` table), never
 * the user-writable profile role field. Before Layer 2 Step 0 these handlers
 * were unauthenticated: anyone could read every system setting and write any
 * key with a service-role client.
 *
 * `POST` was deleted in Step 0: it had no caller anywhere in the repo, and a
 * gated-but-untested second write path is a liability. Next.js now answers 405.
 * PUT's repository `set` inserts a missing key, so admins lose no capability.
 *
 * Data access goes through `systemConfigRepository` (the repository pattern);
 * the deprecated `SystemConfigService` and the module-level service-role client
 * are gone from this route. One deviation is recorded in the Layer 2 workplan
 * (N-9): the repository's `set` does not invalidate `SystemConfigService`'s
 * 5-minute in-process cache, so a value read through that service on the same
 * instance can lag a PUT by up to 5 minutes. The only key this route is used to
 * write today, `payment_grace_period_days`, is read directly, so there is no
 * practical effect.
 *
 * Response shapes are deliberately identical to the pre-Step-0 route, so
 * `app/admin/system-config/page.tsx` needs no change.
 *
 * @module app/api/admin/system-config
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/admin/requireAdminRoute';
import { createLogger } from '@/lib/logger';
import { systemConfigRepository } from '@/lib/repositories/SystemConfigRepository';

const logger = createLogger({ module: 'AdminSystemConfigAPI' });

// Repository + Pino are Node-only, and an admin- and cookie-dependent handler
// must never be cached.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Business OS LLM area rows (`bos_llm_area_*`, Layer 2) are owned by
 * `scripts/bos-llm-settings.ts`, which validates a row against the resolver's
 * own schema and guardrails before writing it. A free-form write through this
 * route would bypass that and could disable every AI feature in an area, so the
 * route refuses the whole request (FR-17, DEC-10).
 */
const RESERVED_KEY_PREFIX = 'bos_llm_area_';

/**
 * Invisible characters that carry no meaning in a settings key: soft hyphen,
 * Mongolian vowel separator, the zero-width/bidi block, the word-joiner and
 * invisible-operator block, and the BOM. They are not whitespace, so `trim()`
 * leaves them in place — which is how `'\u200Bbos_llm_area_chat'` slipped past the
 * first version of this check (QA D-Q1).
 */
const IGNORABLE_KEY_CHARS = /[\u00AD\u180E\u200B-\u200F\u2060-\u206F\uFEFF]/g;

/**
 * The form a key is compared in: NFKC-folded (so full-width `ｂ` becomes `b`),
 * stripped of invisible characters, trimmed and lower-cased.
 */
function canonicalKey(key: string): string {
  return key.normalize('NFKC').replace(IGNORABLE_KEY_CHARS, '').trim().toLowerCase();
}

/**
 * Matched on the canonical form: a raw `/^bos_llm_area_/` test let
 * `BOS_LLM_AREA_chat`, `' bos_llm_area_chat'` (SA S-2) and then the zero-width and
 * full-width variants (QA D-Q1) through as new rows. Step 1's resolver reads the
 * eight exact keys, so such a row is inert junk — but it reads to an operator like
 * a real area row that never passed `validateAreaRow`, and "fixing" it in SQL
 * would make it live. Look-alikes that do NOT fold into ASCII (a Cyrillic `о`, for
 * instance) are caught by the charset rule below instead.
 */
function isReservedKey(key: string): boolean {
  return canonicalKey(key).startsWith(RESERVED_KEY_PREFIX);
}

/** A stored key never has surrounding whitespace; a padded one is a typo or a probe. */
function isPaddedKey(key: string): boolean {
  return key !== key.trim();
}

/**
 * Every settings key in this database is an ASCII identifier. Requiring that
 * closes the look-alike family for good (Cyrillic `о`, Greek `ο`, full-width
 * forms): a homoglyph key can no longer be stored at all, so it cannot sit next
 * to a real one looking identical (QA D-Q1). `.`, `:` and `-` are allowed because
 * namespaced key schemes use them.
 */
const KEY_CHARSET = /^[A-Za-z0-9_.:-]+$/;

function hasUnsupportedCharacters(key: string): boolean {
  return !KEY_CHARSET.test(key);
}

const MAX_KEYS_PER_REQUEST = 50;

const updatesSchema = z
  .record(z.string().min(1).max(100), z.unknown())
  .refine((updates) => Object.keys(updates).length >= 1, {
    message: 'updates must contain at least one key',
  })
  .refine((updates) => Object.keys(updates).length <= MAX_KEYS_PER_REQUEST, {
    message: `updates must contain at most ${MAX_KEYS_PER_REQUEST} keys`,
  });

const putBodySchema = z.object({ updates: updatesSchema });

/**
 * The keys the caller actually sent, read off the raw parsed JSON with
 * `getOwnPropertyNames` so nothing is lost on the way (QA D-Q2).
 */
function rawUpdateKeys(body: unknown): string[] {
  if (!body || typeof body !== 'object') return [];
  const updates = (body as { updates?: unknown }).updates;
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) return [];
  return Object.getOwnPropertyNames(updates);
}

/** Internal error text is for the server log and for development only. */
function devDetails(error: unknown): string | undefined {
  if (process.env.NODE_ENV !== 'development') return undefined;
  return error instanceof Error ? error.message : String(error);
}

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const gate = await requireAdmin(requestLogger);
    if (gate instanceof NextResponse) return gate;

    const { data: settings, error } = await systemConfigRepository.getAll();
    if (error) throw error;

    requestLogger.info(
      { userId: gate.user.id, count: settings?.length ?? 0 },
      'Fetched system settings'
    );

    return NextResponse.json({ success: true, data: settings ?? [] });
  } catch (error) {
    requestLogger.error({ err: error }, 'Error fetching system config');
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch system configuration',
        details: devDetails(error),
      },
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

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid request body. Expected { updates: {...} }' },
        { status: 400 }
      );
    }

    // Captured BEFORE Zod: assigning `__proto__` onto the parsed object sets its
    // prototype instead of creating an own key, so the key silently disappears.
    // JSON.parse keeps it as an own property, so this is the only place it can
    // still be seen (QA D-Q2).
    const requestedKeys = rawUpdateKeys(body);

    const parsed = putBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid request body. Expected { updates: {...} }',
          details: process.env.NODE_ENV === 'development' ? parsed.error.flatten() : undefined,
        },
        { status: 400 }
      );
    }

    const { updates } = parsed.data;
    const keys = Object.keys(updates);

    const reservedKeys = keys.filter(isReservedKey);
    if (reservedKeys.length > 0) {
      requestLogger.warn(
        { userId: gate.user.id, reservedKeys },
        'Refused a write to Business OS LLM area settings'
      );
      return NextResponse.json(
        {
          success: false,
          error:
            'Business OS LLM area settings (bos_llm_area_*) cannot be changed here. Use scripts/bos-llm-settings.ts.',
        },
        { status: 400 }
      );
    }

    const paddedKeys = keys.filter(isPaddedKey);
    if (paddedKeys.length > 0) {
      requestLogger.warn(
        { userId: gate.user.id, paddedKeys },
        'Refused a write with padded setting keys'
      );
      return NextResponse.json(
        {
          success: false,
          error: 'Setting keys must not have leading or trailing whitespace.',
        },
        { status: 400 }
      );
    }

    const unsupportedKeys = keys.filter(hasUnsupportedCharacters);
    if (unsupportedKeys.length > 0) {
      requestLogger.warn(
        { userId: gate.user.id, unsupportedKeys },
        'Refused a write with non-identifier setting keys'
      );
      return NextResponse.json(
        {
          success: false,
          error:
            'Setting keys may contain only letters, digits, underscore, dot, colon or hyphen.',
        },
        { status: 400 }
      );
    }

    // Never answer "updated successfully" for a key that never made it into the
    // write. `__proto__` is the practical case (QA D-Q2).
    const droppedKeys = requestedKeys.filter(
      (key) => !Object.prototype.hasOwnProperty.call(updates, key)
    );
    if (droppedKeys.length > 0) {
      requestLogger.warn(
        { userId: gate.user.id, droppedKeys },
        'Refused a write containing keys that cannot be stored'
      );
      return NextResponse.json(
        {
          success: false,
          error: `These keys cannot be used as setting keys: ${droppedKeys.join(', ')}.`,
        },
        { status: 400 }
      );
    }

    // DEPRECATED: routing_min_executions is no longer used. Routing reads
    // min_executions_for_score directly from the AIS config.
    if (updates.routing_min_executions !== undefined) {
      requestLogger.warn(
        { userId: gate.user.id },
        'routing_min_executions is deprecated; routing uses min_executions_for_score from AIS Config'
      );
    }

    const { error } = await systemConfigRepository.setMultiple(updates);
    if (error) throw error;

    // Keys only: a value can carry a secret (an API key, a webhook URL).
    requestLogger.info({ userId: gate.user.id, keys }, 'System config updated');

    return NextResponse.json({
      success: true,
      message: 'Configuration updated successfully',
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Error updating system config');
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to update system configuration',
        details: devDetails(error),
      },
      { status: 500 }
    );
  }
}
