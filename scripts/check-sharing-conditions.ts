#!/usr/bin/env tsx
/**
 * Check Agent Sharing Conditions
 * Shows current validation requirements for sharing agents
 */

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function main() {
  console.log('🔍 Checking Agent Sharing Conditions...\n')

  // 1. Check if agent_sharing reward exists and is active
  const { data: rewardConfig, error: rewardError } = await supabase
    .from('reward_config')
    .select('*')
    .eq('reward_key', 'agent_sharing')
    .single()

  if (rewardError || !rewardConfig) {
    console.error('❌ agent_sharing reward not found!')
    console.error('Error:', rewardError)
    return
  }

  console.log('📋 Reward Configuration:')
  console.log('  Reward Key:', rewardConfig.reward_key)
  console.log('  Display Name:', rewardConfig.display_name)
  console.log('  Active:', rewardConfig.is_active ? '✅ YES' : '❌ NO')
  console.log('  Credits Amount:', rewardConfig.credits_amount)
  console.log('  Max Per User (lifetime):', rewardConfig.max_per_user || 'unlimited')
  console.log('  Max Per User Per Day:', rewardConfig.max_per_user_per_day || 'unlimited')
  console.log('  Cooldown Hours:', rewardConfig.cooldown_hours || 0)
  console.log('')

  // 2. Check reward_settings for validation rules
  const { data: settings, error: settingsError } = await supabase
    .from('reward_settings')
    .select('*')
    .eq('reward_config_id', rewardConfig.id)
    .single()

  if (settingsError || !settings) {
    console.log('⚠️  No custom validation settings found, using defaults:\n')
    console.log('📊 Validation Requirements (DEFAULTS):')
    console.log('  Min Executions: 3')
    console.log('  Min Success Rate: 66%')
    console.log('  Require Description: Yes')
    console.log('  Min Description Length: 20 characters')
    console.log('  Min Agent Age: 1 hour')
    console.log('  Max Shares Per Month: 20')
    console.log('  Max Total Shares (lifetime): 100')
  } else {
    console.log('📊 Validation Requirements (FROM DATABASE):')
    console.log('  Min Executions:', settings.min_executions ?? 3)
    console.log('  Min Success Rate:', (settings.min_success_rate ?? 66) + '%')
    console.log('  Require Description:', settings.require_description ?? true ? 'Yes' : 'No')
    console.log('  Min Description Length:', (settings.min_description_length ?? 20), 'characters')
    console.log('  Min Agent Age:', (settings.min_agent_age_hours ?? 1), 'hours')
    console.log('  Max Shares Per Month:', settings.max_shares_per_month ?? 20)
    console.log('  Max Total Shares (lifetime):', settings.max_total_shares ?? 100)
  }

  console.log('\n' + '='.repeat(60))
  console.log('SUMMARY: For an agent to be sharable, it must meet ALL of:')
  console.log('='.repeat(60))

  const minExec = settings?.min_executions ?? 3
  const minSuccess = settings?.min_success_rate ?? 66
  const minDesc = settings?.min_description_length ?? 20
  const minAge = settings?.min_agent_age_hours ?? 1
  const dailyLimit = rewardConfig.max_per_user_per_day || 'unlimited'
  const monthlyLimit = settings?.max_shares_per_month ?? 20
  const lifetimeLimit = settings?.max_total_shares ?? 100

  console.log(`\n✅ Agent Quality:`)
  console.log(`   • Agent must be ACTIVE (status = 'active')`)
  console.log(`   • Agent must be at least ${minAge} hour(s) old`)
  console.log(`   • Description must be at least ${minDesc} characters`)
  console.log(`   • Must have at least ${minExec} successful test runs`)
  console.log(`   • Success rate must be at least ${minSuccess}%`)
  console.log(`   • Not already shared by this user`)

  console.log(`\n✅ User Limits:`)
  console.log(`   • Daily: Max ${dailyLimit} shares per 24 hours`)
  console.log(`   • Monthly: Max ${monthlyLimit} shares per 30 days`)
  console.log(`   • Lifetime: Max ${lifetimeLimit} total shares`)

  console.log(`\n💰 Reward:`)
  console.log(`   • Earn ${rewardConfig.credits_amount} credits per share`)
  if (rewardConfig.cooldown_hours && rewardConfig.cooldown_hours > 0) {
    console.log(`   • ${rewardConfig.cooldown_hours} hour cooldown between shares`)
  }

  if (!rewardConfig.is_active) {
    console.log(`\n⚠️  WARNING: Sharing reward is currently INACTIVE!`)
    console.log(`   To enable sharing, go to Admin → Reward Config and activate it.`)
  }
}

main().catch(console.error)
