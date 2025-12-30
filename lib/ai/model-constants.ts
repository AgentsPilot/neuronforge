// lib/ai/model-constants.ts
// Shared model constants for client and server components
// This file is client-safe and can be imported in 'use client' components

/**
 * Supported AI providers
 */
export const PROVIDERS = {
  OPENAI: 'openai',
  ANTHROPIC: 'anthropic',
  GOOGLE: 'google',
  KIMI: 'kimi',
  GROQ: 'groq',
  MISTRAL: 'mistral',
} as const;

export type Provider = typeof PROVIDERS[keyof typeof PROVIDERS];

/**
 * Model tier classifications
 */
export const MODEL_TIERS = {
  FAST: 'fast',
  BALANCED: 'balanced',
  POWERFUL: 'powerful',
} as const;

export type ModelTier = typeof MODEL_TIERS[keyof typeof MODEL_TIERS];

/**
 * OpenAI model name constants
 * Use these instead of raw strings when specifying models
 */
export const OPENAI_MODELS = {
  // GPT-5.2 Series (Latest - December 2025)
  GPT_52: 'gpt-5.2', // Most advanced model - best for spreadsheets, presentations, image perception, coding, and long context
  GPT_52_PRO: 'gpt-5.2-pro', // Highest accuracy for difficult questions and complex analysis

  // GPT-5.1 Series
  GPT_51: 'gpt-5.1', // Flagship model with improved steerability and faster responses

  // GPT-5 Series
  GPT_5: 'gpt-5', // Advanced reasoning model for complex multi-step tasks
  GPT_5_MINI: 'gpt-5-mini', // Balanced performance and cost for production workloads
  GPT_5_NANO: 'gpt-5-nano', // Fastest and most affordable - ideal for summarization and classification

  // GPT-4.1 Series (April 2025)
  GPT_41: 'gpt-4.1', // Specialized for coding with improved instruction following and 1M context window
  GPT_41_MINI: 'gpt-4.1-mini', // Cost-effective coding model with strong instruction following
  GPT_41_NANO: 'gpt-4.1-nano', // Lightweight coding model for simple tasks

  // o-Series Reasoning Models
  O3: 'o3', // Powerful reasoning model - best for math, science, coding, and complex technical analysis
  O4_MINI: 'o4-mini', // Fast reasoning model for visual reasoning and technical writing

  // GPT-4o Series (Still widely used)
  GPT_4O: 'gpt-4o', // Versatile multimodal model for general-purpose tasks
  GPT_4O_MINI: 'gpt-4o-mini', // Cost-effective option for simpler tasks and high-volume applications

  // Legacy Models
  GPT_4_TURBO: 'gpt-4-turbo', // Legacy model - consider migrating to GPT-4.1 or GPT-5 series
  GPT_4: 'gpt-4', // Legacy model - consider migrating to newer models
  GPT_35_TURBO: 'gpt-3.5-turbo', // Legacy model - use for basic tasks where cost is critical
} as const;

export type OpenAIModelId = typeof OPENAI_MODELS[keyof typeof OPENAI_MODELS];

/**
 * Anthropic model name constants
 * Use these instead of raw strings when specifying models
 */
export const ANTHROPIC_MODELS = {
  // Claude 4.5 Series (Latest - Fall 2025)
  CLAUDE_45_OPUS: 'claude-opus-4-5-20251101', // Most intelligent model - best for production code, sophisticated agents, and complex office tasks
  CLAUDE_45_SONNET: 'claude-sonnet-4-5-20250929', // Best balance of intelligence, speed, and cost - ideal for complex agents and coding
  CLAUDE_45_HAIKU: 'claude-haiku-4-5-20251001', // Fastest model with near-frontier intelligence - best for low-latency, high-volume tasks

  // Claude 4.1 Series
  CLAUDE_41_OPUS: 'claude-opus-4-1-20250805', // Enhanced agentic tasks, real-world coding, and reasoning

  // Claude 4 Series
  CLAUDE_4_OPUS: 'claude-opus-4-20250514', // World-class coding with sustained performance on long-running agent workflows
  CLAUDE_4_SONNET: 'claude-sonnet-4-20250514', // Superior coding and reasoning - great balance of capability and speed

  // Claude 3.7 Series
  CLAUDE_37_SONNET: 'claude-3-7-sonnet-20250219', // Hybrid reasoning model - choose between rapid responses or step-by-step thinking

  // Claude 3.5 Series (Legacy but still available)
  CLAUDE_35_SONNET: 'claude-3-5-sonnet-20241022', // Legacy model - consider migrating to Claude 4.5 Sonnet
  CLAUDE_35_HAIKU: 'claude-3-5-haiku-20241022', // Cost-effective for simple tasks where speed matters

  // Claude 3 Series (Legacy)
  CLAUDE_3_OPUS: 'claude-3-opus-20240229', // Deprecated - migrate to Claude 4.1 Opus or Claude 4.5 Opus
  CLAUDE_3_SONNET: 'claude-3-sonnet-20240229', // Retired - migrate to Claude 4.5 Sonnet
  CLAUDE_3_HAIKU: 'claude-3-haiku-20240307', // Budget option for basic tasks - consider Claude 4.5 Haiku for better quality
} as const;

export type AnthropicModelId = typeof ANTHROPIC_MODELS[keyof typeof ANTHROPIC_MODELS];

/**
 * Kimi (Moonshot AI) model name constants
 * Use these instead of raw strings when specifying models
 */
export const KIMI_MODELS = {
  // Kimi K2 Series (Latest - 2025)
  K2_PREVIEW: 'kimi-k2-0905-preview', // Latest K2 with 256K context - best for coding, agentic tasks, and instruction following
  K2_THINKING: 'kimi-k2-thinking', // Enhanced reasoning with 256K context - best for complex multi-step reasoning and analysis
  K2_ORIGINAL: 'kimi-k2-0711-preview', // Original K2 with 128K context - stable baseline for general tasks

  // Kimi K1.5 Series (January 2025)
  K15: 'kimi-k1.5', // Multimodal reasoning model - matches OpenAI o1 in math, coding, and multimodal tasks
  K15_LONG: 'kimi-k1.5-long', // Long chain-of-thought mode - best for detailed step-by-step reasoning

  // Kimi Linear Series (October 2025)
  LINEAR: 'kimi-linear-48b', // Ultra-efficient 1M context - 6x faster with 75% less memory, best for extreme long-context tasks

  // Specialized Models
  DEV: 'kimi-dev-72b', // Coding specialist for issue resolution - 60.4% on SWE-bench Verified
  VL: 'kimi-vl', // Vision-Language model - best for multimodal reasoning and image understanding
} as const;

export type KimiModelId = typeof KIMI_MODELS[keyof typeof KIMI_MODELS];

/**
 * Default models for each tier (matches RoutingService defaults)
 * Using OpenAI GPT-5 series as the default provider
 */
export const DEFAULT_TIER_MODELS = {
  [MODEL_TIERS.FAST]: OPENAI_MODELS.GPT_5_NANO,
  [MODEL_TIERS.BALANCED]: OPENAI_MODELS.GPT_5_MINI,
  [MODEL_TIERS.POWERFUL]: OPENAI_MODELS.GPT_52,
} as const;

/**
 * Default provider for routing
 */
export const DEFAULT_PROVIDER = PROVIDERS.OPENAI;

/**
 * Default model for AgentKit
 */
export const DEFAULT_AGENTKIT_MODEL = OPENAI_MODELS.GPT_5_MINI;

/**
 * Model option for UI dropdowns
 */
export interface ModelOption {
  value: string;
  label: string;
  tier: ModelTier;
}

/**
 * Available models for UI selection, organized by provider
 * Sorted with newest/recommended models first
 */
export const AVAILABLE_MODELS: Record<string, ModelOption[]> = {
  openai: [
    // GPT-5.2 Series (Latest)
    { value: OPENAI_MODELS.GPT_52, label: 'GPT-5.2 (Most Advanced)', tier: MODEL_TIERS.POWERFUL },
    { value: OPENAI_MODELS.GPT_52_PRO, label: 'GPT-5.2 Pro (Highest Accuracy)', tier: MODEL_TIERS.POWERFUL },
    // GPT-5.1 Series
    { value: OPENAI_MODELS.GPT_51, label: 'GPT-5.1 (Flagship)', tier: MODEL_TIERS.POWERFUL },
    // GPT-5 Series
    { value: OPENAI_MODELS.GPT_5, label: 'GPT-5 (Advanced Reasoning)', tier: MODEL_TIERS.POWERFUL },
    { value: OPENAI_MODELS.GPT_5_MINI, label: 'GPT-5 Mini (Balanced)', tier: MODEL_TIERS.BALANCED },
    { value: OPENAI_MODELS.GPT_5_NANO, label: 'GPT-5 Nano (Fastest)', tier: MODEL_TIERS.FAST },
    // GPT-4.1 Series
    { value: OPENAI_MODELS.GPT_41, label: 'GPT-4.1 (Coding)', tier: MODEL_TIERS.POWERFUL },
    { value: OPENAI_MODELS.GPT_41_MINI, label: 'GPT-4.1 Mini', tier: MODEL_TIERS.BALANCED },
    { value: OPENAI_MODELS.GPT_41_NANO, label: 'GPT-4.1 Nano', tier: MODEL_TIERS.FAST },
    // o-Series
    { value: OPENAI_MODELS.O3, label: 'o3 (Reasoning)', tier: MODEL_TIERS.POWERFUL },
    { value: OPENAI_MODELS.O4_MINI, label: 'o4-mini (Fast Reasoning)', tier: MODEL_TIERS.BALANCED },
    // GPT-4o Series (Legacy)
    { value: OPENAI_MODELS.GPT_4O, label: 'GPT-4o (Legacy)', tier: MODEL_TIERS.POWERFUL },
    { value: OPENAI_MODELS.GPT_4O_MINI, label: 'GPT-4o Mini (Legacy)', tier: MODEL_TIERS.BALANCED },
    // Legacy
    { value: OPENAI_MODELS.GPT_4_TURBO, label: 'GPT-4 Turbo (Legacy)', tier: MODEL_TIERS.POWERFUL },
    { value: OPENAI_MODELS.GPT_4, label: 'GPT-4 (Legacy)', tier: MODEL_TIERS.POWERFUL },
    { value: OPENAI_MODELS.GPT_35_TURBO, label: 'GPT-3.5 Turbo (Legacy)', tier: MODEL_TIERS.FAST },
  ],
  claude: [
    // Claude 4.5 Series (Latest)
    { value: ANTHROPIC_MODELS.CLAUDE_45_OPUS, label: 'Claude 4.5 Opus (Most Intelligent)', tier: MODEL_TIERS.POWERFUL },
    { value: ANTHROPIC_MODELS.CLAUDE_45_SONNET, label: 'Claude 4.5 Sonnet (Best Balance)', tier: MODEL_TIERS.BALANCED },
    { value: ANTHROPIC_MODELS.CLAUDE_45_HAIKU, label: 'Claude 4.5 Haiku (Fastest)', tier: MODEL_TIERS.FAST },
    // Claude 4.1 Series
    { value: ANTHROPIC_MODELS.CLAUDE_41_OPUS, label: 'Claude 4.1 Opus (Agentic)', tier: MODEL_TIERS.POWERFUL },
    // Claude 4 Series
    { value: ANTHROPIC_MODELS.CLAUDE_4_OPUS, label: 'Claude 4 Opus (Coding)', tier: MODEL_TIERS.POWERFUL },
    { value: ANTHROPIC_MODELS.CLAUDE_4_SONNET, label: 'Claude 4 Sonnet (Reasoning)', tier: MODEL_TIERS.BALANCED },
    // Claude 3.7 Series
    { value: ANTHROPIC_MODELS.CLAUDE_37_SONNET, label: 'Claude 3.7 Sonnet (Hybrid)', tier: MODEL_TIERS.BALANCED },
    // Claude 3.5 Series (Legacy)
    { value: ANTHROPIC_MODELS.CLAUDE_35_SONNET, label: 'Claude 3.5 Sonnet (Legacy)', tier: MODEL_TIERS.BALANCED },
    { value: ANTHROPIC_MODELS.CLAUDE_35_HAIKU, label: 'Claude 3.5 Haiku (Legacy)', tier: MODEL_TIERS.FAST },
    // Claude 3 Series (Legacy)
    { value: ANTHROPIC_MODELS.CLAUDE_3_OPUS, label: 'Claude 3 Opus (Legacy)', tier: MODEL_TIERS.POWERFUL },
    { value: ANTHROPIC_MODELS.CLAUDE_3_SONNET, label: 'Claude 3 Sonnet (Legacy)', tier: MODEL_TIERS.BALANCED },
    { value: ANTHROPIC_MODELS.CLAUDE_3_HAIKU, label: 'Claude 3 Haiku (Legacy)', tier: MODEL_TIERS.FAST },
  ],
  google: [
    { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash (Latest)', tier: MODEL_TIERS.BALANCED },
    { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro', tier: MODEL_TIERS.POWERFUL },
    { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash', tier: MODEL_TIERS.BALANCED },
    { value: 'gemini-pro', label: 'Gemini Pro (Legacy)', tier: MODEL_TIERS.BALANCED },
  ],
  kimi: [
    // K2 Series (Latest)
    { value: KIMI_MODELS.K2_PREVIEW, label: 'Kimi K2 0905 (Best Value)', tier: MODEL_TIERS.BALANCED },
    { value: KIMI_MODELS.K2_THINKING, label: 'Kimi K2 Thinking (Reasoning)', tier: MODEL_TIERS.POWERFUL },
    { value: KIMI_MODELS.K2_ORIGINAL, label: 'Kimi K2 0711 (Legacy)', tier: MODEL_TIERS.BALANCED },
    // K1.5 Series
    { value: KIMI_MODELS.K15, label: 'Kimi K1.5 (Multimodal)', tier: MODEL_TIERS.POWERFUL },
    { value: KIMI_MODELS.K15_LONG, label: 'Kimi K1.5 Long (Long CoT)', tier: MODEL_TIERS.POWERFUL },
    // Linear Series
    { value: KIMI_MODELS.LINEAR, label: 'Kimi Linear (1M Context)', tier: MODEL_TIERS.FAST },
    // Specialized
    { value: KIMI_MODELS.DEV, label: 'Kimi Dev (Coding)', tier: MODEL_TIERS.POWERFUL },
    { value: KIMI_MODELS.VL, label: 'Kimi VL (Vision)', tier: MODEL_TIERS.BALANCED },
  ],
};

/**
 * Flatten all models for easy access
 */
export const ALL_MODELS: ModelOption[] = [
  ...AVAILABLE_MODELS.openai,
  ...AVAILABLE_MODELS.claude,
  ...AVAILABLE_MODELS.google,
  ...AVAILABLE_MODELS.kimi,
];

/**
 * Get models filtered by tier
 */
export function getModelsByTier(tier: ModelTier): ModelOption[] {
  return ALL_MODELS.filter(model => model.tier === tier);
}

/**
 * Get models for a specific provider
 */
export function getModelsByProvider(provider: string): ModelOption[] {
  return AVAILABLE_MODELS[provider] || [];
}

/**
 * Find a model option by value
 */
export function findModelOption(value: string): ModelOption | undefined {
  return ALL_MODELS.find(model => model.value === value);
}

/**
 * Default routing thresholds (matches RoutingService)
 */
export const DEFAULT_ROUTING_THRESHOLDS = {
  FAST_MAX_SCORE: 3.9,
  BALANCED_MAX_SCORE: 6.9,
} as const;

/**
 * Default AgentKit configuration
 */
export const DEFAULT_AGENTKIT_CONFIG = {
  model: DEFAULT_AGENTKIT_MODEL,
  temperature: 0.1,
  maxIterations: 10,
  timeoutMs: 120000,
} as const;
