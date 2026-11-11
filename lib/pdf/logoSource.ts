/**
 * A business logo, in a form a PDF can actually draw.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `@react-pdf/renderer` TAKES PNG AND JPEG. NOTHING ELSE.
 *
 * Its `<Image>` decodes raster data. Handed an SVG URL it does not throw, draw
 * a placeholder, or warn — it renders nothing, and the document comes out
 * looking exactly like a business that never uploaded a logo.
 *
 * Which is what happened. The invoice generator has rendered
 * `businessSettings.logo_url` since branding landed, the repository selects it
 * and the route passes it, yet one live account's invoices had no logo for
 * months. The file is `…/logos/1788276169328-dnq1hz.svg`. Nothing was broken;
 * the format was unreadable by the renderer, and silently so.
 *
 * Four of five logos on the platform are `.jpg` or `.png` and were always fine,
 * which is why it went unnoticed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SO SVG IS RASTERISED, NOT REFUSED
 *
 * `canvas` is a direct dependency and its librsvg backend is present, so an SVG
 * can be drawn to a bitmap and handed over as a PNG data URI.
 *
 * One wrinkle, and it is the reason a first attempt failed: **librsvg requires
 * `width` and `height` ON THE `<svg>` ELEMENT**. A file carrying only a
 * `viewBox` — which is most files any vector editor exports — fails with
 * "Width and height must be set on the svg element". The viewBox already states
 * the dimensions, so they are lifted from it.
 *
 * Everything here is best-effort: any failure returns null and the document
 * renders without a logo, which is what it did before. A PDF must never fail
 * over branding.
 *
 * @module lib/pdf
 */

import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'pdfLogo' });

/** What the renderer decodes without help. */
const RASTER = ['.png', '.jpg', '.jpeg'];

/** Wide enough to stay sharp at the ~46pt the letterhead draws it. */
const RASTER_WIDTH = 240;

/** Big enough for any logo, small enough that a hostile URL cannot exhaust us. */
const MAX_SVG_BYTES = 2 * 1024 * 1024;

function extensionOf(url: string): string {
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    /* Not absolute. The raw path still ends in its extension. */
    return url.split('?')[0].toLowerCase();
  }
}

/** True when the renderer can take the URL as it stands. */
export function isRasterLogo(logoUrl: string | null | undefined): boolean {
  if (!logoUrl) return false;
  const path = extensionOf(logoUrl);
  return RASTER.some(ext => path.endsWith(ext));
}

/**
 * The logo as something `<Image src>` will draw, or null.
 *
 * A raster URL is returned untouched — react-pdf fetches it itself, and
 * re-downloading it here would be work for nothing. An SVG is fetched,
 * rasterised, and returned as a `data:image/png;base64,…` URI.
 *
 * Async because of that fetch, so it is resolved BEFORE the document element is
 * built rather than inside a component.
 */
export async function pdfLogoSource(logoUrl: string | null | undefined): Promise<string | null> {
  if (!logoUrl) return null;
  if (isRasterLogo(logoUrl)) return logoUrl;

  const path = extensionOf(logoUrl);
  if (!path.endsWith('.svg')) {
    logger.warn({ logoUrl }, 'Logo skipped: not a format a PDF can draw');
    return null;
  }

  try {
    const response = await fetch(logoUrl);
    if (!response.ok) throw new Error(`fetch ${response.status}`);

    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_SVG_BYTES) throw new Error(`svg too large (${bytes.length})`);

    let markup = bytes.toString('utf8');

    /*
     * librsvg needs explicit dimensions. Most exported files carry only a
     * viewBox, which states the same numbers — so they are copied onto the
     * element rather than guessed at.
     */
    if (!/<svg[^>]*\swidth\s*=/.test(markup)) {
      const viewBox = markup.match(/viewBox\s*=\s*["']([\d.\s,+-]+)["']/);
      if (!viewBox) throw new Error('svg has neither width nor viewBox');
      const [, , w, h] = viewBox[1].trim().split(/[\s,]+/).map(Number);
      if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
        throw new Error('svg viewBox is not a usable size');
      }
      markup = markup.replace(/<svg/, `<svg width="${w}" height="${h}"`);
    }

    /*
     * Imported here, not at module scope.
     *
     * `canvas` loads a native binary. This module is reached from PDF routes
     * that are themselves dynamically imported to keep React-PDF away from
     * Jest, and a static require would undo that for anything importing this
     * file for `isRasterLogo` alone.
     */
    const { loadImage, createCanvas } = await import('canvas');

    const image = await loadImage(Buffer.from(markup));
    const height = Math.max(1, Math.round((RASTER_WIDTH * image.height) / image.width));
    const canvas = createCanvas(RASTER_WIDTH, height);
    canvas.getContext('2d').drawImage(image, 0, 0, RASTER_WIDTH, height);

    return `data:image/png;base64,${canvas.toBuffer('image/png').toString('base64')}`;
  } catch (err) {
    /*
     * Warned, never thrown. A logo that cannot be drawn is a cosmetic loss; a
     * quote or invoice that fails to render is a client who cannot read what
     * they are being asked to pay.
     */
    logger.warn({ err, logoUrl }, 'Logo could not be rasterised — rendering without it');
    return null;
  }
}
