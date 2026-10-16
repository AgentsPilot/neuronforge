/**
 * F-27: the website upload rules shared by the route and the browser. Workplan:
 * docs/workplans/WEBSITE_UPLOAD_BUCKET_SCOPE_F27_WORKPLAN.md (Tests).
 */

import {
  WEBSITE_IMAGE_ACCEPT,
  WEBSITE_IMAGE_BUCKET,
  WEBSITE_IMAGE_EXTENSIONS,
  WEBSITE_IMAGE_MAX_BYTES,
  WEBSITE_IMAGE_MAX_MB,
  WEBSITE_IMAGE_MIME_TYPES,
  websiteUploadErrorKey,
  websiteUploadPath,
} from '@/lib/validation/websiteImage';

const UUID = '11111111-2222-4333-8444-555555555555';
const U = 'u';

describe('website image constants', () => {
  it('pins the one bucket', () => {
    expect(WEBSITE_IMAGE_BUCKET).toBe('website-images');
  });

  it('pins 4 MB', () => {
    expect(WEBSITE_IMAGE_MAX_MB).toBe(4);
    expect(WEBSITE_IMAGE_MAX_BYTES).toBe(4 * 1024 * 1024);
  });

  it('allows exactly the four bitmap types, never SVG', () => {
    expect([...WEBSITE_IMAGE_MIME_TYPES].sort()).toEqual(['image/gif', 'image/jpeg', 'image/png', 'image/webp']);
    expect(WEBSITE_IMAGE_MIME_TYPES).not.toContain('image/svg+xml');
    expect(WEBSITE_IMAGE_ACCEPT).not.toMatch(/svg/i);
    expect(WEBSITE_IMAGE_ACCEPT.split(',').sort()).toEqual([...WEBSITE_IMAGE_MIME_TYPES].sort());
  });

  it('has an extension for every allowed type', () => {
    expect(WEBSITE_IMAGE_EXTENSIONS).toEqual({
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
    });
  });
});

describe('websiteUploadPath', () => {
  it.each([
    [undefined, `${U}/${UUID}.png`],
    ['', `${U}/${UUID}.png`],
    ['logos', `${U}/logos/${UUID}.png`],
    [`${U}/logos`, `${U}/logos/${UUID}.png`],
    ['shared/logos', `${U}/logos/${UUID}.png`],
    ['../other/logos', `${U}/logos/${UUID}.png`],
    ['other-user-id', `${U}/${UUID}.png`],
    ['logos/../../x', `${U}/${UUID}.png`],
    ['logos/', `${U}/${UUID}.png`],
    ['LOGOS', `${U}/${UUID}.png`],
  ])('folder %p -> %s', (folder, expected) => {
    const path = websiteUploadPath(U, folder, 'png', UUID);
    expect(path).toBe(expected);
    expect(path.startsWith(`${U}/`)).toBe(true);
    expect(path).not.toContain('..');
  });

  it('uses the extension it is given', () => {
    expect(websiteUploadPath(U, undefined, 'webp', UUID)).toBe(`${U}/${UUID}.webp`);
  });
});

describe('websiteUploadErrorKey', () => {
  it.each([
    ['file_type', 'media.upload.invalid_type'],
    ['file_too_large', 'media.upload.too_large'],
    ['upload_failed', 'media.upload.failed'],
    ['invalid_request', 'media.upload.failed'],
    ['internal', 'media.upload.failed'],
    [undefined, 'media.upload.failed'],
    [42, 'media.upload.failed'],
  ])('%p -> %s', (code, key) => {
    expect(websiteUploadErrorKey(code)).toBe(key);
  });
});
