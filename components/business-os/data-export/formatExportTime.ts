/**
 * The one date format of the "Download my data" control (data export DE-9,
 * SA DE-9 C-1, C-10): "Last export {date}", "until {until}", "from {time}".
 *
 * Explicit fields, NOT `dateStyle` / `timeStyle`: combining those with
 * `timeZoneName` throws a TypeError ("Invalid option"), and inside render that
 * blanks the settings screen. `timeZoneName: 'short'` stays, so the UTC
 * fallback outside the LanguageProvider (/v2/settings, /settings) reads as UTC
 * instead of passing for local time.
 *
 * `timeZoneOptions` is `useBusinessTimezone().timeZoneOptions`: the owner's
 * clock (user_preferences.timezone) inside the provider, UTC outside it. It
 * adds `timeZone` last, so nothing here can override it.
 *
 * Never throws: an unparseable value or a bad zone shows the ISO text rather
 * than an empty screen.
 */

export const EXPORT_TIME_FIELDS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZoneName: 'short',
};

export function formatExportTime(
  iso: string,
  language: string,
  timeZoneOptions: (options?: Intl.DateTimeFormatOptions) => Intl.DateTimeFormatOptions
): string {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat(language, timeZoneOptions(EXPORT_TIME_FIELDS)).format(when);
  } catch {
    return when.toISOString();
  }
}
