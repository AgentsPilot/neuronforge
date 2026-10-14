/**
 * THE one schema for a pending provider price line (SA RR-1): manual entry
 * uses it now, and the provider-page parser output (slice 5) must pass the
 * same schema. Validation only; the bounds and flags are in `lineFlags.ts`.
 *
 *  - Prices are per-1M (or per-image) decimal STRINGS matching the R-1
 *    pattern. A JSON number is refused outright, so no float ever reaches the
 *    database (the migration converts the string in SQL).
 *  - `source_url` must be https on the provider's official host list. It is
 *    never fetched by the server.
 *  - `checked_on` is a real calendar date, not after tomorrow in UTC (so an
 *    admin east of UTC entering today's date after midnight is not refused).
 *  - Strict objects: no admin id, creator, state or snapshot can be sent
 *    (SA C-12). Those come from the gate and the server's own read.
 */

import { z } from 'zod';

import { PRICE_STRING_PATTERN } from './bounds';
import { PRICE_PROVIDERS, isOfficialSourceUrl } from './officialSources';

export const PRICE_STRING_REGEX = new RegExp(PRICE_STRING_PATTERN);
/** Lowercase letters and digits, joined by single dots or hyphens (matches the migration's CHECK). */
export const MODEL_ID_REGEX = /^[a-z0-9]+([.-][a-z0-9]+)*$/;
const IMAGE_SIZE_REGEX = /^[0-9]{2,5}x[0-9]{2,5}$/;
const IMAGE_QUALITY_REGEX = /^[a-z]{1,20}$/;
const ISO_DATE_REGEX = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
/** The exact lowercase scheme the database CHECK requires (built without an escape). */
export const HTTPS_PREFIX = 'https' + String.fromCharCode(58) + '//';
/** Printable ASCII, no space, tab or control character. */
const PRINTABLE_NO_SPACE = /^[!-~]+$/;

const priceString = z
  .string()
  .regex(PRICE_STRING_REGEX, 'Enter the price as a decimal with at most 6 digits before and 9 after the point');

const modelId = z
  .string()
  .min(2)
  .max(100)
  .regex(MODEL_ID_REGEX, 'Use the provider model id: lowercase letters, digits, dots and hyphens');

/** UTC today plus one day, as YYYY-MM-DD. `now` is injectable for tests. */
export function latestAllowedCheckedOn(now: Date = new Date()): string {
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return tomorrow.toISOString().slice(0, 10);
}

function isRealDate(text: string): boolean {
  if (!ISO_DATE_REGEX.test(text)) return false;
  const parsed = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text;
}

const checkedOn = z
  .string()
  .refine(isRealDate, 'Enter the date you checked the price as YYYY-MM-DD')
  .refine((text) => text <= latestAllowedCheckedOn(), 'The checked date cannot be in the future');

const common = {
  provider: z.enum(PRICE_PROVIDERS),
  model_name: modelId,
  source_url: z.string().min(12).max(500),
  checked_on: checkedOn,
};

export const TokenPendingLineSchema = z
  .object({
    kind: z.literal('token'),
    ...common,
    input_per_1m: priceString,
    output_per_1m: priceString,
    cached_input_per_1m: priceString.optional(),
  })
  .strict();

export const ImagePendingLineSchema = z
  .object({
    kind: z.literal('image'),
    ...common,
    image_size: z.string().regex(IMAGE_SIZE_REGEX, 'Use the image size as WIDTHxHEIGHT, for example 1024x1024'),
    image_quality: z.string().regex(IMAGE_QUALITY_REGEX, 'Use the quality name, for example low, medium or high'),
    price_per_image: priceString,
  })
  .strict();

export const PendingLineSchema = z
  .discriminatedUnion('kind', [TokenPendingLineSchema, ImagePendingLineSchema])
  .superRefine((line, ctx) => {
    // SA CR-1: `new URL()` trims spaces and lower-cases the scheme, so it alone
    // would accept text the database CHECK (`left(source_url, 8) = 'https://'`)
    // refuses, and the admin would get a 500. Refuse it here as a 400 instead.
    if (!line.source_url.startsWith(HTTPS_PREFIX) || !PRINTABLE_NO_SPACE.test(line.source_url)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['source_url'],
        message: 'Paste the full https address with no spaces',
      });
      return;
    }
    if (!isOfficialSourceUrl(line.provider, line.source_url)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['source_url'],
        message: `The source must be an https page on ${line.provider}'s own website`,
      });
    }
  });

export type PendingLineInput = z.infer<typeof PendingLineSchema>;

/** The manual-entry request body (SA C-12: nothing else is accepted). */
export const ManualEntryBodySchema = z
  .object({
    lines: z.array(PendingLineSchema).min(1).max(50),
  })
  .strict();

export type ManualEntryBody = z.infer<typeof ManualEntryBodySchema>;

/** The key that identifies one model-and-unit (one pending line at most per key). */
export function unitKeyOf(line: {
  provider: string;
  model_name: string;
  kind: 'token' | 'image';
  image_size?: string | null;
  image_quality?: string | null;
}): string {
  return [line.provider, line.model_name, line.kind, line.image_size ?? '', line.image_quality ?? ''].join('|');
}
