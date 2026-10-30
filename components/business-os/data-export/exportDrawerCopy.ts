/**
 * The words of the export drawer and of its entry button (export redesign
 * MX-1b, workplan §10, §11; SA MX1B-3; MX-3.1), in en / he / es.
 *
 * Kept here rather than in the translation bundles (SA MX1B-3, the DE-9 C-10
 * precedent): the drawer opens from `/settings` and `/v2/settings`, which have
 * no LanguageProvider, so it needs its own copy with `en` as the default. The
 * Record type makes a missing language or key a compile error.
 *
 * - `entryLabel` "Export data" is the only label of the export entry from
 *   MX-3.1 (BQ-E5-2, user 2026-10-27; SA Q-1: `downloadMyDataCopy.ts`, the
 *   old ZIP words, is deleted).
 * - `filesNotIncluded` is final: BQ-35 answered (files are not exported).
 * - `startedToast` is the user's wording (BQ-E5-3, 2026-10-27).
 * - Status words say "Sent", never "Delivered" (XC-9: bounces are not tracked).
 * - `origin.admin` is the label a support-sent export will carry (BQ-E5-1);
 *   no such row exists before MX-5.
 *
 * Numbers and dates are interpolated, never typed into a sentence. he and es
 * are drafts for native review.
 *
 * Pure data, no imports: safe in a client bundle.
 */

export type ExportDrawerLocale = 'en' | 'he' | 'es';

export type ExportHistoryStatusWord = 'waiting' | 'working' | 'sent' | 'failed' | 'interrupted';

export interface ExportDrawerCopy {
  entryLabel: string;
  title: string;
  close: string;
  intro: string;
  filesNotIncluded: string;
  modulesLegend: string;
  selectAll: string;
  export: string;
  exporting: string;
  /** The pop-up after a successful request (BQ-E5-3). `{email}` = the login email. */
  startedToast: string;
  /** Shown in the drawer as well when the "Export requested" email could not be confirmed. */
  confirmationNotSent: string;
  inProgress: string;
  /** `{time}` = when the oldest counted request leaves the 24 h window. */
  dailyLimit: string;
  noLoginEmail: string;
  throttled: string;
  unauthorized: string;
  network: string;
  failed: string;
  invalid: string;
  historyTitle: string;
  historyEmpty: string;
  historyUnavailable: string;
  tryAgain: string;
  /** `{date}` */
  requestedOn: string;
  /** `{date}` */
  sentOn: string;
  /** `{count}` = 1 */
  emailCountOne: string;
  /** `{count}` > 1 */
  emailCountMany: string;
  status: Readonly<Record<ExportHistoryStatusWord, string>>;
  origin: { admin: string };
}

export const EXPORT_DRAWER_COPY: Readonly<Record<ExportDrawerLocale, ExportDrawerCopy>> = {
  en: {
    entryLabel: 'Export data',
    title: 'Export data',
    close: 'Close',
    intro: 'Choose what to export. Each part arrives by email as a CSV file.',
    filesNotIncluded: "Files (client documents, website pictures) are not included. Download client documents from each client's record.",
    modulesLegend: 'Parts to export',
    selectAll: 'Select all',
    export: 'Export',
    exporting: 'Starting…',
    startedToast: 'Export started. The exported files will be sent to {email} once ready.',
    confirmationNotSent: 'The confirmation email could not be sent, but your export is on its way.',
    inProgress: 'An export is already running. You can start another when it has finished.',
    dailyLimit: 'You can export again at {time}.',
    noLoginEmail: 'Your account has no email address the export can be sent to. Please contact support.',
    throttled: 'Too many attempts. Please wait a few minutes and try again.',
    unauthorized: 'Your session has ended. Please sign in again.',
    network: 'We could not reach the server. Check your connection and try again.',
    failed: 'The export could not be started. Please try again.',
    invalid: 'One of the chosen parts is no longer available. Please reopen this window and try again.',
    historyTitle: 'Your exports',
    historyEmpty: 'You have not exported anything yet.',
    historyUnavailable: 'Your export history could not be loaded.',
    tryAgain: 'Try again',
    requestedOn: 'Requested {date}',
    sentOn: 'Sent {date}',
    emailCountOne: '{count} email',
    emailCountMany: '{count} emails',
    status: { waiting: 'Waiting', working: 'Working', sent: 'Sent', failed: 'Failed', interrupted: 'Interrupted' },
    origin: { admin: 'Sent by AgentPilot support' },
  },
  he: {
    entryLabel: 'ייצוא נתונים',
    title: 'ייצוא נתונים',
    close: 'סגירה',
    intro: 'בחרו מה לייצא. כל חלק יגיע במייל כקובץ CSV.',
    filesNotIncluded: 'קבצים (מסמכי לקוחות, תמונות האתר) אינם כלולים. אפשר להוריד מסמכי לקוח מהכרטיס של כל לקוח.',
    modulesLegend: 'חלקים לייצוא',
    selectAll: 'בחירת הכול',
    export: 'ייצוא',
    exporting: 'מתחילים…',
    startedToast: 'הייצוא התחיל. הקבצים המיוצאים יישלחו לכתובת {email} כשיהיו מוכנים.',
    confirmationNotSent: 'לא הצלחנו לשלוח את מייל האישור, אבל הייצוא בדרך.',
    inProgress: 'ייצוא כבר מתבצע. אפשר להתחיל ייצוא נוסף כשהוא יסתיים.',
    dailyLimit: 'אפשר לייצא שוב ב-{time}.',
    noLoginEmail: 'לחשבון שלך אין כתובת מייל שאפשר לשלוח אליה את הייצוא. אנא פנו לתמיכה.',
    throttled: 'יותר מדי ניסיונות. המתינו כמה דקות ונסו שוב.',
    unauthorized: 'החיבור שלך הסתיים. אנא התחברו מחדש.',
    network: 'לא הצלחנו להגיע לשרת. בדקו את החיבור ונסו שוב.',
    failed: 'לא הצלחנו להתחיל את הייצוא. נסו שוב.',
    invalid: 'אחד החלקים שבחרתם כבר אינו זמין. פתחו את החלון מחדש ונסו שוב.',
    historyTitle: 'הייצואים שלך',
    historyEmpty: 'עדיין לא ייצאת דבר.',
    historyUnavailable: 'לא הצלחנו לטעון את היסטוריית הייצוא.',
    tryAgain: 'נסו שוב',
    requestedOn: 'התבקש {date}',
    sentOn: 'נשלח {date}',
    emailCountOne: 'מייל {count}',
    emailCountMany: '{count} מיילים',
    status: { waiting: 'ממתין', working: 'בעבודה', sent: 'נשלח', failed: 'נכשל', interrupted: 'נקטע' },
    origin: { admin: 'נשלח על ידי התמיכה של AgentPilot' },
  },
  // Draft: needs a native check.
  es: {
    entryLabel: 'Exportar datos',
    title: 'Exportar datos',
    close: 'Cerrar',
    intro: 'Elige qué exportar. Cada parte llega por correo como un archivo CSV.',
    filesNotIncluded: 'Los archivos (documentos de clientes, imágenes del sitio web) no se incluyen. Descarga los documentos de cada cliente desde su ficha.',
    modulesLegend: 'Partes para exportar',
    selectAll: 'Seleccionar todo',
    export: 'Exportar',
    exporting: 'Iniciando…',
    startedToast: 'Exportación iniciada. Los archivos exportados se enviarán a {email} cuando estén listos.',
    confirmationNotSent: 'No pudimos enviar el correo de confirmación, pero tu exportación está en camino.',
    inProgress: 'Ya hay una exportación en curso. Podrás iniciar otra cuando termine.',
    dailyLimit: 'Podrás exportar de nuevo a las {time}.',
    noLoginEmail: 'Tu cuenta no tiene un correo al que enviar la exportación. Contacta con soporte.',
    throttled: 'Demasiados intentos. Espera unos minutos y vuelve a intentarlo.',
    unauthorized: 'Tu sesión ha terminado. Vuelve a iniciar sesión.',
    network: 'No pudimos conectar con el servidor. Revisa tu conexión y vuelve a intentarlo.',
    failed: 'No se pudo iniciar la exportación. Vuelve a intentarlo.',
    invalid: 'Una de las partes elegidas ya no está disponible. Vuelve a abrir esta ventana e inténtalo de nuevo.',
    historyTitle: 'Tus exportaciones',
    historyEmpty: 'Todavía no has exportado nada.',
    historyUnavailable: 'No se pudo cargar tu historial de exportaciones.',
    tryAgain: 'Reintentar',
    requestedOn: 'Solicitado {date}',
    sentOn: 'Enviado {date}',
    emailCountOne: '{count} correo',
    emailCountMany: '{count} correos',
    status: { waiting: 'En espera', working: 'En proceso', sent: 'Enviado', failed: 'Fallido', interrupted: 'Interrumpido' },
    origin: { admin: 'Enviado por el soporte de AgentPilot' },
  },
};

export function exportDrawerCopy(language: string | undefined): ExportDrawerCopy {
  return language === 'he' || language === 'es' ? EXPORT_DRAWER_COPY[language] : EXPORT_DRAWER_COPY.en;
}

/** `{name}` placeholders filled; an unknown one is left as is. */
export function fillDrawerCopy(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => (key in values ? String(values[key]) : whole));
}
