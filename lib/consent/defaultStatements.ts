/**
 * The sentence a visitor agrees to when they tick the marketing box.
 *
 * Every tenant can write their own. This is what they get if they never do —
 * and it has to be good enough to rely on, because the alternative to a default
 * is a blank label, which makes consent uncollectable for anyone who has not
 * been through the settings panel.
 *
 * Three properties the wording has to hold, in every locale:
 *
 *   SPECIFIC   names the business and names the channel (email), so it cannot
 *              be read as blanket permission for anything else.
 *   INFORMED   says what the messages are about, and points at the privacy
 *              notice.
 *   WITHDRAWABLE says how to stop, in the same breath as the agreement.
 *
 * `STATEMENT_VERSION` is stamped onto every recorded grant. Bump it when the
 * wording changes materially, so an old consent is still readable as consent to
 * the old words rather than silently re-attributed to the new ones.
 *
 * @module lib/consent/defaultStatements
 */

export const STATEMENT_VERSION = 1;

export type ConsentLocale = 'en' | 'he' | 'es';

const DEFAULTS: Record<ConsentLocale, (businessName: string) => string> = {
  en: (b) =>
    `Yes, ${b} may email me occasional news, offers and reminders. ` +
    `I can unsubscribe at any time using the link in any of those emails.`,

  he: (b) =>
    `כן, אני מאשר/ת ל${b} לשלוח לי מדי פעם עדכונים, הצעות ותזכורות במייל. ` +
    `אפשר להסיר את ההרשמה בכל עת באמצעות הקישור שבתחתית כל הודעה.`,

  es: (b) =>
    `Sí, ${b} puede enviarme por correo electrónico novedades, ofertas y recordatorios ocasionales. ` +
    `Puedo darme de baja en cualquier momento con el enlace incluido en esos correos.`,
};

/** Falls back to English for a locale we have no wording for. */
export function defaultStatement(locale: string, businessName: string): string {
  const key = (locale || 'en').slice(0, 2).toLowerCase() as ConsentLocale;
  const build = DEFAULTS[key] ?? DEFAULTS.en;
  return build(businessName?.trim() || 'this business');
}

/**
 * The tenant's wording for a locale, or the platform default.
 *
 * Callers pass whatever the settings row holds; an empty string counts as
 * unset, because a tenant who cleared the box did not mean "show nothing".
 */
export function resolveStatement(params: {
  locale: string;
  businessName: string;
  tenantStatements?: {
    statement_en?: string | null;
    statement_he?: string | null;
    statement_es?: string | null;
    statement_version?: number | null;
  } | null;
}): { text: string; locale: ConsentLocale; version: number } {
  const key = (params.locale || 'en').slice(0, 2).toLowerCase() as ConsentLocale;
  const locale: ConsentLocale = key in DEFAULTS ? key : 'en';

  const custom = params.tenantStatements?.[`statement_${locale}` as const];
  const isCustom = Boolean(custom?.trim());
  const text = isCustom ? custom!.trim() : defaultStatement(locale, params.businessName);

  // A tenant's own wording is versioned by the tenant; the platform default is
  // versioned by the platform. Stamping the tenant's number onto default text
  // would misattribute the words if they later edit them.
  const version = isCustom
    ? params.tenantStatements?.statement_version ?? 1
    : STATEMENT_VERSION;

  return { text, locale, version };
}
