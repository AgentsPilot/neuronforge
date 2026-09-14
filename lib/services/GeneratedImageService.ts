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

import OpenAI from 'openai';
import { supabaseServer } from '@/lib/supabaseServer';
import { createLogger } from '@/lib/logger';
import { userMediaRepository } from '@/lib/repositories/UserMediaRepository';
import type { ImageAspect } from '@/lib/services/StockImageService';

const logger = createLogger({ service: 'GeneratedImageService' });

const BUCKET = 'website-images';

/** The sizes the model offers, mapped to the crops the archetypes ask for. */
const SIZE_BY_ASPECT: Record<ImageAspect, '1024x1024' | '1536x1024' | '1024x1536'> = {
  wide: '1536x1024',
  portrait: '1024x1536',
  square: '1024x1024',
};

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
  | { ok: false; reason: 'failed' };

export type GenerateImageOutcome = ({ ok: true } & GenerateImageResult) | GenerateImageFailure;

/**
 * Make a picture for this business and put it in their library.
 *
 * Never throws: the caller is a button in an editor, and every outcome here is
 * something the owner can act on — try a different description, or use one of
 * the pictures they already have.
 */
export async function generateImage(
  userId: string,
  prompt: string,
  aspect: ImageAspect,
  section: string
): Promise<GenerateImageOutcome> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    logger.debug('No OPENAI_API_KEY; image generation is unavailable');
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
  const existing = await userMediaRepository.findBySourceRef(userId, sourceRef);
  if (existing) return { ok: true, url: existing.public_url, description: existing.description ?? prompt };

  try {
    const openai = new OpenAI({ apiKey });
    const response = await openai.images.generate({
      model: 'gpt-image-1',
      prompt: `${prompt}. ${STYLE}`,
      size: SIZE_BY_ASPECT[aspect],
      n: 1,
    });

    const b64 = response.data?.[0]?.b64_json;
    if (!b64) {
      logger.warn({ userId, section }, 'Image generation returned nothing');
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

    logger.info({ userId, section, aspect }, 'Generated a picture for a business');
    return { ok: true, url: data.publicUrl, description: prompt };
  } catch (error) {
    logger.error({ err: error, userId, section }, 'Could not generate a picture');
    return { ok: false, reason: 'failed' };
  }
}

/** Stable id for a request, so the same prompt is never paid for twice. */
function hash(input: string): string {
  let value = 0;
  for (const char of input) value = (value * 31 + char.charCodeAt(0)) >>> 0;
  return value.toString(36);
}
