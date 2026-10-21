/**
 * What someone typed into the orders search, read as terms.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A PARSER AND NOT MORE SUBSTRING MATCHING
 *
 * The search joined the client name, the title, the invoice number and
 * `String(item.amount)` into one string and asked whether the typed text
 * appeared anywhere in it. That has two consequences an owner meets quickly:
 *
 *   "800"   matched ₪800, and ₪1,800, and ₪800,000, and invoice 0800. A
 *           substring of a number is not a smaller number.
 *
 *   "october"  matched nothing at all. No date was in the haystack, so the one
 *              question a money list is most often asked — what came in last
 *              month — could not be asked.
 *
 * So amounts and periods are parsed into ranges and compared as numbers and
 * dates. Whatever is left over stays text and keeps matching exactly as before.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE PARSER, BOTH SIDES
 *
 * The field renders a chip per recognised term and the route filters by them,
 * from this one function. A second implementation would drift, and the drift
 * would show as a chip on screen that the rows do not obey — the worst failure
 * available here, because the UI would be *explaining* a filter it is not
 * applying.
 *
 * The typed string stays the only state. Chips are a VIEW of it, which is why
 * the search survives a reload, a CSV export and a URL as plain text.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A BARE NUMBER IS DELIBERATELY NOT AN AMOUNT
 *
 * `28` is an invoice number far more often than it is ₪28, and invoice search
 * already worked. An amount needs a marker that says so: a comparison (`>500`),
 * a range (`500-900`), a currency symbol (`₪800`) or decimals (`800.00`). A
 * bare integer falls through to text, where it matches invoice numbers AND the
 * amount string exactly as it always did. Nothing that worked stops working.
 *
 * @module lib/payments/moneySearchTerms
 */

/** An amount bound. `null` on either side means unbounded that way. */
export interface AmountTerm {
  kind: 'amount';
  min: number | null;
  max: number | null;
  /** The exact characters this came from, so the field can remove it again. */
  raw: string;
}

/** A calendar span on the business's own clock, inclusive at both ends. */
export interface PeriodTerm {
  kind: 'period';
  /** 'YYYY-MM-DD', inclusive. */
  from: string;
  /** 'YYYY-MM-DD', inclusive. */
  to: string;
  raw: string;
}

/** Anything not recognised: a name, an invoice number, a service. */
export interface TextTerm {
  kind: 'text';
  value: string;
  raw: string;
}

/**
 * A state the money is in, typed as a word.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * "open" was the question this search could not answer, and it is the one the
 * advisor card asks out loud: an owner told ₪510 of invoices is open went to
 * this list and had no way to say so. The KPI tiles carry the same states, but
 * a tile is something you find — a word is something you already know.
 *
 * `value` is a `MoneyFilter`, so the caller hands it straight to the control
 * rather than re-deriving a mapping of its own. See `matchesTerms` for why this
 * kind is not matched here.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export interface StatusTerm {
  kind: 'status';
  /** 'unpaid' | 'overdue' | 'paid' | 'refunded' | 'draft' | 'cancelled'. */
  value: string;
  raw: string;
}

/**
 * How the money arrives — a bill sent, a card charged, a plan.
 *
 * The other half of "₪510 of INVOICES is open". `value` is what the `method`
 * query parameter takes, for the same reason as above.
 */
export interface MethodTerm {
  kind: 'method';
  /** 'invoice' | 'direct' | 'plan'. */
  value: string;
  raw: string;
}

export type MoneySearchTerm = AmountTerm | PeriodTerm | TextTerm | StatusTerm | MethodTerm;

/**
 * The state words, in the three languages the product speaks.
 *
 * Several words per state on purpose: an owner reaches for "open" or "unpaid"
 * or "owed" for the same thing, and the list's own label ("Outstanding") is
 * only one of them. Every word here is asserted to parse by the vocabulary
 * test, the same guarantee the period tokens carry.
 */
const STATUS_WORDS: Record<string, string> = {
  open: 'unpaid', unpaid: 'unpaid', outstanding: 'unpaid', owed: 'unpaid', due: 'unpaid',
  pendiente: 'unpaid', impagado: 'unpaid', 'פתוח': 'unpaid', 'פתוחות': 'unpaid', 'חייב': 'unpaid',
  overdue: 'overdue', late: 'overdue', vencido: 'overdue', atrasado: 'overdue',
  'באיחור': 'overdue', 'מאחר': 'overdue',
  paid: 'paid', collected: 'paid', pagado: 'paid', cobrado: 'paid',
  'שולם': 'paid', 'נגבה': 'paid',
  refunded: 'refunded', refund: 'refunded', reembolsado: 'refunded', 'הוחזר': 'refunded',
  draft: 'draft', borrador: 'draft', 'טיוטה': 'draft',
  cancelled: 'cancelled', canceled: 'cancelled', cancelado: 'cancelled', 'בוטל': 'cancelled',
};

/** And the collection words. `plan` reaches a filter no control ever did. */
const METHOD_WORDS: Record<string, string> = {
  invoice: 'invoice', invoices: 'invoice', bill: 'invoice', factura: 'invoice',
  facturas: 'invoice', 'חשבונית': 'invoice', 'חשבוניות': 'invoice',
  card: 'direct', direct: 'direct', tarjeta: 'direct', directo: 'direct',
  'כרטיס': 'direct', 'ישיר': 'direct',
  plan: 'plan', plans: 'plan', installments: 'plan', plazos: 'plan',
  'תשלומים': 'plan',
};

/** A state or collection word, or null. Checked before the number readers. */
function readWord(token: string): StatusTerm | MethodTerm | null {
  const word = token.trim().toLowerCase().replace(/[.,]$/, '');
  if (!word) return null;

  const status = STATUS_WORDS[word];
  if (status) return { kind: 'status', value: status, raw: token };

  const collection = METHOD_WORDS[word];
  if (collection) return { kind: 'method', value: collection, raw: token };

  return null;
}

/**
 * Month names this understands, in the three languages the product speaks.
 *
 * Hebrew is listed because a Hebrew-speaking owner types Hebrew. The short
 * forms are the ones the product's own date formatter produces, so a month read
 * off a row can be pasted back into the search.
 */
const MONTHS: Record<string, number> = {
  january: 1, jan: 1, enero: 1, ene: 1, 'ינואר': 1,
  february: 2, feb: 2, febrero: 2, 'פברואר': 2,
  march: 3, mar: 3, marzo: 3, 'מרץ': 3, 'מרס': 3,
  april: 4, apr: 4, abril: 4, abr: 4, 'אפריל': 4,
  may: 5, mayo: 5, 'מאי': 5,
  june: 6, jun: 6, junio: 6, 'יוני': 6,
  july: 7, jul: 7, julio: 7, 'יולי': 7,
  august: 8, aug: 8, agosto: 8, ago: 8, 'אוגוסט': 8,
  september: 9, sep: 9, sept: 9, septiembre: 9, 'ספטמבר': 9,
  october: 10, oct: 10, octubre: 10, 'אוקטובר': 10,
  november: 11, nov: 11, noviembre: 11, 'נובמבר': 11,
  december: 12, dec: 12, diciembre: 12, dic: 12, 'דצמבר': 12,
};

/** The month a word names, or null. Also used by the caller to pair with a year. */
function monthNamed(token: string): number | null {
  const word = token.trim().toLowerCase().replace(/\.$/, '');
  return /^[a-zא-ת]+$/.test(word) ? MONTHS[word] ?? null : null;
}

/** A calendar month as a period, on the given year. */
function monthSpan(year: number, month: number, raw: string): PeriodTerm {
  return {
    kind: 'period',
    from: dateStr(year, month, 1),
    to: dateStr(year, month, lastDay(year, month)),
    raw,
  };
}

/** Currency marks that make a number an amount. No rates involved: a mark is a hint. */
const CURRENCY = /[₪$€£]/;

const pad = (n: number) => String(n).padStart(2, '0');
const dateStr = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** Last calendar day of a month, leap years included. */
function lastDay(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** `today` shifted by whole calendar days, never by milliseconds. */
function shiftDays(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const moved = new Date(Date.UTC(y, m - 1, d + delta));
  return dateStr(moved.getUTCFullYear(), moved.getUTCMonth() + 1, moved.getUTCDate());
}

/** A number with thousands separators and an optional currency mark stripped. */
function toNumber(text: string): number | null {
  const cleaned = text.replace(CURRENCY, '').replace(/,/g, '').trim();
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/** Does this token carry a marker that makes it an amount rather than text? */
function looksLikeMoney(token: string): boolean {
  return CURRENCY.test(token) || /\d\.\d/.test(token) || /\d,\d{3}/.test(token);
}

/**
 * One token, or null when it is not a recognised amount or period.
 *
 * @param token  the raw token, already lowercased for matching
 * @param today  the business's own date, 'YYYY-MM-DD' — see `businessDayFor`
 */
function readToken(token: string, today: string): AmountTerm | PeriodTerm | null {
  const raw = token;
  const text = token.trim().toLowerCase();
  if (!text) return null;

  /* ── a full date, or a span of two ─────────────────────────────────────── */
  const span = text.match(/^(\d{4}-\d{2}-\d{2})\s*(?:\.\.|–|—|to)\s*(\d{4}-\d{2}-\d{2})$/);
  if (span) {
    const [from, to] = [span[1], span[2]].sort();
    return { kind: 'period', from, to, raw };
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return { kind: 'period', from: text, to: text, raw };
  }

  /* ── a month, with or without a year: 'october', '2026-10', '10/2026' ──── */
  const ymMonth = text.match(/^(\d{4})-(\d{1,2})$/);
  const monthY = text.match(/^(\d{1,2})\/(\d{4})$/);
  if (ymMonth || monthY) {
    const year = Number(ymMonth ? ymMonth[1] : monthY![2]);
    const month = Number(ymMonth ? ymMonth[2] : monthY![1]);
    if (month >= 1 && month <= 12) {
      return {
        kind: 'period',
        from: dateStr(year, month, 1),
        to: dateStr(year, month, lastDay(year, month)),
        raw,
      };
    }
  }

  /* ── a bare year ──────────────────────────────────────────────────────── */
  if (/^\d{4}$/.test(text)) {
    const year = Number(text);
    /* Bounded to years a business could plausibly mean. Otherwise `1600` in a
       service name becomes a search over the seventeenth century. */
    if (year >= 2000 && year <= 2100) {
      return { kind: 'period', from: `${year}-01-01`, to: `${year}-12-31`, raw };
    }
  }

  /* ── a bare month name. A year AFTER it is paired up by the caller, which
        can see the next token; this cannot, the string is already split. ───── */
  const month = monthNamed(text);
  if (month) {
    /*
     * No year given means the most recent occurrence of that month, not the
     * current calendar year's. In January, "december" means the December just
     * gone — the one with orders in it — rather than eleven months away.
     */
    const thisYear = Number(today.slice(0, 4));
    const thisMonth = Number(today.slice(5, 7));
    const year = month > thisMonth ? thisYear - 1 : thisYear;

    return {
      kind: 'period',
      from: dateStr(year, month, 1),
      to: dateStr(year, month, lastDay(year, month)),
      raw,
    };
  }

  /* ── an amount comparison ─────────────────────────────────────────────── */
  const compare = text.match(/^(>=|<=|>|<)\s*([₪$€£]?[\d.,]+)$/);
  if (compare) {
    const value = toNumber(compare[2]);
    if (value !== null) {
      const over = compare[1].startsWith('>');
      return { kind: 'amount', min: over ? value : null, max: over ? null : value, raw };
    }
  }

  /* ── an amount range: '500-900' ───────────────────────────────────────── */
  const range = text.match(/^([₪$€£]?[\d.,]+)\s*(?:-|\.\.|–|—)\s*([₪$€£]?[\d.,]+)$/);
  if (range) {
    const a = toNumber(range[1]);
    const b = toNumber(range[2]);
    if (a !== null && b !== null) {
      return { kind: 'amount', min: Math.min(a, b), max: Math.max(a, b), raw };
    }
  }

  /* ── a marked single amount: '₪800', '800.00' ─────────────────────────── */
  if (looksLikeMoney(text)) {
    const value = toNumber(text);
    if (value !== null) return { kind: 'amount', min: value, max: value, raw };
  }

  return null;
}

/**
 * Multi-word phrases, matched before the string is split on spaces.
 *
 * Each returns a span relative to `today`, so "last 30 days" moves with the
 * business's own date and not with the server's.
 */
function readPhrase(text: string, today: string): PeriodTerm | null {
  const lower = text.toLowerCase();

  const lastN = lower.match(
    /^(?:last\s+(\d{1,3})\s+days?|(?:ה)?(\d{1,3})\s+הימים\s+האחרונים|últimos\s+(\d{1,3})\s+días)$/
  );
  if (lastN) {
    const days = Number(lastN[1] ?? lastN[2] ?? lastN[3]);
    /* Inclusive of today, so "last 30 days" is a 30-day window and not 31. */
    return { kind: 'period', from: shiftDays(today, -(days - 1)), to: today, raw: text };
  }

  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));

  if (['today', 'היום', 'hoy'].includes(lower)) return { kind: 'period', from: today, to: today, raw: text };

  if (['yesterday', 'אתמול', 'ayer'].includes(lower)) {
    const day = shiftDays(today, -1);
    return { kind: 'period', from: day, to: day, raw: text };
  }

  if (['this month', 'החודש', 'este mes'].includes(lower)) {
    return {
      kind: 'period',
      from: dateStr(year, month, 1),
      to: dateStr(year, month, lastDay(year, month)),
      raw: text,
    };
  }

  if (['last month', 'החודש שעבר', 'el mes pasado'].includes(lower)) {
    const y = month === 1 ? year - 1 : year;
    const m = month === 1 ? 12 : month - 1;
    return { kind: 'period', from: dateStr(y, m, 1), to: dateStr(y, m, lastDay(y, m)), raw: text };
  }

  if (['this year', 'השנה', 'este año'].includes(lower)) {
    return { kind: 'period', from: `${year}-01-01`, to: `${year}-12-31`, raw: text };
  }

  if (['last year', 'השנה שעברה', 'el año pasado'].includes(lower)) {
    return { kind: 'period', from: `${year - 1}-01-01`, to: `${year - 1}-12-31`, raw: text };
  }

  return null;
}

/**
 * The multi-word phrases, longest first so "last 30 days" beats "last".
 *
 * Hebrew and Spanish are here because the product speaks them. A Hebrew owner
 * reading a Hebrew page types Hebrew, and the hint buttons under the box insert
 * whatever their own label says — so a phrase the parser does not understand in
 * Hebrew would mean a Hebrew user clicking a hint and getting nothing.
 *
 * "last month" must come AFTER the n-days pattern and both must come before any
 * bare-word pattern, since these are applied in sequence over the whole string.
 */
const PHRASES = [
  /last\s+\d{1,3}\s+days?/gi,
  /ה?\d{1,3}\s+הימים\s+האחרונים/g,
  /últimos\s+\d{1,3}\s+días/gi,
  /this\s+month/gi,
  /last\s+month/gi,
  /this\s+year/gi,
  /last\s+year/gi,
  /este\s+mes/gi,
  /el\s+mes\s+pasado/gi,
  /este\s+año/gi,
  /el\s+año\s+pasado/gi,
  /* The two-word Hebrew forms MUST precede the one-word ones: 'השנה' is a
     prefix of 'השנה שעברה', and lifted first it would leave 'שעברה' behind as
     stray text that matches nothing. */
  /החודש\s+שעבר/g,
  /השנה\s+שעברה/g,
  /החודש/g,
  /השנה/g,
  /היום/g,
  /אתמול/g,
  /yesterday/gi,
  /today/gi,
  /hoy/gi,
  /ayer/gi,
];

/**
 * Read a search string into terms, in the order they were typed.
 *
 * @param input the raw contents of the search box
 * @param today the business's own date, 'YYYY-MM-DD'. Passed in rather than
 *   computed so this stays pure: `businessDayFor(new Date(), tz).date` on the
 *   server, and the same value handed to the field on the client.
 *
 * Adjacent text is merged into ONE text term, so "shlomo the king" stays a
 * phrase and is matched as one. Splitting it would make the search match any
 * row holding either word, which is a different and much looser question.
 */
export function parseMoneySearch(input: string, today: string): MoneySearchTerm[] {
  if (!input.trim()) return [];

  /*
   * Phrases are lifted out first, because they contain spaces and everything
   * below works on space-separated tokens. Each is replaced by a placeholder
   * that cannot occur in typed text.
   */
  const lifted: string[] = [];
  let working = input;
  for (const pattern of PHRASES) {
    working = working.replace(pattern, match => {
      lifted.push(match);
      /* NUL-delimited and space-padded. The string is about to be split on
         whitespace: a bare ` 0 ` would arrive as the token `0` and be read as
         a number, and without the padding the placeholder would fuse with the
         word before it. NUL cannot be typed, so it cannot collide. */
      return ` \u0000${lifted.length - 1}\u0000 `;
    });
  }

  const terms: MoneySearchTerm[] = [];
  /** Text is accumulated and flushed as one term, so phrases stay phrases. */
  let pending: string[] = [];

  const flush = () => {
    if (!pending.length) return;
    const value = pending.join(' ').trim();
    if (value) terms.push({ kind: 'text', value: value.toLowerCase(), raw: value });
    pending = [];
  };

  const tokens = working.split(/\s+/).filter(Boolean);

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    /*
     * "october 2026" is TWO tokens, and a month name alone would otherwise be
     * read as the most recent October and the year dropped on the floor as a
     * period of its own — two period chips, ANDed, matching nothing.
     *
     * So a month followed by a plausible year consumes both, and the chip reads
     * the month the owner actually asked for.
     */
    const named = monthNamed(token);
    const next = tokens[i + 1];
    if (named && next && /^\d{4}$/.test(next)) {
      const year = Number(next);
      if (year >= 2000 && year <= 2100) {
        flush();
        terms.push(monthSpan(year, named, `${token} ${next}`));
        i += 1;
        continue;
      }
    }

    const placeholder = token.match(/^\u0000(\d+)\u0000$/);
    if (placeholder) {
      const phrase = lifted[Number(placeholder[1])];
      const read = readPhrase(phrase, today);
      if (read) {
        flush();
        terms.push(read);
      } else {
        pending.push(phrase);
      }
      continue;
    }

    /*
     * Before the number readers, because these are words and those are not —
     * and after the month pairing above, so a month name still wins. No word
     * appears in both tables; the vocabulary test asserts it.
     */
    const word = readWord(token);
    if (word) {
      flush();
      terms.push(word);
      continue;
    }

    const read = readToken(token, today);
    if (read) {
      flush();
      terms.push(read);
    } else {
      pending.push(token);
    }
  }
  flush();

  return terms;
}

/* ───────────────────────────────────────────────────────────────────────────
   WHAT THE PICKER MAY OFFER.

   The vocabulary lives HERE, beside the reader, because the one unforgivable
   failure in a suggestion list is offering a token the parser cannot read: the
   user clicks, a chip appears, and it filters nothing. Exported from this file
   so the two can be tested together — `searchVocabularyParses` asserts that
   every single token below comes back as a period.
   ─────────────────────────────────────────────────────────────────────────── */

export type SearchLanguage = 'en' | 'es' | 'he';

/** One offerable token, with the words to show on it. */
export interface Suggestion {
  /** Inserted verbatim into the search string. MUST parse. */
  token: string;
  label: string;
}

/**
 * Month names in their canonical form, in order, per language.
 *
 * `MONTHS` above holds every alias it will accept — 'oct', 'sept', 'מרס'. This
 * is the one spelling to OFFER, which is a different list: a picker showing
 * both "oct" and "october" is noise.
 */
const CANONICAL_MONTHS: Record<SearchLanguage, string[]> = {
  en: ['january', 'february', 'march', 'april', 'may', 'june',
       'july', 'august', 'september', 'october', 'november', 'december'],
  es: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
       'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'],
  he: ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
       'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'],
};

/** The relative spans worth a button, in the reader's language. */
const RELATIVE: Record<SearchLanguage, Suggestion[]> = {
  en: [
    { token: 'this month', label: 'This month' },
    { token: 'last month', label: 'Last month' },
    { token: 'last 30 days', label: 'Last 30 days' },
    { token: 'last 90 days', label: 'Last 90 days' },
    { token: 'this year', label: 'This year' },
    { token: 'last year', label: 'Last year' },
  ],
  es: [
    { token: 'este mes', label: 'Este mes' },
    { token: 'el mes pasado', label: 'El mes pasado' },
    { token: 'últimos 30 días', label: 'Últimos 30 días' },
    { token: 'últimos 90 días', label: 'Últimos 90 días' },
    { token: 'este año', label: 'Este año' },
    { token: 'el año pasado', label: 'El año pasado' },
  ],
  he: [
    { token: 'החודש', label: 'החודש' },
    { token: 'החודש שעבר', label: 'החודש שעבר' },
    { token: '30 הימים האחרונים', label: '30 הימים האחרונים' },
    { token: '90 הימים האחרונים', label: '90 הימים האחרונים' },
    { token: 'השנה', label: 'השנה' },
    { token: 'השנה שעברה', label: 'השנה שעברה' },
  ],
};

/** Every relative span the picker offers, in the reader's language. */
export function relativePeriods(language: SearchLanguage): Suggestion[] {
  return RELATIVE[language] ?? RELATIVE.en;
}

/**
 * The states, as the picker offers them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The parser has read these words since the states became terms, and nothing
 * offered them — so the panel showed an amount box and six period pills, and a
 * state could only be found by an owner who already guessed it was typeable.
 * "Open" is the one question the advisor card asks out loud, and it was the one
 * the picker would not help with.
 *
 * ONE SPELLING PER STATE, the way `CANONICAL_MONTHS` offers one month name
 * while `MONTHS` accepts every alias. "open", "unpaid", "outstanding" and
 * "owed" all parse; a panel listing four pills that do the same thing is noise.
 *
 * The METHODS are deliberately not offered here. They have a control of their
 * own in the toolbar, two steps away, and a second way to set the same filter
 * from the same screen is how the two come to disagree about which is on. The
 * words still parse, for anyone who types them.
 *
 * Every token is asserted to parse by `the picker cannot offer a dead token` —
 * offering one the reader cannot read is the one unforgivable failure here.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const STATUS_OFFERS: Record<SearchLanguage, Suggestion[]> = {
  en: [
    { token: 'open', label: 'Open' },
    { token: 'overdue', label: 'Overdue' },
    { token: 'paid', label: 'Paid' },
    { token: 'refunded', label: 'Refunded' },
    { token: 'draft', label: 'Draft' },
    { token: 'cancelled', label: 'Cancelled' },
  ],
  he: [
    { token: 'פתוח', label: 'פתוח' },
    { token: 'באיחור', label: 'באיחור' },
    { token: 'שולם', label: 'שולם' },
    { token: 'הוחזר', label: 'הוחזר' },
    { token: 'טיוטה', label: 'טיוטה' },
    { token: 'בוטל', label: 'בוטל' },
  ],
  es: [
    { token: 'pendiente', label: 'Pendiente' },
    { token: 'vencido', label: 'Vencido' },
    { token: 'pagado', label: 'Pagado' },
    { token: 'reembolsado', label: 'Reembolsado' },
    { token: 'borrador', label: 'Borrador' },
    { token: 'cancelado', label: 'Cancelado' },
  ],
};

/** The states this picker may offer, in the reader's own language. */
export function statusFilters(language: SearchLanguage): Suggestion[] {
  return STATUS_OFFERS[language] ?? STATUS_OFFERS.en;
}

/**
 * Months whose name starts with what has been typed.
 *
 * Both the current year's and the previous one's, because a business searching
 * "october" in October usually wants this one and in March usually wants last.
 * Offering both costs a line and removes the guess.
 */
export function monthCompletions(
  prefix: string,
  language: SearchLanguage,
  today: string
): Suggestion[] {
  const typed = prefix.trim().toLowerCase();
  if (typed.length < 2) return [];

  const thisYear = Number(today.slice(0, 4));
  const out: Suggestion[] = [];

  for (const name of CANONICAL_MONTHS[language] ?? CANONICAL_MONTHS.en) {
    if (!name.startsWith(typed)) continue;

    const shown = language === 'he' ? name : name[0].toUpperCase() + name.slice(1);
    /* The bare name resolves to the most recent occurrence — see `readToken` —
       so it is offered as-is rather than pinned to a year that may be wrong. */
    out.push({ token: name, label: shown });
    out.push({ token: `${name} ${thisYear - 1}`, label: `${shown} ${thisYear - 1}` });
  }

  return out;
}

/**
 * Relative spans whose name starts with what has been typed.
 *
 * Matched on the label as well as the token so Hebrew, where the two are the
 * same string, needs no special case.
 */
export function periodCompletions(prefix: string, language: SearchLanguage): Suggestion[] {
  const typed = prefix.trim().toLowerCase();
  if (!typed) return [];

  return relativePeriods(language).filter(
    s => s.token.toLowerCase().startsWith(typed) || s.label.toLowerCase().startsWith(typed)
  );
}

/**
 * Remove one term from the string it was parsed out of.
 *
 * The field's ✕ and backspace both come here, so a chip is deleted from the
 * TEXT rather than from a parallel list of chips. There is no parallel list to
 * fall out of step.
 *
 * Matched on the raw characters and only the first occurrence, so typing the
 * same term twice and removing one chip removes one chip.
 */
export function removeTerm(input: string, term: MoneySearchTerm): string {
  const at = input.indexOf(term.raw);
  if (at < 0) return input;

  const without = input.slice(0, at) + input.slice(at + term.raw.length);
  return without.replace(/\s{2,}/g, ' ').trim();
}

/**
 * Does an item fall inside every term?
 *
 * @param amount the item's amount, in its own currency
 * @param day the item's date as the BUSINESS writes it, 'YYYY-MM-DD'
 * @param haystack everything searchable about the item, already lowercased
 *
 * AND, not OR. Two terms are a narrower question than one, which is what
 * someone adding a second chip is asking for.
 *
 * Amounts are compared within a currency and never across one. There is no FX
 * rate anywhere in this platform, so ">500" means 500 of whatever the row is
 * priced in. A business billing in two currencies gets both, which is the only
 * answer available without inventing a rate.
 */
export function matchesTerms(
  terms: MoneySearchTerm[],
  item: { amount: number; day: string | null; haystack: string }
): boolean {
  for (const term of terms) {
    if (term.kind === 'text') {
      if (!item.haystack.includes(term.value)) return false;
      continue;
    }

    if (term.kind === 'amount') {
      if (term.min !== null && item.amount < term.min) return false;
      if (term.max !== null && item.amount > term.max) return false;
      continue;
    }

    /*
     * STATE AND COLLECTION ARE APPLIED ELSEWHERE, deliberately.
     *
     * Both already have a control of their own — the KPI tiles and the method
     * group — and both travel to this endpoint as explicit parameters. Matching
     * them here as well would make the typed word a SECOND source of truth for
     * the same narrowing, and two of those drift.
     *
     * So the word's whole job is to move the control: `MoneyList` reads these
     * terms and sets `filter` / `method` from them, which is what the request
     * carries. Recognising it here is still necessary — it keeps the word out
     * of the text haystack, where "open" would otherwise be matched against
     * client names, and it is what lets the field draw a chip for it.
     */
    if (term.kind === 'status' || term.kind === 'method') continue;

    /* A row with no date cannot be in a period. Excluding it is the honest
       answer: "October" asked for October, and this is not known to be in it. */
    if (!item.day) return false;
    if (item.day < term.from || item.day > term.to) return false;
  }

  return true;
}
