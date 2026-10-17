// lib/business-os/data-export/readme.ts
//
// DE-8b (BUSINESS_OS_DATA_EXPORT_DE8B_WORKPLAN.md §8; requirement §0.4.1 E,
// FR-E8, FR-E10, FR-E12, SQ-A5, and every README note owed by DE-3 ... DE-7):
// the plain-language instructions file, in English and Hebrew (TL default
// BC-2: both, always). PURE: no I/O, every fact is an input.
//
// All copy lives in one typed table per language (`Record<...>`), so a
// missing Hebrew string fails `tsc`, and the test checks every block id is
// present and non-empty in both.
//
// The business name is put in as plain text, after `cleanBusinessName`
// strips control and bidi-control characters (so a crafted name cannot
// reorder the text). It appears in the README and data.json only, never in a
// log, an audit detail or an object path (§0.4.1 E "Never").

import type { ExportSectionId } from '@/lib/business-os/data-export/classificationTypes';
// Type-only: erased at build, so this pure module never loads the server-only registry.
import type { ExportGroupId } from '@/lib/business-os/data-export/sections';

export type ReadmeLang = 'en' | 'he';

export const README_BLOCK_IDS = [
  'title',
  'contents',
  'controller',
  'sections',
  'files',
  'not_included',
  'how_to_read',
  'timezones',
  'money',
  'consent',
  'page_addresses',
  'website',
  'retention',
  'questions',
] as const;

export type ReadmeBlockId = (typeof README_BLOCK_IDS)[number];

export interface ReadmeSectionFact {
  id: ExportSectionId;
  group: ExportGroupId;
  rowCount: number;
  status: 'ok' | 'failed';
}

export interface ReadmeFileFacts {
  /** Files in the zip. */
  included: number;
  /** Files listed in files-index.csv that could not be read. */
  couldNotBeRead: number;
  /** Records (documents) whose file is not in the zip: no file stored, or it could not be placed. */
  recordsWithoutFile: number;
  /** Pictures in the zip with no picture-library record (logos, older uploads: Q10b). */
  filesWithoutRecord: number;
  /** Stored document files whose record was deleted or is missing: not exported (C-11). */
  deletedDocumentFiles: number;
}

export interface ReadmeFacts {
  /** Already cleaned, or null: "the account holder". */
  businessName: string | null;
  /** The start instant, ISO 8601 UTC (`...Z`). */
  startedAtUtc: string;
  /** The same instant on the owner's clock, ISO 8601 with its offset. */
  startedAtLocal: string;
  /** The zone the local time is in; 'UTC' when none was set. */
  timezone: string;
  /** false when `user_preferences.timezone` was not set (NULL means "not asked"). */
  timezoneSet: boolean;
  sections: readonly ReadmeSectionFact[];
  files: ReadmeFileFacts;
}

export interface ReadmeBlock {
  id: ReadmeBlockId;
  heading: string;
  lines: string[];
}

const CONTROL = /[\u0000-\u001F\u007F-\u009F]/g;
const BIDI = /[؜‎‏‪-‮⁦-⁩﻿]/g;
const NAME_MAX = 200;

/** The business name as plain text: NFC, no control or bidi characters, trimmed, capped. Empty -> null. */
export function cleanBusinessName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const cleaned = name.normalize('NFC').replace(CONTROL, ' ').replace(BIDI, '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  return Array.from(cleaned).slice(0, NAME_MAX).join('').trim() || null;
}

/** ISO 8601 with the zone's offset, e.g. `2026-10-17T12:30:00+03:00`. Pure (Intl only). */
export function isoWithOffset(instant: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '00';
  const local = Date.UTC(
    Number(get('year')),
    Number(get('month')) - 1,
    Number(get('day')),
    Number(get('hour')),
    Number(get('minute')),
    Number(get('second'))
  );
  const offsetMinutes = Math.round((local - Math.floor(instant.getTime() / 1000) * 1000) / 60_000);
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  const offset = `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}${offset}`;
}

interface Copy {
  headings: Record<ReadmeBlockId, string>;
  groupNames: Record<ExportGroupId, string>;
  sectionNames: Record<ExportSectionId, string>;
  accountHolder: string;
  complete: string;
  couldNotBeRead: string;
  rows: (n: number) => string;
  title: (f: ReadmeFacts) => string[];
  contents: string[];
  controller: (name: string) => string[];
  files: (f: ReadmeFileFacts) => string[];
  notIncluded: string[];
  howToRead: string[];
  timezones: string[];
  money: string[];
  consent: string[];
  pageAddresses: string[];
  website: string[];
  retention: string[];
  questions: string[];
}

const SECTION_NAMES_EN: Record<ExportSectionId, string> = {
  account_identity: 'Your sign-in account (id, email, created)',
  user_profile: 'Your profile',
  preferences: 'Your preferences (language, timezone)',
  notification_settings: 'Your notification choices',
  business_profile: 'Your business profile',
  business_addresses: 'Your business addresses',
  payment_account: 'Your Stripe payment account',
  payment_providers: 'Your payment providers',
  pipeline_stages: 'Pipeline stages',
  clients: 'Clients',
  client_activities: 'Client notes and history',
  client_tasks: 'Client tasks',
  client_documents: 'Client document details',
  services: 'Services',
  bookings: 'Bookings',
  time_off: 'Time off',
  quotes: 'Quotes',
  invoices: 'Invoices',
  payments: 'Payments',
  refunds: 'Refunds',
  payment_plans: 'Payment plans',
  client_payment_plans: 'Plans your clients are on',
  installments: 'Instalments',
  client_payment_methods: 'Saved client payment methods (card brand and last 4 only)',
  intake_settings: 'Intake settings',
  intake_forms: 'Intake forms (every version)',
  email_campaigns: 'Email campaigns',
  email_sequences: 'Email sequences',
  email_sequence_steps: 'Email sequence steps',
  email_sequence_enrollments: 'Who is enrolled in a sequence',
  newsletter_subscribers: 'Newsletter sign-ups',
  consent_records: 'Consent records',
  consent_settings: 'Consent settings',
  email_unsubscribes: 'Do-not-email list',
  website_content: 'Website text (your edits)',
  website_pages: 'Website and landing pages',
  website_blocks: 'Blocks on your pages',
  smart_links: 'Smart links',
  images: 'Picture library records',
};

const SECTION_NAMES_HE: Record<ExportSectionId, string> = {
  account_identity: 'חשבון הכניסה שלך (מזהה, אימייל, תאריך יצירה)',
  user_profile: 'הפרופיל שלך',
  preferences: 'ההעדפות שלך (שפה, אזור זמן)',
  notification_settings: 'בחירות ההתראות שלך',
  business_profile: 'פרופיל העסק',
  business_addresses: 'כתובות העסק',
  payment_account: 'חשבון התשלומים שלך ב-Stripe',
  payment_providers: 'ספקי התשלום שלך',
  pipeline_stages: 'שלבי תהליך המכירה',
  clients: 'לקוחות',
  client_activities: 'הערות והיסטוריה של לקוחות',
  client_tasks: 'משימות לקוחות',
  client_documents: 'פרטי מסמכי לקוחות',
  services: 'שירותים',
  bookings: 'הזמנות',
  time_off: 'זמני היעדרות',
  quotes: 'הצעות מחיר',
  invoices: 'חשבוניות',
  payments: 'תשלומים',
  refunds: 'החזרים',
  payment_plans: 'תוכניות תשלום',
  client_payment_plans: 'תוכניות תשלום של לקוחות',
  installments: 'תשלומים לשיעורין',
  client_payment_methods: 'אמצעי תשלום שמורים של לקוחות (סוג הכרטיס ו-4 ספרות אחרונות בלבד)',
  intake_settings: 'הגדרות שאלון קליטה',
  intake_forms: 'שאלוני קליטה (כל הגרסאות)',
  email_campaigns: 'קמפייני אימייל',
  email_sequences: 'רצפי אימייל',
  email_sequence_steps: 'שלבי רצפי אימייל',
  email_sequence_enrollments: 'מי רשום לרצף',
  newsletter_subscribers: 'הרשמות לניוזלטר',
  consent_records: 'רישומי הסכמה',
  consent_settings: 'הגדרות הסכמה',
  email_unsubscribes: 'רשימת "לא לשלוח אימייל"',
  website_content: 'טקסט האתר (העריכות שלך)',
  website_pages: 'דפי אתר ודפי נחיתה',
  website_blocks: 'רכיבים בדפים שלך',
  smart_links: 'קישורים חכמים',
  images: 'רשומות ספריית התמונות',
};

const EN: Copy = {
  headings: {
    title: 'Your data export',
    contents: 'What is inside this zip',
    controller: 'Who is responsible for this data',
    sections: 'The spreadsheets (one per part of your data)',
    files: 'Your files',
    not_included: 'Not included in this export',
    how_to_read: 'How to read the files',
    timezones: 'Timezones',
    money: 'Money',
    consent: 'Consent and email preferences',
    page_addresses: 'Page addresses',
    website: 'Your website',
    retention: 'How long this download is kept, and its limits',
    questions: 'Questions',
  },
  groupNames: { account: 'Your account', client_records: 'Your client records', content: 'Your content' },
  sectionNames: SECTION_NAMES_EN,
  accountHolder: 'the account holder',
  complete: 'complete',
  couldNotBeRead: 'COULD NOT BE READ (this spreadsheet holds only its header row; try the export again)',
  rows: (n) => (n === 1 ? '1 row' : `${n} rows`),
  title: (f) => [
    'Prepared by AgentPilot (the provider) at your request.',
    `Started at: ${f.startedAtUtc} (UTC); on your clock: ${f.startedAtLocal} (${f.timezone}).`,
    f.timezoneSet
      ? 'Times inside the files are in UTC unless a column says otherwise.'
      : 'No timezone is set on your account, so your clock above is UTC. Times inside the files are in UTC unless a column says otherwise.',
  ],
  contents: [
    'README.txt / README-he.txt: this file, in English and in Hebrew.',
    'data.json: everything in one machine-readable file (exact values, for importing into another system).',
    'records/account, records/client_records, records/content: one spreadsheet (CSV) per part of your data.',
    'files-index.csv: one row per file in "Your files", with the record it belongs to.',
    'files/client-documents/<client id>/: the documents you keep for each client, under their original names.',
    'files/website-images/: the pictures stored for your website.',
  ],
  controller: (name) => [
    `Your account: AgentPilot is the controller of this data about you. For questions about it, contact AgentPilot support.`,
    `Your client records and Your content: ${name} is the controller of these records. AgentPilot keeps them on ${name}'s behalf, as its processor, and returns them to you here. If one of your clients asks for their data, the request is for ${name} to answer.`,
  ],
  files: (f) => [
    `${f.included} file(s) are in this zip. files-index.csv says, for each one, which record it belongs to (record_section and record_id match the id column of client_documents.csv or images.csv).`,
    `${f.filesWithoutRecord} picture(s) have no picture-library record (logos and older uploads); they are still yours and are included, with an empty record link.`,
    `${f.recordsWithoutFile} document record(s) have no file in this zip (no stored file was found for them). The record itself is in client_documents.csv.`,
    `${f.couldNotBeRead} file(s) could not be read while the zip was being prepared (for example, removed before export). They are listed in files-index.csv with status could_not_be_read.`,
    `${f.deletedDocumentFiles} stored file(s) belong to documents that were deleted; deleted items are not included.`,
  ],
  notIncluded: [
    'Agents and agent settings (not part of Business OS).',
    'Your plan, billing, credits and payments to AgentPilot.',
    'Activity history: assistant chats, briefings, insights, emails sent and reminders sent.',
    'Connected apps and their access keys.',
    'The synced copy of an outside calendar (it stays in that calendar).',
    'Bank details on your invoice settings.',
    'Deleted items: deleted documents and other deleted rows.',
    'Visitor tracking: page views, link clicks and IP evidence.',
  ],
  howToRead: [
    'Rows are in id order, not date order; every row carries its own dates.',
    'The export is "as of the start time, best effort": a row that changed while the export was running may or may not appear.',
    'Spreadsheet cells that begin with = + - or @ (for example a phone number like +972...) start with an apostrophe (\'), so a spreadsheet cannot run them as a formula. data.json keeps the exact value.',
    'Structured values (lists, settings) are written as JSON text in one cell.',
  ],
  timezones: [
    'preferences.timezone is the authority for your clock.',
    'user_profile.timezone is a mirror of it.',
    'notification_settings.quiet_hours_timezone is the zone of your quiet hours only.',
  ],
  money: [
    'Amounts are exactly as stored, next to their own currency column. Nothing is converted and there are no totals; for totals per currency, use the ledger export.',
    'processor_fee and net_amount are in fee_currency, which can differ from the payment\'s currency. An empty fee means "fee not recorded", not zero.',
    'A refund row is money returned to the client, stored as a positive amount. payments.amount is the gross charge, so do not count refunds twice.',
    'fee_returned and refund_fee: these two amounts have no recorded currency; for a Stripe refund they are normally in the payment\'s fee currency (payments.fee_currency on the linked payment); check your Stripe dashboard.',
    'The invoice links (stripe_hosted_invoice_url, stripe_invoice_pdf) open the invoice page for anyone who holds them.',
    'website_content.payment_button keeps its own amount and currency, exactly as held.',
  ],
  consent: [
    'The current answer for an address is its latest consent record; a withdrawal wins a tie.',
    'For email, email_unsubscribes and newsletter_subscribers.status give the current answer directly.',
    'Only the current privacy notice text is kept (consent_settings); each consent record keeps the exact sentence agreed and the notice link it was shown.',
    'A record reading redacted@invalid with redacted_at set means a decision existed and was erased.',
  ],
  pageAddresses: [
    'Page addresses in consent records, newsletter sign-ups and client sources are shown without their query string or # part, so an empty page address can mean the original held only a query or fragment, not that none was recorded.',
  ],
  website: [
    'To rebuild a page, read website_blocks (the base) and website_content (your edits) together.',
    'business_profile.subdomain is the authority; website_pages.subdomain is a per-page copy.',
    'Smart-link click, sign-up and revenue totals are not in the file; the payments themselves are in payments.',
  ],
  retention: [
    'The download link works for 3 days, then the file is deleted. You can prepare a new export at any time (one at a time, up to 3 a day).',
    'The on-screen download packages up to 40 MB of files, 150 files and 100,000 records.',
  ],
  questions: ['For questions about this export, contact AgentPilot support.'],
};

const HE: Copy = {
  headings: {
    title: 'ייצוא הנתונים שלך',
    contents: 'מה יש בקובץ ה-zip הזה',
    controller: 'מי אחראי על הנתונים האלה',
    sections: 'הגיליונות (גיליון לכל חלק מהנתונים שלך)',
    files: 'הקבצים שלך',
    not_included: 'מה לא נכלל בייצוא הזה',
    how_to_read: 'איך לקרוא את הקבצים',
    timezones: 'אזורי זמן',
    money: 'כסף',
    consent: 'הסכמות והעדפות אימייל',
    page_addresses: 'כתובות דפים',
    website: 'האתר שלך',
    retention: 'כמה זמן ההורדה נשמרת, והמגבלות שלה',
    questions: 'שאלות',
  },
  groupNames: { account: 'החשבון שלך', client_records: 'רשומות הלקוחות שלך', content: 'התוכן שלך' },
  sectionNames: SECTION_NAMES_HE,
  accountHolder: 'בעל החשבון',
  complete: 'מלא',
  couldNotBeRead: 'לא ניתן היה לקרוא (הגיליון מכיל רק את שורת הכותרות; נסו לייצא שוב)',
  rows: (n) => (n === 1 ? 'שורה אחת' : `${n} שורות`),
  title: (f) => [
    'הוכן על ידי AgentPilot (הספק) לבקשתך.',
    `התחיל ב: ${f.startedAtUtc} (UTC); לפי השעון שלך: ${f.startedAtLocal} (${f.timezone}).`,
    f.timezoneSet
      ? 'הזמנים בתוך הקבצים הם ב-UTC, אלא אם עמודה אומרת אחרת.'
      : 'לא הוגדר אזור זמן בחשבון שלך, ולכן השעון שלמעלה הוא UTC. הזמנים בתוך הקבצים הם ב-UTC, אלא אם עמודה אומרת אחרת.',
  ],
  contents: [
    'README.txt / README-he.txt: הקובץ הזה, באנגלית ובעברית.',
    'data.json: הכול בקובץ אחד שמחשב יכול לקרוא (ערכים מדויקים, לייבוא למערכת אחרת).',
    'records/account, records/client_records, records/content: גיליון (CSV) לכל חלק מהנתונים שלך.',
    'files-index.csv: שורה לכל קובץ ב"הקבצים שלך", עם הרשומה שהוא שייך לה.',
    'files/client-documents/<מזהה לקוח>/: המסמכים שאתם שומרים לכל לקוח, בשמות המקוריים שלהם.',
    'files/website-images/: התמונות השמורות עבור האתר שלך.',
  ],
  controller: (name) => [
    'החשבון שלך: AgentPilot היא בעלת השליטה (controller) בנתונים האלה עליך. לשאלות עליהם, פנו לתמיכה של AgentPilot.',
    `רשומות הלקוחות שלך והתוכן שלך: ${name} הוא בעל השליטה (controller) ברשומות האלה. AgentPilot שומרת אותן בשם ${name}, כמעבדת המידע (processor) שלו, ומחזירה אותן אליך כאן. אם אחד הלקוחות שלך מבקש את הנתונים שלו, הבקשה היא ל${name} לענות עליה.`,
  ],
  files: (f) => [
    `${f.included} קבצים נמצאים ב-zip הזה. הקובץ files-index.csv מציין לכל אחד לאיזו רשומה הוא שייך (record_section ו-record_id תואמים לעמודת id בקובץ client_documents.csv או images.csv).`,
    `ל-${f.filesWithoutRecord} תמונות אין רשומה בספריית התמונות (לוגואים והעלאות ישנות); הן עדיין שלך ונכללו, עם קישור רשומה ריק.`,
    `ל-${f.recordsWithoutFile} רשומות מסמכים אין קובץ ב-zip הזה (לא נמצא עבורן קובץ שמור). הרשומה עצמה נמצאת ב-client_documents.csv.`,
    `${f.couldNotBeRead} קבצים לא ניתנו לקריאה בזמן הכנת ה-zip (למשל, נמחקו לפני הייצוא). הם מופיעים ב-files-index.csv עם הסטטוס could_not_be_read.`,
    `${f.deletedDocumentFiles} קבצים שמורים שייכים למסמכים שנמחקו; פריטים שנמחקו אינם נכללים.`,
  ],
  notIncluded: [
    'סוכנים והגדרות סוכנים (אינם חלק מ-Business OS).',
    'התוכנית, החיוב, הקרדיטים והתשלומים שלך ל-AgentPilot.',
    'היסטוריית פעילות: שיחות עם העוזר, תדריכים, תובנות, אימיילים שנשלחו ותזכורות שנשלחו.',
    'אפליקציות מחוברות ומפתחות הגישה שלהן.',
    'העותק המסונכרן של יומן חיצוני (הוא נשאר באותו יומן).',
    'פרטי הבנק בהגדרות החשבונית שלך.',
    'פריטים שנמחקו: מסמכים שנמחקו ושורות אחרות שנמחקו.',
    'מעקב מבקרים: צפיות בדפים, לחיצות על קישורים וראיות IP.',
  ],
  howToRead: [
    'השורות מסודרות לפי מזהה (id), לא לפי תאריך; כל שורה כוללת את התאריכים שלה.',
    'הייצוא הוא "נכון לזמן ההתחלה, במיטב היכולת": שורה שהשתנתה בזמן שהייצוא רץ עשויה להופיע או לא.',
    'תאים בגיליון שמתחילים ב- = + - או @ (למשל מספר טלפון כמו +972...) מתחילים בגרש (\'), כדי שגיליון אלקטרוני לא יריץ אותם כנוסחה. הקובץ data.json שומר את הערך המדויק.',
    'ערכים מובנים (רשימות, הגדרות) נכתבים כטקסט JSON בתא אחד.',
  ],
  timezones: [
    'preferences.timezone הוא הקובע לשעון שלך.',
    'user_profile.timezone הוא העתק שלו.',
    'notification_settings.quiet_hours_timezone הוא אזור הזמן של שעות השקט בלבד.',
  ],
  money: [
    'הסכומים הם בדיוק כפי שנשמרו, ליד עמודת המטבע שלהם. דבר לא הומר ואין סיכומים; לסיכומים לפי מטבע, השתמשו בייצוא היומן הכספי.',
    'processor_fee ו-net_amount הם במטבע fee_currency, שיכול להיות שונה מהמטבע של התשלום. עמלה ריקה פירושה "העמלה לא נרשמה", לא אפס.',
    'שורת החזר היא כסף שהוחזר ללקוח, ונשמרת כסכום חיובי. payments.amount הוא החיוב ברוטו, ולכן אל תספרו החזרים פעמיים.',
    'fee_returned ו-refund_fee: לשני הסכומים האלה אין מטבע רשום; בהחזר של Stripe הם בדרך כלל במטבע העמלה של התשלום (payments.fee_currency בתשלום המקושר); בדקו בלוח הבקרה של Stripe.',
    'קישורי החשבונית (stripe_hosted_invoice_url, stripe_invoice_pdf) פותחים את דף החשבונית לכל מי שמחזיק בהם.',
    'website_content.payment_button שומר סכום ומטבע משלו, בדיוק כפי שנשמרו.',
  ],
  consent: [
    'התשובה הנוכחית לכתובת היא רישום ההסכמה האחרון שלה; ביטול גובר בתיקו.',
    'לאימייל, email_unsubscribes ו-newsletter_subscribers.status נותנים את התשובה הנוכחית ישירות.',
    'נשמר רק הנוסח הנוכחי של הודעת הפרטיות (consent_settings); כל רישום הסכמה שומר את המשפט המדויק שאושר ואת הקישור להודעה שהוצגה.',
    'רישום שמופיע בו redacted@invalid עם redacted_at פירושו שהייתה החלטה והיא נמחקה.',
  ],
  pageAddresses: [
    'כתובות דפים ברישומי הסכמה, בהרשמות לניוזלטר ובמקורות לקוחות מוצגות בלי מחרוזת השאילתה או החלק שאחרי #, ולכן כתובת דף ריקה יכולה לומר שהכתובת המקורית הכילה רק שאילתה או קטע, ולא שלא נרשמה כתובת.',
  ],
  website: [
    'כדי לבנות דף מחדש, קראו יחד את website_blocks (הבסיס) ואת website_content (העריכות שלך).',
    'business_profile.subdomain הוא הקובע; website_pages.subdomain הוא העתק לכל דף.',
    'סיכומי לחיצות, הרשמות והכנסות של קישורים חכמים אינם בקובץ; התשלומים עצמם נמצאים ב-payments.',
  ],
  retention: [
    'קישור ההורדה עובד 3 ימים, ואז הקובץ נמחק. אפשר להכין ייצוא חדש בכל עת (אחד בכל פעם, עד 3 ביום).',
    'ההורדה מהמסך אורזת עד 40 MB של קבצים, 150 קבצים ו-100,000 רשומות.',
  ],
  questions: ['לשאלות על הייצוא הזה, פנו לתמיכה של AgentPilot.'],
};

const COPY: Record<ReadmeLang, Copy> = { en: EN, he: HE };

/** The README as blocks, in README_BLOCK_IDS order (the test keys on ids, not prose). */
export function buildReadmeBlocks(lang: ReadmeLang, facts: ReadmeFacts): ReadmeBlock[] {
  const copy = COPY[lang];
  const name = cleanBusinessName(facts.businessName) ?? copy.accountHolder;
  const sectionLines = facts.sections.map(
    (section) =>
      `records/${section.group}/${section.id}.csv: ${copy.sectionNames[section.id]} (${copy.groupNames[section.group]}): ` +
      `${copy.rows(section.rowCount)}, ${section.status === 'ok' ? copy.complete : copy.couldNotBeRead}`
  );
  const lines: Record<ReadmeBlockId, string[]> = {
    title: copy.title(facts),
    contents: copy.contents,
    controller: copy.controller(name),
    sections: sectionLines,
    files: copy.files(facts.files),
    not_included: copy.notIncluded,
    how_to_read: copy.howToRead,
    timezones: copy.timezones,
    money: copy.money,
    consent: copy.consent,
    page_addresses: copy.pageAddresses,
    website: copy.website,
    retention: copy.retention,
    questions: copy.questions,
  };
  return README_BLOCK_IDS.map((id) => ({ id, heading: copy.headings[id], lines: lines[id] }));
}

/** The README text, CRLF line ends (opens cleanly in Notepad). The caller adds the BOM. */
export function buildReadme(lang: ReadmeLang, facts: ReadmeFacts): string {
  const out: string[] = [];
  for (const block of buildReadmeBlocks(lang, facts)) {
    out.push(`== ${block.heading} ==`, '', ...block.lines.map((line) => `- ${line}`), '');
  }
  return out.join('\r\n');
}
