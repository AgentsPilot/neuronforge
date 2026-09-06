/**
 * Timezone utility functions for consistent handling of dates/times
 * across the scheduling system.
 *
 * CORE PRINCIPLES:
 * 1. Database stores everything in UTC
 * 2. Availability times (e.g., "09:00") represent LOCAL business hours
 * 3. Display always shows times in user's local timezone
 * 4. Browser automatically handles DST transitions
 */

/**
 * Get the user's current timezone
 * Uses Intl API for accurate timezone detection
 */
export function getUserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
}

/**
 * Get the timezone offset in minutes from UTC
 * Positive values are east of UTC, negative are west
 * Example: Israel (UTC+3) = -180 minutes
 */
export function getTimezoneOffsetMinutes(date: Date = new Date()): number {
  return -date.getTimezoneOffset();
}

/**
 * Format a date for datetime-local input (YYYY-MM-DDTHH:MM)
 * Takes a Date object in any timezone and formats it for local display
 */
export function formatDateTimeLocal(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

/**
 * Parse datetime-local string to Date object
 * Input format: YYYY-MM-DDTHH:MM (represents local time)
 * Output: Date object in local timezone
 */
export function parseDateTimeLocal(dateTimeString: string): Date {
  // datetime-local format is always interpreted as local time
  return new Date(dateTimeString);
}

/**
 * Create a local Date object for a specific day and time
 * @param date - The date (year, month, day matter; time will be replaced)
 * @param timeString - Time in HH:MM format (local business hours)
 * @returns Date object representing that local time
 */
export function createLocalDateTime(date: Date, timeString: string): Date {
  const [hours, minutes] = timeString.split(':').map(Number);
  const result = new Date(date);
  result.setHours(hours, minutes, 0, 0);
  return result;
}

/**
 * Check if a UTC booking time falls within a local time range
 * Used to display bookings on the correct day/hour in the calendar
 *
 * @param utcTimeString - ISO string from database (UTC)
 * @param localDate - The local date we're checking against
 * @returns Whether the UTC time, when converted to local, falls on this date
 */
export function isUTCTimeOnLocalDate(utcTimeString: string, localDate: Date): boolean {
  const utcDate = new Date(utcTimeString);
  const localStart = new Date(localDate);
  localStart.setHours(0, 0, 0, 0);
  const localEnd = new Date(localDate);
  localEnd.setHours(23, 59, 59, 999);

  return utcDate >= localStart && utcDate <= localEnd;
}

/**
 * Get the local hour from a UTC timestamp
 * This is used to position bookings in the calendar grid
 *
 * @param utcTimeString - ISO string from database (UTC)
 * @returns The hour in local timezone (0-23)
 */
export function getLocalHourFromUTC(utcTimeString: string): number {
  return new Date(utcTimeString).getHours();
}

/**
 * Get the local minutes from a UTC timestamp
 *
 * @param utcTimeString - ISO string from database (UTC)
 * @returns The minutes in local timezone (0-59)
 */
export function getLocalMinutesFromUTC(utcTimeString: string): number {
  return new Date(utcTimeString).getMinutes();
}

/**
 * Format a time for display (handles timezone conversion automatically)
 * @param utcTimeString - ISO string from database (UTC)
 * @param options - Intl.DateTimeFormat options
 */
export function formatTimeDisplay(
  utcTimeString: string,
  options: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit', hour12: true }
): string {
  return new Date(utcTimeString).toLocaleTimeString('en-US', options);
}

/**
 * Format a date for display
 * @param utcTimeString - ISO string from database (UTC)
 * @param locale - User's locale
 */
export function formatDateDisplay(
  utcTimeString: string,
  locale: string = 'en-US',
  options: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }
): string {
  return new Date(utcTimeString).toLocaleDateString(locale, options);
}

/**
 * Debug helper: Log timezone information
 */
export function logTimezoneDebug(label: string, date: Date | string) {
  const d = typeof date === 'string' ? new Date(date) : date;
  console.log(`[TZ DEBUG] ${label}:`, {
    iso: d.toISOString(),
    local: d.toLocaleString(),
    timezone: getUserTimezone(),
    offset: getTimezoneOffsetMinutes(d)
  });
}
