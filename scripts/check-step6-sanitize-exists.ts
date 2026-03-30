import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import * as path from 'path';

config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  const { data } = await supabase
    .from('agents')
    .select('pilot_steps')
    .eq('id', '43ffbc8a-406d-4a43-9f3f-4e7554160eda')
    .single();

  const scatterStep = data.pilot_steps.find((s: any) => s.id === 'step4' || s.step_id === 'step4');
  const stepIds = scatterStep.scatter.steps.map((s: any) => s.id || s.step_id);

  console.log('Scatter step IDs:', stepIds);
  console.log('Has step6_sanitize:', stepIds.includes('step6_sanitize'));

  const step6SanitizeStep = scatterStep.scatter.steps.find((s: any) =>
    (s.id === 'step6_sanitize' || s.step_id === 'step6_sanitize')
  );

  if (step6SanitizeStep) {
    console.log('\nstep6_sanitize found:');
    console.log(JSON.stringify(step6SanitizeStep, null, 2));
  } else {
    console.log('\nstep6_sanitize NOT FOUND in database!');
  }
}

main().catch(console.error);
