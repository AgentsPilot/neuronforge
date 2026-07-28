/**
 * POST /api/business-os/story - Generate business story narrative
 *
 * Uses LLM to generate personalized, confidence-building narrative
 * from business stats. Returns big picture summary and focus items.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { ProviderFactory } from '@/lib/ai/providerFactory';
import { OPENAI_MODELS } from '@/lib/ai/providers/openaiProvider';
import { assessAllCards, BusinessStats } from '@/lib/business-os/insights/StaticHealthRules';
import { z } from 'zod';

const logger = createLogger({ module: 'BusinessOSStoryAPI' });

// Input validation
const StoryRequestSchema = z.object({
  stats: z.object({
    payments: z.object({
      revenue_30d: z.number(),
      pending_invoices: z.number()
    }),
    crm: z.object({
      total_contacts: z.number(),
      new_this_week: z.number(),
      became_clients_this_week: z.number(),
      went_quiet: z.number()
    }),
    scheduling: z.object({
      bookings_30d: z.number(),
      upcoming_count: z.number()
    })
  }),
  language: z.enum(['en', 'es', 'he'])
});

export interface FocusItem {
  title: string;
  subtitle: string;
  priority: number;
  actionType?: 'reach_out' | 'collect' | 'share_link' | 'keep_going';
}

export interface StoryResponse {
  bigPicture: string;
  focusItems: FocusItem[];
  healthStatus: 'thriving' | 'healthy' | 'watch' | 'starting';
  cardHealth: ReturnType<typeof assessAllCards>;
}

// Build the LLM prompt
function buildPrompt(stats: BusinessStats, language: string): string {
  const languageNames: Record<string, string> = {
    en: 'English',
    es: 'Spanish',
    he: 'Hebrew'
  };

  return `You are a warm, supportive business advisor speaking to a non-technical business owner.
Your job is to make them feel confident about their business while being honest.

Given their business stats from the last 30 days, write:
1. A "bigPicture" summary (2-3 sentences) that tells them how their business is doing
2. A list of 2-3 "focusItems" - prioritized things they should focus on this week

RULES:
- Speak like a supportive friend over coffee, not a data analyst
- ALWAYS mention revenue if it's above $0 - this is what makes business owners feel good!
- Validate what's going well BEFORE mentioning any concerns
- NEVER use jargon, KPIs, percentages, or business terminology
- Keep it warm, encouraging, and human
- If there are pending invoices, mention the approximate amount waiting to be collected
- If things are slow, be honest but optimistic ("things are quiet, but that's a chance to...")
- Focus items should be actionable and specific
- Each focus item needs a title (what to do) and subtitle (why/context)

LANGUAGE: Write everything in ${languageNames[language] || 'English'}

STATS:
- Revenue collected this month: $${stats.payments.revenue_30d.toLocaleString()}
- Pending invoices waiting to be paid: ${stats.payments.pending_invoices} (follow up on these!)
- Total people in network: ${stats.crm.total_contacts}
- New contacts this week: ${stats.crm.new_this_week}
- Became paying clients this week: ${stats.crm.became_clients_this_week}
- Contacts went quiet (no activity in 2 weeks): ${stats.crm.went_quiet}
- Sessions/bookings this month: ${stats.scheduling.bookings_30d}
- Upcoming sessions this week: ${stats.scheduling.upcoming_count}

Respond with JSON only (no markdown):
{
  "bigPicture": "Your 2-3 sentence summary here",
  "focusItems": [
    { "title": "What to do", "subtitle": "Why/context", "priority": 1, "actionType": "reach_out" },
    { "title": "What to do", "subtitle": "Why/context", "priority": 2, "actionType": "collect" }
  ]
}

Action types: "reach_out" (contact quiet people), "collect" (get pending payments), "share_link" (promote booking), "keep_going" (continue what works)`;
}

// Fallback response if LLM fails
function getFallbackResponse(stats: BusinessStats, language: string): { bigPicture: string; focusItems: FocusItem[] } {
  const revenueStr = `$${stats.payments.revenue_30d.toLocaleString()}`;

  const fallbacks: Record<string, { bigPicture: string; focusItems: FocusItem[] }> = {
    en: {
      bigPicture: stats.payments.revenue_30d > 0
        ? `You've brought in ${revenueStr} this month with ${stats.scheduling.bookings_30d} sessions. ${stats.crm.new_this_week > 0 ? `${stats.crm.new_this_week} new people joined your network.` : ''} ${stats.crm.went_quiet > 0 ? `Some contacts went quiet - consider reaching out.` : ''}`
        : `Your business is moving along. You have ${stats.crm.total_contacts} contacts and ${stats.scheduling.bookings_30d} bookings this month.${stats.crm.went_quiet > 0 ? ` Some contacts went quiet - consider reaching out.` : ''}`,
      focusItems: [
        ...(stats.crm.went_quiet > 0 ? [{ title: 'Reach out to quiet contacts', subtitle: `${stats.crm.went_quiet} people haven't responded lately`, priority: 1, actionType: 'reach_out' as const }] : []),
        ...(stats.payments.pending_invoices > 0 ? [{ title: 'Follow up on pending payments', subtitle: `${stats.payments.pending_invoices} invoices waiting`, priority: 2, actionType: 'collect' as const }] : []),
        { title: 'Keep doing what works', subtitle: 'Your efforts are paying off', priority: 3, actionType: 'keep_going' as const }
      ]
    },
    es: {
      bigPicture: stats.payments.revenue_30d > 0
        ? `Has generado ${revenueStr} este mes con ${stats.scheduling.bookings_30d} sesiones. ${stats.crm.new_this_week > 0 ? `${stats.crm.new_this_week} personas nuevas se unieron a tu red.` : ''} ${stats.crm.went_quiet > 0 ? `Algunos contactos se callaron - considera contactarlos.` : ''}`
        : `Tu negocio avanza. Tienes ${stats.crm.total_contacts} contactos y ${stats.scheduling.bookings_30d} reservas este mes.${stats.crm.went_quiet > 0 ? ` Algunos contactos se callaron - considera contactarlos.` : ''}`,
      focusItems: [
        ...(stats.crm.went_quiet > 0 ? [{ title: 'Contacta a los que callaron', subtitle: `${stats.crm.went_quiet} personas no respondieron`, priority: 1, actionType: 'reach_out' as const }] : []),
        ...(stats.payments.pending_invoices > 0 ? [{ title: 'Cobra pagos pendientes', subtitle: `${stats.payments.pending_invoices} facturas esperando`, priority: 2, actionType: 'collect' as const }] : []),
        { title: 'Sigue así', subtitle: 'Tus esfuerzos dan frutos', priority: 3, actionType: 'keep_going' as const }
      ]
    },
    he: {
      bigPicture: stats.payments.revenue_30d > 0
        ? `הכנסת ${revenueStr} החודש עם ${stats.scheduling.bookings_30d} פגישות. ${stats.crm.new_this_week > 0 ? `${stats.crm.new_this_week} אנשים חדשים הצטרפו לרשת שלך.` : ''} ${stats.crm.went_quiet > 0 ? `כמה אנשי קשר השתתקו - שווה לפנות אליהם.` : ''}`
        : `העסק שלך מתקדם. יש לך ${stats.crm.total_contacts} אנשי קשר ו-${stats.scheduling.bookings_30d} הזמנות החודש.${stats.crm.went_quiet > 0 ? ` כמה אנשי קשר השתתקו - שווה לפנות אליהם.` : ''}`,
      focusItems: [
        ...(stats.crm.went_quiet > 0 ? [{ title: 'פנה לאנשי קשר שהשתתקו', subtitle: `${stats.crm.went_quiet} אנשים לא הגיבו`, priority: 1, actionType: 'reach_out' as const }] : []),
        ...(stats.payments.pending_invoices > 0 ? [{ title: 'עקוב אחרי תשלומים ממתינים', subtitle: `${stats.payments.pending_invoices} חשבוניות ממתינות`, priority: 2, actionType: 'collect' as const }] : []),
        { title: 'המשך במה שעובד', subtitle: 'המאמצים שלך משתלמים', priority: 3, actionType: 'keep_going' as const }
      ]
    }
  };

  return fallbacks[language] || fallbacks.en;
}

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // 1. Authenticate
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // 2. Validate input
    const body = await request.json();
    const parsed = StoryRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Invalid request', details: parsed.error.errors },
        { status: 400 }
      );
    }

    const { stats, language } = parsed.data;

    requestLogger.info({ userId: user.id, language }, 'Generating business story');

    // 3. Get static health assessments (fast, no LLM)
    const cardHealth = assessAllCards(stats);

    // 4. Generate LLM narrative
    let bigPicture: string;
    let focusItems: FocusItem[];

    try {
      const provider = ProviderFactory.getProvider('openai');
      const prompt = buildPrompt(stats, language);

      const response = await provider.complete({
        model: OPENAI_MODELS.GPT_4O_MINI, // Cost-effective for this task
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 500
      });

      // Parse LLM response
      const content = response.content;
      const jsonMatch = content.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        bigPicture = parsed.bigPicture || '';
        focusItems = (parsed.focusItems || []).map((item: any, index: number) => ({
          title: item.title || '',
          subtitle: item.subtitle || '',
          priority: item.priority || index + 1,
          actionType: item.actionType
        }));
      } else {
        throw new Error('Invalid LLM response format');
      }

      requestLogger.info({ userId: user.id }, 'LLM story generated successfully');

    } catch (llmError) {
      requestLogger.warn({ err: llmError, userId: user.id }, 'LLM failed, using fallback');

      // Use fallback response
      const fallback = getFallbackResponse(stats, language);
      bigPicture = fallback.bigPicture;
      focusItems = fallback.focusItems;
    }

    // 5. Build response
    const storyResponse: StoryResponse = {
      bigPicture,
      focusItems,
      healthStatus: cardHealth.overall,
      cardHealth
    };

    return NextResponse.json({
      success: true,
      story: storyResponse
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to generate business story');
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
      },
      { status: 500 }
    );
  }
}
