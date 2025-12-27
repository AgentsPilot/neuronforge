/**
 * WorkflowSessionTracker
 *
 * Manages session lifecycle for V5 Workflow Generator.
 * Encapsulates all session tracking logic, state management, and repository calls.
 *
 * This helper class extracts session tracking concerns from V5WorkflowGenerator,
 * keeping the generator focused on business logic.
 */

import { createLogger } from '@/lib/logger';
import {
  AgentPromptWorkflowGenerationSessionRepository,
  getWorkflowGenerationSessionRepository,
} from '@/lib/agent-creation/agent-prompt-workflow-generation-session-repository';
import type {
  WorkflowInputPath,
  CreateStageParams,
  CompleteStageParams,
} from '@/components/agent-creation/types/workflow-generation-session';
import type { ProviderName } from '@/lib/ai/providerFactory';

const logger = createLogger({ module: 'AgentKit', service: 'WorkflowSessionTracker' });

/**
 * Configuration for session tracking
 */
export interface SessionTrackerConfig {
  /** Enable session tracking (creates diary entries in DB) */
  enabled: boolean;
  /** User ID for the session */
  userId: string;
  /** OpenAI thread ID from System 1 for log correlation */
  openaiThreadId?: string;
  /** Custom repository instance (optional, uses singleton if not provided) */
  repository?: AgentPromptWorkflowGenerationSessionRepository;
}

/**
 * Input data for starting a session
 */
export interface SessionStartInput {
  technicalWorkflow?: any;
  enhancedPrompt?: string;
  provider?: ProviderName;
  model?: string;
}

/**
 * WorkflowSessionTracker
 *
 * Usage:
 *   const tracker = new WorkflowSessionTracker(config);
 *   await tracker.start(input, 'technical_workflow');
 *   await tracker.addStage({ stage_name: 'technical_reviewer', ... });
 *   await tracker.completeStage({ output_data: ... });
 *   await tracker.complete(outputDsl);
 */
export class WorkflowSessionTracker {
  private config: SessionTrackerConfig;
  private repository: AgentPromptWorkflowGenerationSessionRepository | null = null;

  // Internal state
  private _sessionId?: string;
  private _stageIndex: number = 0;

  constructor(config: SessionTrackerConfig) {
    this.config = config;

    if (config.enabled) {
      this.repository = config.repository || getWorkflowGenerationSessionRepository();
      logger.debug({
        userId: config.userId,
        openaiThreadId: config.openaiThreadId,
      }, 'Session tracker initialized');
    }
  }

  // ============================================================================
  // Getters
  // ============================================================================

  /** Current session ID (undefined if not started or tracking disabled) */
  get sessionId(): string | undefined {
    return this._sessionId;
  }

  /** Whether session tracking is enabled */
  get isEnabled(): boolean {
    return this.config.enabled && this.repository !== null;
  }

  // ============================================================================
  // Lifecycle Methods
  // ============================================================================

  /**
   * Start a new session for tracking
   * @returns Session ID if created, undefined if tracking disabled
   */
  async start(
    input: SessionStartInput,
    inputPath: WorkflowInputPath
  ): Promise<string | undefined> {
    if (!this.isEnabled || !this.repository) {
      return undefined;
    }

    try {
      const session = await this.repository.createSession({
        user_id: this.config.userId,
        openai_thread_id: this.config.openaiThreadId || null,
        input_path: inputPath,
        input_data: inputPath === 'technical_workflow'
          ? input.technicalWorkflow!
          : { enhanced_prompt: input.enhancedPrompt },
        reviewer_ai_provider: (input.provider || 'anthropic') as ProviderName,
        reviewer_ai_model: input.model || 'unknown',
      });

      this._sessionId = session.id;
      this._stageIndex = 0;

      logger.info({ sessionId: session.id }, 'Workflow generation session started');
      return session.id;
    } catch (error: any) {
      logger.error({ err: error }, 'Failed to start workflow generation session');
      // Don't fail the generation if session tracking fails
      return undefined;
    }
  }

  /**
   * Add a new stage to the current session
   */
  async addStage(params: Omit<CreateStageParams, 'stage_index'>): Promise<void> {
    if (!this._sessionId || !this.repository) {
      return;
    }

    try {
      await this.repository.addStage(this._sessionId, {
        ...params,
        stage_index: this._stageIndex,
      });
      logger.debug({
        sessionId: this._sessionId,
        stageName: params.stage_name,
        stageIndex: this._stageIndex,
      }, 'Stage added');
    } catch (error: any) {
      logger.error({ err: error, stageName: params.stage_name }, 'Failed to add stage');
    }
  }

  /**
   * Complete the current stage with output data
   * Automatically advances to next stage index
   */
  async completeStage(params: CompleteStageParams): Promise<void> {
    if (!this._sessionId || !this.repository) {
      return;
    }

    try {
      await this.repository.completeStage(
        this._sessionId,
        this._stageIndex,
        params
      );
      const completedIndex = this._stageIndex;
      this._stageIndex++;
      logger.debug({
        sessionId: this._sessionId,
        stageIndex: completedIndex,
      }, 'Stage completed');
    } catch (error: any) {
      logger.error({ err: error }, 'Failed to complete stage');
    }
  }

  /**
   * Complete the session with the final output DSL
   */
  async complete(outputDsl: Record<string, any>): Promise<void> {
    if (!this._sessionId || !this.repository) {
      return;
    }

    try {
      await this.repository.completeSession(this._sessionId, outputDsl);
      logger.info({ sessionId: this._sessionId }, 'Workflow generation session completed');
    } catch (error: any) {
      logger.error({ err: error }, 'Failed to complete session');
    }
  }

  /**
   * Fail the session with an error message
   */
  async fail(errorMessage: string): Promise<void> {
    if (!this._sessionId || !this.repository) {
      return;
    }

    try {
      await this.repository.failSession(this._sessionId, errorMessage);
      logger.warn({
        sessionId: this._sessionId,
        error: errorMessage,
      }, 'Workflow generation session failed');
    } catch (error: any) {
      logger.error({ err: error }, 'Failed to mark session as failed');
    }
  }
}
