/**
 * The rules for a profile picture, shared by the browser and the server
 * (settings drawer D-3, C-19).
 *
 * The hook's pre-check (`useAvatarUpload`), the picker's `accept` attribute
 * (`AvatarUpload`) and the route (`POST /api/user/avatar`) all read these, so
 * they cannot disagree. A file the browser offers and the server then refuses
 * is the worst version of this (the `lib/business-os/intake/types.ts`
 * precedent).
 *
 * Pure on purpose: no server import, because the hook runs in the browser.
 *
 * The browser's claim about a file (`file.type`, the file name) is only a
 * convenience for the pre-check. The server decides the type from the file's
 * first bytes (`sniffImageType`), and the stored content type and extension
 * come from that result (SA ruling Q-1). SVG is never accepted: it is a script
 * vector in a public bucket (F-16), and as text it can never match a signature
 * below.
 *
 * @module lib/validation/avatar
 */

/** 4 MB, exactly 4 194 304 bytes allowed. Under Vercel's 4.5 MB request body limit (C-19). */
export const AVATAR_MAX_BYTES = 4 * 1024 * 1024;

/** The only accepted types. No `image/svg+xml`, no HEIC. */
export const AVATAR_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;

export type AvatarMimeType = (typeof AVATAR_MIME_TYPES)[number];

/** The stored extension for each type. A `Record` over the union, so the compiler checks it is complete. */
export const AVATAR_EXTENSIONS: Readonly<Record<AvatarMimeType, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/** How many leading bytes `sniffImageType` needs (WebP's `WEBP` ends at offset 12). */
export const AVATAR_SNIFF_BYTES = 12;

export function isAvatarMimeType(value: string): value is AvatarMimeType {
  return (AVATAR_MIME_TYPES as readonly string[]).includes(value);
}

/** True when `bytes` holds `signature` starting at `offset`. Shorter input never matches. */
function startsWithAt(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, i) => bytes[offset + i] === byte);
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
const GIF87A = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61];
const GIF89A = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];
const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];

/**
 * The image type a file's leading bytes prove, or `null`.
 *
 * Recognises the four accepted types by their signatures only: PNG, JPEG,
 * GIF87a / GIF89a, and WebP (`RIFF` at 0 AND `WEBP` at 8, because `RIFF` alone
 * is also WAV and AVI). Anything shorter than a signature, or matching none,
 * is `null`. Written here rather than adding a dependency (SA ruling Q-9).
 */
export function sniffImageType(bytes: Uint8Array): AvatarMimeType | null {
  if (startsWithAt(bytes, PNG)) return 'image/png';
  if (startsWithAt(bytes, JPEG)) return 'image/jpeg';
  if (startsWithAt(bytes, GIF87A) || startsWithAt(bytes, GIF89A)) return 'image/gif';
  if (startsWithAt(bytes, RIFF) && startsWithAt(bytes, WEBP, 8)) return 'image/webp';
  return null;
}
