/**
 * The holding screen's words (invite-only signup Slice 5b; FR-24, FR-35).
 *
 * Shown to an account created from a champion's friend invite that has not
 * paid. Until 5c it says payment is coming soon and offers NO checkout, NO
 * price and NO plan name, and promises no email (FR-24: no reminders). It is
 * rendered in the invite's OWN language (C-8), never from `LanguageContext`.
 *
 * Hebrew is written gender-neutrally. Client-safe: plain data, and type-only
 * imports.
 *
 * ── Plan payments P-5a.2 (FR-35, AC-F2.7; workplan §3.3, SA W-7, W-10, Q-8) ──
 * When the held-payment switches are on, the same screen offers "Finish your
 * payment" (`pay*`) and then "Payment processing" (`processing*`). The
 * "coming soon" keys above stay exactly as they were: that screen is still
 * what every held friend sees while any switch is off.
 *
 * `payPrice` carries `{price}`, filled by the page with the formatted USD price
 * from the tier matrix (never a literal here). `refusalCheckoutOpen` carries
 * `{time}`, filled in the browser with the local time from `expiresAt`.
 * Refusals are localized by the route's `code` through
 * `HELD_PAYMENT_REFUSAL_COPY`, never with the server's English message; an
 * unknown code gets `refusalGeneric` (W-10).
 *
 * **The he and es wording of the P-5a.2 keys is a DRAFT** awaiting the user's
 * approval (workplan gate G-4), as for invite 5a.
 */

import type { PlanCheckoutRefusalCode } from '@/lib/business-os/billing/planCheckout';

import type { InviteLocale } from './invitePageCopy';

export interface AwaitingPaymentCopy {
  title: string;
  heldHeading: string;
  heldBody: string;
  heldLater: string;
  /** P-5a.2: the Pay state. */
  payTitle: string;
  payBody: string;
  payPlanLabel: string;
  payPrice: string;
  payButton: string;
  payStarting: string;
  payNotConfigured: string;
  /** P-5a.2: the Processing state. */
  processingTitle: string;
  processingBody: string;
  processingSlow: string;
  processingCheckAgain: string;
  /** P-5a.2: a refused start, by refusal code (W-10). */
  refusalNotOpen: string;
  refusalCheckoutOpen: string;
  refusalBusy: string;
  refusalSubscriptionLive: string;
  refusalNotReady: string;
  refusalEmailRequired: string;
  refusalSupport: string;
  refusalSignedOut: string;
  refusalGeneric: string;
  signOut: string;
  signingOut: string;
  signOutFailed: string;
  signedOutHeading: string;
  signedOutBody: string;
  signIn: string;
  errorHeading: string;
  errorBody: string;
  tryAgain: string;
}

export const AWAITING_PAYMENT_COPY: Record<InviteLocale, AwaitingPaymentCopy> = {
  en: {
    title: 'Payment coming soon',
    heldHeading: 'Your account is ready',
    heldBody: 'Payment for your plan is not open yet, so there is nothing to do here for now. There is no trial in the meantime.',
    heldLater: 'Sign in again later to finish.',
    payTitle: 'Finish your payment',
    payBody: 'Your account is ready. Pay for your plan to start using it.',
    payPlanLabel: 'Your plan',
    payPrice: '{price} a month, excluding tax',
    payButton: 'Pay',
    payStarting: 'Opening the payment…',
    payNotConfigured: 'The payment cannot be shown right now. Please try again later.',
    processingTitle: 'Payment processing',
    processingBody: 'Thank you. We are confirming your payment. This page moves on by itself as soon as it is done.',
    processingSlow: 'This is taking longer than usual. Refresh in a minute.',
    processingCheckAgain: 'Check again',
    refusalNotOpen: 'Payment for your invitation is not open yet. Please try again later.',
    refusalCheckoutOpen: 'A payment window is already open for your account until {time}. Finish it there, or try again after that time.',
    refusalBusy: 'A payment is already being opened. Please wait a moment and try again.',
    refusalSubscriptionLive: 'You already have a subscription. Refresh this page in a minute.',
    refusalNotReady: 'Your account is not ready for payment yet. Please try again later, or contact support.',
    refusalEmailRequired: 'Your account needs an email address before you can pay. Please contact support.',
    refusalSupport: 'We could not set up billing for your account. Please contact support.',
    refusalSignedOut: 'Your session has ended. Please sign in again.',
    refusalGeneric: 'We could not start the payment. Please try again.',
    signOut: 'Sign out',
    signingOut: 'Signing out…',
    signOutFailed: 'Could not sign out. Please try again.',
    signedOutHeading: 'Please sign in',
    signedOutBody: 'Sign in to see where your account stands.',
    signIn: 'Sign in',
    errorHeading: 'Something went wrong',
    errorBody: 'We could not load your account just now. Please try again in a moment.',
    tryAgain: 'Try again',
  },
  he: {
    title: 'התשלום ייפתח בקרוב',
    heldHeading: 'החשבון מוכן',
    heldBody: 'התשלום על התוכנית עדיין לא נפתח, ולכן אין כאן כרגע מה לעשות. בינתיים אין תקופת ניסיון.',
    heldLater: 'אפשר להתחבר שוב מאוחר יותר כדי להשלים.',
    payTitle: 'השלמת התשלום',
    payBody: 'החשבון מוכן. נשאר רק לשלם על התוכנית כדי להתחיל להשתמש בה.',
    payPlanLabel: 'התוכנית',
    payPrice: '{price} לחודש, לא כולל מס',
    payButton: 'לתשלום',
    payStarting: 'פותחים את התשלום…',
    payNotConfigured: 'לא ניתן להציג את התשלום כרגע. כדאי לנסות שוב מאוחר יותר.',
    processingTitle: 'התשלום בעיבוד',
    processingBody: 'תודה. אנחנו מאשרים את התשלום. הדף ימשיך לבד ברגע שזה יסתיים.',
    processingSlow: 'זה לוקח יותר זמן מהרגיל. כדאי לרענן בעוד דקה.',
    processingCheckAgain: 'לבדוק שוב',
    refusalNotOpen: 'התשלום על ההזמנה עדיין לא נפתח. כדאי לנסות שוב מאוחר יותר.',
    refusalCheckoutOpen: 'חלון תשלום כבר פתוח עבור החשבון עד {time}. אפשר להשלים אותו שם, או לנסות שוב אחרי השעה הזו.',
    refusalBusy: 'התשלום כבר נפתח. כדאי לחכות רגע ולנסות שוב.',
    refusalSubscriptionLive: 'כבר יש מינוי לחשבון. כדאי לרענן את הדף בעוד דקה.',
    refusalNotReady: 'החשבון עדיין לא מוכן לתשלום. כדאי לנסות שוב מאוחר יותר או לפנות לתמיכה.',
    refusalEmailRequired: 'כדי לשלם צריך כתובת אימייל בחשבון. יש לפנות לתמיכה.',
    refusalSupport: 'לא הצלחנו להגדיר חיוב עבור החשבון. יש לפנות לתמיכה.',
    refusalSignedOut: 'החיבור הסתיים. יש להתחבר שוב.',
    refusalGeneric: 'לא הצלחנו להתחיל את התשלום. כדאי לנסות שוב.',
    signOut: 'התנתקות',
    signingOut: 'מתנתקים…',
    signOutFailed: 'לא הצלחנו לנתק. כדאי לנסות שוב.',
    signedOutHeading: 'יש להתחבר',
    signedOutBody: 'אחרי ההתחברות אפשר לראות את מצב החשבון.',
    signIn: 'התחברות',
    errorHeading: 'משהו השתבש',
    errorBody: 'לא הצלחנו לטעון את החשבון כרגע. כדאי לנסות שוב בעוד רגע.',
    tryAgain: 'לנסות שוב',
  },
  es: {
    title: 'El pago estará disponible pronto',
    heldHeading: 'Tu cuenta está lista',
    heldBody: 'El pago de tu plan todavía no está disponible, así que por ahora no hay nada que hacer aquí. Mientras tanto no hay periodo de prueba.',
    heldLater: 'Vuelve a iniciar sesión más adelante para terminar.',
    payTitle: 'Completa tu pago',
    payBody: 'Tu cuenta está lista. Solo falta pagar tu plan para empezar a usarla.',
    payPlanLabel: 'Tu plan',
    payPrice: '{price} al mes, impuestos no incluidos',
    payButton: 'Pagar',
    payStarting: 'Abriendo el pago…',
    payNotConfigured: 'No se puede mostrar el pago en este momento. Inténtalo de nuevo más tarde.',
    processingTitle: 'Pago en proceso',
    processingBody: 'Gracias. Estamos confirmando tu pago. Esta página continuará sola en cuanto termine.',
    processingSlow: 'Esto está tardando más de lo habitual. Actualiza la página en un minuto.',
    processingCheckAgain: 'Comprobar de nuevo',
    refusalNotOpen: 'El pago de tu invitación todavía no está disponible. Inténtalo de nuevo más tarde.',
    refusalCheckoutOpen: 'Ya hay una ventana de pago abierta para tu cuenta hasta las {time}. Complétala allí o inténtalo de nuevo después de esa hora.',
    refusalBusy: 'Ya se está abriendo un pago. Espera un momento e inténtalo de nuevo.',
    refusalSubscriptionLive: 'Ya tienes una suscripción. Actualiza esta página en un minuto.',
    refusalNotReady: 'Tu cuenta todavía no está lista para el pago. Inténtalo más tarde o contacta con soporte.',
    refusalEmailRequired: 'Tu cuenta necesita una dirección de correo electrónico para poder pagar. Contacta con soporte.',
    refusalSupport: 'No pudimos configurar la facturación de tu cuenta. Contacta con soporte.',
    refusalSignedOut: 'Tu sesión ha terminado. Vuelve a iniciar sesión.',
    refusalGeneric: 'No pudimos iniciar el pago. Inténtalo de nuevo.',
    signOut: 'Cerrar sesión',
    signingOut: 'Cerrando sesión…',
    signOutFailed: 'No se pudo cerrar la sesión. Inténtalo de nuevo.',
    signedOutHeading: 'Inicia sesión',
    signedOutBody: 'Inicia sesión para ver el estado de tu cuenta.',
    signIn: 'Iniciar sesión',
    errorHeading: 'Algo salió mal',
    errorBody: 'No pudimos cargar tu cuenta ahora mismo. Inténtalo de nuevo en un momento.',
    tryAgain: 'Intentar de nuevo',
  },
};

type RefusalCopyKey = Extract<keyof AwaitingPaymentCopy, `refusal${string}`>;

/**
 * Every code the checkout route can send the holding screen, to its line (W-10,
 * Q-8). `not_available` is the route's 404 (a switch turned off after the page
 * rendered) and `invalid_input` its 400. Typed over `PlanCheckoutRefusalCode`,
 * so a new refusal code fails the build until it is given a line here.
 */
export const HELD_PAYMENT_REFUSAL_COPY: Readonly<Record<PlanCheckoutRefusalCode | 'not_available' | 'invalid_input', RefusalCopyKey>> = {
  not_available: 'refusalNotOpen',
  held_payment_unavailable: 'refusalNotOpen',
  held_tier_unresolved: 'refusalNotOpen',
  held_tier_not_allowed: 'refusalNotOpen',
  checkout_unavailable: 'refusalNotOpen',
  price_unavailable: 'refusalNotOpen',
  price_mismatch: 'refusalNotOpen',
  lock_unavailable: 'refusalNotOpen',
  checkout_open: 'refusalCheckoutOpen',
  checkout_busy: 'refusalBusy',
  retry_later: 'refusalBusy',
  subscription_live: 'refusalSubscriptionLive',
  no_plan_row: 'refusalNotReady',
  email_required: 'refusalEmailRequired',
  billing_record_conflict: 'refusalSupport',
  hold_unreadable: 'refusalGeneric',
  plan_unreadable: 'refusalGeneric',
  billing_row_unreadable: 'refusalGeneric',
  subscription_check_incomplete: 'refusalGeneric',
  stripe_error: 'refusalGeneric',
  invalid_input: 'refusalGeneric',
};

/**
 * The holding screen's line for a refused start. Never the server's English:
 * by `code`, then 401 → signed out, anything else → `refusalGeneric`.
 * `formatTime` turns `expiresAt` into the visitor's local time; without a
 * readable expiry the `checkout_open` line falls back to `refusalBusy`.
 */
export function heldPaymentRefusalMessage(
  copy: AwaitingPaymentCopy,
  refusal: { httpStatus: number; code: string | null; expiresAt: string | null },
  formatTime: (iso: string) => string | null
): string {
  const key =
    refusal.code !== null && Object.prototype.hasOwnProperty.call(HELD_PAYMENT_REFUSAL_COPY, refusal.code)
      ? HELD_PAYMENT_REFUSAL_COPY[refusal.code as keyof typeof HELD_PAYMENT_REFUSAL_COPY]
      : refusal.httpStatus === 401
        ? 'refusalSignedOut'
        : 'refusalGeneric';
  if (key === 'refusalCheckoutOpen') {
    const time = refusal.expiresAt ? formatTime(refusal.expiresAt) : null;
    return time ? copy.refusalCheckoutOpen.replace('{time}', time) : copy.refusalBusy;
  }
  return copy[key];
}

/** The invite's language when it is one of ours, English otherwise. */
export function awaitingPaymentCopyFor(language: string): { locale: InviteLocale; copy: AwaitingPaymentCopy } {
  const locale: InviteLocale = language === 'he' || language === 'es' ? language : 'en';
  return { locale, copy: AWAITING_PAYMENT_COPY[locale] };
}
