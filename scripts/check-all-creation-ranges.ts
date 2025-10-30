import { createClient } from '@supabase/supabase-js';
import { AISConfigService } from '@/lib/services/AISConfigService';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkAllRanges() {
  const ranges = await AISConfigService.getRanges(supabase);

  console.log('\n🔍 Creation Score Range Analysis\n');
  console.log('=' .repeat(80));

  // Check Workflow Steps
  console.log('\n📊 WORKFLOW STEPS');
  console.log(`Range: min=${ranges.creation_workflow_steps.min}, max=${ranges.creation_workflow_steps.max}`);
  console.log('Scores:');
  for (let i = 0; i <= 12; i++) {
    const score = AISConfigService.normalize(i, ranges.creation_workflow_steps);
    if (i <= 6 || i === 10 || i === 12) {
      console.log(`  ${i} steps: ${score.toFixed(2)}/10`);
    }
  }
  if (ranges.creation_workflow_steps.min === 1) {
    console.log('⚠️  Issue: 0 and 1 step both score 0.0');
  }

  // Check Plugin Count
  console.log('\n📊 PLUGIN DIVERSITY');
  console.log(`Range: min=${ranges.creation_plugins.min}, max=${ranges.creation_plugins.max}`);
  console.log('Scores:');
  for (let i = 0; i <= 6; i++) {
    const score = AISConfigService.normalize(i, ranges.creation_plugins);
    console.log(`  ${i} plugin${i !== 1 ? 's' : ' '}: ${score.toFixed(2)}/10`);
  }
  if (ranges.creation_plugins.min === 1) {
    console.log('⚠️  Issue: 0 and 1 plugin both score 0.0 - agents with 1 plugin get no credit!');
  }

  // Check I/O Fields
  console.log('\n📊 INPUT/OUTPUT SCHEMA');
  console.log(`Range: min=${ranges.creation_io_fields.min}, max=${ranges.creation_io_fields.max}`);
  console.log('Scores:');
  for (let i = 0; i <= 10; i++) {
    const score = AISConfigService.normalize(i, ranges.creation_io_fields);
    if (i <= 8 || i === 10) {
      console.log(`  ${i} field${i !== 1 ? 's' : ' '}: ${score.toFixed(2)}/10`);
    }
  }
  if (ranges.creation_io_fields.min === 1) {
    console.log('⚠️  Issue: 0 and 1 field both score 0.0');
  }

  console.log('\n' + '='.repeat(80));
  console.log('\n💡 RECOMMENDED FIXES:\n');
  console.log('1. Update creation_plugins: Change min from 1 to 0');
  console.log('   UPDATE ais_normalization_ranges');
  console.log("   SET min_value = 0, best_practice_min = 0");
  console.log("   WHERE range_key = 'creation_plugins';\n");

  console.log('2. Consider updating creation_workflow_steps: Change min from 1 to 0');
  console.log('   (Though most agents will have at least 1 step)\n');

  console.log('3. Consider updating creation_io_fields: Change min from 1 to 0');
  console.log('   (Though most agents will have at least 1 field)\n');

  console.log('After the fix, the scoring will be:');
  console.log('  Plugins: 0→0.0, 1→2.0, 2→4.0, 3→6.0, 4→8.0, 5→10.0');
  console.log('  This gives proper credit to agents using 1 plugin!\n');
}

checkAllRanges();
