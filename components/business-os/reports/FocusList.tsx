'use client';

import { useRouter } from 'next/navigation';
import { Target, MessageCircle, CreditCard, Share2, Sparkles, ChevronRight } from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import type { FocusItem } from '@/app/api/business-os/story/route';
import type { BusinessStats } from '@/lib/business-os/insights/StaticHealthRules';

interface FocusListProps {
  items: FocusItem[];
  loading?: boolean;
  stats?: BusinessStats | null;
}

// Action type icons and colors
const actionConfig: Record<string, { icon: typeof Target; color: string; bgColor: string }> = {
  reach_out: {
    icon: MessageCircle,
    color: '#8B5CF6', // Purple
    bgColor: 'rgba(139, 92, 246, 0.15)'
  },
  collect: {
    icon: CreditCard,
    color: '#F59E0B', // Amber
    bgColor: 'rgba(245, 158, 11, 0.15)'
  },
  share_link: {
    icon: Share2,
    color: '#3B82F6', // Blue
    bgColor: 'rgba(59, 130, 246, 0.15)'
  },
  keep_going: {
    icon: Sparkles,
    color: '#22C55E', // Green
    bgColor: 'rgba(34, 197, 94, 0.15)'
  }
};

// Generate static focus items based on stats (no LLM)
function generateStaticFocusItems(stats: BusinessStats, language: string): FocusItem[] {
  const items: FocusItem[] = [];

  const translations: Record<string, Record<string, { title: string; subtitle: string }>> = {
    reach_out: {
      en: { title: 'Check in with quiet contacts', subtitle: 'Some contacts haven\'t responded lately' },
      es: { title: 'Contacta a los callados', subtitle: 'Algunos contactos no han respondido' },
      he: { title: 'פנה לאנשי קשר שקטים', subtitle: 'כמה אנשי קשר לא הגיבו לאחרונה' }
    },
    collect: {
      en: { title: 'Follow up on pending payments', subtitle: 'Some invoices are waiting' },
      es: { title: 'Cobra pagos pendientes', subtitle: 'Algunas facturas esperan' },
      he: { title: 'עקוב אחרי תשלומים ממתינים', subtitle: 'כמה חשבוניות ממתינות' }
    },
    share_link: {
      en: { title: 'Share your booking link', subtitle: 'Your calendar has availability' },
      es: { title: 'Comparte tu enlace de reservas', subtitle: 'Tu calendario tiene disponibilidad' },
      he: { title: 'שתף את קישור ההזמנות', subtitle: 'יש לך זמינות ביומן' }
    },
    keep_going: {
      en: { title: 'Keep doing what works', subtitle: 'Your business is on track' },
      es: { title: 'Sigue así', subtitle: 'Tu negocio va bien' },
      he: { title: 'המשך במה שעובד', subtitle: 'העסק שלך על המסלול' }
    }
  };

  // Add reach_out if contacts went quiet
  if (stats.crm.went_quiet > 0) {
    const tr = translations.reach_out[language] || translations.reach_out.en;
    items.push({
      title: tr.title,
      subtitle: `${stats.crm.went_quiet} ${language === 'he' ? 'אנשים' : language === 'es' ? 'personas' : 'people'}`,
      priority: 1,
      actionType: 'reach_out'
    });
  }

  // Add collect if pending invoices
  if (stats.payments.pending_invoices > 0) {
    const tr = translations.collect[language] || translations.collect.en;
    items.push({
      title: tr.title,
      subtitle: `${stats.payments.pending_invoices} ${language === 'he' ? 'חשבוניות' : language === 'es' ? 'facturas' : 'invoices'}`,
      priority: 2,
      actionType: 'collect'
    });
  }

  // Add share_link if no upcoming bookings
  if (stats.scheduling.upcoming_count === 0) {
    const tr = translations.share_link[language] || translations.share_link.en;
    items.push({
      title: tr.title,
      subtitle: tr.subtitle,
      priority: 3,
      actionType: 'share_link'
    });
  }

  // Always add keep_going as last item
  const keepGoing = translations.keep_going[language] || translations.keep_going.en;
  items.push({
    title: keepGoing.title,
    subtitle: keepGoing.subtitle,
    priority: items.length + 1,
    actionType: 'keep_going'
  });

  return items.slice(0, 3); // Max 3 items
}

export function FocusList({ items, loading, stats }: FocusListProps) {
  const { language } = useLanguage();
  const router = useRouter();
  const isRTL = language === 'he';

  const titleText: Record<string, string> = {
    en: 'What to Focus On',
    es: 'En Qué Enfocarte',
    he: 'על מה להתמקד'
  };

  // Use static items if no LLM items provided
  const displayItems = items.length > 0 ? items : (stats ? generateStaticFocusItems(stats, language) : []);

  // Handle action clicks
  const handleAction = (actionType?: string) => {
    switch (actionType) {
      case 'reach_out':
        router.push('/business-os/crm?filter=quiet');
        break;
      case 'collect':
        router.push('/business-os/payments?filter=pending');
        break;
      case 'share_link':
        router.push('/business-os');
        break;
      default:
        // keep_going - no action needed
        break;
    }
  };

  if (loading) {
    return (
      <div
        className="bg-[var(--v2-surface)] border border-[var(--v2-border)] p-4"
        style={{ borderRadius: 'var(--v2-radius-card)' }}
      >
        <div className="flex items-center gap-2 mb-3">
          <Target className="w-4 h-4 text-[var(--v2-primary)]" />
          <h3 className="text-sm font-semibold text-[var(--v2-text-primary)]">
            {titleText[language] || titleText.en}
          </h3>
        </div>
        <div className="space-y-2 animate-pulse">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-start gap-2">
              <div className="w-8 h-8 rounded-lg bg-[var(--v2-border)]" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 bg-[var(--v2-border)] rounded w-3/4" />
                <div className="h-2.5 bg-[var(--v2-border)] rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (displayItems.length === 0) {
    return null;
  }

  return (
    <div
      className="bg-[var(--v2-surface)] border border-[var(--v2-border)] p-4"
      style={{ borderRadius: 'var(--v2-radius-card)' }}
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <Target className="w-4 h-4 text-[var(--v2-primary)]" />
        <h3 className="text-sm font-semibold text-[var(--v2-text-primary)]">
          {titleText[language] || titleText.en}
        </h3>
      </div>

      {/* Focus items */}
      <div className="space-y-1">
        {displayItems.map((item, index) => {
          const config = actionConfig[item.actionType || 'keep_going'];
          const Icon = config.icon;
          const isClickable = item.actionType && item.actionType !== 'keep_going';

          return (
            <button
              key={index}
              onClick={() => handleAction(item.actionType)}
              disabled={!isClickable}
              className={`w-full flex items-center gap-2 p-2 rounded-lg text-start transition-all ${
                isClickable
                  ? 'hover:bg-[var(--v2-surface-hover)] cursor-pointer group'
                  : 'cursor-default'
              }`}
            >
              {/* Priority number and icon */}
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: config.bgColor }}
              >
                <Icon className="w-4 h-4" style={{ color: config.color }} />
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-[var(--v2-text-primary)] line-clamp-1">
                  {item.title}
                </p>
                <p className="text-xs text-[var(--v2-text-secondary)] line-clamp-1">
                  {item.subtitle}
                </p>
              </div>

              {/* Arrow for clickable items */}
              {isClickable && (
                <ChevronRight
                  className="w-3.5 h-3.5 text-[var(--v2-text-muted)] flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity rtl:rotate-180"
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
