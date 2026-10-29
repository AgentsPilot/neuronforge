// lib/business-os/data-export/moduleExportEmails.ts
//
// Module export MX-3a (BUSINESS_OS_EXPORT_MX3_WORKPLAN.md §8, D-20; requirement
// §3, §4.3; SA Workplan Review 2026-10-28 Q-1, Q-5): the emails of the module
// export worker.
//
// - The part email, one per part with the CSV attached, "email n of X".
// - One notice per failed or interrupted job (no attachment): failed,
//   interrupted, or too large. Failed has one copy variant (SA Q-1): a module
//   switched off or unknown says "This part is not available for export right
//   now." instead of "Please try again", because the drawer no longer offers
//   it. It is the failed email, not a fourth kind.
// - The part's file name, `{module_id}_{YYYY-MM-DD}_part-{n}-of-{X}.csv`, with
//   the business date of the produced-at time in the owner's zone (UTC when
//   none is set).
//
// The MX-1b "requested" email's rules hold here too: the owner's language
// (en / he / es; Hebrew and Spanish are drafts for native review), dates and
// times through `formatRequestedAt` in the owner's zone with "(UTC)" when none
// is set, the date and time isolated in right-to-left text (<bdi> in HTML,
// FSI / PDI in text, MX-1b SA CR-4), every interpolated value HTML-escaped.
// No business name, owner name, row count, file name or address other than
// the support contact in any body (requirement §12).
//
// PURE and DETERMINISTIC: no I/O, no logger, no clock. The same input gives
// the same bytes, which a re-sent notice under one key needs (T-M8).
//
// No backslash + hex escape anywhere in this file (lib/ is scanned by Tailwind,
// PR #180): the isolate characters are built from their code points.

import { EXPORT_MODULES } from '@/lib/business-os/data-export/exportModules';
import {
  EXPORT_REQUESTED_EMAIL_COPY,
  formatRequestedAt,
  type ExportEmailLanguage,
} from '@/lib/business-os/data-export/exportRequestedEmail';
import { MODULE_JOB_FAILURE_CODES } from '@/lib/business-os/data-export/moduleExportSending';
import { PLACEHOLDER_ERASURE_CONTACT } from '@/lib/business-os/supportContact';
import { FALLBACK_TIMEZONE } from '@/lib/scheduling/businessTime';

export type { ExportEmailLanguage };

/** The owner's clock, as `ownerClock()` gives it. */
export interface OwnerClockFacts {
  timezone: string;
  isTimezoneSet: boolean;
}

export interface ModulePartEmailInput extends OwnerClockFacts {
  language: ExportEmailLanguage;
  moduleId: string;
  n: number;
  total: number;
  requestedAt: Date;
  /** Fixed once per job (SA Q-3), so every part and every re-send says the same. */
  producedAt: Date;
}

export interface ModuleNoticeEmailInput extends OwnerClockFacts {
  language: ExportEmailLanguage;
  moduleId: string;
  failureCode: string;
  requestedAt: Date;
}

export interface ModuleExportEmail {
  subject: string;
  html: string;
  text: string;
}

export type ModuleNoticeKind = 'failed' | 'not_available' | 'interrupted' | 'too_large';

interface Copy {
  partSubject: string;
  partAttached: string;
  partDates: string;
  partSplit: string;
  filesNotIncluded: string;
  failedSubject: string;
  failed: string;
  tryAgain: string;
  notAvailable: string;
  interruptedSubject: string;
  interrupted: string;
  interruptedMayHaveArrived: string;
  tooLargeSubject: string;
  tooLarge: string;
  requestedOn: string;
}

/** Exported for the copy parity test (T-M1). */
export const MODULE_EXPORT_EMAIL_COPY: Readonly<Record<ExportEmailLanguage, Copy>> = {
  en: {
    partSubject: 'Your data export: {module} (email {n} of {total})',
    partAttached: 'Attached is {module} from your AgentPilot data, email {n} of {total}.',
    partDates: 'Requested on {requestedDate} at {requestedTime}. Produced on {producedDate} at {producedTime}.',
    partSplit: 'This part comes in {total} emails. Each file has the column headings, so each opens on its own.',
    filesNotIncluded: 'Files (client documents, website pictures) are not included.',
    failedSubject: 'Your data export: {module} failed',
    failed: 'This part of your export failed.',
    tryAgain: 'Please try again.',
    notAvailable: 'This part is not available for export right now.',
    interruptedSubject: 'Your data export: {module} was interrupted',
    interrupted: 'This part was interrupted. Please export it again.',
    interruptedMayHaveArrived: 'Some emails of this part may already have arrived; the new export replaces them.',
    tooLargeSubject: 'Your data export: {module} is too large to email',
    tooLarge: 'This part is too large to email. Please contact support at {support}.',
    requestedOn: 'Requested on {requestedDate} at {requestedTime}.',
  },
  // Draft: needs a native check.
  he: {
    partSubject: 'ייצוא הנתונים שלך: {module} (מייל {n} מתוך {total})',
    partAttached: 'מצורף {module} מנתוני ה-AgentPilot שלך, מייל {n} מתוך {total}.',
    partDates: 'התבקש בתאריך {requestedDate} בשעה {requestedTime}. הופק בתאריך {producedDate} בשעה {producedTime}.',
    partSplit: 'החלק הזה נשלח ב-{total} מיילים. בכל קובץ יש את כותרות העמודות, כך שאפשר לפתוח כל אחד בנפרד.',
    filesNotIncluded: 'קבצים (מסמכי לקוחות, תמונות האתר) אינם כלולים.',
    failedSubject: 'ייצוא הנתונים שלך: {module} נכשל',
    failed: 'החלק הזה של הייצוא נכשל.',
    tryAgain: 'אפשר לנסות שוב.',
    notAvailable: 'החלק הזה אינו זמין לייצוא כרגע.',
    interruptedSubject: 'ייצוא הנתונים שלך: {module} נקטע',
    interrupted: 'החלק הזה נקטע. יש לייצא אותו שוב.',
    interruptedMayHaveArrived: 'ייתכן שחלק מהמיילים של החלק הזה כבר הגיעו; הייצוא החדש מחליף אותם.',
    tooLargeSubject: 'ייצוא הנתונים שלך: {module} גדול מדי לשליחה במייל',
    tooLarge: 'החלק הזה גדול מדי לשליחה במייל. אפשר לפנות לתמיכה בכתובת {support}.',
    requestedOn: 'התבקש בתאריך {requestedDate} בשעה {requestedTime}.',
  },
  // Draft: needs a native check.
  es: {
    partSubject: 'Tu exportación de datos: {module} (correo {n} de {total})',
    partAttached: 'Adjuntamos {module} de tus datos de AgentPilot, correo {n} de {total}.',
    partDates: 'Solicitado el {requestedDate} a las {requestedTime}. Generado el {producedDate} a las {producedTime}.',
    partSplit: 'Esta parte llega en {total} correos. Cada archivo tiene los encabezados, así que cada uno se abre por separado.',
    filesNotIncluded: 'Los archivos (documentos de clientes, imágenes del sitio web) no se incluyen.',
    failedSubject: 'Tu exportación de datos: {module} ha fallado',
    failed: 'Esta parte de tu exportación ha fallado.',
    tryAgain: 'Inténtalo de nuevo.',
    notAvailable: 'Esta parte no está disponible para exportar en este momento.',
    interruptedSubject: 'Tu exportación de datos: {module} se ha interrumpido',
    interrupted: 'Esta parte se ha interrumpido. Vuelve a exportarla.',
    interruptedMayHaveArrived: 'Puede que ya hayan llegado algunos correos de esta parte; la nueva exportación los sustituye.',
    tooLargeSubject: 'Tu exportación de datos: {module} es demasiado grande para enviarla por correo',
    tooLarge: 'Esta parte es demasiado grande para enviarla por correo. Escribe a soporte en {support}.',
    requestedOn: 'Solicitado el {requestedDate} a las {requestedTime}.',
  },
};

/** First-strong isolate / pop directional isolate (MX-1b SA CR-4), from code points: no escape in source. */
const FSI = String.fromCodePoint(0x2068);
const PDI = String.fromCodePoint(0x2069);

const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => (key in values ? values[key] : whole));
}

/** A module's name in the language; an id not in the map (a renamed module) shows as itself. */
export function moduleDisplayName(moduleId: string, language: ExportEmailLanguage): string {
  const found = EXPORT_MODULES.find((module) => module.id === moduleId);
  return found ? found.name[language] : moduleId;
}

/** SA Q-1 / Q-5: which notice a failure code sends. */
export function noticeKindFor(failureCode: string): ModuleNoticeKind {
  switch (failureCode) {
    case MODULE_JOB_FAILURE_CODES.INTERRUPTED:
      return 'interrupted';
    case MODULE_JOB_FAILURE_CODES.TOO_LARGE:
    case MODULE_JOB_FAILURE_CODES.OVER_CEILING:
      return 'too_large';
    case MODULE_JOB_FAILURE_CODES.MODULE_SWITCHED_OFF:
    case MODULE_JOB_FAILURE_CODES.MODULE_UNKNOWN:
      return 'not_available';
    default:
      return 'failed';
  }
}

/** `YYYY-MM-DD` of `at` in the zone (UTC when none is set): the business date of D-20. */
export function businessDate(at: Date, clock: OwnerClockFacts): string {
  const timeZone = clock.isTimezoneSet ? clock.timezone : FALLBACK_TIMEZONE;
  const parts = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone }).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * D-20: `{module_id}_{YYYY-MM-DD}_part-{n}-of-{X}.csv`. The module id is ASCII
 * and carries no user data, so it needs no RFC 5987 encoding; the localised
 * name is in the subject and the body.
 */
export function partFileName(input: OwnerClockFacts & { moduleId: string; producedAt: Date; n: number; total: number }): string {
  return `${input.moduleId}_${businessDate(input.producedAt, input)}_part-${input.n}-of-${input.total}.csv`;
}

interface Rendered {
  isRtl: boolean;
  text: (value: string) => string;
  html: (value: string) => string;
}

function renderer(language: ExportEmailLanguage): Rendered {
  const isRtl = language === 'he';
  return {
    isRtl,
    text: (value) => (isRtl ? `${FSI}${value}${PDI}` : value),
    html: (value) => (isRtl ? `<bdi>${escapeHtml(value)}</bdi>` : escapeHtml(value)),
  };
}

function wrapHtml(language: ExportEmailLanguage, paragraphs: readonly string[]): string {
  const dir = language === 'he' ? 'rtl' : 'ltr';
  return (
    `<div dir="${dir}" lang="${language}" style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;text-align:${dir === 'rtl' ? 'right' : 'left'}">` +
    paragraphs.map((p) => `<p>${p}</p>`).join('') +
    `</div>`
  );
}

/** A sentence in both forms: the text with `values`, and the HTML with each value escaped (or isolated). */
function sentence(template: string, text: Record<string, string>, html: Record<string, string>): { text: string; html: string } {
  return { text: fill(template, text), html: fill(escapeHtml(template), html) };
}

const supportLink = (): string => {
  const support = escapeHtml(PLACEHOLDER_ERASURE_CONTACT);
  return `<a href="mailto:${support}">${support}</a>`;
};

export function buildModulePartEmail(input: ModulePartEmailInput): ModuleExportEmail {
  const copy = MODULE_EXPORT_EMAIL_COPY[input.language];
  const r = renderer(input.language);
  const name = moduleDisplayName(input.moduleId, input.language);
  const n = String(input.n);
  const total = String(input.total);
  const requested = formatRequestedAt({ language: input.language, requestedAt: input.requestedAt, timezone: input.timezone, isTimezoneSet: input.isTimezoneSet });
  const produced = formatRequestedAt({ language: input.language, requestedAt: input.producedAt, timezone: input.timezone, isTimezoneSet: input.isTimezoneSet });

  const attached = sentence(copy.partAttached, { module: name, n, total }, { module: escapeHtml(name), n, total });
  const dates = sentence(
    copy.partDates,
    { requestedDate: r.text(requested.date), requestedTime: r.text(requested.time), producedDate: r.text(produced.date), producedTime: r.text(produced.time) },
    { requestedDate: r.html(requested.date), requestedTime: r.html(requested.time), producedDate: r.html(produced.date), producedTime: r.html(produced.time) }
  );
  const split = input.total > 1 ? sentence(copy.partSplit, { total }, { total }) : null;
  const notYou = EXPORT_REQUESTED_EMAIL_COPY[input.language].notYou;

  const textLines = [attached.text, '', dates.text, ...(split ? ['', split.text] : []), '', copy.filesNotIncluded, '', fill(notYou, { support: PLACEHOLDER_ERASURE_CONTACT }), ''];
  const html = wrapHtml(input.language, [
    attached.html,
    dates.html,
    ...(split ? [split.html] : []),
    escapeHtml(copy.filesNotIncluded),
    fill(escapeHtml(notYou), { support: supportLink() }),
  ]);

  return { subject: fill(copy.partSubject, { module: name, n, total }), html, text: textLines.join('\n') };
}

export function buildModuleNoticeEmail(input: ModuleNoticeEmailInput): ModuleExportEmail & { kind: ModuleNoticeKind } {
  const copy = MODULE_EXPORT_EMAIL_COPY[input.language];
  const r = renderer(input.language);
  const name = moduleDisplayName(input.moduleId, input.language);
  const kind = noticeKindFor(input.failureCode);
  const requested = formatRequestedAt({ language: input.language, requestedAt: input.requestedAt, timezone: input.timezone, isTimezoneSet: input.isTimezoneSet });
  const requestedOn = sentence(
    copy.requestedOn,
    { requestedDate: r.text(requested.date), requestedTime: r.text(requested.time) },
    { requestedDate: r.html(requested.date), requestedTime: r.html(requested.time) }
  );

  let subjectTemplate: string;
  let body: Array<{ text: string; html: string }>;
  switch (kind) {
    case 'interrupted':
      subjectTemplate = copy.interruptedSubject;
      body = [
        { text: copy.interrupted, html: escapeHtml(copy.interrupted) },
        { text: copy.interruptedMayHaveArrived, html: escapeHtml(copy.interruptedMayHaveArrived) },
      ];
      break;
    case 'too_large':
      subjectTemplate = copy.tooLargeSubject;
      body = [sentence(copy.tooLarge, { support: PLACEHOLDER_ERASURE_CONTACT }, { support: supportLink() })];
      break;
    case 'not_available':
      subjectTemplate = copy.failedSubject;
      body = [{ text: `${copy.failed} ${copy.notAvailable}`, html: `${escapeHtml(copy.failed)} ${escapeHtml(copy.notAvailable)}` }];
      break;
    default:
      subjectTemplate = copy.failedSubject;
      body = [{ text: `${copy.failed} ${copy.tryAgain}`, html: `${escapeHtml(copy.failed)} ${escapeHtml(copy.tryAgain)}` }];
  }
  body.push(requestedOn);

  const text = `${body.map((s) => s.text).join('\n\n')}\n`;
  return {
    kind,
    subject: fill(subjectTemplate, { module: name }),
    html: wrapHtml(input.language, body.map((s) => s.html)),
    text,
  };
}
