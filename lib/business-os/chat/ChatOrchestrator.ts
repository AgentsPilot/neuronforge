/**
 * ChatOrchestrator
 *
 * Main entry point for the deterministic-first chat architecture.
 * Routes user input through the appropriate pipeline based on classification.
 *
 * Flow:
 * 1. Check for active session
 * 2. Classify input (deterministic patterns first)
 * 3. Route to appropriate handler
 * 4. Execute capability or prompt for more info
 * 5. Render response
 */

import { createLogger } from '@/lib/logger';
import {
  commandSessionRepository,
  type CommandSession,
  type SessionChoice
} from './CommandSessionRepository';
import { transitionSession, canTransition } from './SessionStateMachine';
import { classifyInteraction, type InteractionType } from './InteractionClassifier';
import {
  parseDate,
  parseTime,
  parseDateTime,
  parseDuration,
  parseMoney,
  parseEmail,
  parsePhone,
  parseBoolean,
  parseNumber
} from './ParameterParsers';
import {
  CAPABILITY_REGISTRY,
  getCapability,
  generateLLMToolSchema,
  type Capability,
  type CapabilityParam
} from './CapabilityRegistry';
import { EntityResolver, type ResolutionResult } from './EntityResolver';
import { CapabilityEngine, type ExecutionResult } from './CapabilityEngine';
import { ResponseRenderer, type ChatResponse } from './ResponseRenderer';

const logger = createLogger({ service: 'ChatOrchestrator' });

// ============== TYPES ==============

export interface OrchestratorInput {
  userId: string;
  message: string;
  language: 'en' | 'he';
  conversationId?: string;
}

export interface OrchestratorResult {
  success: boolean;
  response: ChatResponse;
  sessionId?: string;
  requiresLLM?: boolean;
  llmContext?: LLMContext;
}

export interface LLMContext {
  systemPrompt: string;
  tools: object[];
  conversationHistory?: Array<{ role: string; content: string }>;
  sessionContext?: {
    capability: string;
    resolvedParams: Record<string, unknown>;
    pendingParams: string[];
  };
}

// ============== ORCHESTRATOR CLASS ==============

export class ChatOrchestrator {
  private userId: string;
  private entityResolver: EntityResolver;
  private engine: CapabilityEngine;
  private renderer: ResponseRenderer;
  private language: 'en' | 'he';

  constructor(userId: string, language: 'en' | 'he' = 'en') {
    this.userId = userId;
    this.entityResolver = new EntityResolver(userId);
    this.engine = new CapabilityEngine(userId);
    this.renderer = new ResponseRenderer(language);
    this.language = language;
  }

  /**
   * Main entry point - process user message
   */
  async process(input: OrchestratorInput): Promise<OrchestratorResult> {
    const { message, language } = input;
    const trimmedMessage = message.trim();

    logger.info({ userId: this.userId, messageLength: trimmedMessage.length }, 'Processing chat message');

    // Update language settings if changed
    if (language !== this.language) {
      this.language = language;
      this.renderer = new ResponseRenderer(language);
    }

    try {
      // 1. Check for active session
      const sessionResult = await commandSessionRepository.getActiveSession(this.userId);
      const activeSession = sessionResult.data;

      // 2. Classify the input
      const pendingChoices = activeSession?.pending_choices?.map(c => ({
        id: c.id,
        label: c.label
      }));

      const classification = classifyInteraction(trimmedMessage, {
        session: activeSession,
        pendingChoices
      });

      logger.debug(
        { classification: classification.type, hasSession: !!activeSession },
        'Input classified'
      );

      // 3. Route based on classification
      return await this.route(trimmedMessage, classification, activeSession);
    } catch (error) {
      logger.error({ err: error }, 'Orchestrator error');
      return {
        success: false,
        response: this.renderer.showError(
          'Something went wrong. Please try again.',
          'משהו השתבש. אנא נסה שנית.'
        )
      };
    }
  }

  /**
   * Route to appropriate handler based on classification
   */
  private async route(
    message: string,
    classification: InteractionType,
    session: CommandSession | null
  ): Promise<OrchestratorResult> {
    switch (classification.type) {
      case 'CONFIRMATION':
        return this.handleConfirmation(session, classification.value === 'confirm');

      case 'CHOICE_SELECTION':
        return this.handleChoiceSelection(session, classification.choiceId);

      case 'PARAMETER_VALUE':
        return this.handleParameterValue(session, classification.value);

      case 'SLASH_COMMAND':
        return this.handleSlashCommand(classification.command, classification.args);

      case 'ENTITY_ID_REFERENCE':
        return this.handleEntityIdReference(session, classification.entityId);

      case 'CORRECTION':
        return this.handleCorrection(session, classification.field, classification.value);

      case 'NATURAL_LANGUAGE':
      default:
        return this.handleNaturalLanguage(message, session);
    }
  }

  // ============== HANDLERS ==============

  /**
   * Handle confirmation (yes/no)
   */
  private async handleConfirmation(
    session: CommandSession | null,
    confirmed: boolean
  ): Promise<OrchestratorResult> {
    if (!session) {
      return {
        success: true,
        response: {
          message: "I'm not sure what you're confirming. What would you like to do?",
          messageHe: 'לא ברור מה לאשר. מה תרצה לעשות?',
          actions: []
        }
      };
    }

    if (session.status !== 'awaiting_confirmation') {
      // Maybe they're confirming a parameter value
      return this.handleParameterValue(session, confirmed ? 'yes' : 'no');
    }

    if (!confirmed) {
      // User cancelled
      await commandSessionRepository.terminate(session.id, this.userId, 'cancelled');
      return {
        success: true,
        response: this.renderer.showCancelled(),
        sessionId: session.id
      };
    }

    // Transition to executing
    const transitionResult = transitionSession(session, { type: 'CONFIRM' });
    await commandSessionRepository.update(session.id, this.userId, { status: transitionResult.newStatus });

    // Execute the capability
    const result = await this.engine.execute(session);

    // Update session with result
    const finalStatus = result.success ? 'completed' : 'failed';
    await commandSessionRepository.update(session.id, this.userId, { status: finalStatus });

    return {
      success: result.success,
      response: result.success
        ? this.renderer.showSuccess(result)
        : this.renderer.showError(result.error || 'Execution failed', result.message_he),
      sessionId: session.id
    };
  }

  /**
   * Handle choice selection (1, 2, 3, etc.)
   */
  private async handleChoiceSelection(
    session: CommandSession | null,
    choiceId: string
  ): Promise<OrchestratorResult> {
    if (!session || session.status !== 'awaiting_choice' || !session.pending_choices) {
      return {
        success: true,
        response: {
          message: "I'm not sure what you're selecting. What would you like to do?",
          messageHe: 'לא ברור מה לבחור. מה תרצה לעשות?',
          actions: []
        }
      };
    }

    const selectedChoice = session.pending_choices.find(c => c.id === choiceId);

    if (!selectedChoice) {
      return {
        success: false,
        response: this.renderer.showError(
          'Invalid selection. Please choose from the options above.',
          'בחירה לא תקינה. אנא בחר מהאפשרויות למעלה.'
        )
      };
    }

    // The first pending param is the one being disambiguated
    const paramName = session.pending_params[0];
    if (!paramName) {
      return {
        success: false,
        response: this.renderer.showError('Session error: no pending parameter', 'שגיאת סשן')
      };
    }

    // Resolve the parameter with the selected entity
    await commandSessionRepository.resolveParameter(session.id, this.userId, paramName, selectedChoice.id);
    await commandSessionRepository.update(session.id, this.userId, {
      resolved_params: {
        ...session.resolved_params,
        [`${paramName}_entity`]: selectedChoice.entity
      },
      pending_choices: null
    });

    // Check if we need more parameters
    const capability = getCapability(session.capability_id);
    if (!capability) {
      return {
        success: false,
        response: this.renderer.showError('Unknown capability', 'פעולה לא מוכרת')
      };
    }

    // Refresh session
    const updatedSessionResult = await commandSessionRepository.getActiveSession(this.userId);
    if (!updatedSessionResult.data) {
      return {
        success: false,
        response: this.renderer.showError('Session expired', 'הסשן פג תוקף')
      };
    }

    // Continue gathering params or proceed to confirmation
    return this.continueSession(updatedSessionResult.data, capability);
  }

  /**
   * Handle parameter value input
   */
  private async handleParameterValue(
    session: CommandSession | null,
    value: string
  ): Promise<OrchestratorResult> {
    if (!session || session.pending_params.length === 0) {
      // No active session or no pending params - treat as natural language
      return this.handleNaturalLanguage(value, session);
    }

    const capability = getCapability(session.capability_id);
    if (!capability) {
      return {
        success: false,
        response: this.renderer.showError('Unknown capability', 'פעולה לא מוכרת')
      };
    }

    // Get the first pending parameter
    const paramName = session.pending_params[0];
    const param = capability.params.find(p => p.name === paramName);

    if (!param) {
      return {
        success: false,
        response: this.renderer.showError('Invalid parameter', 'פרמטר לא תקין')
      };
    }

    // Try to parse the value
    const parseResult = await this.parseParameterValue(param, value);

    if (!parseResult.success) {
      return {
        success: false,
        response: this.renderer.showError(
          parseResult.error || 'Could not understand that value.',
          'לא הצלחתי להבין את הערך.'
        )
      };
    }

    // If it's an entity reference that needs resolution
    if (parseResult.needsResolution && param.entityType) {
      const resolution = await this.entityResolver.resolve(param.entityType, value);
      return this.handleEntityResolution(session, capability, param, resolution);
    }

    // Save the resolved parameter
    await commandSessionRepository.resolveParameter(session.id, this.userId, paramName, parseResult.value);

    // Refresh and continue
    const updatedSessionResult = await commandSessionRepository.getActiveSession(this.userId);
    if (!updatedSessionResult.data) {
      return {
        success: false,
        response: this.renderer.showError('Session expired', 'הסשן פג תוקף')
      };
    }

    return this.continueSession(updatedSessionResult.data, capability);
  }

  /**
   * Handle slash command
   */
  private async handleSlashCommand(
    command: string,
    args: string
  ): Promise<OrchestratorResult> {
    // Map slash commands to capabilities
    const commandMap: Record<string, string> = {
      'task': 'task.create',
      'contact': 'contact.create',
      'book': 'booking.create',
      'invoice': 'invoice.create',
      'service': 'service.create',
      'help': 'help'
    };

    const capabilityId = commandMap[command];

    if (command === 'help' || !capabilityId) {
      return {
        success: true,
        response: this.renderer.showHelp()
      };
    }

    const capability = getCapability(capabilityId);
    if (!capability) {
      return {
        success: true,
        response: this.renderer.showHelp()
      };
    }

    // Parse any inline parameters from args
    const initialParams = this.parseInlineParams(capability, args);

    // Get required params that are still missing
    const pendingParams = capability.params
      .filter(p => p.required && initialParams[p.name] === undefined)
      .map(p => p.name);

    // Create a new session
    const sessionResult = await commandSessionRepository.create(
      this.userId,
      capabilityId,
      initialParams,
      pendingParams
    );

    if (sessionResult.error || !sessionResult.data) {
      return {
        success: false,
        response: this.renderer.showError('Failed to create session', 'נכשל ביצירת סשן')
      };
    }

    // Continue the session flow
    return this.continueSession(sessionResult.data, capability);
  }

  /**
   * Handle entity ID reference (e.g., [ID: uuid])
   */
  private async handleEntityIdReference(
    session: CommandSession | null,
    entityId: string
  ): Promise<OrchestratorResult> {
    if (!session || session.pending_params.length === 0) {
      return {
        success: true,
        response: {
          message: "I found an ID reference but I'm not sure what to do with it. What would you like to do?",
          messageHe: 'מצאתי הפניה לזיהוי אבל לא ברור מה לעשות איתה. מה תרצה לעשות?',
          actions: []
        }
      };
    }

    const capability = getCapability(session.capability_id);
    if (!capability) {
      return {
        success: false,
        response: this.renderer.showError('Unknown capability', 'פעולה לא מוכרת')
      };
    }

    // Find the first pending entity parameter
    const paramName = session.pending_params[0];
    const param = capability.params.find(p => p.name === paramName && p.entityType);

    if (!param || !param.entityType) {
      // Not an entity param - try as regular value
      return this.handleParameterValue(session, entityId);
    }

    // Resolve by ID
    const resolution = await this.entityResolver.resolveById(param.entityType, entityId);
    return this.handleEntityResolution(session, capability, param, resolution);
  }

  /**
   * Handle correction
   */
  private async handleCorrection(
    session: CommandSession | null,
    field: string,
    value: string
  ): Promise<OrchestratorResult> {
    if (!session || session.status !== 'awaiting_confirmation') {
      return this.handleNaturalLanguage(`change ${field} to ${value}`, session);
    }

    const capability = getCapability(session.capability_id);
    if (!capability) {
      return {
        success: false,
        response: this.renderer.showError('Unknown capability', 'פעולה לא מוכרת')
      };
    }

    // Find matching param
    const param = capability.params.find(p =>
      p.name.toLowerCase().includes(field.toLowerCase()) ||
      p.description.toLowerCase().includes(field.toLowerCase())
    );

    if (!param) {
      return {
        success: false,
        response: this.renderer.showError(
          `I don't recognize the field "${field}". Please try again.`,
          `לא מזהה את השדה "${field}". אנא נסה שנית.`
        )
      };
    }

    // Parse and update the value
    const parseResult = await this.parseParameterValue(param, value);
    if (!parseResult.success) {
      return {
        success: false,
        response: this.renderer.showError(
          parseResult.error || `Could not understand the new value for ${field}`,
          `לא הצלחתי להבין את הערך החדש עבור ${field}`
        )
      };
    }

    // Update the resolved params
    const newResolvedParams = {
      ...session.resolved_params,
      [param.name]: parseResult.value
    };

    await commandSessionRepository.update(session.id, this.userId, {
      resolved_params: newResolvedParams
    });

    // Re-show confirmation
    return {
      success: true,
      response: this.renderer.showConfirmation(capability, newResolvedParams),
      sessionId: session.id
    };
  }

  /**
   * Handle natural language - requires LLM
   */
  private async handleNaturalLanguage(
    message: string,
    session: CommandSession | null
  ): Promise<OrchestratorResult> {
    logger.debug({ messageLength: message.length }, 'Routing to LLM for natural language');

    // Build LLM context
    const llmContext = this.buildLLMContext(message, session);

    return {
      success: true,
      requiresLLM: true,
      llmContext,
      response: {
        message: '', // Will be filled by LLM
        actions: []
      }
    };
  }

  // ============== HELPER METHODS ==============

  /**
   * Continue session - check for more params or proceed to confirmation
   */
  private async continueSession(
    session: CommandSession,
    capability: Capability
  ): Promise<OrchestratorResult> {
    // Check if we still have pending required params
    const pendingRequired = session.pending_params.filter(paramName => {
      const param = capability.params.find(p => p.name === paramName);
      return param?.required && session.resolved_params[paramName] === undefined;
    });

    if (pendingRequired.length > 0) {
      // Ask for the next parameter
      const nextParam = capability.params.find(p => p.name === pendingRequired[0])!;
      return {
        success: true,
        response: this.renderer.askParameterWithContext(
          nextParam,
          capability,
          session.resolved_params
        ),
        sessionId: session.id
      };
    }

    // All required params gathered - proceed based on confirmation requirement
    if (capability.confirmationRequired) {
      // Update status to awaiting_confirmation
      await commandSessionRepository.update(session.id, this.userId, {
        status: 'awaiting_confirmation'
      });

      return {
        success: true,
        response: this.renderer.showConfirmation(capability, session.resolved_params),
        sessionId: session.id
      };
    }

    // No confirmation needed - execute directly
    // First update session to include resolved params
    const freshSessionResult = await commandSessionRepository.getById(session.id, this.userId);
    if (!freshSessionResult.data) {
      return {
        success: false,
        response: this.renderer.showError('Session expired', 'הסשן פג תוקף')
      };
    }

    const result = await this.engine.execute(freshSessionResult.data);

    await commandSessionRepository.update(session.id, this.userId, {
      status: result.success ? 'completed' : 'failed'
    });

    return {
      success: result.success,
      response: result.success
        ? this.renderer.showSuccess(result)
        : this.renderer.showError(result.error || 'Execution failed', result.message_he),
      sessionId: session.id
    };
  }

  /**
   * Handle entity resolution result
   */
  private async handleEntityResolution(
    session: CommandSession,
    capability: Capability,
    param: CapabilityParam,
    resolution: ResolutionResult
  ): Promise<OrchestratorResult> {
    switch (resolution.status) {
      case 'exact':
        // Perfect match - save and continue
        await commandSessionRepository.resolveParameter(
          session.id,
          this.userId,
          param.name,
          resolution.entity!.id
        );
        await commandSessionRepository.update(session.id, this.userId, {
          resolved_params: {
            ...session.resolved_params,
            [param.name]: resolution.entity!.id,
            [`${param.name}_entity`]: resolution.entity!.data
          }
        });

        const updatedSessionResult = await commandSessionRepository.getActiveSession(this.userId);
        if (!updatedSessionResult.data) {
          return {
            success: false,
            response: this.renderer.showError('Session expired', 'הסשן פג תוקף')
          };
        }
        return this.continueSession(updatedSessionResult.data, capability);

      case 'multiple':
        // Multiple matches - show choices
        const choices: SessionChoice[] = (resolution.choices || []).map(c => ({
          id: c.id,
          label: c.label,
          entity: c.entity
        }));
        await commandSessionRepository.setChoices(session.id, this.userId, choices);

        return {
          success: true,
          response: this.renderer.showEntityChoices(param.entityType!, resolution.choices || []),
          sessionId: session.id
        };

      case 'none':
        return {
          success: false,
          response: this.renderer.showNotFound(param.entityType!, resolution.searchedTerm),
          sessionId: session.id
        };

      case 'error':
      default:
        return {
          success: false,
          response: this.renderer.showError(
            resolution.error || 'Could not resolve entity',
            'לא הצלחתי למצוא את הישות'
          ),
          sessionId: session.id
        };
    }
  }

  /**
   * Parse parameter value based on type
   */
  private async parseParameterValue(
    param: CapabilityParam,
    value: string
  ): Promise<{ success: boolean; value?: unknown; error?: string; needsResolution?: boolean }> {
    // If it's an entity type, mark for resolution
    if (param.entityType) {
      return { success: true, value, needsResolution: true };
    }

    // Parse based on type
    switch (param.type) {
      case 'date': {
        const parsed = parseDate(value);
        return parsed.success
          ? { success: true, value: parsed.value }
          : { success: false, error: parsed.error || 'Could not parse date' };
      }

      case 'time': {
        const parsed = parseTime(value);
        return parsed.success
          ? { success: true, value: parsed.value }
          : { success: false, error: parsed.error || 'Could not parse time' };
      }

      case 'datetime': {
        const parsed = parseDateTime(value);
        return parsed.success
          ? { success: true, value: parsed.value }
          : { success: false, error: parsed.error || 'Could not parse date/time' };
      }

      case 'duration': {
        const parsed = parseDuration(value);
        return parsed.success
          ? { success: true, value: parsed.value }
          : { success: false, error: parsed.error || 'Could not parse duration' };
      }

      case 'money': {
        const parsed = parseMoney(value);
        return parsed.success
          ? { success: true, value: parsed.value }
          : { success: false, error: parsed.error || 'Could not parse amount' };
      }

      case 'email': {
        const parsed = parseEmail(value);
        return parsed.success
          ? { success: true, value: parsed.value }
          : { success: false, error: parsed.error || 'Invalid email format' };
      }

      case 'phone': {
        const parsed = parsePhone(value);
        return parsed.success
          ? { success: true, value: parsed.value }
          : { success: false, error: parsed.error || 'Invalid phone format' };
      }

      case 'boolean': {
        const parsed = parseBoolean(value);
        return parsed.success
          ? { success: true, value: parsed.value }
          : { success: false, error: parsed.error || 'Could not understand yes/no' };
      }

      case 'number': {
        const parsed = parseNumber(value);
        return parsed.success
          ? { success: true, value: parsed.value }
          : { success: false, error: parsed.error || 'Could not parse number' };
      }

      case 'string':
      case 'entity_ref':
      default:
        return { success: true, value };
    }
  }

  /**
   * Parse inline parameters from slash command
   */
  private parseInlineParams(
    capability: Capability,
    text: string
  ): Record<string, unknown> {
    const params: Record<string, unknown> = {};

    if (!text) return params;

    // Simple heuristics for common patterns
    for (const param of capability.params) {
      switch (param.type) {
        case 'money': {
          const moneyMatch = text.match(/[$₪€£]?\s*(\d+(?:[.,]\d{2})?)\s*(?:[$₪€£]|NIS|ILS|USD)?/i);
          if (moneyMatch) {
            const amount = parseFloat(moneyMatch[1].replace(',', '.'));
            const currency = text.includes('$') || /USD/i.test(text) ? 'USD' : 'ILS';
            params[param.name] = { amount, currency };
          }
          break;
        }

        case 'date': {
          const dateResult = parseDate(text);
          if (dateResult.success) {
            params[param.name] = dateResult.value;
          }
          break;
        }

        case 'email': {
          const emailResult = parseEmail(text);
          if (emailResult.success) {
            params[param.name] = emailResult.value;
          }
          break;
        }

        // For strings, we'll leave them for the LLM or follow-up questions
      }
    }

    return params;
  }

  /**
   * Build LLM context for natural language processing
   */
  private buildLLMContext(message: string, session: CommandSession | null): LLMContext {
    const tools = generateLLMToolSchema();

    const systemPrompt = `You are a helpful business assistant for AgentPilot.
You help users manage their business through natural conversation.

Available capabilities:
${CAPABILITY_REGISTRY
  .map(c => `- ${c.id}: ${this.language === 'he' ? c.description_he || c.description : c.description}`)
  .join('\n')}

Guidelines:
1. Understand the user's intent and map it to the appropriate capability
2. Extract parameter values from their message
3. Use the tools provided to execute capabilities
4. Respond in ${this.language === 'he' ? 'Hebrew' : 'English'}
5. Be concise and helpful

${session ? `
Active session:
- Capability: ${session.capability_id}
- Resolved parameters: ${JSON.stringify(session.resolved_params)}
- Pending parameters: ${session.pending_params.join(', ')}
` : ''}`;

    return {
      systemPrompt,
      tools,
      sessionContext: session
        ? {
            capability: session.capability_id,
            resolvedParams: session.resolved_params,
            pendingParams: session.pending_params
          }
        : undefined
    };
  }

  /**
   * Process LLM response and continue the flow
   * Called after LLM processes the natural language
   */
  async processLLMResponse(
    toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>
  ): Promise<OrchestratorResult> {
    if (toolCalls.length === 0) {
      return {
        success: true,
        response: {
          message: "I'm not sure what you'd like me to do. Can you be more specific?",
          messageHe: 'לא ברור מה לעשות. אפשר לפרט?',
          actions: []
        }
      };
    }

    // Process the first tool call (capability invocation)
    const toolCall = toolCalls[0];
    // Convert tool name back to capability ID (task_create → task.create)
    const capabilityId = toolCall.name.replace('_', '.');
    const params = toolCall.arguments;

    const capability = getCapability(capabilityId);
    if (!capability) {
      return {
        success: false,
        response: this.renderer.showError(
          `Unknown capability: ${capabilityId}`,
          `פעולה לא מוכרת: ${capabilityId}`
        )
      };
    }

    // Resolve entity references in params
    const resolvedParams: Record<string, unknown> = {};
    const pendingParams: string[] = [];

    for (const param of capability.params) {
      const value = params[param.name];

      if (value !== undefined) {
        if (param.entityType && typeof value === 'string') {
          // Resolve entity reference
          const resolution = await this.entityResolver.resolve(param.entityType, value);

          if (resolution.status === 'exact') {
            resolvedParams[param.name] = resolution.entity!.id;
            resolvedParams[`${param.name}_entity`] = resolution.entity!.data;
          } else if (resolution.status === 'multiple') {
            // Create session with partial params and show choices
            const sessionResult = await commandSessionRepository.create(
              this.userId,
              capabilityId,
              resolvedParams,
              [param.name, ...pendingParams]
            );

            if (!sessionResult.data) {
              return {
                success: false,
                response: this.renderer.showError('Failed to create session', 'נכשל ביצירת סשן')
              };
            }

            const choices: SessionChoice[] = (resolution.choices || []).map(c => ({
              id: c.id,
              label: c.label,
              entity: c.entity
            }));
            await commandSessionRepository.setChoices(sessionResult.data.id, this.userId, choices);

            return {
              success: true,
              response: this.renderer.showEntityChoices(param.entityType, resolution.choices || []),
              sessionId: sessionResult.data.id
            };
          } else {
            // Not found - mark as pending
            pendingParams.push(param.name);
          }
        } else {
          resolvedParams[param.name] = value;
        }
      } else if (param.required) {
        pendingParams.push(param.name);
      }
    }

    // Create session with LLM-extracted params
    const sessionResult = await commandSessionRepository.create(
      this.userId,
      capabilityId,
      resolvedParams,
      pendingParams
    );

    if (sessionResult.error || !sessionResult.data) {
      return {
        success: false,
        response: this.renderer.showError('Failed to create session', 'נכשל ביצירת סשן')
      };
    }

    // Continue the session flow
    return this.continueSession(sessionResult.data, capability);
  }
}
