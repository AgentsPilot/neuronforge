import 'server-only';

/**
 * A photograph for a section, chosen when the copy is written.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * Generated sites had no pictures. Every content field expected one and the
 * generator set none, so a business launched with a mesh gradient where its
 * hero photograph should be — and because `HeroBlock` switches its split layout
 * off when there is no image, the two archetypes whose design IS a split hero
 * quietly rendered a stacked one instead. The missing photograph was not only
 * an empty slot; it was disabling a layout.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY STOCK RATHER THAN GENERATED
 *
 * This is the owner's acquisition page. A generated photograph is unique and
 * slow and costs money on every signup; a stock photograph is real, arrives in
 * a fifth of a second, and costs nothing. For rooms, desks, materials and
 * hands-at-work — which is what these sections actually need — the stock
 * library wins on every axis that matters.
 *
 * It is also what the approved mockups were built from. `warm-archetype.html`
 * says so in its own text: *"Free stack only — Google Fonts for the Hebrew
 * serif, Pexels for the photographs"*.
 *
 * Generation is the right tool for something specific to one business, and is
 * offered from the editor on request rather than spent on every signup.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE PICTURE IS COPIED AND NOT LINKED
 *
 * A hotlinked URL is somebody else's uptime, somebody else's rate limit, and
 * somebody else's decision about whether the file still exists next year. The
 * file is copied into the business's own bucket, so what a visitor loads is
 * ours and what the owner gets is an asset they keep.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT NEVER THROWS
 *
 * A missing photograph is a worse page. A failed website build is no page. Every
 * path here answers null and says so in the log, and every caller treats null as
 * "this section has no image", which is exactly the state every section already
 * handles because it was the only state until now.
 *
 * @module lib/services/StockImageService
 */

import { supabaseServer } from '@/lib/supabaseServer';
import { createLogger } from '@/lib/logger';
import { userMediaRepository } from '@/lib/repositories/UserMediaRepository';

const logger = createLogger({ service: 'StockImageService' });

const PEXELS_ENDPOINT = 'https://api.pexels.com/v1/search';
const BUCKET = 'website-images';

/**
 * The crops the archetypes ask for.
 *
 * Not decoration: Bold opens on a 4:5 portrait with chip cards floating at its
 * edges, Stone on a wide band, and a feature tile is square. Handing the same
 * landscape file to all three crops two of them badly, and the hero is the one
 * picture on the page nobody scrolls past.
 */
export type ImageAspect = 'wide' | 'portrait' | 'square';

const PEXELS_ORIENTATION: Record<ImageAspect, string> = {
  wide: 'landscape',
  portrait: 'portrait',
  square: 'square',
};

/**
 * What to look for, per trade.
 *
 * Deliberately about PLACES AND WORK, never about faces. A stock portrait of
 * somebody who is not the owner, on a page whose entire job is to make a
 * stranger trust them, is worse than no portrait — and it is the one thing a
 * visitor reliably notices. Team portraits stay empty until a real photograph is
 * uploaded.
 */
const QUERY_BY_VERTICAL: Record<string, string> = {
  therapist: 'calm therapy room interior',
  psychologist: 'quiet consulting room armchair',
  counselor: 'warm counselling room daylight',
  wellness: 'calm wellness studio interior',
  coach: 'bright office conversation desk',

  consultant: 'minimal office desk daylight',
  lawyer: 'law office bookshelf interior',
  accountant: 'clean desk paperwork calculator',
  realtor: 'modern apartment interior light',

  photographer: 'photography studio equipment',
  designer: 'design studio desk workspace',
  beauty: 'beauty salon interior minimal',

  trainer: 'gym training equipment interior',
  fitness: 'fitness studio interior light',
  tutor: 'study desk books notebook',
  teacher: 'classroom desk learning materials',
};

/** The fallback for a trade we cannot place — a workspace suits almost any. */
const DEFAULT_QUERY = 'minimal workspace interior daylight';

interface PexelsPhoto {
  id: number;
  width: number;
  height: number;
  alt: string;
  src: { large2x?: string; large?: string; original?: string };
}

/**
 * A picture for this section of this business's site.
 *
 * Returns the public URL of a file in the business's own bucket, or null when
 * there is no key configured, nothing matched, or anything at all went wrong.
 *
 * @param userId   whose library the picture is copied into
 * @param vertical the trade, which decides what is searched for
 * @param aspect   the crop the archetype's design needs
 * @param section  recorded so the editor can offer it back for the right slot
 */
export async function imageForSection(
  userId: string,
  vertical: string | null | undefined,
  aspect: ImageAspect,
  section: string
): Promise<string | null> {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) {
    // Not an error: a deployment without a key simply builds sites without
    // photographs, exactly as it did before this existed.
    logger.debug({ section }, 'No PEXELS_API_KEY; section will have no image');
    return null;
  }

  const query = QUERY_BY_VERTICAL[vertical ?? ''] ?? DEFAULT_QUERY;

  try {
    const photo = await findPhoto(apiKey, query, aspect, userId);
    if (!photo) return null;

    // Already ours from an earlier build of this or another page.
    const existing = await userMediaRepository.findBySourceRef(userId, `pexels:${photo.id}`);
    if (existing) return existing.public_url;

    return await adopt(userId, photo, aspect, section, query);
  } catch (error) {
    logger.error({ err: error, userId, section, vertical }, 'Could not find an image for a section');
    return null;
  }
}

/**
 * Several pictures for one section — a gallery, rather than a single slot.
 *
 * A photographer's site leads with their work, and one photograph is not a
 * portfolio. Fetched from the same search and adopted the same way, offset by
 * the business hash so two photographers do not open with the same six pictures.
 *
 * Returns however many it managed, which may be none. A gallery with three
 * pictures is worse than one with six and far better than a section that is not
 * there.
 */
export async function imagesForSection(
  userId: string,
  vertical: string | null | undefined,
  aspect: ImageAspect,
  section: string,
  count: number
): Promise<string[]> {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) return [];

  const query = QUERY_BY_VERTICAL[vertical ?? ''] ?? DEFAULT_QUERY;

  try {
    const photos = await findPhotos(apiKey, query, aspect, userId, count);
    const urls: string[] = [];

    for (const photo of photos) {
      const existing = await userMediaRepository.findBySourceRef(userId, `pexels:${photo.id}`);
      const url = existing?.public_url ?? (await adopt(userId, photo, aspect, section, query));
      if (url) urls.push(url);
    }

    return urls;
  } catch (error) {
    logger.error({ err: error, userId, section }, 'Could not assemble a gallery');
    return [];
  }
}

/**
 * One photo from the library, chosen the same way every time for a business.
 *
 * The page of results is fetched and then indexed by a hash of the user id
 * rather than taking the first hit. Taking the first would give every therapist
 * on the platform the same hero — and two competitors in one town discovering
 * they share a photograph is a worse outcome than either of them having a
 * slightly less apt one. Hashing keeps it stable across rebuilds, so a business
 * does not find its site redecorated because it regenerated a page.
 */
async function findPhoto(
  apiKey: string,
  query: string,
  aspect: ImageAspect,
  userId: string
): Promise<PexelsPhoto | null> {
  const url =
    `${PEXELS_ENDPOINT}?query=${encodeURIComponent(query)}` +
    `&orientation=${PEXELS_ORIENTATION[aspect]}&per_page=30`;

  const response = await fetch(url, {
    headers: { Authorization: apiKey },
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) {
    logger.warn({ status: response.status, query }, 'Stock library refused the search');
    return null;
  }

  const body = (await response.json()) as { photos?: PexelsPhoto[] };
  const photos = body.photos ?? [];
  if (!photos.length) return null;

  return photos[businessOffset(userId) % photos.length];
}

/** A run of photos starting at the business's own offset, wrapping the page. */
async function findPhotos(
  apiKey: string,
  query: string,
  aspect: ImageAspect,
  userId: string,
  count: number
): Promise<PexelsPhoto[]> {
  const url =
    `${PEXELS_ENDPOINT}?query=${encodeURIComponent(query)}` +
    `&orientation=${PEXELS_ORIENTATION[aspect]}&per_page=40`;

  const response = await fetch(url, {
    headers: { Authorization: apiKey },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) return [];

  const body = (await response.json()) as { photos?: PexelsPhoto[] };
  const photos = body.photos ?? [];
  if (!photos.length) return [];

  const start = businessOffset(userId) % photos.length;
  return Array.from({ length: Math.min(count, photos.length) }, (_, i) => photos[(start + i) % photos.length]);
}

/**
 * A stable number for a business.
 *
 * Used to index into the results so the same business gets the same pictures on
 * every rebuild, and two businesses in the same trade get different ones. Taking
 * the first hit instead would give every therapist on the platform an identical
 * hero.
 */
function businessOffset(userId: string): number {
  let hash = 0;
  for (const char of userId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash;
}

/** Copy the file into the business's bucket and record that it owns it. */
async function adopt(
  userId: string,
  photo: PexelsPhoto,
  aspect: ImageAspect,
  section: string,
  query: string
): Promise<string | null> {
  const source = photo.src.large2x ?? photo.src.large ?? photo.src.original;
  if (!source) return null;

  const file = await fetch(source, { signal: AbortSignal.timeout(15000) });
  if (!file.ok) {
    logger.warn({ status: file.status, photoId: photo.id }, 'Could not download the photograph');
    return null;
  }

  const bytes = await file.arrayBuffer();
  // Same per-user folder the upload endpoint writes to, so one bucket policy
  // covers a photograph we found and one the owner took.
  const path = `${userId}/stock/${photo.id}.jpg`;

  const { error: uploadError } = await supabaseServer.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: 'image/jpeg', upsert: true });

  if (uploadError) {
    logger.error({ err: uploadError, path }, 'Could not store the photograph');
    return null;
  }

  const { data } = supabaseServer.storage.from(BUCKET).getPublicUrl(path);
  const publicUrl = data.publicUrl;

  await userMediaRepository.record({
    userId,
    storagePath: path,
    publicUrl,
    source: 'stock',
    sourceRef: `pexels:${photo.id}`,
    section,
    aspect,
    description: photo.alt || query,
    width: photo.width,
    height: photo.height,
  });

  logger.info({ userId, section, aspect, photoId: photo.id }, 'Adopted a photograph for a section');
  return publicUrl;
}
