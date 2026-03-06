/**
 * Semantic Skeleton Types
 *
 * Type definitions for the semantic skeleton intermediate representation.
 * The skeleton represents business logic flow in a simplified, natural language format.
 */

/**
 * Base action interface - all skeleton actions extend this
 */
export interface BaseSkeletonAction {
  action: 'fetch' | 'loop' | 'extract' | 'decide' | 'create' | 'upload' | 'send' | 'filter' | 'skip' | 'update' | 'aggregate'
}

/**
 * Fetch Action - Retrieve data from a source
 */
export interface FetchAction extends BaseSkeletonAction {
  action: 'fetch'
  what: string // Description of what to retrieve (e.g., "Gmail messages from last 7 days")
}

/**
 * Loop Action - Iterate over a collection
 */
export interface LoopAction extends BaseSkeletonAction {
  action: 'loop'
  over: string // Description of collection to iterate over
  collect_results: boolean // Whether to collect outputs from loop iterations
  do: SkeletonAction[] // Actions to perform in loop body
}

/**
 * Extract Action - Extract specific fields from current item
 */
export interface ExtractAction extends BaseSkeletonAction {
  action: 'extract'
  fields: string[] // Field names to extract
}

/**
 * Decide Action - Conditional branching
 */
export interface DecideAction extends BaseSkeletonAction {
  action: 'decide'
  if: string // Condition description
  then: SkeletonAction[] // Actions if condition is true
  else?: SkeletonAction[] // Actions if condition is false (optional)
}

/**
 * Create Action - Create a new resource
 */
export interface CreateAction extends BaseSkeletonAction {
  action: 'create'
  what: string // Description of resource to create
}

/**
 * Upload Action - Store data to a destination
 */
export interface UploadAction extends BaseSkeletonAction {
  action: 'upload'
  what: string // Description of what to upload
  to: string // Destination description
}

/**
 * Send Action - Send a message or notification
 */
export interface SendAction extends BaseSkeletonAction {
  action: 'send'
  what: string // Description of what to send
}

/**
 * Filter Action - Filter a collection by criteria
 */
export interface FilterAction extends BaseSkeletonAction {
  action: 'filter'
  collection: string // Collection description
  by: string // Criteria description
}

/**
 * Skip Action - Skip processing current item
 */
export interface SkipAction extends BaseSkeletonAction {
  action: 'skip'
}

/**
 * Update Action - Modify existing data
 */
export interface UpdateAction extends BaseSkeletonAction {
  action: 'update'
  what: string // Description of item to update
  with: string // Description of new values
}

/**
 * Aggregate Action - Combine or summarize collected data
 */
export interface AggregateAction extends BaseSkeletonAction {
  action: 'aggregate'
  data: string // Description of data to aggregate
  by: string // Aggregation method (sum, count, average, group by, etc.)
}

/**
 * Union type for all skeleton actions
 */
export type SkeletonAction =
  | FetchAction
  | LoopAction
  | ExtractAction
  | DecideAction
  | CreateAction
  | UploadAction
  | SendAction
  | FilterAction
  | SkipAction
  | UpdateAction
  | AggregateAction

/**
 * Semantic Skeleton
 *
 * Simplified representation of workflow business logic.
 * This is the output of LLM #1 (skeleton generation).
 */
export interface SemanticSkeleton {
  /** Concise description of what this workflow achieves */
  goal: string

  /** The entity that defines one output record (e.g., "email", "attachment", "row") */
  unit_of_work: string

  /** Sequential flow of actions */
  flow: SkeletonAction[]
}

/**
 * Loop Structure - Extracted from skeleton for IR generation
 */
export interface LoopStructure {
  /** Nesting level (1 = outer, 2 = nested, etc.) */
  level: number

  /** Description of what to iterate over */
  over: string

  /** Whether this loop should collect results */
  collect_results: boolean

  /** Index in flow array (for reference) */
  flowIndex?: number
}

/**
 * Conditional Structure - Extracted from skeleton for IR generation
 */
export interface ConditionalStructure {
  /** Condition description */
  condition: string

  /** Actions to perform if condition is true */
  then_actions: string[]

  /** Actions to perform if condition is false */
  else_actions: string[]

  /** Index in flow array (for reference) */
  flowIndex?: number
}

/**
 * Augmented Enhanced Prompt - Enhanced Prompt + Semantic Structure
 *
 * This is what gets sent to LLM #2 (IR generation).
 */
export interface EnhancedPromptWithStructure {
  /** Original Enhanced Prompt fields */
  sections: {
    data: string[]
    actions: string[]
    output: string[]
    delivery: string[]
    processing_steps?: string[]
  }
  specifics?: {
    services_involved?: string[]
    resolved_user_inputs?: Array<{ key: string; value: string }>
  }

  /** NEW: Semantic structure guidance */
  semantic_structure: {
    /** Workflow goal */
    goal: string

    /** Unit of work entity */
    unit_of_work: string

    /** Flattened flow outline (for LLM readability) */
    flow_outline: string[]

    /** Extracted loop structures */
    loop_structure: LoopStructure[]

    /** Extracted conditional logic */
    conditional_logic: ConditionalStructure[]

    /** Identifiers for where to collect results */
    collection_points: string[]
  }
}
