/**
 * The holding screen's words (invite-only signup Slice 5b; FR-24, FR-35).
 *
 * Shown to an account created from a champion's friend invite that has not
 * paid. Until 5c it says payment is coming soon and offers NO checkout, NO
 * price and NO plan name, and promises no email (FR-24: no reminders). It is
 * rendered in the invite's OWN language (C-8), never from `LanguageContext`.
 *
 * Hebrew is written gender-neutrally. Client-safe: plain data, no import.
 */

import type { InviteLocale } from './invitePageCopy';

export interface AwaitingPaymentCopy {
  title: string;
  heldHeading: string;
  heldBody: string;
  heldLater: string;
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

/** The invite's language when it is one of ours, English otherwise. */
export function awaitingPaymentCopyFor(language: string): { locale: InviteLocale; copy: AwaitingPaymentCopy } {
  const locale: InviteLocale = language === 'he' || language === 'es' ? language : 'en';
  return { locale, copy: AWAITING_PAYMENT_COPY[locale] };
}
