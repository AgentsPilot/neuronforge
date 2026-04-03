/**
 * Core simulator orchestration for the Enhanced Prompt Generator.
 *
 * Executes the full Phase 1 -> Phase 2 -> Phase 3 -> Validate flow
 * for a single scenario. Each phase is timed individually, and errors
 * are caught per-phase and recorded in the output.
 */

import { HttpClient } from '@/simulators/shared/http-client';
import type { HttpResponse, SimulatorLogger } from '@/simulators/shared/types';
import { authenticate, clearAuthCache, getCookieHeader } from './auth';
import { generateAnswers } from './llm-answerer';
import { validateEnhancedPrompt } from './llm-validator';
import type {
  Scenario,
  SimulatorConfig,
  SimulatorOutput,
  InitThreadResponse,
  Phase1Response,
  Phase2Response,
  Phase3Response,
  ClarificationQuestion,
  ClarificationAnswer,
  ValidationResult,
} from './types';
import * as fs from 'fs';
import * as path from 'path';

const SIMULATOR_VERSION = '1.0.0';
const WARNING_THRESHOLD_MS = 90_000;

/**
 * Wraps an HTTP POST call with 401 retry logic.
 * On a 401 response, clears the auth cache, re-authenticates, and retries once.
 * Fulfills FR-3.3: transparent re-auth on session expiry mid-run.
 */
async function requestWithRetry<T>(
  httpClient: HttpClient,
  url: string,
  body: Record<string, unknown>,
  logger: SimulatorLogger,
): Promise<HttpResponse<T>> {
  const resp = await httpClient.post<T>(url, body, getCookieHeader());

  if (resp.status === 401) {
    logger.warn(`Got 401 on ${url}, re-authenticating...`);
    clearAuthCache();
    await authenticate(logger);
    const retryResp = await httpClient.post<T>(url, body, getCookieHeader());
    return retryResp;
  }

  return resp;
}

/**
 * Run a single scenario through the full Phase 1-3 flow + validation.
 */
export async function runScenario(
  scenario: Scenario,
  config: SimulatorConfig,
  logger: SimulatorLogger,
): Promise<SimulatorOutput> {
  const runStartTime = Date.now();
  const timestamp = new Date().toISOString();
  const httpClient = new HttpClient(logger);
  const errors: SimulatorOutput['errors'] = [];

  // Resolve LLM provider/model (scenario overrides > config defaults)
  const aiProvider = scenario.ai_provider || config.llmProvider;
  const aiModel = scenario.ai_model || config.llmModel;

  // Initialize output structure
  const output: SimulatorOutput = {
    scenario: {
      name: scenario.name,
      user_prompt: scenario.user_prompt,
      file: `${scenario.name}.json`,
    },
    run: {
      timestamp,
      duration_ms: 0,
      simulator_version: SIMULATOR_VERSION,
      base_url: config.baseUrl,
      ai_provider: aiProvider,
      ai_model: aiModel,
    },
    auth: { success: false, user_id: null, email: null },
    phases: { phase1: null, phase2: null, phase3: null },
    validation: null,
    status: 'error',
    errors: [],
  };

  // -----------------------------------------------------------------------
  // Step 1: Authenticate
  // -----------------------------------------------------------------------
  let authState;
  try {
    authState = await authenticate(logger);
    output.auth = {
      success: true,
      user_id: authState.userId,
      email: authState.email,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    errors.push({ phase: 'auth', message: msg });
    output.errors = errors;
    output.run.duration_ms = Date.now() - runStartTime;
    return output;
  }

  // -----------------------------------------------------------------------
  // Step 2: Init Thread
  // -----------------------------------------------------------------------
  let threadId: string | null = null;
  const phase1Start = Date.now();

  try {
    logger.info('Initializing thread...');
    const initResponse = await requestWithRetry<InitThreadResponse>(
      httpClient,
      `${config.baseUrl}/api/agent-creation/init-thread`,
      {},
      logger,
    );

    if (!initResponse.ok || !initResponse.data.thread_id) {
      throw new Error(`Init thread failed: ${JSON.stringify(initResponse.data)}`);
    }
    threadId = initResponse.data.thread_id;

    logger.info(`Thread created: ${threadId}`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    errors.push({ phase: 'init-thread', message: msg });
    output.errors = errors;
    output.run.duration_ms = Date.now() - runStartTime;
    return output;
  }

  // -----------------------------------------------------------------------
  // Step 3: Phase 1 -- Send user_prompt, receive analysis
  // -----------------------------------------------------------------------
  let phase1Response: Phase1Response | null = null;
  try {
    logger.info('Executing Phase 1 (Analyze)...');
    const phase1Body: Record<string, unknown> = {
      thread_id: threadId,
      phase: 1,
      user_prompt: scenario.user_prompt,
    };

    if (scenario.user_context) {
      phase1Body.user_context = scenario.user_context;
    }
    if (scenario.connected_services) {
      phase1Body.connected_services = scenario.connected_services;
    }

    const resp = await requestWithRetry<Phase1Response>(
      httpClient,
      `${config.baseUrl}/api/agent-creation/process-message`,
      phase1Body,
      logger,
    );

    if (!resp.ok || !resp.data.success) {
      throw new Error(`Phase 1 failed: ${JSON.stringify(resp.data)}`);
    }

    phase1Response = resp.data;
    const phase1Duration = Date.now() - phase1Start;

    output.phases.phase1 = {
      success: true,
      duration_ms: phase1Duration,
      thread_id: threadId,
      request: phase1Body,
      response: phase1Response,
      clarification_questions: phase1Response.ambiguities || [],
    };

    logger.info(`Phase 1 complete in ${phase1Duration}ms`, {
      clarityScore: phase1Response.clarityScore,
      ambiguities: (phase1Response.ambiguities || []).length,
      connectedPlugins: (phase1Response.connectedPlugins || []).length,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    errors.push({ phase: 'phase1', message: msg });
    output.phases.phase1 = {
      success: false,
      duration_ms: Date.now() - phase1Start,
      thread_id: threadId,
      request: null,
      response: null,
      clarification_questions: [],
    };
    output.errors = errors;
    output.run.duration_ms = Date.now() - runStartTime;
    return output;
  }

  // -----------------------------------------------------------------------
  // Step 4: Phase 2 -- Send connected_services, receive questionsSequence
  // -----------------------------------------------------------------------
  const phase2Start = Date.now();
  let phase2Response: Phase2Response | null = null;
  let questions: ClarificationQuestion[] = [];
  const phase2Body: Record<string, unknown> = {
    thread_id: threadId,
    phase: 2,
    connected_services: scenario.connected_services || phase1Response?.connectedPlugins || [],
    enhanced_prompt: null,
    declined_services: [],
    user_feedback: null,
  };

  try {
    logger.info('Executing Phase 2 (Clarify)...');

    const resp = await requestWithRetry<Phase2Response>(
      httpClient,
      `${config.baseUrl}/api/agent-creation/process-message`,
      phase2Body,
      logger,
    );

    if (!resp.ok || !resp.data.success) {
      throw new Error(`Phase 2 failed: ${JSON.stringify(resp.data)}`);
    }

    phase2Response = resp.data;
    questions = phase2Response.questionsSequence || [];
    const phase2Duration = Date.now() - phase2Start;

    logger.info(`Phase 2 complete in ${phase2Duration}ms`, {
      questionCount: questions.length,
    });

    // Log the questions for debugging
    for (const q of questions) {
      logger.debug(`Question "${q.id}" (${q.type}): ${q.question}`);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    errors.push({ phase: 'phase2', message: msg });
    output.phases.phase2 = {
      success: false,
      duration_ms: Date.now() - phase2Start,
      skipped: false,
      questions: [],
      generated_answers: {},
      request: null,
      response: null,
    };
    output.errors = errors;
    output.run.duration_ms = Date.now() - runStartTime;
    return output;
  }

  // -----------------------------------------------------------------------
  // Step 5: LLM Answerer -- Generate answers from Phase 2's questions
  // -----------------------------------------------------------------------
  let generatedAnswers: Record<string, ClarificationAnswer> = {};
  const hasQuestions = questions.length > 0;

  if (hasQuestions) {
    try {
      logger.info('Generating LLM answers for clarification questions...');
      generatedAnswers = await generateAnswers(
        scenario.user_prompt,
        questions,
        scenario.clarification_hints,
        aiProvider,
        aiModel,
        logger,
      );
      logger.info(`Generated ${Object.keys(generatedAnswers).length} answers`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`LLM answerer failed: ${msg}`);
      errors.push({ phase: 'llm-answerer', message: msg });
      // Continue to Phase 3 with empty answers rather than aborting
    }
  } else {
    logger.info('No clarification questions from Phase 2, skipping LLM answerer');
  }

  output.phases.phase2 = {
    success: true,
    duration_ms: Date.now() - phase2Start,
    skipped: !hasQuestions,
    questions,
    generated_answers: generatedAnswers,
    request: phase2Body,
    response: phase2Response,
  };

  // -----------------------------------------------------------------------
  // Step 6: Phase 3 -- Send clarification_answers, receive enhanced_prompt
  // -----------------------------------------------------------------------
  const phase3Start = Date.now();
  let phase3Response: Phase3Response | null = null;

  try {
    logger.info('Executing Phase 3 (Finalize)...');
    const phase3Body: Record<string, unknown> = {
      thread_id: threadId,
      phase: 3,
      clarification_answers: generatedAnswers,
      connected_services: scenario.connected_services || phase1Response?.connectedPlugins || [],
      declined_services: [],
      enhanced_prompt: null,
    };

    const resp = await requestWithRetry<Phase3Response>(
      httpClient,
      `${config.baseUrl}/api/agent-creation/process-message`,
      phase3Body,
      logger,
    );

    if (!resp.ok || !resp.data.success) {
      throw new Error(`Phase 3 failed: ${JSON.stringify(resp.data)}`);
    }

    phase3Response = resp.data;
    const phase3Duration = Date.now() - phase3Start;

    // Log missing plugins as warning, not failure (per requirement)
    const missingPlugins = phase3Response.missingPlugins || [];
    if (missingPlugins.length > 0) {
      logger.warn(`Phase 3 reports missing plugins: ${missingPlugins.join(', ')}`);
    }

    output.phases.phase3 = {
      success: true,
      duration_ms: phase3Duration,
      request: phase3Body,
      response: phase3Response,
      enhanced_prompt: phase3Response.enhanced_prompt || null,
      missing_plugins: missingPlugins,
    };

    logger.info(`Phase 3 complete in ${phase3Duration}ms`, {
      hasEnhancedPrompt: !!phase3Response.enhanced_prompt,
      missingPlugins: missingPlugins.length,
      readyForGeneration: (phase3Response.metadata as Record<string, unknown>)?.ready_for_generation,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    errors.push({ phase: 'phase3', message: msg });
    output.phases.phase3 = {
      success: false,
      duration_ms: Date.now() - phase3Start,
      request: null,
      response: null,
      enhanced_prompt: null,
      missing_plugins: [],
    };
    output.errors = errors;
    output.run.duration_ms = Date.now() - runStartTime;
    output.status = 'error';
    saveOutput(output, scenario.name, logger);
    return output;
  }

  // -----------------------------------------------------------------------
  // Step 7: LLM Validation
  // -----------------------------------------------------------------------
  let validation: ValidationResult | null = null;

  if (phase3Response?.enhanced_prompt) {
    try {
      validation = await validateEnhancedPrompt(
        scenario.user_prompt,
        phase3Response.enhanced_prompt,
        aiProvider,
        aiModel,
        logger,
      );
      output.validation = validation;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`Validation failed: ${msg}`);
      errors.push({ phase: 'validation', message: msg });
    }
  } else {
    logger.warn('No enhanced prompt to validate (Phase 3 did not return one)');
  }

  // -----------------------------------------------------------------------
  // Step 8: Determine final status and save
  // -----------------------------------------------------------------------
  const totalDuration = Date.now() - runStartTime;
  output.run.duration_ms = totalDuration;
  output.errors = errors;

  if (errors.length > 0) {
    output.status = 'error';
  } else if (validation && !validation.pass) {
    output.status = 'warning';
  } else {
    output.status = 'pass';
  }

  if (totalDuration > WARNING_THRESHOLD_MS) {
    logger.warn(`Scenario "${scenario.name}" took ${totalDuration}ms (exceeds ${WARNING_THRESHOLD_MS}ms threshold)`);
  }

  logger.info(`Scenario "${scenario.name}" completed: ${output.status.toUpperCase()} in ${totalDuration}ms`);

  saveOutput(output, scenario.name, logger);
  return output;
}

/**
 * Save the simulator output to a JSON file in the output directory.
 */
function saveOutput(output: SimulatorOutput, scenarioName: string, logger: SimulatorLogger): void {
  const outputDir = path.join(__dirname, 'output');

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Sanitize timestamp for filename (replace colons with dashes)
  const safeTimestamp = output.run.timestamp.replace(/:/g, '-').replace(/\./g, '-');
  const filename = `${scenarioName}_${safeTimestamp}.json`;
  const filepath = path.join(outputDir, filename);

  fs.writeFileSync(filepath, JSON.stringify(output, null, 2), 'utf-8');
  logger.info(`Output saved: ${filepath}`);
}
