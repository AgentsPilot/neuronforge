/**
 * The address-book read, in one place (settings drawer review §0.6 C-3).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT IS ITS OWN MODULE
 *
 * Two places start this request: `SavedAddressPicker` (every caller, as it
 * always has) and the Marketing permission panel, which starts it at the same
 * moment as its consent read so the list is not a second wait after the form.
 * Two hand copies of the URL, the cache option and the parse is how one of them
 * drifts. This is the only copy.
 *
 * IT NEVER REJECTS. A failed read is an answer (`ok: false`), not an exception.
 * The panel may start it speculatively, before anyone opens the drawer, and a
 * promise nobody awaits must never become an unhandled rejection.
 *
 * It logs nothing, as the picker never has: the book is a convenience beside a
 * text field that is the whole form without it.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { KnownAddress } from '@/components/ui/SavedAddressPicker';

export type AddressBookRead =
  | { ok: true; locale: string; addresses: KnownAddress[] }
  /** `status` is `null` when no response came back (network error, unreadable body). */
  | { ok: false; status: number | null };

export async function readAddressBook(locale: string): Promise<AddressBookRead> {
  try {
    // `no-store`: the book changes from other screens (profile, invoices), and a
    // cached list would offer an address that has since been deleted.
    const response = await fetch(`/api/business-os/addresses?locale=${encodeURIComponent(locale)}`, {
      cache: 'no-store',
    });
    if (!response.ok) return { ok: false, status: response.status };

    const result = await response.json();
    if (!result?.success) return { ok: false, status: response.status };

    const addresses: KnownAddress[] = Array.isArray(result.data?.addresses) ? result.data.addresses : [];
    return { ok: true, locale, addresses };
  } catch {
    return { ok: false, status: null };
  }
}
