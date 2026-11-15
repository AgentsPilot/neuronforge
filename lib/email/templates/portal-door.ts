/**
 * The email that sends a client to a page where they decide.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE TEMPLATE, SIX DOORS, AND THAT IS DELIBERATE.
 *
 * Every one of these is the same email: one sentence and one button. Only the
 * sentence and the `?task=` differ. Written as six templates they would be six
 * places to drift — six greetings, six button styles, six chances for one of
 * them to stop matching the others after a redesign nobody applied everywhere.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE COPY IS A TABLE, NOT A PROMPT.
 *
 * This email is the only thing the receptionist may SEND to a client. What
 * makes that safe is not that the agent is careful — it is that the agent
 * cannot choose the words. It picks a door; the sentence comes from here.
 *
 * So there is no `message` field on the input, and there must never be one. A
 * free-text line would let the model state a price, a time or a promise, which
 * is the exact failure the whole design exists to prevent: send a door, never
 * send an answer.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT A DOOR IS
 *
 * A page where the CLIENT does the deciding. A booking link does not book, a
 * reschedule link does not reschedule, a refund form does not refund. If the
 * agent has misread the message, the client receives a door they do not walk
 * through — mildly odd, entirely recoverable, and nothing has been promised.
 *
 * Requirement: docs/requirements/BUSINESS_OS_RECEPTIONIST_SENDS_REQUIREMENT.md
 */

import type { Locale } from '@/lib/i18n/config';
import { wrapInBrandedTemplate, emailButton, type BrandingData } from './base-template';
import { escapeHtml } from '@/lib/email/escapeHtml';

/**
 * The doors. Each is a self-service surface that already exists.
 *
 * `book` is the odd one: it is a smart link rather than a booking's own
 * portal, because the person asking may have no booking yet — which is the
 * whole point of asking.
 */
export type PortalDoor =
  | 'book'
  | 'reschedule'
  | 'cancel'
  | 'pay'
  | 'intake'
  | 'quote'
  | 'refund';

export interface PortalDoorEmailData {
  clientName?: string | null;
  businessName: string;
  /** Where the door leads. Built by the caller; never by the model. */
  url: string;
  /** Which door, which decides every word below. */
  door: PortalDoor;
  branding: BrandingData;
  locale?: Locale;
}

/**
 * Every word this email can contain.
 *
 * `line` says why they are being sent somewhere, in one sentence that states
 * no fact about this business — no price, no time, no availability, no policy.
 * Read them as a set: none of them answers anything, each of them points.
 */
const COPY: Record<PortalDoor, Record<'en' | 'he' | 'es', { subject: string; line: string; button: string }>> = {
  book: {
    en: {
      subject: 'Booking a time',
      line: 'Thanks for getting in touch. You can see what is available and pick a time here:',
      button: 'See available times',
    },
    he: {
      subject: 'קביעת מועד',
      line: 'תודה על הפנייה. אפשר לראות את המועדים הפנויים ולבחור מה שמתאים כאן:',
      button: 'למועדים הפנויים',
    },
    es: {
      subject: 'Reservar una cita',
      line: 'Gracias por escribirnos. Aquí puedes ver la disponibilidad y elegir una hora:',
      button: 'Ver horarios disponibles',
    },
  },
  reschedule: {
    en: {
      subject: 'Moving your appointment',
      line: 'No problem. You can pick another time here, and the change is confirmed straight away:',
      button: 'Choose another time',
    },
    he: {
      subject: 'שינוי מועד הפגישה',
      line: 'אין בעיה. אפשר לבחור מועד אחר כאן, והשינוי נקלט מיד:',
      button: 'בחירת מועד אחר',
    },
    es: {
      subject: 'Cambiar tu cita',
      line: 'Sin problema. Puedes elegir otra hora aquí y el cambio se confirma al instante:',
      button: 'Elegir otra hora',
    },
  },
  cancel: {
    en: {
      subject: 'Cancelling your appointment',
      line: 'You can cancel here. It takes a moment and you will get a confirmation:',
      button: 'Cancel the appointment',
    },
    he: {
      subject: 'ביטול הפגישה',
      line: 'אפשר לבטל כאן. זה לוקח רגע ותקבלו אישור:',
      button: 'ביטול הפגישה',
    },
    es: {
      subject: 'Cancelar tu cita',
      line: 'Puedes cancelar aquí. Tarda un momento y recibirás una confirmación:',
      button: 'Cancelar la cita',
    },
  },
  pay: {
    en: {
      subject: 'Paying for your appointment',
      line: 'You can pay here. The page shows what is outstanding:',
      button: 'Go to payment',
    },
    he: {
      subject: 'תשלום עבור הפגישה',
      line: 'אפשר לשלם כאן. בעמוד מופיע מה נותר לתשלום:',
      button: 'מעבר לתשלום',
    },
    es: {
      subject: 'Pagar tu cita',
      line: 'Puedes pagar aquí. La página muestra lo que queda pendiente:',
      button: 'Ir al pago',
    },
  },
  intake: {
    en: {
      subject: 'A few details before your appointment',
      line: 'Before we meet, there are a few details to fill in. It only takes a minute:',
      button: 'Fill in the details',
    },
    he: {
      subject: 'כמה פרטים לפני הפגישה',
      line: 'לפני שניפגש נשארו כמה פרטים למלא. זה לוקח דקה:',
      button: 'מילוי הפרטים',
    },
    es: {
      subject: 'Algunos datos antes de tu cita',
      line: 'Antes de vernos quedan algunos datos por completar. Solo lleva un minuto:',
      button: 'Completar los datos',
    },
  },
  quote: {
    en: {
      subject: 'Your quote',
      line: 'Your quote is here. You can read it and reply from the page:',
      button: 'Open the quote',
    },
    he: {
      subject: 'הצעת המחיר שלכם',
      line: 'הצעת המחיר נמצאת כאן. אפשר לקרוא ולהשיב מתוך העמוד:',
      button: 'פתיחת הצעת המחיר',
    },
    es: {
      subject: 'Tu presupuesto',
      line: 'Tu presupuesto está aquí. Puedes leerlo y responder desde la página:',
      button: 'Abrir el presupuesto',
    },
  },
  refund: {
    en: {
      subject: 'Your refund request',
      line: 'We got your message. So we can deal with it quickly, tell us which payment it is about and how much:',
      button: 'Open the refund form',
    },
    he: {
      subject: 'בקשת ההחזר שלכם',
      line: 'קיבלנו את הפנייה. כדי שנוכל לטפל בה מהר, ספרו לנו על איזה תשלום מדובר ועל איזה סכום:',
      button: 'מילוי בקשת החזר',
    },
    es: {
      subject: 'Tu solicitud de reembolso',
      line: 'Recibimos tu mensaje. Para resolverlo rápido, dinos de qué pago se trata y por cuánto:',
      button: 'Abrir el formulario',
    },
  },
};

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS EMAIL ENDS AT THE BUTTON, AND THAT IS THE POINT.
 *
 * It used to sign off with "if it is easier, just reply to this email and we
 * will pick it up" — in every language, under every door. It read as
 * courtesy. It was the one sentence that undid the feature.
 *
 * A door exists so the client answers the questions nobody could answer for
 * them: WHICH payment, HOW MUCH, which slot, which details. The form collects
 * exactly that and hands the owner a complete request. An invitation to write
 * back instead offers the client the one route that collects nothing — and the
 * reply lands in the same inbox, where the receptionist reads it, still cannot
 * answer it, and escalates to the owner. The door was sent, a model call was
 * spent, and the owner is interrupted anyway, with a half-formed question.
 *
 * Saying nothing traps nobody. It is a normal email from the business, and a
 * client who wants to reply will. The difference is that we no longer steer
 * them away from the thing built to help them.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export function generatePortalDoorEmail(data: PortalDoorEmailData): {
  subject: string;
  html: string;
  text: string;
} {
  const locale = (data.locale || 'en') as 'en' | 'he' | 'es';
  const lang = COPY[data.door][locale] ? locale : 'en';
  const copy = COPY[data.door][lang];

  /* Their first name only. A full name in a greeting reads like a form letter,
     which is the opposite of what this email is for. The same reasoning, and
     the same line, as `booking-invite.ts`. */
  const firstName = (data.clientName || '').trim().split(/\s+/)[0] || '';

  const greeting = firstName
    ? lang === 'he'
      ? `שלום ${escapeHtml(firstName)},`
      : lang === 'es'
        ? `Hola ${escapeHtml(firstName)}:`
        : `Hi ${escapeHtml(firstName)},`
    : lang === 'he'
      ? 'שלום,'
      : lang === 'es'
        ? 'Hola:'
        : 'Hi,';

  const body = `
    <p style="margin: 0 0 12px; font-size: 15px; line-height: 1.6;">${greeting}</p>
    <p style="margin: 0 0 24px; font-size: 15px; line-height: 1.6;">${escapeHtml(copy.line)}</p>
    ${emailButton(copy.button, data.url, { branding: { ...data.branding, locale: lang as Locale } })}
  `.trim();

  const html = wrapInBrandedTemplate(body, { ...data.branding, locale: lang as Locale });

  /*
   * A plain-text part on every send.
   *
   * Not decoration: a client whose mail client refuses HTML, or whose filter
   * strips it, gets an empty message otherwise — and this one exists to carry
   * exactly one link.
   */
  const text = [
    greeting.replace(/<[^>]*>/g, ''),
    '',
    copy.line,
    data.url,
  ].join('\n');

  return { subject: copy.subject, html, text };
}

/** Which portal task a door opens. `book` has none: it is a smart link. */
export const DOOR_TASK: Record<Exclude<PortalDoor, 'book'>, string> = {
  reschedule: 'reschedule',
  cancel: 'cancel',
  pay: 'pay',
  intake: 'intake',
  quote: 'quote',
  refund: 'refund',
};

/* RTL is handled by `wrapInBrandedTemplate` from the locale, so nothing here
   sets `dir` itself — doing both is how one ends up fighting the other after a
   template change. */
