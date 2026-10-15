/**
 * The contact search: one box, a panel of what it understands, one string.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE TEXT IS THE ONLY STATE — the same design as the orders search, and for
 * the same three reasons.
 *
 * There is no array of chips anywhere. `value` is the string the owner typed,
 * the chips are what this function makes of it, and everything that adds or
 * removes one edits that string. Which buys:
 *
 *   · the chips cannot disagree with the filter, because the route parses the
 *     same string with the same function;
 *   · a search survives a reload, a URL and a CSV export as plain text;
 *   · select-all, paste and undo keep working, because it really is one
 *     `<input>` rather than a div pretending to be one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE DATES ARE NOT PARSED HERE
 *
 * "this month" and "September" mean exactly what they mean on the orders page,
 * because the orders parser is what reads them. A second implementation would
 * be a second answer to "which days are in this month", and the two would
 * disagree the first time one learned about a business week that starts on
 * Sunday.
 *
 * So the prefixed tokens are lifted out first and everything left over goes to
 * `parseMoneySearch`, which contributes its period terms. Its AMOUNT terms are
 * turned back into text: "500" against a contact is a phone number or a name,
 * never a sum, and a filter nobody asked for is worse than a word that matches
 * nothing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT A CONTACT CAN BE FILTERED BY
 *
 * Read off the live schema rather than the types. `stage`, `source`, `tags` and
 * `created_at` carry values on real accounts; `has:`/`no:` covers an email, a
 * phone, a booking or an open task; `in-stage:` measures `stage_entered_at`.
 *
 * `utm_source`, `utm_medium` and `utm_campaign` are deliberately absent: they
 * are null across every row, and a filter that can only ever match nothing is
 * worse than no filter at all.
 *
 * THE FILTER IS APPLIED IN SQL, and only in SQL. This module turns a string
 * into terms; the repository turns terms into a query. There is no in-memory
 * matcher, because a second reading of the same terms is a second answer, and
 * the one nothing exercises is the one that goes wrong.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { parseMoneySearch, type PeriodTerm } from '@/lib/payments/moneySearchTerms';

/** Where the contact is in the pipeline. The keys are per-account. */
export interface StageTerm {
  kind: 'stage';
  value: string;
  /** The exact characters this came from, so the field can remove it again. */
  raw: string;
}

/** How they arrived — `website_booking`, `instagram`, `in_person`. */
export interface SourceTerm {
  kind: 'source';
  value: string;
  raw: string;
}

/** One of the contact's tags, matched whole and case-insensitively. */
export interface TagTerm {
  kind: 'tag';
  value: string;
  raw: string;
}

/**
 * Something the contact either has or has not.
 *
 * `email` and `phone` are columns; `bookings` and `tasks` are the two tables
 * the list already joins, so neither costs an extra query. "A lead captured
 * with only a phone number" is a shape this product really produces, and
 * "never booked" is how an owner finds the people worth chasing.
 */
export interface HasTerm {
  kind: 'has';
  field: 'email' | 'phone' | 'bookings' | 'tasks';
  /** False for the `no:` form. */
  present: boolean;
  raw: string;
}

/**
 * How long they have sat where they are.
 *
 * Measured from `stage_entered_at`, so it answers "stuck in lead for a month"
 * — which is a different question from "added a month ago", and the one worth
 * asking.
 */
export interface InStageTerm {
  kind: 'in_stage';
  days: number;
  raw: string;
}

/** Anything not recognised: a name, an email, part of a phone number. */
export interface ContactTextTerm {
  kind: 'text';
  value: string;
  raw: string;
}

export type ContactSearchTerm =
  | StageTerm
  | SourceTerm
  | TagTerm
  | HasTerm
  | InStageTerm
  | PeriodTerm
  | ContactTextTerm;

/**
 * The prefixes, in the three languages the product speaks.
 *
 * An owner reading a Hebrew interface types Hebrew. The English forms are kept
 * in every language because they are what a URL carries and what a colleague
 * pastes into chat.
 */
const PREFIXES: Record<string, 'stage' | 'source' | 'tag'> = {
  stage: 'stage',
  source: 'source',
  tag: 'tag',
  etapa: 'stage',
  origen: 'source',
  etiqueta: 'tag',
  'שלב': 'stage',
  'מקור': 'source',
  'תגית': 'tag',
};

/** `has:` and its negative, in the three languages. */
const PRESENCE: Record<string, boolean> = {
  has: true,
  no: false,
  con: true,
  sin: false,
  'יש': true,
  'אין': false,
};

/** Only these four. An unknown one is left as text rather than guessed at. */
const PRESENCE_FIELDS: Record<string, HasTerm['field']> = {
  email: 'email',
  phone: 'phone',
  bookings: 'bookings',
  tasks: 'tasks',
  correo: 'email',
  telefono: 'phone',
  reservas: 'bookings',
  tareas: 'tasks',
  'אימייל': 'email',
  'טלפון': 'phone',
  'פגישות': 'bookings',
  'משימות': 'tasks',
};

/** `in-stage:30d`, and the same word in each language. */
const IN_STAGE = new Set(['in-stage', 'instage', 'en-etapa', 'בשלב']);

/**
 * `prefix:value`, where the value may be quoted.
 *
 * Quoting is what makes "Champion client" one tag rather than a tag and a
 * stray word — the tags on real accounts have spaces in them.
 */
const PREFIXED = /^([^\s:]+):(?:"([^"]*)"|(\S*))$/;

/** Lowercased and trimmed, which is how every comparison below is made. */
const normalise = (value: string) => value.trim().toLowerCase();

export function parseContactSearch(input: string, today: string): ContactSearchTerm[] {
  if (!input.trim()) return [];

  const terms: ContactSearchTerm[] = [];
  const leftovers: string[] = [];

  /*
   * Quoted values are lifted whole BEFORE the split, because they contain
   * spaces and everything below works on space-separated tokens.
   */
  const quoted = input.match(/[^\s:]+:"[^"]*"/g) ?? [];
  let working = input;
  for (const phrase of quoted) working = working.replace(phrase, ' ');

  for (const token of [...quoted, ...working.split(/\s+/)].filter(Boolean)) {
    const match = token.match(PREFIXED);

    if (!match) {
      leftovers.push(token);
      continue;
    }

    const prefix = normalise(match[1]);
    const value = normalise(match[2] ?? match[3] ?? '');

    /*
     * `has:` / `no:` — and an unknown field is left as TEXT. "has:budget" is
     * somebody guessing at a filter we do not have, and inventing one that
     * matches everything would be worse than searching for the words.
     */
    if (prefix in PRESENCE) {
      const presenceField = PRESENCE_FIELDS[value];
      if (presenceField) {
        terms.push({ kind: 'has', field: presenceField, present: PRESENCE[prefix], raw: token });
      } else {
        leftovers.push(token);
      }
      continue;
    }

    /* `in-stage:30d`, `in-stage:30` — days, and nothing smaller. A stage is
       something somebody sits in for weeks; an hour in it is not a question
       anybody asks. */
    if (IN_STAGE.has(prefix)) {
      const days = Number(value.replace(/d$/, ''));
      if (Number.isFinite(days) && days > 0) {
        terms.push({ kind: 'in_stage', days: Math.floor(days), raw: token });
      } else {
        leftovers.push(token);
      }
      continue;
    }

    const field = PREFIXES[prefix];

    if (!field) {
      leftovers.push(token);
      continue;
    }

    /* `stage:` with nothing after it is somebody mid-type, not a filter for
       the empty stage. Left as text, it matches nothing and says so. */
    if (!value) {
      leftovers.push(token);
      continue;
    }

    terms.push({ kind: field, value, raw: token } as ContactSearchTerm);
  }

  /*
   * Everything else, read by the orders parser — see the note above. Its
   * amounts come back as text because a bare number against a contact is a
   * phone number far more often than anything else.
   */
  for (const term of parseMoneySearch(leftovers.join(' '), today)) {
    if (term.kind === 'period') terms.push(term);
    else terms.push({ kind: 'text', value: normalise(term.raw), raw: term.raw });
  }

  return terms;
}

/** Drop one term's characters from the string, leaving the rest as typed. */
export function removeContactTerm(input: string, term: ContactSearchTerm): string {
  const at = input.indexOf(term.raw);
  if (at < 0) return input;

  const without = input.slice(0, at) + input.slice(at + term.raw.length);
  return without.replace(/\s{2,}/g, ' ').trim();
}
