/**
 * DE-8b T-4 (workplan §11; requirement §0.4.1 E as amended by SA C-16; SA
 * C-8, C-13): the zip's file name.
 */
import {
  ASCII_FILE_NAME_PATTERN,
  FILE_NAME_PATTERN,
  businessSlug,
  contentDisposition,
  encodeRfc5987,
  exportStamp,
  exportZipFileNames,
} from '../fileName';

// 2026-10-17 06:30 UTC = 09:30 in Jerusalem (UTC+3 in October).
const NOW = new Date('2026-10-17T06:30:00Z');

describe('names', () => {
  it('Latin name, owner clock', () => {
    expect(exportZipFileNames(NOW, 'Asia/Jerusalem', 'Acme Studio')).toEqual({
      fileName: 'acme-studio-data-export-2026-10-17-0930.zip',
      asciiFileName: 'acme-studio-data-export-2026-10-17-0930.zip',
    });
  });

  it('Hebrew name keeps its letters; the ASCII fallback is the agentpilot name', () => {
    expect(exportZipFileNames(NOW, 'Asia/Jerusalem', 'סטודיו נוגה')).toEqual({
      fileName: 'סטודיו-נוגה-data-export-2026-10-17-0930.zip',
      asciiFileName: 'agentpilot-data-export-2026-10-17-0930.zip',
    });
  });

  it('mixed name: accents kept in the Unicode name, folded in the ASCII one (SA optimisation)', () => {
    expect(exportZipFileNames(NOW, 'UTC', 'Café Noga 2')).toEqual({
      fileName: 'café-noga-2-data-export-2026-10-17-0630.zip',
      asciiFileName: 'cafe-noga-2-data-export-2026-10-17-0630.zip',
    });
  });

  it('Arabic and CJK letters survive', () => {
    expect(businessSlug('مقهى نور')).toBe('مقهى-نور');
    expect(businessSlug('東京 Studio')).toBe('東京-studio');
  });

  it('no name gives the agentpilot name', () => {
    expect(exportZipFileNames(NOW, null, null).fileName).toBe('agentpilot-data-export-2026-10-17-0630.zip');
  });
});

describe('the clock', () => {
  it('NULL and an invalid zone are UTC', () => {
    expect(exportStamp(NOW, null)).toBe('2026-10-17-0630');
    expect(exportStamp(NOW, 'Mars/Base')).toBe('2026-10-17-0630');
    expect(exportStamp(NOW, 'Asia/Jerusalem')).toBe('2026-10-17-0930');
  });

  it('midnight is 00, never 24, and can change the date', () => {
    expect(exportStamp(new Date('2026-10-16T21:00:00Z'), 'Asia/Jerusalem')).toBe('2026-10-17-0000');
  });
});

describe('hostile names (negative controls)', () => {
  it.each([
    ['../../etc', 'etc'],
    ['CON', ''],
    ['  ', ''],
    ['🎉🎉', ''],
    ['lpt1', ''],
  ])('%j -> slug %j', (name, slug) => {
    expect(businessSlug(name)).toBe(slug);
  });

  it('a bidi override (U+202E) mid-name never reaches the name', () => {
    const { fileName } = exportZipFileNames(NOW, 'UTC', 'Acme‮exe.Studio');
    expect(fileName).not.toMatch(/[‪-‮⁦-⁩]/);
    expect(fileName).toBe('acme-exe-studio-data-export-2026-10-17-0630.zip');
  });

  it('a 200-character name is cut to 60 code points, never inside a surrogate pair', () => {
    const name = 'a'.repeat(59) + '𝒜' + 'b'.repeat(140);
    const slug = businessSlug(name);
    expect(Array.from(slug).length).toBeLessThanOrEqual(60);
    expect(slug).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(slug.endsWith('𝒜')).toBe(true);
  });

  it('a Hebrew letter keeps its niqqud at the cut (grapheme boundary)', () => {
    const slug = businessSlug('א'.repeat(59) + 'בָּ' + 'ג'.repeat(10));
    expect(slug.endsWith('בָּ') || slug.endsWith('א')).toBe(true);
    expect(Array.from(slug).length).toBeLessThanOrEqual(60);
  });

  it.each([
    'Acme "Studio"; x=1\r\nSet-Cookie: a',
    "O'Brien & Sons (Ltd) *",
    'סטודיו "נוגה"\n',
    '../../etc/passwd',
    'CON',
    '',
  ])('C-13: %j gives names that match the safety patterns', (name) => {
    const names = exportZipFileNames(NOW, 'Asia/Jerusalem', name);
    expect(names.fileName).toMatch(FILE_NAME_PATTERN);
    expect(names.asciiFileName).toMatch(ASCII_FILE_NAME_PATTERN);
  });
});

describe('Content-Disposition reference (RFC 5987)', () => {
  it('encodes % and \' ( ) * beyond encodeURIComponent', () => {
    expect(encodeRfc5987("50% O'Brien (x)*")).toBe('50%25%20O%27Brien%20%28x%29%2A');
  });

  it('carries the ASCII fallback and the percent-encoded Unicode name', () => {
    const names = exportZipFileNames(NOW, 'Asia/Jerusalem', 'סטודיו נוגה');
    expect(contentDisposition(names.fileName, names.asciiFileName)).toBe(
      `attachment; filename="agentpilot-data-export-2026-10-17-0930.zip"; filename*=UTF-8''${encodeURIComponent(names.fileName)}`
    );
  });
});
