/**
 * Turning a business's wall clock into an instant, and back.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A booking slot is produced as a naive local time — the availability API builds
 * it as `${date}T${slot}:00`, because a working day is measured in the hours the
 * practitioner keeps, not in UTC. `scheduling_bookings.start_time` is a
 * `timestamptz`, which is an INSTANT.
 *
 * Nothing converted between the two. Postgres reads a string with no offset as
 * UTC, so a slot the client picked at 13:00 was stored as 13:00Z and rendered —
 * correctly, in the business's own timezone — as 09:00. Four hours vanished on
 * the way into the database, and every surface downstream faithfully repeated
 * the wrong hour: the confirmation page, the email, the diary.
 *
 * These two functions are the conversion that was missing. No dependency: the
 * platform ships no timezone library, and `Intl` already knows every zone's
 * offset including the daylight-saving rules.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * How far `timeZone` is from UTC at a given instant, in milliseconds.
 *
 * Derived by asking `Intl` what the clock reads there and comparing it with the
 * instant, which is the only way to get a zone's offset without shipping the
 * tzdata ourselves. Positive east of Greenwich.
 */
function offsetMsAt(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);

  const read = (type: string) => Number(parts.find(part => part.type === type)?.value ?? '0');

  // `hour` comes back as 24 at midnight under hour12:false in some engines.
  const asIfUtc = Date.UTC(
    read('year'),
    read('month') - 1,
    read('day'),
    read('hour') % 24,
    read('minute'),
    read('second')
  );

  return asIfUtc - instant.getTime();
}

/**
 * A naive local time in `timeZone`, as a UTC instant.
 *
 * `'2026-09-23T13:00:00'` in `America/New_York` becomes
 * `'2026-09-23T17:00:00.000Z'` — one o'clock there, stored as the moment it
 * actually is.
 *
 * The offset is applied twice because the offset itself depends on the instant:
 * the first pass lands near enough to pick the right side of a daylight-saving
 * change, the second uses that zone rule. Input already carrying a `Z` or an
 * offset is an instant already and is returned untouched.
 */
export function wallClockToInstant(naive: string, timeZone: string): string {
  if (/[Z]|[+-]\d{2}:\d{2}$/.test(naive)) return new Date(naive).toISOString();

  const parts = naive.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!parts) return naive;

  const [, y, mo, d, h, mi, sec] = parts;
  const asIfUtc = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(sec ?? '0')
  );

  const firstPass = asIfUtc - offsetMsAt(new Date(asIfUtc), timeZone);
  const settled = asIfUtc - offsetMsAt(new Date(firstPass), timeZone);

  return new Date(settled).toISOString();
}

/**
 * An instant, as the wall clock reads in `timeZone`.
 *
 * The inverse, for anywhere that needs the naive form back — comparing against
 * a business's configured hours, for instance, which are stored as plain
 * `09:00`-style strings with no date and no zone.
 */
export function instantToWallClock(instant: string | Date, timeZone: string): string {
  const date = instant instanceof Date ? instant : new Date(instant);
  const shifted = new Date(date.getTime() + offsetMsAt(date, timeZone));
  return shifted.toISOString().slice(0, 19);
}
