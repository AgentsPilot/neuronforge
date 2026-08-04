'use client';

/**
 * LandingPageWizard
 * 3-step wizard for creating standalone landing pages
 * Steps: 1) Select/Create Service 2) Choose Style (skip if website exists) 3) Preview & Publish
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Globe, ChevronRight, ChevronLeft, Check, X,
  Plus, Loader2, Eye, Sparkles, Rocket, ExternalLink,
  Monitor, Tablet, Smartphone, Maximize2, Calendar, DollarSign,
  Target, Users, FileText, CreditCard, ClipboardList, GripVertical, User
} from 'lucide-react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { CSS } from '@dnd-kit/utilities';
import { useLanguage } from '@/lib/business-os/LanguageContext';

// Types
interface SchedulingService {
  id: string;
  name: string;
  service_name?: string;
  description: string | null;
  duration_minutes: number;
  price: number | null;
  currency: string;
  status: string;
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

interface LandingPageWizardProps {
  existingTheme?: ExistingTheme | null;
  subdomain?: string;
  businessInfo?: BusinessInfo | null;
  clientFlow?: ClientFlowStep[];
  onComplete: (data: LandingPageWizardResult) => void;
  onCancel: () => void;
}

export interface LandingPageWizardResult {
  serviceId: string;
  serviceName: string;
  stylePreset: string;
  theme: ExistingTheme;
  slug: string;
  shouldPublish: boolean;
  clientFlow: ClientFlowStep[];
  generatedContent: Record<string, unknown>;
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
    // Step 1
    step1_title: 'Select a Service',
    step1_subtitle: 'Choose which service this landing page promotes',
    loading_services: 'Loading services...',
    no_services: 'No services yet',
    no_services_desc: 'Create your first service to get started',
    create_new_service: 'Create New Service',
    service_name: 'Service Name',
    service_description: 'Description',
    service_description_placeholder: 'Describe your service in detail. The AI will use this to generate compelling landing page content...',
    service_duration: 'Duration (minutes)',
    service_price: 'Price',
    create_service: 'Create Service',
    creating: 'Creating...',
    // Step 2 - Journey
    step_journey_title: 'Build Client Journey',
    step_journey_subtitle: 'Drag to reorder or add/remove steps',
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
    using_website_style_desc: 'Your landing page will match your existing website',
    customize: 'Customize',
    or_choose_preset: 'Or choose a different style:',
    // Step 3
    step3_title: 'Preview & Publish',
    step3_subtitle: 'Review your landing page and go live',
    generating: 'Generating your landing page...',
    slug_label: 'Landing page URL',
    preview: 'Preview',
    edit: 'Edit',
    open_preview: 'Open Full Preview',
  },
  es: {
    step: 'Paso',
    of: 'de',
    cancel: 'Cancelar',
    back: 'Atrás',
    continue: 'Continuar',
    publish: 'Publicar',
    save_draft: 'Guardar borrador',
    step1_title: 'Selecciona un Servicio',
    step1_subtitle: 'Elige qué servicio promueve esta landing page',
    loading_services: 'Cargando servicios...',
    no_services: 'Sin servicios aún',
    no_services_desc: 'Crea tu primer servicio para comenzar',
    create_new_service: 'Crear Nuevo Servicio',
    service_name: 'Nombre del Servicio',
    service_description: 'Descripción',
    service_description_placeholder: 'Describe tu servicio en detalle. La IA usará esto para generar contenido atractivo...',
    service_duration: 'Duración (minutos)',
    service_price: 'Precio',
    create_service: 'Crear Servicio',
    creating: 'Creando...',
    step_journey_title: 'Construir Recorrido del Cliente',
    step_journey_subtitle: 'Arrastra para reordenar o añade/elimina pasos',
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
    using_website_style_desc: 'Tu landing page coincidirá con tu sitio web existente',
    customize: 'Personalizar',
    or_choose_preset: 'O elige un estilo diferente:',
    step3_title: 'Vista Previa y Publicar',
    step3_subtitle: 'Revisa tu landing page y publícala',
    generating: 'Generando tu landing page...',
    slug_label: 'URL de la landing page',
    preview: 'Vista Previa',
    edit: 'Editar',
    open_preview: 'Abrir Vista Completa',
  },
  he: {
    step: 'שלב',
    of: 'מתוך',
    cancel: 'ביטול',
    back: 'חזור',
    continue: 'המשך',
    publish: 'פרסם',
    save_draft: 'שמור כטיוטה',
    step1_title: 'בחר שירות',
    step1_subtitle: 'בחר איזה שירות דף הנחיתה מקדם',
    loading_services: 'טוען שירותים...',
    no_services: 'אין שירותים עדיין',
    no_services_desc: 'צור את השירות הראשון שלך כדי להתחיל',
    create_new_service: 'צור שירות חדש',
    service_name: 'שם השירות',
    service_description: 'תיאור',
    service_description_placeholder: 'תאר את השירות שלך בפירוט. הבינה המלאכותית תשתמש בזה כדי ליצור תוכן משכנע לדף הנחיתה...',
    service_duration: 'משך (דקות)',
    service_price: 'מחיר',
    create_service: 'צור שירות',
    creating: 'יוצר...',
    step_journey_title: 'בנה מסע לקוח',
    step_journey_subtitle: 'גרור לשינוי סדר או הוסף/הסר שלבים',
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
    using_website_style_desc: 'דף הנחיתה יתאים לאתר הקיים שלך',
    customize: 'התאמה אישית',
    or_choose_preset: 'או בחר סגנון אחר:',
    step3_title: 'תצוגה מקדימה ופרסום',
    step3_subtitle: 'בדוק את דף הנחיתה שלך ופרסם',
    generating: 'יוצר את דף הנחיתה שלך...',
    slug_label: 'כתובת דף הנחיתה',
    preview: 'תצוגה מקדימה',
    edit: 'עריכה',
    open_preview: 'פתח תצוגה מלאה',
  }
};

export function LandingPageWizard({
  existingTheme,
  subdomain = '',
  businessInfo,
  clientFlow,
  onComplete,
  onCancel
}: LandingPageWizardProps) {
  const { language } = useLanguage();
  const labels = LABELS[language] || LABELS.en;
  const isRTL = language === 'he';

  // Determine total steps: Service → Journey → Style (skip if theme exists) → Preview
  const hasExistingTheme = !!existingTheme;
  const totalSteps = hasExistingTheme ? 3 : 4;

  // Wizard state
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(false);

  // Step 1: Service selection
  const [services, setServices] = useState<SchedulingService[]>([]);
  const [loadingServices, setLoadingServices] = useState(true);
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);
  const [showCreateService, setShowCreateService] = useState(false);
  const [newServiceName, setNewServiceName] = useState('');
  const [newServiceDescription, setNewServiceDescription] = useState('');
  const [newServiceDuration, setNewServiceDuration] = useState(60);
  const [newServicePrice, setNewServicePrice] = useState<number | null>(null);
  const [creatingService, setCreatingService] = useState(false);
  const [userCurrency, setUserCurrency] = useState('USD');

  // Step 2: Journey selection - custom flow builder
  // Use passed clientFlow if editing, otherwise default to scheduling + client_info + confirmation
  const [selectedFlow, setSelectedFlow] = useState<ClientFlowStep[]>(
    clientFlow && clientFlow.length > 0 ? clientFlow : ['scheduling', 'client_info', 'confirmation']
  );

  // Step 3: Style selection (only if no existing theme)
  const [selectedPresetId, setSelectedPresetId] = useState<string>('professional');
  const [useExistingTheme, setUseExistingTheme] = useState(true);

  // Step 3: Preview & Publish
  const [slug, setSlug] = useState('');
  const [generatedContent, setGeneratedContent] = useState<Record<string, unknown> | null>(null);
  const [generatingContent, setGeneratingContent] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [deviceMode, setDeviceMode] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const [previewDataKey, setPreviewDataKey] = useState<string | null>(null);

  // Get selected service
  const selectedService = services.find(s => s.id === selectedServiceId);

  // Fetch services and user profile on mount
  useEffect(() => {
    fetchServices();
    fetchUserProfile();
  }, []);

  const fetchUserProfile = async () => {
    try {
      const response = await fetch('/api/business-os/profile');
      const data = await response.json();
      if (data.success && data.profile?.currency) {
        setUserCurrency(data.profile.currency);
      }
    } catch {
      // Keep default USD
    }
  };

  const fetchServices = async () => {
    try {
      setLoadingServices(true);
      const response = await fetch('/api/scheduling/services');
      const data = await response.json();
      if (data.success && data.services) {
        const mapped = data.services
          .filter((s: { status: string }) => s.status === 'active')
          .map((s: SchedulingService & { service_name?: string }) => ({
            ...s,
            name: s.service_name || s.name
          }));
        setServices(mapped);
      }
    } catch {
      // Silently fail
    } finally {
      setLoadingServices(false);
    }
  };

  // Create new service in the regular services table
  const handleCreateService = async () => {
    if (!newServiceName.trim()) return;

    setCreatingService(true);
    try {
      const response = await fetch('/api/scheduling/services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_name: newServiceName.trim(),
          description: newServiceDescription.trim() || null,
          duration_minutes: newServiceDuration,
          price: newServicePrice,
          currency: userCurrency,
          status: 'active'
        })
      });

      const data = await response.json();
      if (data.success && data.service) {
        const newService = {
          ...data.service,
          name: data.service.service_name
        };
        setServices(prev => [...prev, newService]);
        setSelectedServiceId(newService.id);
        setShowCreateService(false);
        setNewServiceName('');
        setNewServiceDescription('');
        setNewServiceDuration(60);
        setNewServicePrice(null);
        // Auto-advance to next step
        goNext();
      }
    } catch {
      // Handle error
    } finally {
      setCreatingService(false);
    }
  };

  // Generate slug from service name
  const generateSlug = (name: string): string => {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim();
  };

  // Get selected theme
  const getSelectedTheme = (): ExistingTheme => {
    if (hasExistingTheme && useExistingTheme && existingTheme) {
      return existingTheme;
    }
    const preset = STYLE_PRESETS.find(p => p.id === selectedPresetId);
    return preset?.theme || STYLE_PRESETS[0].theme;
  };

  // Helper to format price with correct currency symbol
  const formatPrice = (price: number | null | undefined, currency: string) => {
    if (price == null) return language === 'he' ? 'צרו קשר' : language === 'es' ? 'Contáctenos' : 'Contact us';
    const symbols: Record<string, string> = { USD: '$', EUR: '€', ILS: '₪', GBP: '£' };
    const symbol = symbols[currency] || currency + ' ';
    return `${symbol}${price}`;
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
      generatedContent: generatedContent || {},
      clientFlow: selectedFlow,
      language,
      logoUrl: businessInfo?.logoUrl,
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
    try {
      const response = await fetch('/api/website/landing-pages/generate', {
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
      // Use default content on error
      setGeneratedContent(getDefaultGeneratedContent(selectedService));
    } finally {
      setGeneratingContent(false);
    }
  };

  // Navigation: Step 1 (Service) → Step 2 (Journey) → Step 3 (Style, skip if theme) → Step 4/3 (Preview)
  const goNext = async () => {
    if (currentStep === 1 && selectedServiceId) {
      // Service → Journey
      setCurrentStep(2);
    } else if (currentStep === 2) {
      // Journey → Style or Preview
      if (hasExistingTheme) {
        // Skip style, go to preview (step 3 in 3-step flow)
        setCurrentStep(3);
        await generateContent();
      } else {
        // Go to style selection
        setCurrentStep(3);
      }
    } else if (currentStep === 3) {
      if (hasExistingTheme) {
        // Already at preview
        return;
      }
      // Style → Preview (step 4 in 4-step flow)
      setCurrentStep(4);
      await generateContent();
    }
  };

  const goBack = () => {
    if (currentStep === 1) return;

    if (hasExistingTheme) {
      // In 3-step flow: Preview (3) → Journey (2) → Service (1)
      setCurrentStep(currentStep - 1);
    } else {
      // In 4-step flow: Preview (4) → Style (3) → Journey (2) → Service (1)
      setCurrentStep(currentStep - 1);
    }
  };

  const handleServiceSelect = async (serviceId: string) => {
    setSelectedServiceId(serviceId);
    // Find the selected service for slug generation
    const service = services.find(s => s.id === serviceId);
    if (!service) return;

    // Set slug from service name
    setSlug(generateSlug(service.name));

    // Auto-advance to Journey step (step 2)
    setCurrentStep(2);
  };

  const handleComplete = async (shouldPublish: boolean) => {
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

    const result = {
      serviceId: selectedService.id,
      serviceName: selectedService.name,
      stylePreset: hasExistingTheme && useExistingTheme ? 'existing' : selectedPresetId,
      theme: getSelectedTheme(),
      slug,
      shouldPublish,
      clientFlow: clientFlowSteps,
      generatedContent: generatedContent || {}
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

  // Render Step 1: Service Selection
  const renderStep1 = () => (
    <div className="space-y-4">
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
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-[var(--v2-text-primary)] mb-1.5">
              {labels.service_name}
            </label>
            <input
              type="text"
              value={newServiceName}
              onChange={(e) => setNewServiceName(e.target.value)}
              className="w-full px-3 py-2 bg-[var(--v2-bg)] border border-[var(--v2-border)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#4F6EF7]"
              placeholder="e.g., Private Yoga Session"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--v2-text-primary)] mb-1.5">
              {labels.service_description}
              <span className="text-xs text-[var(--v2-text-muted)] font-normal ms-1">
                ({language === 'he' ? 'חשוב לתוכן AI' : language === 'es' ? 'importante para AI' : 'important for AI content'})
              </span>
            </label>
            <textarea
              value={newServiceDescription}
              onChange={(e) => setNewServiceDescription(e.target.value)}
              className="w-full px-3 py-2 bg-[var(--v2-bg)] border border-[var(--v2-border)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#4F6EF7] resize-none"
              placeholder={labels.service_description_placeholder}
              rows={4}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[var(--v2-text-primary)] mb-1.5">
                {labels.service_duration}
              </label>
              <input
                type="number"
                value={newServiceDuration}
                onChange={(e) => setNewServiceDuration(parseInt(e.target.value) || 60)}
                className="w-full px-3 py-2 bg-[var(--v2-bg)] border border-[var(--v2-border)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#4F6EF7]"
                min={15}
                step={15}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--v2-text-primary)] mb-1.5">
                {labels.service_price}
              </label>
              <input
                type="number"
                value={newServicePrice ?? ''}
                onChange={(e) => setNewServicePrice(e.target.value ? parseFloat(e.target.value) : null)}
                className="w-full px-3 py-2 bg-[var(--v2-bg)] border border-[var(--v2-border)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#4F6EF7]"
                placeholder="0.00"
                min={0}
                step={0.01}
              />
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button
              onClick={() => setShowCreateService(false)}
              className="flex-1 px-4 py-2 border border-[var(--v2-border)] text-sm text-[var(--v2-text-primary)] font-medium rounded-lg hover:bg-[var(--v2-surface-hover)] transition-all"
            >
              {labels.cancel}
            </button>
            <button
              onClick={handleCreateService}
              disabled={!newServiceName.trim() || creatingService}
              className="flex-1 px-4 py-2 bg-[#4F6EF7] text-white text-sm font-medium rounded-lg hover:bg-[#3B5AE5] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {creatingService ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {labels.creating}
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  {labels.create_service}
                </>
              )}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-2">
            {services.map((service) => {
              const isSelected = selectedServiceId === service.id;
              const currencySymbol = service.currency === 'ILS' ? '₪' : service.currency === 'EUR' ? '€' : '$';

              return (
                <button
                  key={service.id}
                  onClick={() => handleServiceSelect(service.id)}
                  className={`relative text-start p-4 rounded-xl border transition-all ${
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
                        <span>{service.duration_minutes} min</span>
                        {service.price != null && (
                          <span className="text-green-600 font-medium">{currencySymbol}{service.price}</span>
                        )}
                      </div>
                    </div>
                    {isSelected && (
                      <div className="w-6 h-6 bg-[#4F6EF7] rounded-full flex items-center justify-center">
                        <Check className="w-4 h-4 text-white" />
                      </div>
                    )}
                  </div>
                </button>
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

  const renderJourneyStep = () => {
    // Check if service has a price - if so, payment step should be required
    const serviceHasPrice = selectedService?.price != null && selectedService.price > 0;

    // Available steps to add (excluding confirmation which is always there)
    const availableToAdd: ClientFlowStep[] = (['scheduling', 'client_info', 'payment', 'intake'] as const)
      .filter(step => !selectedFlow.includes(step));

    return (
      <div className="space-y-4">
        {/* Info message if service has price */}
        {serviceHasPrice && (
          <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg">
            <p className="text-sm text-amber-700 dark:text-amber-300">
              {labels.journey_payment_required}
            </p>
          </div>
        )}

        {/* Available steps to add */}
        {availableToAdd.length > 0 && (
          <div className="mb-4">
            <p className="text-xs text-[var(--v2-text-muted)] mb-2">{labels.journey_add_step}:</p>
            <div className="flex flex-wrap gap-2">
              {availableToAdd.map(step => {
                const stepInfo = STEP_INFO[step];
                const Icon = stepInfo.icon;
                return (
                  <button
                    key={step}
                    onClick={() => toggleJourneyStep(step)}
                    className="flex items-center gap-2 px-3 py-1.5 border-2 border-dashed border-[var(--v2-border)] rounded-full text-[var(--v2-text-secondary)] hover:border-[#4F6EF7] hover:text-[#4F6EF7] transition-colors"
                  >
                    <Icon className="w-4 h-4" />
                    {stepInfo.name[language] || stepInfo.name.en}
                    <Plus className="w-3 h-3" />
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Current flow steps with drag and drop */}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleJourneyDragEnd}
          modifiers={[restrictToVerticalAxis]}
        >
          <SortableContext items={selectedFlow} strategy={verticalListSortingStrategy}>
            <div className="space-y-3">
              {selectedFlow.map((step, index) => (
                <SortableJourneyStep
                  key={step}
                  step={step}
                  index={index}
                  language={language}
                  isConfirmation={step === 'confirmation'}
                  isPaymentRequired={serviceHasPrice && step === 'payment'}
                  onRemove={toggleJourneyStep}
                  alwaysIncludedLabel={labels.journey_always_included}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>

        {/* Add confirmation if not in list */}
        {!selectedFlow.includes('confirmation') && selectedFlow.length > 0 && (
          <div className="flex items-center gap-3 p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-600">
            <div className="w-10 h-10 rounded-full bg-gray-400 text-white flex items-center justify-center font-bold">
              {selectedFlow.length + 1}
            </div>
            <div className="flex-1">
              <div className="font-medium text-[var(--v2-text-primary)]">{labels.journey_step_confirmation}</div>
              <div className="text-sm text-[var(--v2-text-secondary)]">{labels.journey_step_confirmation_desc}</div>
            </div>
            <span className="text-xs text-[var(--v2-text-muted)] italic">{labels.journey_always_included}</span>
          </div>
        )}
      </div>
    );
  };

  // Render Step 3: Style Selection (only shown if no existing theme)
  const renderStep2Style = () => (
    <div className="space-y-4">
      {/* If has existing theme, show option to use it */}
      {hasExistingTheme && existingTheme && (
        <button
          onClick={() => {
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

      {/* Style presets */}
      {(!hasExistingTheme || !useExistingTheme) && (
        <>
          {hasExistingTheme && (
            <p className="text-sm text-[var(--v2-text-muted)] text-center pt-2">{labels.or_choose_preset}</p>
          )}
          <div className="grid grid-cols-2 gap-3">
            {STYLE_PRESETS.map((preset) => {
              const isSelected = selectedPresetId === preset.id && !useExistingTheme;

              return (
                <button
                  key={preset.id}
                  onClick={() => {
                    setSelectedPresetId(preset.id);
                    setUseExistingTheme(false);
                  }}
                  className={`relative text-start p-3 rounded-xl border transition-all ${
                    isSelected
                      ? 'ring-2 ring-[#4F6EF7] border-[#4F6EF7]'
                      : 'border-[var(--v2-border)] hover:border-[#4F6EF7]/50'
                  }`}
                >
                  {/* Color preview */}
                  <div className="h-16 rounded-lg overflow-hidden mb-2 flex">
                    <div
                      className="flex-1"
                      style={{ backgroundColor: preset.theme.colors.primary }}
                    />
                    <div
                      className="flex-1"
                      style={{ backgroundColor: preset.theme.colors.secondary }}
                    />
                  </div>
                  <h4 className="text-sm font-medium text-[var(--v2-text-primary)]">
                    {preset.name[language] || preset.name.en}
                  </h4>
                  <p className="text-xs text-[var(--v2-text-muted)]">
                    {preset.description[language] || preset.description.en}
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
                    src={`/business-os/website/landing-preview?dataKey=${previewDataKey}`}
                    className="w-full h-full border-0"
                    title="Landing Page Preview"
                    style={{ minHeight: '400px' }}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
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

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={() => handleComplete(false)}
              disabled={loading}
              className="flex-1 px-4 py-2 border border-[var(--v2-border)] text-sm text-[var(--v2-text-primary)] font-medium hover:bg-[var(--v2-surface-hover)] transition-all rounded-lg flex items-center justify-center"
            >
              {labels.save_draft}
            </button>
            <button
              onClick={() => handleComplete(true)}
              disabled={loading || publishing}
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

  // Determine which step content to render
  // Flow: Step 1 (Service) → Step 2 (Journey) → Step 3 (Style, skip if theme) → Step 4/3 (Preview)
  const renderCurrentStep = () => {
    if (currentStep === 1) {
      return renderStep1();
    }
    if (currentStep === 2) {
      return renderJourneyStep();
    }
    if (hasExistingTheme) {
      // 3-step flow: step 3 is preview
      return renderStepPreview();
    }
    // 4-step flow
    if (currentStep === 3) {
      return renderStep2Style();
    }
    return renderStepPreview();
  };

  // Get current step title/subtitle
  const getStepTitle = () => {
    if (currentStep === 1) return labels.step1_title;
    if (currentStep === 2) return labels.step_journey_title;
    if (hasExistingTheme) return labels.step3_title; // Preview
    if (currentStep === 3) return labels.step2_title; // Style
    return labels.step3_title; // Preview
  };

  const getStepSubtitle = () => {
    if (currentStep === 1) return labels.step1_subtitle;
    if (currentStep === 2) return labels.step_journey_subtitle;
    if (hasExistingTheme) return labels.step3_subtitle;
    if (currentStep === 3) return labels.step2_subtitle;
    return labels.step3_subtitle;
  };

  const isPreviewStep = hasExistingTheme ? currentStep === 3 : currentStep === 4;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" dir={isRTL ? 'rtl' : 'ltr'}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-[var(--v2-surface)] rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-[var(--v2-border)] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#4F6EF7] flex items-center justify-center">
              <Globe className="w-4 h-4 text-white" />
            </div>
            <div>
              <span className="text-sm font-medium text-[var(--v2-text-primary)]">
                {labels.step} {currentStep} {labels.of} {totalSteps}
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
            animate={{ width: `${(currentStep / totalSteps) * 100}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {/* Step header */}
          <div className="mb-4">
            <h2 className="text-lg font-bold text-[var(--v2-text-primary)]">{getStepTitle()}</h2>
            <p className="text-sm text-[var(--v2-text-secondary)]">{getStepSubtitle()}</p>
          </div>

          {/* Step content */}
          <AnimatePresence mode="wait">
            <motion.div
              key={currentStep}
              initial={{ opacity: 0, x: isRTL ? -20 : 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: isRTL ? 20 : -20 }}
              transition={{ duration: 0.15 }}
            >
              {renderCurrentStep()}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Footer navigation (not shown on preview step which has its own buttons) */}
        {!isPreviewStep && (
          <div className="px-6 py-4 border-t border-[var(--v2-border)] flex items-center justify-between">
            <button
              onClick={currentStep === 1 ? onCancel : goBack}
              className="flex items-center gap-1 text-sm font-medium text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)]"
            >
              <ChevronLeft className="w-4 h-4" />
              {currentStep === 1 ? labels.cancel : labels.back}
            </button>
            {/* Show Continue button on step 1 only if service is selected */}
            {currentStep === 1 && selectedServiceId && (
              <button
                onClick={goNext}
                className="px-4 py-2 bg-[#4F6EF7] text-white text-sm font-medium hover:bg-[#3B5AE5] transition-all flex items-center gap-1 rounded-lg"
              >
                {labels.continue}
                <ChevronRight className="w-4 h-4" />
              </button>
            )}
            {/* Show Continue button on journey step (step 2) */}
            {currentStep === 2 && (
              <button
                onClick={goNext}
                className="px-4 py-2 bg-[#4F6EF7] text-white text-sm font-medium hover:bg-[#3B5AE5] transition-all flex items-center gap-1 rounded-lg"
              >
                {labels.continue}
                <ChevronRight className="w-4 h-4" />
              </button>
            )}
            {/* Show Continue button on style step (step 3 without existing theme) */}
            {currentStep === 3 && !hasExistingTheme && (
              <button
                onClick={goNext}
                className="px-4 py-2 bg-[#4F6EF7] text-white text-sm font-medium hover:bg-[#3B5AE5] transition-all flex items-center gap-1 rounded-lg"
              >
                {labels.continue}
                <ChevronRight className="w-4 h-4" />
              </button>
            )}
          </div>
        )}
      </motion.div>
    </div>
  );
}
