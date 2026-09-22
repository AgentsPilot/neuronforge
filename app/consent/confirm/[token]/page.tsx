/**
 * "Confirm your subscription" — the page the emailed link opens.
 *
 * ONE CLICK. Arriving here from a real click on the email's button IS the
 * confirmation: the record is written before the page renders, and what loads
 * is already "confirmed". Sending somebody a link that opens a page with
 * another button on it asks them to agree twice to the same thing.
 *
 * The exception is a request that does not look like a person clicking. Mail
 * gateways and Safe Links fetch every URL in an email before the recipient sees
 * it, and a link that confirmed for THEM would subscribe someone who never
 * acted — the precise failure double opt-in exists to prevent. Those get the
 * button instead, which a scanner cannot press. See `looksLikeHumanClick`.
 *
 * Built from `PublicShell` and `StatusCard` like the quote, the invoice and the
 * booking-management pages, so it wears the business's own template rather than
 * the platform's default. For most people this is the second thing they will
 * ever have seen from that business, and it has to be recognisable as theirs.
 *
 * Public, outside `(protected)`: the person confirming has no account here and
 * never will.
 */

import type { Metadata } from 'next';
import { headers } from 'next/headers';

import { ConfirmButton } from './ConfirmButton';
import { BrandButton } from '@/components/public/BrandButton';
import { PublicShell } from '@/components/public/PublicShell';
import { StatusCard } from '@/components/public/StatusCard';
import { resolvePublicBranding } from '@/lib/branding/publicBranding';
import { verifyConsentConfirmToken } from '@/lib/consent/confirmToken';
import { confirmConsent, looksLikeHumanClick } from '@/lib/consent/confirmConsent';
import { resolveStatement } from '@/lib/consent/defaultStatements';
import { marketingConsentRepository } from '@/lib/repositories/MarketingConsentRepository';
import type { Locale } from '@/lib/i18n/config';

export const metadata: Metadata = {
  title: 'Confirm your subscription',
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ token: string }>;
}

const COPY = {
  en: {
    heading: 'Confirm your subscription',
    lead: (b: string) => `Press the button to confirm you want emails from ${b}.`,
    agreed: 'What you agreed to:',
    button: 'Confirm subscription',
    doneTitle: 'Confirmed',
    done: 'Thank you. You are on the list.',
    alreadyTitle: 'Already confirmed',
    already: 'This was confirmed earlier. There is nothing more to do.',
    problemTitle: 'This link did not work',
    expired: 'It has expired. Sign up again to get a new one.',
    invalid: 'It is not a valid confirmation link.',
    failed: 'Something went wrong. Please try again.',
    ignoreTitle: 'Did not sign up?',
    ignore: 'Close this page. Nothing is subscribed unless you press the button.',
    website: 'Visit our website',
  },
  he: {
    heading: 'אישור ההרשמה',
    lead: (b: string) => `לחצו על הכפתור כדי לאשר שאתם רוצים לקבל דיוור מ${b}.`,
    agreed: 'זה מה שאישרתם:',
    button: 'אישור ההרשמה',
    doneTitle: 'ההרשמה אושרה',
    done: '.תודה. אתם ברשימה',
    alreadyTitle: 'ההרשמה כבר אושרה',
    already: '.האישור בוצע כבר קודם. אין צורך בפעולה נוספת',
    problemTitle: 'הקישור לא עבד',
    expired: '.הקישור פג תוקף. אפשר להירשם שוב ולקבל קישור חדש',
    invalid: '.זה אינו קישור אישור תקין',
    failed: '.משהו השתבש. אנא נסו שוב',
    ignoreTitle: '?לא נרשמתם',
    ignore: '.אפשר לסגור את הדף. שום הרשמה לא נוצרת בלי לחיצה על הכפתור',
    website: 'לאתר שלנו',
  },
  es: {
    heading: 'Confirma tu suscripción',
    lead: (b: string) => `Pulsa el botón para confirmar que quieres recibir correos de ${b}.`,
    agreed: 'Lo que aceptaste:',
    button: 'Confirmar suscripción',
    doneTitle: 'Confirmado',
    done: 'Gracias. Ya estás en la lista.',
    alreadyTitle: 'Ya estaba confirmado',
    already: 'Esto se confirmó antes. No hay nada más que hacer.',
    problemTitle: 'Este enlace no ha funcionado',
    expired: 'Ha caducado. Suscríbete de nuevo para recibir uno nuevo.',
    invalid: 'No es un enlace de confirmación válido.',
    failed: 'Algo salió mal. Inténtalo de nuevo.',
    ignoreTitle: '¿No te suscribiste?',
    ignore: 'Cierra esta página. No se crea ninguna suscripción si no pulsas el botón.',
    website: 'Ir a nuestra web',
  },
} as const;

export default async function ConsentConfirmPage({ params }: PageProps) {
  const { token } = await params;
  const verdict = verifyConsentConfirmToken(token);

  /*
   * An unreadable token names no business, so there is no template to wear and
   * the layout above renders this unbranded. Shown rather than 404'd: "this
   * link expired, sign up again" is an answer, and a not-found page is not.
   */
  if (!verdict.ok) {
    const t = COPY.en;
    return (
      <div className="min-h-screen px-4 py-8">
        <div className="mx-auto max-w-lg">
          <StatusCard
            standalone
            tone="warning"
            title={t.problemTitle}
            description={verdict.reason === 'expired' ? t.expired : t.invalid}
          />
        </div>
      </div>
    );
  }

  const { u: userId, e: email, l: tokenLocale } = verdict.payload;

  const requestHeaders = await headers();

  /*
   * The click IS the confirmation.
   *
   * Done before anything renders, so what the person sees is the finished
   * state rather than a second button asking them to agree again. Skipped when
   * the request does not look like a person clicking — see the note at the top
   * and `looksLikeHumanClick` — in which case the button below is what a real
   * visitor will press and what a scanner cannot.
   */
  const confirmed = looksLikeHumanClick(requestHeaders)
    ? await confirmConsent(token, {
        userAgent: requestHeaders.get('user-agent'),
        via: 'email_link',
      })
    : null;

  const [brand, { data: settings }] = await Promise.all([
    resolvePublicBranding({ by: 'userId', userId }),
    marketingConsentRepository.settings(userId),
  ]);

  const locale = ((brand?.locale ?? tokenLocale ?? 'en') as Locale) || 'en';
  const t = COPY[locale as keyof typeof COPY] ?? COPY.en;
  const businessName = brand?.businessName ?? 'this business';

  // Restated so the person confirms something specific rather than a bare
  // button, and so the wording on screen matches the wording in the email.
  const statement = resolveStatement({
    locale,
    businessName,
    tenantStatements: settings,
  });

  /*
   * Terminal states. Rendered inside the shell below so they still carry the
   * business's own frame: a client who just subscribed should not be dropped
   * onto a page that looks like it came from somewhere else.
   */
  const settled = confirmed?.ok ? (
    <StatusCard
      standalone
      inShell
      tone="success"
      title={confirmed.alreadyConfirmed ? t.alreadyTitle : t.doneTitle}
      description={confirmed.alreadyConfirmed ? t.already : t.done}
      actions={
        brand?.info.websiteUrl ? (
          <BrandButton href={brand.info.websiteUrl} variant="secondary">
            {t.website}
          </BrandButton>
        ) : undefined
      }
    />
  ) : confirmed && !confirmed.ok && confirmed.reason !== 'failed' ? (
    // A token that verified a moment ago but was refused on the way in:
    // capture switched off, or a race. Not offered a retry button, because
    // pressing it would produce the same answer.
    <StatusCard
      standalone
      inShell
      tone="warning"
      title={t.problemTitle}
      description={confirmed.reason === 'expired' ? t.expired : t.invalid}
    />
  ) : null;

  const body = settled ?? (
    <div className="space-y-4">
      <h1
        className="text-xl font-bold"
        style={{ color: 'var(--ap-text)', fontFamily: 'var(--ap-font-heading)' }}
      >
        {t.heading}
      </h1>

      <p style={{ color: 'var(--ap-text-muted)' }}>{t.lead(businessName)}</p>

      <div>
        <p className="mb-1 text-xs" style={{ color: 'var(--ap-text-muted)' }}>
          {t.agreed}
        </p>
        <blockquote
          className="apc-panel p-4"
          style={{
            background: 'var(--ap-surface)',
            border: '1px solid var(--ap-border)',
            color: 'var(--ap-text)',
          }}
        >
          {statement.text}
        </blockquote>
      </div>

      <ConfirmButton
        token={token}
        websiteUrl={brand?.info.websiteUrl ?? null}
        websiteLabel={t.website}
        labels={{
          button: t.button,
          done: t.done,
          doneTitle: t.doneTitle,
          already: t.already,
          alreadyTitle: t.alreadyTitle,
          expired: t.expired,
          invalid: t.invalid,
          failed: t.failed,
          problemTitle: t.problemTitle,
        }}
      />

      {/*
        The line that makes doing nothing a safe choice. Someone whose address
        a stranger typed in needs to know that closing the tab ends it.
      */}
      <div className="pt-2 text-sm" style={{ color: 'var(--ap-text-muted)' }}>
        <p className="font-semibold">{t.ignoreTitle}</p>
        <p>{t.ignore}</p>
      </div>

      <p className="text-xs" style={{ color: 'var(--ap-text-muted)', opacity: 0.7 }}>
        {email}
      </p>
    </div>
  );

  // No brand resolved: the business exists but has no public identity yet.
  // Render the same content on the platform's default frame rather than none.
  if (!brand) {
    return (
      <div className="min-h-screen px-4 py-8">
        <div className="mx-auto max-w-lg">{body}</div>
      </div>
    );
  }

  return (
    <PublicShell brand={brand} width="narrow" header={{ compact: true }}>
      {body}
    </PublicShell>
  );
}
