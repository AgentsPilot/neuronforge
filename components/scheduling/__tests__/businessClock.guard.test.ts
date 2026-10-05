/**
 * The booking dialog counts every hour on the BUSINESS's clock.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Wherever the owner is sitting. An owner in Israel with the business set to New
 * York typed a 10:00 start for an hour-long service and the dialog filled the
 * end in as 04:00: `handleStartTimeChange` read the typed wall clock with
 * `new Date(...)` — which has no offset to go on, so it uses the MACHINE's zone
 * — and then wrote the end back on the business's. Seven hours out, before the
 * start, and the validator then refused the booking outright.
 *
 * Source-level, because the two clocks agree whenever the machine happens to sit
 * in the business's zone: under `TZ=UTC` against a UTC business, which is how CI
 * and Vercel run, the broken version is indistinguishable from the fixed one. A
 * render test in this repo's own jsdom cannot see it either. What CAN be checked
 * anywhere is that the file no longer contains the construct.
 *
 * The arithmetic itself is pinned in `lib/scheduling/__tests__/crossZone.guard.test.ts`,
 * which asserts absolute expected values and so holds on any machine.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const SOURCE = readFileSync(join(__dirname, '..', 'SchedulingBookingModal.tsx'), 'utf8');

/**
 * The file with its prose removed.
 *
 * These assertions are about what the dialog DOES, and the comments beside the
 * fix quote the construct it replaced — `new Date(newStartTime)` is written out
 * in full there, on purpose, so the next reader knows what not to go back to.
 * Matching raw source made the guard fail on its own explanation, which would
 * teach whoever hit it to delete the comment.
 */
const MODAL = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('a typed wall clock is never read on the machine', () => {
  it('does not parse the start with a bare Date constructor', () => {
    expect(MODAL).not.toContain('new Date(newStartTime)');
    // Any `new Date(` on a form field would be the same defect wearing another
    // name. `formData.*` holds business wall clocks, never instants.
    expect(MODAL).not.toMatch(/new Date\(\s*formData\./);
  });

  it('routes both handlers through the shared resolver', () => {
    expect(MODAL).toContain('endOfBusinessLocal(newStartTime, serviceDuration, zone)');
    expect(MODAL).toMatch(/endOfBusinessLocal\(formData\.start_time, service\.duration_minutes \|\| 60, zone\)/);
  });
});

describe('the zone the booking is stamped with', () => {
  it('is the business zone, not the browser', () => {
    expect(MODAL).toContain('...(zoneReady ? { timezone: zone } : {})');
    expect(MODAL).not.toContain('timezone: formData.timezone');
  });

  /*
   * `scheduling_bookings.timezone` is the fallback clock for every
   * client-facing email, so a browser-stamped row mails the wrong hour to a
   * client the moment an account has no `user_preferences` row. The seed also
   * raced a `/api/user/profile` fetch, which reads the OTHER of the platform's
   * two timezone columns.
   */
  it('no longer seeds the form from the browser at all', () => {
    expect(MODAL).not.toContain('timezone: browserTimezone');
    expect(MODAL).not.toContain('/api/user/profile');
  });

  it('keeps the browser zone for display only', () => {
    // Named so its purpose cannot be mistaken, and resolved in an effect
    // because Intl answers differently on the server and in the browser.
    expect(MODAL).toContain('const [viewerZone, setViewerZone]');
    expect(MODAL).toMatch(/setViewerZone\(safeTimezone\(Intl\.DateTimeFormat\(\)\.resolvedOptions\(\)\.timeZone\)\)/);
    // The echo is formatted on the viewer's clock from an instant resolved on
    // the business's — never parsed on the viewer's.
    expect(MODAL).toContain('const instant = fromBusinessLocalInput(local, zone);');
  });
});
