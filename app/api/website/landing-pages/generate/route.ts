/**
 * Landing Page Content Generation API
 * POST - Generate AI content for a landing page based on service data
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { ProviderFactory } from '@/lib/ai/providerFactory';
import { buildBosCallContext, newBosGroupId } from '@/lib/business-os/llm/callCatalog';
import { runAiAction } from '@/lib/business-os/llm/aiActionAudit';
import { withModelFallback } from '@/lib/business-os/llm/modelFallback';
import { resolveBosLlmSettings } from '@/lib/business-os/llm/modelSettings';
import { z } from 'zod';

const logger = createLogger({ module: 'LandingPageGenerateAPI' });

/*
 * This route calls a model and waits for a full page of copy — whichever
 * model the website area row names (Layer 2), not a model this file picks.
 *
 * Without `maxDuration` a Vercel function is killed at the platform default
 * while the browser is still waiting, and the wizard's spinner — which only
 * stops in the fetch's `finally` — spins until the tab is closed. Peer routes
 * that call a model already set this; this one never did.
 */
export const maxDuration = 60;

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
 * The language the business has actually chosen, as this generator names them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The page was written in whatever language the SERVICE TEXT happened to be in,
 * and that is not the same question. A business working in Hebrew names a
 * service "Couple training" or "Gym Public Training Course" — both real rows on
 * the reporting account — and `detectLanguage` reads Latin characters and
 * answers English. Their clients then get an English landing page from a Hebrew
 * business, and the only way to fix it is to rename the service.
 *
 * The configured language is a fact; the script of a service name is a hint.
 * The fact wins, and detection stays as the fallback for an account that has
 * never been asked.
 *
 * Null for anything unrecognised, so the caller can fall through rather than
 * being handed a wrong confident answer.
 * ─────────────────────────────────────────────────────────────────────────────
 */
function configuredLanguage(locale: string | null | undefined): 'hebrew' | 'english' | 'spanish' | null {
  switch ((locale || '').trim().toLowerCase().slice(0, 2)) {
    case 'he': return 'hebrew';
    case 'es': return 'spanish';
    case 'en': return 'english';
    default: return null;
  }
}

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

    // Get business profile for additional context, and the preference rows that
    // say which language this business works in.
    const [{ data: profile }, { data: preferences }] = await Promise.all([
      supabaseServer
        .from('business_profiles')
        .select('company_name, vertical, sub_vertical, target_audience, unique_value_proposition, language')
        .eq('user_id', user.id)
        .single(),
      supabaseServer
        .from('user_preferences')
        .select('preferred_language')
        .eq('user_id', user.id)
        .maybeSingle(),
    ]);

    /*
     * ─────────────────────────────────────────────────────────────────────────
     * THE LANGUAGE THE BUSINESS WORKS IN, NOT THE ONE ITS SERVICE NAME IS IN.
     *
     * This was `detectLanguage(description || name)` alone, which answers a
     * different question. The reporting account has services called "Couple
     * training" and "Gym Public Training Course" beside Hebrew ones — so a
     * Hebrew business generating a page for one of those got an English page
     * for its Hebrew clients, and the only lever was to rename the service.
     *
     * `preferred_language` first, then the profile's, matching the precedence
     * `my-day` uses: the preference row is the one a person can change.
     * Detection remains for an account that has set neither, where the text is
     * the only evidence there is.
     * ─────────────────────────────────────────────────────────────────────────
     */
    const contentLanguage =
      configuredLanguage(preferences?.preferred_language)
      ?? configuredLanguage(profile?.language)
      ?? detectLanguage(validated.serviceDescription || validated.serviceName);

    // One usage group per generation request; never taken from the request.
    const groupId = newBosGroupId();

    /*
     * ─────────────────────────────────────────────────────────────────────────
     * WHY THE STARTING DRAFT WAS USED, WHERE SOMEBODY WILL SEE IT.
     *
     * Three paths return the default content — the area switched off, a reply
     * missing its sections, and unparseable JSON — and all three returned it as
     * `{ success: true, content }`, indistinguishable from a page the model
     * actually wrote. The `warning` the wizard logs was only ever set by the
     * catch block, so a generation that ran, answered and was REJECTED looked
     * like a generation that worked.
     *
     * That cost a real investigation: the owner reported a page of placeholder
     * copy, the usage table showed a successful 5.2-second gpt-4o call, and
     * nothing anywhere said those two facts belonged to the same request.
     * ─────────────────────────────────────────────────────────────────────────
     */
    let draftReason: string | null = null;
    let draftDetail: Record<string, unknown> | undefined;

    requestLogger.info({
      userId: user.id,
      groupId,
      contentLanguage,
      // Which answer won, so a page that came out in the wrong language can be
      // diagnosed without guessing: a configured one, or the text's own script.
      languageSource:
        configuredLanguage(preferences?.preferred_language) ? 'preference'
        : configuredLanguage(profile?.language) ? 'profile'
        : 'detected',
      descriptionLength: validated.serviceDescription?.length || 0,
      serviceName: validated.serviceName
    }, 'Starting AI content generation');

    // Build prompt for AI content generation
    const prompt = buildGenerationPrompt(validated, profile, contentLanguage);
    const systemPrompt = buildSystemPrompt(contentLanguage);

    // Generate content using AI. The model is NOT chosen here: it comes from
    // the website area row (Layer 2 FR-15), resolved a few lines below.
    const provider = ProviderFactory.getProvider('openai');

    // The call and the parse are one AI action, one audit entry (Layer 3,
    // FR-12). Content replaced by the defaults is recorded as a failure.
    const generatedContent = await runAiAction(
      { area: 'website', actionType: 'website_landing_page', groupId, trigger: 'user', accountId: user.id, correlationId },
      async (h): Promise<Record<string, unknown>> => {
        /*
         * Model, temperature and the on/off switch come from the website area
         * row (Layer 2 FR-12). Off returns the same default content a parse
         * failure already returns — and because no LLM call is made, the action
         * writes no audit entry (Layer 3 FR-7), which is correct: nothing ran.
         */
        const settings = await resolveBosLlmSettings('website', 'landing_page');
        if (!settings.enabled) {
          requestLogger.info(
            { userId: user.id, reason: 'disabled' },
            'Landing page AI is switched off; using the default content'
          );
          draftReason = 'ai_disabled';
          return getDefaultContent(validated);
        }

        // Built inside the attempt so a retry carries the model that ran (FR-11).
        const { result: response } = await withModelFallback(settings, (model) => provider.chatCompletion(
          {
            model,
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
            ...(settings.temperature !== undefined ? { temperature: settings.temperature } : {}),
            response_format: { type: 'json_object' }
          },
          buildBosCallContext({
            userId: user.id,
            area: 'website',
            callName: 'landing_page',
            groupId,
            correlationId,
          })
        ));

        // Parse the generated content
        try {
          const responseText = response.choices[0]?.message?.content || '{}';
          requestLogger.info({ responseLength: responseText.length }, 'AI response received');
          const parsed: Record<string, unknown> = JSON.parse(responseText);

          // Validate that we got real content, not empty objects
          if (!parsed.hero || !parsed.features || !parsed.faq) {
            // The model's output: keys only at warn, the content at debug
            // (bos-llm-call-standards, Standard 5).
            requestLogger.warn({ keys: Object.keys(parsed) }, 'AI response missing expected fields');
            requestLogger.debug({ generatedContent: parsed }, 'AI response missing expected fields: content');
            h.markFailed('content_fallback');
            draftReason = 'missing_sections';
            // Key names only: the copy itself is the owner's and stays in the
            // debug log, not in an HTTP response.
            draftDetail = { returned: Object.keys(parsed), required: ['hero', 'features', 'faq'] };
            return getDefaultContent(validated);
          }
          return parsed;
        } catch (parseError) {
          // A JSON SyntaxError quotes the model's output: name at warn, detail at debug.
          requestLogger.warn(
            { errName: parseError instanceof Error ? parseError.name : typeof parseError },
            'Failed to parse AI response, using defaults'
          );
          requestLogger.debug({ err: parseError }, 'Failed to parse AI response: detail');
          h.markFailed('content_fallback');
          draftReason = 'unparseable_json';
          draftDetail = { errName: parseError instanceof Error ? parseError.name : typeof parseError };
          return getDefaultContent(validated);
        }
      }
    );

    requestLogger.info({
      serviceId: validated.serviceId,
      userId: user.id
    }, 'Generated landing page content');

    return NextResponse.json({
      success: true,
      content: generatedContent,
      // Present only when the page is the starting draft, so the wizard can say
      // so instead of presenting placeholder copy as generated work.
      ...(draftReason
        ? { warning: `Used the starting draft (${draftReason})`, debug: draftDetail }
        : {}),
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
  profile: {
    company_name?: string;
    vertical?: string;
    sub_vertical?: string;
    target_audience?: string;
    unique_value_proposition?: string;
  } | null,
  language: 'hebrew' | 'english' | 'spanish' | 'other'
): string {
  const businessName = profile?.company_name || '';
  const vertical = profile?.vertical || '';
  const targetAudience = profile?.target_audience || '';
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * THE TWO THE PROFILE ALREADY ANSWERED, AND THE PROMPT NEVER ASKED.
   *
   * `unique_value_proposition` and `sub_vertical` were SELECTED from the
   * profile on every generation — the first was even declared in this
   * function's parameter type — and neither reached the model. So the one
   * sentence a business has written about what makes it different was fetched,
   * typed, and dropped, while the page it was meant to shape got its
   * differentiators invented from the service description alone.
   *
   * That is the difference between marketing copy about a service and
   * marketing copy from THIS business about that service.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const uniqueValue = profile?.unique_value_proposition || '';
  const specialism = profile?.sub_vertical || '';

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
${specialism ? `SPECIALISM: ${specialism}` : ''}
${targetAudience ? `TARGET AUDIENCE: ${targetAudience}` : ''}
${uniqueValue ? `WHAT SETS THIS BUSINESS APART (the business's own words — use this rather than inventing a differentiator): ${uniqueValue}` : ''}

═══════════════════════════════════════════════════════════════
STEP 1: UNDERSTAND WHAT IS BEING SOLD
═══════════════════════════════════════════════════════════════

Work it out from the DESCRIPTION, the INDUSTRY and the SPECIALISM above. Say
what it is in the business's own terms rather than sorting it into a category:
a page for a six-week programme should read like a programme, a page for a home
visit like a home visit.

Then adapt EVERYTHING to that: the nouns, the verbs, the questions a buyer
would ask, and what the call to action asks them to do. A reader should not be
able to tell the page was produced from a template.

═══════════════════════════════════════════════════════════════
STEP 2: CONTENT GENERATION INSTRUCTIONS
═══════════════════════════════════════════════════════════════

1. HERO SECTION:
   - Subheadline: Create a compelling 1-2 sentence summary that captures:
     * What the offering IS (course, training, service, etc.)
     * WHO it's for — use TARGET AUDIENCE above where the business has stated
       one, and fall back to the audience implied by the description
     * What TRANSFORMATION or OUTCOME they'll achieve
   - One sentence, two at most. Name the thing, name the reader, name what
     changes for them. No sentence that would still be true of a different
     business in the same industry

2. FEATURES SECTION (extract 4 REAL benefits from the description):
   - Write the section's own title, in the language above, naming what the
     reader gets from THIS offering. "${l.whyChoose}" is a safe fallback when
     nothing better fits
   - Each feature should be a SPECIFIC benefit mentioned or implied in the description
   - Don't use generic benefits - be specific to THIS offering
   - Where WHAT SETS THIS BUSINESS APART is given, let it shape one of the four.
     It is the business's own answer to "why us", and a differentiator you
     invent instead is one they never claimed and may not be able to keep

3. ABOUT SECTION (who the reader would be buying from):
   - A landing page is reached by someone who has never seen this business:
     no familiar logo, no navigation, no second page to check. Two or three
     sentences, between knowing what is on offer and being asked to pay
   - Built ONLY from the business facts above. Where they are missing, return
     an empty string rather than filling the gap — an invented claim about who
     somebody is, is the one kind of copy they cannot stand behind

4. PRICING SECTION:
   - Do NOT write a title for this section. The page sets it.
   - List 4-5 specific inclusions from the description

5. FAQ SECTION (create 4 questions a real customer would ask):
   - The questions follow from what this is. Ask what someone about to buy THIS
     would actually want settled before they commit: how it runs, what is
     needed of them, what they are left with afterwards
   - Every answer comes from the description. Do not answer what it does not say

6. CALL-TO-ACTION SECTIONS:
   - Ask for the step this offering actually takes next, in the language above.
     "${l.readyToStart}" is the fallback when nothing more specific fits

═══════════════════════════════════════════════════════════════
OUTPUT FORMAT (JSON)
═══════════════════════════════════════════════════════════════

{
  "offering_type": "a short lowercase English noun for what this is, e.g. course, programme, treatment, rental, workshop — your own word, not from a list",
  "hero": {
    "headline": "Short, impactful headline (3-6 words) that captures the essence of the offering",
    "subheadline": "Compelling 1-2 sentence summary that explains what this is, who it's for, and the transformation"
  },
  "about": {
    "title": "A heading that introduces the business, in the language above",
    "content": "2-3 sentences on WHO is behind this offering: the business, what it does, and why a stranger should trust it with their money. Written from BUSINESS, INDUSTRY, SPECIALISM and WHAT SETS THIS BUSINESS APART above — never invented. Return an empty string if the information above does not support any of it"
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
        "price": "${data.servicePrice || 0}"
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
          price: data.servicePrice?.toString() || 'Contact us'
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
