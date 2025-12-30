// lib/ai/providerFactory.ts
// Factory pattern for AI provider instantiation
// Manages singleton instances of OpenAI, Anthropic, and Kimi providers

import { OpenAIProvider } from './providers/openaiProvider';
import { AnthropicProvider } from './providers/anthropicProvider';
import { KimiProvider } from './providers/kimiProvider';
import { BaseAIProvider } from './providers/baseProvider';
import { AIAnalyticsService } from '../analytics/aiAnalytics';
import { createClient } from '@supabase/supabase-js';
import { PROVIDERS, type Provider } from './model-constants';

// Re-export for backward compatibility
export { PROVIDERS };
export type ProviderName = Provider;

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
      case PROVIDERS.OPENAI:
        return this.getOpenAIProvider();

      case PROVIDERS.ANTHROPIC:
        return this.getAnthropicProvider();

      case PROVIDERS.KIMI:
        return this.getKimiProvider();

      default:
        throw new Error(`Unknown provider: ${provider}. Supported providers: ${Object.values(PROVIDERS).join(', ')}`);
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
      case PROVIDERS.OPENAI:
        return !!process.env.OPENAI_API_KEY;
      case PROVIDERS.ANTHROPIC:
        return !!process.env.ANTHROPIC_API_KEY;
      case PROVIDERS.KIMI:
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

    if (this.isProviderAvailable(PROVIDERS.OPENAI)) {
      providers.push(PROVIDERS.OPENAI);
    }

    if (this.isProviderAvailable(PROVIDERS.ANTHROPIC)) {
      providers.push(PROVIDERS.ANTHROPIC);
    }

    if (this.isProviderAvailable(PROVIDERS.KIMI)) {
      providers.push(PROVIDERS.KIMI);
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
      [PROVIDERS.OPENAI]: {
        available: this.isProviderAvailable(PROVIDERS.OPENAI),
        initialized: !!this.openaiInstance
      },
      [PROVIDERS.ANTHROPIC]: {
        available: this.isProviderAvailable(PROVIDERS.ANTHROPIC),
        initialized: !!this.anthropicInstance
      },
      [PROVIDERS.KIMI]: {
        available: this.isProviderAvailable(PROVIDERS.KIMI),
        initialized: !!this.kimiInstance
      }
    };
  }
}
