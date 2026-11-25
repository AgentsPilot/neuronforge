/**
 * Who email may go to, when it may not go to everyone (PROD-1b, A7).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ONE RECIPIENT CHECK EVERY SEND PATH CALLS.
 *
 * The guard is ON when either is true (SA-E1):
 *   - the deployment is not Vercel production (`isProductionDeployment`), or
 *   - `EMAIL_RECIPIENT_ALLOWLIST` is present in the environment, even on
 *     production. Today's Production target still serves the staging world
 *     with live crons, so setting the list there protects it now; the list is
 *     removed from Production at the real production cutover.
 *
 * While it is on, only listed recipients may be mailed. Unset, empty, or a
 * list with no valid entry allows NOBODY (SA-E2): fail closed, never open.
 * Presence is the switch, so a value someone set on purpose (even an empty
 * one) can never mean "no guard" (SA D-13).
 *
 * With the guard off (production, variable absent) the check returns at once
 * and reads nothing else, so production does no new work.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * GRAMMAR. Entries are separated by commas, semicolons or whitespace. An entry
 * is an exact address (`name@team.example`) or a whole domain (`@team.example`).
 * Matching is case-insensitive; a domain entry matches that domain exactly (not
 * its subdomains, not a longer domain ending in the same text). Wildcards, bare
 * domains and anything not address-shaped are ignored and counted invalid, so
 * there is no way to write "everyone".
 *
 * PRIVACY. A verdict carries counts only, never an address, so a caller that
 * logs the verdict cannot log a recipient by accident.
 *
 * Pure and edge-safe: no logger, no Node-only import. The admin Environment
 * page counts entries with `parseRecipientAllowList`, the same parser the
 * guard uses, so the two cannot disagree.
 *
 * @module lib/email/recipientAllowList
 */

import { isProductionDeployment } from '@/lib/utils/deploymentEnvironment';

/** The one log message every refusing path uses, so an operator searches for one string. */
export const RECIPIENT_REFUSED_MESSAGE = 'Email not sent: recipient not on the allow-list';

export interface ParsedRecipientAllowList {
  addresses: ReadonlySet<string>;
  domains: ReadonlySet<string>;
  invalidEntries: number;
}

export type RecipientRefusalReason = 'allowlist_unset' | 'recipient_not_allowed' | 'unparseable_recipient';

export type OutboundRecipientVerdict =
  | { allowed: true; basis: 'production' | 'allowlist' }
  | {
      allowed: false;
      reason: RecipientRefusalReason;
      recipientCount: number;
      refusedCount: number;
    };

/* A domain: two or more labels of letters, digits and hyphens. No wildcard can match it. */
const DOMAIN_SHAPE = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)(?:[.][a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;
/* A local part: no whitespace, no `@`, no brackets or separators, no `*`. */
const LOCAL_SHAPE = /^[^\s@<>()"',;:*]+$/;
const ENTRY_SEPARATORS = /[\s,;]+/;
const RECIPIENT_SEPARATORS = /[,;]/;
const BRACKETED = /<([^<>]*)>\s*$/;

/** `user@domain`, lower-cased and trimmed, or null when it is not address-shaped. */
function normaliseAddress(value: string): string | null {
  const address = value.trim().toLowerCase();
  const at = address.lastIndexOf('@');
  if (at <= 0 || at !== address.indexOf('@')) return null;
  const local = address.slice(0, at);
  const domain = address.slice(at + 1);
  return LOCAL_SHAPE.test(local) && DOMAIN_SHAPE.test(domain) ? address : null;
}

/** Parse the allow-list value. Never throws; an unusable value parses to "nobody". */
export function parseRecipientAllowList(raw: string | undefined | null): ParsedRecipientAllowList {
  const addresses = new Set<string>();
  const domains = new Set<string>();
  let invalidEntries = 0;

  for (const entry of (raw ?? '').split(ENTRY_SEPARATORS)) {
    if (entry.length === 0) continue;
    const lowered = entry.toLowerCase();
    if (lowered.startsWith('@')) {
      const domain = lowered.slice(1);
      if (DOMAIN_SHAPE.test(domain)) domains.add(domain);
      else invalidEntries += 1;
      continue;
    }
    const address = normaliseAddress(lowered);
    if (address) addresses.add(address);
    else invalidEntries += 1;
  }

  return { addresses, domains, invalidEntries };
}

/** Is the recipient guard on for this deployment? See the module header. */
export function isRecipientGuardOn(): boolean {
  return !isProductionDeployment() || process.env.EMAIL_RECIPIENT_ALLOWLIST !== undefined;
}

/**
 * Every recipient address in a set of recipient fields, flattened.
 *
 * For the plugin executors, whose `to`, `cc` and `bcc` arrive as a string, a
 * comma-joined string or an array. `null` and `undefined` are absent fields.
 * Anything else (an object, a number) is kept as an empty string, which the
 * check refuses as unparseable: an unexpected shape never slips past as
 * "no recipient".
 */
export function recipientsOf(...fields: unknown[]): string[] {
  const out: string[] = [];
  const visit = (value: unknown): void => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    out.push(typeof value === 'string' ? value : '');
  };
  for (const field of fields) visit(field);
  return out;
}

/**
 * May a message go to every one of these recipients?
 *
 * Each element may hold several addresses separated by commas or semicolons
 * (SMTP joins `to` with commas, so `"a@x, b@y"` is two recipients), and a
 * display-name form `Name <addr>` is read for the address in brackets. A list
 * that mixes allowed and refused recipients is refused whole (SA D-2).
 */
export function checkOutboundRecipients(recipients: readonly string[]): OutboundRecipientVerdict {
  if (!isRecipientGuardOn()) return { allowed: true, basis: 'production' };

  const pieces: Array<string | null> = [];
  for (const element of recipients) {
    const parts = String(element ?? '').split(RECIPIENT_SEPARATORS).map((part) => part.trim());
    const nonEmpty = parts.filter((part) => part.length > 0);
    if (nonEmpty.length === 0) {
      pieces.push(null);
      continue;
    }
    for (const part of nonEmpty) {
      const bracketed = part.match(BRACKETED);
      /*
       * SA code review 3: an `@` outside the brackets (`x@other.example
       * <listed@team.example>`) is refused. A provider might read either
       * address, so the piece is only allowed when there is exactly one.
       */
      if (bracketed && part.slice(0, bracketed.index).includes('@')) {
        pieces.push(null);
        continue;
      }
      pieces.push(normaliseAddress(bracketed ? bracketed[1] : part));
    }
  }

  const recipientCount = pieces.length;
  if (recipientCount === 0) {
    return { allowed: false, reason: 'unparseable_recipient', recipientCount: 0, refusedCount: 0 };
  }

  const list = parseRecipientAllowList(process.env.EMAIL_RECIPIENT_ALLOWLIST);
  if (list.addresses.size === 0 && list.domains.size === 0) {
    return { allowed: false, reason: 'allowlist_unset', recipientCount, refusedCount: recipientCount };
  }

  let unparseable = 0;
  let refused = 0;
  for (const address of pieces) {
    if (address === null) {
      unparseable += 1;
      continue;
    }
    const domain = address.slice(address.indexOf('@') + 1);
    if (!list.addresses.has(address) && !list.domains.has(domain)) refused += 1;
  }

  if (unparseable > 0) {
    return { allowed: false, reason: 'unparseable_recipient', recipientCount, refusedCount: unparseable + refused };
  }
  if (refused > 0) {
    return { allowed: false, reason: 'recipient_not_allowed', recipientCount, refusedCount: refused };
  }
  return { allowed: true, basis: 'allowlist' };
}

/** The fields a refusal is logged with: counts and the reason, never an address (SA-E2). */
export function refusalLogFields(verdict: Extract<OutboundRecipientVerdict, { allowed: false }>): {
  reason: RecipientRefusalReason;
  isProduction: boolean;
  recipientCount: number;
  refusedCount: number;
} {
  return {
    reason: verdict.reason,
    isProduction: isProductionDeployment(),
    recipientCount: verdict.recipientCount,
    refusedCount: verdict.refusedCount,
  };
}
