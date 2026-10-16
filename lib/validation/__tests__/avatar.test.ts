/**
 * The shared profile-picture rules (settings drawer D-3, C-19).
 *
 * The constants are pinned because three places read them (hook pre-check,
 * picker `accept`, route). `sniffImageType` is the server's only type check:
 * the claimed MIME type and the file name are ignored (SA ruling Q-1), so a
 * signature it wrongly accepts is a file type the public bucket wrongly stores.
 */

import {
  AVATAR_EXTENSIONS,
  AVATAR_MAX_BYTES,
  AVATAR_MIME_TYPES,
  AVATAR_SNIFF_BYTES,
  isAvatarMimeType,
  sniffImageType,
} from '../avatar';

const bytes = (...values: number[]) => new Uint8Array(values);
const ascii = (text: string) => new TextEncoder().encode(text);

const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1);
const GIF87 = ascii('GIF87a\x01\x00\x01\x00\x00\x00');
const GIF89 = ascii('GIF89a\x01\x00\x01\x00\x00\x00');
const WEBP = new Uint8Array([...ascii('RIFF'), 0x24, 0, 0, 0, ...ascii('WEBP')]);

describe('avatar constants', () => {
  it('the limit is exactly 4 MB', () => {
    expect(AVATAR_MAX_BYTES).toBe(4 * 1024 * 1024);
    expect(AVATAR_MAX_BYTES).toBe(4194304);
  });

  it('exactly the four types, no SVG, no HEIC', () => {
    expect([...AVATAR_MIME_TYPES]).toEqual(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
    expect(AVATAR_MIME_TYPES as readonly string[]).not.toContain('image/svg+xml');
    expect(AVATAR_MIME_TYPES as readonly string[]).not.toContain('image/heic');
  });

  it('every type has its extension, derived from the type and never from a file name', () => {
    expect(AVATAR_EXTENSIONS).toEqual({
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/webp': 'webp',
      'image/gif': 'gif',
    });
  });

  it('the sniff window covers WebP (RIFF at 0, WEBP at 8)', () => {
    expect(AVATAR_SNIFF_BYTES).toBe(12);
  });

  it('isAvatarMimeType', () => {
    for (const type of AVATAR_MIME_TYPES) expect(isAvatarMimeType(type)).toBe(true);
    for (const type of ['image/svg+xml', 'image/heic', 'image/*', 'text/plain', '', 'IMAGE/PNG']) {
      expect(isAvatarMimeType(type)).toBe(false);
    }
  });
});

describe('sniffImageType', () => {
  it.each([
    ['PNG', 'image/png', PNG],
    ['JPEG', 'image/jpeg', JPEG],
    ['GIF87a', 'image/gif', GIF87],
    ['GIF89a', 'image/gif', GIF89],
    ['WebP', 'image/webp', WEBP],
  ])('%s signature -> %s', (_name, expected, input) => {
    expect(sniffImageType(input)).toBe(expected);
  });

  it('a bare JPEG start of three bytes is enough', () => {
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff))).toBe('image/jpeg');
  });

  it.each([
    ['RIFF without WEBP (WAV)', new Uint8Array([...ascii('RIFF'), 0x24, 0, 0, 0, ...ascii('WAVE')])],
    ['RIFF only, truncated', ascii('RIFF')],
    ['RIFF + size, WEBP missing', new Uint8Array([...ascii('RIFF'), 0x24, 0, 0, 0])],
    ['2-byte JPEG', bytes(0xff, 0xd8)],
    ['GIF8 only', ascii('GIF8')],
    ['GIF88a (not a version)', ascii('GIF88a')],
    ['PNG truncated to 7 bytes', PNG.slice(0, 7)],
    ['SVG', ascii('<svg xmlns="http://www.w3.org/2000/svg"></svg>')],
    ['SVG with XML prolog', ascii('<?xml version="1.0"?><svg></svg>')],
    ['HTML', ascii('<!doctype html><html><script>alert(1)</script>')],
    ['plain text', ascii('hello world, not an image')],
    ['empty', new Uint8Array(0)],
    ['HEIC (ftyp box)', new Uint8Array([0, 0, 0, 0x18, ...ascii('ftypheic'), 0, 0, 0, 0])],
  ])('%s -> null', (_name, input) => {
    expect(sniffImageType(input)).toBeNull();
  });

  it('only the leading bytes count: a PNG signature later in the file is not a PNG', () => {
    expect(sniffImageType(new Uint8Array([0x20, ...PNG]))).toBeNull();
  });
});
