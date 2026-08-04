'use client';

/**
 * WebsiteSetupWizard
 * 4-step guided wizard for first-time website setup
 * Steps: 1) Branding+Template 2) Client Journey 3) Services Review 4) Preview & Publish
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Globe, ChevronRight, ChevronLeft, Check, X,
  Calendar, CreditCard, FileText, CheckCircle,
  ChevronUp, ChevronDown, Plus, Loader2, Eye,
  Sparkles, Rocket, ExternalLink, Monitor, Tablet, Smartphone, Maximize2
} from 'lucide-react';
import { MediaUploader } from '@/components/website/MediaUploader';
import { useLanguage } from '@/lib/business-os/LanguageContext';

// Template name translations
const TEMPLATE_NAMES: Record<string, { en: string; es: string; he: string }> = {
  // Therapist
  'Warm & Welcoming': { en: 'Warm & Welcoming', es: 'Cálido y Acogedor', he: 'חם ומזמין' },
  'Professional & Clinical': { en: 'Professional & Clinical', es: 'Profesional y Clínico', he: 'מקצועי וקליני' },
  'Modern & Minimal': { en: 'Modern & Minimal', es: 'Moderno y Minimalista', he: 'מודרני ומינימליסטי' },
  'Specialized (Trauma-Focused)': { en: 'Specialized (Trauma-Focused)', es: 'Especializado (Trauma)', he: 'מתמחה (טראומה)' },
  'Trauma-Focused': { en: 'Trauma-Focused', es: 'Enfocado en Trauma', he: 'התמחות בטראומה' },
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

// Helper function to get translated template name
const getTranslatedTemplateName = (name: string, lang: 'en' | 'es' | 'he'): string => {
  return TEMPLATE_NAMES[name]?.[lang] || name;
};

// Brand voice translations
const BRAND_VOICE_TRANSLATIONS: Record<string, { en: string; es: string; he: string }> = {
  'warm': { en: 'Warm', es: 'Cálido', he: 'חם ומזמין' },
  'professional': { en: 'Professional', es: 'Profesional', he: 'מקצועי וקליני' },
  'minimal': { en: 'Minimal', es: 'Minimalista', he: 'מודרני ומינימליסטי' },
  'bold': { en: 'Bold', es: 'Audaz', he: 'נועז' },
  'elegant': { en: 'Elegant', es: 'Elegante', he: 'אלגנטי' },
  'creative': { en: 'Creative', es: 'Creativo', he: 'יצירתי' },
};

// Helper function to get translated brand voice
const getTranslatedBrandVoice = (voice: string, lang: 'en' | 'es' | 'he'): string => {
  return BRAND_VOICE_TRANSLATIONS[voice]?.[lang] || voice;
};

// Types
interface WebsiteTemplate {
  id: string;
  name: string;
  description?: string;
  vertical: string;
  preview_url?: string;
  thumbnail_url?: string;
  theme: {
    primary_color?: string;
    secondary_color?: string;
    colors?: {
      primary: string;
      secondary: string;
    };
  };
}

interface SchedulingService {
  id: string;
  name: string;
  description: string | null;
  duration_minutes: number;
  price: number | null;
  currency: string;
  status: string;
  icon?: string;
}

type FlowStepKey = 'booking' | 'payment' | 'intake' | 'confirmation';

interface FlowStep {
  key: FlowStepKey;
  label: { en: string; es: string; he: string };
  description: { en: string; es: string; he: string };
  icon: typeof Calendar;
  color: string;
  removable: boolean;
}

interface WebsiteSetupWizardProps {
  templates: WebsiteTemplate[];
  currentTemplateId?: string;
  currentLogoUrl?: string;
  currentClientFlow?: FlowStepKey[];
  currentHiddenServiceNames?: string[];
  subdomain?: string;
  /** Page ID for preview iframe */
  pageId?: string;
  onComplete: (data: WizardResult) => void;
  onSkip: () => void;
  /** Called before showing Step 4 preview to save current state for accurate preview */
  onBeforePreview?: (data: Omit<WizardResult, 'shouldPublish'>) => Promise<void>;
  /** When true, renders without full-page wrapper (for embedding in existing page structure) */
  embedded?: boolean;
}

export interface WizardResult {
  templateId: string;
  logoUrl?: string;
  clientFlow: FlowStepKey[];
  hiddenServiceIds: string[];
  subdomain: string;
  shouldPublish: boolean;
}

// Flow step definitions
const FLOW_STEPS: FlowStep[] = [
  {
    key: 'booking',
    label: { en: 'Book Appointment', es: 'Reservar Cita', he: 'הזמנת תור' },
    description: { en: 'Client selects date and time', es: 'El cliente elige fecha y hora', he: 'הלקוח בוחר תאריך ושעה' },
    icon: Calendar,
    color: '#3B82F6',
    removable: true
  },
  {
    key: 'payment',
    label: { en: 'Collect Payment', es: 'Cobrar Pago', he: 'גביית תשלום' },
    description: { en: 'Secure payment via Stripe', es: 'Pago seguro via Stripe', he: 'תשלום מאובטח דרך Stripe' },
    icon: CreditCard,
    color: '#10B981',
    removable: true
  },
  {
    key: 'intake',
    label: { en: 'Intake Form', es: 'Formulario de Ingreso', he: 'טופס קליטה' },
    description: { en: 'Collect client information', es: 'Recopilar información del cliente', he: 'איסוף מידע על הלקוח' },
    icon: FileText,
    color: '#8B5CF6',
    removable: true
  },
  {
    key: 'confirmation',
    label: { en: 'Confirmation', es: 'Confirmación', he: 'אישור' },
    description: { en: 'Email & calendar invite sent', es: 'Correo e invitación enviados', he: 'מייל והזמנה ליומן נשלחו' },
    icon: CheckCircle,
    color: '#6B7280',
    removable: false
  }
];

// Labels
const LABELS = {
  en: {
    step: 'Step',
    of: 'of',
    skip_setup: 'Skip setup',
    back: 'Back',
    continue: 'Continue',
    publish_website: 'Publish Website',
    save_draft: 'Save as draft',
    // Step 1
    step1_title: "Let's Set Up Your Website",
    step1_subtitle: 'Choose a template and optionally upload your logo',
    choose_template: 'Choose a Template',
    loading_templates: 'Loading templates...',
    upload_logo: 'Upload Your Logo (Optional)',
    logo_hint: 'Recommended: Square image, at least 200x200px',
    // Step 2
    step2_title: 'Client Journey',
    step2_subtitle: 'What happens when a client wants to book?',
    drag_to_reorder: 'Use arrows to reorder steps',
    click_to_add: 'Click to add:',
    always_included: 'Always included',
    tip_simple: 'Tip: Keep it simple',
    tip_simple_desc: 'Most therapists use just Booking + Confirmation. You can add payment later.',
    services_only: 'Just want to show services?',
    services_only_desc: 'Remove all optional steps. Services will display without a booking button.',
    // Step 3
    step3_title: 'Your Services',
    step3_subtitle: 'Toggle services to show or hide on your website',
    services_synced: 'Services are synced from your Scheduling capability',
    manage_services: 'Manage Services',
    no_services: 'No services found',
    no_services_desc: 'Add services in the Scheduling section to display them on your website.',
    // Step 4
    step4_title: 'Your Website is Ready!',
    step4_subtitle: "Here's a preview of what your clients will see",
    your_address: 'Your website address',
    open_preview: 'Open Full Preview',
    preview: 'Preview',
    go_back_edit: 'Go Back & Edit',
    loading_preview: 'Loading preview...',
    preview_not_available: 'Preview not available',
  },
  es: {
    step: 'Paso',
    of: 'de',
    skip_setup: 'Saltar configuración',
    back: 'Atrás',
    continue: 'Continuar',
    publish_website: 'Publicar Sitio',
    save_draft: 'Guardar borrador',
    step1_title: 'Configuremos Tu Sitio Web',
    step1_subtitle: 'Elige una plantilla y opcionalmente sube tu logo',
    choose_template: 'Elegir Plantilla',
    loading_templates: 'Cargando plantillas...',
    upload_logo: 'Subir Tu Logo (Opcional)',
    logo_hint: 'Recomendado: Imagen cuadrada, mínimo 200x200px',
    step2_title: 'Viaje del Cliente',
    step2_subtitle: '¿Qué pasa cuando un cliente quiere reservar?',
    drag_to_reorder: 'Usa las flechas para reordenar',
    click_to_add: 'Clic para agregar:',
    always_included: 'Siempre incluido',
    tip_simple: 'Tip: Mantenlo simple',
    tip_simple_desc: 'La mayoría usa solo Reserva + Confirmación. Puedes agregar pago después.',
    services_only: '¿Solo quieres mostrar servicios?',
    services_only_desc: 'Elimina todos los pasos opcionales. Los servicios se mostrarán sin botón de reserva.',
    step3_title: 'Tus Servicios',
    step3_subtitle: 'Activa o desactiva servicios para mostrar en tu sitio',
    services_synced: 'Los servicios están sincronizados desde Programación',
    manage_services: 'Gestionar Servicios',
    no_services: 'No hay servicios',
    no_services_desc: 'Agrega servicios en Programación para mostrarlos en tu sitio.',
    step4_title: '¡Tu Sitio Está Listo!',
    step4_subtitle: 'Así es como lo verán tus clientes',
    your_address: 'Dirección de tu sitio',
    open_preview: 'Abrir Vista Previa',
    preview: 'Vista Previa',
    go_back_edit: 'Volver y Editar',
    loading_preview: 'Cargando vista previa...',
    preview_not_available: 'Vista previa no disponible',
  },
  he: {
    step: 'שלב',
    of: 'מתוך',
    skip_setup: 'דלג על ההגדרה',
    back: 'חזור',
    continue: 'המשך',
    publish_website: 'פרסם אתר',
    save_draft: 'שמור כטיוטה',
    step1_title: 'בואו נגדיר את האתר שלך',
    step1_subtitle: 'בחר תבנית והעלה לוגו אם תרצה',
    choose_template: 'בחר תבנית',
    loading_templates: 'טוען תבניות...',
    upload_logo: 'העלה לוגו (אופציונלי)',
    logo_hint: 'מומלץ: תמונה מרובעת, לפחות 200x200 פיקסלים',
    step2_title: 'מסע הלקוח',
    step2_subtitle: 'מה קורה כשלקוח רוצה להזמין?',
    drag_to_reorder: 'השתמש בחצים לשינוי סדר',
    click_to_add: 'לחץ להוספה:',
    always_included: 'תמיד כלול',
    tip_simple: 'טיפ: שמור על פשטות',
    tip_simple_desc: 'רוב המטפלים משתמשים רק בהזמנה + אישור. אפשר להוסיף תשלום מאוחר יותר.',
    services_only: 'רוצה להציג רק שירותים?',
    services_only_desc: 'הסר את כל השלבים האופציונליים. השירותים יוצגו ללא כפתור הזמנה.',
    step3_title: 'השירותים שלך',
    step3_subtitle: 'הפעל או כבה שירותים להצגה באתר',
    services_synced: 'השירותים מסונכרנים מניהול התורים',
    manage_services: 'נהל שירותים',
    no_services: 'לא נמצאו שירותים',
    no_services_desc: 'הוסף שירותים בניהול התורים כדי להציג אותם באתר.',
    step4_title: 'האתר שלך מוכן!',
    step4_subtitle: 'כך הלקוחות שלך יראו אותו',
    your_address: 'כתובת האתר שלך',
    open_preview: 'פתח תצוגה מקדימה',
    preview: 'תצוגה מקדימה',
    go_back_edit: 'חזור ועריכה',
    loading_preview: 'טוען תצוגה מקדימה...',
    preview_not_available: 'התצוגה המקדימה לא זמינה',
  }
};

export function WebsiteSetupWizard({
  templates,
  currentTemplateId,
  currentLogoUrl,
  currentClientFlow = ['booking', 'confirmation'],
  currentHiddenServiceNames = [],
  subdomain: initialSubdomain = '',
  pageId,
  onComplete,
  onSkip,
  onBeforePreview,
  embedded = false
}: WebsiteSetupWizardProps) {
  const { language } = useLanguage();
  const labels = LABELS[language] || LABELS.en;
  const isRTL = language === 'he';

  // Wizard state
  const [currentStep, setCurrentStep] = useState(1);
  const totalSteps = 4;

  // Step 1: Branding & Template
  const [selectedTemplateId, setSelectedTemplateId] = useState(currentTemplateId || templates[0]?.id || '');
  const [logoUrl, setLogoUrl] = useState(currentLogoUrl || '');

  // Step 2: Client Journey
  const [clientFlow, setClientFlow] = useState<FlowStepKey[]>(currentClientFlow);

  // Step 3: Services
  const [services, setServices] = useState<SchedulingService[]>([]);
  const [hiddenServiceIds, setHiddenServiceIds] = useState<Set<string>>(new Set());
  const [loadingServices, setLoadingServices] = useState(false);
  // Store hidden service names for matching when services load
  const [hiddenServiceNames] = useState<Set<string>>(new Set(currentHiddenServiceNames));

  // Step 4: Publish
  const [subdomain, setSubdomain] = useState(initialSubdomain);
  const [publishing, setPublishing] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(true);
  // Refresh key to force iframe reload when entering step 4
  const [previewKey, setPreviewKey] = useState(0);
  const [deviceMode, setDeviceMode] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const [savingForPreview, setSavingForPreview] = useState(false);
  const [showFullPreview, setShowFullPreview] = useState(false);

  // Fetch services when reaching step 3
  useEffect(() => {
    if (currentStep === 3 && services.length === 0) {
      fetchServices();
    }
  }, [currentStep]);

  // Refresh preview when entering step 4
  useEffect(() => {
    if (currentStep === 4) {
      setPreviewLoading(true);
      setPreviewKey(prev => prev + 1);
    }
  }, [currentStep]);

  const fetchServices = async () => {
    try {
      setLoadingServices(true);
      const response = await fetch('/api/scheduling/services');
      const data = await response.json();
      if (data.success && data.services) {
        // Map service_name to name for consistency with interface
        const mapped = data.services
          .filter((s: { status: string }) => s.status === 'active')
          .map((s: { id: string; service_name: string; description: string | null; duration_minutes: number; price: number | null; currency: string; status: string }) => ({
            ...s,
            name: s.service_name // Map service_name to name
          }));
        setServices(mapped);

        // Initialize hidden service IDs based on matching service names
        if (hiddenServiceNames.size > 0) {
          const hiddenIds = new Set<string>();
          mapped.forEach((service: { id: string; name: string }) => {
            if (hiddenServiceNames.has(service.name)) {
              hiddenIds.add(service.id);
            }
          });
          setHiddenServiceIds(hiddenIds);
        }
      }
    } catch {
      // Silently fail - services are optional
    } finally {
      setLoadingServices(false);
    }
  };

  // Client flow helpers
  const activeFlowSteps = FLOW_STEPS.filter(s => clientFlow.includes(s.key));
  const inactiveFlowSteps = FLOW_STEPS.filter(s => !clientFlow.includes(s.key) && s.removable);

  const moveInFlow = (key: FlowStepKey, direction: 'up' | 'down') => {
    const index = clientFlow.indexOf(key);
    if (index === -1) return;

    const newFlow = [...clientFlow];
    const confirmationIndex = newFlow.indexOf('confirmation');

    if (direction === 'up' && index > 0) {
      [newFlow[index - 1], newFlow[index]] = [newFlow[index], newFlow[index - 1]];
    } else if (direction === 'down' && index < newFlow.length - 1) {
      // Don't move past confirmation
      if (index + 1 < confirmationIndex || key === 'confirmation') {
        [newFlow[index], newFlow[index + 1]] = [newFlow[index + 1], newFlow[index]];
      }
    }

    // Ensure confirmation is always last
    const confIdx = newFlow.indexOf('confirmation');
    if (confIdx !== -1 && confIdx !== newFlow.length - 1) {
      newFlow.splice(confIdx, 1);
      newFlow.push('confirmation');
    }

    setClientFlow(newFlow);
  };

  const addToFlow = (key: FlowStepKey) => {
    if (!clientFlow.includes(key)) {
      // Insert before confirmation
      const newFlow = [...clientFlow];
      const confIndex = newFlow.indexOf('confirmation');
      if (confIndex !== -1) {
        newFlow.splice(confIndex, 0, key);
      } else {
        newFlow.push(key);
      }
      setClientFlow(newFlow);
    }
  };

  const removeFromFlow = (key: FlowStepKey) => {
    if (key === 'confirmation') return;
    setClientFlow(clientFlow.filter(k => k !== key));
  };

  // Service toggle
  const toggleService = (serviceId: string) => {
    setHiddenServiceIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(serviceId)) {
        newSet.delete(serviceId);
      } else {
        newSet.add(serviceId);
      }
      return newSet;
    });
  };

  // Navigation
  const goNext = async () => {
    if (currentStep < totalSteps) {
      // Before going to Step 4 (Preview), save current state for accurate preview
      if (currentStep === 3 && onBeforePreview) {
        setSavingForPreview(true);
        try {
          await onBeforePreview({
            templateId: selectedTemplateId,
            logoUrl: logoUrl || undefined,
            clientFlow,
            hiddenServiceIds: Array.from(hiddenServiceIds),
            subdomain
          });
        } finally {
          setSavingForPreview(false);
        }
      }
      setCurrentStep(currentStep + 1);
    }
  };

  const goBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  // Complete wizard
  const handleComplete = (shouldPublish: boolean) => {
    if (shouldPublish) {
      setPublishing(true);
    }
    onComplete({
      templateId: selectedTemplateId,
      logoUrl: logoUrl || undefined,
      clientFlow,
      hiddenServiceIds: Array.from(hiddenServiceIds),
      subdomain,
      shouldPublish
    });
  };

  const getTemplatePrimaryColor = (template: WebsiteTemplate): string => {
    return template.theme?.colors?.primary || template.theme?.primary_color || '#4F6EF7';
  };

  const getTemplateSecondaryColor = (template: WebsiteTemplate): string => {
    return template.theme?.colors?.secondary || template.theme?.secondary_color || '#6366F1';
  };

  // Step renderers
  const renderStep1 = () => (
    <div className="space-y-5">
      {/* Template Selection */}
      <div>
        <h3 className="text-base font-semibold text-[var(--v2-text-primary)] mb-3">{labels.choose_template}</h3>
        {templates.length === 0 ? (
          <div className="p-6 text-center border-2 border-dashed border-[var(--v2-border)] rounded-lg">
            <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-[var(--v2-text-muted)]" />
            <p className="text-sm text-[var(--v2-text-muted)]">{labels.loading_templates}</p>
          </div>
        ) : (
        <div className="grid grid-cols-2 gap-2">
          {templates.slice(0, 4).map((template) => {
            const isSelected = selectedTemplateId === template.id;
            const primaryColor = getTemplatePrimaryColor(template);
            const secondaryColor = getTemplateSecondaryColor(template);
            const accentColor = template.theme?.accent_color || secondaryColor;

            return (
              <button
                key={template.id}
                onClick={() => setSelectedTemplateId(template.id)}
                className={`relative text-start transition-all overflow-hidden border ${
                  isSelected
                    ? 'ring-2 ring-[#4F6EF7] ring-offset-1 border-[#4F6EF7]'
                    : 'border-[var(--v2-border)] hover:border-[#4F6EF7]/50'
                }`}
                style={{ borderRadius: 'var(--v2-radius-card)' }}
              >
                {/* Color Preview Bar - Shows the template's color palette */}
                <div className="h-16 relative overflow-hidden">
                  {/* Background gradient using template colors */}
                  <div
                    className="absolute inset-0"
                    style={{
                      background: `linear-gradient(135deg, ${primaryColor} 0%, ${primaryColor} 50%, ${secondaryColor} 50%, ${secondaryColor} 100%)`
                    }}
                  />
                  {/* Accent stripe */}
                  <div
                    className="absolute bottom-0 left-0 right-0 h-2"
                    style={{ backgroundColor: accentColor }}
                  />
                  {/* Selected checkmark */}
                  {isSelected && (
                    <div className="absolute top-1.5 right-1.5 w-5 h-5 bg-white rounded-full flex items-center justify-center shadow-md">
                      <Check className="w-3 h-3 text-[#4F6EF7]" />
                    </div>
                  )}
                </div>

                {/* Template Info */}
                <div className="p-2.5 bg-[var(--v2-surface)]">
                  <h4 className="text-xs font-semibold text-[var(--v2-text-primary)] truncate">
                    {getTranslatedTemplateName(template.name, language)}
                  </h4>
                  {template.theme?.brand_voice && (
                    <span className="text-[10px] text-[var(--v2-text-muted)]">
                      {getTranslatedBrandVoice(template.theme.brand_voice, language)}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
        )}
      </div>

      {/* Logo Upload - Inline with template */}
      <div className="flex items-center gap-4 p-3 bg-[var(--v2-bg)] rounded-lg border border-[var(--v2-border)]">
        <div className="shrink-0">
          <MediaUploader
            value={logoUrl}
            onChange={setLogoUrl}
            onRemove={() => setLogoUrl('')}
            folder="logos"
            placeholder=""
            previewClassName="w-14 h-14 rounded-lg"
            showUrlInput={false}
          />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-[var(--v2-text-primary)]">{labels.upload_logo}</h3>
          <p className="text-xs text-[var(--v2-text-muted)]">{labels.logo_hint}</p>
        </div>
      </div>
    </div>
  );

  const renderStep2 = () => (
    <div className="space-y-4">
      {/* Active Flow Steps - Compact */}
      <div className="space-y-2">
        {activeFlowSteps.map((step, index) => {
          const StepIcon = step.icon;
          const isConfirmation = step.key === 'confirmation';
          const flowIndex = clientFlow.indexOf(step.key);
          const canMoveUp = flowIndex > 0;
          const canMoveDown = flowIndex < clientFlow.length - 2;

          return (
            <div
              key={step.key}
              className="flex items-center gap-3"
            >
              {/* Step Icon */}
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                style={{ backgroundColor: step.color }}
              >
                <StepIcon className="w-4 h-4 text-white" />
              </div>

              {/* Step Content */}
              <div
                className="flex-1 px-3 py-2 rounded-lg border"
                style={{
                  backgroundColor: `${step.color}08`,
                  borderColor: `${step.color}30`
                }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold" style={{ color: step.color }}>
                      {index + 1}
                    </span>
                    <span className="text-sm font-medium text-gray-900">
                      {step.label[language] || step.label.en}
                    </span>
                  </div>

                  {/* Controls */}
                  <div className="flex items-center gap-1">
                    {!isConfirmation && (
                      <>
                        <button
                          onClick={() => moveInFlow(step.key, 'up')}
                          disabled={!canMoveUp}
                          className={`p-0.5 rounded ${canMoveUp ? 'text-gray-400 hover:text-gray-600' : 'text-gray-200 cursor-not-allowed'}`}
                        >
                          <ChevronUp className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => moveInFlow(step.key, 'down')}
                          disabled={!canMoveDown}
                          className={`p-0.5 rounded ${canMoveDown ? 'text-gray-400 hover:text-gray-600' : 'text-gray-200 cursor-not-allowed'}`}
                        >
                          <ChevronDown className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => removeFromFlow(step.key)}
                          className="p-0.5 rounded text-gray-300 hover:text-red-500"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </>
                    )}
                    {isConfirmation && (
                      <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                        {labels.always_included}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Inactive Steps to Add - Compact */}
      {inactiveFlowSteps.length > 0 && (
        <div className="flex gap-2 flex-wrap pt-2 border-t border-[var(--v2-border)]">
          <span className="text-xs text-[var(--v2-text-muted)] self-center">{labels.click_to_add}</span>
          {inactiveFlowSteps.map((step) => {
            const StepIcon = step.icon;
            return (
              <button
                key={step.key}
                onClick={() => addToFlow(step.key)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 border border-dashed rounded-lg text-sm transition-all hover:bg-gray-50"
                style={{ borderColor: `${step.color}50`, color: step.color }}
              >
                <StepIcon className="w-4 h-4" />
                {step.label[language] || step.label.en}
                <Plus className="w-3 h-3 opacity-50" />
              </button>
            );
          })}
        </div>
      )}

      {/* Tips - More compact */}
      <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-amber-500 shrink-0" />
        <p className="text-xs text-amber-700">
          <span className="font-medium">{labels.tip_simple}:</span> {labels.tip_simple_desc}
        </p>
      </div>

      {clientFlow.length === 1 && clientFlow[0] === 'confirmation' && (
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-center gap-2">
          <Eye className="w-4 h-4 text-blue-500 shrink-0" />
          <p className="text-xs text-blue-700">
            <span className="font-medium">{labels.services_only}:</span> {labels.services_only_desc}
          </p>
        </div>
      )}
    </div>
  );

  const renderStep3 = () => (
    <div className="space-y-4">
      {loadingServices ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-[var(--v2-text-muted)]" />
        </div>
      ) : services.length === 0 ? (
        <div className="text-center py-8">
          <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-[var(--v2-surface-hover)] flex items-center justify-center">
            <Calendar className="w-6 h-6 text-[var(--v2-text-muted)]" />
          </div>
          <h3 className="text-base font-semibold text-[var(--v2-text-primary)] mb-1">{labels.no_services}</h3>
          <p className="text-sm text-[var(--v2-text-secondary)] mb-3">{labels.no_services_desc}</p>
          <a
            href="/business-os"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#4F6EF7] text-white text-sm hover:bg-[#3B5AE5] transition-all"
            style={{ borderRadius: 'var(--v2-radius-button)' }}
          >
            {labels.manage_services}
            <ChevronRight className="w-4 h-4" />
          </a>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {services.map((service) => {
              const isHidden = hiddenServiceIds.has(service.id);
              const currencySymbol = service.currency === 'ILS' ? '₪' : service.currency === 'EUR' ? '€' : '$';
              return (
                <div
                  key={service.id}
                  className={`p-3 bg-gradient-to-r from-[var(--v2-surface)] to-transparent border rounded-xl transition-colors ${
                    isHidden
                      ? 'border-[var(--v2-border)] opacity-50'
                      : 'border-[var(--v2-border)] hover:border-[#4F6EF7]/30'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${isHidden ? 'bg-gray-200' : 'bg-[#4F6EF7]/10'}`}>
                      <Calendar className={`w-5 h-5 ${isHidden ? 'text-gray-400' : 'text-[#4F6EF7]'}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <h4 className={`font-medium truncate ${isHidden ? 'text-[var(--v2-text-secondary)] line-through' : 'text-[var(--v2-text-primary)]'}`}>
                          {service.name}
                        </h4>
                        <div className="flex items-center gap-2">
                          {service.price != null && !isHidden && (
                            <span className="text-sm font-semibold text-green-600 whitespace-nowrap">
                              {currencySymbol}{service.price}
                            </span>
                          )}
                          {/* Show/Hide Toggle Button */}
                          <button
                            type="button"
                            onClick={() => toggleService(service.id)}
                            className={`p-1.5 rounded-lg transition-all ${
                              isHidden
                                ? 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                                : 'bg-[#4F6EF7]/10 text-[#4F6EF7] hover:bg-[#4F6EF7]/20'
                            }`}
                          >
                            {isHidden ? (
                              <X className="w-4 h-4" />
                            ) : (
                              <Check className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      </div>
                      {service.description && !isHidden && (
                        <p className="text-xs text-[var(--v2-text-secondary)] mt-1 line-clamp-2">
                          {service.description}
                        </p>
                      )}
                      {!isHidden && (
                        <div className="flex items-center gap-1 mt-2">
                          <Calendar className="w-3 h-3 text-[var(--v2-text-secondary)]" />
                          <span className="text-xs text-[var(--v2-text-secondary)]">{service.duration_minutes} min</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="p-2.5 bg-blue-50 rounded-lg flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-blue-600" />
              <span className="text-xs text-blue-700">{labels.services_synced}</span>
            </div>
            <a
              href="/business-os"
              className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-0.5"
            >
              {labels.manage_services}
              <ChevronRight className="w-3 h-3" />
            </a>
          </div>
        </>
      )}
    </div>
  );

  // Device widths for preview
  const DEVICE_WIDTHS: Record<'desktop' | 'tablet' | 'mobile', string> = {
    desktop: '100%',
    tablet: '768px',
    mobile: '375px'
  };

  const renderStep4 = () => (
    <>
      <div className="space-y-3">
        {/* Success Message - Compact */}
        <div className="text-center">
          <div className="w-10 h-10 mx-auto mb-2 rounded-full bg-green-100 flex items-center justify-center">
            <Check className="w-5 h-5 text-green-600" />
          </div>
          <h3 className="text-lg font-bold text-[var(--v2-text-primary)]">{labels.step4_title}</h3>
          <p className="text-sm text-[var(--v2-text-secondary)]">{labels.step4_subtitle}</p>
        </div>

        {/* Live Preview with iframe */}
        <div className="border border-[var(--v2-border)] rounded-lg overflow-hidden">
          {/* Browser Chrome */}
          <div className="bg-[var(--v2-surface-hover)] px-3 py-1.5 flex items-center gap-2 border-b border-[var(--v2-border)]">
            <div className="flex gap-1">
              <div className="w-2 h-2 rounded-full bg-red-400" />
              <div className="w-2 h-2 rounded-full bg-amber-400" />
              <div className="w-2 h-2 rounded-full bg-green-400" />
            </div>
            <div className="flex-1 flex justify-center">
              <div className="bg-[var(--v2-surface)] rounded px-3 py-0.5 text-xs text-[var(--v2-text-secondary)] border border-[var(--v2-border)]">
                {subdomain || 'yoursite'}.agentspilot.com
              </div>
            </div>
            {/* Device Toggle */}
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
            {/* Full Page Preview */}
            {pageId && (
              <button
                onClick={() => setShowFullPreview(true)}
                className="p-1 text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] transition-colors"
                title="Full Page Preview"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
            )}
            {/* Open in new tab */}
            {pageId && (
              <a
                href={`/business-os/website/preview/${pageId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1 text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] transition-colors"
                title={labels.open_preview}
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>

          {/* Preview Content - iframe */}
          <div className="bg-gray-100 flex justify-center overflow-auto" style={{ height: '320px' }}>
            {pageId ? (
              <div
                className="bg-white shadow-lg transition-all duration-300 h-full overflow-hidden relative"
                style={{
                  width: DEVICE_WIDTHS[deviceMode],
                  maxWidth: '100%',
                  borderRadius: deviceMode !== 'desktop' ? '8px' : '0',
                  margin: deviceMode !== 'desktop' ? '8px' : '0'
                }}
              >
                {/* Loading overlay */}
                {previewLoading && (
                  <div className="absolute inset-0 bg-white flex items-center justify-center z-10">
                    <div className="text-center">
                      <Loader2 className="w-8 h-8 text-[#4F6EF7] animate-spin mx-auto mb-2" />
                      <p className="text-xs text-[var(--v2-text-secondary)]">{labels.loading_preview}</p>
                    </div>
                  </div>
                )}
                <iframe
                  key={previewKey}
                  src={`/business-os/website/preview/${pageId}?embedded=true`}
                  className="w-full h-full border-0"
                  onLoad={() => setPreviewLoading(false)}
                  title="Website Preview"
                />
              </div>
            ) : (
              /* Fallback mockup when no pageId */
              <div className="flex items-center justify-center h-full w-full">
                <div className="text-center text-[var(--v2-text-muted)]">
                  <Globe className="w-12 h-12 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">{labels.preview_not_available}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Subdomain - Compact - Always LTR for URL */}
        <div>
          <label className="block text-xs font-medium text-[var(--v2-text-secondary)] mb-1.5">{labels.your_address}</label>
          <div className="flex items-center" dir="ltr">
            <input
              type="text"
              value={subdomain}
              onChange={(e) => setSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              className="flex-1 px-3 py-2 bg-[var(--v2-bg)] border border-[var(--v2-border)] text-sm text-[var(--v2-text-primary)] rounded-l-lg focus:outline-none focus:ring-2 focus:ring-[#4F6EF7]"
              placeholder="yoursite"
            />
            <span className="px-3 py-2 bg-[var(--v2-surface-hover)] border border-l-0 border-[var(--v2-border)] rounded-r-lg text-sm text-[var(--v2-text-secondary)]">
              .agentspilot.com
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={() => handleComplete(false)}
            className="flex-1 px-4 py-2 border border-[var(--v2-border)] text-sm text-[var(--v2-text-primary)] font-medium hover:bg-[var(--v2-surface-hover)] transition-all flex items-center justify-center"
            style={{ borderRadius: 'var(--v2-radius-button)' }}
          >
            {labels.save_draft}
          </button>
          <button
            onClick={() => handleComplete(true)}
            disabled={publishing}
            className="flex-1 px-4 py-2 bg-[#4F6EF7] text-white text-sm font-medium hover:bg-[#3B5AE5] flex items-center justify-center gap-1.5 disabled:opacity-50 transition-all"
            style={{ borderRadius: 'var(--v2-radius-button)' }}
          >
            {publishing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Rocket className="w-4 h-4" />
            )}
            {labels.publish_website}
          </button>
        </div>
      </div>

      {/* Full Page Preview Modal */}
      {showFullPreview && pageId && (
        <div className="fixed inset-0 z-50 bg-gray-900">
          {/* Toolbar */}
          <div className="bg-gray-800 border-b border-gray-700 px-2 sm:px-4 py-2 sm:py-3 flex items-center justify-between">
            <div className="flex items-center gap-2 sm:gap-4 min-w-0">
              <button
                onClick={() => setShowFullPreview(false)}
                className="p-1.5 sm:p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-all flex-shrink-0"
              >
                <X className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>
              <div className="min-w-0">
                <h1 className="text-white font-medium text-sm sm:text-base truncate">{labels.preview}</h1>
                <p className="text-gray-500 text-xs sm:text-sm hidden xs:block truncate">{subdomain || 'yoursite'}.agentspilot.com</p>
              </div>
            </div>
            {/* Device Toggle */}
            <div className="flex items-center gap-0.5 sm:gap-1 bg-gray-700 rounded-lg p-0.5 sm:p-1 flex-shrink-0">
              {[
                { mode: 'desktop' as const, icon: Monitor },
                { mode: 'tablet' as const, icon: Tablet },
                { mode: 'mobile' as const, icon: Smartphone }
              ].map(({ mode, icon: Icon }) => (
                <button
                  key={mode}
                  onClick={() => setDeviceMode(mode)}
                  className={`p-1.5 sm:p-2 rounded-md transition-all ${
                    deviceMode === mode
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  <Icon className="w-4 h-4 sm:w-5 sm:h-5" />
                </button>
              ))}
            </div>
          </div>
          {/* Preview Frame */}
          <div className="flex-1 overflow-auto p-2 sm:p-4 flex justify-center" style={{ height: 'calc(100vh - 48px)' }}>
            <div
              className="bg-white shadow-2xl transition-all duration-300 overflow-hidden"
              style={{
                width: DEVICE_WIDTHS[deviceMode],
                maxWidth: '100%',
                height: '100%',
                borderRadius: deviceMode !== 'desktop' ? '16px' : '0'
              }}
            >
              <iframe
                src={`/business-os/website/preview/${pageId}?embedded=true`}
                className="w-full h-full border-0"
                title="Full Website Preview"
              />
            </div>
          </div>
        </div>
      )}
    </>
  );

  // Wizard content - shared between embedded and full-page modes
  const wizardContent = (
    <>
      {/* Progress Header - Compact */}
      <div
        className="bg-[var(--v2-surface)] border border-[var(--v2-border)] px-4 py-3 mb-4"
        style={{ borderRadius: 'var(--v2-radius-card)' }}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-[#4F6EF7] flex items-center justify-center">
              <Globe className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="text-sm font-medium text-[var(--v2-text-primary)]">
              {labels.step} {currentStep} {labels.of} {totalSteps}
            </span>
          </div>
          <button
            onClick={onSkip}
            className="text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] text-xs flex items-center gap-0.5"
          >
            {labels.skip_setup}
            <ChevronRight className="w-3 h-3" />
          </button>
        </div>
        {/* Progress Bar */}
        <div className="h-1 bg-[var(--v2-border)] rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-[#4F6EF7]"
            initial={{ width: '0%' }}
            animate={{ width: `${(currentStep / totalSteps) * 100}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>
      </div>

      {/* Step Header - Compact */}
      <div className="mb-4">
        <h2 className="text-lg font-bold text-[var(--v2-text-primary)] mb-1">
          {currentStep === 1 && labels.step1_title}
          {currentStep === 2 && labels.step2_title}
          {currentStep === 3 && labels.step3_title}
          {currentStep === 4 && labels.step4_title}
        </h2>
        <p className="text-sm text-[var(--v2-text-secondary)]">
          {currentStep === 1 && labels.step1_subtitle}
          {currentStep === 2 && labels.step2_subtitle}
          {currentStep === 3 && labels.step3_subtitle}
          {currentStep === 4 && labels.step4_subtitle}
        </p>
      </div>

      {/* Step Content - Compact */}
      <div
        className="bg-[var(--v2-surface)] border border-[var(--v2-border)] p-4 shadow-sm"
        style={{ borderRadius: 'var(--v2-radius-card)' }}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={currentStep}
            initial={{ opacity: 0, x: isRTL ? -20 : 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: isRTL ? 20 : -20 }}
            transition={{ duration: 0.15 }}
          >
            {currentStep === 1 && renderStep1()}
            {currentStep === 2 && renderStep2()}
            {currentStep === 3 && renderStep3()}
            {currentStep === 4 && renderStep4()}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Bottom Navigation - Compact */}
      <div
        className="bg-[var(--v2-surface)] border border-[var(--v2-border)] px-4 py-3 mt-4"
        style={{ borderRadius: 'var(--v2-radius-card)' }}
      >
        <div className="flex items-center justify-between">
          <button
            onClick={goBack}
            disabled={currentStep === 1}
            className={`flex items-center gap-1 text-sm font-medium ${
              currentStep === 1
                ? 'text-[var(--v2-text-muted)] cursor-not-allowed'
                : 'text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)]'
            }`}
          >
            <ChevronLeft className="w-4 h-4" />
            {labels.back}
          </button>
          {currentStep < 4 && (
            <button
              onClick={goNext}
              className="px-4 py-2 bg-[#4F6EF7] text-white text-sm font-medium hover:bg-[#3B5AE5] transition-all flex items-center gap-1"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              {labels.continue}
              <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </>
  );

  // Embedded mode - render without full-page wrapper
  if (embedded) {
    return (
      <div dir={isRTL ? 'rtl' : 'ltr'}>
        {wizardContent}
      </div>
    );
  }

  // Full-page mode (legacy)
  return (
    <div
      className="min-h-screen bg-[var(--v2-bg)] flex flex-col"
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      {/* Top Bar */}
      <header className="px-6 py-4 flex items-center justify-between border-b border-[var(--v2-border)] bg-[var(--v2-surface)]">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#4F6EF7] flex items-center justify-center">
            <Globe className="w-5 h-5 text-white" />
          </div>
          <span className="font-semibold text-[var(--v2-text-primary)]">
            {labels.step} {currentStep} {labels.of} {totalSteps}
          </span>
        </div>
        <button
          onClick={onSkip}
          className="text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] text-sm flex items-center gap-1"
        >
          {labels.skip_setup}
          <ChevronRight className="w-4 h-4" />
        </button>
      </header>

      {/* Progress Bar */}
      <div className="h-1.5 bg-[var(--v2-border)]">
        <motion.div
          className="h-full bg-[#4F6EF7]"
          initial={{ width: '0%' }}
          animate={{ width: `${(currentStep / totalSteps) * 100}%` }}
          transition={{ duration: 0.3 }}
        />
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        <main className="flex-1 p-6 sm:p-8">
          <div className="max-w-2xl mx-auto">
            {/* Step Header */}
            <div className="mb-8">
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-[#4F6EF7]/10 text-[#4F6EF7] rounded-full text-sm font-medium mb-4">
                <Globe className="w-4 h-4" />
                {labels.step} {currentStep}
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold text-[var(--v2-text-primary)] mb-2">
                {currentStep === 1 && labels.step1_title}
                {currentStep === 2 && labels.step2_title}
                {currentStep === 3 && labels.step3_title}
                {currentStep === 4 && labels.step4_title}
              </h1>
              <p className="text-[var(--v2-text-secondary)]">
                {currentStep === 1 && labels.step1_subtitle}
                {currentStep === 2 && labels.step2_subtitle}
                {currentStep === 3 && labels.step3_subtitle}
                {currentStep === 4 && labels.step4_subtitle}
              </p>
            </div>

            {/* Step Content */}
            <div className="bg-[var(--v2-surface)] rounded-2xl border border-[var(--v2-border)] p-6 shadow-sm">
              <AnimatePresence mode="wait">
                <motion.div
                  key={currentStep}
                  initial={{ opacity: 0, x: isRTL ? -20 : 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: isRTL ? 20 : -20 }}
                  transition={{ duration: 0.2 }}
                >
                  {currentStep === 1 && renderStep1()}
                  {currentStep === 2 && renderStep2()}
                  {currentStep === 3 && renderStep3()}
                  {currentStep === 4 && renderStep4()}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </main>

        {/* Bottom Navigation */}
        {currentStep < 4 && (
          <div className="border-t border-[var(--v2-border)] bg-[var(--v2-surface)] px-6 py-4">
            <div className="max-w-2xl mx-auto flex items-center justify-between">
              <button
                onClick={goBack}
                disabled={currentStep === 1}
                className={`flex items-center gap-2 font-medium ${
                  currentStep === 1
                    ? 'text-[var(--v2-text-muted)] cursor-not-allowed'
                    : 'text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)]'
                }`}
              >
                <ChevronLeft className="w-5 h-5" />
                {labels.back}
              </button>
              <button
                onClick={goNext}
                className="px-6 py-2.5 bg-[#4F6EF7] text-white font-semibold hover:bg-[#3B5AE5] transition-all flex items-center gap-2"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                {labels.continue}
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
