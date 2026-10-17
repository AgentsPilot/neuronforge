/**
 * The words of the one "Download my data" control (data export DE-9,
 * workplan §3.6; SA DE-9 C-10), in en / he / es.
 *
 * Kept here rather than in the 4,000-line dictionaries, following
 * `components/business-os/settings/inviteFriendsCopy.ts`. The control renders
 * inside a LanguageProvider (/business-os/settings) and outside one
 * (/v2/settings, /settings, where the locale is `en`), so it needs no
 * FALLBACK_COPY. The Record type makes a missing language or key a compile
 * error.
 *
 * Numbers and dates are interpolated, never typed into a sentence: `{limit}` is
 * EXPORT_JOB_POLICY.DAILY_LIMIT, `{date}` / `{until}` / `{time}` come from the
 * C-1 formatter, and `{email}` is rendered by the control as a mailto link to
 * the one support contact (BC-3).
 *
 * `tooLarge` deliberately names no ceiling (not "40 MB", not "150 files"): a
 * refusal can also be over the row ceiling (DE-8b QA edge note 4). The control
 * always shows these words, never the server's `error` string.
 *
 * he and es are drafts for native review.
 *
 * Pure data, no imports: safe in a client bundle.
 */

export type DownloadMyDataLocale = 'en' | 'he' | 'es';

export interface DownloadMyDataCopy {
  label: string;
  preparing: string;
  started: string;
  partial: string;
  lastExport: string;
  lastExportExpired: string;
  downloadAgain: string;
  inProgress: string;
  dailyLimit: string;
  tooLarge: string;
  timeout: string;
  clientTimeout: string;
  signFailed: string;
  expired: string;
  throttled: string;
  unauthorized: string;
  network: string;
  failed: string;
  dismiss: string;
}

export type DownloadMyDataCopyKey = keyof DownloadMyDataCopy;

export const DOWNLOAD_MY_DATA_COPY: Record<DownloadMyDataLocale, DownloadMyDataCopy> = {
  en: {
    label: 'Download my data',
    preparing: 'Preparing your export. This can take up to a minute. Please keep this page open.',
    started: 'Your download has started. You can download it again until {until}.',
    partial: 'Some items could not be included. The README file in the download lists them.',
    lastExport: 'Last export {date}. You can download it again until {until}.',
    lastExportExpired: 'Last export {date}.',
    downloadAgain: 'Download again',
    inProgress: 'An export is already being prepared. Please try again in a minute.',
    dailyLimit: 'You can prepare {limit} exports in 24 hours. You can prepare the next one from {time}.',
    tooLarge:
      'Your account holds more than the on-screen download can package, so nothing was downloaded. Please contact support at {email} and we will prepare your export for you.',
    timeout: 'We could not prepare your export in time. Nothing was downloaded. Please try again.',
    clientTimeout:
      'This is taking longer than expected. If your export finishes, "Download again" will appear here. Please check back in a minute.',
    signFailed: 'Your export is ready, but the download link could not be made. Please use "Download again".',
    expired: 'This export is no longer available. Use "Download my data" to prepare a new one.',
    throttled: 'Too many attempts. Please wait a few minutes and try again.',
    unauthorized: 'Your session has ended. Please sign in again and retry.',
    network: 'We could not reach the server. Check your connection and try again.',
    failed: 'We could not prepare your export. Nothing was downloaded. Please try again.',
    dismiss: 'Dismiss',
  },
  he: {
    label: 'הורדת הנתונים שלי',
    preparing: 'מכינים את הקובץ שלך. זה יכול לקחת עד דקה. נא להשאיר את הדף פתוח.',
    started: 'ההורדה התחילה. אפשר להוריד אותה שוב עד {until}.',
    partial: 'חלק מהפריטים לא נכללו. קובץ ה-README שבהורדה מפרט אותם.',
    lastExport: 'הייצוא האחרון: {date}. אפשר להוריד אותו שוב עד {until}.',
    lastExportExpired: 'הייצוא האחרון: {date}.',
    downloadAgain: 'הורדה חוזרת',
    inProgress: 'כבר מכינים ייצוא. נא לנסות שוב בעוד דקה.',
    dailyLimit: 'אפשר להכין {limit} ייצואים ב-24 שעות. את הבא אפשר להכין החל מ-{time}.',
    tooLarge:
      'בחשבון שלך יש יותר ממה שההורדה מהמסך יכולה לארוז, ולכן לא הורד דבר. נא לפנות לתמיכה בכתובת {email} ונכין עבורך את הייצוא.',
    timeout: 'לא הצלחנו להכין את הייצוא בזמן. לא הורד דבר. נא לנסות שוב.',
    clientTimeout: 'זה לוקח יותר זמן מהצפוי. אם הייצוא יסתיים, "הורדה חוזרת" תופיע כאן. נא לבדוק שוב בעוד דקה.',
    signFailed: 'הייצוא מוכן, אבל לא הצלחנו ליצור קישור הורדה. נא להשתמש ב"הורדה חוזרת".',
    expired: 'הייצוא הזה כבר לא זמין. אפשר ללחוץ על "הורדת הנתונים שלי" כדי להכין חדש.',
    throttled: 'יותר מדי ניסיונות. נא להמתין כמה דקות ולנסות שוב.',
    unauthorized: 'החיבור שלך הסתיים. נא להתחבר מחדש ולנסות שוב.',
    network: 'לא הצלחנו להגיע לשרת. נא לבדוק את החיבור ולנסות שוב.',
    failed: 'לא הצלחנו להכין את הייצוא. לא הורד דבר. נא לנסות שוב.',
    dismiss: 'סגירה',
  },
  es: {
    label: 'Descargar mis datos',
    preparing: 'Estamos preparando tu exportación. Puede tardar hasta un minuto. Mantén esta página abierta.',
    started: 'Tu descarga ha comenzado. Puedes volver a descargarla hasta el {until}.',
    partial: 'Algunos elementos no se pudieron incluir. El archivo README de la descarga los enumera.',
    lastExport: 'Última exportación: {date}. Puedes volver a descargarla hasta el {until}.',
    lastExportExpired: 'Última exportación: {date}.',
    downloadAgain: 'Descargar de nuevo',
    inProgress: 'Ya se está preparando una exportación. Vuelve a intentarlo en un minuto.',
    dailyLimit: 'Puedes preparar {limit} exportaciones en 24 horas. Podrás preparar la siguiente a partir del {time}.',
    tooLarge:
      'Tu cuenta contiene más de lo que la descarga en pantalla puede empaquetar, así que no se descargó nada. Escribe a soporte en {email} y prepararemos tu exportación.',
    timeout: 'No pudimos preparar tu exportación a tiempo. No se descargó nada. Vuelve a intentarlo.',
    clientTimeout:
      'Está tardando más de lo esperado. Si tu exportación termina, aparecerá «Descargar de nuevo» aquí. Vuelve a mirar en un minuto.',
    signFailed: 'Tu exportación está lista, pero no se pudo crear el enlace de descarga. Usa «Descargar de nuevo».',
    expired: 'Esta exportación ya no está disponible. Usa «Descargar mis datos» para preparar una nueva.',
    throttled: 'Demasiados intentos. Espera unos minutos y vuelve a intentarlo.',
    unauthorized: 'Tu sesión ha terminado. Vuelve a iniciar sesión e inténtalo de nuevo.',
    network: 'No pudimos conectar con el servidor. Revisa tu conexión y vuelve a intentarlo.',
    failed: 'No pudimos preparar tu exportación. No se descargó nada. Vuelve a intentarlo.',
    dismiss: 'Cerrar',
  },
};

/**
 * The placeholders the control fills, per key (C-10). The parity test checks
 * every one exists in all three languages, and that no language has a
 * placeholder the control does not fill.
 */
export const DOWNLOAD_MY_DATA_PLACEHOLDERS: Partial<Record<DownloadMyDataCopyKey, readonly string[]>> = {
  started: ['until'],
  lastExport: ['date', 'until'],
  lastExportExpired: ['date'],
  dailyLimit: ['limit', 'time'],
  tooLarge: ['email'],
};

export function downloadMyDataCopy(language: string | undefined): DownloadMyDataCopy {
  return language === 'he' || language === 'es' ? DOWNLOAD_MY_DATA_COPY[language] : DOWNLOAD_MY_DATA_COPY.en;
}

/** `{name}` → value. An unknown placeholder is left as written, so a test sees it. */
export function fillCopy(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}
