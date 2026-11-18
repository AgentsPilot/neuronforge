/**
 * What a tax number looks like, country by country.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * The field was free text with no limit, so an owner could type forty digits
 * and save them, and the first time anyone found out was a client holding an
 * invoice with a number on it that no tax authority recognises. A wrong tax
 * number is worse than a missing one: `missingInvoiceFields` can see that the
 * field is empty and ask for it, and it cannot see that the content is wrong.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ADVISORY, NOT A GATE — WITH ONE EXCEPTION
 *
 * The length cap is enforced, because no country's number is longer than its
 * own format and a truncation at the limit is obvious while it is happening.
 * Everything else is said rather than refused:
 *
 *   · the rules below are the common cases, NOT the whole world. A business in
 *     a country this table does not know must still be able to bill, so an
 *     unknown country gets a generous alphanumeric field and no complaint.
 *   · formats change, and a stale rule that refuses a valid number is a
 *     business that cannot invoice at all.
 *
 * So `check` returns a sentence to show, never a reason to block a save. The
 * one thing that is structural is `format`: a country whose number is written
 * with separators gets them inserted as the owner types, because a number that
 * LOOKS like the document it will appear on is one they can proofread.
 *
 * @module lib/payments
 */

export interface TaxIdRule {
  /** What the country calls it, for the field's own label. */
  label: string;
  /** Shown in the empty field, in the country's own shape. */
  placeholder: string;
  /** Characters allowed, after which the field stops accepting input. */
  maxLength: number;
  /** Digits only, or letters too (an EU VAT prefix, a UK GB). */
  alphanumeric: boolean;
  /** Draws the separators as it is typed. Identity where there are none. */
  format: (raw: string) => string;
  /** Null when it looks right; a sentence when it does not. */
  check: (raw: string) => string | null;
}

/** Everything that is not a letter or a digit, which is what we re-insert. */
const bare = (value: string, alphanumeric: boolean): string =>
  (alphanumeric ? value.replace(/[^A-Za-z0-9]/g, '') : value.replace(/\D/g, '')).toUpperCase();

/**
 * The United States: an EIN is nine digits, written XX-XXXXXXX.
 *
 * A sole trader may enter an SSN here instead, which is also nine digits and
 * written XXX-XX-XXXX — the field does not try to tell them apart, because
 * asking which one it is would be asking a question to format a string.
 */
const US: TaxIdRule = {
  label: 'EIN',
  placeholder: '12-3456789',
  maxLength: 9,
  alphanumeric: false,
  format: raw => {
    const digits = bare(raw, false).slice(0, 9);
    return digits.length > 2 ? digits.slice(0, 2) + '-' + digits.slice(2) : digits;
  },
  check: raw => (bare(raw, false).length === 9 ? null : 'A US EIN is nine digits, like 12-3456789.'),
};

/** Israel: nine digits, written without separators. */
const IL: TaxIdRule = {
  label: 'מספר עוסק / ח.פ.',
  placeholder: '514123456',
  maxLength: 9,
  alphanumeric: false,
  format: raw => bare(raw, false).slice(0, 9),
  check: raw =>
    bare(raw, false).length === 9 ? null : 'An Israeli business number is nine digits.',
};

/** The United Kingdom: GB plus nine digits, written GB123 4567 89. */
const GB: TaxIdRule = {
  label: 'VAT number',
  placeholder: 'GB123 4567 89',
  maxLength: 11,
  alphanumeric: true,
  format: raw => {
    const value = bare(raw, true).replace(/^GB/, '').slice(0, 9);
    const parts = [value.slice(0, 3), value.slice(3, 7), value.slice(7, 9)].filter(Boolean);
    return value ? 'GB' + parts.join(' ') : '';
  },
  check: raw =>
    bare(raw, true).replace(/^GB/, '').length === 9
      ? null
      : 'A UK VAT number is GB followed by nine digits.',
};

/**
 * The EU shape: a two-letter country prefix and up to twelve characters.
 *
 * One rule for the whole union on purpose. Each member state has its own
 * length and its own check digit, and a table of twenty-seven that is right
 * today is a table that is wrong next year — in the direction that stops a
 * business invoicing. The prefix is the part worth checking, because it is the
 * part people leave off.
 */
const EU = (code: string, country: string): TaxIdRule => ({
  label: 'VAT number',
  placeholder: code + '123456789',
  maxLength: 14,
  alphanumeric: true,
  format: raw => bare(raw, true).slice(0, 14),
  check: raw => {
    const value = bare(raw, true);
    if (value.length < 8) return 'A VAT number in ' + country + ' starts with ' + code + '.';
    return value.startsWith(code) ? null : 'A VAT number in ' + country + ' starts with ' + code + '.';
  },
});

/**
 * A country this table does not know.
 *
 * Deliberately permissive: the alternative is a business that cannot put its
 * own tax number on its own invoice because we had not heard of its format.
 */
const ANY: TaxIdRule = {
  label: 'Tax ID / VAT number',
  placeholder: 'Your tax number',
  maxLength: 20,
  alphanumeric: true,
  format: raw => raw.replace(/[^A-Za-z0-9\- ]/g, '').slice(0, 20),
  check: () => null,
};

const BY_COUNTRY: Record<string, TaxIdRule> = {
  US,
  IL,
  GB,
  DE: EU('DE', 'Germany'),
  FR: EU('FR', 'France'),
  ES: EU('ES', 'Spain'),
  IT: EU('IT', 'Italy'),
  NL: EU('NL', 'the Netherlands'),
  IE: EU('IE', 'Ireland'),
  BE: EU('BE', 'Belgium'),
  AT: EU('AT', 'Austria'),
  PT: EU('PT', 'Portugal'),
  PL: EU('PL', 'Poland'),
  SE: EU('SE', 'Sweden'),
  DK: EU('DK', 'Denmark'),
  FI: EU('FI', 'Finland'),
};

/** The rule for a country code, or the permissive one. */
export function taxIdRule(country: string | null | undefined): TaxIdRule {
  if (!country) return ANY;
  return BY_COUNTRY[country.trim().toUpperCase()] ?? ANY;
}
