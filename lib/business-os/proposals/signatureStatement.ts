/**
 * The sentence a client signs, and its version.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SERVER'S WORDING IS THE ONE THAT COUNTS
 *
 * The page shows this sentence and sends back what it displayed, but what gets
 * RECORDED is resolved here, server-side. `lib/consent/recordConsent.ts` sets
 * the rule and the reason: a client running a stale page, a translated build,
 * or a hand-made request must not be able to decide what they agreed to.
 *
 * Their echo is kept too — under `evidence.client_statement` — so a mismatch is
 * visible afterwards rather than silently resolved in either direction.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE VERSION IS NOT DECORATION
 *
 * This sentence will be reworded. A signature means what the sentence said ON
 * THE DAY, so the version is stored beside it and **must be bumped whenever any
 * wording below changes** — including a translation. Without that, a reworded
 * statement silently restates what every past client agreed to.
 *
 * @module lib/business-os/proposals
 */

export const SIGNATURE_STATEMENT_VERSION = '2026-11-10.1';

type Locale = 'en' | 'es' | 'he';

/**
 * Deliberately plain, and deliberately not a warranty.
 *
 * It says the client read the proposal and agrees to its terms — which is what
 * they are actually doing. It does not claim identity, witnessing or anything
 * else this product cannot evidence.
 */
const STATEMENTS: Record<Locale, string> = {
  en: 'I have read this proposal and I agree to its terms.',
  es: 'He leído esta propuesta y acepto sus condiciones.',
  he: 'קראתי את ההצעה ואני מסכים/ה לתנאיה.',
};

export function signatureStatement(locale: string | null | undefined): {
  text: string;
  locale: Locale;
  version: string;
} {
  const resolved: Locale =
    locale === 'he' || locale === 'es' ? locale : 'en';
  return {
    text: STATEMENTS[resolved],
    locale: resolved,
    version: SIGNATURE_STATEMENT_VERSION,
  };
}
