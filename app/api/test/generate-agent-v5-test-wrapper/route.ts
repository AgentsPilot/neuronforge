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
  ReviewedTechnicalWorkflowInput,
} from '@/lib/agentkit/v4/v5-generator';
import { ProviderName } from '@/lib/ai/providerFactory';
import { createLogger } from '@/lib/logger';
import { compileDsl, getErrorSummary } from '@/lib/pilot/dsl-compiler';
import type { CompilationResult } from '@/lib/pilot/dsl-compiler';
import { initializeSchemaRegistry } from '@/lib/pilot/schema-registry';

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
  /**
   * Pre-reviewed technical workflow - skips LLM reviewer entirely.
   * Use for deterministic testing by injecting reviewer output directly.
   * When provided, technicalWorkflow is ignored and LLM reviewer is bypassed.
   * Must include technical_workflow, enhanced_prompt, reviewer_summary, and feasibility fields.
   */
  reviewedTechnicalWorkflow?: string | ReviewedTechnicalWorkflowInput;
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
      reviewedTechnicalWorkflow,
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

    // Parse reviewedTechnicalWorkflow if provided (for deterministic testing - skips LLM reviewer)
    let parsedReviewedWorkflow: ReviewedTechnicalWorkflowInput | undefined = undefined;
    if (reviewedTechnicalWorkflow) {
      if (typeof reviewedTechnicalWorkflow === 'string') {
        try {
          parsedReviewedWorkflow = JSON.parse(reviewedTechnicalWorkflow) as ReviewedTechnicalWorkflowInput;
        } catch (parseError) {
          return NextResponse.json(
            {
              success: false,
              error: 'reviewedTechnicalWorkflow must be a valid JSON string or object',
              details: parseError instanceof Error ? parseError.message : 'JSON parse error',
            },
            { status: 400 }
          );
        }
      } else {
        parsedReviewedWorkflow = reviewedTechnicalWorkflow;
      }

      // Validate reviewed workflow has required fields
      if (!parsedReviewedWorkflow.technical_workflow?.length) {
        return NextResponse.json(
          {
            success: false,
            error: 'reviewedTechnicalWorkflow must include technical_workflow array with steps',
          },
          { status: 400 }
        );
      }
    }

    // Check if we have a reviewed workflow (takes priority over technicalWorkflow)
    const hasReviewedWorkflowSteps = (parsedReviewedWorkflow?.technical_workflow?.length ?? 0) > 0;

    // Must have either enhancedPrompt, technicalWorkflow with steps, or reviewedTechnicalWorkflow
    const hasTechnicalWorkflowSteps = (parsedTechnicalWorkflow?.technical_workflow?.length ?? 0) > 0;
    if (!parsedEnhancedPrompt && !hasTechnicalWorkflowSteps && !hasReviewedWorkflowSteps) {
      return NextResponse.json(
        {
          success: false,
          error: 'Either enhancedPrompt (stringified JSON), technicalWorkflow.technical_workflow (with steps), or reviewedTechnicalWorkflow is required',
        },
        { status: 400 }
      );
    }

    // Auto-extract required_services from multiple sources (in priority order)
    // 1. reviewedTechnicalWorkflow.requiredServices (highest priority - injected workflow)
    // 2. reviewedTechnicalWorkflow.enhanced_prompt.specifics.services_involved
    // 3. enhancedPrompt.specifics.services_involved
    // 4. parsedTechnicalWorkflow.requiredServices (from Phase 4 response)
    // 5. parsedTechnicalWorkflow.enhanced_prompt.specifics.services_involved
    let required_services: string[] = [];
    if ((parsedReviewedWorkflow as any)?.requiredServices?.length > 0) {
      required_services = (parsedReviewedWorkflow as any).requiredServices;
    } else if ((parsedReviewedWorkflow as any)?.enhanced_prompt?.specifics?.services_involved?.length > 0) {
      required_services = (parsedReviewedWorkflow as any).enhanced_prompt.specifics.services_involved;
    } else if (parsedEnhancedPrompt?.specifics?.services_involved) {
      required_services = parsedEnhancedPrompt.specifics.services_involved;
    } else if ((parsedTechnicalWorkflow as any)?.requiredServices?.length > 0) {
      required_services = (parsedTechnicalWorkflow as any).requiredServices;
    } else if ((parsedTechnicalWorkflow as any)?.enhanced_prompt?.specifics?.services_involved?.length > 0) {
      required_services = (parsedTechnicalWorkflow as any).enhanced_prompt.specifics.services_involved;
    }

    // Validate we have required_services
    if (required_services.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Request body is missing required values: required_services. Provide via enhancedPrompt.specifics.services_involved or technicalWorkflow.requiredServices',
          missingFields: ['services_involved or requiredServices'],
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
      // IMPORTANT: Include requiredServices and technical_inputs_required for DSL Builder
      fullTechnicalWorkflow = {
        technical_workflow: parsedTechnicalWorkflow?.technical_workflow || [],
        enhanced_prompt: {
          plan_title: parsedEnhancedPrompt.plan_title!,
          plan_description: parsedEnhancedPrompt.plan_description!,
          specifics: {
            resolved_user_inputs: parsedEnhancedPrompt.specifics!.resolved_user_inputs!,
            services_involved: required_services, // Pass services_involved for suggested_plugins
          },
        },
        analysis: {
          agent_name: parsedEnhancedPrompt.plan_title || 'Generated Workflow',
          description: parsedEnhancedPrompt.plan_description || '',
        },
        // Pass requiredServices for fallback suggested_plugins
        requiredServices: required_services,
        // Pass technical_inputs_required from parsed technicalWorkflow (Phase 4 output)
        technical_inputs_required: (parsedTechnicalWorkflow as any)?.technical_inputs_required || [],
      };
    } else if (hasTechnicalWorkflowSteps) {
      // Use provided technicalWorkflow (must have all required fields)
      // Ensure requiredServices is set from required_services if not already present
      fullTechnicalWorkflow = {
        ...parsedTechnicalWorkflow as TechnicalWorkflowInput,
        requiredServices: (parsedTechnicalWorkflow as any)?.requiredServices || required_services,
      };
    }

    logger.info({
      userId,
      provider,
      model,
      hasEnhancedPrompt: !!parsedEnhancedPrompt,
      hasTechnicalWorkflowSteps,
      hasReviewedWorkflowSteps,
      technicalWorkflowStepsCount: fullTechnicalWorkflow?.technical_workflow?.length || 0,
      reviewedWorkflowStepsCount: parsedReviewedWorkflow?.technical_workflow?.length || 0,
      requiredServicesCount: required_services.length,
      requiredServices: required_services,
      technicalInputsRequiredCount: fullTechnicalWorkflow?.technical_inputs_required?.length || 0,
      hasEnhancedPromptInWorkflow: !!fullTechnicalWorkflow?.enhanced_prompt,
      openaiThreadId: openaiThreadId || null,
    }, 'V5 test wrapper called');

    // Debug log the full structure being passed
    logger.debug({
      fullTechnicalWorkflow: {
        hasEnhancedPrompt: !!fullTechnicalWorkflow?.enhanced_prompt,
        planTitle: fullTechnicalWorkflow?.enhanced_prompt?.plan_title,
        servicesInvolved: fullTechnicalWorkflow?.enhanced_prompt?.specifics?.services_involved,
        requiredServices: fullTechnicalWorkflow?.requiredServices,
        technicalInputsRequired: fullTechnicalWorkflow?.technical_inputs_required?.map(i => (i as any).key || i),
        stepsCount: fullTechnicalWorkflow?.technical_workflow?.length,
      },
    }, 'Full technicalWorkflow structure being passed to V5 generator');

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
      reviewedTechnicalWorkflow: parsedReviewedWorkflow, // Skip LLM reviewer if provided
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
      hasReviewedWorkflowSteps,
      requiredServices: required_services,
      skipDslBuilder,
      reviewerWillBeSkipped: hasReviewedWorkflowSteps,
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

    // Run DSL compiler validation on generated workflow (if workflow exists)
    let dslCompilation: {
      valid: boolean;
      errors: CompilationResult['errors'];
      warnings: CompilationResult['warnings'];
      errorSummary?: string;
    } | undefined;

    if (result.workflow?.workflow_steps?.length > 0) {
      // Initialize schema registry for field validation (required by DSL compiler)
      await initializeSchemaRegistry();

      const compilationResult = compileDsl({ steps: result.workflow.workflow_steps });

      dslCompilation = {
        valid: compilationResult.valid,
        errors: compilationResult.errors,
        warnings: compilationResult.warnings,
        errorSummary: !compilationResult.valid ? getErrorSummary(compilationResult) : undefined,
      };

      if (compilationResult.valid) {
        logger.info({
          valid: true,
          warningsCount: compilationResult.warnings.length,
        }, 'DSL compilation passed');
      } else {
        logger.error({
          valid: false,
          errorsCount: compilationResult.errors.length,
          warningsCount: compilationResult.warnings.length,
          errorSummary: dslCompilation.errorSummary,
        }, 'DSL compilation failed');
      }
    } else {
      logger.debug('Skipping DSL compilation (no workflow_steps in result)');
    }

    // Return raw V5GenerationResult with latency, session tracking, and DSL compilation info
    return NextResponse.json({
      ...result,
      latency_ms: latencyMs,
      workflowGenerationSessionId: result.sessionId,
      dslCompilation,
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