/**
 * What is actually stored in `scheduling_availability`, and who agrees about it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Reported: the working hours dialog shows nothing, while the publish gate let
 * a scheduled service through and a direct read of the column found content.
 * Both can be true at once if the SHAPE of what is stored is not the shape the
 * editor reads.
 *
 *   the editor   `parseAvailability` keeps a day only when it is an ARRAY,
 *                keyed `sunday` … `saturday`. Anything else becomes [].
 *   the gate     `hasAnyAvailability` asks `windowsForDay`, which accepts more
 *                than one shape, so it can see hours the editor cannot.
 *
 * This prints the raw value and then asks both questions of it, so the answer
 * is not an inference. READ ONLY: it writes nothing.
 *
 *   npx tsx scripts/inspect-availability.ts --company="David KPMG"
 * ─────────────────────────────────────────────────────────────────────────────
 */

import path from 'path';

import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '../.env.local') });

const load = async () => ({
  supabase: (await import('../lib/supabaseServer')).supabaseServer,
  windows: await import('../lib/scheduling/availabilityWindows'),
  editor: await import('../components/scheduling/AvailabilityEditor'),
});

const arg = (name: string) => {
  const hit = process.argv.find(value => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

async function main() {
  const { supabase, windows } = await load();
  const company = arg('company');

  if (!company) {
    console.error('Pass --company="Business Name".');
    process.exit(1);
  }

  const { data: profiles, error: profileError } = await supabase
    .from('business_profiles')
    .select('user_id, company_name, scheduling_availability')
    .eq('company_name', company);

  if (profileError) throw profileError;
  if (!profiles?.length) {
    console.error(`No business called ${JSON.stringify(company)}.`);
    process.exit(1);
  }
  if (profiles.length > 1) {
    console.error(`${profiles.length} businesses share that name.`);
    process.exit(1);
  }

  const profile = profiles[0];
  const raw = profile.scheduling_availability;

  console.log(`\naccount: ${company}  (${profile.user_id})`);
  console.log(`\n--- the column, exactly as stored ---`);
  console.log(`type: ${raw === null ? 'null' : Array.isArray(raw) ? 'array' : typeof raw}`);
  console.log(JSON.stringify(raw, null, 2));

  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const keys = Object.keys(raw as Record<string, unknown>);
    console.log(`\n--- keys ---`);
    console.log(`  ${keys.join(', ')}`);

    const unexpected = keys.filter(key => !DAYS.includes(key));
    const missing = DAYS.filter(key => !keys.includes(key));
    if (unexpected.length) console.log(`  NOT day names: ${unexpected.join(', ')}`);
    if (missing.length) console.log(`  day names absent: ${missing.join(', ')}`);

    console.log(`\n--- per day: what each reader sees ---`);
    for (const day of DAYS) {
      const value = (raw as Record<string, unknown>)[day];
      const isArray = Array.isArray(value);
      /* The editor keeps a day ONLY when it is an array. */
      const editorSees = isArray ? (value as unknown[]).length : 'nothing (not an array)';
      /* The gate asks this, which accepts more shapes. */
      const gateSees = windows.windowsForDay(raw, day as never).length;

      const disagrees = (isArray ? (value as unknown[]).length : 0) !== gateSees;
      console.log(
        `  ${day.padEnd(10)} stored: ${JSON.stringify(value)}` +
          `\n             editor: ${editorSees}   gate: ${gateSees} window(s)` +
          (disagrees ? '   <-- THEY DISAGREE' : '')
      );
    }
  }

  console.log(`\n--- the two verdicts ---`);
  console.log(`  gate   (hasAnyAvailability): ${windows.hasAnyAvailability(raw) ? 'HAS HOURS' : 'no hours'}`);

  const parsed = DAYS.reduce((acc, day) => {
    const value = raw && typeof raw === 'object' ? (raw as Record<string, unknown>)[day] : undefined;
    acc[day] = Array.isArray(value) ? (value as unknown[]).length : 0;
    return acc;
  }, {} as Record<string, number>);
  const editorTotal = Object.values(parsed).reduce((a, b) => a + b, 0);
  console.log(`  editor (parseAvailability):  ${editorTotal > 0 ? `${editorTotal} window(s)` : 'SHOWS EMPTY'}`);

  if (windows.hasAnyAvailability(raw) && editorTotal === 0) {
    console.log(
      `\n  The two disagree, which is the reported bug: the business HAS hours by\n` +
        `  every check that decides whether a client can book, and the editor shows\n` +
        `  none because the stored shape is not the one it reads.`
    );
  }
}

main().catch(error => {
  console.error('\nFAILED:', error?.message || error);
  process.exit(1);
});
