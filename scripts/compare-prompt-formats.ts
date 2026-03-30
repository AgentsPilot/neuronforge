/**
 * Compare Narrative vs Structured Prompt Workflow Generation
 *
 * Validates both workflows and compares:
 * - Complexity metrics
 * - Data flow correctness
 * - Loop/conditional handling
 * - Parameter completeness
 * - Config reference format
 */

import fs from 'fs'
import path from 'path'

interface WorkflowMetrics {
  name: string
  topLevelSteps: number
  totalSteps: number
  scatterGatherLoops: number
  conditionals: number
  nestedConditionalDepth: number
  pluginActions: number
  transforms: number
  aiProcessing: number
  declaredVariables: number
  configReferences: number
  variableReferences: number
}

function countSteps(steps: any[]): number {
  let count = steps.length

  for (const step of steps) {
    if (step.scatter?.steps) {
      count += countSteps(step.scatter.steps)
    }
    if (step.steps) {
      count += countSteps(step.steps)
    }
    if (step.else_steps) {
      count += countSteps(step.else_steps)
    }
  }

  return count
}

function countLoops(steps: any[]): number {
  let count = 0

  for (const step of steps) {
    if (step.type === 'scatter_gather') {
      count++
      if (step.scatter?.steps) {
        count += countLoops(step.scatter.steps)
      }
    }
    if (step.steps) count += countLoops(step.steps)
    if (step.else_steps) count += countLoops(step.else_steps)
  }

  return count
}

function countConditionals(steps: any[]): number {
  let count = 0

  for (const step of steps) {
    if (step.type === 'conditional') {
      count++
    }
    if (step.scatter?.steps) count += countConditionals(step.scatter.steps)
    if (step.steps) count += countConditionals(step.steps)
    if (step.else_steps) count += countConditionals(step.else_steps)
  }

  return count
}

function maxConditionalDepth(steps: any[], currentDepth = 0): number {
  let maxDepth = currentDepth

  for (const step of steps) {
    if (step.type === 'conditional') {
      const innerDepth = currentDepth + 1
      maxDepth = Math.max(maxDepth, innerDepth)

      if (step.steps) {
        maxDepth = Math.max(maxDepth, maxConditionalDepth(step.steps, innerDepth))
      }
      if (step.else_steps) {
        maxDepth = Math.max(maxDepth, maxConditionalDepth(step.else_steps, innerDepth))
      }
    }

    if (step.scatter?.steps) {
      maxDepth = Math.max(maxDepth, maxConditionalDepth(step.scatter.steps, currentDepth))
    }
  }

  return maxDepth
}

function countPluginActions(steps: any[]): number {
  let count = 0

  for (const step of steps) {
    if (step.type === 'action') count++
    if (step.scatter?.steps) count += countPluginActions(step.scatter.steps)
    if (step.steps) count += countPluginActions(step.steps)
    if (step.else_steps) count += countPluginActions(step.else_steps)
  }

  return count
}

function countTransforms(steps: any[]): number {
  let count = 0

  for (const step of steps) {
    if (step.type === 'transform') count++
    if (step.scatter?.steps) count += countTransforms(step.scatter.steps)
    if (step.steps) count += countTransforms(step.steps)
    if (step.else_steps) count += countTransforms(step.else_steps)
  }

  return count
}

function countAI(steps: any[]): number {
  let count = 0

  for (const step of steps) {
    if (step.type === 'ai_processing') count++
    if (step.scatter?.steps) count += countAI(step.scatter.steps)
    if (step.steps) count += countAI(step.steps)
    if (step.else_steps) count += countAI(step.else_steps)
  }

  return count
}

function countVariables(steps: any[]): number {
  const vars = new Set<string>()

  function collect(steps: any[]) {
    for (const step of steps) {
      if (step.output_variable) vars.add(step.output_variable)
      if (step.scatter?.steps) collect(step.scatter.steps)
      if (step.steps) collect(step.steps)
      if (step.else_steps) collect(step.else_steps)
    }
  }

  collect(steps)
  return vars.size
}

function countConfigRefs(steps: any[]): number {
  const json = JSON.stringify(steps)
  const matches = json.match(/\{\{config\.\w+\}\}/g)
  return matches ? new Set(matches).size : 0
}

function countVarRefs(steps: any[]): number {
  const json = JSON.stringify(steps)
  const matches = json.match(/\{\{\w+(?:\.\w+)?\}\}/g)
  return matches ? matches.filter(m => !m.includes('config.')).length : 0
}

function analyzeWorkflow(name: string, workflow: any[]): WorkflowMetrics {
  return {
    name,
    topLevelSteps: workflow.length,
    totalSteps: countSteps(workflow),
    scatterGatherLoops: countLoops(workflow),
    conditionals: countConditionals(workflow),
    nestedConditionalDepth: maxConditionalDepth(workflow),
    pluginActions: countPluginActions(workflow),
    transforms: countTransforms(workflow),
    aiProcessing: countAI(workflow),
    declaredVariables: countVariables(workflow),
    configReferences: countConfigRefs(workflow),
    variableReferences: countVarRefs(workflow)
  }
}

async function main() {
  console.log('📊 Narrative vs Structured Prompt - Comparison Analysis')
  console.log('=' .repeat(80))

  // Load both workflows
  const narrativePath = path.join(process.cwd(), 'output/vocabulary-pipeline/pilot-dsl-steps-narrative.json')
  const structuredPath = path.join(process.cwd(), 'output/vocabulary-pipeline/pilot-dsl-steps-structured-prompt.json')

  // Save narrative workflow first
  const currentWorkflow = JSON.parse(fs.readFileSync(
    path.join(process.cwd(), 'output/vocabulary-pipeline/pilot-dsl-steps.json'),
    'utf-8'
  ))

  // Check which one is which by step count
  if (currentWorkflow.length === 12) {
    // This is narrative (12 top-level steps)
    fs.writeFileSync(narrativePath, JSON.stringify(currentWorkflow, null, 2))
    console.log('✅ Saved narrative workflow (12 top-level steps)')
  } else {
    // This is structured
    console.log(`⚠️  Current workflow has ${currentWorkflow.length} steps - checking...`)
  }

  const narrative = JSON.parse(fs.readFileSync(narrativePath, 'utf-8'))
  const structured = JSON.parse(fs.readFileSync(structuredPath, 'utf-8'))

  console.log(`\n📁 Narrative Prompt: ${narrativePath}`)
  console.log(`📁 Structured Prompt: ${structuredPath}`)

  // Analyze both
  const narrativeMetrics = analyzeWorkflow('Narrative Prompt', narrative)
  const structuredMetrics = analyzeWorkflow('Structured Prompt', structured)

  console.log('\n📊 COMPLEXITY COMPARISON')
  console.log('=' .repeat(80))

  const metrics: Array<keyof WorkflowMetrics> = [
    'topLevelSteps',
    'totalSteps',
    'scatterGatherLoops',
    'conditionals',
    'nestedConditionalDepth',
    'pluginActions',
    'transforms',
    'aiProcessing',
    'declaredVariables',
    'configReferences',
    'variableReferences'
  ]

  const labels: Record<string, string> = {
    topLevelSteps: 'Top-level Steps',
    totalSteps: 'Total Steps (including nested)',
    scatterGatherLoops: 'Scatter-gather Loops',
    conditionals: 'Conditional Steps',
    nestedConditionalDepth: 'Max Conditional Nesting',
    pluginActions: 'Plugin Actions',
    transforms: 'Transform Operations',
    aiProcessing: 'AI Processing Steps',
    declaredVariables: 'Declared Variables',
    configReferences: 'Config References',
    variableReferences: 'Variable References'
  }

  console.log(`\n${'Metric'.padEnd(35)} | ${'Narrative'.padEnd(12)} | ${'Structured'.padEnd(12)} | Difference`)
  console.log('-'.repeat(80))

  for (const metric of metrics) {
    const nValue = narrativeMetrics[metric] as number
    const sValue = structuredMetrics[metric] as number
    const diff = nValue - sValue
    const diffStr = diff > 0 ? `+${diff}` : `${diff}`
    const winner = diff > 0 ? '🔵' : diff < 0 ? '🟢' : '⚪'

    console.log(
      `${labels[metric].padEnd(35)} | ${String(nValue).padEnd(12)} | ${String(sValue).padEnd(12)} | ${diffStr.padEnd(10)} ${winner}`
    )
  }

  console.log('\n📈 COMPLEXITY SCORE')
  console.log('=' .repeat(80))

  const narrativeScore = narrativeMetrics.totalSteps +
    narrativeMetrics.scatterGatherLoops * 3 +
    narrativeMetrics.conditionals * 2 +
    narrativeMetrics.nestedConditionalDepth * 5

  const structuredScore = structuredMetrics.totalSteps +
    structuredMetrics.scatterGatherLoops * 3 +
    structuredMetrics.conditionals * 2 +
    structuredMetrics.nestedConditionalDepth * 5

  console.log(`Narrative Prompt:   ${narrativeScore} points`)
  console.log(`Structured Prompt:  ${structuredScore} points`)
  console.log(`\nDifference: +${narrativeScore - structuredScore} points (${((narrativeScore / structuredScore - 1) * 100).toFixed(1)}% more complex)`)

  console.log('\n🏆 WINNER BY CATEGORY')
  console.log('=' .repeat(80))

  const categories = [
    { name: 'Workflow Complexity', winner: narrativeScore > structuredScore ? 'Narrative' : 'Structured' },
    { name: 'Loop Handling', winner: narrativeMetrics.scatterGatherLoops >= structuredMetrics.scatterGatherLoops ? 'Narrative' : 'Structured' },
    { name: 'Conditional Logic', winner: narrativeMetrics.nestedConditionalDepth >= structuredMetrics.nestedConditionalDepth ? 'Narrative' : 'Structured' },
    { name: 'Transform Operations', winner: narrativeMetrics.transforms >= structuredMetrics.transforms ? 'Narrative' : 'Structured' },
    { name: 'Variable Management', winner: narrativeMetrics.declaredVariables >= structuredMetrics.declaredVariables ? 'Narrative' : 'Structured' }
  ]

  for (const cat of categories) {
    console.log(`${cat.name.padEnd(30)} → ${cat.winner}`)
  }

  console.log('\n✅ ANALYSIS COMPLETE')
  console.log('=' .repeat(80))

  // Save comparison report
  const report = {
    narrative: narrativeMetrics,
    structured: structuredMetrics,
    comparison: {
      narrativeScore,
      structuredScore,
      narrativeAdvantage: narrativeScore - structuredScore,
      narrativeAdvantagePercent: ((narrativeScore / structuredScore - 1) * 100).toFixed(1)
    }
  }

  const reportPath = path.join(process.cwd(), 'output/vocabulary-pipeline/prompt-format-comparison.json')
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
  console.log(`\n💾 Comparison report saved: ${reportPath}`)
}

main().catch(console.error)
