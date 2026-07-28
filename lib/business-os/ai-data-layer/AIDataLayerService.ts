/**
 * AIDataLayerService
 *
 * Main orchestrator for the AI Data Layer. Processes user messages using
 * OpenAI function calling to autonomously query and mutate data.
 *
 * Flow:
 * 1. Build rich context (profile, stats, recent activity, entities)
 * 2. Send message + context + tools to LLM
 * 3. Execute tool calls via SafeExecutionLayer
 * 4. Return LLM-generated response in user's language
 */

import OpenAI from 'openai';
import { createLogger } from '@/lib/logger';
import { contextBuilder } from './ContextBuilder';
import { createExecutionLayer, SafeExecutionLayer } from './SafeExecutionLayer';
import {
  MAX_TOOL_CALLS_PER_REQUEST,
  type AIDataLayerRequest,
  type AIDataLayerResponse,
  type ChatMessage,
  type ToolResult,
  type UserContext
} from './types';
import {
  CAPABILITIES_SCHEMA,
  generateCapabilitiesDescription,
  getAction
} from './capabilities-schema';
import type { ChatCompletionTool } from 'openai/resources/chat/completions';

const logger = createLogger({ service: 'AIDataLayerService' });

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export class AIDataLayerService {
  private userId: string;
  private executionLayer: SafeExecutionLayer;

  constructor(userId: string) {
    this.userId = userId;
    this.executionLayer = createExecutionLayer(userId);
  }

  /**
   * Process a user message and return an AI response
   */
  async processMessage(request: AIDataLayerRequest): Promise<AIDataLayerResponse> {
    const { message, conversationHistory, pendingConfirmationId } = request;

    logger.info({ userId: this.userId, messageLength: message.length }, 'Processing AI data layer request');

    try {
      // Build rich context
      const context = await contextBuilder.buildContext(this.userId);

      // Detect language from profile or message content
      const containsHebrew = /[\u0590-\u05FF]/.test(message);
      const isHebrew = context.profile.language === 'he' || containsHebrew;

      // Handle confirmation flow
      if (pendingConfirmationId) {
        return this.handleConfirmation(pendingConfirmationId, message, isHebrew);
      }

      // Build system prompt with context
      const systemPrompt = this.buildSystemPrompt(context);

      // Build messages array
      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: 'system', content: systemPrompt },
        ...(conversationHistory || []).map(this.convertToOpenAIMessage),
        { role: 'user', content: message }
      ];

      // Call OpenAI with function calling (pass user language for auto-generated choices)
      const response = await this.callLLMWithTools(messages, context.profile.language);

      return response;
    } catch (error) {
      logger.error({ err: error, userId: this.userId }, 'AI data layer processing failed');
      return {
        message: 'I encountered an error processing your request. Please try again.',
        actions: []
      };
    }
  }

  /**
   * Build the system prompt with user context
   */
  private buildSystemPrompt(context: UserContext): string {
    const { profile, stats, recentActivity, entities } = context;

    // Detect language from profile or default
    const language = profile.language || 'en';
    const isHebrew = language === 'he';

    const languageInstructions = isHebrew
      ? 'The user prefers Hebrew. ALWAYS respond in Hebrew (עברית). Use natural, conversational Hebrew.'
      : 'Respond in the same language as the user. If unclear, use English.';

    // Format services list for context
    const servicesContext = entities.services.length > 0
      ? `Available services: ${entities.services.map(s => `"${s.name}" (${profile.currency || 'ILS'} ${s.price}, ${s.duration_minutes}min)`).join(', ')}`
      : 'No services configured yet.';

    // Format contacts summary
    const contactsContext = entities.contacts.length > 0
      ? `Recent contacts: ${entities.contacts.slice(0, 5).map(c => c.name).join(', ')}${entities.contacts.length > 5 ? ` (and ${entities.contacts.length - 5} more)` : ''}`
      : 'No contacts yet.';

    // Generate capabilities description from schema
    const capabilitiesDescription = generateCapabilitiesDescription();

    return `You are an intelligent business assistant with direct access to the user's business data.
You can query and modify data using the execute_action tool.

## User Profile
- Business: ${profile.businessName || 'Not set'}
- Industry: ${profile.vertical || 'Not set'}
- Currency: ${profile.currency || 'ILS'}
- Timezone: ${profile.timezone || 'UTC'}

## Current Statistics
- Total contacts: ${stats.totalContacts}
- Today's bookings: ${stats.todayBookings}
- Pending tasks: ${stats.pendingTasks}
- Pending invoices: ${stats.pendingInvoices}

## Available Data
${servicesContext}
${contactsContext}

## Recent Activity
${recentActivity.lastContact ? `- Last contact added: ${recentActivity.lastContact.name}` : ''}
${recentActivity.lastBooking ? `- Last booking: ${recentActivity.lastBooking.serviceName} on ${new Date(recentActivity.lastBooking.date).toLocaleDateString()}` : ''}
${recentActivity.lastTask ? `- Last task: "${recentActivity.lastTask.title}" (${recentActivity.lastTask.status})` : ''}

## Language
${languageInstructions}

${capabilitiesDescription}

## CRITICAL: Action Selection Rules

When the user wants to hide/disable/turn off/unpublish something → use **deactivate** action
When the user wants to permanently remove/delete something → use **delete** action

These are DIFFERENT actions:
- **deactivate**: Hides the entity. Data is preserved. Can be reversed with activate.
- **delete**: PERMANENTLY destroys. Cannot be undone.

When asking for confirmation, use terminology that matches the action:
- For deactivate: "hide", "disable", "deactivate", "turn off" (Hebrew: להשבית, להסתיר, לכבות)
- For delete: "permanently delete", "remove forever" (Hebrew: למחוק לצמיתות, להסיר לצמיתות)
- For activate: "enable", "show", "publish" (Hebrew: להפעיל, להציג, לפרסם)
- For complete: "mark as done", "complete" (Hebrew: לסמן כהושלם)
- For cancel: "cancel" (Hebrew: לבטל)

NEVER use "remove" (להסיר) or "delete" (למחוק) when the action is deactivate.

## Response Guidelines
- Be concise and helpful
- When showing data, format it clearly
- For mutations requiring confirmation, describe the EXACT action using correct terminology
- Match the user's language naturally
- Use the user's currency (${profile.currency || 'ILS'}) for prices

## Entity Resolution - CRITICAL
When the user wants to perform an action on an entity (deactivate, delete, update, etc.):
1. You MUST first call execute_action with action: "list" to get the actual entities with their real UUIDs
2. NEVER generate, guess, or make up IDs like "svc-1", "contact-2", etc.
3. ONLY use IDs that come from list results or from "[ID: xxx]" in user messages
4. If multiple matches exist, the system will auto-present choices to user

IMPORTANT - Use correct filters when listing:
- For "activate" action: list with filters: { is_active: false } (show inactive items)
- For "deactivate" action: list with filters: { is_active: true } (show active items)

Example WRONG flow:
- User: "deactivate service"
- AI calls: execute_action(entity: "services", action: "deactivate", id: "svc-1") ❌ WRONG - made up ID

Example CORRECT flow for DEACTIVATE:
- User: "deactivate service"
- AI calls: execute_action(entity: "services", action: "list", filters: { is_active: true }) ✓
- System returns active services with real UUIDs
- User selects one
- AI calls: execute_action(entity: "services", action: "deactivate", id: "real-uuid") ✓

Example CORRECT flow for ACTIVATE:
- User: "activate service"
- AI calls: execute_action(entity: "services", action: "list", filters: { is_active: false }) ✓
- System returns inactive services with real UUIDs
- User selects one
- AI calls: execute_action(entity: "services", action: "activate", id: "real-uuid") ✓

## CRITICAL: Always Use present_choices for Selection
When the user needs to choose from multiple entities (services, contacts, etc.):
- ALWAYS use the present_choices tool - NEVER list options as text
- The frontend renders choices as clickable buttons
- Include the entity ID in each choice
- Example: user says "deactivate service" → list services → call present_choices with service options

## IMPORTANT: User Selection with ID
When the user's message contains "[ID: xxx]" at the end, it means they selected from a list.
- Extract the UUID from "[ID: xxx]" and use it directly as the entity ID
- Do NOT search or query again - the ID is already provided
- Example: "Follow-up Call [ID: abc-123-def]" → use id: "abc-123-def"

## CRITICAL: Use present_entity_card for Displaying Entity Details
When the user asks to "open", "show", "view", "פתח", or see details of an entity:
1. First search/list to find the entity (by name or filter)
2. If exactly ONE match: call present_entity_card with the full entity data
3. If multiple matches: call present_choices to let user select
4. NEVER output entity data as plain text - ALWAYS use present_entity_card

Available search filters:
- contacts: use { search: "name" } to search by name/email
- services: use { search: "name" } to search by service name

Example CORRECT flow for "open contact Sara" / "פתח איש קשר שרה":
- AI calls: execute_action(entity: "contacts", action: "list", filters: { search: "sara" })
- System returns 1 contact with full data
- AI calls: present_entity_card(entityType: "contacts", entityId: "uuid-here", entity: { ...contact data })
- Result: Beautiful card with "Open in CRM", "Call", "Email" buttons

Example CORRECT flow for "show my services":
- AI calls: execute_action(entity: "services", action: "list")
- System returns multiple services
- AI calls: present_choices (or auto-generated by system) to let user select
- User selects one
- AI calls: present_entity_card with the selected service data`;
  }

  /**
   * Generate capability-aware tool definitions
   */
  private generateToolDefinitions(): ChatCompletionTool[] {
    // Build enum of all entities
    const allEntities: string[] = [];
    for (const capability of Object.values(CAPABILITIES_SCHEMA)) {
      allEntities.push(...Object.keys(capability.entities));
    }

    // Build enum of all action types
    const allActions = ['list', 'get', 'create', 'update', 'delete', 'deactivate', 'activate', 'complete', 'cancel', 'publish', 'send'];

    return [
      {
        type: 'function',
        function: {
          name: 'execute_action',
          description: `Execute an action on a business entity. Use the capabilities schema provided in the system prompt to understand what actions are available for each entity.

IMPORTANT ACTION SEMANTICS:
- deactivate: Hide/unpublish an entity (e.g., service). Data is preserved, not deleted. Reversible.
- delete: PERMANENTLY remove. Cannot be undone. Use deactivate instead when user just wants to hide.
- complete: Mark as done (for tasks, bookings)
- cancel: Cancel without deleting (for bookings, invoices)
- activate: Make visible/publish (opposite of deactivate)`,
          parameters: {
            type: 'object',
            properties: {
              entity: {
                type: 'string',
                enum: allEntities,
                description: 'The entity type to operate on'
              },
              action: {
                type: 'string',
                enum: allActions,
                description: 'The action to perform. Use the EXACT action that matches user intent (e.g., "deactivate" not "delete" when hiding)'
              },
              id: {
                type: 'string',
                description: 'Entity ID (required for get, update, delete, deactivate, activate, complete, cancel, publish, send)'
              },
              filters: {
                type: 'object',
                description: 'Filter conditions for list action',
                additionalProperties: true
              },
              data: {
                type: 'object',
                description: 'Data payload for create/update actions',
                additionalProperties: true
              },
              limit: {
                type: 'number',
                description: 'Max results for list (default 20, max 50)'
              }
            },
            required: ['entity', 'action']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'present_choices',
          description: `REQUIRED: Present a list of choices to the user as clickable buttons.

YOU MUST USE THIS TOOL (not text) when:
- User needs to select from multiple entities (services, contacts, tasks, etc.)
- You found multiple matches and need disambiguation
- Any scenario where user chooses from a list

NEVER list options as text - ALWAYS use this tool. The frontend renders clickable buttons.
The user's next message will contain the selected label + "[ID: xxx]" suffix.`,
          parameters: {
            type: 'object',
            properties: {
              prompt: {
                type: 'string',
                description: 'The question/prompt to show before the choices (in user\'s language)'
              },
              choices: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: {
                      type: 'string',
                      description: 'Entity ID or unique identifier'
                    },
                    label: {
                      type: 'string',
                      description: 'Display label for the choice (e.g., service name)'
                    },
                    detail: {
                      type: 'string',
                      description: 'Optional detail text (e.g., price, duration)'
                    }
                  },
                  required: ['id', 'label']
                },
                description: 'List of choices to present'
              },
              entityType: {
                type: 'string',
                description: 'Type of entity being selected (for context)'
              },
              pendingAction: {
                type: 'string',
                description: 'The action that will be performed on the selected entity (e.g., "deactivate", "delete")'
              }
            },
            required: ['prompt', 'choices']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'present_entity_card',
          description: `Present a single entity (contact, service, task, etc.) in a beautiful card format with action buttons.

USE THIS TOOL when:
- User asks to "open", "show", "view", or "get details" of a specific entity
- You have fetched a single entity's full details and want to display them nicely
- User selected an entity from a list and you retrieved its details

The card will show formatted entity details with action buttons like:
- "Open in CRM" (navigates to CRM page with contact filter)
- "Edit" (opens edit modal)
- "Call" / "Email" (for contacts with phone/email)

NEVER dump entity data as plain text - ALWAYS use this tool for a polished presentation.`,
          parameters: {
            type: 'object',
            properties: {
              entityType: {
                type: 'string',
                enum: ['contacts', 'services', 'bookings', 'tasks', 'invoices'],
                description: 'The type of entity being presented'
              },
              entityId: {
                type: 'string',
                description: 'The entity ID (UUID)'
              },
              entity: {
                type: 'object',
                description: 'The full entity data to display',
                additionalProperties: true
              }
            },
            required: ['entityType', 'entityId', 'entity']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'navigate',
          description: 'Navigate the user to a page in the application',
          parameters: {
            type: 'object',
            properties: {
              destination: {
                type: 'string',
                enum: [
                  '/business-os',
                  '/business-os/crm',
                  '/business-os/scheduling',
                  '/business-os/payments',
                  '/business-os/email-automation',
                  '/business-os/website',
                  '/business-os/reports',
                  '/business-os/settings'
                ],
                description: 'The page to navigate to'
              },
              params: {
                type: 'object',
                description: 'Query parameters',
                additionalProperties: { type: 'string' }
              }
            },
            required: ['destination']
          }
        }
      }
    ];
  }

  /**
   * Call LLM with tools and handle tool execution loop
   */
  private async callLLMWithTools(
    messages: OpenAI.Chat.ChatCompletionMessageParam[],
    userLanguage?: string
  ): Promise<AIDataLayerResponse> {
    let currentMessages = [...messages];
    let toolCallCount = 0;
    const allToolCalls: AIDataLayerResponse['toolCalls'] = [];
    const allActions: AIDataLayerResponse['actions'] = [];
    let pendingConfirmation: AIDataLayerResponse['pendingConfirmation'];

    // Track list results for auto-generating present_choices
    let lastListResult: { entity: string; data: Record<string, unknown>[] } | null = null;
    let pendingActionType: string | null = null;

    // Determine language - check profile first, then detect from message
    // Hebrew detection: check if message contains Hebrew characters
    const userMessage = messages.find(m => m.role === 'user')?.content || '';
    const messageText = typeof userMessage === 'string' ? userMessage : '';
    const containsHebrew = /[\u0590-\u05FF]/.test(messageText);
    const isHebrew = userLanguage === 'he' || containsHebrew;

    const toolDefinitions = this.generateToolDefinitions();

    // Tool execution loop
    while (toolCallCount < MAX_TOOL_CALLS_PER_REQUEST) {
      const completion = await openai.chat.completions.create({
        model: process.env.OPENAI_CHAT_MODEL || 'gpt-4o',
        messages: currentMessages,
        tools: toolDefinitions,
        tool_choice: 'auto'
      });

      const assistantMessage = completion.choices[0]?.message;

      if (!assistantMessage) {
        break;
      }

      // If no tool calls, we have our final response
      if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
        // AUTO-INJECT present_entity_card if LLM returned exactly ONE result
        // This happens when user asks to "open contact Sara" and there's one match
        if (lastListResult && lastListResult.data.length === 1 && !allActions.some(a => a.type === 'present_entity_card')) {
          const singleEntity = lastListResult.data[0];
          const entityId = singleEntity.id as string;

          logger.info(
            { userId: this.userId, entity: lastListResult.entity, entityId },
            'Auto-generating present_entity_card for single result'
          );

          // Execute present_entity_card tool to get formatted card with actions
          const cardResult = await this.executionLayer.execute('present_entity_card', {
            entityType: lastListResult.entity,
            entityId,
            entity: singleEntity
          });

          if (cardResult.success && 'action' in cardResult) {
            allActions.push(cardResult.action as any);

            // Return with the entity card - no text message needed
            return {
              message: '', // Card speaks for itself
              actions: allActions,
              pendingConfirmation,
              toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined
            };
          }
        }

        // AUTO-INJECT present_choices if LLM returned a text list instead of using the tool
        // This happens when LLM lists options as text instead of calling present_choices
        if (lastListResult && lastListResult.data.length > 1 && !allActions.some(a => a.type === 'present_choices')) {
          const autoChoices = this.autoGeneratePresentChoices(
            lastListResult.entity,
            lastListResult.data,
            pendingActionType,
            isHebrew
          );

          if (autoChoices) {
            logger.info(
              { userId: this.userId, entity: lastListResult.entity, choiceCount: autoChoices.choices.length },
              'Auto-generating present_choices for list result'
            );

            allActions.push(autoChoices);

            // Return with auto-generated choices
            // Include the prompt as the message so user sees what to do
            return {
              message: autoChoices.prompt, // Show the selection prompt
              actions: allActions,
              pendingConfirmation,
              toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined
            };
          }
        }

        // Determine the final message:
        // - If pending confirmation: empty (frontend renders based on pendingConfirmation data)
        // - If entity card is being presented: empty (card speaks for itself)
        // - Otherwise: use LLM's content
        const hasEntityCard = allActions.some(a => a.type === 'present_entity_card');
        const message = pendingConfirmation || hasEntityCard
          ? '' // Empty - frontend renders the card/confirmation UI
          : (assistantMessage.content || '');

        return {
          message,
          actions: allActions,
          pendingConfirmation,
          toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined
        };
      }

      // Add assistant message to history
      currentMessages.push(assistantMessage);

      // Execute each tool call
      for (const toolCall of assistantMessage.tool_calls) {
        toolCallCount++;

        if (toolCallCount > MAX_TOOL_CALLS_PER_REQUEST) {
          logger.warn({ userId: this.userId, toolCallCount }, 'Max tool calls exceeded');
          break;
        }

        // Type guard for function tool calls
        if (toolCall.type !== 'function') continue;

        const functionName = toolCall.function.name;
        const functionArgs = JSON.parse(toolCall.function.arguments);

        logger.info(
          { userId: this.userId, function: functionName, args: functionArgs },
          'Executing tool call'
        );

        // Track pending action type for context (e.g., user wants to deactivate)
        if (functionName === 'execute_action' && functionArgs.action) {
          const actionType = functionArgs.action as string;
          if (['deactivate', 'activate', 'delete', 'complete', 'cancel', 'update'].includes(actionType)) {
            pendingActionType = actionType;
          }
        }

        // Execute the tool
        let result = await this.executionLayer.execute(functionName, functionArgs);

        // AUTO-RECOVERY: If the LLM used an invalid ID, automatically fetch the list
        // This handles the case where LLM makes up IDs like "svc-4" instead of using real UUIDs
        if (!result.success && (result as any).requiresList && functionName === 'execute_action') {
          const entity = functionArgs.entity as string;
          const originalAction = functionArgs.action as string;
          logger.info(
            { userId: this.userId, entity, originalAction },
            'Auto-recovering from invalid ID by fetching entity list'
          );

          // Build appropriate filters based on the intended action
          // e.g., "activate" should show inactive items, "deactivate" should show active items
          const filters: Record<string, unknown> = {};
          if (entity === 'services') {
            if (originalAction === 'activate') {
              // Show inactive services (ones that can be activated)
              filters.is_active = false;
            } else if (originalAction === 'deactivate') {
              // Show active services (ones that can be deactivated)
              filters.is_active = true;
            }
          }

          // Execute a list action to get real entities
          const listResult = await this.executionLayer.execute('execute_action', {
            entity,
            action: 'list',
            filters: Object.keys(filters).length > 0 ? filters : undefined
          });

          if (listResult.success) {
            const queryResult = listResult as { data?: Record<string, unknown>[] };
            if (queryResult.data && queryResult.data.length > 0) {
              // PERFORMANCE OPTIMIZATION: Return immediately with choices instead of looping
              logger.info(
                { userId: this.userId, entity, resultCount: queryResult.data.length },
                '[PERF] Fast-path: auto-recovering with immediate choices'
              );

              const autoChoices = this.autoGeneratePresentChoices(
                entity,
                queryResult.data,
                originalAction, // Use the original intended action (deactivate, delete, etc.)
                isHebrew
              );

              if (autoChoices) {
                allActions.push(autoChoices);

                // Return immediately - no more LLM calls needed!
                return {
                  message: autoChoices.prompt,
                  actions: allActions,
                  pendingConfirmation,
                  toolCalls: allToolCalls
                };
              }

              // Fallback if autoChoices failed
              lastListResult = {
                entity,
                data: queryResult.data
              };

              result = {
                success: true,
                data: queryResult.data,
                autoRecovered: true
              } as any;
            }
          }
        }

        // Track tool calls
        allToolCalls.push({
          name: functionName,
          args: functionArgs,
          result
        });

        // PERFORMANCE OPTIMIZATION: Immediately return when list results are available
        // Instead of making another LLM call to decide how to present, auto-inject the action now
        // This saves ~10-20 seconds per request by eliminating the second LLM round-trip
        if (functionName === 'execute_action' && functionArgs.action === 'list' && result.success) {
          const queryResult = result as { data?: Record<string, unknown>[] };

          if (queryResult.data && queryResult.data.length === 1) {
            // SINGLE RESULT: Auto-inject present_entity_card and return immediately
            const singleEntity = queryResult.data[0];
            const entityId = singleEntity.id as string;
            const entity = functionArgs.entity as string;

            logger.info(
              { userId: this.userId, entity, entityId },
              '[PERF] Fast-path: auto-injecting entity card for single list result'
            );

            // Execute present_entity_card to get formatted card with actions
            const cardResult = await this.executionLayer.execute('present_entity_card', {
              entityType: entity,
              entityId,
              entity: singleEntity
            });

            if (cardResult.success && 'action' in cardResult) {
              allActions.push(cardResult.action as any);
              allToolCalls.push({
                name: 'present_entity_card',
                args: { entityType: entity, entityId, entity: singleEntity },
                result: cardResult
              });

              // Return immediately - no second LLM call needed!
              return {
                message: '', // Card speaks for itself
                actions: allActions,
                pendingConfirmation,
                toolCalls: allToolCalls
              };
            }
          } else if (queryResult.data && queryResult.data.length > 1) {
            // MULTIPLE RESULTS: Auto-inject present_choices and return immediately
            const entity = functionArgs.entity as string;

            logger.info(
              { userId: this.userId, entity, resultCount: queryResult.data.length },
              '[PERF] Fast-path: auto-injecting choices for multiple list results'
            );

            const autoChoices = this.autoGeneratePresentChoices(
              entity,
              queryResult.data,
              pendingActionType,
              isHebrew
            );

            if (autoChoices) {
              allActions.push(autoChoices);

              // Return immediately - no second LLM call needed!
              return {
                message: autoChoices.prompt,
                actions: allActions,
                pendingConfirmation,
                toolCalls: allToolCalls
              };
            }
          }

          // Fallback: store for later if fast-path didn't work
          if (queryResult.data && queryResult.data.length >= 1) {
            lastListResult = {
              entity: functionArgs.entity as string,
              data: queryResult.data
            };
          }
        }

        // Handle navigation/modal actions
        if (result.success && 'action' in result) {
          // OVERRIDE: If LLM called present_entity_card but we have multiple list results,
          // force present_choices instead so user can choose
          if ((result.action as any).type === 'present_entity_card' && lastListResult && lastListResult.data.length > 1) {
            logger.info(
              { userId: this.userId, entity: lastListResult.entity, resultCount: lastListResult.data.length },
              'Overriding present_entity_card with present_choices because multiple results exist'
            );

            // Generate choices instead of showing just one entity
            const autoChoices = this.autoGeneratePresentChoices(
              lastListResult.entity,
              lastListResult.data,
              null, // No pending action for "open" requests
              isHebrew
            );

            if (autoChoices) {
              allActions.push(autoChoices);
              lastListResult = null;
              continue; // Skip adding the entity card
            }
          }

          allActions.push(result.action as any);

          // If LLM properly used present_choices, clear the lastListResult
          if ((result.action as any).type === 'present_choices') {
            lastListResult = null;
          }
        }

        // Handle pending confirmation - include actionType and entity for frontend rendering
        if (result.requiresConfirmation && 'confirmationId' in result) {
          const mutationResult = result as any;
          pendingConfirmation = {
            id: mutationResult.confirmationId as string,
            preview: mutationResult.preview as string,
            actionType: mutationResult.actionType || 'update',
            entity: mutationResult.pendingAction?.entity || functionArgs.entity || 'unknown'
          };
        }

        // Add tool result to messages
        currentMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(result)
        });
      }
    }

    // Final response if we hit the loop limit
    const finalCompletion = await openai.chat.completions.create({
      model: process.env.OPENAI_CHAT_MODEL || 'gpt-4o',
      messages: currentMessages
    });

    // If there's a pending confirmation, don't include LLM message
    const message = pendingConfirmation
      ? ''
      : (finalCompletion.choices[0]?.message?.content || '');

    return {
      message,
      actions: allActions,
      pendingConfirmation,
      toolCalls: allToolCalls
    };
  }

  /**
   * Auto-generate present_choices action from list results
   * This is a fallback when LLM returns text instead of using the present_choices tool
   */
  private autoGeneratePresentChoices(
    entity: string,
    data: Record<string, unknown>[],
    pendingAction: string | null,
    isHebrew: boolean
  ): { type: 'present_choices'; prompt: string; choices: Array<{ id: string; label: string; detail?: string }>; entityType: string; pendingAction?: string } | null {
    if (!data || data.length === 0) return null;

    const choices = data.map(item => {
      // Build label based on entity type
      let label = '';
      let detail = '';

      switch (entity) {
        case 'services':
          label = (item.service_name || item.name || 'Service') as string;
          if (item.price !== undefined && item.duration_minutes !== undefined) {
            // Include currency from item if available, fallback to ILS
            const currency = (item.currency || 'ILS') as string;
            detail = `${currency} ${item.price}, ${item.duration_minutes} ${isHebrew ? 'דק׳' : 'min'}`;
          }
          break;
        case 'contacts':
          const firstName = (item.first_name || '') as string;
          const lastName = (item.last_name || '') as string;
          label = `${firstName} ${lastName}`.trim() || (item.email as string) || 'Contact';
          if (item.email) detail = item.email as string;
          break;
        case 'tasks':
          label = (item.title || 'Task') as string;
          if (item.status) detail = item.status as string;
          break;
        case 'bookings':
          label = (item.service_name || item.client_first_name || 'Booking') as string;
          if (item.start_time) {
            const date = new Date(item.start_time as string);
            detail = date.toLocaleDateString(isHebrew ? 'he-IL' : 'en-US');
          }
          break;
        case 'invoices':
          label = isHebrew ? `חשבונית #${item.invoice_number || item.id}` : `Invoice #${item.invoice_number || item.id}`;
          if (item.total_amount !== undefined) {
            detail = `${item.total_amount}`;
          }
          break;
        default:
          label = (item.name || item.title || item.id || 'Item') as string;
      }

      return {
        id: item.id as string,
        label,
        detail: detail || undefined
      };
    });

    // Generate a localized prompt based on context and language
    const prompt = this.generateSelectionPrompt(entity, pendingAction, isHebrew);

    return {
      type: 'present_choices',
      prompt,
      choices,
      entityType: entity,
      pendingAction: pendingAction || undefined
    };
  }

  /**
   * Generate localized selection prompt
   */
  private generateSelectionPrompt(entity: string, pendingAction: string | null, isHebrew: boolean): string {
    // Entity labels in both languages
    const entityLabels: Record<string, { en: string; he: string }> = {
      services: { en: 'service', he: 'שירות' },
      contacts: { en: 'contact', he: 'איש קשר' },
      tasks: { en: 'task', he: 'משימה' },
      bookings: { en: 'booking', he: 'פגישה' },
      invoices: { en: 'invoice', he: 'חשבונית' }
    };

    // Action labels in both languages
    const actionLabels: Record<string, { en: string; he: string }> = {
      deactivate: { en: 'deactivate', he: 'להשבית' },
      activate: { en: 'activate', he: 'להפעיל' },
      delete: { en: 'delete', he: 'למחוק' },
      update: { en: 'update', he: 'לעדכן' },
      complete: { en: 'complete', he: 'להשלים' },
      cancel: { en: 'cancel', he: 'לבטל' }
    };

    const entityLabel = entityLabels[entity] || { en: entity.replace(/s$/, ''), he: entity };
    const label = isHebrew ? entityLabel.he : entityLabel.en;

    if (pendingAction) {
      const actionLabel = actionLabels[pendingAction] || { en: pendingAction, he: pendingAction };
      const action = isHebrew ? actionLabel.he : actionLabel.en;

      return isHebrew
        ? `בחר ${label} ${action}:`
        : `Select ${label} to ${action}:`;
    }

    return isHebrew
      ? `בחר ${label}:`
      : `Select a ${label}:`;
  }

  /**
   * Handle confirmation of a pending mutation
   */
  private async handleConfirmation(
    confirmationId: string,
    userMessage: string,
    isHebrew: boolean
  ): Promise<AIDataLayerResponse> {
    const isConfirmed = this.isConfirmationMessage(userMessage);
    const isCancelled = this.isCancellationMessage(userMessage);

    if (isConfirmed) {
      const result = await this.executionLayer.confirmMutation(confirmationId);

      if (result.success) {
        return {
          message: isHebrew ? 'בוצע! הפעולה הושלמה בהצלחה.' : 'Done! The operation was completed successfully.',
          actions: []
        };
      } else {
        const errorPrefix = isHebrew ? 'הפעולה נכשלה:' : 'Operation failed:';
        return {
          message: `${errorPrefix} ${result.error}`,
          actions: []
        };
      }
    }

    if (isCancelled) {
      this.executionLayer.cancelMutation(confirmationId);
      return {
        message: isHebrew ? 'הפעולה בוטלה.' : 'Operation cancelled.',
        actions: []
      };
    }

    // User said something else - treat as a new/modified request
    // Cancel the pending mutation and process the new intent
    this.executionLayer.cancelMutation(confirmationId);
    return this.processMessage({ message: userMessage });
  }

  /**
   * Check if message is a confirmation
   */
  private isConfirmationMessage(message: string): boolean {
    const confirmPatterns = [
      /^(yes|yeah|yep|sure|ok|okay|confirm|approved|do it|go ahead|אישור|כן|בסדר|אוקיי)$/i,
      /^(yes|כן)/i
    ];
    const normalized = message.trim().toLowerCase();
    return confirmPatterns.some(pattern => pattern.test(normalized));
  }

  /**
   * Check if message is a cancellation
   */
  private isCancellationMessage(message: string): boolean {
    const cancelPatterns = [
      /^(no|nope|cancel|stop|abort|never ?mind|לא|ביטול|בטל|לא רוצה)$/i
    ];
    const normalized = message.trim().toLowerCase();
    return cancelPatterns.some(pattern => pattern.test(normalized));
  }

  /**
   * Convert our ChatMessage to OpenAI format
   */
  private convertToOpenAIMessage(
    msg: ChatMessage
  ): OpenAI.Chat.ChatCompletionMessageParam {
    if (msg.role === 'tool' && msg.tool_call_id) {
      return {
        role: 'tool',
        tool_call_id: msg.tool_call_id,
        content: msg.content
      };
    }

    if (msg.role === 'assistant' && msg.tool_calls) {
      return {
        role: 'assistant',
        content: msg.content,
        tool_calls: msg.tool_calls.map(tc => ({
          id: tc.id,
          type: tc.type as 'function',
          function: tc.function
        }))
      };
    }

    return {
      role: msg.role as 'user' | 'assistant' | 'system',
      content: msg.content
    };
  }
}

// Factory function
export function createAIDataLayerService(userId: string): AIDataLayerService {
  return new AIDataLayerService(userId);
}
