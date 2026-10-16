/**
 * The two reads the Marketing permission drawer opens with (settings drawer
 * review §0.6 C-3 / C-5; C-a workplan A-1; SA-CA-1, SA-CA-6).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE COPY OF EACH REQUEST
 *
 * The panel reads consent and the address book when it opens. The settings
 * page may start the same two reads earlier (idle, hover, focus, press) through
 * `useDrawerPrefetch`, and the panel then takes them instead of asking again.
 * Both go through here, so the early read and the panel's own read are the same
 * request and cannot drift. The page imports `startMarketingDrawerReads` only,
 * so it never names a route (`accountCard.guard`).
 *
 * NEITHER READ EVER REJECTS. A failure is an answer that says how it failed:
 * `refused` with the status, or `threw` with the error (a network error, or a
 * body that is not JSON). The panel logs it exactly as it always has (D-12):
 * `warn({ status })` or `error({ err })`. Nothing here logs, and nothing here
 * ever sees a value worth logging: the payload is legal and personal text.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readAddressBook, type AddressBookRead } from '@/components/ui/addressBookRead';

export type ConsentRead =
  | { ok: true; status: number; body: unknown }
  | { ok: false; kind: 'refused'; status: number }
  | { ok: false; kind: 'threw'; err: unknown };

/** Both reads, started together, for one language. */
export interface MarketingDrawerReads {
  locale: string;
  consent: Promise<ConsentRead>;
  book: Promise<AddressBookRead>;
}

/**
 * The consent GET, exactly as the panel has always sent it: the URL alone, no
 * `init` (SA-CA-6). The body is returned unjudged; whether it is usable is the
 * panel's call (`success`, the payload shape).
 */
export async function readConsentSettings(locale: string): Promise<ConsentRead> {
  try {
    const response = await fetch(`/api/business-os/consent-settings?locale=${encodeURIComponent(locale)}`);
    if (!response.ok) return { ok: false, kind: 'refused', status: response.status };
    const body: unknown = await response.json();
    return { ok: true, status: response.status, body };
  } catch (err) {
    return { ok: false, kind: 'threw', err };
  }
}

/** Starts both reads now, in parallel, and hands back the two promises. */
export function startMarketingDrawerReads(locale: string): MarketingDrawerReads {
  return {
    locale,
    consent: readConsentSettings(locale),
    book: readAddressBook(locale),
  };
}
