/**
 * OnboardingChatService
 * Handles conversational onboarding with LLM integration
 * Processes user bio and extracts business profile information
 */

import { createLogger } from '@/lib/logger';
import { ProviderFactory, PROVIDERS } from '@/lib/ai/providerFactory';
import { OPENAI_MODELS } from '@/lib/ai/providers/openaiProvider';
import type { CallContext } from '@/lib/ai/providers/baseProvider';
import type { Locale } from '@/lib/i18n/config';
import { supabaseServer } from '@/lib/supabaseServer';
import { tokensToPilotCredits } from '@/lib/utils/pricingConfig';

const logger = createLogger({ service: 'OnboardingChatService' });

export interface OnboardingContext {
  userId: string;
  locale: Locale;
  conversationHistory: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
}

export interface BusinessProfileExtraction {
  vertical: string;
  sub_vertical?: string;
  company_name?: string;
  services: string[];
  clients_per_week?: number;
  tools: string[];
  website_url?: string;
  revenue_tier?: string;
  company_size?: string;
  profile_completeness: number;
}

export interface OnboardingResponse {
  response: string;
  profileUpdates?: Partial<BusinessProfileExtraction>;
  nextAction?: 'continue_chat' | 'preview_profile' | 'analyze_website';
}

export class OnboardingChatService {
  /**
   * Get system prompt for bio extraction based on locale
   */
  private getSystemPrompt(locale: Locale): string {
    const prompts = {
      en: `You are an AI assistant helping a business owner set up their AI Business Operating System.
Your role is to extract business information from their bio or conversation to build a comprehensive business profile.

Extract and identify:
- Vertical (therapist, coach, consultant, lawyer, course creator, etc.)
- Services offered
- Business model (1:1 sessions, courses, products, etc.)
- Client volume (per week/month)
- Tools they currently use (Google Calendar, Stripe, etc.)
- Website URL if mentioned
- Company size (solo, 2-5, 6-10, etc.)

Be conversational and friendly. If information is missing, ask clarifying questions.
Keep responses concise (max 150 words).

When you have enough information to build a profile, indicate you're ready to show a preview.`,

      es: `Eres un asistente de IA que ayuda a un dueño de negocio a configurar su Sistema Operativo de Negocio con IA.
Tu rol es extraer información del negocio de su biografía o conversación para construir un perfil empresarial completo.

Extrae e identifica:
- Vertical (terapeuta, coach, consultor, abogado, creador de cursos, etc.)
- Servicios ofrecidos
- Modelo de negocio (sesiones 1:1, cursos, productos, etc.)
- Volumen de clientes (por semana/mes)
- Herramientas que usan actualmente (Google Calendar, Stripe, etc.)
- URL del sitio web si se menciona
- Tamaño de la empresa (solo, 2-5, 6-10, etc.)

Sé conversacional y amigable. Si falta información, haz preguntas aclaratorias.
Mantén las respuestas concisas (máximo 150 palabras).

Cuando tengas suficiente información para construir un perfil, indica que estás listo para mostrar una vista previa.`,

      he: `אתה עוזר AI שעוזר לבעל עסק להגדיר את מערכת ההפעלה העסקית שלו עם AI.
תפקידך הוא לחלץ מידע עסקי מהביוגרפיה או השיחה שלהם כדי לבנות פרופיל עסקי מקיף.

חלץ וזהה:
- אנכי (מטפל, מאמן, יועץ, עורך דין, יוצר קורסים, וכו')
- שירותים מוצעים
- מודל עסקי (פגישות 1:1, קורסים, מוצרים, וכו')
- נפח לקוחות (לשבוע/חודש)
- כלים שבהם הם משתמשים כרגע (Google Calendar, Stripe, וכו')
- URL של אתר אינטרנט אם הוזכר
- גודל החברה (סולו, 2-5, 6-10, וכו')

היה שיחתי וידידותי. אם חסר מידע, שאל שאלות הבהרה.
שמור על תשובות תמציתיות (מקסימום 150 מילים).

כאשר יש לך מספיק מידע כדי לבנות פרופיל, ציין שאתה מוכן להראות תצוגה מקדימה.`
    };

    return prompts[locale];
  }

  /**
   * Process a bio (uploaded file or typed text) and extract business profile
   */
  async processBio(
    bio: string,
    userId: string,
    locale: Locale = 'en'
  ): Promise<{
    success: boolean;
    profile?: BusinessProfileExtraction;
    tokensUsed?: number;
    pilotCredits?: number;
    error?: string;
  }> {
    try {
      logger.info({ bioLength: bio.length, locale }, 'Processing bio');

      const provider = ProviderFactory.getProvider(PROVIDERS.OPENAI);
      const context: CallContext = {
        userId,
        feature: 'onboarding',
        component: 'OnboardingChatService',
        category: 'bio_extraction',
        activity_type: 'business_profile_extraction',
        activity_name: 'process_bio',
      };

      const extractionPrompt = `Extract business information from this bio and return as JSON:

Bio:
${bio}

Return ONLY a JSON object with these fields (use null if not found):
{
  "vertical": "therapist|coach|consultant|lawyer|course_creator|other",
  "sub_vertical": "optional specific type",
  "company_name": "business name",
  "services": ["service 1", "service 2"],
  "clients_per_week": number,
  "tools": ["tool 1", "tool 2"],
  "website_url": "url",
  "revenue_tier": "startup|growing|established",
  "company_size": "solo|2-5|6-10|11-50|50+"
}`;

      const response = await provider.chatCompletion({
        model: OPENAI_MODELS.GPT_4O_MINI,
        messages: [
          {
            role: 'system',
            content: 'You are a business profile extraction assistant. Return only valid JSON.'
          },
          {
            role: 'user',
            content: extractionPrompt
          }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1, // Low temperature for consistent extraction
        max_tokens: 500
      }, context);

      const content = response.choices[0]?.message?.content || '{}';

      // Get token usage from response
      const tokensUsed = response.usage?.total_tokens || 0;
      const pilotCredits = await tokensToPilotCredits(tokensUsed, supabaseServer);

      // Parse JSON response
      let extracted: Partial<BusinessProfileExtraction>;
      try {
        extracted = JSON.parse(content);
      } catch (parseError) {
        logger.error({ err: parseError, content }, 'Failed to parse LLM JSON response');
        throw new Error('Failed to parse profile extraction');
      }

      // Calculate profile completeness
      const completeness = this.calculateCompleteness(extracted);

      const profile: BusinessProfileExtraction = {
        vertical: extracted.vertical || 'other',
        sub_vertical: extracted.sub_vertical,
        company_name: extracted.company_name,
        services: extracted.services || [],
        clients_per_week: extracted.clients_per_week,
        tools: extracted.tools || [],
        website_url: extracted.website_url,
        revenue_tier: extracted.revenue_tier,
        company_size: extracted.company_size,
        profile_completeness: completeness
      };

      logger.info(
        { vertical: profile.vertical, completeness, tokensUsed, pilotCredits },
        'Bio processed successfully'
      );
      return { success: true, profile, tokensUsed, pilotCredits };
    } catch (error) {
      logger.error({ err: error }, 'Failed to process bio');
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Handle conversational onboarding chat
   */
  async chat(
    userMessage: string,
    context: OnboardingContext
  ): Promise<OnboardingResponse> {
    try {
      logger.info({ userId: context.userId, locale: context.locale }, 'Processing chat message');

      const provider = ProviderFactory.getProvider(PROVIDERS.OPENAI);
      const callContext: CallContext = {
        userId: context.userId,
        feature: 'onboarding',
        component: 'OnboardingChatService',
        category: 'conversational_onboarding',
        activity_type: 'onboarding_chat',
        activity_name: 'chat_interaction',
      };

      const messages = [
        {
          role: 'system' as const,
          content: this.getSystemPrompt(context.locale)
        },
        ...context.conversationHistory,
        {
          role: 'user' as const,
          content: userMessage
        }
      ];

      const response = await provider.chatCompletion({
        model: OPENAI_MODELS.GPT_4O_MINI,
        messages,
        temperature: 0.7,
        max_tokens: 300
      }, callContext);

      const assistantResponse = response.choices[0]?.message?.content || 'I apologize, I didn\'t understand that. Could you please rephrase?';

      // Determine next action based on response
      const nextAction = this.determineNextAction(assistantResponse, context);

      logger.info({ userId: context.userId, nextAction }, 'Chat message processed');
      return {
        response: assistantResponse,
        nextAction
      };
    } catch (error) {
      logger.error({ err: error, userId: context.userId }, 'Failed to process chat message');
      throw error;
    }
  }

  /**
   * Determine next action based on conversation state
   */
  private determineNextAction(
    response: string,
    context: OnboardingContext
  ): 'continue_chat' | 'preview_profile' | 'analyze_website' {
    const lowerResponse = response.toLowerCase();

    // Check if assistant is ready to show preview
    if (
      lowerResponse.includes('ready to show') ||
      lowerResponse.includes('build your profile') ||
      lowerResponse.includes('set up your')
    ) {
      return 'preview_profile';
    }

    // Check if website analysis needed
    if (
      lowerResponse.includes('analyze your website') ||
      lowerResponse.includes('scrape your website')
    ) {
      return 'analyze_website';
    }

    return 'continue_chat';
  }

  /**
   * Calculate profile completeness percentage
   */
  private calculateCompleteness(profile: Partial<BusinessProfileExtraction>): number {
    const fields = [
      'vertical',
      'company_name',
      'services',
      'clients_per_week',
      'tools',
      'website_url'
    ];

    const filledFields = fields.filter(field => {
      const value = profile[field as keyof typeof profile];
      if (Array.isArray(value)) {
        return value.length > 0;
      }
      return value !== null && value !== undefined && value !== '';
    });

    return Math.round((filledFields.length / fields.length) * 100);
  }
}

// Singleton export
export const onboardingChatService = new OnboardingChatService();
