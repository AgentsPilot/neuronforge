/**
 * The rules for a website picture upload, shared by the route and the browser.
 *
 * `POST /api/website/upload` decides every one of these itself (F-27). The
 * browser components read the same list and limit only so they never offer a
 * file the server is going to refuse.
 *
 * Pure, no imports beyond types, safe in the browser and on the server.
 *
 * @module lib/validation/websiteImage
 */

import type { SniffedImageType } from '@/lib/validation/imageSignature';

/**
 * The only bucket website pictures go to. An allow-list of one: the route
 * compares the caller's `bucket` field with this and nothing else, and never
 * names another bucket (F-27 SA-F27-1).
 */
export const WEBSITE_IMAGE_BUCKET = 'website-images';

/**
 * 4 MB. Vercel refuses a request body over 4.5 MB before the route runs, with
 * a response the browser cannot read, so a higher limit here would promise
 * something the platform does not deliver (F-27 DC-5, ruling Q-2). The bucket
 * itself stays at 5 MB because generated pictures are stored there too.
 */
export const WEBSITE_IMAGE_MAX_MB = 4;
export const WEBSITE_IMAGE_MAX_BYTES = WEBSITE_IMAGE_MAX_MB * 1024 * 1024;

/** No SVG: a script-capable document on a public origin (F-27 DC-4, ruling Q-7). */
export const WEBSITE_IMAGE_MIME_TYPES: readonly SniffedImageType[] = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
];

/** For an `<input type="file" accept>`. */
export const WEBSITE_IMAGE_ACCEPT = WEBSITE_IMAGE_MIME_TYPES.join(',');

/** The stored extension comes from the sniffed type, never from the file name. */
export const WEBSITE_IMAGE_EXTENSIONS: Readonly<Record<SniffedImageType, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

/** The one sub-folder a caller can select. */
export const WEBSITE_IMAGE_LOGO_FOLDER = 'logos';

/**
 * Where an upload is stored: `<userId>/<uuid>.<ext>` or
 * `<userId>/logos/<uuid>.<ext>`.
 *
 * `folder` is a selector, never a path. The caller's text is not put into the
 * object name; it only chooses between the two shapes above, by whether its
 * LAST `/`-segment is exactly `logos`. The two logo call sites send `logos`
 * and `<userId>/logos` (or `shared/logos` before the user has loaded), and all
 * three land under the signed-in owner's folder (F-27 DC-2).
 */
export function websiteUploadPath(
  userId: string,
  folder: string | undefined,
  ext: string,
  uuid: string,
): string {
  const lastSegment = folder ? folder.split('/').pop() : undefined;
  const subFolder = lastSegment === WEBSITE_IMAGE_LOGO_FOLDER ? `${WEBSITE_IMAGE_LOGO_FOLDER}/` : '';
  return `${userId}/${subFolder}${uuid}.${ext}`;
}

/** The fixed `code` values the upload route answers with. */
export type WebsiteUploadErrorCode =
  | 'unauthorized'
  | 'invalid_request'
  | 'file_type'
  | 'file_too_large'
  | 'upload_failed'
  | 'internal';

/**
 * The translation key the browser shows for a failed upload.
 *
 * The server's `error` text is fixed English for API consumers; the owner sees
 * their own language, chosen by `code` (F-27 SA-F27-2). Anything unexpected,
 * including a response that was not JSON, is the generic failure.
 */
export function websiteUploadErrorKey(
  code: unknown,
): 'media.upload.invalid_type' | 'media.upload.too_large' | 'media.upload.failed' {
  if (code === 'file_type') return 'media.upload.invalid_type';
  if (code === 'file_too_large') return 'media.upload.too_large';
  return 'media.upload.failed';
}
