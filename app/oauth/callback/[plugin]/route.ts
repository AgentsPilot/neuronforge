// app/oauth/callback/[plugin]/route.ts

import { NextRequest, NextResponse } from 'next/server';
import type { Logger } from 'pino';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { logAndFlush } from '@/lib/audit/boundedAuditFlush';
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';
import { UserPluginConnections } from '@/lib/server/user-plugin-connections';
import type { PluginDefinition, UserConnection } from '@/lib/types/plugin-types';
import {
  oauthCallbackQuerySchema,
  parseOAuthCallbackState,
} from '@/lib/validation/oauth-callback-schema';

const logger = createLogger({ module: 'OAuthCallbackAPI' });

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || '';

/** What the browser is told. Deliberately says nothing about our internals. */
const REFUSED_MESSAGE =
  'We could not confirm which account this authorization belongs to. Please sign in and start the connection again.';

/** Escape a string for safe embedding inside a JS single-quoted literal. */
function escapeJs(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/</g, '\\x3c')
    .replace(/>/g, '\\x3e')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** Escape a string for embedding in HTML text content. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Build an HTML page that posts a message to the opener window and closes itself.
 *
 * Note: `postMessage(msg, '')` THROWS in the browser when
 * `NEXT_PUBLIC_APP_URL` is unset, so nothing server-side — least of all a
 * refusal — may depend on the opener having heard this. Every decision is
 * already final by the time this renders.
 */
function buildPostMessageResponse(
  plugin: string,
  payload: {
    success: boolean;
    error?: string;
    details?: string;
    data?: Record<string, string>;
    /**
     * Rendered into the page body, for the paths where the user must be told
     * something even if the opener never hears the message: the `postMessage`
     * below throws when the origin is empty, which aborts the script before
     * `window.close()`, leaving this text on screen.
     */
    bodyMessage?: string;
  }
): NextResponse {
  const safePlugin = escapeJs(plugin);
  const safeOrigin = escapeJs(APP_URL);

  const dataBlock = payload.data
    ? `,\n              data: { ${Object.entries(payload.data).map(([k, v]) => `${k}: '${escapeJs(v)}'`).join(', ')} }`
    : '';

  const errorBlock = payload.error
    ? `,\n              error: '${escapeJs(payload.error)}'`
    : '';

  const detailsBlock = payload.details
    ? `,\n              details: '${escapeJs(payload.details)}'`
    : '';

  const bodyHtml = payload.success
    ? '<h3>Authorization Successful!</h3><p>Closing window...</p>'
    : payload.bodyMessage
      ? `<p>${escapeHtml(payload.bodyMessage)}</p>`
      : '';

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * NO OPENER IS NORMAL, AND THE CONNECTION IS ALREADY SAVED.
   *
   * Google's consent pages send `Cross-Origin-Opener-Policy`, which swaps the
   * browsing context group and leaves `window.opener` NULL when the popup
   * comes back to us. Nothing is wrong when that happens: the token exchange
   * ran in the route above and the connection is stored before a byte of this
   * HTML is written.
   *
   * This branch used to say "Please close this window and try again", in red,
   * on a successful connection. An owner who follows that instruction
   * reconnects an account that was already connected, and the one who does not
   * is left looking at an error and a window that never closes, because the
   * `window.close()` was inside the opener branch.
   *
   * So: say what happened, and close. The opener cannot be told, so the page
   * that opened this window finds out by asking — see `waitForOAuthCompletion`,
   * which verifies the connection when the popup closes without a message.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const noOpenerFallback = payload.success
    ? `\n            } else {\n              document.body.innerHTML = '<h3>Connected</h3><p>You can close this window and carry on.</p>';\n              setTimeout(() => window.close(), 1200);`
    : `\n            } else {\n              window.close();`;

  return new NextResponse(
    `<html><body>${bodyHtml}<script>
            if (window.opener) {
              window.opener.postMessage({
                type: 'plugin-connected',
                plugin: '${safePlugin}',
                success: ${payload.success}${errorBlock}${detailsBlock}${dataBlock}
              }, '${safeOrigin}');
              setTimeout(() => window.close(), ${payload.success ? 500 : 100});
${noOpenerFallback}
            }
          </script></body></html>`,
    { headers: { 'Content-Type': 'text/html' } }
  );
}

/**
 * Was an auth cookie present on the request at all?
 *
 * Same predicate `lib/auth.ts` uses to decide there is a session to verify, so
 * this distinguishes "no cookie reached us" from "a cookie reached us and did
 * not verify". That distinction is the evidence for later making the cookie a
 * hard precondition; it is recorded as a BOOLEAN — never the cookie, never the
 * state, never the code.
 */
function hasAuthCookie(request: NextRequest): boolean {
  return request.cookies.getAll().some((c) => c.name.includes('auth-token'));
}

/**
 * Request metadata for a refusal row, with unknown values OMITTING their key.
 *
 * It goes in `details` rather than being collected by passing `request` to the
 * audit service, which is the obvious route and the wrong one:
 * `extractRequestContext` copies a live bearer or refresh token into
 * `session_id`. A refusal row is read by an operator investigating; it must
 * never become a place credentials accumulate (SA D-1, the ruling recorded in
 * `lib/audit/recordRefusedAccess.ts`). This handler holds a `NextRequest`, so
 * it reads the headers it already has instead of the ambient `headers()`.
 *
 * Omitting rather than writing 'unknown' keeps "not captured" and "captured as
 * unknown" distinguishable — same reasoning as that module's.
 */
function refusalRequestDetails(request: NextRequest): Record<string, string> {
  const details: Record<string, string> = {};
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const ip = forwarded || request.headers.get('x-real-ip');
  const userAgent = request.headers.get('user-agent');
  if (ip) details.ip_address = ip;
  if (userAgent) details.user_agent = userAgent;
  return details;
}

/** Why a callback was refused. Coarse on purpose: a label, not an echo. */
type RefusalReason = 'no_session' | 'state_unreadable' | 'user_mismatch' | 'plugin_mismatch';

// GET /oauth/callback/[plugin]?code={code}&state={state}
// Handles OAuth callbacks from various plugins (Gmail, Slack, etc.)
//
// ─────────────────────────────────────────────────────────────────────────────
// THE INVARIANT: IDENTITY IS SESSION-SCOPED.
//
// Precisely that, and no more. The state is still unsigned and not yet bound to
// the flow that issued it, so this is not end-to-end protection of the
// callback; signed state is the next slice.
//
// This is a cross-site top-level GET from a vendor, and the `state` it carries
// back is a blob the client authored. The account a grant is stored under is
// therefore decided by `getUser()` and the plugin by the route segment; the
// state's copies of both are compared and must agree, and a disagreement is
// REFUSED rather than quietly overridden (overriding would still land the
// write on the signed-in user, which is not a safe outcome either).
//
// All of it happens BEFORE the token exchange: refusing afterwards would mean
// we had already minted a live vendor grant for a request we then discard, and
// would hand an unauthenticated GET a free outbound call.
//
// The write underneath runs as the service role with an upsert whose conflict
// target is (`user_id`, `plugin_key`), so RLS on `plugin_connections` is
// BYPASSED and is not a mitigation here — this handler is the isolation
// boundary (`tenant-isolation-guard`).
// ─────────────────────────────────────────────────────────────────────────────
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ plugin: string }> }
) {
  const { plugin } = await params;
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ plugin, correlationId });
  const authCookiePresent = hasAuthCookie(request);

  /**
   * Refuse, record it, and tell the opener nothing useful.
   *
   * The row is written through `logAndFlush`, not `log()` + `flush()`:
   * `AuditTrail.log()` awaits `buildLogEntry` BEFORE it queues the entry, so a
   * `flush()` issued in the same tick finds an empty queue, takes its early
   * return, and leaves the row to the 5-second batch timer that a freezing
   * serverless instance beats. `logAndFlush` chains the two, is bounded, never
   * rejects, and serialises against other callers. The refusal row is the only
   * trace this path leaves, so losing it defeats the point of recording it.
   *
   * `recordRefusedAccess` is the sibling precedent and its conventions are
   * followed here (no `request`, metadata in `details`, classification left to
   * `EVENT_METADATA`), but it is not reusable as-is: it is the single writer of
   * `SECURITY_UNAUTHORIZED_ACCESS` with a pinned surface list and the fixed
   * reason `not_an_admin`, none of which describe a plugin callback.
   */
  const refuse = async (
    reason: RefusalReason,
    sessionUserId: string | null
  ): Promise<NextResponse> => {
    // `plugin` and `correlationId` ride along on the child logger's bindings.
    requestLogger.warn(
      { reason, authCookiePresent },
      'OAuth callback refused: identity must come from the session'
    );

    await logAndFlush(
      {
        action: AUDIT_EVENTS.PLUGIN_AUTH_REFUSED,
        entityType: 'connection',
        resourceName: plugin.slice(0, 100),
        // The session user, or nobody. Never the id the callback asked for —
        // attributing to that would let a caller write audit rows against an
        // account that is not theirs.
        userId: sessionUserId,
        details: {
          plugin_key: plugin.slice(0, 100),
          reason,
          auth_cookie_present: authCookiePresent,
          correlation_id: correlationId,
          ...refusalRequestDetails(request),
        },
        // No severity, no complianceFlags, no request: the registration in
        // `events.ts` owns the classification (the PR #157 / #160 lesson).
      },
      requestLogger,
      { reason: 'refused plugin OAuth callback', continues: 'the refusal is unaffected' }
    );

    return buildPostMessageResponse(plugin, {
      success: false,
      error: REFUSED_MESSAGE,
      // Shown on the page too, because the opener may never hear the message.
      bodyMessage: REFUSED_MESSAGE,
    });
  };

  try {
    const { searchParams } = new URL(request.url);

    requestLogger.info('OAuth callback received');

    // Check for OAuth errors from provider
    const oauthError = searchParams.get('error');
    if (oauthError) {
      const errorDescription = searchParams.get('error_description');
      requestLogger.error({ oauthError, errorDescription }, 'OAuth error from provider');

      return buildPostMessageResponse(plugin, {
        success: false,
        error: `${oauthError}: ${errorDescription || 'OAuth authorization failed'}`,
      });
    }

    // Validate the query at the boundary (CLAUDE.md rule 2) — length-capped, so
    // an oversized callback is refused before anything reads or logs it.
    const query = oauthCallbackQuerySchema.safeParse({
      code: searchParams.get('code') ?? undefined,
      state: searchParams.get('state') ?? undefined,
    });
    if (!query.success) {
      requestLogger.error(
        // Which field failed and how — never the field's value.
        { issues: query.error.issues.map((i) => ({ path: i.path, issueCode: i.code })) },
        'OAuth callback query failed validation'
      );

      return buildPostMessageResponse(plugin, {
        success: false,
        error: 'Missing authorization code or state parameter',
      });
    }

    // ── Identity, before any outbound call ────────────────────────────────
    const user = await getUser();
    if (!user) {
      return refuse('no_session', null);
    }

    const parsedState = parseOAuthCallbackState(query.data.state);
    if (!parsedState) {
      return refuse('state_unreadable', user.id);
    }

    // The producers both send `user_id`, so it is required by the schema above
    // and must agree with the session. Tolerated and compared — never used as
    // the identity.
    if (parsedState.user_id !== user.id) {
      return refuse('user_mismatch', user.id);
    }

    // The tokens are exchanged with the PATH plugin's credentials and scopes,
    // so they are stored under the path plugin. A state naming a different one
    // would label a grant as a surface other than the one it is scoped for.
    if (parsedState.plugin_key !== plugin) {
      return refuse('plugin_mismatch', user.id);
    }

    // Get plugin manager and user connections
    const pluginManager = await PluginManagerV2.getInstance();
    const userConnections = UserPluginConnections.getInstance();

    // Get plugin definition
    const pluginDefinition = pluginManager.getPluginDefinition(plugin);
    if (!pluginDefinition) {
      requestLogger.error({ plugin }, 'Plugin definition not found');

      return buildPostMessageResponse(plugin, {
        success: false,
        error: 'Plugin configuration not found',
      });
    }

    // Handle OAuth callback. Identity and plugin are passed in from the
    // authenticated request — the callee reads neither from the state.
    const connection = await userConnections.handleOAuthCallback(
      query.data.code,
      query.data.state,
      user.id,
      plugin,
      pluginDefinition.plugin.auth_config,
      request
    );

    // Extract and save plugin-specific profile data (driven by plugin definition)
    await extractPluginProfileData(searchParams, connection, pluginDefinition, userConnections, requestLogger);

    // The connection / failure rows are written AND flushed inside
    // `handleOAuthCallback` itself, so neither depends on how many awaits
    // happen to sit between the queue and the response here.
    requestLogger.info({ userId: connection.user_id }, 'OAuth callback successful');

    return buildPostMessageResponse(plugin, {
      success: true,
      data: {
        plugin_key: connection.plugin_key,
        plugin_name: connection.plugin_name,
        username: connection.username || '',
        connected_at: connection.connected_at,
      },
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'OAuth callback failed');

    return buildPostMessageResponse(plugin, {
      success: false,
      error: 'OAuth callback failed',
      details:
        process.env.NODE_ENV === 'development' && error instanceof Error ? error.message : undefined,
    });
  }
}

/** Extract and save plugin-specific profile data based on oauth_callback_profile_params in the plugin definition. */
async function extractPluginProfileData(
  searchParams: URLSearchParams,
  connection: UserConnection,
  pluginDefinition: PluginDefinition,
  userConnections: UserPluginConnections,
  requestLogger: Logger
): Promise<void> {
  const profileParams: string[] | undefined = pluginDefinition.plugin.auth_config?.oauth_callback_profile_params;
  if (!profileParams?.length) return;

  try {
    const profileData: Record<string, string> = {};
    for (const param of profileParams) {
      const value = searchParams.get(param);
      if (value) profileData[param] = value;
    }

    if (Object.keys(profileData).length > 0) {
      await userConnections.updateConnectionProfileData(
        connection.user_id,
        connection.plugin_key,
        profileData
      );
      requestLogger.info({ storedParams: Object.keys(profileData) }, 'Stored plugin profile data');
    } else {
      // Key names only: the callback carries the one-time code and the state.
      requestLogger.warn(
        { expectedParams: profileParams, receivedKeys: [...searchParams.keys()] },
        'OAuth callback missing expected profile params'
      );
    }
  } catch (error) {
    // Don't throw - profile data storage failure shouldn't break the OAuth flow
    requestLogger.error({ err: error }, 'Failed to store plugin profile data');
  }
}
