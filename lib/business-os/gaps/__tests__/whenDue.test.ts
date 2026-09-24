/**
 * The two clocks.
 *
 * Every automation before the meeting reminder ran forward from the moment
 * something got stuck: wait a day, then chase. The reminder runs backward from
 * an appointment by a lead time the owner picked, and the arithmetic is not the
 * same arithmetic. These tests hold the difference in place.
 */

import { whenDue } from '@/lib/business-os/gaps/whenDue';
import { OPERATIONAL_AUTOMATIONS, automationById } from '@/lib/business-os/gaps/automations';

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

const remindAboutMeeting = automationById('remind_about_meeting')!;
const chaseIntake = automationById('chase_intake')!;

/** 2026-10-01 14:00 UTC — a fixed appointment, so nothing depends on today. */
const APPOINTMENT = '2026-10-01T14:00:00.000Z';

describe('whenDue — before_event', () => {
  it('counts backward from the appointment by the owner lead time', () => {
    const due = whenDue(
      remindAboutMeeting,
      { since: '2026-09-01T00:00:00.000Z', eventAt: APPOINTMENT },
      { meeting_reminder_hours_before: 24 }
    );

    expect(due?.toISOString()).toBe('2026-09-30T14:00:00.000Z');
  });

  it('honours a lead time the owner changed', () => {
    const due = whenDue(
      remindAboutMeeting,
      { since: '2026-09-01T00:00:00.000Z', eventAt: APPOINTMENT },
      { meeting_reminder_hours_before: 2 }
    );

    expect(due?.toISOString()).toBe('2026-10-01T12:00:00.000Z');
  });

  it('ignores `since` entirely', () => {
    /*
     * `since` is when the booking was made. On this clock it means nothing —
     * a booking made in January and one made yesterday for the same Tuesday
     * get the same reminder.
     */
    const early = whenDue(
      remindAboutMeeting,
      { since: '2026-01-01T00:00:00.000Z', eventAt: APPOINTMENT },
      { meeting_reminder_hours_before: 24 }
    );
    const late = whenDue(
      remindAboutMeeting,
      { since: '2026-09-29T00:00:00.000Z', eventAt: APPOINTMENT },
      { meeting_reminder_hours_before: 24 }
    );

    expect(early?.toISOString()).toBe(late?.toISOString());
  });

  it('says nothing when there is no appointment time', () => {
    // Rather than falling back to now, which would send a reminder about an
    // appointment whose time nobody knows.
    expect(
      whenDue(remindAboutMeeting, { since: APPOINTMENT }, { meeting_reminder_hours_before: 24 })
    ).toBeNull();
  });

  it('says nothing when the lead time is unreadable', () => {
    for (const value of [undefined, null, 'soon', 0, -3, NaN]) {
      expect(
        whenDue(
          remindAboutMeeting,
          { since: '2026-09-01T00:00:00.000Z', eventAt: APPOINTMENT },
          { meeting_reminder_hours_before: value }
        )
      ).toBeNull();
    }
  });
});

describe('whenDue — after_gap', () => {
  it('counts forward from the moment it got stuck', () => {
    const due = whenDue(chaseIntake, { since: '2026-09-30T14:00:00.000Z' }, {});

    // 24 hours, from the registry.
    expect(due?.toISOString()).toBe('2026-10-01T14:00:00.000Z');
  });

  it('ignores an appointment time that happens to be present', () => {
    const withEvent = whenDue(
      chaseIntake,
      { since: '2026-09-30T14:00:00.000Z', eventAt: APPOINTMENT },
      { meeting_reminder_hours_before: 1 }
    );

    expect(withEvent?.toISOString()).toBe('2026-10-01T14:00:00.000Z');
  });
});

describe('the registry', () => {
  it('gives every entry a clock that whenDue understands', () => {
    for (const automation of OPERATIONAL_AUTOMATIONS) {
      expect([undefined, 'after_gap', 'before_event']).toContain(automation.timing);
    }
  });

  it('gives every before_event entry the column its lead time lives in', () => {
    /*
     * Without it `whenDue` reads `undefined` hours and returns null forever —
     * an automation switched on, a card saying it is running, and no reminder
     * ever sent.
     */
    for (const automation of OPERATIONAL_AUTOMATIONS) {
      if (automation.timing === 'before_event') {
        expect(automation.leadHoursColumn).toBeTruthy();
      }
    }
  });
});
