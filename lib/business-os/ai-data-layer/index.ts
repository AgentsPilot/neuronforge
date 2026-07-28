/**
 * AI Data Layer
 *
 * Autonomous data access for Business OS chat.
 * Replaces hardcoded capabilities with LLM-driven tool calling.
 */

export { AIDataLayerService, createAIDataLayerService } from './AIDataLayerService';
export { ContextBuilder, contextBuilder } from './ContextBuilder';
export { SafeExecutionLayer, createExecutionLayer } from './SafeExecutionLayer';
export * from './types';
