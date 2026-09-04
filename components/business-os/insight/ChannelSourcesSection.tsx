'use client';

import { useMemo } from 'react';
import { Mail, Link2, HelpCircle, Music2, Briefcase, Play } from 'lucide-react';
import { PluginIcon } from '@/components/PluginIcon';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import type { Channel } from '@/lib/business-os/channel-insights/channelFromReferrer';

/**
 * Where the business's clients actually come from.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A TREEMAP, not a bar list, for two reasons that are both about the whole.
 *
 * The question is "where do my clients come from" — a share question. A bar list
 * answers a different one: it scales each bar against the biggest channel, so it
 * says which is largest but never what fraction anything is. A treemap cell IS
 * its share of the total; there is no scale to read and no baseline to compare
 * against.
 *
 * And it has a FIXED height. The row list grew by a row per channel, so the card
 * got taller every time a channel connected — the more a business used the
 * product, the worse its dashboard fitted. A treemap redistributes into the same
 * box whether there are three channels or ten.
 *
 * What that costs: per-channel bookings and revenue no longer have a column.
 * They are in each cell's tooltip, and revenue is printed inside any cell with
 * room for it, so the channels that matter still show their money.
 *
 * Attribution needs no connected account — it comes from the referrer already
 * recorded on every lead.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface ChannelRow {
  channel: Channel;
  leads: number;
  bookings: number;
  /** Money that actually arrived. */
  revenue: number;
  /** Money asked for, paid or not — always >= revenue. */
  billed?: number;
  leadShare: number;
  inferred: boolean;
  /** Null when the channel isn't connected — rendered as "—", never as 0. */
  reach: number | null;
  /** Connected, but the first sync hasn't produced numbers yet. */
  awaitingData?: boolean;
  /** Connected, but the platform doesn't publish reach — Meta retired it for Pages. */
  reachUnavailable?: boolean;
}

/** Where a visit landed. Not where it came from — that is the channel. */
export type VisitSurface = 'website' | 'landing' | 'smart_links' | 'analytics';

interface ChannelSourcesSectionProps {
  rows: ChannelRow[];
  totals: { leads: number; bookings: number; revenue: number; billed?: number };
  untracked: { leads: number; bookings: number; revenue: number; billed?: number };
  /**
   * Arrivals split by the page they landed on. A separate question from the
   * channel table above it: that says who sent them, this says where they went.
   * Absent surfaces are left out — a landing page nobody visited and no landing
   * page at all are different facts.
   */
  visits?: { total: number; bySurface: { surface: VisitSurface; visits: number }[] };
  /** Drop the card chrome when this sits inside a shared card. */
  embedded?: boolean;
}

const SURFACE_LABELS: Record<VisitSurface, Record<string, string>> = {
  website: { en: 'Website', es: 'Sitio web', he: 'אתר' },
  landing: { en: 'Landing pages', es: 'Páginas de destino', he: 'דפי נחיתה' },
  smart_links: { en: 'Smart links', es: 'Enlaces inteligentes', he: 'לינקים חכמים' },
  analytics: { en: 'Analytics', es: 'Analytics', he: 'אנליטיקס' },
};

/**
 * Real brand marks where the platform ships one (public/plugins/), so a channel
 * is recognised before its label is read. The rest fall back to a lucide glyph
 * describing the channel's nature.
 */
const CHANNEL_LOGOS: Partial<Record<Channel, string>> = {
  instagram: 'instagram',
  facebook: 'facebook',
  google: 'google-business-profile',
  whatsapp: 'whatsapp',
  linkedin: 'linkedin',
};

const CHANNEL_ICONS: Partial<Record<Channel, typeof Mail>> = {
  tiktok: Music2,
  youtube: Play,
  email: Mail,
  referral: Link2,
  direct: HelpCircle,
  linkedin: Briefcase,
};

/**
 * Brand colour, used on the ICON ONLY — never on the bars.
 *
 * These ten used to colour the bars, and as a chart palette they fail every
 * check: TikTok is pure black (no chroma), YouTube pure red (outside the
 * lightness band), and — the one that actually hurt — Facebook #1877F2 against
 * Google #4285F4 is ΔE 4.8 for NORMAL vision, so a reader with no colour
 * deficiency at all cannot tell those two bars apart.
 *
 * Ten saturated hues cannot be made separable; that is more categories than any
 * palette supports. But the bars never needed to carry identity: every row
 * already has the channel's logo and its name. The bar's job is magnitude, which
 * is a one-hue job. So the bars are one accent, and the brand colour survives
 * where it is recognised anyway and where nothing depends on telling two of them
 * apart — behind the icon.
 *
 * TikTok and YouTube are nudged off pure black and pure red: at icon size those
 * two read as printing errors beside the others.
 */
const CHANNEL_COLORS: Record<Channel, string> = {
  instagram: '#E1306C',
  facebook: '#1877F2',
  google: '#4285F4',
  whatsapp: '#25D366',
  tiktok: '#141414',
  linkedin: '#0A66C2',
  youtube: '#E8332A',
  email: '#8B5CF6',
  referral: '#64748B',
  direct: '#94A3B8',
};

/**
 * Exported so the dashboard's verdict names a channel exactly as this card
 * does. A verdict saying "google" while the card beside it says "גוגל" is two
 * components disagreeing about one word.
 */
export const CHANNEL_LABELS: Record<Channel, Record<string, string>> = {
  instagram: { en: 'Instagram', es: 'Instagram', he: 'אינסטגרם' },
  facebook: { en: 'Facebook', es: 'Facebook', he: 'פייסבוק' },
  google: { en: 'Google', es: 'Google', he: 'גוגל' },
  whatsapp: { en: 'WhatsApp', es: 'WhatsApp', he: 'וואטסאפ' },
  tiktok: { en: 'TikTok', es: 'TikTok', he: 'טיקטוק' },
  linkedin: { en: 'LinkedIn', es: 'LinkedIn', he: 'לינקדאין' },
  youtube: { en: 'YouTube', es: 'YouTube', he: 'יוטיוב' },
  email: { en: 'Email', es: 'Correo', he: 'אימייל' },
  referral: { en: 'Other sites', es: 'Otros sitios', he: 'אתרים אחרים' },
  direct: { en: 'Direct / unknown', es: 'Directo / desconocido', he: 'ישיר / לא ידוע' },
};

/*
 * The chart palette that used to live here is gone with the ring.
 *
 * It existed because arcs cannot carry brand colours: three of the ten channels
 * are blue and two are grey, so Facebook against Google measured ΔE 4.8 for
 * NORMAL vision — two adjacent slices nobody could tell apart. Five validated
 * hues solved that, and forced a sixth channel to fold into a grey "Other".
 *
 * A labelled cell needs none of it. Identity rests on the name and the mark
 * beside it, so the brand colour is free to be the brand colour again, and
 * there is no five-channel ceiling to fold anything into.
 */

const COPY: Record<string, Record<string, string>> = {
  title: {
    en: 'Where your clients come from',
    es: 'De dónde vienen tus clientes',
    he: 'מאיפה מגיעים הלקוחות',
  },
  reach: { en: 'Saw you', es: 'Te vieron', he: 'נחשפו' },
  reachHelp: {
    en: 'People who saw your posts on a connected account. Not visits.',
    es: 'Personas que vieron tus publicaciones en una cuenta conectada. No son visitas.',
    he: 'אנשים שראו את הפוסטים שלך בחשבון מחובר. לא ביקורים.',
  },
  paidShort: { en: 'paid', es: 'cobrado', he: 'שולם' },
  billed: { en: 'Billed', es: 'Facturado', he: 'חויב' },
  awaitingTitle: {
    en: 'Connected. The first numbers arrive after tonight\'s sync.',
    es: 'Conectado. Los primeros números llegan tras la sincronización de esta noche.',
    he: 'מחובר. המספרים הראשונים יגיעו אחרי הסנכרון הלילה.',
  },
  unavailableTitle: {
    en: 'Facebook no longer reports how many people saw a Page — only what they did.',
    es: 'Facebook ya no informa cuántas personas vieron una página — solo lo que hicieron.',
    he: 'פייסבוק כבר לא מדווחת כמה אנשים ראו עמוד — רק מה הם עשו.',
  },
  leads: { en: 'Leads', es: 'Contactos', he: 'לידים' },
  bookings: { en: 'Bookings', es: 'Reservas', he: 'הזמנות' },
  revenue: { en: 'Revenue', es: 'Ingresos', he: 'הכנסה' },
  basis: {
    en: 'Based on how each client reached you',
    es: 'Según cómo llegó cada cliente',
    he: 'מבוסס על איך שהלקוחות הגיעו אליך',
  },
  empty: {
    en: 'No leads yet in this period',
    es: 'Aún no hay contactos en este período',
    he: 'אין עדיין לידים בתקופה הזו',
  },
  emptyHint: {
    en: 'When someone reaches you, we show which channel sent them.',
    es: 'Cuando alguien te contacte, mostramos de qué canal vino.',
    he: 'כשמישהו יפנה אליך, נראה מאיזה ערוץ הוא הגיע',
  },
  untrackedNote: {
    en: "couldn't be traced to a channel — some apps hide where a visitor came from",
    es: 'no se pudieron rastrear — algunas apps ocultan el origen del visitante',
    he: 'לא ניתן היה לזהות מאיפה הגיעו — חלק מהאפליקציות מסתירות את המקור',
  },
  visitsTitle: {
    en: 'Where they landed',
    es: 'Dónde llegaron',
    he: 'לאן הם הגיעו',
  },
  visits: { en: 'unique visitors', es: 'visitantes únicos', he: 'מבקרים ייחודיים' },
  // Someone who reads the site and later follows a booking link appears under
  // both, so the parts can add up to more than the total. Saying so is better
  // than letting the reader do the arithmetic and conclude one is wrong.
  visitsNote: {
    en: 'Counted once each. Someone who used two of these appears in both.',
    es: 'Contados una vez. Quien usó dos aparece en ambos.',
    he: 'כל אחד נספר פעם אחת. מי שהשתמש בשניים מופיע בשניהם.',
  },

  /*
   * The finding, said in words before anything is drawn.
   *
   * The card held both numbers — arrivals and leads — and never put them
   * together, so it could show 431 visitors and 1 lead without ever stating the
   * 0.23% that is the actual news. One sentence does what the ring could not.
   *
   * Three forms because Hebrew and Spanish inflect the verb: "1 הפכו" is wrong,
   * and a single template with a plural verb would be wrong on exactly the
   * account this card is most often read on — a new one, with one lead.
   */
  sayNone: {
    en: 'Of {visitors} visitors this month, nobody has got in touch yet',
    es: 'De {visitors} visitantes este mes, nadie se ha puesto en contacto aún',
    he: 'מתוך {visitors} מבקרים החודש, אף אחד עדיין לא יצר קשר',
  },
  sayOne: {
    en: 'Of {visitors} visitors this month, 1 became a lead',
    es: 'De {visitors} visitantes este mes, 1 se convirtió en contacto',
    he: 'מתוך {visitors} מבקרים החודש, אחד הפך לליד',
  },
  sayMany: {
    en: 'Of {visitors} visitors this month, {leads} became leads',
    es: 'De {visitors} visitantes este mes, {leads} se convirtieron en contactos',
    he: 'מתוך {visitors} מבקרים החודש, {leads} הפכו לידים',
  },
  /** When no visitor figure exists, the rate cannot be stated — so it is not. */
  sayLeadsOnly: {
    en: '{leads} leads in this period',
    es: '{leads} contactos en este período',
    he: '{leads} לידים בתקופה הזו',
  },
  rateTitle: {
    en: 'Visitors who became leads',
    es: 'Visitantes que se convirtieron en contactos',
    he: 'אחוז המבקרים שהפכו ללידים',
  },
};

export function ChannelSourcesSection({
  rows,
  totals,
  untracked,
  visits,
  embedded = false,
}: ChannelSourcesSectionProps) {
  const { language, isRTL } = useLanguage();

  const t = (key: string) => COPY[key]?.[language] || COPY[key]?.en || key;
  const channelLabel = (channel: Channel) =>
    CHANNEL_LABELS[channel]?.[language] || CHANNEL_LABELS[channel]?.en || channel;

  /**
   * Every channel, as one tile.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * The ring is gone, and so is the split that surrounded it.
   *
   * A ring encodes share as arc, so a channel with no leads has no arc — which
   * forced the connected-but-silent channels into a strip of their own, with
   * their own heading and their own divider. That is how the card came to hold
   * three stacked sections to answer one question, and why the number 1 was
   * printed four times on an account with a single lead: a pill, the ring's
   * centre, the legend value, and "100%".
   *
   * A tile has no such requirement. A channel at zero is the same kind of thing
   * as a channel at forty — it just has a different number — so both live in
   * one row, the quiet ones dimmed. Three sections become one.
   *
   * Brand colours are safe again here, and that is a real change from the ring.
   * The chart palette existed because three of the ten channels are blue and
   * two are grey, and adjacent ARCS carrying those colours were not separable.
   * A tile is a labelled box: identity rests on the name and the mark, never on
   * the hue, so Facebook blue beside Google blue costs nothing.
   *
   * Nothing is folded into "Other" either. The five-hue limit was a property of
   * the palette, not of the data.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const tiles = useMemo(() => {
    const charted = rows.reduce((sum, r) => sum + (r.leads > 0 ? r.leads : 0), 0);
    const busiest = rows.reduce((max, r) => Math.max(max, r.leads), 0);

    return [...rows]
      // Producing channels first and biggest first; the silent ones keep a
      // stable order behind them rather than shuffling as reach changes.
      .sort((a, b) => b.leads - a.leads)
      .map(row => ({
        key: row.channel,
        label: channelLabel(row.channel),
        leads: row.leads,
        share: charted > 0 && row.leads > 0 ? Math.round((row.leads / charted) * 100) : 0,
        // Bar length is against the busiest channel, not against the total: at
        // 100% of one lead a full-width bar says nothing, while against the
        // leader it says "this is the one".
        fill: busiest > 0 ? (row.leads / busiest) * 100 : 0,
        color: CHANNEL_COLORS[row.channel],
        logo: CHANNEL_LOGOS[row.channel],
        Icon: CHANNEL_ICONS[row.channel],
        reach: row.reach,
        awaitingData: row.awaitingData,
        reachUnavailable: row.reachUnavailable,
      }));
  }, [rows, language]); // eslint-disable-line react-hooks/exhaustive-deps -- channelLabel is derived from language

  const surfaces = visits?.bySurface ?? [];
  const surfaceLabel = (surface: VisitSurface) =>
    SURFACE_LABELS[surface]?.[language] || SURFACE_LABELS[surface]?.en || surface;

  const locale = language === 'he' ? 'he-IL' : language === 'es' ? 'es-ES' : 'en-US';

  const formatCount = (value: number) => new Intl.NumberFormat(locale).format(value);

  /** Reach runs to five figures and has a tile's width to fit in. */
  const formatCompact = (value: number) =>
    new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(value);

  /*
   * The sentence, and the rate beside it.
   *
   * `visits.total` is arrivals; `totals.leads` is everyone who got in touch,
   * INCLUDING the untracked ones — the conversion is a fact about the business,
   * not about how much of it we managed to attribute. The tiles below sum to
   * less than this number whenever some leads could not be traced, which is
   * what the untracked note at the foot exists to say.
   */
  const visitorTotal = visits?.total ?? 0;
  const conversion = visitorTotal > 0 ? (totals.leads / visitorTotal) * 100 : null;

  const say = visitorTotal === 0
    ? t('sayLeadsOnly').replace('{leads}', formatCount(totals.leads))
    : (totals.leads === 0 ? t('sayNone') : totals.leads === 1 ? t('sayOne') : t('sayMany'))
        .replace('{visitors}', formatCount(visitorTotal))
        .replace('{leads}', formatCount(totals.leads));

  /** Two decimals below 1%, because 0.23% and 0.00% are not the same news. */
  const conversionText = conversion === null
    ? null
    : `${conversion >= 10 ? conversion.toFixed(0) : conversion.toFixed(conversion < 1 ? 2 : 1)}%`;

  return (
    <div
      className={`flex flex-col ${embedded ? '' : 'bg-[var(--v2-surface)] border border-[var(--v2-border)] p-3.5 h-full'}`}
      style={embedded ? undefined : { borderRadius: '16px' }}
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      <div className="mb-1 flex items-center justify-between gap-3">
        {/* Matched to ChannelsCard's heading exactly — size, weight, colour and
            family. The two now sit side by side inside one card as peer
            questions, and headings that differ by half a pixel and a shade of
            grey read as a mistake rather than as a distinction. */}
        <span
          style={{
            fontFamily: isRTL
              ? '"Heebo", system-ui, sans-serif'
              : '"Space Grotesk", system-ui, sans-serif',
            fontSize: '13.5px',
            fontWeight: 600,
            color: '#131A2B',
          }}
        >
          {t('title')}
        </span>
      </div>
      {/* Matched to the sibling column's subtitle for the same reason as the
          heading above it. */}
      <p style={{ fontSize: '11px', color: '#8A93A6', lineHeight: 1.4, marginBottom: '10px' }}>
        {t('basis')}
      </p>

      {rows.length === 0 && surfaces.length === 0 ? (
        /* An empty channel table means one of two things, and saying which
           is more useful than a bare "no data": either nobody has arrived yet,
           or nothing is connected to attribute them to. */
        <div className="py-7 text-center">
          <div
            className="mx-auto mb-2.5 flex items-center justify-center"
            style={{
              width: 38,
              height: 38,
              borderRadius: '99px',
              background: 'var(--v2-border)',
              opacity: 0.5,
            }}
          >
            <Link2 className="w-4 h-4 text-[var(--v2-text-muted)]" />
          </div>
          <p className="text-[13px] text-[var(--v2-text-secondary)]">{t('empty')}</p>
          <p className="text-[11.5px] text-[var(--v2-text-muted)] mt-1 max-w-[240px] mx-auto leading-relaxed">
            {t('emptyHint')}
          </p>
        </div>
      ) : (
        <>
          {/* The finding, in a sentence. It is the first thing on the card
              because it is the answer — everything below is the breakdown. */}
          <p
            className="mb-3 flex flex-wrap items-baseline gap-x-2 gap-y-1"
            style={{ fontSize: '13px', lineHeight: 1.5, color: 'var(--v2-text-secondary)' }}
          >
            <span>{say}</span>
            {conversionText && (
              <span
                title={t('rateTitle')}
                className="shrink-0 px-2 py-0.5 text-[11px] font-semibold tabular-nums"
                style={{
                  borderRadius: '99px',
                  // Amber under 2%, and this is a judgement the card is entitled
                  // to make: a hundred visitors and one lead is a problem, and
                  // colouring it like a success would be the card lying quietly.
                  color: (conversion ?? 0) >= 2 ? '#0F8F60' : '#B45309',
                  background: (conversion ?? 0) >= 2
                    ? 'rgba(18, 166, 111, 0.10)'
                    : 'rgba(217, 119, 6, 0.10)',
                }}
              >
                {conversionText}
              </span>
            )}
          </p>

          {/* One cell for every channel — producing and silent alike.
              `auto-fit` rather than a fixed count: the same grid holds two
              channels and ten without either looking like a mistake. */}
          <div
            className="grid gap-1.5"
            style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(94px, 1fr))' }}
          >
            {tiles.map(tile => {
              const quiet = tile.leads === 0;

              return (
                <div
                  key={tile.key}
                  title={
                    !quiet
                      ? `${tile.label} — ${formatCount(tile.leads)} ${t('leads').toLowerCase()}`
                      : tile.reach !== null
                        ? `${tile.label} — ${t('reach')}: ${formatCount(tile.reach)}`
                        : tile.awaitingData
                          ? t('awaitingTitle')
                          : tile.reachUnavailable
                            ? t('unavailableTitle')
                            : tile.label
                  }
                  className="min-w-0 px-2.5 pb-2 pt-2"
                  style={{
                    borderRadius: '12px',
                    border: '1px solid var(--v2-border)',
                    background: quiet ? 'var(--v2-bg)' : 'var(--v2-surface)',
                    opacity: quiet ? 0.72 : 1,
                  }}
                >
                  <div className="flex items-center justify-between gap-1.5">
                    {tile.logo ? (
                      <PluginIcon pluginId={tile.logo} className="w-4 h-4 shrink-0" alt="" />
                    ) : tile.Icon ? (
                      <tile.Icon className="w-4 h-4 shrink-0" style={{ color: tile.color }} />
                    ) : (
                      <span
                        aria-hidden
                        className="inline-block shrink-0"
                        style={{ width: 9, height: 9, borderRadius: 3, background: tile.color }}
                      />
                    )}
                    {!quiet && (
                      <span className="text-[10px] tabular-nums text-[var(--v2-text-muted)]">
                        {tile.share}%
                      </span>
                    )}
                  </div>

                  {/* Always the lead count, never reach — one unit per column,
                      or the cells stop being comparable. A dash where there is
                      nothing, which is not the same claim as a zero. */}
                  <div
                    className="mt-1 tabular-nums"
                    style={{
                      fontFamily: isRTL
                        ? '"Heebo", system-ui, sans-serif'
                        : '"Space Grotesk", system-ui, sans-serif',
                      fontSize: '18px',
                      fontWeight: 700,
                      letterSpacing: '-0.02em',
                      lineHeight: 1.15,
                      color: quiet ? 'var(--v2-text-muted)' : 'var(--v2-text-primary)',
                    }}
                  >
                    {quiet ? '—' : formatCount(tile.leads)}
                  </div>

                  <div className="truncate text-[10.5px] leading-tight text-[var(--v2-text-muted)]">
                    {tile.label}
                  </div>

                  {/* A bar where there are leads; where there are none, the one
                      number that channel does have. "3.4K saw you, nobody got in
                      touch" is the most useful sentence this card can say, and
                      it was the whole reason the silent strip existed. */}
                  {quiet ? (
                    <div className="mt-1.5 truncate text-[10px] leading-tight text-[var(--v2-text-muted)]">
                      {tile.reach !== null
                        ? `${formatCompact(tile.reach)} ${t('reach').toLowerCase()}`
                        : tile.awaitingData
                          ? '⏳'
                          : ' '}
                    </div>
                  ) : (
                    <div
                      className="mt-1.5 overflow-hidden"
                      style={{ height: 3, borderRadius: '99px', background: 'var(--v2-border)' }}
                    >
                      <i
                        aria-hidden
                        className="block h-full"
                        style={{
                          width: `${tile.fill}%`,
                          borderRadius: '99px',
                          background: tile.color,
                        }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Where the arrivals landed, on one line under the cells.
              It describes the visitors in the sentence above, not the leads in
              the cells — which is why it reads as a continuation of the first
              number rather than as a section of its own. */}
          {surfaces.length > 0 && (
            <div className="mt-3 pt-2.5 border-t border-[var(--v2-border)]">
              <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px] text-[var(--v2-text-muted)]">
                <span className="font-medium text-[var(--v2-text-secondary)] tabular-nums">
                  {formatCount(visits?.total ?? 0)}
                </span>
                <span>{t('visits')}</span>
                {surfaces.map(({ surface, visits: count }) => (
                  <span key={surface} className="flex items-baseline gap-1">
                    <span aria-hidden style={{ color: 'var(--v2-border)' }}>·</span>
                    <span>{surfaceLabel(surface)}</span>
                    <span className="font-medium text-[var(--v2-text-secondary)] tabular-nums">
                      {formatCount(count)}
                    </span>
                  </span>
                ))}
              </p>
              {surfaces.length > 1 && (
                <p className="mt-1.5 text-[10.5px] leading-relaxed text-[var(--v2-text-muted)]">
                  {t('visitsNote')}
                </p>
              )}
            </div>
          )}

          {/* Say plainly how much of the picture is missing, rather than
              letting the visible channels imply they account for everything. */}
          {untracked.leads > 0 && (
            <p className="mt-2.5 text-[11px] leading-relaxed text-[var(--v2-text-muted)]">
              <span className="font-medium text-[var(--v2-text-secondary)]">
                {untracked.leads} {t('leads').toLowerCase()}
              </span>{' '}
              {t('untrackedNote')}
            </p>
          )}
        </>
      )}
    </div>
  );
}
