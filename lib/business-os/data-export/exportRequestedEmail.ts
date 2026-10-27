// lib/business-os/data-export/exportRequestedEmail.ts
//
// The one "Export requested" email (module export MX-1b, workplan §7;
// requirement §3.4, §4.3, §4.5 with BQ-35 answered: files are not exported).
//
// Sent by the request route right after the database accepted the request, to
// the account's login email, in the owner's language, with the request time in
// the owner's clock ("UTC" labelled when no zone is set, the ownerClock rule).
// It lists the modules by name and says the parts arrive "within a few
// minutes" (the cron-only worker, XC-8).
//
// It names nothing about the business: no business name, no owner name, no
// email address except the support contact, no row count and no file name
// (requirement §12). Every interpolated value is HTML-escaped.
//
// PURE: no I/O, no logger. The module names come from the MX-0 map, the one
// source shared with the drawer. Hebrew and Spanish are drafts for native
// review.

import { EXPORT_MODULES, type ExportModuleId } from '@/lib/business-os/data-export/exportModules';
import { PLACEHOLDER_ERASURE_CONTACT } from '@/lib/business-os/supportContact';

export type ExportEmailLanguage = 'en' | 'he' | 'es';

export interface ExportRequestedEmailInput {
  language: ExportEmailLanguage;
  /** The request's modules, in the request's order. */
  modules: readonly ExportModuleId[];
  requestedAt: Date;
  /** `ownerClock().timezone`. */
  timezone: string;
  /** `ownerClock().isSet`: false labels the time "UTC". */
  isTimezoneSet: boolean;
}

export interface ExportRequestedEmail {
  subject: string;
  html: string;
  text: string;
}

interface Copy {
  locale: string;
  subject: string;
  requested: string;
  listHeading: string;
  arrives: string;
  filesNotIncluded: string;
  notYou: string;
  utc: string;
}

/** Exported for the copy parity test. */
export const EXPORT_REQUESTED_EMAIL_COPY: Readonly<Record<ExportEmailLanguage, Copy>> = {
  en: {
    locale: 'en-GB',
    subject: 'Your data export has started',
    requested: 'You asked for an export of your AgentPilot data on {date} at {time}.',
    listHeading: 'The parts you chose:',
    arrives: 'Each part will arrive in its own email, with a CSV file attached, within a few minutes.',
    filesNotIncluded: "Files (client documents, website pictures) are not included. Download client documents from each client's record.",
    notYou: 'If you did not ask for this, contact us at {support}.',
    utc: 'UTC',
  },
  he: {
    locale: 'he-IL',
    subject: 'ייצוא הנתונים שלך התחיל',
    requested: 'ביקשת ייצוא של נתוני ה-AgentPilot שלך בתאריך {date} בשעה {time}.',
    listHeading: 'החלקים שבחרת:',
    arrives: 'כל חלק יגיע במייל נפרד, עם קובץ CSV מצורף, תוך כמה דקות.',
    filesNotIncluded: 'קבצים (מסמכי לקוחות, תמונות האתר) אינם כלולים. אפשר להוריד מסמכי לקוח מהכרטיס של כל לקוח.',
    notYou: 'אם לא ביקשת זאת, כתבו לנו לכתובת {support}.',
    utc: 'UTC',
  },
  // Draft: needs a native check.
  es: {
    locale: 'es-ES',
    subject: 'Tu exportación de datos ha comenzado',
    requested: 'Pediste una exportación de tus datos de AgentPilot el {date} a las {time}.',
    listHeading: 'Las partes que elegiste:',
    arrives: 'Cada parte llegará en su propio correo, con un archivo CSV adjunto, en unos minutos.',
    filesNotIncluded: 'Los archivos (documentos de clientes, imágenes del sitio web) no se incluyen. Descarga los documentos de cada cliente desde su ficha.',
    notYou: 'Si no lo pediste tú, escríbenos a {support}.',
    utc: 'UTC',
  },
};

/** First-strong isolate / pop directional isolate (SA CR-4), for the plain-text part. */
const FSI = '⁨';
const PDI = '⁩';

const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => (key in values ? values[key] : whole));
}

/** The date and the time of the request, in the owner's zone; " (UTC)" when none is set. */
export function formatRequestedAt(input: Pick<ExportRequestedEmailInput, 'language' | 'requestedAt' | 'timezone' | 'isTimezoneSet'>): {
  date: string;
  time: string;
} {
  const copy = EXPORT_REQUESTED_EMAIL_COPY[input.language];
  const timeZone = input.isTimezoneSet ? input.timezone : 'UTC';
  const date = new Intl.DateTimeFormat(copy.locale, { year: 'numeric', month: 'long', day: 'numeric', timeZone }).format(input.requestedAt);
  const clock = new Intl.DateTimeFormat(copy.locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).format(input.requestedAt);
  return { date, time: input.isTimezoneSet ? clock : `${clock} (${copy.utc})` };
}

/** A module's name in the language; an id not in the map (never expected) shows as itself. */
function moduleName(id: string, language: ExportEmailLanguage): string {
  const found = EXPORT_MODULES.find((module) => module.id === id);
  return found ? found.name[language] : id;
}

export function buildExportRequestedEmail(input: ExportRequestedEmailInput): ExportRequestedEmail {
  const copy = EXPORT_REQUESTED_EMAIL_COPY[input.language];
  const { date, time } = formatRequestedAt(input);
  const names = input.modules.map((id) => moduleName(id, input.language));
  const isRtl = input.language === 'he';
  // SA CR-4: in right-to-left text the date and "time (UTC)" are isolated, so the bidi
  // algorithm cannot flip the parentheses or move "(UTC)": FSI/PDI in the text part,
  // `<bdi>` in the HTML. Left-to-right emails need neither and stay as they were.
  const isolateText = (value: string) => (isRtl ? `${FSI}${value}${PDI}` : value);
  const isolateHtml = (value: string) => (isRtl ? `<bdi>${escapeHtml(value)}</bdi>` : escapeHtml(value));
  const requested = fill(copy.requested, { date: isolateText(date), time: isolateText(time) });
  const requestedHtml = fill(escapeHtml(copy.requested), { date: isolateHtml(date), time: isolateHtml(time) });
  const notYouText = fill(copy.notYou, { support: PLACEHOLDER_ERASURE_CONTACT });

  const dir = isRtl ? 'rtl' : 'ltr';
  const support = escapeHtml(PLACEHOLDER_ERASURE_CONTACT);
  const supportLink = `<a href="mailto:${support}">${support}</a>`;
  const html =
    `<div dir="${dir}" lang="${input.language}" style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;text-align:${dir === 'rtl' ? 'right' : 'left'}">` +
    `<p>${requestedHtml}</p>` +
    `<p>${escapeHtml(copy.listHeading)}</p>` +
    `<ul>${names.map((name) => `<li>${escapeHtml(name)}</li>`).join('')}</ul>` +
    `<p>${escapeHtml(copy.arrives)}</p>` +
    `<p>${escapeHtml(copy.filesNotIncluded)}</p>` +
    `<p>${escapeHtml(copy.notYou).replace('{support}', supportLink)}</p>` +
    `</div>`;

  const text = [requested, '', copy.listHeading, ...names.map((name) => `- ${name}`), '', copy.arrives, '', copy.filesNotIncluded, '', notYouText, ''].join('\n');

  return { subject: copy.subject, html, text };
}
