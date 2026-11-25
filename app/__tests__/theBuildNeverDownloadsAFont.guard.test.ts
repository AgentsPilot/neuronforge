/**
 * No layout asks Google for a font while the app is being built.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PREVENTS
 *
 * `next/font/google` downloads the face during compilation. On 2026-11-06 that
 * download was refused mid-build on Vercel and the deployment died:
 *
 *     app/business-os/layout.tsx
 *     An error occurred in `next/font`.
 *     TypeError: Cannot read properties of null (reading '1')
 *         at .../@next/font/dist/google/loader.js:112:78
 *
 * The message names no cause because there is none to name: the loader fetches
 * the stylesheet, regexes it, and reads `[1]` off a match that is null when the
 * fetch returned something other than a stylesheet. A rate limit, a 503 and a
 * blocked egress are indistinguishable, and all of them read as a type error
 * inside Next rather than as "the font did not download".
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A GUARD AND NOT A CODE REVIEW NOTE
 *
 * The failure is not reproducible on demand. The same commit built clean
 * locally and in CI; the only red build was the one Google happened to refuse.
 * So reintroducing `next/font/google` would not fail anybody's build — it would
 * sit there until a random deploy, months later, on a commit that has nothing
 * to do with fonts. That is exactly the kind of regression a cheap source guard
 * is for.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const ROOTS = ['app', 'components', 'lib'];
const ROOT = process.cwd();

/** Every source file under the given roots, tests and build output excluded. */
function sources(): string[] {
  const found: string[] = [];

  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        /* `__tests__` is skipped so this file's own prose, which quotes the
           forbidden import, does not count as a violation. */
        if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
        if (entry.name.startsWith('.')) continue;
        walk(full);
        continue;
      }

      if (/\.(tsx?|jsx?|css)$/.test(entry.name)) found.push(full);
    }
  };

  for (const root of ROOTS) walk(path.join(ROOT, root));
  return found;
}

const files = sources();

/** Source with comments removed, so prose about the bug is not read as the bug. */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/**
 * The import forms that make the build fetch a face: a static import, a
 * `require`, and a dynamic `import()`. Matching these rather than the bare
 * module name keeps a mention in a string or a doc from counting.
 */
const IMPORTS_GOOGLE_FONT =
  /(?:from\s*|require\s*\(\s*|import\s*\(\s*)['"]next\/font\/google['"]/;

describe('nothing downloads a font at build time', () => {
  it('finds source files to check at all', () => {
    /* A broken walk would make every assertion below vacuously true. */
    expect(files.length).toBeGreaterThan(500);
  });

  it('imports no font from next/font/google', () => {
    /*
     * THE BUG, AS ONE ASSERTION. Each offender is reported with its path, so a
     * failure says which file to change rather than only that one exists.
     *
     * Comments are stripped and the match is on the IMPORT form, not on the
     * bare string. Both layouts now carry a note explaining what went wrong,
     * and those notes name `next/font/google` — a substring search flagged the
     * documentation of the fix as the defect it documents.
     */
    const offenders = files
      .filter(file => IMPORTS_GOOGLE_FONT.test(code(fs.readFileSync(file, 'utf8'))))
      .map(file => path.relative(ROOT, file));

    expect(offenders).toEqual([]);
  });

  it('pulls in no font stylesheet over the network from CSS either', () => {
    /* The other way back in: an @import of the same stylesheet the loader was
       fetching. It fails at request time rather than build time, which is
       worse, because nothing goes red at all. */
    const offenders = files
      .filter(file => file.endsWith('.css'))
      .filter(file => /@import[^;]*fonts\.googleapis\.com/.test(fs.readFileSync(file, 'utf8')))
      .map(file => path.relative(ROOT, file));

    expect(offenders).toEqual([]);
  });
});

describe('the faces the layouts name are actually on disk', () => {
  /** `src:` paths out of a layout, resolved the way next/font/local resolves them. */
  const resolvedFaces = (layout: string): string[] => {
    const source = fs.readFileSync(path.join(ROOT, layout), 'utf8');
    const dir = path.dirname(path.join(ROOT, layout));

    return [...source.matchAll(/src:\s*'([^']+)'/g)].map(m => path.resolve(dir, m[1]));
  };

  it.each([
    ['app/layout.tsx', 1],
    ['app/business-os/layout.tsx', 2],
  ])('%s names %i face(s), and each file exists', (layout, count) => {
    const faces = resolvedFaces(layout);

    expect(faces).toHaveLength(count);
    for (const face of faces) {
      expect(fs.existsSync(face)).toBe(true);
      /* Non-empty, because an LFS pointer or a failed download is a small text
         file that `existsSync` is perfectly happy with. */
      expect(fs.statSync(face).size).toBeGreaterThan(10_000);
    }
  });

  it('the vendored files are real fonts, not HTML error pages', () => {
    /*
     * A refused download writes the refusal to the file. `wOF2` is the woff2
     * magic number and `\0\1\0\0` the TrueType one; an error page is neither,
     * and would otherwise be committed and ship as a broken face.
     */
    const faces = [
      'app/fonts/Inter-Variable-latin.woff2',
      'app/fonts/SpaceGrotesk-Variable-latin.woff2',
      'lib/pdf/fonts/Heebo-VariableFont_wght.ttf',
    ];

    /* Hex, because two of the four magic numbers are not printable:
       774f4632 is "wOF2", 00010000 is TrueType, 4f54544f is "OTTO",
       74727565 is "true". */
    const FONT_MAGIC = ['774f4632', '00010000', '4f54544f', '74727565'];

    for (const face of faces) {
      const magic = fs.readFileSync(path.join(ROOT, face)).subarray(0, 4).toString('hex');

      expect(FONT_MAGIC).toContain(magic);
    }
  });

  it('keeps the OFL licence beside the faces it covers', () => {
    /* Both families are SIL OFL 1.1: redistribution is permitted provided the
       licence is included, so these two files are a condition of shipping. */
    for (const licence of ['app/fonts/Inter-OFL.txt', 'app/fonts/SpaceGrotesk-OFL.txt']) {
      const text = fs.readFileSync(path.join(ROOT, licence), 'utf8');

      expect(text).toContain('SIL OPEN FONT LICENSE');
    }
  });
});
