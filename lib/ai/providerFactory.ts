// lib/ai/providerFactory.ts
// Factory pattern for AI provider instantiation
// Manages singleton instances of OpenAI, Anthropic, and Kimi providers

import { OpenAIProvider } from './providers/openaiProvider';
import { AnthropicProvider } from './providers/anthropicProvider';
import { KimiProvider } from './providers/kimiProvider';
import { GroqProvider } from './providers/groqProvider';
import { BaseAIProvider } from './providers/baseProvider';
import { AIAnalyticsService } from '../analytics/aiAnalytics';
import { createClient } from '@supabase/supabase-js';

/**
 * Provider name constants
 * Use these instead of raw strings when calling getProvider()
 */
export const PROVIDERS = {
  OPENAI: 'openai',
  ANTHROPIC: 'anthropic',
  KIMI: 'kimi',
  /**
   * Groq — open-weights models on their own inference hardware.
   *
   * The provider class existed and the factory could not hand it out, so
   * nothing in the product could reach it. Added here so choosing it is a
   * config change rather than a code change, which is the point of the factory.
   */
  GROQ: 'groq'
} as const;

export type ProviderName = typeof PROVIDERS[keyof typeof PROVIDERS];

/**
 * Provider Factory - Creates and manages AI provider instances
 *
 * Uses singleton pattern to reuse provider instances and avoid
 * unnecessary API client instantiation.
 */
export class ProviderFactory {
  private static openaiInstance: OpenAIProvider | null = null;
  private static anthropicInstance: AnthropicProvider | null = null;
  private static kimiInstance: KimiProvider | null = null;
  private static groqInstance: GroqProvider | null = null;
  private static aiAnalytics: AIAnalyticsService | null = null;

  /**
   * Get or create AIAnalyticsService instance
   * @private
   */
  private static getAnalytics(): AIAnalyticsService {
    if (!this.aiAnalytics) {
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      );
      this.aiAnalytics = new AIAnalyticsService(supabase);
      console.log('📊 Initialized AIAnalyticsService for providers');
    }
    return this.aiAnalytics;
  }

  /**
   * Get provider instance by name
   *
   * @param provider - Provider name (use PROVIDERS.OPENAI, PROVIDERS.ANTHROPIC, or PROVIDERS.KIMI)
   * @returns Provider instance
   * @throws Error if API key not configured
   */
  static getProvider(provider: ProviderName): BaseAIProvider {
    switch (provider) {
      case 'openai':
        return this.getOpenAIProvider();

      case 'anthropic':
        return this.getAnthropicProvider();

      case 'kimi':
        return this.getKimiProvider();

      case 'groq':
        return this.getGroqProvider();

      default:
        throw new Error(`Unknown provider: ${provider}. Supported providers: openai, anthropic, kimi, groq`);
    }
  }

  /**
   * Get OpenAI provider instance (singleton)
   *
   * @private
   * @returns OpenAI provider instance
   * @throws Error if OPENAI_API_KEY not configured
   */
  private static getOpenAIProvider(): OpenAIProvider {
    if (!this.openaiInstance) {
      const apiKey = process.env.OPENAI_API_KEY;

      if (!apiKey) {
        throw new Error(
          'OPENAI_API_KEY environment variable is not configured. ' +
          'Please set it in your environment or .env file.'
        );
      }

      console.log('🔧 Initializing OpenAI Provider with analytics tracking');
      const analytics = this.getAnalytics();
      this.openaiInstance = new OpenAIProvider(apiKey, analytics);
    }

    return this.openaiInstance;
  }

  /**
   * Get Anthropic provider instance (singleton)
   *
   * @private
   * @returns Anthropic provider instance
   * @throws Error if ANTHROPIC_API_KEY not configured
   */
  private static getAnthropicProvider(): AnthropicProvider {
    if (!this.anthropicInstance) {
      const apiKey = process.env.ANTHROPIC_API_KEY;

      if (!apiKey) {
        throw new Error(
          'ANTHROPIC_API_KEY environment variable is not configured. ' +
          'Please set it in your environment or .env file. ' +
          'Get your API key from: https://console.anthropic.com/'
        );
      }

      console.log('🔧 Initializing Anthropic Provider with analytics tracking');
      const analytics = this.getAnalytics();
      this.anthropicInstance = new AnthropicProvider(apiKey, analytics);
    }

    return this.anthropicInstance;
  }

  /**
   * Get Kimi provider instance (singleton)
   *
   * @private
   * @returns Kimi provider instance
   * @throws Error if KIMI_API_KEY not configured
   */
  private static getKimiProvider(): KimiProvider {
    if (!this.kimiInstance) {
      const apiKey = process.env.KIMI_API_KEY;

      if (!apiKey) {
        throw new Error(
          'KIMI_API_KEY environment variable is not configured. ' +
          'Please set it in your environment or .env file. ' +
          'Get your API key from: https://platform.moonshot.ai'
        );
      }

      console.log('🔧 Initializing Kimi Provider with analytics tracking');
      const analytics = this.getAnalytics();
      this.kimiInstance = new KimiProvider(apiKey, analytics);
    }

    return this.kimiInstance;
  }

  /**
   * Get Groq provider instance (singleton)
   *
   * @private
   * @throws Error if GROQ_API_KEY not configured
   */
  private static getGroqProvider(): GroqProvider {
    if (!this.groqInstance) {
      const apiKey = process.env.GROQ_API_KEY;

      if (!apiKey) {
        throw new Error(
          'GROQ_API_KEY environment variable is not configured. ' +
          'Please set it in your environment or .env file. ' +
          'Get your API key from: https://console.groq.com'
        );
      }

      console.log('🔧 Initializing Groq Provider with analytics tracking');
      const analytics = this.getAnalytics();
      this.groqInstance = new GroqProvider(apiKey, analytics);
    }

    return this.groqInstance;
  }

  /**
   * Clear cached provider instances
   *
   * Useful for testing or when API keys change
   */
  static clearInstances(): void {
    console.log('🧹 Clearing provider instances');
    this.openaiInstance = null;
    this.anthropicInstance = null;
    this.kimiInstance = null;
    this.aiAnalytics = null;
  }

  /**
   * Check if a provider is available (API key configured)
   *
   * @param provider - Provider name to check
   * @returns true if provider is available, false otherwise
   */
  static isProviderAvailable(provider: ProviderName): boolean {
    switch (provider) {
      case 'openai':
        return !!process.env.OPENAI_API_KEY;
      case 'anthropic':
        return !!process.env.ANTHROPIC_API_KEY;
      case 'kimi':
        return !!process.env.KIMI_API_KEY;
      default:
        return false;
    }
  }

  /**
   * Get all available providers
   *
   * @returns Array of available provider names
   */
  static getAvailableProviders(): ProviderName[] {
    const providers: ProviderName[] = [];

    if (this.isProviderAvailable('openai')) {
      providers.push('openai');
    }

    if (this.isProviderAvailable('anthropic')) {
      providers.push('anthropic');
    }

    if (this.isProviderAvailable('kimi')) {
      providers.push('kimi');
    }

    return providers;
  }

  /**
   * Get provider status (for monitoring/debugging)
   *
   * @returns Status of all providers
   */
  static getStatus() {
    return {
      openai: {
        available: this.isProviderAvailable('openai'),
        initialized: !!this.openaiInstance
      },
      anthropic: {
        available: this.isProviderAvailable('anthropic'),
        initialized: !!this.anthropicInstance
      },
      kimi: {
        available: this.isProviderAvailable('kimi'),
        initialized: !!this.kimiInstance
      }
    };
  }
}

/**
 * Provider wrapper with simplified complete() method
 * Used by services for easy LLM chat completions
 */
export interface SimpleProvider {
  complete(params: {
    model: string;
    messages: Array<{ role: string; content: string }>;
    response_format?: { type: string };
    temperature?: number;
    /** Callers cap their own output; without this the cap was silently dropped. */
    max_tokens?: number;
  }): Promise<{ content: string }>;
  getProvider(name: ProviderName): BaseAIProvider;
}

/**
 * Get a wrapper around the provider factory with a simplified complete() method
 */
export function getProviderFactory(): SimpleProvider {
  return {
    getProvider(name: ProviderName): BaseAIProvider {
      return ProviderFactory.getProvider(name);
    },
    async complete(params: {
      model: string;
      messages: Array<{ role: string; content: string }>;
      response_format?: { type: string };
      temperature?: number;
      max_tokens?: number;
    }): Promise<{ content: string }> {
      const provider = ProviderFactory.getProvider('openai') as any;

      // Build chat completion params
      const chatParams: any = {
        model: params.model,
        messages: params.messages,
      };

      if (params.response_format) {
        chatParams.response_format = params.response_format;
      }

      if (params.temperature !== undefined) {
        chatParams.temperature = params.temperature;
      }

      if (params.max_tokens !== undefined) {
        chatParams.max_tokens = params.max_tokens;
      }

      // Call chatCompletion with a minimal context (no tracking for simple calls)
      const result = await provider.chatCompletion(chatParams, {
        userId: 'system',
        feature: 'onboarding',
        component: 'simple-complete'
      });

      // Extract content from OpenAI response format
      const content = result.choices?.[0]?.message?.content || '';
      return { content };
    }
  };
}
