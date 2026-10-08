/**
 * The receipt a client gets for asking to be quoted.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A client picked a quoted service, typed their details and what they needed,
 * pressed send, and heard nothing. The owner was alerted; the person waiting
 * for a price was not, and from their side a silent form is indistinguishable
 * from a broken one.
 *
 * Two things are worth testing about an email like this, and neither is its
 * markup: that it speaks the reader's language all the way through, which is a
 * fault this folder has shipped before, and that the one piece of untrusted
 * text in it cannot become markup in the sender's own branded template.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { generateQuoteReceivedEmail } from '../quote-received';
import { htmlToText } from '../../htmlToText';

const BRANDING = {
  businessName: 'סטודיו שיפוצים',
  primaryColor: '#D14E97',
  logoUrl: undefined,
};

const BASE = {
  clientName: 'אופיר עומר',
  serviceName: 'הצעת מחיר לשיפוץ',
  submittedAt: new Date('2026-10-06T12:00:00Z'),
  timezone: 'Asia/Jerusalem',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- BrandingData carries
  // a dozen optional fields the copy never reads; the three above are what it uses.
  branding: BRANDING as any,
};

describe('what the email says', () => {
  it('names the service in the subject, so the inbox line is useful', () => {
    const { subject } = generateQuoteReceivedEmail({ ...BASE, locale: 'he' });
    expect(subject).toContain('הצעת מחיר לשיפוץ');
  });

  it('greets the client by their first name and names the business', () => {
    const { html } = generateQuoteReceivedEmail({ ...BASE, locale: 'he' });
    const text = htmlToText(html);
    expect(text).toContain('אופיר');
    expect(text).toContain('סטודיו שיפוצים');
  });

  it('promises a reply and asks the client for nothing', () => {
    /*
     * The next move is a PRICE, and only the business can write one. An email
     * asking the client to act would be asking them for the single thing they
     * cannot provide, so there is no button in this template at all.
     */
    const { html } = generateQuoteReceivedEmail({ ...BASE, locale: 'en' });
    expect(htmlToText(html)).toContain('will come back to you with a quote');
    expect(html).not.toMatch(/<a[^>]+href="https?:/);
  });

  it('promises no deadline it cannot keep', () => {
    // The platform does not know a business's turnaround, and "within 24
    // hours" in their name would be a commitment they never made.
    const text = htmlToText(generateQuoteReceivedEmail({ ...BASE, locale: 'en' }).html);
    expect(text).not.toMatch(/24 hours|within a day|business day/i);
  });
});

describe('it speaks one language at a time', () => {
  it.each(['en', 'es', 'he'] as const)('%s has no stray English sentence', locale => {
    const { subject, html } = generateQuoteReceivedEmail({ ...BASE, locale });
    const text = htmlToText(html);

    if (locale === 'he') {
      expect(subject).toContain('קיבלנו את הפנייה שלך');
      expect(text).toContain('תודה');
      // The giveaway from the chase-email bug: English copy around a correct date.
      expect(text).not.toContain('Thank you');
      expect(text).not.toContain('we have your request');
    }

    if (locale === 'es') {
      expect(subject).toContain('Hemos recibido tu solicitud');
      expect(text).not.toContain('Thank you');
    }
  });
});

describe("the client's own words", () => {
  it('are quoted back, so they can see what arrived', () => {
    const { html } = generateQuoteReceivedEmail({
      ...BASE,
      locale: 'he',
      note: 'שיפוץ מטבח, כולל ריצוף',
    });
    expect(htmlToText(html)).toContain('שיפוץ מטבח, כולל ריצוף');
  });

  it('cannot become markup in the business\'s own template', () => {
    /*
     * The one piece of untrusted text in this email, going into an HTML
     * document that carries the business's name and logo.
     */
    const { html } = generateQuoteReceivedEmail({
      ...BASE,
      locale: 'en',
      note: '<img src=x onerror="alert(1)"> & "quoted"',
    });

    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
    expect(html).toContain('&amp;');
  });

  it('are simply absent when there were none', () => {
    const { html } = generateQuoteReceivedEmail({ ...BASE, locale: 'en', note: '   ' });
    const text = htmlToText(html);
    // No empty "Your note" row left standing with nothing in it.
    expect(text).not.toContain('Your note');
  });
});
