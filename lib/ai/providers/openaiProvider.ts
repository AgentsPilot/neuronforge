// lib/ai/providers/openaiProvider.ts
import OpenAI from 'openai';
import { BaseAIProvider, CallContext } from './baseProvider';

export class OpenAIProvider extends BaseAIProvider {
  private openai: OpenAI;
  
  constructor(apiKey: string, analytics?: any) {
    super(analytics);
    this.openai = new OpenAI({ apiKey });
  }

  async chatCompletion(
    params: OpenAI.Chat.ChatCompletionCreateParams,
    context: CallContext
  ): Promise<OpenAI.Chat.ChatCompletion> {
    // Ensure streaming is disabled for token tracking
    const nonStreamParams = { ...params, stream: false as const };

    return this.callWithTracking(
      context,
      'openai',
      params.model,
      'chat/completions',
      async () => {
        const result = await this.openai.chat.completions.create(nonStreamParams);
        // Type assertion since we disabled streaming
        return result as OpenAI.Chat.ChatCompletion;
      },
      (result: OpenAI.Chat.ChatCompletion) => ({
        inputTokens: result.usage?.prompt_tokens || 0,
        outputTokens: result.usage?.completion_tokens || 0,
        cost: this.calculateCost(params.model, result.usage),
        responseSize: JSON.stringify(result).length
      })
    ) as Promise<OpenAI.Chat.ChatCompletion>;
  }

  private calculateCost(model: string, usage: any): number {
    const pricing: Record<string, { input: number; output: number }> = {
      'gpt-4o': { input: 0.0025, output: 0.01 },
      'gpt-4': { input: 0.03, output: 0.06 },
      'gpt-3.5-turbo': { input: 0.001, output: 0.002 }
    };

    const modelPricing = pricing[model] || pricing['gpt-3.5-turbo'];

    return (
      (usage?.prompt_tokens || 0) * modelPricing.input / 1000 +
      (usage?.completion_tokens || 0) * modelPricing.output / 1000
    );
  }
}