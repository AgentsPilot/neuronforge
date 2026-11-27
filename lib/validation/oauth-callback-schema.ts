// lib/validation/oauth-callback-schema.ts

import { z } from 'zod';

/**
 * Validation for the plugin OAuth callback boundary (`/oauth/callback/[plugin]`).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE INVARIANT THESE SCHEMAS SERVE
 *
 * The callback's `state` is a client-chosen blob. It is a HINT about the flow,
 * never an identity. Identity comes from the session (`getUser()`), and the
 * plugin comes from the route segment; the state's copies of those two are
 * tolerated only so in-flight flows keep working, and the callback refuses
 * when either disagrees with the authenticated request.
 *
 * So these schemas exist to make the blob a known shape with bounded size —
 * not to make it trustworthy. Nothing downstream may treat a field here as
 * authority. CLAUDE.md rule 2: this boundary previously ran `JSON.parse` into
 * an implicit `any` and destructured it.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * Upper bounds, so a malformed or oversized callback is refused before any
 * parsing, logging or outbound call. Generous enough for every real provider:
 * the longest authorization codes in use are a few hundred characters, and the
 * state carries at most a uuid, a plugin key and a PKCE verifier (RFC 7636
 * caps the verifier at 128 characters).
 */
export const OAUTH_CALLBACK_MAX_CODE_LENGTH = 4096;
export const OAUTH_CALLBACK_MAX_STATE_LENGTH = 4096;

/** `?code=…&state=…` as it must look before anything reads it. */
export const oauthCallbackQuerySchema = z.object({
  code: z.string().min(1).max(OAUTH_CALLBACK_MAX_CODE_LENGTH),
  state: z.string().min(1).max(OAUTH_CALLBACK_MAX_STATE_LENGTH),
});

export type OAuthCallbackQuery = z.infer<typeof oauthCallbackQuerySchema>;

/**
 * The decoded `state` object.
 *
 * `.strip()` (Zod's default for objects, stated here on purpose) drops every
 * unknown key — the producers also send `timestamp` and `random`, which no
 * consumer reads.
 *
 * `user_id` is REQUIRED even though it is never used as an identity: both
 * producers always send it, so requiring it costs no real flow, and it means a
 * callback that reaches us without one is refused rather than accepted on the
 * session alone. It is still only ever COMPARED against `getUser()`.
 */
export const oauthCallbackStateSchema = z
  .object({
    // Tolerated, compared, never trusted. Not an identity source.
    user_id: z.string().uuid(),
    // Tolerated, compared against the route segment, never used for storage.
    plugin_key: z.string().min(1).max(100),
    // See the read site in lib/server/user-plugin-connections.ts for why this
    // is not a control today.
    code_verifier: z.string().min(1).max(256).optional(),
  })
  .strip();

export type OAuthCallbackState = z.infer<typeof oauthCallbackStateSchema>;

/**
 * Decode and validate a raw `state` query value.
 *
 * Returns `null` rather than throwing, because every malformed-state outcome on
 * this route is the same refusal and must not surface a parser message to the
 * browser.
 */
export function parseOAuthCallbackState(rawState: string): OAuthCallbackState | null {
  try {
    const decoded = JSON.parse(decodeURIComponent(rawState));
    const result = oauthCallbackStateSchema.safeParse(decoded);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
