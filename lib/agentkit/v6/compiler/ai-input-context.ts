/**
 * AI input-context detection (Item 11 / WP-58)
 *
 * An AI/processing step (`ai_processing` / `generate`) only receives its declared
 * `input` payload as data. When its instruction *references* another in-scope
 * variable — most importantly the enclosing scatter's loop `itemVariable`, but
 * also any other available variable — that reference is just prose to the model
 * unless the variable is actually placed in the step's input context. The result
 * is blank output columns for fields the model was told to copy from a variable
 * it never received (the `0ee53785` blank From/Subject/Filename columns).
 *
 * This module is the SINGLE, deterministic detection primitive shared by every
 * fix call site (no divergent copies — cross-cutting constraint #5 / P6):
 *   1. `IntentToIRConverter` (root cause) — populates `AIConfig.additional_inputs`.
 *   2. `ExecutionGraphCompiler.compileAIOperation` (resolver) — injects each as a
 *      labelled `{{var}}` block so the runtime hands the value to the model.
 *   3. `scripts/fix-ai-scatter-loopvar-input.ts` — the in-place DSL edit for
 *      already-saved agents that don't self-heal on recalibration.
 *
 * Detection is structural and reference-driven: it matches the instruction text
 * against the CONCRETE set of in-scope variable names that already exist in the
 * workflow. There are ZERO plugin names and ZERO hardcoded field names — a
 * variable is only ever a candidate because the surrounding graph declares it
 * (the scatter loop var, other step inputs). A loop var is a candidate only
 * inside its own scatter, which gives correct scoping for free.
 */

/**
 * Reduce a variable reference to its base variable name.
 *
 * Strips `{{ }}` wrappers and any dotted / bracket-indexed path so that
 * `"{{attachment_item.subject}}"`, `"attachment_item"`, and
 * `"current_email.attachments[0]"` all collapse to their root variable
 * (`attachment_item`, `attachment_item`, `current_email`).
 */
export function extractBaseVarName(ref: string): string {
  if (!ref) return ''
  // Drop template braces, then take the segment before the first `.` or `[`.
  const bare = ref.replace(/\{\{|\}\}/g, '').trim()
  const base = bare.split(/[.[]/)[0]
  return base.trim()
}

/**
 * Return the subset of `candidateVariables` whose base name is referenced in
 * `instruction` (word-boundary match) and is NOT already bound to the step.
 *
 * @param instruction         The AI step's free-text instruction / prompt.
 * @param candidateVariables  In-scope variable names/refs that actually exist in
 *                            the workflow (e.g. the scatter `itemVariable`, other
 *                            declared step inputs). Detection never invents names.
 * @param boundVariables      Variable names/refs already carried in the step's
 *                            input (the primary input), which must not be
 *                            re-injected.
 * @returns Deduplicated base variable names to add to the step's input context,
 *          preserving the order of `candidateVariables`.
 */
export function detectReferencedInScopeVariables(
  instruction: string,
  candidateVariables: string[],
  boundVariables: string[]
): string[] {
  if (!instruction || !candidateVariables?.length) return []

  const boundSet = new Set(
    (boundVariables || []).map(extractBaseVarName).filter(Boolean)
  )

  const result: string[] = []
  const seen = new Set<string>()

  for (const candidate of candidateVariables) {
    const base = extractBaseVarName(candidate)
    if (!base || boundSet.has(base) || seen.has(base)) continue

    // Word-boundary match on the exact variable name. This catches both a bare
    // mention (`attachment_item`) and a dotted reference (`attachment_item.subject`)
    // because `\b` sits at the `_`→`.` transition. Escape regex-special chars
    // defensively (variable names are normally plain identifiers).
    const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`\\b${escaped}\\b`)
    if (re.test(instruction)) {
      result.push(base)
      seen.add(base)
    }
  }

  return result
}
