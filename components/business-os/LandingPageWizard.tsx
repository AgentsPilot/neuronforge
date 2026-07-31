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
  Monitor, Tablet, Smartphone, Maximize2, Calendar, DollarSign
} from 'lucide-react';
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

type ClientFlowStep = 'booking' | 'payment' | 'intake' | 'confirmation';

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
    // Step 2
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

  // Determine total steps (skip style step if theme exists)
  const hasExistingTheme = !!existingTheme;
  const totalSteps = hasExistingTheme ? 2 : 3;

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

  // Step 2: Style selection (only if no existing theme)
  const [selectedPresetId, setSelectedPresetId] = useState<string>('professional');
  const [useExistingTheme, setUseExistingTheme] = useState(true);

  // Step 3: Preview & Publish
  const [slug, setSlug] = useState('');
  const [generatedContent, setGeneratedContent] = useState<Record<string, unknown> | null>(null);
  const [generatingContent, setGeneratingContent] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [deviceMode, setDeviceMode] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');

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

  // Navigation
  const goNext = async () => {
    if (currentStep === 1 && selectedServiceId) {
      // If has existing theme, skip to step 3 (preview)
      if (hasExistingTheme) {
        setCurrentStep(2); // In 2-step flow, step 2 is preview
        await generateContent();
      } else {
        setCurrentStep(2); // Style selection
      }
    } else if (currentStep === 2) {
      if (hasExistingTheme) {
        // Already at preview (step 2 in 2-step flow)
        return;
      }
      setCurrentStep(3); // Preview
      await generateContent();
    }
  };

  const goBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleServiceSelect = async (serviceId: string) => {
    setSelectedServiceId(serviceId);
    // Find the selected service for content generation
    const service = services.find(s => s.id === serviceId);
    if (!service) return;

    // Auto-advance after selection
    if (hasExistingTheme) {
      // Skip to preview step (step 2 in 2-step flow)
      setCurrentStep(2);
      setSlug(generateSlug(service.name));
      // Generate content for the selected service
      setGeneratingContent(true);
      try {
        console.log('[LandingPageWizard] Calling generate API with:', {
          serviceId: service.id,
          serviceName: service.name,
          hasDescription: !!service.description,
          descriptionLength: service.description?.length || 0
        });

        const response = await fetch('/api/website/landing-pages/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            serviceId: service.id,
            serviceName: service.name,
            serviceDescription: service.description,
            servicePrice: service.price,
            serviceDuration: service.duration_minutes,
            theme: existingTheme
          })
        });
        const data = await response.json();

        console.log('[LandingPageWizard] Generate API response:', {
          success: data.success,
          hasContent: !!data.content,
          warning: data.warning,
          debug: data.debug,
          heroHeadline: data.content?.hero?.headline
        });

        if (data.success && data.content) {
          if (data.warning) {
            console.warn('[LandingPageWizard] Using fallback content:', data.warning);
          }
          setGeneratedContent(data.content);
        } else {
          console.warn('[LandingPageWizard] API failed, using local defaults');
          // Use default content if API fails
          setGeneratedContent(getDefaultGeneratedContent(service));
        }
      } catch (error) {
        console.error('[LandingPageWizard] Error calling generate API:', error);
        // Use default content on error
        setGeneratedContent(getDefaultGeneratedContent(service));
      } finally {
        setGeneratingContent(false);
      }
    } else {
      // Go to style selection step
      setCurrentStep(2);
    }
  };

  const handleComplete = async (shouldPublish: boolean) => {
    if (!selectedService) return;

    setPublishing(shouldPublish);
    setLoading(true);

    onComplete({
      serviceId: selectedService.id,
      serviceName: selectedService.name,
      stylePreset: hasExistingTheme && useExistingTheme ? 'existing' : selectedPresetId,
      theme: getSelectedTheme(),
      slug,
      shouldPublish
    });
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

  // Render Step 2: Style Selection (only shown if no existing theme)
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

            {/* Full Landing Page Preview */}
            <div className="bg-gray-100 flex justify-center overflow-auto" style={{ height: '400px' }}>
              <div
                className="bg-white shadow-lg transition-all duration-300 overflow-y-auto"
                style={{
                  width: DEVICE_WIDTHS[deviceMode],
                  maxWidth: '100%',
                  borderRadius: deviceMode !== 'desktop' ? '8px' : '0',
                  margin: deviceMode !== 'desktop' ? '8px' : '0'
                }}
              >
                {/* Header with Logo */}
                <div className="px-4 py-3 bg-white border-b border-gray-100 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {businessInfo?.logoUrl ? (
                      <img
                        src={businessInfo.logoUrl}
                        alt={businessInfo.companyName || ''}
                        className="h-8 w-auto object-contain"
                      />
                    ) : businessInfo?.companyName ? (
                      <span className="font-bold text-gray-900">{businessInfo.companyName}</span>
                    ) : (
                      <span className="font-bold text-gray-900">{subdomain || 'Your Business'}</span>
                    )}
                  </div>
                  <button
                    className="px-4 py-1.5 text-white text-xs font-semibold rounded-lg"
                    style={{ backgroundColor: getSelectedTheme().colors.primary }}
                  >
                    {language === 'he' ? 'הזמן עכשיו' : language === 'es' ? 'Reservar' : 'Book Now'}
                  </button>
                </div>

                {/* Hero Section */}
                <div
                  className="p-8 text-white text-center relative overflow-hidden"
                  style={{
                    background: `linear-gradient(135deg, ${getSelectedTheme().colors.primary} 0%, ${getSelectedTheme().colors.secondary || getSelectedTheme().colors.primary}ee 100%)`
                  }}
                >
                  {/* Decorative elements */}
                  <div className="absolute top-0 right-0 w-32 h-32 rounded-full opacity-10 bg-white transform translate-x-16 -translate-y-16" />
                  <div className="absolute bottom-0 left-0 w-24 h-24 rounded-full opacity-10 bg-white transform -translate-x-12 translate-y-12" />

                  <div className="relative z-10">
                    <h1 className="text-2xl font-bold mb-3 leading-tight">
                      {selectedService?.name || 'Service'}
                    </h1>
                    <p className="text-sm opacity-90 mb-4 max-w-md mx-auto leading-relaxed">
                      {(generatedContent?.hero as { subheadline?: string })?.subheadline || (language === 'he' ? 'הזמינו עכשיו כדי להתחיל' : language === 'es' ? 'Reserve ahora para comenzar' : 'Book now to get started')}
                    </p>
                    {selectedService?.price != null && (
                      <div className="mb-4">
                        <span className="text-3xl font-bold">{formatPrice(selectedService.price, selectedService.currency)}</span>
                        {selectedService.duration_minutes && (
                          <span className="text-sm opacity-75 ms-2">
                            / {selectedService.duration_minutes >= 60
                              ? `${Math.floor(selectedService.duration_minutes / 60)} ${language === 'he' ? 'שעות' : language === 'es' ? 'horas' : 'hours'}`
                              : `${selectedService.duration_minutes} ${language === 'he' ? 'דקות' : language === 'es' ? 'minutos' : 'min'}`
                            }
                          </span>
                        )}
                      </div>
                    )}
                    <button className="px-8 py-3 bg-white text-gray-900 text-sm font-semibold rounded-full shadow-lg hover:shadow-xl transition-shadow">
                      {language === 'he' ? 'הזמן עכשיו' : language === 'es' ? 'Reservar Ahora' : 'Book Now'}
                    </button>
                  </div>
                </div>

                {/* Service Description - About This Service */}
                {selectedService?.description && (
                  <div className="p-5">
                    <div className="flex items-center gap-2 mb-3">
                      <div
                        className="w-1 h-6 rounded-full"
                        style={{ backgroundColor: getSelectedTheme().colors.primary }}
                      />
                      <h2 className="text-base font-bold text-gray-900">
                        {language === 'he' ? 'אודות השירות' : language === 'es' ? 'Sobre Este Servicio' : 'About This Service'}
                      </h2>
                    </div>
                    <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">
                      {selectedService.description.length > 300
                        ? selectedService.description.substring(0, 300) + '...'
                        : selectedService.description
                      }
                    </p>
                    {selectedService.duration_minutes && (
                      <div className="mt-4 flex items-center gap-4 text-sm">
                        <div
                          className="flex items-center gap-2 px-3 py-1.5 rounded-full"
                          style={{ backgroundColor: `${getSelectedTheme().colors.primary}10` }}
                        >
                          <Calendar className="w-4 h-4" style={{ color: getSelectedTheme().colors.primary }} />
                          <span className="text-gray-700">
                            {selectedService.duration_minutes >= 60
                              ? `${Math.floor(selectedService.duration_minutes / 60)} ${language === 'he' ? 'שעות' : language === 'es' ? 'horas' : 'hours'}`
                              : `${selectedService.duration_minutes} ${language === 'he' ? 'דקות' : language === 'es' ? 'minutos' : 'min'}`
                            }
                          </span>
                        </div>
                        {selectedService.price != null && (
                          <div
                            className="flex items-center gap-2 px-3 py-1.5 rounded-full"
                            style={{ backgroundColor: `${getSelectedTheme().colors.primary}10` }}
                          >
                            <DollarSign className="w-4 h-4" style={{ color: getSelectedTheme().colors.primary }} />
                            <span className="text-gray-700 font-medium">{formatPrice(selectedService.price, selectedService.currency)}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Features Section */}
                {(generatedContent?.features as { title?: string; features?: Array<{ title: string; description: string; icon?: string }> })?.features && (
                  <div className="p-5 bg-gray-50">
                    <h2 className="text-base font-bold text-gray-900 text-center mb-4">
                      {(generatedContent?.features as { title?: string })?.title || 'Why Choose Us'}
                    </h2>
                    <div className="grid grid-cols-2 gap-3">
                      {((generatedContent?.features as { features?: Array<{ title: string; description: string; icon?: string }> })?.features || []).slice(0, 4).map((feature, idx) => (
                        <div key={idx} className="flex flex-col items-center text-center p-4 bg-white rounded-xl shadow-sm border border-gray-100">
                          <div
                            className="w-10 h-10 rounded-full flex items-center justify-center mb-2"
                            style={{ backgroundColor: `${getSelectedTheme().colors.primary}15` }}
                          >
                            <Check className="w-5 h-5" style={{ color: getSelectedTheme().colors.primary }} />
                          </div>
                          <h3 className="text-sm font-semibold text-gray-900 mb-1">{feature.title}</h3>
                          <p className="text-xs text-gray-600 leading-relaxed">{feature.description}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Pricing Section */}
                <div className="p-5">
                  <h2 className="text-base font-bold text-gray-900 text-center mb-4">
                    {(generatedContent?.pricing as { title?: string })?.title || 'Investment'}
                  </h2>
                  <div
                    className="p-5 rounded-2xl text-center relative overflow-hidden"
                    style={{
                      backgroundColor: `${getSelectedTheme().colors.primary}08`,
                      border: `2px solid ${getSelectedTheme().colors.primary}40`
                    }}
                  >
                    {/* Badge */}
                    <div
                      className="absolute top-0 right-0 px-3 py-1 text-xs font-semibold text-white rounded-bl-lg"
                      style={{ backgroundColor: getSelectedTheme().colors.primary }}
                    >
                      {language === 'he' ? 'מומלץ' : language === 'es' ? 'Recomendado' : 'Popular'}
                    </div>

                    <h3 className="font-bold text-gray-900 text-lg mb-2 mt-2">{selectedService?.name}</h3>
                    <p className="text-3xl font-bold mb-1" style={{ color: getSelectedTheme().colors.primary }}>
                      {formatPrice(selectedService?.price, selectedService?.currency || 'USD')}
                    </p>
                    <p className="text-xs text-gray-500 mb-4">
                      {selectedService?.duration_minutes ? (
                        selectedService.duration_minutes >= 60
                          ? `${Math.floor(selectedService.duration_minutes / 60)} ${language === 'he' ? 'שעות' : language === 'es' ? 'horas' : 'hours'}`
                          : `${selectedService.duration_minutes} ${language === 'he' ? 'דקות' : language === 'es' ? 'minutos' : 'minutes'}`
                      ) : ''}
                    </p>

                    {/* Pricing features list */}
                    {(generatedContent?.pricing as { plans?: Array<{ features?: string[] }> })?.plans?.[0]?.features && (
                      <ul className="text-start space-y-2 mb-4">
                        {((generatedContent?.pricing as { plans?: Array<{ features?: string[] }> })?.plans?.[0]?.features || []).slice(0, 4).map((feature, idx) => (
                          <li key={idx} className="flex items-center gap-2 text-sm text-gray-700">
                            <Check className="w-4 h-4 flex-shrink-0" style={{ color: getSelectedTheme().colors.primary }} />
                            <span>{feature}</span>
                          </li>
                        ))}
                      </ul>
                    )}

                    <button
                      className="w-full py-3 text-white text-sm font-semibold rounded-xl shadow-md hover:shadow-lg transition-shadow"
                      style={{ backgroundColor: getSelectedTheme().colors.primary }}
                    >
                      {language === 'he' ? 'הזמן עכשיו' : language === 'es' ? 'Reservar' : 'Book Now'}
                    </button>
                  </div>
                </div>

                {/* FAQ Section */}
                {(generatedContent?.faq as { items?: Array<{ question: string; answer: string }> })?.items && (
                  <div className="p-5 bg-gray-50">
                    <h2 className="text-base font-bold text-gray-900 text-center mb-4">
                      {(generatedContent?.faq as { title?: string })?.title || 'FAQ'}
                    </h2>
                    <div className="space-y-3">
                      {((generatedContent?.faq as { items?: Array<{ question: string; answer: string }> })?.items || []).slice(0, 4).map((item, idx) => (
                        <div key={idx} className="p-4 bg-white rounded-xl shadow-sm border border-gray-100">
                          <div className="flex items-start gap-3">
                            <div
                              className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                              style={{ backgroundColor: `${getSelectedTheme().colors.primary}15` }}
                            >
                              <span className="text-xs font-bold" style={{ color: getSelectedTheme().colors.primary }}>?</span>
                            </div>
                            <div className="flex-1">
                              <h3 className="text-sm font-semibold text-gray-900 mb-1.5">{item.question}</h3>
                              <p className="text-xs text-gray-600 leading-relaxed">{item.answer}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Client Journey / Process Steps (if flow exists) */}
                {clientFlow && clientFlow.length > 1 && (
                  <div className="p-5 bg-gray-50">
                    <h2 className="text-base font-bold text-gray-900 text-center mb-4">
                      {language === 'he' ? 'תהליך ההזמנה' : language === 'es' ? 'Proceso de Reserva' : 'Booking Process'}
                    </h2>
                    <div className="flex items-center justify-center gap-2">
                      {clientFlow.map((step, idx) => {
                        const stepLabels: Record<ClientFlowStep, { he: string; es: string; en: string }> = {
                          booking: { he: 'הזמנה', es: 'Reserva', en: 'Book' },
                          payment: { he: 'תשלום', es: 'Pago', en: 'Pay' },
                          intake: { he: 'טופס', es: 'Formulario', en: 'Form' },
                          confirmation: { he: 'אישור', es: 'Confirmación', en: 'Confirm' }
                        };
                        const label = stepLabels[step]?.[language] || stepLabels[step]?.en || step;
                        return (
                          <div key={step} className="flex items-center">
                            <div className="flex flex-col items-center">
                              <div
                                className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold"
                                style={{ backgroundColor: getSelectedTheme().colors.primary }}
                              >
                                {idx + 1}
                              </div>
                              <span className="text-xs text-gray-600 mt-1">{label}</span>
                            </div>
                            {idx < clientFlow.length - 1 && (
                              <ChevronRight className="w-4 h-4 text-gray-400 mx-1" />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* CTA Footer */}
                <div
                  className="p-6 text-center text-white relative overflow-hidden"
                  style={{
                    background: `linear-gradient(135deg, ${getSelectedTheme().colors.primary} 0%, ${getSelectedTheme().colors.secondary || getSelectedTheme().colors.primary}dd 100%)`
                  }}
                >
                  <div className="absolute top-0 left-0 w-full h-full opacity-10">
                    <div className="absolute top-4 right-8 w-20 h-20 rounded-full bg-white" />
                    <div className="absolute bottom-4 left-8 w-16 h-16 rounded-full bg-white" />
                  </div>
                  <div className="relative z-10">
                    <h2 className="text-lg font-bold mb-2">
                      {(generatedContent?.booking_widget as { title?: string })?.title || (language === 'he' ? 'מוכנים להתחיל?' : language === 'es' ? '¿Listo para comenzar?' : 'Ready to Get Started?')}
                    </h2>
                    <p className="text-sm opacity-90 mb-4">
                      {language === 'he' ? 'הצעד הראשון שלכם מתחיל כאן' : language === 'es' ? 'Tu primer paso comienza aquí' : 'Take your first step today'}
                    </p>
                    <button className="px-8 py-3 bg-white text-gray-900 text-sm font-semibold rounded-full shadow-lg hover:shadow-xl transition-all">
                      {language === 'he' ? 'הזמן עכשיו' : language === 'es' ? 'Reservar Ahora' : 'Book Now'}
                    </button>
                  </div>
                </div>
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
  const renderCurrentStep = () => {
    if (currentStep === 1) {
      return renderStep1();
    }
    if (hasExistingTheme) {
      // 2-step flow: step 2 is preview
      return renderStepPreview();
    }
    // 3-step flow
    if (currentStep === 2) {
      return renderStep2Style();
    }
    return renderStepPreview();
  };

  // Get current step title/subtitle
  const getStepTitle = () => {
    if (currentStep === 1) return labels.step1_title;
    if (hasExistingTheme) return labels.step3_title;
    if (currentStep === 2) return labels.step2_title;
    return labels.step3_title;
  };

  const getStepSubtitle = () => {
    if (currentStep === 1) return labels.step1_subtitle;
    if (hasExistingTheme) return labels.step3_subtitle;
    if (currentStep === 2) return labels.step2_subtitle;
    return labels.step3_subtitle;
  };

  const isPreviewStep = hasExistingTheme ? currentStep === 2 : currentStep === 3;

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
            {/* Show Continue button on step 1 only if service is selected (for users who want manual navigation) */}
            {currentStep === 1 && selectedServiceId && (
              <button
                onClick={goNext}
                className="px-4 py-2 bg-[#4F6EF7] text-white text-sm font-medium hover:bg-[#3B5AE5] transition-all flex items-center gap-1 rounded-lg"
              >
                {labels.continue}
                <ChevronRight className="w-4 h-4" />
              </button>
            )}
            {/* Show Continue button on style selection step (step 2 without existing theme) */}
            {currentStep === 2 && !hasExistingTheme && (
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
