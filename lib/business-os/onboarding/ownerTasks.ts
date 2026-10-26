/**
 * What only the owner can do, decided once for every screen that asks.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * Two screens asked this question, one click apart, and each kept its own
 * answer. The build screen worked it out from the owner's answers — hours
 * where something is booked, a processor where a card is taken, bank details
 * where an invoice goes out, the intake form to read. The plan screen before
 * it had only ever grown the two money ones.
 *
 * So the plan said "1 needs you" where the build then showed three. The plan
 * exists so somebody can decide with the cost in view, and it was understating
 * that cost and then surprising them with it. Reported exactly that way:
 * "nothing about complete configuration for the services, nothing about the
 * invoice or availability".
 *
 * Neither list carried "finish your services", though both screens say in as
 * many words that the services are drafts. The one task the owner will
 * certainly do was the one nobody counted.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS HERE AND WHAT IS NOT
 *
 * The CONDITIONS and the WORDS, because both were duplicated and both drifted.
 * Not the rendering: the build screen draws these as steps with a result line,
 * the plan draws them as cards with a note, and those are genuinely different
 * shapes. Each screen formats `minutes` into its own sentence.
 *
 * This is deliberately NOT `journeyReadiness`, which answers a neighbouring
 * question — "what blocks this business trading right now" — against the live
 * database. This one reads a plan that has not been built yet, from answers
 * given minutes ago, and includes work that blocks nothing (reading the intake
 * form) while leaving out gaps that no owner can act on during onboarding.
 * Merging them would mean one of the two questions being answered badly.
 *
 * @module lib/business-os/onboarding/ownerTasks
 */

export type OwnerTaskKey = 'services' | 'availability' | 'intake' | 'stripe' | 'bank';

export type OwnerTaskLanguage = 'en' | 'he' | 'es';

export interface OwnerTask {
  key: OwnerTaskKey;
  /** The thing itself, as the owner would name it. */
  title: string;
  /** Why it matters, and why nobody else can do it. */
  body: string;
  /** Roughly how long, for a screen to phrase however it phrases it. */
  minutes: number;
  /**
   * Tasks that have to be done before this one can finish, where those tasks
   * are themselves owed. Empty for everything the owner can do in any order.
   *
   * ─────────────────────────────────────────────────────────────────────────
   * MEASURED, and the reason this field exists. An owner started with the
   * services card, filled a service in, pressed Publish and was told:
   *
   *   "Your services ask clients to pick a time, but you have no working
   *    hours set. Some services are billed by invoice, but there would be no
   *    way to send one. Still needed: business name, tax ID, business
   *    address, bank details."
   *
   * Every one of those is another card on the same screen. The list presented
   * five equal choices while one of them silently required three of the
   * others, so the owner picked the only one that could not be finished yet
   * and met a wall of work they had already been shown.
   *
   * `journeyReadiness` is where that refusal comes from, and it is right to
   * refuse. What was missing is that the screen offering the work knew none
   * of it.
   * ─────────────────────────────────────────────────────────────────────────
   */
  dependsOn: OwnerTaskKey[];
}

/**
 * What the two screens know about the business when they ask.
 *
 * Shaped around what onboarding actually holds rather than around either
 * screen's props: a catalogue that is usually EMPTY plus a count, because the
 * interview asks how many services there are rather than for a list of them.
 */
export interface OwnerTaskInput {
  /** Rows where they exist. Usually empty at this point; the count decides. */
  services?: Array<{ is_scheduled?: boolean; collection?: 'online' | 'invoice' | null }>;
  /** How many the build will create, from whichever source knows. */
  serviceCount?: number;
  sellsScheduled?: boolean;
  collectionMethod?: 'card_online' | 'invoice' | 'in_person' | 'mixed' | 'none' | null;
  needsIntake?: boolean;
}

interface Copy {
  title: Record<OwnerTaskLanguage, string>;
  body: Record<OwnerTaskLanguage, string>;
  minutes: number;
}

/**
 * The words, in one table.
 *
 * No dashes between clauses, in any language: a dash joins two half-thoughts
 * without saying how they relate, and `noDashesInOnboardingCopy` fails the
 * screens that render these.
 */
const COPY: Record<OwnerTaskKey, Copy> = {
  services: {
    title: {
      en: 'Finish your services',
      he: 'להשלים את השירותים',
      es: 'Completar tus servicios',
    },
    body: {
      en: 'I create them as drafts with their names. The price and the length are yours, and nothing can be booked without them.',
      he: 'אקים אותם כטיוטות עם השמות. המחיר ומשך הזמן הם שלך, ובלעדיהם אי אפשר להזמין.',
      es: 'Los dejo como borradores con sus nombres. El precio y la duración son tuyos, y sin ellos no se puede reservar.',
    },
    minutes: 3,
  },
  availability: {
    title: {
      en: 'Your working hours',
      he: 'שעות העבודה שלך',
      es: 'Tu horario',
    },
    body: {
      en: 'Only you know when you work. Without it there is nothing to book.',
      he: 'רק אתה יודע מתי אתה עובד. בלי זה אין מה להזמין.',
      es: 'Solo tú sabes cuándo trabajas. Sin eso no hay nada que reservar.',
    },
    minutes: 2,
  },
  intake: {
    title: {
      en: 'Your intake form',
      he: 'טופס הפנייה שלך',
      es: 'Tu formulario de admisión',
    },
    /*
     * READ, not write. The build generates the form and switches it on, under
     * the same `needsIntake` that puts this task on screen, so an owner who
     * sees this already has the questions. The copy told them to pick a
     * template and build it, which described work the platform had just done.
     */
    body: {
      en: 'I write it from what you told me. Read the questions before a client does.',
      he: 'אכתוב אותו לפי מה שסיפרת. עבור על השאלות לפני שלקוח רואה אותן.',
      es: 'Lo escribo con lo que me contaste. Revisa las preguntas antes de que las vea un cliente.',
    },
    minutes: 2,
  },
  stripe: {
    title: {
      en: 'Connect payments',
      he: 'חיבור תשלומים',
      es: 'Conectar pagos',
    },
    body: {
      en: 'Stripe asks for your ID and a bank account, so this one only you can do.',
      he: 'סטרייפ מבקשת תעודת זהות וחשבון בנק, אז את זה רק אתה יכול לעשות.',
      es: 'Stripe pide tu identificación y una cuenta bancaria, así que esto solo lo puedes hacer tú.',
    },
    minutes: 5,
  },
  bank: {
    title: {
      en: 'Your bank details',
      he: 'פרטי הבנק שלך',
      es: 'Tus datos bancarios',
    },
    body: {
      en: 'They go on every invoice. It is where your client learns to send the money. Nobody can type them but you.',
      he: 'הם מופיעים בכל חשבונית. משם הלקוח יודע לאן להעביר. אף אחד לא יכול להקליד אותם חוץ ממך.',
      es: 'Van en cada factura. Es donde tu cliente aprende a dónde enviar el dinero. Nadie puede escribirlos salvo tú.',
    },
    minutes: 2,
  },
};

/**
 * Which of these this business owes, in the order it will meet them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SERVICES DECIDE, AND THE BUSINESS-WIDE ANSWER IS THE FALLBACK.
 *
 * Where rows exist they are the truth, because a client walks through a
 * service and not through a setting: one account can hold a free session, an
 * invoiced programme and one taking a card, and no single answer describes
 * that. Where no rows exist yet — the ordinary case on the plan screen, which
 * is shown before anything is created — the owner's own answer stands in.
 *
 * NOT FROM PRICES, ever. The interview collects a count, whether clients book,
 * and how money arrives, and leaves every price to the services editor. A
 * `price > 0` test here is always false and silently empties this list; that
 * exact gate has been written and removed five times across these screens.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function ownerTasks(input: OwnerTaskInput, language: OwnerTaskLanguage): OwnerTask[] {
  const rows = input.services ?? [];
  const planned = Math.max(rows.length, input.serviceCount ?? 0);
  const hasServices = planned > 0;

  const money = input.collectionMethod;

  const wantsHours = rows.length
    ? rows.some(row => row.is_scheduled !== false)
    : hasServices && input.sellsScheduled !== false;

  const collectsOnline = rows.length
    ? rows.some(row => row.collection === 'online')
    : hasServices && (money === 'card_online' || money === 'mixed');

  /*
   * `!== 'online'` per row, deliberately: a service whose collection is null
   * is one whose money question is unsettled, and the owner still owes the
   * paperwork that lets them bill for it. The business-wide fallback has no
   * such ambiguity, so it names the three answers that mean a document.
   */
  const invoicesSome = rows.length
    ? rows.some(row => row.collection !== 'online')
    : hasServices && (money === 'invoice' || money === 'in_person' || money === 'mixed');

  /*
   * DEPENDENCIES FIRST, AND THE SERVICES LAST.
   *
   * This listed the catalogue first, on the reasoning that it is what the
   * owner meets first. It is also the only task that cannot be finished until
   * the others are: publishing a service is refused without working hours, a
   * processor, or the invoice details, all of which are cards further down the
   * same list. Offering it first sent people at the one wall on the screen.
   *
   * So: the hours a booking needs, then the money, then the form a client
   * fills, and the catalogue last, where everything it needs is already done.
   */
  const owed: OwnerTaskKey[] = [];
  if (wantsHours) owed.push('availability');
  if (collectsOnline) owed.push('stripe');
  if (invoicesSome) owed.push('bank');
  if (input.needsIntake) owed.push('intake');
  if (hasServices) owed.push('services');

  /*
   * Only what this business actually owes counts as a dependency. A coach who
   * takes no cards is not waiting on Stripe, and saying so would invent a
   * blocker out of a task that was never on the list.
   */
  const blockers = owed.filter(key => key === 'availability' || key === 'stripe' || key === 'bank');

  return owed.map(key => ({
    key,
    title: COPY[key].title[language],
    body: COPY[key].body[language],
    minutes: COPY[key].minutes,
    /* Publishing is what has the dependencies; nothing else here waits. */
    dependsOn: key === 'services' ? blockers : [],
  }));
}

/** Every task this module can produce, for tests and for exhaustiveness. */
export const OWNER_TASK_KEYS = Object.keys(COPY) as OwnerTaskKey[];
