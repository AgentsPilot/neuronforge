// lib/ai/providers/groqProvider.ts
// Groq provider for ultra-fast, free AI inference
import { BaseAIProvider, CallContext } from './baseProvider';
import { AIAnalyticsService } from '@/lib/analytics/aiAnalytics';
import { getModelMaxOutputTokens } from '../context-limits';

interface GroqMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface GroqChatParams {
  model: string;
  messages: GroqMessage[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stream?: boolean;
  /**
   * Tool calling — Groq's API is OpenAI-compatible and supports it.
   *
   * This adapter did not forward `tools`/`tool_choice`, so any caller that
   * needs a STRUCTURED answer could not use Groq at all. The BizQL planner is
   * exactly that: it hands the model a JSON schema and requires a tool call
   * back, which is what makes the plan parseable and validatable rather than
   * free text to be regexed. Groq was therefore unreachable for the planner —
   * an adapter gap, not a model limitation.
   *
   * Typed loosely on purpose: the shape is the OpenAI one, and pinning it to
   * the OpenAI SDK's types here would drag that dependency into a provider
   * that speaks plain HTTP.
   */
  tools?: unknown[];
  tool_choice?: unknown;
}

interface GroqUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

interface GroqToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface GroqChoice {
  index: number;
  message: {
    role: string;
    // Null when the model answered with a tool call instead of prose.
    content: string | null;
    tool_calls?: GroqToolCall[];
  };
  finish_reason: string;
}

interface GroqResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: GroqChoice[];
  usage: GroqUsage;
}

/**
 * Models Groq serves that are worth reaching for.
 *
 * Named rather than passed as strings so a switch is one edit here, not a hunt
 * through call sites — the same shape the other providers use.
 */
export const GROQ_MODELS = {
  /** Largest tool-capable open-weights model Groq serves; the GPT-4o-mini rival. */
  GPT_OSS_120B: 'openai/gpt-oss-120b',
  /** Smaller and faster, for latency-sensitive or high-volume paths. */
  GPT_OSS_20B: 'openai/gpt-oss-20b',
  QWEN_38_27B: 'qwen/qwen3.8-27b',
} as const;

export class GroqProvider extends BaseAIProvider {
  private apiKey: string;
  private baseURL: string = 'https://api.groq.com/openai/v1';

  /*
   * The abstract contract `BaseAIProvider` requires.
   *
   * None of these were implemented, so this class never satisfied its own base
   * type — `tsc` reported it, and the build ignores TypeScript errors, so it
   * shipped anyway. Anything routing through the factory got a provider that
   * could not answer what its default model was or how much it could emit.
   */
  readonly defaultModel = GROQ_MODELS.GPT_OSS_120B;

  /** Fallback only — prefer `getMaxOutputTokens(model)`. */
  readonly defaultMaxTokens = 4096;

  /** Groq exposes OpenAI's chat API but not its `response_format` constraint. */
  readonly supportsResponseFormat = false;

  getMaxOutputTokens(model: string): number {
    return getModelMaxOutputTokens(model);
  }

  constructor(apiKey: string, analytics?: AIAnalyticsService) {
    super(analytics);
    this.apiKey = apiKey;
  }

  async chatCompletion(params: GroqChatParams, context: CallContext): Promise<GroqResponse> {
    const { model, messages, temperature = 0.7, max_tokens = 1000, top_p = 1, stream = false, tools, tool_choice } = params;

    return this.callWithTracking(
      context,
      'groq',
      model,
      '/chat/completions',
      async () => {
        const response = await fetch(`${this.baseURL}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages,
            temperature,
            max_tokens,
            top_p,
            stream,
            // Omitted entirely when absent — sending `tools: undefined` is fine
            // in JSON, but an explicit null is not, and some gateways reject it.
            ...(tools ? { tools } : {}),
            ...(tool_choice ? { tool_choice } : {}),
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(
            `Groq API error: ${response.status} ${response.statusText}. ${JSON.stringify(errorData)}`
          );
        }

        const data: GroqResponse = await response.json();
        return data;
      },
      (result: GroqResponse) => {
        const inputTokens = result.usage?.prompt_tokens || 0;
        const outputTokens = result.usage?.completion_tokens || 0;

        // Groq is FREE for the help bot use case!
        // But we'll track a nominal cost for analytics purposes
        const cost = 0; // Actually free!

        return {
          inputTokens,
          outputTokens,
          cost,
          responseSize: JSON.stringify(result).length,
        };
      }
    );
  }
}
