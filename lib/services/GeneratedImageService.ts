import 'server-only';

/**
 * A picture made for one business, on request.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS ON REQUEST AND NOT PART OF GENERATION
 *
 * Stock covers the common case: a therapy room, a studio, a desk. It is free,
 * it arrives in a fifth of a second, and it is a real photograph. Generation is
 * for what stock cannot give — something specific to THIS business, or an
 * abstract ground that should not look like anybody's actual room.
 *
 * Spending it on every signup would mean paying per business and adding twenty
 * seconds to the moment a new owner is watching a spinner, to replace a
 * photograph that was already fine. So it lives behind a button in the editor,
 * used when the owner looks at a picture and wants a different one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT REFUSES TO DRAW PEOPLE
 *
 * These pages exist to make a stranger trust a therapist, a coach, a trainer. A
 * generated human face on that page is the one element a visitor reliably reads
 * as false, and it is false — that person does not exist. The prompt is prefixed
 * to ask for places and materials, and requests that read as portraits are
 * refused rather than quietly reinterpreted, because silently returning an empty
 * room to somebody who asked for a photograph of their team would be worse than
 * telling them no.
 *
 * @module lib/services/GeneratedImageService
 */

import { supabaseServer } from '@/lib/supabaseServer';
import { createLogger } from '@/lib/logger';
import { userMediaRepository } from '@/lib/repositories/UserMediaRepository';
import {
  systemConfigRepository,
  IMAGE_GENERATION_CONFIG_DEFAULTS,
  IMAGE_FALLBACK_PRICING,
  type ImageGenerationConfig,
} from '@/lib/repositories/SystemConfigRepository';
import { ProviderFactory } from '@/lib/ai/providerFactory';
import type {
  ImageGenerationParams,
  ImagePriceResolver,
  ReportedImageQuality,
} from '@/lib/ai/providers/openaiProvider';
import { buildBosCallContext, type BosLlmOwner } from '@/lib/business-os/llm/callCatalog';
import type { ImageAspect } from '@/lib/services/StockImageService';

const logger = createLogger({ service: 'GeneratedImageService' });

const BUCKET = 'website-images';

/*
 * The model, the aspect → size map and the quality come from configuration
 * (`SystemConfigRepository.getImageGenerationConfig`), with documented
 * defaults there. OpenAI is the only image provider today; a second one would
 * need a capability interface and config-driven selection (F-15), not a
 * provider key that accepts exactly one value.
 */

/** Sizes the image model accepts. A configured size outside these falls back to the default. */
const IMAGE_SIZES: ReadonlyArray<ImageGenerationParams['size']> = ['1024x1024', '1536x1024', '1024x1536'];

/**
 * Qualities that may be requested. `auto` (the default) lets the provider
 * choose; every image is priced by the quality the provider REPORTS it used,
 * so `auto` needs no price of its own.
 */
const IMAGE_QUALITIES: ReadonlyArray<ImageGenerationParams['quality']> = ['auto', 'low', 'medium', 'high'];

/**
 * The quality an image is priced at when the provider does not report one.
 * `high` is the most expensive level, so the recorded price is an upper bound
 * rather than an understatement (user decision CR-1, option C, 2026-09-18).
 */
export const UNREPORTED_QUALITY_PRICED_AS = 'high';

function isImageSize(value: string): value is ImageGenerationParams['size'] {
  return (IMAGE_SIZES as readonly string[]).includes(value);
}

function isImageQuality(value: string): value is ImageGenerationParams['quality'] {
  return (IMAGE_QUALITIES as readonly string[]).includes(value);
}

export type ImagePriceSource = 'config' | 'fallback' | 'unpriced';

/**
 * The per-image dollar price (Layer 1.5 FR-13): configuration, then the
 * documented fallback map, then 0 with an error log. The row is written in
 * every case — spend is never dropped — but an image must never be recorded at
 * $0 silently.
 */
export function resolveImagePrice(
  pricesUsd: Readonly<Record<string, number>>,
  model: string,
  size: string,
  quality: string
): { usdPerImage: number; source: ImagePriceSource } {
  const key = `${model}:${size}:${quality}`;
  const configured = pricesUsd[key];
  if (typeof configured === 'number' && Number.isFinite(configured) && configured > 0) {
    return { usdPerImage: configured, source: 'config' };
  }
  const fallback = IMAGE_FALLBACK_PRICING[key];
  if (typeof fallback === 'number') return { usdPerImage: fallback, source: 'fallback' };

  // Names the three parts of the key only — never the prompt.
  logger.error({ model, size, quality }, 'No price for this image model, size and quality; recording $0');
  return { usdPerImage: 0, source: 'unpriced' };
}

/** What one generated image was priced at, and on what basis. */
export interface ImagePricing {
  usdPerImage: number;
  source: ImagePriceSource;
  /** The quality the price is keyed on: the reported one, or UNREPORTED_QUALITY_PRICED_AS. */
  pricedQuality: string;
  qualityReported: boolean;
}

/**
 * The resolver handed to the provider (user decision CR-1, option C): prices
 * the image AFTER the call from the quality the provider reports it used,
 * keyed on model + size + that quality, with `resolveImagePrice`'s precedence.
 * No reported quality → priced at UNREPORTED_QUALITY_PRICED_AS, with a warning.
 * A requested quality other than `auto` that differs from the reported one is
 * logged; the price follows what was reported.
 *
 * `last()` returns what was priced, for the service's own log line. Never
 * throws: a throw inside the provider's tracking would turn a paid-for image
 * into a failure row.
 */
export function imagePriceResolver(
  pricesUsd: Readonly<Record<string, number>>,
  model: string,
  size: string,
  requestedQuality: string
): { priceFor: ImagePriceResolver; last: () => ImagePricing | null } {
  let last: ImagePricing | null = null;

  const priceFor: ImagePriceResolver = (reported: ReportedImageQuality) => {
    try {
      const qualityReported = typeof reported === 'string' && reported.length > 0;
      const pricedQuality = qualityReported ? reported : UNREPORTED_QUALITY_PRICED_AS;

      if (!qualityReported) {
        logger.warn(
          { model, size, requestedQuality, pricedAs: pricedQuality },
          'Provider reported no image quality; pricing the image at the highest level'
        );
      } else if (requestedQuality !== 'auto' && reported !== requestedQuality) {
        logger.warn(
          { model, size, requestedQuality, reportedQuality: reported },
          'Image generated at a different quality than requested; priced by the reported quality'
        );
      }

      const { usdPerImage, source } = resolveImagePrice(pricesUsd, model, size, pricedQuality);
      last = { usdPerImage, source, pricedQuality, qualityReported };
      return usdPerImage;
    } catch (error) {
      logger.error({ err: error, model, size }, 'Could not price a generated image; recording $0');
      return 0;
    }
  };

  return { priceFor, last: () => last };
}

/**
 * The size and quality actually sent: the configured values when the model
 * accepts them, else the documented defaults. Null only if the defaults
 * themselves are unusable, which is a code error.
 */
function effectiveRequest(
  config: ImageGenerationConfig,
  aspect: ImageAspect
): { size: ImageGenerationParams['size']; quality: ImageGenerationParams['quality'] } | null {
  const size = [config.sizes[aspect], IMAGE_GENERATION_CONFIG_DEFAULTS.sizes[aspect]].find(isImageSize);
  const quality = [config.quality, IMAGE_GENERATION_CONFIG_DEFAULTS.quality].find(isImageQuality);
  if (!size || !quality) return null;

  if (size !== config.sizes[aspect] || quality !== config.quality) {
    logger.warn({ aspect }, 'Configured image size or quality is not supported; using the default');
  }
  return { size, quality };
}

/**
 * What the model is asked for, whatever the owner typed.
 *
 * Keeps the result in the same register as the stock photography beside it —
 * one page mixing a plain interior photograph with a glossy illustration looks
 * like a mistake even when both are individually fine.
 */
const STYLE =
  'A natural, understated photograph. Real materials and daylight, shallow depth of field, ' +
  'no text, no logos, no watermarks, no people and no faces. Editorial, not advertising.';

/** Words that mean the request is really for a portrait. */
const PEOPLE = /\b(person|people|man|woman|portrait|face|team|staff|headshot|selfie|model|child|children|kid|baby|client|patient)\b/i;

export interface GenerateImageResult {
  url: string;
  description: string;
}

export type GenerateImageFailure =
  | { ok: false; reason: 'unavailable' }
  | { ok: false; reason: 'depicts_people' }
  | { ok: false; reason: 'limit_reached'; used: number; limit: number }
  | { ok: false; reason: 'failed' };

/**
 * Generated pictures allowed per business per day.
 *
 * Every call to `images.generate` is billed, and nothing above this function
 * stops a finger on the Enter key. Ten is generous for the real job — replacing
 * a handful of stock photographs on one site — and cheap enough that a stuck
 * key costs pennies rather than an invoice nobody sees until month end.
 *
 * A DAY, not a month, on purpose: a daily cap is self-healing. Someone who hits
 * it is working again tomorrow with no support ticket, while a monthly one
 * locks a paying business out for weeks.
 *
 * This is an interim guard. The real accounting is per-package monthly
 * allowance, and when that exists this becomes its floor rather than the whole
 * story.
 */
export const DAILY_GENERATION_LIMIT = 10;

/**
 * What this business has left today.
 *
 * Exported because the allowance has to be VISIBLE, not only enforced. A
 * picture can be generated from the media picker on any block, on any page, and
 * from the wizard — so a counter kept by any one of those screens would be
 * wrong the moment a second one is used. Every surface asks here.
 *
 * `null` for an unreadable count, matching the repository: a caller must be
 * able to tell "none used" from "unknown" and say so, rather than promising an
 * allowance it cannot verify.
 */
export async function generationAllowance(
  userId: string
): Promise<{ used: number; limit: number; remaining: number } | null> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const used = await userMediaRepository.countGeneratedSince(userId, since);
  if (used === null) return null;

  return {
    used,
    limit: DAILY_GENERATION_LIMIT,
    remaining: Math.max(0, DAILY_GENERATION_LIMIT - used),
  };
}

export type GenerateImageOutcome = ({ ok: true } & GenerateImageResult) | GenerateImageFailure;

/**
 * Make a picture for this business and put it in their library.
 *
 * Never throws: the caller is a button in an editor, and every outcome here is
 * something the owner can act on — try a different description, or use one of
 * the pictures they already have.
 *
 * Every image actually generated writes ONE usage-ledger row (Layer 1.5 FR-9):
 * the owner's account, the `images` area, zero tokens and the per-image cost.
 * Nothing refused before the provider call writes a row; a failed provider call
 * writes a failure row; a paid-for image keeps its row even if storing it fails.
 */
export async function generateImage(
  /** The business account and the grouping id of the request that asked. Required (FR-11). */
  owner: BosLlmOwner,
  prompt: string,
  aspect: ImageAspect,
  section: string
): Promise<GenerateImageOutcome> {
  const userId = owner.userId;

  // Asked of the factory rather than read in order to build a client (FR-9e).
  if (!ProviderFactory.isProviderAvailable('openai')) {
    logger.debug('No OpenAI provider configured; image generation is unavailable');
    return { ok: false, reason: 'unavailable' };
  }

  if (PEOPLE.test(prompt)) {
    return { ok: false, reason: 'depicts_people' };
  }

  /*
   * The same request twice is the same picture.
   *
   * An owner pressing the button again because nothing appeared should not be
   * charged twice, and a rebuild should not redraw what it already has.
   */
  const sourceRef = `openai:${hash(`${prompt}|${aspect}`)}`;

  /*
   * The reuse check comes FIRST, and stays first.
   *
   * A picture this business already generated costs nothing to hand back, so it
   * must not consume a day's allowance. Putting the limit above this would
   * charge an owner for scrolling their own library.
   */
  const existing = await userMediaRepository.findBySourceRef(userId, sourceRef);
  if (existing) return { ok: true, url: existing.public_url, description: existing.description ?? prompt };

  /*
   * Only now, with a real generation about to be billed, is the day counted.
   *
   * A count that cannot be read refuses rather than allows. The alternative —
   * treating an unreadable count as zero — turns every database hiccup into
   * unlimited spending, which is the exact failure this exists to prevent.
   */
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const usedToday = await userMediaRepository.countGeneratedSince(userId, since);

  if (usedToday === null) {
    logger.error({ userId }, 'Could not read today\'s generation count; refusing to generate');
    return { ok: false, reason: 'failed' };
  }

  if (usedToday >= DAILY_GENERATION_LIMIT) {
    logger.warn(
      { userId, usedToday, limit: DAILY_GENERATION_LIMIT },
      'Daily image generation limit reached'
    );
    return { ok: false, reason: 'limit_reached', used: usedToday, limit: DAILY_GENERATION_LIMIT };
  }

  try {
    const config = await systemConfigRepository.getImageGenerationConfig();
    const request = effectiveRequest(config, aspect);
    if (!request) {
      logger.error({ aspect }, 'No usable image size or quality, even from the defaults');
      return { ok: false, reason: 'failed' };
    }
    const { size, quality } = request;
    // Priced after the call, from the quality the provider reports (CR-1 option C).
    const pricing = imagePriceResolver(config.pricesUsd, config.model, size, quality);

    const context = buildBosCallContext({
      userId,
      area: 'images',
      callName: 'image_generation',
      groupId: owner.groupId,
    });

    // The provider records the ledger row, success or failure, before this
    // returns or throws. n is always 1: one row per image (WC-3).
    const response = await ProviderFactory.getOpenAI().generateImage(
      { model: config.model, prompt: `${prompt}. ${STYLE}`, size, quality, n: 1 },
      context,
      pricing.priceFor
    );
    const priced = pricing.last();

    const b64 = response.data?.[0]?.b64_json;
    if (!b64) {
      // Billed all the same, so its priced row stays (FR-9c).
      logger.warn({ userId, section, groupId: owner.groupId }, 'Image generation returned nothing');
      return { ok: false, reason: 'failed' };
    }

    const bytes = Buffer.from(b64, 'base64');
    // The same per-user folder everything else writes to, so one bucket policy
    // covers a generated picture, a stock one, and the owner's own photograph.
    const path = `${userId}/generated/${sourceRef.split(':')[1]}.png`;

    const { error: uploadError } = await supabaseServer.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType: 'image/png', upsert: true });

    if (uploadError) {
      logger.error({ err: uploadError, path }, 'Could not store a generated picture');
      return { ok: false, reason: 'failed' };
    }

    const { data } = supabaseServer.storage.from(BUCKET).getPublicUrl(path);

    await userMediaRepository.record({
      userId,
      storagePath: path,
      publicUrl: data.publicUrl,
      source: 'generated',
      sourceRef,
      section,
      aspect,
      description: prompt,
    });

    /*
     * The count goes in the log line so spending is visible from the logs
     * alone. `usedToday` is the count BEFORE this one, so the running total is
     * `+ 1` — recorded explicitly rather than left to be worked out later by
     * whoever is looking at an unexpected invoice.
     */
    logger.info(
      {
        userId,
        section,
        aspect,
        groupId: owner.groupId,
        priceSource: priced?.source,
        pricedQuality: priced?.pricedQuality,
        usdPerImage: priced?.usdPerImage,
        generatedToday: usedToday + 1,
        dailyLimit: DAILY_GENERATION_LIMIT,
      },
      'Generated a picture for a business'
    );
    return { ok: true, url: data.publicUrl, description: prompt };
  } catch (error) {
    logger.error({ err: error, userId, section, groupId: owner.groupId }, 'Could not generate a picture');
    return { ok: false, reason: 'failed' };
  }
}

/** Stable id for a request, so the same prompt is never paid for twice. */
function hash(input: string): string {
  let value = 0;
  for (const char of input) value = (value * 31 + char.charCodeAt(0)) >>> 0;
  return value.toString(36);
}
