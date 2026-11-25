/**
 * Proposal PDF.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NEVER IMPORT THIS STATICALLY FROM ANYTHING JEST TOUCHES
 *
 * `@react-pdf/renderer` registers fonts as a side effect of being imported, and
 * Jest cannot transform it — seven places in this codebase already carry that
 * note, and one of them records that every unit test of write safety hung
 * outright until the import was made dynamic. Reach it with
 * `await import('@/lib/pdf/ProposalPDFGenerator')` at the call site, the way
 * `ProposalAcceptanceService.ts:795-801` reaches `PaymentReminderService`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * GENERATED, NEVER STORED
 *
 * The invoice route works this way and the reason is the same: a quote can be
 * superseded, and a stored PDF would go on describing the version it was made
 * from. Rendering on demand means the file cannot disagree with the row.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT DOES NOT RE-ADD THE MONEY
 *
 * Every figure arrives already rounded and already summing to `total` —
 * `proposalContent.ts` did that, and the route refused anything that did not.
 * This file formats. A PDF that recomputed would be a third opinion on what the
 * client owes, and the one they would print.
 */

import React from 'react';
import { Document, Page, Text, View, Image, StyleSheet, renderToBuffer } from '@react-pdf/renderer';
import { setupHebrewPDF, getRTLPageStyle, RTLText, formatCurrencyRTL } from 'react-pdf-rtl';
import { formatAddressLines } from '@/lib/geo/address';
import { registerThemeFont } from './themeFonts';
import { pdfLogoSource } from './logoSource';
import { createLogger } from '@/lib/logger';
import { itemAmount, subtotalOf, taxOf, type ProposalContent } from '@/lib/business-os/proposals/proposalContent';
import { renderText } from '@/lib/business-os/mail/replyBody';

const logger = createLogger({ module: 'ProposalPDFGenerator' });

/* Registered once per process, exactly as the invoice generator does it. */
let hebrewSetupDone = false;
function ensureHebrewSetup() {
  if (!hebrewSetupDone) {
    setupHebrewPDF('Rubik');
    hebrewSetupDone = true;
  }
}

type Language = 'en' | 'es' | 'he';

const LABELS: Record<Language, Record<string, string>> = {
  en: {
    proposal: 'Proposal', preparedFor: 'Prepared for', dated: 'Dated', validUntil: 'Valid until',
    overview: 'Overview', items: 'Items', date: 'Date', item: 'Item', qty: 'Qty',
    unit: 'Unit price', amount: 'Amount', subtotal: 'Subtotal', total: 'Total',
    stages: 'How it is paid', terms: 'Payment terms', onReceipt: 'On receipt',
    net: 'Net {days} days', sessions: 'Meetings', included: 'included', taxId: 'Tax ID', paymentInfo: 'Payment details', bank: 'Bank', account: 'Account', routing: 'Routing', thanks: 'Thank you for your business!', signedOn: 'Signed on',
  },
  es: {
    proposal: 'Presupuesto', preparedFor: 'Para', dated: 'Fecha', validUntil: 'Válido hasta',
    overview: 'Resumen', items: 'Partidas', date: 'Fecha', item: 'Partida', qty: 'Cant.',
    unit: 'Precio unit.', amount: 'Importe', subtotal: 'Subtotal', total: 'Total',
    stages: 'Cómo se paga', terms: 'Condiciones', onReceipt: 'Al recibir',
    net: '{days} días', sessions: 'Sesiones', included: 'incluido', taxId: 'NIF', paymentInfo: 'Datos de pago', bank: 'Banco', account: 'Cuenta', routing: 'Sucursal', thanks: '¡Gracias por su confianza!', signedOn: 'Firmado el',
  },
  he: {
    proposal: 'הצעת מחיר', preparedFor: 'עבור', dated: 'תאריך', validUntil: 'בתוקף עד',
    overview: 'תקציר', items: 'פריטים', date: 'תאריך', item: 'פריט', qty: 'כמות',
    unit: 'מחיר יחידה', amount: 'סכום', subtotal: 'סכום ביניים', total: 'סה״כ',
    stages: 'אופן התשלום', terms: 'תנאי תשלום', onReceipt: 'עם קבלת החשבונית',
    net: 'שוטף + {days}', sessions: 'פגישות', included: 'כלול', taxId: 'ח.פ', paymentInfo: 'פרטי תשלום', bank: 'בנק', account: 'חשבון', routing: 'סניף', thanks: 'תודה על עסקך!', signedOn: 'נחתם בתאריך',
  },
};

export interface ProposalPDFData {
  number: string;
  title: string;
  description: string | null;
  total: number;
  currency: string;
  validUntil: string | null;
  termsDays: number | null;
  /** Null for a quote priced as one figure, which is most of them. */
  content: ProposalContent | null;
  stages: Array<{ label: string; amount: number }>;
  clientName: string | null;
  clientEmail: string | null;
  letterhead: {
    name: string | null;
    /*
     * The ADDRESS OBJECT, not a string.
     *
     * `business_profiles.invoice_address` is jsonb — `{line1, city, state,
     * postal_code, country}` — and interpolating it rendered `[object Object]`
     * on the letterhead of a live quote. `formatAddressLines` is what the
     * invoice uses, and it translates the country code into the document's own
     * language rather than printing `US` to a Hebrew reader.
     */
    address: Record<string, unknown> | null;
    taxId: string | null;
    phone: string | null;
    email: string | null;
    logoUrl: string | null;
    /*
     * Resolved before the document is built, because turning an SVG into
     * something drawable needs a fetch and a rasterise — neither of which a
     * render function can await. See `pdfLogoSource`.
     */
    logoSrc?: string | null;
  };
  /**
   * HOW TO PAY, when the business has said.
   *
   * The invoice carries this in a tinted box and the quote carried nothing —
   * yet a quote with a deposit due on acceptance is precisely where a client
   * needs to know where the money goes. Same four fields, same source, so the
   * two documents cannot give different instructions.
   */
  payment?: {
    bankName?: string | null;
    bankAccount?: string | null;
    bankRouting?: string | null;
    instructions?: string | null;
  } | null;
  /**
   * The signature, once the client has given one.
   *
   * Only ever on an ACCEPTED quote — there is nothing to show before, and a
   * signature block on an open quote would suggest it had been agreed.
   */
  signature?: {
    name: string;
    signedAt: string;
    /** The drawn mark. Absent on a signature taken as a typed name alone. */
    image?: string | null;
  } | null;
  footerText?: string | null;
  language?: Language;
  branding?: { primaryColor?: string; headingFont?: string; bodyFont?: string };
}

/**
 * Text that knows which way round it goes.
 *
 * `InvoicePDFGenerator` has the same component and the same reason: plain
 * `<Text>` leaves bidi reordering to the PDF layer, which gets a mixed string
 * wrong. A live quote rendered its own number as "48FEB85A#" and its client
 * line as "המלך דויד :עבור" — the punctuation and the Latin run migrated.
 *
 * `RTLText` handles the segmentation. Used for EVERY string on a Hebrew page,
 * not only the obviously mixed ones: a label that is pure Hebrew today picks up
 * a number tomorrow.
 */
/**
 * What `Text` and `RTLText` both accept.
 *
 * These were typed `object`, which is not assignable to react-pdf's
 * `Style | Style[]` and errored at every call site that passed a style array.
 *
 * Taken from `RTLText`, NOT `Text`, and the direction matters: `Text` accepts a
 * wider union that also admits SVG presentation attributes, and a style typed
 * that wide cannot be handed to `RTLText`. The narrower of the two goes both
 * ways. `InvoicePDFGenerator` reads it off `RTLText` for the same reason.
 */
type PDFStyle = React.ComponentProps<typeof RTLText>['style'];

const T: React.FC<{ children: React.ReactNode; style?: PDFStyle; isRTL: boolean }> = ({
  children,
  style,
  isRTL,
}) => {
  /*
   * ONE STRING, ALWAYS — and flattened here rather than trusted.
   *
   * `RTLText` takes a string, so this used `String(children)`. JSX hands a
   * component with two children an ARRAY, and `String(['#','A85FEB48'])` is
   * `"#,A85FEB48"` — Array.prototype.toString joins with commas. A live quote
   * printed its own number as `#,A85FEB48`, its client line as
   * `עבור:, ,דויד המלך`, and its tax id as `ח.פ:, 99-99999,`.
   *
   * Every call site now passes a single template literal, and this flatten is
   * the belt to that braces: the next person to write `{a} {b}` here gets a
   * space, not a comma.
   */
  const text = Array.isArray(children) ? children.join('') : String(children ?? '');
  return isRTL ? <RTLText style={style}>{text}</RTLText> : <Text style={style}>{children}</Text>;
};

/**
 * A money value. PLAIN `Text`, never `RTLText`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `formatCurrencyRTL` HAS ALREADY DONE THE BIDI WORK
 *
 * It returns a string whose symbol and digits are ordered, with its own
 * directional marks embedded. Passing that through `RTLText` segments and
 * re-orders an already-ordered string, and the symbol can be dropped — which
 * is what happened to one live quote's grand total: `סה״כ 750`, no currency,
 * directly beneath a subtotal reading `₪750`.
 *
 * `InvoicePDFGenerator` draws every figure with a plain `<Text>` and reserves
 * `SmartText` for labels. That is why its shekel has never gone missing, and
 * it is the reason this exists rather than another `<T>`.
 */
const Money: React.FC<{ children: string; style?: PDFStyle }> = ({ children, style }) => (
  <Text style={style}>{children}</Text>
);

function ProposalDocument({ data }: { data: ProposalPDFData }) {
  const language: Language = data.language || 'en';
  const isRTL = language === 'he';
  const L = LABELS[language];
  const align = isRTL ? ('right' as const) : ('left' as const);
  const alignEnd = isRTL ? ('left' as const) : ('right' as const);
  const row = isRTL ? ('row-reverse' as const) : ('row' as const);
  /*
   * The business's own colour, used the way the invoice uses it: the name, the
   * section headings, the table header and the grand total. A quote and the
   * invoice that follows it are the same business talking, and a grey quote
   * followed by a green invoice reads as two.
   */
  const accent = data.branding?.primaryColor || '#1F2937';
  /** Formatted by the shared helper, so `US` reads as ארצות הברית in Hebrew. */
  const addressLines = data.letterhead.address
    ? formatAddressLines(
        data.letterhead.address as Parameters<typeof formatAddressLines>[0],
        language
      )
    : [];
  const font = isRTL ? 'Rubik' : data.branding?.bodyFont || 'Helvetica';

  /*
   * THE INVOICE'S FORMATTER, COPIED EXACTLY.
   *
   * Plain `Intl` with `he-IL` puts the shekel AFTER the number, so the quote
   * printed `100₪` while the invoice that follows it prints `₪150`. One
   * business, two conventions, on two documents a client reads side by side.
   *
   * `formatCurrencyRTL` is what the invoice uses for Hebrew + ILS, and it is
   * the reason that one reads correctly. Every other pairing falls through to
   * `Intl`, as it does there.
   */
  const money = (amount: number): string => {
    const currency = (data.currency || 'USD').toUpperCase();
    if (isRTL && currency === 'ILS') return formatCurrencyRTL(amount, '₪', 'he-IL');
    return new Intl.NumberFormat(
      language === 'he' ? 'he-IL' : language === 'es' ? 'es-ES' : 'en-US',
      { style: 'currency', currency }
    ).format(amount);
  };

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * 700, NEVER 600.
   *
   * `react-pdf-rtl` registers Rubik at 300, 400, 500 and 700. A style asking
   * for 600 gets no registered face, React-PDF falls back, and the fallback has
   * no ₪ glyph — so the character is dropped SILENTLY.
   *
   * On a live quote that meant `סה״כ 750` with no currency at all, while the
   * subtotal and the tax above it — styled at the default weight — kept theirs.
   * A total with no currency on a document somebody is about to agree to.
   *
   * `InvoicePDFGenerator` uses 700 in all seventeen of its weighted styles,
   * which is why its shekel has always rendered.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const s = StyleSheet.create({
    /*
     * `getRTLPageStyle` takes a FONT FAMILY, not a flag — its signature is
     * `(fontFamily?: string)` and its own example is `getRTLPageStyle("Rubik")`.
     * Handing it a boolean sets the page's font to `true`.
     *
     * Applied only for Hebrew, and spread FIRST so the explicit values below
     * win. `InvoicePDFGenerator` imports this helper and never calls it, so
     * there is no precedent here to follow — this is the documented usage.
     */
    page: {
      ...(isRTL ? getRTLPageStyle('Rubik') : {}),
      paddingTop: 38,
      /* 38, not 46: the page-number footer is absolute at `bottom: 24`, so
         the reserve only has to clear it. The extra 8pt of flow space was
         enough to tip a full-but-fitting quote onto a second page. */
      paddingBottom: 38,
      paddingHorizontal: 40,
      fontSize: 9.5,
      fontFamily: font,
      color: '#1F2937',
    },
    head: { flexDirection: row, justifyContent: 'space-between', marginBottom: 22 },
    logo: { width: 46, height: 46, marginEnd: 10, objectFit: 'contain' },
    bizName: { fontSize: 13, fontWeight: 700, marginBottom: 2, textAlign: align },
    bizLine: { fontSize: 8.5, color: '#6B7280', textAlign: align, lineHeight: 1.5 },
    meta: { fontSize: 8.5, color: '#6B7280', textAlign: alignEnd, lineHeight: 1.7 },
    metaStrong: { fontSize: 10, color: '#111827', fontWeight: 700 },
    title: { fontSize: 16, fontWeight: 700, marginBottom: 4, textAlign: align, color: accent },
    section: { fontSize: 8, fontWeight: 700, letterSpacing: 0.6, color: '#9CA3AF', marginTop: 18, marginBottom: 6, textAlign: align },
    body: { fontSize: 9.5, color: '#4B5563', lineHeight: 1.6, textAlign: align },
    /* The brand bar the invoice's table wears, so the two documents read as
       one business rather than two templates. */
    thead: { flexDirection: row, backgroundColor: accent, paddingVertical: 5, paddingHorizontal: 6, marginBottom: 2 },
    th: { fontSize: 7.5, fontWeight: 700, color: '#FFFFFF', letterSpacing: 0.4 },
    itemRow: { flexDirection: row, paddingVertical: 6, paddingHorizontal: 6, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
    cDate: { width: 56, fontSize: 8.5, color: '#9CA3AF', textAlign: align },
    cLabel: { flex: 1, paddingHorizontal: 6 },
    cQty: { width: 34, fontSize: 9.5, textAlign: alignEnd },
    cUnit: { width: 62, fontSize: 9.5, textAlign: alignEnd },
    cNum: { width: 68, fontSize: 9.5, textAlign: alignEnd },
    itemName: { fontSize: 10, fontWeight: 700, textAlign: align },
    itemBody: { fontSize: 8.5, color: '#6B7280', marginTop: 2, lineHeight: 1.5, textAlign: align },
    totals: { marginTop: 10, alignSelf: isRTL ? 'flex-start' : 'flex-end', width: 190 },
    tRow: { flexDirection: row, justifyContent: 'space-between', paddingVertical: 2.5 },
    tLabel: { fontSize: 9, color: '#6B7280' },
    tValue: { fontSize: 9, textAlign: alignEnd },
    grand: { flexDirection: row, justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: '#D1D5DB', marginTop: 4, paddingTop: 6 },
    grandLabel: { fontSize: 11, fontWeight: 700 },
    /*
     * NO `fontWeight` — and that is the whole reason the shekel is visible.
     *
     * Measured on the running server against a live quote, rendering the SAME
     * string four ways in one document:
     *
     *   fontSize 13, fontWeight 700  ->  750     the symbol is not emitted
     *   fontSize 13                  ->  ₪750
     *   fontSize 9,  fontWeight 700  ->  750     not emitted
     *   fontSize 9                   ->  ₪750
     *
     * Same font resource (/F2) in all four, same subset, same `money()` call.
     * Weight alone decides whether U+20AA survives — Hebrew LETTERS come
     * through at 700 (the `סה״כ` label beside this is 700 and renders), so it
     * is that one glyph missing from whatever face react-pdf resolves for bold.
     *
     * The grand total was the only money in the document drawn bold, which is
     * why it was the only figure that printed without its currency, directly
     * under a subtotal reading `₪750`.
     *
     * Emphasis now comes from size and the brand colour, which is how the
     * figure already read. Do not put a weight back on this style without
     * re-running that four-way test — a bold total that silently loses its
     * currency is worse than a total that is merely large.
     */
    grandValue: { fontSize: 13, color: accent, textAlign: alignEnd },
    foot: { position: 'absolute', bottom: 24, left: 40, right: 40, fontSize: 7.5, color: '#9CA3AF', textAlign: 'center' },
    clientName: { fontSize: 11, fontWeight: 700, textAlign: align, marginBottom: 1 },
    signBox: { marginTop: 22, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#E5E7EB' },
    signMark: { width: 150, height: 52, objectFit: 'contain', marginBottom: 2 },
    signRule: { width: 170, borderBottomWidth: 1, borderBottomColor: '#9CA3AF', marginBottom: 4 },
    signName: { fontSize: 10, fontWeight: 700, textAlign: align },
    signWhen: { fontSize: 8, color: '#6B7280', textAlign: align },
    payBox: { marginTop: 18, padding: 11, borderRadius: 6, backgroundColor: '#FFFBEB', borderWidth: 1, borderColor: '#FDE68A' },
    payHead: { fontSize: 9.5, fontWeight: 700, color: '#92400E', marginBottom: 5, textAlign: align },
    payLine: { fontSize: 9, color: '#1F2937', marginBottom: 3, textAlign: align },
    payNote: { fontSize: 8, color: '#6B7280', textAlign: align },
    footThanks: { marginTop: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#E5E7EB', fontSize: 8.5, color: '#9CA3AF', textAlign: 'center' },
    footNote: { marginTop: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#E5E7EB', fontSize: 9, textAlign: 'center' },
  });

  const items = data.content?.items ?? [];
  const subtotal = subtotalOf(items);
  const taxAmount = data.content ? taxOf(subtotal, data.content.tax) : 0;

  const terms =
    data.termsDays === null
      ? null
      : data.termsDays === 0
        ? L.onReceipt
        : L.net.replace('{days}', String(data.termsDays));

  return (
    <Document title={`${L.proposal} ${data.number}`}>
      <Page size="A4" style={s.page}>
        {/* Letterhead */}
        <View style={s.head} fixed>
          <View style={{ flexDirection: row, flex: 1 }}>
            {data.letterhead.logoSrc ? (
              /* This `Image` is react-pdf's, not the DOM's — it renders into a
                 PDF and takes no `alt`. The a11y rule cannot tell them apart.

                 Guarded by format: PNG and JPEG only. See lib/pdf/logoSource.ts
                 for why an SVG renders as nothing at all. */
              // eslint-disable-next-line jsx-a11y/alt-text
              <Image src={data.letterhead.logoSrc} style={s.logo} />
            ) : null}
            <View style={{ flex: 1 }}>
              {data.letterhead.name ? (
                /* In the brand colour, as the invoice sets its business name. */
                <T isRTL={isRTL} style={[s.bizName, { color: accent }]}>
                  {data.letterhead.name}
                </T>
              ) : null}
              {/*
                One line per address line, not everything joined by a dot.
                `formatAddressLines` returns the lines a postal address is
                actually written in, and flattening them was what produced the
                `[object Object] · +1201… · …` run on the live quote.
              */}
              {addressLines.map((line, i) => (
                <T key={`addr-${i}`} isRTL={isRTL} style={s.bizLine}>
                  {line}
                </T>
              ))}
              {[data.letterhead.phone, data.letterhead.email].filter(Boolean).length ? (
                <T isRTL={isRTL} style={s.bizLine}>
                  {[data.letterhead.phone, data.letterhead.email].filter(Boolean).join(' · ')}
                </T>
              ) : null}
              {data.letterhead.taxId ? (
                <T isRTL={isRTL} style={s.bizLine}>
                  {`${L.taxId}: ${data.letterhead.taxId}`}
                </T>
              ) : null}
            </View>
          </View>
          <View>
            <T isRTL={isRTL} style={s.meta}>{L.proposal}</T>
            {/* Its own line, and its own run. Inline inside the label it came
                out as "48FEB85A#" — the number reversed and the hash left
                behind — because a Latin id inside a Hebrew sentence is a bidi
                boundary the PDF layer resolves the wrong way. */}
            <T isRTL={isRTL} style={[s.meta, s.metaStrong, { color: accent }]}>
              {`#${data.number}`}
            </T>
            {data.validUntil ? (
              <T isRTL={isRTL} style={s.meta}>
                {`${L.validUntil} ${data.validUntil}`}
              </T>
            ) : null}
          </View>
        </View>

        <T isRTL={isRTL} style={s.title}>{data.title}</T>

        {/*
          A LABELLED BLOCK, as the invoice's `לכבוד` is.
          ───────────────────────────────────────────────────────────────────
          The client's name sat inline under the title as `עבור: דויד המלך` —
          readable, but nothing on the page said it was a section, so the
          document opened with four unlabelled lines. The invoice names this
          block and the quote should read the same way.

          The name and the email stay on separate lines: an email is a Latin
          run, and inline it reorders the Hebrew around it.
        */}
        {(data.clientName || data.clientEmail) && (
          <View style={{ marginTop: 10 }}>
            <T isRTL={isRTL} style={s.section}>{L.preparedFor}</T>
            {data.clientName ? (
              <T isRTL={isRTL} style={s.clientName}>{data.clientName}</T>
            ) : null}
            {data.clientEmail ? (
              <T isRTL={isRTL} style={s.bizLine}>{data.clientEmail}</T>
            ) : null}
          </View>
        )}

        {data.description ? (
          <>
            <T isRTL={isRTL} style={s.section}>{L.overview}</T>
            <T isRTL={isRTL} style={s.body}>{data.description}</T>
          </>
        ) : null}

        {/* The breakdown. Omitted for a quote priced as one figure. */}
        {items.length > 0 && (
          <>
            <T isRTL={isRTL} style={s.section}>{L.items}</T>
            {/*
              FIVE COLUMNS, matching the invoice's.

              It carried date / item / amount only, so a line reading "400₪"
              never said it was 2 × 200₪ — the quantity and unit price were in
              the data, shown in the builder, and dropped on the way to the
              document the client actually keeps.
            */}
            {/*
              NOT `fixed`.
              ─────────────────────────────────────────────────────────────
              `fixed` repeats an element on EVERY page, not on every page the
              table continues onto — and this table is followed by totals,
              stages, the payment box and the footer. So a second page carrying
              only those rendered a green column header with nothing under it,
              and on a quote that overflowed by a point or two, a page
              containing nothing BUT that header.

              The cost is that a genuinely long item list does not repeat its
              header. That is the lesser loss: a phantom header over the wrong
              content is wrong on every document, while a sixty-item quote is
              rare and still readable.
            */}
            <View style={s.thead}>
              {/*
                COLUMN FIRST, `th` SECOND.

                Later entries in a react-pdf style array win, and `cDate`
                carries `color: '#9CA3AF'` for the muted date in the BODY rows.
                With `th` first, that grey overrode the header's white and
                `תאריך` printed as faint grey on the brand bar while the other
                four were white — one heading looking disabled.

                Only the date column had a colour of its own, which is why only
                that heading was wrong. Reversed on all five so the rule holds
                whichever column gains a colour next.
              */}
              <T isRTL={isRTL} style={[s.cDate, s.th]}>{L.date}</T>
              <T isRTL={isRTL} style={[s.cLabel, s.th]}>{L.item}</T>
              <T isRTL={isRTL} style={[s.cQty, s.th]}>{L.qty}</T>
              <T isRTL={isRTL} style={[s.cUnit, s.th]}>{L.unit}</T>
              <T isRTL={isRTL} style={[s.cNum, s.th]}>{L.amount}</T>
            </View>
            {items.map(item => {
              const text = renderText(item.body).trim();
              return (
                /*
                 * `wrap` left on, so a long description flows to the next page
                 * instead of being clipped — the thing invoices never had to
                 * handle. The name and its amount are kept together inside.
                 */
                <View key={item.id} style={s.itemRow}>
                  <T isRTL={isRTL} style={s.cDate}>{item.date ?? ''}</T>
                  <View style={s.cLabel}>
                    <T isRTL={isRTL} style={s.itemName}>{item.label}</T>
                    {text ? <T isRTL={isRTL} style={s.itemBody}>{text}</T> : null}
                  </View>
                  <Money style={s.cQty}>{String(item.qty)}</Money>
                  <Money style={s.cUnit}>{money(item.unitPrice)}</Money>
                  <Money style={s.cNum}>{money(itemAmount(item))}</Money>
                </View>
              );
            })}

            <View style={s.totals} wrap={false}>
              <View style={s.tRow}>
                <T isRTL={isRTL} style={s.tLabel}>{L.subtotal}</T>
                <Money style={s.tValue}>{money(subtotal)}</Money>
              </View>
              {data.content && data.content.tax.rate > 0 ? (
                <View style={s.tRow}>
                  <T isRTL={isRTL} style={s.tLabel}>
                    {`${data.content.tax.label} ${data.content.tax.rate}%${
                      data.content.tax.inclusive ? ` · ${L.included}` : ''
                    }`}
                  </T>
                  <Money style={s.tValue}>{money(taxAmount)}</Money>
                </View>
              ) : null}
            </View>
          </>
        )}

        {/* The figure being approved — always, breakdown or not. */}
        <View style={s.totals} wrap={false}>
          <View style={s.grand}>
            <T isRTL={isRTL} style={s.grandLabel}>{L.total}</T>
            <Money style={s.grandValue}>{money(data.total)}</Money>
          </View>
        </View>

        {data.stages.length > 1 && (
          <View wrap={false}>
            <T isRTL={isRTL} style={s.section}>{L.stages}</T>
            {data.stages.map((stage, i) => (
              <View key={`${stage.label}-${i}`} style={s.tRow}>
                <T isRTL={isRTL} style={s.tLabel}>{stage.label}</T>
                <Money style={s.tValue}>{money(stage.amount)}</Money>
              </View>
            ))}
          </View>
        )}

        {terms ? (
          <T isRTL={isRTL} style={[s.body, { marginTop: 14 }]}>
            {`${L.terms}: ${terms}`}
          </T>
        ) : null}

        {/*
          THE SIGNATURE, on an accepted quote.
          ───────────────────────────────────────────────────────────────────
          The mark above a rule, the name and the date beneath it — the shape
          a signed document has had for a very long time, and the reason the
          drawing is captured at all: what makes this read as a contract is
          seeing it here, not storing it.

          The name is printed whether or not a drawing exists. It is the
          legible record; the mark is a picture of one.
        */}
        {data.signature && (
          <View style={s.signBox} wrap={false}>
            {data.signature.image ? (
              // eslint-disable-next-line jsx-a11y/alt-text
              <Image src={data.signature.image} style={s.signMark} />
            ) : null}
            <View style={s.signRule} />
            <T isRTL={isRTL} style={s.signName}>{data.signature.name}</T>
            <T isRTL={isRTL} style={s.signWhen}>
              {`${L.signedOn} ${data.signature.signedAt}`}
            </T>
          </View>
        )}

        {/*
          Where the money goes. Same box, same colours, same four lines as the
          invoice — a client who reads both must not be given two answers.
        */}
        {(data.payment?.bankName ||
          data.payment?.bankAccount ||
          data.payment?.bankRouting ||
          data.payment?.instructions) && (
          <View style={s.payBox} wrap={false}>
            <T isRTL={isRTL} style={s.payHead}>{L.paymentInfo}</T>
            {data.payment.bankName ? (
              <T isRTL={isRTL} style={s.payLine}>{`${L.bank}: ${data.payment.bankName}`}</T>
            ) : null}
            {data.payment.bankAccount ? (
              <T isRTL={isRTL} style={s.payLine}>{`${L.account}: ${data.payment.bankAccount}`}</T>
            ) : null}
            {data.payment.bankRouting ? (
              <T isRTL={isRTL} style={s.payLine}>{`${L.routing}: ${data.payment.bankRouting}`}</T>
            ) : null}
            {data.payment.instructions ? (
              <T isRTL={isRTL} style={s.payNote}>{data.payment.instructions}</T>
            ) : null}
          </View>
        )}

        {/*
          THE FOOTER THE INVOICE HAS AND THIS DID NOT.

          A page number alone is a system artefact. The invoice closes with the
          business's own line — `invoice_footer_text` — and a quote that ends
          mid-air after the payment terms reads as unfinished beside it.

          The number stays, below it: a client printing a three-page proposal
          needs to know they have all three.
        */}
        {/*
          TWO LINES, as the invoice closes with.

          The business's own words in the brand colour, then a plain thank-you
          beneath. The invoice has both and the quote had only the first, so a
          business that never wrote a footer line closed its quotes on the
          payment terms and nothing else.

          The second is unconditional for that reason: it is the line that
          makes the document end rather than stop.
        */}
        {data.footerText ? (
          <T isRTL={isRTL} style={[s.footNote, { color: accent }]}>
            {data.footerText}
          </T>
        ) : null}
        <T
          isRTL={isRTL}
          style={[s.footThanks, data.footerText ? { marginTop: 4, paddingTop: 0, borderTopWidth: 0 } : {}]}
        >
          {L.thanks}
        </T>

        <Text
          style={s.foot}
          fixed
          render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
        />
      </Page>
    </Document>
  );
}

export async function generateProposalPDFAsync(data: ProposalPDFData): Promise<Buffer> {
  const language = data.language || 'en';
  const isRTL = language === 'he';

  if (isRTL) ensureHebrewSetup();

  /* PNG/JPEG pass through; an SVG is rasterised. Null on any failure, and the
     letterhead simply renders without it. */
  const logoSrc = await pdfLogoSource(data.letterhead.logoUrl);

  /* Hebrew keeps Rubik — see lib/pdf/themeFonts.ts, same rule as the invoice. */
  let branding = data.branding;
  if (!isRTL && branding && (branding.headingFont || branding.bodyFont)) {
    const [headingFont, bodyFont] = await Promise.all([
      registerThemeFont(branding.headingFont),
      registerThemeFont(branding.bodyFont),
    ]);
    branding = { ...branding, headingFont: headingFont ?? undefined, bodyFont: bodyFont ?? undefined };
  }

  /*
   * THE CAST IS THE DUPLICATED-TYPES PROBLEM, NOT A SHORTCUT.
   *
   * `renderToBuffer` wants `ReactElement<DocumentProps>`, and a component that
   * RETURNS a `<Document>` is not that type. `InvoicePDFGenerator.tsx:473-477`
   * documents the same error at its own call site and leaves it standing,
   * noting it "needs the dependency de-duplicated, not an annotation" —
   * `react-pdf-rtl` bundles its own copy of the react-pdf types, so the two are
   * structurally alike and nominally distinct.
   *
   * De-duplicating the dependency is the real fix and is not this change's to
   * make. Narrowed here rather than left to stand, so this file does not add a
   * second instance of an error the build is configured to ignore.
   */
  const element = React.createElement(ProposalDocument, {
    data: { ...data, branding, letterhead: { ...data.letterhead, logoSrc } },
  }) as unknown as Parameters<typeof renderToBuffer>[0];

  const buffer = await renderToBuffer(element);
  logger.info({ number: data.number, language, size: buffer.length }, 'Proposal PDF generated');
  return buffer;
}
