/**
 * One request for a contact's money, however many components ask for it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The contact drawer and the payments section inside it both need the plan
 * data that `/api/payments/money` assembles, and both fetched it themselves —
 * the same URL, for the same contact, in the same render. Two identical
 * requests went out on every drawer open, each taking upwards of a second
 * against a route that joins invoices, transactions, refunds and plans.
 *
 * Neither was wrong to want the data, and neither should have to know the other
 * exists. Deduplication belongs here, at the fetch, not in an arrangement
 * between two components that would have to be maintained by hand.
 *
 * The PARSED body is what gets shared, not the `Response` — a Response body can
 * only be read once, so handing the same one to two callers would leave the
 * second with an exhausted stream.
 *
 * The window is deliberately short. `cache: 'no-store'` is still passed and
 * still matters: a refund refreshes this a second later and must see the new
 * state. This collapses requests that are genuinely simultaneous, nothing more.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/payments/fetchContactMoney
 */

import { requestDeduplicator } from '@/lib/utils/request-deduplication';
import type { MoneyPlan } from '@/lib/payments/moneyItems';

/**
 * What the money endpoint returns for one contact.
 *
 * `plan` is the real `MoneyPlan` rather than a loose shape: both readers want
 * it — the drawer takes three properties, the payments section stores it whole
 * — and a second, weaker declaration here would be the thing they drift apart
 * through. Everything else on an item stays open; this module only exists to
 * make the request once.
 */
export interface ContactMoneyItem {
  bookingId?: string | null;
  plan?: MoneyPlan | null;
  [key: string]: unknown;
}

export interface ContactMoneyResponse {
  success: boolean;
  data?: {
    items?: ContactMoneyItem[];
    [key: string]: unknown;
  };
}

/**
 * Long enough to collapse two components mounting together, short enough that
 * a deliberate refresh after a refund is never served a stale answer.
 */
const WINDOW_MS = 1500;

export async function fetchContactMoney(contactId: string): Promise<ContactMoneyResponse> {
  return requestDeduplicator.deduplicate(
    `money:${contactId}`,
    async () => {
      const response = await fetch(`/api/payments/money?contact_id=${contactId}&limit=100`, {
        cache: 'no-store',
      });
      return (await response.json()) as ContactMoneyResponse;
    },
    WINDOW_MS
  );
}
