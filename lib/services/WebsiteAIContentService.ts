/**
 * WebsiteAIContentService
 * AI-powered content generation for website blocks
 *
 * Generates personalized content based on:
 * - Business profile (company name, vertical, description)
 * - Scheduling services
 * - User's activated capabilities
 * - Target language (EN/ES/HE)
 */

import { createLogger } from '@/lib/logger';
import { ProviderFactory } from '@/lib/ai/providerFactory';

const logger = createLogger({ service: 'WebsiteAIContentService' });

// Types
export type WebsiteLanguage = 'en' | 'es' | 'he';

export interface BusinessProfileData {
  company_name: string | null;
  vertical: string;
  sub_vertical?: string | null;
  website_url?: string | null;
  website_analysis?: Record<string, unknown> | null;
}

export interface SchedulingServiceData {
  service_name: string;
  description?: string | null;
  price?: number | null;
  currency?: string;
  duration_minutes?: number | null;
}

export interface UserCapabilityData {
  capability_key: string;
  name_en: string;
  name_es: string;
  name_he: string;
  icon: string;
  color?: string | null;
}

export interface ContentGenerationRequest {
  blockType: string;
  targetLanguage: WebsiteLanguage;
  businessProfile: BusinessProfileData;
  services?: SchedulingServiceData[];
  userCapabilities?: UserCapabilityData[];
  existingContent?: Record<string, unknown>;
  fieldToRegenerate?: string;
}

export interface ProcessStep {
  title: string;
  description: string;
  icon: string;
  number?: number;
  capability_key?: string;
  capability_link?: string;
  auto_generated?: boolean;
}

export interface Testimonial {
  quote: string;
  author: string;
  role?: string;
  company?: string;
  image?: string;
  rating?: number;
}

// Capability to Process Step mapping
const CAPABILITY_STEPS: Record<string, Record<WebsiteLanguage, { title: string; description: string; icon: string }>> = {
  'crm': {
    en: { title: 'Get to Know You', description: 'Fill out a brief intake form so we can understand your needs', icon: 'Users' },
    es: { title: 'Conocerte', description: 'Completa un breve formulario para entender tus necesidades', icon: 'Users' },
    he: { title: 'להכיר אותך', description: 'מלא טופס קצר כדי שנבין את הצרכים שלך', icon: 'Users' }
  },
  'scheduling': {
    en: { title: 'Book Your Session', description: 'Choose a time that works best for you', icon: 'Calendar' },
    es: { title: 'Reserva tu Sesión', description: 'Elige un horario que te convenga', icon: 'Calendar' },
    he: { title: 'קבע פגישה', description: 'בחר זמן שנוח לך', icon: 'Calendar' }
  },
  'payments': {
    en: { title: 'Secure Payment', description: 'Pay safely with credit card or other methods', icon: 'CreditCard' },
    es: { title: 'Pago Seguro', description: 'Paga de forma segura con tarjeta u otros métodos', icon: 'CreditCard' },
    he: { title: 'תשלום מאובטח', description: 'שלם בבטחה עם כרטיס אשראי או אמצעים אחרים', icon: 'CreditCard' }
  },
  'email_automation': {
    en: { title: 'Stay Connected', description: 'Receive helpful reminders and follow-ups', icon: 'Mail' },
    es: { title: 'Mantente Conectado', description: 'Recibe recordatorios y seguimientos útiles', icon: 'Mail' },
    he: { title: 'שמור על קשר', description: 'קבל תזכורות ומעקבים שימושיים', icon: 'Mail' }
  }
};

// Service icon mapping (Lucide icon names)
const SERVICE_ICONS: Record<string, string> = {
  'consult': 'MessageCircle',
  'consultation': 'MessageCircle',
  'therapy': 'Brain',
  'therapist': 'Brain',
  'session': 'Clock',
  'coaching': 'Target',
  'coach': 'Target',
  'train': 'Dumbbell',
  'training': 'Dumbbell',
  'fitness': 'Dumbbell',
  'massage': 'Hand',
  'spa': 'Flower2',
  'yoga': 'Flower2',
  'meditation': 'Flower2',
  'wellness': 'Heart',
  'photo': 'Camera',
  'photography': 'Camera',
  'legal': 'Scale',
  'lawyer': 'Scale',
  'law': 'Scale',
  'design': 'Palette',
  'creative': 'Palette',
  'art': 'Palette',
  'dev': 'Code',
  'development': 'Code',
  'software': 'Code',
  'tech': 'Code',
  'tutor': 'BookOpen',
  'tutoring': 'BookOpen',
  'lesson': 'BookOpen',
  'teaching': 'BookOpen',
  'education': 'GraduationCap',
  'music': 'Music',
  'audio': 'Music',
  'hair': 'Scissors',
  'beauty': 'Sparkles',
  'makeup': 'Sparkles',
  'health': 'Heart',
  'medical': 'Stethoscope',
  'nutrition': 'Apple',
  'diet': 'Apple',
  'business': 'Briefcase',
  'strategy': 'TrendingUp',
  'marketing': 'Megaphone',
  'sales': 'ShoppingCart',
  'finance': 'DollarSign',
  'accounting': 'Calculator',
  'real estate': 'Home',
  'property': 'Home',
  'writing': 'PenTool',
  'content': 'FileText',
  'video': 'Video',
  'default': 'Sparkles'
};

export class WebsiteAIContentService {

  /**
   * Get the appropriate icon for a service based on its name
   */
  getServiceIcon(serviceName: string): string {
    const name = serviceName.toLowerCase();

    for (const [keyword, icon] of Object.entries(SERVICE_ICONS)) {
      if (name.includes(keyword)) {
        return icon;
      }
    }

    return SERVICE_ICONS['default'];
  }

  /**
   * Generate process steps from user's activated capabilities
   */
  generateProcessStepsFromCapabilities(
    capabilities: UserCapabilityData[],
    language: WebsiteLanguage
  ): ProcessStep[] {
    const steps: ProcessStep[] = [];
    let stepNumber = 1;

    // Define the ideal order for process steps
    const capabilityOrder = ['crm', 'scheduling', 'payments', 'email_automation'];

    // Sort capabilities by the ideal order
    const sortedCapabilities = [...capabilities].sort((a, b) => {
      const aIndex = capabilityOrder.indexOf(a.capability_key);
      const bIndex = capabilityOrder.indexOf(b.capability_key);
      return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
    });

    for (const cap of sortedCapabilities) {
      const stepTemplate = CAPABILITY_STEPS[cap.capability_key];

      if (stepTemplate) {
        const langStep = stepTemplate[language];
        steps.push({
          number: stepNumber++,
          title: langStep.title,
          description: langStep.description,
          icon: langStep.icon,
          capability_key: cap.capability_key,
          capability_link: `/business-os/${cap.capability_key}`,
          auto_generated: true
        });
      }
    }

    return steps;
  }

  /**
   * Generate content for a specific block type
   */
  async generateBlockContent(request: ContentGenerationRequest): Promise<Record<string, unknown>> {
    const { blockType, targetLanguage, businessProfile, services, userCapabilities } = request;

    logger.info({ blockType, targetLanguage, companyName: businessProfile.company_name }, 'Generating block content');

    try {
      switch (blockType) {
        case 'hero':
          return await this.generateHeroContent(businessProfile, targetLanguage);

        case 'about':
          return await this.generateAboutContent(businessProfile, targetLanguage);

        case 'services':
          return this.generateServicesContent(services || [], targetLanguage);

        case 'pricing':
          return this.generatePricingContent(services || [], targetLanguage);

        case 'faq':
          return await this.generateFAQContent(businessProfile, services || [], targetLanguage);

        case 'features':
          return await this.generateFeaturesContent(businessProfile, services || [], targetLanguage);

        case 'process':
          return this.generateProcessContent(userCapabilities || [], targetLanguage);

        case 'stats':
          return this.generateStatsContent(targetLanguage);

        case 'contact_form':
          return this.generateContactFormContent(businessProfile, targetLanguage);

        case 'cta':
          return await this.generateCTAContent(businessProfile, targetLanguage);

        default:
          logger.debug({ blockType }, 'No specific generation logic for block type');
          return request.existingContent || {};
      }
    } catch (error) {
      logger.error({ err: error, blockType }, 'Failed to generate block content');
      return request.existingContent || {};
    }
  }

  /**
   * Regenerate a single field within a block
   */
  async regenerateField(request: ContentGenerationRequest): Promise<string> {
    const { blockType, fieldToRegenerate, targetLanguage, businessProfile } = request;

    if (!fieldToRegenerate) {
      throw new Error('fieldToRegenerate is required');
    }

    logger.info({ blockType, fieldToRegenerate, targetLanguage }, 'Regenerating single field');

    const provider = ProviderFactory.getProvider('openai');
    const languageNames: Record<WebsiteLanguage, string> = {
      en: 'English',
      es: 'Spanish',
      he: 'Hebrew'
    };

    const prompt = this.buildFieldRegenerationPrompt(
      blockType,
      fieldToRegenerate,
      businessProfile,
      languageNames[targetLanguage]
    );

    const response = await provider.complete({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a professional website copywriter. Generate concise, engaging content.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.7,
      max_tokens: 300
    });

    return response.content.trim();
  }

  /**
   * Enhance a testimonial with AI
   */
  async enhanceTestimonial(text: string, language: WebsiteLanguage): Promise<string> {
    logger.info({ language, textLength: text.length }, 'Enhancing testimonial');

    const provider = ProviderFactory.getProvider('openai');
    const languageNames: Record<WebsiteLanguage, string> = {
      en: 'English',
      es: 'Spanish',
      he: 'Hebrew'
    };

    const prompt = `Enhance this testimonial to sound more professional and compelling while keeping the authentic voice.
Keep it in ${languageNames[language]}.
Do not change the core message or add claims that weren't there.
Make it concise (2-3 sentences max).

Original testimonial:
"${text}"

Enhanced testimonial (just the text, no quotes):`;

    const response = await provider.complete({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a professional editor who polishes customer testimonials.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.5,
      max_tokens: 200
    });

    return response.content.trim();
  }

  // ==================== PRIVATE GENERATION METHODS ====================

  private async generateHeroContent(
    profile: BusinessProfileData,
    language: WebsiteLanguage
  ): Promise<Record<string, unknown>> {
    const provider = ProviderFactory.getProvider('openai');
    const langName = { en: 'English', es: 'Spanish', he: 'Hebrew' }[language];

    const prompt = `Generate hero section content for a ${profile.vertical} business website.
Company name: ${profile.company_name || 'Professional Services'}
Language: ${langName}

Generate a JSON object with:
- headline: A compelling headline (max 10 words)
- subheadline: A supporting message (max 20 words)
- cta_text: Call to action button text (2-4 words)

Return ONLY valid JSON, no markdown.`;

    try {
      const response = await provider.complete({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 200
      });

      const parsed = JSON.parse(response.content.trim());
      return {
        headline: parsed.headline,
        subheadline: parsed.subheadline,
        cta_text: parsed.cta_text,
        cta_link: '#contact'
      };
    } catch {
      // Fallback content
      const fallbacks: Record<WebsiteLanguage, Record<string, string>> = {
        en: { headline: `Welcome to ${profile.company_name || 'Our Services'}`, subheadline: 'Professional services tailored to your needs', cta_text: 'Get Started' },
        es: { headline: `Bienvenido a ${profile.company_name || 'Nuestros Servicios'}`, subheadline: 'Servicios profesionales adaptados a tus necesidades', cta_text: 'Comenzar' },
        he: { headline: `ברוכים הבאים ל${profile.company_name || 'השירותים שלנו'}`, subheadline: 'שירותים מקצועיים המותאמים לצרכים שלך', cta_text: 'להתחיל' }
      };
      return { ...fallbacks[language], cta_link: '#contact' };
    }
  }

  private async generateAboutContent(
    profile: BusinessProfileData,
    language: WebsiteLanguage
  ): Promise<Record<string, unknown>> {
    const provider = ProviderFactory.getProvider('openai');
    const langName = { en: 'English', es: 'Spanish', he: 'Hebrew' }[language];

    const prompt = `Generate about section content for a ${profile.vertical} business website.
Company name: ${profile.company_name || 'Professional Services'}
Language: ${langName}

Generate a JSON object with:
- title: Section title (e.g., "About Us")
- about_text: A 2-3 sentence description of the business

Return ONLY valid JSON, no markdown.`;

    try {
      const response = await provider.complete({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 300
      });

      return JSON.parse(response.content.trim());
    } catch {
      const fallbacks: Record<WebsiteLanguage, Record<string, string>> = {
        en: { title: `About ${profile.company_name || 'Us'}`, about_text: 'We are dedicated to providing excellent service and helping our clients achieve their goals.' },
        es: { title: `Sobre ${profile.company_name || 'Nosotros'}`, about_text: 'Nos dedicamos a brindar un servicio excelente y ayudar a nuestros clientes a alcanzar sus metas.' },
        he: { title: `אודות ${profile.company_name || 'אותנו'}`, about_text: 'אנו מחויבים לספק שירות מעולה ולעזור ללקוחותינו להשיג את המטרות שלהם.' }
      };
      return fallbacks[language];
    }
  }

  private generateServicesContent(
    services: SchedulingServiceData[],
    language: WebsiteLanguage
  ): Record<string, unknown> {
    const titles: Record<WebsiteLanguage, string> = {
      en: 'Our Services',
      es: 'Nuestros Servicios',
      he: 'השירותים שלנו'
    };

    const subtitles: Record<WebsiteLanguage, string> = {
      en: 'Discover how we can help you',
      es: 'Descubre cómo podemos ayudarte',
      he: 'גלה כיצד נוכל לעזור לך'
    };

    return {
      title: titles[language],
      subtitle: subtitles[language],
      services: services.map(service => ({
        name: service.service_name,
        description: service.description || '',
        icon: this.getServiceIcon(service.service_name),
        price: service.price ? this.formatPrice(service.price, service.currency || 'USD') : undefined,
        duration: service.duration_minutes ? `${service.duration_minutes} min` : undefined
      }))
    };
  }

  private generatePricingContent(
    services: SchedulingServiceData[],
    language: WebsiteLanguage
  ): Record<string, unknown> {
    const titles: Record<WebsiteLanguage, string> = {
      en: 'Pricing',
      es: 'Precios',
      he: 'מחירים'
    };

    const subtitles: Record<WebsiteLanguage, string> = {
      en: 'Transparent pricing for all our services',
      es: 'Precios transparentes para todos nuestros servicios',
      he: 'מחירים שקופים לכל השירותים שלנו'
    };

    const ctaTexts: Record<WebsiteLanguage, string> = {
      en: 'Book Now',
      es: 'Reservar',
      he: 'הזמן עכשיו'
    };

    const pricedServices = services.filter(s => s.price && s.price > 0);

    return {
      title: titles[language],
      subtitle: subtitles[language],
      plans: pricedServices.map((service, index) => ({
        name: service.service_name,
        price: this.formatPrice(service.price!, service.currency || 'USD'),
        period: service.duration_minutes ? `${service.duration_minutes} min` : undefined,
        description: service.description || undefined,
        features: this.generateServiceFeatures(service, language),
        popular: index === Math.floor(pricedServices.length / 2),
        cta_text: ctaTexts[language],
        cta_link: '/booking'
      }))
    };
  }

  private generateProcessContent(
    capabilities: UserCapabilityData[],
    language: WebsiteLanguage
  ): Record<string, unknown> {
    const titles: Record<WebsiteLanguage, string> = {
      en: 'How It Works',
      es: 'Cómo Funciona',
      he: 'איך זה עובד'
    };

    const subtitles: Record<WebsiteLanguage, string> = {
      en: 'Simple steps to get started',
      es: 'Pasos sencillos para comenzar',
      he: 'צעדים פשוטים להתחיל'
    };

    return {
      title: titles[language],
      subtitle: subtitles[language],
      steps: this.generateProcessStepsFromCapabilities(capabilities, language),
      layout: 'numbered'
    };
  }

  private async generateFAQContent(
    profile: BusinessProfileData,
    services: SchedulingServiceData[],
    language: WebsiteLanguage
  ): Promise<Record<string, unknown>> {
    const provider = ProviderFactory.getProvider('openai');
    const langName = { en: 'English', es: 'Spanish', he: 'Hebrew' }[language];
    const serviceNames = services.map(s => s.service_name).join(', ');

    const prompt = `Generate FAQ section for a ${profile.vertical} business website.
Company: ${profile.company_name || 'Professional Services'}
Services offered: ${serviceNames || 'various services'}
Language: ${langName}

Generate a JSON object with:
- title: Section title
- items: Array of 4-5 FAQ items, each with "question" and "answer"

Return ONLY valid JSON, no markdown.`;

    try {
      const response = await provider.complete({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 600
      });

      return JSON.parse(response.content.trim());
    } catch {
      const fallbacks: Record<WebsiteLanguage, { title: string; items: Array<{ question: string; answer: string }> }> = {
        en: {
          title: 'Frequently Asked Questions',
          items: [
            { question: 'How do I book an appointment?', answer: 'Simply click the booking button and choose a time that works for you.' },
            { question: 'What are your payment options?', answer: 'We accept all major credit cards and offer flexible payment plans.' }
          ]
        },
        es: {
          title: 'Preguntas Frecuentes',
          items: [
            { question: '¿Cómo reservo una cita?', answer: 'Simplemente haz clic en el botón de reserva y elige un horario.' },
            { question: '¿Cuáles son las opciones de pago?', answer: 'Aceptamos todas las tarjetas principales y ofrecemos planes de pago.' }
          ]
        },
        he: {
          title: 'שאלות נפוצות',
          items: [
            { question: 'איך אני קובע פגישה?', answer: 'פשוט לחץ על כפתור ההזמנה ובחר זמן שנוח לך.' },
            { question: 'מהן אפשרויות התשלום?', answer: 'אנו מקבלים את כל כרטיסי האשראי הגדולים ומציעים תוכניות תשלום.' }
          ]
        }
      };
      return fallbacks[language];
    }
  }

  private async generateFeaturesContent(
    profile: BusinessProfileData,
    services: SchedulingServiceData[],
    language: WebsiteLanguage
  ): Promise<Record<string, unknown>> {
    const provider = ProviderFactory.getProvider('openai');
    const langName = { en: 'English', es: 'Spanish', he: 'Hebrew' }[language];

    const prompt = `Generate features section for a ${profile.vertical} business website.
Company: ${profile.company_name || 'Professional Services'}
Language: ${langName}

Generate a JSON object with:
- title: Section title
- subtitle: Brief description
- features: Array of 3-4 features, each with "title", "description", and "icon" (use Lucide icon names like 'CheckCircle', 'Shield', 'Clock', 'Star')

Return ONLY valid JSON, no markdown.`;

    try {
      const response = await provider.complete({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 500
      });

      return JSON.parse(response.content.trim());
    } catch {
      const fallbacks: Record<WebsiteLanguage, Record<string, unknown>> = {
        en: {
          title: 'Why Choose Us',
          subtitle: 'What sets us apart',
          features: [
            { title: 'Professional Service', description: 'Experienced and certified professionals', icon: 'Award' },
            { title: 'Flexible Scheduling', description: 'Book appointments that fit your schedule', icon: 'Clock' },
            { title: 'Personalized Approach', description: 'Tailored solutions for your unique needs', icon: 'Users' }
          ]
        },
        es: {
          title: 'Por Qué Elegirnos',
          subtitle: 'Lo que nos distingue',
          features: [
            { title: 'Servicio Profesional', description: 'Profesionales experimentados y certificados', icon: 'Award' },
            { title: 'Horarios Flexibles', description: 'Reserva citas que se adapten a tu horario', icon: 'Clock' },
            { title: 'Enfoque Personalizado', description: 'Soluciones adaptadas a tus necesidades', icon: 'Users' }
          ]
        },
        he: {
          title: 'למה לבחור בנו',
          subtitle: 'מה מייחד אותנו',
          features: [
            { title: 'שירות מקצועי', description: 'מומחים מנוסים ומוסמכים', icon: 'Award' },
            { title: 'גמישות בזמנים', description: 'קבע פגישות שמתאימות ללוח הזמנים שלך', icon: 'Clock' },
            { title: 'גישה אישית', description: 'פתרונות מותאמים לצרכים הייחודיים שלך', icon: 'Users' }
          ]
        }
      };
      return fallbacks[language];
    }
  }

  private generateStatsContent(language: WebsiteLanguage): Record<string, unknown> {
    const titles: Record<WebsiteLanguage, string> = {
      en: 'Our Impact',
      es: 'Nuestro Impacto',
      he: 'ההשפעה שלנו'
    };

    // Stats will be enriched from real data by WebsiteBlockEnrichmentService
    return {
      title: titles[language],
      stats: []
    };
  }

  private generateContactFormContent(
    profile: BusinessProfileData,
    language: WebsiteLanguage
  ): Record<string, unknown> {
    const content: Record<WebsiteLanguage, Record<string, unknown>> = {
      en: {
        title: profile.company_name ? `Contact ${profile.company_name}` : 'Contact Us',
        subtitle: 'We\'d love to hear from you',
        submit_text: 'Send Message',
        fields: [
          { name: 'name', type: 'text', label: 'Your Name', required: true },
          { name: 'email', type: 'email', label: 'Email', required: true },
          { name: 'phone', type: 'tel', label: 'Phone', required: false },
          { name: 'message', type: 'textarea', label: 'Message', required: true }
        ]
      },
      es: {
        title: profile.company_name ? `Contactar ${profile.company_name}` : 'Contáctanos',
        subtitle: 'Nos encantaría saber de ti',
        submit_text: 'Enviar Mensaje',
        fields: [
          { name: 'name', type: 'text', label: 'Tu Nombre', required: true },
          { name: 'email', type: 'email', label: 'Correo', required: true },
          { name: 'phone', type: 'tel', label: 'Teléfono', required: false },
          { name: 'message', type: 'textarea', label: 'Mensaje', required: true }
        ]
      },
      he: {
        title: profile.company_name ? `צור קשר עם ${profile.company_name}` : 'צור קשר',
        subtitle: 'נשמח לשמוע ממך',
        submit_text: 'שלח הודעה',
        fields: [
          { name: 'name', type: 'text', label: 'שם', required: true },
          { name: 'email', type: 'email', label: 'אימייל', required: true },
          { name: 'phone', type: 'tel', label: 'טלפון', required: false },
          { name: 'message', type: 'textarea', label: 'הודעה', required: true }
        ]
      }
    };

    return content[language];
  }

  private async generateCTAContent(
    profile: BusinessProfileData,
    language: WebsiteLanguage
  ): Promise<Record<string, unknown>> {
    const content: Record<WebsiteLanguage, Record<string, string>> = {
      en: {
        title: 'Ready to Get Started?',
        subtitle: 'Book your first session today',
        cta_text: 'Book Now',
        cta_link: '#booking'
      },
      es: {
        title: '¿Listo para Comenzar?',
        subtitle: 'Reserva tu primera sesión hoy',
        cta_text: 'Reservar',
        cta_link: '#booking'
      },
      he: {
        title: 'מוכן להתחיל?',
        subtitle: 'קבע את הפגישה הראשונה שלך היום',
        cta_text: 'הזמן עכשיו',
        cta_link: '#booking'
      }
    };

    return content[language];
  }

  // ==================== HELPER METHODS ====================

  private formatPrice(price: number, currency: string): string {
    const symbols: Record<string, string> = {
      USD: '$',
      EUR: '€',
      ILS: '₪',
      GBP: '£',
      MXN: '$'
    };
    const symbol = symbols[currency] || currency + ' ';
    return `${symbol}${price}`;
  }

  private generateServiceFeatures(
    service: SchedulingServiceData,
    language: WebsiteLanguage
  ): string[] {
    const features: string[] = [];

    if (service.duration_minutes) {
      const durationText: Record<WebsiteLanguage, string> = {
        en: `${service.duration_minutes} minute session`,
        es: `Sesión de ${service.duration_minutes} minutos`,
        he: `פגישה של ${service.duration_minutes} דקות`
      };
      features.push(durationText[language]);
    }

    const genericFeatures: Record<WebsiteLanguage, string[]> = {
      en: ['Professional service', 'Online booking', 'Flexible scheduling'],
      es: ['Servicio profesional', 'Reserva en línea', 'Horarios flexibles'],
      he: ['שירות מקצועי', 'הזמנה מקוונת', 'גמישות בזמנים']
    };

    // Add generic features to reach at least 3
    const needed = Math.max(0, 3 - features.length);
    features.push(...genericFeatures[language].slice(0, needed));

    return features;
  }

  private buildFieldRegenerationPrompt(
    blockType: string,
    field: string,
    profile: BusinessProfileData,
    languageName: string
  ): string {
    const fieldDescriptions: Record<string, string> = {
      headline: 'a compelling headline (max 10 words)',
      subheadline: 'a supporting message (max 20 words)',
      cta_text: 'a call-to-action button text (2-4 words)',
      title: 'a section title (2-5 words)',
      subtitle: 'a brief description (max 15 words)',
      about_text: 'an about us paragraph (2-3 sentences)',
      description: 'a brief description (1-2 sentences)'
    };

    const description = fieldDescriptions[field] || 'appropriate content';

    return `Generate ${description} for the ${blockType} section of a ${profile.vertical} business website.
Company: ${profile.company_name || 'Professional Services'}
Language: ${languageName}

Return ONLY the text, no quotes or formatting.`;
  }
}

// Singleton export
export const websiteAIContentService = new WebsiteAIContentService();
