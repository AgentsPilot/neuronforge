'use client';

/**
 * LandingPageWizard
 * Unified wizard for creating both Smart Links and Landing Pages
 *
 * Smart Links:
 *   - Contact Form Only → /go/[code] → /c/[userCode]/contact
 *   - Full Journey → /go/[code] → /c/[userCode]/book?flow=...
 *
 * Landing Pages:
 *   - Full marketing page with journey steps
 *
 * Steps vary by creation type - see getStepsForCreationType()
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Globe, ChevronRight, ChevronLeft, Check, X,
  Plus, Loader2, Eye, Sparkles, Rocket, ExternalLink,
  Monitor, Tablet, Smartphone, Maximize2, Calendar, DollarSign,
  Target, Users, FileText, CreditCard, ClipboardList, GripVertical, User,
  Link, MessageSquare, Copy, QrCode, Layers, Mail, Share2, Clock, ArrowRight
} from 'lucide-react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { CSS } from '@dnd-kit/utilities';
import { useLanguage, type CurrencyCode } from '@/lib/business-os/LanguageContext';
import { ServiceDescriptionField } from '@/components/business-os/ServiceDescriptionField';
import { getTranslatedTemplateName, getTranslatedVertical, getTranslatedBrandVoice, getArchetypeLabel } from '@/lib/website-builder/templateLabels';
import { ArchetypePreview, ArchetypeFontLinks } from '@/components/business-os/ArchetypePreview';
import { ClientJourneyStrip } from '@/components/business-os/setup/ClientJourneyStrip';
import { QRCodeSVG } from 'qrcode.react';
import { createLogger } from '@/lib/logger';
import { useConfigurationDialog } from '@/components/business-os/ConfigurationDialogProvider';
import { SchedulingServicesList } from '@/components/scheduling/SchedulingServicesList';

const logger = createLogger({ module: 'LandingPageWizard' });

// Types
interface SchedulingService {
  id: string;
  name: string;
  service_name?: string;
  description: string | null;
  duration_minutes: number | null;
  price: number | null;
  currency: string;
  status: string;
  is_active?: boolean;
  /** The two facts this service's client journey is built from. */
  is_scheduled?: boolean | null;
  collection?: 'online' | 'invoice' | null;
}

interface ExistingTheme {
  colors: {
    primary: string;
    secondary: string;
  };
  fonts: {
    heading: string;
    body: string;
  };
}

interface BusinessInfo {
  companyName?: string | null;
  logoUrl?: string | null;
}

// New steps: 'scheduling' (date/time), 'client_info' (name/email/phone)
// Legacy 'booking' = scheduling + client_info combined
type ClientFlowStep = 'scheduling' | 'client_info' | 'booking' | 'payment' | 'intake' | 'confirmation';

// Creation types for unified wizard
type CreationType = 'landing-page' | 'smart-link';
type JourneyType = 'contact-only' | 'full-journey';

// Smart link data from API
interface SmartLink {
  id: string;
  code: string;
  destination_url: string;
  name: string;
}

interface EditingSmartLink {
  id: string;
  name: string | null;
  metadata?: {
    journeyType?: 'contact-only' | 'full';
    serviceIds?: string[];
    flow?: string[];
    destinationType?: 'form' | 'booking';
  } | null;
}

/**
 * A template, as much of one as this wizard needs.
 *
 * Declared structurally rather than imported from the catalogue so the wizard
 * does not pull the whole 33-template module into the client bundle for four
 * colour values.
 */
export interface WizardTemplate {
  id: string;
  name: string;
  vertical: string;
  theme: {
    // All optional: the website page's own `WebsiteTemplate` — which is what
    // gets passed in — declares them that way, and carries `font_family`
    // rather than the split heading/body pair. Requiring them here made a
    // template from that list unassignable to this one.
    primary_color?: string;
    secondary_color?: string;
    accent_color?: string;
    font_heading?: string;
    font_body?: string;
    font_family?: string;
    brand_voice?: string;
    /*
     * The archetype's own shape. `/api/website/templates` answers with designs
     * now, and the ground, the ink and the typeface are what make one card
     * different from the next — the three flat colours above cannot show it.
     */
    colors?: {
      primary?: string;
      secondary?: string;
      accent?: string;
      background?: string;
      surface?: string;
      text?: string;
      textSecondary?: string;
    };
    fonts?: { heading?: string; body?: string };
  };
  borderRadius?: string;
}

interface LandingPageWizardProps {
  existingTheme?: ExistingTheme | null;
  /**
   * The templates to choose from when the business has not settled on one.
   *
   * A landing page used to pick from four hardcoded style presets, which are
   * colours and nothing else — so a page created before any website left the
   * business with a look but no template, and `business_profiles.template_id`
   * stayed empty. Everything generated afterwards is built from the template,
   * so the first surface has to establish a real one.
   */
  templates?: WizardTemplate[];
  subdomain?: string;
  businessInfo?: BusinessInfo | null;
  clientFlow?: ClientFlowStep[];
  userCode?: string; // User code for smart link destinations
  onComplete: (data: LandingPageWizardResult) => void;
  onCancel: () => void;
  editingSmartLink?: EditingSmartLink | null; // When editing an existing smart link
}

export interface LandingPageWizardResult {
  // Common fields
  creationType: CreationType;
  clientFlow: ClientFlowStep[];

  // Landing page specific
  serviceId?: string;
  serviceName?: string;
  stylePreset?: string;
  /** The template this page was built from, when one was chosen here. */
  templateId?: string;
  theme?: ExistingTheme;
  slug?: string;
  shouldPublish?: boolean;
  generatedContent?: Record<string, unknown>;
  /** Whether this page's header wears the business logo. */
  showLogo?: boolean;

  // Smart link specific
  smartLink?: SmartLink;
  journeyType?: JourneyType;
}

// Style presets for users without existing website
const STYLE_PRESETS = [
  {
    id: 'professional',
    name: { en: 'Professional', es: 'Profesional', he: 'מקצועי' },
    description: { en: 'Clean, corporate look', es: 'Aspecto limpio y corporativo', he: 'מראה נקי ועסקי' },
    theme: {
      colors: { primary: '#2D5A5A', secondary: '#5B9A8B' },
      fonts: { heading: 'Merriweather', body: 'Open Sans' }
    }
  },
  {
    id: 'warm',
    name: { en: 'Warm', es: 'Cálido', he: 'חם' },
    description: { en: 'Friendly, approachable', es: 'Amigable y accesible', he: 'ידידותי ונגיש' },
    theme: {
      colors: { primary: '#7C9082', secondary: '#E8DDD4' },
      fonts: { heading: 'Lora', body: 'Nunito' }
    }
  },
  {
    id: 'bold',
    name: { en: 'Bold', es: 'Audaz', he: 'נועז' },
    description: { en: 'High-contrast, attention-grabbing', es: 'Alto contraste, llamativo', he: 'ניגודיות גבוהה, תופס עין' },
    theme: {
      colors: { primary: '#1A1A2E', secondary: '#E94560' },
      fonts: { heading: 'Montserrat', body: 'Roboto' }
    }
  },
  {
    id: 'minimal',
    name: { en: 'Minimal', es: 'Minimalista', he: 'מינימליסטי' },
    description: { en: 'Simple, elegant', es: 'Simple y elegante', he: 'פשוט ואלגנטי' },
    theme: {
      colors: { primary: '#4A6670', secondary: '#E9EEF0' },
      fonts: { heading: 'DM Serif Display', body: 'Inter' }
    }
  }
];

// Step info for journey builder - descriptions are product/service agnostic
const STEP_INFO: Record<ClientFlowStep, {
  icon: typeof Calendar;
  name: { en: string; es: string; he: string };
  description: { en: string; es: string; he: string };
  color: string;
  circle: string;
}> = {
  scheduling: {
    icon: Calendar,
    name: { en: 'Schedule', es: 'Agendar', he: 'תיאום' },
    description: { en: 'Pick a date & time', es: 'Elegir fecha y hora', he: 'בחירת תאריך ושעה' },
    color: 'border-[#4F6EF7]/40',
    circle: 'bg-[#4F6EF7]'
  },
  client_info: {
    icon: User,
    name: { en: 'Client Info', es: 'Info Cliente', he: 'פרטי לקוח' },
    description: { en: 'Name, email, phone', es: 'Nombre, email, teléfono', he: 'שם, אימייל, טלפון' },
    color: 'border-indigo-500/40',
    circle: 'bg-indigo-500'
  },
  booking: {
    icon: Calendar,
    name: { en: 'Book Appointment', es: 'Reservar Cita', he: 'קביעת פגישה' },
    description: { en: 'Date, time & client info', es: 'Fecha, hora e info', he: 'תאריך, שעה ופרטים' },
    color: 'border-[#4F6EF7]/40',
    circle: 'bg-[#4F6EF7]'
  },
  payment: {
    icon: CreditCard,
    name: { en: 'Payment', es: 'Pago', he: 'תשלום' },
    description: { en: 'Complete purchase', es: 'Completar compra', he: 'השלמת הרכישה' },
    color: 'border-green-500/40',
    circle: 'bg-green-500'
  },
  intake: {
    icon: ClipboardList,
    name: { en: 'Intake Form', es: 'Formulario', he: 'שאלון' },
    description: { en: 'Collect information', es: 'Recopilar información', he: 'איסוף מידע' },
    color: 'border-purple-500/40',
    circle: 'bg-purple-500'
  },
  confirmation: {
    icon: Check,
    name: { en: 'Confirmation', es: 'Confirmación', he: 'אישור' },
    description: { en: 'Success message', es: 'Mensaje de éxito', he: 'הודעת הצלחה' },
    color: 'border-[var(--v2-border)]',
    circle: 'bg-gray-400'
  }
};

// Sortable journey step component for drag and drop
interface SortableJourneyStepProps {
  step: ClientFlowStep;
  index: number;
  language: 'en' | 'es' | 'he';
  isConfirmation: boolean;
  isPaymentRequired: boolean;
  onRemove: (step: ClientFlowStep) => void;
  alwaysIncludedLabel: string;
}

function SortableJourneyStep({
  step,
  index,
  language,
  isConfirmation,
  isPaymentRequired,
  onRemove,
  alwaysIncludedLabel
}: SortableJourneyStepProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: step, disabled: isConfirmation });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 1000 : 'auto' as const
  };

  const stepInfo = STEP_INFO[step];
  const Icon = stepInfo.icon;

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <div
        className={`flex items-center gap-3 p-4 rounded-xl bg-[var(--v2-surface)] border ${stepInfo.color} group`}
      >
        {/* Drag handle */}
        {!isConfirmation && (
          <button
            {...listeners}
            className="cursor-grab active:cursor-grabbing text-[var(--v2-text-muted)] hover:text-[var(--v2-text-secondary)] transition-colors touch-none"
            aria-label="Drag to reorder"
          >
            <GripVertical className="w-5 h-5" />
          </button>
        )}

        <div className={`w-10 h-10 rounded-full ${stepInfo.circle} text-white flex items-center justify-center font-bold flex-shrink-0`}>
          {index + 1}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-[var(--v2-text-primary)]">
            {stepInfo.name[language] || stepInfo.name.en}
          </div>
          <div className="text-sm text-[var(--v2-text-secondary)]">
            {stepInfo.description[language] || stepInfo.description.en}
          </div>
        </div>
        {isConfirmation ? (
          <span className="text-xs text-[var(--v2-text-muted)] italic flex-shrink-0">{alwaysIncludedLabel}</span>
        ) : !isPaymentRequired ? (
          <button
            onClick={() => onRemove(step)}
            className="p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-red-400 hover:text-red-500 flex-shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

// Labels
const LABELS = {
  en: {
    step: 'Step',
    of: 'of',
    cancel: 'Cancel',
    back: 'Back',
    continue: 'Continue',
    publish: 'Publish',
    save_draft: 'Save as Draft',
    // Step 0 - Creation Type Selection
    step0_title: 'What do you want to create?',
    step0_subtitle: 'Choose the type of customer acquisition tool',
    creation_smart_link: 'Smart Link',
    creation_smart_link_desc: 'A direct link to share on social media, WhatsApp, or your existing website',
    creation_landing_page: 'Landing Page',
    creation_landing_page_desc: 'A full marketing page with your branding, content, and booking',
    // Step 1 (Smart Link) - Journey Type Selection
    journey_type_title: 'What should visitors do?',
    journey_type_subtitle: 'Choose the action for your smart link',
    journey_contact_only: 'Contact Form Only',
    journey_contact_only_desc: 'Capture name, email, phone, and message',
    journey_contact_only_best_for: 'Best for: general inquiries, "get in touch"',
    journey_full: 'Full User Journey',
    journey_full_desc: 'Configure booking, payment, intake steps',
    journey_full_best_for: 'Best for: appointments, consultations, services',
    // Smart Link Complete
    smart_link_ready_title: 'Your Smart Link is Ready!',
    smart_link_copy: 'Copy Link',
    smart_link_show_qr: 'Show QR',
    smart_link_preview: 'Preview',
    smart_link_share_tips: 'Where to share:',
    smart_link_tip_instagram: 'Instagram or TikTok bio link',
    smart_link_tip_whatsapp: 'WhatsApp status or groups',
    smart_link_tip_email: 'Email signature',
    smart_link_tip_website: 'Your existing website',
    smart_link_done: 'Done',
    smart_link_create_another: 'Create Another',
    smart_link_copied: 'Link copied!',
    smart_link_contact_form_name: 'Contact Form',
    smart_link_services_link: '{count} Services Link',
    smart_link_all_services: 'All Services Link',
    smart_link_booking_link: 'Booking Link',
    smart_link_service_link_suffix: 'Link',
    minutes_abbr: 'min',
    journey_follows_service: 'Each service decides its own journey — a date step only where one is booked, a payment step only where it is paid by card. Change it on the service.',
    // Step 1 (Landing Page)
    step1_title: 'Select a Service',
    add_service_title: 'Add a Service',
    add_service_subtitle: 'Create the service this landing page will promote',
    step1_subtitle: 'Choose which service this landing page promotes',
    loading_services: 'Loading services...',
    fix_availability: 'Set working hours',
    fix_invoicing: 'Complete invoice details',
    no_services: 'No services yet',
    no_services_desc: 'Create your first service to get started',
    create_new_service: 'Create New Service',
    generation_failed: 'We could not write this page from your service. It has been filled in with a starting draft you can edit.',
    preview_building: 'Writing your page…',
    generation_timeout: 'Writing this page took too long and was stopped. It has been filled in with a starting draft you can edit.',
    service_description_placeholder: 'Describe your service in detail. The AI will use this to generate compelling landing page content...',
    all_services: 'All Services',
    all_services_desc: 'Let visitors choose from all your available services',
    multi_select_hint: 'Select services to include (or skip to show all)',
    // Step 2 - Journey
    journey_add_step: 'Add step',
    journey_step_booking: 'Schedule',
    journey_step_booking_desc: 'Pick a date & time',
    journey_step_payment: 'Payment',
    journey_step_payment_desc: 'Complete purchase',
    journey_step_intake: 'Intake Form',
    journey_step_intake_desc: 'Collect information',
    journey_step_confirmation: 'Confirmation',
    journey_step_confirmation_desc: 'Success message',
    journey_always_included: 'Always included',
    journey_payment_required: 'Payment required for paid services',
    // Step 3 - Style
    step2_title: 'Choose a Style',
    step2_subtitle: 'Select the visual appearance for your landing page',
    using_website_style: 'Using Your Website Style',
    show_logo: 'Show my business logo on this page',
    using_website_style_desc: 'Your landing page will match your existing website',
    customize: 'Customize',
    or_choose_preset: 'Or choose a different style:',
    // Step 3
    step3_title: 'Preview & Publish',
    step3_subtitle: 'Review your landing page and go live',
    generating: 'Generating your landing page...',
    slug_label: 'Landing page URL',
    slug_required: 'Give the page a web address — it is how people reach it.',
    preview: 'Preview',
    edit: 'Edit',
    open_preview: 'Open Full Preview',
    // Edit mode
    edit_smart_link_title: 'Edit Smart Link',
    edit_smart_link_subtitle: 'Update services and client journey',
    smart_link_updated_title: 'Smart Link Updated!',
    update_link: 'Update Link',
  },
  es: {
    step: 'Paso',
    of: 'de',
    cancel: 'Cancelar',
    back: 'Atrás',
    continue: 'Continuar',
    publish: 'Publicar',
    save_draft: 'Guardar borrador',
    // Step 0 - Creation Type Selection
    step0_title: '¿Qué quieres crear?',
    step0_subtitle: 'Elige el tipo de herramienta de captación',
    creation_smart_link: 'Smart Link',
    creation_smart_link_desc: 'Un enlace directo para compartir en redes sociales, WhatsApp o tu sitio web',
    creation_landing_page: 'Landing Page',
    creation_landing_page_desc: 'Una página de marketing completa con tu marca, contenido y reservas',
    // Step 1 (Smart Link) - Journey Type Selection
    journey_type_title: '¿Qué deben hacer los visitantes?',
    journey_type_subtitle: 'Elige la acción para tu smart link',
    journey_contact_only: 'Solo Formulario de Contacto',
    journey_contact_only_desc: 'Captura nombre, email, teléfono y mensaje',
    journey_contact_only_best_for: 'Ideal para: consultas generales, "contáctenos"',
    journey_full: 'Recorrido Completo',
    journey_full_desc: 'Configura pasos de reserva, pago e intake',
    journey_full_best_for: 'Ideal para: citas, consultas, servicios',
    // Smart Link Complete
    smart_link_ready_title: '¡Tu Smart Link está listo!',
    smart_link_copy: 'Copiar Enlace',
    smart_link_show_qr: 'Mostrar QR',
    smart_link_preview: 'Vista Previa',
    smart_link_share_tips: 'Dónde compartir:',
    smart_link_tip_instagram: 'Bio de Instagram o TikTok',
    smart_link_tip_whatsapp: 'Estado o grupos de WhatsApp',
    smart_link_tip_email: 'Firma de email',
    smart_link_tip_website: 'Tu sitio web existente',
    smart_link_done: 'Listo',
    smart_link_create_another: 'Crear Otro',
    smart_link_copied: '¡Enlace copiado!',
    smart_link_contact_form_name: 'Formulario de Contacto',
    smart_link_services_link: '{count} Servicios',
    smart_link_all_services: 'Todos los Servicios',
    smart_link_booking_link: 'Enlace de Reserva',
    smart_link_service_link_suffix: '',
    minutes_abbr: 'min',
    journey_follows_service: 'Cada servicio define su propio recorrido — fecha solo si se reserva una, pago solo si se cobra con tarjeta. Se cambia en el servicio.',
    // Step 1 (Landing Page)
    step1_title: 'Selecciona un Servicio',
    add_service_title: 'Añadir un Servicio',
    add_service_subtitle: 'Crea el servicio que promoverá esta landing page',
    step1_subtitle: 'Elige qué servicio promueve esta landing page',
    loading_services: 'Cargando servicios...',
    fix_availability: 'Configurar horario',
    fix_invoicing: 'Completar datos de factura',
    no_services: 'Sin servicios aún',
    no_services_desc: 'Crea tu primer servicio para comenzar',
    create_new_service: 'Crear Nuevo Servicio',
    generation_failed: 'No pudimos redactar esta página desde tu servicio. Se completó con un borrador inicial que puedes editar.',
    preview_building: 'Redactando tu página…',
    generation_timeout: 'La redacción tardó demasiado y se detuvo. Se completó con un borrador inicial que puedes editar.',
    service_description_placeholder: 'Describe tu servicio en detalle. La IA usará esto para generar contenido atractivo...',
    all_services: 'Todos los Servicios',
    all_services_desc: 'Dejar que los visitantes elijan de todos tus servicios disponibles',
    multi_select_hint: 'Selecciona servicios a incluir (o salta para mostrar todos)',
    journey_add_step: 'Añadir paso',
    journey_step_booking: 'Agendar',
    journey_step_booking_desc: 'Elegir fecha y hora',
    journey_step_payment: 'Pago',
    journey_step_payment_desc: 'Completar compra',
    journey_step_intake: 'Formulario',
    journey_step_intake_desc: 'Recopilar información',
    journey_step_confirmation: 'Confirmación',
    journey_step_confirmation_desc: 'Mensaje de éxito',
    journey_always_included: 'Siempre incluido',
    journey_payment_required: 'Pago requerido para servicios pagados',
    step2_title: 'Elige un Estilo',
    step2_subtitle: 'Selecciona la apariencia visual de tu landing page',
    using_website_style: 'Usando el Estilo de Tu Sitio',
    show_logo: 'Mostrar el logo de mi negocio en esta página',
    using_website_style_desc: 'Tu landing page coincidirá con tu sitio web existente',
    customize: 'Personalizar',
    or_choose_preset: 'O elige un estilo diferente:',
    step3_title: 'Vista Previa y Publicar',
    step3_subtitle: 'Revisa tu landing page y publícala',
    generating: 'Generando tu landing page...',
    slug_label: 'URL de la landing page',
    slug_required: 'Dale una dirección web a la página — es como llegan a ella.',
    preview: 'Vista Previa',
    edit: 'Editar',
    open_preview: 'Abrir Vista Completa',
    // Edit mode
    edit_smart_link_title: 'Editar Smart Link',
    edit_smart_link_subtitle: 'Actualiza servicios y recorrido del cliente',
    smart_link_updated_title: '¡Smart Link Actualizado!',
    update_link: 'Actualizar Enlace',
  },
  he: {
    step: 'שלב',
    of: 'מתוך',
    cancel: 'ביטול',
    back: 'חזור',
    continue: 'המשך',
    publish: 'פרסם',
    save_draft: 'שמור כטיוטה',
    // Step 0 - Creation Type Selection
    step0_title: 'מה ברצונך ליצור?',
    step0_subtitle: 'בחר את סוג הכלי לגיוס לקוחות',
    creation_smart_link: 'קישור חכם',
    creation_smart_link_desc: 'קישור ישיר לשיתוף ברשתות חברתיות, וואטסאפ או האתר שלך',
    creation_landing_page: 'דף נחיתה',
    creation_landing_page_desc: 'דף שיווקי מלא עם המיתוג שלך, תוכן והזמנות',
    // Step 1 (Smart Link) - Journey Type Selection
    journey_type_title: 'מה המבקרים יעשו?',
    journey_type_subtitle: 'בחר את הפעולה לקישור החכם',
    journey_contact_only: 'טופס יצירת קשר בלבד',
    journey_contact_only_desc: 'איסוף שם, אימייל, טלפון והודעה',
    journey_contact_only_best_for: 'מתאים ל: פניות כלליות, "צור קשר"',
    journey_full: 'מסע לקוח מלא',
    journey_full_desc: 'הגדר שלבי הזמנה, תשלום ושאלון',
    journey_full_best_for: 'מתאים ל: פגישות, ייעוץ, שירותים',
    // Smart Link Complete
    smart_link_ready_title: 'הקישור החכם שלך מוכן!',
    smart_link_copy: 'העתק קישור',
    smart_link_show_qr: 'הצג QR',
    smart_link_preview: 'תצוגה מקדימה',
    smart_link_share_tips: 'איפה לשתף:',
    smart_link_tip_instagram: 'ביו באינסטגרם או טיקטוק',
    smart_link_tip_whatsapp: 'סטטוס או קבוצות וואטסאפ',
    smart_link_tip_email: 'חתימת אימייל',
    smart_link_tip_website: 'האתר הקיים שלך',
    smart_link_done: 'סיום',
    smart_link_create_another: 'צור עוד',
    smart_link_copied: 'הקישור הועתק!',
    smart_link_contact_form_name: 'טופס יצירת קשר',
    smart_link_services_link: '{count} שירותים',
    smart_link_all_services: 'כל השירותים',
    smart_link_booking_link: 'קישור להזמנה',
    smart_link_service_link_suffix: '',
    minutes_abbr: 'דק׳',
    journey_follows_service: 'כל שירות קובע את המסע שלו — שלב תאריך רק כשקובעים תור, שלב תשלום רק כשגובים בכרטיס. משנים את זה בשירות עצמו.',
    // Step 1 (Landing Page)
    step1_title: 'בחר שירות',
    add_service_title: 'הוסף שירות',
    add_service_subtitle: 'צור את השירות שדף הנחיתה יקדם',
    step1_subtitle: 'בחר איזה שירות דף הנחיתה מקדם',
    loading_services: 'טוען שירותים...',
    fix_availability: 'הגדר שעות פעילות',
    fix_invoicing: 'השלם פרטי חשבונית',
    no_services: 'אין שירותים עדיין',
    no_services_desc: 'צור את השירות הראשון שלך כדי להתחיל',
    create_new_service: 'צור שירות חדש',
    generation_failed: 'לא הצלחנו לכתוב את הדף מהשירות שלכם. הוא מולא בטיוטה התחלתית שאפשר לערוך.',
    preview_building: 'כותבים את הדף שלכם…',
    generation_timeout: 'כתיבת הדף ארכה זמן רב מדי ונעצרה. הוא מולא בטיוטה התחלתית שאפשר לערוך.',
    service_description_placeholder: 'תאר את השירות שלך בפירוט. הבינה המלאכותית תשתמש בזה כדי ליצור תוכן משכנע לדף הנחיתה...',
    all_services: 'כל השירותים',
    all_services_desc: 'אפשר למבקרים לבחור מכל השירותים הזמינים שלך',
    multi_select_hint: 'בחר שירותים לכלול (או דלג להצגת הכל)',
    journey_add_step: 'הוסף שלב',
    journey_step_booking: 'תיאום',
    journey_step_booking_desc: 'בחירת תאריך ושעה',
    journey_step_payment: 'תשלום',
    journey_step_payment_desc: 'השלמת הרכישה',
    journey_step_intake: 'שאלון',
    journey_step_intake_desc: 'איסוף מידע',
    journey_step_confirmation: 'אישור',
    journey_step_confirmation_desc: 'הודעת הצלחה',
    journey_always_included: 'תמיד כלול',
    journey_payment_required: 'תשלום נדרש לשירותים בתשלום',
    step2_title: 'בחר סגנון',
    step2_subtitle: 'בחר את המראה החזותי לדף הנחיתה שלך',
    using_website_style: 'משתמש בסגנון האתר שלך',
    show_logo: 'הצג את הלוגו של העסק בדף הזה',
    using_website_style_desc: 'דף הנחיתה יתאים לאתר הקיים שלך',
    customize: 'התאמה אישית',
    or_choose_preset: 'או בחר סגנון אחר:',
    step3_title: 'תצוגה מקדימה ופרסום',
    step3_subtitle: 'בדוק את דף הנחיתה שלך ופרסם',
    generating: 'יוצר את דף הנחיתה שלך...',
    slug_label: 'כתובת דף הנחיתה',
    slug_required: 'תנו לדף כתובת — זו הדרך שבה מגיעים אליו.',
    preview: 'תצוגה מקדימה',
    edit: 'עריכה',
    open_preview: 'פתח תצוגה מלאה',
    // Edit mode
    edit_smart_link_title: 'עריכת קישור חכם',
    edit_smart_link_subtitle: 'עדכון שירותים ומסע הלקוח',
    smart_link_updated_title: 'הקישור החכם עודכן!',
    update_link: 'עדכן קישור',
  }
};

export function LandingPageWizard({
  existingTheme,
  templates = [],
  subdomain = '',
  businessInfo,
  clientFlow,
  userCode = '',
  onComplete,
  onCancel,
  editingSmartLink
}: LandingPageWizardProps) {
  const { language, formatCurrency, availableCurrencies } = useLanguage();
  const labels = LABELS[language] || LABELS.en;
  const isRTL = language === 'he';

  // Edit mode detection
  const isEditMode = !!editingSmartLink;

  // Step 0: Creation Type Selection state
  // If editing, pre-populate from metadata
  const [creationType, setCreationType] = useState<CreationType | null>(
    isEditMode ? 'smart-link' : null
  );
  const [journeyType, setJourneyType] = useState<JourneyType | null>(() => {
    if (!isEditMode) return null;
    // A contact-only link used to come back with nothing selected, because the
    // check only recognised 'full'. Editing one meant re-answering a question
    // it had already answered — and starting the wizard at the service step
    // with no journey type set.
    const stored = editingSmartLink?.metadata?.journeyType;
    if (stored === 'full') return 'full-journey';
    if (stored === 'contact-only') return 'contact-only';
    return null;
  });
  const [createdSmartLink, setCreatedSmartLink] = useState<SmartLink | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [creatingSmartLink, setCreatingSmartLink] = useState(false);
  const [showQRModal, setShowQRModal] = useState(false);

  // Determine total steps based on creation type
  // Smart Link (contact): Step 0 → Step 1 → Done
  // Smart Link (journey): Step 0 → Step 1 → Service → Journey → Done
  // Landing Page: Step 0 → Service → Journey → Style (skip if theme) → Preview
  const hasExistingTheme = !!existingTheme;

  const getTotalSteps = (): number => {
    if (!creationType) return 1; // Just step 0
    if (creationType === 'smart-link') {
      if (!journeyType) return 2; // Step 0 + Step 1 (journey type)
      if (journeyType === 'contact-only') return 2; // Done after selecting contact-only
      // Full journey: Step 0 + Journey Type + Service + Done = 4. The journey
      // builder that used to sit between service and done is gone — the
      // journey is the service's, not the link's.
      return 4;
    }
    // Landing page: Step 0 + Service + Style (optional) + Preview. The journey
    // step is gone — it is the service's, and the service step already shows it.
    return hasExistingTheme ? 3 : 4;
  };

  const totalSteps = getTotalSteps();

  // Wizard state - step 0 is creation type selection
  // If editing, start at step 2 (service selection for full journey)
  const [currentStep, setCurrentStep] = useState(isEditMode ? 2 : 0);
  /**
   * Why the chosen service cannot be sold yet, if it cannot.
   *
   * Held rather than thrown so the wizard can show the sentence the server
   * wrote — which names the service and what is missing — beside the choice
   * that caused it.
   */
  const [serviceGate, setServiceGate] = useState<{
    ready: boolean;
    error?: string;
    reason?: string;
    /** Each blocking gap on its own, so each carries the control that fixes it. */
    gaps?: Array<{ kind: string; message: string }>;
  } | null>(null);
  const [checkingService, setCheckingService] = useState(false);

  /**
   * Ask the server whether this service's journey can run.
   *
   * The same `journeyGaps` the publish gate and the smart-link gate use, so the
   * wizard cannot wave through something those will refuse. Returns null when
   * the check itself fails — never block an owner on our own error.
   *
   * Driven by the SERVICE, not by which surface was chosen: a product needs no
   * working hours and a free one needs no invoice details, so a landing page or
   * a smart link selling one passes straight through.
   */
  const checkServiceReadiness = async (serviceIds: string[]) => {
    try {
      setCheckingService(true);
      // No ids means the whole catalogue, which is what a smart link naming no
      // service actually offers.
      const query = serviceIds.length > 0 ? `?service_ids=${serviceIds.join(',')}` : '';
      const response = await fetch(`/api/business-os/journey-readiness${query}`);
      const data = await response.json();
      if (data?.success) {
        if (data.checkFailed) {
          // The server could not answer and said `ready` so as not to block
          // anyone. Worth knowing: from here it looks exactly like a pass.
          logger.warn({ serviceIds }, 'Readiness check failed server-side and defaulted to ready');
        }
        return data as {
          ready: boolean;
          error?: string;
          reason?: string;
          gaps?: Array<{ kind: string; message: string }>;
        };
      }

      /*
       * A failed CHECK lets the owner through, deliberately — we do not block
       * anyone on our own error. But it is indistinguishable from "nothing was
       * wrong", so it is logged: a gate that quietly stops gating looks exactly
       * like a gate that was never wired up.
       */
      logger.warn({ status: response.status, serviceIds }, 'Service readiness check did not answer');
      return null;
    } catch (err) {
      logger.warn({ err, serviceIds }, 'Service readiness check failed');
      return null;
    } finally {
      setCheckingService(false);
    }
  };
  const [loading, setLoading] = useState(false);

  // Step 1: Service selection
  const [services, setServices] = useState<SchedulingService[]>([]);
  const [loadingServices, setLoadingServices] = useState(true);
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);

  /*
   * A landing page is written from the service's description.
   *
   * `serviceDescription` is passed straight to the generator and the prompt
   * builds the hero, the benefits, the FAQ and the pricing copy out of it —
   * with nothing there it sends "No description provided" and the model writes
   * a page about a name. So a service without one stops the wizard here and
   * asks for it, rather than producing a page nobody wants and leaving the
   * business to work out why it reads like it is about no one.
   */
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [describeServiceId, setDescribeServiceId] = useState<string | null>(null);

  /*
   * The same Configuration dialog the rest of Business OS opens.
   *
   * The wizard sits inside `ConfigurationDialogProvider` (see the Business OS
   * layout), so a gap message here can offer the exact settings tab that closes
   * it rather than telling the owner to go and find it.
   */
  const { openConfiguration } = useConfigurationDialog();

  /**
   * Take a service the editor just saved and make it usable by this wizard.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * `SchedulingServicesList` saves a new service as a DRAFT on purpose — the
   * onboarding chat creates them fast and stopping to write copy there is the
   * friction it exists to avoid. The picker below lists live services only, so
   * a draft is invisible: you add a service, and it is nowhere.
   *
   * Publishing needs a DESCRIPTION. That rule is not this wizard's invention —
   * `handlePublish` enforces it, because the website writes its section from
   * that text and publishing without one puts a paragraph the model guessed in
   * front of clients. So a service saved without one is NOT published here;
   * it is selected, which opens the same "describe this service" prompt the
   * wizard already shows, and publishing happens once there is something to
   * publish.
   */
  const publishAndSelectService = async (serviceId: string) => {
    let created: (SchedulingService & { service_name?: string }) | null = null;

    try {
      const response = await fetch('/api/scheduling/services');
      const data = await response.json();
      created = (data?.services ?? []).find((svc: { id: string }) => svc.id === serviceId) ?? null;
    } catch (err) {
      logger.warn({ err, serviceId }, 'Could not read the service just created');
    }

    await fetchServices();
    setShowCreateService(false);

    if (!created) return;

    /*
     * The new service is added to the list by hand.
     *
     * `fetchServices` keeps only LIVE services — a landing page must not be
     * built around one nobody can book — and this one is still a draft, so it
     * was filtered straight back out. The owner saved a service and returned to
     * a list that did not contain it.
     *
     * It is put back because this is the one service the wizard is about. Its
     * card is also where the "describe this service" prompt renders, so without
     * the card there was nowhere to ask for the description either.
     */
    const withName = { ...created, name: created.service_name || created.name };
    setServices(prev => (prev.some(svc => svc.id === serviceId) ? prev : [...prev, withName]));
    setSelectedServiceId(serviceId);
    setServiceGate(null);

    /*
     * No description, no publish — and no advance.
     *
     * The rule is `handlePublish`'s, not this wizard's: the website writes its
     * section from this text, and publishing without one puts a paragraph the
     * model guessed in front of clients. So the prompt is opened instead, and
     * `onSaved` publishes once there is something to publish.
     */
    if (!(created.description ?? '').trim()) {
      setDescribeServiceId(serviceId);
      return;
    }

    try {
      await fetch(`/api/scheduling/services/${serviceId}/publish`, { method: 'POST' });
      await fetchServices();
    } catch (err) {
      logger.warn({ err, serviceId }, 'Could not publish the new service');
    }

    setDescribeServiceId(null);
    setSlug(generateSlug(withName.name));

    const gate = await checkServiceReadiness([serviceId]);
    if (gate && !gate.ready) {
      setServiceGate(gate);
      return;
    }
    setCurrentStep(2);
  };

  /*
   * Whether a card can actually be charged right now.
   *
   * The embedded service form draws a journey strip from this, and showing an
   * owner a payment step their clients cannot complete is the failure worth
   * avoiding — so it starts false and turns on only when the check says so.
   *
   * Read from the readiness endpoint's advisory gaps: a `processor` gap means
   * services want a card and none can be taken. No gap means it can.
   */
  const [processorReady, setProcessorReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/business-os/journey-readiness');
        const data = await response.json();
        if (!cancelled && data?.success) {
          setProcessorReady(!(data.advisory ?? []).includes('processor'));
        }
      } catch {
        // Left false: see above — the quiet failure is the safer one here.
      }
    })();
    return () => { cancelled = true; };
  }, []);
  /** Why the page's copy is the fallback rather than written for this service. */
  const [generationFailed, setGenerationFailed] = useState<string | null>(null);
  // Multi-select for smart links - allows selecting multiple services
  // If editing, pre-populate from metadata
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>(
    isEditMode && editingSmartLink?.metadata?.serviceIds ? editingSmartLink.metadata.serviceIds : []
  );
  const [showCreateService, setShowCreateService] = useState(false);

  // Step 2: Journey selection - custom flow builder
  // Use passed clientFlow if editing, otherwise default to scheduling + client_info + confirmation
  // If editing, pre-populate from metadata (flow array)
  const [selectedFlow, setSelectedFlow] = useState<ClientFlowStep[]>(() => {
    if (isEditMode && editingSmartLink?.metadata?.flow && editingSmartLink.metadata.flow.length > 0) {
      // Add confirmation back if not present
      const flow = editingSmartLink.metadata.flow as ClientFlowStep[];
      return flow.includes('confirmation') ? flow : [...flow, 'confirmation'];
    }
    if (clientFlow && clientFlow.length > 0) return clientFlow;
    return ['scheduling', 'client_info', 'confirmation'];
  });

  // Step 3: Style selection (only if no existing theme)
  const [selectedPresetId, setSelectedPresetId] = useState<string>('professional');
  const [useExistingTheme, setUseExistingTheme] = useState(true);

  // Step 3: Preview & Publish
  const [slug, setSlug] = useState('');
  const [generatedContent, setGeneratedContent] = useState<Record<string, unknown> | null>(null);
  const [generatingContent, setGeneratingContent] = useState(false);
  const [publishing, setPublishing] = useState(false);
  // The image is the business's, held on the profile; this page only records
  // whether to display it.
  const [showLogo, setShowLogo] = useState(!!businessInfo?.logoUrl);
  const [deviceMode, setDeviceMode] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const [previewDataKey, setPreviewDataKey] = useState<string | null>(null);

  // Get selected service
  const selectedService = services.find(s => s.id === selectedServiceId);

  // Reset state when editingSmartLink changes (for edit mode)
  useEffect(() => {
    if (editingSmartLink) {
      // Entering edit mode - set up the state from metadata
      setCreationType('smart-link');
      setJourneyType(editingSmartLink.metadata?.journeyType === 'full' ? 'full-journey' : 'full-journey');
      setCurrentStep(2); // Start at service selection

      // Pre-populate selected services
      if (editingSmartLink.metadata?.serviceIds) {
        setSelectedServiceIds(editingSmartLink.metadata.serviceIds);
      } else {
        setSelectedServiceIds([]);
      }

      // Pre-populate flow
      if (editingSmartLink.metadata?.flow && editingSmartLink.metadata.flow.length > 0) {
        const flow = editingSmartLink.metadata.flow as ClientFlowStep[];
        setSelectedFlow(flow.includes('confirmation') ? flow : [...flow, 'confirmation']);
      } else {
        setSelectedFlow(['scheduling', 'client_info', 'confirmation']);
      }

      // Clear any previous completion state
      setCreatedSmartLink(null);
      setLinkCopied(false);
    } else {
      // Not editing - reset to initial state
      setCreationType(null);
      setJourneyType(null);
      setCurrentStep(0);
      setSelectedServiceIds([]);
      setSelectedFlow(clientFlow && clientFlow.length > 0 ? clientFlow : ['scheduling', 'client_info', 'confirmation']);
      setCreatedSmartLink(null);
      setLinkCopied(false);
    }
  }, [editingSmartLink, clientFlow]);

  // Fetch services and user profile on mount
  useEffect(() => {
    fetchServices();
  }, []);

  const fetchServices = async () => {
    try {
      setLoadingServices(true);
      const response = await fetch('/api/scheduling/services');
      const data = await response.json();
      if (data.success && data.services) {
        const mapped = data.services
          // Both flags, as every public surface now checks: a link must not be
          // able to offer a service that is switched off or unpublished.
          .filter((s: { status: string; is_active?: boolean }) => s.status === 'active' && s.is_active !== false)
          .map((s: SchedulingService & { service_name?: string }) => ({
            ...s,
            name: s.service_name || s.name
          }));
        setServices(mapped);

        // A link with no stored services offers all of them — that is what an
        // absent `services=` parameter means on the public page. Editing one
        // showed an empty picker, which reads as "nothing selected" rather
        // than "everything", and saving from there would have narrowed the
        // link to nothing without the user asking.
        if (isEditMode && !editingSmartLink?.metadata?.serviceIds?.length) {
          setSelectedServiceIds(mapped.map((service: SchedulingService) => service.id));
        }
      }
    } catch {
      // Silently fail
    } finally {
      setLoadingServices(false);
    }
  };


  /**
   * A URL suggestion from the service name, or nothing.
   *
   * This kept only `a-z0-9`, so a Hebrew service name left just its digits
   * behind: "בדיקה 2" became "-2" — a leading hyphen and a stray number offered
   * as the page's address. Every Hebrew and Arabic business got the same, and
   * two services numbered 2 and 3 produced "-2" and "-3".
   *
   * There is no honest transliteration to make here, so it does not invent one.
   * A name with nothing usable in it returns '' and the field stays blank for
   * the person to fill in — which is also why saving and publishing now require
   * it. A bad suggestion is worse than none: it is the one people accept.
   */
  const generateSlug = (name: string): string => {
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      // The old version stopped here, keeping the hyphens this leaves behind.
      .replace(/^-+|-+$/g, '');

    // Digits alone are not a name — "2" is what is left of "בדיקה 2".
    return /[a-z]/.test(slug) ? slug : '';
  };

  // Get selected theme
  const getSelectedTheme = (): ExistingTheme => {
    if (hasExistingTheme && useExistingTheme && existingTheme) {
      return existingTheme;
    }
    // A real template outranks the colour presets: it is the thing the rest of
    // the product keys off, and the one this page will establish for the
    // business if nothing has yet.
    const template = templates.find(t => t.id === selectedTemplateId);
    if (template) {
      // `font_family` is the older single-field form; some templates carry only
      // that, so it is the fallback for both halves rather than a third branch.
      const family = template.theme.font_family?.split(',')[0].trim();
      return {
        colors: {
          primary: template.theme.primary_color || STYLE_PRESETS[0].theme.colors.primary,
          secondary: template.theme.secondary_color || STYLE_PRESETS[0].theme.colors.secondary,
        },
        fonts: {
          heading: template.theme.font_heading || family || STYLE_PRESETS[0].theme.fonts.heading,
          body: template.theme.font_body || family || STYLE_PRESETS[0].theme.fonts.body,
        },
      };
    }
    const preset = STYLE_PRESETS.find(p => p.id === selectedPresetId);
    return preset?.theme || STYLE_PRESETS[0].theme;
  };

  // Helper to format price with correct currency symbol
  /*
   * `CurrencyCode` is 'USD' | 'ILS' | 'EUR' | 'GBP'.
   *
   * This cast asserted `... | 'CAD' | 'AUD'` — two codes the type does not
   * contain — so it never type-checked, and a service stored as CAD would have
   * been handed to `formatCurrency` as a currency it cannot format. A service's
   * `currency` column is a free-form string, so the value has to be CHECKED
   * rather than asserted: an unsupported one falls back to the viewer's own
   * currency instead of being forced through.
   */
  const toCurrencyCode = (code: string): CurrencyCode | undefined =>
    (['USD', 'ILS', 'EUR', 'GBP'] as readonly string[]).includes(code)
      ? (code as CurrencyCode)
      : undefined;

  const formatPrice = (price: number | null | undefined, currencyCode: string) => {
    if (price == null) return language === 'he' ? 'צרו קשר' : language === 'es' ? 'Contáctenos' : 'Contact us';
    // Use the global formatCurrency from LanguageContext for locale-aware formatting
    return formatCurrency(price, { showFree: false, currencyOverride: toCurrencyCode(currencyCode) });
  };

  // Store preview data in sessionStorage and return a key
  const storePreviewData = (): string => {
    const key = `landing-preview-${Date.now()}`;
    const previewData = {
      serviceName: selectedService?.name || '',
      serviceId: selectedService?.id,
      servicePrice: selectedService?.price,
      serviceDuration: selectedService?.duration_minutes,
      serviceCurrency: selectedService?.currency || 'USD',
      theme: getSelectedTheme(),
      /*
       * Which design the preview is OF.
       *
       * `getSelectedTheme` deliberately returns only two colours and two font
       * names — that is the shape the save endpoint takes. It cannot carry the
       * archetype's background, type scale, layouts or composition, so without
       * the id alongside it the preview completed from the platform default and
       * showed white with 8px corners whichever look was selected. The owner
       * judged a design they were never shown.
       *
       * Undefined when they chose to keep the business's existing look; both
       * routes then fall back to the business's own template, which is what
       * that choice means.
       */
      templateId: hasExistingTheme && useExistingTheme ? undefined : selectedTemplateId,
      generatedContent: generatedContent || {},
      clientFlow: selectedFlow,
      language,
      showLogo,
      companyName: businessInfo?.companyName,
      subdomain: subdomain
    };
    sessionStorage.setItem(key, JSON.stringify(previewData));
    return key;
  };

  // Update preview data when content changes
  useEffect(() => {
    if (generatedContent && selectedService) {
      const key = storePreviewData();
      setPreviewDataKey(key);
    }
  }, [generatedContent, selectedService, selectedFlow]);

  // Generate default content for preview when AI fails
  const getDefaultGeneratedContent = (service: SchedulingService) => ({
    hero: {
      headline: service.name,
      subheadline: service.description || (language === 'he' ? 'הזמינו עכשיו כדי להתחיל' : language === 'es' ? 'Reserve ahora para comenzar' : 'Book now to get started')
    },
    features: {
      title: language === 'he' ? 'למה לבחור בשירות זה' : language === 'es' ? '¿Por qué elegir este servicio?' : 'Why Choose This Service',
      features: [
        {
          title: language === 'he' ? 'הנחייה מקצועית' : language === 'es' ? 'Guía Experta' : 'Expert Guidance',
          description: language === 'he' ? 'עבודה עם אנשי מקצוע מנוסים' : language === 'es' ? 'Trabaje con profesionales experimentados' : 'Work with experienced professionals'
        },
        {
          title: language === 'he' ? 'גישה מותאמת אישית' : language === 'es' ? 'Enfoque Personalizado' : 'Personalized Approach',
          description: language === 'he' ? 'מותאם לצרכים הספציפיים שלך' : language === 'es' ? 'Adaptado a sus necesidades específicas' : 'Tailored to your specific needs'
        },
        {
          title: language === 'he' ? 'תוצאות מוכחות' : language === 'es' ? 'Resultados Comprobados' : 'Proven Results',
          description: language === 'he' ? 'רקורד של הצלחה' : language === 'es' ? 'Historial de éxito' : 'Track record of success'
        }
      ]
    },
    pricing: {
      title: language === 'he' ? 'השקעה' : language === 'es' ? 'Inversión' : 'Investment'
    },
    faq: {
      title: language === 'he' ? 'שאלות נפוצות' : language === 'es' ? 'Preguntas Frecuentes' : 'Frequently Asked Questions',
      items: [
        {
          question: language === 'he' ? 'למה לצפות?' : language === 'es' ? '¿Qué puedo esperar?' : 'What can I expect?',
          answer: language === 'he' ? 'סביבה תומכת ומקצועית המתמקדת במטרות שלך.' : language === 'es' ? 'Un ambiente de apoyo y profesional centrado en sus objetivos.' : 'A supportive, professional environment focused on your goals.'
        },
        {
          question: language === 'he' ? 'איך להתכונן?' : language === 'es' ? '¿Cómo me preparo?' : 'How do I prepare?',
          answer: language === 'he' ? 'פשוט בוא כמו שאתה. אנחנו נדריך אותך בכל דבר.' : language === 'es' ? 'Simplemente ven como eres. Te guiaremos en todo.' : 'Simply come as you are. We\'ll guide you through everything.'
        },
        {
          question: language === 'he' ? 'מה אם אני צריך לתאם מחדש?' : language === 'es' ? '¿Qué pasa si necesito reprogramar?' : 'What if I need to reschedule?',
          answer: language === 'he' ? 'אנחנו מבינים שהחיים קורים. צור קשר כדי לתאם מחדש.' : language === 'es' ? 'Entendemos que la vida pasa. Contáctenos para reprogramar.' : 'We understand life happens. Contact us to reschedule.'
        }
      ]
    },
    booking_widget: {
      title: language === 'he' ? 'מוכנים להתחיל?' : language === 'es' ? '¿Listo para comenzar?' : 'Ready to Get Started?'
    }
  });

  // Generate landing page content
  const generateContent = async () => {
    if (!selectedService) return;

    setSlug(generateSlug(selectedService.name));
    setGeneratingContent(true);
    setGenerationFailed(null);

    /*
     * A spinner that cannot outlive the request.
     *
     * `generatingContent` is cleared only in this function's `finally`, so a
     * request that never settles — a killed serverless function, a dropped
     * connection — left the wizard spinning with nothing on screen to say so
     * and nothing in the console, because the log line is after the `await`.
     * Ninety seconds is well past a real generation, which takes about seven.
     */
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90_000);

    try {
      const response = await fetch('/api/website/landing-pages/generate', {
        signal: controller.signal,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceId: selectedService.id,
          serviceName: selectedService.name,
          serviceDescription: selectedService.description,
          servicePrice: selectedService.price,
          serviceDuration: selectedService.duration_minutes,
          theme: getSelectedTheme()
        })
      });

      const data = await response.json();
      console.log('[LandingPageWizard] AI generation response:', {
        success: data.success,
        hasContent: !!data.content,
        warning: data.warning,
        debug: data.debug,
        contentKeys: data.content ? Object.keys(data.content) : []
      });

      if (data.success && data.content) {
        // Check if we got real AI content or default content
        if (data.warning) {
          console.warn('[LandingPageWizard] Using fallback content:', data.warning, data.debug);
        }
        setGeneratedContent(data.content);
      } else {
        console.warn('[LandingPageWizard] API failed, using local defaults');
        // Use default content if API fails
        setGeneratedContent(getDefaultGeneratedContent(selectedService));
      }
    } catch (error) {
      console.error('[LandingPageWizard] Error calling generate API:', error);
      // Say so, rather than presenting boilerplate as if it were generated.
      setGenerationFailed(
        (error as Error)?.name === 'AbortError' ? labels.generation_timeout : labels.generation_failed
      );
      setGeneratedContent(getDefaultGeneratedContent(selectedService));
    } finally {
      clearTimeout(timeout);
      setGeneratingContent(false);
    }
  };

  /*
   * The preview step must never wait on something nobody started.
   *
   * Its iframe renders a bare spinner until `previewDataKey` exists, and that
   * key is only set by an effect requiring `generatedContent`. So any route
   * onto this step that does not generate leaves a spinner turning forever
   * with NOTHING in the console — no request was ever made, so there is no
   * failure to log. `handleServiceSelect` is exactly such a route: it sets the
   * step itself rather than going through `goNext`, so the generation call in
   * `goNext`'s step-1 branch never runs.
   *
   * Rather than patch that one path and wait for the next, the step asks for
   * what it needs. `generateContent` sets `generatedContent` on success AND on
   * failure — it falls back to a draft — so this runs once and cannot loop.
   */
  useEffect(() => {
    if (creationType !== 'landing-page') return;
    if (currentStep !== (hasExistingTheme ? 2 : 3)) return;
    if (generatingContent || generatedContent || !selectedService) return;

    void generateContent();
    // `generateContent` is redefined every render; the guards above are what
    // stop this repeating, not the dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creationType, currentStep, hasExistingTheme, generatingContent, generatedContent, selectedService]);

  // Create smart link via API
  const createSmartLink = async (
    destinationType: 'form' | 'booking',
    destinationPath: string,
    name: string,
    metadata?: {
      journeyType?: 'contact-only' | 'full';
      serviceIds?: string[];
      flow?: string[];
    }
  ) => {
    setCreatingSmartLink(true);
    try {
      // Build full URL from path (API requires full URL)
      const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
      const fullDestinationUrl = destinationPath.startsWith('http') ? destinationPath : `${baseUrl}${destinationPath}`;

      const response = await fetch('/api/smart-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          destination_url: fullDestinationUrl,
          destination_type: destinationType,
          name,
          metadata: metadata ? {
            ...metadata,
            destinationType
          } : { destinationType }
        })
      });

      const data = await response.json();
      if (data.success && data.link) {
        setCreatedSmartLink(data.link);
        return data.link;
      }
      return null;
    } catch (error) {
      console.error('[LandingPageWizard] Error creating smart link:', error);
      return null;
    } finally {
      setCreatingSmartLink(false);
    }
  };

  // Update existing smart link via API (for edit mode)
  const updateSmartLink = async (
    destinationType: 'form' | 'booking',
    destinationPath: string,
    name: string,
    metadata?: {
      journeyType?: 'contact-only' | 'full';
      serviceIds?: string[];
      flow?: string[];
    }
  ) => {
    if (!editingSmartLink) return null;

    setCreatingSmartLink(true);
    try {
      // Build full URL from path (API requires full URL)
      const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
      const fullDestinationUrl = destinationPath.startsWith('http') ? destinationPath : `${baseUrl}${destinationPath}`;

      const response = await fetch(`/api/smart-links/${editingSmartLink.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          destination_url: fullDestinationUrl,
          destination_type: destinationType,
          name,
          metadata: metadata ? {
            ...metadata,
            destinationType
          } : { destinationType }
        })
      });

      const data = await response.json();
      if (data.success && data.link) {
        setCreatedSmartLink(data.link);
        return data.link;
      }
      return null;
    } catch (error) {
      console.error('[LandingPageWizard] Error updating smart link:', error);
      return null;
    } finally {
      setCreatingSmartLink(false);
    }
  };

  // Copy smart link to clipboard
  const copySmartLink = () => {
    if (!createdSmartLink) return;
    const url = `${window.location.origin}/go/${createdSmartLink.code}`;
    navigator.clipboard.writeText(url);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  // Build destination URL for smart link with flow params
  // Uses {userCode} placeholder that the API will replace with the actual userCode
  const buildSmartLinkDestination = (): string => {
    // Use placeholder - the API will replace this with the actual userCode from the database
    const userCodePlaceholder = '{userCode}';

    if (journeyType === 'contact-only') {
      return `/c/${userCodePlaceholder}/contact`;
    }

    // Full journey — services only, no flow.
    //
    // The link used to pin `?flow=`, which could not be right for a business
    // whose services walk different journeys. The booking page rebuilds its
    // steps from the service the client picks, so the link says which services
    // it offers and nothing about how they are booked.
    //
    // For smart links: pass selected service IDs (multiple allowed)
    // If only one service selected, pass as single service param for direct selection
    // If multiple or none, pass as services param to filter the list
    let serviceParam = '';
    if (selectedServiceIds.length === 1) {
      // Single service - pre-select it
      serviceParam = `&service=${selectedServiceIds[0]}`;
    } else if (selectedServiceIds.length > 1) {
      // Multiple services - filter to show only these
      serviceParam = `&services=${selectedServiceIds.join(',')}`;
    }
    // If no services selected, show all services (no param needed)

    // `?` then a stripped leading `&`, so the URL is well formed whether or not
    // any services were chosen.
    const query = serviceParam.replace(/^&/, '');
    const url = `/c/${userCodePlaceholder}/book${query ? `?${query}` : ''}`;

    return url;
  };

  // Navigation logic - varies by creation type
  const goNext = async () => {
    // Step 0: Creation type selected
    if (currentStep === 0 && creationType) {
      setCurrentStep(1);
      return;
    }

    // Step 1 varies by creation type
    if (currentStep === 1) {
      if (creationType === 'smart-link') {
        // Journey type selection for smart link
        if (journeyType === 'contact-only') {
          // Create contact form smart link immediately (API will replace {userCode} placeholder)
          const link = await createSmartLink('form', `/c/{userCode}/contact`, labels.smart_link_contact_form_name, {
            journeyType: 'contact-only'
          });
          if (link) {
            setCurrentStep(2); // Go to completion screen
          }
        } else if (journeyType === 'full-journey') {
          // Go to service selection
          setCurrentStep(2);
        }
      } else if (selectedServiceId) {
        /*
         * Landing page: the same advance the card click performs.
         *
         * This branch used to be empty — selecting a card auto-advances, so
         * Continue was left as a no-op with a comment saying so. It is still a
         * BUTTON on the screen, and a button that does nothing when pressed
         * reads as a broken wizard. It is the case that matters most now: a
         * service whose journey cannot run does not advance on selection, so
         * the owner is left looking at a Continue button, pressing it, and
         * getting nothing at all.
         *
         * Runs the same gate for the same reason, then advances the same way.
         */
        const gate = await checkServiceReadiness([selectedServiceId]);
        if (gate && !gate.ready) {
          setServiceGate(gate);
          return;
        }
        setServiceGate(null);
        setCurrentStep(2);
        if (hasExistingTheme) await generateContent();
      }
      return;
    }

    // Smart Link flow: service selection is the last decision.
    //
    // There used to be a journey builder after it, and it could not hold: the
    // journey belongs to the service — a card-paid session and an invoiced
    // programme walk different steps — so a flow pinned to the link contradicted
    // half the catalogue and lost silently at render. The link chooses WHICH
    // services; each service chooses its own journey, shown beside it while
    // picking.
    if (creationType === 'smart-link' && journeyType === 'full-journey') {
      if (currentStep === 2) {
        /*
         * The same gate the landing page gets, for the same reason.
         *
         * A smart link goes live the moment it exists, and the API refuses by
         * creating it INACTIVE — correct, and silent from in here: the owner
         * finished the wizard and got a link that does not work, with the
         * explanation on a response nobody reads.
         *
         * Asked of the services the link will offer. None selected means the
         * whole catalogue, and the check widens to match.
         */
        const gate = await checkServiceReadiness(selectedServiceIds);
        if (gate && !gate.ready) {
          setServiceGate(gate);
          return;
        }
        setServiceGate(null);

        // Service selection → create or update the link and show completion
        const destination = buildSmartLinkDestination();
        // Generate name based on number of services selected
        let linkName = labels.smart_link_booking_link;
        if (selectedServiceIds.length === 1) {
          const service = services.find(s => s.id === selectedServiceIds[0]);
          const suffix = labels.smart_link_service_link_suffix ? ` ${labels.smart_link_service_link_suffix}` : '';
          linkName = `${service?.name || labels.smart_link_booking_link}${suffix}`;
        } else if (selectedServiceIds.length > 1) {
          linkName = labels.smart_link_services_link.replace('{count}', String(selectedServiceIds.length));
        } else {
          linkName = labels.smart_link_all_services;
        }
        const metadata = {
          journeyType: 'full' as const,
          serviceIds: selectedServiceIds,
        };
        // Use update if in edit mode, otherwise create
        const link = isEditMode
          ? await updateSmartLink('booking', destination, linkName, metadata)
          : await createSmartLink('booking', destination, linkName, metadata);
        if (link) {
          setCurrentStep(3);
        }
      }
      return;
    }

    /*
     * Landing Page flow — no journey step.
     *
     * There used to be one between Service and Style, headed "Build Client
     * Journey / Drag to reorder or add or remove steps". It had not been a
     * builder for some time: the journey belongs to the service, so the screen
     * had become a read-only list — and the service-selection step before it
     * already shows the very same strip for the very same service. A whole step
     * of a four-step wizard to look twice at one thing, under a heading
     * promising an editor that is not there.
     *
     * The smart-link flow dropped its equivalent step for the same reason.
     */
    if (creationType === 'landing-page') {
      // A template is what the page is generated from, so the step that picks
      // one cannot be skipped past without picking.
      if (currentStep === 2 && !hasExistingTheme && templates.length > 0 && !selectedTemplateId) {
        return;
      }
      if (currentStep === 1 && selectedServiceId) {
        // The readiness gate for this path lives in `handleServiceSelect`,
        // which is what actually advances a landing page — see the note there.
        //
        // Asked again here rather than trusted: this branch is reachable from
        // anything that calls `goNext` at step 1, and a gate that depends on
        // one entry point being the only one is a gate waiting to be walked
        // around. The check is cheap and the answer is the same.
        const gate = await checkServiceReadiness([selectedServiceId]);
        if (gate && !gate.ready) {
          setServiceGate(gate);
          return;
        }
        setServiceGate(null);

        // Service → Style, or straight to Preview when the theme is settled.
        setCurrentStep(2);
        if (hasExistingTheme) await generateContent();
      } else if (currentStep === 2) {
        if (hasExistingTheme) {
          // Already at preview
          return;
        }
        // Style → Preview
        setCurrentStep(3);
        await generateContent();
      }
    }
  };

  const goBack = () => {
    if (currentStep === 0) return;

    // Smart link completion screen - go back to journey type selection
    if (creationType === 'smart-link' && createdSmartLink) {
      setCreatedSmartLink(null);
      if (journeyType === 'contact-only') {
        setCurrentStep(1);
      } else {
        setCurrentStep(2); // Back to choosing which services the link offers
      }
      return;
    }

    // General back navigation
    if (currentStep === 1) {
      // Go back to step 0, reset creation type
      setCreationType(null);
      setJourneyType(null);
      setCurrentStep(0);
      return;
    }

    setCurrentStep(currentStep - 1);
  };

  const handleServiceSelect = async (serviceId: string) => {
    // For smart links: toggle multi-select (don't auto-advance)
    if (creationType === 'smart-link') {
      setSelectedServiceIds(prev => {
        const newIds = prev.includes(serviceId)
          ? prev.filter(id => id !== serviceId)
          : [...prev, serviceId];
        // Also update selectedServiceId for backward compatibility (use first selected)
        setSelectedServiceId(newIds.length > 0 ? newIds[0] : null);
        return newIds;
      });
      return; // Don't auto-advance for smart links
    }

    // For landing pages: single select with auto-advance
    setSelectedServiceId(serviceId);
    // A gap belongs to the service that had it. Leaving the message up while a
    // different one is selected would blame the new choice for the old problem.
    setServiceGate(null);
    // Find the selected service for slug generation
    const service = services.find(s => s.id === serviceId);
    if (!service) return;

    // No description, no page. Ask for it here instead of advancing.
    if (!service.description || !service.description.trim()) {
      setDescribeServiceId(serviceId);
      return;
    }
    setDescribeServiceId(null);

    // Set slug from service name
    setSlug(generateSlug(service.name));

    /*
     * ─────────────────────────────────────────────────────────────────────────
     * CAN THIS SERVICE BE SOLD AT ALL?
     *
     * Checked HERE, not in `goNext`. This handler advances the landing-page
     * flow itself — `setCurrentStep(2)` on the line below — and never calls
     * `goNext`, so a gate placed in `goNext`'s step-1 branch was simply never
     * reached. The wizard carried on, generated a page for a service whose
     * journey cannot run, and the first sign of trouble was the generation
     * call failing.
     *
     * Only BLOCKING gaps stop them: a missing card processor is fine, because
     * the client is invoiced instead. A service that needs none of this — a
     * free product, say — passes straight through and sees nothing.
     */
    const gate = await checkServiceReadiness([serviceId]);
    if (gate && !gate.ready) {
      setServiceGate(gate);
      return;
    }

    // Landing page: Step 1 (service) → Step 2 (journey)
    setCurrentStep(2);
  };

  // Handle smart link completion (user clicks "Done")
  const handleSmartLinkComplete = () => {
    if (!createdSmartLink) return;

    const clientFlowSteps: ClientFlowStep[] = journeyType === 'contact-only'
      ? ['client_info', 'confirmation']
      : selectedFlow;

    onComplete({
      creationType: 'smart-link',
      smartLink: createdSmartLink,
      journeyType: journeyType || 'contact-only',
      clientFlow: clientFlowSteps,
      serviceId: selectedServiceId || undefined,
      serviceName: selectedService?.name
    });
  };

  const handleComplete = async (shouldPublish: boolean) => {
    // Guarded here as well: the buttons are disabled, but a handler that
    // trusts its own UI is one refactor from creating an unreachable page.
    if (!slug.trim()) return;

    console.log('[LandingPageWizard] handleComplete called', { shouldPublish, selectedService: !!selectedService });

    if (!selectedService) {
      console.warn('[LandingPageWizard] No selected service, returning early');
      return;
    }

    setPublishing(shouldPublish);
    setLoading(true);

    // Ensure confirmation is at the end
    const clientFlowSteps: ClientFlowStep[] = selectedFlow.includes('confirmation')
      ? selectedFlow
      : [...selectedFlow.filter((s): s is ClientFlowStep => s !== 'confirmation'), 'confirmation'];

    const result: LandingPageWizardResult = {
      creationType: 'landing-page',
      serviceId: selectedService.id,
      serviceName: selectedService.name,
      stylePreset: hasExistingTheme && useExistingTheme ? 'existing' : selectedPresetId,
      // The template this page is built from, so the page records it and — if
      // the business has none yet — adopts it as its own.
      templateId: hasExistingTheme && useExistingTheme ? undefined : (selectedTemplateId ?? undefined),
      theme: getSelectedTheme(),
      slug,
      shouldPublish,
      clientFlow: clientFlowSteps,
      generatedContent: generatedContent || {},
      showLogo
    };

    console.log('[LandingPageWizard] Calling onComplete with:', {
      serviceId: result.serviceId,
      serviceName: result.serviceName,
      slug: result.slug,
      hasGeneratedContent: !!result.generatedContent,
      contentKeys: Object.keys(result.generatedContent || {})
    });

    onComplete(result);
  };

  // Device widths for preview
  const DEVICE_WIDTHS: Record<'desktop' | 'tablet' | 'mobile', string> = {
    desktop: '100%',
    tablet: '768px',
    mobile: '375px'
  };

  // Render Step 0: Creation Type Selection
  const renderStep0 = () => (
    <div className="space-y-4">
      {/* Smart Link Option */}
      <button
        onClick={() => {
          setCreationType('smart-link');
          setCurrentStep(1);
        }}
        className="w-full p-5 rounded-xl border-2 border-[var(--v2-border)] hover:border-[#4F6EF7] hover:bg-[#4F6EF7]/5 transition-all text-start group"
      >
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: '#4F6EF720' }}>
            <Link className="w-6 h-6" style={{ color: '#4F6EF7' }} />
          </div>
          <div className="flex-1">
            <h4 className="text-base font-semibold text-[var(--v2-text-primary)] group-hover:text-[#4F6EF7] transition-colors">
              {labels.creation_smart_link}
            </h4>
            <p className="text-sm text-[var(--v2-text-secondary)] mt-1">
              {labels.creation_smart_link_desc}
            </p>
          </div>
          <ChevronRight className="w-5 h-5 text-[var(--v2-text-muted)] group-hover:text-[#4F6EF7] transition-colors flex-shrink-0 mt-1" />
        </div>
      </button>

      {/* Landing Page Option */}
      <button
        onClick={() => {
          setCreationType('landing-page');
          setCurrentStep(1);
        }}
        className="w-full p-5 rounded-xl border-2 border-[var(--v2-border)] hover:border-[#4F6EF7] hover:bg-[#4F6EF7]/5 transition-all text-start group"
      >
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: '#22C58B20' }}>
            <FileText className="w-6 h-6" style={{ color: '#22C58B' }} />
          </div>
          <div className="flex-1">
            <h4 className="text-base font-semibold text-[var(--v2-text-primary)] group-hover:text-[#4F6EF7] transition-colors">
              {labels.creation_landing_page}
            </h4>
            <p className="text-sm text-[var(--v2-text-secondary)] mt-1">
              {labels.creation_landing_page_desc}
            </p>
          </div>
          <ChevronRight className="w-5 h-5 text-[var(--v2-text-muted)] group-hover:text-[#4F6EF7] transition-colors flex-shrink-0 mt-1" />
        </div>
      </button>
    </div>
  );

  // Render Smart Link Journey Type Selection (Step 1 for smart links)
  const renderJourneyTypeSelection = () => (
    <div className="space-y-4">
      {/* Contact Form Only */}
      <button
        onClick={async () => {
          setJourneyType('contact-only');
          // Create contact form smart link immediately (API will replace {userCode} placeholder)
          const link = await createSmartLink('form', `/c/{userCode}/contact`, labels.smart_link_contact_form_name, {
            journeyType: 'contact-only'
          });
          if (link) {
            setCurrentStep(2); // Go to completion screen
          }
        }}
        disabled={creatingSmartLink}
        className="w-full p-5 rounded-xl border-2 border-[var(--v2-border)] hover:border-[#4F6EF7] hover:bg-[#4F6EF7]/5 transition-all text-start group disabled:opacity-50"
      >
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: '#8B5CF620' }}>
            <MessageSquare className="w-6 h-6" style={{ color: '#8B5CF6' }} />
          </div>
          <div className="flex-1">
            <h4 className="text-base font-semibold text-[var(--v2-text-primary)] group-hover:text-[#4F6EF7] transition-colors">
              {labels.journey_contact_only}
            </h4>
            <p className="text-sm text-[var(--v2-text-secondary)] mt-1">
              {labels.journey_contact_only_desc}
            </p>
            <p className="text-xs text-[var(--v2-text-muted)] mt-2">
              {labels.journey_contact_only_best_for}
            </p>
          </div>
          {creatingSmartLink && journeyType === 'contact-only' ? (
            <Loader2 className="w-5 h-5 text-[#4F6EF7] animate-spin flex-shrink-0 mt-1" />
          ) : (
            <ChevronRight className="w-5 h-5 text-[var(--v2-text-muted)] group-hover:text-[#4F6EF7] transition-colors flex-shrink-0 mt-1" />
          )}
        </div>
      </button>

      {/* Full User Journey */}
      <button
        onClick={() => {
          setJourneyType('full-journey');
          setCurrentStep(2); // Go to service selection
        }}
        disabled={creatingSmartLink}
        className="w-full p-5 rounded-xl border-2 border-[var(--v2-border)] hover:border-[#4F6EF7] hover:bg-[#4F6EF7]/5 transition-all text-start group disabled:opacity-50"
      >
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: '#F59E0B20' }}>
            <Calendar className="w-6 h-6" style={{ color: '#F59E0B' }} />
          </div>
          <div className="flex-1">
            <h4 className="text-base font-semibold text-[var(--v2-text-primary)] group-hover:text-[#4F6EF7] transition-colors">
              {labels.journey_full}
            </h4>
            <p className="text-sm text-[var(--v2-text-secondary)] mt-1">
              {labels.journey_full_desc}
            </p>
            <p className="text-xs text-[var(--v2-text-muted)] mt-2">
              {labels.journey_full_best_for}
            </p>
          </div>
          <ChevronRight className="w-5 h-5 text-[var(--v2-text-muted)] group-hover:text-[#4F6EF7] transition-colors flex-shrink-0 mt-1" />
        </div>
      </button>
    </div>
  );

  // Render Smart Link Completion Screen (Compact)
  const renderSmartLinkComplete = () => {
    if (!createdSmartLink) return null;

    const fullUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/go/${createdSmartLink.code}`;
    const shortCode = createdSmartLink.code;

    return (
      <div className="space-y-4">
        {/* Compact Success Header */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3"
        >
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 200, damping: 15 }}
            className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: '#22C58B' }}
          >
            <Check className="w-6 h-6 text-white" strokeWidth={3} />
          </motion.div>
          <div>
            <h2 className="text-lg font-bold text-[var(--v2-text-primary)]">
              {isEditMode ? labels.smart_link_updated_title : labels.smart_link_ready_title}
            </h2>
            <p className="text-sm text-[var(--v2-text-muted)]">{createdSmartLink.name}</p>
          </div>
        </motion.div>

        {/* Link Card - Compact */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-gradient-to-br from-[#4F6EF7]/5 to-[#4F6EF7]/10 border border-[#4F6EF7]/20 p-4 rounded-xl"
        >
          {/* URL Display - Single line */}
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-lg flex-shrink-0 flex items-center justify-center bg-[#4F6EF7]">
              <Link className="w-4 h-4 text-white" />
            </div>
            <code className="text-sm font-semibold text-[var(--v2-text-primary)] truncate flex-1" dir="ltr">
              /go/{shortCode}
            </code>
          </div>

          {/* Action Buttons Row */}
          <div className="flex gap-2">
            <button
              onClick={copySmartLink}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-semibold rounded-lg transition-all"
              style={{
                backgroundColor: linkCopied ? '#22C58B' : '#4F6EF7',
                color: 'white'
              }}
            >
              {linkCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {linkCopied ? labels.smart_link_copied : labels.smart_link_copy}
            </button>
            <button
              onClick={() => window.open(fullUrl, '_blank')}
              className="p-2 text-[var(--v2-text-secondary)] bg-white/80 dark:bg-white/10 border border-[var(--v2-border)] rounded-lg hover:bg-white dark:hover:bg-white/20 transition-all"
              title={labels.smart_link_preview}
            >
              <ExternalLink className="w-4 h-4" />
            </button>
            <button
              className="p-2 text-[var(--v2-text-secondary)] bg-white/80 dark:bg-white/10 border border-[var(--v2-border)] rounded-lg hover:bg-white dark:hover:bg-white/20 transition-all"
              title={labels.smart_link_show_qr}
              onClick={() => setShowQRModal(true)}
            >
              <QrCode className="w-4 h-4" />
            </button>
          </div>
        </motion.div>

        {/* Action Buttons */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="flex gap-2"
        >
          <button
            onClick={handleSmartLinkComplete}
            className="flex-1 px-4 py-2.5 bg-[#4F6EF7] text-white font-semibold rounded-xl hover:bg-[#3B5AE5] transition-all shadow-sm"
          >
            {labels.smart_link_done}
          </button>
          <button
            onClick={() => {
              // Reset and start over
              setCreatedSmartLink(null);
              setCreationType(null);
              setJourneyType(null);
              setSelectedServiceId(null);
              setSelectedServiceIds([]);
              setCurrentStep(0);
            }}
            className="flex-1 px-4 py-2.5 border border-[var(--v2-border)] text-[var(--v2-text-primary)] font-medium rounded-xl hover:bg-[var(--v2-surface-hover)] transition-all"
          >
            {labels.smart_link_create_another}
          </button>
        </motion.div>

        {/* QR Code Modal */}
        <AnimatePresence>
          {showQRModal && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
              onClick={() => setShowQRModal(false)}
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="bg-white dark:bg-[var(--v2-surface)] rounded-2xl p-6 shadow-xl max-w-sm w-full mx-4"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-[var(--v2-text-primary)]">
                    {labels.smart_link_show_qr}
                  </h3>
                  <button
                    onClick={() => setShowQRModal(false)}
                    className="p-1.5 text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] hover:bg-[var(--v2-surface-hover)] rounded-lg transition-all"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="flex flex-col items-center">
                  <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
                    <QRCodeSVG
                      value={fullUrl}
                      size={200}
                      level="H"
                      includeMargin={false}
                    />
                  </div>
                  <p className="mt-4 text-sm text-[var(--v2-text-secondary)] text-center break-all max-w-[250px]">
                    {fullUrl}
                  </p>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  // Render Step 1: Service Selection
  const renderStep1 = () => (
    <div className="space-y-4">
      {/*
        Why the chosen service cannot be sold yet.

        Shown against the choice that caused it, because that is where it can be
        acted on — either by picking a different service or by leaving to fill
        the gap in. Without it the Next button simply did nothing, which reads
        as a broken wizard rather than as a decision being blocked.
      */}
      {serviceGate && !serviceGate.ready && (
        <div className="space-y-2">
          {serviceGate.gaps && serviceGate.gaps.length > 0 ? (
            serviceGate.gaps.map(gap => {
              const isInvoicing = gap.kind === 'invoicing';
              const GapIcon = isInvoicing ? FileText : Clock;
              return (
                <div
                  key={gap.kind}
                  className="flex items-start gap-3 p-3 bg-[var(--v2-surface)] border border-[var(--v2-border)]"
                  style={{ borderRadius: 'var(--v2-radius-card)' }}
                >
                  <div
                    className="flex-shrink-0 w-8 h-8 flex items-center justify-center bg-amber-500/15 text-amber-600 dark:text-amber-400"
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                  >
                    <GapIcon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-[var(--v2-text-primary)]">{gap.message}</p>
                    <button
                      type="button"
                      onClick={() =>
                        openConfiguration(isInvoicing ? 'invoice' : 'availability', {
                          /*
                            Ask again once they come back.

                            The owner has just been sent to fix the very thing
                            this message names, so leaving it up asserts an
                            answer that may no longer be true — and in a wizard
                            it also blocks the step they were trying to reach.
                          */
                          onClose: async () => {
                            if (!selectedServiceId) return;
                            const again = await checkServiceReadiness([selectedServiceId]);
                            setServiceGate(again && !again.ready ? again : null);
                          },
                        })
                      }
                      className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#4F6EF7] hover:bg-[#3B5AE5] transition-colors"
                      style={{ borderRadius: 'var(--v2-radius-button)' }}
                    >
                      {isInvoicing ? labels.fix_invoicing : labels.fix_availability}
                      <ArrowRight className={`w-3.5 h-3.5 ${language === 'he' ? 'rotate-180' : ''}`} />
                    </button>
                  </div>
                </div>
              );
            })
          ) : serviceGate.error ? (
            <p
              className="px-3 py-2.5 text-sm bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-200"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
              role="status"
            >
              {serviceGate.error}
            </p>
          ) : null}
        </div>
      )}

      {loadingServices ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-[var(--v2-text-muted)]" />
          <span className="ml-2 text-sm text-[var(--v2-text-muted)]">{labels.loading_services}</span>
        </div>
      ) : services.length === 0 && !showCreateService ? (
        <div className="text-center py-8">
          <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-[var(--v2-surface-hover)] flex items-center justify-center">
            <Calendar className="w-6 h-6 text-[var(--v2-text-muted)]" />
          </div>
          <h3 className="text-base font-semibold text-[var(--v2-text-primary)] mb-1">{labels.no_services}</h3>
          <p className="text-sm text-[var(--v2-text-secondary)] mb-4">{labels.no_services_desc}</p>
          <button
            onClick={() => setShowCreateService(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-[#4F6EF7] text-white text-sm font-medium rounded-lg hover:bg-[#3B5AE5] transition-all"
          >
            <Plus className="w-4 h-4" />
            {labels.create_new_service}
          </button>
        </div>
      ) : showCreateService ? (
        /*
          ───────────────────────────────────────────────────────────────────
          THE REAL SERVICE FORM, NOT A SMALLER COPY OF IT.

          This was four fields — name, description, duration, price — while
          Settings edits eleven. The four it left out are precisely the ones
          every readiness gate reads:

            is_scheduled   decides whether working hours are required
            collection     with price, decides card-at-booking vs invoice
            sale_mode      decides whether there is a price at all yet
            currency       what the price is even denominated in

          So a service made here arrived on DEFAULTS, and `collection: null`
          reads as "takes cards" — meaning a service created in this wizard
          could immediately trip the invoicing gate over a choice the form had
          never offered. Create a service, then be blocked by a setting you were
          never asked about.

          `SchedulingServicesList` already supports being embedded this way:
          `autoStartNewRow` opens straight into the new row, and an empty
          `services` array means only that row is drawn — the picker below is
          still this wizard's own.
        */
        <div className="space-y-4">
          <SchedulingServicesList
            /*
              Empty on purpose: the editor then draws ONLY the row being added.
              Handed the real catalogue it listed every existing service in an
              editable form, inviting changes to services this wizard was never
              about.
            */
            services={[]}
            autoStartNewRow
            showAddButton={false}
            // Editor only: this wizard adds one service, it does not manage the
            // catalogue — and with no services passed the column was empty.
            hideServiceList
            intakeEnabled={false}
            /*
              The journey strip on the row draws a payment step from this, and
              showing a step clients cannot complete is the failure worth
              avoiding — so it stays false until the check below says otherwise.
            */
            processorReady={processorReady}
            /*
              `onServiceEdited` fires when the new service is SAVED — as a
              draft, which is what this editor creates. Left there it never
              reached the picker below, which lists live services only, so a
              service you had just added appeared nowhere.
            */
            onServiceEdited={async (serviceId) => {
              await publishAndSelectService(serviceId);
            }}
            onServicePublishedWithId={async (serviceId) => {
              await fetchServices();
              setShowCreateService(false);
              handleServiceSelect(serviceId);
            }}
            onSilentRefresh={fetchServices}
            /*
              The form's own Cancel is the only one.

              There used to be a second below it, because the form's cancel only
              collapsed its row — leaving the wizard still in "create" mode with
              the list hidden, so the panel fell back to "pick one from the
              list" and there was nothing to pick from. It reports back now, so
              one button does the whole job.
            */
            onCancelNewRow={() => setShowCreateService(false)}
          />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-2">
            {/* Multi-select hint for smart links */}
            {creationType === 'smart-link' && services.length > 1 && (
              <div className="text-sm text-[var(--v2-text-muted)] mb-2 flex items-center gap-2">
                <Layers className="w-4 h-4" />
                {labels.multi_select_hint}
              </div>
            )}

            {services.map((service) => {
              // For smart links, use multi-select; for landing pages, use single select
              const isSelected = creationType === 'smart-link'
                ? selectedServiceIds.includes(service.id)
                : selectedServiceId === service.id;
              // Get currency symbol from centralized currency configs
              const serviceCurrency = (service.currency || 'USD') as 'USD' | 'EUR' | 'ILS' | 'GBP';
              const currencySymbol = availableCurrencies[serviceCurrency]?.symbol || '$';

              return (
                <div key={service.id}>
                <button
                  onClick={() => handleServiceSelect(service.id)}
                  disabled={checkingService}
                  // `w-full`: the button used to be the grid's own child and so
                  // stretched to the column. Wrapping it in a div — needed so the
                  // description field can sit outside a button — made it size to
                  // its content instead, giving every service a card as wide as
                  // its own name.
                  className={`relative w-full text-start p-4 rounded-xl border transition-all ${
                    isSelected
                      ? 'ring-2 ring-[#4F6EF7] border-[#4F6EF7] bg-[#4F6EF7]/5'
                      : 'border-[var(--v2-border)] hover:border-[#4F6EF7]/50 bg-[var(--v2-surface)]'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                      isSelected ? 'bg-[#4F6EF7]/20' : 'bg-[var(--v2-surface-hover)]'
                    }`}>
                      <Calendar className={`w-5 h-5 ${isSelected ? 'text-[#4F6EF7]' : 'text-[var(--v2-text-muted)]'}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-medium text-[var(--v2-text-primary)] truncate">{service.name}</h4>
                      <div className="flex items-center gap-3 text-xs text-[var(--v2-text-muted)]">
                        {service.duration_minutes ? (
                          <span>{service.duration_minutes} {labels.minutes_abbr}</span>
                        ) : null}
                        {service.price != null && (
                          <span className="text-green-600 font-medium">{currencySymbol}{service.price}</span>
                        )}
                      </div>
                      {/* What a client picking this service actually walks
                          through. The journey is the service's own, so this is
                          how the difference between them becomes visible while
                          choosing which to offer — the link cannot change it,
                          and pretending otherwise is what the flow builder
                          used to do. */}
                      <div className="mt-2">
                        <ClientJourneyStrip
                          compact
                          service={{
                            scheduled: service.is_scheduled !== false,
                            collection: service.collection ?? null,
                            price: service.price,
                          }}
                        />
                      </div>
                    </div>
                    {isSelected && (
                      <div className="w-6 h-6 bg-[#4F6EF7] rounded-full flex items-center justify-center">
                        <Check className="w-4 h-4 text-white" />
                      </div>
                    )}
                  </div>
                </button>

                {/* Outside the button, because it contains a form. */}
                {describeServiceId === service.id && (
                  <div
                    className="mt-2 p-4 bg-[var(--v2-bg)] border border-[var(--v2-border)]"
                    style={{ borderRadius: 'var(--v2-radius-card)' }}
                  >
                    <ServiceDescriptionField
                      service={service}
                      language={language as 'en' | 'es' | 'he'}
                      autoFocus
                      onSaved={async (serviceId, description) => {
                        setServices(prev => prev.map(item =>
                          item.id === serviceId ? { ...item, description } : item
                        ));
                        setDescribeServiceId(null);
                        setSlug(generateSlug(service.name));

                        /*
                         * Now it can be published.
                         *
                         * A service added through the embedded editor without a
                         * description is deliberately left as a draft — the
                         * publish rule requires one, because the website writes
                         * its section from that text. This is where the
                         * description arrives, so this is where it becomes
                         * publishable. Harmless for a service that was already
                         * live: the endpoint is idempotent.
                         */
                        await fetch(`/api/scheduling/services/${serviceId}/publish`, {
                          method: 'POST',
                        }).catch(err => logger.warn({ err, serviceId }, 'Could not publish after describing'));
                        await fetchServices();

                        /*
                         * The gate again — this is the THIRD way past this step.
                         *
                         * A service with no description never reaches the check
                         * in `handleServiceSelect`: that returns early to ask
                         * for one. Writing the description then advanced
                         * straight to step 2 from here, so filling in a
                         * description was a way of walking around a gate that
                         * had nothing to do with descriptions.
                         *
                         * Three entry points to one step is the actual lesson:
                         * the check belongs to the transition, and every route
                         * into it has to ask.
                         */
                        const gate = await checkServiceReadiness([serviceId]);
                        if (gate && !gate.ready) {
                          setServiceGate(gate);
                          return;
                        }
                        setServiceGate(null);
                        setCurrentStep(2);
                      }}
                    />
                  </div>
                )}
              </div>
              );
            })}
          </div>

          {/* Create new service button */}
          <button
            onClick={() => setShowCreateService(true)}
            className="w-full p-4 rounded-xl border-2 border-dashed border-[var(--v2-border)] hover:border-[#4F6EF7]/50 transition-all flex items-center justify-center gap-2 text-[var(--v2-text-muted)] hover:text-[#4F6EF7]"
          >
            <Plus className="w-5 h-5" />
            <span className="text-sm font-medium">{labels.create_new_service}</span>
          </button>
        </>
      )}
    </div>
  );

  // Render Step 2: Journey Selection
  // DnD sensors for drag and drop
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Handle drag end for journey steps
  const handleJourneyDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setSelectedFlow(prev => {
        const oldIndex = prev.indexOf(active.id as ClientFlowStep);
        const newIndex = prev.indexOf(over.id as ClientFlowStep);

        // Don't allow moving past confirmation (which should always be last)
        if (newIndex === prev.length - 1 && prev[prev.length - 1] === 'confirmation') {
          return prev;
        }

        return arrayMove(prev, oldIndex, newIndex);
      });
    }
  };

  // Toggle a step in the client journey
  const toggleJourneyStep = (step: ClientFlowStep) => {
    if (step === 'confirmation') return; // Confirmation is always included

    setSelectedFlow(prev => {
      if (prev.includes(step)) {
        return prev.filter(s => s !== step);
      } else {
        // Add step before confirmation
        const withoutConfirmation = prev.filter(s => s !== 'confirmation');
        return [...withoutConfirmation, step, 'confirmation'];
      }
    });
  };

  // Auto-add payment if service has price - only when service changes
  useEffect(() => {
    if (!selectedService) return;
    const serviceHasPrice = selectedService.price != null && selectedService.price > 0;
    if (serviceHasPrice && !selectedFlow.includes('payment')) {
      setSelectedFlow(prev => {
        if (prev.includes('payment')) return prev; // Already has payment
        const withoutConfirmation = prev.filter(s => s !== 'confirmation');
        return [...withoutConfirmation, 'payment', 'confirmation'];
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedService?.id, selectedService?.price]); // Only trigger when service changes

  /**
   * The journey, shown rather than built.
   *
   * This was an editable flow builder — add a payment step, drop the date —
   * and it could not be honoured. The journey belongs to the service: a
   * card-paid session and an invoiced programme walk different steps, and the
   * booking page rebuilds them from whichever service the client picks. A flow
   * chosen here simply lost at render, silently, which is worse than not
   * offering the choice.
   *
   * So the step now reports what this page's service will actually do.
   */
  /*
   * Removed: the landing page's journey step.
   *
   * It rendered a read-only strip per service under the heading "Build Client
   * Journey / Drag to reorder or add or remove steps" — an editor that had
   * stopped existing once the journey became a property of the service. The
   * service-selection step before it already shows the same strip for the same
   * service, so this was a whole step of a four-step wizard spent looking twice
   * at one thing.
   */
  // Render Step 3: Style Selection (only shown if no existing theme)
  const renderStep2Style = () => (
    <div className="space-y-4">
      {/* If has existing theme, show option to use it */}
      {/* The business logo, when there is one to show. The image comes from the
          business profile — this only chooses whether this page wears it. */}
      {businessInfo?.logoUrl && (
        <label className="w-full flex items-center gap-3 p-3 rounded-xl border border-[var(--v2-border)] cursor-pointer">
          <input
            type="checkbox"
            checked={showLogo}
            onChange={(e) => setShowLogo(e.target.checked)}
            className="w-4 h-4 accent-[#4F6EF7]"
          />
          <img
            src={businessInfo.logoUrl}
            alt=""
            className="w-8 h-8 object-contain rounded"
          />
          <span className="text-sm text-[var(--v2-text-secondary)]">{labels.show_logo}</span>
        </label>
      )}

      {hasExistingTheme && existingTheme && (
        <button
          onClick={() => {
            // The only path forward when a look already exists. Kept as a
            // button rather than made static so the step still advances the
            // way every other step in this wizard does.
            setUseExistingTheme(true);
            goNext();
          }}
          className={`w-full p-4 rounded-xl border-2 transition-all text-start ${
            useExistingTheme
              ? 'border-[#4F6EF7] ring-2 ring-[#4F6EF7]/20 bg-[#4F6EF7]/5'
              : 'border-[var(--v2-border)] hover:border-[#4F6EF7]/50'
          }`}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-12 h-12 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: existingTheme.colors.primary }}
            >
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <div className="flex-1">
              <h4 className="font-medium text-[var(--v2-text-primary)]">{labels.using_website_style}</h4>
              <p className="text-sm text-[var(--v2-text-secondary)]">{labels.using_website_style_desc}</p>
            </div>
            {useExistingTheme && (
              <div className="w-6 h-6 bg-[#4F6EF7] rounded-full flex items-center justify-center">
                <Check className="w-4 h-4 text-white" />
              </div>
            )}
          </div>
        </button>
      )}

      {/*
        The gallery, ONLY for a business that has no look yet.
        ─────────────────────────────────────────────────────────────────────
        A landing page does not get its own template. It is the same business
        as the invoice that follows it and the booking confirmation after that,
        and a client who meets a near-black page and then receives a cream
        receipt has not met one business.

        This used to show the gallery whenever the owner unchecked "use my
        existing look", and the split it created was permanent —
        `adoptBusinessTemplate` is adopt-only, so the page kept a template the
        business never wore, and the only repair was to re-apply the business
        template, which silently overwrote the page.

        The exception is not an exception to that rule: a business whose FIRST
        surface is a landing page has no template for it to differ from, so its
        choice here establishes the look for everything built afterwards —
        exactly as the onboarding build does when that comes first.
      */}
      {!hasExistingTheme && (
        <>
          {/*
            The real templates, not a private palette.

            This offered four hardcoded STYLE_PRESETS — colour pairs with no id
            the rest of the product recognises — so a landing page created
            before any website gave the business a look but no template, and
            everything generated afterwards had nothing to be consistent with.
            These are the same templates the website wizard and the Templates
            tab offer, so whichever surface a business builds first, it is
            choosing from one catalogue.
          */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Every design's typeface, in one request. */}
            <ArchetypeFontLinks
              families={templates.flatMap(t => [
                t.theme.fonts?.heading,
                t.theme.fonts?.body,
                t.theme.font_heading,
                t.theme.font_family,
              ])}
            />
            {templates.map((template) => {
              const isSelected = selectedTemplateId === template.id && !useExistingTheme;
              const primary = template.theme.primary_color || '#4F6EF7';
              const secondary = template.theme.secondary_color || '#6366F1';
              const accent = template.theme.accent_color || secondary;
              const archetypeLabel = getArchetypeLabel(template.id, language as 'en' | 'es' | 'he');

              return (
                <button
                  key={template.id}
                  onClick={() => {
                    setSelectedTemplateId(template.id);
                    setUseExistingTheme(false);
                  }}
                  className={`relative w-full text-start p-3 rounded-xl border transition-all ${
                    isSelected
                      ? 'ring-2 ring-[#4F6EF7] border-[#4F6EF7]'
                      : 'border-[var(--v2-border)] hover:border-[#4F6EF7]/50'
                  }`}
                >
                  {/* The same card every other gallery shows, so a design looks
                      like itself wherever it is offered. */}
                  <div className="rounded-lg overflow-hidden mb-2">
                    <ArchetypePreview
                      name={archetypeLabel.name || template.name}
                      background={template.theme.colors?.background}
                      ink={template.theme.colors?.text}
                      inkMuted={template.theme.colors?.textSecondary}
                      brand={primary}
                      accent={accent}
                      headingFont={
                        template.theme.fonts?.heading
                        || template.theme.font_heading
                        || template.theme.font_family
                      }
                      radius={template.borderRadius}
                      selected={isSelected}
                      heightClass="h-20"
                    />
                  </div>
                  {/* Named and described the same way the website wizard does
                      it — a landing page wears the business's design, so the
                      two galleries have to be the same gallery. */}
                  <h4 className="text-sm font-medium text-[var(--v2-text-primary)] truncate">
                    {archetypeLabel.blurb
                      ? archetypeLabel.name
                      : getTranslatedTemplateName(template.name, language as 'en' | 'es' | 'he', template.id)}
                  </h4>
                  <p className="text-xs text-[var(--v2-text-muted)] truncate">
                    {archetypeLabel.blurb
                      || (template.theme.brand_voice
                        ? getTranslatedBrandVoice(template.theme.brand_voice, language as 'en' | 'es' | 'he')
                        : getTranslatedVertical(template.vertical, language as 'en' | 'es' | 'he'))}
                  </p>
                  {isSelected && (
                    <div className="absolute top-2 right-2 w-5 h-5 bg-[#4F6EF7] rounded-full flex items-center justify-center">
                      <Check className="w-3 h-3 text-white" />
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* Hint text to help users */}
          <p className="text-xs text-[var(--v2-text-muted)] text-center pt-2">
            {language === 'he' ? 'בחר סגנון ולחץ המשך' :
             language === 'es' ? 'Selecciona un estilo y haz clic en continuar' :
             'Select a style and click Continue below'}
          </p>
        </>
      )}
    </div>
  );

  // Render Step 3: Preview & Publish (or Step 2 if theme exists)
  const renderStepPreview = () => (
    <div className="space-y-4">
      {/* Why this page reads like a template rather than like the service. It
          used to fall back to boilerplate in silence, so a failed generation
          was indistinguishable from a poor one. */}
      {generationFailed && !generatingContent && (
        <div
          className="p-3 text-xs bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300"
          style={{ borderRadius: 'var(--v2-radius-button)' }}
        >
          {generationFailed}
        </div>
      )}
      {generatingContent ? (
        <div className="flex flex-col items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-[#4F6EF7] mb-3" />
          <p className="text-sm text-[var(--v2-text-muted)]">{labels.generating}</p>
          <p className="text-xs text-[var(--v2-text-muted)] mt-2 opacity-60">
            {language === 'he' ? 'זה ייקח רק כמה שניות...' :
             language === 'es' ? 'Esto solo tomará unos segundos...' :
             'This will only take a few seconds...'}
          </p>
        </div>
      ) : (
        <>
          {/* Preview frame */}
          <div className="border border-[var(--v2-border)] rounded-lg overflow-hidden">
            {/* Browser chrome */}
            <div className="bg-[var(--v2-surface-hover)] px-3 py-1.5 flex items-center gap-2 border-b border-[var(--v2-border)]">
              <div className="flex gap-1">
                <div className="w-2 h-2 rounded-full bg-red-400" />
                <div className="w-2 h-2 rounded-full bg-amber-400" />
                <div className="w-2 h-2 rounded-full bg-green-400" />
              </div>
              <div className="flex-1 flex justify-center">
                <div className="bg-[var(--v2-surface)] rounded px-3 py-0.5 text-xs text-[var(--v2-text-secondary)] border border-[var(--v2-border)]">
                  {subdomain || 'yoursite'}.agentspilot.com/{slug || 'service'}
                </div>
              </div>
              {/* Device toggle */}
              <div className="flex items-center gap-0.5 bg-[var(--v2-surface)] rounded p-0.5">
                {[
                  { mode: 'desktop' as const, icon: Monitor },
                  { mode: 'tablet' as const, icon: Tablet },
                  { mode: 'mobile' as const, icon: Smartphone }
                ].map(({ mode, icon: Icon }) => (
                  <button
                    key={mode}
                    onClick={() => setDeviceMode(mode)}
                    className={`p-1 rounded transition-all ${
                      deviceMode === mode
                        ? 'bg-[#4F6EF7] text-white'
                        : 'text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)]'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                  </button>
                ))}
              </div>
            </div>

            {/* Full Landing Page Preview - Iframe with actual block components */}
            <div className="bg-gray-100 flex justify-center overflow-hidden" style={{ height: '400px' }}>
              <div
                className="bg-white shadow-lg transition-all duration-300 overflow-hidden"
                style={{
                  width: DEVICE_WIDTHS[deviceMode],
                  maxWidth: '100%',
                  borderRadius: deviceMode !== 'desktop' ? '8px' : '0',
                  margin: deviceMode !== 'desktop' ? '8px' : '0'
                }}
              >
                {previewDataKey ? (
                  <iframe
                    key={previewDataKey}
                    src={`/landing-preview?dataKey=${previewDataKey}&lang=${language}`}
                    className="w-full h-full border-0"
                    title="Landing Page Preview"
                    style={{ minHeight: '400px' }}
                  />
                ) : (
                  /* Says what it is waiting for. A bare spinner here was
                     indistinguishable from a spinner that would never stop. */
                  <div className="w-full h-full flex flex-col items-center justify-center gap-2">
                    <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                    <p className="text-xs text-[var(--v2-text-muted)]">{labels.preview_building}</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Slug input */}
          <div>
            <label className="block text-xs font-medium text-[var(--v2-text-secondary)] mb-1.5">
              {labels.slug_label}
            </label>
            <div className="flex items-center" dir="ltr">
              <span className="px-3 py-2 bg-[var(--v2-surface-hover)] border border-r-0 border-[var(--v2-border)] rounded-l-lg text-sm text-[var(--v2-text-secondary)]">
                {subdomain || 'yoursite'}.agentspilot.com/
              </span>
              <input
                type="text"
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                className="flex-1 px-3 py-2 bg-[var(--v2-bg)] border border-[var(--v2-border)] text-sm text-[var(--v2-text-primary)] rounded-r-lg focus:outline-none focus:ring-2 focus:ring-[#4F6EF7]"
                placeholder="service-name"
              />
            </div>
          </div>

          {/* The address is required for both actions — a draft with no URL is a
              page nothing can reach, and publishing without one fails at the
              server anyway. Said here rather than left to two dead buttons. */}
          {!slug.trim() && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              {labels.slug_required}
            </p>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={() => handleComplete(false)}
              disabled={loading || !slug.trim()}
              className="flex-1 px-4 py-2 border border-[var(--v2-border)] text-sm text-[var(--v2-text-primary)] font-medium hover:bg-[var(--v2-surface-hover)] transition-all rounded-lg flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {labels.save_draft}
            </button>
            <button
              onClick={() => handleComplete(true)}
              disabled={loading || publishing || !slug.trim()}
              className="flex-1 px-4 py-2 bg-[#4F6EF7] text-white text-sm font-medium hover:bg-[#3B5AE5] flex items-center justify-center gap-1.5 disabled:opacity-50 transition-all rounded-lg"
            >
              {publishing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Rocket className="w-4 h-4" />
              )}
              {labels.publish}
            </button>
          </div>
        </>
      )}
    </div>
  );

  // Determine which step content to render based on creation type
  const renderCurrentStep = () => {
    // Step 0: Creation Type Selection (always first)
    if (currentStep === 0) {
      return renderStep0();
    }

    // Smart Link flow
    if (creationType === 'smart-link') {
      // Step 1: Journey Type Selection
      if (currentStep === 1) {
        return renderJourneyTypeSelection();
      }
      // Contact-only: Step 2 is completion screen
      if (journeyType === 'contact-only' && currentStep === 2) {
        return renderSmartLinkComplete();
      }
      // Full journey: Step 2 is service selection
      if (journeyType === 'full-journey') {
        if (currentStep === 2) return renderStep1(); // Service selection
        // No journey builder: each service shows its own journey in the list
        // above, and the link cannot override it.
        if (currentStep === 3) return renderSmartLinkComplete(); // Completion
      }
    }

    // Landing Page flow
    if (creationType === 'landing-page') {
      if (currentStep === 1) return renderStep1(); // Service selection — shows the journey
      if (hasExistingTheme) {
        // 3-step flow: Step 2 is preview
        if (currentStep === 2) return renderStepPreview();
      } else {
        // 4-step flow: Step 2 is style, Step 3 is preview
        if (currentStep === 2) return renderStep2Style();
        if (currentStep === 3) return renderStepPreview();
      }
    }

    return null;
  };

  // Get current step title/subtitle based on creation type and current step
  const getStepTitle = () => {
    if (currentStep === 0) return labels.step0_title;

    /*
      The service step has two faces, and the heading has to follow.

      While the embedded editor is open the owner is CREATING a service, not
      choosing one — "Select a Service / Choose which service this landing page
      promotes" described a picker that is not on screen.
    */
    if (showCreateService) return labels.add_service_title;

    if (creationType === 'smart-link') {
      if (currentStep === 1) return labels.journey_type_title;
      if (journeyType === 'contact-only' && currentStep === 2) return labels.smart_link_ready_title;
      if (journeyType === 'full-journey') {
        if (currentStep === 2) return isEditMode ? labels.edit_smart_link_title : labels.step1_title; // Service
        if (currentStep === 3) return isEditMode ? labels.smart_link_updated_title : labels.smart_link_ready_title; // Complete
      }
    }

    if (creationType === 'landing-page') {
      if (currentStep === 1) return labels.step1_title;
      if (hasExistingTheme) {
        return labels.step3_title; // Preview
      } else {
        if (currentStep === 2) return labels.step2_title; // Style
        return labels.step3_title; // Preview
      }
    }

    return '';
  };

  const getStepSubtitle = () => {
    if (currentStep === 0) return labels.step0_subtitle;

    // See the heading above: the editor is open, so this is not a picker.
    if (showCreateService) return labels.add_service_subtitle;

    if (creationType === 'smart-link') {
      if (currentStep === 1) return labels.journey_type_subtitle;
      if (journeyType === 'contact-only' && currentStep === 2) return ''; // No subtitle for completion
      if (journeyType === 'full-journey') {
        if (currentStep === 2) return isEditMode ? labels.edit_smart_link_subtitle : labels.step1_subtitle;
        if (currentStep === 3) return '';
      }
    }

    if (creationType === 'landing-page') {
      if (currentStep === 1) return labels.step1_subtitle;
      if (hasExistingTheme) {
        return labels.step3_subtitle;
      } else {
        if (currentStep === 2) return labels.step2_subtitle;
        return labels.step3_subtitle;
      }
    }

    return '';
  };

  // Determine if we're on a step that has its own action buttons (completion screen or preview)
  const isStepWithOwnButtons = (): boolean => {
    // Smart link completion screens have their own buttons
    if (creationType === 'smart-link') {
      if (journeyType === 'contact-only' && currentStep === 2) return true;
      if (journeyType === 'full-journey' && currentStep === 4) return true;
    }
    // Landing page preview has its own buttons
    if (creationType === 'landing-page') {
      // Preview owns its own actions. One lower than before, since the journey
      // step between Service and Style is gone.
      if (hasExistingTheme && currentStep === 2) return true;
      if (!hasExistingTheme && currentStep === 3) return true;
    }
    return false;
  };

  // Determine if we should show the continue button in footer
  const shouldShowContinueButton = (): boolean => {
    // Step 0: no continue button (selection auto-advances)
    if (currentStep === 0) return false;

    // Smart link journey type selection: no continue (selection auto-advances)
    if (creationType === 'smart-link' && currentStep === 1) return false;

    // Service selection for smart links: always show continue (0 services = all services)
    if (creationType === 'smart-link' && journeyType === 'full-journey' && currentStep === 2) {
      return true; // Can proceed with any selection (including none = all services)
    }
    // Service selection for landing pages: require selection
    if (creationType === 'landing-page' && currentStep === 1) {
      return !!selectedServiceId;
    }

    // Journey builder: always show continue
    if (creationType === 'smart-link' && journeyType === 'full-journey' && currentStep === 3) {
      return true;
    }
    if (creationType === 'landing-page' && currentStep === 2) {
      return true;
    }

    // Style selection: show continue
    if (creationType === 'landing-page' && !hasExistingTheme && currentStep === 3) {
      return true;
    }

    return false;
  };

  // Get header icon based on creation type
  const getHeaderIcon = () => {
    if (creationType === 'smart-link') {
      return <Link className="w-4 h-4" style={{ color: '#4F6EF7' }} />;
    }
    return <Globe className="w-4 h-4" style={{ color: '#4F6EF7' }} />;
  };

  // Calculate display step number (1-indexed for user display)
  const getDisplayStep = (): number => {
    return currentStep + 1; // Convert 0-indexed to 1-indexed
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" dir={isRTL ? 'rtl' : 'ltr'}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-[var(--v2-surface)] rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-[var(--v2-border)] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#4F6EF720' }}>
              {getHeaderIcon()}
            </div>
            <div>
              <span className="text-sm font-medium text-[var(--v2-text-primary)]">
                {labels.step} {getDisplayStep()} {labels.of} {totalSteps}
              </span>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="p-2 text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] hover:bg-[var(--v2-surface-hover)] rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Progress bar */}
        <div className="h-1 bg-[var(--v2-border)]">
          <motion.div
            className="h-full bg-[#4F6EF7]"
            initial={{ width: '0%' }}
            animate={{ width: `${((currentStep + 1) / totalSteps) * 100}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {/* Step header - hide on completion screens */}
          {!isStepWithOwnButtons() && (
            <div className="mb-4">
              <h2 className="text-lg font-bold text-[var(--v2-text-primary)]">{getStepTitle()}</h2>
              {getStepSubtitle() && (
                <p className="text-sm text-[var(--v2-text-secondary)]">{getStepSubtitle()}</p>
              )}
            </div>
          )}

          {/* Step content */}
          <AnimatePresence mode="wait">
            <motion.div
              key={`${creationType}-${journeyType}-${currentStep}`}
              initial={{ opacity: 0, x: isRTL ? -20 : 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: isRTL ? 20 : -20 }}
              transition={{ duration: 0.15 }}
            >
              {renderCurrentStep()}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Footer navigation (not shown on steps with their own buttons) */}
        {!isStepWithOwnButtons() && (
          <div className="px-6 py-4 border-t border-[var(--v2-border)] flex items-center justify-between">
            <button
              onClick={currentStep === 0 ? onCancel : goBack}
              className="flex items-center gap-1 text-sm font-medium text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)]"
            >
              <ChevronLeft className="w-4 h-4" />
              {currentStep === 0 ? labels.cancel : labels.back}
            </button>

            {/* Continue button - shown based on shouldShowContinueButton logic */}
            {shouldShowContinueButton() && (
              <button
                onClick={goNext}
                disabled={creatingSmartLink}
                className="px-4 py-2 bg-[#4F6EF7] text-white text-sm font-medium hover:bg-[#3B5AE5] transition-all flex items-center gap-1 rounded-lg disabled:opacity-50"
              >
                {creatingSmartLink ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    {isEditMode && currentStep === 3 ? labels.update_link : labels.continue}
                    <ChevronRight className="w-4 h-4" />
                  </>
                )}
              </button>
            )}
          </div>
        )}
      </motion.div>
    </div>
  );
}
