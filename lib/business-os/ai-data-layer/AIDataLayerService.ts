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
  type ActiveEntity,
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
import { generateSemanticFilterInstruction } from './semantic-schema';
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
    const { message, conversationHistory, pendingConfirmationId, activeEntity } = request;

    logger.info({
      userId: this.userId,
      messageLength: message.length,
      hasActiveEntity: !!activeEntity,
      activeEntityType: activeEntity?.type
    }, 'Processing AI data layer request');

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

      // Build system prompt with context (including active entity if present)
      const systemPrompt = this.buildSystemPrompt(context, activeEntity);

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
   * Build the system prompt with user context and optional active entity
   */
  private buildSystemPrompt(context: UserContext, activeEntity?: ActiveEntity): string {
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

${this.buildActiveEntityContext(activeEntity, isHebrew)}

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

## CRITICAL: Response Formatting - ALWAYS USE LINE BREAKS

Your responses MUST be easy to read. ALWAYS use newlines (\\n) to separate:
- Headers from content
- Each numbered list item
- Paragraphs
- Questions from context

REQUIRED format when asking for information:

[Header]

[Context explaining what you need]

1. First item
2. Second item
3. Third item

[Final question]

Example (Hebrew) - note the LINE BREAKS:
"שינוי שם שירות

כדי לשנות את שם השירות, אני צריך לדעת:

1. שם השירות הנוכחי
2. השם החדש שתרצה לתת לשירות

תוכל לספק את המידע הזה?"

Example (Hebrew) - creating service:
"הוסף שירות חדש

כדי להוסיף שירות חדש, אני אצטרך:

1. שם השירות
2. מחיר השירות (ב-ILS)
3. משך זמן השירות (בדקות)

מה הפרטים?"

Example success confirmation:
"✓ בוצע!

התאריך עודכן ל-15 ביולי 2024."

BAD (unreadable): "שינוי שם שירות כדי לשנות את שם השירות, אני אהיה צריך לדעת: 1. שם השירות הנוכחי 2. השם החדש שתרצה לתת לשירות תוכל לספק את המידע הזה?"
GOOD: Use line breaks between header, explanation, list items, and question.

NEVER use markdown (**, #, etc.) - use plain text with actual newline characters.

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
- bookings: use { search: "client_name" } to search by client first/last name
- tasks: use { search: "task_title" } to search by title/description
- invoices: use { search: "invoice_number" } to search by invoice number

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
- AI calls: present_entity_card with the selected service data

## Meetings, Appointments & Schedule
When user asks about meetings, appointments, schedule ("מתי הפגישה הבאה שלי", "when is my next meeting", "מה יש לי היום"):

IMPORTANT: Always filter for FUTURE bookings using start_date filter!
Today's date: ${new Date().toISOString().split('T')[0]}

→ Query FUTURE bookings: execute_action(entity: "bookings", action: "list", filters: { status: "confirmed", start_date: "${new Date().toISOString().split('T')[0]}" })

**CRITICAL - HOW TO DISPLAY BOOKINGS:**
After getting booking results, ALWAYS use the present_booking_list tool to display them as beautiful cards.
DO NOT use present_choices, present_entity_card, or plain text for bookings.

**IMPORTANT - AVOID DUPLICATE DISPLAY:**
When you use present_booking_list, your text response should be SHORT and NOT list the bookings again!
The cards already show all the details - don't repeat them in text.

✅ Good text response: "הנה הפגישות הקרובות שלך:" or "Here are your upcoming meetings:"
❌ Bad text response: "הנה הפגישות שלך: 1. שיחת מעקב עם... 2. מפגש עם..." (this duplicates the cards!)

Example flow:
1. execute_action(entity: "bookings", action: "list", filters: {...}) → get bookings array
2. present_booking_list(bookings: [...]) → display as styled cards
3. Text response: Just a brief intro like "הנה הפגישות הקרובות:" - DO NOT list booking details in text!

If no bookings found, respond with: "אין לך פגישות קרובות." / "You have no upcoming meetings."

**TIMEZONE WARNING:** The start_time in database is stored in UTC. The cards will display correct local time.
When mentioning times in your text response, DO NOT include specific times - let the cards show them.

## Booking Actions (Reschedule, Cancel)
Booking cards have action buttons that users can click directly. When showing bookings:
- The cards include "Reschedule" and "Cancel" buttons
- Users click these buttons to take action - no need for multi-step chat flows
- If user types "reschedule" or "cancel" without context, show their bookings first so they can use the buttons

For natural language rescheduling ("reschedule Offir's booking to 3pm"):
1. List bookings with search filter: execute_action(entity: "bookings", action: "list", filters: { search: "Offir" })
2. Present the bookings with their action buttons
3. Let the user click the Reschedule button on the correct booking

## Counting Entities with Date Filters
When user asks "how many X today/this week/this month" ("כמה לקוחות נוספו היום"):

Use the count action with date filters:
→ execute_action(entity: "contacts", action: "count", filters: { created_at_gte: "YYYY-MM-DD" })

Date filters:
- created_at_gte: Greater than or equal to this date (start of range)
- created_at_lte: Less than or equal to this date (end of range)

Example for "contacts added today":
Today's date: ${new Date().toISOString().split('T')[0]}
→ execute_action(entity: "contacts", action: "count", filters: { created_at_gte: "${new Date().toISOString().split('T')[0]}" })

Example response:
"נוספו 5 לקוחות היום" / "5 contacts were added today"

## CRITICAL: Multi-Turn Update Flows

When updating an entity (rename, change price, etc.), follow this EXACT pattern:

**STEP 1 - User requests update** (e.g., "שנה שם שירות" / "rename service"):
- If entity not specified: List entities and ask user to select
- If entity has "[ID: xxx]": Use that ID directly

**STEP 2 - Gather missing info** (e.g., user selected "Discovery Call [ID: abc-123]"):
- Ask ONLY for the missing value: "מה השם החדש?" / "What's the new name?"

**STEP 3 - User provides the new value** (e.g., "פגישת היכרות"):
- THIS IS THE VALUE! Execute the update IMMEDIATELY!
- Do NOT show entity card
- Do NOT ask any more questions
- Call: execute_action(entity: "services", action: "update", id: "abc-123", data: { service_name: "פגישת היכרות" })

WRONG: User says "פגישת היכרות" → Show entity card (user did NOT ask to view!)
CORRECT: User says "פגישת היכרות" → Execute update with that as the new name

**Field mapping for services:**
- "שנה שם" / "rename" → field: service_name
- "שנה מחיר" / "change price" → field: price
- "שנה משך" / "change duration" → field: duration_minutes

**Field mapping for tasks:**
- "שנה תאריך" / "change date" → field: due_date
- "שנה כותרת" / "rename" → field: title
- "שנה עדיפות" / "change priority" → field: priority

**Field mapping for contacts:**
- "שנה שם" / "rename" → fields: first_name, last_name
- "שנה אימייל" / "change email" → field: email
- "שנה טלפון" / "change phone" → field: phone

## CRITICAL: Finding Entities by Name for Updates

When user references an entity by name (not ID), you MUST search first:

**Tasks by title**: "complete task Follow-up Call" / "סיים משימה שיחת מעקב"
1. execute_action(entity: "tasks", action: "list", filters: { search: "Follow-up Call" })
2. If ONE match: Use the task ID for complete/update
3. If MULTIPLE: present_choices for user to select

**Invoices by number**: "show invoice 123" / "הצג חשבונית 123"
1. execute_action(entity: "invoices", action: "list", filters: { search: "123" })
2. If ONE match: present_entity_card with full invoice data
3. If MULTIPLE: present_choices for user to select

NEVER guess or make up entity IDs! Always search first when user references by name/number.

${generateSemanticFilterInstruction()}`;
  }

  /**
   * Build context section for active entity (when user is viewing an entity card)
   * This enables context-aware follow-ups like "change the date" or "whose is this"
   */
  private buildActiveEntityContext(activeEntity?: ActiveEntity, isHebrew?: boolean): string {
    if (!activeEntity) {
      return '';
    }

    const { type, id, data } = activeEntity;

    // Get display name for the entity
    let entityName = '';
    switch (type) {
      case 'tasks':
        entityName = (data.title as string) || 'Task';
        break;
      case 'contacts':
        const firstName = (data.first_name || '') as string;
        const lastName = (data.last_name || '') as string;
        entityName = `${firstName} ${lastName}`.trim() || (data.email as string) || 'Contact';
        break;
      case 'services':
        entityName = (data.service_name || data.name || 'Service') as string;
        break;
      case 'bookings':
        entityName = (data.service_name || 'Booking') as string;
        break;
      case 'invoices':
        entityName = `Invoice #${data.invoice_number || id}`;
        break;
    }

    // Format entity data for context (exclude very long or binary fields)
    const safeData = { ...data };
    delete safeData.notes; // Can be very long
    delete safeData.description;
    const entityDataStr = JSON.stringify(safeData, null, 2);

    const hebrewFieldMappings = `
FIELD MAPPINGS (Hebrew → Field):
- "תאריך", "מועד", "דדליין" → due_date
- "כותרת", "שם" → title
- "סטטוס", "מצב" → status
- "עדיפות", "דחיפות" → priority
- "של מי", "איש קשר" → contact_id (lookup contact name)
- "תיאור" → description

DATE PARSING (Hebrew):
- "מחר" → tomorrow's date
- "בעוד שבוע" → date + 7 days
- "15 לחודש" → specific date this/next month`;

    const englishFieldMappings = `
FIELD MAPPINGS:
- "date", "due date", "deadline" → due_date
- "title", "name" → title
- "status" → status
- "priority" → priority
- "owner", "assigned to", "whose" → contact_id (lookup contact name)

DATE PARSING:
- "tomorrow" → tomorrow's date
- "next week" → date + 7 days
- "the 15th" → specific date this/next month`;

    return `
## CURRENT CONTEXT - ACTIVE ENTITY
⚠️ CRITICAL: The user is currently viewing this ${type.slice(0, -1)}:

**${entityName}** (ID: ${id})
\`\`\`json
${entityDataStr}
\`\`\`

When the user says things like:
- "change the date" / "שנה תאריך" → Update THIS entity's due_date
- "mark complete" / "סמן כהושלם" → Complete THIS entity
- "whose is this" / "של מי זה" → Look up contact_id on THIS entity
- "delete it" / "מחק את זה" → Delete THIS entity

USE THE ID DIRECTLY - do NOT search again. The entity context is already provided above.

${isHebrew ? hebrewFieldMappings : englishFieldMappings}
`;
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
    const allActions = ['list', 'get', 'count', 'create', 'update', 'delete', 'deactivate', 'activate', 'complete', 'cancel', 'publish', 'send'];

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
      },
      {
        type: 'function',
        function: {
          name: 'present_booking_list',
          description: `Present a list of bookings/meetings as beautiful styled cards in the chat.

USE THIS TOOL when:
- User asks about their meetings, schedule, or appointments
- You have queried bookings and need to display the results
- User says "מתי הפגישה הבאה שלי", "when is my next meeting", "מה יש לי היום"

DO NOT use present_choices or present_entity_card for bookings - ALWAYS use this tool.
Each booking will be displayed as a styled card with date, time, service name, and contact.

IMPORTANT: When using this tool, your text response should be VERY SHORT (e.g., "הנה הפגישות:" or "Here are your meetings:").
DO NOT list the bookings in text - the cards already display all details. Avoid duplicate information!`,
          parameters: {
            type: 'object',
            properties: {
              bookings: {
                type: 'array',
                description: 'Array of booking objects from the list query result',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', description: 'Booking ID' },
                    start_time: { type: 'string', description: 'Start time in ISO format' },
                    end_time: { type: 'string', description: 'End time in ISO format (optional)' },
                    status: { type: 'string', description: 'Booking status' },
                    service_name: { type: 'string', description: 'Name of the service' },
                    client_first_name: { type: 'string', description: 'Client first name' },
                    client_last_name: { type: 'string', description: 'Client last name' },
                    client_email: { type: 'string', description: 'Client email' },
                    client_phone: { type: 'string', description: 'Client phone' }
                  },
                  required: ['id', 'start_time']
                }
              }
            },
            required: ['bookings']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'reschedule_booking',
          description: `Reschedule a booking to a new time. This tool:
1. Checks availability for the new time slot
2. Verifies no conflicts with other bookings
3. Updates start_time and end_time (maintaining the same duration)
4. Returns confirmation or suggests available alternatives

Use when user says "change the meeting to 12:00", "reschedule to tomorrow at 3pm", "שנה את הפגישה לשעה 12".

IMPORTANT:
- You must have the booking ID (from activeEntity or from a previous booking query)
- Provide the new_start_time in ISO format with the user's timezone offset
- If the slot is not available, the tool will return available alternatives`,
          parameters: {
            type: 'object',
            properties: {
              booking_id: {
                type: 'string',
                description: 'The UUID of the booking to reschedule'
              },
              new_start_time: {
                type: 'string',
                description: 'New start time in ISO 8601 format (e.g., "2026-07-31T12:00:00+03:00")'
              }
            },
            required: ['booking_id', 'new_start_time']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'update_entity_field',
          description: `Update a single field on an entity. Use this for quick inline edits when:
- User says "change the date to tomorrow" → update due_date
- User says "rename it to X" → update title/name
- User says "set priority to high" → update priority
- User says "mark as done" → update status to completed

IMPORTANT: Only use when you have the entity ID from activeEntity context or from a previous selection.
For safe fields (title, due_date, priority, status, description), changes are applied immediately.
For destructive changes (delete), use execute_action with delete instead.
For rescheduling bookings, use the reschedule_booking tool instead.`,
          parameters: {
            type: 'object',
            properties: {
              entityType: {
                type: 'string',
                enum: ['tasks', 'contacts', 'services', 'bookings', 'invoices'],
                description: 'The type of entity to update'
              },
              entityId: {
                type: 'string',
                description: 'The entity UUID to update'
              },
              field: {
                type: 'string',
                description: 'The field name to update (e.g., due_date, title, status, priority)'
              },
              value: {
                description: 'The new value for the field. For dates, use ISO format (YYYY-MM-DD).'
              }
            },
            required: ['entityType', 'entityId', 'field', 'value']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'update_availability',
          description: `Update business availability/working hours. Use when user wants to:
- Change working hours: "I work 9-5 on weekdays"
- Add availability for specific days: "Open on Sunday 10:00-14:00"
- Remove availability (close a day): "Close on Saturday" / "לא עובד בשבת"
- Set hours for multiple days: "Monday to Friday 09:00-17:00"

Requires confirmation before applying changes.

Day names accepted (English & Hebrew):
- sunday/ראשון, monday/שני, tuesday/שלישי, wednesday/רביעי, thursday/חמישי, friday/שישי, saturday/שבת`,
          parameters: {
            type: 'object',
            properties: {
              days: {
                type: 'array',
                items: { type: 'string' },
                description: 'Days to update (e.g., ["monday", "tuesday", "wednesday"])'
              },
              hours: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    start: { type: 'string', description: 'Start time in HH:MM format (e.g., "09:00")' },
                    end: { type: 'string', description: 'End time in HH:MM format (e.g., "17:00")' }
                  },
                  required: ['start', 'end']
                },
                description: 'Time slots for the specified days'
              },
              clear_day: {
                type: 'string',
                description: 'Day to mark as closed/unavailable (alternative to setting hours)'
              }
            }
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'get_revenue_stats',
          description: `Get revenue statistics and payment information. Use when user asks about:
- Total revenue/income: "מה ההכנסות שלי", "how much did I make"
- Revenue for time period: "revenue this week/month", "הכנסות החודש"
- Payment stats: "how many paid invoices", "כמה חשבוניות שולמו"

Returns: total revenue, number of transactions, paid invoices count for the period.`,
          parameters: {
            type: 'object',
            properties: {
              period: {
                type: 'string',
                enum: ['today', 'this_week', 'this_month', 'last_30_days', 'all_time'],
                description: 'Time period for revenue stats'
              }
            }
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
        // EXCEPTION: Skip for bookings - they should be displayed as text
        if (lastListResult && lastListResult.data.length > 1 && lastListResult.entity !== 'bookings' && !allActions.some(a => a.type === 'present_choices')) {
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
            // EXCEPTION: For bookings, let the LLM format them as text (no choices UI)
            const entity = functionArgs.entity as string;

            if (entity === 'bookings') {
              // Skip auto-choices for bookings - LLM will format as text list
              logger.info(
                { userId: this.userId, entity, resultCount: queryResult.data.length },
                'Skipping auto-choices for bookings - will format as text'
              );
            } else {
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
