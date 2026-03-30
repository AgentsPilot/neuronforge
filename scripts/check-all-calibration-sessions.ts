import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import * as path from 'path';

config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  // Get ALL recent calibration sessions
  const { data: sessions } = await supabase
    .from('calibration_sessions')
    .select('id, agent_id, status, started_at, iterations')
    .order('started_at', { ascending: false })
    .limit(10);

  console.log(`Found ${sessions?.length || 0} total calibration sessions`);

  if (!sessions || sessions.length === 0) {
    console.log('No calibration sessions found in database');
    return;
  }

  for (const session of sessions) {
    console.log(`\n[${session.started_at}] ${session.id}`);
    console.log(`  Agent: ${session.agent_id}`);
    console.log(`  Status: ${session.status}`);

    const iterations = session.iterations as any[];
    console.log(`  Iterations: ${iterations?.length || 0}`);

    if (iterations && iterations.length > 0) {
      const lastIteration = iterations[iterations.length - 1];
      if (lastIteration.collectedIssues) {
        console.log(`  Issues: ${lastIteration.collectedIssues.length}`);
        const hasVendorIssue = lastIteration.collectedIssues.some((i: any) =>
          i.message && i.message.includes('folder_name is required')
        );
        if (hasVendorIssue) {
          console.log('  ⚠️  HAS FOLDER_NAME ERROR');
        }
      }
    }
  }

  // Find sessions with folder_name error
  const sessionsWithVendorError = sessions.filter(session => {
    const iterations = session.iterations as any[];
    if (!iterations || iterations.length === 0) return false;

    const lastIteration = iterations[iterations.length - 1];
    return lastIteration.collectedIssues?.some((i: any) =>
      i.message && i.message.includes('folder_name is required')
    );
  });

  if (sessionsWithVendorError.length > 0) {
    console.log(`\n\n=== SESSIONS WITH FOLDER_NAME ERROR: ${sessionsWithVendorError.length} ===`);
    const session = sessionsWithVendorError[0];
    const iterations = session.iterations as any[];
    const lastIteration = iterations[iterations.length - 1];

    console.log('\nSession ID:', session.id);
    console.log('Agent ID:', session.agent_id);

    const folderNameIssue = lastIteration.collectedIssues.find((i: any) =>
      i.message && i.message.includes('folder_name is required')
    );

    console.log('\n=== FOLDER_NAME ISSUE ===');
    console.log('Message:', folderNameIssue.message);
    console.log('AutoRepairAvailable:', folderNameIssue.autoRepairAvailable);
    console.log('Has Proposal:', !!folderNameIssue.autoRepairProposal);
    if (folderNameIssue.autoRepairProposal) {
      console.log('\nProposal:', JSON.stringify(folderNameIssue.autoRepairProposal, null, 2));
    }
    console.log('\nAffectedSteps:', JSON.stringify(folderNameIssue.affectedSteps, null, 2));
  }
}

main().catch(console.error);
