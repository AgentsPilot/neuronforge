import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import * as path from 'path';

// Load environment variables
config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  // Find the expense extraction agent (previously called invoice)
  const { data: agents } = await supabase
    .from('agents')
    .select('id, agent_name')
    .or('agent_name.ilike.%expense%,agent_name.ilike.%invoice%')
    .order('created_at', { ascending: false })
    .limit(5);

  console.log('Found agents:', agents?.map(a => ({ id: a.id, name: a.agent_name })));

  if (!agents || agents.length === 0) {
    console.log('No expense/invoice agents found');
    return;
  }

  const agentId = agents[0].id;
  console.log('\n=== Using agent:', agents[0].agent_name, '===\n');

  // Get the most recent calibration session
  const { data: sessions } = await supabase
    .from('calibration_sessions')
    .select('*')
    .eq('agent_id', agentId)
    .order('started_at', { ascending: false })
    .limit(1);

  if (!sessions || sessions.length === 0) {
    console.log('No calibration sessions found');
    return;
  }

  const session = sessions[0];
  console.log('=== CALIBRATION SESSION ===');
  console.log('ID:', session.id);
  console.log('Status:', session.status);
  console.log('Started:', session.started_at);
  console.log('Completed:', session.completed_at);
  console.log('Iterations:', session.iterations);
  console.log('Auto-fixes applied:', session.auto_fixes_applied);

  // Get all iterations for this session
  const { data: iterations } = await supabase
    .from('calibration_iterations')
    .select('*')
    .eq('session_id', session.id)
    .order('iteration_number', { ascending: true });

  console.log('\n=== ITERATIONS ===');
  console.log(`Total: ${iterations?.length || 0}`);

  if (iterations) {
    for (const iter of iterations) {
      console.log(`\n--- Iteration ${iter.iteration_number} ---`);
      console.log('Status:', iter.status);
      console.log('Issues found:', iter.issues_found);
      console.log('Fixes applied:', iter.fixes_applied);

      // Check execution trace for this iteration
      if (iter.execution_id) {
        const { data: execution } = await supabase
          .from('agent_executions')
          .select('*')
          .eq('id', iter.execution_id)
          .single();

        if (execution) {
          console.log('\nExecution status:', execution.status);

          const trace = execution.trace as any;

          // Look for step outputs
          if (trace?.steps) {
            // Check step6 (document-extractor)
            const step6 = trace.steps.find((s: any) => s.stepId === 'step6');
            if (step6?.output) {
              console.log('\n[Step6 - Document Extractor]');
              const output = step6.output;
              if (Array.isArray(output)) {
                console.log(`Extracted ${output.length} items`);
                if (output.length > 0) {
                  console.log('First item fields:', Object.keys(output[0]));
                  console.log('Sample:', JSON.stringify(output[0], null, 2).substring(0, 300));
                }
              } else if (output?.items) {
                console.log(`Extracted ${output.items.length} items`);
                if (output.items.length > 0) {
                  console.log('First item:', JSON.stringify(output.items[0], null, 2).substring(0, 300));
                }
              } else {
                console.log('Output structure:', JSON.stringify(output, null, 2).substring(0, 300));
              }
            }

            // Check step11 (filter)
            const step11 = trace.steps.find((s: any) => s.stepId === 'step11');
            if (step11) {
              console.log('\n[Step11 - Filter]');
              console.log('Status:', step11.status);
              if (step11.output) {
                const output = step11.output;
                if (Array.isArray(output)) {
                  console.log(`Filtered to ${output.length} items`);
                } else if (output?.items) {
                  console.log(`Filtered to ${output.items.length} items`);
                } else {
                  console.log('Output:', JSON.stringify(output, null, 2).substring(0, 200));
                }
              }
              if (step11.error) {
                console.log('ERROR:', step11.error);
              }
            }

            // Check final steps
            const step15 = trace.steps.find((s: any) => s.stepId === 'step15');
            if (step15) {
              console.log('\n[Step15 - Append to Sheets]');
              console.log('Status:', step15.status);
              if (step15.error) {
                console.log('ERROR:', step15.error);
              }
            }

            const step16 = trace.steps.find((s: any) => s.stepId === 'step16');
            if (step16) {
              console.log('\n[Step16 - Send Email]');
              console.log('Status:', step16.status);
              if (step16.error) {
                console.log('ERROR:', step16.error);
              }
            }
          }

          // Check for issues
          if (trace?.collectedIssues && trace.collectedIssues.length > 0) {
            console.log('\n[Issues Collected]');
            for (const issue of trace.collectedIssues.slice(0, 3)) {
              console.log(`- ${issue.message}`);
            }
          }
        }
      }

      // Show fixes applied in this iteration
      if (iter.fixes_applied > 0 && iter.applied_fixes) {
        console.log('\n[Fixes Applied]');
        const fixes = iter.applied_fixes as any;
        if (Array.isArray(fixes)) {
          for (const fix of fixes.slice(0, 3)) {
            console.log(`- ${fix.type}: ${fix.description || fix.reasoning || 'N/A'}`);
          }
        }
      }
    }
  }

  // Check final result
  console.log('\n=== FINAL SESSION RESULT ===');
  if (session.final_result) {
    const result = session.final_result as any;
    console.log('Success:', result.success);
    console.log('Message:', result.message);
    if (result.issues) {
      console.log('Critical issues:', result.issues.critical?.length || 0);
      console.log('Warnings:', result.issues.warnings?.length || 0);
    }
    if (result.summary) {
      console.log('Completed steps:', result.summary.completedSteps);
      console.log('Failed steps:', result.summary.failedSteps);
    }
  }
}

main().catch(console.error);
