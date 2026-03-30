import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import * as path from 'path';

config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  const agentId = '43ffbc8a-406d-4a43-9f3f-4e7554160eda';

  // Check calibration_sessions table
  const { data: sessions } = await supabase
    .from('calibration_sessions')
    .select('*')
    .eq('agent_id', agentId)
    .order('started_at', { ascending: false })
    .limit(1);

  if (!sessions || sessions.length === 0) {
    console.log('No calibration sessions found for agent:', agentId);
    return;
  }

  const session = sessions[0];
  console.log('=== CALIBRATION SESSION ===');
  console.log('Session ID:', session.id);
  console.log('Status:', session.status);
  console.log('Started:', session.started_at);

  const iterations = session.iterations || [];
  console.log('\nIterations:', iterations.length);

  if (iterations.length > 0) {
    const lastIteration = iterations[iterations.length - 1];
    console.log('\n=== LAST ITERATION ===');
    console.log('Iteration Number:', lastIteration.iterationNumber);
    console.log('Execution ID:', lastIteration.executionId);
    console.log('Status:', lastIteration.status);

    if (lastIteration.collectedIssues) {
      console.log('\n=== COLLECTED ISSUES ===');
      console.log('Total:', lastIteration.collectedIssues.length);

      lastIteration.collectedIssues.forEach((issue: any, idx: number) => {
        console.log(`\n[${idx + 1}] ${issue.message}`);
        console.log('    Category:', issue.category);
        console.log('    AutoRepairAvailable:', issue.autoRepairAvailable);
        if (issue.autoRepairProposal) {
          console.log('    Proposal Type:', issue.autoRepairProposal.type);
        }
      });

      const folderIssue = lastIteration.collectedIssues.find((i: any) =>
        i.message && i.message.includes('folder_name')
      );

      if (folderIssue) {
        console.log('\n=== FOLDER ISSUE FULL DETAILS ===');
        console.log(JSON.stringify(folderIssue, null, 2));
      }
    }

    if (lastIteration.autoFixesApplied) {
      console.log('\n=== AUTO-FIXES APPLIED ===');
      console.log(JSON.stringify(lastIteration.autoFixesApplied, null, 2));
    }
  }
}

main().catch(console.error);
