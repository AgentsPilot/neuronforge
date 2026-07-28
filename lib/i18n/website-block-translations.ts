/**
 * Website Block Translations
 * Centralized translations for all website block UI strings
 * Supports: English (en), Spanish (es), Hebrew (he)
 */

import type { Locale } from './config';

type TranslationValue = string;
type TranslationRecord = Record<Locale, TranslationValue>;

interface BlockTranslations {
  // Common/Shared
  common: {
    learnMore: TranslationRecord;
    readMore: TranslationRecord;
    viewAll: TranslationRecord;
    bookNow: TranslationRecord;
    getStarted: TranslationRecord;
    contactUs: TranslationRecord;
    sendMessage: TranslationRecord;
    submit: TranslationRecord;
    loading: TranslationRecord;
    success: TranslationRecord;
    error: TranslationRecord;
    required: TranslationRecord;
    optional: TranslationRecord;
    close: TranslationRecord;
    back: TranslationRecord;
    next: TranslationRecord;
    previous: TranslationRecord;
    step: TranslationRecord;
    of: TranslationRecord;
    years: TranslationRecord;
    minutes: TranslationRecord;
    hours: TranslationRecord;
    perSession: TranslationRecord;
    free: TranslationRecord;
    popular: TranslationRecord;
    featured: TranslationRecord;
    new: TranslationRecord;
    recommended: TranslationRecord;
    clientsServed: TranslationRecord;
    reviews: TranslationRecord;
    at: TranslationRecord;
  };

  // Header Block
  header: {
    menu: TranslationRecord;
    home: TranslationRecord;
    about: TranslationRecord;
    services: TranslationRecord;
    pricing: TranslationRecord;
    testimonials: TranslationRecord;
    contact: TranslationRecord;
    faq: TranslationRecord;
    booking: TranslationRecord;
    blog: TranslationRecord;
  };

  // Hero Block
  hero: {
    defaultHeadline: TranslationRecord;
    defaultSubheadline: TranslationRecord;
    trustBadge: TranslationRecord;
    clientsServed: TranslationRecord;
    happyClients: TranslationRecord;
    yearsExperience: TranslationRecord;
    rating: TranslationRecord;
    reviews: TranslationRecord;
    awards: TranslationRecord;
  };

  // Services Block
  services: {
    title: TranslationRecord;
    subtitle: TranslationRecord;
    duration: TranslationRecord;
    price: TranslationRecord;
    bookService: TranslationRecord;
    viewDetails: TranslationRecord;
    selectService: TranslationRecord;
    ourServices: TranslationRecord;
    allServices: TranslationRecord;
  };

  // Testimonials Block
  testimonials: {
    title: TranslationRecord;
    subtitle: TranslationRecord;
    readStory: TranslationRecord;
    verifiedClient: TranslationRecord;
    whatClientsSay: TranslationRecord;
    clientStories: TranslationRecord;
  };

  // Stats Block
  stats: {
    simpleProcess: TranslationRecord;
  };

  // About Block
  about: {
    title: TranslationRecord;
    addPhoto: TranslationRecord;
    yearsExperience: TranslationRecord;
  };

  // Process Block
  process: {
    title: TranslationRecord;
    subtitle: TranslationRecord;
    simpleProcess: TranslationRecord;
    howItWorks: TranslationRecord;
  };

  // Contact Form Block
  contactForm: {
    title: TranslationRecord;
    subtitle: TranslationRecord;
    namePlaceholder: TranslationRecord;
    emailPlaceholder: TranslationRecord;
    phonePlaceholder: TranslationRecord;
    messagePlaceholder: TranslationRecord;
    submitButton: TranslationRecord;
    successMessage: TranslationRecord;
    errorMessage: TranslationRecord;
    nameLabel: TranslationRecord;
    emailLabel: TranslationRecord;
    phoneLabel: TranslationRecord;
    messageLabel: TranslationRecord;
  };

  // FAQ Block
  faq: {
    title: TranslationRecord;
    subtitle: TranslationRecord;
    haveQuestion: TranslationRecord;
    searchPlaceholder: TranslationRecord;
    noResults: TranslationRecord;
    frequentlyAskedQuestions: TranslationRecord;
  };

  // Pricing Block
  pricing: {
    title: TranslationRecord;
    subtitle: TranslationRecord;
    perMonth: TranslationRecord;
    perYear: TranslationRecord;
    perSession: TranslationRecord;
    oneTime: TranslationRecord;
    mostPopular: TranslationRecord;
    selectPlan: TranslationRecord;
    includes: TranslationRecord;
    startingAt: TranslationRecord;
  };

  // Features Block
  features: {
    title: TranslationRecord;
    subtitle: TranslationRecord;
    whyChooseUs: TranslationRecord;
  };

  // Team Block
  team: {
    title: TranslationRecord;
    subtitle: TranslationRecord;
    meetOurTeam: TranslationRecord;
  };

  // Booking Block
  booking: {
    title: TranslationRecord;
    subtitle: TranslationRecord;
    selectDate: TranslationRecord;
    selectTime: TranslationRecord;
    confirmBooking: TranslationRecord;
    bookingConfirmed: TranslationRecord;
    availableSlots: TranslationRecord;
    noSlotsAvailable: TranslationRecord;
    selectService: TranslationRecord;
  };

  // Newsletter Block
  newsletter: {
    title: TranslationRecord;
    subtitle: TranslationRecord;
    emailPlaceholder: TranslationRecord;
    subscribe: TranslationRecord;
    successMessage: TranslationRecord;
    privacyNote: TranslationRecord;
  };

  // CTA Block
  cta: {
    readyToStart: TranslationRecord;
    scheduleCall: TranslationRecord;
    getInTouch: TranslationRecord;
  };

  // Gallery Block
  gallery: {
    title: TranslationRecord;
    viewImage: TranslationRecord;
    imageOf: TranslationRecord;
  };

  // Intake Form Block
  intakeForm: {
    title: TranslationRecord;
    subtitle: TranslationRecord;
    submitForm: TranslationRecord;
    formSubmitted: TranslationRecord;
    requiredField: TranslationRecord;
    selectOption: TranslationRecord;
    other: TranslationRecord;
    yes: TranslationRecord;
    no: TranslationRecord;
  };
}

export const websiteBlockTranslations: BlockTranslations = {
  // Common/Shared translations
  common: {
    learnMore: { en: 'Learn more', es: 'Saber más', he: 'למד עוד' },
    readMore: { en: 'Read more', es: 'Leer más', he: 'קרא עוד' },
    viewAll: { en: 'View all', es: 'Ver todo', he: 'צפה בהכל' },
    bookNow: { en: 'Book Now', es: 'Reservar Ahora', he: 'הזמן עכשיו' },
    getStarted: { en: 'Get Started', es: 'Comenzar', he: 'התחל עכשיו' },
    contactUs: { en: 'Contact Us', es: 'Contáctenos', he: 'צור קשר' },
    sendMessage: { en: 'Send Message', es: 'Enviar Mensaje', he: 'שלח הודעה' },
    submit: { en: 'Submit', es: 'Enviar', he: 'שלח' },
    loading: { en: 'Loading...', es: 'Cargando...', he: 'טוען...' },
    success: { en: 'Success!', es: '¡Éxito!', he: 'הצלחה!' },
    error: { en: 'Error', es: 'Error', he: 'שגיאה' },
    required: { en: 'Required', es: 'Requerido', he: 'חובה' },
    optional: { en: 'Optional', es: 'Opcional', he: 'אופציונלי' },
    close: { en: 'Close', es: 'Cerrar', he: 'סגור' },
    back: { en: 'Back', es: 'Atrás', he: 'חזרה' },
    next: { en: 'Next', es: 'Siguiente', he: 'הבא' },
    previous: { en: 'Previous', es: 'Anterior', he: 'הקודם' },
    step: { en: 'Step', es: 'Paso', he: 'שלב' },
    of: { en: 'of', es: 'de', he: 'מתוך' },
    years: { en: 'Years', es: 'Años', he: 'שנים' },
    minutes: { en: 'minutes', es: 'minutos', he: 'דקות' },
    hours: { en: 'hours', es: 'horas', he: 'שעות' },
    perSession: { en: 'per session', es: 'por sesión', he: 'לפגישה' },
    free: { en: 'Free', es: 'Gratis', he: 'חינם' },
    popular: { en: 'Popular', es: 'Popular', he: 'פופולרי' },
    featured: { en: 'Featured', es: 'Destacado', he: 'מומלץ' },
    new: { en: 'New', es: 'Nuevo', he: 'חדש' },
    recommended: { en: 'Recommended', es: 'Recomendado', he: 'מומלץ' },
    clientsServed: { en: 'clients served', es: 'clientes atendidos', he: 'לקוחות שירתנו' },
    reviews: { en: 'reviews', es: 'reseñas', he: 'ביקורות' },
    at: { en: 'at', es: 'en', he: 'ב' },
  },

  // Header Block
  header: {
    menu: { en: 'Menu', es: 'Menú', he: 'תפריט' },
    home: { en: 'Home', es: 'Inicio', he: 'בית' },
    about: { en: 'About', es: 'Acerca de', he: 'אודות' },
    services: { en: 'Services', es: 'Servicios', he: 'שירותים' },
    pricing: { en: 'Pricing', es: 'Precios', he: 'מחירון' },
    testimonials: { en: 'Testimonials', es: 'Testimonios', he: 'המלצות' },
    contact: { en: 'Contact', es: 'Contacto', he: 'צור קשר' },
    faq: { en: 'FAQ', es: 'Preguntas', he: 'שאלות נפוצות' },
    booking: { en: 'Book Now', es: 'Reservar', he: 'הזמן תור' },
    blog: { en: 'Blog', es: 'Blog', he: 'בלוג' },
  },

  // Hero Block
  hero: {
    defaultHeadline: { en: 'Welcome', es: 'Bienvenido', he: 'ברוכים הבאים' },
    defaultSubheadline: {
      en: 'Your trusted professional',
      es: 'Tu profesional de confianza',
      he: 'המקצוען שלך'
    },
    trustBadge: { en: 'Trusted by', es: 'Confiado por', he: 'מהימן על ידי' },
    clientsServed: { en: 'Clients Served', es: 'Clientes Atendidos', he: 'לקוחות שירתנו' },
    happyClients: { en: 'Happy Clients', es: 'Clientes Felices', he: 'לקוחות מרוצים' },
    yearsExperience: { en: 'Years Experience', es: 'Años de Experiencia', he: 'שנות ניסיון' },
    rating: { en: 'Rating', es: 'Calificación', he: 'דירוג' },
    reviews: { en: 'Reviews', es: 'Reseñas', he: 'ביקורות' },
    awards: { en: 'Awards', es: 'Premios', he: 'פרסים' },
  },

  // Services Block
  services: {
    title: { en: 'Our Services', es: 'Nuestros Servicios', he: 'השירותים שלנו' },
    subtitle: {
      en: 'How we can help you',
      es: 'Cómo podemos ayudarte',
      he: 'איך נוכל לעזור לך'
    },
    duration: { en: 'Duration', es: 'Duración', he: 'משך' },
    price: { en: 'Price', es: 'Precio', he: 'מחיר' },
    bookService: { en: 'Book Service', es: 'Reservar Servicio', he: 'הזמן שירות' },
    viewDetails: { en: 'View Details', es: 'Ver Detalles', he: 'צפה בפרטים' },
    selectService: { en: 'Select Service', es: 'Seleccionar Servicio', he: 'בחר שירות' },
    ourServices: { en: 'Our Services', es: 'Nuestros Servicios', he: 'השירותים שלנו' },
    allServices: { en: 'All Services', es: 'Todos los Servicios', he: 'כל השירותים' },
  },

  // Testimonials Block
  testimonials: {
    title: { en: 'Testimonials', es: 'Testimonios', he: 'המלצות' },
    subtitle: {
      en: 'What our clients say',
      es: 'Lo que dicen nuestros clientes',
      he: 'מה הלקוחות שלנו אומרים'
    },
    readStory: { en: 'Read Story', es: 'Leer Historia', he: 'קרא את הסיפור' },
    verifiedClient: { en: 'Verified Client', es: 'Cliente Verificado', he: 'לקוח מאומת' },
    whatClientsSay: {
      en: 'What Our Clients Say',
      es: 'Lo Que Dicen Nuestros Clientes',
      he: 'מה הלקוחות שלנו אומרים'
    },
    clientStories: { en: 'Client Stories', es: 'Historias de Clientes', he: 'סיפורי לקוחות' },
  },

  // Stats Block
  stats: {
    simpleProcess: { en: 'Simple Process', es: 'Proceso Simple', he: 'תהליך פשוט' },
  },

  // About Block
  about: {
    title: { en: 'About', es: 'Acerca de', he: 'אודות' },
    addPhoto: { en: 'Add your photo', es: 'Agrega tu foto', he: 'הוסיפו תמונה' },
    yearsExperience: { en: 'Years Experience', es: 'Años de Experiencia', he: 'שנות ניסיון' },
  },

  // Process Block
  process: {
    title: { en: 'How It Works', es: 'Cómo Funciona', he: 'איך זה עובד' },
    subtitle: {
      en: 'Simple steps to get started',
      es: 'Pasos simples para comenzar',
      he: 'צעדים פשוטים להתחלה'
    },
    simpleProcess: { en: 'Simple Process', es: 'Proceso Simple', he: 'תהליך פשוט' },
    howItWorks: { en: 'How It Works', es: 'Cómo Funciona', he: 'איך זה עובד' },
  },

  // Contact Form Block
  contactForm: {
    title: { en: 'Contact Us', es: 'Contáctenos', he: 'צור קשר' },
    subtitle: {
      en: "We'd love to hear from you",
      es: 'Nos encantaría saber de ti',
      he: 'נשמח לשמוע ממך'
    },
    namePlaceholder: { en: 'Your name', es: 'Tu nombre', he: 'השם שלך' },
    emailPlaceholder: { en: 'Your email', es: 'Tu correo', he: 'האימייל שלך' },
    phonePlaceholder: { en: 'Your phone', es: 'Tu teléfono', he: 'הטלפון שלך' },
    messagePlaceholder: { en: 'Your message', es: 'Tu mensaje', he: 'ההודעה שלך' },
    submitButton: { en: 'Send Message', es: 'Enviar Mensaje', he: 'שלח הודעה' },
    successMessage: {
      en: 'Message sent successfully!',
      es: '¡Mensaje enviado con éxito!',
      he: 'ההודעה נשלחה בהצלחה!'
    },
    errorMessage: {
      en: 'Failed to send message. Please try again.',
      es: 'Error al enviar el mensaje. Por favor intenta de nuevo.',
      he: 'שליחת ההודעה נכשלה. אנא נסה שוב.'
    },
    nameLabel: { en: 'Name', es: 'Nombre', he: 'שם' },
    emailLabel: { en: 'Email', es: 'Correo', he: 'אימייל' },
    phoneLabel: { en: 'Phone', es: 'Teléfono', he: 'טלפון' },
    messageLabel: { en: 'Message', es: 'Mensaje', he: 'הודעה' },
  },

  // FAQ Block
  faq: {
    title: { en: 'Frequently Asked Questions', es: 'Preguntas Frecuentes', he: 'שאלות נפוצות' },
    subtitle: {
      en: 'Find answers to common questions',
      es: 'Encuentra respuestas a preguntas comunes',
      he: 'מצא תשובות לשאלות נפוצות'
    },
    haveQuestion: {
      en: 'Have a question?',
      es: '¿Tienes una pregunta?',
      he: 'יש לך שאלה?'
    },
    searchPlaceholder: { en: 'Search questions...', es: 'Buscar preguntas...', he: 'חפש שאלות...' },
    noResults: {
      en: 'No questions found',
      es: 'No se encontraron preguntas',
      he: 'לא נמצאו שאלות'
    },
    frequentlyAskedQuestions: { en: 'Frequently Asked Questions', es: 'Preguntas Frecuentes', he: 'שאלות נפוצות' },
  },

  // Pricing Block
  pricing: {
    title: { en: 'Pricing', es: 'Precios', he: 'מחירון' },
    subtitle: {
      en: 'Choose the plan that fits you',
      es: 'Elige el plan que te conviene',
      he: 'בחר את התוכנית המתאימה לך'
    },
    perMonth: { en: '/month', es: '/mes', he: '/לחודש' },
    perYear: { en: '/year', es: '/año', he: '/לשנה' },
    perSession: { en: '/session', es: '/sesión', he: '/לפגישה' },
    oneTime: { en: 'One-time', es: 'Pago único', he: 'תשלום חד פעמי' },
    mostPopular: { en: 'Most Popular', es: 'Más Popular', he: 'הכי פופולרי' },
    selectPlan: { en: 'Select Plan', es: 'Seleccionar Plan', he: 'בחר תוכנית' },
    includes: { en: 'Includes', es: 'Incluye', he: 'כולל' },
    startingAt: { en: 'Starting at', es: 'Desde', he: 'החל מ-' },
  },

  // Features Block
  features: {
    title: { en: 'Features', es: 'Características', he: 'תכונות' },
    subtitle: {
      en: 'What makes us different',
      es: 'Lo que nos diferencia',
      he: 'מה הופך אותנו לשונים'
    },
    whyChooseUs: { en: 'Why Choose Us', es: 'Por Qué Elegirnos', he: 'למה לבחור בנו' },
  },

  // Team Block
  team: {
    title: { en: 'Our Team', es: 'Nuestro Equipo', he: 'הצוות שלנו' },
    subtitle: {
      en: 'Meet the experts',
      es: 'Conoce a los expertos',
      he: 'הכירו את המומחים'
    },
    meetOurTeam: { en: 'Meet Our Team', es: 'Conoce a Nuestro Equipo', he: 'הכירו את הצוות שלנו' },
  },

  // Booking Block
  booking: {
    title: { en: 'Book an Appointment', es: 'Reservar una Cita', he: 'הזמן תור' },
    subtitle: {
      en: 'Choose a convenient time',
      es: 'Elige un horario conveniente',
      he: 'בחר זמן נוח'
    },
    selectDate: { en: 'Select Date', es: 'Seleccionar Fecha', he: 'בחר תאריך' },
    selectTime: { en: 'Select Time', es: 'Seleccionar Hora', he: 'בחר שעה' },
    confirmBooking: { en: 'Confirm Booking', es: 'Confirmar Reserva', he: 'אשר הזמנה' },
    bookingConfirmed: { en: 'Booking Confirmed!', es: '¡Reserva Confirmada!', he: 'ההזמנה אושרה!' },
    availableSlots: { en: 'Available Slots', es: 'Horarios Disponibles', he: 'זמנים פנויים' },
    noSlotsAvailable: {
      en: 'No slots available',
      es: 'No hay horarios disponibles',
      he: 'אין זמנים פנויים'
    },
    selectService: { en: 'Select a Service', es: 'Selecciona un Servicio', he: 'בחר שירות' },
  },

  // Newsletter Block
  newsletter: {
    title: { en: 'Stay Updated', es: 'Mantente Actualizado', he: 'הישאר מעודכן' },
    subtitle: {
      en: 'Subscribe to our newsletter',
      es: 'Suscríbete a nuestro boletín',
      he: 'הירשם לניוזלטר שלנו'
    },
    emailPlaceholder: { en: 'Enter your email', es: 'Ingresa tu correo', he: 'הכנס את האימייל שלך' },
    subscribe: { en: 'Subscribe', es: 'Suscribirse', he: 'הירשם' },
    successMessage: {
      en: 'Successfully subscribed!',
      es: '¡Suscripción exitosa!',
      he: 'נרשמת בהצלחה!'
    },
    privacyNote: {
      en: "We respect your privacy. Unsubscribe at any time.",
      es: 'Respetamos tu privacidad. Cancela cuando quieras.',
      he: 'אנו מכבדים את פרטיותך. בטל את הרישום בכל עת.'
    },
  },

  // CTA Block
  cta: {
    readyToStart: { en: 'Ready to Get Started?', es: '¿Listo para Comenzar?', he: 'מוכן להתחיל?' },
    scheduleCall: { en: 'Schedule a Call', es: 'Programar Llamada', he: 'קבע שיחה' },
    getInTouch: { en: 'Get in Touch', es: 'Ponte en Contacto', he: 'צור קשר' },
  },

  // Gallery Block
  gallery: {
    title: { en: 'Gallery', es: 'Galería', he: 'גלריה' },
    viewImage: { en: 'View Image', es: 'Ver Imagen', he: 'צפה בתמונה' },
    imageOf: { en: 'Image {current} of {total}', es: 'Imagen {current} de {total}', he: 'תמונה {current} מתוך {total}' },
  },

  // Intake Form Block
  intakeForm: {
    title: { en: 'Intake Form', es: 'Formulario de Admisión', he: 'טופס קליטה' },
    subtitle: {
      en: 'Please fill out this form before your appointment',
      es: 'Por favor completa este formulario antes de tu cita',
      he: 'אנא מלא טופס זה לפני הפגישה שלך'
    },
    submitForm: { en: 'Submit Form', es: 'Enviar Formulario', he: 'שלח טופס' },
    formSubmitted: {
      en: 'Form submitted successfully!',
      es: '¡Formulario enviado con éxito!',
      he: 'הטופס נשלח בהצלחה!'
    },
    requiredField: { en: 'This field is required', es: 'Este campo es requerido', he: 'שדה חובה' },
    selectOption: { en: 'Select an option', es: 'Selecciona una opción', he: 'בחר אפשרות' },
    other: { en: 'Other', es: 'Otro', he: 'אחר' },
    yes: { en: 'Yes', es: 'Sí', he: 'כן' },
    no: { en: 'No', es: 'No', he: 'לא' },
  },
};

/**
 * Get a translation for a specific block and key
 */
export function getBlockTranslation(
  section: keyof BlockTranslations,
  key: string,
  locale: Locale
): string {
  const sectionTranslations = websiteBlockTranslations[section];
  if (!sectionTranslations) {
    return key;
  }

  const keyTranslations = (sectionTranslations as Record<string, TranslationRecord>)[key];
  if (!keyTranslations) {
    return key;
  }

  return keyTranslations[locale] || keyTranslations.en || key;
}

/**
 * Get all translations for a section
 */
export function getBlockSectionTranslations(
  section: keyof BlockTranslations,
  locale: Locale
): Record<string, string> {
  const sectionTranslations = websiteBlockTranslations[section];
  if (!sectionTranslations) {
    return {};
  }

  const result: Record<string, string> = {};
  for (const [key, translations] of Object.entries(sectionTranslations as Record<string, TranslationRecord>)) {
    result[key] = translations[locale] || translations.en || key;
  }

  return result;
}

/**
 * Hook-like function to get translations for a block
 * Use this in block components
 */
export function useBlockTranslations(section: keyof BlockTranslations, locale: Locale) {
  const t = (key: string): string => getBlockTranslation(section, key, locale);
  const translations = getBlockSectionTranslations(section, locale);

  return { t, translations };
}

/**
 * Type-safe translation helper that can be used in components
 */
export function createBlockTranslator<T extends keyof BlockTranslations>(
  section: T,
  locale: Locale
) {
  type SectionKeys = keyof BlockTranslations[T];

  return (key: SectionKeys): string => {
    return getBlockTranslation(section, key as string, locale);
  };
}

/**
 * Template content translations for block-specific fields
 * These translate the actual content stored in templates (titles, descriptions, CTAs)
 */
type TemplateContentTranslations = Record<string, TranslationRecord>;

const templateContentTranslations: TemplateContentTranslations = {
  // About Block content
  'About Me': { en: 'About Me', es: 'Sobre Mí', he: 'אודותיי' },
  'About Us': { en: 'About Us', es: 'Sobre Nosotros', he: 'אודותינו' },
  'About': { en: 'About', es: 'Acerca de', he: 'אודות' },
  'My Story': { en: 'My Story', es: 'Mi Historia', he: 'הסיפור שלי' },
  'Our Story': { en: 'Our Story', es: 'Nuestra Historia', he: 'הסיפור שלנו' },
  'Who We Are': { en: 'Who We Are', es: 'Quiénes Somos', he: 'מי אנחנו' },
  'Meet Your Therapist': { en: 'Meet Your Therapist', es: 'Conoce a Tu Terapeuta', he: 'הכירו את המטפל שלכם' },

  // Hero Headlines
  'A Safe Space for Healing and Growth': {
    en: 'A Safe Space for Healing and Growth',
    es: 'Un Espacio Seguro para Sanar y Crecer',
    he: 'מרחב בטוח לריפוי וצמיחה'
  },
  'Your Family Comes First': {
    en: 'Your Family Comes First',
    es: 'Tu Familia es lo Primero',
    he: 'המשפחה שלך קודמת'
  },
  'Evidence-Based Therapy for Lasting Change': {
    en: 'Evidence-Based Therapy for Lasting Change',
    es: 'Terapia Basada en Evidencia para un Cambio Duradero',
    he: 'טיפול מבוסס ראיות לשינוי מתמשך'
  },
  'Modern Therapy for Modern Life': {
    en: 'Modern Therapy for Modern Life',
    es: 'Terapia Moderna para la Vida Moderna',
    he: 'טיפול מודרני לחיים מודרניים'
  },
  'Professional Guidance for Every Step': {
    en: 'Professional Guidance for Every Step',
    es: 'Orientación Profesional en Cada Paso',
    he: 'הנחיה מקצועית לכל צעד'
  },

  // CTA Buttons
  'Schedule a Consultation': { en: 'Schedule a Consultation', es: 'Programar Consulta', he: 'קבע ייעוץ' },
  'Book Session': { en: 'Book Session', es: 'Reservar Sesión', he: 'הזמן פגישה' },
  'Book Now': { en: 'Book Now', es: 'Reservar Ahora', he: 'הזמן עכשיו' },
  'Request Appointment': { en: 'Request Appointment', es: 'Solicitar Cita', he: 'בקש תור' },
  'Get Started': { en: 'Get Started', es: 'Comenzar', he: 'התחל' },
  'Start Your Journey': { en: 'Start Your Journey', es: 'Comienza Tu Viaje', he: 'התחל את המסע שלך' },
  'Schedule a Call': { en: 'Schedule a Call', es: 'Programar Llamada', he: 'קבע שיחה' },
  'Contact Us': { en: 'Contact Us', es: 'Contáctenos', he: 'צור קשר' },
  'Learn More': { en: 'Learn More', es: 'Saber Más', he: 'למד עוד' },
  'Start Now': { en: 'Start Now', es: 'Empezar Ahora', he: 'התחל עכשיו' },
  'Book Your Free Call': { en: 'Book Your Free Call', es: 'Reserva Tu Llamada Gratis', he: 'הזמן שיחה חינם' },
  'Schedule Consultation': { en: 'Schedule Consultation', es: 'Programar Consulta', he: 'קבע ייעוץ' },
  'Find Your Balance': { en: 'Find Your Balance', es: 'Encuentra Tu Equilibrio', he: 'מצא את האיזון שלך' },
  'Free Strategy Call': { en: 'Free Strategy Call', es: 'Llamada de Estrategia Gratis', he: 'שיחת אסטרטגיה חינם' },
  'Book Free Call': { en: 'Book Free Call', es: 'Reservar Llamada Gratis', he: 'הזמן שיחה חינם' },
  'Free Assessment': { en: 'Free Assessment', es: 'Evaluación Gratis', he: 'הערכה חינם' },
  'Get Proposal': { en: 'Get Proposal', es: 'Obtener Propuesta', he: 'קבל הצעה' },
  'Free Consultation': { en: 'Free Consultation', es: 'Consulta Gratis', he: 'ייעוץ חינם' },
  'Free Case Review': { en: 'Free Case Review', es: 'Revisión de Caso Gratis', he: 'סקירת תיק חינם' },
  'Get Free Case Review': { en: 'Get Free Case Review', es: 'Obtener Revisión de Caso Gratis', he: 'קבל סקירת תיק חינם' },

  // Section Titles
  'Our Services': { en: 'Our Services', es: 'Nuestros Servicios', he: 'השירותים שלנו' },
  'Services': { en: 'Services', es: 'Servicios', he: 'שירותים' },
  'What We Offer': { en: 'What We Offer', es: 'Lo Que Ofrecemos', he: 'מה אנחנו מציעים' },
  'How It Works': { en: 'How It Works', es: 'Cómo Funciona', he: 'איך זה עובד' },
  'The Process': { en: 'The Process', es: 'El Proceso', he: 'התהליך' },
  'Simple Steps': { en: 'Simple Steps', es: 'Pasos Simples', he: 'צעדים פשוטים' },
  'What Our Clients Say': { en: 'What Our Clients Say', es: 'Lo Que Dicen Nuestros Clientes', he: 'מה הלקוחות שלנו אומרים' },
  'Testimonials': { en: 'Testimonials', es: 'Testimonios', he: 'המלצות' },
  'Client Stories': { en: 'Client Stories', es: 'Historias de Clientes', he: 'סיפורי לקוחות' },
  'Questions? Reach Out': { en: 'Questions? Reach Out', es: '¿Preguntas? Contáctanos', he: 'שאלות? צור קשר' },
  'Have Questions?': { en: 'Have Questions?', es: '¿Tienes Preguntas?', he: 'יש לך שאלות?' },
  'Get in Touch': { en: 'Get in Touch', es: 'Ponte en Contacto', he: 'צור קשר' },
  'Contact': { en: 'Contact', es: 'Contacto', he: 'יצירת קשר' },
  'Begin Your Healing Journey': { en: 'Begin Your Healing Journey', es: 'Comienza Tu Viaje de Sanación', he: 'התחל את מסע הריפוי שלך' },
  'Request an Appointment': { en: 'Request an Appointment', es: 'Solicita una Cita', he: 'בקש תור' },
  'Ready to Start?': { en: 'Ready to Start?', es: '¿Listo para Comenzar?', he: 'מוכן להתחיל?' },
  'Frequently Asked Questions': { en: 'Frequently Asked Questions', es: 'Preguntas Frecuentes', he: 'שאלות נפוצות' },
  'FAQ': { en: 'FAQ', es: 'Preguntas', he: 'שאלות נפוצות' },

  // Process Steps - Titles
  'Free Consultation': { en: 'Free Consultation', es: 'Consulta Gratuita', he: 'ייעוץ חינם' },
  'Initial Consultation': { en: 'Initial Consultation', es: 'Consulta Inicial', he: 'ייעוץ ראשוני' },
  'First Session': { en: 'First Session', es: 'Primera Sesión', he: 'פגישה ראשונה' },
  'Ongoing Growth': { en: 'Ongoing Growth', es: 'Crecimiento Continuo', he: 'צמיחה מתמשכת' },
  'Ongoing Support': { en: 'Ongoing Support', es: 'Apoyo Continuo', he: 'תמיכה מתמשכת' },
  'Schedule Consultation': { en: 'Schedule Consultation', es: 'Programar Consulta', he: 'קבע ייעוץ' },
  'First Appointment': { en: 'First Appointment', es: 'Primera Cita', he: 'פגישה ראשונה' },
  'Ongoing Care': { en: 'Ongoing Care', es: 'Cuidado Continuo', he: 'טיפול מתמשך' },
  'Book Online': { en: 'Book Online', es: 'Reservar en Línea', he: 'הזמן אונליין' },
  'Brief Intake': { en: 'Brief Intake', es: 'Admisión Breve', he: 'קליטה קצרה' },
  'Safety First': { en: 'Safety First', es: 'Seguridad Primero', he: 'בטיחות קודמת' },
  'Understanding Your Story': { en: 'Understanding Your Story', es: 'Entendiendo Tu Historia', he: 'הבנת הסיפור שלך' },
  'Processing & Healing': { en: 'Processing & Healing', es: 'Procesamiento y Sanación', he: 'עיבוד וריפוי' },
  'Integration': { en: 'Integration', es: 'Integración', he: 'אינטגרציה' },

  // Process Steps - Descriptions
  'A brief call to understand your needs and answer questions': {
    en: 'A brief call to understand your needs and answer questions',
    es: 'Una breve llamada para entender tus necesidades y responder preguntas',
    he: 'שיחה קצרה להבנת הצרכים שלך ומענה לשאלות'
  },
  'Begin your journey in a safe, supportive environment': {
    en: 'Begin your journey in a safe, supportive environment',
    es: 'Comienza tu viaje en un ambiente seguro y de apoyo',
    he: 'התחל את המסע שלך בסביבה בטוחה ותומכת'
  },
  'Regular sessions to support your continued healing': {
    en: 'Regular sessions to support your continued healing',
    es: 'Sesiones regulares para apoyar tu sanación continua',
    he: 'פגישות קבועות לתמיכה בתהליך הריפוי שלך'
  },
  'Book a free 15-minute consultation call': {
    en: 'Book a free 15-minute consultation call',
    es: 'Reserva una llamada de consulta gratuita de 15 minutos',
    he: 'הזמן שיחת ייעוץ חינמית של 15 דקות'
  },
  'Free 15-minute call to discuss your needs': {
    en: 'Free 15-minute call to discuss your needs',
    es: 'Llamada gratuita de 15 minutos para discutir tus necesidades',
    he: 'שיחה חינמית של 15 דקות לדיון בצרכים שלך'
  },
  'Begin building a therapeutic relationship': {
    en: 'Begin building a therapeutic relationship',
    es: 'Comienza a construir una relación terapéutica',
    he: 'התחל לבנות קשר טיפולי'
  },
  'Regular sessions to support your growth': {
    en: 'Regular sessions to support your growth',
    es: 'Sesiones regulares para apoyar tu crecimiento',
    he: 'פגישות קבועות לתמיכה בצמיחה שלך'
  },
  'Complete intake and begin your journey': {
    en: 'Complete intake and begin your journey',
    es: 'Completa la admisión y comienza tu viaje',
    he: 'השלם את הקליטה והתחל את המסע שלך'
  },
  'Regular sessions tailored to your needs': {
    en: 'Regular sessions tailored to your needs',
    es: 'Sesiones regulares adaptadas a tus necesidades',
    he: 'פגישות קבועות המותאמות לצרכים שלך'
  },
  'Select a time that works for you': {
    en: 'Select a time that works for you',
    es: 'Selecciona un horario que te convenga',
    he: 'בחר זמן שמתאים לך'
  },
  'Quick questionnaire before your session': {
    en: 'Quick questionnaire before your session',
    es: 'Cuestionario rápido antes de tu sesión',
    he: 'שאלון קצר לפני הפגישה שלך'
  },
  'Begin your journey to clarity': {
    en: 'Begin your journey to clarity',
    es: 'Comienza tu viaje hacia la claridad',
    he: 'התחל את המסע שלך לבהירות'
  },
  "We'll establish grounding techniques and coping strategies": {
    en: "We'll establish grounding techniques and coping strategies",
    es: 'Estableceremos técnicas de anclaje y estrategias de afrontamiento',
    he: 'נקבע טכניקות הארקה ואסטרטגיות התמודדות'
  },
  'Gently explore your experiences at your own pace': {
    en: 'Gently explore your experiences at your own pace',
    es: 'Explora suavemente tus experiencias a tu propio ritmo',
    he: 'חקור בעדינות את החוויות שלך בקצב שלך'
  },
  'Work through trauma using specialized techniques': {
    en: 'Work through trauma using specialized techniques',
    es: 'Trabaja el trauma usando técnicas especializadas',
    he: 'עבד את הטראומה באמצעות טכניקות מתמחות'
  },
  'Build a new narrative and reclaim your life': {
    en: 'Build a new narrative and reclaim your life',
    es: 'Construye una nueva narrativa y recupera tu vida',
    he: 'בנה נרטיב חדש והחזר את חייך'
  },

  // Service Names
  'Individual Therapy': { en: 'Individual Therapy', es: 'Terapia Individual', he: 'טיפול פרטני' },
  'Couples Therapy': { en: 'Couples Therapy', es: 'Terapia de Parejas', he: 'טיפול זוגי' },
  'Family Therapy': { en: 'Family Therapy', es: 'Terapia Familiar', he: 'טיפול משפחתי' },
  'Group Therapy': { en: 'Group Therapy', es: 'Terapia Grupal', he: 'טיפול קבוצתי' },
  'EMDR': { en: 'EMDR', es: 'EMDR', he: 'EMDR' },
  'One-on-one sessions tailored to your unique journey': {
    en: 'One-on-one sessions tailored to your unique journey',
    es: 'Sesiones individuales adaptadas a tu viaje único',
    he: 'פגישות אישיות המותאמות למסע הייחודי שלך'
  },
  'Strengthen your relationship and deepen connection': {
    en: 'Strengthen your relationship and deepen connection',
    es: 'Fortalece tu relación y profundiza la conexión',
    he: 'חזק את הקשר שלך והעמק את החיבור'
  },
  'Build healthier family dynamics together': {
    en: 'Build healthier family dynamics together',
    es: 'Construyan dinámicas familiares más saludables juntos',
    he: 'בנו יחד דינמיקה משפחתית בריאה יותר'
  },

  // Stats labels
  'Years Experience': { en: 'Years Experience', es: 'Años de Experiencia', he: 'שנות ניסיון' },
  'Clients Helped': { en: 'Clients Helped', es: 'Clientes Ayudados', he: 'לקוחות שנעזרו' },
  'Client Satisfaction': { en: 'Client Satisfaction', es: 'Satisfacción del Cliente', he: 'שביעות רצון לקוחות' },
  'Happy Clients': { en: 'Happy Clients', es: 'Clientes Felices', he: 'לקוחות מרוצים' },

  // Header menu items
  'Process': { en: 'Process', es: 'Proceso', he: 'תהליך' },
  'Credentials': { en: 'Credentials', es: 'Credenciales', he: 'הסמכות' },
  'Home': { en: 'Home', es: 'Inicio', he: 'בית' },
  'About': { en: 'About', es: 'Acerca de', he: 'אודות' },
  'Services': { en: 'Services', es: 'Servicios', he: 'שירותים' },
  'Testimonials': { en: 'Testimonials', es: 'Testimonios', he: 'המלצות' },
  'Contact': { en: 'Contact', es: 'Contacto', he: 'צור קשר' },
  'Book': { en: 'Book', es: 'Reservar', he: 'הזמן' },
  'Specializations': { en: 'Specializations', es: 'Especializaciones', he: 'התמחויות' },
  'Approach': { en: 'Approach', es: 'Enfoque', he: 'גישה' },
  'Resources': { en: 'Resources', es: 'Recursos', he: 'משאבים' },
  'Programs': { en: 'Programs', es: 'Programas', he: 'תוכניות' },
  'Results': { en: 'Results', es: 'Resultados', he: 'תוצאות' },
  'Connect': { en: 'Connect', es: 'Conectar', he: 'התחבר' },
  'Success Stories': { en: 'Success Stories', es: 'Historias de Éxito', he: 'סיפורי הצלחה' },
  'Get Started': { en: 'Get Started', es: 'Comenzar', he: 'התחל' },
  'Pricing': { en: 'Pricing', es: 'Precios', he: 'מחירון' },
  'Portfolio': { en: 'Portfolio', es: 'Portafolio', he: 'תיק עבודות' },
  'Gallery': { en: 'Gallery', es: 'Galería', he: 'גלריה' },
  'Blog': { en: 'Blog', es: 'Blog', he: 'בלוג' },
  'Team': { en: 'Team', es: 'Equipo', he: 'צוות' },

  // Misc placeholders
  'Your Practice': { en: 'Your Practice', es: 'Tu Consulta', he: 'הפרקטיקה שלך' },
  'Clinical Practice': { en: 'Clinical Practice', es: 'Práctica Clínica', he: 'קליניקה' },

  // Stats labels from templates
  'Lives Transformed': { en: 'Lives Transformed', es: 'Vidas Transformadas', he: 'חיים ששונו' },
  'Goal Achievement': { en: 'Goal Achievement', es: 'Logro de Metas', he: 'השגת יעדים' },
  'Years Coaching': { en: 'Years Coaching', es: 'Años de Coaching', he: 'שנות אימון' },
  'Executives Coached': { en: 'Executives Coached', es: 'Ejecutivos Entrenados', he: 'מנהלים שאומנו' },
  'Client Base': { en: 'Client Base', es: 'Base de Clientes', he: 'בסיס לקוחות' },
  'Certified': { en: 'Certified', es: 'Certificado', he: 'מוסמך' },
  'Career Pivots': { en: 'Career Pivots', es: 'Cambios de Carrera', he: 'שינויי קריירה' },
  'Land Within 90 Days': { en: 'Land Within 90 Days', es: 'Colocación en 90 Días', he: 'השמה תוך 90 יום' },
  'Avg Salary Increase': { en: 'Avg Salary Increase', es: 'Aumento Salarial Prom.', he: 'עלייה ממוצעת בשכר' },
  'Client Value Created': { en: 'Client Value Created', es: 'Valor Creado para Clientes', he: 'ערך שנוצר ללקוחות' },
  'Projects Delivered': { en: 'Projects Delivered', es: 'Proyectos Entregados', he: 'פרויקטים שהושלמו' },
};

/**
 * Translate template content text based on locale
 * This handles the actual content stored in templates (titles, descriptions, etc.)
 */
export function translateTemplateContent(text: string, locale: Locale): string {
  if (locale === 'en') {
    return text;
  }

  const translation = templateContentTranslations[text];
  if (translation) {
    return translation[locale] || translation.en || text;
  }

  return text;
}

/**
 * Translate all translatable fields in a block's content
 * Recursively processes the content object and translates string fields
 */
export function translateBlockContent(
  content: Record<string, unknown>,
  locale: Locale
): Record<string, unknown> {
  if (locale === 'en') {
    return content;
  }

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(content)) {
    if (typeof value === 'string') {
      result[key] = translateTemplateContent(value, locale);
    } else if (Array.isArray(value)) {
      result[key] = value.map(item => {
        if (typeof item === 'string') {
          return translateTemplateContent(item, locale);
        } else if (typeof item === 'object' && item !== null) {
          return translateBlockContent(item as Record<string, unknown>, locale);
        }
        return item;
      });
    } else if (typeof value === 'object' && value !== null) {
      result[key] = translateBlockContent(value as Record<string, unknown>, locale);
    } else {
      result[key] = value;
    }
  }

  return result;
}
