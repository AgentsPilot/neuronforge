/**
 * Intent Handlers - Public API
 *
 * Pluggable intent-specific handlers for orchestration
 * All 10 intent types covered
 */

// Base handler
export { BaseHandler } from './BaseHandler';

// Concrete handlers (10 intent types)
export { ExtractHandler } from './ExtractHandler';
export { SummarizeHandler } from './SummarizeHandler';
export { GenerateHandler } from './GenerateHandler';
export { ValidateHandler } from './ValidateHandler';
export { SendHandler } from './SendHandler';
export { TransformHandler } from './TransformHandler';
export { ConditionalHandler } from './ConditionalHandler';
export { AggregateHandler } from './AggregateHandler';
export { FilterHandler } from './FilterHandler';
export { EnrichHandler } from './EnrichHandler';

// Handler registry (only export the instance, not the class to avoid duplicate export)
export { handlerRegistry } from './HandlerRegistry';
