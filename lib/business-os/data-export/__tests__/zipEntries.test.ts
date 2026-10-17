/**
 * DE-8b T-5 (workplan §9.3; SA Q-13, C-4, C-14): entry names inside the zip.
 * `file_name` arrives from the public intake upload as the uploader sent it,
 * so these are hostile inputs, not cosmetics.
 */
import { EntryNamer, SEGMENT_MAX_UNITS, cleanSegment, isAllowedEntryName, joinEntry } from '../zipEntries';

const PREFIX = 'files/client-documents/11111111-1111-4111-8111-111111111111';

describe('cleanSegment: hostile intake names (SA C-4)', () => {
  it.each([
    ['../../x.pdf'],
    ['..\\x'],
    ['C:x'],
    ['/etc/passwd'],
    ['....'],
    ['.'],
    ['..'],
    ['invoice‮fdp.exe'],
    ['a\u0000b.txt'],
    ['x'.repeat(500) + '.pdf'],
    ['bad\uD800name.txt'],
    ['nul.txt'],
    ['CON'],
    ['\u0007\u001b'],
    [''],
  ])('%j becomes ONE safe segment under a fixed prefix', (raw) => {
    const segment = cleanSegment(raw);
    expect(segment.length).toBeGreaterThan(0);
    expect(segment.length).toBeLessThanOrEqual(SEGMENT_MAX_UNITS);
    expect(segment).not.toMatch(/[/\\:*?"<>|]/);
    expect(segment).not.toMatch(/[\u0000-\u001F\u007F-\u009F‎‏‪-‮⁦-⁩]/);
    expect(segment).not.toMatch(/^[.\s]|[.\s]$/);
    expect(segment).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    expect(isAllowedEntryName(`${PREFIX}/${segment}`)).toBe(true);
  });

  it('exact results for the classic shapes', () => {
    expect(cleanSegment('../../x.pdf')).toBe('-..-x.pdf');
    expect(cleanSegment('C:x')).toBe('C-x');
    expect(cleanSegment('/etc/passwd')).toBe('-etc-passwd');
    expect(cleanSegment('....')).toBe('file');
    expect(cleanSegment('invoice‮fdp.exe')).toBe('invoicefdp.exe');
    expect(cleanSegment('nul.txt')).toBe('file.txt');
    expect(cleanSegment('Com1.tar.gz')).toBe('file.gz');
  });

  it('a 500-character name keeps its extension within 120 units', () => {
    const segment = cleanSegment('x'.repeat(500) + '.pdf');
    expect(segment).toHaveLength(SEGMENT_MAX_UNITS);
    expect(segment.endsWith('.pdf')).toBe(true);
  });

  it('a long name of astral characters is cut on a code-point boundary', () => {
    const segment = cleanSegment('𝒜'.repeat(100) + '.png');
    expect(segment.endsWith('.png')).toBe(true);
    expect(segment).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  it('Hebrew names survive (NFC)', () => {
    expect(cleanSegment('חוזה לקוח.pdf')).toBe('חוזה לקוח.pdf');
    expect(cleanSegment('é.txt')).toBe('é.txt');
  });
});

describe('joinEntry', () => {
  it('cleans every segment and joins under the fixed prefix', () => {
    expect(joinEntry('files/website-images', ['logo', 'a.png'])).toBe('files/website-images/logo/a.png');
    expect(joinEntry('files/website-images', ['..', '..', 'x'])).toBe('files/website-images/file/file/x');
  });
});

describe('EntryNamer: duplicates (SA C-14)', () => {
  it('adds (2), (3) before the extension, case-insensitively', () => {
    const namer = new EntryNamer();
    expect(namer.claim(PREFIX, 'Report.PDF')).toBe(`${PREFIX}/Report.PDF`);
    expect(namer.claim(PREFIX, 'report.pdf')).toBe(`${PREFIX}/report (2).pdf`);
    expect(namer.claim(PREFIX, 'REPORT.pdf')).toBe(`${PREFIX}/REPORT (3).pdf`);
    expect(namer.claim(`${PREFIX}x`, 'report.pdf')).toBe(`${PREFIX}x/report.pdf`);
  });

  it('is deterministic for the same claim order', () => {
    const run = () => {
      const namer = new EntryNamer();
      return ['a.txt', 'A.txt', 'a.txt'].map((name) => namer.claim('files/x', name));
    };
    expect(run()).toEqual(run());
  });
});

describe('isAllowedEntryName (the zip-wide allow-list)', () => {
  it.each(['README.txt', 'README-he.txt', 'data.json', 'files-index.csv', 'records/account/user_profile.csv', `${PREFIX}/a.pdf`])(
    'allows %j',
    (name) => expect(isAllowedEntryName(name)).toBe(true)
  );

  it.each(['/abs', '../x', 'files/a/../b', 'files/a/./b', 'files\\a\\b', 'files/a/C:x', 'records/../x.csv', 'other.txt', 'files/a', 'files/a/b\u0000'])(
    'refuses %j',
    (name) => expect(isAllowedEntryName(name)).toBe(false)
  );
});
