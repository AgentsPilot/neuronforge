// Find invoice extraction agent and its recent executions
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import * as path from 'path';

config({ path: path.join(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function findInvoiceAgent() {
  // Find agents with "invoice" in the name
  const { data: agents, error: agentError } = await supabase
    .from('agents')
    .select('id, agent_name, created_at')
    .ilike('agent_name', '%invoice%')
    .order('created_at', { ascending: false })
    .limit(5);

  if (agentError) {
    console.error('Error fetching agents:', agentError);
    return;
  }

  console.log('\n=== INVOICE AGENTS ===');
  if (agents && agents.length > 0) {
    for (const agent of agents) {
      console.log(`\n${agent.agent_name}`);
      console.log(`  ID: ${agent.id}`);
      console.log(`  Created: ${agent.created_at}`);

      // Get recent executions for this agent
      const { data: executions } = await supabase
        .from('workflow_executions')
        .select('id, status, started_at, ended_at, error_message')
        .eq('agent_id', agent.id)
        .order('started_at', { ascending: false })
        .limit(3);

      if (executions && executions.length > 0) {
        console.log(`  Recent executions:`);
        for (const exec of executions) {
          console.log(`    - ${exec.id} (${exec.status}) - ${exec.started_at}`);
          if (exec.error_message) {
            console.log(`      Error: ${exec.error_message.slice(0, 100)}`);
          }
        }
      } else {
        console.log(`  No executions found`);
      }

      // Check calibration runs
      const { data: calibRuns } = await supabase
        .from('calibration_runs')
        .select('id, status, created_at, test_cases_passed, test_cases_failed')
        .eq('agent_id', agent.id)
        .order('created_at', { ascending: false })
        .limit(3);

      if (calibRuns && calibRuns.length > 0) {
        console.log(`  Recent calibration runs:`);
        for (const run of calibRuns) {
          console.log(`    - ${run.id} (${run.status}) - ${run.created_at}`);
          console.log(`      Passed: ${run.test_cases_passed}, Failed: ${run.test_cases_failed}`);
        }
      }
    }
  } else {
    console.log('No invoice agents found');
  }
}

findInvoiceAgent().catch(console.error);
