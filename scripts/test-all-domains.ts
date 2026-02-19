/**
 * Master Test Script: Run All Domain Tests
 *
 * Validates that hardRequirements propagation works across:
 * - Manufacturing (quality control)
 * - Healthcare (patient triage)
 * - DevOps (log monitoring)
 * - Finance (fraud detection)
 */

import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

interface TestResult {
  domain: string
  success: boolean
  duration: number
  error?: string
}

const tests = [
  { name: 'Manufacturing', script: 'test-domain-manufacturing.ts' },
  { name: 'Healthcare', script: 'test-domain-healthcare.ts' },
  { name: 'DevOps', script: 'test-domain-devops.ts' },
  { name: 'Finance', script: 'test-domain-finance.ts' }
]

async function runTest(testName: string, scriptPath: string): Promise<TestResult> {
  const startTime = Date.now()

  try {
    console.log(`\n${'='.repeat(80)}`)
    console.log(`Running ${testName} test...`)
    console.log('='.repeat(80))

    const { stdout, stderr } = await execAsync(`npx tsx scripts/${scriptPath}`, {
      maxBuffer: 10 * 1024 * 1024 // 10MB buffer
    })

    console.log(stdout)
    if (stderr && !stderr.includes('[dotenv]')) {
      console.warn('Warnings:', stderr)
    }

    const duration = Date.now() - startTime

    return {
      domain: testName,
      success: true,
      duration
    }
  } catch (error: any) {
    const duration = Date.now() - startTime

    console.error(`\n❌ ${testName} test failed:`)
    console.error(error.stdout || error.message)

    return {
      domain: testName,
      success: false,
      duration,
      error: error.message
    }
  }
}

async function runAllTests() {
  console.log('\n' + '='.repeat(80))
  console.log('DOMAIN GENERALIZATION VALIDATION - ALL WORKFLOWS')
  console.log('='.repeat(80))
  console.log('\nTesting hardRequirements propagation across 4 diverse domains...\n')

  const results: TestResult[] = []

  for (const test of tests) {
    const result = await runTest(test.name, test.script)
    results.push(result)
  }

  // Print summary
  console.log('\n' + '='.repeat(80))
  console.log('FINAL RESULTS SUMMARY')
  console.log('='.repeat(80))
  console.log()

  const passed = results.filter(r => r.success).length
  const failed = results.filter(r => !r.success).length

  results.forEach(result => {
    const icon = result.success ? '✅' : '❌'
    const durationSec = (result.duration / 1000).toFixed(1)
    console.log(`${icon} ${result.domain.padEnd(15)} - ${durationSec}s`)
    if (result.error) {
      console.log(`   Error: ${result.error}`)
    }
  })

  console.log()
  console.log(`Total: ${results.length} tests`)
  console.log(`Passed: ${passed}`)
  console.log(`Failed: ${failed}`)
  console.log()

  if (failed === 0) {
    console.log('🎉 ALL DOMAIN TESTS PASSED')
    console.log()
    console.log('✅ Domain generalization validated successfully!')
    console.log('✅ hardRequirements propagation works across:')
    console.log('   - Manufacturing (quality control)')
    console.log('   - Healthcare (patient triage)')
    console.log('   - DevOps (log monitoring)')
    console.log('   - Finance (fraud detection)')
    console.log()
    console.log('The V6 pipeline is truly domain-agnostic! 🚀')
    console.log()
    process.exit(0)
  } else {
    console.log(`❌ ${failed} TEST(S) FAILED`)
    console.log()
    process.exit(1)
  }
}

runAllTests().catch(err => {
  console.error('Fatal error running tests:', err)
  process.exit(1)
})
