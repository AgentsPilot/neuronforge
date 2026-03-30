#!/usr/bin/env tsx
/**
 * Comprehensive parameter validation script
 * Checks ALL action steps against their plugin schemas
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import dotenv from 'dotenv'
import { PluginManagerV2 } from '../lib/server/plugin-manager-v2'

// Load environment variables
dotenv.config({ path: join(process.cwd(), '.env.local') })

interface ValidationIssue {
  step_id: string
  plugin: string
  operation: string
  issue_type: 'missing_required' | 'unknown_param' | 'wrong_type'
  parameter: string
  details: string
}

async function validateAllParameters() {
  console.log('📋 Comprehensive Parameter Validation\n')
  console.log('=' .repeat(80))

  // Load PILOT DSL
  const pilotPath = join(process.cwd(), 'output/vocabulary-pipeline/pilot-dsl-steps.json')
  const pilotSteps = JSON.parse(readFileSync(pilotPath, 'utf-8'))

  // Load plugin manager
  const pluginManager = await PluginManagerV2.getInstance()
  const allPlugins = pluginManager.getAvailablePlugins()

  const issues: ValidationIssue[] = []
  let totalActionSteps = 0

  // Helper to check a single action step
  function checkActionStep(step: any, context: string = '') {
    if (step.type !== 'action') return

    totalActionSteps++

    const { step_id, plugin, operation, config } = step
    const contextPrefix = context ? `${context} > ` : ''

    console.log(`\n${contextPrefix}${step_id}: ${plugin}.${operation}`)

    // Get plugin schema (handle both hyphen and underscore formats)
    const pluginKey = plugin.replace(/-/g, '_')
    const pluginDef = allPlugins[pluginKey] || allPlugins[plugin]
    if (!pluginDef) {
      console.log(`  ⚠️  Plugin '${plugin}' (tried: ${pluginKey}) not found`)
      console.log(`     Available: ${Object.keys(allPlugins).join(', ')}`)
      issues.push({
        step_id,
        plugin,
        operation,
        issue_type: 'unknown_param',
        parameter: 'N/A',
        details: `Plugin '${plugin}' not found in registry`
      })
      return
    }

    const actionDef = pluginDef.actions[operation]
    if (!actionDef) {
      console.log(`  ⚠️  Operation '${operation}' not found in ${plugin}`)
      issues.push({
        step_id,
        plugin,
        operation,
        issue_type: 'unknown_param',
        parameter: 'N/A',
        details: `Operation '${operation}' not found in ${plugin}`
      })
      return
    }

    const schema = actionDef.parameters
    const requiredParams = schema?.required || []
    const schemaProperties = schema?.properties || {}

    console.log(`  Required: [${requiredParams.join(', ')}]`)
    console.log(`  Provided: [${Object.keys(config).join(', ')}]`)

    // Check for missing required parameters
    for (const paramName of requiredParams) {
      if (!(paramName in config)) {
        console.log(`  ❌ MISSING REQUIRED: '${paramName}'`)
        issues.push({
          step_id,
          plugin,
          operation,
          issue_type: 'missing_required',
          parameter: paramName,
          details: `Required parameter '${paramName}' not found in config`
        })
      } else {
        console.log(`  ✅ ${paramName}`)
      }
    }

    // Check for unknown parameters
    for (const paramName of Object.keys(config)) {
      if (!(paramName in schemaProperties)) {
        console.log(`  ⚠️  UNKNOWN: '${paramName}' (not in schema)`)
        issues.push({
          step_id,
          plugin,
          operation,
          issue_type: 'unknown_param',
          parameter: paramName,
          details: `Parameter '${paramName}' not defined in ${plugin}.${operation} schema`
        })
      }
    }
  }

  // Process all top-level steps
  for (const step of pilotSteps) {
    if (step.type === 'action') {
      checkActionStep(step)
    } else if (step.type === 'scatter_gather' && step.scatter?.steps) {
      console.log(`\n${step.step_id}: scatter_gather (loop)`)
      for (const nestedStep of step.scatter.steps) {
        checkActionStep(nestedStep, step.step_id)
      }
    }
  }

  // Summary
  console.log('\n' + '='.repeat(80))
  console.log('📊 Validation Summary\n')
  console.log(`Total action steps checked: ${totalActionSteps}`)
  console.log(`Total issues found: ${issues.length}\n`)

  if (issues.length === 0) {
    console.log('✅ ALL PARAMETERS VALID!')
    return true
  }

  // Group issues by type
  const missingRequired = issues.filter(i => i.issue_type === 'missing_required')
  const unknownParams = issues.filter(i => i.issue_type === 'unknown_param')

  if (missingRequired.length > 0) {
    console.log(`❌ Missing Required Parameters (${missingRequired.length}):`)
    for (const issue of missingRequired) {
      console.log(`   - ${issue.step_id}: ${issue.plugin}.${issue.operation} missing '${issue.parameter}'`)
    }
    console.log('')
  }

  if (unknownParams.length > 0) {
    console.log(`⚠️  Unknown Parameters (${unknownParams.length}):`)
    for (const issue of unknownParams) {
      console.log(`   - ${issue.step_id}: ${issue.plugin}.${issue.operation} has unknown '${issue.parameter}'`)
    }
    console.log('')
  }

  console.log('=' .repeat(80))

  return issues.length === 0
}

validateAllParameters()
  .then((success) => {
    process.exit(success ? 0 : 1)
  })
  .catch((error) => {
    console.error('❌ Validation failed with error:', error)
    process.exit(1)
  })
