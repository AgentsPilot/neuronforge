/**
 * The two reminder emails.
 *
 * `now` is injected on every case, so none of these is a function of the minute
 * the suite happens to run.
 */

import {
  generateMeetingReminderEmail,
  generateOwnerMeetingReminderEmail,
} from '../meeting-reminder';
import type { BrandingData } from '../base-template';

const branding: BrandingData = {
  businessName: 'Harbour Physio',
  primaryColor: '#F97316',
} as BrandingData;

/** The appointment, and a set of "now"s at known distances from it. */
const STARTS_AT = new Date('2026-10-01T14:00:00.000Z');
const HOUR = 3_600_000;

const base = {
  clientName: 'Dana',
  businessName: 'Harbour Physio',
  serviceName: 'Initial assessment',
  startsAt: STARTS_AT,
  timezone: 'UTC',
  branding,
};

describe('the client reminder', () => {
  it('says how near it is in words, not in a raw hour count', () => {
    const tomorrow = generateMeetingReminderEmail({
      ...base,
      now: STARTS_AT.getTime() - 30 * HOUR,
    });
    expect(tomorrow.subject).toContain('tomorrow');

    const soon = generateMeetingReminderEmail({
      ...base,
      now: STARTS_AT.getTime() - 2 * HOUR,
    });
    expect(soon.subject).toContain('in about 2 hours');
  });

  it('still carries the full date, for somebody reading it late', () => {
    // "Tomorrow" alone is worse than useless to a person who opens the mail a
    // day after it arrived.
    const { html } = generateMeetingReminderEmail({
      ...base,
      now: STARTS_AT.getTime() - 30 * HOUR,
    });

    expect(html).toContain('2026');
  });

  it('offers a way to move it when there is a link', () => {
    const { html } = generateMeetingReminderEmail({
      ...base,
      manageUrl: 'https://example.test/manage/abc',
      now: STARTS_AT.getTime() - 24 * HOUR,
    });

    expect(html).toContain('https://example.test/manage/abc');
  });

  it('renders without one rather than showing a dead button', () => {
    const { html } = generateMeetingReminderEmail({
      ...base,
      manageUrl: null,
      now: STARTS_AT.getTime() - 24 * HOUR,
    });

    expect(html).toContain('Initial assessment');
    expect(html).not.toContain('Change the time');
  });

  it('asks for nothing', () => {
    /*
     * No confirmation, no reply, no "please let us know". A reminder that
     * creates an obligation is another thing on somebody's list, and the ones
     * that get ignored are the ones that ask.
     */
    const { html } = generateMeetingReminderEmail({
      ...base,
      now: STARTS_AT.getTime() - 24 * HOUR,
    });

    expect(html.toLowerCase()).not.toContain('confirm');
    expect(html.toLowerCase()).not.toContain('reply to this');
  });

  it('speaks the reader language', () => {
    const he = generateMeetingReminderEmail({
      ...base,
      locale: 'he',
      now: STARTS_AT.getTime() - 30 * HOUR,
    });

    expect(he.subject).toContain('מחר');
    expect(he.html).toContain('היי Dana');
  });
});

describe('the owner heads-up', () => {
  const ownerBase = { ...base, clientName: 'Dana', now: STARTS_AT.getTime() - 2 * HOUR };

  it('leads with who is coming', () => {
    // The owner is deciding what to do in the next hour; the name is the first
    // thing they need, not the service.
    const { subject, html } = generateOwnerMeetingReminderEmail(ownerBase);

    expect(subject.startsWith('Dana')).toBe(true);
    expect(html.indexOf('Dana')).toBeLessThan(html.indexOf('Initial assessment'));
  });

  it('carries what can still be fixed before the appointment', () => {
    const { html } = generateOwnerMeetingReminderEmail({
      ...ownerBase,
      outstanding: { intakeMissing: true, paymentDue: '₪420' },
    });

    expect(html).toContain('intake form has not come back');
    expect(html).toContain('₪420');
  });

  it('says so in one line when there is nothing outstanding', () => {
    // A list of everything that is fine is a list nobody reads.
    const { html } = generateOwnerMeetingReminderEmail(ownerBase);

    expect(html).toContain('Nothing outstanding');
    expect(html).not.toContain('intake form has not come back');
  });

  it('shows how to reach the client when contact details exist', () => {
    const { html } = generateOwnerMeetingReminderEmail({
      ...ownerBase,
      clientEmail: 'dana@example.test',
      clientPhone: '+972 50 000 0000',
    });

    expect(html).toContain('dana@example.test');
    expect(html).toContain('+972 50 000 0000');
  });

  it('is not the client email with the greeting swapped', () => {
    const owner = generateOwnerMeetingReminderEmail(ownerBase);
    const client = generateMeetingReminderEmail(ownerBase);

    expect(owner.subject).not.toBe(client.subject);
    // The client is asked to come; the owner is told who is coming.
    expect(owner.html).not.toContain('Looking forward to seeing you');
  });
});
