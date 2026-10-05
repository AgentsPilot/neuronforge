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
 * entitlements config, already in the invite's language (credit deduction
 * slice 6, OI-10), with the value phrases ("per month", "in total") and the
 * numbers grouped the same way. Neither are any credit figures: those come from
 * config through the resolver, never from this file.
 *
 * Hebrew is written gender-neutrally, because the page cannot know who is
 * reading it or who sent it.
 *
 * Client-safe: plain data and pure functions, no server import.
 */

import { CREDIT_EXPLANATION } from '@/lib/i18n/creditExplanation';

export type InviteLocale = 'en' | 'he' | 'es';

/** Unicode LEFT-TO-RIGHT ISOLATE and POP DIRECTIONAL ISOLATE (QA-6). */
export const LTR_ISOLATE = '\u2066';
export const POP_ISOLATE = '\u2069';

export const INVITE_LOCALES: readonly InviteLocale[] = ['en', 'he', 'es'];

export interface InvitePageCopy {
  loading: string;
  /** The small label above a valid invite's heading. Layout only. */
  eyebrow: string;
  validHeading: (name: string) => string;
  noteHeading: (name: string) => string;
  offerHeading: string;
  free: string;
  perMonth: (priceUsd: number) => string;
  /** Not rendered in 5b (SA CR-1): kept for 5c, when payment at signup is live. */
  paymentRequired: string;
  /**
   * Slice 5b (workplan D-11): under a PAID offer's signup form, while payment is
   * not live. Honest before signup: the account waits, with no trial.
   */
  paymentOpensLater: string;
  accessOpenEnded: string;
  accessMonths: (months: number) => string;
  accessWhilePaid: string;
  includedHeading: string;
  /**
   * Headings for the rows under `includedHeading`, keyed by the `labelKey` that
   * `describePlanOffer` returns.
   *
   * The entitlements module names these rather than wording them, because it
   * cannot reach translations. They are repeated here rather than read from
   * `LanguageContext` for the reason at the top of this file: this page renders
   * in the INVITE's language and ignores the viewer's entirely, so it cannot use
   * a viewer-scoped dictionary. Keep the wording in step with the
   * `plan.category.*` entries there.
   */
  planCategory: Record<string, string>;
  /**
   * The sentence under a row, keyed by the `noteKey` that `describePlanOffer`
   * returns (credit deduction slice 6, D-h). Today only the credits row has one.
   *
   * The wording is NOT repeated here: it is the shared `CREDIT_EXPLANATION`,
   * which the dashboard card and the plan screen read through `LanguageContext`
   * under the same keys — so the three surfaces cannot say different things.
   */
  planCategoryNote: Record<string, string>;
  linkExpires: (date: string) => string;
  /** Slice 1b: the signup form (FR-11). */
  signup: SignupCopy;
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

/**
 * The signup form's words (Slice 1b). Error messages are keyed by the server's
 * machine-readable error code, so the page never guesses what went wrong.
 */
export interface SignupCopy {
  heading: string;
  /** "Step 1 of 2" above the form's heading. Layout only. */
  stepOf: (step: number, total: number) => string;
  codeWillGoTo: (maskedEmail: string) => string;
  sendCode: string;
  sending: string;
  codeSentTo: (maskedEmail: string) => string;
  codeLabel: string;
  passwordLabel: string;
  passwordHint: string;
  confirmLabel: string;
  create: string;
  creating: string;
  resend: string;
  readyHeading: string;
  readyBody: string;
  /** Slice 3b: "Continue with Google" (FR-11). Shown only when it is configured. */
  google: GoogleSignupCopy;
  errors: {
    code_format: string;
    password_short: string;
    password_long: string;
    password_mismatch: string;
    code_invalid: (attemptsRemaining: number) => string;
    code_expired: string;
    code_locked: string;
    code_recently_sent: (seconds: number) => string;
    code_limit_reached: string;
    code_not_sent: string;
    existing_account: string;
    signup_in_progress: string;
    signed_in: string;
    weak_password: string;
    no_longer_available: string;
    generic: string;
  };
}

/**
 * The Google button's words (Slice 3b). The button's own label ("Continue with
 * Google") is drawn by Google in the invite's language, so it is not here.
 * Every refusal points to the path that works: the emailed code (SA R-8).
 */
export interface GoogleSignupCopy {
  /** Between the Google button and the code form. */
  divider: string;
  creating: string;
  readyHeading: string;
  readyBody: string;
  errors: {
    google_email_mismatch: (maskedEmail: string) => string;
    google_email_unverified: string;
    /** SA R-2: Google is not authoritative for this address. */
    google_use_code: string;
    google_token_invalid: string;
  };
}

export const INVITE_PAGE_COPY: Record<InviteLocale, InvitePageCopy> = {
  en: {
    loading: 'Checking your invitation…',
    eyebrow: 'Your invitation',
    validHeading: (name) => `${name} invited you`,
    noteHeading: (name) => `A note from ${name}`,
    offerHeading: 'What you are offered',
    free: 'Free',
    perMonth: (price) => `$${price} per month`,
    paymentRequired: 'Payment is required at signup.',
    paymentOpensLater: "You can create your account now. Payment opens soon, and you'll be able to use AgentPilot once you've paid.",
    accessOpenEnded: 'No end date',
    accessMonths: (months) => (months === 1 ? '1 month from signup' : `${months} months from signup`),
    accessWhilePaid: 'While the plan is paid for',
    includedHeading: 'What it includes',
    planCategory: {
      'plan.category.credits': 'Credits',
      'plan.category.crm': 'Clients (CRM)',
      'plan.category.website_intake': 'Website and enquiries',
      'plan.category.payments': 'Payments',
      'plan.category.ai_chat': 'AI assistant',
      'plan.category.marketing': 'Marketing',
      'plan.category.insights': 'Insights',
      'plan.category.support': 'Support',
      'plan.category.platform': 'Platform',
      'plan.category.addon': 'Add-ons',
    },
    planCategoryNote: {
      'usage.explain.monthly': CREDIT_EXPLANATION.en.monthly,
      'usage.explain.trial': CREDIT_EXPLANATION.en.trial,
    },
    linkExpires: (date) => `You can accept this invitation until ${date}.`,
    signup: {
      heading: 'Create your account',
      stepOf: (step, total) => `Step ${step} of ${total}`,
      codeWillGoTo: (masked) => `We'll email a 6-digit code to ${masked} to confirm it's you.`,
      sendCode: 'Send me a code',
      sending: 'Sending…',
      codeSentTo: (masked) => `We sent a 6-digit code to ${masked}. It is valid for 10 minutes.`,
      codeLabel: '6-digit code',
      passwordLabel: 'Choose a password',
      passwordHint: 'At least 8 characters.',
      confirmLabel: 'Confirm the password',
      create: 'Create my account',
      creating: 'Creating your account…',
      resend: 'Send a new code',
      readyHeading: 'Your account is ready',
      readyBody: 'Sign in with your email and the password you just chose.',
      google: {
        divider: 'or',
        creating: 'Creating your account…',
        readyHeading: 'Your account is ready',
        readyBody: 'Sign in with Google to continue.',
        errors: {
          google_email_mismatch: (masked) =>
            `This invitation is for ${masked}, and the Google account you chose uses a different address. Choose the Google account for ${masked}, or use the emailed code below.`,
          google_email_unverified: 'Google has not confirmed the address on that account. Please use the emailed code below.',
          google_use_code: 'For this address, please use the emailed code below.',
          google_token_invalid: 'Google sign-in did not complete. Please try again, or use the emailed code below.',
        },
      },
      errors: {
        code_format: 'Enter the 6 digits from the email.',
        password_short: 'The password needs at least 8 characters.',
        password_long: 'That password is too long. Please choose a shorter one.',
        password_mismatch: 'The two passwords do not match.',
        code_invalid: (left) => (left === 1 ? 'That code is not right. 1 try left.' : `That code is not right. ${left} tries left.`),
        code_expired: 'That code has expired. Send a new one.',
        code_locked: 'Too many wrong tries for this code. Send a new one.',
        code_recently_sent: (seconds) => `A code was just sent. You can ask for another in ${seconds} seconds.`,
        code_limit_reached: 'Too many codes were sent today. Please try again tomorrow.',
        code_not_sent: 'We could not send the email just now. Please try again.',
        existing_account: 'This email already has an account. Sign in instead.',
        signup_in_progress: 'This invitation is being used right now. Please wait a moment and try again.',
        signed_in: 'Sign out before accepting this invitation.',
        // SA N-1: the code was used up by this attempt, so a new one is needed.
        weak_password: 'That password is too easy to guess. Send a new code, then choose another password.',
        no_longer_available: 'This invitation can no longer be used.',
        generic: 'Something went wrong. Please try again.',
      },
    },
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
    // SA N-1: reads correctly on both a valid and an existing-account invite.
    signedInBody: 'Sign out to continue with this invitation.',
    signOut: 'Sign out',
    signingOut: 'Signing out…',
    notRecognisedHeading: "We don't recognise this invitation",
    notRecognisedBody: 'Check that you opened the whole link, or ask the person who invited you for a new one.',
    errorHeading: "We couldn't check your invitation just now. Please try again.",
    retry: 'Try again',
  },
  he: {
    loading: 'בודקים את ההזמנה…',
    eyebrow: 'ההזמנה שלך',
    validHeading: (name) => `קיבלת הזמנה מאת ${name}`,
    noteHeading: (name) => `הודעה מאת ${name}`,
    offerHeading: 'מה מוצע לך',
    free: 'חינם',
    perMonth: (price) => `$${price} לחודש`,
    paymentRequired: 'נדרש תשלום בעת ההרשמה.',
    paymentOpensLater: 'אפשר ליצור את החשבון עכשיו. התשלום ייפתח בקרוב, ואחרי התשלום אפשר יהיה להשתמש ב־AgentPilot.',
    accessOpenEnded: 'ללא תאריך סיום',
    accessMonths: (months) => (months === 1 ? 'חודש אחד מההרשמה' : `${months} חודשים מההרשמה`),
    accessWhilePaid: 'כל עוד התוכנית בתשלום',
    includedHeading: 'מה כלול',
    planCategory: {
      'plan.category.credits': 'קרדיטים',
      'plan.category.crm': 'לקוחות (CRM)',
      'plan.category.website_intake': 'אתר ופניות',
      'plan.category.payments': 'תשלומים',
      'plan.category.ai_chat': 'עוזר AI',
      'plan.category.marketing': 'שיווק',
      'plan.category.insights': 'תובנות',
      'plan.category.support': 'תמיכה',
      'plan.category.platform': 'פלטפורמה',
      'plan.category.addon': 'תוספות',
    },
    planCategoryNote: {
      'usage.explain.monthly': CREDIT_EXPLANATION.he.monthly,
      'usage.explain.trial': CREDIT_EXPLANATION.he.trial,
    },
    linkExpires: (date) => `אפשר לקבל את ההזמנה עד ${date}.`,
    signup: {
      heading: 'יצירת החשבון',
      stepOf: (step, total) => `שלב ${step} מתוך ${total}`,
      codeWillGoTo: (masked) => `נשלח קוד בן 6 ספרות אל ${LTR_ISOLATE}${masked}${POP_ISOLATE} כדי לוודא שזו הכתובת שלך.`,
      sendCode: 'שליחת קוד',
      sending: 'שולחים…',
      codeSentTo: (masked) => `שלחנו קוד בן 6 ספרות אל ${LTR_ISOLATE}${masked}${POP_ISOLATE}. הקוד תקף ל־10 דקות.`,
      codeLabel: 'קוד בן 6 ספרות',
      passwordLabel: 'בחירת סיסמה',
      passwordHint: '8 תווים לפחות.',
      confirmLabel: 'אימות הסיסמה',
      create: 'יצירת החשבון',
      creating: 'יוצרים את החשבון…',
      resend: 'שליחת קוד חדש',
      readyHeading: 'החשבון מוכן',
      readyBody: 'אפשר להתחבר עם כתובת המייל והסיסמה שנבחרה עכשיו.',
      google: {
        divider: 'או',
        creating: 'יוצרים את החשבון…',
        readyHeading: 'החשבון מוכן',
        readyBody: 'אפשר להתחבר עם Google כדי להמשיך.',
        errors: {
          google_email_mismatch: (masked) =>
            `ההזמנה הזו מיועדת ל־${LTR_ISOLATE}${masked}${POP_ISOLATE}, וחשבון Google שנבחר משתמש בכתובת אחרת. אפשר לבחור את חשבון Google של ${LTR_ISOLATE}${masked}${POP_ISOLATE}, או להשתמש בקוד שנשלח במייל, למטה.`,
          google_email_unverified: 'Google לא אישרה את הכתובת בחשבון הזה. אפשר להשתמש בקוד שנשלח במייל, למטה.',
          google_use_code: 'לכתובת הזו יש להשתמש בקוד שנשלח במייל, למטה.',
          google_token_invalid: 'ההתחברות עם Google לא הושלמה. אפשר לנסות שוב, או להשתמש בקוד שנשלח במייל, למטה.',
        },
      },
      errors: {
        code_format: 'יש להזין את 6 הספרות מהמייל.',
        password_short: 'הסיסמה צריכה להכיל 8 תווים לפחות.',
        password_long: 'הסיסמה ארוכה מדי. אפשר לבחור סיסמה קצרה יותר.',
        password_mismatch: 'שתי הסיסמאות אינן זהות.',
        code_invalid: (left) => (left === 1 ? 'הקוד שגוי. נשאר ניסיון אחד.' : `הקוד שגוי. נשארו ${left} ניסיונות.`),
        code_expired: 'תוקף הקוד פג. אפשר לשלוח קוד חדש.',
        code_locked: 'היו יותר מדי ניסיונות שגויים לקוד הזה. אפשר לשלוח קוד חדש.',
        code_recently_sent: (seconds) => `קוד נשלח זה עתה. אפשר לבקש קוד נוסף בעוד ${seconds} שניות.`,
        code_limit_reached: 'נשלחו יותר מדי קודים היום. אפשר לנסות שוב מחר.',
        code_not_sent: 'לא הצלחנו לשלוח את המייל כרגע. אפשר לנסות שוב.',
        existing_account: 'כבר יש חשבון עם כתובת המייל הזו. אפשר להתחבר.',
        signup_in_progress: 'ההזמנה נמצאת בשימוש כרגע. כדאי לחכות רגע ולנסות שוב.',
        signed_in: 'צריך להתנתק לפני קבלת ההזמנה.',
        weak_password: 'קל מדי לנחש את הסיסמה הזו. צריך לשלוח קוד חדש ואז לבחור סיסמה אחרת.',
        no_longer_available: 'אי אפשר להשתמש יותר בהזמנה הזו.',
        generic: 'משהו השתבש. אפשר לנסות שוב.',
      },
    },
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
    signedInBody: 'צריך להתנתק כדי להמשיך עם ההזמנה הזו.',
    signOut: 'התנתקות',
    signingOut: 'מתנתקים…',
    notRecognisedHeading: 'לא זיהינו את ההזמנה הזו',
    notRecognisedBody: 'כדאי לבדוק שנפתח הקישור המלא, או לבקש הזמנה חדשה ממי ששלח אותה.',
    errorHeading: 'לא הצלחנו לבדוק את ההזמנה כרגע. אפשר לנסות שוב.',
    retry: 'לנסות שוב',
  },
  es: {
    loading: 'Comprobando tu invitación…',
    eyebrow: 'Tu invitación',
    validHeading: (name) => `${name} te ha invitado`,
    noteHeading: (name) => `Un mensaje de ${name}`,
    offerHeading: 'Lo que se te ofrece',
    free: 'Gratis',
    perMonth: (price) => `$${price} al mes`,
    paymentRequired: 'Se requiere el pago al registrarte.',
    paymentOpensLater: 'Puedes crear tu cuenta ahora. El pago estará disponible pronto y podrás usar AgentPilot cuando hayas pagado.',
    accessOpenEnded: 'Sin fecha de fin',
    accessMonths: (months) => (months === 1 ? '1 mes desde el registro' : `${months} meses desde el registro`),
    accessWhilePaid: 'Mientras el plan esté pagado',
    includedHeading: 'Qué incluye',
    planCategory: {
      'plan.category.credits': 'Créditos',
      'plan.category.crm': 'Clientes (CRM)',
      'plan.category.website_intake': 'Web y consultas',
      'plan.category.payments': 'Pagos',
      'plan.category.ai_chat': 'Asistente de IA',
      'plan.category.marketing': 'Marketing',
      'plan.category.insights': 'Análisis',
      'plan.category.support': 'Soporte',
      'plan.category.platform': 'Plataforma',
      'plan.category.addon': 'Complementos',
    },
    planCategoryNote: {
      'usage.explain.monthly': CREDIT_EXPLANATION.es.monthly,
      'usage.explain.trial': CREDIT_EXPLANATION.es.trial,
    },
    linkExpires: (date) => `Puedes aceptar esta invitación hasta el ${date}.`,
    signup: {
      heading: 'Crea tu cuenta',
      stepOf: (step, total) => `Paso ${step} de ${total}`,
      codeWillGoTo: (masked) => `Te enviaremos un código de 6 dígitos a ${masked} para confirmar que eres tú.`,
      sendCode: 'Enviarme un código',
      sending: 'Enviando…',
      codeSentTo: (masked) => `Hemos enviado un código de 6 dígitos a ${masked}. Es válido durante 10 minutos.`,
      codeLabel: 'Código de 6 dígitos',
      passwordLabel: 'Elige una contraseña',
      passwordHint: 'Al menos 8 caracteres.',
      confirmLabel: 'Confirma la contraseña',
      create: 'Crear mi cuenta',
      creating: 'Creando tu cuenta…',
      resend: 'Enviar un código nuevo',
      readyHeading: 'Tu cuenta está lista',
      readyBody: 'Inicia sesión con tu correo y la contraseña que acabas de elegir.',
      google: {
        divider: 'o',
        creating: 'Creando tu cuenta…',
        readyHeading: 'Tu cuenta está lista',
        readyBody: 'Inicia sesión con Google para continuar.',
        errors: {
          google_email_mismatch: (masked) =>
            `Esta invitación es para ${masked} y la cuenta de Google que elegiste usa otra dirección. Elige la cuenta de Google de ${masked} o usa el código por correo que aparece más abajo.`,
          google_email_unverified: 'Google no ha confirmado la dirección de esa cuenta. Usa el código por correo que aparece más abajo.',
          google_use_code: 'Para esta dirección, usa el código por correo que aparece más abajo.',
          google_token_invalid: 'No se completó el inicio de sesión con Google. Inténtalo de nuevo o usa el código por correo que aparece más abajo.',
        },
      },
      errors: {
        code_format: 'Introduce los 6 dígitos del correo.',
        password_short: 'La contraseña necesita al menos 8 caracteres.',
        password_long: 'Esa contraseña es demasiado larga. Elige una más corta.',
        password_mismatch: 'Las dos contraseñas no coinciden.',
        code_invalid: (left) => (left === 1 ? 'Ese código no es correcto. Te queda 1 intento.' : `Ese código no es correcto. Te quedan ${left} intentos.`),
        code_expired: 'Ese código ha caducado. Pide uno nuevo.',
        code_locked: 'Demasiados intentos fallidos con este código. Pide uno nuevo.',
        code_recently_sent: (seconds) => `Acabamos de enviar un código. Puedes pedir otro dentro de ${seconds} segundos.`,
        code_limit_reached: 'Se han enviado demasiados códigos hoy. Inténtalo de nuevo mañana.',
        code_not_sent: 'No pudimos enviar el correo ahora. Inténtalo de nuevo.',
        existing_account: 'Este correo ya tiene una cuenta. Inicia sesión.',
        signup_in_progress: 'Esta invitación se está usando ahora mismo. Espera un momento y vuelve a intentarlo.',
        signed_in: 'Cierra la sesión antes de aceptar esta invitación.',
        weak_password: 'Esa contraseña es demasiado fácil de adivinar. Pide un código nuevo y elige otra contraseña.',
        no_longer_available: 'Esta invitación ya no se puede usar.',
        generic: 'Algo salió mal. Inténtalo de nuevo.',
      },
    },
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
    signedInBody: 'Cierra la sesión para continuar con esta invitación.',
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
