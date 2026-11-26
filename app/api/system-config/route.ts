import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { systemConfigRepository } from '@/lib/repositories';

const logger = createLogger({ module: 'SystemConfigAPI' });

/* A signed-in, per-user response: it must never become cacheable through a later
   refactor that stops reading cookies or search params. */
export const dynamic = 'force-dynamic';

/**
 * The only settings this browser-facing route will ever return, grouped by the
 * category a caller may ask for. Adding a key here is a deliberate decision to
 * expose it to every signed-in user — anything not listed is never returned,
 * whatever the table holds. Both lists below are derived from this one map, so
 * category mode and keys mode cannot drift apart.
 *
 * Never add a key named `success`, `error`, `details` or `data`: the success body
 * is a flat map (see GET below) and such a key would collide with the error
 * envelope. Workplan: docs/workplans/system-config-route-auth-workplan.md.
 */
const CLIENT_READABLE_SYSTEM_CONFIG = {
  agent_creation: ['agent_creation_ai_provider', 'agent_creation_ai_model'],
} as const;

type ClientReadableCategory = keyof typeof CLIENT_READABLE_SYSTEM_CONFIG;

// Cast: `z.enum` needs a non-empty string tuple, and `Object.keys` is typed `string[]`;
// the map above is a non-empty literal, so the tuple shape holds.
const CLIENT_READABLE_CATEGORIES = Object.keys(
  CLIENT_READABLE_SYSTEM_CONFIG,
) as [ClientReadableCategory, ...ClientReadableCategory[]];

const CLIENT_READABLE_KEYS: ReadonlySet<string> = new Set(
  Object.values(CLIENT_READABLE_SYSTEM_CONFIG).flat(),
);

const KEY_PATTERN = /^[a-z0-9_]{1,100}$/;
const MAX_KEYS = 20;
/** Bounds the work done on the raw string before it is split. */
const MAX_KEYS_PARAM_LENGTH = 2100;

const keysSchema = z
  .string()
  .max(MAX_KEYS_PARAM_LENGTH)
  .transform((raw) => raw.split(',').map((segment) => segment.trim()))
  .pipe(z.array(z.string().regex(KEY_PATTERN)).min(1).max(MAX_KEYS))
  .transform((keys) => [...new Set(keys)]);

const querySchema = z
  .object({
    category: z.enum(CLIENT_READABLE_CATEGORIES).optional(),
    keys: keysSchema.optional(),
  })
  .superRefine((query, ctx) => {
    if ((query.category === undefined) === (query.keys === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide exactly one of `category` or `keys`',
      });
    }
  });

/**
 * GET /api/system-config?category=<category> | ?keys=<key>,<key>
 *
 * Contract:
 * - Signed-in users only (401 otherwise).
 * - Only keys in `CLIENT_READABLE_SYSTEM_CONFIG` are ever queried or returned. In keys
 *   mode, a requested key that is not on the list is simply absent from the response; an
 *   unknown category is a 400.
 * - The success body is a FLAT `{ [key]: value }` map, not `{ success, data }`, because the
 *   agent creation page (`app/v2/agents/new/page.tsx`) reads it that way; the route test's
 *   T15 invariant protects it. Changing the shape means changing that page in the same
 *   commit (workplan FU-2). Error bodies use the standard `{ success: false, error, details }`.
 */
export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });
  const startTime = Date.now();

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 },
      );
    }

    const { searchParams } = request.nextUrl;
    const parsed = querySchema.safeParse({
      category: searchParams.get('category') ?? undefined,
      keys: searchParams.get('keys') ?? undefined,
    });

    if (!parsed.success) {
      requestLogger.warn(
        { userId: user.id, issueCount: parsed.error.issues.length },
        'Invalid system config query',
      );
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid input',
          details: process.env.NODE_ENV === 'development' ? parsed.error.flatten() : undefined,
        },
        { status: 400 },
      );
    }

    const { category, keys } = parsed.data;
    const requestedKeys: readonly string[] = category
      ? CLIENT_READABLE_SYSTEM_CONFIG[category]
      : keys ?? [];
    const allowedKeys = requestedKeys.filter((key) => CLIENT_READABLE_KEYS.has(key));

    const logContext = {
      userId: user.id,
      mode: category ? 'category' : 'keys',
      category,
      requestedCount: requestedKeys.length,
      allowedCount: allowedKeys.length,
    };

    if (allowedKeys.length === 0) {
      requestLogger.debug(
        { ...logContext, returnedCount: 0, durationMs: Date.now() - startTime },
        'System config fetched',
      );
      return NextResponse.json({});
    }

    const { data, error } = await systemConfigRepository.getByKeys(allowedKeys);

    if (error) {
      requestLogger.error({ err: error, ...logContext }, 'Failed to fetch system config');
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to fetch configuration',
          details: process.env.NODE_ENV === 'development' ? error.message : undefined,
        },
        { status: 500 },
      );
    }

    // Belt and braces: whatever the repository returns, only the keys resolved above
    // (all allow-listed) may reach the response.
    const allowed = new Set(allowedKeys);
    const configMap: Record<string, unknown> = {};
    for (const row of data ?? []) {
      if (allowed.has(row.key)) {
        configMap[row.key] = row.value;
      }
    }

    requestLogger.debug(
      {
        ...logContext,
        returnedCount: Object.keys(configMap).length,
        durationMs: Date.now() - startTime,
      },
      'System config fetched',
    );

    return NextResponse.json(configMap);
  } catch (error) {
    requestLogger.error({ err: error }, 'Unexpected error fetching system config');
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details:
          process.env.NODE_ENV === 'development'
            ? error instanceof Error
              ? error.message
              : String(error)
            : undefined,
      },
      { status: 500 },
    );
  }
}
