/**
 * The invite page's words, in the three languages an invite can carry
 * (`en`, `he`, `es`; requirement FR-8, FR-9, T-12).
 *
 * The page renders in the invite's OWN language, which the server returns from
 * the invite row (C-8). It never reads the browser's language and never uses
 * `LanguageContext`: a stored preference or a browser setting is a suggestion,
 * and the admin's explicit choice on the invite is the answer.
 *
 * Plan and capability names are NOT here. They arrive from the server, from the
 * entitlements config, and are English placeholders in every locale today
 * (SA ruling F-4), exactly as on the customer "Your plan" section.
 *
 * Hebrew is written gender-neutrally, because the page cannot know who is
 * reading it or who sent it.
 *
 * Client-safe: plain data and pure functions, no server import.
 */

export type InviteLocale = 'en' | 'he' | 'es';

/** Unicode LEFT-TO-RIGHT ISOLATE and POP DIRECTIONAL ISOLATE (QA-6). */
export const LTR_ISOLATE = '\u2066';
export const POP_ISOLATE = '\u2069';

export const INVITE_LOCALES: readonly InviteLocale[] = ['en', 'he', 'es'];

export interface InvitePageCopy {
  loading: string;
  validHeading: (name: string) => string;
  noteHeading: (name: string) => string;
  offerHeading: string;
  free: string;
  perMonth: (priceUsd: number) => string;
  paymentRequired: string;
  accessOpenEnded: string;
  accessMonths: (months: number) => string;
  accessWhilePaid: string;
  includedHeading: string;
  linkExpires: (date: string) => string;
  /** R-4 (SA ruling F-10): the Slice 0 line on a valid invite. Removed by Slice 1. */
  signupNotYet: (name: string) => string;
  expiredHeading: string;
  revokedHeading: string;
  usedHeading: string;
  unavailableHeading: string;
  askForNew: (name: string) => string;
  usedBody: string;
  signIn: string;
  /** Slice 1a (FR-8a): the invited email already has an account. */
  existingAccountHeading: string;
  existingAccountBody: string;
  /** Slice 1a (L-8): someone is already signed in on this browser. */
  signedInHeading: (email: string | null) => string;
  signedInBody: string;
  signOut: string;
  signingOut: string;
  notRecognisedHeading: string;
  notRecognisedBody: string;
  errorHeading: string;
  retry: string;
}

export const INVITE_PAGE_COPY: Record<InviteLocale, InvitePageCopy> = {
  en: {
    loading: 'Checking your invitation…',
    validHeading: (name) => `${name} invited you`,
    noteHeading: (name) => `A note from ${name}`,
    offerHeading: 'What you are offered',
    free: 'Free',
    perMonth: (price) => `$${price} per month`,
    paymentRequired: 'Payment is required at signup.',
    accessOpenEnded: 'No end date',
    accessMonths: (months) => (months === 1 ? '1 month from signup' : `${months} months from signup`),
    accessWhilePaid: 'While the plan is paid for',
    includedHeading: 'What it includes',
    linkExpires: (date) => `You can accept this invitation until ${date}.`,
    signupNotYet: (name) => `You can't create your account from this page yet. ${name} will let you know when you can.`,
    expiredHeading: 'This invitation has expired',
    revokedHeading: 'This invitation was withdrawn',
    usedHeading: 'This invitation has already been used',
    unavailableHeading: 'This invitation is no longer available',
    askForNew: (name) => `Ask ${name} for a new one.`,
    usedBody: 'If you already have an account, sign in instead.',
    signIn: 'Sign in',
    existingAccountHeading: 'You already have an account',
    existingAccountBody:
      'This invitation was sent to an email address that already has an account. Sign in to continue. Nothing about your account has changed.',
    signedInHeading: (email) => (email ? `You're signed in as ${email}` : "You're already signed in"),
    signedInBody: 'An invitation can only be accepted by someone who is signed out. Sign out to continue.',
    signOut: 'Sign out',
    signingOut: 'Signing out…',
    notRecognisedHeading: "We don't recognise this invitation",
    notRecognisedBody: 'Check that you opened the whole link, or ask the person who invited you for a new one.',
    errorHeading: "We couldn't check your invitation just now. Please try again.",
    retry: 'Try again',
  },
  he: {
    loading: 'בודקים את ההזמנה…',
    validHeading: (name) => `קיבלת הזמנה מאת ${name}`,
    noteHeading: (name) => `הודעה מאת ${name}`,
    offerHeading: 'מה מוצע לך',
    free: 'חינם',
    perMonth: (price) => `$${price} לחודש`,
    paymentRequired: 'נדרש תשלום בעת ההרשמה.',
    accessOpenEnded: 'ללא תאריך סיום',
    accessMonths: (months) => (months === 1 ? 'חודש אחד מההרשמה' : `${months} חודשים מההרשמה`),
    accessWhilePaid: 'כל עוד התוכנית בתשלום',
    includedHeading: 'מה כלול',
    linkExpires: (date) => `אפשר לקבל את ההזמנה עד ${date}.`,
    signupNotYet: (name) => `עדיין אי אפשר ליצור חשבון מהעמוד הזה. עדכון יגיע מאת ${name} כשזה יתאפשר.`,
    expiredHeading: 'תוקף ההזמנה פג',
    revokedHeading: 'ההזמנה בוטלה',
    usedHeading: 'כבר נעשה שימוש בהזמנה הזו',
    unavailableHeading: 'ההזמנה הזו כבר אינה זמינה',
    askForNew: (name) => `אפשר לבקש הזמנה חדשה מאת ${name}.`,
    usedBody: 'אם כבר יש לך חשבון, אפשר פשוט להתחבר.',
    signIn: 'התחברות',
    existingAccountHeading: 'כבר יש חשבון עם כתובת המייל הזו',
    existingAccountBody:
      'ההזמנה נשלחה לכתובת מייל שכבר יש לה חשבון. אפשר להתחבר כדי להמשיך. שום דבר בחשבון לא השתנה.',
    // QA-6: the email is wrapped in a left-to-right isolate (U+2066 … U+2069),
    // so its characters keep their order inside the right-to-left sentence.
    signedInHeading: (email) =>
      email ? `החיבור הנוכחי הוא כ־${LTR_ISOLATE}${email}${POP_ISOLATE}` : 'יש כבר חיבור פעיל בדפדפן הזה',
    signedInBody: 'אפשר לקבל הזמנה רק כשאין חיבור פעיל. צריך להתנתק כדי להמשיך.',
    signOut: 'התנתקות',
    signingOut: 'מתנתקים…',
    notRecognisedHeading: 'לא זיהינו את ההזמנה הזו',
    notRecognisedBody: 'כדאי לבדוק שנפתח הקישור המלא, או לבקש הזמנה חדשה ממי ששלח אותה.',
    errorHeading: 'לא הצלחנו לבדוק את ההזמנה כרגע. אפשר לנסות שוב.',
    retry: 'לנסות שוב',
  },
  es: {
    loading: 'Comprobando tu invitación…',
    validHeading: (name) => `${name} te ha invitado`,
    noteHeading: (name) => `Un mensaje de ${name}`,
    offerHeading: 'Lo que se te ofrece',
    free: 'Gratis',
    perMonth: (price) => `$${price} al mes`,
    paymentRequired: 'Se requiere el pago al registrarte.',
    accessOpenEnded: 'Sin fecha de fin',
    accessMonths: (months) => (months === 1 ? '1 mes desde el registro' : `${months} meses desde el registro`),
    accessWhilePaid: 'Mientras el plan esté pagado',
    includedHeading: 'Qué incluye',
    linkExpires: (date) => `Puedes aceptar esta invitación hasta el ${date}.`,
    signupNotYet: (name) => `Todavía no puedes crear tu cuenta desde esta página. ${name} te avisará cuando puedas.`,
    expiredHeading: 'Esta invitación ha caducado',
    revokedHeading: 'Esta invitación fue retirada',
    usedHeading: 'Esta invitación ya se ha utilizado',
    unavailableHeading: 'Esta invitación ya no está disponible',
    askForNew: (name) => `Pide a ${name} una nueva.`,
    usedBody: 'Si ya tienes una cuenta, inicia sesión.',
    signIn: 'Iniciar sesión',
    existingAccountHeading: 'Ya tienes una cuenta',
    existingAccountBody:
      'Esta invitación se envió a un correo que ya tiene una cuenta. Inicia sesión para continuar. No ha cambiado nada en tu cuenta.',
    signedInHeading: (email) => (email ? `Has iniciado sesión como ${email}` : 'Ya has iniciado sesión'),
    signedInBody: 'Solo se puede aceptar una invitación sin haber iniciado sesión. Cierra la sesión para continuar.',
    signOut: 'Cerrar sesión',
    signingOut: 'Cerrando sesión…',
    notRecognisedHeading: 'No reconocemos esta invitación',
    notRecognisedBody: 'Comprueba que abriste el enlace completo o pide una nueva a quien te invitó.',
    errorHeading: 'No pudimos comprobar tu invitación en este momento. Inténtalo de nuevo.',
    retry: 'Reintentar',
  },
};

/** The locale to render: the invite's own, or English for anything else. */
export function inviteLocaleOf(language: string | null | undefined): InviteLocale {
  return (INVITE_LOCALES as readonly string[]).includes(language ?? '') ? (language as InviteLocale) : 'en';
}

/** Right-to-left for Hebrew. */
export function directionOf(locale: InviteLocale): 'rtl' | 'ltr' {
  return locale === 'he' ? 'rtl' : 'ltr';
}
