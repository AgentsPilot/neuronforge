/**
 * Who this visitor is, as far as a website can honestly know.
 *
 * Browser-only. An id minted here is a convenience for counting, not an
 * identity: it says "these page views probably came from the same person on the
 * same device", which is exactly what a unique-visitor figure claims and no
 * more.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * `website_page_views.session_id` was null on every row ever recorded, so the
 * only way to count visitors was to count ROWS — which counts one person
 * reading four pages as four visitors — or to fall back on `ip_hash`, which is
 * hashed with the date and so cannot tell a returning visitor from a new one
 * the next morning.
 *
 * It also broke conversion tracking outright.
 * `SmartLinkRepository.markConversion()` matches a booking back to the click
 * that produced it ON `session_id`. The smart-link redirect mints one and
 * appends it to the destination as `_sid`; nothing at the destination ever read
 * it, so no conversion has ever been attributed to a link.
 *
 * THE ORDER OF PREFERENCE MATTERS
 *
 *   1. `_sid` from the URL. The visitor arrived through a smart link and the
 *      redirect already gave them an id. Using it is what joins the click to
 *      the view and, later, to the booking.
 *   2. A stored id from a previous visit, so somebody returning is the same
 *      visitor rather than a new one.
 *   3. A fresh id.
 *
 * Getting 1 and 2 the wrong way round would mint a second identity for exactly
 * the people the attribution is about.
 * ---------------------------------------------------------------------------
 */

const STORAGE_KEY = 'ap_vid';

/** How long a stored visitor id stays the same person. */
const TTL_DAYS = 30;

interface StoredSession {
  id: string;
  at: number;
}

/**
 * The id to record this page view against.
 *
 * Never throws. Storage can be unavailable — private windows, blocked cookies,
 * embedded browsers — and analytics must not be the thing that breaks a page
 * somebody came to read. When storage refuses, a per-view id is still returned;
 * it counts that view without claiming continuity it cannot prove.
 */
export function resolveVisitorSessionId(): string {
  if (typeof window === 'undefined') return newId();

  // 1. Arrived through a smart link: keep the id the redirect already issued,
  //    and persist it so the rest of the visit shares it.
  const fromLink = new URLSearchParams(window.location.search).get('_sid');
  if (fromLink) {
    store(fromLink);
    return fromLink;
  }

  // 2. A previous visit from this browser.
  const existing = read();
  if (existing) {
    // Touched on every view, so an active visitor does not expire mid-session.
    store(existing);
    return existing;
  }

  // 3. Somebody new.
  const minted = newId();
  store(minted);
  return minted;
}

function read(): string | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as StoredSession;
    if (!parsed?.id || typeof parsed.at !== 'number') return null;

    const age = Date.now() - parsed.at;
    if (age > TTL_DAYS * 86_400_000) return null;

    return parsed.id;
  } catch {
    // Unreadable, blocked, or written by an older version. Treated as absent.
    return null;
  }
}

function store(id: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ id, at: Date.now() } satisfies StoredSession));
  } catch {
    // Private windows and blocked storage both land here. The id still travels
    // with this page view; only continuity across views is lost.
  }
}

function newId(): string {
  // `randomUUID` is absent on http origins in some browsers, which a local
  // preview is, so the fallback is not theoretical.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
