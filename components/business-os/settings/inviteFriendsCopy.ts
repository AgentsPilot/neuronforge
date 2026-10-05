/**
 * The words of the "Invite friends" settings section (Slice 5a, F5a-12), in
 * en/he/es.
 *
 * Kept here rather than in `LanguageContext.tsx` (workplan D-11), following
 * `app/invite/invitePageCopy.ts`: the section reads only `language` and `isRTL`
 * from the context, for display. No number is written into a sentence: the
 * allowance and what is left arrive from the server and are interpolated (SA
 * R-7), so changing the allowance in config never leaves stale text.
 *
 * Pure data, no imports: safe in a client bundle.
 */

export type InviteFriendsLocale = 'en' | 'he' | 'es';

/** The API's refusal codes the section explains (T-21). */
export type InviteFriendsErrorCode =
  | 'allowance_reached'
  | 'already_invited'
  | 'own_email'
  | 'daily_limit'
  | 'not_eligible'
  | 'invalid_input'
  | 'generic';

/**
 * `joined` = the friend created an account (`redeemed_at` set, F5b-7). Until
 * payment is live (Slice 5c) such a friend is held, so the words say "not
 * subscribed yet" rather than implying they are using the product.
 */
export type InviteFriendsStatus = 'pending' | 'expired' | 'revoked' | 'joined';

export interface InviteFriendsCopy {
  sectionTitle: string;
  intro: (allowance: number) => string;
  remaining: (remaining: number, allowance: number) => string;
  allInUse: (allowance: number) => string;
  emailLabel: string;
  noteLabel: string;
  noteHint: string;
  languageLabel: string;
  languageNames: Record<string, string>;
  send: string;
  sending: string;
  linkHeading: string;
  linkBody: string;
  copyLink: string;
  copied: string;
  dismiss: string;
  emailNotSent: string;
  listHeading: string;
  empty: string;
  sentOn: (date: string) => string;
  status: Record<InviteFriendsStatus, string>;
  slotReturned: string;
  revoke: string;
  revokeConfirm: (email: string) => string;
  revokeYes: string;
  cancel: string;
  revokeFailed: string;
  errors: Record<InviteFriendsErrorCode, (allowance: number) => string>;
}

export const INVITE_FRIENDS_COPY: Record<InviteFriendsLocale, InviteFriendsCopy> = {
  en: {
    sectionTitle: 'Invite friends',
    intro: (allowance) =>
      `As a Founding Partner you can invite up to ${allowance} friends to Essentials, a paid monthly plan. They'll see your name, your note and the price before they decide.`,
    remaining: (remaining, allowance) => `${remaining} of ${allowance} invites left`,
    allInUse: (allowance) =>
      `All ${allowance} of your invites are in use. An invite you revoke, or one that expires, comes back to you.`,
    emailLabel: "Friend's email",
    noteLabel: 'Personal note (optional)',
    noteHint: 'Shown in the email and on the invitation page.',
    languageLabel: 'Language of the invitation',
    languageNames: { en: 'English', he: 'עברית', es: 'Español' },
    send: 'Send invite',
    sending: 'Sending…',
    linkHeading: 'Invite sent',
    linkBody: 'This is the link we emailed. It is shown only once, so copy it now if you want to share it yourself.',
    copyLink: 'Copy link',
    copied: 'Copied',
    dismiss: 'Done',
    emailNotSent: "We couldn't confirm the email was sent. Share the link yourself.",
    listHeading: 'Your invites',
    empty: "You haven't invited anyone yet.",
    sentOn: (date) => `Sent ${date}`,
    status: { pending: 'Pending', expired: 'Expired', revoked: 'Revoked', joined: 'Signed up — not subscribed yet' },
    slotReturned: 'Back in your invites',
    revoke: 'Revoke',
    revokeConfirm: (email) => `Revoke the invite to ${email}? The link will stop working.`,
    revokeYes: 'Yes, revoke',
    cancel: 'Cancel',
    revokeFailed: "That invite can't be revoked any more. The list has been refreshed.",
    errors: {
      allowance_reached: (allowance) => `All ${allowance} of your invites are in use.`,
      already_invited: () => 'You already have a live invite to this address.',
      own_email: () => "You can't invite yourself.",
      daily_limit: () => "You've sent a lot of invites today. Please try again tomorrow.",
      not_eligible: () => 'Friend invites are not available for your account.',
      invalid_input: () => 'Please check the email address and the note.',
      generic: () => 'Something went wrong. Please try again.',
    },
  },
  he: {
    sectionTitle: 'הזמנת חברים',
    intro: (allowance) =>
      `כשותף מייסד אפשר להזמין עד ${allowance} חברים לתוכנית Essentials, תוכנית חודשית בתשלום. הם יראו את השם שלך, את ההודעה שלך ואת המחיר לפני שיחליטו.`,
    remaining: (remaining, allowance) => `נותרו ${remaining} מתוך ${allowance} הזמנות`,
    allInUse: (allowance) => `כל ${allowance} ההזמנות שלך בשימוש. הזמנה שתבטל, או שתפוג, תחזור אליך.`,
    emailLabel: 'האימייל של החבר',
    noteLabel: 'הודעה אישית (לא חובה)',
    noteHint: 'מוצגת במייל ובדף ההזמנה.',
    languageLabel: 'שפת ההזמנה',
    languageNames: { en: 'English', he: 'עברית', es: 'Español' },
    send: 'שליחת הזמנה',
    sending: 'שולח…',
    linkHeading: 'ההזמנה נשלחה',
    linkBody: 'זה הקישור ששלחנו במייל. הוא מוצג פעם אחת בלבד, אז כדאי להעתיק אותו עכשיו אם תרצה לשתף אותו בעצמך.',
    copyLink: 'העתקת הקישור',
    copied: 'הועתק',
    dismiss: 'סיום',
    emailNotSent: 'לא הצלחנו לוודא שהמייל נשלח. אפשר לשתף את הקישור בעצמך.',
    listHeading: 'ההזמנות שלך',
    empty: 'עדיין לא הזמנת אף אחד.',
    sentOn: (date) => `נשלחה ${date}`,
    status: { pending: 'ממתינה', expired: 'פג תוקף', revoked: 'בוטלה', joined: 'נרשם — עדיין ללא מנוי' },
    slotReturned: 'חזרה להזמנות שלך',
    revoke: 'ביטול',
    // The address is isolated left-to-right inside the Hebrew sentence.
    revokeConfirm: (email) => `לבטל את ההזמנה ל-⁦${email}⁩? הקישור יפסיק לעבוד.`,
    revokeYes: 'כן, לבטל',
    cancel: 'חזרה',
    revokeFailed: 'אי אפשר לבטל את ההזמנה הזו יותר. הרשימה עודכנה.',
    errors: {
      allowance_reached: (allowance) => `כל ${allowance} ההזמנות שלך בשימוש.`,
      already_invited: () => 'כבר יש לך הזמנה פעילה לכתובת הזו.',
      own_email: () => 'אי אפשר להזמין את עצמך.',
      daily_limit: () => 'שלחת הרבה הזמנות היום. אפשר לנסות שוב מחר.',
      not_eligible: () => 'הזמנת חברים אינה זמינה בחשבון שלך.',
      invalid_input: () => 'כדאי לבדוק את כתובת האימייל ואת ההודעה.',
      generic: () => 'משהו השתבש. אפשר לנסות שוב.',
    },
  },
  es: {
    sectionTitle: 'Invitar amigos',
    intro: (allowance) =>
      `Como Socio Fundador puedes invitar hasta ${allowance} amigos a Essentials, un plan mensual de pago. Verán tu nombre, tu nota y el precio antes de decidir.`,
    remaining: (remaining, allowance) => `Te quedan ${remaining} de ${allowance} invitaciones`,
    allInUse: (allowance) =>
      `Tus ${allowance} invitaciones están en uso. Una invitación que revoques, o que caduque, vuelve a estar disponible.`,
    emailLabel: 'Correo de tu amigo',
    noteLabel: 'Nota personal (opcional)',
    noteHint: 'Se muestra en el correo y en la página de la invitación.',
    languageLabel: 'Idioma de la invitación',
    languageNames: { en: 'English', he: 'עברית', es: 'Español' },
    send: 'Enviar invitación',
    sending: 'Enviando…',
    linkHeading: 'Invitación enviada',
    linkBody: 'Este es el enlace que enviamos por correo. Solo se muestra una vez: cópialo ahora si quieres compartirlo tú.',
    copyLink: 'Copiar enlace',
    copied: 'Copiado',
    dismiss: 'Listo',
    emailNotSent: 'No pudimos confirmar que el correo se enviara. Comparte el enlace tú mismo.',
    listHeading: 'Tus invitaciones',
    empty: 'Todavía no has invitado a nadie.',
    sentOn: (date) => `Enviada el ${date}`,
    status: { pending: 'Pendiente', expired: 'Caducada', revoked: 'Revocada', joined: 'Registrado — aún sin suscripción' },
    slotReturned: 'De vuelta en tus invitaciones',
    revoke: 'Revocar',
    revokeConfirm: (email) => `¿Revocar la invitación a ${email}? El enlace dejará de funcionar.`,
    revokeYes: 'Sí, revocar',
    cancel: 'Cancelar',
    revokeFailed: 'Esa invitación ya no se puede revocar. La lista se ha actualizado.',
    errors: {
      allowance_reached: (allowance) => `Tus ${allowance} invitaciones están en uso.`,
      already_invited: () => 'Ya tienes una invitación activa para esta dirección.',
      own_email: () => 'No puedes invitarte a ti mismo.',
      daily_limit: () => 'Has enviado muchas invitaciones hoy. Vuelve a intentarlo mañana.',
      not_eligible: () => 'Las invitaciones a amigos no están disponibles para tu cuenta.',
      invalid_input: () => 'Revisa la dirección de correo y la nota.',
      generic: () => 'Algo salió mal. Inténtalo de nuevo.',
    },
  },
};

/** The section's locale for a UI language, falling back to English. */
export function inviteFriendsLocaleOf(language: string | null | undefined): InviteFriendsLocale {
  return language === 'he' || language === 'es' ? language : 'en';
}

/** A known refusal code, or `generic`. */
export function inviteFriendsErrorOf(code: unknown): InviteFriendsErrorCode {
  switch (code) {
    case 'allowance_reached':
    case 'already_invited':
    case 'own_email':
    case 'daily_limit':
    case 'not_eligible':
    case 'invalid_input':
      return code;
    default:
      return 'generic';
  }
}
