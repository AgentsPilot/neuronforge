/**
 * Hard Requirements Formatter
 *
 * Shared utility for formatting hard requirements across pipeline phases.
 * Provides both compact hybrid (JSON + brief instructions) and verbose markdown formats.
 *
 * Usage:
 *   - Phase 1 (Semantic Planning): Formats requirements for LLM understanding
 *   - Phase 3 (IR Formalization): Formats requirements for IR enforcement
 */

import type { HardRequirements } from '../requirements/HardRequirementsExtractor'

export type RequirementsFormat = 'compact_hybrid' | 'verbose_markdown'
export type PhaseContext = 'semantic_plan' | 'ir_formalization'

export interface FormattingOptions {
  format: RequirementsFormat
  phaseContext: PhaseContext
}

export class HardRequirementsFormatter {
  /**
   * Format hard requirements for LLM consumption
   * @param requirements - The hard requirements to format
   * @param options - Formatting options (format type and phase context)
   * @returns Formatted markdown string ready for LLM prompt
   */
  static format(
    requirements: HardRequirements,
    options: FormattingOptions
  ): string {
    if (options.format === 'compact_hybrid') {
      return this.formatCompactHybrid(requirements, options.phaseContext)
    }
    return this.formatVerboseMarkdown(requirements, options.phaseContext)
  }

  /**
   * Compact Hybrid Format: Brief instructions + JSON structure
   * Recommended default - 67% token reduction while maintaining LLM clarity
   */
  private static formatCompactHybrid(
    reqs: HardRequirements,
    phaseContext: PhaseContext
  ): string {
    return `
## Hard Requirements (Non-Negotiable Constraints)

The following constraints were extracted from the user's intent and MUST be preserved:

\`\`\`json
${JSON.stringify(reqs, null, 2)}
\`\`\`

${this.getPhaseInstructions(phaseContext)}
`
  }

  /**
   * Get phase-specific integration instructions
   * Guides LLM on how to map requirements to phase-specific structures
   */
  private static getPhaseInstructions(phaseContext: PhaseContext): string {
    if (phaseContext === 'semantic_plan') {
      return `**Integration Guide:**
- \`unit_of_work\` → understanding.data_sources processing level
- \`thresholds\` → understanding.delivery.conditions or post_ai_filtering
- \`routing_rules\` → understanding.delivery.recipients_description (partition logic)
- \`invariants\` → operation ordering in file_operations or assumptions
- \`required_outputs\` → understanding.rendering.columns_to_include
- \`side_effect_constraints\` → conditional execution logic

Fill \`requirements_mapping\` array to show preservation strategy for each requirement ID.`
    } else if (phaseContext === 'ir_formalization') {
      return `**IR Mapping Rules:**
1. **Thresholds** → \`conditionals\` array with choice nodes
2. **Sequential dependencies** → execution graph \`next\` pointers + \`inputs\`/\`outputs\`
3. **Routing rules** → \`conditionals\` with partition-based delivery
4. **Required outputs** → \`rendering.columns_to_include\` + AI output_fields
5. **Unit of work** → data source iteration strategy
6. **Side effect constraints** → conditional execution enforcement

ALL requirements must be enforced in IR. Track enforcement in \`requirements_enforcement\` array.`
    }
    return ''
  }

  /**
   * Verbose Markdown Format: Detailed subsections with explanatory text
   * Legacy format - kept for rollback capability
   */
  private static formatVerboseMarkdown(
    reqs: HardRequirements,
    phaseContext: PhaseContext
  ): string {
    let message = `## Hard Requirements (MUST PRESERVE)\n\n`
    message += `These are non-negotiable constraints extracted from the user's intent. Your ${phaseContext === 'semantic_plan' ? 'Semantic Plan' : 'IR'} MUST preserve these:\n\n`

    // Unit of work
    if (reqs.unit_of_work) {
      message += `### Unit of Work\n`
      message += `- **Processing Level**: ${reqs.unit_of_work}\n`
      message += `- CRITICAL: All operations MUST be performed at the ${reqs.unit_of_work} level\n\n`
    }

    // Thresholds
    if (reqs.thresholds && reqs.thresholds.length > 0) {
      message += `### Thresholds (Conditional Execution)\n`
      reqs.thresholds.forEach((threshold, idx) => {
        message += `${idx + 1}. **${threshold.field} ${threshold.operator} ${threshold.value}**\n`
        message += `   - Applies to: ${threshold.applies_to.join(', ')}\n`
        message += `   - CRITICAL: These actions ONLY execute when condition is true\n`
      })
      message += '\n'
    }

    // Routing rules
    if (reqs.routing_rules && reqs.routing_rules.length > 0) {
      message += `### Routing Rules (Deterministic Branching)\n`
      reqs.routing_rules.forEach((rule, idx) => {
        message += `${idx + 1}. When **${rule.condition}** = "${rule.field_value}" → deliver to **${rule.destination}**\n`
      })
      message += `   - CRITICAL: These are deterministic rules, NOT user preferences\n\n`
    }

    // Invariants
    if (reqs.invariants && reqs.invariants.length > 0) {
      message += `### Invariants (MUST NEVER VIOLATE)\n`
      reqs.invariants.forEach((invariant, idx) => {
        message += `${idx + 1}. **${invariant.type}**: ${invariant.description}\n`
        message += `   - Check: ${invariant.check}\n`
      })
      message += '\n'
    }

    // Required outputs
    if (reqs.required_outputs && reqs.required_outputs.length > 0) {
      message += `### Required Outputs\n`
      message += `The following fields MUST be present in final output:\n`
      reqs.required_outputs.forEach(field => {
        message += `- ${field}\n`
      })
      message += '\n'
    }

    // Side effect constraints
    if (reqs.side_effect_constraints && reqs.side_effect_constraints.length > 0) {
      message += `### Side Effect Constraints\n`
      reqs.side_effect_constraints.forEach((constraint, idx) => {
        message += `${idx + 1}. **${constraint.action}**\n`
        message += `   - Allowed when: ${constraint.allowed_when}\n`
        message += `   - Forbidden when: ${constraint.forbidden_when}\n`
      })
      message += '\n'
    }

    // All requirements list
    if (reqs.requirements && reqs.requirements.length > 0) {
      message += `### All Requirements (${reqs.requirements.length} total)\n`
      reqs.requirements.forEach(req => {
        message += `- **[${req.id}]** (${req.type}): ${req.constraint}\n`
        message += `  - Source: "${req.source}"\n`
      })
      message += '\n'
    }

    return message
  }

  /**
   * Estimate token count for formatted output
   * Uses ~4 characters per token approximation
   */
  static estimateTokens(
    requirements: HardRequirements,
    format: RequirementsFormat
  ): number {
    const formatted = this.format(requirements, {
      format,
      phaseContext: 'semantic_plan' // Use semantic as representative
    })
    return Math.ceil(formatted.length / 4)
  }
}
