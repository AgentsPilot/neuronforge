/**
 * "You are unsubscribed" — the page the email's unsubscribe link opens.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ARRIVING HERE IS THE UNSUBSCRIBE. No button, no confirmation step.
 *
 * Its sibling — the subscription confirmation — does the opposite and asks a
 * scanner to prove it is a person first, because a prefetched link must never
 * subscribe somebody who did not act. Here the asymmetry runs the other way: if
 * a mail gateway prefetches this and takes a person off a list they never
 * wanted, nothing is harmed. Making somebody click twice to LEAVE, so that a
 * scanner cannot, gets the risk backwards and is the behaviour regulators
 * describe as making withdrawal harder than consent.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT SAYS WHAT STOPS AND WHAT DOES NOT.
 *
 * The one thing this page must not do is imply the business has gone quiet.
 * Appointment confirmations, reminders, invoices and receipts keep coming:
 * those are about something the person actually did, they are not marketing,
 * and `sendEmail` never gates them on consent. A page that said "you will not
 * hear from us again" would be a promise the next receipt breaks.
 *
 * Public, outside `(protected)`: the person unsubscribing has no account here
 * and never will.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { Metadata } from 'next';
import { headers } from 'next/headers';

import { BrandButton } from '@/components/public/BrandButton';
import { StatusCard } from '@/components/public/StatusCard';
import { resolvePublicBranding } from '@/lib/branding/publicBranding';
import { verifyUnsubscribeToken } from '@/lib/consent/unsubscribeToken';
import { withdrawConsent } from '@/lib/consent/withdrawConsent';
import type { Locale } from '@/lib/i18n/config';

export const metadata: Metadata = {
  title: 'Unsubscribed',
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ token: string }>;
}

const COPY = {
  en: {
    doneTitle: 'You are unsubscribed',
    done: (b: string) => `You will not receive marketing emails from ${b} any more.`,
    alreadyTitle: 'Already unsubscribed',
    already: (b: string) => `You were already off ${b}'s marketing list. Nothing has changed.`,
    stillTitle: 'What you will still receive',
    still:
      'Anything about something you actually did still reaches you: appointment confirmations and reminders, invoices and receipts. Those are not marketing and cannot be switched off here.',
    problemTitle: 'This link did not work',
    invalid: 'It is not a valid unsubscribe link. If you keep receiving emails, reply to one and ask to be removed.',
    failed: 'Something went wrong and you have NOT been unsubscribed. Please try the link again.',
    website: 'Visit our website',
  },
  he: {
    doneTitle: 'הוסרתם מרשימת התפוצה',
    done: (b: string) => `לא תקבלו יותר מיילים שיווקיים מ${b}.`,
    alreadyTitle: 'כבר הוסרתם',
    already: (b: string) => `כבר לא הייתם ברשימת הדיוור של ${b}. שום דבר לא השתנה.`,
    stillTitle: 'מה כן תמשיכו לקבל',
    still:
      'כל מה שקשור למשהו שבאמת עשיתם ימשיך להגיע אליכם: אישורי פגישות ותזכורות, חשבוניות וקבלות. אלה אינם דיוור שיווקי ואי אפשר לבטל אותם כאן.',
    problemTitle: 'הקישור לא עבד',
    invalid: 'זה אינו קישור הסרה תקין. אם אתם ממשיכים לקבל מיילים, השיבו לאחד מהם ובקשו להסיר אתכם.',
    failed: 'משהו השתבש ולא הוסרתם. אנא נסו את הקישור שוב.',
    website: 'לאתר שלנו',
  },
  es: {
    doneTitle: 'Te has dado de baja',
    done: (b: string) => `Ya no recibirás correos de marketing de ${b}.`,
    alreadyTitle: 'Ya estabas dado de baja',
    already: (b: string) => `Ya no estabas en la lista de ${b}. No ha cambiado nada.`,
    stillTitle: 'Lo que sí seguirás recibiendo',
    still:
      'Todo lo relacionado con algo que hiciste sigue llegándote: confirmaciones y recordatorios de citas, facturas y recibos. Eso no es marketing y no puede desactivarse aquí.',
    problemTitle: 'Este enlace no ha funcionado',
    invalid: 'No es un enlace de baja válido. Si sigues recibiendo correos, responde a uno y pide que te quiten.',
    failed: 'Algo salió mal y NO te has dado de baja. Inténtalo de nuevo.',
    website: 'Ir a nuestra web',
  },
} as const;

export default async function UnsubscribePage({ params }: PageProps) {
  const { token } = await params;
  const payload = verifyUnsubscribeToken(token);

  /*
   * An unreadable token names no business, so there is no template to wear and
   * the layout renders this unbranded. Shown rather than 404'd: a person who
   * wants out deserves to be told what to do instead, and a not-found page
   * tells them nothing.
   */
  if (!payload) {
    const t = COPY.en;
    return (
      <div className="min-h-screen px-4 py-8">
        <div className="mx-auto max-w-lg">
          <StatusCard standalone tone="warning" title={t.problemTitle} description={t.invalid} />
        </div>
      </div>
    );
  }

  const requestHeaders = await headers();

  const [outcome, brand] = await Promise.all([
    withdrawConsent(token, {
      userAgent: requestHeaders.get('user-agent'),
      via: 'unsubscribe_link',
    }),
    resolvePublicBranding({ by: 'userId', userId: payload.userId }),
  ]);

  const locale = ((brand?.locale ?? 'en') as Locale) || 'en';
  const t = COPY[locale as keyof typeof COPY] ?? COPY.en;
  const businessName = brand?.businessName ?? 'this business';

  /*
   * A failure says so, plainly, and does NOT pretend. Somebody who closes this
   * page believing they are off a list they are still on will next see a
   * marketing email and have no reason to trust the link a second time.
   */
  if (!outcome.ok) {
    return (
      <StatusCard
        standalone
        inShell
        tone="warning"
        title={t.problemTitle}
        description={outcome.reason === 'failed' ? t.failed : t.invalid}
      />
    );
  }

  return (
    <div className="space-y-4">
      <StatusCard
        standalone
        inShell
        tone="success"
        title={outcome.alreadyOff ? t.alreadyTitle : t.doneTitle}
        description={
          outcome.alreadyOff ? t.already(businessName) : t.done(businessName)
        }
        actions={
          brand?.info.websiteUrl ? (
            <BrandButton href={brand.info.websiteUrl} variant="secondary">
              {t.website}
            </BrandButton>
          ) : undefined
        }
      />

      {/* The half that stops this page being a promise the next receipt breaks. */}
      <StatusCard standalone inShell tone="info" title={t.stillTitle} description={t.still} />
    </div>
  );
}
