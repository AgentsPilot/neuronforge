/**
 * Semantic Skeleton to IR Translator
 *
 * Translates a semantic skeleton (business logic flow) into an augmented Enhanced Prompt
 * that guides IR generation. This separates structure design (LLM #1) from detail filling (LLM #2).
 */

import type {
  SemanticSkeleton,
  SkeletonAction,
  LoopAction,
  DecideAction,
  LoopStructure,
  ConditionalStructure,
  EnhancedPromptWithStructure,
} from './types/semantic-skeleton-types'

export class SemanticSkeletonToIR {
  /**
   * Augment Enhanced Prompt with skeleton structure
   *
   * Takes the original Enhanced Prompt and adds semantic structure guidance
   * extracted from the skeleton. This gives LLM #2 the STRUCTURE to fill in.
   *
   * @param originalPrompt - The Enhanced Prompt from Phase 0
   * @param skeleton - The semantic skeleton from Phase 1
   * @returns Augmented prompt with semantic structure guidance
   */
  augmentEnhancedPrompt(
    originalPrompt: any, // Using 'any' for now since EnhancedPrompt type may vary
    skeleton: SemanticSkeleton
  ): EnhancedPromptWithStructure {
    return {
      ...originalPrompt,
      semantic_structure: {
        goal: skeleton.goal,
        unit_of_work: skeleton.unit_of_work,
        flow_outline: this.flattenFlow(skeleton.flow),
        loop_structure: this.extractLoopStructure(skeleton.flow),
        conditional_logic: this.extractConditionals(skeleton.flow),
        collection_points: this.findCollectionPoints(skeleton.flow),
        filter_hints: this.extractFilterHints(skeleton.flow),
      },
    }
  }

  /**
   * Flatten flow into readable outline
   *
   * Converts nested skeleton actions into a flat list of descriptions
   * that LLM can read to understand overall flow.
   *
   * @param flow - Skeleton actions
   * @param indent - Current indentation level (for nested actions)
   * @returns Array of flow step descriptions
   */
  private flattenFlow(flow: SkeletonAction[], indent: number = 0): string[] {
    const outline: string[] = []
    const indentStr = '  '.repeat(indent)

    for (const action of flow) {
      switch (action.action) {
        case 'fetch':
          outline.push(`${indentStr}fetch: ${action.what}`)
          break

        case 'loop':
          outline.push(`${indentStr}loop over: ${action.over} (collect=${action.collect_results})`)
          // Recursively flatten loop body
          outline.push(...this.flattenFlow(action.do, indent + 1))
          break

        case 'extract':
          outline.push(`${indentStr}extract fields: ${action.fields.join(', ')}`)
          break

        case 'decide':
          outline.push(`${indentStr}decide if: ${action.if}`)
          outline.push(`${indentStr}  then:`)
          outline.push(...this.flattenFlow(action.then, indent + 2))
          if (action.else && action.else.length > 0) {
            outline.push(`${indentStr}  else:`)
            outline.push(...this.flattenFlow(action.else, indent + 2))
          }
          break

        case 'create':
          outline.push(`${indentStr}create: ${action.what}`)
          break

        case 'upload':
          outline.push(`${indentStr}upload: ${action.what} to ${action.to}`)
          break

        case 'send':
          outline.push(`${indentStr}send: ${action.what}`)
          break

        case 'filter':
          outline.push(`${indentStr}filter: ${action.collection} by ${action.by}`)
          break

        case 'skip':
          outline.push(`${indentStr}skip current item`)
          break

        case 'update':
          outline.push(`${indentStr}update: ${action.what} with ${action.with}`)
          break

        case 'aggregate':
          outline.push(`${indentStr}aggregate: ${action.data} by ${action.by}`)
          break
      }
    }

    return outline
  }

  /**
   * Extract loop structure from skeleton
   *
   * Parses skeleton flow to identify all loops, their nesting level,
   * and collection flags. This guides LLM #2 in creating proper loop nodes.
   *
   * @param flow - Skeleton actions
   * @param level - Current nesting level (1 = outer, 2 = nested, etc.)
   * @returns Array of loop structures with nesting info
   */
  private extractLoopStructure(
    flow: SkeletonAction[],
    level: number = 1
  ): LoopStructure[] {
    const loops: LoopStructure[] = []

    for (let i = 0; i < flow.length; i++) {
      const action = flow[i]

      if (action.action === 'loop') {
        // Found a loop - record its structure
        loops.push({
          level,
          over: action.over,
          collect_results: action.collect_results,
          flowIndex: i,
        })

        // Recursively extract nested loops from loop body
        const nestedLoops = this.extractLoopStructure(action.do, level + 1)
        loops.push(...nestedLoops)
      } else if (action.action === 'decide') {
        // Check then and else branches for loops
        const thenLoops = this.extractLoopStructure(action.then, level)
        loops.push(...thenLoops)

        if (action.else) {
          const elseLoops = this.extractLoopStructure(action.else, level)
          loops.push(...elseLoops)
        }
      }
    }

    return loops
  }

  /**
   * Extract conditional branches from skeleton
   *
   * Finds all "decide" actions and extracts their conditions and branch actions.
   * This guides LLM #2 in creating choice nodes.
   *
   * @param flow - Skeleton actions
   * @returns Array of conditional structures
   */
  private extractConditionals(flow: SkeletonAction[]): ConditionalStructure[] {
    const conditionals: ConditionalStructure[] = []

    for (let i = 0; i < flow.length; i++) {
      const action = flow[i]

      if (action.action === 'decide') {
        conditionals.push({
          condition: action.if,
          then_actions: this.summarizeActions(action.then),
          else_actions: action.else ? this.summarizeActions(action.else) : [],
          flowIndex: i,
        })

        // Recursively extract conditionals from branches
        conditionals.push(...this.extractConditionals(action.then))
        if (action.else) {
          conditionals.push(...this.extractConditionals(action.else))
        }
      } else if (action.action === 'loop') {
        // Check loop body for conditionals
        conditionals.push(...this.extractConditionals(action.do))
      }
    }

    return conditionals
  }

  /**
   * Summarize actions into short descriptions
   *
   * Converts array of actions into human-readable summaries.
   * Used to describe then/else branches in conditionals.
   *
   * @param actions - Skeleton actions
   * @returns Array of action summaries
   */
  private summarizeActions(actions: SkeletonAction[]): string[] {
    return actions.map(action => {
      switch (action.action) {
        case 'fetch':
          return `fetch ${action.what}`
        case 'loop':
          return `loop over ${action.over}`
        case 'extract':
          return `extract ${action.fields.join(', ')}`
        case 'decide':
          return `decide if ${action.if}`
        case 'create':
          return `create ${action.what}`
        case 'upload':
          return `upload to ${action.to}`
        case 'send':
          return `send ${action.what}`
        case 'filter':
          return `filter by ${action.by}`
        case 'skip':
          return 'skip current item'
        case 'update':
          return `update ${action.what}`
        case 'aggregate':
          return `aggregate ${action.data}`
        default:
          return 'unknown action'
      }
    })
  }

  /**
   * Find collection points in flow
   *
   * Identifies loops that have collect_results=true.
   * Returns identifiers that can be used to reference these loops.
   *
   * @param flow - Skeleton actions
   * @param parentPath - Path prefix for nested loops
   * @returns Array of collection point identifiers
   */
  private findCollectionPoints(
    flow: SkeletonAction[],
    parentPath: string = ''
  ): string[] {
    const collectionPoints: string[] = []

    for (let i = 0; i < flow.length; i++) {
      const action = flow[i]

      if (action.action === 'loop') {
        const loopPath = parentPath ? `${parentPath}.loop_${i}` : `loop_${i}`

        if (action.collect_results) {
          collectionPoints.push(loopPath)
        }

        // Recursively check nested loops
        const nestedPoints = this.findCollectionPoints(action.do, loopPath)
        collectionPoints.push(...nestedPoints)
      } else if (action.action === 'decide') {
        // Check then and else branches
        const thenPoints = this.findCollectionPoints(action.then, parentPath)
        collectionPoints.push(...thenPoints)

        if (action.else) {
          const elsePoints = this.findCollectionPoints(action.else, parentPath)
          collectionPoints.push(...elsePoints)
        }
      }
    }

    return collectionPoints
  }

  /**
   * Extract filter action hints from skeleton
   *
   * Detects filter actions with "X of Y" pattern and provides explicit guidance
   * for field access. This helps LLM understand it needs to use Y.X syntax.
   *
   * @param flow - Skeleton actions
   * @param context - Current loop context for tracking parent item
   * @returns Array of filter hints with explicit field access instructions
   */
  private extractFilterHints(
    flow: SkeletonAction[],
    context: { loopContext?: string } = {}
  ): Array<{ pattern: string; hint: string; collectionField: string }> {
    const hints: Array<{ pattern: string; hint: string; collectionField: string }> = []

    for (const action of flow) {
      if (action.action === 'filter') {
        // Parse "X of Y" pattern
        const match = action.collection.match(/^(.+?)\s+of\s+(.+)$/i)
        if (match) {
          const [, collection] = match
          const collectionField = collection.trim()
          const parentContext = context.loopContext || 'the parent loop item'

          hints.push({
            pattern: action.collection,
            collectionField,
            hint: `This filter operates on "${collectionField}" from ${parentContext}. The transform input MUST access the nested array field using dot notation: {{loop_item_variable.${collectionField}}}. DO NOT use {{loop_item_variable}} alone - that's an object, not an array. You must access the array field within it.`
          })
        }
      } else if (action.action === 'loop') {
        // Recursively check loop body with updated context
        const nestedHints = this.extractFilterHints(action.do, { loopContext: action.over })
        hints.push(...nestedHints)
      } else if (action.action === 'decide') {
        // Check branches
        hints.push(...this.extractFilterHints(action.then, context))
        if (action.else) {
          hints.push(...this.extractFilterHints(action.else, context))
        }
      }
    }

    return hints
  }

  /**
   * Validate that skeleton structure is complete
   *
   * Basic validation to ensure skeleton has required information
   * before augmenting Enhanced Prompt.
   *
   * @param skeleton - Semantic skeleton to validate
   * @throws Error if skeleton is invalid
   */
  validateSkeleton(skeleton: SemanticSkeleton): void {
    if (!skeleton.goal) {
      throw new Error('Skeleton missing required field: goal')
    }

    if (!skeleton.unit_of_work) {
      throw new Error('Skeleton missing required field: unit_of_work')
    }

    if (!skeleton.flow || skeleton.flow.length === 0) {
      throw new Error('Skeleton missing required field: flow (or flow is empty)')
    }

    // Validate that at least one loop has collect_results=true (for unit_of_work enforcement)
    const collectionPoints = this.findCollectionPoints(skeleton.flow)
    if (collectionPoints.length === 0) {
      throw new Error(
        `Skeleton specifies unit_of_work='${skeleton.unit_of_work}' but no loops have collect_results=true`
      )
    }
  }
}
