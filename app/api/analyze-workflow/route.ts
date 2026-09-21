/**
 * POST /api/analyze-workflow — ask gpt-4o to break a workflow description into steps.
 *
 * ── Why this route is gated ───────────────────────────────────────────────
 * Until 2026-09-21 it was unauthenticated and took its identity from
 * `body.userId || x-user-id || 'anonymous'`. That was originally recorded as a Low
 * finding (F16, "spoofable attribution, not a disclosure") — but the route also takes
 * **`systemPrompt` AND `userMessage` from the request body** and passes both straight to
 * `gpt-4o` with `max_tokens: 2000` on the platform's own `OPENAI_API_KEY`.
 *
 * That makes it an open, fully-controllable LLM proxy: arbitrary system prompt, arbitrary
 * content, our key, our bill, our egress — not merely mis-attributed analytics. The
 * binding precedent is the plugin-suggestion endpoint deleted in PR #73 for exactly this
 * shape; see app/api/plugins/__tests__/dead-plugin-routes-removed.guard.test.ts, which
 * names it. (Its route path is deliberately not repeated here — that guard fails on any
 * source file mentioning it, which is how this very comment was caught.) This route is
 * gated rather than deleted because it has a live caller:
 * `components/wizard/workflowAnalysis.ts:81`, which runs on a signed-in page.
 *
 * Identity — both the gate and the analytics attribution — is now `getUser()` only.
 * Neither `body.userId` nor `x-user-id` is read.
 *
 * Middleware does not authenticate `/api/*` (middleware.ts:83).
 *
 * Follow-up, deliberately NOT done here (SA ruling: not in a security branch): this route
 * constructs `new OpenAIProvider(...)` with a hardcoded `'gpt-4o'` instead of going
 * through `getProviderFactory()`, which violates CLAUDE.md § AI Provider Factory and
 * Mandatory Rule 5.
 *
 * See docs/workplans/IDENTITY_SWEEP_WORKPLAN.md § Slice 0.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { AIAnalyticsService } from '@/lib/analytics/aiAnalytics';
import { OpenAIProvider } from '@/lib/ai/providers/openaiProvider';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { v4 as uuidv4 } from 'uuid';

interface AnalyzeWorkflowRequest {
  systemPrompt: string;
  userMessage: string;
  sessionId?: string;
}

const logger = createLogger({ module: 'API', route: '/api/analyze-workflow' });

// Initialize Supabase service client for analytics
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Initialize AI Analytics
const aiAnalytics = new AIAnalyticsService(supabase, {
  enableRealtime: true,
  enableCostTracking: true,
  enablePerformanceMetrics: true
});

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // Gate before the body is read, so an anonymous caller cannot reach the model at all.
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Attribution is the session user. A body `userId` / `x-user-id` is never consulted.
    const userIdToUse = user.id;

    const body: AnalyzeWorkflowRequest = await request.json();
    const { systemPrompt, userMessage, sessionId: providedSessionId } = body;

    if (!systemPrompt || !userMessage) {
      return NextResponse.json(
        { error: 'Missing required fields: systemPrompt and userMessage' },
        { status: 400 }
      );
    }

    // Session id is a correlation label only — it grants nothing, so a caller-supplied
    // value is fine.
    const sessionId = providedSessionId || request.headers.get('x-session-id') || uuidv4();

    if (!process.env.OPENAI_API_KEY) {
      requestLogger.error({ userId: userIdToUse }, 'OPENAI_API_KEY is not configured');
      return NextResponse.json(
        { error: 'OpenAI API key not configured in environment variables' },
        { status: 500 }
      );
    }

    // Lengths, never the text: `systemPrompt` and `userMessage` are user content and
    // must not reach the log stream.
    requestLogger.info(
      {
        userId: userIdToUse,
        sessionId,
        userMessageLength: userMessage.length,
        systemPromptLength: systemPrompt.length
      },
      'Workflow analysis requested'
    );

    // Initialize OpenAI provider with analytics
    const openaiProvider = new OpenAIProvider(process.env.OPENAI_API_KEY!, aiAnalytics);

    requestLogger.debug({ model: 'gpt-4o' }, 'Making tracked AI call for workflow analysis');

    // Call OpenAI with automatic analytics tracking via BaseProvider
    const response = await openaiProvider.chatCompletion(
      {
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        temperature: 0.1,
        max_tokens: 2000
      },
      {
        userId: userIdToUse,
        sessionId: sessionId,
        feature: 'workflow_analysis',
        component: 'analyze-workflow',
        workflow_step: 'ai_analysis',
        category: 'workflow_processing',
        activity_type: 'workflow_analysis',
        activity_name: 'Analyzing workflow structure and steps',
        activity_step: 'analysis'
      }
    );

    const content = response.choices[0]?.message?.content;

    if (!content) {
      requestLogger.error({ userId: userIdToUse }, 'No response content from OpenAI');
      return NextResponse.json(
        { error: 'No response content from OpenAI' },
        { status: 500 }
      );
    }

    // Extract usage data from OpenAI response
    const inputTokens = response.usage?.prompt_tokens || 0;
    const outputTokens = response.usage?.completion_tokens || 0;
    const totalTokens = response.usage?.total_tokens || 0;

    // Info, not debug: this is the cost signal.
    requestLogger.info(
      { userId: userIdToUse, inputTokens, outputTokens, totalTokens },
      'Workflow analysis token usage'
    );

    // Extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      // The model's reply is derived from user-supplied prompts — log its size, never
      // its text.
      requestLogger.error(
        { userId: userIdToUse, contentLength: content.length },
        'No JSON object found in the model response'
      );
      return NextResponse.json(
        { error: 'OpenAI did not return valid JSON format' },
        { status: 500 }
      );
    }

    let analysis;
    try {
      analysis = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      requestLogger.error(
        { err: parseError, userId: userIdToUse },
        'Failed to parse the JSON block out of the model response'
      );
      return NextResponse.json(
        { error: 'Failed to parse OpenAI JSON response' },
        { status: 500 }
      );
    }

    // Validate the analysis structure
    if (!analysis.workflowSteps || !Array.isArray(analysis.workflowSteps)) {
      // Keys only. The values are model output about the user's workflow.
      requestLogger.error(
        { userId: userIdToUse, receivedKeys: Object.keys(analysis ?? {}) },
        'Model response is missing the workflowSteps array'
      );
      return NextResponse.json(
        { error: 'Invalid analysis format: missing workflowSteps array' },
        { status: 500 }
      );
    }

    // Note: Token tracking happens automatically via openaiProvider.chatCompletion()
    // No manual tracking needed - AIAnalyticsService handles it via BaseProvider

    requestLogger.info(
      { userId: userIdToUse, stepCount: analysis.workflowSteps.length },
      'Workflow analysis completed'
    );

    return NextResponse.json({
      analysis,
      usage: {
        provider: 'openai',
        model: 'gpt-4o',
        inputTokens: inputTokens,
        outputTokens: outputTokens,
        totalTokens: totalTokens
      },
      sessionId: sessionId // Return session ID for tracking
    });

  } catch (error: any) {
    requestLogger.error({ err: error }, 'Workflow analysis request failed');
    return NextResponse.json(
      {
        error: 'Failed to analyze workflow',
        // Dev-guarded: an upstream provider message can carry request detail.
        details: process.env.NODE_ENV === 'development' ? error?.message : undefined
      },
      { status: 500 }
    );
  }
}
