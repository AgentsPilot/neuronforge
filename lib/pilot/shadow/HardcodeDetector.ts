// lib/pilot/shadow/HardcodeDetector.ts
// Generic hardcode detection system - plugin-agnostic and data-driven
// Detects resource IDs, business logic values, and configuration parameters
// Uses plugin schemas to identify truly user-configurable parameters

export interface DetectedValue {
  // Location information
  path: string // JSONPath-style: "step2.params.spreadsheet_id"
  stepIds: string[] // Which steps use this value
  value: any // The hardcoded value

  // Suggested parameterization
  suggested_param: string // e.g., "spreadsheet_id"
  label: string // User-friendly: "Spreadsheet ID"
  type: 'text' | 'number' | 'email' | 'url' | 'select'

  // Categorization
  category: 'resource_ids' | 'business_logic' | 'configuration'
  priority: 'critical' | 'high' | 'medium' | 'low'

  // Explanation
  reason: string // Why this was detected
}

export interface DetectionResult {
  resource_ids: DetectedValue[]
  business_logic: DetectedValue[]
  configuration: DetectedValue[]
  total_count: number
}

interface ValueOccurrence {
  value: any
  locations: Array<{ stepId: string; path: string; paramName?: string; parentPath?: string }>
  context: string[] // Parent keys: ["params", "condition", etc.]
}

export class HardcodeDetector {
  // Pattern matchers (generic, not plugin-specific)
  private patterns = {
    resource_id: /^[a-zA-Z0-9_-]{15,}$/,
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    url: /^https?:\/\/.+/,
    time_range: /\d+\s*(day|hour|minute|week|month|year)s?/i,
    numeric_threshold: /^\d+$/,
  }

  // User inputs from enhanced prompt (optional, for precise matching)
  private resolvedUserInputs: Map<string, any> = new Map()

  /**
   * Check if a value should be parameterized based on path and resolved user inputs
   *
   * Uses two strategies:
   * 1. If resolvedUserInputs available: Match against known user inputs from agent creation
   * 2. Otherwise: Use DSL Builder's heuristics (data/content/body = step data, rest = user inputs)
   */
  private isUserConfigurableValue(path: string, value: any): boolean {
    const paramName = path.split('.').pop() || ''
    const lowerParamName = paramName.toLowerCase()

    // Skip technical parameters that should never be parameterized
    const technicalParams = [
      'major_dimension',      // Google Sheets - technical format parameter
      'value_input_option',   // Google Sheets - technical parameter
      'insert_data_option',   // Google Sheets - technical parameter
      'response_value_render_option', // Google Sheets - technical parameter
      'query',                // Gmail - complex search syntax
      'q',                    // Gmail - search query shorthand
    ]

    if (technicalParams.includes(lowerParamName)) {
      console.log(`[HardcodeDetector] Skipping technical parameter: ${paramName}`)
      return false
    }

    // Strategy 1: Filter/condition values are ALWAYS business logic (user-facing)
    if ((path.includes('.filter') || path.includes('.condition') || path.includes('.where')) &&
        path.endsWith('.value')) {
      // If we have resolvedUserInputs, check if this filter value matches any
      if (this.resolvedUserInputs.size > 0) {
        // Filter values often match patterns like "complaint_keywords"
        const matchingKey = Array.from(this.resolvedUserInputs.keys()).find(key =>
          key.includes('keyword') || key.includes('filter') || key.includes('rule')
        )
        if (matchingKey) {
          const userValue = this.resolvedUserInputs.get(matchingKey)
          // Check if our value is part of the user's configured values
          if (typeof userValue === 'string' && userValue.includes(String(value))) {
            return true
          }
        }
      }
      // Even without resolvedUserInputs, filter values are user-facing
      return true
    }

    // Strategy 2: Check if this is in .params
    if (!/\.params\.[^.]+$/.test(path)) {
      return false // Not in params, skip
    }

    // Skip booleans - always technical
    if (typeof value === 'boolean') {
      return false
    }

    // DSL Rule: data/input/content/body/message/text/value/item/element → NOT user inputs
    // These are data flow parameters that use {{stepN.data}} or {{loopVar}}
    if (lowerParamName.includes('data') ||
        lowerParamName.includes('input') ||
        lowerParamName.includes('content') ||
        lowerParamName.includes('body') ||
        lowerParamName.includes('message') ||
        lowerParamName.includes('text') ||
        lowerParamName.includes('value') ||
        lowerParamName.includes('item') ||
        lowerParamName.includes('element')) {
      return false
    }

    // If we have resolvedUserInputs, use them as the source of truth
    if (this.resolvedUserInputs.size > 0) {
      // Check if this param name or value matches any resolved user input
      const entries = Array.from(this.resolvedUserInputs.entries());
      for (const [key, userValue] of entries) {
        // Match by param name (e.g., "spreadsheet_id" matches "spreadsheet_id")
        if (key === paramName || key.toLowerCase() === lowerParamName) {
          return true
        }
        // Match by value (e.g., "1pM8Wb..." matches spreadsheet_id value)
        if (userValue === value) {
          return true
        }
        // Match if value is substring of user value (for ranges like "UrgentEmails")
        if (typeof userValue === 'string' && typeof value === 'string') {
          if (userValue.includes(value) || value.includes(userValue)) {
            return true
          }
        }
      }
      // No match found in resolvedUserInputs - skip this param
      return false
    }

    // Fallback: Without resolvedUserInputs, detect everything else in .params
    return true
  }

  /**
   * Main detection method - scans pilot_steps for hardcoded values
   *
   * @param pilotSteps - The workflow steps to scan
   * @param resolvedUserInputs - Optional list from enhanced_prompt.specifics.resolved_user_inputs
   *                              If provided, will use these to identify user-configurable params
   */
  detect(pilotSteps: any[], resolvedUserInputs?: Array<{ key: string; value: any }>): DetectionResult {
    // Store resolved user inputs for matching
    if (resolvedUserInputs && resolvedUserInputs.length > 0) {
      this.resolvedUserInputs.clear()
      resolvedUserInputs.forEach(input => {
        this.resolvedUserInputs.set(input.key, input.value)
      })
      console.log('[HardcodeDetector] Using resolvedUserInputs:', Array.from(this.resolvedUserInputs.entries()))
    } else {
      console.log('[HardcodeDetector] No resolvedUserInputs provided - using fallback heuristics')
    }

    // Create a map of stepId -> step name for labeling
    const stepNameMap = new Map<string, string>()
    pilotSteps.forEach((step, index) => {
      const stepId = step.id || step.step_id
      const stepName = step.name || step.label || `Step ${index + 1}`
      stepNameMap.set(stepId, stepName)
    })

    // Step 1: Find all values and their occurrences
    const valueOccurrences = this.findAllValues(pilotSteps)
    console.log('[HardcodeDetector] Found value occurrences:', valueOccurrences.length)
    console.log('[HardcodeDetector] Sample paths:', valueOccurrences.slice(0, 5).map(v => v.locations[0]?.path))

    // Step 2: Categorize and prioritize
    // Each occurrence is already per-step (thanks to step-specific keys in findAllValues)
    const detectedValues: DetectedValue[] = []

    for (const occurrence of valueOccurrences) {
      const detected = this.categorizeValue(occurrence, stepNameMap)
      if (detected) {
        console.log(`[HardcodeDetector] Created detection for ${detected.path} → ${detected.suggested_param} (step: ${detected.stepIds.join(', ')})`)
        detectedValues.push(detected)
      }
    }

    console.log('[HardcodeDetector] Detected values:', detectedValues.length)
    console.log('[HardcodeDetector] By category:', {
      resource_ids: detectedValues.filter(v => v.category === 'resource_ids').length,
      business_logic: detectedValues.filter(v => v.category === 'business_logic').length,
      configuration: detectedValues.filter(v => v.category === 'configuration').length
    })

    // Step 3: Group by category
    const result: DetectionResult = {
      resource_ids: detectedValues.filter(v => v.category === 'resource_ids'),
      business_logic: detectedValues.filter(v => v.category === 'business_logic'),
      configuration: detectedValues.filter(v => v.category === 'configuration'),
      total_count: detectedValues.length
    }

    return result
  }

  /**
   * Recursively find all values in pilot_steps
   *
   * IMPORTANT: Creates separate occurrences for each step and path, even if they have the same value.
   * This ensures that the same spreadsheet ID in step 2 and step 10 are treated independently.
   * Also handles nested steps in parallel/scatter blocks.
   */
  private findAllValues(pilotSteps: any[]): ValueOccurrence[] {
    // Create a list of all occurrences (not grouped)
    const occurrences: ValueOccurrence[] = []

    const processStep = (step: any) => {
      this.traverseObject(step, step.id, step.id, (value, path, context, paramName, parentPath) => {
        // Skip null, undefined, booleans
        if (value == null || typeof value === 'boolean') return

        // Skip template variables (already parameterized)
        if (typeof value === 'string' && value.includes('{{')) return

        // Check if this value is user-configurable
        if (!this.isUserConfigurableValue(path, value)) return

        // Create a separate occurrence for each unique path in each step
        // This ensures complete independence between steps
        occurrences.push({
          value,
          locations: [{ stepId: step.id, path, paramName, parentPath }],
          context: context
        })
      })

      // Handle nested steps in parallel blocks
      if (step.type === 'parallel' && Array.isArray(step.steps)) {
        step.steps.forEach((nestedStep: any) => {
          processStep(nestedStep)
        })
      }

      // Handle nested steps in scatter_gather blocks
      if (step.type === 'scatter_gather' && step.scatter?.steps) {
        step.scatter.steps.forEach((nestedStep: any) => {
          processStep(nestedStep)
        })
      }
    }

    for (const step of pilotSteps) {
      processStep(step)
    }

    return occurrences
  }

  /**
   * Recursively traverse object and collect values
   */
  private traverseObject(
    obj: any,
    stepId: string,
    basePath: string,
    callback: (value: any, path: string, context: string[], paramName?: string, parentPath?: string) => void
  ) {
    if (obj == null || typeof obj !== 'object') {
      return
    }

    const context: string[] = []

    for (const [key, value] of Object.entries(obj)) {
      const path = basePath ? `${basePath}.${key}` : key

      // Collect context from parent keys
      context.push(key)

      // CRITICAL: Skip 'steps' array in parallel/scatter blocks
      // These nested steps are processed separately by findAllValues() recursive logic
      // to ensure each nested step gets its own unique parameters (e.g., step8_X, step9_X)
      if (key === 'steps' && Array.isArray(value)) {
        continue; // Skip this array entirely - will be processed recursively
      }

      if (value && typeof value === 'object') {
        if (Array.isArray(value)) {
          // Handle arrays
          value.forEach((item, idx) => {
            if (item && typeof item === 'object') {
              this.traverseObject(item, stepId, `${path}[${idx}]`, callback)
            } else {
              callback(item, `${path}[${idx}]`, context, key, basePath)
            }
          })
        } else {
          // Recurse into nested objects
          this.traverseObject(value, stepId, path, callback)
        }
      } else {
        // Leaf value
        callback(value, path, context, key, basePath)
      }
    }
  }

  /**
   * Categorize a value occurrence and generate detection metadata
   */
  /**
   * Categorize a value occurrence - returns DetectedValue for FIRST location only
   * Note: If the same value appears in multiple locations, caller should invoke this
   * multiple times (once per location) to get separate detections
   */
  private categorizeValue(occurrence: ValueOccurrence, stepNameMap: Map<string, string>): DetectedValue | null {
    const { value, locations, context } = occurrence
    const strValue = String(value)
    const stepIds = Array.from(new Set(locations.map(l => l.stepId)))
    const firstLocation = locations[0]

    // Get step name for better labeling
    const stepName = stepNameMap.get(stepIds[0]) || 'unknown step'

    // Determine category and priority based on patterns and context

    // 1. Resource IDs (critical)
    if (this.patterns.resource_id.test(strValue)) {
      const baseParamName = this.extractParamName(firstLocation.path) || 'resource_id'

      return {
        path: firstLocation.path,
        stepIds,
        value,
        suggested_param: baseParamName,
        label: this.humanize(baseParamName),
        type: 'text',
        category: 'resource_ids',
        priority: locations.length > 1 ? 'critical' : 'high',
        reason: `Long ID used in ${stepName}`
      }
    }

    // 2. Email addresses (high priority)
    if (this.patterns.email.test(strValue)) {
      const baseParamName = this.extractParamName(firstLocation.path) || 'email_address'
      return {
        path: firstLocation.path,
        stepIds,
        value,
        suggested_param: baseParamName,
        label: this.humanize(baseParamName),
        type: 'email',
        category: 'resource_ids',
        priority: 'high',
        reason: `Email address used in ${stepName}`
      }
    }

    // 3. URLs (high priority)
    if (this.patterns.url.test(strValue)) {
      const baseParamName = this.extractParamName(firstLocation.path) || 'url'
      return {
        path: firstLocation.path,
        stepIds,
        value,
        suggested_param: baseParamName,
        label: this.humanize(baseParamName),
        type: 'url',
        category: 'configuration',
        priority: 'high',
        reason: `URL used in ${stepName}`
      }
    }

    // 4. Categorize by path structure
    const path = firstLocation.path.toLowerCase()

    // Values in .filter/.condition/.where are business logic
    if (path.includes('.filter') || path.includes('.condition') || path.includes('.where')) {
      // Create unique param name by including the value itself (sanitized)
      const baseParamName = this.extractParamName(firstLocation.path) || 'filter_value'
      const sanitizedValue = String(value)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .substring(0, 30) // Limit length
      const uniqueParamName = `${baseParamName}_${sanitizedValue}`

      return {
        path: firstLocation.path,
        stepIds,
        value,
        suggested_param: uniqueParamName,
        label: `Value: ${String(value)}`,
        type: typeof value === 'number' ? 'number' : 'text',
        category: 'business_logic',
        priority: 'medium',
        reason: `Filter/condition value used in ${stepName}`
      }
    }

    // Values directly in .params are configuration
    if (path.includes('.params.')) {
      const baseParamName = this.extractParamName(firstLocation.path)
      if (!baseParamName) return null // Skip if we can't determine a good name

      return {
        path: firstLocation.path,
        stepIds,
        value,
        suggested_param: baseParamName,
        label: this.humanize(baseParamName),
        type: typeof value === 'number' ? 'number' : 'text',
        category: 'configuration',
        priority: 'medium',
        reason: `Configuration parameter used in ${stepName}`
      }
    }

    // Default: treat as configuration
    const paramName = this.extractParamName(firstLocation.path)
    if (!paramName) return null

    return {
      path: firstLocation.path,
      stepIds,
      value,
      suggested_param: paramName,
      label: this.humanize(paramName),
      type: typeof value === 'number' ? 'number' : 'text',
      category: 'configuration',
      priority: 'low',
      reason: `Parameter used in ${stepName}`
    }
  }

  /**
   * Extract parameter name from JSONPath
   * e.g., "params.spreadsheet_id" → "spreadsheet_id"
   * e.g., "step8.params.range" → "step8_range" (when inside parallel block)
   */
  private extractParamName(path: string): string | null {
    // Split by dots and get segments
    const segments = path.split('.').filter(s => !s.match(/^\d+$/) && !s.includes('['))

    // Check if this path includes a step ID (e.g., step8, step9)
    // This is common in parallel blocks where each parallel step needs unique params
    const stepIdMatch = path.match(/step(\d+)/)
    const stepId = stepIdMatch ? stepIdMatch[0] : null

    // Look for meaningful parameter names
    const meaningfulSegments = segments.filter(s =>
      s.length > 2 && !['params', 'config', 'data'].includes(s) && !s.match(/^step\d+$/)
    )

    if (meaningfulSegments.length > 0) {
      const paramName = meaningfulSegments[meaningfulSegments.length - 1]

      // If we're inside a specific step (not a parent parallel/scatter step),
      // prefix the param name with the step ID to make it unique
      // This handles cases like parallel steps that each need different values
      if (stepId && path.includes(`${stepId}.params.`)) {
        return `${stepId}_${paramName}`
      }

      return paramName
    }

    return segments.length > 0 ? segments[segments.length - 1] : null
  }

  /**
   * Convert snake_case to Title Case and clean up redundant suffixes
   */
  private humanize(str: string): string {
    let result = str
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase())

    // Remove redundant suffixes for cleaner labels
    result = result
      .replace(/\s+Id$/i, '')        // "Spreadsheet Id" → "Spreadsheet"
      .replace(/\s+Name$/i, '')      // "Range Name" → "Range"
      .replace(/\s+Code$/i, '')      // "Product Code" → "Product"
      .replace(/\s+Key$/i, '')       // "Api Key" → "Api"

    return result
  }

  /**
   * Apply parameterization to pilot_steps
   * Replaces hardcoded values with {{input.X}}
   */
  applyParameterization(
    pilotSteps: any[],
    selections: Array<{ path: string; param_name: string; value: any }>
  ): any[] {
    // Create a deep clone
    const repairedSteps = JSON.parse(JSON.stringify(pilotSteps))

    // Apply each replacement
    for (const selection of selections) {
      this.replaceValueAtPath(repairedSteps, selection.path, `{{input.${selection.param_name}}}`)
    }

    return repairedSteps
  }

  /**
   * Recursively find a step by ID, searching nested structures
   */
  private findStepRecursive(steps: any[], stepId: string): any {
    for (const step of steps) {
      if (step.id === stepId) {
        return step
      }

      // Search in nested parallel steps
      if (step.type === 'parallel' && Array.isArray(step.steps)) {
        const found = this.findStepRecursive(step.steps, stepId)
        if (found) return found
      }

      // Search in nested scatter_gather steps
      if (step.type === 'scatter_gather' && step.scatter?.steps) {
        const found = this.findStepRecursive(step.scatter.steps, stepId)
        if (found) return found
      }
    }
    return null
  }

  /**
   * Replace a value at a specific JSONPath in the steps array
   */
  private replaceValueAtPath(steps: any[], path: string, newValue: any) {
    // Parse path like "step2.params.spreadsheet_id" or "step8.config.condition.conditions[0].value"
    const segments = path.split(/\.|\[|\]/).filter(s => s.length > 0)

    if (segments.length === 0) return

    // First segment should be the step identifier (e.g., "step2")
    const stepId = segments[0]

    // Find the step with matching id (recursively search nested steps)
    const targetStep = this.findStepRecursive(steps, stepId)
    if (!targetStep) {
      console.warn(`[HardcodeDetector] Step ${stepId} not found in pilot_steps`)
      return
    }

    // Navigate to the parent object
    let current = targetStep
    for (let i = 1; i < segments.length - 1; i++) {
      const segment = segments[i]
      if (current[segment] === undefined) {
        console.warn(`[HardcodeDetector] Path segment ${segment} not found at ${path}`)
        return
      }
      current = current[segment]
    }

    // Replace the final value
    const lastSegment = segments[segments.length - 1]
    if (current && current[lastSegment] !== undefined) {
      console.log(`[HardcodeDetector] Replacing ${path}: "${current[lastSegment]}" → "${newValue}"`)
      current[lastSegment] = newValue
    } else {
      console.warn(`[HardcodeDetector] Final segment ${lastSegment} not found at ${path}`)
    }
  }
}
