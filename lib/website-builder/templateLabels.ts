/**
 * How a template, a vertical and a brand voice are named to a person.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * These lived as private copies in the website page AND the website setup
 * wizard, and the landing page wizard — which now offers the same templates —
 * had none at all, so it rendered "Academic Tutor / professional" untranslated
 * beside two surfaces that translate them. Three places offering one catalogue
 * have to name it one way.
 *
 * Only the labels live here. The templates themselves are the catalogue's.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type TemplateLabelLanguage = 'en' | 'es' | 'he';

export const TEMPLATE_NAMES: Record<string, { en: string; es: string; he: string }> = {
  // Therapist
  'Warm & Welcoming': { en: 'Warm & Welcoming', es: 'Cálido y Acogedor', he: 'חם ומזמין' },
  'Professional & Clinical': { en: 'Professional & Clinical', es: 'Profesional y Clínico', he: 'מקצועי וקליני' },
  'Modern & Minimal': { en: 'Modern & Minimal', es: 'Moderno y Minimalista', he: 'מודרני ומינימליסטי' },
  'Specialized (Trauma-Focused)': { en: 'Specialized (Trauma-Focused)', es: 'Especializado (Trauma)', he: 'מתמחה (טראומה)' },
  // Coach
  'Inspiring Transformation': { en: 'Inspiring Transformation', es: 'Transformación Inspiradora', he: 'טרנספורמציה מעוררת השראה' },
  'Professional Executive': { en: 'Professional Executive', es: 'Ejecutivo Profesional', he: 'מנהל מקצועי' },
  'Wellness & Mindfulness': { en: 'Wellness & Mindfulness', es: 'Bienestar y Mindfulness', he: 'בריאות ומיינדפולנס' },
  'Career Transition': { en: 'Career Transition', es: 'Transición de Carrera', he: 'מעבר קריירה' },
  // Consultant
  'Professional Services': { en: 'Professional Services', es: 'Servicios Profesionales', he: 'שירותים מקצועיים' },
  'Technology Advisory': { en: 'Technology Advisory', es: 'Asesoría Tecnológica', he: 'ייעוץ טכנולוגי' },
  'Marketing Consultant': { en: 'Marketing Consultant', es: 'Consultor de Marketing', he: 'יועץ שיווק' },
  'Financial Advisory': { en: 'Financial Advisory', es: 'Asesoría Financiera', he: 'ייעוץ פיננסי' },
  // Lawyer
  'Professional Law Firm': { en: 'Professional Law Firm', es: 'Firma de Abogados', he: 'משרד עורכי דין' },
  'Personal Injury Specialist': { en: 'Personal Injury Specialist', es: 'Especialista en Lesiones', he: 'מומחה נזקי גוף' },
  'Family Law Practice': { en: 'Family Law Practice', es: 'Derecho de Familia', he: 'דיני משפחה' },
  'Criminal Defense': { en: 'Criminal Defense', es: 'Defensa Penal', he: 'סנגוריה פלילית' },
  // Photographer
  'Minimal Portfolio': { en: 'Minimal Portfolio', es: 'Portafolio Minimalista', he: 'תיק עבודות מינימליסטי' },
  'Wedding Photography': { en: 'Wedding Photography', es: 'Fotografía de Bodas', he: 'צילום חתונות' },
  'Commercial Photography': { en: 'Commercial Photography', es: 'Fotografía Comercial', he: 'צילום מסחרי' },
  'Portrait Photography': { en: 'Portrait Photography', es: 'Fotografía de Retratos', he: 'צילום פורטרטים' },
  // Real Estate
  'Luxury Real Estate': { en: 'Luxury Real Estate', es: 'Bienes Raíces de Lujo', he: 'נדל"ן יוקרתי' },
  'Family Homes Specialist': { en: 'Family Homes Specialist', es: 'Especialista en Hogares', he: 'מומחה בתי משפחה' },
  'Commercial Real Estate': { en: 'Commercial Real Estate', es: 'Bienes Raíces Comerciales', he: 'נדל"ן מסחרי' },
  'First-Time Buyer Expert': { en: 'First-Time Buyer Expert', es: 'Experto en Primeros Compradores', he: 'מומחה רוכשים ראשונים' },
  // Personal Trainer
  'Gym Fitness Pro': { en: 'Gym Fitness Pro', es: 'Profesional del Fitness', he: 'מאמן כושר מקצועי' },
  'Wellness Coach': { en: 'Wellness Coach', es: 'Coach de Bienestar', he: 'מאמן בריאות' },
  'Sports Performance': { en: 'Sports Performance', es: 'Rendimiento Deportivo', he: 'ביצועי ספורט' },
  // Tutor
  'Academic Tutor': { en: 'Academic Tutor', es: 'Tutor Académico', he: 'מורה פרטי' },
  'Test Prep Expert': { en: 'Test Prep Expert', es: 'Experto en Preparación', he: 'מומחה הכנה למבחנים' },
  'Language Tutor': { en: 'Language Tutor', es: 'Tutor de Idiomas', he: 'מורה לשפות' }
};

// Vertical translations
export const VERTICAL_NAMES: Record<string, { en: string; es: string; he: string }> = {
  therapist: { en: 'Therapist', es: 'Terapeuta', he: 'מטפל' },
  coach: { en: 'Coach', es: 'Coach', he: 'מאמן' },
  consultant: { en: 'Consultant', es: 'Consultor', he: 'יועץ' },
  lawyer: { en: 'Lawyer', es: 'Abogado', he: 'עורך דין' },
  photographer: { en: 'Photographer', es: 'Fotógrafo', he: 'צלם' },
  real_estate: { en: 'Real Estate', es: 'Bienes Raíces', he: 'נדל"ן' },
  personal_trainer: { en: 'Personal Trainer', es: 'Entrenador Personal', he: 'מאמן אישי' },
  tutor: { en: 'Tutor', es: 'Tutor', he: 'מורה פרטי' }
};

/**
 * A template's name, in the platform's language.
 *
 * Pass the `id` whenever you have it. `TEMPLATE_NAMES` is keyed by the DISPLAY
 * NAME of a vertical template ("Academic Tutor"), and the six archetypes are
 * named in `ARCHETYPE_LABELS` keyed by id — so an archetype found nothing here
 * and fell through to its raw name, and a Hebrew business was offered
 * "Stone / Warm / Bloom / Bold / Lumen / Aster" in English, under a Hebrew
 * heading, with four of the six already translated a few lines away.
 *
 * The id wins where both exist: it is the identity, and the name is a label
 * that a catalogue row is free to change.
 */
export const getTranslatedTemplateName = (
  name: string,
  lang: 'en' | 'es' | 'he',
  id?: string | null
): string => {
  const archetype = id ? ARCHETYPE_LABELS[id] : undefined;
  if (archetype) return archetype.name[lang] || archetype.name.en;
  return TEMPLATE_NAMES[name]?.[lang] || name;
};

// Helper function to get translated vertical name
export const getTranslatedVertical = (vertical: string, lang: 'en' | 'es' | 'he'): string => {
  return VERTICAL_NAMES[vertical]?.[lang] || vertical;
};

// Brand voice translations
export const BRAND_VOICE_TRANSLATIONS: Record<string, { en: string; es: string; he: string }> = {
  'warm': { en: 'Warm', es: 'Cálido', he: 'חם ומזמין' },
  'professional': { en: 'Professional', es: 'Profesional', he: 'מקצועי וקליני' },
  'minimal': { en: 'Minimal', es: 'Minimalista', he: 'מודרני ומינימליסטי' },
  'bold': { en: 'Bold', es: 'Audaz', he: 'נועז' },
  'elegant': { en: 'Elegant', es: 'Elegante', he: 'אלגנטי' },
  'creative': { en: 'Creative', es: 'Creativo', he: 'יצירתי' },
};

// Helper function to get translated brand voice
export const getTranslatedBrandVoice = (voice: string, lang: 'en' | 'es' | 'he'): string => {
  return BRAND_VOICE_TRANSLATIONS[voice]?.[lang] || voice;
};

/**
 * The four archetypes, named and described to a person.
 *
 * Here rather than in `archetypes.ts` for the reason at the top of this file:
 * an archetype is thirty token values and four layout names, and display copy
 * is neither. It also has to exist in three languages, and the design objects
 * have no business carrying Spanish in them.
 *
 * `blurb` answers the only question an owner actually has in front of the
 * gallery — *is this one me?* — so each names the kind of business it suits
 * rather than describing its own palette. Somebody choosing a look for their
 * practice does not care that it is stone-grey; they care that it reads as
 * serious.
 */
export const ARCHETYPE_LABELS: Record<
  string,
  { name: Record<TemplateLabelLanguage, string>; blurb: Record<TemplateLabelLanguage, string> }
> = {
  stone: {
    name: { en: 'Stone', es: 'Piedra', he: 'אבן' },
    blurb: {
      en: 'Quiet and typographic. For advisors, lawyers and consultants.',
      es: 'Sobrio y tipográfico. Para asesores, abogados y consultores.',
      he: 'שקט וטיפוגרפי. ליועצים, עורכי דין ומומחים.',
    },
  },
  bloom: {
    name: { en: 'Bloom', es: 'Flor', he: 'פריחה' },
    blurb: {
      en: 'Warm and soft. For therapy, wellness and anything with children in it.',
      es: 'Cálido y suave. Para terapia, bienestar y todo lo que incluya niños.',
      he: 'חם ורך. לטיפול, בריאות וכל מה שיש בו ילדים.',
    },
  },
  lumen: {
    name: { en: 'Lumen', es: 'Lumen', he: 'לומן' },
    blurb: {
      en: 'Dark and image-led. For photographers, designers and beauty.',
      es: 'Oscuro y visual. Para fotógrafos, diseñadores y belleza.',
      he: 'כהה ומוביל בתמונה. לצלמים, מעצבים ויופי.',
    },
  },
  aster: {
    name: { en: 'Aster', es: 'Aster', he: 'אסטר' },
    blurb: {
      en: 'Bold and high contrast. For trainers, courses and anything sold.',
      es: 'Audaz y de alto contraste. Para entrenadores, cursos y ventas.',
      he: 'נועז ובניגודיות גבוהה. למאמנים, קורסים וכל מה שנמכר.',
    },
  },
  /*
   * Warm and Bold shipped without labels, so the gallery fell back to
   * `getArchetypeLabel`'s last resort — the raw id — and two of the six
   * templates were offered to a Hebrew business as the English words "warm"
   * and "bold" with no description at all.
   */
  warm: {
    name: { en: 'Warm', es: 'Cálido', he: 'חמים' },
    blurb: {
      en: 'Paper and serif, laid out in tiles. For studios, clinics and small practices.',
      es: 'Papel y serif, en mosaico. Para estudios, clínicas y consultas pequeñas.',
      he: 'נייר וגופן מסורתי, בפריסת אריחים. לסטודיו, קליניקה ועסק קטן.',
    },
  },
  bold: {
    name: { en: 'Bold', es: 'Intenso', he: 'נועז' },
    blurb: {
      en: 'Night and flame, set in mono. For courses, coaching and launches.',
      es: 'Noche y fuego, en monoespaciada. Para cursos, coaching y lanzamientos.',
      he: 'כהה ולוהט, בגופן אחיד. לקורסים, אימון והשקות.',
    },
  },
};

/** An archetype's name and blurb, falling back to English and then to its id. */
export function getArchetypeLabel(
  id: string,
  language: TemplateLabelLanguage = 'en'
): { name: string; blurb: string } {
  const entry = ARCHETYPE_LABELS[id];
  if (!entry) return { name: id, blurb: '' };
  return {
    name: entry.name[language] || entry.name.en,
    blurb: entry.blurb[language] || entry.blurb.en,
  };
}
