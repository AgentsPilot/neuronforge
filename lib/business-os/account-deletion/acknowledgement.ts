/**
 * The one typed statement of the customer self-delete (data export DE-10b.2;
 * requirement §3.2, §3.3; SA workplan review V-5).
 *
 * There is one statement per language. The customer types it to say they took
 * their data and want the account deleted forever. A statement in ANY
 * supported language is accepted, whatever the UI language, so a Hebrew user
 * who types the English statement is not refused.
 *
 * The server matches against THIS list, never against a statement the browser
 * sent. The drawer imports the same list only to show the statement and to
 * enable its button. So this module is pure and client-safe: no server import,
 * no logging (the typed text is the customer's own words).
 *
 * ── Matching (§3.3) ────────────────────────────────────────────────────────
 * NFC → strip bidi and zero-width marks → strip Hebrew points and cantillation
 * → the purge rule (`normaliseConfirmation`: trim, collapse whitespace, lower
 * case). That rule is MIRRORED below rather than imported, because
 * `lib/business-os/purge/confirmation.ts` imports a server repository and this
 * module ships in the client bundle. A parity test pins the two together.
 *
 * Final wording is UI copy and needs a native check. Spanish is a draft.
 *
 * @module lib/business-os/account-deletion/acknowledgement
 */

export const STATEMENT_LANGUAGES = ['en', 'he', 'es'] as const;
export type StatementLanguage = (typeof STATEMENT_LANGUAGES)[number];

/** Verbatim from the requirement §3.2. No punctuation and no geresh, by design. */
export const DELETION_STATEMENTS: Readonly<Record<StatementLanguage, string>> = {
  en: 'I have downloaded my data and want my account deleted forever',
  he: 'הורדתי את הנתונים שלי ואני רוצה למחוק את החשבון שלי לצמיתות',
  // Draft: needs a native check (as in DE-9).
  es: 'He descargado mis datos y quiero que mi cuenta se elimine para siempre',
};

/** The longest statement a customer may send (the receipt column holds at most 500). */
export const MAX_STATEMENT_LENGTH = 500;

/*
 * SA N-4: the three ranges below are written as LITERAL invisible characters
 * on purpose. Tailwind scans `lib/`, and a backslash-u escape in a scanned file
 * can break `next build` (the CSS-escape hazard, PR #180). Do not "fix" them
 * into escapes. The tests in __tests__/acknowledgement.test.ts use literal
 * marks for the same reason, and prove each range strips what it should. The
 * Hebrew points range is literal too.
 */
/** LRM, RLM, the embedding and override marks, and the isolates. */
const BIDI_MARKS = /[‎‏‪-‮⁦-⁩]/g;
/** Zero-width space, non-joiner, joiner and the BOM. */
const ZERO_WIDTH_MARKS = /[​-‍﻿]/g;
/** Hebrew points (niqqud) and cantillation marks. No letter lives in this range. */
const HEBREW_POINTS = /[֑-ׇ]/g;

/** Mirror of `normaliseConfirmation` (lib/business-os/purge/confirmation.ts). Pinned by a parity test. */
function normaliseConfirmationMirror(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function normaliseAcknowledgement(s: string): string {
  return normaliseConfirmationMirror(
    s.normalize('NFC').replace(BIDI_MARKS, '').replace(ZERO_WIDTH_MARKS, '').replace(HEBREW_POINTS, '')
  );
}

const NORMALISED_STATEMENTS: ReadonlyArray<[StatementLanguage, string]> = STATEMENT_LANGUAGES.map((language) => [
  language,
  normaliseAcknowledgement(DELETION_STATEMENTS[language]),
]);

/**
 * The language whose statement the typed text matches, or null. Text longer
 * than the receipt can hold never matches.
 */
export function matchStatement(typed: unknown): StatementLanguage | null {
  if (typeof typed !== 'string' || typed.length === 0 || typed.length > MAX_STATEMENT_LENGTH) return null;
  const normalised = normaliseAcknowledgement(typed);
  for (const [language, statement] of NORMALISED_STATEMENTS) {
    if (normalised === statement) return language;
  }
  return null;
}

export function isStatementLanguage(value: unknown): value is StatementLanguage {
  return typeof value === 'string' && (STATEMENT_LANGUAGES as readonly string[]).includes(value);
}
