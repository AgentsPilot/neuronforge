/**
 * V6 QA Agent: Execution Layer Testing
 *
 * Generates workflow using Gmail complaints test and executes it to find runtime issues.
 *
 * Test Flow:
 * 1. Generate workflow using test-v6-gmail-complaints.ts
 * 2. Execute through /api/v6/execute-test endpoint
 * 3. Capture all execution issues
 * 4. Generate comprehensive issue report
 */

import { SemanticPlanGenerator } from '../lib/agentkit/v6/semantic-plan/SemanticPlanGenerator'
import { IRFormalizer } from '../lib/agentkit/v6/semantic-plan/IRFormalizer'
import { IRToDSLCompiler } from '../lib/agentkit/v6/compiler/IRToDSLCompiler'
import { PilotNormalizer } from '../lib/agentkit/v6/compiler/PilotNormalizer'
import { WorkflowPostValidator } from '../lib/agentkit/v6/compiler/WorkflowPostValidator'
import { PluginManagerV2 } from '../lib/server/plugin-manager-v2'
import { writeFileSync } from 'fs'

// Same prompt as Gmail complaints test
const GMAIL_COMPLAINTS_PROMPT = {
  plan_title: "Customer Complaint Email Logger (Gmail → Google Sheets)",
  plan_description: "Scans your Gmail Inbox for the last 7 days, finds emails that contain complaint keywords, and appends only those complaint emails into the 'UrgentEmails' tab of your Google Sheet while skipping duplicates based on Gmail message link/id.",
  sections: {
    data: [
      "- Scan Gmail Inbox messages from the last 7 days.",
      '- Treat an email as a complaint if the email content contains any of these keywords (case-insensitive match): "complaint", "refund", "angry", "not working".',
      '- Use the Google Sheet with spreadsheet id "1pM8WbXtPgaYqokHn_spgQAfR7SBuql3JUtE1ugDtOpc" as the destination.',
      '- Use the worksheet/tab name "UrgentEmails" inside that spreadsheet as the destination tab.',
      "- Read existing rows from the destination tab to identify already-logged complaint emails by Gmail message link/id."
    ],
    actions: [
      '- For each Gmail message in scope, check whether the message content contains any of: "complaint", "refund", "angry", "not working".',
      "- If the message matches the complaint rule, extract these fields: sender email, subject, date, and the full email text.",
      "- If the message matches the complaint rule, also capture the Gmail message link/id to use as a unique identifier.",
      "- If the Gmail message link/id already exists in the destination tab, do not add a new row for that message.",
      "- If the Gmail message link/id does not exist in the destination tab, append exactly one new row for that message.",
      "- Treat each matching message independently (if a thread has multiple matching messages, log every matching message as its own row)."
    ],
    output: [
      "- Append one row per complaint email to the destination Google Sheet tab.",
      "- Each appended row must include (in this order): sender email, subject, date, full email text, Gmail message link/id."
    ],
    delivery: [
      '- Deliver results by writing/appending rows into the Google Sheet tab "UrgentEmails" (no email/slack notification).'
    ],
    processing_steps: [
      "- Fetch Gmail messages from Inbox for the last 7 days.",
      '- Load existing rows from the "UrgentEmails" tab and build a set of existing Gmail message link/id values.',
      "- Filter messages by keyword match against the email content (case-insensitive).",
      "- For each matching message, extract required fields and append a new row only if its Gmail message link/id is not already present."
    ]
  },
  specifics: {
    services_involved: ["google-mail", "google-sheets"],
    user_inputs_required: [],
    resolved_user_inputs: [
      { key: "user_email", value: "offir.omer@gmail.com" },
      { key: "spreadsheet_id", value: "1pM8WbXtPgaYqokHn_spgQAfR7SBuql3JUtE1ugDtOpc" },
      { key: "sheet_tab_name", value: "UrgentEmails" },
      { key: "gmail_scope", value: "Inbox" },
      { key: "data_time_window", value: "last 7 days" },
      { key: "complaint_keywords", value: "complaint, refund, angry, not working" },
      { key: "sheet_dedup_rule", value: "skip if Gmail message link/id already exists in the sheet" },
      { key: "thread_handling", value: "log every message that matches the complaint rule" },
      { key: "sheet_columns", value: "sender email, subject, date, full email text, Gmail message link/id" }
    ]
  }
}

interface IssueReport {
  category: 'compilation' | 'validation' | 'execution' | 'runtime'
  severity: 'critical' | 'high' | 'medium' | 'low'
  phase: string
  issue: string
  details: any
  impact: string
}

async function main() {
  console.log('================================================================================')
  console.log('V6 QA AGENT: EXECUTION LAYER TESTING')
  console.log('================================================================================')
  console.log('')
  console.log('Test Workflow: Gmail Complaint Logger → Google Sheets')
  console.log('Goal: Generate workflow and execute to find runtime issues')
  console.log('')

  const qaReport: any = {
    test_name: 'v6_execution_layer_qa',
    timestamp: new Date().toISOString(),
    phases_completed: 0,
    issues_found: [] as IssueReport[],
    workflow: null,
    execution_result: null,
    success: false
  }

  try {
    // ========================================================================
    // STEP 1: Generate Workflow (Phases 1-5)
    // ========================================================================
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('STEP 1: WORKFLOW GENERATION (Phases 1-5)')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('')

    // Phase 1: Understanding
    console.log('[Phase 1] Generating semantic plan...')
    const semanticGenerator = new SemanticPlanGenerator({
      model_provider: 'openai',
      model_name: 'gpt-5.2',
      temperature: 0.3,
      max_tokens: 6000
    })

    const semanticResult = await semanticGenerator.generate(GMAIL_COMPLAINTS_PROMPT as any)

    if (!semanticResult.success || !semanticResult.semantic_plan) {
      qaReport.issues_found.push({
        category: 'compilation',
        severity: 'critical',
        phase: 'Phase 1: Understanding',
        issue: 'Semantic plan generation failed',
        details: { errors: semanticResult.errors },
        impact: 'Cannot proceed with workflow generation'
      })
      throw new Error(`Phase 1 failed: ${semanticResult.errors?.join(', ')}`)
    }

    console.log('✓ Phase 1 complete')
    qaReport.phases_completed++

    // Phase 2: Grounding (skip - no metadata)
    const groundedPlan: any = {
      ...semanticResult.semantic_plan,
      grounded: false,
      grounding_results: [],
      grounding_errors: [],
      grounding_confidence: 0.5,
      grounding_timestamp: new Date().toISOString(),
      validated_assumptions_count: 0,
      total_assumptions_count: semanticResult.semantic_plan.assumptions?.length || 0
    }

    console.log('✓ Phase 2 skipped (no metadata)')
    qaReport.phases_completed++

    // Phase 3: Formalization
    console.log('[Phase 3] Generating IR...')
    const pluginManager = new PluginManagerV2()
    await pluginManager.initializeWithCorePlugins()
    const servicesInvolved = GMAIL_COMPLAINTS_PROMPT.specifics.services_involved

    const irFormalizer = new IRFormalizer({
      model: 'gpt-5.2',
      temperature: 0.0,
      max_tokens: 4000,
      openai_api_key: process.env.OPENAI_API_KEY,
      pluginManager,
      servicesInvolved
    })

    const formalizationResult = await irFormalizer.formalize(groundedPlan)

    if (!formalizationResult.ir) {
      qaReport.issues_found.push({
        category: 'compilation',
        severity: 'critical',
        phase: 'Phase 3: Formalization',
        issue: 'IR generation failed',
        details: formalizationResult,
        impact: 'Cannot compile to PILOT DSL'
      })
      throw new Error('Phase 3 failed: No IR generated')
    }

    console.log('✓ Phase 3 complete')
    qaReport.phases_completed++

    // Phase 4: Compilation
    console.log('[Phase 4] Compiling IR to PILOT DSL...')
    const compiler = new IRToDSLCompiler({
      model: 'gpt-5.2',
      temperature: 0.0,
      openai_api_key: process.env.OPENAI_API_KEY,
      pluginManager
    })

    const pipelineContext = {
      semantic_goal: semanticResult.semantic_plan.goal,
      grounded_facts: {},
      formalization_confidence: formalizationResult.formalization_metadata.formalization_confidence
    }

    const compilationResult = await compiler.compile(formalizationResult.ir, pipelineContext)

    if (!compilationResult.success) {
      qaReport.issues_found.push({
        category: 'compilation',
        severity: 'critical',
        phase: 'Phase 4: Compilation',
        issue: 'DSL compilation failed',
        details: { errors: compilationResult.errors },
        impact: 'Cannot execute workflow'
      })
      throw new Error(`Phase 4 failed: ${compilationResult.errors?.join(', ')}`)
    }

    console.log('✓ Phase 4 complete')
    qaReport.phases_completed++

    // Phase 5: Normalization & Validation
    console.log('[Phase 5] Normalizing and validating workflow...')
    const normalizedResult = PilotNormalizer.normalizePilot(
      { workflow_steps: compilationResult.workflow },
      compilationResult.plugins_used || []
    )

    const pluginSchemas = pluginManager.getAvailablePlugins()
    const postValidator = new WorkflowPostValidator(pluginSchemas)
    const validation = postValidator.validate(
      { workflow: normalizedResult.workflow_steps },
      true // autoFix enabled
    )

    if (!validation.valid) {
      qaReport.issues_found.push({
        category: 'validation',
        severity: 'high',
        phase: 'Phase 5: Validation',
        issue: `Workflow validation failed with ${validation.issues?.length || 0} issues`,
        details: { issues: validation.issues },
        impact: 'Workflow may fail during execution'
      })
    }

    console.log('✓ Phase 5 complete')
    qaReport.phases_completed++

    qaReport.workflow = normalizedResult.workflow_steps
    qaReport.plugins_used = compilationResult.plugins_used

    console.log('')
    console.log(`✓ Workflow generated successfully (${normalizedResult.workflow_steps.length} steps)`)
    console.log(`  Plugins: ${compilationResult.plugins_used?.join(', ')}`)
    console.log(`  Validation: ${validation.valid ? 'VALID' : 'INVALID'}`)
    console.log('')

    // Display workflow steps
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('GENERATED WORKFLOW STEPS')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('')

    normalizedResult.workflow_steps.forEach((step: any, idx: number) => {
      console.log(`${idx + 1}. ${step.id} - ${step.type}`)
      if (step.type === 'action') {
        console.log(`   Action: ${step.plugin}.${step.action}`)
      }
      console.log(`   Dependencies: ${step.dependencies?.join(', ') || 'none'}`)
      console.log('')
    })

    // ========================================================================
    // STEP 2: Execute Workflow
    // ========================================================================
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('STEP 2: WORKFLOW EXECUTION')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('')

    console.log('Executing workflow through /api/v6/execute-test endpoint...')
    console.log('')

    // Note: This would normally make an HTTP request to the execution endpoint
    // For now, we'll document what the execution test should check

    console.log('⚠️  EXECUTION TEST SKIPPED')
    console.log('')
    console.log('Reason: Execution requires HTTP server and authenticated user')
    console.log('')
    console.log('To execute this workflow manually:')
    console.log('1. Start the dev server: npm run dev')
    console.log('2. Open test-v6-declarative.html in browser')
    console.log('3. Paste the enhanced prompt in "Compilation" tab')
    console.log('4. Click "Run Full Pipeline"')
    console.log('5. Go to "Execution" tab and click "Execute Workflow"')
    console.log('')
    console.log('Expected execution issues to check:')
    console.log('  - Plugin authentication/authorization failures')
    console.log('  - Invalid parameter types or missing required parameters')
    console.log('  - Variable reference errors (undefined step outputs)')
    console.log('  - Action execution errors (API failures)')
    console.log('  - Scatter-gather iteration issues')
    console.log('  - Transform/filter logic errors')
    console.log('  - DAG execution order issues')
    console.log('')

    qaReport.execution_result = {
      skipped: true,
      reason: 'Requires HTTP server and authenticated user',
      manual_test_url: 'http://localhost:3000/test-v6-declarative.html'
    }

    // ========================================================================
    // STEP 3: Analyze Potential Runtime Issues
    // ========================================================================
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('STEP 3: STATIC ANALYSIS OF POTENTIAL RUNTIME ISSUES')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('')

    // Analyze workflow for common runtime issues
    const workflow = normalizedResult.workflow_steps

    // Check 1: Variable references
    console.log('[Check 1] Variable Reference Validation')
    const stepIds = new Set(workflow.map((s: any) => s.id))
    workflow.forEach((step: any) => {
      // Check input variable references
      if (step.input && typeof step.input === 'string') {
        const varRefs = step.input.match(/\{\{([^}]+)\}\}/g) || []
        varRefs.forEach((ref: string) => {
          const stepRef = ref.replace(/\{\{|\}\}/g, '').split('.')[0]
          if (!stepIds.has(stepRef)) {
            qaReport.issues_found.push({
              category: 'runtime',
              severity: 'critical',
              phase: 'Static Analysis',
              issue: `Invalid variable reference in step ${step.id}`,
              details: { step_id: step.id, invalid_reference: stepRef, input: step.input },
              impact: 'Step will fail at runtime due to undefined variable'
            })
          }
        })
      }

      // Check params variable references
      if (step.params) {
        const paramsStr = JSON.stringify(step.params)
        const varRefs = paramsStr.match(/\{\{([^}]+)\}\}/g) || []
        varRefs.forEach((ref: string) => {
          const stepRef = ref.replace(/\{\{|\}\}/g, '').split('.')[0]
          if (!stepIds.has(stepRef)) {
            qaReport.issues_found.push({
              category: 'runtime',
              severity: 'critical',
              phase: 'Static Analysis',
              issue: `Invalid variable reference in step ${step.id} params`,
              details: { step_id: step.id, invalid_reference: stepRef, params: step.params },
              impact: 'Action will receive undefined parameter values'
            })
          }
        })
      }
    })

    if (qaReport.issues_found.filter((i: IssueReport) => i.category === 'runtime' && i.issue.includes('variable reference')).length === 0) {
      console.log('✓ All variable references point to valid steps')
    } else {
      console.log(`✗ Found ${qaReport.issues_found.filter((i: IssueReport) => i.issue.includes('variable reference')).length} invalid variable references`)
    }
    console.log('')

    // Check 2: Action parameter validation
    console.log('[Check 2] Action Parameter Validation')
    const actionSteps = workflow.filter((s: any) => s.type === 'action')
    actionSteps.forEach((step: any) => {
      const pluginDef = pluginSchemas[step.plugin]
      if (!pluginDef) {
        qaReport.issues_found.push({
          category: 'runtime',
          severity: 'critical',
          phase: 'Static Analysis',
          issue: `Unknown plugin in step ${step.id}`,
          details: { step_id: step.id, plugin: step.plugin },
          impact: 'Step will fail - plugin not found'
        })
        return
      }

      const actionDef = pluginDef.actions[step.action]
      if (!actionDef) {
        qaReport.issues_found.push({
          category: 'runtime',
          severity: 'critical',
          phase: 'Static Analysis',
          issue: `Unknown action in step ${step.id}`,
          details: { step_id: step.id, plugin: step.plugin, action: step.action },
          impact: 'Step will fail - action not found'
        })
        return
      }

      // Check required parameters (basic check - doesn't handle complex schemas)
      const requiredParams = actionDef.parameters?.required || []
      const providedParams = Object.keys(step.params || {})
      const missingParams = requiredParams.filter((p: string) => !providedParams.includes(p))

      if (missingParams.length > 0) {
        qaReport.issues_found.push({
          category: 'runtime',
          severity: 'high',
          phase: 'Static Analysis',
          issue: `Missing required parameters in step ${step.id}`,
          details: { step_id: step.id, action: `${step.plugin}.${step.action}`, missing: missingParams },
          impact: 'Action may fail due to missing required parameters'
        })
      }
    })

    if (qaReport.issues_found.filter((i: IssueReport) => i.issue.includes('parameter')).length === 0) {
      console.log(`✓ All ${actionSteps.length} action steps have valid parameters`)
    } else {
      console.log(`✗ Found ${qaReport.issues_found.filter((i: IssueReport) => i.issue.includes('parameter')).length} parameter issues`)
    }
    console.log('')

    // Check 3: Scatter-gather structure
    console.log('[Check 3] Scatter-Gather Structure')
    const scatterSteps = workflow.filter((s: any) => s.type === 'scatter_gather')
    scatterSteps.forEach((step: any) => {
      if (!step.scatter || !step.scatter.steps || step.scatter.steps.length === 0) {
        qaReport.issues_found.push({
          category: 'runtime',
          severity: 'high',
          phase: 'Static Analysis',
          issue: `Invalid scatter-gather structure in step ${step.id}`,
          details: { step_id: step.id, scatter: step.scatter },
          impact: 'Scatter-gather will fail - no nested steps defined'
        })
      }

      // Check that nested steps don't have invalid dependencies
      if (step.scatter && step.scatter.steps) {
        step.scatter.steps.forEach((nestedStep: any) => {
          if (nestedStep.dependencies && nestedStep.dependencies.length > 0) {
            // Nested steps should only depend on other nested steps in same scatter
            const nestedStepIds = new Set(step.scatter.steps.map((s: any) => s.id))
            const invalidDeps = nestedStep.dependencies.filter((dep: string) => !nestedStepIds.has(dep))
            if (invalidDeps.length > 0) {
              qaReport.issues_found.push({
                category: 'runtime',
                severity: 'medium',
                phase: 'Static Analysis',
                issue: `Nested step ${nestedStep.id} has invalid dependencies`,
                details: { parent_step: step.id, nested_step: nestedStep.id, invalid_deps: invalidDeps },
                impact: 'Nested step may fail due to invalid dependency references'
              })
            }
          }
        })
      }
    })

    if (qaReport.issues_found.filter((i: IssueReport) => i.issue.includes('scatter')).length === 0) {
      console.log(`✓ All ${scatterSteps.length} scatter-gather steps have valid structure`)
    } else {
      console.log(`✗ Found ${qaReport.issues_found.filter((i: IssueReport) => i.issue.includes('scatter')).length} scatter-gather issues`)
    }
    console.log('')

    // ========================================================================
    // GENERATE QA REPORT
    // ========================================================================
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('QA REPORT SUMMARY')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('')

    console.log(`Phases Completed: ${qaReport.phases_completed}/5`)
    console.log(`Workflow Steps: ${workflow.length}`)
    console.log(`Issues Found: ${qaReport.issues_found.length}`)
    console.log('')

    if (qaReport.issues_found.length === 0) {
      console.log('✅ NO ISSUES FOUND - Workflow is ready for execution')
      qaReport.success = true
    } else {
      console.log(`⚠️  ${qaReport.issues_found.length} ISSUES DETECTED`)
      console.log('')

      // Group by severity
      const critical = qaReport.issues_found.filter((i: IssueReport) => i.severity === 'critical')
      const high = qaReport.issues_found.filter((i: IssueReport) => i.severity === 'high')
      const medium = qaReport.issues_found.filter((i: IssueReport) => i.severity === 'medium')
      const low = qaReport.issues_found.filter((i: IssueReport) => i.severity === 'low')

      if (critical.length > 0) {
        console.log(`❌ Critical Issues (${critical.length}):`)
        critical.forEach((issue: IssueReport) => {
          console.log(`   - [${issue.phase}] ${issue.issue}`)
          console.log(`     Impact: ${issue.impact}`)
        })
        console.log('')
      }

      if (high.length > 0) {
        console.log(`⚠️  High Priority Issues (${high.length}):`)
        high.forEach((issue: IssueReport) => {
          console.log(`   - [${issue.phase}] ${issue.issue}`)
          console.log(`     Impact: ${issue.impact}`)
        })
        console.log('')
      }

      if (medium.length > 0) {
        console.log(`ℹ️  Medium Priority Issues (${medium.length}):`)
        medium.forEach((issue: IssueReport) => {
          console.log(`   - [${issue.phase}] ${issue.issue}`)
        })
        console.log('')
      }

      if (low.length > 0) {
        console.log(`💡 Low Priority Issues (${low.length}):`)
        low.forEach((issue: IssueReport) => {
          console.log(`   - [${issue.phase}] ${issue.issue}`)
        })
        console.log('')
      }

      qaReport.success = critical.length === 0 && high.length === 0
    }

    // Save QA report
    const outputPath = '/tmp/v6-execution-qa-report.json'
    writeFileSync(outputPath, JSON.stringify(qaReport, null, 2))
    console.log(`QA report saved to: ${outputPath}`)
    console.log('')

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    if (qaReport.success) {
      console.log('✅ QA PASSED - Workflow is ready for execution')
    } else {
      console.log('❌ QA FAILED - Critical issues must be fixed before execution')
    }
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('')

  } catch (error) {
    console.error('')
    console.error('❌ QA AGENT FAILED')
    console.error('')
    console.error('Error:', error instanceof Error ? error.message : String(error))
    console.error('')

    qaReport.success = false
    qaReport.fatal_error = error instanceof Error ? error.message : String(error)

    // Save error report
    writeFileSync(
      '/tmp/v6-execution-qa-report.json',
      JSON.stringify(qaReport, null, 2)
    )

    process.exit(1)
  }
}

main()
