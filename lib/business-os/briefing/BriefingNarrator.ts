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
  userId?: string
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
        messages: [{ role: 'user', content: buildPrompt(facts, language) }],
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

function buildPrompt(facts: BriefingFacts, language: BriefingLanguage): string {
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
    '- payments: money a client STILL OWES the business. It has NOT been paid.',
    '  Never describe it as paid, received, settled or collected. The owner needs to chase it.',
    '- awaitingIntake: these clients have NOT returned their intake form yet.',
    '- cancelled: appointments that were cancelled, freeing that slot.',
    '- allReady: every appointment today is ready; nothing is outstanding on them.',
    '',
    'FORMAT: a list, one fact per line, separated by newlines.',
    'Each line is a single short sentence — under about ten words — that stands on its own.',
    'No bullet characters, no numbering, no headings, no greeting, no sign-off, no blank lines.',
    'At most six lines, fewer when there is less to say.',
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
      ...(appointments.total > 0 && appointments.ready === appointments.total
        ? { allReady: true }
        : appointments.ready > 0 && { ready: appointments.ready }),
      ...(appointments.awaitingIntake.length > 0 && {
        awaitingIntake: appointments.awaitingIntake.map(p => ({ name: p.name, time: p.timeLocal })),
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
    if (appointments.ready > 0 && appointments.ready === appointments.total) {
      lines.push(phrase.allReady(appointments.ready));
    } else if (appointments.ready > 0) {
      lines.push(phrase.someReady(appointments.ready));
    }
  }

  for (const person of appointments.awaitingIntake.slice(0, 3)) {
    lines.push(phrase.awaitingIntake(person.name));
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

  if (lines.length === 0) lines.push(phrase.quiet());

  // Newline-separated, matching the model's contract: the card renders these
  // as a list, one fact per row.
  return lines.join('\n');
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
  allReady: (n: number) => string;
  someReady: (n: number) => string;
  awaitingIntake: (name: string) => string;
  owes: (name: string, amount: string) => string;
  cancelledAt: (time: string) => string;
  cancelled: () => string;
  first: (name: string, time: string) => string;
  quiet: () => string;
}

/*
 * Hebrew and Spanish branch on 1 vs many because counts are the entire content
 * here — "1 פגישות" is the kind of error that makes the whole card look
 * machine-made.
 */
const FALLBACK: Record<BriefingLanguage, FallbackPhrases> = {
  en: {
    appointments: n => (n === 1 ? 'You have one appointment today.' : `You have ${n} appointments today.`),
    allReady: n => (n === 1 ? 'They are ready.' : `All ${n} are ready.`),
    someReady: n => (n === 1 ? 'One client is ready.' : `${n} clients are ready.`),
    awaitingIntake: name => `${name} hasn't completed intake.`,
    owes: (name, amount) => `${name} still owes ${amount}.`,
    cancelledAt: time => `Your ${time} appointment was cancelled, leaving an opening.`,
    cancelled: () => 'An appointment was cancelled, leaving an opening.',
    first: (name, time) => `Your first appointment is ${name} at ${time}.`,
    quiet: () => 'Nothing is scheduled today.',
  },
  es: {
    appointments: n => (n === 1 ? 'Tienes una cita hoy.' : `Tienes ${n} citas hoy.`),
    allReady: n => (n === 1 ? 'Está listo.' : `Los ${n} están listos.`),
    someReady: n => (n === 1 ? 'Un cliente está listo.' : `${n} clientes están listos.`),
    awaitingIntake: name => `${name} no ha completado el formulario.`,
    owes: (name, amount) => `${name} todavía debe ${amount}.`,
    cancelledAt: time => `Tu cita de las ${time} se canceló y dejó un hueco libre.`,
    cancelled: () => 'Se canceló una cita y dejó un hueco libre.',
    first: (name, time) => `Tu primera cita es ${name} a las ${time}.`,
    quiet: () => 'No hay nada agendado para hoy.',
  },
  he: {
    appointments: n => (n === 1 ? 'יש לך פגישה אחת היום.' : `יש לך ${n} פגישות היום.`),
    allReady: n => (n === 1 ? 'הוא מוכן.' : `כל ${n} מוכנים.`),
    someReady: n => (n === 1 ? 'לקוח אחד מוכן.' : `${n} לקוחות מוכנים.`),
    awaitingIntake: name => `${name} לא השלים את הטופס.`,
    owes: (name, amount) => `${name} עדיין חייב ${amount}.`,
    cancelledAt: time => `הפגישה שלך ב-${time} בוטלה ונפתח חלון פנוי.`,
    cancelled: () => 'פגישה בוטלה ונפתח חלון פנוי.',
    first: (name, time) => `הפגישה הראשונה שלך היא ${name} בשעה ${time}.`,
    quiet: () => 'אין שום דבר מתוכנן להיום.',
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
