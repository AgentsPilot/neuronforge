import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  const { data: agent } = await supabase
    .from('agents')
    .select('pilot_steps')
    .eq('id', '43ffbc8a-406d-4a43-9f3f-4e7554160eda')
    .single();

  for (let i = 0; i < agent.pilot_steps.length; i++) {
    const step = agent.pilot_steps[i];
    const stepStr = JSON.stringify(step);
    const matches = stepStr.match(/\{\{config\.\w+\}\}/g);
    if (matches) {
      console.log(`Step ${i} (${step.step_id}): plugin=${step.plugin}, action=${step.action || step.operation}`);
      console.log(`  Config refs: ${matches.join(', ')}`);
      if (step.loop_steps) {
        for (let j = 0; j < step.loop_steps.length; j++) {
          const loopStep = step.loop_steps[j];
          const loopStr = JSON.stringify(loopStep);
          const loopMatches = loopStr.match(/\{\{config\.\w+\}\}/g);
          if (loopMatches) {
            console.log(`  Loop step ${j} (${loopStep.step_id}): plugin=${loopStep.plugin}, action=${loopStep.action || loopStep.operation}`);
            console.log(`    Config refs: ${loopMatches.join(', ')}`);
          }
        }
      }
    }
  }
}

main().catch(console.error);
