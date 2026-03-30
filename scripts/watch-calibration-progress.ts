import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

let lastStatus = '';
let lastIterations = 0;

async function checkProgress() {
  // Get the most recent calibration session
  const { data: session } = await supabase
    .from('calibration_sessions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!session) {
    console.log('No calibration sessions found');
    return;
  }

  // Check if status or iterations changed
  if (session.status !== lastStatus || session.iterations_count !== lastIterations) {
    console.log('\n' + new Date().toLocaleTimeString());
    console.log('Session ID:', session.id);
    console.log('Status:', session.status);
    console.log('Iterations:', session.iterations_count || 0);
    console.log('Created:', new Date(session.created_at).toLocaleTimeString());

    if (session.summary) {
      console.log('Summary:', session.summary);
    }

    lastStatus = session.status;
    lastIterations = session.iterations_count || 0;
  }

  // Get the agent to check current workflow state
  const { data: agent } = await supabase
    .from('agents')
    .select('id, pilot_steps, updated_at')
    .eq('id', session.agent_id)
    .single();

  if (agent) {
    // Check step2 flatten field
    const step2 = agent.pilot_steps?.find((s: any) => s.id === 'step2' || s.step_id === 'step2');
    if (step2?.config?.field) {
      console.log('  Step2 flatten field:', step2.config.field);
    }

    // Check step6 parameter
    const step4 = agent.pilot_steps?.find((s: any) => s.id === 'step4' || s.step_id === 'step4');
    const step6 = step4?.scatter?.steps?.find((s: any) => s.id === 'step6' || s.step_id === 'step6');
    if (step6?.config) {
      if ('file_content' in step6.config) {
        console.log('  ✅ Step6 uses file_content');
      } else if ('file_url' in step6.config) {
        console.log('  ❌ Step6 still has file_url');
      }
    }
  }

  // If completed, show final result and exit
  if (session.status === 'completed' || session.status === 'failed') {
    console.log('\n=== CALIBRATION FINISHED ===');
    console.log('Final Status:', session.status);
    console.log('Total Iterations:', session.iterations_count || 0);

    if (session.status === 'completed') {
      console.log('\n✅ SUCCESS! Running final verification...\n');

      // Run the check script
      const { execSync } = require('child_process');
      try {
        const output = execSync('npx tsx scripts/check-fix-applied.ts', { encoding: 'utf-8' });
        console.log(output);
      } catch (err) {
        console.error('Error running verification:', err);
      }
    }

    process.exit(0);
  }
}

console.log('=== WATCHING CALIBRATION PROGRESS ===');
console.log('Monitoring the most recent calibration session...');
console.log('Press Ctrl+C to stop\n');

// Check immediately
checkProgress();

// Then check every 2 seconds
const interval = setInterval(checkProgress, 2000);

// Handle Ctrl+C
process.on('SIGINT', () => {
  clearInterval(interval);
  console.log('\n\nStopped monitoring');
  process.exit(0);
});
