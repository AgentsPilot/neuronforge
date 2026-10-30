/**
 * What a number counts, said in words the owner uses.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE FAULT THIS EXISTS TO STOP
 *
 * A live weekly verdict read, in Hebrew: "Send reminders to 29 clients who
 * missed meetings." That business has six clients in total, and two have ever
 * missed a meeting.
 *
 * The 29 was real. It was `affected_count` on an unfilled-calendar insight,
 * where it counts EMPTY HOURS IN THE WORKING WEEK. The weekly narrator was
 * handed that insight as a single line of prose — its title and its money, with
 * no statement of what the number counted — so it kept the figure and chose a
 * subject, and the subject it chose was people.
 *
 * A number with no noun attached is the whole problem. Every count the platform
 * raises is a count of SOMETHING, and that something is already recorded on the
 * row as `affected_entity_type`. This file is the one place that turns it into
 * words, so a prompt, a validator and a title cannot each invent their own.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND WHY THERE IS A LIST OF WORDS FOR PEOPLE
 *
 * Attaching a count to the people the owner serves is both the easiest mistake
 * to make and the most expensive one to read: "29 clients missed their
 * appointments" tells a therapist with six clients that her practice is
 * collapsing. So the one subject that is checked, rather than trusted, is
 * people — `mentionsPeople` below is read by `verifyPriorities` to refuse a
 * sentence that pins a non-people count onto clients.
 *
 * The lists are deliberately short and only need the words the model actually
 * reaches for. A word missing from them makes the check weaker, never wrong:
 * the other rules still require every figure to belong to the insight cited.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * `affected_entity_type` → an English plural phrase naming what is counted.
 *
 * Phrases, not single nouns, where the bare noun would not be enough on its
 * own: "slots" could be anything, "empty hours in the working week" cannot be
 * mistaken for a person or a booking.
 *
 * Every type any detector sets today has an entry here. A type with none
 * reports `null`, and a null means "we do not know what this counts" — which
 * the prompt says out loud rather than guessing (see `describeCount`).
 */
export const COUNT_NOUN: Record<string, string> = {
  contact: 'clients',
  booking: 'bookings',
  session: 'sessions',
  invoice: 'invoices',
  payment: 'payments',
  transaction: 'payments',
  payment_method: 'saved payment cards',
  proposal: 'quotes',
  service: 'services',
  page: 'pages on their site',
  task: 'tasks',
  lead_source: 'places enquiries come from',
  stripe_account: 'payment accounts',
  time_slot: 'appointment slots',
  /*
   * Hours, not meetings, and not clients.
   *
   * `OpsUtilizationLowDetector` divides unfilled hours by the number of weeks
   * measured, so this is empty hours in an average WEEK. Its own generated
   * title called them "empty meetings", which is already one step away from
   * what was counted; the verdict then took another step to "clients".
   *
   * WHICH week it is lives in `COUNT_PERIOD` rather than here, because this
   * phrase is read back twice inside one sentence and a period clause doubled
   * is a sentence nobody can follow.
   */
  open_hour: 'empty hours in their working week',
};

/**
 * WHEN a count was measured, for the figures whose period can be mistaken.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SECOND MOVE, AFTER THE SUBJECT WAS NAILED DOWN
 *
 * `COUNT_NOUN` stopped "29 empty hours" becoming "29 clients". It said nothing
 * about when, and the next live note read "you have 29 empty hours IN THE
 * COMING WEEK": the right number, the right noun, and a week that had not
 * happened yet. Nothing measured it, nothing could check it, and it is the kind
 * of sentence an owner plans a day around.
 *
 * Only the counts whose period is genuinely ambiguous need an entry. A count of
 * unpaid invoices is a count of things that exist right now and reads that way
 * on its own; an average across four past weeks does not.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const COUNT_PERIOD: Record<string, string> = {
  open_hour:
    'This was measured across the last 28 days and is an average of weeks that have ALREADY HAPPENED. Never write it as a forecast, and never attach it to a week that has not happened.',
};

/** The words naming what a count counts, or `null` when nothing recorded it. */
export function countNoun(entityType?: string | null): string | null {
  if (!entityType) return null;

  return COUNT_NOUN[entityType] ?? null;
}

/** True when the count really is a count of people. */
export function isPeopleCount(entityType?: string | null): boolean {
  return entityType === 'contact';
}

/**
 * One line a prompt can put beside a figure, naming what it counts and what it
 * does not.
 *
 * The negative half is load-bearing. "These are empty hours" on its own is a
 * fact the model may still paraphrase into people; naming the two subjects it
 * must not use closes the move it actually made.
 */
export function describeCount(count: number, entityType?: string | null): string {
  const noun = countNoun(entityType);

  if (!noun) {
    return `${count} (WHAT THIS COUNTS WAS NOT RECORDED — do not put this number in a sentence)`;
  }

  /* Appended once, after the subject is settled. See `COUNT_PERIOD`. */
  const period = entityType ? COUNT_PERIOD[entityType] : undefined;
  const when = period ? ` ${period}` : '';

  if (isPeopleCount(entityType)) return `${count} ${noun}${when}`;

  return `${count} ${noun} (this number counts ${noun}, NOT clients and NOT bookings).${when}`;
}

/**
 * The words that mean "the people I serve", per output language.
 *
 * Includes the vertical words the platform's own terminology maps hand the
 * model — patients, students, members — because those are exactly what it will
 * write when told to use the owner's vocabulary.
 */
const PEOPLE_WORDS: Record<string, string[]> = {
  en: [
    'client', 'clients', 'customer', 'customers', 'patient', 'patients',
    'student', 'students', 'member', 'members', 'people', 'person',
    'enquirer', 'enquirers', 'lead', 'leads',
  ],
  /*
   * SHORT WORDS LEFT OUT ON PURPOSE.
   *
   * Hebrew is matched by substring (see `mentionsPeople`), and the obvious
   * additions are prefixes of unrelated words: `איש` sits inside `אישור`
   * (confirmation), `אדם` inside `אדמה`, `חבר` inside `חברה` (company) and
   * `להתחבר` (to connect). Any of them would drop a perfectly good line like
   * "send a confirmation" for talking about people it never mentioned.
   *
   * A missing word only weakens this one check; a false match destroys a
   * usable sentence. So the list holds the unambiguous words only.
   */
  he: [
    'לקוח', 'לקוחות', 'לקוחה', 'מטופל', 'מטופלים', 'מטופלת',
    'תלמיד', 'תלמידים', 'חברים', 'אנשים',
    'פונה', 'פונים', 'מתעניין', 'מתעניינים',
  ],
  es: [
    'cliente', 'clientes', 'paciente', 'pacientes', 'alumno', 'alumnos',
    'miembro', 'miembros', 'personas', 'persona', 'interesado', 'interesados',
  ],
};

/**
 * Does this sentence talk about people?
 *
 * Word-boundary matched in Latin scripts so "person" is not found inside
 * another word. Hebrew has no case and its words are not reliably separated by
 * the boundaries a Latin regex knows, so it is a plain substring test there:
 * `לקוח` is a prefix of `לקוחות` and both are hits, which is the behaviour
 * wanted.
 */
export function mentionsPeople(text: string, language: string): boolean {
  const words = PEOPLE_WORDS[language] ?? PEOPLE_WORDS.en;
  const haystack = text.toLocaleLowerCase();

  return words.some(word =>
    /^[a-z]+$/.test(word)
      ? new RegExp(`\\b${word}\\b`).test(haystack)
      : haystack.includes(word)
  );
}
