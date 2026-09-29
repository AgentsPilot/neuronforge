/**
 * Who an invitation email is from, and where a reply goes (invite-only signup
 * Slice 2a; requirement FR-15, T-11, BQ-9; workplan D-1 to D-3).
 *
 * Pure: no I/O, no env. The platform's sending ADDRESS comes from
 * `platformSenderAddress()` in the transport (and is `undefined` when it is not
 * configured, SA R-2); this file only builds the header around it.
 *
 * ── "<Name> via AgentPilot" ─────────────────────────────────────────────────
 * The display name is the inviter's; the envelope address stays on our own
 * verified domain (the `resolveSender` rationale in `emailTransport.ts`). The
 * name is admin-entered text headed for a mail header, so it is cleaned first:
 * quotes, backslashes, angle brackets and every control character (CR and LF
 * among them) are removed, and it is capped at 64 code points, cut on a whole
 * code point so an emoji is never split.
 *
 * ── The fallback (BQ-9, D-3) ────────────────────────────────────────────────
 * An admin with no name on record is snapshotted as "AgentPilot"
 * (`INVITER_NAME_FALLBACK` in `adminInviteOps.ts`; a test pins the two
 * together). That renders `AgentPilot <address>`, never "AgentPilot via
 * AgentPilot".
 */

/** The platform brand every invitation is sent "via". */
export const INVITE_SENDER_BRAND = 'AgentPilot';

/** The longest inviter name put in a From header, in code points. */
export const INVITE_SENDER_NAME_MAX = 64;

/** The longest Reply-To stored; mirrors the database CHECK (3..320). */
const REPLY_TO_MIN = 3;
const REPLY_TO_MAX = 320;

/** One `@`, no spaces, brackets, quotes or separators. */
const ADDRESS_SHAPE = /^[^\s@<>()"',;:\\]+@[^\s@<>()"',;:\\]+$/;

/** Is this the platform fallback name rather than a person's? */
export function isPlatformFallbackName(name: string | null | undefined): boolean {
  return typeof name !== 'string' || name.trim().length === 0 || name.trim() === INVITE_SENDER_BRAND;
}

/** The inviter's name as a mail header may carry it (see the file header). */
export function cleanInviterName(name: string | null | undefined): string {
  if (typeof name !== 'string') return '';
  const stripped = name.replace(/["\\<>\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return Array.from(stripped).slice(0, INVITE_SENDER_NAME_MAX).join('').trim();
}

/**
 * The From header: `"<Name> via AgentPilot" <address>`, or `AgentPilot <address>`
 * for the fallback name or a name that cleans to nothing.
 */
export function buildInviteFromHeader(displayName: string | null | undefined, platformAddress: string): string {
  const name = cleanInviterName(displayName);
  if (isPlatformFallbackName(name)) return `${INVITE_SENDER_BRAND} <${platformAddress}>`;
  return `"${name} via ${INVITE_SENDER_BRAND}" <${platformAddress}>`;
}

/**
 * The Reply-To snapshot (D-2): the issuing admin's own auth email, trimmed and
 * lower-cased, or `null` when there is none or it does not look like an
 * address. Taken from the gate, never from a request body. Satisfies the
 * `business_os_invites_inviter_reply_to_normalised` CHECK by construction.
 */
export function normaliseReplyToAddress(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const address = value.trim().toLowerCase();
  const length = Array.from(address).length;
  if (length < REPLY_TO_MIN || length > REPLY_TO_MAX) return null;
  return ADDRESS_SHAPE.test(address) ? address : null;
}
