// lib/ai/providerFactory.ts
// Factory pattern for AI provider instantiation
// Manages singleton instances of OpenAI, Anthropic, and Kimi providers

import { OpenAIProvider } from './providers/openaiProvider';
import { AnthropicProvider } from './providers/anthropicProvider';
import { KimiProvider } from './providers/kimiProvider';
import { BaseAIProvider } from './providers/baseProvider';
import { AIAnalyticsService } from '../analytics/aiAnalytics';
import { createClient } from '@supabase/supabase-js';

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
   * @param provider - Provider name ('openai', 'anthropic', or 'kimi')
   * @returns Provider instance
   * @throws Error if API key not configured
   */
  static getProvider(provider: 'openai' | 'anthropic' | 'kimi'): BaseAIProvider {
    switch (provider) {
      case 'openai':
        return this.getOpenAIProvider();

      case 'anthropic':
        return this.getAnthropicProvider();

      case 'kimi':
        return this.getKimiProvider();

      default:
        throw new Error(`Unknown provider: ${provider}. Supported providers: openai, anthropic, kimi`);
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
  static isProviderAvailable(provider: 'openai' | 'anthropic' | 'kimi'): boolean {
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
  static getAvailableProviders(): ('openai' | 'anthropic' | 'kimi')[] {
    const providers: ('openai' | 'anthropic' | 'kimi')[] = [];

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
