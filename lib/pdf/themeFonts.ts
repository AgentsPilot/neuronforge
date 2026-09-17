/**
 * Register a business's theme font with react-pdf.
 *
 * WHY THIS IS NOT JUST A fontFamily STRING
 *
 * react-pdf ships four built-in families (Helvetica and friends). Anything else
 * has to be registered from an actual font file before it can be named in a
 * style — naming an unregistered family silently falls back, so a themed
 * invoice would quietly look exactly like an unthemed one.
 *
 * Google Fonts serves TTF only to clients that look old enough not to
 * understand WOFF2, so the CSS is requested with an ancient user agent and the
 * .ttf URL is read out of it. Each family is fetched once per process.
 *
 * HEBREW
 *
 * Latin display faces mostly carry no Hebrew glyphs, so applying a theme font
 * to a Hebrew invoice replaces readable text with empty boxes. Hebrew keeps
 * Rubik, which the RTL setup already registers. That is a real limit of the
 * font, not a shortcut.
 *
 * @module lib/pdf/themeFonts
 */

import { Font } from '@react-pdf/renderer';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'PDFThemeFonts' });

/** Families already registered (or known to be unavailable) this process. */
const attempted = new Map<string, string | null>();

/*
 * NO User-Agent header. Sending one is what broke this.
 *
 * The trick used to be to ask as an ancient browser so Google would serve TTF
 * instead of WOFF2. That is no longer what happens. Measured against the live
 * API, all three cases differ:
 *
 *   MSIE 6.0 UA   →  /l/font?kit=…   magic 34 68 00 00   a subset blob
 *                                    fontkit: "Unknown font format"
 *   no UA         →  …-Regular.ttf   magic 00 01 00 00   a real TTF
 *   modern UA     →  /l/font?kit=…   magic 77 4F 46 32   WOFF2
 *
 * So the legacy header now produces the ONE format nothing can read, and
 * sending nothing produces exactly what is wanted. Node's fetch sets no
 * User-Agent unless told to, which is why this is an absence rather than a
 * value.
 */

/** Font container formats `fontkit` can actually parse. */
const READABLE_MAGIC = new Set(['00010000', '74727565', '74746366', '4f54544f']);

function cssUrl(family: string): string {
  return `https://fonts.googleapis.com/css?family=${encodeURIComponent(family)}:400,700`;
}

/**
 * Make a theme font usable in a PDF.
 *
 * @returns the family name to put in styles, or null to keep the default.
 *          Never throws: an invoice must render even when a font does not.
 */
export async function registerThemeFont(family: string | undefined | null): Promise<string | null> {
  if (!family) return null;

  const trimmed = family.trim();
  if (!trimmed) return null;
  if (attempted.has(trimmed)) return attempted.get(trimmed)!;

  try {
    const response = await fetch(cssUrl(trimmed));
    if (!response.ok) throw new Error(`Google Fonts returned ${response.status}`);

    const css = await response.text();

    /*
     * ─────────────────────────────────────────────────────────────────────────
     * THE URL DOES NOT ALWAYS END IN `.ttf`.
     *
     * This looked for `url(https://….ttf)`, and Google serves two shapes:
     *
     *   https://fonts.gstatic.com/s/assistant/v24/…-Regular.ttf
     *   https://fonts.gstatic.com/l/font?kit=2sDPZGJY…&skey=d0a91b9f&v=v24
     *
     * The second is a TTF too — the legacy user agent above is what guarantees
     * that — it simply arrives from a query-string endpoint with no extension.
     * Newer families and ones with many subsets come back that way, Assistant
     * among them. So every themed invoice for a business on Bloom, Warm or any
     * archetype whose body face is Assistant silently fell back to Helvetica,
     * and the log said the stylesheet had no TTF in it when it had one.
     *
     * Parsed per `@font-face` block rather than by position, too. The old code
     * assumed "first declaration is regular, second is bold", which is only
     * true when the response happens to contain exactly the two weights asked
     * for in that order — a response split by SUBSET (latin, latin-ext,
     * hebrew) would have handed the second subset's regular face to bold.
     */
    const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)]
      .map(block => block[1])
      .map(block => ({
        weight: Number(/font-weight:\s*(\d+)/.exec(block)?.[1] ?? 400),
        src: /src:\s*url\((https:\/\/[^)]+)\)/.exec(block)?.[1],
      }))
      .filter((face): face is { weight: number; src: string } =>
        // A woff would be a sign the user agent was not believed; react-pdf
        // cannot read one, and registering it fails at render rather than here.
        Boolean(face.src) && !/\.woff2?(\?|$)/.test(face.src!)
      );

    // One face per weight: a family served per subset repeats each weight, and
    // react-pdf takes the first it is given.
    const byWeight = new Map<number, string>();
    for (const face of faces) {
      if (!byWeight.has(face.weight)) byWeight.set(face.weight, face.src);
    }

    if (byWeight.size === 0) throw new Error('No usable font source in the stylesheet');

    /*
     * ─────────────────────────────────────────────────────────────────────────
     * PROVE IT IS A FONT BEFORE REGISTERING IT.
     *
     * `Font.register` only records a URL; react-pdf fetches and parses it later,
     * during rendering — OUTSIDE this function's try/catch. So a source that
     * turns out to be unreadable does not fall back quietly here, it throws
     * "Unknown font format" from `fontkit` in the middle of generating a
     * document, and the invoice fails to send. A 500 on an invoice is far worse
     * than a PDF in the wrong typeface.
     *
     * That is exactly what happened: the URL looked plausible, the bytes were
     * not a font, and a cosmetic fallback became a hard failure. Reading the
     * first four bytes here costs one request per family per process and makes
     * the promise in this file's header — never throws, always renders — true
     * rather than hoped for.
     */
    const verified: Array<{ src: string; fontWeight: number }> = [];
    for (const [fontWeight, src] of byWeight) {
      const probe = await fetch(src);
      if (!probe.ok) continue;

      const bytes = Buffer.from(await probe.arrayBuffer());
      const magic = bytes.subarray(0, 4).toString('hex');
      if (!READABLE_MAGIC.has(magic)) {
        logger.warn(
          { family: trimmed, fontWeight, magic },
          'Font source is not a container fontkit can read; skipping this weight'
        );
        continue;
      }

      /*
       * The BYTES are registered, not the URL.
       *
       * Checking a URL and then handing over the URL verifies nothing: react-pdf
       * fetches it a second time, and what arrives the second time is what
       * fontkit actually parses. Two requests to the same Google Fonts address
       * can differ — that is the whole reason this file exists, since the
       * response depends on how the client presents itself — and the second
       * request is made by a library that decides its own headers.
       *
       * A data URL takes react-pdf's `isDataUrl` branch, which decodes it
       * inline and never fetches anything. So the bytes proved readable above
       * are exactly the bytes parsed at render, and the check stops being a
       * guess about a future request.
       */
      verified.push({
        src: `data:font/truetype;base64,${bytes.toString('base64')}`,
        fontWeight,
      });
    }

    if (verified.length === 0) throw new Error('No readable font source in the stylesheet');

    Font.register({ family: trimmed, fonts: verified });

    attempted.set(trimmed, trimmed);
    logger.info({ family: trimmed, weights: verified.map(f => f.fontWeight) }, 'Registered theme font for PDF');
    return trimmed;
  } catch (err) {
    // A missing font is a cosmetic loss; falling back is the correct outcome.
    attempted.set(trimmed, null);
    logger.warn({ err, family: trimmed }, 'Could not register theme font; using the default');
    return null;
  }
}
