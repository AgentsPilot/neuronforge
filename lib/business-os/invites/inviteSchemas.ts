/**
 * Zod schemas for the invite boundaries (C-5, C-7, AC-6).
 *
 * ── Built from config, never re-listed ──────────────────────────────────────
 * The expiry options, the champion month cap and the tier ids come from the
 * entitlements config folder, so a new tier becomes invitable, or an expiry
 * option changes, with no edit here (GR-1, T-14). They are NOT taken from
 * `adminOps`: that module's enums serve a different operation, and coupling the
 * two would let a change to one silently widen the other.
 *
 * ── `.strict()` everywhere ──────────────────────────────────────────────────
 * An unknown key is a 400, not an ignored field. That is what stops a request
 * from smuggling `grant_id`, `issuerAdminId`, `userId`, `tokenHash` or a level
 * into an invite (§8.1 "tampered grant"). The grant of a champion invite is not
 * a request field at all: it is read from config.
 *
 * Pure: no I/O. Safe to import from a route or a test.
 */

import { z } from 'zod';

import { locales } from '@/lib/i18n/config';
import {
  CHAMPION_ACCESS_MONTHS_MAX,
  CHAMPION_INVITE_TYPE,
  INVITE_LINK_EXPIRY,
  PAID_INVITE_TYPE,
} from '@/lib/business-os/entitlements/config/invites';
import { TIER_ORDER } from '@/lib/business-os/entitlements/config/tierMatrix';

/** Longest accepted email address (RFC 5321 path limit). */
const EMAIL_MAX = 320;

/** Personal note and reason limits: mirrored by the database CHECKs as a backstop. */
export const PERSONAL_NOTE_MAX = 1000;
export const REASON_MIN = 3;
export const REASON_MAX = 500;

/** Normalised (trimmed, lower-cased), then syntax-checked (FR-2). */
const emailSchema = z.string().trim().toLowerCase().min(3).max(EMAIL_MAX).email();

/** One of the configured expiry options, and nothing else (T-14). */
const linkExpiryDaysSchema = z
  .number()
  .int()
  .refine((days) => (INVITE_LINK_EXPIRY.optionsDays as readonly number[]).includes(days), {
    message: 'Link expiry must be one of the configured options',
  });

/** Plain text. An empty note after trimming means "no note". */
const personalNoteSchema = z.string().trim().max(PERSONAL_NOTE_MAX).optional();

/**
 * Characters as the database counts them (`char_length`): code points, not
 * UTF-16 units, so two emoji are 2 characters here as they are in SQL (QA-3).
 */
export function characterCount(value: string): number {
  return Array.from(value).length;
}

/** The admin's reason: 3 to 500 characters, counted as the database counts them. */
const reasonSchema = z
  .string()
  .trim()
  .refine((value) => characterCount(value) >= REASON_MIN, { message: `At least ${REASON_MIN} characters` })
  .refine((value) => characterCount(value) <= REASON_MAX, { message: `At most ${REASON_MAX} characters` });

/**
 * A champion's access end, decided at creation (RC-4: silence is never
 * "forever"). A REQUIRED key: omitting it is a 400.
 */
export const championAccessSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('open_ended') }).strict(),
  z
    .object({
      kind: z.literal('months'),
      months: z.number().int().min(1).max(CHAMPION_ACCESS_MONTHS_MAX),
    })
    .strict(),
]);

const commonCreateFields = {
  email: emailSchema,
  linkExpiryDays: linkExpiryDaysSchema,
  language: z.enum(locales),
  personalNote: personalNoteSchema,
  reason: reasonSchema,
  /**
   * Slice 2a (FR-14): email the invitation now. REQUIRED, with no default: an
   * older client that does not know about the email is refused (400) rather
   * than silently emailing someone. The sender, the Reply-To and the link are
   * never request fields; `.strict()` refuses `from`, `replyTo` and the like.
   */
  sendEmail: z.boolean(),
};

/**
 * The create body, discriminated on the invite type.
 *
 * Champion carries `access` and no `grantId`; Paid carries `grantId` (a tier id
 * from `TIER_ORDER`) and no `access`. Either extra key is refused.
 */
export const createInviteSchema = z.discriminatedUnion('inviteType', [
  z
    .object({
      inviteType: z.literal(CHAMPION_INVITE_TYPE),
      ...commonCreateFields,
      access: championAccessSchema,
    })
    .strict(),
  z
    .object({
      inviteType: z.literal(PAID_INVITE_TYPE),
      ...commonCreateFields,
      grantId: z.enum(TIER_ORDER),
    })
    .strict(),
]);

export type CreateInviteBody = z.infer<typeof createInviteSchema>;

/** The invite id in the revoke path. */
export const inviteIdSchema = z.string().uuid();

/** The revoke body: a reason and nothing else (FR-6). */
export const revokeInviteSchema = z.object({ reason: reasonSchema }).strict();

export type RevokeInviteBody = z.infer<typeof revokeInviteSchema>;

/**
 * The public validate body.
 *
 * Only the SHAPE is checked here. The token's format is checked afterwards and
 * a malformed token gets the same answer as an unknown one (AC-2); a 400 from
 * this schema says nothing about any token.
 */
export const validateInviteBodySchema = z.object({ token: z.string().max(512) }).strict();

// ── Slice 1b: the signup bodies ─────────────────────────────────────────────

/** bcrypt reads at most 72 BYTES and silently ignores the rest (SA R-13). */
export const PASSWORD_MAX_BYTES = 72;
export const PASSWORD_MIN_CHARACTERS = 8;

/**
 * A cheap character cap checked BEFORE the byte count (QA-1b-7), so a huge
 * string is refused without being encoded. Any password over 72 bytes is
 * refused anyway; 256 characters is far above every valid one.
 */
export const PASSWORD_MAX_CHARACTERS = 256;

/** UTF-8 length, which is what bcrypt counts. */
export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/**
 * The new account's password: at least 8 characters, at most 72 UTF-8 bytes
 * (R-13). A multi-byte password under 72 characters can exceed 72 bytes, and
 * bcrypt would then silently drop its tail. Never trimmed: spaces are the
 * person's choice.
 */
const passwordSchema = z
  .string()
  .max(PASSWORD_MAX_CHARACTERS)
  .refine((value) => characterCount(value) >= PASSWORD_MIN_CHARACTERS, {
    message: `At least ${PASSWORD_MIN_CHARACTERS} characters`,
  })
  .refine((value) => utf8ByteLength(value) <= PASSWORD_MAX_BYTES, { message: 'Too long' });

/** Request a code: the token and nothing else. */
export const signupCodeRequestSchema = z.object({ token: z.string().max(512) }).strict();

/**
 * Complete the signup: the token, the code and the password, and NOTHING else
 * (L-1, AC-6). An `email`, `userId`, `accountId`, `cohort`, `tier` or `level`
 * key is a 400: the email, the grant and the account id come from the server.
 */
export const completeSignupSchema = z
  .object({
    token: z.string().max(512),
    signupCode: z.string().regex(/^[0-9]{6}$/),
    password: passwordSchema,
  })
  .strict();

export type CompleteSignupBody = z.infer<typeof completeSignupSchema>;

// ── Slice 3b: sign up with Google ───────────────────────────────────────────

/** A compact JWS: three base64url segments. Google's ID tokens are well under 2 KB. */
export const GOOGLE_ID_TOKEN_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
export const GOOGLE_ID_TOKEN_MAX_LENGTH = 4096;

/** The raw nonce the page made: 32 random bytes, base64url without padding (43 characters, D-6). */
export const GOOGLE_RAW_NONCE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Complete the signup with Google: the invite token, Google's ID token and the
 * RAW nonce whose SHA-256 the page gave Google, and NOTHING else (L-1, AC-6,
 * §3.4). An `email`, `userId`, `accountId` or `cohort` key is a 400: the email
 * written is the invite row's, never the token's, and the account id is the
 * server's.
 */
export const completeGoogleSignupSchema = z
  .object({
    token: z.string().max(512),
    idToken: z.string().max(GOOGLE_ID_TOKEN_MAX_LENGTH).regex(GOOGLE_ID_TOKEN_PATTERN),
    nonce: z.string().regex(GOOGLE_RAW_NONCE_PATTERN),
  })
  .strict();

export type CompleteGoogleSignupBody = z.infer<typeof completeGoogleSignupSchema>;
