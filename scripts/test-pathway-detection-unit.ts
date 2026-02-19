/**
 * Unit Test: Pathway Detection (No Database Dependencies)
 *
 * Tests the core PathwayDetector logic with mocked plugin data
 */

import { determineV6Pathway, explainPathwayDecision } from '../lib/agentkit/v6/utils/PathwayDetector'

// Mock PluginManager with test plugin data
class MockPluginManager {
  private plugins: Record<string, any>

  constructor(plugins: Record<string, any>) {
    this.plugins = plugins
  }

  getAvailablePlugins() {
    return this.plugins
  }
}

// Create test plugins with OAuth and non-OAuth auth types
const mockPlugins = {
  'google-mail': {
    plugin: {
      auth_config: {
        auth_type: 'oauth2_google'
      }
    }
  },
  'google-sheets': {
    plugin: {
      auth_config: {
        auth_type: 'oauth2_google'
      }
    }
  },
  'hubspot': {
    plugin: {
      auth_config: {
        auth_type: 'oauth2'
      }
    }
  },
  'slack': {
    plugin: {
      auth_config: {
        auth_type: 'oauth2'
      }
    }
  },
  'custom-api': {
    plugin: {
      auth_config: {
        auth_type: 'api_key'
      }
    }
  },
  'my-webhook': {
    plugin: {
      auth_config: {
        auth_type: 'none'
      }
    }
  }
}

async function runTests() {
  console.log('='.repeat(80))
  console.log('PATHWAY DETECTION UNIT TEST (No Database Dependencies)')
  console.log('='.repeat(80))

  const mockPM = new MockPluginManager(mockPlugins) as any
  let passCount = 0
  const tests: Array<{name: string, expected: string, actual: string}> = []

  // ========================================================================
  // TEST 1: Gmail only (should be FAST)
  // ========================================================================

  console.log('\nTEST 1: Gmail Workflow (OAuth-based)')
  console.log('-'.repeat(80))

  const gmailPrompt = {
    specifics: {
      services_involved: ['google-mail']
    }
  }

  const gmailPathway = await determineV6Pathway(gmailPrompt, mockPM)
  const gmailExplanation = await explainPathwayDecision(gmailPrompt, mockPM)

  console.log(`Pathway: ${gmailPathway}`)
  console.log(`Reason: ${gmailExplanation.reason}`)
  console.log('Details:')
  gmailExplanation.details.forEach(d => console.log(`  ${d}`))

  const test1Pass = gmailPathway === 'fast'
  console.log(`Expected: fast | Actual: ${gmailPathway} | ${test1Pass ? '✅ PASS' : '❌ FAIL'}`)
  if (test1Pass) passCount++
  tests.push({ name: 'Gmail only', expected: 'fast', actual: gmailPathway })

  // ========================================================================
  // TEST 2: Gmail + Google Sheets (both OAuth, should be FAST)
  // ========================================================================

  console.log('\nTEST 2: Gmail + Google Sheets (both OAuth-based)')
  console.log('-'.repeat(80))

  const multiOAuthPrompt = {
    specifics: {
      services_involved: ['google-mail', 'google-sheets']
    }
  }

  const multiOAuthPathway = await determineV6Pathway(multiOAuthPrompt, mockPM)
  const multiOAuthExplanation = await explainPathwayDecision(multiOAuthPrompt, mockPM)

  console.log(`Pathway: ${multiOAuthPathway}`)
  console.log(`Reason: ${multiOAuthExplanation.reason}`)
  console.log('Details:')
  multiOAuthExplanation.details.forEach(d => console.log(`  ${d}`))

  const test2Pass = multiOAuthPathway === 'fast'
  console.log(`Expected: fast | Actual: ${multiOAuthPathway} | ${test2Pass ? '✅ PASS' : '❌ FAIL'}`)
  if (test2Pass) passCount++
  tests.push({ name: 'Gmail + Sheets', expected: 'fast', actual: multiOAuthPathway })

  // ========================================================================
  // TEST 3: Gmail + HubSpot + Slack (all OAuth, should be FAST)
  // ========================================================================

  console.log('\nTEST 3: Gmail + HubSpot + Slack (all OAuth-based)')
  console.log('-'.repeat(80))

  const complexOAuthPrompt = {
    specifics: {
      services_involved: ['google-mail', 'hubspot', 'slack']
    }
  }

  const complexOAuthPathway = await determineV6Pathway(complexOAuthPrompt, mockPM)
  const complexOAuthExplanation = await explainPathwayDecision(complexOAuthPrompt, mockPM)

  console.log(`Pathway: ${complexOAuthPathway}`)
  console.log(`Reason: ${complexOAuthExplanation.reason}`)
  console.log('Details:')
  complexOAuthExplanation.details.forEach(d => console.log(`  ${d}`))

  const test3Pass = complexOAuthPathway === 'fast'
  console.log(`Expected: fast | Actual: ${complexOAuthPathway} | ${test3Pass ? '✅ PASS' : '❌ FAIL'}`)
  if (test3Pass) passCount++
  tests.push({ name: 'Gmail + HubSpot + Slack', expected: 'fast', actual: complexOAuthPathway })

  // ========================================================================
  // TEST 4: Unknown service (should be FULL)
  // ========================================================================

  console.log('\nTEST 4: Unknown Service (no OAuth)')
  console.log('-'.repeat(80))

  const unknownPrompt = {
    specifics: {
      services_involved: ['custom-api', 'my-webhook']
    }
  }

  const unknownPathway = await determineV6Pathway(unknownPrompt, mockPM)
  const unknownExplanation = await explainPathwayDecision(unknownPrompt, mockPM)

  console.log(`Pathway: ${unknownPathway}`)
  console.log(`Reason: ${unknownExplanation.reason}`)
  console.log('Details:')
  unknownExplanation.details.forEach(d => console.log(`  ${d}`))

  const test4Pass = unknownPathway === 'full'
  console.log(`Expected: full | Actual: ${unknownPathway} | ${test4Pass ? '✅ PASS' : '❌ FAIL'}`)
  if (test4Pass) passCount++
  tests.push({ name: 'Unknown services', expected: 'full', actual: unknownPathway })

  // ========================================================================
  // TEST 5: Mixed (Gmail + custom, should be FULL)
  // ========================================================================

  console.log('\nTEST 5: Mixed OAuth + Custom (should be FULL)')
  console.log('-'.repeat(80))

  const mixedPrompt = {
    specifics: {
      services_involved: ['google-mail', 'custom-api']
    }
  }

  const mixedPathway = await determineV6Pathway(mixedPrompt, mockPM)
  const mixedExplanation = await explainPathwayDecision(mixedPrompt, mockPM)

  console.log(`Pathway: ${mixedPathway}`)
  console.log(`Reason: ${mixedExplanation.reason}`)
  console.log('Details:')
  mixedExplanation.details.forEach(d => console.log(`  ${d}`))

  const test5Pass = mixedPathway === 'full'
  console.log(`Expected: full | Actual: ${mixedPathway} | ${test5Pass ? '✅ PASS' : '❌ FAIL'}`)
  if (test5Pass) passCount++
  tests.push({ name: 'Mixed OAuth + custom', expected: 'full', actual: mixedPathway })

  // ========================================================================
  // TEST 6: No services (should be FULL - safety fallback)
  // ========================================================================

  console.log('\nTEST 6: No Services Specified (safety fallback)')
  console.log('-'.repeat(80))

  const emptyPrompt = {
    specifics: {
      services_involved: []
    }
  }

  const emptyPathway = await determineV6Pathway(emptyPrompt, mockPM)
  const emptyExplanation = await explainPathwayDecision(emptyPrompt, mockPM)

  console.log(`Pathway: ${emptyPathway}`)
  console.log(`Reason: ${emptyExplanation.reason}`)

  const test6Pass = emptyPathway === 'full'
  console.log(`Expected: full | Actual: ${emptyPathway} | ${test6Pass ? '✅ PASS' : '❌ FAIL'}`)
  if (test6Pass) passCount++
  tests.push({ name: 'No services', expected: 'full', actual: emptyPathway })

  // ========================================================================
  // SUMMARY
  // ========================================================================

  console.log('\n' + '='.repeat(80))
  console.log('TEST SUMMARY')
  console.log('='.repeat(80))

  const total = tests.length

  console.log(`\nPassed: ${passCount}/${total}`)
  console.log(`\n${passCount === total ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`)

  if (passCount < total) {
    console.log('\nFailed tests:')
    tests.forEach(t => {
      if (t.expected !== t.actual) {
        console.log(`  ❌ ${t.name}: expected ${t.expected}, got ${t.actual}`)
      }
    })
  }

  console.log('\n' + '='.repeat(80))

  // Exit with appropriate code
  process.exit(passCount === total ? 0 : 1)
}

// Run tests
runTests().catch(error => {
  console.error('Test failed:', error)
  process.exit(1)
})
