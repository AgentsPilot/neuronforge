/**
 * Test CapabilityBinderV2 with real Generic Intent V1 contract
 */

import fs from 'fs'
import path from 'path'
import type { IntentContract } from '../lib/agentkit/v6/semantic-plan/types/intent-schema-types'

async function main() {
  console.log('🧪 Testing CapabilityBinderV2 with Real Generic Intent V1 Contract\n')
  console.log('=' .repeat(80))

  // Load the real contract
  const contractPath = path.join(process.cwd(), 'output', 'generic-intent-v1-contract.json')

  if (!fs.existsSync(contractPath)) {
    console.error('❌ Contract file not found:', contractPath)
    process.exit(1)
  }

  const contract: IntentContract = JSON.parse(fs.readFileSync(contractPath, 'utf-8'))

  console.log('\n📄 Loaded Contract:')
  console.log(`   Version: ${contract.version}`)
  console.log(`   Goal: ${contract.goal}`)
  console.log(`   Steps: ${contract.steps.length}`)

  console.log('\n📋 Steps with Capability Requirements:\n')

  let stepsWithUses = 0
  for (const step of contract.steps) {
    if (step.uses && step.uses.length > 0) {
      stepsWithUses++
      const uses = step.uses[0]
      console.log(`   ${step.id} (${step.kind}):`)
      console.log(`     Domain: ${uses.domain}`)
      console.log(`     Capability: ${uses.capability}`)

      if (uses.preferences?.provider_family) {
        console.log(`     Provider: ${uses.preferences.provider_family}`)
      }
      if (uses.preferences?.must_support && uses.preferences.must_support.length > 0) {
        console.log(`     Must-support: ${uses.preferences.must_support.join(', ')}`)
      }
      console.log('')
    }
  }

  console.log('=' .repeat(80))
  console.log(`\n📊 Summary: ${stepsWithUses}/${contract.steps.length} steps have capability requirements\n`)

  console.log('✅ Expected Binding Behavior:\n')
  console.log('   1. Domain + Capability matching finds candidates')
  console.log('   2. Provider preferences score candidates')
  console.log('   3. Must-support filters out incompatible actions')
  console.log('   4. Best candidate selected deterministically')
  console.log('   5. NO hardcoded plugin logic')

  console.log('\n' + '=' .repeat(80))
  console.log('\n✅ Contract loaded successfully')
  console.log('✅ Ready for CapabilityBinderV2 execution')
  console.log('\n📝 Next: Integrate with PluginManagerV2 and bind to real plugins')
  console.log('\n' + '=' .repeat(80))
}

main().catch((err) => {
  console.error('\n❌ Test failed:', err)
  process.exit(1)
})
