/**
 * Turns BriefingFacts into the sentences the owner reads.
 *
 * The model's ONLY job is phrasing. Every number, name and time it is allowed
 * to use is in the facts object it receives; it is never asked to count, total,
 * compare or infer. A briefing that invents "John owes $250" would poison trust
 * in every other figure on the dashboard, so the prompt forbids new facts and
 * `findUnsupportedFigures` checks the output before it ships.
 *
 * When the provider is unavailable the deterministic composer runs instead. It
 * produces plainer prose from the same facts, so an outage degrades the writing
 * rather than emptying the card.
 */

import { ProviderFactory } from '@/lib/ai/providerFactory';
import { OPENAI_MODELS } from '@/lib/ai/providers/openaiProvider';
import { createLogger } from '@/lib/logger';
import type { BriefingFacts } from './BriefingFactsService';

const logger = createLogger({ service: 'BriefingNarrator' });

export type BriefingSource = 'llm' | 'fallback';

export interface Narration {
  narrative: string;
  source: BriefingSource;
}

export type BriefingLanguage = 'en' | 'es' | 'he';

/**
 * What kind of business this is, as far as anything knows.
 *
 * Both fields are optional and often absent: `vertical` is 'other' for anything
 * the onboarding chat could not place, and a business name is frequently just a
 * person's name. The prompt is written to degrade on either — see
 * `describeBusiness`.
 */
export interface BusinessType {
  /** `business_profiles.vertical`, e.g. 'trainer'. */
  vertical?: string | null;
  /** `business_profiles.sub_vertical`, e.g. 'personal_training'. */
  subVertical?: string | null;
  /** The trading name, which sometimes says more than the vertical does. */
  name?: string | null;
}

/**
 * The business, in one clause the model can reason from.
 *
 * Machine keys are handed over as-is rather than translated: 'nail_tech' is
 * perfectly legible to a model and needs no table of ours to become so. The
 * name is included because it often carries the trade when the vertical does
 * not — "Studio Pilates" places a business that stored 'other'.
 */
function describeBusiness(type: BusinessType): string {
  const parts: string[] = [];

  // 'other' is the chat's way of saying it could not tell, so it is worth no
  // more to the model than an absent field — and stating it invites the model
  // to treat "other" as the trade itself.
  if (type.vertical && type.vertical !== 'other') parts.push(type.vertical.replace(/_/g, ' '));
  if (type.subVertical) parts.push(`specifically ${type.subVertical.replace(/_/g, ' ')}`);
  if (type.name) parts.push(`trading as "${type.name}"`);

  return parts.length > 0 ? `a business of this kind: ${parts.join(', ')}` : 'a small service business';
}

const LANGUAGE_NAMES: Record<BriefingLanguage, string> = {
  en: 'English',
  es: 'Spanish',
  he: 'Hebrew',
};

/**
 * Compose the briefing.
 *
 * Never throws: this renders a dashboard card, and a card that can take the
 * page down with it is worse than a plain one.
 */
export async function narrateBriefing(
  facts: BriefingFacts,
  language: BriefingLanguage = 'en',
  userId?: string,
  businessType: BusinessType = {}
): Promise<Narration> {
  if (facts.isQuiet) {
    // Nothing to phrase. Spending a model call to say "nothing today" is the
    // one case where the templates are strictly better.
    return { narrative: composeFallback(facts, language), source: 'fallback' };
  }

  try {
    const provider = ProviderFactory.getProvider('openai');

    /*
     * `chatCompletion`, not `complete`. The provider takes an analytics
     * CallContext as a second argument and returns an OpenAI ChatCompletion,
     * so token spend on this feature is attributable.
     *
     * Worth knowing: app/api/business-os/story/route.ts calls
     * `provider.complete({...})`, which does not exist on this class. That call
     * throws every time and the route has been serving its hardcoded fallback
     * copy since it was written.
     */
    const completion = await provider.chatCompletion(
      {
        model: OPENAI_MODELS.GPT_4O_MINI,
        messages: [{ role: 'user', content: buildPrompt(facts, language, businessType) }],
        // Low, deliberately. This is reporting, not writing — the same facts
        // should read the same way twice.
        temperature: 0.3,
        max_tokens: 320,
      },
      {
        userId: userId ?? 'unknown',
        feature: 'business-os',
        component: 'daily-briefing',
        activity_type: 'narration',
      }
    );

    const narrative = cleanNarrative(completion.choices[0]?.message?.content ?? '');
    if (!narrative) throw new Error('Empty narration');

    const untranslated = findUntranslatedWords(narrative, facts, language);
    if (untranslated.length > 0) {
      logger.warn(
        { untranslated, language, date: facts.day.date },
        'Briefing leaked untranslated words; using the deterministic composer'
      );
      return { narrative: composeFallback(facts, language), source: 'fallback' };
    }

    const unsupported = findUnsupportedFigures(narrative, facts);
    if (unsupported.length > 0) {
      // Not a tuning problem. A number in the prose that is not in the facts
      // is fabricated, and the plain version is the honest one.
      logger.warn(
        { unsupported, date: facts.day.date },
        'Briefing contained figures absent from the facts; using the deterministic composer'
      );
      return { narrative: composeFallback(facts, language), source: 'fallback' };
    }

    return { narrative, source: 'llm' };
  } catch (error) {
    logger.warn({ err: error, date: facts.day.date }, 'Narration failed; using the deterministic composer');
    return { narrative: composeFallback(facts, language), source: 'fallback' };
  }
}

/* ------------------------------------------------------------------ prompt */

/**
 * Bump this whenever the prompt below changes the words it produces.
 *
 * The briefing is cached per business day against a hash of the FACTS, so a
 * change to the instructions is invisible to that hash: the wording changes,
 * the fingerprint does not, and everyone who already has a cached briefing
 * keeps the old phrasing until tomorrow. The fix for the ordering rule was
 * itself unobservable for exactly this reason.
 *
 * It costs one re-narration per user on the day it changes, which is the same
 * price as any other fact moving.
 */
export const PROMPT_VERSION = 3;

function buildPrompt(
  facts: BriefingFacts,
  language: BriefingLanguage,
  businessType: BusinessType
): string {
  const target = LANGUAGE_NAMES[language];

  return [
    `You write a short morning briefing for the owner of a small business.`,
    '',
    `LANGUAGE: write the entire briefing in ${target}. This is not optional.`,
    `The data below is labelled in English; that is only how it is stored.`,
    `Your output must be ${target} prose, whatever language the field names or the values are in.`,
    '',
    'RULES — these are absolute:',
    '1. Use ONLY the values in the JSON below. Never introduce a number, name, time or amount that is not there.',
    '2. Never calculate, total, compare or estimate anything. If a total is not given, do not state one.',
    '3. Write names EXACTLY as they appear, in their original script. Never transliterate or translate a name.',
    '4. Times are already in the business\'s own timezone. Use them verbatim.',
    '5. Say only what is present. Never state that something is absent, empty, zero or "none" —',
    '   a field that is missing simply goes unmentioned.',
    '6. Write every count as its number. "2 clients are ready", never "clients are ready".',
    '7. The JSON field names are English labels for the data. NEVER copy a field name into',
    '   your sentence — every word you write must be in the target language.',
    '',
    'WHAT THE FIELDS MEAN — read these before writing:',
    '- receivedToday: money that ARRIVED today. Good news — report it as money in,',
    '  never as something owed or outstanding. Do not confuse it with payments below.',
    '- payments: money someone STILL OWES the business. It has NOT been paid.',
    '  Never describe it as paid, received, settled or collected. The owner needs to chase it.',
    '- awaitingIntake: these people have NOT returned their intake form yet.',
    '- awaitingPayment: these people have an appointment today they have NOT paid for,',
    '  where payment was due before the appointment. Not the same as an unpaid invoice.',
    '- cancelled: appointments that were cancelled, freeing that slot.',
    '- allReady: every appointment today is ready; nothing is outstanding on them.',
    '- completed: appointments that have ALREADY HAPPENED. Say so as a fact about the',
    '  day — never as something outstanding, and never as a reason to chase anyone.',
    '- newLeads: people who got in touch for the first time today. `count` is how',
    '  many there were; `people` are the ones you may name, with `note` being what',
    '  they asked about. Name them where you can — it is the point of the line.',
    '  NEVER invent a name, and never name anyone who is not in `people`; where',
    '  `count` exceeds the list, account for the rest as a number.',
    '- quotesWaiting: people owed a price — either nobody has written the quote',
    '  or it was written and never sent. The owner is the blocker; say so plainly.',
    '- quotesOut: quotes already sent that the client has not answered in three',
    '  days or more. The owner has done their part — report it, never imply a',
    '  chore. Do not confuse this with quotesWaiting; they are opposites.',
    '- quotesWaitingValue / quotesOutValue: what those quotes are worth in total.',
    '  Say the amount with the count when it is given — it is what tells the owner',
    '  which line to start with. Copy the string exactly; never re-derive it.',
    '',
    /*
     * Vocabulary is the model's job, not a lookup table's.
     *
     * A trainer has trainees, a clinic has patients, a tutor has students, a
     * salon has clients — and the list does not end, which is exactly why it is
     * not a list. Mapping every vertical to a noun in every language is a table
     * someone has to extend for each new business type and each new language,
     * and it is still wrong for every business whose vertical is stored as
     * "other". The model already knows what a barber calls the people in the
     * chair; it only needs telling what kind of business this is.
     */
    'WHO THIS BUSINESS SERVES:',
    `This is ${describeBusiness(businessType)}.`,
    'Use the words THIS owner would use for the people they serve — a personal',
    'trainer says trainees, a clinic says patients, a tutor says students, a salon',
    'says clients. Choose the natural word for this business and this language.',
    'Never use CRM vocabulary: not "contacts", not "leads", not "records", not',
    '"entries". Those are the database\'s words, never the owner\'s.',
    'If you cannot tell what kind of business it is, say "clients" in the target language.',
    '',
    'FORMAT: a list, one fact per line, separated by newlines.',
    'Each line is a single short sentence — under about ten words — that stands on its own.',
    'No bullet characters, no numbering, no headings, no greeting, no sign-off, no blank lines.',
    'At most six lines, fewer when there is less to say.',
    '',
    /*
     * The order is fixed here because it was previously fixed nowhere.
     *
     * `composeFallback` has always assembled these lines in a deliberate
     * sequence, but the model was given no ordering rule at all — so the two
     * paths told the same day differently, and the model's own choice moved
     * between runs. A day whose takings led with the money read as a receipt
     * rather than a briefing; the owner opens this to find out what the day
     * holds, and the day's shape has to come first.
     *
     * This list mirrors the fallback step for step. Change one and change the
     * other, or the card starts depending on whether the model was reachable.
     */
    'ORDER: report the facts in this sequence, skipping anything absent.',
    '1. How many appointments there are today.',
    '2. How many of them are already completed.',
    '3. How many are ready.',
    '4. Anyone who has not returned an intake form.',
    '5. Anyone who has not paid for today\'s appointment.',
    '6. Money that came in today.',
    '7. Money still owed.',
    '8. Cancellations.',
    '9. Which appointment is first, and when.',
    '10. What is coming next: new enquiries, quotes, the next appointment.',
    'The day comes before the money. Never open with an amount when there are',
    'appointments to report — takings are the result of the day, not its headline.',
    'The lines above name what to cover in what order. They are not phrasings to',
    'copy — write each fact in your own natural sentence.',
    '',
    'Example of the shape (not the content):',
    'You have 6 appointments today.',
    '5 clients are ready.',
    'Sarah hasn\'t completed intake.',
    'Your first is Michael at 09:00.',
    '',
    'STYLE: a trusted assistant speaking to the owner. Address them directly.',
    'Grammar matters: match gender and number agreement correctly in the target language',
    '(in Hebrew, "פגישה" is feminine — two appointments is "שתי פגישות", not "שני").',
    '',
    'FACTS:',
    JSON.stringify(toPromptShape(facts), null, 2),
    '',
    `Reminder: the briefing must be written in ${target}.`,
  ].join('\n');
}

/**
 * The facts, trimmed to what the model may say.
 *
 * Two things happen here. Internal plumbing — the UTC window, the quiet flag,
 * the currency bookkeeping — is dropped so it cannot leak into the prose as a
 * stray number. And empty collections are omitted entirely rather than sent as
 * `[]`: given an empty array the model dutifully reports it, producing
 * "There are no cancellations. There are no outstanding payments." An absent
 * key has nothing to narrate.
 */
function toPromptShape(facts: BriefingFacts) {
  const { appointments, money } = facts;

  const shape: Record<string, unknown> = {
    date: facts.day.date,
    appointments: {
      total: appointments.total,
      /*
       * Readiness is a flag when it is universal and a count only when it is
       * partial.
       *
       * Sending `ready: 2` beside `total: 2` produced "clients are ready" with
       * the number silently dropped, in all three languages — having just
       * written "2 appointments", the model treats a second 2 as redundant and
       * omits it, which reads as a rendering fault. `allReady` gives it a fact
       * with no number to repeat; a partial count is genuinely new information
       * and keeps its digit.
       */
      ...(appointments.completed > 0 && { completed: appointments.completed }),
      ...(appointments.total > 0 && appointments.ready === appointments.total
        ? { allReady: true }
        : appointments.ready > 0 && { ready: appointments.ready }),
      ...(appointments.awaitingIntake.length > 0 && {
        awaitingIntake: appointments.awaitingIntake.map(p => ({ name: p.name, time: p.timeLocal })),
      }),
      ...(appointments.awaitingPayment.length > 0 && {
        awaitingPayment: appointments.awaitingPayment.map(p => ({ name: p.name, time: p.timeLocal })),
      }),
      ...(appointments.first && {
        first: {
          name: appointments.first.name,
          time: appointments.first.timeLocal,
          service: appointments.first.serviceName,
          ownerNote: appointments.first.note,
        },
      }),
      ...(appointments.cancelled.length > 0 && {
        cancelled: appointments.cancelled.map(c => ({
          name: c.name,
          time: c.timeLocal,
          reason: c.reason,
        })),
      }),
    },
  };

  if (money.receivedToday > 0) {
    // Pre-formatted, like the owed amounts: handing over a number and a
    // currency code produced "500 USD" where a reader expects "$500".
    shape.receivedToday = formatMoney(money.receivedToday, money.currency);
    shape.receivedCount = money.receivedCount;
  }

  if (money.owed.length > 0) {
    /*
     * `overdue` is present only when true.
     *
     * Sent as `false` the model reports it — "The payment is not overdue." —
     * which is the same failure as sending an empty array: a field with a
     * falsy value is still a fact to state. Nothing absent can be narrated.
     */
    shape.payments = money.owed.slice(0, 5).map(o => ({
      name: o.name,
      // Pre-formatted, so the model copies a string rather than composing one
      // from a number and a currency code — which produced "200 USD" where a
      // reader expects "$200".
      amount: formatMoney(o.amount, o.currency),
      ...(o.overdue && { overdue: true }),
    }));
  }

  /*
   * New leads, when there are any.
   *
   * The other half of `outlook` — the next appointment — is deliberately NOT
   * sent. It only exists on a day with no appointments, and such a day never
   * reaches this function: `isQuiet` short-circuits to the templates before a
   * model is called. Sending a key that can only ever be absent here would be
   * dead weight in the prompt.
   */
  if (facts.outlook.newLeads.count > 0) {
    /*
     * The names go to the model as FACTS, not as something to infer.
     *
     * `findUnsupportedFigures` catches an invented number; nothing catches an
     * invented name, so the model must never be in a position to need one. It
     * gets exactly the people it is allowed to mention, and the count.
     */
    shape.newLeads = {
      count: facts.outlook.newLeads.count,
      people: facts.outlook.newLeads.people,
    };
  }

  if (facts.outlook.quotesWaiting.count > 0) {
    shape.quotesWaiting = facts.outlook.quotesWaiting.count;
    /*
     * Sent pre-formatted, as a string, for the same reason the owed amounts
     * are: handing over a bare number and a currency code produced "200 USD"
     * where a reader expects "$200". It also registers the figure as allowed,
     * so the guardrail does not mistake the owner's own money for invention.
     */
    if (facts.outlook.quotesWaiting.value && facts.outlook.quotesWaiting.currency) {
      shape.quotesWaitingValue = formatMoney(
        facts.outlook.quotesWaiting.value,
        facts.outlook.quotesWaiting.currency
      );
    }
  }

  if (facts.outlook.quotesOut.count > 0) {
    shape.quotesOut = facts.outlook.quotesOut.count;
    if (facts.outlook.quotesOut.value && facts.outlook.quotesOut.currency) {
      shape.quotesOutValue = formatMoney(
        facts.outlook.quotesOut.value,
        facts.outlook.quotesOut.currency
      );
    }
  }

  return shape;
}

/* ---------------------------------------------------------------- guardrail */

/**
 * Numbers in the prose that appear nowhere in the facts.
 *
 * Deliberately narrow: it flags digits, not names, because a name is checked by
 * being copied and a number is the thing a model is most likely to invent —
 * a plausible total, a rounded sum, a count it derived. Times and amounts from
 * the facts are all registered as allowed strings first.
 */
export function findUnsupportedFigures(narrative: string, facts: BriefingFacts): string[] {
  const allowed = new Set<string>();

  const permit = (value: unknown) => {
    if (value === undefined || value === null) return;
    const text = String(value);
    allowed.add(text);
    // '09:00' also licenses '09' and '00'; '1250.5' licenses '1250'.
    for (const part of text.split(/[^0-9]+/)) if (part) allowed.add(String(Number(part)));

    /*
     * Money reaches the model already formatted — '$1,250.50' rather than
     * 1250.5 — so the amount in the prose is a copy of that string. Splitting
     * it on non-digits yields '1', '250', '50' and never the figure actually
     * written, which flagged a faithful briefing as fabricated. Strip the
     * decoration instead and permit what is left.
     */
    const bare = text.replace(/[^0-9.]/g, '');
    if (bare) allowed.add(bare);

    const numeric = Number(bare || text);
    if (Number.isFinite(numeric)) {
      allowed.add(String(numeric));
      allowed.add(String(Math.round(numeric)));
      allowed.add(numeric.toFixed(2));
    }
  };

  /*
   * Walk everything the model was shown, strings included.
   *
   * Permitting only the numeric fields was too strict: a service named
   * "בדיקה 1" or a client called "Studio 54" puts a digit into the prose that
   * the model copied faithfully, and flagging it sent a correct briefing to the
   * fallback. Anything present in the prompt is fair game; only figures that
   * appear nowhere in it are fabricated.
   */
  const walk = (value: unknown) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) return value.forEach(walk);
    if (typeof value === 'object') return Object.values(value as object).forEach(walk);
    permit(value);
  };

  walk(toPromptShape(facts));

  const { appointments } = facts;
  // Counts the model may state that are not themselves fields in the payload.
  permit(appointments.awaitingIntake.length);
  permit(appointments.cancelled.length);
  // The date the briefing is about, in every shape it might be written.
  for (const part of facts.day.date.split('-')) permit(Number(part));

  /*
   * One token per written number, thousands separators and decimals included.
   *
   * A naive /\d+([.,]\d+)?/ tears "$1,250.50" into "1,250" and "50", and the
   * orphaned "50" then looks like a figure nobody supplied — a false alarm that
   * sends a correct briefing to the fallback.
   */
  const figures = narrative.match(/\d+(?:,\d{3})*(?:\.\d+)?/g) ?? [];

  return figures
    .map(figure => figure.replace(/,/g, ''))
    .filter(figure => {
      if (allowed.has(figure)) return false;
      const numeric = Number(figure);
      return !(Number.isFinite(numeric) && allowed.has(String(numeric)));
    });
}

/**
 * Latin words in a Hebrew briefing that came from nowhere in the facts.
 *
 * Rule 7 tells the model not to reuse the English field names, and it does it
 * anyway — "יש לך תשלום outstanding" survived both a renamed key and an
 * explicit instruction. Hebrew is a different script, so the leak is
 * mechanically detectable in a way it is not for Spanish, and a briefing with
 * an English word wedged into it is worse than the plainer deterministic one.
 *
 * Names are exempt because they are supposed to be verbatim: a client called
 * "Studio 54" must survive untouched in a Hebrew sentence.
 */
export function findUntranslatedWords(
  narrative: string,
  facts: BriefingFacts,
  language: BriefingLanguage
): string[] {
  if (language !== 'he') return [];

  const allowed = new Set<string>();
  const permitWords = (value: unknown) => {
    if (typeof value !== 'string') return;
    for (const word of value.match(/[A-Za-z]{2,}/g) ?? []) allowed.add(word.toLowerCase());
  };

  const { appointments, money } = facts;
  for (const person of [...appointments.awaitingIntake, ...appointments.cancelled]) {
    permitWords(person.name);
  }
  permitWords(appointments.first?.name);
  permitWords(appointments.first?.serviceName);
  permitWords(appointments.first?.note);
  for (const entry of money.owed) {
    permitWords(entry.name);
    permitWords(entry.currency);
  }

  return (narrative.match(/[A-Za-z]{2,}/g) ?? []).filter(
    word => !allowed.has(word.toLowerCase())
  );
}

/* ----------------------------------------------------------------- fallback */

/**
 * The same facts, composed without a model.
 *
 * Kept deliberately flat — this is the outage path, and prose assembled from
 * templates reads worse the harder it tries.
 */
export function composeFallback(facts: BriefingFacts, language: BriefingLanguage): string {
  const phrase = FALLBACK[language] ?? FALLBACK.en;
  const { appointments, money } = facts;
  const lines: string[] = [];

  if (appointments.total > 0) {
    lines.push(phrase.appointments(appointments.total));

    /*
     * Finished sessions are reported, not hidden. The owner asked for the
     * day's work to show as done rather than vanish from the count — a card
     * that silently shrinks through the afternoon reads as data going missing.
     */
    if (appointments.completed > 0) {
      lines.push(phrase.completed(appointments.completed, appointments.total));
    }
    if (appointments.ready > 0 && appointments.ready === appointments.total) {
      lines.push(phrase.allReady(appointments.ready));
    } else if (appointments.ready > 0) {
      lines.push(phrase.someReady(appointments.ready));
    }
  }

  for (const person of appointments.awaitingIntake.slice(0, 3)) {
    lines.push(phrase.awaitingIntake(person.name));
  }

  for (const person of appointments.awaitingPayment.slice(0, 3)) {
    lines.push(phrase.awaitingPayment(person.name));
  }

  /*
   * What came in, before what is owed.
   *
   * The card could only ever report debts — `owed` was its whole money
   * vocabulary — so a day on which £500 arrived and nothing was outstanding had
   * nothing to say about money at all. The figure an owner most wants at the
   * end of a day was the one the briefing could not produce.
   */
  if (money.receivedToday > 0) {
    lines.push(
      phrase.receivedToday(
        formatMoney(money.receivedToday, money.currency),
        money.receivedCount
      )
    );
  }

  for (const entry of money.owed.slice(0, 3)) {
    lines.push(phrase.owes(entry.name, formatAmount(entry.amount, entry.currency)));
  }

  for (const cancellation of appointments.cancelled.slice(0, 2)) {
    lines.push(cancellation.timeLocal ? phrase.cancelledAt(cancellation.timeLocal) : phrase.cancelled());
  }

  if (appointments.first) {
    lines.push(phrase.first(appointments.first.name, appointments.first.timeLocal));
  }

  /*
   * The quiet line leads, and the outlook follows it.
   *
   * Checked here rather than at the end, because the outlook lines below are
   * not today: a day whose only content is next Wednesday's appointment still
   * needs to say that today itself held nothing, or the card reads as though
   * Wednesday were today.
   */
  if (lines.length === 0) lines.push(phrase.quiet());

  const { outlook } = facts;

  if (outlook.next) {
    lines.push(
      phrase.next(outlook.next.name, formatDay(outlook.next.dateLocal, language), outlook.next.timeLocal)
    );
  }

  if (outlook.newLeads.count > 0) {
    lines.push(phrase.newLeads(outlook.newLeads.count, outlook.newLeads.people));
  }

  if (outlook.quotesWaiting.count > 0) {
    lines.push(
      phrase.quotesWaiting(
        outlook.quotesWaiting.count,
        outlook.quotesWaiting.value && outlook.quotesWaiting.currency
          ? formatMoney(outlook.quotesWaiting.value, outlook.quotesWaiting.currency)
          : undefined
      )
    );
  }

  if (outlook.quotesOut.count > 0) {
    lines.push(phrase.quotesOut(outlook.quotesOut.count));
  }

  // Newline-separated, matching the model's contract: the card renders these
  // as a list, one fact per row.
  return lines.join('\n');
}

const DAY_LOCALES: Record<BriefingLanguage, string> = {
  en: 'en-GB',
  es: 'es-ES',
  he: 'he-IL',
};

/**
 * A date the owner can act on, in their own language.
 *
 * Weekday AND date, not one or the other. "Wednesday" alone is ambiguous the
 * moment the next appointment is more than a week out, and a bare date makes
 * the reader count days to work out whether it is soon. Formatted here rather
 * than in the facts service because it is the only part of the briefing whose
 * wording depends on the reader — the facts layer deals in ISO strings.
 */
function formatDay(dateLocal: string, language: BriefingLanguage): string {
  // Noon, so the label cannot slip a day when the runtime reads a bare date as
  // UTC midnight and the reader sits west of it.
  const parsed = new Date(`${dateLocal}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return dateLocal;

  try {
    return new Intl.DateTimeFormat(DAY_LOCALES[language] ?? 'en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    }).format(parsed);
  } catch {
    return dateLocal;
  }
}

/** Split a narration into the lines the card renders. */
export function briefingLines(narrative: string): string[] {
  return narrative
    .split('\n')
    .map(line => line.replace(/^\s*[-•*\d.]+\s*/, '').trim())
    .filter(Boolean);
}

/** Shared by the prompt and the fallback so both render money identically. */
export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
    }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

function formatAmount(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
    }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

interface FallbackPhrases {
  appointments: (n: number) => string;
  /** `n` of `total` have already happened. */
  completed: (n: number, total: number) => string;
  allReady: (n: number) => string;
  someReady: (n: number) => string;
  awaitingIntake: (name: string) => string;
  /** Coming today and hasn't paid, where payment was due before the appointment. */
  awaitingPayment: (name: string) => string;
  /** `money` is already formatted; `n` is how many payments made it up. */
  receivedToday: (money: string, n: number) => string;
  owes: (name: string, amount: string) => string;
  cancelledAt: (time: string) => string;
  cancelled: () => string;
  first: (name: string, time: string) => string;
  quiet: () => string;
  /** The next appointment beyond today. `day` arrives already localised. */
  next: (name: string, day: string, time: string) => string;
  /**
   * Who got in touch, by name where we have them.
   *
   * Takes both: a business with more new people than the briefing prints names
   * for gets the names it can show and the true total.
   */
  newLeads: (n: number, people: Array<{ name: string; note?: string }>) => string;
  /** People owed a price — unwritten or written and unsent. The owner's move. */
  /** `money` is the group's total, already formatted; absent on mixed currencies. */
  quotesWaiting: (n: number, money?: string) => string;
  /** Quotes out with the client and unanswered. Reported, never a chore. */
  quotesOut: (n: number) => string;
}

/**
 * "A", "A and B", "A, B and C" — and "A, B and 4 others" once the list is
 * longer than the names we hold.
 *
 * The conjunction is the only part that differs between the three languages,
 * so it is a parameter rather than three copies of the same joining logic.
 */
function joinNames(
  people: Array<{ name: string }>,
  total: number,
  conjunction: string,
  others: (n: number) => string
): string {
  const names = people.map(p => p.name).filter(Boolean);
  if (names.length === 0) return '';

  const hidden = total - names.length;
  const parts = hidden > 0 ? [...names, others(hidden)] : names;

  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} ${conjunction} ${parts[parts.length - 1]}`;
}

/*
 * Hebrew and Spanish branch on 1 vs many because counts are the entire content
 * here — "1 פגישות" is the kind of error that makes the whole card look
 * machine-made.
 */
const FALLBACK: Record<BriefingLanguage, FallbackPhrases> = {
  en: {
    appointments: n => (n === 1 ? 'You have one appointment today.' : `You have ${n} appointments today.`),
    completed: (n, total) => (n === total ? 'All of them are done.' : `${n} of them are already done.`),
    allReady: n => (n === 1 ? 'They are ready.' : `All ${n} are ready.`),
    someReady: n => (n === 1 ? 'One client is ready.' : `${n} clients are ready.`),
    awaitingIntake: name => `${name} hasn't completed intake.`,
    awaitingPayment: name => `${name} hasn't paid yet.`,
    owes: (name, amount) => `${name} still owes ${amount}.`,
    receivedToday: (money, n) => (n === 1 ? `${money} came in today.` : `${money} came in today, across ${n} payments.`),
    cancelledAt: time => `Your ${time} appointment was cancelled, leaving an opening.`,
    cancelled: () => 'An appointment was cancelled, leaving an opening.',
    first: (name, time) => `Your first appointment is ${name} at ${time}.`,
    quiet: () => 'No activity we could see for today.',
    next: (name, day, time) => `Your next is ${name}, ${day} at ${time}.`,
    newLeads: (n, people) => {
      const named = joinNames(people, n, 'and', k => `${k} more`);
      if (!named) {
        return n === 1 ? 'Someone new got in touch today.' : `${n} new people got in touch today.`;
      }
      // One person who said what they wanted gets their words; a list does not,
      // because three notes in one line is no longer a summary.
      const note = people.length === 1 && people[0].note ? ` — ${people[0].note}` : '';
      return `${named} got in touch today${note}.`;
    },
    quotesWaiting: (n, money) =>
      (n === 1 ? 'Someone is waiting on a price from you' : `${n} people are waiting on a price from you`) +
      (money ? ` — ${money}.` : '.'),
    quotesOut: n =>
      n === 1 ? 'One quote is out and still unanswered.' : `${n} quotes are out and still unanswered.`,
  },
  es: {
    appointments: n => (n === 1 ? 'Tienes una cita hoy.' : `Tienes ${n} citas hoy.`),
    completed: (n, total) => (n === total ? 'Todas ya están hechas.' : `${n} de ellas ya están hechas.`),
    allReady: n => (n === 1 ? 'Está listo.' : `Los ${n} están listos.`),
    someReady: n => (n === 1 ? 'Un cliente está listo.' : `${n} clientes están listos.`),
    awaitingIntake: name => `${name} no ha completado el formulario.`,
    awaitingPayment: name => `${name} todavía no ha pagado.`,
    owes: (name, amount) => `${name} todavía debe ${amount}.`,
    receivedToday: (money, n) => (n === 1 ? `Entraron ${money} hoy.` : `Entraron ${money} hoy, en ${n} pagos.`),
    cancelledAt: time => `Tu cita de las ${time} se canceló y dejó un hueco libre.`,
    cancelled: () => 'Se canceló una cita y dejó un hueco libre.',
    first: (name, time) => `Tu primera cita es ${name} a las ${time}.`,
    quiet: () => 'No detectamos actividad para hoy.',
    next: (name, day, time) => `Tu próxima es ${name}, el ${day} a las ${time}.`,
    newLeads: (n, people) => {
      const named = joinNames(people, n, 'y', k => `${k} más`);
      if (!named) {
        return n === 1 ? 'Alguien nuevo te contactó hoy.' : `${n} personas nuevas te contactaron hoy.`;
      }
      const note = people.length === 1 && people[0].note ? ` — ${people[0].note}` : '';
      return `${named} te ${n === 1 ? 'contactó' : 'contactaron'} hoy${note}.`;
    },
    quotesWaiting: (n, money) =>
      (n === 1 ? 'Alguien espera un precio tuyo' : `${n} personas esperan un precio tuyo`) +
      (money ? ` — ${money}.` : '.'),
    quotesOut: n =>
      n === 1 ? 'Un presupuesto sigue sin respuesta.' : `${n} presupuestos siguen sin respuesta.`,
  },
  he: {
    appointments: n => (n === 1 ? 'יש לך פגישה אחת היום.' : `יש לך ${n} פגישות היום.`),
    completed: (n, total) => (n === total ? 'כולן כבר הסתיימו.' : `${n} מהן כבר הסתיימו.`),
    allReady: n => (n === 1 ? 'הוא מוכן.' : `כל ${n} מוכנים.`),
    someReady: n => (n === 1 ? 'לקוח אחד מוכן.' : `${n} לקוחות מוכנים.`),
    awaitingIntake: name => `${name} לא השלים את הטופס.`,
    awaitingPayment: name => `${name} עדיין לא שילם.`,
    owes: (name, amount) => `${name} עדיין חייב ${amount}.`,
    receivedToday: (money, n) => (n === 1 ? `${money} נכנסו היום.` : `${money} נכנסו היום, ב-${n} תשלומים.`),
    cancelledAt: time => `הפגישה שלך ב-${time} בוטלה ונפתח חלון פנוי.`,
    cancelled: () => 'פגישה בוטלה ונפתח חלון פנוי.',
    first: (name, time) => `הפגישה הראשונה שלך היא ${name} בשעה ${time}.`,
    quiet: () => 'לא זיהינו פעילות להיום.',
    next: (name, day, time) => `הפגישה הבאה שלך היא ${name}, ב${day} בשעה ${time}.`,
    newLeads: (n, people) => {
      const named = joinNames(people, n, 'ו-', k => `עוד ${k}`);
      if (!named) {
        return n === 1 ? 'מישהו חדש פנה אליך היום.' : `${n} אנשים חדשים פנו אליך היום.`;
      }
      const note = people.length === 1 && people[0].note ? ` — ${people[0].note}` : '';
      return `${named} ${n === 1 ? 'פנה/תה' : 'פנו'} אליך היום${note}.`;
    },
    quotesWaiting: (n, money) =>
      (n === 1 ? 'מישהו מחכה לך להצעת מחיר' : `${n} אנשים מחכים לך להצעת מחיר`) +
      (money ? ` — ${money}.` : '.'),
    quotesOut: n =>
      n === 1 ? 'הצעת מחיר אחת נשלחה ועדיין ללא מענה.' : `${n} הצעות מחיר נשלחו ועדיין ללא מענה.`,
  },
};

/** Strip anything the model wrapped around the prose. */
function cleanNarrative(content: string): string {
  return content
    .replace(/^```[a-z]*\n?/i, '')
    .replace(/```$/, '')
    .replace(/^["']|["']$/g, '')
    .trim();
}
