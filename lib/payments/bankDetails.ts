/**
 * Whether a bank account could be real, checked where it can be.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS CATCHES, AND WHAT IT CANNOT
 *
 * A typo. Nothing more, and that is worth saying plainly: an IBAN that passes
 * mod-97 may still belong to somebody else, and a routing number with a valid
 * check digit may belong to a bank this business has never used. Only the bank
 * knows, and in this product only Stripe ever asks one.
 *
 * What it does catch is the failure that actually happens: a digit dropped, two
 * transposed, a letter typed where a number belongs. `hasPaymentMethod` — the
 * test every gate in the platform uses — only asks whether these fields are
 * NON-EMPTY, so today a transposed IBAN passes every check we have and reaches
 * a client on an invoice, where the money then does not arrive and nobody can
 * say why.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NO DEPENDENCY, AND THE REASON IS THE ALGORITHMS
 *
 * Both are short, published, and unchanged for decades: ISO 13616 mod-97 for an
 * IBAN, and the weighted mod-10 in the ABA's own specification for a routing
 * number. A package for either would be more code to audit than the code it
 * replaces.
 *
 * The UK is deliberately absent. Real sort-code checking needs VocaLink's
 * modulus tables, which are a data file that goes stale — a dependency with a
 * maintenance cost, for a country whose IBAN form is already handled below.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ADVISORY, LIKE THE TAX ID
 *
 * Every function here returns a sentence or null. Nothing blocks a save: a
 * business whose bank details we cannot parse must still be able to put them on
 * an invoice, and a rule that refuses a valid account is a business that cannot
 * be paid.
 *
 * @module lib/payments
 */

/** Letters and digits only, upper-cased. Spaces and dashes are decoration. */
const bare = (value: string): string => value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();

/** Every country whose accounts are written as an IBAN, with its length. */
const IBAN_LENGTH: Record<string, number> = {
  AT: 20, BE: 16, BG: 22, CH: 21, CY: 28, CZ: 24, DE: 22, DK: 18, EE: 20,
  ES: 24, FI: 18, FR: 27, GB: 22, GR: 27, HR: 21, HU: 28, IE: 22, IL: 23,
  IS: 26, IT: 27, LT: 20, LU: 20, LV: 21, MT: 31, NL: 18, NO: 15, PL: 28,
  PT: 25, RO: 24, SE: 24, SI: 19, SK: 24, TR: 26,
};

export function isIbanCountry(country: string | null | undefined): boolean {
  return Boolean(country && IBAN_LENGTH[country.trim().toUpperCase()]);
}

/**
 * ISO 13616 mod-97.
 *
 * Move the first four characters to the end, turn every letter into two digits
 * (A = 10 … Z = 35), and the whole thing read as one number must leave a
 * remainder of 1. Computed in chunks because the number is far wider than a
 * JavaScript integer — a `parseInt` of a 30-digit string silently loses
 * precision and would answer "valid" for numbers that are not.
 */
function mod97(iban: string): number {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const digits = rearranged.replace(/[A-Z]/g, letter => String(letter.charCodeAt(0) - 55));

  let remainder = 0;
  for (const digit of digits) {
    remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder;
}

/**
 * Is this an IBAN that could exist?
 *
 * `null` when it looks right. The country's own length is checked first,
 * because "too short" is a sentence an owner can act on and "fails the
 * checksum" is not.
 */
export function checkIban(value: string, country?: string | null): string | null {
  const iban = bare(value);
  if (!iban) return null;

  if (!/^[A-Z]{2}/.test(iban)) {
    return 'An IBAN starts with two letters for the country, like IL62 0108 0000 0009 9999 999.';
  }

  const prefix = iban.slice(0, 2);
  const expected = IBAN_LENGTH[prefix];

  if (!expected) {
    /* A country this table does not list. Nothing honest to say about it. */
    return null;
  }

  if (country && country.trim().toUpperCase() !== prefix) {
    return 'This IBAN is for ' + prefix + ', and your address says ' + country.trim().toUpperCase() + '.';
  }

  if (iban.length !== expected) {
    return 'An IBAN in ' + prefix + ' has ' + expected + ' characters. This one has ' + iban.length + '.';
  }

  return mod97(iban) === 1
    ? null
    : 'That IBAN does not check out. A digit is usually transposed somewhere.';
}

/** Groups of four, the way an IBAN is written everywhere it is printed. */
export function formatIban(value: string): string {
  return (bare(value).match(/.{1,4}/g) ?? []).join(' ');
}

/**
 * A US routing number: nine digits, weighted 3-7-1, summing to a multiple of 10.
 *
 * The weights are the ABA's, in that order, repeated three times. A number
 * passing this is correctly FORMED; whether it belongs to the bank the owner
 * banks with is not knowable here.
 */
export function checkRoutingNumber(value: string): string | null {
  const digits = value.replace(/\D/g, '');
  if (!digits) return null;

  if (digits.length !== 9) {
    return 'A US routing number is nine digits. This one has ' + digits.length + '.';
  }

  const weights = [3, 7, 1, 3, 7, 1, 3, 7, 1];
  const total = weights.reduce((sum, weight, index) => sum + weight * Number(digits[index]), 0);

  return total % 10 === 0
    ? null
    : 'That routing number does not check out. It is usually one digit off.';
}

/**
 * A US account number, which carries no checksum anywhere in the system.
 *
 * Every bank numbers its own accounts, so the only honest test is length — and
 * even that is a range rather than a rule. Said once here so no caller invents
 * a stricter one: there is nothing more to check, and a field that refuses a
 * valid account is worse than one that accepts a wrong one, because the second
 * is caught by the bank and the first is never caught at all.
 */
export function checkAccountNumber(value: string): string | null {
  const digits = value.replace(/\D/g, '');
  if (!digits) return null;

  if (digits.length < 4) return 'An account number is at least four digits.';
  if (digits.length > 17) return 'An account number is at most seventeen digits.';
  return null;
}

export interface BankCheck {
  /** How the field should be labelled and filled in this country. */
  mode: 'iban' | 'domestic';
  accountLabel: string;
  accountPlaceholder: string;
  /** Null where this country does not use one — an IBAN carries it inside. */
  routingLabel: string | null;
  routingPlaceholder: string | null;
  format: (raw: string) => string;
  checkAccount: (raw: string, country?: string | null) => string | null;
  checkRouting: (raw: string) => string | null;
}

/**
 * How to ask for a bank account where this business banks.
 *
 * Two shapes, because there are two in practice: one value that carries
 * everything, or an account plus the number that says which bank.
 */
export function bankCheckFor(country: string | null | undefined): BankCheck {
  if (isIbanCountry(country)) {
    return {
      mode: 'iban',
      accountLabel: 'IBAN',
      accountPlaceholder: 'IL62 0108 0000 0009 9999 999',
      routingLabel: null,
      routingPlaceholder: null,
      format: formatIban,
      checkAccount: (raw, iso) => checkIban(raw, iso),
      checkRouting: () => null,
    };
  }

  return {
    mode: 'domestic',
    accountLabel: 'Account number',
    accountPlaceholder: '000123456789',
    routingLabel: 'Routing number',
    routingPlaceholder: '021000021',
    /* No separators: an account number is printed as it is given. */
    format: raw => raw.replace(/[^0-9A-Za-z -]/g, '').slice(0, 34),
    checkAccount: raw => checkAccountNumber(raw),
    checkRouting: raw => checkRoutingNumber(raw),
  };
}
