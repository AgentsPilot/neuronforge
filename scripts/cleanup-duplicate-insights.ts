/**
 * Collapse duplicate open insights
 *
 * The detector cron re-inserted a fresh row every 15 minutes for any detection
 * that stayed open, because `isOnCooldown` reads `last_surfaced_at` and nothing
 * ever surfaced an insight to set it. One detection became hundreds of rows.
 *
 * This keeps the newest open row per (user_id, detector_id) and deletes the rest.
 * Only `new` and `viewed` rows are touched — acted, dismissed and snoozed rows
 * are the record of what the user did, and are left exactly as they are.
 *
 * Dry run by default:
 *   npx tsx -r dotenv/config scripts/cleanup-duplicate-insights.ts dotenv_config_path=.env.local
 *   npx tsx -r dotenv/config scripts/cleanup-duplicate-insights.ts dotenv_config_path=.env.local --apply
 */

import { supabaseServer } from '../lib/supabaseServer';
import { createLogger } from '../lib/logger';

const logger = createLogger({ module: 'CleanupDuplicateInsights' });

const APPLY = process.argv.includes('--apply');
const OPEN_STATUSES = ['new', 'viewed'];
const PAGE_SIZE = 1000;
const DELETE_CHUNK = 200;

type Row = {
  id: string;
  user_id: string;
  detector_id: string;
  status: string;
  detected_at: string | null;
  created_at: string;
};

async function fetchAllOpenInsights(): Promise<Row[]> {
  const rows: Row[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabaseServer
      .from('insights')
      .select('id, user_id, detector_id, status, detected_at, created_at')
      .in('status', OPEN_STATUSES)
      .order('created_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;

    rows.push(...(data as Row[]));
    if (data.length < PAGE_SIZE) break;
  }

  return rows;
}

async function main() {
  const rows = await fetchAllOpenInsights();
  logger.info({ openInsights: rows.length, apply: APPLY }, 'Loaded open insights');

  // Newest first from the query, so the first row of each group is the keeper.
  const keep = new Map<string, Row>();
  const remove: Row[] = [];
  const perUser: Record<string, { kept: number; removed: number }> = {};

  for (const row of rows) {
    const key = `${row.user_id}::${row.detector_id}`;
    perUser[row.user_id] ||= { kept: 0, removed: 0 };

    if (!keep.has(key)) {
      keep.set(key, row);
      perUser[row.user_id].kept++;
    } else {
      remove.push(row);
      perUser[row.user_id].removed++;
    }
  }

  console.table(
    Object.entries(perUser)
      .map(([userId, counts]) => ({ user: userId.slice(0, 8), keeping: counts.kept, deleting: counts.removed }))
      .sort((a, b) => b.deleting - a.deleting)
      .slice(0, 20)
  );
  logger.info({ keeping: keep.size, deleting: remove.length }, 'Cleanup plan');

  if (!APPLY) {
    logger.info('Dry run — nothing deleted. Re-run with --apply to carry this out.');
    return;
  }

  let deleted = 0;
  for (let i = 0; i < remove.length; i += DELETE_CHUNK) {
    const ids = remove.slice(i, i + DELETE_CHUNK).map(r => r.id);
    const { error } = await supabaseServer.from('insights').delete().in('id', ids);

    if (error) {
      logger.error({ err: error, chunkStart: i }, 'Failed to delete a chunk; stopping');
      break;
    }
    deleted += ids.length;
  }

  logger.info({ deleted, of: remove.length }, 'Cleanup complete');
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    logger.error({ err }, 'Cleanup failed');
    process.exit(1);
  });
