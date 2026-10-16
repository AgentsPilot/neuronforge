/**
 * F-27 DC-3: the picture type comes from the bytes. Workplan:
 * docs/workplans/WEBSITE_UPLOAD_BUCKET_SCOPE_F27_WORKPLAN.md (Tests).
 */

import { IMAGE_SIGNATURE_BYTES, sniffImageSignature } from '@/lib/validation/imageSignature';

const bytes = (...values: number[]) => new Uint8Array(values);
const ascii = (text: string) => new Uint8Array(Array.from(text, ch => ch.charCodeAt(0)));
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

describe('sniffImageSignature', () => {
  it('needs 12 bytes', () => {
    expect(IMAGE_SIGNATURE_BYTES).toBe(12);
  });

  it.each([
    ['PNG', bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d), 'image/png'],
    ['JPEG', bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46), 'image/jpeg'],
    ['GIF87a', concat(ascii('GIF87a'), bytes(1, 0, 1, 0)), 'image/gif'],
    ['GIF89a', concat(ascii('GIF89a'), bytes(1, 0, 1, 0)), 'image/gif'],
    ['WebP', concat(ascii('RIFF'), bytes(0x24, 0, 0, 0), ascii('WEBP')), 'image/webp'],
  ])('recognises %s', (_name, input, expected) => {
    expect(sniffImageSignature(input)).toBe(expected);
  });

  it.each([
    ['RIFF without WEBP (WAV)', concat(ascii('RIFF'), bytes(0x24, 0, 0, 0), ascii('WAVE'))],
    ['RIFF alone', ascii('RIFF')],
    ['truncated PNG (7 bytes)', bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a)],
    ['truncated JPEG (2 bytes)', bytes(0xff, 0xd8)],
    ['GIF8', ascii('GIF8')],
    ['<svg', ascii('<svg xmlns="http://www.w3.org/2000/svg">')],
    ['<?xml', ascii('<?xml version="1.0"?><svg>')],
    ['<!DOCTYPE html', ascii('<!DOCTYPE html><html>')],
    ['%PDF', ascii('%PDF-1.7\n%')],
    ['empty', new Uint8Array(0)],
  ])('refuses %s', (_name, input) => {
    expect(sniffImageSignature(input)).toBeNull();
  });
});
