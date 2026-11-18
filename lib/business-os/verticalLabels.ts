/**
 * What each business type is called, per language.
 *
 * `business_profiles.vertical` stores a machine key — `tutor`, `nail_tech` —
 * and the settings page was printing it raw, so a Hebrew account read "סוג עסק:
 * tutor". This is the same table onboarding already used to name the vertical
 * in conversation, moved here so the interface can read it too; it holds no
 * server dependencies, which is what kept it out of reach before.
 */

export type VerticalLanguage = 'en' | 'he' | 'es';

const VERTICAL_NAMES: Record<string, Record<VerticalLanguage, string>> = {
  therapist: { en: 'Therapist', he: 'מטפל/ת', es: 'Terapeuta' },
  coach: { en: 'Coach', he: 'מאמן/ת', es: 'Coach' },
  consultant: { en: 'Consultant', he: 'יועץ/ת', es: 'Consultor' },
  lawyer: { en: 'Lawyer', he: 'עורך/ת דין', es: 'Abogado' },
  photographer: { en: 'Photographer', he: 'צלם/ת', es: 'Fotógrafo' },
  realtor: { en: 'Realtor', he: 'סוכן נדל"ן', es: 'Agente Inmobiliario' },
  trainer: { en: 'Trainer', he: 'מדריך/ה', es: 'Entrenador' },
  tutor: { en: 'Tutor / Teacher', he: 'מורה / מדריך', es: 'Tutor / Profesor' },
  beauty: { en: 'Beauty Professional', he: 'מקצועות היופי', es: 'Profesional de Belleza' },
  wellness: { en: 'Wellness', he: 'בריאות ורווחה', es: 'Bienestar' },
  // `beauty` appeared twice in the original map; the second entry silently
  // replaced the first, making "Beauty Professional" unreachable. Dropped:
  //   beauty: { en: 'Beauty', he: 'יופי וטיפוח', es: 'Belleza' },
  makeup_artist: { en: 'Makeup Artist', he: 'מאפרת', es: 'Maquilladora' },
  makeup: { en: 'Makeup Artist', he: 'מאפרת', es: 'Maquilladora' },
  esthetician: { en: 'Esthetician', he: 'קוסמטיקאית', es: 'Esteticista' },
  nail_tech: { en: 'Nail Technician', he: 'מניקוריסטית', es: 'Manicurista' },
  hairdresser: { en: 'Hairdresser', he: 'ספר/ית', es: 'Peluquero/a' },
  hairstylist: { en: 'Hairstylist', he: 'מעצב/ת שיער', es: 'Estilista' },
  barber: { en: 'Barber', he: 'ספר', es: 'Barbero' },
  spa: { en: 'Spa', he: 'ספא', es: 'Spa' },
  fitness: { en: 'Fitness', he: 'כושר', es: 'Fitness' },
  designer: { en: 'Designer', he: 'מעצב/ת', es: 'Diseñador' },
  accountant: { en: 'Accountant', he: 'רואה חשבון', es: 'Contador' },
  doctor: { en: 'Doctor', he: 'רופא/ה', es: 'Doctor' },
  dentist: { en: 'Dentist', he: 'רופא/ת שיניים', es: 'Dentista' },
  teacher: { en: 'Teacher / Educator', he: 'מורה / מחנך', es: 'Profesor / Educador' },
  educator: { en: 'Educator', he: 'מחנך/ת', es: 'Educador' },
  instructor: { en: 'Instructor', he: 'מדריך/ה', es: 'Instructor' },
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * THE TRADES, named for the presets added in `OnboardingConfigurationService`.
   *
   * A key with no name here is still shown — `getVerticalLabel` falls back to
   * the key itself — but a Hebrew account would read "home_services", which is
   * the failure this table was written to end.
   * ───────────────────────────────────────────────────────────────────────────
   */
  contractor: { en: 'Contractor', he: 'קבלן', es: 'Contratista' },
  home_services: { en: 'Home Services', he: 'שירותי בית', es: 'Servicios para el Hogar' },
  agency: { en: 'Agency', he: 'סוכנות', es: 'Agencia' },
  events: { en: 'Events', he: 'אירועים', es: 'Eventos' },
  pet_services: { en: 'Pet Services', he: 'שירותי חיות מחמד', es: 'Servicios para Mascotas' },
  auto_services: { en: 'Auto Services', he: 'שירותי רכב', es: 'Servicios Automotrices' },
  retail: { en: 'Retail / Shop', he: 'קמעונאות / חנות', es: 'Comercio / Tienda' },

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * `default` AND `other` ARE NOT BUSINESS TYPES, and printing them as one is
   * how an owner came to be told two contradictory things at once.
   *
   * Both are sentinels: `default` is the fallback pipeline preset's own key,
   * written when the story extraction cannot read a trade, and `other` is the
   * same thing under its previous name. `profileReadiness` knows that and
   * reports the business type as MISSING for either — while this table turned
   * them into "Service Provider", which reads as an answer somebody gave.
   *
   * Measured: a renovation contractor saw "Business type: Service Provider" in
   * settings and "business type missing" on the dashboard, in the same session,
   * and nothing on the platform could set the field.
   *
   * The names stay, because a caller that wants a word for an unplaced business
   * still needs one — `getVerticalDescriptor` writes website copy from it. What
   * changed is that asking for the LABEL of a sentinel now returns nothing, so
   * a screen showing a business type has to have one. See `getVerticalLabel`.
   * ───────────────────────────────────────────────────────────────────────────
   */
  other: { en: 'Service Provider', he: 'נותן שירות', es: 'Proveedor de Servicios' },
  default: { en: 'Service Provider', he: 'נותן שירות', es: 'Proveedor de Servicios' },
};

/**
 * The values `vertical` holds when nothing is known about the trade.
 *
 * The same pair `profileReadiness.UNKNOWN_VERTICALS` tests, declared here too
 * rather than imported: this module is loaded by client components and must
 * stay free of server-only imports, which is what kept it from reading that
 * one. Two short lists that must not drift, so each names the other.
 */
const SENTINEL_VERTICALS = new Set(['default', 'other']);

/**
 * Whether this value is a real answer about the business, or our fallback.
 *
 * Exported because every surface that PRINTS a business type needs to ask it
 * first. Three of them printed "Service Provider" for a field the dashboard was
 * simultaneously reporting as missing.
 */
export function isKnownVertical(vertical: string | null | undefined): boolean {
  return (
    typeof vertical === 'string' &&
    vertical.trim().length > 0 &&
    !SENTINEL_VERTICALS.has(vertical.trim().toLowerCase())
  );
}

/**
 * The business types a person may CHOOSE, in the settings picker.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT IS WRITTEN OUT RATHER THAN DERIVED FROM THE TABLE ABOVE
 *
 * `VERTICAL_NAMES` exists to NAME a stored value, so it carries spellings that
 * are the same trade twice — `makeup` beside `makeup_artist`, `hairstylist`
 * beside `hairdresser` — and both read identically to a person. Derived, this
 * list would show the same words twice and look broken.
 *
 * It is also not the pipeline-preset list. Those two answer different
 * questions: a preset exists where the stages differ, and `barber` shares a
 * beauty board while still being what somebody calls themselves. Choosing one
 * of these does not reseed a pipeline — the stages are seeded once, at
 * onboarding, and are the owner's to edit afterwards — so the only thing a
 * name without a preset costs is nothing.
 *
 * Ordered by trade family rather than alphabetically: the picker sorts by the
 * reader's own language at render time, and an English-ordered list would be
 * wrong in two of the three.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const SELECTABLE_VERTICALS: readonly string[] = [
  // Practices and professional services
  'therapist',
  'coach',
  'consultant',
  'lawyer',
  'accountant',
  'agency',
  'designer',
  // Health
  'doctor',
  'dentist',
  'wellness',
  // Teaching
  'teacher',
  'tutor',
  // Movement
  'fitness',
  'trainer',
  // Beauty
  'beauty',
  'hairdresser',
  'barber',
  'nail_tech',
  'makeup_artist',
  'esthetician',
  'spa',
  // Trades, homes and vehicles
  'contractor',
  'home_services',
  'auto_services',
  // Creative and property
  'photographer',
  'realtor',
  // Everything else with a board of its own
  'events',
  'pet_services',
  'retail',
];

/**
 * @returns the business type in `language`, or the stored key itself when we
 *          have no name for it — an unrecognised vertical is still better shown
 *          than blanked out. EMPTY for a sentinel: `default` and `other` are
 *          our fallbacks, not answers, and a label is for printing (see the
 *          note on those two entries). Callers that need to distinguish "not
 *          set" from "not loaded" ask `isKnownVertical`.
 */
export function getVerticalLabel(
  vertical: string | null | undefined,
  language: VerticalLanguage = 'en'
): string {
  if (!isKnownVertical(vertical)) return '';
  return VERTICAL_NAMES[vertical!]?.[language] || vertical!;
}
