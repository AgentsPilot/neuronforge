/**
 * Test script for landing page AI content generation
 *
 * Run with: npx ts-node scripts/test-landing-page-generation.ts
 */

import { ProviderFactory } from '../lib/ai/providerFactory';

// Hebrew ADHD course description
const TEST_DESCRIPTION = `כמדריכי הורים ומטפלים המלווים הורים ומשפחות, אנו פוגשים מידי יום אנשים עם הפרעת קשב וריכוז, חלקם מאובחנים וחלקם לא. לא אחת אנשי טיפול ומדריכי הורים מרגישים שהמטרות שהציבו לא מתקדמות ולא מיושמות, שהכלים שיש להם אינם מתאימים להורים ולילדים שעימם הם עובדים. במחקרים מדווח על עלייה של 30% באנשים המאובחנים עם הפרעת קשב וריכוז (ויש עוד רבים נוספים שלא מאובחנים ואף לא יודעים שהם אנשי קשב). מטרת קורס זה לספק ידע רחב בתחום הפרעת הקשב והוויסות החושי שיאפשר לאנשי חינוך, טיפול ומדריכי הורים לזהות אנשי קשב, להמליץ להם ו/או לילדיהם לגשת לאבחון ולספק כלים פרקטיים במטרה לייצר הצלחה בתהליך הטיפול. מדריכי הורים יעברו הכשרה מעשית בעבודה עם הורים לילדים עם הפרעות קשב וריכוז וויסות חושי. הפרעת קשב וויסות – הינה הפרעה נוירולוגית, בעלת רקע גנטי הנוכחת בחיי הילד מינקות, ומלווה אותו בכל תחומי החיים כל יום (מבקר עד לילה). להיות הורה הינה משימת חיים ארוכה ומורכבת לכל מי שבחר בכך. להיות הורה לילד עם הפרעת קשב וויסות הינה משימה שמשולבים בה כאב, ובעיקר תהליך של עבודת אבל, בושה, מאמץ מתמשך ושחיקה נפשית. המפגש עם גורמי חינוך וטיפול להורי הילדים בעלי הלקויות כמעט תמיד טעון ומלווה ב"מחול החרבות". הבנת ההורות הייחודית הזו, הכרות עם תהליכים אשר עוברים ההורים מרגע קבלת הידיעה על לקויות ילדם, הדרך הארוכה לקבלתה והתארגנות הורית מותאמת, יכולה לשפר ולסייע הן בקשר עם ההורים והן ביצירת שיתופי פעולה טיפוליים.`;

const TEST_SERVICE_NAME = 'קורס ADHD למדריכי הורים';
const TEST_PRICE = 1500;
const TEST_DURATION = 960; // 16 hours

/**
 * Detect the primary language of the text
 */
function detectLanguage(text: string): 'hebrew' | 'english' | 'spanish' | 'other' {
  if (!text) return 'english';

  const hebrewChars = text.match(/[\u0590-\u05FF]/g) || [];
  const spanishChars = text.match(/[áéíóúüñ¿¡]/gi) || [];
  const latinChars = text.match(/[a-zA-Z]/g) || [];

  const hebrewRatio = hebrewChars.length / text.length;
  const spanishRatio = spanishChars.length / text.length;

  if (hebrewRatio > 0.1) return 'hebrew';
  if (spanishRatio > 0.02 && latinChars.length > hebrewChars.length) return 'spanish';
  if (latinChars.length > 0) return 'english';

  return 'other';
}

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
  serviceName: string,
  description: string,
  price: number,
  duration: number,
  language: 'hebrew' | 'english' | 'spanish' | 'other'
): string {
  const hours = Math.floor(duration / 60);
  const durationText = `${hours} hours`;

  const labels = {
    hebrew: {
      investment: 'ההשקעה',
      readyToStart: 'מוכנים להתחיל?',
      haveQuestions: 'יש לכם שאלות?',
      whyChoose: 'למה לבחור בקורס הזה',
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

  return `TASK: Analyze the following service description and generate a complete landing page content structure.

═══════════════════════════════════════════════════════════════
SERVICE INFORMATION
═══════════════════════════════════════════════════════════════

SERVICE NAME: ${serviceName}

FULL DESCRIPTION (analyze this carefully - extract all benefits, features, target audience, and unique aspects):
"""
${description}
"""

PRICING: ${price}
DURATION: ${durationText}

═══════════════════════════════════════════════════════════════
CONTENT GENERATION INSTRUCTIONS
═══════════════════════════════════════════════════════════════

1. HERO SECTION:
   - Analyze the description to find the MAIN transformation or benefit
   - Headline: Powerful, concise (max 8 words) - capture the core value
   - Subheadline: Expand on the benefit, speak to the target audience's desires (1-2 sentences)

2. FEATURES SECTION (extract 4 REAL benefits from the description):
   - Each feature should be a SPECIFIC benefit mentioned or implied in the description
   - Don't use generic benefits like "Expert Guidance" - be specific to THIS service
   - Icons to choose from: Star, Shield, Clock, Users, Target, Heart, Brain, Zap, Award, CheckCircle, Lightbulb, Compass, TrendingUp, Sparkles

3. PRICING SECTION:
   - Highlight what's included based on the description
   - List 4-5 specific inclusions from the description

4. FAQ SECTION (create 4 questions a real customer would ask):
   - Questions should be SPECIFIC to this service based on the description
   - If it's a course: questions about format, prerequisites, what they'll learn
   - If it's coaching: questions about the process, expected outcomes
   - If it's a treatment: questions about the experience, results, preparation
   - Answers should be helpful and based on information in the description

5. CALL-TO-ACTION SECTIONS:
   - Use language appropriate to the service type

═══════════════════════════════════════════════════════════════
OUTPUT FORMAT (JSON)
═══════════════════════════════════════════════════════════════

{
  "hero": {
    "headline": "Compelling headline based on core benefit",
    "subheadline": "Expanded benefit statement (1-2 sentences)"
  },
  "features": {
    "title": "${l.whyChoose}",
    "features": [
      { "title": "Specific Benefit 1", "description": "Detailed explanation from description", "icon": "Brain" },
      { "title": "Specific Benefit 2", "description": "Detailed explanation from description", "icon": "Target" },
      { "title": "Specific Benefit 3", "description": "Detailed explanation from description", "icon": "Heart" },
      { "title": "Specific Benefit 4", "description": "Detailed explanation from description", "icon": "Sparkles" }
    ]
  },
  "pricing": {
    "title": "${l.investment}",
    "plans": [
      {
        "name": "${serviceName}",
        "price": "${price}",
        "description": "Brief value statement",
        "features": ["Specific inclusion 1", "Specific inclusion 2", "Specific inclusion 3", "Specific inclusion 4"]
      }
    ]
  },
  "faq": {
    "title": "${l.commonQuestions}",
    "items": [
      { "question": "Specific question about this service?", "answer": "Helpful answer based on description" },
      { "question": "Another relevant question?", "answer": "Helpful answer based on description" },
      { "question": "Question about process/format?", "answer": "Helpful answer based on description" },
      { "question": "Question about outcomes/results?", "answer": "Helpful answer based on description" }
    ]
  },
  "booking_widget": {
    "title": "${l.readyToStart}"
  },
  "contact_form": {
    "title": "${l.haveQuestions}"
  }
}

CRITICAL REMINDERS:
- ALL text must be in ${language === 'hebrew' ? 'Hebrew (עברית)' : language === 'spanish' ? 'Spanish (Español)' : 'English'}
- Extract REAL information from the description - do not invent generic content
- If the description is detailed, use that detail in your output
- FAQ questions must be ones a real potential customer would ask about THIS specific service`;
}

async function testGeneration() {
  console.log('='.repeat(60));
  console.log('Testing Landing Page AI Content Generation');
  console.log('='.repeat(60));

  // Detect language
  const language = detectLanguage(TEST_DESCRIPTION);
  console.log(`\nDetected language: ${language}`);
  console.log(`Description length: ${TEST_DESCRIPTION.length} characters`);

  // Build prompts
  const systemPrompt = buildSystemPrompt(language);
  const userPrompt = buildGenerationPrompt(
    TEST_SERVICE_NAME,
    TEST_DESCRIPTION,
    TEST_PRICE,
    TEST_DURATION,
    language
  );

  console.log('\n--- System Prompt ---');
  console.log(systemPrompt.substring(0, 500) + '...');

  console.log('\n--- User Prompt (first 1000 chars) ---');
  console.log(userPrompt.substring(0, 1000) + '...');

  console.log('\n--- Calling OpenAI API ---');

  try {
    const provider = ProviderFactory.getProvider('openai');

    const startTime = Date.now();
    const response = await provider.complete({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.7,
      response_format: { type: 'json_object' }
    });
    const endTime = Date.now();

    console.log(`API call took: ${endTime - startTime}ms`);

    const responseText = response.choices[0]?.message?.content || '{}';
    console.log(`\nResponse length: ${responseText.length} characters`);

    const generatedContent = JSON.parse(responseText);

    console.log('\n' + '='.repeat(60));
    console.log('GENERATED CONTENT');
    console.log('='.repeat(60));
    console.log(JSON.stringify(generatedContent, null, 2));

    // Validate structure
    console.log('\n--- Validation ---');
    console.log('Has hero:', !!generatedContent.hero);
    console.log('Has features:', !!generatedContent.features);
    console.log('Has pricing:', !!generatedContent.pricing);
    console.log('Has faq:', !!generatedContent.faq);

    if (generatedContent.hero) {
      console.log('\nHero headline:', generatedContent.hero.headline);
      console.log('Hero subheadline:', generatedContent.hero.subheadline);
    }

    if (generatedContent.features?.features) {
      console.log('\nFeatures:');
      generatedContent.features.features.forEach((f: { title: string }, i: number) => {
        console.log(`  ${i + 1}. ${f.title}`);
      });
    }

    if (generatedContent.faq?.items) {
      console.log('\nFAQ Questions:');
      generatedContent.faq.items.forEach((f: { question: string }, i: number) => {
        console.log(`  ${i + 1}. ${f.question}`);
      });
    }

  } catch (error) {
    console.error('\nERROR:', error);
  }
}

// Run the test
testGeneration();
