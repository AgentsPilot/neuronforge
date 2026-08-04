/**
 * Landing Page Content Generation API
 * POST - Generate AI content for a landing page based on service data
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { ProviderFactory } from '@/lib/ai/providerFactory';
import { z } from 'zod';

const logger = createLogger({ module: 'LandingPageGenerateAPI' });

const GenerateContentSchema = z.object({
  serviceId: z.string().uuid(),
  serviceName: z.string().min(1),
  serviceDescription: z.string().nullable().optional(),
  servicePrice: z.number().nullable().optional(),
  serviceDuration: z.number().optional(),
  theme: z.object({
    colors: z.object({
      primary: z.string(),
      secondary: z.string()
    }).passthrough(),
    fonts: z.object({
      heading: z.string(),
      body: z.string()
    }).passthrough()
  }).passthrough().optional()
});

/**
 * Detect the primary language of the text
 */
function detectLanguage(text: string): 'hebrew' | 'english' | 'spanish' | 'other' {
  if (!text) return 'english';

  // Hebrew character range
  const hebrewChars = text.match(/[\u0590-\u05FF]/g) || [];
  // Spanish-specific characters
  const spanishChars = text.match(/[áéíóúüñ¿¡]/gi) || [];
  // Basic Latin (English)
  const latinChars = text.match(/[a-zA-Z]/g) || [];

  const hebrewRatio = hebrewChars.length / text.length;
  const spanishRatio = spanishChars.length / text.length;

  if (hebrewRatio > 0.1) return 'hebrew';
  if (spanishRatio > 0.02 && latinChars.length > hebrewChars.length) return 'spanish';
  if (latinChars.length > 0) return 'english';

  return 'other';
}

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const validated = GenerateContentSchema.parse(body);

    // Get business profile for additional context
    const { data: profile } = await supabaseServer
      .from('business_profiles')
      .select('company_name, vertical, sub_vertical, target_audience, unique_value_proposition')
      .eq('user_id', user.id)
      .single();

    // Detect language from service description or name
    const contentLanguage = detectLanguage(validated.serviceDescription || validated.serviceName);

    requestLogger.info({
      detectedLanguage: contentLanguage,
      descriptionLength: validated.serviceDescription?.length || 0,
      serviceName: validated.serviceName
    }, 'Starting AI content generation');

    // Build prompt for AI content generation
    const prompt = buildGenerationPrompt(validated, profile, contentLanguage);
    const systemPrompt = buildSystemPrompt(contentLanguage);

    // Generate content using AI - use gpt-4o for better content quality
    const provider = ProviderFactory.getProvider('openai');

    const response = await provider.chatCompletion(
      {
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: systemPrompt
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7,
        response_format: { type: 'json_object' }
      },
      {
        userId: user.id,
        feature: 'landing-page-generation',
        component: 'LandingPageGenerateAPI'
      }
    );

    // Parse the generated content
    let generatedContent: Record<string, unknown>;
    try {
      const responseText = response.choices[0]?.message?.content || '{}';
      requestLogger.info({ responseLength: responseText.length }, 'AI response received');
      generatedContent = JSON.parse(responseText);

      // Validate that we got real content, not empty objects
      if (!generatedContent.hero || !generatedContent.features || !generatedContent.faq) {
        requestLogger.warn({ generatedContent }, 'AI response missing expected fields');
        generatedContent = getDefaultContent(validated);
      }
    } catch (parseError) {
      requestLogger.warn({ err: parseError }, 'Failed to parse AI response, using defaults');
      generatedContent = getDefaultContent(validated);
    }

    requestLogger.info({
      serviceId: validated.serviceId,
      userId: user.id
    }, 'Generated landing page content');

    return NextResponse.json({
      success: true,
      content: generatedContent
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid input', details: error.errors },
        { status: 400 }
      );
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    requestLogger.error({ err: error, errorMessage }, 'Failed to generate landing page content');

    // Return default content on error, but include the error for debugging
    const body = await request.clone().json().catch(() => ({}));
    return NextResponse.json({
      success: true,
      content: getDefaultContent(body),
      warning: 'Used default content due to generation error',
      debug: process.env.NODE_ENV === 'development' ? { error: errorMessage } : undefined
    });
  }
}

/**
 * Build system prompt based on detected language
 */
function buildSystemPrompt(language: 'hebrew' | 'english' | 'spanish' | 'other'): string {
  const languageInstructions = {
    hebrew: `You are an expert Hebrew copywriter specializing in landing pages that convert visitors to customers.
CRITICAL: All output text MUST be in Hebrew (עברית). Use natural, professional Hebrew that resonates with Israeli audiences.
Write right-to-left friendly content. Use modern Hebrew marketing language.`,
    spanish: `You are an expert Spanish copywriter specializing in landing pages that convert visitors to customers.
CRITICAL: All output text MUST be in Spanish (Español). Use natural, professional Spanish.`,
    english: `You are an expert copywriter specializing in landing pages that convert visitors to customers.
All output text should be in English.`,
    other: `You are an expert copywriter specializing in landing pages that convert visitors to customers.
Match the language of the input description in your output.`
  };

  return `${languageInstructions[language]}

Your expertise:
1. ANALYZING service descriptions to extract key benefits, features, and selling points
2. TRANSFORMING raw information into compelling marketing copy
3. CREATING relevant FAQ based on the actual service content
4. STRUCTURING content for maximum conversion

Key principles:
- Extract REAL benefits from the description, don't invent generic ones
- FAQ must address questions a potential customer would actually ask about THIS specific service
- Features should highlight what makes this service unique based on the description
- Headlines should capture the core transformation/benefit the service provides

Always respond with valid JSON matching the exact structure requested.`;
}

function buildGenerationPrompt(
  data: z.infer<typeof GenerateContentSchema>,
  profile: { company_name?: string; vertical?: string; target_audience?: string; unique_value_proposition?: string } | null,
  language: 'hebrew' | 'english' | 'spanish' | 'other'
): string {
  const businessName = profile?.company_name || '';
  const vertical = profile?.vertical || '';
  const targetAudience = profile?.target_audience || '';

  // Format duration in a readable way
  let durationText = '';
  if (data.serviceDuration) {
    if (data.serviceDuration >= 60) {
      const hours = Math.floor(data.serviceDuration / 60);
      const mins = data.serviceDuration % 60;
      durationText = hours + (mins > 0 ? `.${mins}` : '') + ' hours';
    } else {
      durationText = data.serviceDuration + ' minutes';
    }
  }

  // Language-specific labels
  const labels = {
    hebrew: {
      investment: 'ההשקעה',
      readyToStart: 'מוכנים להתחיל?',
      haveQuestions: 'יש לכם שאלות?',
      whyChoose: 'למה לבחור בשירות הזה',
      commonQuestions: 'שאלות נפוצות',
      bookNow: 'להרשמה'
    },
    spanish: {
      investment: 'Inversión',
      readyToStart: '¿Listo para comenzar?',
      haveQuestions: '¿Tienes preguntas?',
      whyChoose: 'Por qué elegir este servicio',
      commonQuestions: 'Preguntas frecuentes',
      bookNow: 'Reservar ahora'
    },
    english: {
      investment: 'Investment',
      readyToStart: 'Ready to Get Started?',
      haveQuestions: 'Have Questions?',
      whyChoose: 'Why Choose This Service',
      commonQuestions: 'Frequently Asked Questions',
      bookNow: 'Book Now'
    },
    other: {
      investment: 'Investment',
      readyToStart: 'Ready to Get Started?',
      haveQuestions: 'Have Questions?',
      whyChoose: 'Why Choose This Service',
      commonQuestions: 'Frequently Asked Questions',
      bookNow: 'Book Now'
    }
  };

  const l = labels[language];

  return `TASK: Analyze the following offering and generate a complete landing page content structure.

═══════════════════════════════════════════════════════════════
OFFERING INFORMATION
═══════════════════════════════════════════════════════════════

NAME: ${data.serviceName}

FULL DESCRIPTION (analyze this carefully to understand what type of offering this is):
"""
${data.serviceDescription || 'No description provided'}
"""

PRICING: ${data.servicePrice ? `${data.servicePrice}` : 'Contact for pricing'}
DURATION: ${durationText || 'Varies'}
${businessName ? `BUSINESS: ${businessName}` : ''}
${vertical ? `INDUSTRY: ${vertical}` : ''}
${targetAudience ? `TARGET AUDIENCE: ${targetAudience}` : ''}

═══════════════════════════════════════════════════════════════
STEP 1: DETECT THE TYPE OF OFFERING
═══════════════════════════════════════════════════════════════

From the description, determine if this is:
- A COURSE/TRAINING (keywords: קורס, הכשרה, לימוד, course, training, workshop, certification)
- A COACHING/CONSULTATION (keywords: אימון, ייעוץ, coaching, mentoring, consultation)
- A TREATMENT/THERAPY (keywords: טיפול, treatment, therapy, session)
- A PRODUCT/SERVICE (anything else)

Adapt ALL content accordingly - use course-specific language for courses, service language for services, etc.

═══════════════════════════════════════════════════════════════
STEP 2: CONTENT GENERATION INSTRUCTIONS
═══════════════════════════════════════════════════════════════

1. HERO SECTION:
   - Subheadline: Create a compelling 1-2 sentence summary that captures:
     * What the offering IS (course, training, service, etc.)
     * WHO it's for (the target audience from the description)
     * What TRANSFORMATION or OUTCOME they'll achieve
   - Example for a course: "קורס מעשי להורים ומטפלים, לזיהוי וטיפול מוצלח בילדים עם הפרעת קשב"
   - Example for a service: "טיפול מותאם אישית שיעזור לך להתגבר על חרדות ולחיות חיים מלאים"

2. FEATURES SECTION (extract 4 REAL benefits from the description):
   - Title should match the offering type:
     * For courses: "${language === 'hebrew' ? 'מה תלמדו בקורס' : language === 'spanish' ? 'Qué Aprenderás' : 'What You Will Learn'}"
     * For services: "${l.whyChoose}"
   - Each feature should be a SPECIFIC benefit mentioned or implied in the description
   - Don't use generic benefits - be specific to THIS offering

3. PRICING SECTION:
   - Title for courses: "${language === 'hebrew' ? 'פרטי הקורס' : language === 'spanish' ? 'Detalles del Curso' : 'Course Details'}"
   - Title for services: "${l.investment}"
   - List 4-5 specific inclusions from the description

4. FAQ SECTION (create 4 questions a real customer would ask):
   - FOR COURSES: questions about format, prerequisites, schedule, certification, what they'll learn
   - FOR SERVICES: questions about the process, duration, expected outcomes
   - FOR TREATMENTS: questions about the experience, preparation, results
   - Answers should be helpful and based on information in the description

5. CALL-TO-ACTION SECTIONS:
   - For courses: "${language === 'hebrew' ? 'מוכנים להירשם?' : language === 'spanish' ? '¿Listo para inscribirte?' : 'Ready to Enroll?'}"
   - For services: "${l.readyToStart}"

═══════════════════════════════════════════════════════════════
OUTPUT FORMAT (JSON)
═══════════════════════════════════════════════════════════════

{
  "offering_type": "course|service|coaching|treatment",
  "hero": {
    "headline": "Short, impactful headline (3-6 words) that captures the essence of the offering",
    "subheadline": "Compelling 1-2 sentence summary that explains what this is, who it's for, and the transformation"
  },
  "features": {
    "title": "Appropriate title based on offering type",
    "features": [
      { "title": "Specific Benefit 1", "description": "Detailed explanation from description", "icon": "Brain" },
      { "title": "Specific Benefit 2", "description": "Detailed explanation from description", "icon": "Target" },
      { "title": "Specific Benefit 3", "description": "Detailed explanation from description", "icon": "Heart" },
      { "title": "Specific Benefit 4", "description": "Detailed explanation from description", "icon": "Sparkles" }
    ]
  },
  "pricing": {
    "title": "Appropriate title based on offering type",
    "plans": [
      {
        "name": "${data.serviceName}",
        "price": "${data.servicePrice || 0}",
        "description": "Brief value statement about the offering",
        "features": ["Specific inclusion 1", "Specific inclusion 2", "Specific inclusion 3", "Specific inclusion 4"]
      }
    ]
  },
  "faq": {
    "title": "${l.commonQuestions}",
    "faqs": [
      { "question": "Specific question about this offering?", "answer": "Helpful answer based on description" },
      { "question": "Another relevant question?", "answer": "Helpful answer based on description" },
      { "question": "Question about process/format?", "answer": "Helpful answer based on description" },
      { "question": "Question about outcomes/results?", "answer": "Helpful answer based on description" }
    ]
  },
  "booking_widget": {
    "title": "Appropriate CTA based on offering type (for bookable services)"
  },
  "cta": {
    "title": "Compelling CTA title (for courses/products - e.g. 'Ready to Start Learning?')",
    "description": "Short motivating description (e.g. 'Enroll now and begin your journey')",
    "cta_text": "Action button text (e.g. 'Enroll Now' for courses, 'Buy Now' for products)"
  },
  "contact_form": {
    "title": "${l.haveQuestions}"
  }
}

CRITICAL REMINDERS:
- ALL text must be in ${language === 'hebrew' ? 'Hebrew (עברית)' : language === 'spanish' ? 'Spanish (Español)' : 'English'}
- DETECT the offering type from the description and adapt ALL content accordingly
- The subheadline is THE MOST IMPORTANT - it should clearly explain what this is and who it's for
- Extract REAL information from the description - do not invent generic content
- FAQ questions must be ones a real potential customer would ask about THIS specific offering`;
}

function getDefaultContent(data: { serviceName?: string; serviceDescription?: string | null; servicePrice?: number | null; serviceDuration?: number }): Record<string, unknown> {
  const serviceName = data.serviceName || 'Our Service';

  // Format duration
  let durationText = '60 minute session';
  if (data.serviceDuration) {
    if (data.serviceDuration >= 60) {
      const hours = Math.floor(data.serviceDuration / 60);
      const mins = data.serviceDuration % 60;
      durationText = hours + (mins > 0 ? `.${mins}` : '') + ' hour' + (hours > 1 ? 's' : '');
    } else {
      durationText = data.serviceDuration + ' minutes';
    }
  }

  return {
    hero: {
      headline: `Transform Your Life with ${serviceName}`,
      subheadline: 'Experience professional guidance tailored to your unique needs and goals.'
    },
    features: {
      title: 'Why Choose This Service',
      features: [
        { title: 'Expert Guidance', description: 'Work with experienced professionals who understand your needs', icon: 'Star' },
        { title: 'Personalized Approach', description: 'Content and methods tailored to your specific situation', icon: 'Users' },
        { title: 'Proven Results', description: 'A track record of success with satisfied clients', icon: 'TrendingUp' },
        { title: 'Comprehensive Support', description: 'Full support throughout your journey', icon: 'Heart' }
      ]
    },
    pricing: {
      title: 'Investment',
      plans: [
        {
          name: serviceName,
          price: data.servicePrice?.toString() || 'Contact us',
          description: durationText,
          features: ['Full program access', 'Personalized attention', 'Support materials', 'Follow-up assistance']
        }
      ]
    },
    faq: {
      title: 'Frequently Asked Questions',
      faqs: [
        { question: 'What can I expect from this service?', answer: 'A supportive, professional environment focused on helping you achieve your goals.' },
        { question: 'How do I prepare?', answer: 'Simply come as you are. We will guide you through everything you need to know.' },
        { question: 'What if I need to reschedule?', answer: 'We understand life happens. Contact us to reschedule your appointment.' },
        { question: 'Is this right for me?', answer: 'This service is designed to help anyone looking to improve in this area. Contact us to discuss your specific needs.' }
      ]
    },
    booking_widget: {
      title: 'Ready to Get Started?'
    },
    contact_form: {
      title: 'Have Questions? Reach Out'
    }
  };
}
