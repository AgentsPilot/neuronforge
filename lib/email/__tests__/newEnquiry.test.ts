/**
 * The owner alert, as a table of expectations.
 *
 * Two of these exist for the specific things that go wrong in an email nobody
 * looks at in a browser: a visitor's text reaching the document unescaped, and
 * a Hebrew owner getting a left-to-right layout.
 */

import { generateNewEnquiryEmail } from '../templates/new-enquiry';
import type { BrandingData } from '../templates/base-template';

const branding: BrandingData = {
  businessName: 'Test Practice',
  primaryColor: '#4F46E5',
  secondaryColor: '#818CF8',
};

const base = {
  contactName: 'Dana Levi',
  contactEmail: 'dana@example.com',
  contactUrl: 'https://app.example.com/business-os/crm?contact=abc',
  settingsUrl: 'https://app.example.com/business-os/settings?section=preferences',
  branding,
};

describe('the new enquiry alert', () => {
  it('names the person in the subject, so the inbox line is useful on its own', () => {
    const { subject } = generateNewEnquiryEmail({ ...base, kind: 'enquiry' });
    expect(subject).toContain('Dana Levi');
  });

  it('names the service somebody wants a price for', () => {
    const { subject } = generateNewEnquiryEmail({
      ...base,
      kind: 'quote',
      serviceName: 'Kitchen refit',
    });
    expect(subject).toContain('Dana Levi');
    expect(subject).toContain('Kitchen refit');
  });

  it('reads differently for an enquiry and a quote request', () => {
    const enquiry = generateNewEnquiryEmail({ ...base, kind: 'enquiry' });
    const quote = generateNewEnquiryEmail({ ...base, kind: 'quote', serviceName: 'X' });

    // Both are waiting on the owner, but only one needs a figure from them.
    expect(enquiry.html).toContain('waiting to hear back');
    expect(quote.html).toContain('Only you can answer');
  });

  it('escapes what a stranger typed', () => {
    const { html } = generateNewEnquiryEmail({
      ...base,
      kind: 'enquiry',
      contactName: '<script>alert(1)</script>',
      message: 'Hi <b>there</b> & good morning',
    });

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
    expect(html).not.toContain('<b>there</b>');
  });

  it('keeps a multi-line message readable without letting markup through', () => {
    const { html } = generateNewEnquiryEmail({
      ...base,
      kind: 'enquiry',
      message: 'line one\nline two',
    });

    // The break is added AFTER escaping, so this is the only tag that survives.
    expect(html).toContain('line one<br />line two');
  });

  it('leaves the subject unescaped, because a subject is not HTML', () => {
    const { subject } = generateNewEnquiryEmail({
      ...base,
      kind: 'enquiry',
      contactName: 'Ben & Co',
    });
    expect(subject).toContain('Ben & Co');
    expect(subject).not.toContain('&amp;');
  });

  it('renders right-to-left for a Hebrew owner', () => {
    const { html } = generateNewEnquiryEmail({
      ...base,
      kind: 'enquiry',
      message: 'שלום',
      locale: 'he',
    });
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('direction: rtl');
  });

  it('omits every detail row it has no value for', () => {
    const { html } = generateNewEnquiryEmail({ ...base, kind: 'enquiry' });
    expect(html).not.toContain('Phone');
    expect(html).not.toContain('Found you via');
    // A row with an empty value is worse than no row.
    expect(html).toContain('Email');
  });

  it('falls back to the email address when nobody gave a name', () => {
    const { subject } = generateNewEnquiryEmail({ ...base, kind: 'enquiry', contactName: '   ' });
    expect(subject).toContain('dana@example.com');
  });

  it('carries the way out', () => {
    // An alert with no unsubscribe is how a useful alert becomes spam.
    const { html } = generateNewEnquiryEmail({ ...base, kind: 'enquiry' });
    expect(html).toContain(base.settingsUrl);
    expect(html).toContain(base.contactUrl);
  });

  it('tells the owner a slot is free again', () => {
    const { subject, html } = generateNewEnquiryEmail({
      ...base,
      kind: 'cancelled',
      serviceName: 'Deep tissue massage',
      whenLocal: 'Tuesday 9:00',
      reason: 'Feeling unwell',
    });

    expect(subject).toContain('cancelled');
    expect(subject).toContain('Deep tissue massage');
    // The point of the email: that hour can be sold again.
    expect(html).toContain('free again');
    expect(html).toContain('Feeling unwell');
  });

  it('gives both times when an appointment moves', () => {
    const { subject, html } = generateNewEnquiryEmail({
      ...base,
      kind: 'moved',
      serviceName: 'Intro call',
      whenLocal: 'Thursday 14:00',
      previousWhenLocal: 'Tuesday 9:00',
    });

    expect(subject).toContain('moved');
    // "Moved" alone is unusable — they need to know what to stop expecting.
    expect(html).toContain('Thursday 14:00');
    expect(html).toContain('Tuesday 9:00');
  });

  it('does not claim a reason nobody gave', () => {
    const { html } = generateNewEnquiryEmail({
      ...base,
      kind: 'cancelled',
      serviceName: 'X',
      whenLocal: 'Tuesday 9:00',
    });
    expect(html).not.toContain('Reason given');
  });
});
