/**
 * The chase email, written in the reader's language.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `locale` reached the date formatter and the branded wrapper and nothing else,
 * so every sentence was hardcoded English with a localised date dropped into
 * the middle of it. A Hebrew school chasing a Hebrew client sent:
 *
 *     Hi אופיר עומר, I hope you're well.
 *     I wanted to check in about invoice INV-00006 for ₪300.00 …
 *     It was due on יום ראשון, 27 בספטמבר 2026, 1 day ago.
 *
 * Three languages in one paragraph, to a paying client, about money. The date
 * being right is what made it obvious: the locale WAS there, the copy simply
 * never read it.
 *
 * Every other template in this folder reads `translations.ts`. This one now
 * does too, and these tests are what keeps it there.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  generateChaseInvoiceEmail,
  generateFollowupNudgeEmail,
  generateBookingReminderEmail,
} from '../insight-actions';
import { htmlToText } from '../../htmlToText';

const INVOICE = {
  clientName: 'אופיר עומר',
  businessName: 'בית הספר הבינלאומי להורות',
  invoiceNumber: 'INV-00006',
  amount: 300,
  currency: 'ILS',
  dueDate: new Date('2026-09-27T00:00:00Z'),
  daysOverdue: 1,
  payUrl: 'https://example.com/invoice/abc',
  timezone: 'Asia/Jerusalem',
  branding: { businessName: 'בית הספר הבינלאומי להורות' },
};

const render = (over: Record<string, unknown> = {}) => {
  const mail = generateChaseInvoiceEmail({ ...INVOICE, ...over } as never);
  return { ...mail, text: htmlToText(mail.html) };
};

/** Latin words that are ours, not the business's or the client's. */
const ENGLISH_PROSE = [
  'I hope', 'wanted to check', 'still showing', 'It was due',
  'already paid', 'Pay invoice', 'Invoice', 'from',
];

describe('a Hebrew business chasing a Hebrew client', () => {
  const he = render({ locale: 'he' });

  it('writes the whole body in Hebrew', () => {
    expect(he.text).toContain('שלום אופיר עומר');
    expect(he.text).toContain('רציתי לבדוק לגבי חשבונית INV-00006');
    expect(he.text).toContain('שעדיין מופיעה כלא שולמה');
    expect(he.text).toContain('אם כבר שילמת');
  });

  it('writes the subject in Hebrew too', () => {
    // The subject is the half a client sees before deciding to open it.
    expect(he.subject).toContain('חשבונית INV-00006');
    expect(he.subject).not.toContain('Invoice');
  });

  it('labels the button in Hebrew', () => {
    expect(he.text).toContain('לתשלום החשבונית');
    expect(he.text).not.toContain('Pay invoice');
  });

  it('leaves no English sentence anywhere in it', () => {
    /*
     * The invoice number and the currency are not prose — they are the same
     * in every language. Everything else must be gone.
     */
    for (const phrase of ENGLISH_PROSE) {
      expect(he.text).not.toContain(phrase);
    }
  });

  it('says how late it is in Hebrew, singular and plural', () => {
    expect(render({ locale: 'he', daysOverdue: 1 }).text).toContain('לפני יום.');
    expect(render({ locale: 'he', daysOverdue: 5 }).text).toContain('לפני 5 ימים.');
  });

  it('drops the lateness clause entirely when it is not late', () => {
    // Day 0 of `payment_overdue_reminder_days`: due today, not overdue.
    const text = render({ locale: 'he', daysOverdue: 0 }).text;
    expect(text).toContain('מועד התשלום שלה היה');
    expect(text).not.toContain('לפני');
  });
});

describe('the other two languages', () => {
  it('writes Spanish throughout', () => {
    const es = render({ locale: 'es' });
    expect(es.subject).toContain('Factura INV-00006');
    expect(es.text).toContain('espero que estés bien');
    expect(es.text).toContain('sigue figurando como impagada');
    expect(es.text).toContain('Pagar factura');
    expect(es.text).toContain('hace 1 día');
  });

  it('still writes English when that is the language', () => {
    // The regression must not have swung the other way.
    const en = render({ locale: 'en' });
    expect(en.subject).toContain('Invoice INV-00006');
    expect(en.text).toContain("I hope you're well");
    expect(en.text).toContain('1 day ago');
  });

  it('falls back to English when no locale is given', () => {
    expect(render().text).toContain('still showing as unpaid');
  });
});

describe('the firm tone', () => {
  it('is localised as well, not just the friendly one', () => {
    /*
     * Two tones, three languages. The firm branch was the easier one to leave
     * behind, because the default is friendly and nobody sees firm by accident.
     */
    const he = render({ locale: 'he', tone: 'firm' });
    expect(he.text).toContain('עדיין פתוחה');
    expect(he.text).not.toContain('still outstanding');

    const es = render({ locale: 'es', tone: 'firm' });
    expect(es.text).toContain('sigue pendiente');
  });

  it('drops the pleasantry, in every language', () => {
    // "Hi X," with no "I hope you're well" after it. That IS the tone.
    expect(render({ locale: 'he', tone: 'firm' }).text).not.toContain('מקווה ששלומך טוב');
    expect(render({ locale: 'en', tone: 'firm' }).text).not.toContain("I hope you're well");
  });
});

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * THE OTHER TWO IN THIS FILE.
 *
 * All three generators took a `locale`, handed it to the date formatter and the
 * branded wrapper, and wrote their sentences in English regardless. The chase
 * was the one that got noticed because a client complained about it; the nudge
 * and the appointment reminder are the same bug reaching the same inboxes.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const CLIENT = { clientName: 'אופיר עומר', businessName: 'בית הספר הבינלאומי להורות' };
const BRANDING = { branding: { businessName: CLIENT.businessName } };

describe('the nudge to somebody who went quiet', () => {
  const nudge = (over: Record<string, unknown> = {}) => {
    const mail = generateFollowupNudgeEmail({
      ...CLIENT, ...BRANDING, bookingUrl: 'https://example.com/book', ...over,
    } as never);
    return { ...mail, text: htmlToText(mail.html) };
  };

  it('writes Hebrew, subject included', () => {
    const he = nudge({ locale: 'he', reason: 'past_client', serviceName: 'ייעוץ אישי' });
    expect(he.subject).toContain('לקביעת המפגש הבא שלך');
    expect(he.text).toContain('עבר קצת זמן מאז הביקור האחרון שלך');
    expect(he.text).toContain('לקביעת מועד');
    expect(he.text).not.toContain('Book a time');
  });

  it('localises every reason, not just the default', () => {
    /*
     * Four openings, and each picks up where the relationship left off. A
     * single untranslated branch is an English sentence that appears only for
     * the clients in that one state, which is how it survives a spot check.
     */
    expect(nudge({ locale: 'he', reason: 'new_enquiry' }).text).toContain('פנית אלינו');
    expect(nudge({ locale: 'he', reason: 'after_intro' }).text).toContain('נהנית מהמפגש הראשון');
    expect(nudge({ locale: 'he', reason: 'unspecified' }).text).toContain('שלום אופיר עומר');

    for (const reason of ['new_enquiry', 'past_client', 'after_intro', 'unspecified']) {
      expect(nudge({ locale: 'he', reason }).text).not.toContain('I hope');
    }
  });

  it('names the service in the reader\'s language, or says "session" in it', () => {
    expect(nudge({ locale: 'he', serviceName: 'ייעוץ אישי' }).text).toContain('ייעוץ אישי הבא שלך');
    expect(nudge({ locale: 'he' }).text).toContain('את המפגש הבא שלך');
  });

  it('writes Spanish throughout', () => {
    const es = nudge({ locale: 'es', reason: 'past_client' });
    expect(es.subject).toContain('Reserva tu próxima sesión');
    expect(es.text).toContain('Ha pasado un tiempo');
    expect(es.text).toContain('Reservar hora');
  });
});

describe('the appointment reminder', () => {
  const reminder = (over: Record<string, unknown> = {}) => {
    const mail = generateBookingReminderEmail({
      ...CLIENT, ...BRANDING,
      serviceName: 'ייעוץ אישי',
      startsAt: new Date('2026-10-02T07:00:00Z'),
      timezone: 'Asia/Jerusalem',
      manageUrl: 'https://example.com/manage',
      ...over,
    } as never);
    return { ...mail, text: htmlToText(mail.html) };
  };

  it('writes Hebrew, subject included', () => {
    const he = reminder({ locale: 'he' });
    expect(he.subject).toContain('תזכורת:');
    expect(he.text).toContain('תזכורת לגבי');
    expect(he.text).toContain('שינוי מועד או ביטול');
    expect(he.text).toContain('נתראה בקרוב');
    expect(he.text).not.toContain('Reminder');
  });

  it('puts the hour on the clock the reader actually uses', () => {
    /*
     * `hour12` was forced on for every language, so a Hebrew sentence carried a
     * literal "AM" — a word Hebrew does not use. English keeps its 12-hour
     * clock; the other two get the 24-hour one they write with.
     */
    expect(reminder({ locale: 'he' }).text).not.toContain('AM');
    expect(reminder({ locale: 'es' }).text).not.toContain('AM');
    expect(reminder({ locale: 'en' }).text).toContain('AM');
  });

  it('writes Spanish throughout', () => {
    const es = reminder({ locale: 'es' });
    expect(es.subject).toContain('Recordatorio:');
    expect(es.text).toContain('Un recordatorio sobre tu');
    expect(es.text).toContain('Reprogramar o cancelar');
  });
});
