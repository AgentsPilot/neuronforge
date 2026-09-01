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
  other: { en: 'Service Provider', he: 'נותן שירות', es: 'Proveedor de Servicios' },
  default: { en: 'Service Provider', he: 'נותן שירות', es: 'Proveedor de Servicios' },
};

/**
 * @returns the business type in `language`, or the stored key itself when we
 *          have no name for it — an unrecognised vertical is still better shown
 *          than blanked out.
 */
export function getVerticalLabel(
  vertical: string | null | undefined,
  language: VerticalLanguage = 'en'
): string {
  if (!vertical) return '';
  return VERTICAL_NAMES[vertical]?.[language] || vertical;
}
