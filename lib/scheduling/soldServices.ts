/**
 * Which services have already been sold, and so may not change currency.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The database refuses the change (`service_currency_lock`, 20261008) because
 * changing a currency RELABELS rather than converts: 300 USD becoming 300 ILS
 * is a price cut of about 73% that nobody typed.
 *
 * But a rule the UI cannot see is a rule the owner meets as an error. The
 * picker offered all four currencies on a service with three bookings against
 * it, took the click, and only then failed — so this tells the screen what the
 * database already knows.
 *
 * FOUR QUERIES FOR THE WHOLE LIST, not four per service. A per-row count is an
 * N+1 that grows with the catalogue, and the answer is the same shape either
 * way: the set of service ids that money points at.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'SoldServices' });

/** Everything that counts as "this has been sold". Mirrors the trigger exactly. */
const MONEY_TABLES = [
  'payment_invoices',
  'payment_transactions',
  'scheduling_bookings',
  'proposals',
] as const;

export async function soldServiceIds(
  supabase: SupabaseClient,
  userId: string
): Promise<Set<string>> {
  const sold = new Set<string>();

  try {
    const results = await Promise.all(
      MONEY_TABLES.map(table =>
        supabase.from(table).select('service_id').eq('user_id', userId).not('service_id', 'is', null)
      )
    );

    for (const { data, error } of results) {
      /*
       * A table that cannot be read leaves the lock OFF for those services,
       * and that is the right way to fail: the database still refuses the
       * write, so the worst case is the old behaviour — an error on save —
       * rather than a picker frozen for a service nobody has sold.
       */
      if (error) {
        logger.warn({ err: error, userId }, 'Could not read sold services; some pickers stay open');
        continue;
      }

      for (const row of data ?? []) {
        if (row.service_id) sold.add(row.service_id as string);
      }
    }
  } catch (err) {
    logger.warn({ err, userId }, 'Could not resolve sold services');
  }

  return sold;
}
