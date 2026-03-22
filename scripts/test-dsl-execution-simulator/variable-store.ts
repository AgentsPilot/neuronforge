/**
 * A3: VariableStore — Config + step output storage, {{template}} resolution
 *
 * Manages execution state: stores config values and step outputs.
 * Resolves {{config.X}}, {{stepOutput.field}}, and {{item.field}} references.
 */

export interface ResolutionResult {
  resolved: any
  unresolvedRefs: string[]
}

export class VariableStore {
  private config: Record<string, any>
  private stepOutputs: Map<string, any> = new Map()
  private scopedVars: Map<string, any> = new Map() // for scatter-gather itemVariable

  constructor(workflowConfig: Record<string, any>) {
    this.config = { ...workflowConfig }
  }

  /**
   * Store a step's output by its output_variable name.
   */
  setStepOutput(outputVariable: string, data: any): void {
    this.stepOutputs.set(outputVariable, data)
  }

  /**
   * Get a step's output by variable name.
   */
  getStepOutput(name: string): any {
    return this.stepOutputs.get(name)
  }

  /**
   * Set a scoped variable (e.g., scatter-gather itemVariable).
   */
  setScopedVar(name: string, value: any): void {
    this.scopedVars.set(name, value)
  }

  /**
   * Clear a scoped variable.
   */
  clearScopedVar(name: string): void {
    this.scopedVars.delete(name)
  }

  /**
   * Get all config keys.
   */
  getConfigKeys(): string[] {
    return Object.keys(this.config)
  }

  /**
   * Get all stored output variable names.
   */
  getOutputVariableNames(): string[] {
    return Array.from(this.stepOutputs.keys())
  }

  /**
   * Deep-resolve all {{template}} references in an object.
   * Returns the resolved object and any unresolved references found.
   */
  resolveDeep(obj: any): ResolutionResult {
    const unresolvedRefs: string[] = []
    const resolved = this._resolveValue(obj, unresolvedRefs)
    return { resolved, unresolvedRefs }
  }

  private _resolveValue(value: any, unresolvedRefs: string[]): any {
    if (value === null || value === undefined) return value

    if (typeof value === 'string') {
      return this._resolveString(value, unresolvedRefs)
    }

    if (Array.isArray(value)) {
      return value.map(item => this._resolveValue(item, unresolvedRefs))
    }

    if (typeof value === 'object') {
      const result: Record<string, any> = {}
      for (const [key, val] of Object.entries(value)) {
        result[key] = this._resolveValue(val, unresolvedRefs)
      }
      return result
    }

    // numbers, booleans — pass through
    return value
  }

  /**
   * Resolve a string that may contain {{template}} references.
   * Handles both full-string templates ({{X}}) and embedded templates ("text {{X}} more").
   */
  private _resolveString(str: string, unresolvedRefs: string[]): any {
    // Check if the entire string is a single template reference
    const fullMatch = str.match(/^\{\{(.+?)\}\}$/)
    if (fullMatch) {
      const ref = fullMatch[1].trim()
      const resolved = this._lookupRef(ref)
      if (resolved === undefined) {
        unresolvedRefs.push(`{{${ref}}}`)
        return str // return original template string
      }
      return resolved // return the actual value (preserves type — object, array, number, etc.)
    }

    // Handle embedded templates within a string
    const result = str.replace(/\{\{(.+?)\}\}/g, (match, ref) => {
      const trimmedRef = ref.trim()
      const resolved = this._lookupRef(trimmedRef)
      if (resolved === undefined) {
        unresolvedRefs.push(`{{${trimmedRef}}}`)
        return match // keep original
      }
      return String(resolved)
    })

    return result
  }

  /**
   * Look up a reference like "config.X", "stepOutput.field", "item.field".
   */
  private _lookupRef(ref: string): any {
    const parts = ref.split('.')

    // config.X
    if (parts[0] === 'config') {
      const key = parts.slice(1).join('.')
      return this.config[key]
    }

    // Check scoped vars first (scatter-gather itemVariable)
    if (this.scopedVars.has(parts[0])) {
      let value = this.scopedVars.get(parts[0])
      for (let i = 1; i < parts.length; i++) {
        if (value === null || value === undefined) return undefined
        value = value[parts[i]]
      }
      return value
    }

    // Step output: "variableName" or "variableName.field.subfield"
    if (this.stepOutputs.has(parts[0])) {
      let value = this.stepOutputs.get(parts[0])
      for (let i = 1; i < parts.length; i++) {
        if (value === null || value === undefined) return undefined
        value = value[parts[i]]
      }
      return value
    }

    return undefined
  }

  /**
   * Collect all {{config.X}} references from an object tree.
   */
  static collectConfigRefs(obj: any): string[] {
    const refs: string[] = []
    const seen = new Set<string>()

    function walk(value: any) {
      if (typeof value === 'string') {
        const matches = value.matchAll(/\{\{config\.(.+?)\}\}/g)
        for (const match of matches) {
          if (!seen.has(match[1])) {
            seen.add(match[1])
            refs.push(match[1])
          }
        }
      } else if (Array.isArray(value)) {
        value.forEach(walk)
      } else if (value && typeof value === 'object') {
        Object.values(value).forEach(walk)
      }
    }

    walk(obj)
    return refs
  }

  /**
   * Collect all {{X}} variable references from an object tree.
   */
  static collectAllRefs(obj: any): string[] {
    const refs: string[] = []
    const seen = new Set<string>()

    function walk(value: any) {
      if (typeof value === 'string') {
        const matches = value.matchAll(/\{\{(.+?)\}\}/g)
        for (const match of matches) {
          const ref = match[1].trim()
          if (!seen.has(ref)) {
            seen.add(ref)
            refs.push(ref)
          }
        }
      } else if (Array.isArray(value)) {
        value.forEach(walk)
      } else if (value && typeof value === 'object') {
        Object.values(value).forEach(walk)
      }
    }

    walk(obj)
    return refs
  }
}
