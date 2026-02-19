/**
 * Test Pathway Detection
 *
 * Verifies that PathwayDetector correctly identifies:
 * - FAST PATH: OAuth-based plugins (Gmail, Sheets, HubSpot)
 * - FULL PATH: Custom/unknown services
 */

import { PluginManagerV2 } from '../lib/server/plugin-manager-v2'
import { determineV6Pathway, explainPathwayDecision } from '../lib/agentkit/v6/utils/PathwayDetector'

async function testPathwayDetection() {
  console.log('='.repeat(80))
  console.log('PATHWAY DETECTION TEST')
  console.log('='.repeat(80))

  // Initialize PluginManager
  const pluginManager = await PluginManagerV2.getInstance()
  console.log(`\n✓ PluginManager initialized with ${Object.keys(pluginManager.getAvailablePlugins()).length} plugins\n`)

  // ========================================================================
  // TEST 1: Gmail only (should be FAST)
  // ========================================================================

  console.log('TEST 1: Gmail Workflow (OAuth-based)')
  console.log('-'.repeat(80))

  const gmailPrompt = {
    specifics: {
      services_involved: ['google-mail']
    }
  }

  const gmailPathway = await determineV6Pathway(gmailPrompt, pluginManager)
  const gmailExplanation = await explainPathwayDecision(gmailPrompt, pluginManager)

  console.log(`Pathway: ${gmailPathway}`)
  console.log(`Reason: ${gmailExplanation.reason}`)
  console.log('Details:')
  gmailExplanation.details.forEach(d => console.log(`  ${d}`))
  console.log(`Expected: fast | Actual: ${gmailPathway} | ${gmailPathway === 'fast' ? '✅ PASS' : '❌ FAIL'}`)

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

  const multiOAuthPathway = await determineV6Pathway(multiOAuthPrompt, pluginManager)
  const multiOAuthExplanation = await explainPathwayDecision(multiOAuthPrompt, pluginManager)

  console.log(`Pathway: ${multiOAuthPathway}`)
  console.log(`Reason: ${multiOAuthExplanation.reason}`)
  console.log('Details:')
  multiOAuthExplanation.details.forEach(d => console.log(`  ${d}`))
  console.log(`Expected: fast | Actual: ${multiOAuthPathway} | ${multiOAuthPathway === 'fast' ? '✅ PASS' : '❌ FAIL'}`)

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

  const complexOAuthPathway = await determineV6Pathway(complexOAuthPrompt, pluginManager)
  const complexOAuthExplanation = await explainPathwayDecision(complexOAuthPrompt, pluginManager)

  console.log(`Pathway: ${complexOAuthPathway}`)
  console.log(`Reason: ${complexOAuthExplanation.reason}`)
  console.log('Details:')
  complexOAuthExplanation.details.forEach(d => console.log(`  ${d}`))
  console.log(`Expected: fast | Actual: ${complexOAuthPathway} | ${complexOAuthPathway === 'fast' ? '✅ PASS' : '❌ FAIL'}`)

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

  const unknownPathway = await determineV6Pathway(unknownPrompt, pluginManager)
  const unknownExplanation = await explainPathwayDecision(unknownPrompt, pluginManager)

  console.log(`Pathway: ${unknownPathway}`)
  console.log(`Reason: ${unknownExplanation.reason}`)
  console.log('Details:')
  unknownExplanation.details.forEach(d => console.log(`  ${d}`))
  console.log(`Expected: full | Actual: ${unknownPathway} | ${unknownPathway === 'full' ? '✅ PASS' : '❌ FAIL'}`)

  // ========================================================================
  // TEST 5: Mixed (Gmail + custom, should be FULL)
  // ========================================================================

  console.log('\nTEST 5: Mixed OAuth + Custom (should be FULL)')
  console.log('-'.repeat(80))

  const mixedPrompt = {
    specifics: {
      services_involved: ['google-mail', 'custom-service']
    }
  }

  const mixedPathway = await determineV6Pathway(mixedPrompt, pluginManager)
  const mixedExplanation = await explainPathwayDecision(mixedPrompt, pluginManager)

  console.log(`Pathway: ${mixedPathway}`)
  console.log(`Reason: ${mixedExplanation.reason}`)
  console.log('Details:')
  mixedExplanation.details.forEach(d => console.log(`  ${d}`))
  console.log(`Expected: full | Actual: ${mixedPathway} | ${mixedPathway === 'full' ? '✅ PASS' : '❌ FAIL'}`)

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

  const emptyPathway = await determineV6Pathway(emptyPrompt, pluginManager)
  const emptyExplanation = await explainPathwayDecision(emptyPrompt, pluginManager)

  console.log(`Pathway: ${emptyPathway}`)
  console.log(`Reason: ${emptyExplanation.reason}`)
  console.log(`Expected: full | Actual: ${emptyPathway} | ${emptyPathway === 'full' ? '✅ PASS' : '❌ FAIL'}`)

  // ========================================================================
  // SUMMARY
  // ========================================================================

  console.log('\n' + '='.repeat(80))
  console.log('TEST SUMMARY')
  console.log('='.repeat(80))

  const tests = [
    { name: 'Gmail only', expected: 'fast', actual: gmailPathway },
    { name: 'Gmail + Sheets', expected: 'fast', actual: multiOAuthPathway },
    { name: 'Gmail + HubSpot + Slack', expected: 'fast', actual: complexOAuthPathway },
    { name: 'Unknown services', expected: 'full', actual: unknownPathway },
    { name: 'Mixed OAuth + custom', expected: 'full', actual: mixedPathway },
    { name: 'No services', expected: 'full', actual: emptyPathway }
  ]

  const passed = tests.filter(t => t.expected === t.actual).length
  const total = tests.length

  console.log(`\nPassed: ${passed}/${total}`)
  console.log(`\n${passed === total ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`)
  console.log('\n' + '='.repeat(80))
}

// Run tests
testPathwayDetection().catch(error => {
  console.error('Test failed:', error)
  process.exit(1)
})
