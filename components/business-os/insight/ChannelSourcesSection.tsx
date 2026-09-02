'use client';

import { useMemo } from 'react';
import { Mail, Link2, HelpCircle, Music2, Briefcase, Play, Globe, FileText, BarChart3 } from 'lucide-react';
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

const SURFACE_ICONS: Record<VisitSurface, typeof Mail> = {
  website: Globe,
  landing: FileText,
  smart_links: Link2,
  analytics: BarChart3,
};

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

/**
 * CHART colours — deliberately NOT the brand colours above.
 *
 * Brand colours cannot serve as a palette: three of the ten channels are blue,
 * two are grey residual buckets, and Facebook against Google measures ΔE 4.8 for
 * NORMAL vision — indistinguishable. A business whose only attributed traffic was
 * the two grey buckets got a chart drawn in two invisible greys.
 *
 * These five pass every check in `dataviz/scripts/validate_palette.js` against a
 * white surface under `--pairs all` (worst pair ΔE 9.1 protan, 17.4 normal), so
 * any two slices are separable in any order. Brand identity has not gone away —
 * it lives in the legend's icon, beside the name.
 *
 * Five, and no more: beyond that the tail folds into "Other". A generated sixth
 * hue would break the guarantee this list exists to make.
 */
const SLICE_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#4a3aa7', '#c2185b'];

/** The folded tail. Grey on purpose: a residual is not an identity. */
const OTHER_COLOR = '#9AA3B2';

/** How many channels get their own slice before the rest are folded. */
const MAX_SLICES = SLICE_COLORS.length;

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
  /** The folded tail, once there are more channels than the palette can separate. */
  otherChannels: { en: 'Other', es: 'Otros', he: 'אחר' },
  /**
   * Heading for connected channels that produced nobody. They cannot be on the
   * map — area is leads, and theirs is zero — but leaving them off entirely is
   * how Meta and Google disappeared from a dashboard of someone who had just
   * connected them. "3,400 saw you, none got in touch" is the most actionable
   * sentence this card can say.
   */
  noLeadsYet: {
    en: 'Connected, no leads yet',
    es: 'Conectados, aún sin contactos',
    he: 'מחוברים, עדיין בלי לידים',
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
};

interface Slice {
  key: string;
  label: string;
  leads: number;
  share: number;
  /** Chart colour — from the validated palette, never the brand. */
  color: string;
  /** Brand colour, for the legend glyph only. */
  brand: string;
  logo?: string;
  Icon?: typeof Mail;
}

const R = 15;
const CIRCUMFERENCE = 2 * Math.PI * R;
const STROKE = 5;
/** Visible separation between slices, in viewBox units (~1.3px at 104px). */
const SLICE_GAP = 1.2;

/**
 * The ring.
 *
 * Round caps are what make it read as round, and they are also the trap: a round
 * cap extends the drawn arc by STROKE/2 at BOTH ends, so a slice drawn to its
 * exact share renders one whole stroke-width too long and laps its neighbour.
 * The dash is therefore shortened by a full STROKE and re-centred inside its true
 * span, which puts the visible arc exactly where the share says it should be.
 *
 * A single slice is drawn as a plain circle: with one arc there is no neighbour
 * to separate from, and the gap correction would leave a ring that reads as 97%
 * of something rather than all of it.
 */
function Donut({ slices, total, label }: { slices: Slice[]; total: number; label: string }) {
  let cursor = 0;

  return (
    <div className="relative shrink-0" style={{ width: 104, height: 104 }}>
      <svg
        viewBox="0 0 36 36"
        className="h-full w-full"
        style={{ transform: 'rotate(-90deg)' }}
        role="img"
        aria-label={`${total} ${label}`}
      >
        <circle cx="18" cy="18" r={R} fill="none" stroke="#EDF1F7" strokeWidth={STROKE} />

        {slices.map(slice => {
          const full = (slice.leads / Math.max(total, 1)) * CIRCUMFERENCE;
          const solo = slices.length === 1;
          const drawn = solo ? full : Math.max(full - SLICE_GAP - STROKE, 0.01);
          const dashStart = solo ? cursor : cursor + (full - drawn) / 2;

          cursor += full;

          return (
            <circle
              key={slice.key}
              cx="18"
              cy="18"
              r={R}
              fill="none"
              stroke={slice.color}
              strokeWidth={STROKE}
              strokeLinecap={solo ? 'butt' : 'round'}
              strokeDasharray={`${drawn.toFixed(2)} ${(CIRCUMFERENCE - drawn).toFixed(2)}`}
              strokeDashoffset={(-dashStart).toFixed(2)}
            />
          );
        })}
      </svg>

      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[20px] font-semibold leading-none text-[var(--v2-text-primary)] tabular-nums">
          {total}
        </span>
        <span className="mt-0.5 text-[10px] text-[var(--v2-text-muted)]">{label}</span>
      </div>
    </div>
  );
}

export function ChannelSourcesSection({
  rows,
  totals,
  untracked,
  visits,
  embedded = false,
}: ChannelSourcesSectionProps) {
  const { language, formatCurrency, isRTL } = useLanguage();

  const t = (key: string) => COPY[key]?.[language] || COPY[key]?.en || key;
  const channelLabel = (channel: Channel) =>
    CHANNEL_LABELS[channel]?.[language] || CHANNEL_LABELS[channel]?.en || channel;

  /**
   * The slices, largest first, with the tail folded.
   *
   * A channel with no leads is NOT a slice: zero has no arc, and inventing one
   * would claim it produced somebody. Those channels appear below the ring
   * instead, where reach is the number that matters.
   *
   * Beyond five, the remainder becomes one grey "Other". The palette guarantees
   * five separable hues and no more; a generated sixth would quietly break the
   * guarantee. Share is recomputed here over CHARTED leads so the arcs close the
   * circle exactly — `leadShare` from the service is a share of all leads, which
   * includes untracked ones and would leave a permanent gap in the ring.
   */
  const slices = useMemo<Slice[]>(() => {
    const withLeads = [...rows].filter(r => r.leads > 0).sort((a, b) => b.leads - a.leads);
    const charted = withLeads.reduce((sum, r) => sum + r.leads, 0);
    if (charted === 0) return [];

    const pct = (leads: number) => Math.round((leads / charted) * 100);

    const named = withLeads.slice(0, withLeads.length > MAX_SLICES ? MAX_SLICES - 1 : MAX_SLICES);
    const rest = withLeads.slice(named.length);

    const out: Slice[] = named.map((row, i) => ({
      key: row.channel,
      label: CHANNEL_LABELS[row.channel]?.[language] || CHANNEL_LABELS[row.channel]?.en || row.channel,
      leads: row.leads,
      share: pct(row.leads),
      color: SLICE_COLORS[i],
      brand: CHANNEL_COLORS[row.channel],
      logo: CHANNEL_LOGOS[row.channel],
      Icon: CHANNEL_ICONS[row.channel],
    }));

    if (rest.length > 0) {
      const leads = rest.reduce((sum, r) => sum + r.leads, 0);
      out.push({
        key: 'other',
        label: COPY.otherChannels?.[language] || COPY.otherChannels.en,
        leads,
        share: pct(leads),
        color: OTHER_COLOR,
        brand: OTHER_COLOR,
      });
    }

    return out;
  }, [rows, language]);

  /** What the ring adds up to — charted leads, not all leads. */
  const chartedLeads = slices.reduce((sum, s) => sum + s.leads, 0);


  /**
   * Connected, but nobody has come through them yet.
   *
   * These CANNOT go on the map: it encodes leads as area, and zero has no area —
   * drawing them a token block would claim they produced someone. Leaving them
   * out altogether is worse, and was a live bug: a business that had just
   * connected Meta and Google saw neither anywhere on this card. So they get
   * their own strip, where reach is the number that matters.
   */
  const silent = rows.filter(r => r.leads === 0);
  // Switches the money column from "collected" to "billed" the moment any
  // channel has work invoiced but unpaid.
  const anyBilled = rows.some(r => (r.billed ?? 0) > r.revenue);
  const surfaces = visits?.bySurface ?? [];
  const surfaceLabel = (surface: VisitSurface) =>
    SURFACE_LABELS[surface]?.[language] || SURFACE_LABELS[surface]?.en || surface;

  const formatCount = (value: number) => new Intl.NumberFormat(
    language === 'he' ? 'he-IL' : language === 'es' ? 'es-ES' : 'en-US'
  ).format(value);

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
        {totals.leads > 0 && (
          <span
            className="shrink-0 px-2 py-0.5 text-[11px] font-medium text-[var(--v2-text-secondary)] bg-[var(--v2-bg)] tabular-nums"
            style={{ borderRadius: '99px' }}
          >
            {formatCount(totals.leads)} {t('leads').toLowerCase()}
          </span>
        )}
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
          {/* A DONUT, and a small one.
              Three forms preceded it. Bars answered "which is biggest" against
              an arbitrary maximum rather than "what share"; a treemap answered
              share correctly but needed a 172px box to do it, which made the
              card too tall, and with two channels it read as two grey rectangles
              rather than as a chart at all.

              A donut states share — the actual question — in about half the
              height, and it still looks like a chart when there are only two
              slices, which is the case this business is actually in. */}
          <div className="flex items-center gap-4">
            <Donut slices={slices} total={chartedLeads} label={t('leads')} />

            {/* The legend is not decoration: it is what stops identity resting
                on colour alone, and it carries the numbers the slices cannot. */}
            <div className="min-w-0 flex-1 space-y-1">
              {slices.map(slice => (
                <div key={slice.key} className="flex items-center gap-2 text-[11.5px]">
                  <i
                    aria-hidden
                    className="inline-block shrink-0"
                    style={{ width: 8, height: 8, borderRadius: '99px', background: slice.color }}
                  />
                  {slice.logo ? (
                    <PluginIcon pluginId={slice.logo} className="w-3.5 h-3.5 shrink-0" alt="" />
                  ) : slice.Icon ? (
                    <slice.Icon className="w-3.5 h-3.5 shrink-0" style={{ color: slice.brand }} />
                  ) : null}
                  <span className="min-w-0 flex-1 truncate text-[var(--v2-text-secondary)]">
                    {slice.label}
                  </span>
                  <span className="shrink-0 font-medium text-[var(--v2-text-primary)] tabular-nums">
                    {formatCount(slice.leads)}
                  </span>
                  <span className="w-8 shrink-0 text-end text-[var(--v2-text-muted)] tabular-nums">
                    {slice.share}%
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Channels with no leads, which the map cannot hold.
              Area encodes leads, so zero has no area — and the map correctly
              refuses to invent one. But dropping these rows made Meta and Google
              vanish from the dashboard of someone who had just connected them,
              which is the opposite of what this card is for. They get a strip of
              their own, carrying the one number they do have: reach. */}
          {silent.length > 0 && (
            <div className="mt-3 pt-3 border-t border-[var(--v2-border)]">
              <p className="mb-2 text-[11px] text-[var(--v2-text-muted)]">{t('noLeadsYet')}</p>
              <div className="flex flex-wrap gap-1.5">
                {silent.map(row => {
                  const logo = CHANNEL_LOGOS[row.channel];
                  const Icon = CHANNEL_ICONS[row.channel];
                  const color = CHANNEL_COLORS[row.channel];

                  return (
                    <span
                      key={row.channel}
                      className="flex items-center gap-1.5 px-2 py-1 text-[11.5px] text-[var(--v2-text-secondary)] bg-[var(--v2-bg)]"
                      style={{ borderRadius: '99px' }}
                      title={
                        row.reach !== null
                          ? `${channelLabel(row.channel)} — ${t('reach')}: ${formatCount(row.reach)}`
                          : row.awaitingData
                            ? t('awaitingTitle')
                            : row.reachUnavailable
                              ? t('unavailableTitle')
                              : channelLabel(row.channel)
                      }
                    >
                      {logo ? (
                        <PluginIcon pluginId={logo} className="w-3.5 h-3.5 shrink-0" alt="" />
                      ) : Icon ? (
                        <Icon className="w-3.5 h-3.5 shrink-0" style={{ color }} />
                      ) : null}
                      <span className="truncate">{channelLabel(row.channel)}</span>
                      {/* Reach is the whole point of this strip, so it is printed
                          rather than hidden on hover. An hourglass while the first
                          sync is pending; a dash when the platform will never
                          report it. Never a zero — that would read as "nobody saw
                          you" when the truth is "we cannot know". */}
                      {row.reach !== null ? (
                        <b className="font-semibold text-[var(--v2-text-primary)] tabular-nums">
                          {formatCount(row.reach)}
                        </b>
                      ) : row.awaitingData ? (
                        <span>⏳</span>
                      ) : (
                        <span className="text-[var(--v2-text-muted)]">—</span>
                      )}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* Where those arrivals landed. A different question from the table
              above — that one says who sent them — so it gets its own heading
              rather than another column. Only surfaces that reported anything
              appear: a business with no landing page should not be shown a
              landing-page row reading 0. */}
          {surfaces.length > 0 && (
            <div className="mt-4 pt-3 border-t border-[var(--v2-border)]">
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <span className="text-[11px] text-[var(--v2-text-muted)]">{t('visitsTitle')}</span>
                <span className="text-[11px] text-[var(--v2-text-muted)] tabular-nums">
                  {formatCount(visits?.total ?? 0)} {t('visits')}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {surfaces.map(({ surface, visits: count }) => {
                  const Icon = SURFACE_ICONS[surface];
                  return (
                    <span
                      key={surface}
                      className="flex items-center gap-1.5 px-2 py-1 text-[11.5px] text-[var(--v2-text-secondary)] bg-[var(--v2-bg)] border border-[var(--v2-border)]"
                      style={{ borderRadius: '99px' }}
                    >
                      {Icon && <Icon className="w-3 h-3 shrink-0 text-[var(--v2-text-muted)]" />}
                      <span className="truncate">{surfaceLabel(surface)}</span>
                      <b className="font-semibold text-[var(--v2-text-primary)] tabular-nums">
                        {formatCount(count)}
                      </b>
                    </span>
                  );
                })}
              </div>
              {surfaces.length > 1 && (
                <p className="mt-2 text-[11px] text-[var(--v2-text-muted)] leading-relaxed">
                  {t('visitsNote')}
                </p>
              )}
            </div>
          )}

          {/* Say plainly how much of the picture is missing, rather than
              letting the visible channels imply they account for everything. */}
          {untracked.leads > 0 && (
            <p className="mt-4 pt-3 border-t border-[var(--v2-border)] text-[11.5px] text-[var(--v2-text-muted)] leading-relaxed">
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
