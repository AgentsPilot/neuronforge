'use client';

import { useLanguage } from '@/lib/business-os/LanguageContext';
import { Globe, Users, BarChart3, Settings, Check } from 'lucide-react';

// Card type configurations
const CARD_CONFIG = {
  website: {
    color: '#4F6EF7',
    Icon: Globe,
    nameKey: 'cap.website.name',
    subtitleKey: 'cap.website.subtitle',
    actionKey: 'cap.website.action',
    defaultName: 'Website',
    defaultSubtitle: 'Your online presence',
    defaultAction: 'View site'
  },
  people: {
    color: '#8B5CF6',
    Icon: Users,
    nameKey: 'cap.people.name',
    subtitleKey: 'cap.people.subtitle',
    actionKey: 'cap.people.action',
    defaultName: 'People',
    defaultSubtitle: 'Your clients & pipeline',
    defaultAction: 'Open pipeline'
  },
  reports: {
    color: '#22C58B',
    Icon: BarChart3,
    nameKey: 'cap.reports.name',
    subtitleKey: 'cap.reports.subtitle',
    actionKey: 'cap.reports.action',
    defaultName: 'Reports',
    defaultSubtitle: 'How the business is doing',
    defaultAction: 'See insights'
  },
  config: {
    color: '#D14E97',
    Icon: Settings,
    nameKey: 'cap.config.name',
    subtitleKey: 'cap.config.subtitle',
    actionKey: 'cap.config.action',
    defaultName: 'Configuration',
    defaultSubtitle: 'Services, hours, payments',
    defaultAction: 'Adjust setup'
  }
};

// Stats types for each card
interface WebsiteStats {
  url?: string;
  visitorsToday: number;
  bookingStarts: number;
  status: 'live' | 'draft';
  wantsWebsite?: boolean;
  hasLivePages?: boolean;
}

interface PipelineStage {
  stage_key: string;
  stage_label: string;
  color: string;
  count: number;
}

interface PeopleStats {
  totalContacts: number;
  newThisWeek: number;
  becameClients?: number;
  wentQuiet?: number;
  pipeline: PipelineStage[];
}

interface ReportsStats {
  weeklyRevenue: number;
  weeklyBars: number[]; // 6 values for bar chart
  changePercent: number;
  previousWeek: number;
}

interface ConfigStats {
  servicesCount: number;
  servicesActive: boolean;
  hoursSet: boolean;
  openDaysCount: number;
  paymentsConnected: boolean;
  paymentsProvider: string;
  automationsCount: number;
  calendarSynced: boolean;
  calendarProvider: 'google_calendar' | 'outlook' | null;
}

type CardStats = WebsiteStats | PeopleStats | ReportsStats | ConfigStats;

interface CapabilityCardProps {
  type: 'website' | 'people' | 'reports' | 'config';
  stats: CardStats;
  onClick: () => void;
}

// Mini Browser component - matches mockup exactly
function MiniBrowser({ url }: { url?: string }) {
  return (
    <div
      className="bg-[var(--v2-bg)] border border-[var(--v2-border)] overflow-hidden"
      style={{ borderRadius: '9px' }}
    >
      <div
        className="flex items-center"
        style={{ padding: '6px 8px', gap: '4px', borderBottom: '1px solid var(--v2-border)' }}
      >
        <span className="rounded-full bg-[#D6DAE6]" style={{ width: '6px', height: '6px' }} />
        <span className="rounded-full bg-[#D6DAE6]" style={{ width: '6px', height: '6px' }} />
        <span className="rounded-full bg-[#D6DAE6]" style={{ width: '6px', height: '6px' }} />
        <span
          className="text-[var(--v2-text-muted)] truncate"
          style={{ fontSize: '9.5px', marginLeft: '6px' }}
        >
          {url || 'your-site.agentspilot.site'}
        </span>
      </div>
      <div className="flex flex-col" style={{ padding: '10px', gap: '5px' }}>
        <div className="bg-[#E4E7EF]" style={{ height: '6px', borderRadius: '4px', width: '60%' }} />
        <div className="bg-[#E4E7EF]" style={{ height: '6px', borderRadius: '4px', width: '90%' }} />
        <div className="bg-[#E4E7EF]" style={{ height: '6px', borderRadius: '4px', width: '40%' }} />
      </div>
    </div>
  );
}

// Mini Pipeline bar - matches mockup: height 8px, gap 4px, border-radius 6px
// Now supports dynamic pipeline stages from user's CRM configuration
function MiniPipeline({ pipeline }: { pipeline: PipelineStage[] }) {
  if (pipeline.length === 0) return null;

  const total = pipeline.reduce((sum, stage) => sum + stage.count, 0);

  // If no contacts at all, show equal-width empty stages
  if (total === 0) {
    return (
      <div className="flex overflow-hidden" style={{ gap: '4px', height: '8px', borderRadius: '6px' }}>
        {pipeline.map((stage) => (
          <i
            key={stage.stage_key}
            style={{ flex: 1, height: '100%', background: stage.color, opacity: 0.3 }}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="flex overflow-hidden" style={{ gap: '4px', height: '8px', borderRadius: '6px' }}>
      {pipeline.map((stage) => (
        <i
          key={stage.stage_key}
          style={{
            flex: stage.count > 0 ? stage.count : 0.1, // Show minimal width for empty stages
            height: '100%',
            background: stage.color,
            opacity: stage.count > 0 ? 1 : 0.3
          }}
        />
      ))}
    </div>
  );
}

// Mini Bar Chart - matches mockup: 6 bars, 38px height, gap 5px, rounded top corners
function MiniBarChart({ bars }: { bars: number[] }) {
  const max = Math.max(...bars, 1);
  return (
    <div className="flex items-end" style={{ height: '38px', gap: '5px' }}>
      {bars.map((value, index) => (
        <i
          key={index}
          className="flex-1"
          style={{
            height: `${Math.max((value / max) * 100, 15)}%`,
            background: index === bars.length - 1 ? '#22C58B' : 'rgba(34, 197, 139, 0.25)',
            borderRadius: '3px 3px 0 0'
          }}
        />
      ))}
    </div>
  );
}

// Config Summary - compact single-line items
function ConfigSummary({ stats, t }: { stats: ConfigStats; t: (key: string) => string }) {
  // Build items dynamically based on what's set up
  const items: { label: string; detail: string; isSet: boolean }[] = [
    {
      label: stats.servicesCount > 0 ? `${stats.servicesCount} ${t('cap.config.services') || 'services'}` : t('cap.config.no_services') || 'No services',
      detail: stats.servicesCount > 0 ? (t('cap.config.active') || 'active') : (t('cap.config.add_services') || 'add services'),
      isSet: stats.servicesCount > 0
    },
    {
      label: stats.hoursSet ? `${stats.openDaysCount} ${t('cap.config.days') || 'days'}` : (t('cap.config.hours_not_set') || '0 days'),
      detail: stats.hoursSet ? (t('cap.config.open') || 'open') : (t('cap.config.set_availability') || 'set availability'),
      isSet: stats.hoursSet
    },
    {
      label: stats.paymentsConnected ? (stats.paymentsProvider || 'Stripe') : (t('cap.config.stripe_not_connected') || 'Stripe not connected'),
      detail: stats.paymentsConnected ? (t('cap.config.payments_on') || 'payments on') : (t('cap.config.connect_stripe') || 'connect to accept payments'),
      isSet: stats.paymentsConnected
    },
    {
      label: stats.calendarSynced
        ? (stats.calendarProvider === 'google_calendar' ? 'Google' : 'Outlook')
        : (t('cap.config.calendar') || 'Calendar'),
      detail: stats.calendarSynced
        ? (t('cap.config.calendar_synced') || 'synced')
        : (t('cap.config.connect_calendar') || 'connect to sync'),
      isSet: stats.calendarSynced
    }
  ];

  return (
    <div className="flex flex-col" style={{ gap: '7px' }}>
      {items.map((item, index) => (
        <div key={index} className="flex items-center" style={{ gap: '8px', fontSize: '12.5px' }}>
          <span
            className="rounded-full flex items-center justify-center flex-none"
            style={{
              width: '15px',
              height: '15px',
              background: item.isSet ? 'rgba(34, 197, 139, 0.15)' : 'rgba(209, 78, 151, 0.15)'
            }}
          >
            {item.isSet ? (
              <Check style={{ width: '9px', height: '9px', color: '#22C58B', strokeWidth: 3 }} />
            ) : (
              <Settings style={{ width: '9px', height: '9px', color: '#D14E97', strokeWidth: 2 }} />
            )}
          </span>
          <b className="font-semibold text-[var(--v2-text-primary)]">{item.label}</b>
          <span className="text-[var(--v2-text-muted)]">· {item.detail}</span>
        </div>
      ))}
    </div>
  );
}

// Arrow icon matching mockup
function ArrowIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      style={{ width: '15px', height: '15px' }}
      stroke="currentColor"
      strokeWidth={2.2}
      fill="none"
    >
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

export function CapabilityCard({ type, stats, onClick }: CapabilityCardProps) {
  const { t, isRTL } = useLanguage();
  const config = CARD_CONFIG[type];
  const Icon = config.Icon;

  const name = t(config.nameKey) || config.defaultName;
  const subtitle = t(config.subtitleKey) || config.defaultSubtitle;
  const action = t(config.actionKey) || config.defaultAction;

  // Determine status badge
  let statusBadge: { text: string; color: string; bg: string } | null = null;
  if (type === 'website') {
    const ws = stats as WebsiteStats;
    if (ws.status === 'live' || ws.hasLivePages) {
      statusBadge = { text: t('cap.status.live') || 'Live', color: '#128a5e', bg: 'rgba(34, 197, 139, 0.13)' };
    } else if (ws.wantsWebsite && !ws.hasLivePages) {
      statusBadge = { text: t('cap.status.not_published') || 'Not published', color: '#F97316', bg: 'rgba(249, 115, 22, 0.12)' };
    }
  } else if (type === 'people') {
    const ps = stats as PeopleStats;
    if (ps.newThisWeek > 0) {
      statusBadge = { text: `+${ps.newThisWeek} ${t('cap.status.new') || 'new'}`, color: '#8B5CF6', bg: 'rgba(139, 92, 246, 0.12)' };
    }
  } else if (type === 'reports') {
    const rs = stats as ReportsStats;
    if (rs.changePercent > 0) {
      statusBadge = { text: `↑ ${rs.changePercent}%`, color: '#128a5e', bg: 'rgba(34, 197, 139, 0.13)' };
    }
  } else if (type === 'config') {
    const cs = stats as ConfigStats;
    const allSet = cs.servicesCount > 0 && cs.hoursSet && cs.paymentsConnected;
    if (allSet) {
      statusBadge = { text: t('cap.status.all_set') || 'All set', color: '#128a5e', bg: 'rgba(34, 197, 139, 0.13)' };
    } else {
      statusBadge = { text: t('cap.status.setup_needed') || 'Setup needed', color: '#D14E97', bg: 'rgba(209, 78, 151, 0.13)' };
    }
  }

  return (
    <div
      onClick={onClick}
      className="bg-[var(--v2-surface)] border border-[var(--v2-border)] flex flex-col cursor-pointer transition-all hover:translate-y-[-3px] hover:shadow-[0_26px_54px_-30px_rgba(20,26,43,0.45)] hover:border-[#DDE0EA] relative overflow-hidden"
      style={{
        borderRadius: '20px',
        padding: '20px',
        boxShadow: '0 16px 44px -34px rgba(20, 26, 43, 0.4)',
        height: '100%',
        minHeight: 0
      }}
    >
      {/* Header - matches mockup: gap 11px, margin-bottom 14px */}
      <div className="flex items-center" style={{ gap: '11px', marginBottom: '14px' }}>
        <div
          className="flex items-center justify-center flex-none"
          style={{
            width: '40px',
            height: '40px',
            borderRadius: '11px',
            background: `${config.color}1F`
          }}
        >
          <Icon style={{ width: '20px', height: '20px', color: config.color }} strokeWidth={2} />
        </div>
        <div className="flex-1 min-w-0">
          <b
            className="block"
            style={{
              fontFamily: '"Space Grotesk", system-ui, sans-serif',
              fontSize: '16px',
              fontWeight: 600,
              letterSpacing: '-0.01em',
              color: 'var(--v2-text-primary)'
            }}
          >
            {name}
          </b>
          <small style={{ fontSize: '11.5px', color: 'var(--v2-text-muted)' }}>{subtitle}</small>
        </div>
        {/* Status Badge - inline with header like mockup */}
        {statusBadge && (
          <span
            className="font-bold flex-none"
            style={{
              fontSize: '10px',
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              padding: '3px 8px',
              borderRadius: '6px',
              color: statusBadge.color,
              background: statusBadge.bg
            }}
          >
            {statusBadge.text}
          </span>
        )}
      </div>

      {/* Body - matches mockup: gap 9px, justify center */}
      <div className="flex-1 min-h-0 flex flex-col justify-center" style={{ gap: '9px' }}>
        {type === 'website' && (
          <>
            <MiniBrowser url={(stats as WebsiteStats).url} />
            <div style={{ fontSize: '12.5px', color: 'var(--v2-text-muted)', lineHeight: 1.45 }}>
              <b style={{ color: 'var(--v2-text-primary)', fontWeight: 600 }}>
                {(stats as WebsiteStats).visitorsToday} {t('cap.website.visitors') || 'visitors'}
              </b>{' '}
              {t('cap.website.today') || 'today'} ·{' '}
              <b style={{ color: 'var(--v2-text-primary)', fontWeight: 600 }}>
                {(stats as WebsiteStats).bookingStarts}
              </b>{' '}
              {t('cap.website.started_booking') || 'started a booking'}
            </div>
          </>
        )}

        {type === 'people' && (
          <>
            <div
              className="flex items-baseline"
              style={{ gap: '8px', fontFamily: '"Space Grotesk", system-ui, sans-serif' }}
            >
              <b
                style={{
                  fontSize: '27px',
                  fontWeight: 700,
                  letterSpacing: '-0.02em',
                  color: 'var(--v2-text-primary)'
                }}
              >
                {(stats as PeopleStats).totalContacts}
              </b>
              <span style={{ fontSize: '12.5px', color: 'var(--v2-text-muted)' }}>
                {t('cap.people.people_you_know') || 'people you know'}
              </span>
            </div>
            <MiniPipeline pipeline={(stats as PeopleStats).pipeline} />
            {/* Became clients / went quiet */}
            <div style={{ fontSize: '12.5px', color: 'var(--v2-text-muted)', lineHeight: 1.45 }}>
              <b style={{ color: 'var(--v2-text-primary)', fontWeight: 600 }}>
                {(stats as PeopleStats).becameClients ?? 0}
              </b>{' '}
              {t('cap.people.became_clients') || 'became clients this week'} ·{' '}
              <b style={{ color: 'var(--v2-text-primary)', fontWeight: 600 }}>
                {(stats as PeopleStats).wentQuiet ?? 0}
              </b>{' '}
              {t('cap.people.went_quiet') || 'went quiet'}
            </div>
          </>
        )}

        {type === 'reports' && (
          <>
            <div
              className="flex items-baseline"
              style={{ gap: '8px', fontFamily: '"Space Grotesk", system-ui, sans-serif' }}
            >
              <b
                style={{
                  fontSize: '27px',
                  fontWeight: 700,
                  letterSpacing: '-0.02em',
                  color: 'var(--v2-text-primary)'
                }}
              >
                ${(stats as ReportsStats).weeklyRevenue.toLocaleString()}
              </b>
              <span style={{ fontSize: '12.5px', color: 'var(--v2-text-muted)' }}>
                {t('cap.reports.booked_this_week') || 'booked this week'}
              </span>
            </div>
            <MiniBarChart bars={(stats as ReportsStats).weeklyBars} />
            <div style={{ fontSize: '12.5px', color: 'var(--v2-text-muted)', lineHeight: 1.45 }}>
              {t('cap.reports.up_from') || 'Up from'}{' '}
              <b style={{ color: 'var(--v2-text-primary)', fontWeight: 600 }}>
                ${(stats as ReportsStats).previousWeek.toLocaleString()}
              </b>{' '}
              {t('cap.reports.last_week') || 'last week'}
            </div>
          </>
        )}

        {type === 'config' && (
          <ConfigSummary stats={stats as ConfigStats} t={t} />
        )}
      </div>

      {/* Footer - matches mockup: margin-top 14px, gap 6px, font 13px, font-weight 600 */}
      <div
        className="flex items-center flex-shrink-0"
        style={{
          marginTop: '14px',
          gap: '6px',
          fontSize: '13px',
          fontWeight: 600,
          color: config.color
        }}
      >
        {action}
        <ArrowIcon />
      </div>
    </div>
  );
}

// Export stats type for use in parent
export type { WebsiteStats, PeopleStats, ReportsStats, ConfigStats, PipelineStage };
