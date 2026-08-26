/**
 * Website Generation Service
 * LLM-powered service that generates complete website content based on business profile
 *
 * Generates:
 * - Hero section (headline, subheadline)
 * - About section
 * - Service descriptions
 * - Process flow steps
 * - SEO metadata
 * - Theme colors and fonts
 */

import { createLogger } from '@/lib/logger';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { schedulingServiceRepository } from '@/lib/repositories/SchedulingRepository';
import { getWebsitePageRepository } from '@/lib/repositories/WebsitePageRepository';
import { getWebsiteBlockRepository } from '@/lib/repositories/WebsiteBlockRepository';
import { getProviderFactory } from '@/lib/ai/providerFactory';
import { supabaseServer } from '@/lib/supabaseServer';
import { v4 as uuid } from 'uuid';

const logger = createLogger({ service: 'WebsiteGenerationService' });

interface WebsiteContent {
  title: string;
  metaDescription: string;
  keywords: string[];
  hero: {
    headline: string;
    subheadline: string;
  };
  about: {
    paragraphs: string[];
  };
  serviceDescriptions: Record<string, string | { description: string; icon?: string }>;
  processSteps: Array<{
    title: string;
    description: string;
    icon: string;
  }>;
  testimonials: Array<{
    quote: string;
    author: string;
    role: string;
  }>;
  faq: Array<{
    question: string;
    answer: string;
  }>;
  theme: {
    primaryColor: string;
    secondaryColor: string;
    accentColor: string;
    fontFamily: string;
  };
}

export class WebsiteGenerationService {
  /**
   * Generate complete website for a user based on their business profile
   */
  async generateWebsite(userId: string): Promise<{
    success: boolean;
    homepageId?: string;
    blocksCreated?: number;
    error?: string;
  }> {
    try {
      logger.info({ userId }, 'Starting website generation');

      // 1. Fetch business profile and services
      const profileResult = await businessProfileRepository.findByUserId(userId);
      if (profileResult.error || !profileResult.data) {
        logger.error({ err: profileResult.error, userId }, 'Failed to fetch business profile');
        return { success: false, error: 'Business profile not found' };
      }

      const profile = profileResult.data;

      const servicesResult = await schedulingServiceRepository.listAll(userId);
      if (servicesResult.error) {
        logger.warn({ err: servicesResult.error, userId }, 'Failed to fetch services (proceeding with empty array)');
      }

      const services = servicesResult.data || [];

      // 2. Generate website content using LLM
      logger.info({ userId, vertical: profile.vertical, language: profile.language }, 'Generating website content with LLM');

      const websiteContent = await this.callLLM(profile, services);

      // 3. Use user_code as subdomain (or generate one if missing)
      let subdomain = profile.user_code;
      if (!subdomain) {
        // Fetch or generate user_code if not present on profile
        const userCodeResult = await businessProfileRepository.getUserCode(userId);
        if (userCodeResult.error || !userCodeResult.data) {
          logger.warn({ userId }, 'Failed to get user_code, falling back to generated subdomain');
          subdomain = this.generateSubdomain(profile.company_name || 'business');
        } else {
          subdomain = userCodeResult.data;
        }
      }

      // 4. Create homepage
      const websitePageRepository = getWebsitePageRepository(supabaseServer);

      // Convert LLM theme format to PageTheme format
      const pageTheme = {
        colors: {
          primary: websiteContent.theme.primaryColor,
          secondary: websiteContent.theme.secondaryColor,
          accent: websiteContent.theme.accentColor,
          background: '#ffffff',
          surface: '#f9fafb',
          text: '#111827',
          textSecondary: '#6b7280',
        },
        fonts: {
          heading: websiteContent.theme.fontFamily,
          body: websiteContent.theme.fontFamily.includes('serif') ? 'Georgia, serif' : 'Inter, sans-serif',
        },
        borderRadius: '0.5rem',
        spacing: 'normal' as const,
      };

      const homepageResult = await websitePageRepository.create({
        user_id: userId,
        page_type: 'homepage',
        slug: 'home',
        title: websiteContent.title,
        meta_description: websiteContent.metaDescription,
        seo_keywords: websiteContent.keywords,
        status: 'draft', // Website starts as draft - user must explicitly publish
        subdomain,
        website_language: (profile.language || 'en') as 'en' | 'es' | 'he',
        theme: pageTheme,
      });

      if (homepageResult.error || !homepageResult.data) {
        logger.error({ err: homepageResult.error, userId }, 'Failed to create homepage');
        return { success: false, error: 'Failed to create homepage' };
      }

      const homepage = homepageResult.data;
      logger.info({ userId, homepageId: homepage.id, subdomain }, 'Homepage created');

      // 5. Create website blocks
      const blocks = this.buildBlocks(homepage.id, websiteContent, services, profile.language || 'en', profile.company_name || 'Your Business');
      const websiteBlockRepository = getWebsiteBlockRepository(supabaseServer);

      let blocksCreated = 0;
      for (const block of blocks) {
        const blockResult = await websiteBlockRepository.create(block);

        if (blockResult.error) {
          logger.warn({ err: blockResult.error, blockType: block.block_type }, 'Failed to create block (non-blocking)');
        } else {
          blocksCreated++;
        }
      }

      logger.info({ userId, homepageId: homepage.id, blocksCreated }, 'Website generation completed');

      // 6. Update profile completeness to 75% (website now complete)
      await businessProfileRepository.update(userId, {
        profile_completeness: 75,
      });

      return {
        success: true,
        homepageId: homepage.id,
        blocksCreated,
      };

    } catch (error) {
      logger.error({ err: error, userId }, 'Website generation failed');
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Call LLM to generate website content
   */
  private async callLLM(profile: any, services: any[]): Promise<WebsiteContent> {
    const prompt = this.buildPrompt(profile, services);
    const language = profile.language || 'en';

    const systemPrompts: Record<string, string> = {
      en: 'You are a professional website copywriter. Generate compelling, clear, and SEO-optimized website content in English.',
      he: 'אתה כותב תוכן אתרים מקצועי. צור תוכן מושך, ברור ומותאם לקידום אתרים. חובה לכתוב את כל התוכן בעברית בלבד - כל השדות כולל כותרות, תיאורים, שאלות ותשובות, ועדויות לקוחות.',
      es: 'Eres un redactor profesional de sitios web. Genera contenido atractivo, claro y optimizado para SEO. Todo el contenido debe estar en español - incluyendo títulos, descripciones, preguntas y respuestas, y testimonios.',
    };

    try {
      const factory = getProviderFactory();

      // Use the factory's complete() method directly (not getProvider)
      const response = await factory.complete({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompts[language] || systemPrompts.en },
          { role: 'user', content: prompt }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.7,
      });

      const content = JSON.parse(response.content);
      logger.debug({ userId: profile.user_id, language }, 'LLM website content generated');

      return content as WebsiteContent;

    } catch (error) {
      logger.error({ err: error }, 'LLM call failed');
      // Return fallback content
      return this.getFallbackContent(profile, services);
    }
  }

  /**
   * Build LLM prompt for website generation
   * Uses ALL profile data collected during onboarding for comprehensive website content
   */
  private buildPrompt(profile: any, services: any[]): string {
    const vertical = profile.vertical || 'business';
    const subVertical = profile.sub_vertical || null;
    const companyName = profile.company_name || 'Business';
    const description = profile.description || `A ${vertical} providing professional services`;
    const language = profile.language || 'en';

    // Extract rich profile data from onboarding
    const painPoints = profile.pain_points || [];
    const goals = profile.goals || [];
    const tools = profile.tools || [];
    const onlinePresenceMode = profile.online_presence_mode || 'full_website';
    const paymentMode = profile.payment_mode || 'none';

    // Extract additional data from extracted_data if available
    const extractedData = profile.extracted_data || {};
    const targetAudience = extractedData.target_audience || [];
    const clientsPerWeek = profile.clients_per_week || extractedData.clients_per_week || null;

    const serviceList = services
      .map(s => `- ${s.service_name}: ${s.duration_minutes} minutes${s.price ? `, ${s.price} ${s.currency}` : ', Free'}`)
      .join('\n');

    const languageInstructions: Record<string, string> = {
      en: 'LANGUAGE REQUIREMENT: Generate ALL content values in English only.',
      he: `
!!! קריטי - דרישת שפה !!!
צור את כל התוכן בעברית בלבד. זה כולל:
- כותרות (headline, subheadline, title)
- פסקאות (paragraphs)
- תיאורי שירותים (serviceDescriptions)
- שלבי תהליך (processSteps - title ו-description)
- שאלות ותשובות (faq - question ו-answer)
- עדויות לקוחות (testimonials - quote ו-role)
- מטא תיאור (metaDescription)
- מילות מפתח (keywords)

!!! אל תשתמש באנגלית בשום שדה תוכן !!!
כל הערכים חייבים להיות בעברית.
`.trim(),
      es: `
!!! CRÍTICO - REQUISITO DE IDIOMA !!!
Genera TODO el contenido en español únicamente. Esto incluye:
- Títulos (headline, subheadline, title)
- Párrafos (paragraphs)
- Descripciones de servicios (serviceDescriptions)
- Pasos del proceso (processSteps - title y description)
- Preguntas frecuentes (faq - question y answer)
- Testimonios (testimonials - quote y role)
- Meta descripción (metaDescription)
- Palabras clave (keywords)

!!! NO uses inglés en ningún campo de contenido !!!
Todos los valores deben estar en español.
`.trim(),
    };

    // Map pain_points to human-readable descriptions for better LLM context
    const painPointDescriptions: Record<string, string> = {
      no_shows: 'clients missing appointments without notice',
      manual_reminders: 'spending time sending manual appointment reminders',
      payment_collection: 'difficulty collecting payments from clients',
      admin_overhead: 'too much administrative work taking time away from clients',
      client_tracking: 'trouble keeping track of client information and progress',
      no_website: 'no professional online presence',
      scheduling_chaos: 'complicated scheduling and calendar management',
      follow_up: 'difficulty following up with leads and clients',
      retention: 'challenges retaining clients long-term',
    };

    // Map goals to human-readable descriptions
    const goalDescriptions: Record<string, string> = {
      grow_clients: 'grow their client base',
      save_time: 'save time on administrative tasks',
      automation: 'automate repetitive workflows',
      professional_image: 'project a more professional image',
      online_presence: 'establish a strong online presence',
      grow_revenue: 'increase revenue',
      retain_clients: 'improve client retention',
    };

    // Build pain points section if available
    const painPointsText = painPoints.length > 0
      ? `\nBusiness Challenges (problems they solve for clients):\n${painPoints.map((p: string) => `- ${painPointDescriptions[p] || p}`).join('\n')}`
      : '';

    // Build goals section if available
    const goalsText = goals.length > 0
      ? `\nBusiness Goals:\n${goals.map((g: string) => `- ${goalDescriptions[g] || g}`).join('\n')}`
      : '';

    // Build target audience section if available
    const targetAudienceText = targetAudience.length > 0
      ? `\nTarget Audience: ${targetAudience.join(', ')}`
      : '';

    // Build volume context if available
    const volumeText = clientsPerWeek
      ? `\nBusiness Volume: Approximately ${clientsPerWeek} clients per week`
      : '';

    // Build payment context
    const paymentText = paymentMode !== 'none'
      ? `\nPayment Model: ${paymentMode === 'upfront' ? 'Clients pay when booking' : paymentMode === 'invoicing' ? 'Invoice-based billing' : 'Installment payment plans'}`
      : '';

    return `
Generate a complete website for a ${subVertical ? `${subVertical} (${vertical})` : vertical} business.

${languageInstructions[language]}

=== BUSINESS PROFILE ===
Business Name: ${companyName}
Business Type: ${subVertical || vertical}
Description: ${description}
${targetAudienceText}
${volumeText}
${painPointsText}
${goalsText}
${paymentText}

=== SERVICES OFFERED ===
${serviceList || '- Services to be added'}

=== GENERATION INSTRUCTIONS ===
Generate the following as JSON. Use the business profile information above to:
1. Create a compelling headline that speaks to the target audience
2. Write about section paragraphs that address their challenges and showcase expertise
3. Generate service descriptions that highlight value and outcomes
4. Design process steps that reflect the actual client journey
5. Choose theme colors appropriate for the ${subVertical || vertical} vertical

{
  "title": "Homepage title (50-60 characters, include business name and key value)",
  "metaDescription": "SEO meta description (120-160 characters, highlight unique value proposition)",
  "keywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"],
  "hero": {
    "headline": "Compelling headline that speaks to target audience (5-10 words)",
    "subheadline": "Supporting text explaining value proposition and outcomes (15-25 words)"
  },
  "about": {
    "paragraphs": [
      "Paragraph 1: Introduction to the business and its mission",
      "Paragraph 2: Expertise, experience, and what makes them unique",
      "Paragraph 3: Approach to working with clients and expected outcomes"
    ]
  },
  "serviceDescriptions": {
    "Service Name": {
      "description": "Benefit-focused description explaining what client gets and why it matters (20-40 words)",
      "icon": "Choose appropriate icon from: MessageCircle, Brain, Target, Dumbbell, Hand, Flower2, Camera, Scale, Palette, Code, BookOpen, Music, Scissors, Sparkles, Heart, Users, Briefcase, GraduationCap, Stethoscope, Calculator, PenTool, Mic, Video, Utensils, Wrench, Car, Home, ShieldCheck, Plane, Dog, Baby, Leaf, Clock, Check, Zap, Eye, Shield, Award, Globe, Lock, CreditCard, Activity, Compass, Moon, Building, Feather, BarChart, Star, TrendingUp"
    }
  },
  "processSteps": [
    {
      "title": "Step title",
      "description": "Brief description of what happens (10-20 words)",
      "icon": "calendar" // Valid: calendar, clipboard, check, user, phone, mail, heart, star
    }
  ],
  "testimonials": [
    {
      "quote": "Realistic testimonial quote that reflects the service quality (20-40 words)",
      "author": "First Name L.",
      "role": "Client role or description"
    }
  ],
  "faq": [
    {
      "question": "Common question clients might ask",
      "answer": "Clear, helpful answer (20-50 words)"
    }
  ],
  "theme": {
    "primaryColor": "#hexcolor",
    "secondaryColor": "#hexcolor",
    "accentColor": "#hexcolor",
    "fontFamily": "font-name"
  }
}

=== THEME GUIDELINES ===
${this.getThemeGuidelines(vertical, subVertical)}

=== CONTENT QUALITY GUIDELINES ===
- Write in the appropriate tone for a ${subVertical || vertical} (professional but approachable)
- Focus on client outcomes and benefits, not just features
- Address potential client concerns implicitly in the about section
- Make the process steps feel welcoming and low-friction
- Use language that resonates with ${targetAudience.length > 0 ? targetAudience.join(', ') : 'the target audience'}
${painPoints.length > 0 ? `- Subtly address these pain points in the messaging: ${painPoints.join(', ')}` : ''}
${goals.length > 0 ? `- Align content with these business goals: ${goals.join(', ')}` : ''}

=== TESTIMONIALS GUIDELINES ===
- Generate 2-3 realistic placeholder testimonials
- Use generic but believable names (e.g., "Sarah M.", "David R.")
- Roles should match the target audience (e.g., "New Client", "Regular Client", "Business Owner")
- Quotes should highlight specific benefits and outcomes
- Make testimonials feel authentic - avoid generic praise

=== FAQ GUIDELINES ===
- Generate 3-4 common questions relevant to this ${subVertical || vertical} business
- Questions should address: booking process, what to expect, pricing/payment, preparation
- Answers should be concise, helpful, and reduce friction to booking

Generate compelling, professional content that clearly communicates the value proposition and encourages visitors to ${services.length > 0 ? 'book a session' : 'get in touch'}.

=== FINAL LANGUAGE REMINDER ===
${language === 'he' ? 'זכור: כל התוכן חייב להיות בעברית בלבד. לא אנגלית!' : language === 'es' ? 'Recuerda: Todo el contenido debe estar en español únicamente. ¡No inglés!' : 'Remember: All content must be in English.'}
    `.trim();
  }

  /**
   * Get theme guidelines based on vertical and sub-vertical
   */
  private getThemeGuidelines(vertical: string, subVertical: string | null): string {
    const guidelines: Record<string, string> = {
      therapist: 'Calming blues/greens (#60a5fa, #10b981), serif fonts for warmth and trust',
      psychologist: 'Calming blues/greens (#60a5fa, #10b981), serif fonts for warmth and trust',
      counselor: 'Calming blues/greens (#60a5fa, #10b981), serif fonts for warmth and trust',
      coach: 'Energetic oranges/blues (#f97316, #3b82f6), modern sans-serif for motivation',
      life_coach: 'Warm oranges and teals (#f97316, #14b8a6), inspiring and uplifting',
      business_coach: 'Professional blues/grays (#3b82f6, #6b7280), confident and results-focused',
      parenting_coach: 'Warm family-friendly colors (#f97316, #10b981), approachable and nurturing',
      consultant: 'Professional navy/gray (#1e40af, #6b7280), clean sans-serif',
      lawyer: 'Authoritative dark blue/gold (#1e3a8a, #d97706), traditional serif',
      accountant: 'Trustworthy blues/greens (#1e40af, #10b981), clean professional look',
      teacher: 'Friendly blues/yellows (#3b82f6, #eab308), approachable and educational',
      tutor: 'Friendly blues/yellows (#3b82f6, #eab308), approachable and educational',
      fitness: 'Energetic reds/oranges (#ef4444, #f97316), dynamic and motivating',
      trainer: 'Energetic reds/oranges (#ef4444, #f97316), dynamic and motivating',
      beauty: 'Elegant pinks/purples (#ec4899, #a855f7), luxurious and stylish',
      wellness: 'Natural greens/earth tones (#10b981, #a3a3a3), calming and organic',
      photographer: 'Neutral blacks/whites with accent (#171717, #ffffff, #f97316), artistic',
      designer: 'Creative purples/teals (#a855f7, #14b8a6), modern and innovative',
      default: 'Clean blue/white (#3b82f6, #ffffff), modern sans-serif',
    };

    // Try sub-vertical first, then vertical, then default
    return guidelines[subVertical || ''] || guidelines[vertical] || guidelines.default;
  }

  /**
   * Get a default icon for a service based on its name
   */
  private getDefaultIconForService(serviceName: string): string {
    const name = serviceName.toLowerCase();

    // Common service type mappings
    if (name.includes('consult') || name.includes('ייעוץ')) return 'MessageCircle';
    if (name.includes('therap') || name.includes('טיפול')) return 'Heart';
    if (name.includes('coach') || name.includes('אימון')) return 'Target';
    if (name.includes('train') || name.includes('אימון גופני')) return 'Dumbbell';
    if (name.includes('massage') || name.includes('עיסוי')) return 'Hand';
    if (name.includes('yoga') || name.includes('יוגה')) return 'Flower2';
    if (name.includes('photo') || name.includes('צילום')) return 'Camera';
    if (name.includes('design') || name.includes('עיצוב')) return 'Palette';
    if (name.includes('code') || name.includes('תכנות')) return 'Code';
    if (name.includes('teach') || name.includes('לימוד') || name.includes('שיעור')) return 'BookOpen';
    if (name.includes('music') || name.includes('מוזיקה')) return 'Music';
    if (name.includes('hair') || name.includes('תספורת')) return 'Scissors';
    if (name.includes('beauty') || name.includes('יופי')) return 'Sparkles';
    if (name.includes('group') || name.includes('קבוצ')) return 'Users';
    if (name.includes('business') || name.includes('עסק')) return 'Briefcase';
    if (name.includes('law') || name.includes('משפט')) return 'Scale';
    if (name.includes('health') || name.includes('בריאות')) return 'Stethoscope';
    if (name.includes('finance') || name.includes('פיננס') || name.includes('חשבונ')) return 'Calculator';

    // Default icon
    return 'Star';
  }

  /**
   * Build website blocks from generated content
   */
  private buildBlocks(pageId: string, content: WebsiteContent, services: any[], language: string = 'en', companyName: string = 'Your Business'): any[] {
    // Block title translations
    const blockTitles: Record<string, Record<string, string>> = {
      about: { en: 'About', he: 'אודות', es: 'Acerca de' },
      services: { en: 'Services', he: 'שירותים', es: 'Servicios' },
      process: { en: 'How It Works', he: 'איך זה עובד', es: 'Cómo Funciona' },
      booking: { en: 'Book Your Session', he: 'קבעו פגישה', es: 'Reserva tu Sesión' },
      bookingDescription: { en: 'Choose a time that works for you', he: 'בחרו זמן שמתאים לכם', es: 'Elige un horario que te convenga' },
      cta: { en: 'Ready to get started?', he: 'מוכנים להתחיל?', es: '¿Listo para comenzar?' },
      ctaBooking: { en: 'Book a Session', he: 'קבעו פגישה', es: 'Reservar Sesión' },
      ctaContact: { en: 'Contact Us', he: 'צרו קשר', es: 'Contáctanos' },
      ctaSchedule: { en: 'Schedule Now', he: 'קבעו עכשיו', es: 'Agendar Ahora' },
      ctaGetInTouch: { en: 'Get in Touch', he: 'צרו קשר', es: 'Contáctanos' },
      contact: { en: 'Contact', he: 'יצירת קשר', es: 'Contacto' },
      testimonials: { en: 'What Clients Say', he: 'מה הלקוחות אומרים', es: 'Lo que Dicen los Clientes' },
      faq: { en: 'Frequently Asked Questions', he: 'שאלות נפוצות', es: 'Preguntas Frecuentes' },
    };

    // Navigation menu item translations
    const menuLabels: Record<string, Record<string, string>> = {
      about: { en: 'About', he: 'אודות', es: 'Acerca de' },
      services: { en: 'Services', he: 'שירותים', es: 'Servicios' },
      process: { en: 'How It Works', he: 'איך זה עובד', es: 'Cómo Funciona' },
      contact: { en: 'Contact', he: 'יצירת קשר', es: 'Contacto' },
      bookNow: { en: 'Book Now', he: 'הזמן עכשיו', es: 'Reservar' },
    };

    const t = (key: string) => blockTitles[key]?.[language] || blockTitles[key]?.en || key;
    const menu = (key: string) => menuLabels[key]?.[language] || menuLabels[key]?.en || key;

    return [
      // Header block with navigation menu
      {
        page_id: pageId,
        block_type: 'header',
        position: 0,
        content: {
          logo_text: companyName,
          menu_items: [
            { label: menu('about'), anchor: '#about' },
            { label: menu('services'), anchor: '#services' },
            { label: menu('process'), anchor: '#process' },
            { label: menu('contact'), anchor: '#contact' },
          ],
          cta_button: services.length > 0
            ? { text: menu('bookNow'), link: '#booking' }
            : null,
          style: 'blur',
        },
      },

      // Hero block
      {
        page_id: pageId,
        block_type: 'hero',
        position: 1,
        content: {
          headline: content.hero.headline,
          subheadline: content.hero.subheadline,
          cta_text: services.length > 0 ? t('ctaBooking') : t('ctaContact'),
          cta_link: services.length > 0 ? '#booking' : '#contact',
        },
      },

      // About block
      {
        page_id: pageId,
        block_type: 'about',
        position: 2,
        content: {
          title: t('about'),
          // AboutBlock expects 'content' as a string, not 'paragraphs' array
          content: content.about.paragraphs.join('\n\n'),
        },
      },

      // Services block
      {
        page_id: pageId,
        block_type: 'services',
        position: 3,
        content: {
          title: t('services'),
          services: services.map(s => {
            const serviceData = content.serviceDescriptions[s.service_name];
            // Handle both old format (string) and new format (object with description and icon)
            const description = typeof serviceData === 'string'
              ? serviceData
              : serviceData?.description || '';
            const icon = typeof serviceData === 'object'
              ? serviceData?.icon
              : this.getDefaultIconForService(s.service_name);
            return {
              id: s.id,
              name: s.service_name,
              description,
              icon,
              duration: s.duration_minutes,
              durationMinutes: s.duration_minutes, // For ServicesBlock to show formatted duration
              priceRaw: s.price, // Raw price for booking modal
              price: s.price ? `${s.currency === 'ILS' ? '₪' : s.currency === 'EUR' ? '€' : '$'}${s.price}` : null,
              currency: s.currency,
            };
          }),
        },
      },

      // Process flow block
      {
        page_id: pageId,
        block_type: 'process',
        position: 4,
        content: {
          title: t('process'),
          steps: content.processSteps,
          // Default client flow for booking - enables service action buttons
          client_flow: services.length > 0
            ? ['scheduling', 'client_info', 'confirmation']
            : ['confirmation'],
          services_only: services.length === 0,
        },
      },

      // Testimonials block with AI-generated content
      {
        page_id: pageId,
        block_type: 'testimonials',
        position: 5,
        content: {
          title: t('testimonials'),
          testimonials: content.testimonials || [],
        },
      },

      // FAQ block with AI-generated content
      {
        page_id: pageId,
        block_type: 'faq',
        position: 6,
        content: {
          title: t('faq'),
          questions: content.faq || [],
        },
      },

      // Booking widget block (if services exist)
      ...(services.length > 0 ? [{
        page_id: pageId,
        block_type: 'booking_widget',
        position: 7,
        content: {
          title: t('booking'),
          description: t('bookingDescription'),
        },
      }] : []),

      // Contact form block
      {
        page_id: pageId,
        block_type: 'contact_form',  // Must match block registry key
        position: 8,
        content: {
          title: t('contact'),
          fields: ['name', 'email', 'phone', 'message'],
        },
      },

      // CTA block
      {
        page_id: pageId,
        block_type: 'cta',
        position: 9,
        content: {
          title: content.hero.headline,
          description: t('cta'),
          cta_text: services.length > 0 ? t('ctaSchedule') : t('ctaGetInTouch'),
          cta_link: services.length > 0 ? '#booking' : '#contact',
        },
      },

      // Footer block
      {
        page_id: pageId,
        block_type: 'footer',
        position: 10,
        content: {
          company_name: companyName,
          tagline: content.metaDescription,
          copyright_year: new Date().getFullYear(),
          menu_items: [
            { label: menu('about'), anchor: '#about' },
            { label: menu('services'), anchor: '#services' },
            { label: menu('contact'), anchor: '#contact' },
          ],
          show_powered_by: true,
        },
      },
    ];
  }

  /**
   * Generate URL-friendly subdomain from company name
   * Uses transliteration for non-Latin characters (Hebrew, Arabic, etc.)
   */
  private generateSubdomain(companyName: string): string {
    // Transliterate Hebrew characters to Latin
    const hebrewToLatin: Record<string, string> = {
      'א': 'a', 'ב': 'b', 'ג': 'g', 'ד': 'd', 'ה': 'h', 'ו': 'v', 'ז': 'z',
      'ח': 'ch', 'ט': 't', 'י': 'y', 'כ': 'k', 'ך': 'k', 'ל': 'l', 'מ': 'm',
      'ם': 'm', 'נ': 'n', 'ן': 'n', 'ס': 's', 'ע': 'a', 'פ': 'p', 'ף': 'p',
      'צ': 'ts', 'ץ': 'ts', 'ק': 'k', 'ר': 'r', 'ש': 'sh', 'ת': 't',
    };

    // Transliterate the company name
    let slug = companyName
      .split('')
      .map(char => hebrewToLatin[char] || char)
      .join('')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
      .replace(/[^a-z0-9\s-]/g, '')    // Remove remaining special characters
      .replace(/\s+/g, '-')             // Replace spaces with hyphens
      .replace(/-+/g, '-')              // Replace multiple hyphens with single
      .replace(/^-|-$/g, '')            // Remove leading/trailing hyphens
      .substring(0, 40);                // Limit length

    // If slug is empty after processing, use a fallback
    if (!slug) {
      slug = 'my-business';
    }

    // Add a short unique suffix (4 chars) to avoid collisions
    const uniqueSuffix = uuid().substring(0, 4);
    return `${slug}-${uniqueSuffix}`;
  }

  /**
   * Get fallback content if LLM fails
   * Uses available profile data to generate meaningful fallback content
   */
  private getFallbackContent(profile: any, services: any[]): WebsiteContent {
    const companyName = profile.company_name || 'Business';
    const vertical = profile.vertical || 'business';
    const subVertical = profile.sub_vertical || null;
    const description = profile.description || null;
    const language = profile.language || 'en';

    // Get display vertical name
    const displayVertical = subVertical || vertical;
    const capitalizedVertical = displayVertical.charAt(0).toUpperCase() + displayVertical.slice(1).replace(/_/g, ' ');

    // Get theme colors based on vertical
    const themeColors = this.getFallbackThemeColors(vertical, subVertical);

    // Generate about paragraphs using description if available
    const aboutParagraphs = description
      ? [
          description,
          `At ${companyName}, we are committed to delivering excellent results and personalized attention to each client.`,
          services.length > 0
            ? 'Book your session today and experience the difference.'
            : 'Contact us today to learn more about how we can help you.',
        ]
      : [
          `${companyName} provides professional ${capitalizedVertical.toLowerCase()} services with a focus on quality and client satisfaction.`,
          'We are committed to delivering excellent results and personalized attention to each client.',
          services.length > 0
            ? 'Book your session today and experience the difference.'
            : 'Contact us today to get started.',
        ];

    // Generate service descriptions
    const serviceDescriptions = services.reduce((acc, s) => {
      acc[s.service_name] = `Professional ${s.service_name.toLowerCase()} service${s.duration_minutes ? ` (${s.duration_minutes} minutes)` : ''}.`;
      return acc;
    }, {} as Record<string, string>);

    // Localized process step titles
    const processStepTitles: Record<string, { step1: string; step2: string; step3: string }> = {
      en: {
        step1: services.length > 0 ? 'Book Your Session' : 'Get in Touch',
        step2: 'Prepare',
        step3: 'Get Started',
      },
      he: {
        step1: services.length > 0 ? 'קבעו פגישה' : 'צרו קשר',
        step2: 'התכוננו',
        step3: 'התחילו',
      },
      es: {
        step1: services.length > 0 ? 'Reserva tu Sesión' : 'Contáctanos',
        step2: 'Prepárate',
        step3: 'Comienza',
      },
    };

    const steps = processStepTitles[language] || processStepTitles.en;

    // Localized testimonials
    const testimonialTemplates: Record<string, Array<{ quote: string; author: string; role: string }>> = {
      en: [
        { quote: 'Amazing experience! Highly recommended.', author: 'Sarah M.', role: 'Client' },
        { quote: 'Professional and caring service. Will definitely return.', author: 'David R.', role: 'Client' },
      ],
      he: [
        { quote: 'חוויה מדהימה! ממליצה בחום.', author: 'שרה מ.', role: 'לקוחה' },
        { quote: 'שירות מקצועי ואכפתי. בהחלט אחזור.', author: 'דוד ר.', role: 'לקוח' },
      ],
      es: [
        { quote: '¡Experiencia increíble! Muy recomendado.', author: 'María S.', role: 'Cliente' },
        { quote: 'Servicio profesional y atento. Definitivamente volveré.', author: 'Carlos R.', role: 'Cliente' },
      ],
    };

    // Localized FAQ
    const faqTemplates: Record<string, Array<{ question: string; answer: string }>> = {
      en: [
        { question: 'How do I book a session?', answer: 'Simply click on the "Book Now" button and choose a time that works for you.' },
        { question: 'What should I expect?', answer: 'We\'ll guide you through every step of the process. Just bring yourself and an open mind!' },
        { question: 'What is your cancellation policy?', answer: 'We ask for 24 hours notice for cancellations to allow us to offer the slot to others.' },
      ],
      he: [
        { question: 'איך אני קובע/ת פגישה?', answer: 'פשוט לחצו על "הזמן עכשיו" ובחרו זמן שמתאים לכם.' },
        { question: 'מה לצפות?', answer: 'נלווה אתכם בכל שלב בתהליך. פשוט תגיעו עם מוטיבציה וראש פתוח!' },
        { question: 'מהי מדיניות הביטולים?', answer: 'אנחנו מבקשים הודעה של 24 שעות מראש לביטולים כדי שנוכל להציע את המקום לאחרים.' },
      ],
      es: [
        { question: '¿Cómo reservo una sesión?', answer: 'Simplemente haga clic en "Reservar" y elija un horario que le convenga.' },
        { question: '¿Qué debo esperar?', answer: 'Te guiaremos en cada paso del proceso. ¡Solo trae una mente abierta!' },
        { question: '¿Cuál es la política de cancelación?', answer: 'Pedimos 24 horas de aviso para cancelaciones.' },
      ],
    };

    return {
      title: `${companyName} - ${capitalizedVertical} Services`,
      metaDescription: description
        ? description.substring(0, 160)
        : `${companyName} provides professional ${capitalizedVertical.toLowerCase()} services. Book your session today.`,
      keywords: [vertical, subVertical, 'professional services', 'booking', companyName.toLowerCase()].filter(Boolean) as string[],
      hero: {
        headline: `Welcome to ${companyName}`,
        subheadline: description
          ? description.substring(0, 100)
          : `Professional ${capitalizedVertical.toLowerCase()} services tailored to your needs`,
      },
      about: {
        paragraphs: aboutParagraphs,
      },
      serviceDescriptions,
      processSteps: [
        {
          title: steps.step1,
          description: services.length > 0 ? 'Choose a time that works for you' : 'Reach out to discuss your needs',
          icon: services.length > 0 ? 'calendar' : 'mail',
        },
        {
          title: steps.step2,
          description: 'We\'ll send you all the details',
          icon: 'clipboard',
        },
        {
          title: steps.step3,
          description: 'Meet at your scheduled time',
          icon: 'check',
        },
      ],
      testimonials: testimonialTemplates[language] || testimonialTemplates.en,
      faq: faqTemplates[language] || faqTemplates.en,
      theme: themeColors,
    };
  }

  /**
   * Get fallback theme colors based on vertical
   */
  private getFallbackThemeColors(vertical: string, subVertical: string | null): {
    primaryColor: string;
    secondaryColor: string;
    accentColor: string;
    fontFamily: string;
  } {
    const themes: Record<string, { primary: string; secondary: string; accent: string; font: string }> = {
      therapist: { primary: '#60a5fa', secondary: '#ffffff', accent: '#10b981', font: 'Georgia, serif' },
      coach: { primary: '#f97316', secondary: '#ffffff', accent: '#3b82f6', font: 'Inter, sans-serif' },
      parenting_coach: { primary: '#f97316', secondary: '#ffffff', accent: '#10b981', font: 'Inter, sans-serif' },
      life_coach: { primary: '#f97316', secondary: '#ffffff', accent: '#14b8a6', font: 'Inter, sans-serif' },
      consultant: { primary: '#1e40af', secondary: '#ffffff', accent: '#6b7280', font: 'Inter, sans-serif' },
      lawyer: { primary: '#1e3a8a', secondary: '#ffffff', accent: '#d97706', font: 'Georgia, serif' },
      teacher: { primary: '#3b82f6', secondary: '#ffffff', accent: '#eab308', font: 'Inter, sans-serif' },
      fitness: { primary: '#ef4444', secondary: '#ffffff', accent: '#f97316', font: 'Inter, sans-serif' },
      beauty: { primary: '#ec4899', secondary: '#ffffff', accent: '#a855f7', font: 'Inter, sans-serif' },
      wellness: { primary: '#10b981', secondary: '#ffffff', accent: '#a3a3a3', font: 'Inter, sans-serif' },
      default: { primary: '#3b82f6', secondary: '#ffffff', accent: '#10b981', font: 'Inter, sans-serif' },
    };

    const theme = themes[subVertical || ''] || themes[vertical] || themes.default;

    return {
      primaryColor: theme.primary,
      secondaryColor: theme.secondary,
      accentColor: theme.accent,
      fontFamily: theme.font,
    };
  }
}
