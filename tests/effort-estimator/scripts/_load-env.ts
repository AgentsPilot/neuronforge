/**
 * Bootstrap: load .env.local BEFORE any other module imports.
 *
 * Why this exists: `lib/supabaseServer.ts:15` eagerly constructs the Supabase
 * service-role client at module load time. If env vars aren't already in
 * process.env when that module is first imported, the client construction
 * throws "supabaseUrl is required".
 *
 * MUST be imported as a side-effect (`import './_load-env'`) as the FIRST
 * import in any script that touches `@/lib/supabaseServer`, `@/lib/repositories`,
 * or anything that transitively pulls them. ES modules guarantee side-effect
 * imports run to completion before subsequent imports are processed.
 *
 * DO NOT extract logic from this file into a function call — that would defeat
 * the purpose. The dotenv call MUST happen at module evaluation time.
 *
 * DO NOT copy this pattern into production code paths. It is a script-only
 * convenience to keep the invocation simple (`npx tsx <script>` instead of
 * `npx tsx --import ./scripts/env-preload.ts <script>`).
 */
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

const envPath = path.join(process.cwd(), '.env.local');

if (!fs.existsSync(envPath)) {
  console.error(
    `[effort-estimator script] .env.local not found at ${envPath}. ` +
    `Run this script from the repository root, or create the file.`
  );
  process.exit(1);
}

const result = dotenv.config({ path: envPath });
if (result.error) {
  console.error(`[effort-estimator script] Failed to parse .env.local: ${result.error.message}`);
  process.exit(1);
}
