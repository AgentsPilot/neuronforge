import { formatEmailDate } from '@/lib/email/templates/base-template';
import { generateICSContent, icsSequenceFor } from '@/lib/email/templates/booking-confirmation';

const branding = { businessName: 'Bright Clinic', primaryColor: '#000' } as never;
const base = {
  clientName: 'Dana', clientEmail: 'dana@example.com', serviceName: 'Consultation',
  dateTime: new Date('2026-09-24T13:00:00.000Z'),
  endTime: new Date('2026-09-24T14:00:00.000Z'),
  duration: 60, timezone: 'America/New_York',
  rescheduleUrl: '', cancelUrl: '', bookingId: 'b-1', branding,
} as never;

describe('emails name the clock the hour is on', () => {
  it('labels the zone when a time is shown', () => {
    const s = formatEmailDate(new Date('2026-09-24T13:00:00.000Z'), 'America/New_York', { locale: 'en' });
    expect(s).toContain('9:00');
    expect(s).toMatch(/Eastern/);
  });
  it('shows the SAME instant on the business clock, whoever reads it', () => {
    expect(formatEmailDate(new Date('2026-09-24T13:00:00.000Z'), 'Asia/Jerusalem', { locale: 'en' }))
      .toMatch(/4:00.*Israel/);
  });
  it('leaves a date-only value unlabelled', () => {
    const s = formatEmailDate(new Date('2026-09-24T12:00:00.000Z'), 'UTC', { includeTime: false });
    expect(s).not.toMatch(/Time|GMT|UTC/);
  });
});

describe('the calendar invite', () => {
  it('carries the absolute instant, so the client calendar localises it', () => {
    const ics = generateICSContent(base);
    expect(ics).toContain('DTSTART:20260924T130000Z');
    expect(ics).toContain('DTEND:20260924T140000Z');
  });
  it('omits ORGANIZER rather than naming a mailbox nobody reads', () => {
    expect(generateICSContent(base)).not.toContain('ORGANIZER');
    expect(generateICSContent(base, { organizerEmail: 'owner@clinic.com' }))
      .toContain('ORGANIZER;CN=Bright Clinic:mailto:owner@clinic.com');
  });
  it('raises SEQUENCE so a reschedule is not ignored as a duplicate', () => {
    const first = icsSequenceFor('2026-09-20T10:00:00Z');
    const later = icsSequenceFor('2026-09-21T10:00:00Z');
    expect(later).toBeGreaterThan(first);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(later).toBeLessThan(2_147_483_647);
    expect(icsSequenceFor(null)).toBe(0);
  });
  it('withdraws the event on cancellation, with no alarm left ringing', () => {
    const ics = generateICSContent(base, { method: 'CANCEL', sequence: 5 });
    expect(ics).toContain('METHOD:CANCEL');
    expect(ics).toContain('STATUS:CANCELLED');
    expect(ics).toContain('SEQUENCE:5');
    expect(ics).not.toContain('VALARM');
  });
  it('keeps the same UID so the cancel matches the booking it withdraws', () => {
    const uid = (s: string) => s.split('\r\n').find(l => l.startsWith('UID:'));
    expect(uid(generateICSContent(base))).toBe(uid(generateICSContent(base, { method: 'CANCEL' })));
  });
  it('uses CRLF line endings, as iCalendar requires', () => {
    expect(generateICSContent(base).split('\r\n').length).toBeGreaterThan(10);
  });
});
