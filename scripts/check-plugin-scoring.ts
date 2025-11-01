import { createClient } from '@supabase/supabase-js';
import { AISConfigService } from '@/lib/services/AISConfigService';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkPluginScoring() {
  const ranges = await AISConfigService.getRanges(supabase);

  console.log('\n🔍 Plugin Diversity Scoring Analysis\n');
  console.log('Current Range:', ranges.creation_plugins);
  console.log('  Min:', ranges.creation_plugins.min);
  console.log('  Max:', ranges.creation_plugins.max);

  console.log('\n📊 Scores for different plugin counts:\n');
  for (let i = 0; i <= 6; i++) {
    const score = AISConfigService.normalize(i, ranges.creation_plugins);
    console.log(`  ${i} plugin${i !== 1 ? 's' : ' '}: ${score.toFixed(2)}/10`);
  }

  console.log('\n⚠️  PROBLEM IDENTIFIED:');
  console.log('  With range min=1 and max=5:');
  console.log('  - 0 plugins → clamps to min (1) → normalized to 0.0');
  console.log('  - 1 plugin → normalized to 0.0 (at minimum)');
  console.log('  - 5 plugins → normalized to 10.0 (at maximum)');
  console.log('\n  This means agents with 1 plugin get NO credit!');

  console.log('\n💡 SOLUTION:');
  console.log('  Change the range to min=0, max=5');
  console.log('  Then:');
  console.log('  - 0 plugins → 0.0/10 (no plugins)');
  console.log('  - 1 plugin → 2.0/10 (basic)');
  console.log('  - 2 plugins → 4.0/10');
  console.log('  - 3 plugins → 6.0/10');
  console.log('  - 5 plugins → 10.0/10 (maximum)');
}

checkPluginScoring();
