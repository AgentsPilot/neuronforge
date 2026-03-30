import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  // Get latest calibration session
  const { data: sessions } = await supabase
    .from('calibration_sessions')
    .select('*')
    .eq('agent_id', '43ffbc8a-406d-4a43-9f3f-4e7554160eda')
    .order('created_at', { ascending: false })
    .limit(1);

  if (!sessions || sessions.length === 0) {
    console.log('No calibration sessions found');
    return;
  }

  const session = sessions[0];
  console.log('Latest calibration session:', session.id);
  console.log('Status:', session.status);
  console.log('Created:', session.created_at);
  console.log('Total iterations:', session.total_iterations);
  console.log('Fixes applied:', session.fixes_applied);
  console.log('\n=== Issues Found ===');
  if (session.issues_found && Array.isArray(session.issues_found)) {
    session.issues_found.forEach((issue: any, index: number) => {
      console.log(`\n${index + 1}. ${issue.title || issue.type}`);
      console.log('   Category:', issue.category);
      console.log('   Auto-repair available:', issue.autoRepairAvailable);
      if (issue.autoRepairProposal) {
        console.log('   Proposal type:', issue.autoRepairProposal.type);
        console.log('   Confidence:', issue.autoRepairProposal.confidence);
      }
    });
  }
}

main();
