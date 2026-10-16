/**
 * What kind of picture a file really is, read from its first bytes.
 *
 * A browser's `file.type` and the file name are both the caller's claim, so a
 * page saved as `photo.png` and labelled `image/png` passes any check that
 * reads them. The opening bytes of a real PNG, JPEG, GIF or WebP are fixed by
 * each format, so they decide instead (F-27 DC-3; the same table as D-3's
 * avatar check, which FU-1 folds into this one).
 *
 * SVG is deliberately not recognised: it is a script-capable document, not a
 * bitmap, and is refused everywhere a user can upload a picture (F-16, F-27
 * DC-4).
 *
 * Pure, no imports, safe in the browser and on the server.
 *
 * @module lib/validation/imageSignature
 */

/** How many leading bytes `sniffImageSignature` needs. WebP is the longest. */
export const IMAGE_SIGNATURE_BYTES = 12;

export type SniffedImageType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((value, i) => bytes[offset + i] === value);
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const JPEG = [0xff, 0xd8, 0xff] as const;
const GIF87A = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61] as const; // "GIF87a"
const GIF89A = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] as const; // "GIF89a"
const RIFF = [0x52, 0x49, 0x46, 0x46] as const; // "RIFF"
const WEBP = [0x57, 0x45, 0x42, 0x50] as const; // "WEBP" at offset 8

/**
 * The image type the bytes prove, or `null` when they prove none of the four.
 *
 * WebP needs both `RIFF` and `WEBP`: `RIFF` alone is also WAV and AVI.
 */
export function sniffImageSignature(bytes: Uint8Array): SniffedImageType | null {
  if (startsWith(bytes, PNG)) return 'image/png';
  if (startsWith(bytes, JPEG)) return 'image/jpeg';
  if (startsWith(bytes, GIF87A) || startsWith(bytes, GIF89A)) return 'image/gif';
  if (startsWith(bytes, RIFF) && startsWith(bytes, WEBP, 8)) return 'image/webp';
  return null;
}
