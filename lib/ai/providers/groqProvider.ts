// lib/ai/providers/groqProvider.ts
// Groq provider for ultra-fast, free AI inference
import { BaseAIProvider, CallContext } from './baseProvider';
import { AIAnalyticsService } from '@/lib/analytics/aiAnalytics';

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
}

interface GroqUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

interface GroqChoice {
  index: number;
  message: {
    role: string;
    content: string;
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

export class GroqProvider extends BaseAIProvider {
  private apiKey: string;
  private baseURL: string = 'https://api.groq.com/openai/v1';

  constructor(apiKey: string, analytics?: AIAnalyticsService) {
    super(analytics);
    this.apiKey = apiKey;
  }

  async chatCompletion(params: GroqChatParams, context: CallContext): Promise<GroqResponse> {
    const { model, messages, temperature = 0.7, max_tokens = 1000, top_p = 1, stream = false } = params;

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
