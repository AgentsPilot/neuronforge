/**
 * The logo's numbers have to agree with themselves in three places, and two of
 * the disagreements are silent.
 *
 *   1. `LOGO_HEIGHT` and the literal Tailwind classes in `Logo.tsx`. The
 *      classes must be written out in full or the JIT never generates them —
 *      which compiles, renders, and produces an element with no height. No
 *      error anywhere.
 *
 *   2. The manifest's `width`/`height` and the actual PNG on disk. This is the
 *      original bug: three headers declared a 109x20 wordmark as 120x120 and
 *      the only symptom was a console warning nobody reads.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { WORDMARK, LOGO_HEIGHT, widthForHeight } from '../logo';

const ROOT = process.cwd();

/** PNG dimensions straight from the IHDR header — no image library needed. */
function pngSize(publicPath: string): { width: number; height: number } {
  const buf = readFileSync(join(ROOT, 'public', publicPath.replace(/^\//, '')));
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe('the logo manifest describes the files that exist', () => {
  const assets = [
    ['WORDMARK.light', WORDMARK.light],
    ...(WORDMARK.dark ? ([['WORDMARK.dark', WORDMARK.dark]] as const) : []),
  ] as const;

  it.each(assets)('%s matches the PNG on disk', (_name, asset) => {
    expect(pngSize(asset.src)).toEqual({ width: asset.width, height: asset.height });
  });

  it('is a wide lockup, not a square', () => {
    // The asset is ~5.5:1. If this ever reads near 1 the file has been replaced
    // by an untrimmed art-board again, which is what made the logo render tiny.
    const ratio = WORDMARK.light.width / WORDMARK.light.height;
    expect(ratio).toBeGreaterThan(3);
  });

  it('keeps the ratio when scaled to a placement height', () => {
    const h = LOGO_HEIGHT.header;
    const w = widthForHeight(WORDMARK.light, h);
    expect(w / h).toBeCloseTo(WORDMARK.light.width / WORDMARK.light.height, 1);
  });
});

describe('the sizing classes are literal, and match LOGO_HEIGHT', () => {
  const raw = readFileSync(join(ROOT, 'components/brand/Logo.tsx'), 'utf8');

  /*
   * Comments stripped before scanning. The file documents the broken pattern by
   * name — that is the point of the note — and a guard that cannot tell an
   * example from an occurrence fails on its own explanation. It did, first run.
   */
  const source = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('never builds a class name from a variable', () => {
    /*
     * `h-[${x}px]` is the failure this catches: Tailwind cannot see it, so the
     * class is never generated and the logo has no height. It looks correct in
     * the editor and renders nothing.
     */
    expect(source).not.toMatch(/h-\[\$\{/);
    expect(source).not.toMatch(/w-\[\$\{/);
  });

  it.each(Object.entries(LOGO_HEIGHT))('has a literal class for %s (%ipx)', (_placement, px) => {
    expect(source).toContain(`h-[${px}px]`);
  });
});
