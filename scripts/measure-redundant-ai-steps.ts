#!/usr/bin/env ts-node
/**
 * W5 Measurement — Residual `ai_processing` steps matching deterministic-op fingerprints
 *
 * Sweeps every V6 regression scenario's `phase4-pilot-dsl-steps.json` and counts
 * `ai_processing` steps whose `prompt` field matches a deterministic-operation
 * fingerprint. Each match suggests the LLM routed an operation to AI when a
 * structured `transform` primitive (with_fields, project_column, set_difference,
 * filter, etc.) would have expressed the same intent more cheaply, faster, and
 * with runtime-validatable outputs.
 *
 * Decision gates (per primitive, applied independently):
 *
 *   - residual count = 0 across all 10 scenarios → corresponding AI-fallback
 *     path is SAFE TO RETIRE. (Per Q-A4 sequencing in DESIGN_REBASE.md, the
 *     existing fallback paths in StepExecutor stay active until measurement
 *     proves they no longer fire.)
 *
 *   - residual count > 0 → file a follow-up task in WORKPLAN.md Phase 4 to
 *     add a compiler rewrite pass for that pattern.
 *
 * The script is idempotent and side-effect-free: read-only sweep + console
 * report. Run it manually, in CI, or in a /loop for continuous tracking.
 *
 * Usage:
 *   npx ts-node scripts/measure-redundant-ai-steps.ts
 *   npx ts-node scripts/measure-redundant-ai-steps.ts --json   # machine-readable
 *   npx ts-node scripts/measure-redundant-ai-steps.ts --scenarios complaint-email-logger,gantt-urgent-tasks
 *
 * Workplan: docs/v6/V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_INTENT_CONTRACT.md task 0.12
 * Inventory baseline: docs/v6/V6_WP16_INVENTORY.md
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

// ─── Fingerprint definitions ────────────────────────────────────────────────

/**
 * Each fingerprint describes a deterministic-op pattern that, if matched in
 * an ai_processing step's prompt, suggests the LLM should have used a
 * structured transform primitive instead.
 *
 * Patterns are case-INsensitive and operate on the normalized prompt
 * (whitespace collapsed). They are intentionally conservative — better
 * to under-count and miss a few cases than over-count and create noise.
 */
interface Fingerprint {
  /** Canonical primitive name (matches the transform op kind in IntentContract grammar) */
  primitive: string

  /** Human-readable description for the report */
  description: string

  /** Regexes tested against the lowercased prompt text */
  patterns: RegExp[]

  /** Example LLM phrase that would match (for the report) */
  example: string

  /** Reference to the structured replacement (workplan task or grammar reference) */
  replaceWith: string
}

const FINGERPRINTS: Fingerprint[] = [
  {
    primitive: 'project_column',
    description: 'Extract a single column or field from each row of an array',
    patterns: [
      /\bextract\s+(?:the\s+)?(?:values?\s+from\s+)?(?:the\s+)?(?:fifth|fourth|third|second|first|\d+(?:st|nd|rd|th)?)\s+column\b/i,
      /\bextract\s+(?:the\s+)?values?\s+from\s+column\b/i,
      /\b(?:return|extract|get)\s+(?:only\s+)?(?:the\s+)?(?:column|field)\s+\d/i,
    ],
    example: '"From the sheet rows, extract the values from the fifth column..."',
    replaceWith: 'transform/project_column with column={kind:"by_index",index:N}',
  },
  {
    primitive: 'set_difference',
    description: 'Anti-join — keep items NOT present in a reference array',
    patterns: [
      /\bremove\s+(?:rows?|records?|items?|entries)\s+(?:that\s+(?:are\s+)?)?already\s+(?:in|present|exist)/i,
      /\bskip\s+(?:rows?|records?|items?)\s+(?:that\s+)?(?:are\s+)?already/i,
      /\bkeep\s+only\s+(?:rows?|records?|items?)\s+(?:whose|where).{0,40}\b(?:not\s+(?:in|already)|n[o']t\s+(?:in|already))/i,
      /\bdedup(?:licate|e)?\s+against\b/i,
      /\bnot\s+already\s+(?:logged|added|present|in\s+the)/i,
    ],
    example: '"Compare each record against the existing list. Keep only records whose key is not already present."',
    replaceWith: 'transform/set_difference with reference="<slot>", key_field="<name>"',
  },
  {
    primitive: 'with_fields',
    description: 'Augment items with computed fields (boolean, status, date math, string concat, template)',
    patterns: [
      // Computed boolean (has_valid_X = X is not null)
      /\b(?:set|add|compute)\s+(?:a\s+)?\w+\s+(?:field\s+)?(?:to\s+)?(?:true\s+if|false\s+if|=\s*\w+\s+(?:is|!=)\s+null)/i,
      // Status reasoning (set status to X if all required fields present, else Y)
      /\bset\s+(?:the\s+)?status(?:\s+field)?\s+to\b/i,
      // Date arithmetic
      /\bcompute\s+days?\s+(?:remaining|until|from|since|between)\b/i,
      /\bdays?\s+(?:remaining|until|from|since)\s*=\s*\w+\s*[-+]\s*today\b/i,
      // String composition / template substitution
      /\bconstruct\s+(?:the\s+)?(?:url|link|path)\s+(?:as|using)\b/i,
      /\breplace\s+\{[\w_]+\}\s+(?:with|in)\b/i,
      // Add a derived field
      /\badd\s+(?:a\s+)?\w+\s+field\s+(?:that|with|as)\b/i,
      // Build a row by combining sources
      /\bbuild\s+(?:a\s+)?(?:row|record)\s+(?:that\s+)?combin\w+/i,
      /\bcombine\s+(?:the\s+)?(?:extracted\s+)?\w+\s+(?:fields\s+)?(?:with|and)\s+the\s+\w+'?s?/i,
    ],
    example: '"Add has_valid_amount as a boolean: true if amount is a valid number, false otherwise"',
    replaceWith: 'transform/with_fields with appropriate Expression (null_check, if, concat, date_diff, etc.)',
  },
  {
    primitive: 'filter',
    description: 'Filter array by structured rule',
    patterns: [
      /\bkeep\s+only\s+(?:rows?|records?|items?|messages?|emails?)\s+(?:where|whose|that)\s+\w+\s+(?:contains?|equals?|=|matches?|includes?)/i,
      /\bfilter\s+(?:to\s+)?(?:only\s+)?(?:keep\s+)?(?:rows?|records?|items?|messages?|emails?)\s+(?:where|whose|that)/i,
    ],
    example: '"Keep only rows where Stage equals 4"',
    replaceWith: 'transform/filter with structured `where` condition',
  },
  {
    primitive: 'group',
    description: 'Group items by a field value',
    patterns: [
      /\bgroup\s+(?:the\s+)?(?:rows?|records?|items?|results?)\s+by\s+\w+/i,
      /\bgroup\s+by\s+(?:the\s+)?[\w\s]+\s+(?:column|field)/i,
    ],
    example: '"Group the leads by Sales Person"',
    replaceWith: 'transform/group with rules.group_by="<field>"',
  },
  {
    primitive: 'sort',
    description: 'Sort items by a field',
    patterns: [
      /\bsort\s+(?:the\s+)?(?:rows?|records?|items?|results?)\s+by\s+\w+/i,
      /\b(?:order|sort)\s+by\s+\w+\s+(?:ascending|descending|asc|desc)/i,
    ],
    example: '"Sort the contracts by end_date ascending"',
    replaceWith: 'transform/sort with rules.sort_by="<field>"',
  },
  {
    primitive: 'dedupe',
    description: 'Deduplicate by a field',
    patterns: [
      /\bdedup(?:e|licate)\s+by\s+\w+/i,
      /\bremove\s+duplicates?\s+(?:where|by|on)\s+\w+/i,
    ],
    example: '"Dedupe records by email_address"',
    replaceWith: 'transform/dedupe with rules.field="<field>"',
  },
]

// ─── Scenario sweep ──────────────────────────────────────────────────────────

interface AiProcessingHit {
  scenario: string
  step_id: string
  primitive: string
  matched_pattern: string
  prompt_snippet: string
}

interface ScenarioReport {
  scenario: string
  ai_processing_total: number
  hits: AiProcessingHit[]
  legitimate_remaining: number
}

interface MeasurementReport {
  generated_at: string
  scenarios_swept: number
  total_ai_processing_steps: number
  total_residual_hits: number
  hits_by_primitive: Record<string, number>
  scenarios: ScenarioReport[]
  /** Decision gate state per primitive */
  retirement_gates: Record<string, { residual: number; safe_to_retire: boolean }>
}

// Resolve relative to repo root (assumes script is run from repo root, which
// is the standard `npx ts-node scripts/...` invocation).
const SCENARIOS_ROOT = path.resolve(process.cwd(), 'tests/v6-regression/scenarios')

function listScenarios(filter?: Set<string>): string[] {
  if (!fs.existsSync(SCENARIOS_ROOT)) {
    console.error(`[measure-redundant-ai-steps] Scenarios directory not found: ${SCENARIOS_ROOT}`)
    process.exit(2)
  }
  const all = fs
    .readdirSync(SCENARIOS_ROOT, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort()
  return filter ? all.filter(s => filter.has(s)) : all
}

function readPhase4Steps(scenario: string): any[] | null {
  const file = path.join(SCENARIOS_ROOT, scenario, 'output', 'phase4-pilot-dsl-steps.json')
  if (!fs.existsSync(file)) return null
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch (err) {
    console.error(`[measure-redundant-ai-steps] Failed to parse ${file}: ${(err as Error).message}`)
    return null
  }
}

/**
 * Walk the DSL step tree (including nested steps inside scatter_gather, conditional, loop)
 * and yield every ai_processing step.
 */
function* walkAiProcessingSteps(steps: any[]): Generator<any> {
  if (!Array.isArray(steps)) return
  for (const step of steps) {
    if (!step || typeof step !== 'object') continue
    if (step.type === 'ai_processing') {
      yield step
    }
    // Recurse into nested step containers
    if (Array.isArray(step.steps)) yield* walkAiProcessingSteps(step.steps)
    if (Array.isArray(step.scatter?.steps)) yield* walkAiProcessingSteps(step.scatter.steps)
    if (Array.isArray(step.then_steps)) yield* walkAiProcessingSteps(step.then_steps)
    if (Array.isArray(step.else_steps)) yield* walkAiProcessingSteps(step.else_steps)
    if (Array.isArray(step.then)) yield* walkAiProcessingSteps(step.then)
    if (Array.isArray(step.else)) yield* walkAiProcessingSteps(step.else)
  }
}

function classifyPrompt(prompt: string): { primitive: string; pattern: string } | null {
  if (typeof prompt !== 'string' || prompt.length === 0) return null
  // Normalize whitespace for stable matching against multi-line prompts
  const normalized = prompt.replace(/\s+/g, ' ').trim()
  for (const fp of FINGERPRINTS) {
    for (const pattern of fp.patterns) {
      if (pattern.test(normalized)) {
        return { primitive: fp.primitive, pattern: pattern.source }
      }
    }
  }
  return null
}

function sweep(scenarios: string[]): MeasurementReport {
  const hitsByPrimitive: Record<string, number> = {}
  for (const fp of FINGERPRINTS) hitsByPrimitive[fp.primitive] = 0

  let totalAiSteps = 0
  let totalHits = 0
  const scenarioReports: ScenarioReport[] = []

  for (const scenario of scenarios) {
    const steps = readPhase4Steps(scenario)
    if (!steps) {
      console.warn(`[measure-redundant-ai-steps] ${scenario}: no phase4-pilot-dsl-steps.json found, skipping`)
      continue
    }

    const hits: AiProcessingHit[] = []
    let aiCount = 0
    for (const step of walkAiProcessingSteps(steps)) {
      aiCount++
      const result = classifyPrompt(step.prompt)
      if (result) {
        hits.push({
          scenario,
          step_id: step.step_id ?? step.id ?? '<unknown>',
          primitive: result.primitive,
          matched_pattern: result.pattern,
          prompt_snippet: String(step.prompt).slice(0, 200),
        })
        hitsByPrimitive[result.primitive]++
      }
    }

    totalAiSteps += aiCount
    totalHits += hits.length

    scenarioReports.push({
      scenario,
      ai_processing_total: aiCount,
      hits,
      legitimate_remaining: aiCount - hits.length,
    })
  }

  const retirementGates: Record<string, { residual: number; safe_to_retire: boolean }> = {}
  for (const fp of FINGERPRINTS) {
    retirementGates[fp.primitive] = {
      residual: hitsByPrimitive[fp.primitive],
      safe_to_retire: hitsByPrimitive[fp.primitive] === 0,
    }
  }

  return {
    generated_at: new Date().toISOString(),
    scenarios_swept: scenarioReports.length,
    total_ai_processing_steps: totalAiSteps,
    total_residual_hits: totalHits,
    hits_by_primitive: hitsByPrimitive,
    scenarios: scenarioReports,
    retirement_gates: retirementGates,
  }
}

// ─── Reporting ───────────────────────────────────────────────────────────────

function printHumanReport(report: MeasurementReport): void {
  const sep = '─'.repeat(78)

  console.log()
  console.log('═'.repeat(78))
  console.log('  W5 Measurement — Residual ai_processing steps matching deterministic-op fingerprints')
  console.log('═'.repeat(78))
  console.log()
  console.log(`  Generated:           ${report.generated_at}`)
  console.log(`  Scenarios swept:     ${report.scenarios_swept}`)
  console.log(`  ai_processing total: ${report.total_ai_processing_steps}`)
  console.log(`  Residual hits:       ${report.total_residual_hits}`)
  console.log(`  Legitimate AI:       ${report.total_ai_processing_steps - report.total_residual_hits}`)
  console.log()
  console.log(sep)
  console.log(' Retirement Gates (per primitive)')
  console.log(sep)
  for (const [primitive, gate] of Object.entries(report.retirement_gates)) {
    const fp = FINGERPRINTS.find(f => f.primitive === primitive)!
    const status = gate.safe_to_retire ? '✅ SAFE TO RETIRE' : '⛔ KEEP FALLBACK'
    const pad = primitive.padEnd(18)
    console.log(`  ${pad} residual=${String(gate.residual).padStart(2)}  ${status}`)
    if (!gate.safe_to_retire) {
      console.log(`  ${' '.repeat(18)}   → ${fp.replaceWith}`)
    }
  }
  console.log()
  console.log(sep)
  console.log(' Per-Scenario Breakdown')
  console.log(sep)
  for (const sc of report.scenarios) {
    const flag = sc.hits.length === 0 ? '✅' : '⚠️ '
    console.log(`  ${flag} ${sc.scenario.padEnd(40)} ai=${String(sc.ai_processing_total).padStart(2)}  hits=${String(sc.hits.length).padStart(2)}  legit=${String(sc.legitimate_remaining).padStart(2)}`)
    for (const hit of sc.hits) {
      console.log(`     → ${hit.step_id} (${hit.primitive}): "${hit.prompt_snippet.replace(/\s+/g, ' ').slice(0, 110)}${hit.prompt_snippet.length > 110 ? '…' : ''}"`)
    }
  }
  console.log()
  console.log(sep)
  console.log(' Decision Summary')
  console.log(sep)
  const safeToRetire = Object.entries(report.retirement_gates).filter(([_, g]) => g.safe_to_retire).map(([p]) => p)
  const keep = Object.entries(report.retirement_gates).filter(([_, g]) => !g.safe_to_retire).map(([p]) => p)
  if (safeToRetire.length > 0) {
    console.log(`  ✅ Safe to retire (residual=0):  ${safeToRetire.join(', ')}`)
  } else {
    console.log(`  ✅ Safe to retire (residual=0):  (none yet — keep all fallback paths active)`)
  }
  if (keep.length > 0) {
    console.log(`  ⛔ Keep fallback paths:          ${keep.join(', ')}`)
  }
  console.log()
  console.log(sep)
  console.log(' Per Q-A4 sequencing (DESIGN_REBASE.md): primitives marked SAFE TO RETIRE')
  console.log(' may have their corresponding AI-fallback paths in StepExecutor disabled.')
  console.log(' For primitives with residue > 0, file follow-up tasks in Phase 4.')
  console.log(sep)
  console.log()
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): { json: boolean; scenarios?: Set<string> } {
  let json = false
  let scenarios: Set<string> | undefined
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--json') json = true
    else if (arg === '--scenarios' && i + 1 < argv.length) {
      scenarios = new Set(argv[i + 1].split(',').map(s => s.trim()).filter(Boolean))
      i++
    } else if (arg === '--help' || arg === '-h') {
      console.log('Usage: npx ts-node scripts/measure-redundant-ai-steps.ts [--json] [--scenarios a,b,c]')
      process.exit(0)
    }
  }
  return { json, scenarios }
}

function main(): void {
  const opts = parseArgs(process.argv)
  const scenarios = listScenarios(opts.scenarios)
  if (scenarios.length === 0) {
    console.error('[measure-redundant-ai-steps] No scenarios matched filter.')
    process.exit(2)
  }
  const report = sweep(scenarios)
  if (opts.json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    printHumanReport(report)
  }
  // Exit code: 0 if all gates safe-to-retire, 1 otherwise (informational)
  const anyOpen = Object.values(report.retirement_gates).some(g => !g.safe_to_retire)
  process.exit(anyOpen ? 1 : 0)
}

// Always run when invoked directly. The script is small enough that the
// CommonJS `require.main === module` guard isn't worth the ESM-compat cost.
// If you need the helpers programmatically, import this file from a TS module.
main()

export { sweep, classifyPrompt, FINGERPRINTS }
export type { MeasurementReport, ScenarioReport, AiProcessingHit, Fingerprint }
