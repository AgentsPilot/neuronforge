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
import { createLogger } from '@/lib/logger';
import { bosBriefingGroupId, buildBosCallContext } from '@/lib/business-os/llm/callCatalog';
import { withModelFallback } from '@/lib/business-os/llm/modelFallback';
import { resolveBosLlmSettings } from '@/lib/business-os/llm/modelSettings';
import type { BriefingFacts } from './BriefingFactsService';

const logger = createLogger({ service: 'BriefingNarrator' });

export type BriefingSource = 'llm' | 'fallback';

export interface Narration {
  narrative: string;
  source: BriefingSource;
  /**
   * The model that produced it, present only when one did.
   *
   * The model that RAN, which is the fallback's whenever a configured model
   * was refused — a stored briefing naming the model that was asked for but
   * never answered is the failure FR-13 exists to prevent.
   */
  model?: string;
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
  /** Required: the briefing's usage belongs to this business, never to a placeholder account. */
  userId: string,
  businessType: BusinessType = {}
): Promise<Narration> {
  /*
   * Nothing to phrase, so nothing to pay for.
   *
   * `isQuiet` is the facts layer's own judgement and is checked first because it
   * is the cheaper test. The statement count is the stronger one: if the day
   * produced no sentences there is literally nothing to send, and a model call
   * would be asked to write a briefing out of an empty list. It cannot be wrong
   * and it catches the days `isQuiet` misses.
   */
  if (facts.isQuiet || buildStatements(facts, language).length === 0) {
    return { narrative: composeFallback(facts, language), source: 'fallback' };
  }

  // Deterministic per business and business-local day, so re-narrations the
  // same day (after the facts change) share one group.
  const groupId = bosBriefingGroupId(userId, facts.day.date);

  // Model, temperature and the on/off switch come from the briefing area row
  // (Layer 2 FR-12). Off is the same deterministic composer an outage uses:
  // the card still reads, in plainer prose.
  const settings = await resolveBosLlmSettings('briefing', 'daily_narration');
  if (!settings.enabled) {
    logger.info(
      { date: facts.day.date, reason: 'disabled' },
      'Briefing narration AI is switched off; using the deterministic composer'
    );
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
    // Built inside the attempt so a retry carries the model that ran (FR-11).
    const { result: completion, modelUsed } = await withModelFallback(settings, (model) =>
      provider.chatCompletion(
        {
          model,
          messages: [{ role: 'user', content: buildPrompt(facts, language, businessType) }],
          // Low, deliberately. This is reporting, not writing — the same facts
          // should read the same way twice.
          ...(settings.temperature !== undefined ? { temperature: settings.temperature } : {}),
          max_tokens: 320,
        },
        buildBosCallContext(
          { userId, area: 'briefing', callName: 'daily_narration', groupId },
          { activity_type: 'narration' }
        )
      )
    );

    const raw = cleanNarrative(completion.choices[0]?.message?.content ?? '');
    if (!raw) throw new Error('Empty narration');

    /*
     * Lines about subjects the day is silent on are removed, not rejected.
     *
     * See `dropUnsupportedLines`. Falling back over one bad sentence is how the
     * owner ends up with the flat template version; dropping the sentence keeps
     * the rest, which is almost always right.
     */
    const { kept, dropped } = dropUnsupportedLines(raw, facts, language);
    if (dropped.length > 0) {
      logger.warn(
        { dropped, date: facts.day.date },
        'Briefing mentioned subjects the day has nothing on; those lines were removed'
      );
    }

    const narrative = kept.trim();
    // Everything was unsupported. The templates are the honest answer.
    if (!narrative) {
      logger.warn({ date: facts.day.date }, 'Nothing survived the subject check; using the deterministic composer');
      return { narrative: composeFallback(facts, language), source: 'fallback' };
    }

    const untranslated = findUntranslatedWords(narrative, facts, language);
    if (untranslated.length > 0) {
      logger.warn(
        { untranslated, language, date: facts.day.date },
        'Briefing leaked untranslated words; using the deterministic composer'
      );
      return { narrative: composeFallback(facts, language), source: 'fallback' };
    }

    const unsupported = findUnsupportedFigures(narrative, facts, language);
    if (unsupported.length > 0) {
      // Not a tuning problem. A number in the prose that is not in the facts
      // is fabricated, and the plain version is the honest one.
      logger.warn(
        { unsupported, date: facts.day.date },
        'Briefing contained figures absent from the facts; using the deterministic composer'
      );
      return { narrative: composeFallback(facts, language), source: 'fallback' };
    }

    /*
     * `modelUsed`, not the configured model (FR-13).
     *
     * `BriefingStore` records this against the stored briefing, and the value
     * that matters is the one that PRODUCED the text — which is the fallback's
     * model whenever a configured model was refused.
     */
    return { narrative, source: 'llm', model: modelUsed };
  } catch (error) {
    logger.warn(
      { err: error, date: facts.day.date, groupId },
      'Narration failed; using the deterministic composer'
    );
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
export const PROMPT_VERSION = 11;

/**
 * Which model writes the briefing.
 *
 * `gpt-4.1`, chosen on measured behaviour rather than on tier. Run three times
 * each against one real day's facts:
 *
 *   gpt-4o-mini   split a SINGLE appointment across three sentences, 3 times
 *                 out of 3, so a reader could not tell whether the person named
 *                 was the one that had been completed
 *   gpt-4.1-mini  obeyed that rule, then called two enquiries "2 new clients"
 *                 and silently dropped one of the two names, 3 times out of 3
 *   gpt-4.1       correct and identical on all three runs
 *
 * `gpt-4.1-mini` is not a middle option: calling an enquiry a client is a
 * factual error the owner would act on, and neither guard in this file can
 * catch it — no number is wrong.
 *
 * Cost is $0.0033 a briefing against $0.0003, which is one call per business
 * per day: about $100 a month at a thousand businesses. This is the first thing
 * an owner reads each morning and the surface where a wrong word misleads most.
 *
 * Overridable by env so it can be rolled back without a deploy, per the
 * project rule that model choice is configuration rather than a constant.
 */

/**
 * Exported for comparison harnesses that measure one prompt across models.
 * Not part of the module's contract — `narrateBriefing` is.
 */
export function buildPrompt(
  facts: BriefingFacts,
  language: BriefingLanguage,
  businessType: BusinessType
): string {
  const target = LANGUAGE_NAMES[language];

  return [
    'You are given the facts of one business day, already written as short',
    "sentences in the owner's own language, in order of importance.",
    'Rewrite them as a morning briefing for the owner.',
    '',
    'RULES — these are absolute:',
    '1. The lines you are given are ALL the facts. Never introduce a number,',
    '   name, time or amount that is not among them.',
    '2. Never calculate, total, compare or estimate. If a total is not given,',
    '   do not state one.',
    '3. Write names EXACTLY as they appear, in their original script. Never',
    '   transliterate or translate a name.',
    '4. Times are already in the business\'s own timezone. Use them verbatim.',
    '5. Never report an absence. Not "no new enquiries", not "nothing',
    '   outstanding", not "none". A subject that is not in the lines below did',
    '   not happen today, and a list of things that did not happen is the',
    '   longest list there is.',
    '6. Write every count as its number. "2 appointments are ready", never',
    '   "appointments are ready".',
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
    'Use the words THIS owner would use for the people they serve — a personal',
    'trainer says trainees, a clinic says patients, a tutor says students, a salon',
    'says clients. Choose the natural word for this business and this language.',
    'Never use CRM vocabulary: not "contacts", not "leads", not "records", not',
    '"entries". Those are the database\'s words, never the owner\'s.',
    'That word names the PEOPLE and nothing else. An appointment is an',
    'appointment; a session is a session. "2 trainees are already completed" is',
    'wrong — the appointments completed, not the people.',
    'If you cannot tell what kind of business it is, say "clients" in the target language.',
    '',
    'FORMAT: a list, one fact per line, separated by newlines.',
    'Each line is a single short sentence — under about ten words — that stands on its own.',
    'ONE SUBJECT PER LINE. Do not join two unrelated facts with a comma: a line',
    'that says the day is ready AND that somebody owes money is two lines.',
    'No bullet characters, no numbering, no headings, no greeting, no sign-off, no blank lines.',
    'AT MOST SIX LINES. This is a hard limit, not a preference: a briefing read',
    'over coffee stops being read at about six. A busy day does NOT earn more',
    'lines — it earns shorter ones.',
    /*
     * One sentence where there used to be a numbered ORDER block of its own.
     *
     * The block existed because the model received an unordered object and had
     * to re-derive importance from it; the statements arrive ranked, so the
     * whole instruction is "keep it". Losing the block is ~291 tokens off every
     * briefing this platform will ever send.
     */
    'The lines below are ALREADY in order of importance. Keep that order. If they',
    'will not fit in six, MERGE adjacent ones into a single sentence rather than',
    'dropping any; drop only from the bottom, and only if merging cannot hold it.',
    '',
    'STYLE: a trusted assistant speaking to the owner. Address them directly.',
    'The lines are plain and repetitive by design — make them read as one person',
    'talking, not as a list you were handed. Do not copy them word for word.',
    'Grammar matters: match gender and number agreement correctly in the target language',
    '(in Hebrew, "פגישה" is feminine — two appointments is "שתי פגישות", not "שני").',
    '',
    /*
     * ───────────────────────────────────────────────────────────────────────
     * EVERYTHING VARIABLE LIVES BELOW THIS LINE, AND NOTHING ABOVE IT.
     *
     * The provider caches prompt PREFIXES: an identical opening shared between
     * calls is billed at half rate, and only from the first token that differs.
     *
     * The language line used to be the THIRD line of the prompt, so a Hebrew
     * and an English briefing shared 110 characters out of 8,600 and the cache
     * never applied to either. Two businesses in the same language shared
     * 4,772 — barely over the threshold, and only by luck.
     *
     * Everything above is instruction text identical on every call, for EVERY
     * business in EVERY language, so the whole of it is cacheable and the
     * marginal cost of a briefing is the day itself.
     *
     * If you add anything here, add it below this comment. A single
     * interpolation above it silently costs the discount on everything.
     * ───────────────────────────────────────────────────────────────────────
     */
    `LANGUAGE: write the entire briefing in ${target}. This is not optional.`,
    `The lines below are already in ${target}; keep every word of your output in it.`,
    '',
    `THIS BUSINESS: ${describeBusiness(businessType)}.`,
    '',
    'TODAY:',
    buildStatements(facts, language).join('\n'),
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

  /*
   * With ONE appointment, the counts are not sent at all.
   *
   * Telling the model there is 1 appointment, that 1 is completed, and who it
   * is with invites three sentences about one thing — and no instruction
   * reliably stops that, because each line is individually true. The fix is the
   * same one this file already applies to empty arrays: what is absent cannot
   * be narrated. So the singular day sends the appointment itself, with its
   * state attached, and nothing to count.
   */
  const singleAppointment =
    appointments.total === 1 && appointments.first
      ? {
          name: appointments.first.name,
          time: appointments.first.timeLocal,
          service: appointments.first.serviceName,
          ownerNote: appointments.first.note,
          state: appointments.completed === 1 ? 'already completed' : undefined,
        }
      : null;

  const shape: Record<string, unknown> = {
    appointments: singleAppointment
      ? // One appointment: the appointment itself, nothing to count.
        { only: singleAppointment }
      : {
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
     * AGGREGATED once there are more than two.
     *
     * Sending five debts produced five lines, because each one is a true fact
     * and the model narrates what it is given. On a busy day that alone
     * overran the six-line brief the FORMAT rules ask for, and buried the
     * appointment the owner is about to walk into under a list of names.
     *
     * Two or fewer are still named: "Acme owes $2,400" is more use than "2
     * clients owe $2,880" when there are only two. Beyond that the total plus
     * the biggest one carries the same decision — who to chase first — in one
     * sentence instead of five.
     */
    /*
     * ───────────────────────────────────────────────────────────────────────
     * ONLY MONEY THAT IS THIS MORNING'S PROBLEM.
     *
     * An invoice that is not late and not due for weeks is not something to
     * act on over coffee. A briefing said "דויד המלך עדיין חייב ₪4,250" — David
     * still owes ₪4,250 — about an invoice due on 9 November, in September.
     * "Still owes" reads as late; it was not late, and nothing could be done
     * about it that day.
     *
     * Told this in the prompt, the model went on including it anyway across
     * four runs. So the filter is here instead: what is not pressing never
     * reaches the model, and cannot be written about. Outstanding money in
     * full belongs in the weekly review, which is the surface for it.
     * ───────────────────────────────────────────────────────────────────────
     */
    const PRESSING_DAYS = 7;
    const horizon = Date.now() + PRESSING_DAYS * 86_400_000;
    const pressing = money.owed.filter(o => {
      if (o.overdue) return true;
      if (!o.dueDate) return true; // No date to judge by: keep it rather than hide it.
      const due = Date.parse(o.dueDate);
      return !Number.isFinite(due) || due <= horizon;
    });

    if (pressing.length === 0) {
      // Nothing pressing. The subject simply does not appear today.
    } else if (pressing.length <= 2) {
      shape.payments = pressing.map(o => ({
        name: o.name,
        amount: formatMoney(o.amount, o.currency),
        ...(o.overdue && { overdue: true }),
        /*
         * WHEN it falls due, so "late" can be told from "not for six weeks".
         *
         * Without it every issued invoice read as a debt: a briefing said
         * "David still owes ₪4,250" about an invoice due on 9 November, which
         * is not a thing to act on over breakfast in September. `overdue`
         * alone cannot carry that — it is false both for an invoice due
         * tomorrow and one due next quarter.
         */
        ...(o.dueDate ? { dueDate: o.dueDate } : {}),
      }));
    } else {
      const largest = [...pressing].sort((a, b) => b.amount - a.amount)[0];
      const overdueCount = pressing.filter(o => o.overdue).length;
      const pressingTotal = pressing.reduce((sum, o) => sum + o.amount, 0);
      shape.paymentsSummary = {
        people: pressing.length,
        total: formatMoney(pressingTotal, money.currency),
        largest: { name: largest.name, amount: formatMoney(largest.amount, largest.currency) },
        ...(overdueCount > 0 && { overdue: overdueCount }),
      };
    }
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

  /*
   * Optional-chained: a caller whose facts predate this group would otherwise
   * throw here, and the briefing is best-effort by design.
   */
  if ((facts.outlook.stagesToBill?.count ?? 0) > 0) {
    shape.stagesToBill = facts.outlook.stagesToBill.count;
    if (facts.outlook.stagesToBill.value && facts.outlook.stagesToBill.currency) {
      shape.stagesToBillValue = formatMoney(
        facts.outlook.stagesToBill.value,
        facts.outlook.stagesToBill.currency
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
export function findUnsupportedFigures(
  narrative: string,
  facts: BriefingFacts,
  language: BriefingLanguage = 'en'
): string[] {
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

  /*
   * Every figure the model was actually shown.
   *
   * The statements ARE the payload now, so a number copied out of one is
   * supported by definition. Tokenised with the same regex the narrative is
   * read with, rather than stripped out of the whole line — running the money
   * strip over a sentence concatenates every digit in it into one nonsense
   * figure.
   */
  for (const statement of buildStatements(facts, language)) {
    for (const figure of statement.match(/\d+(?:,\d{3})*(?:\.\d+)?/g) ?? []) permit(figure);
  }

  const { appointments } = facts;
  /*
   * Counts the model may state that are not themselves fields in the payload.
   *
   * The allowlist is built from the FACTS, not from what happens to have been
   * sent. `total` and `completed` are the case that proves why: on a day with
   * one appointment the shape deliberately omits both — there is nothing to
   * count, only somebody to name — and a briefing that still said "1
   * appointment" was then flagged as fabricating a figure that is plainly true.
   *
   * The guard's question is "is this number real", not "did we mention it".
   */
  permit(appointments.total);
  permit(appointments.completed);
  permit(appointments.ready);
  permit(appointments.awaitingIntake.length);
  permit(appointments.cancelled.length);
  permit(appointments.awaitingPayment.length);
  permit(appointments.noShows?.length ?? 0);
  permit(appointments.syncFailures ?? 0);

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * THE MONEY TOTALS, WHICH ARE REAL WHETHER OR NOT THEY WERE SENT.
   *
   * `toPromptShape` sends `totalOwed` only when there are MORE than two debts;
   * with one or two it lists them individually and the total never appears in
   * the payload. But adding two amounts is the most natural thing a narrator
   * does when shown two — "₪4,250 and ₪300 outstanding" becomes "₪4,550
   * outstanding" — and the guard then called a correct sum a fabrication and
   * threw the whole briefing away.
   *
   * That is not a rare edge. A business with one or two unpaid invoices is the
   * ordinary case, so this rejected the narration nearly every day: one real
   * account fell back to the templates on every single briefing it ever
   * received, while the model was being called and paid for each time.
   *
   * The count of debts goes in for the same reason — "2 clients owe you" is a
   * fact about the facts, not an invention.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const { money } = facts;
  permit(money.totalOwed);
  permit(money.owed.length);
  permit(money.receivedToday);
  permit(money.receivedCount);

  // Every individual amount, whether or not the shape happened to carry it.
  for (const entry of money.owed) permit(entry.amount);

  // Plan instalments and the retry queue, on the same principle.
  permit(money.instalmentsDue?.length ?? 0);
  permit(money.retrying ?? 0);
  for (const entry of money.instalmentsDue ?? []) permit(entry.amount);

  const { outlook } = facts;
  permit(outlook.quotesAccepted?.count ?? 0);
  permit(outlook.quotesAccepted?.value);
  permit(outlook.quotesDeclined?.count ?? 0);
  permit(outlook.quotesDeclined?.value);
  permit(outlook.unanswered?.count ?? 0);
  permit(outlook.refunded?.count ?? 0);
  permit(outlook.refunded?.value);

  /*
   * The date is NOT permitted, and is no longer sent.
   *
   * It used to be, "in every shape it might be written" — which licensed every
   * component of it. On 2026-09-17 that quietly allowed 2026, 9 and 17 to
   * appear anywhere in the prose, so "9 new enquiries" passed this check on a
   * day with one, purely because it was September. A guard against invented
   * figures that permits 1-31 and 1-12 all month is not much of a guard.
   *
   * Nothing is lost by dropping it: the model never writes the date. The card
   * renders "Thursday 17 September" in its own header, and the FORMAT rules
   * forbid headings and greetings, which is where a date would otherwise go.
   */

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

/* --------------------------------------------------------------- statements */

/**
 * The day as a list of finished sentences, in the order they matter.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE MODEL IS SENT SENTENCES RATHER THAN A DATA STRUCTURE
 *
 * It used to receive a JSON object plus a 261-token dictionary explaining what
 * each key meant, and was asked to work out what was true from which keys were
 * present. On 27 September it concluded, in every sample run, that a client had
 * not returned an intake form. Nobody had ever sent one: `awaitingIntake` was
 * an empty array. **The absence of a key is not a fact, but it reads like one.**
 *
 * A statement cannot be misread that way. It is in the list or it is not, and
 * the dictionary — along with most of the defensive rules that existed to stop
 * the model misreading a field — disappears with it.
 *
 * Aggregation happens HERE, in code, where it is deterministic and testable.
 * The rule is the one `owedSummary` already used: name one, name two, summarise
 * three or more. Applied to intake, payment and cancellations it is what turns
 * a busy day from seventeen lines into six, and nothing is dropped to a cap.
 *
 * Both paths share this function. The composer and the model can no longer tell
 * the same day differently, which they did — the same facts read as seven flat
 * bullets from one and five grouped lines from the other.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function buildStatements(facts: BriefingFacts, language: BriefingLanguage): string[] {
  return [...todayStatements(facts, language), ...outlookStatements(facts, language)];
}

/**
 * Past which count a group of people stops getting a line each.
 *
 * One person is a sentence about them. Two or more share ONE sentence that
 * names as many as we hold — "Sarah and Dana haven't returned their intake
 * forms" — because two lines differing only in a name is the shape that turned
 * a busy day into seventeen of them. Nothing is dropped: past the names we
 * print, the rest are counted.
 */
const NAME_LIMIT = 1;

/** Everything that is true of today itself. */
function todayStatements(facts: BriefingFacts, language: BriefingLanguage): string[] {
  const phrase = FALLBACK[language] ?? FALLBACK.en;
  const { appointments, money } = facts;
  const lines: string[] = [];

  /*
   * One appointment is one sentence.
   *
   * Counting it, then counting how many of it are done, then naming who it is
   * with, is three lines about one thing — and the reader cannot tell whether
   * the person named is the one that was completed. With a single appointment
   * the honest form names the person and the state together.
   */
  if (appointments.total === 1 && appointments.first) {
    lines.push(
      appointments.completed === 1
        ? phrase.onlyOneDone(appointments.first.name, appointments.first.timeLocal)
        : phrase.onlyOne(appointments.first.name, appointments.first.timeLocal)
    );
  } else if (appointments.total > 0) {
    /*
     * The count and the first appointment, together at the top.
     *
     * They used to be two lines with the first one LAST, below the money and
     * the cancellations. An owner read how many appointments they had, then
     * four other subjects, then who the first was with — and the question this
     * card exists to answer is what the day looks like.
     */
    lines.push(
      appointments.first
        ? phrase.appointmentsWithFirst(
            appointments.total,
            appointments.first.name,
            appointments.first.timeLocal
          )
        : phrase.appointments(appointments.total)
    );

    /*
     * Finished sessions are reported, not hidden. The owner asked for the
     * day's work to show as done rather than vanish from the count — a card
     * that silently shrinks through the afternoon reads as data going missing.
     *
     * Done and ready share a line when both are true: they are two halves of
     * the same question, and split apart they were two of the six.
     */
    const someDone = appointments.completed > 0;
    const someReady = appointments.ready > 0;

    if (someDone && someReady) {
      lines.push(phrase.doneAndReady(appointments.completed, appointments.ready));
    } else if (someDone) {
      lines.push(phrase.completed(appointments.completed, appointments.total));
    } else if (appointments.ready === appointments.total) {
      lines.push(phrase.allReady(appointments.ready));
    } else if (someReady) {
      lines.push(phrase.someReady(appointments.ready));
    }
  }

  if (appointments.awaitingIntake.length > NAME_LIMIT) {
    lines.push(
      phrase.awaitingIntakeMany(
        phrase.names(appointments.awaitingIntake, appointments.awaitingIntake.length),
        appointments.awaitingIntake.length
      )
    );
  } else {
    for (const person of appointments.awaitingIntake) {
      lines.push(phrase.awaitingIntake(person.name));
    }
  }

  if (appointments.awaitingPayment.length > NAME_LIMIT) {
    lines.push(
      phrase.awaitingPaymentMany(
        phrase.names(appointments.awaitingPayment, appointments.awaitingPayment.length),
        appointments.awaitingPayment.length
      )
    );
  } else {
    for (const person of appointments.awaitingPayment) {
      lines.push(phrase.awaitingPayment(person.name));
    }
  }

  /*
   * Booked, and nobody came.
   *
   * Reported separately from a cancellation because it is different news: a
   * cancellation frees the slot, a no-show cost the hour. The briefing carried
   * one and was silent about the other.
   */
  const noShows = appointments.noShows ?? [];
  if (noShows.length === 1 && noShows[0].name) {
    lines.push(phrase.noShow(noShows[0].name));
  } else if (noShows.length > 0) {
    lines.push(phrase.noShowMany(noShows.length));
  }

  // Nothing else tells them. The first sign of a failed sync is a client
  // arriving for a slot the owner had already given away.
  if ((appointments.syncFailures ?? 0) > 0) {
    lines.push(phrase.syncFailures(appointments.syncFailures));
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

  /*
   * Totalled past two, for the same reason the prompt shape aggregates: three
   * debts became three lines, and on a busy day the composer produced eighteen
   * lines for a card that asks for six.
   */
  if (money.owed.length <= NAME_LIMIT) {
    for (const entry of money.owed) {
      lines.push(phrase.owes(entry.name, formatAmount(entry.amount, entry.currency)));
    }
  } else {
    lines.push(
      phrase.owedSummary(
        money.owed.length,
        formatAmount(money.totalOwed, money.currency),
        money.owed.reduce((a, b) => (a.amount >= b.amount ? a : b)).name
      )
    );
  }

  /*
   * Money owed on a SCHEDULE rather than against an invoice, so invisible to
   * `owed`, which reads invoices only. A client paying a course over four
   * months showed the owner nothing.
   *
   * One line per currency: there is no FX rate anywhere in this platform, and a
   * single total across two currencies cannot be honest.
   */
  for (const [currency, group] of groupByCurrency(facts.money.instalmentsDue ?? [])) {
    const total = group.reduce((sum, entry) => sum + entry.amount, 0);
    lines.push(phrase.instalmentsDue(group.length, formatAmount(total, currency)));
  }

  if ((money.retrying ?? 0) > 0) {
    lines.push(phrase.retrying(money.retrying));
  }

  if (appointments.cancelled.length > NAME_LIMIT) {
    lines.push(phrase.cancelledMany(appointments.cancelled.length));
  } else {
    for (const cancellation of appointments.cancelled) {
      lines.push(cancellation.timeLocal ? phrase.cancelledAt(cancellation.timeLocal) : phrase.cancelled());
    }
  }

  return lines;
}

/** What is true beyond today. */
function outlookStatements(facts: BriefingFacts, language: BriefingLanguage): string[] {
  const phrase = FALLBACK[language] ?? FALLBACK.en;
  const { outlook } = facts;
  const lines: string[] = [];

  /*
   * WON WORK LEADS, before anything that needs chasing.
   *
   * A quote accepted this morning is the only unambiguously good thing a day
   * can contain, and the briefing never carried it: an owner who had just won
   * ₪8,500 read a summary about appointments and unpaid invoices. Ordering it
   * below the enquiries would be taking the order from the database rather
   * than from the person reading it.
   */
  if ((outlook.quotesAccepted?.count ?? 0) > 0) {
    lines.push(
      phrase.quoteAccepted(
        phrase.names(outlook.quotesAccepted.people, outlook.quotesAccepted.count),
        outlook.quotesAccepted.count,
        outlook.quotesAccepted.value && outlook.quotesAccepted.currency
          ? formatMoney(outlook.quotesAccepted.value, outlook.quotesAccepted.currency)
          : undefined
      )
    );
  }

  /*
   * Turned down, stated as a fact about today and never as a trend.
   *
   * `topReason` is set only where every decline today gave the SAME reason,
   * and even then it is one day. Whether declines form a pattern belongs to
   * `ConvDeclineReasonDetector`, which has a quarter of evidence behind it.
   * Names are deliberately not used: being named in your owner's morning
   * summary for saying no is not a thing the client agreed to.
   */
  if ((outlook.quotesDeclined?.count ?? 0) > 0) {
    lines.push(
      phrase.quoteDeclined(
        outlook.quotesDeclined.count,
        outlook.quotesDeclined.value && outlook.quotesDeclined.currency
          ? formatMoney(outlook.quotesDeclined.value, outlook.quotesDeclined.currency)
          : undefined,
        outlook.quotesDeclined.topReason
      )
    );
  }

  /*
   * Leads the outlook, because it is the most actionable thing a morning
   * briefing can carry and the briefing was blind to it. `newLeads` counts
   * contacts created TODAY, so an enquiry that arrived on Friday and was never
   * answered did not exist on Monday morning — the exact gap the "reply to
   * enquiries" automation was built to close.
   */
  if ((outlook.unanswered?.count ?? 0) > 0) {
    lines.push(
      phrase.unanswered(
        phrase.names(outlook.unanswered.people, outlook.unanswered.count),
        outlook.unanswered.count
      )
    );
  }

  if (outlook.next) {
    lines.push(
      phrase.next(outlook.next.name, formatDay(outlook.next.dateLocal, language), outlook.next.timeLocal)
    );
  }

  if (outlook.newLeads.count > 0) {
    lines.push(phrase.newLeads(outlook.newLeads.count, outlook.newLeads.people));
  }

  // Money that has gone back out. Priced only when the group shares a currency.
  if ((outlook.refunded?.count ?? 0) > 0) {
    lines.push(
      phrase.refunded(
        outlook.refunded.count,
        outlook.refunded.value && outlook.refunded.currency
          ? formatMoney(outlook.refunded.value, outlook.refunded.currency)
          : undefined
      )
    );
  }

  if (outlook.quotesWaiting.count > 0) {
    lines.push(
      phrase.quotesWaiting(
        phrase.names(outlook.quotesWaiting.people, outlook.quotesWaiting.count),
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

  /*
   * The template path matters here more than for most facts: `isQuiet`
   * short-circuits to these templates before the model is ever called, and a
   * waiting phase is one of the things that makes a day non-quiet. Without this
   * line such a day produced a briefing that said nothing about the reason it was
   * sent.
   */
  if ((outlook.stagesToBill?.count ?? 0) > 0) {
    lines.push(
      phrase.stagesToBill(
        outlook.stagesToBill.count,
        outlook.stagesToBill.value && outlook.stagesToBill.currency
          ? formatMoney(outlook.stagesToBill.value, outlook.stagesToBill.currency)
          : undefined
      )
    );
  }

  return lines;
}

/**
 * Amounts grouped by their own currency, largest group first.
 *
 * Never a single total across two currencies: there is no FX rate anywhere in
 * this platform, so a combined figure would be invented.
 */
function groupByCurrency<T extends { amount: number; currency: string }>(
  entries: T[]
): Array<[string, T[]]> {
  const groups = new Map<string, T[]>();
  for (const entry of entries) {
    const key = entry.currency || 'USD';
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  return [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
}

/* ----------------------------------------------------------------- fallback */

/**
 * The same facts, composed without a model.
 *
 * Kept deliberately flat — this is the outage path, and prose assembled from
 * templates reads worse the harder it tries. It shares `buildStatements` with
 * the prompt, so the two paths cannot report the same day differently.
 */
export function composeFallback(facts: BriefingFacts, language: BriefingLanguage): string {
  const phrase = FALLBACK[language] ?? FALLBACK.en;
  const today = todayStatements(facts, language);
  const ahead = outlookStatements(facts, language);

  /*
   * The quiet line leads, and the outlook follows it.
   *
   * Said here rather than only for a wholly empty day, because the outlook
   * lines are not today: a day whose only content is next Wednesday's
   * appointment still needs to say that today itself held nothing, or the card
   * reads as though Wednesday were today.
   */
  const lines = today.length > 0 ? [...today, ...ahead] : [phrase.quiet(), ...ahead];

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

/** Split a narration into the lines the card renders. Lives in `./briefingLines` so the browser can import it. */
export { briefingLines } from './briefingLines';

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
  /**
   * The count and the first appointment in ONE sentence.
   *
   * They were two lines, and the first of them sat at the BOTTOM of the card,
   * below the money — so an owner read how many appointments they had, then
   * four other subjects, then who the first one was with. The one thing this
   * card exists to answer is what the day looks like, and that is this line.
   */
  appointmentsWithFirst: (n: number, name: string, time: string) => string;
  /** `n` of `total` have already happened. */
  completed: (n: number, total: number) => string;
  /** Both states of the day in one line, when both are true of it. */
  doneAndReady: (done: number, ready: number) => string;
  allReady: (n: number) => string;
  someReady: (n: number) => string;
  awaitingIntake: (name: string) => string;
  /** Coming today and hasn't paid, where payment was due before the appointment. */
  awaitingPayment: (name: string) => string;

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * AGGREGATED FORMS — one line however many people.
   *
   * Three clients missing intake produced three lines, and a busy day produced
   * seventeen against a six-line brief. Named while a name still helps, counted
   * once it stops: an owner chasing five forms does the same thing whether or
   * not the line lists all five.
   * ───────────────────────────────────────────────────────────────────────────
   */
  /**
   * A list of people as this language writes one: "A, B and 2 others".
   *
   * Exposed on the table because the conjunction is the only part that differs
   * between the three, and the statement builder must not have to know it.
   */
  names: (people: Array<{ name: string }>, total: number) => string;
  awaitingIntakeMany: (named: string, n: number) => string;
  awaitingPaymentMany: (named: string, n: number) => string;
  cancelledMany: (n: number) => string;

  /* Booked, and nobody came. Not the same news as a cancellation. */
  noShow: (name: string) => string;
  noShowMany: (n: number) => string;
  /* Appointments that never reached the owner's real calendar. */
  syncFailures: (n: number) => string;
  /* Money owed on a plan rather than against an invoice. */
  instalmentsDue: (n: number, money: string) => string;
  /* A card that failed and is queued to try again. */
  retrying: (n: number) => string;
  /**
   * A quote the client said YES to today.
   *
   * Leads the outlook, ahead of anything that needs chasing. It is the one
   * unambiguously good thing a day can contain, and a briefing that opened
   * with unpaid invoices while ₪8,500 of work was won that morning had its
   * priorities from the database rather than from the owner.
   */
  quoteAccepted: (named: string, n: number, money?: string) => string;
  /** Turned down today. `reason` only where every one today agreed on it. */
  quoteDeclined: (n: number, money?: string, reason?: string) => string;
  /* Wrote in, still no reply — whenever they wrote. */
  unanswered: (named: string, n: number) => string;
  /* Money that has gone back out. */
  refunded: (n: number, money?: string) => string;
  /** `money` is already formatted; `n` is how many payments made it up. */
  receivedToday: (money: string, n: number) => string;
  owes: (name: string, amount: string) => string;
  /** Several debts, totalled rather than listed. */
  owedSummary: (people: number, total: string, largest: string) => string;
  cancelledAt: (time: string) => string;
  cancelled: () => string;
  first: (name: string, time: string) => string;
  /** The day's only appointment, named rather than counted. */
  onlyOne: (name: string, time: string) => string;
  /** The day's only appointment, already done. */
  onlyOneDone: (name: string, time: string) => string;
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
  /**
   * People owed a price — unwritten or written and unsent. The owner's move.
   *
   * `named` carries who, where the gap knows. It did not, and the line read
   * "somebody is waiting on a price from you" over data that held the name:
   * the owner's reply to their own briefing was "who is waiting?". `unanswered`
   * above has taken names all along; this one simply never asked for them.
   *
   * `money` is the group's total, already formatted; absent on mixed
   * currencies and absent when the count covers more rows than were totalled.
   */
  quotesWaiting: (named: string, n: number, money?: string) => string;
  /** Quotes out with the client and unanswered. Reported, never a chore. */
  quotesOut: (n: number) => string;
  /** Phases waiting on the owner to mark done so they can be billed. */
  stagesToBill: (n: number, money?: string) => string;
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
  /**
   * The separator before the LAST name, spacing included, chosen by what
   * follows it.
   *
   * A plain word would do for English and Spanish. Hebrew's vav is a prefix
   * rather than a word: it attaches to the name, and takes a hyphen only
   * before a Latin word or a numeral. Passed as a string with spaces around
   * it, this produced "Sarah, Dana ו- Noa" — a conjunction floating between
   * two spaces, which is not how anybody writes Hebrew.
   */
  conjunction: (next: string) => string,
  others: (n: number) => string
): string {
  const names = people.map(p => p.name).filter(Boolean);
  if (names.length === 0) return '';

  const hidden = total - names.length;
  const parts = hidden > 0 ? [...names, others(hidden)] : names;

  if (parts.length === 1) return parts[0];

  const last = parts[parts.length - 1];
  return `${parts.slice(0, -1).join(', ')}${conjunction(last)}${last}`;
}

/** Hebrew letters, for deciding whether the vav needs its hyphen. */
const HEBREW_START = /^[\u0590-\u05FF]/;

/** "Dana ונועה", but "Dana ו-Noa" and "Tom ועוד 2". */
const hebrewAnd = (next: string) => (HEBREW_START.test(next) ? ' ו' : ' ו-');

/*
 * Hebrew and Spanish branch on 1 vs many because counts are the entire content
 * here — "1 פגישות" is the kind of error that makes the whole card look
 * machine-made.
 */
const FALLBACK: Record<BriefingLanguage, FallbackPhrases> = {
  en: {
    appointments: n => (n === 1 ? 'You have one appointment today.' : `You have ${n} appointments today.`),
    appointmentsWithFirst: (n, name, time) =>
      `You have ${n} appointments today, the first with ${name} at ${time}.`,
    completed: (n, total) =>
      n === total
        ? 'All of them are done.'
        : n === 1
          ? 'One of them is already done.'
          : `${n} of them are already done.`,
    doneAndReady: (done, ready) =>
      `${done === 1 ? 'One is' : `${done} are`} already done and ${ready} ${ready === 1 ? 'is' : 'are'} ready.`,
    allReady: n =>
      n === 1 ? 'The appointment is ready.' : `All ${n} appointments are ready.`,
    someReady: n =>
      n === 1 ? 'One appointment is ready.' : `${n} appointments are ready.`,
    awaitingIntake: name => `${name} hasn't completed intake.`,
    awaitingPayment: name => `${name} hasn't paid yet.`,
    names: (people, total) => joinNames(people, total, () => ' and ', k => `${k} more`),
    awaitingIntakeMany: (named, n) =>
      named ? `${named} haven't returned their intake forms.` : `${n} clients haven't returned their intake forms.`,
    awaitingPaymentMany: (named, n) =>
      named ? `${named} haven't paid for today yet.` : `${n} of today's appointments are unpaid.`,
    cancelledMany: n => `${n} appointments were cancelled, leaving openings.`,
    noShow: name => `${name} didn't turn up.`,
    noShowMany: n => `${n} people didn't turn up.`,
    syncFailures: n =>
      n === 1 ? "One appointment didn't reach your calendar." : `${n} appointments didn't reach your calendar.`,
    instalmentsDue: (n, money) =>
      n === 1 ? `A plan payment of ${money} is due.` : `${n} plan payments are due, ${money} in total.`,
    retrying: n => (n === 1 ? 'A payment failed and is being retried.' : `${n} payments failed and are being retried.`),
    quoteAccepted: (named, n, money) => {
      const who = named || (n === 1 ? 'A client' : `${n} clients`);
      return money
        ? `${who} accepted your quote, ${money}.`
        : `${who} accepted your quote.`;
    },
    quoteDeclined: (n, money, reason) =>
      `${n === 1 ? 'One quote was' : `${n} quotes were`} turned down${money ? `, ${money}` : ''}${
        reason ? ` (${reason})` : ''
      }.`,
    unanswered: (named, n) =>
      named ? `${named} wrote in and are still waiting for a reply.` : `${n} enquiries are still waiting for a reply.`,
    refunded: (n, money) =>
      (n === 1 ? 'A booking was refunded' : `${n} bookings were refunded`) + (money ? `, ${money}.` : '.'),
    owes: (name, amount) => `${name} still owes ${amount}.`,
    owedSummary: (people, total, largest) => `${people} clients owe you ${total}, ${largest} the most.`,
    receivedToday: (money, n) => (n === 1 ? `${money} came in today.` : `${money} came in today, across ${n} payments.`),
    cancelledAt: time => `Your ${time} appointment was cancelled, leaving an opening.`,
    cancelled: () => 'An appointment was cancelled, leaving an opening.',
    first: (name, time) => `Your first appointment is ${name} at ${time}.`,
    onlyOne: (name, time) => `One appointment today: ${name} at ${time}.`,
    onlyOneDone: (name, time) => `One appointment today: ${name} at ${time}, already done.`,
    quiet: () => 'No activity we could see for today.',
    next: (name, day, time) => `Your next is ${name}, ${day} at ${time}.`,
    newLeads: (n, people) => {
      const named = joinNames(people, n, () => ' and ', k => `${k} more`);
      if (!named) {
        return n === 1 ? 'Someone new got in touch today.' : `${n} new people got in touch today.`;
      }
      // One person who said what they wanted gets their words; a list does not,
      // because three notes in one line is no longer a summary.
      const note = people.length === 1 && people[0].note ? ` — ${people[0].note}` : '';
      return `${named} got in touch today${note}.`;
    },
    quotesWaiting: (named, n, money) =>
      (named
        ? `${named} ${n === 1 ? 'is' : 'are'} waiting on a price from you`
        : n === 1
          ? 'Someone is waiting on a price from you'
          : `${n} people are waiting on a price from you`) + (money ? `, ${money}.` : '.'),
    quotesOut: n =>
      n === 1 ? 'One quote is out and still unanswered.' : `${n} quotes are out and still unanswered.`,
    stagesToBill: (n, money) =>
      (n === 1
        ? 'One phase is waiting for you to mark it done and bill it'
        : `${n} phases are waiting for you to mark them done and bill them`) +
      (money ? `: ${money}.` : '.'),
  },
  es: {
    appointments: n => (n === 1 ? 'Tienes una cita hoy.' : `Tienes ${n} citas hoy.`),
    appointmentsWithFirst: (n, name, time) =>
      `Tienes ${n} citas hoy, la primera con ${name} a las ${time}.`,
    completed: (n, total) =>
      n === total
        ? 'Todas ya están hechas.'
        : n === 1
          ? 'Una de ellas ya está hecha.'
          : `${n} de ellas ya están hechas.`,
    doneAndReady: (done, ready) =>
      `${done === 1 ? 'Una ya está hecha' : `${done} ya están hechas`} y ${ready === 1 ? 'una está lista' : `${ready} están listas`}.`,
    allReady: n =>
      n === 1 ? 'La cita está lista.' : `Las ${n} citas están listas.`,
    someReady: n =>
      n === 1 ? 'Una cita está lista.' : `${n} citas están listas.`,
    awaitingIntake: name => `${name} no ha completado el formulario.`,
    awaitingPayment: name => `${name} todavía no ha pagado.`,
    names: (people, total) => joinNames(people, total, () => ' y ', k => `${k} más`),
    awaitingIntakeMany: (named, n) =>
      named ? `${named} no han devuelto sus formularios.` : `${n} clientes no han devuelto sus formularios.`,
    awaitingPaymentMany: (named, n) =>
      named ? `${named} todavía no han pagado lo de hoy.` : `${n} citas de hoy están sin pagar.`,
    cancelledMany: n => `Se cancelaron ${n} citas, dejando huecos libres.`,
    noShow: name => `${name} no se presentó.`,
    noShowMany: n => `${n} personas no se presentaron.`,
    syncFailures: n =>
      n === 1 ? 'Una cita no llegó a tu calendario.' : `${n} citas no llegaron a tu calendario.`,
    instalmentsDue: (n, money) =>
      n === 1 ? `Vence un pago del plan de ${money}.` : `Vencen ${n} pagos del plan, ${money} en total.`,
    retrying: n =>
      n === 1 ? 'Un pago falló y se está reintentando.' : `${n} pagos fallaron y se están reintentando.`,
    quoteAccepted: (named, n, money) => {
      const who = named || (n === 1 ? 'Un cliente' : `${n} clientes`);
      return money
        ? `${who} aceptó tu presupuesto, ${money}.`
        : `${who} aceptó tu presupuesto.`;
    },
    quoteDeclined: (n, money, reason) =>
      `${n === 1 ? 'Rechazaron un presupuesto' : `Rechazaron ${n} presupuestos`}${money ? `, ${money}` : ''}${
        reason ? ` (${reason})` : ''
      }.`,
    unanswered: (named, n) =>
      named ? `${named} escribieron y siguen esperando respuesta.` : `${n} consultas siguen esperando respuesta.`,
    refunded: (n, money) =>
      (n === 1 ? 'Se reembolsó una reserva' : `Se reembolsaron ${n} reservas`) + (money ? `, ${money}.` : '.'),
    owes: (name, amount) => `${name} todavía debe ${amount}.`,
    owedSummary: (people, total, largest) =>
      `${people} clientes te deben ${total}, y ${largest} es quien más debe.`,
    receivedToday: (money, n) => (n === 1 ? `Entraron ${money} hoy.` : `Entraron ${money} hoy, en ${n} pagos.`),
    cancelledAt: time => `Tu cita de las ${time} se canceló y dejó un hueco libre.`,
    cancelled: () => 'Se canceló una cita y dejó un hueco libre.',
    first: (name, time) => `Tu primera cita es ${name} a las ${time}.`,
    onlyOne: (name, time) => `Una cita hoy: ${name} a las ${time}.`,
    onlyOneDone: (name, time) => `Una cita hoy: ${name} a las ${time}, ya realizada.`,
    quiet: () => 'No detectamos actividad para hoy.',
    next: (name, day, time) => `Tu próxima es ${name}, el ${day} a las ${time}.`,
    newLeads: (n, people) => {
      const named = joinNames(people, n, () => ' y ', k => `${k} más`);
      if (!named) {
        return n === 1 ? 'Alguien nuevo te contactó hoy.' : `${n} personas nuevas te contactaron hoy.`;
      }
      const note = people.length === 1 && people[0].note ? ` — ${people[0].note}` : '';
      return `${named} te ${n === 1 ? 'contactó' : 'contactaron'} hoy${note}.`;
    },
    quotesWaiting: (named, n, money) =>
      (named
        ? `${named} ${n === 1 ? 'espera' : 'esperan'} un precio tuyo`
        : n === 1
          ? 'Alguien espera un precio tuyo'
          : `${n} personas esperan un precio tuyo`) + (money ? `, ${money}.` : '.'),
    quotesOut: n =>
      n === 1 ? 'Un presupuesto sigue sin respuesta.' : `${n} presupuestos siguen sin respuesta.`,
    stagesToBill: (n, money) =>
      (n === 1
        ? 'Una fase espera que la marques como hecha y la factures'
        : `${n} fases esperan que las marques como hechas y las factures`) +
      (money ? `: ${money}.` : '.'),
  },
  he: {
    appointments: n => (n === 1 ? 'יש לך פגישה אחת היום.' : `יש לך ${n} פגישות היום.`),
    appointmentsWithFirst: (n, name, time) =>
      `יש לך ${n} פגישות היום, הראשונה עם ${name} בשעה ${time}.`,
    completed: (n, total) =>
      n === total
        ? 'כולן כבר הסתיימו.'
        : n === 1
          ? 'אחת מהן כבר הסתיימה.'
          : `${n} מהן כבר הסתיימו.`,
    doneAndReady: (done, ready) =>
      `${done === 1 ? 'אחת כבר הסתיימה' : `${done} כבר הסתיימו`} ו-${
        ready === 1 ? 'אחת מוכנה' : `${ready} מוכנות`
      }.`,
    allReady: n => (n === 1 ? 'הפגישה מוכנה.' : `כל ${n} הפגישות מוכנות.`),
    someReady: n => (n === 1 ? 'פגישה אחת מוכנה.' : `${n} פגישות מוכנות.`),
    awaitingIntake: name => `${name} לא השלים את הטופס.`,
    awaitingPayment: name => `${name} עדיין לא שילם.`,
    names: (people, total) => joinNames(people, total, hebrewAnd, k => `עוד ${k}`),
    awaitingIntakeMany: (named, n) =>
      named ? `${named} לא החזירו את הטפסים.` : `${n} לקוחות לא החזירו את הטפסים.`,
    awaitingPaymentMany: (named, n) =>
      named ? `${named} עדיין לא שילמו על היום.` : `${n} מהפגישות היום עדיין לא שולמו.`,
    cancelledMany: n => `${n} פגישות בוטלו ונפתחו חלונות פנויים.`,
    noShow: name => `${name} לא הגיע.`,
    noShowMany: n => `${n} אנשים לא הגיעו.`,
    syncFailures: n =>
      n === 1 ? 'פגישה אחת לא הגיעה ליומן שלך.' : `${n} פגישות לא הגיעו ליומן שלך.`,
    instalmentsDue: (n, money) =>
      n === 1 ? `תשלום אחד בתוכנית בסך ${money} הגיע לפירעון.` : `${n} תשלומים בתוכנית הגיעו לפירעון, ${money} בסך הכול.`,
    retrying: n => (n === 1 ? 'תשלום אחד נכשל ומנסים שוב.' : `${n} תשלומים נכשלו ומנסים שוב.`),
    quoteAccepted: (named, n, money) => {
      const who = named || (n === 1 ? 'לקוח' : `${n} לקוחות`);
      return money
        ? `${who} אישר את הצעת המחיר, ${money}.`
        : `${who} אישר את הצעת המחיר.`;
    },
    quoteDeclined: (n, money, reason) =>
      `${n === 1 ? 'הצעת מחיר אחת נדחתה' : `${n} הצעות מחיר נדחו`}${money ? `, ${money}` : ''}${
        reason ? ` (${reason})` : ''
      }.`,
    unanswered: (named, n) =>
      named ? `${named} פנו ועדיין מחכים לתשובה.` : `${n} פניות עדיין מחכות לתשובה.`,
    refunded: (n, money) =>
      (n === 1 ? 'הזמנה אחת זוכתה' : `${n} הזמנות זוכו`) + (money ? `, ${money}.` : '.'),
    owes: (name, amount) => `${name} עדיין חייב ${amount}.`,
    owedSummary: (people, total, largest) =>
      `${people} לקוחות חייבים ${total}, ${largest} חייב הכי הרבה.`,
    receivedToday: (money, n) => (n === 1 ? `${money} נכנסו היום.` : `${money} נכנסו היום, ב-${n} תשלומים.`),
    cancelledAt: time => `הפגישה שלך ב-${time} בוטלה ונפתח חלון פנוי.`,
    cancelled: () => 'פגישה בוטלה ונפתח חלון פנוי.',
    first: (name, time) => `הפגישה הראשונה שלך היא ${name} בשעה ${time}.`,
    onlyOne: (name, time) => `פגישה אחת היום: ${name} בשעה ${time}.`,
    onlyOneDone: (name, time) => `פגישה אחת היום: ${name} בשעה ${time}, כבר התקיימה.`,
    quiet: () => 'לא זיהינו פעילות להיום.',
    next: (name, day, time) => `הפגישה הבאה שלך היא ${name}, ב${day} בשעה ${time}.`,
    newLeads: (n, people) => {
      const named = joinNames(people, n, hebrewAnd, k => `עוד ${k}`);
      if (!named) {
        return n === 1 ? 'מישהו חדש פנה אליך היום.' : `${n} אנשים חדשים פנו אליך היום.`;
      }
      const note = people.length === 1 && people[0].note ? ` — ${people[0].note}` : '';
      return `${named} ${n === 1 ? 'פנה/תה' : 'פנו'} אליך היום${note}.`;
    },
    quotesWaiting: (named, n, money) =>
      (named
        ? `${named} ${n === 1 ? 'מחכה' : 'מחכים'} לך להצעת מחיר`
        : n === 1
          ? 'מישהו מחכה לך להצעת מחיר'
          : `${n} אנשים מחכים לך להצעת מחיר`) + (money ? `, ${money}.` : '.'),
    quotesOut: n =>
      n === 1 ? 'הצעת מחיר אחת נשלחה ועדיין ללא מענה.' : `${n} הצעות מחיר נשלחו ועדיין ללא מענה.`,
    stagesToBill: (n, money) =>
      (n === 1
        ? 'שלב אחד מחכה שתסמן שבוצע ותחייב עליו'
        : `${n} שלבים מחכים שתסמן שבוצעו ותחייב עליהם`) +
      (money ? `: ${money}.` : '.'),
  },
};

/** Strip anything the model wrapped around the prose. */
/**
 * Which subjects the day actually contains, and the words that name them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A narration can be perfectly worded, use no foreign word and invent no
 * figure, and still say something that never happened. On 2026-09-27 the model
 * wrote — in all three sample runs — "אופיר עומר לא השלים את הטופס", that the
 * client had not returned his intake form. No form was ever sent: the
 * `awaitingIntake` list was EMPTY. The two existing guards check words and
 * numbers, so neither could see it.
 *
 * It also reported absences — "no money came in today", "no new enquiries" —
 * which the prompt already forbids and the model does anyway. A briefing is
 * what happened, not an inventory of what did not.
 *
 * Both are the same fault: a sentence about a subject the day has nothing to
 * say about. So one rule covers them — if the underlying collection is empty,
 * the subject may not be mentioned at all.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const SUBJECT_WORDS: Record<BriefingLanguage, Record<string, string[]>> = {
  en: {
    intake: ['intake', 'form'],
    awaitingPayment: ['not paid for', 'unpaid appointment'],
    cancelled: ['cancel'],
    newLeads: ['enquir', 'inquir', 'new lead'],
    quotes: ['quote', 'proposal'],
    received: ['came in today', 'received today', 'paid today'],
    owed: ['owe', 'outstanding', 'debt'],
  },
  es: {
    intake: ['formulario', 'admisión'],
    awaitingPayment: ['sin pagar', 'no ha pagado'],
    cancelled: ['cancel'],
    newLeads: ['consulta', 'cliente potencial'],
    quotes: ['presupuesto', 'propuesta'],
    received: ['recibido hoy', 'entró hoy'],
    owed: ['debe', 'deuda', 'pendiente de pago'],
  },
  he: {
    intake: ['טופס'],
    awaitingPayment: ['לא שילם', 'טרם שילם'],
    cancelled: ['ביטל', 'בוטל', 'ביטול'],
    newLeads: ['פניות', 'פנייה', 'פניה', 'ליד'],
    quotes: ['הצעת מחיר', 'הצעות', 'ציטוט'],
    received: ['התקבל כסף', 'נכנס כסף', 'התקבלו תשלומים'],
    owed: ['חייב', 'חוב', 'חובות'],
  },
};

/** True when the day genuinely has something to say about that subject. */
function subjectHasContent(subject: string, facts: BriefingFacts): boolean {
  const { appointments, money, outlook } = facts;
  switch (subject) {
    case 'intake': return appointments.awaitingIntake.length > 0;
    case 'awaitingPayment': return appointments.awaitingPayment.length > 0;
    case 'cancelled': return appointments.cancelled.length > 0;
    case 'newLeads': return outlook.newLeads.count > 0;
    case 'quotes': return (outlook.quotesWaiting?.count ?? 0) > 0 || (outlook.quotesOut?.count ?? 0) > 0;
    case 'received': return money.receivedToday > 0;
    case 'owed': return money.owed.length > 0;
    default: return true;
  }
}

/**
 * Drop the lines that talk about subjects the day is silent on.
 *
 * A line rather than the whole briefing: rejecting everything would send the
 * owner back to the templates over one bad sentence, which is how the flat
 * seven-bullet version reached them for weeks. The rest of the narration is
 * usually correct and worth keeping.
 */
export function dropUnsupportedLines(
  narrative: string,
  facts: BriefingFacts,
  language: BriefingLanguage
): { kept: string; dropped: string[] } {
  const words = SUBJECT_WORDS[language] ?? SUBJECT_WORDS.en;
  const dropped: string[] = [];

  const kept = narrative
    .split('\n')
    .filter(line => {
      const haystack = line.toLowerCase();
      for (const [subject, needles] of Object.entries(words)) {
        if (subjectHasContent(subject, facts)) continue;
        if (needles.some(n => haystack.includes(n.toLowerCase()))) {
          dropped.push(line.trim());
          return false;
        }
      }
      return true;
    })
    .join('\n');

  return { kept, dropped };
}

function cleanNarrative(content: string): string {
  return content
    .replace(/^```[a-z]*\n?/i, '')
    .replace(/```$/, '')
    .replace(/^["']|["']$/g, '')
    .trim();
}
