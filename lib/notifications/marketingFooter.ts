/**
 * The footer every marketing email carries, and cannot be sent without.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO THINGS THE LAW ASKS FOR, IN ONE PLACE.
 *
 *   a way to leave     a visible link, not only the `List-Unsubscribe` header.
 *                      The header is for the mail client; plenty of readers
 *                      never see that control and look for the word in the
 *                      body.
 *   a postal address   CAN-SPAM §7704(a)(5) wants a physical address in every
 *                      commercial message, and consent does not substitute for
 *                      it. The gate already refuses a business that has not
 *                      given one, so by the time this runs there is one to
 *                      print.
 *
 * Appended by the TRANSPORT rather than by templates, which is the whole point:
 * the transport is the only place that sees every marketing send. A template
 * that forgot would otherwise be a compliance failure nobody notices until a
 * complaint.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT THROWS RATHER THAN DEGRADING.
 *
 * Every other thing in the transport falls back: a missing brand uses the
 * default, a failed lookup logs and continues. Not this. A marketing email
 * without a way off is the one send that cannot be taken back, so an absent
 * address or link stops it.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Plain, legible, and styled inline: no stylesheet survives every client. */
const COPY = {
  en: {
    why: (b: string) => `You are receiving this because you agreed to hear from ${b}.`,
    unsubscribe: 'Unsubscribe',
  },
  he: {
    why: (b: string) => `קיבלתם את ההודעה הזאת כי אישרתם לקבל עדכונים מ${b}.`,
    unsubscribe: 'הסרה מרשימת התפוצה',
  },
  es: {
    why: (b: string) => `Recibes esto porque aceptaste recibir mensajes de ${b}.`,
    unsubscribe: 'Darse de baja',
  },
} as const;

export interface MarketingFooterInput {
  businessName: string;
  postalAddress: string;
  unsubscribeUrl: string;
  locale?: string;
  /** Right-to-left languages need the block mirrored, like every other email. */
  isRtl?: boolean;
}

export class MarketingFooterError extends Error {}

/** Minimal escaping: these three values reach an HTML document. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildMarketingFooter(input: MarketingFooterInput): string {
  const businessName = input.businessName?.trim();
  const postalAddress = input.postalAddress?.trim();
  const unsubscribeUrl = input.unsubscribeUrl?.trim();

  if (!businessName || !postalAddress || !unsubscribeUrl) {
    throw new MarketingFooterError(
      'A marketing email needs a business name, a postal address and an unsubscribe link'
    );
  }

  const t = COPY[(input.locale ?? 'en') as keyof typeof COPY] ?? COPY.en;
  const dir = input.isRtl ? 'rtl' : 'ltr';
  const align = input.isRtl ? 'right' : 'left';

  /*
   * A table, because Outlook's rendering engine still does not lay out a
   * `div` with padding reliably — the same reason every template in this
   * product is built out of tables.
   */
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" dir="${dir}" style="margin-top:28px;border-top:1px solid #E5E7EB;">
  <tr>
    <td style="padding:16px 8px 0;text-align:${align};font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#6B7280;">
      <div>${escapeHtml(t.why(businessName))}</div>
      <div style="margin-top:4px;">${escapeHtml(postalAddress)}</div>
      <div style="margin-top:8px;">
        <a href="${escapeHtml(unsubscribeUrl)}" style="color:#6B7280;text-decoration:underline;">${escapeHtml(t.unsubscribe)}</a>
      </div>
    </td>
  </tr>
</table>`.trim();
}

/**
 * Put the footer inside the document rather than after it.
 *
 * Appending to the raw string would leave markup after `</body>`, which some
 * clients drop and others render outside the styled wrapper. Falls back to a
 * plain append when there is no `</body>` — a fragment, which some callers do
 * send.
 */
export function appendMarketingFooter(html: string, footer: string): string {
  const closing = /<\/body\s*>/i;

  return closing.test(html) ? html.replace(closing, `${footer}</body>`) : `${html}${footer}`;
}
