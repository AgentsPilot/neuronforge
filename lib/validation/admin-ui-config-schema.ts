// lib/validation/admin-ui-config-schema.ts

/**
 * Write-side validation for `/api/admin/ui-config` (slice F-1).
 *
 * The read side (`lib/design-system-v2/customTokens.ts`, TH-1) is the security
 * boundary: it decides what reaches the inlined `<style>` on owner pages. This
 * module makes the save agree with it, so an admin is told "not valid" instead
 * of "saved" for a value every page would then silently ignore.
 *
 * One grammar, two sides: the schema is BUILT from `V2_CUSTOM_TOKEN_VARS` and
 * every value goes through `validTokenValue`. No token pattern is declared here.
 * It cannot live in `customTokens.ts` itself, because that module must import
 * nothing (TH-1 guard G-12). The parity test in
 * `lib/validation/__tests__/admin-ui-config-schema.test.ts` pins the two sides
 * together.
 *
 * Prototype safety: the input's keys are never used to assign onto a plain
 * object. Empty-value removal copies through `Object.fromEntries` (which creates
 * an own `__proto__` key instead of setting the prototype), and allow-list
 * membership is checked with `hasOwnProperty`, never `in`, so `constructor` and
 * `__proto__` are unknown keys and are rejected by `.strict()`.
 */

import { z } from 'zod';
import {
  V2_CUSTOM_TOKEN_VARS,
  validTokenValue,
  type V2CustomTokenGroup,
  type V2CustomTokens,
} from '@/lib/design-system-v2/customTokens';

const GROUPS = Object.keys(V2_CUSTOM_TOKEN_VARS) as V2CustomTokenGroup[];

const hasOwn = (obj: object, key: string) => Object.prototype.hasOwnProperty.call(obj, key);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAllowedGroup(group: string): group is V2CustomTokenGroup {
  return hasOwn(V2_CUSTOM_TOKEN_VARS, group);
}

function isAllowedKey(group: V2CustomTokenGroup, key: string): boolean {
  return hasOwn(V2_CUSTOM_TOKEN_VARS[group], key);
}

/**
 * "Use the default": the page stores `''` when an admin clears a field. An
 * allow-listed key whose value is a string that trims to `''` is removed, and an
 * allow-listed group left empty is removed (SA ruling Q-1, R-2).
 *
 * Everything else is kept exactly as sent, so the schema still rejects it: an
 * unknown key is rejected even when its value is `''`, and `null` or a number is
 * rejected rather than stripped. Never throws; a non-object passes through.
 */
export function stripEmptyTokenValues(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;
  return Object.fromEntries(
    Object.entries(raw).flatMap(([group, source]): Array<[string, unknown]> => {
      if (!isAllowedGroup(group) || !isRecord(source)) return [[group, source]];
      const kept = Object.fromEntries(
        Object.entries(source).filter(
          ([key, value]) => !(isAllowedKey(group, key) && typeof value === 'string' && value.trim() === '')
        )
      );
      return Object.keys(kept).length === 0 ? [] : [[group, kept]];
    })
  );
}

/** One allow-listed token: valid → the trimmed value (what the read side emits). */
function tokenValueSchema(group: V2CustomTokenGroup) {
  return z
    .unknown()
    .transform((value, ctx) => {
      const valid = validTokenValue(group, value);
      if (valid === null) {
        // No value in the message: the issue may be logged or returned.
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid token value' });
        return z.NEVER;
      }
      return valid;
    })
    .optional();
}

function groupSchema(group: V2CustomTokenGroup) {
  const shape = Object.fromEntries(
    Object.keys(V2_CUSTOM_TOKEN_VARS[group]).map((key) => [key, tokenValueSchema(group)])
  );
  return z.object(shape).strict().optional();
}

const tokensObjectSchema = z
  .object(Object.fromEntries(GROUPS.map((group) => [group, groupSchema(group)])))
  .strict();

/**
 * The tokens an admin saves. Accepts an object iff every group and key is
 * allow-listed and every non-empty value passes its group's grammar; outputs the
 * trimmed values with empty ones removed.
 */
export const v2CustomTokensWriteSchema = z
  .preprocess(stripEmptyTokenValues, tokensObjectSchema)
  .transform((tokens) => tokens as V2CustomTokens);

export const UI_VERSIONS = ['v1', 'v2'] as const;
export type UiVersion = (typeof UI_VERSIONS)[number];

export const uiConfigPostSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('update_version'),
    data: z.object({ version: z.enum(UI_VERSIONS) }).strict(),
  }),
  z.object({
    action: z.literal('save_tokens'),
    data: z.object({ tokens: v2CustomTokensWriteSchema }).strict(),
  }),
  z.object({
    action: z.literal('reset_tokens'),
    // The page sends `{}`; nothing in it is used.
    data: z.unknown().optional(),
  }),
]);

export type UiConfigPostInput = z.infer<typeof uiConfigPostSchema>;

/** Where the token object sits in a POST body. */
const TOKENS_PATH = ['data', 'tokens'] as const;

export interface InvalidTokenSummary {
  /**
   * Allow-listed `group` or `group.key` names whose value was rejected. Only
   * names from the allow-list, never a caller-supplied key, so nothing the
   * caller sent is reflected back (SA R-3).
   */
  invalidKeys: string[];
  /** How many unknown groups or keys were sent. Their names are not kept. */
  unknownCount: number;
}

/**
 * Summarise the token issues of a parse error. `prefix` is the path of the
 * token object inside the parsed value: `['data', 'tokens']` for a POST body,
 * `[]` when `v2CustomTokensWriteSchema` was parsed directly. Issues outside the
 * prefix are ignored. Returns `null` when no issue concerns the tokens.
 */
export function invalidTokenKeys(
  error: z.ZodError,
  prefix: readonly (string | number)[] = TOKENS_PATH
): InvalidTokenSummary | null {
  const invalid = new Set<string>();
  let unknownCount = 0;
  let touched = false;

  for (const issue of error.issues) {
    const startsWithPrefix = prefix.every((part, i) => issue.path[i] === part);
    if (!startsWithPrefix) continue;
    const rest = issue.path.slice(prefix.length);

    if (issue.code === z.ZodIssueCode.unrecognized_keys) {
      touched = true;
      unknownCount += issue.keys.length;
      continue;
    }

    const [group, key] = rest;
    if (typeof group !== 'string' || !isAllowedGroup(group)) {
      // The token object itself is the wrong type (path at the prefix).
      if (rest.length === 0) touched = true;
      continue;
    }
    touched = true;
    if (rest.length === 1) invalid.add(group);
    else if (typeof key === 'string' && isAllowedKey(group, key)) invalid.add(`${group}.${key}`);
  }

  if (!touched) return null;
  return { invalidKeys: [...invalid].sort(), unknownCount };
}

const MAX_NAMES_IN_MESSAGE = 10;

/** The admin-facing message for a rejected save. Names only, never values. */
export function invalidTokensMessage({ invalidKeys, unknownCount }: InvalidTokenSummary): string {
  const parts: string[] = [];
  if (invalidKeys.length > 0) {
    const shown = invalidKeys.slice(0, MAX_NAMES_IN_MESSAGE).join(', ');
    const more = invalidKeys.length > MAX_NAMES_IN_MESSAGE ? ` and ${invalidKeys.length - MAX_NAMES_IN_MESSAGE} more` : '';
    parts.push(
      `These values are not valid: ${shown}${more}. Use a colour such as #6366F1, or a size such as 12px.`
    );
  }
  if (unknownCount > 0) parts.push('The request contains an unknown setting.');
  if (parts.length === 0) parts.push('The custom tokens are not in the expected format.');
  return parts.join(' ');
}
