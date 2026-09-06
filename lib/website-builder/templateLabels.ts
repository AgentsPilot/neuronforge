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

// Helper function to get translated template name
export const getTranslatedTemplateName = (name: string, lang: 'en' | 'es' | 'he'): string => {
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
