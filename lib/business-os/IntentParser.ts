/**
 * IntentParser - LLM-based intent extraction for chat commands
 * Uses the provider factory to parse natural language into structured intents
 *
 * Features:
 * - Capabilities auto-generated from CapabilityRegistry
 * - Message history for multi-turn conversation context
 */

import { ProviderFactory } from '@/lib/ai/providerFactory';
import { ParsedIntent, IntentType } from './DraftManagerTypes';
import { createLogger } from '@/lib/logger';
import { generateCapabilityPrompt } from './CapabilityRegistry';

const logger = createLogger({ module: 'IntentParser' });

// Chat message type for history
export interface ChatHistoryMessage {
  type: 'user' | 'ai';
  content: string;
}

// Build system prompt dynamically from capability registry
function buildSystemPrompt(): string {
  return `You are an intelligent multilingual business assistant. Your job is to understand what the user wants to do and map it to one of the available business capabilities.

You understand ALL languages natively. Interpret the user's INTENT, not just keywords.

${generateCapabilityPrompt()}
unknown - ONLY use if the request is completely unrelated to running a business

ENTITY EXTRACTION:
- Currency: Detect from symbols ($=USD, ₪=ILS, €=EUR, £=GBP) or words
- Duration: Convert to minutes (1 hour=60, 1.5 hours=90)
- Time: Convert to 24h format when possible (2pm→14:00, 5pm→17:00)
- Days: Use English day names (monday, tuesday, etc.)
- Dates: Parse relative dates (tomorrow, next week, in 3 days)

CONVERSATION CONTEXT:
- You will receive recent conversation history to understand context
- Use previous messages to resolve ambiguous references
- If user says "change the end time" - look at history to see which day/service they were discussing

STRICT EXTRACTION RULES (CRITICAL):
- ONLY extract information EXPLICITLY mentioned by the user
- NEVER add, infer, or guess additional details (no last names, no extra info)
- For names: Extract ONLY what the user typed - if they say "שרה", return just "Sara" (transliterated), NOT "Sarah Johnson"
- If user gives first name only, return first name only - do NOT add a last name
- Transliterate Hebrew names to English spelling (שרה→Sara, דוד→David, יוסי→Yossi)

GENERAL RULES:
- Be GENEROUS with confidence (0.7+ for anything business-related)
- Detect language and return in "language" field (en, he, es, ar, etc.)
- NEVER return "unknown" for business commands - pick the closest capability
- Understand context and synonyms naturally

OUTPUT (JSON only):
{"intent":"<capability>","entities":{...},"confidence":0.X,"confirmRequired":false,"language":"xx"}
`;
}

export interface IntentParserOptions {
  userId: string;
  history?: ChatHistoryMessage[]; // Recent conversation history for context
  context?: {
    currentPage?: string;
    selectedItems?: string[];
    existingServices?: { id: string; name: string }[];
    existingContacts?: { id: string; name: string }[];
    pendingAvailabilityDays?: string[]; // Days from previous availability question
  };
}

/**
 * Parse a user message into a structured intent
 * Now accepts message history for multi-turn conversation context
 */
export async function parseIntent(
  message: string,
  options: IntentParserOptions
): Promise<ParsedIntent> {
  const { userId, context, history = [] } = options;

  try {
    const provider = ProviderFactory.getProvider('openai');

    // Build context-aware additions to system prompt
    let contextAdditions = '';
    if (context?.existingServices?.length) {
      contextAdditions += `\nExisting services: ${context.existingServices.map(s => s.name).join(', ')}`;
    }
    if (context?.existingContacts?.length) {
      contextAdditions += `\nExisting contacts: ${context.existingContacts.map(c => c.name).join(', ')}`;
    }

    // Build messages array with conversation history
    const systemPrompt = buildSystemPrompt() + contextAdditions;

    // Include last 6 messages for context (3 exchanges)
    const recentHistory = history.slice(-6);
    const historyMessages = recentHistory.map(h => ({
      role: h.type === 'user' ? 'user' as const : 'assistant' as const,
      content: h.content,
    }));

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      ...historyMessages,
      { role: 'user' as const, content: message },
    ];

    logger.debug({ historyLength: recentHistory.length, messageLength: message.length }, 'Parsing intent with history');

    const response = await provider.chatCompletion(
      {
        model: 'gpt-4o-mini', // Fast and cheap for parsing
        messages,
        temperature: 0.1, // Low temperature for consistent parsing
        max_tokens: 500,
        response_format: { type: 'json_object' }, // Force JSON output
      },
      {
        userId,
        feature: 'business-os-chat',
        component: 'IntentParser',
      }
    );

    logger.info({ responseContent: response.choices[0]?.message?.content?.substring(0, 200) }, 'LLM response received');

    const content = response.choices[0]?.message?.content?.trim();
    if (!content) {
      throw new Error('Empty response from LLM');
    }

    // Parse JSON response
    const parsed = JSON.parse(content);

    // Validate required fields
    if (!parsed.intent || typeof parsed.confidence !== 'number') {
      throw new Error('Invalid response structure');
    }

    return {
      intent: parsed.intent as IntentType,
      entities: parsed.entities || {},
      confidence: parsed.confidence,
      confirmRequired: parsed.confirmRequired ?? false,
      rawText: message,
      language: parsed.language || 'en',
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error({ err: error, message, errorMessage }, 'Failed to parse intent');

    // Return unknown intent on error with slightly higher confidence
    // so user sees "unknown" handler instead of "low confidence" fallback
    return {
      intent: 'unknown',
      entities: { _error: errorMessage },
      confidence: 0.5, // Above threshold so executor handles it
      confirmRequired: false,
      rawText: message,
    };
  }
}

/**
 * Generate a natural language response based on the intent and result
 */
export function generateResponse(
  intent: ParsedIntent,
  success: boolean,
  entityName?: string
): string {
  const { intent: intentType, entities } = intent;

  if (!success) {
    return "I couldn't complete that action. Please try again or rephrase your request.";
  }

  switch (intentType) {
    case 'service.create':
      return `Added <b>${entities.service_name || 'new service'}</b> (${entities.duration_minutes || 60} min · ${entities.is_free ? 'Free' : `$${entities.price || 0}`}). See it in the preview — nothing's live until you publish.`;

    case 'service.update':
      return `Updated <b>${entityName || entities.service_name || 'the service'}</b>. Check the preview to see your changes.`;

    case 'service.delete':
      return `Removed <b>${entityName || entities.service_name || 'the service'}</b>. Tap Discard if that was a mistake.`;

    case 'availability.update':
      const days = entities.days?.join(', ') || 'selected days';
      return `Updated your availability for ${days}. Your booking page will show the new hours once you publish.`;

    case 'contact.add':
      return `Added <b>${entities.first_name || ''} ${entities.last_name || ''}</b> to your contacts.`;

    case 'contact.update':
      return `Updated <b>${entityName || entities.contact_name || 'the contact'}</b>.`;

    case 'invoice.create':
      return `Created a draft invoice for <b>$${entities.amount || 0}</b>. Review it in the preview before sending.`;

    case 'report.query':
      return `Here's your ${entities.metric || 'report'} for ${entities.period || 'the selected period'}.`;

    case 'navigate':
      return `Opening ${entities.destination || 'the page'}...`;

    case 'preview.switch':
      return `Showing ${entities.context || 'the preview'}...`;

    default:
      return "I've processed your request. Check the preview to see the changes.";
  }
}

/**
 * Get suggested quick actions based on current context
 */
export function getSuggestions(
  previewContext: string,
  hasDrafts: boolean
): string[] {
  const baseSuggestions = hasDrafts ? ['Review changes', 'Discard all'] : [];

  switch (previewContext) {
    case 'services':
      return [...baseSuggestions, 'Add a service', 'Change a price', 'Set my hours'];
    case 'crm':
      return [...baseSuggestions, 'Add a contact', 'View pipeline', 'Follow up'];
    case 'payments':
      return [...baseSuggestions, 'Send invoice', 'Check pending'];
    case 'reports':
      return [...baseSuggestions, 'This week revenue', 'Compare months'];
    default:
      return baseSuggestions;
  }
}
