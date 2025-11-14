import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function checkConstraint() {
  console.log('🔍 Checking workflow_step_executions table constraints...\n')

  // Query the database to get constraint information
  const { data, error } = await supabase.rpc('get_table_constraints', {
    table_name: 'workflow_step_executions'
  }).single()

  if (error) {
    console.log('⚠️  RPC function not available, trying direct query...\n')

    // Try a test insert to see what values are allowed
    const testStepTypes = [
      'action',
      'llm_decision',
      'ai_processing',
      'conditional',
      'loop',
      'transform',
      'delay',
      'parallel_group',
      'switch',
      'validation',
      'enrichment',
      'comparison',
      'sub_workflow',
      'human_approval'
    ]

    console.log('Testing which step_type values are allowed:\n')

    for (const stepType of testStepTypes) {
      const { error: insertError } = await supabase
        .from('workflow_step_executions')
        .insert({
          workflow_execution_id: '00000000-0000-0000-0000-000000000000', // Will fail FK, but constraint check happens first
          step_id: 'test',
          step_name: 'test',
          step_type: stepType,
          status: 'pending'
        })

      if (insertError) {
        if (insertError.code === '23514') {
          console.log(`❌ ${stepType}: REJECTED by CHECK constraint`)
        } else if (insertError.code === '23503') {
          console.log(`✅ ${stepType}: ACCEPTED (FK error expected)`)
        } else {
          console.log(`⚠️  ${stepType}: ${insertError.code} - ${insertError.message}`)
        }
      } else {
        console.log(`✅ ${stepType}: ACCEPTED`)
      }
    }
  } else {
    console.log('Constraint info:', JSON.stringify(data, null, 2))
  }

  // Also check if there are any existing records to see what values are actually used
  const { data: existingRecords, error: selectError } = await supabase
    .from('workflow_step_executions')
    .select('step_type')
    .limit(100)

  if (!selectError && existingRecords && existingRecords.length > 0) {
    const uniqueTypes = [...new Set(existingRecords.map(r => r.step_type))]
    console.log('\n📊 Existing step_type values in database:')
    uniqueTypes.forEach(type => console.log(`   - ${type}`))
  }
}

checkConstraint()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ Error:', err)
    process.exit(1)
  })
