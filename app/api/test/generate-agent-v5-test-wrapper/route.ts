/**
 * V5 Workflow Generator Test API Wrapper
 *
 * Simplified test endpoint for V5WorkflowGenerator.
 * Used by plugins-test-v2 page for testing the LLM review flow.
 *
 * This is a TEST API - no authentication required.
 * Accepts userId directly in the request body.
 */

import { NextRequest, NextResponse } from 'next/server';
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';
import {
  V5WorkflowGenerator,
  WorkflowGenerationInput,
  V5GenerationResult,
  TechnicalWorkflowInput,
} from '@/lib/agentkit/v4/v5-generator';
import { ProviderName } from '@/lib/ai/providerFactory';
import { createLogger } from '@/lib/logger';

export const runtime = 'nodejs';

const logger = createLogger({ module: 'API', route: '/api/test/generate-agent-v5-test-wrapper' });

/**
 * Request body for V5 test wrapper
 */
interface V5TestWrapperRequest {
  /** Enhanced prompt string (stringified JSON) - for Stage 1 LLM extraction path */
  enhancedPrompt?: string;
  /** Pre-built technical workflow - for LLM review path (string or object, only technical_workflow array needed) */
  technicalWorkflow?: string | Partial<TechnicalWorkflowInput>;
  /** User ID to load connected plugins */
  userId: string;
  /** AI provider (e.g., "anthropic", "openai") */
  provider: ProviderName;
  /** Model name (e.g., "claude-sonnet-4-20250514") */
  model: string;
  /** Skip DSL building and return only reviewed workflow (for testing LLM review in isolation) */
  skipDslBuilder?: boolean;
  /** OpenAI thread ID from System 1 (optional, for session tracking correlation) */
  openaiThreadId?: string;
}

/**
 * Parsed structure of enhancedPrompt JSON
 */
interface ParsedEnhancedPrompt {
  sections?: {
    data?: string[];
    output?: string[];
    actions?: string[];
    delivery?: string[];
    processing_steps?: string[];
  };
  specifics?: {
    services_involved?: string[];
    resolved_user_inputs?: Array<{ key: string; value: string }>;
    user_inputs_required?: Array<{ key: string; description: string }>;
  };
  plan_title?: string;
  plan_description?: string;
}

export async function POST(req: NextRequest) {
  const startTime = Date.now();

  try {
    const body: V5TestWrapperRequest = await req.json();

    const {
      enhancedPrompt,
      technicalWorkflow,
      userId,
      provider,
      model,
      skipDslBuilder,
      openaiThreadId,
    } = body;

    // Collect missing required fields
    const missingFields: string[] = [];
    if (!userId) missingFields.push('userId');
    if (!provider) missingFields.push('provider');
    if (!model) missingFields.push('model');

    if (missingFields.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: `Request body is missing required values: ${missingFields.join(', ')}`,
          missingFields,
        },
        { status: 400 }
      );
    }

    // Parse enhancedPrompt if provided
    let parsedEnhancedPrompt: ParsedEnhancedPrompt | null = null;
    if (enhancedPrompt) {
      try {
        parsedEnhancedPrompt = JSON.parse(enhancedPrompt) as ParsedEnhancedPrompt;
      } catch (parseError) {
        return NextResponse.json(
          {
            success: false,
            error: 'enhancedPrompt must be a valid JSON string',
            details: parseError instanceof Error ? parseError.message : 'JSON parse error',
          },
          { status: 400 }
        );
      }
    }

    // Parse technicalWorkflow if provided as a string (supports both string and object)
    let parsedTechnicalWorkflow: Partial<TechnicalWorkflowInput> | undefined = undefined;
    if (technicalWorkflow) {
      if (typeof technicalWorkflow === 'string') {
        try {
          parsedTechnicalWorkflow = JSON.parse(technicalWorkflow) as Partial<TechnicalWorkflowInput>;
        } catch (parseError) {
          return NextResponse.json(
            {
              success: false,
              error: 'technicalWorkflow must be a valid JSON string or object',
              details: parseError instanceof Error ? parseError.message : 'JSON parse error',
            },
            { status: 400 }
          );
        }
      } else {
        parsedTechnicalWorkflow = technicalWorkflow;
      }
    }

    // Must have either enhancedPrompt or technicalWorkflow with steps
    const hasTechnicalWorkflowSteps = (parsedTechnicalWorkflow?.technical_workflow?.length ?? 0) > 0;
    if (!parsedEnhancedPrompt && !hasTechnicalWorkflowSteps) {
      return NextResponse.json(
        {
          success: false,
          error: 'Either enhancedPrompt (stringified JSON) or technicalWorkflow.technical_workflow (with steps) is required',
        },
        { status: 400 }
      );
    }

    // Auto-extract required_services from enhancedPrompt.specifics.services_involved
    let required_services: string[] = [];
    if (parsedEnhancedPrompt?.specifics?.services_involved) {
      required_services = parsedEnhancedPrompt.specifics.services_involved;
    }

    // Validate we have required_services
    if (required_services.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Request body is missing required values: required_services (extracted from enhancedPrompt.specifics.services_involved)',
          missingFields: ['specifics.services_involved'],
        },
        { status: 400 }
      );
    }

    // Build the full technicalWorkflow by merging parsed enhancedPrompt data
    let fullTechnicalWorkflow: TechnicalWorkflowInput | undefined;

    if (parsedEnhancedPrompt) {
      // Validate required fields in parsedEnhancedPrompt
      const missingEnhancedFields: string[] = [];
      if (!parsedEnhancedPrompt.plan_title) missingEnhancedFields.push('plan_title');
      if (!parsedEnhancedPrompt.plan_description) missingEnhancedFields.push('plan_description');
      if (!parsedEnhancedPrompt.specifics?.resolved_user_inputs) missingEnhancedFields.push('specifics.resolved_user_inputs');

      if (missingEnhancedFields.length > 0) {
        return NextResponse.json(
          {
            success: false,
            error: `enhancedPrompt JSON is missing required values: ${missingEnhancedFields.join(', ')}`,
            missingFields: missingEnhancedFields,
          },
          { status: 400 }
        );
      }

      // Build technicalWorkflow from parsed enhancedPrompt
      fullTechnicalWorkflow = {
        technical_workflow: parsedTechnicalWorkflow?.technical_workflow || [],
        enhanced_prompt: {
          plan_title: parsedEnhancedPrompt.plan_title!,
          plan_description: parsedEnhancedPrompt.plan_description!,
          specifics: {
            resolved_user_inputs: parsedEnhancedPrompt.specifics!.resolved_user_inputs!,
          },
        },
        analysis: {
          agent_name: parsedEnhancedPrompt.plan_title || 'Generated Workflow',
          description: parsedEnhancedPrompt.plan_description || '',
        },
      };
    } else if (hasTechnicalWorkflowSteps) {
      // Use provided technicalWorkflow (must have all required fields)
      fullTechnicalWorkflow = parsedTechnicalWorkflow as TechnicalWorkflowInput;
    }

    logger.info({
      userId,
      provider,
      model,
      hasEnhancedPrompt: !!parsedEnhancedPrompt,
      hasTechnicalWorkflowSteps,
      technicalWorkflowStepsCount: fullTechnicalWorkflow?.technical_workflow?.length || 0,
      requiredServicesCount: required_services.length,
      requiredServices: required_services,
      openaiThreadId: openaiThreadId || null,
    }, 'V5 test wrapper called');

    // Get plugin manager instance
    const pluginManager = await PluginManagerV2.getInstance();

    // Load user's connected plugins
    const userPlugins = await pluginManager.getAllActivePluginKeys(userId);

    logger.debug({
      userId,
      userPluginsCount: userPlugins.length,
      userPlugins,
    }, 'Loaded user connected plugins');

    // Load plugin contexts for connected plugins
    const pluginDefContexts = pluginManager.getPluginsDefinitionContext(userPlugins);

    // Convert to IPluginContext format using toShortLLMContext
    const connectedPluginContexts = pluginDefContexts.map(ctx => ctx.toShortLLMContext());

    logger.debug({
      connectedPluginsCount: connectedPluginContexts.length,
      plugins: connectedPluginContexts.map(p => p.key),
    }, 'Plugin contexts loaded');

    // Create V5 generator with user's connected plugins and session tracking
    const generator = new V5WorkflowGenerator(pluginManager, {
      connectedPlugins: connectedPluginContexts,
      userId,
      sessionTracking: {
        enabled: true,
        userId,
        openaiThreadId,
      },
    });

    // Build generation input
    const generationInput: WorkflowGenerationInput = {
      enhancedPrompt,
      technicalWorkflow: fullTechnicalWorkflow,
      provider,
      model,
      required_services,
      skipDslBuilder,
    };

    logger.info({
      provider,
      model,
      hasEnhancedPrompt: !!parsedEnhancedPrompt,
      hasTechnicalWorkflowSteps,
      requiredServices: required_services,
      skipDslBuilder,
    }, 'Starting V5 workflow generation');

    // Generate workflow
    const result: V5GenerationResult = await generator.generateWorkflow(generationInput);

    const endTime = Date.now();
    const latencyMs = endTime - startTime;

    if (!result.success) {
      logger.error({
        errors: result.errors,
        warnings: result.warnings,
        latencyMs,
      }, 'V5 generation failed');

      return NextResponse.json(
        {
          ...result,
          latency_ms: latencyMs,
        },
        { status: 400 }
      );
    }

    logger.info({
      metadata: result.metadata,
      warningsCount: result.warnings?.length || 0,
      latencyMs,
      workflowGenerationSessionId: result.sessionId,
    }, 'V5 generation succeeded');

    // Return raw V5GenerationResult with latency and session tracking info
    return NextResponse.json({
      ...result,
      latency_ms: latencyMs,
      workflowGenerationSessionId: result.sessionId,
    });

  } catch (error: any) {
    const endTime = Date.now();
    const latencyMs = endTime - startTime;

    logger.error({ err: error, latencyMs }, 'Unexpected error in V5 test wrapper');

    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Internal server error',
        latency_ms: latencyMs,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}