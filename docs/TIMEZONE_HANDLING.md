# Timezone Handling in Scheduling System

> **Last Updated**: 2026-08-07

## Overview

The scheduling system handles timezones consistently across all components to ensure bookings appear at the correct local time regardless of user location.

## Core Principles

1. **Database Storage**: All times stored in UTC (ISO 8601 format with timezone)
   - Example: `2026-08-07T14:00:00+00:00` (2pm UTC)

2. **Availability Times**: Represent local business hours
   - Example: `"09:00"` means 9am in the user's local timezone

3. **Display**: Always show times in user's local timezone
   - JavaScript `new Date()` automatically handles conversion

4. **Browser Handles DST**: No manual DST calculation needed

## How It Works

### Storing a Booking

```typescript
// User selects "10:00 AM" in datetime-local input (local time)
const localDateTime = "2026-08-07T10:00";
const date = new Date(localDateTime); // Creates Date in local timezone

// Convert to UTC for storage
const utcString = date.toISOString(); // "2026-08-07T07:00:00.000Z" (if user is in UTC-3)

// Send to API
fetch('/api/scheduling/bookings', {
  body: JSON.stringify({
    start_time: utcString  // Stored as UTC in database
  })
});
```

### Displaying a Booking

```typescript
// From database: "2026-08-07T14:00:00+00:00" (UTC)
const utcString = booking.start_time;

// JavaScript automatically converts to local
const date = new Date(utcString);

// Display in local time
const localHour = date.getHours(); // 17 (if user is in UTC+3)
const displayTime = date.toLocaleTimeString(); // "5:00 PM"
```

### Checking Availability

```typescript
// Availability stored as: { monday: [{ start: "09:00", end: "17:00" }] }
// These represent LOCAL business hours

// Create a local datetime for the slot
const now = new Date();
const slotStart = new Date(now);
slotStart.setHours(9, 0, 0, 0); // 9am LOCAL time

// Check if booking conflicts (stored in UTC)
const bookingStart = new Date(booking.start_time); // Converts UTC to local

// Compare (both in local timezone now)
const conflicts = slotStart < bookingEnd && slotEnd > bookingStart;
```

## User Timezone Detection

```typescript
// Get user's timezone
const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
// Example: "Asia/Jerusalem", "America/New_York"

// Get offset from UTC
const offsetMinutes = -new Date().getTimezoneOffset();
// Example: 180 for UTC+3, -240 for UTC-4
```

## Common Pitfalls

### ❌ Wrong: Using UTC time for display

```typescript
// DON'T manually parse UTC
const utcTime = "2026-08-07T14:00:00+00:00";
const hour = parseInt(utcTime.split('T')[1]); // 14 - WRONG! This is UTC hour
```

### ✅ Right: Let JavaScript handle conversion

```typescript
// DO use Date object
const utcTime = "2026-08-07T14:00:00+00:00";
const date = new Date(utcTime);
const hour = date.getHours(); // 17 (in UTC+3) - CORRECT! Local hour
```

### ❌ Wrong: Storing local time as string

```typescript
// DON'T store "10:00 AM" without date/timezone context
const booking = { time: "10:00 AM" }; // Which timezone?
```

### ✅ Right: Store full ISO string with timezone

```typescript
// DO store complete UTC timestamp
const booking = {
  start_time: "2026-08-07T07:00:00.000Z" // Clear, unambiguous
};
```

## Debugging Timezone Issues

Check browser console for these debug logs:

1. **🌍 TIMEZONE DEBUG** - Shows user's timezone and quick slot generation
2. **⏰ AVAILABILITY DEBUG** - Shows parsed availability times
3. **📅 First booking timezone check** - Shows UTC to local conversion
4. **📍 Booking position** - Shows where booking appears in calendar grid

Example output:
```
🌍 TIMEZONE DEBUG: {
  userTimezone: "Asia/Jerusalem",
  timezoneOffset: "UTC+3",
  currentTime: {
    iso: "2026-08-07T14:00:00.000Z",
    local: "8/7/2026, 5:00:00 PM",
    hours: 17
  }
}
```

## Files Involved

| File | Purpose |
|------|---------|
| `lib/utils/timezone.ts` | Timezone utility functions |
| `components/business-os/SchedulingDialog.tsx` | Quick slot generation (local time) |
| `components/scheduling/SchedulingCalendarView.tsx` | Calendar display (UTC → local) |
| `app/api/scheduling/bookings/route.ts` | API (stores UTC) |

## Testing Different Timezones

To test the system in different timezones:

1. **Chrome DevTools**: DevTools → ⋮ → More tools → Sensors → Location → Select timezone
2. **Firefox**: about:config → search `intl.tzdata.default_tzdata` → set to timezone
3. **System**: Change your OS timezone settings

Test scenarios:
- Create booking at 10:00 AM local → verify stored as correct UTC
- View booking created in different timezone → verify displays at correct local time
- Check availability shows today's hours correctly in your timezone

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-08-07 | Initial documentation | Created comprehensive timezone handling guide after fixing display issues |
