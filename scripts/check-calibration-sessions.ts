import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import * as path from 'path';

config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  const agentId = '43ffbc8a-406d-4a43-9f3f-4e7554160eda';

  // Get recent calibration sessions
  const { data: sessions } = await supabase
    .from('calibration_sessions')
    .select('*')
    .eq('agent_id', agentId)
    .order('started_at', { ascending: false })
    .limit(5);

  console.log(`Found ${sessions?.length || 0} calibration sessions`);

  if (!sessions || sessions.length === 0) {
    console.log('No calibration sessions found');
    return;
  }

  for (const session of sessions) {
    console.log('\n=== CALIBRATION SESSION ===');
    console.log('Session ID:', session.id);
    console.log('Status:', session.status);
    console.log('Started:', session.started_at);
    console.log('Completed:', session.completed_at);

    const iterations = session.iterations as any[];
    console.log('Iterations:', iterations?.length || 0);

    if (iterations && iterations.length > 0) {
      const lastIteration = iterations[iterations.length - 1];
      console.log('\n=== LAST ITERATION ===');
      console.log('Iteration #:', lastIteration.iterationNumber);
      console.log('Execution ID:', lastIteration.executionId);
      console.log('Status:', lastIteration.status);

      if (lastIteration.collectedIssues && lastIteration.collectedIssues.length > 0) {
        console.log('\n=== COLLECTED ISSUES ===');
        lastIteration.collectedIssues.forEach((issue: any, idx: number) => {
          console.log(`\n[${idx + 1}] ${issue.message}`);
          console.log('    Category:', issue.category);
          console.log('    AutoRepairAvailable:', issue.autoRepairAvailable);
          console.log('    Has Proposal:', !!issue.autoRepairProposal);
          if (issue.autoRepairProposal) {
            console.log('    Proposal Type:', issue.autoRepairProposal.type);
          }
        });

        // Find folder_name issue
        const folderNameIssue = lastIteration.collectedIssues.find((issue: any) =>
          issue.message && issue.message.includes('folder_name is required')
        );

        if (folderNameIssue) {
          console.log('\n=== FOLDER_NAME ISSUE DETAILS ===');
          console.log(JSON.stringify(folderNameIssue, null, 2));
        }
      }
    }
  }
}

main().catch(console.error);
