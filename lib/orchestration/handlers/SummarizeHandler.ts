/**
 * SummarizeHandler
 *
 * Handler for summarization intents
 * Optimized for condensing content while preserving key information
 */

import { BaseHandler } from './BaseHandler';
import type { HandlerContext, HandlerResult, IntentType } from '../types';

export class SummarizeHandler extends BaseHandler {
  intent: IntentType = 'summarize';

  constructor() {
    super();
  }

  async handle(context: HandlerContext): Promise<HandlerResult> {
    const startTime = Date.now();

    try {
      // Validate context
      const isValid = await this.validate(context);
      if (!isValid) {
        return this.createErrorResult('Invalid handler context');
      }

      // Resolve variables in input
      const resolvedInput = this.resolveInputVariables(context);

      // Apply preprocessing to clean data and extract metadata
      const { data: cleanedData, metadata } = await this.applyPreprocessing(resolvedInput);

      // Prepare input for LLM
      const input = this.safeStringify(cleanedData);

      // Estimate token usage
      const inputTokens = this.estimateTokenCount(input);
      const estimatedTokens = inputTokens + 800; // Summaries need more output tokens
      if (!this.checkBudget(context, estimatedTokens)) {
        return this.createErrorResult('Insufficient budget for summarization');
      }

      // Prepare prompts
      const { system, user } = this.formatPrompt(
        this.buildSystemPrompt(context),
        input,
        context
      );

      // Calculate dataset size for smart metadata filtering
      const dataSize = Array.isArray(cleanedData) ? cleanedData.length : 0;

      // Inject preprocessing metadata facts into user prompt
      const enrichedUser = this.injectPreprocessingFacts(user, metadata, dataSize);

      // Execute summarization using provider-agnostic method
      const llmResponse = await this.callLLM(
        context,
        system,
        enrichedUser, // Use enriched prompt with metadata facts
        0.5, // Moderate temperature for balanced creativity
        Math.min(context.budget.remaining, 2048)
      );

      // Parse response
      const output = llmResponse.text;

      // Extract clean summary by removing meta-commentary and narrative
      const cleanSummary = this.extractCleanSummary(output);

      // Calculate actual token usage
      const tokensUsed = {
        input: llmResponse.inputTokens,
        output: llmResponse.outputTokens,
      };

      // Use cost from provider
      const cost = llmResponse.cost;

      // Create success result
      const result = this.createSuccessResult(
        {
          result: cleanSummary,   // PRIMARY field - matches StepExecutor and Stage 1 expectations
          response: cleanSummary, // Alias for compatibility
          output: cleanSummary,   // Alias for compatibility
          summary: cleanSummary,  // Semantic alias (Stage 1 mentions this for summarization)
          originalLength: inputTokens,
          summaryLength: tokensUsed.output,
          compressionRatio: 1 - (tokensUsed.output / inputTokens),
        },
        tokensUsed,
        cost,
        Date.now() - startTime,
        {
          model: context.routingDecision.model,
          provider: context.routingDecision.provider,
        }
      );

      this.logExecution(context, result, Date.now() - startTime);

      return result;
    } catch (error) {
      console.error('[SummarizeHandler] Execution error:', error);
      return this.createErrorResult(error instanceof Error ? error : 'Unknown error');
    }
  }

  /**
   * Build system prompt for summarization
   * ✅ OPTIMIZED: Simplified to reduce token overhead (~150 tokens vs ~300)
   * ✅ FIXED: Explicitly instruct to output ONLY the summary content
   * ✅ ENHANCED: Provide more detailed guidance for comprehensive summaries
   * ✅ ENRICHED: Maximum detail extraction with context and insights
   */
  private buildSystemPrompt(context: HandlerContext): string {
    const targetLength = this.extractTargetLength(context);

    return `You are an expert summarization specialist. Create rich, comprehensive summaries that capture every important detail and provide context.

Core Principles:
- Extract and include EVERY significant detail (dates, times, amounts, names, locations, etc.)
- Add contextual information that helps understand the importance or relevance
- Organize logically with clear categories and subcategories
- Include specific numbers, percentages, and quantifiable data
- Preserve tone and urgency when relevant
- Note patterns, trends, or unusual items
${targetLength ? `- Target length: ~${targetLength} words (be thorough)` : '- Prioritize completeness over brevity'}

What to Include:
1. WHO: People, organizations, senders involved
2. WHAT: Specific actions, events, transactions
3. WHEN: Exact dates, times, deadlines, durations
4. WHERE: Locations, addresses, platforms
5. HOW MUCH: Amounts, quantities, prices
6. WHY: Purpose, context, reasoning (when evident)
7. STATUS: Current state, next steps, pending items

Structure Guidelines:
- Use clear category headers
- List items with bullet points
- Include sub-bullets for additional details
- Add brief context notes in parentheses when helpful
- Group related items together
- Prioritize by importance or urgency

CRITICAL: Output ONLY the summary content itself. Do NOT include:
- Meta-commentary like "I will now...", "Let me...", "Here is..."
- Narrative about what you're doing or next steps
- Just deliver the pure, rich summary content directly

Example of EXCELLENT output:
"Analysis of your last 10 emails received between Nov 12-13, 2025:

🔴 URGENT / ACTION REQUIRED:
(None identified)

💰 Financial Transactions (2 transfers totaling $5,197.46):
- Nov 13, 2025: Chase transfer of $132.13 sent to account ending in 1234
  (Early morning transaction)
- Nov 12, 2025: Chase transfer of $5,065.33 sent to account ending in 1556
  (Large transfer - possible significant payment or investment)

📱 Subscriptions & Recurring Charges:
- Apple/NBA: NBA Live Games & Scores League Pass Premium Monthly
  • Current charge processed successfully
  • Next renewal: December 8, 2025
  • Monthly subscription (monitor for auto-renewal)

🅿️ Reservations & Bookings:
- SpotHero Parking: November 12, 2025 reservation confirmed
  • Location: 385 W 15th St - Valet (111 8th Ave Garage, Manhattan)
  • Status: Confirmed and active
  • Consider: Check confirmation details before arrival

💬 Team Communications:
- Slack: 1 unread message in AgentPilot workspace
  • Requires attention when convenient
  • May contain team updates or requests

📊 Summary Statistics:
- Total emails: 10
- Financial: 2 transactions ($5,197.46)
- Subscriptions: 1 active
- Reservations: 1 confirmed
- Pending actions: 1 Slack message to review"

Example of POOR output:
"You have some emails about money and subscriptions. I will now send this summary to you."`;
  }

  /**
   * Extract target length from input if specified
   */
  private extractTargetLength(context: HandlerContext): number | null {
    // ✅ Use extractInputData to avoid circular references
    const inputData = this.extractInputData(context);

    if (typeof inputData === 'object' && inputData.targetLength) {
      return parseInt(inputData.targetLength);
    }

    const inputStr = this.safeStringify(inputData);
    const lengthMatch = inputStr.match(/(\d+)\s*(words?|tokens?)/i);
    if (lengthMatch) {
      return parseInt(lengthMatch[1]);
    }

    return null;
  }

  /**
   * Extract clean summary content by removing meta-commentary and narrative
   * ✅ CRITICAL FIX: Prevents duplicate summaries in email output
   */
  private extractCleanSummary(output: string): string {
    let cleaned = output;

    // Remove leading meta-commentary patterns (from start of text)
    const leadingPatterns = [
      /^I will (now )?analyze[^\n]*(\n\n|\n)/i,
      /^I will (now )?summarize[^\n]*(\n\n|\n)/i,
      /^Let me (now )?analyze[^\n]*(\n\n|\n)/i,
      /^Let me (now )?summarize[^\n]*(\n\n|\n)/i,
      /^Now,? I will send[^\n]*(\n\n|\n)/i,
      /^I will (now )?send[^\n]*(\n\n|\n)/i,
      /^Executing[^\n]*(\n\n|\n)/i,
      /^Processing[^\n]*(\n\n|\n)/i,
    ];

    for (const pattern of leadingPatterns) {
      cleaned = cleaned.replace(pattern, '');
    }

    // Remove trailing meta-commentary patterns (from end of text)
    // Split into sections first to avoid regex complexity
    const sections = cleaned.split(/\n\n+/);
    const cleanedSections = sections.filter(section => {
      const lower = section.toLowerCase().trim();
      // Remove sections that are purely narrative about sending
      if (lower.startsWith('now,') && lower.includes('send')) return false;
      if (lower.startsWith('i will') && lower.includes('send')) return false;
      if (lower.startsWith('let me send')) return false;
      if (lower.startsWith('### sending')) return false;
      if (lower.startsWith('---') && lower.includes('send')) return false;
      return true;
    });

    cleaned = cleanedSections.join('\n\n');

    // Trim whitespace
    cleaned = cleaned.trim();

    // If the cleaning removed too much (less than 50 chars), return original
    // This prevents over-aggressive cleaning
    if (cleaned.length < 50) {
      console.warn('[SummarizeHandler] Clean summary too short, using original output');
      return output;
    }

    console.log(`[SummarizeHandler] Cleaned summary: ${cleaned.length} chars (was ${output.length} chars)`);

    return cleaned;
  }
}
