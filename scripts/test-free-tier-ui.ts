/**
 * Test Script: Set up free tier expiration for UI testing
 *
 * Run this script to test the free tier expiration UI:
 * npx tsx scripts/test-free-tier-ui.ts
 */

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface ExpirationScenario {
  name: string
  daysRemaining: number
  description: string
  expectedAlert: string
}

const scenarios: ExpirationScenario[] = [
  {
    name: 'CAUTION',
    daysRemaining: 12,
    description: '12 days remaining (Yellow alert)',
    expectedAlert: 'Free tier expires in 12 days'
  },
  {
    name: 'WARNING',
    daysRemaining: 6,
    description: '6 days remaining (Orange alert)',
    expectedAlert: 'Free tier expires in 6 days'
  },
  {
    name: 'CRITICAL',
    daysRemaining: 2,
    description: '2 days remaining (Red alert)',
    expectedAlert: 'Free tier expires in 2 days!'
  },
  {
    name: 'EXPIRED',
    daysRemaining: -1,
    description: 'Expired (Red alert + frozen)',
    expectedAlert: 'Free tier expired - Purchase tokens to continue'
  }
]

async function setupFreeTierTest(userEmail: string, scenarioName: string) {
  console.log('\n🧪 Free Tier Expiration Test Setup\n')

  // 1. Find user by email
  const { data: { users }, error: userError } = await supabase.auth.admin.listUsers()

  if (userError) {
    console.error('❌ Error fetching users:', userError)
    return
  }

  const user = users?.find(u => u.email === userEmail)

  if (!user) {
    console.error(`❌ User not found with email: ${userEmail}`)
    console.log('\n📋 Available users:')
    users?.slice(0, 5).forEach(u => console.log(`   - ${u.email} (${u.id})`))
    return
  }

  console.log(`✅ Found user: ${user.email} (${user.id})`)

  // 2. Find scenario
  const scenario = scenarios.find(s => s.name === scenarioName)

  if (!scenario) {
    console.error(`❌ Invalid scenario: ${scenarioName}`)
    console.log('\n📋 Available scenarios:')
    scenarios.forEach(s => console.log(`   - ${s.name}: ${s.description}`))
    return
  }

  console.log(`📌 Setting up scenario: ${scenario.name}`)
  console.log(`   ${scenario.description}`)

  // 3. Calculate dates
  const now = new Date()
  const grantedAt = new Date(now.getTime() - (30 - scenario.daysRemaining) * 24 * 60 * 60 * 1000)
  const expiresAt = new Date(now.getTime() + scenario.daysRemaining * 24 * 60 * 60 * 1000)

  // 4. Update user subscription
  const updateData: any = {
    free_tier_granted_at: grantedAt.toISOString(),
    free_tier_expires_at: expiresAt.toISOString(),
    free_tier_initial_amount: 208340,
    stripe_subscription_id: null // Ensure user is not a paying customer
  }

  // If expired, freeze the account
  if (scenario.daysRemaining <= 0) {
    updateData.account_frozen = true
    updateData.balance = 0
  } else {
    updateData.account_frozen = false
  }

  const { error: updateError } = await supabase
    .from('user_subscriptions')
    .update(updateData)
    .eq('user_id', user.id)

  if (updateError) {
    console.error('❌ Error updating subscription:', updateError)
    return
  }

  console.log('✅ Subscription updated successfully!')

  // 5. Verify the update
  const { data: subscription, error: verifyError } = await supabase
    .from('user_subscriptions')
    .select('balance, free_tier_granted_at, free_tier_expires_at, free_tier_initial_amount, account_frozen, stripe_subscription_id')
    .eq('user_id', user.id)
    .single()

  if (verifyError) {
    console.error('❌ Error verifying subscription:', verifyError)
    return
  }

  console.log('\n📊 Subscription Details:')
  console.log(`   Pilot Credits: ${Math.floor((subscription.balance || 0) / 10).toLocaleString()}`)
  console.log(`   Granted At: ${subscription.free_tier_granted_at}`)
  console.log(`   Expires At: ${subscription.free_tier_expires_at}`)
  console.log(`   Days Remaining: ${scenario.daysRemaining}`)
  console.log(`   Account Frozen: ${subscription.account_frozen}`)
  console.log(`   Has Subscription: ${!!subscription.stripe_subscription_id}`)

  console.log('\n✅ Setup complete!')
  console.log(`\n🎯 Expected behavior:`)
  console.log(`   Dashboard "Client Risk Alert" card should show:`)
  console.log(`   "${scenario.expectedAlert}"`)
  console.log(`\n   Billing page "Subscription" tab should show:`)
  console.log(`   Free Tier Status card with countdown\n`)
}

async function resetFreeTier(userEmail: string) {
  console.log('\n🔄 Resetting Free Tier\n')

  const { data: { users }, error: userError } = await supabase.auth.admin.listUsers()

  if (userError) {
    console.error('❌ Error fetching users:', userError)
    return
  }

  const user = users?.find(u => u.email === userEmail)

  if (!user) {
    console.error(`❌ User not found with email: ${userEmail}`)
    return
  }

  const { error: updateError } = await supabase
    .from('user_subscriptions')
    .update({
      free_tier_granted_at: null,
      free_tier_expires_at: null,
      free_tier_initial_amount: 0,
      account_frozen: false
    })
    .eq('user_id', user.id)

  if (updateError) {
    console.error('❌ Error resetting subscription:', updateError)
    return
  }

  console.log('✅ Free tier reset successfully for', user.email)
}

// ============================================================================
// CLI Interface
// ============================================================================

const command = process.argv[2]
const userEmail = process.argv[3]
const scenario = process.argv[4]

if (command === 'setup' && userEmail && scenario) {
  setupFreeTierTest(userEmail, scenario.toUpperCase())
} else if (command === 'reset' && userEmail) {
  resetFreeTier(userEmail)
} else {
  console.log(`
🧪 Free Tier Expiration UI Test Script

Usage:
  npx tsx scripts/test-free-tier-ui.ts setup <email> <scenario>
  npx tsx scripts/test-free-tier-ui.ts reset <email>

Scenarios:
  CAUTION  - 12 days remaining (Yellow alert)
  WARNING  - 6 days remaining (Orange alert)
  CRITICAL - 2 days remaining (Red alert)
  EXPIRED  - Expired (Red alert + frozen account)

Examples:
  npx tsx scripts/test-free-tier-ui.ts setup user@example.com CRITICAL
  npx tsx scripts/test-free-tier-ui.ts reset user@example.com
  `)
}
