/**
 * The currency this business actually trades in.
 *
 * There is no `business_profiles.currency` column, so anything reading
 * `profile.currency` gets `undefined` and falls back to USD. The chat did
 * exactly that, and answered an Israeli business "אופיר חייב לך 2,050.00 $ ש\"ח"
 * — a dollar sign and a shekel label on the same number.
 *
 * Individual rows carry their own currency and render correctly; it is the
 * figures with no row behind them — a sum, an average — that need this.
 *
 * Derived from what the business charges rather than stored, because that is
 * the only record of it: a priced service first, then the most recent invoice.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'UserCurrency' });

export const DEFAULT_CURRENCY = 'USD';

export async function resolveUserCurrency(
  supabase: SupabaseClient,
  userId: string
): Promise<string> {
  try {
    // A service price is the business's own list price, so it is the better
    // signal — an invoice may have been raised in a client's currency.
    const { data: service } = await supabase
      .from('scheduling_services')
      .select('currency')
      .eq('user_id', userId)
      .not('currency', 'is', null)
      .limit(1)
      .maybeSingle();

    if (service?.currency) return service.currency as string;

    const { data: invoice } = await supabase
      .from('payment_invoices')
      .select('currency')
      .eq('user_id', userId)
      .not('currency', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    return (invoice?.currency as string) || DEFAULT_CURRENCY;
  } catch (error) {
    // Never fatal: a wrong symbol is bad, no answer at all is worse.
    logger.warn({ userId, err: error }, 'Failed to resolve business currency, assuming USD');
    return DEFAULT_CURRENCY;
  }
}
