/**
 * HandlerRegistry
 *
 * Central registry for all intent handlers
 * Provides handler lookup and execution
 */

import type { IntentHandler, IntentType, HandlerContext, HandlerResult } from '../types';
import { ExtractHandler } from './ExtractHandler';
import { SummarizeHandler } from './SummarizeHandler';
import { GenerateHandler } from './GenerateHandler';
import { ValidateHandler } from './ValidateHandler';
import { SendHandler } from './SendHandler';
import { TransformHandler } from './TransformHandler';
import { ConditionalHandler } from './ConditionalHandler';
import { AggregateHandler } from './AggregateHandler';
import { FilterHandler } from './FilterHandler';
import { EnrichHandler } from './EnrichHandler';

export class HandlerRegistry {
  private handlers: Map<IntentType, IntentHandler> = new Map();

  constructor() {
    this.registerDefaultHandlers();
  }

  /**
   * Register default handlers for all intent types
   */
  private registerDefaultHandlers(): void {
    // Register all 10 intent handlers
    this.register(new ExtractHandler());
    this.register(new SummarizeHandler());
    this.register(new GenerateHandler());
    this.register(new ValidateHandler());
    this.register(new SendHandler());
    this.register(new TransformHandler());
    this.register(new ConditionalHandler());
    this.register(new AggregateHandler());
    this.register(new FilterHandler());
    this.register(new EnrichHandler());

    console.log(`[HandlerRegistry] Registered ${this.handlers.size} intent handlers`);
  }

  /**
   * Register a handler
   */
  register(handler: IntentHandler): void {
    if (this.handlers.has(handler.intent)) {
      console.warn(`[HandlerRegistry] Overwriting existing handler for intent: ${handler.intent}`);
    }

    this.handlers.set(handler.intent, handler);
    console.log(`[HandlerRegistry] Registered handler for intent: ${handler.intent}`);
  }

  /**
   * Unregister a handler
   */
  unregister(intent: IntentType): boolean {
    const removed = this.handlers.delete(intent);
    if (removed) {
      console.log(`[HandlerRegistry] Unregistered handler for intent: ${intent}`);
    }
    return removed;
  }

  /**
   * Get handler for intent
   */
  getHandler(intent: IntentType): IntentHandler | null {
    const handler = this.handlers.get(intent);
    if (!handler) {
      console.warn(`[HandlerRegistry] No handler found for intent: ${intent}`);
    }
    return handler || null;
  }

  /**
   * Check if handler exists for intent
   */
  hasHandler(intent: IntentType): boolean {
    return this.handlers.has(intent);
  }

  /**
   * Execute handler for context
   */
  async execute(context: HandlerContext): Promise<HandlerResult> {
    const handler = this.getHandler(context.intent);

    if (!handler) {
      return {
        success: false,
        output: null,
        tokensUsed: {
          input: 0,
          output: 0,
          total: 0,
        },
        cost: 0,
        latency: 0,
        error: `No handler registered for intent: ${context.intent}`,
      };
    }

    try {
      return await handler.handle(context);
    } catch (error) {
      console.error(`[HandlerRegistry] Error executing handler for ${context.intent}:`, error);
      return {
        success: false,
        output: null,
        tokensUsed: {
          input: 0,
          output: 0,
          total: 0,
        },
        cost: 0,
        latency: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get all registered intents
   */
  getRegisteredIntents(): IntentType[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * Get handler count
   */
  getHandlerCount(): number {
    return this.handlers.size;
  }

  /**
   * Clear all handlers
   */
  clear(): void {
    this.handlers.clear();
    console.log('[HandlerRegistry] Cleared all handlers');
  }
}

/**
 * Singleton instance for convenient access
 */
export const handlerRegistry = new HandlerRegistry();
