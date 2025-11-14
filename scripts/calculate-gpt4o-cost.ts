import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function calculateCost() {
  // Fetch GPT-4o pricing from database
  const { data: pricing, error } = await supabase
    .from('ai_model_pricing')
    .select('*')
    .eq('model_name', 'gpt-4o')
    .eq('provider', 'openai')
    .order('effective_date', { ascending: false })
    .limit(1)
    .single()

  if (error) {
    console.error('Error fetching pricing:', error)
    // Use fallback pricing if database query fails
    console.log('\n💰 GPT-4o Cost Calculation (Fallback Pricing):')
    console.log('   Input:  $2.50 per 1M tokens')
    console.log('   Output: $10.00 per 1M tokens')

    const tokens = 200000
    const inputCost = (tokens / 1000000) * 2.50
    const outputCost = (tokens / 1000000) * 10.00
    const avgCost = (inputCost + outputCost) / 2

    console.log(`\n📊 For ${tokens.toLocaleString()} tokens:`)
    console.log(`   Input only:  $${inputCost.toFixed(4)}`)
    console.log(`   Output only: $${outputCost.toFixed(4)}`)
    console.log(`   Average (50/50 split): $${avgCost.toFixed(4)}`)
    return
  }

  const inputCostPer1M = pricing.input_cost_per_token * 1000000
  const outputCostPer1M = pricing.output_cost_per_token * 1000000

  console.log('💰 GPT-4o Pricing (from database):')
  console.log(`   Input:  $${inputCostPer1M.toFixed(2)} per 1M tokens`)
  console.log(`   Output: $${outputCostPer1M.toFixed(2)} per 1M tokens`)
  console.log(`   Effective Date: ${pricing.effective_date}`)

  const tokens = 200000
  const inputCost = (tokens / 1000000) * inputCostPer1M
  const outputCost = (tokens / 1000000) * outputCostPer1M
  const avgCost = (inputCost + outputCost) / 2

  console.log(`\n📊 For ${tokens.toLocaleString()} tokens (circuit breaker limit):`)
  console.log(`   Input only:  $${inputCost.toFixed(4)}`)
  console.log(`   Output only: $${outputCost.toFixed(4)}`)
  console.log(`   Average (50/50 split): $${avgCost.toFixed(4)}`)

  // Also show the previous token explosion cost
  const explosionTokens = 195620
  const explosionInputCost = (explosionTokens / 1000000) * inputCostPer1M
  const explosionOutputCost = (explosionTokens / 1000000) * outputCostPer1M
  const explosionAvgCost = (explosionInputCost + explosionOutputCost) / 2

  console.log(`\n🔴 Previous Token Explosion (${explosionTokens.toLocaleString()} tokens):`)
  console.log(`   Cost: $${explosionAvgCost.toFixed(4)} per execution`)
  console.log(`   If 10 users hit this bug: $${(explosionAvgCost * 10).toFixed(2)}`)
  console.log(`   If 100 users hit this bug: $${(explosionAvgCost * 100).toFixed(2)}`)
}

calculateCost()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err)
    process.exit(1)
  })
