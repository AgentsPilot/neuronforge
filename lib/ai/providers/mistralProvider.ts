// lib/ai/providers/mistralProvider.ts
import { BaseAIProvider, CallContext } from './baseProvider';
import { AIAnalyticsService } from '@/lib/analytics/aiAnalytics';

interface MistralMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface MistralChatParams {
  model: string;
  messages: MistralMessage[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stream?: boolean;
}

interface MistralUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

interface MistralChoice {
  index: number;
  message: {
    role: string;
    content: string;
  };
  finish_reason: string;
}

interface MistralResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: MistralChoice[];
  usage: MistralUsage;
}

export class MistralProvider extends BaseAIProvider {
  private apiKey: string;
  private baseURL: string = 'https://api.mistral.ai/v1';

  constructor(apiKey: string, analytics?: AIAnalyticsService) {
    super(analytics);
    this.apiKey = apiKey;
  }

  async chatCompletion(params: MistralChatParams, context: CallContext): Promise<MistralResponse> {
    const { model, messages, temperature = 0.7, max_tokens = 1000, top_p = 1, stream = false } = params;

    return this.callWithTracking(
      context,
      'mistral',
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
            `Mistral API error: ${response.status} ${response.statusText}. ${JSON.stringify(errorData)}`
          );
        }

        const data: MistralResponse = await response.json();
        return data;
      },
      (result: MistralResponse) => {
        const inputTokens = result.usage?.prompt_tokens || 0;
        const outputTokens = result.usage?.completion_tokens || 0;

        // Mistral pricing (approximate as of 2024)
        // mistral-tiny: $0.14/$0.42 per 1M tokens (input/output)
        // mistral-small: $0.6/$1.8 per 1M tokens
        // mistral-medium: $2.5/$7.5 per 1M tokens
        // mistral-7b-instruct (open weights, using similar to tiny pricing): $0.14/$0.42 per 1M tokens

        let inputCostPerMillion = 0.14;
        let outputCostPerMillion = 0.42;

        if (model.includes('small')) {
          inputCostPerMillion = 0.6;
          outputCostPerMillion = 1.8;
        } else if (model.includes('medium') || model.includes('large')) {
          inputCostPerMillion = 2.5;
          outputCostPerMillion = 7.5;
        }

        const cost = (inputTokens * inputCostPerMillion / 1_000_000) + (outputTokens * outputCostPerMillion / 1_000_000);

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
