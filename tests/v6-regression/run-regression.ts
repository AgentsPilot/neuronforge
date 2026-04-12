/**
 * V6 Regression Test Suite — Master Runner
 *
 * Orchestrates the V6 Intent Contract -> DSL compilation -> execution pipeline
 * across multiple test scenarios, aggregating results into a structured report.
 *
 * Usage: npx tsx --import ./scripts/env-preload.ts tests/v6-regression/run-regression.ts
 *
 * Exit code: 0 = all pass, 1 = any fail
 */

import { execSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

// ============================================================================
// Types
// ============================================================================

interface ScenarioMeta {
  name: string
  description: string
  plugins: string[]
  expected: {
    min_steps: number
    step_types?: string[]
    phase_a_checks: number
    phase_d_success: boolean
  }
}

interface EPKeyHintsResult {
  valid: boolean
  warnings: string[]
  autoFixedKeys: { original: string; fixed: string }[]
}

interface PhaseCompileResult {
  success: boolean
  steps: number
  duration_ms: number
  error?: string
}

interface PhaseAResult {
  success: boolean
  checks_passed: number
  checks_failed: number
  errors: string[]
}

interface PhaseDResult {
  success: boolean
  steps_completed: number
  steps_failed: number
  duration_ms: number
  error?: string
}

interface ScenarioResult {
  scenario: string
  status: 'PASS' | 'FAIL'
  ep_key_hints: {
    valid: boolean
    warnings: string[]
    auto_fixed_keys: { original: string; fixed: string }[]
  }
  compile: PhaseCompileResult
  phase_a: PhaseAResult
  phase_d: PhaseDResult
  failure_reason?: string
}

// ============================================================================
// RegressionLogger — dual console + file output (SA item 8: proper flush)
// ============================================================================

class RegressionLogger {
  private stream: fs.WriteStream
  private closed = false

  constructor(logPath: string) {
    // Ensure parent directory exists
    const dir = path.dirname(logPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    this.stream = fs.createWriteStream(logPath, { flags: 'w' })
  }

  log(message: string): void {
    const timestamp = new Date().toISOString().slice(11, 19)
    const timestamped = `[${timestamp}] ${message}`
    console.log(message)
    if (!this.closed) {
      this.stream.write(timestamped + '\n')
    }
  }

  /** Write sub-process output only to the log file (too verbose for console) */
  logSubProcess(label: string, output: string): void {
    if (!this.closed) {
      this.stream.write(`--- ${label} stdout ---\n${output}\n--- end ---\n`)
    }
  }

  /**
   * Flush and close the write stream. Returns a promise that resolves
   * when the stream is fully flushed (SA item 8).
   */
  close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.closed) {
        resolve()
        return
      }
      this.closed = true
      this.stream.end(() => {
        resolve()
      })
    })
  }
}

// ============================================================================
// EP Key Hints Validation (Task 8 — static lookup, SA-approved)
// ============================================================================

/**
 * Static lookup table of known plugin parameter names.
 * SA-approved: the regression runner should be self-contained with no Supabase
 * or PluginManager dependencies. Extend this table when adding new plugins
 * or new scenarios that use additional plugin parameters.
 */
const PLUGIN_PARAM_LOOKUP: Record<string, Record<string, string>> = {
  'google-sheets': {
    'spreadsheet_id': 'google_sheets__table_read__spreadsheet_id',
    'sheet_tab_name': 'google_sheets__table_read__sheet_tab_name',
    'header_row': 'google_sheets__table_read__header_row',
    'columns': 'google_sheets__table_create__columns',
    'row_data': 'google_sheets__table_create__row_data',
  },
  'google-mail': {
    'query': 'google_mail__email_search__query',
    'recipients': 'google_mail__email_send__recipients',
    'subject': 'google_mail__email_send__subject',
    'body': 'google_mail__email_send__body',
    'max_results': 'google_mail__email_search__max_results',
  },
}

function validateEPKeyHints(enhancedPrompt: any, plugins: string[]): EPKeyHintsResult {
  const warnings: string[] = []
  const autoFixedKeys: { original: string; fixed: string }[] = []

  const resolvedInputs = enhancedPrompt?.specifics?.resolved_user_inputs
  if (!Array.isArray(resolvedInputs)) {
    return { valid: true, warnings: [], autoFixedKeys: [] }
  }

  // Build a combined lookup for the scenario's plugins
  const relevantParams: Record<string, string> = {}
  for (const plugin of plugins) {
    const params = PLUGIN_PARAM_LOOKUP[plugin]
    if (params) {
      for (const [paramName, hintKey] of Object.entries(params)) {
        // If the same param name exists in multiple plugins, mark as ambiguous
        if (relevantParams[paramName] && relevantParams[paramName] !== hintKey) {
          relevantParams[paramName] = '__AMBIGUOUS__'
        } else {
          relevantParams[paramName] = hintKey
        }
      }
    }
  }

  for (const input of resolvedInputs) {
    const key = input.key as string
    if (!key) continue

    // Check if key already has the EP hint prefix pattern (contains double underscore)
    if (key.includes('__')) {
      continue // Already prefixed — pass silently
    }

    // Check if this key matches a known plugin parameter
    const fixedKey = relevantParams[key]
    if (fixedKey && fixedKey !== '__AMBIGUOUS__') {
      warnings.push(`${key} missing EP hint prefix`)
      autoFixedKeys.push({ original: key, fixed: fixedKey })
    } else if (fixedKey === '__AMBIGUOUS__') {
      warnings.push(`${key} matches multiple plugins — not auto-fixed`)
    }
    // Generic keys (no match) pass silently
  }

  return {
    valid: warnings.length === 0,
    warnings,
    autoFixedKeys,
  }
}

/**
 * Apply EP key hint auto-fixes to the enhanced prompt (in memory only).
 * Returns a new copy with fixed keys — the original is not modified.
 */
function applyEPFixes(enhancedPrompt: any, fixes: { original: string; fixed: string }[]): any {
  if (fixes.length === 0) return enhancedPrompt

  const copy = JSON.parse(JSON.stringify(enhancedPrompt))
  const resolvedInputs = copy?.specifics?.resolved_user_inputs
  if (!Array.isArray(resolvedInputs)) return copy

  for (const input of resolvedInputs) {
    const fix = fixes.find(f => f.original === input.key)
    if (fix) {
      input.key = fix.fixed
    }
  }

  return copy
}

// ============================================================================
// Phase Runners
// ============================================================================

const PROJECT_ROOT = path.resolve(__dirname, '..', '..')

// Use local tsx binary directly instead of `npx tsx` to avoid nested npx spawning.
// On Windows, `execSync('npx tsx ...')` goes through cmd.exe → npx → tsx → Node,
// which can hang or timeout due to pipe buffering and process resolution delays.
const isWindows = process.platform === 'win32'
const TSX_BIN = isWindows
  ? path.join(PROJECT_ROOT, 'node_modules', '.bin', 'tsx.cmd')
  : path.join(PROJECT_ROOT, 'node_modules', '.bin', 'tsx')

// All phase runners use execWithFileRedirect() below instead of execSync with pipe.

/**
 * Run a command via execSync, redirecting output to a temp file to avoid
 * Windows pipe deadlocks. Returns the captured output as a string.
 */
function execWithFileRedirect(cmd: string, timeout: number): { output: string; exitCode: number } {
  const tmpFile = path.join(os.tmpdir(), `regression-${Date.now()}-${Math.random().toString(36).slice(2)}.log`)
  const redirectedCmd = isWindows
    ? `${cmd} > "${tmpFile}" 2>&1`
    : `${cmd} > "${tmpFile}" 2>&1`

  try {
    execSync(redirectedCmd, { cwd: PROJECT_ROOT, timeout, stdio: 'ignore', ...(isWindows ? { shell: 'cmd.exe' } : {}) })
    const output = fs.existsSync(tmpFile) ? fs.readFileSync(tmpFile, 'utf-8') : ''
    try { fs.unlinkSync(tmpFile) } catch { /* ignore cleanup errors */ }
    return { output, exitCode: 0 }
  } catch (err: any) {
    const output = fs.existsSync(tmpFile) ? fs.readFileSync(tmpFile, 'utf-8') : ''
    try { fs.unlinkSync(tmpFile) } catch { /* ignore cleanup errors */ }
    return { output, exitCode: err.status || 1 }
  }
}

function runCompile(
  enhancedPromptPath: string,
  intentContractPath: string,
  scenarioOutputDir: string,
  logger: RegressionLogger
): PhaseCompileResult {
  const start = Date.now()
  const cmd = [
    `"${TSX_BIN}" --import ./scripts/env-preload.ts scripts/test-complete-pipeline-with-vocabulary.ts`,
    `"${enhancedPromptPath}"`,
    `--intent-contract "${intentContractPath}"`,
    `--output-dir "${scenarioOutputDir}"`,
  ].join(' ')

  const { output, exitCode } = execWithFileRedirect(cmd, 120_000)
  logger.logSubProcess(exitCode === 0 ? 'Compile' : 'Compile (FAILED)', output)

  // Check DSL output exists
  const dslPath = path.join(scenarioOutputDir, 'phase4-pilot-dsl-steps.json')
  if (!fs.existsSync(dslPath)) {
    return { success: false, steps: 0, duration_ms: Date.now() - start, error: output.slice(-500) || 'phase4-pilot-dsl-steps.json not found' }
  }

  try {
    const dslSteps = JSON.parse(fs.readFileSync(dslPath, 'utf-8'))
    const stepCount = Array.isArray(dslSteps) ? dslSteps.length : 0
    return { success: true, steps: stepCount, duration_ms: Date.now() - start }
  } catch (err: any) {
    return { success: false, steps: 0, duration_ms: Date.now() - start, error: `Failed to parse DSL: ${err.message}` }
  }
}

function runPhaseA(
  scenarioOutputDir: string,
  logger: RegressionLogger
): PhaseAResult {
  const cmd = `"${TSX_BIN}" scripts/test-dsl-execution-simulator/index.ts --input-dir "${scenarioOutputDir}"`

  const { output, exitCode } = execWithFileRedirect(cmd, 60_000)
  logger.logSubProcess(exitCode === 0 ? 'Phase A' : 'Phase A (non-zero exit)', output)

  return parsePhaseAReport(scenarioOutputDir)
}

function parsePhaseAReport(scenarioOutputDir: string): PhaseAResult {
  const reportPath = path.join(scenarioOutputDir, 'execution-simulation-report.json')
  if (!fs.existsSync(reportPath)) {
    return { success: false, checks_passed: 0, checks_failed: 0, errors: ['Phase A crashed — no report file generated'] }
  }

  try {
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'))
    const checks = report.validation || report.summary?.validation || {}
    const checksPassed = checks.checks_passed ?? checks.passed ?? 0
    const checksFailed = checks.checks_failed ?? checks.failed ?? 0
    const errors: string[] = []

    // Extract error messages from issues/validation
    const issues = report.validation?.issues || report.issues || []
    for (const issue of issues) {
      if (issue.severity === 'error') {
        errors.push(issue.message || issue.description || 'Unknown error')
      }
    }

    return {
      success: checksFailed === 0 && errors.length === 0,
      checks_passed: checksPassed,
      checks_failed: checksFailed,
      errors,
    }
  } catch (err: any) {
    return { success: false, checks_passed: 0, checks_failed: 0, errors: [`Failed to parse Phase A report: ${err.message}`] }
  }
}

function runPhaseD(
  scenarioOutputDir: string,
  logger: RegressionLogger
): PhaseDResult {
  const start = Date.now()
  const cmd = `"${TSX_BIN}" --import ./scripts/env-preload.ts scripts/test-workflowpilot-execution.ts --input-dir "${scenarioOutputDir}"`

  const { output, exitCode } = execWithFileRedirect(cmd, 120_000)
  logger.logSubProcess(exitCode === 0 ? 'Phase D' : 'Phase D (non-zero exit)', output)

  return parsePhaseDReport(scenarioOutputDir, start)
}

function parsePhaseDReport(scenarioOutputDir: string, startTime: number): PhaseDResult {
  const reportPath = path.join(scenarioOutputDir, 'workflowpilot-execution-report.json')
  if (!fs.existsSync(reportPath)) {
    return { success: false, steps_completed: 0, steps_failed: 0, duration_ms: Date.now() - startTime, error: 'Phase D crashed — no report file generated' }
  }

  try {
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'))
    const summary = report.summary || {}

    return {
      success: summary.success === true,
      steps_completed: summary.steps_completed || 0,
      steps_failed: summary.steps_failed || 0,
      duration_ms: summary.execution_time_ms || (Date.now() - startTime),
      error: report.error || undefined,
    }
  } catch (err: any) {
    return { success: false, steps_completed: 0, steps_failed: 0, duration_ms: Date.now() - startTime, error: `Failed to parse Phase D report: ${err.message}` }
  }
}

// ============================================================================
// Console Output Formatting
// ============================================================================

function printHeader(scenarios: string[]): void {
  console.log('')
  console.log('\u2554' + '\u2550'.repeat(66) + '\u2557')
  console.log('\u2551' + '                V6 REGRESSION TEST SUITE                        ' + '\u2551')
  console.log('\u255A' + '\u2550'.repeat(66) + '\u255D')
  console.log('')
  console.log(`Found ${scenarios.length} scenarios in tests/v6-regression/scenarios/`)
  for (let i = 0; i < scenarios.length; i++) {
    console.log(`   ${i + 1}. ${scenarios[i]}`)
  }
  console.log('')
  console.log('\u2550'.repeat(66))
}

function printScenarioProgress(index: number, total: number, name: string): void {
  console.log(`\n[${index + 1}/${total}] ${name}`)
}

function printEPResult(epResult: EPKeyHintsResult): void {
  if (epResult.valid) {
    console.log('   EP Key Hints: All keys have prefix')
  } else {
    console.log(`   EP Key Hints: ${epResult.autoFixedKeys.length} keys missing prefix (auto-fixed in memory):`)
    for (const fix of epResult.autoFixedKeys) {
      console.log(`      ${fix.original} -> ${fix.fixed}`)
    }
  }
}

function printCompileResult(result: PhaseCompileResult): void {
  if (result.success) {
    console.log(`   Compile .............. PASS (${result.steps} steps, ${(result.duration_ms / 1000).toFixed(1)}s)`)
  } else {
    console.log(`   Compile .............. FAILED`)
    if (result.error) {
      console.log(`      - ${result.error.slice(0, 200)}`)
    }
  }
}

function printPhaseAResult(result: PhaseAResult): void {
  if (result.success) {
    console.log(`   Phase A .............. PASS (${result.checks_passed}/${result.checks_passed + result.checks_failed} checks)`)
  } else {
    console.log(`   Phase A .............. FAILED (${result.checks_passed}/${result.checks_passed + result.checks_failed} checks, ${result.checks_failed} errors)`)
    for (const err of result.errors.slice(0, 5)) {
      console.log(`      - ${err}`)
    }
  }
}

function printPhaseDResult(result: PhaseDResult): void {
  if (result.success) {
    console.log(`   Phase D .............. PASS (${result.steps_completed}/${result.steps_completed + result.steps_failed} steps, ${(result.duration_ms / 1000).toFixed(1)}s)`)
  } else {
    console.log(`   Phase D .............. FAILED`)
    if (result.error) {
      console.log(`      - ${result.error.slice(0, 200)}`)
    }
  }
}

function printPhaseDSkipped(reason: string): void {
  console.log(`   Phase D .............. SKIPPED (${reason})`)
}

function printScenarioVerdict(status: 'PASS' | 'FAIL', failReason?: string): void {
  if (status === 'PASS') {
    console.log('   PASS')
  } else {
    console.log(`   FAIL -- ${failReason || 'unknown reason'}`)
  }
}

function printSummary(results: ScenarioResult[], reportPath: string): void {
  console.log('')
  console.log('\u2550'.repeat(66))
  console.log('                    REGRESSION SUMMARY')
  console.log('\u2550'.repeat(66))
  console.log('')

  // Header row
  const nameWidth = 35
  console.log(`  ${'Scenario'.padEnd(nameWidth)}Compile   Phase A   Phase D   Result`)
  console.log('  ' + '\u2500'.repeat(63))

  for (const r of results) {
    const compileStatus = r.compile.success ? 'PASS' : 'FAIL'
    const phaseAStatus = r.phase_a.success ? 'PASS' : (r.phase_a.checks_passed === 0 && r.phase_a.checks_failed === 0 ? 'SKIP' : 'FAIL')
    const phaseDStatus = r.phase_d.success ? 'PASS' : (r.phase_d.steps_completed === 0 && r.phase_d.steps_failed === 0 && !r.phase_d.error ? 'SKIP' : 'FAIL')

    console.log(`  ${r.scenario.padEnd(nameWidth)}${compileStatus.padEnd(10)}${phaseAStatus.padEnd(10)}${phaseDStatus.padEnd(10)}${r.status}`)
  }

  const passed = results.filter(r => r.status === 'PASS').length
  const failed = results.filter(r => r.status === 'FAIL').length

  console.log('')
  console.log('\u2500'.repeat(66))
  console.log(`  Total: ${results.length} scenarios | Passed: ${passed} | Failed: ${failed}`)
  console.log('\u2500'.repeat(66))
  console.log('')

  if (failed === 0) {
    console.log(`REGRESSION PASSED -- ${passed}/${results.length} scenarios passed`)
  } else {
    console.log(`REGRESSION FAILED -- ${passed}/${results.length} scenarios passed`)
    console.log('')
    console.log('  Failed scenarios:')
    for (const r of results.filter(r => r.status === 'FAIL')) {
      console.log(`    - ${r.scenario}: ${r.failure_reason || 'unknown'}`)
    }
  }

  console.log('')
  console.log(`Report saved: ${reportPath}`)
  console.log('\u2550'.repeat(66))
}

// ============================================================================
// Main Orchestration
// ============================================================================

async function main() {
  const scenariosDir = path.resolve(PROJECT_ROOT, 'tests', 'v6-regression', 'scenarios')
  const now = new Date()
  const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const outputBaseDir = path.resolve(PROJECT_ROOT, 'tests', 'v6-regression', 'output')
  const runOutputDir = path.join(outputBaseDir, timestamp)
  fs.mkdirSync(runOutputDir, { recursive: true })

  const logPath = path.join(runOutputDir, 'regression-log.txt')
  const logger = new RegressionLogger(logPath)

  // 1. Discover scenarios — sort alphabetically for deterministic ordering (SA item 4)
  const scenarios = fs.readdirSync(scenariosDir)
    .filter(d => {
      try {
        return fs.statSync(path.join(scenariosDir, d)).isDirectory()
          && fs.existsSync(path.join(scenariosDir, d, 'scenario.json'))
      } catch {
        return false
      }
    })
    .sort()

  if (scenarios.length === 0) {
    logger.log('No scenarios found. Exiting.')
    await logger.close()
    process.exit(0)
  }

  // 2. Print header
  printHeader(scenarios)
  logger.log(`V6 Regression Test Suite — ${scenarios.length} scenarios`)

  // 2.5. Plugin smoke test gate — abort if plugin executors have failing smoke tests (P4-T9)
  {
    console.log('Running plugin smoke tests as prerequisite...')
    logger.log('Running plugin smoke tests (60s timeout)...')

    const jestBin = isWindows
      ? path.join(PROJECT_ROOT, 'node_modules', '.bin', 'jest.cmd')
      : path.join(PROJECT_ROOT, 'node_modules', '.bin', 'jest')
    const smokeCmd = `"${jestBin}" --config jest.config.js tests/plugins/ --testNamePattern="\\[smoke\\]" --verbose --forceExit`

    const { output: smokeOutput, exitCode: smokeExit } = execWithFileRedirect(smokeCmd, 60_000)
    logger.logSubProcess('Plugin Smoke Tests', smokeOutput)

    if (smokeExit !== 0) {
      const failMsg = 'REGRESSION ABORTED -- Plugin smoke tests failed.\nFix plugin executor issues before running V6 regression.'
      console.log('')
      console.log('\u2550'.repeat(66))
      console.log(failMsg)
      console.log('\u2550'.repeat(66))
      // Extract failing test names from output for diagnostic context
      const failLines = smokeOutput
        .split('\n')
        .filter((line: string) => line.includes('FAIL') || line.includes('\u2717') || line.includes('failed'))
        .slice(0, 10)
      if (failLines.length > 0) {
        console.log('\nFailing tests:')
        for (const line of failLines) {
          console.log(`  ${line.trim()}`)
        }
      }
      console.log('')
      logger.log(failMsg)
      await logger.close()
      process.exit(1)
    }

    console.log('Plugin smoke tests passed.\n')
    logger.log('Plugin smoke tests passed.')
  }

  const results: ScenarioResult[] = []
  const suiteStartTime = Date.now()

  // 3. Run each scenario sequentially
  for (let i = 0; i < scenarios.length; i++) {
    const scenarioName = scenarios[i]
    const scenarioDir = path.join(scenariosDir, scenarioName)
    const scenarioOutputDir = path.join(runOutputDir, scenarioName)
    fs.mkdirSync(scenarioOutputDir, { recursive: true })

    printScenarioProgress(i, scenarios.length, scenarioName)
    logger.log(`[${i + 1}/${scenarios.length}] Starting scenario: ${scenarioName}`)

    console.log('   Loading scenario...')

    // SA item 7: wrap per-scenario file loading in try-catch
    let meta: ScenarioMeta
    let enhancedPrompt: any
    try {
      meta = JSON.parse(fs.readFileSync(path.join(scenarioDir, 'scenario.json'), 'utf-8'))
      enhancedPrompt = JSON.parse(fs.readFileSync(path.join(scenarioDir, 'enhanced-prompt.json'), 'utf-8'))
    } catch (err: any) {
      const errorMsg = `Failed to load scenario files: ${err.message}`
      logger.log(`   FAIL — ${errorMsg}`)
      console.log(`   FAIL -- ${errorMsg}`)
      results.push({
        scenario: scenarioName,
        status: 'FAIL',
        failure_reason: errorMsg,
        ep_key_hints: { valid: false, warnings: [], auto_fixed_keys: [] },
        compile: { success: false, steps: 0, duration_ms: 0, error: errorMsg },
        phase_a: { success: false, checks_passed: 0, checks_failed: 0, errors: [errorMsg] },
        phase_d: { success: false, steps_completed: 0, steps_failed: 0, duration_ms: 0, error: errorMsg },
      })
      continue
    }

    // Check for placeholder intent contract
    const intentContractPath = path.join(scenarioDir, 'intent-contract.json')
    if (!fs.existsSync(intentContractPath)) {
      const errorMsg = 'intent-contract.json not found'
      logger.log(`   FAIL — ${errorMsg}`)
      console.log(`   FAIL -- ${errorMsg}`)
      results.push({
        scenario: scenarioName,
        status: 'FAIL',
        failure_reason: errorMsg,
        ep_key_hints: { valid: false, warnings: [], auto_fixed_keys: [] },
        compile: { success: false, steps: 0, duration_ms: 0, error: errorMsg },
        phase_a: { success: false, checks_passed: 0, checks_failed: 0, errors: [errorMsg] },
        phase_d: { success: false, steps_completed: 0, steps_failed: 0, duration_ms: 0, error: errorMsg },
      })
      continue
    }

    // Check if intent contract is a placeholder
    try {
      const intentContractContent = JSON.parse(fs.readFileSync(intentContractPath, 'utf-8'))
      if (intentContractContent._placeholder) {
        const errorMsg = 'intent-contract.json is a placeholder — needs LLM generation'
        logger.log(`   FAIL — ${errorMsg}`)
        console.log(`   FAIL -- ${errorMsg}`)
        results.push({
          scenario: scenarioName,
          status: 'FAIL',
          failure_reason: errorMsg,
          ep_key_hints: { valid: false, warnings: [], auto_fixed_keys: [] },
          compile: { success: false, steps: 0, duration_ms: 0, error: errorMsg },
          phase_a: { success: false, checks_passed: 0, checks_failed: 0, errors: [errorMsg] },
          phase_d: { success: false, steps_completed: 0, steps_failed: 0, duration_ms: 0, error: errorMsg },
        })
        continue
      }
    } catch {
      // If we can't parse the intent contract, the compile phase will catch it
    }

    // EP Key Hints validation
    const epResult = validateEPKeyHints(enhancedPrompt, meta.plugins)
    printEPResult(epResult)
    logger.log(`   EP validation: ${epResult.valid ? 'valid' : `${epResult.warnings.length} warnings`}`)

    // If auto-fixes were applied, write fixed enhanced prompt for pipeline to read
    let enhancedPromptPathForPipeline = path.join(scenarioDir, 'enhanced-prompt.json')
    if (epResult.autoFixedKeys.length > 0) {
      const fixedPrompt = applyEPFixes(enhancedPrompt, epResult.autoFixedKeys)
      const fixedPath = path.join(scenarioOutputDir, 'enhanced-prompt-fixed.json')
      fs.writeFileSync(fixedPath, JSON.stringify(fixedPrompt, null, 2))
      enhancedPromptPathForPipeline = fixedPath
    }

    // --- Compile Phase ---
    const compileResult = runCompile(
      enhancedPromptPathForPipeline,
      intentContractPath,
      scenarioOutputDir,
      logger
    )
    printCompileResult(compileResult)
    logger.log(`   Compile: ${compileResult.success ? 'PASS' : 'FAIL'} (${compileResult.steps} steps, ${compileResult.duration_ms}ms)`)

    if (!compileResult.success) {
      printPhaseDSkipped('Compile failed')
      printScenarioVerdict('FAIL', `Compile failed: ${compileResult.error}`)
      results.push({
        scenario: scenarioName,
        status: 'FAIL',
        failure_reason: `Compile failed: ${compileResult.error}`,
        ep_key_hints: { valid: epResult.valid, warnings: epResult.warnings, auto_fixed_keys: epResult.autoFixedKeys },
        compile: compileResult,
        phase_a: { success: false, checks_passed: 0, checks_failed: 0, errors: ['Skipped — compile failed'] },
        phase_d: { success: false, steps_completed: 0, steps_failed: 0, duration_ms: 0, error: 'Skipped — compile failed' },
      })
      continue
    }

    // Validate step count against expected minimum
    if (compileResult.steps < meta.expected.min_steps) {
      logger.log(`   WARNING: compiled ${compileResult.steps} steps, expected >= ${meta.expected.min_steps}`)
    }

    // --- Phase A ---
    const phaseAResult = runPhaseA(scenarioOutputDir, logger)
    printPhaseAResult(phaseAResult)
    logger.log(`   Phase A: ${phaseAResult.success ? 'PASS' : 'FAIL'} (${phaseAResult.checks_passed}/${phaseAResult.checks_passed + phaseAResult.checks_failed} checks)`)

    // --- Phase D (skip if Phase A failed) ---
    let phaseDResult: PhaseDResult
    if (!phaseAResult.success) {
      printPhaseDSkipped('Phase A failed')
      phaseDResult = { success: false, steps_completed: 0, steps_failed: 0, duration_ms: 0, error: 'Skipped — Phase A failed' }
    } else {
      phaseDResult = runPhaseD(scenarioOutputDir, logger)
      printPhaseDResult(phaseDResult)
      logger.log(`   Phase D: ${phaseDResult.success ? 'PASS' : 'FAIL'} (${phaseDResult.steps_completed} steps, ${phaseDResult.duration_ms}ms)`)
    }

    // --- Determine scenario verdict ---
    const scenarioStatus: 'PASS' | 'FAIL' = compileResult.success && phaseAResult.success && phaseDResult.success ? 'PASS' : 'FAIL'
    let failureReason: string | undefined
    if (!compileResult.success) {
      failureReason = `Compile failed: ${compileResult.error}`
    } else if (!phaseAResult.success) {
      failureReason = `Phase A had ${phaseAResult.checks_failed} errors`
    } else if (!phaseDResult.success) {
      failureReason = `Phase D failed: ${phaseDResult.error || 'execution failure'}`
    }

    printScenarioVerdict(scenarioStatus, failureReason)

    results.push({
      scenario: scenarioName,
      status: scenarioStatus,
      failure_reason: failureReason,
      ep_key_hints: { valid: epResult.valid, warnings: epResult.warnings, auto_fixed_keys: epResult.autoFixedKeys },
      compile: compileResult,
      phase_a: phaseAResult,
      phase_d: phaseDResult,
    })
  }

  // 4. Write regression report JSON
  const reportPath = path.join(runOutputDir, 'regression-report.json')
  const suiteDuration = Date.now() - suiteStartTime
  const passed = results.filter(r => r.status === 'PASS').length
  const failed = results.filter(r => r.status === 'FAIL').length

  const report = {
    timestamp: now.toISOString(),
    duration_ms: suiteDuration,
    scenarios: {
      total: results.length,
      passed,
      failed,
    },
    overall_result: failed === 0 ? 'PASS' : 'FAIL',
    results: results.map(r => ({
      scenario: r.scenario,
      status: r.status,
      ep_key_hints: r.ep_key_hints,
      compile: { success: r.compile.success, steps: r.compile.steps, duration_ms: r.compile.duration_ms },
      phase_a: { success: r.phase_a.success, checks_passed: r.phase_a.checks_passed, checks_failed: r.phase_a.checks_failed, errors: r.phase_a.errors },
      phase_d: { success: r.phase_d.success, steps_completed: r.phase_d.steps_completed, steps_failed: r.phase_d.steps_failed, duration_ms: r.phase_d.duration_ms },
    })),
  }

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))

  // 5. Print summary
  printSummary(results, reportPath)
  logger.log(`Suite finished in ${suiteDuration}ms — ${passed} passed, ${failed} failed`)

  // 6. Update `latest` pointer — copy (not symlink) for Windows compatibility
  const latestDir = path.join(outputBaseDir, 'latest')
  try {
    if (fs.existsSync(latestDir)) {
      fs.rmSync(latestDir, { recursive: true, force: true })
    }
    fs.cpSync(runOutputDir, latestDir, { recursive: true })
  } catch (err: any) {
    logger.log(`WARNING: Failed to update latest pointer: ${err.message}`)
  }

  // 7. Flush logger before exiting (SA item 8)
  await logger.close()

  // 8. Exit with appropriate code
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(async (err) => {
  console.error('Fatal error in regression runner:', err)
  process.exit(1)
})
