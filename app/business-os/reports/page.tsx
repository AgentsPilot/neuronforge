'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { BusinessOSHeader } from '@/components/business-os/BusinessOSHeader';
import { BigPictureSummary } from '@/components/business-os/reports/BigPictureSummary';
import { StoryCard } from '@/components/business-os/reports/StoryCard';
import { FocusList } from '@/components/business-os/reports/FocusList';
import {
  ArrowLeft,
  BarChart3,
  Users,
  Calendar,
  CreditCard,
  LayoutDashboard,
  List,
  FileText,
  Banknote
} from 'lucide-react';
import { assessAllCards } from '@/lib/business-os/insights/StaticHealthRules';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { PaymentTransactionList } from '@/components/payments/PaymentTransactionList';
import { PaymentInvoiceList } from '@/components/payments/PaymentInvoiceList';
import type { StoryResponse, FocusItem } from '@/app/api/business-os/story/route';
import type { BusinessStats, HealthStatus } from '@/lib/business-os/insights/StaticHealthRules';

// Reports theme color: Green (#22C58B)
const REPORTS_COLOR = '#22C58B';

type ViewMode = 'overview' | 'transactions' | 'invoices';

export default function ReportsPage() {
  const router = useRouter();
  const { t, language, formatCurrency } = useLanguage();
  const [viewMode, setViewMode] = useState<ViewMode>('overview');
  const [loading, setLoading] = useState(true);
  const [storyLoading, setStoryLoading] = useState(false);
  const [stats, setStats] = useState<BusinessStats | null>(null);
  const [story, setStory] = useState<StoryResponse | null>(null);
  const [hasGeneratedStory, setHasGeneratedStory] = useState(false);

  // Fetch stats on mount (no LLM call - just static data)
  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/business-os/stats');
      const data = await response.json();

      if (data.success && data.stats) {
        const newStats: BusinessStats = {
          payments: {
            revenue_30d: data.stats.payments?.revenue_30d || 0,
            pending_invoices: data.stats.payments?.pending_invoices || 0
          },
          crm: {
            total_contacts: data.stats.crm?.total_contacts || 0,
            new_this_week: data.stats.crm?.new_this_week || 0,
            became_clients_this_week: data.stats.crm?.became_clients_this_week || 0,
            went_quiet: data.stats.crm?.went_quiet || 0
          },
          scheduling: {
            bookings_30d: data.stats.scheduling?.bookings_30d || 0,
            upcoming_count: data.stats.scheduling?.upcoming_count || 0
          }
        };
        setStats(newStats);

        // Set static health assessments (no LLM)
        const cardHealth = assessAllCards(newStats);
        setStory({
          bigPicture: '', // Empty until user clicks Generate Insights
          focusItems: [],
          healthStatus: cardHealth.overall,
          cardHealth
        });
      }
    } catch (error) {
      console.error('Failed to fetch stats:', error);
    } finally {
      setLoading(false);
    }
  };

  // Only called when user clicks "Generate Insights" button
  const generateInsights = async () => {
    if (!stats) return;

    try {
      setStoryLoading(true);
      const response = await fetch('/api/business-os/story', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stats, language })
      });
      const data = await response.json();

      if (data.success && data.story) {
        setStory(data.story);
        setHasGeneratedStory(true);
      }
    } catch (error) {
      console.error('Failed to generate story:', error);
    } finally {
      setStoryLoading(false);
    }
  };

  // Translations for card content
  const cardTranslations: Record<string, Record<string, string>> = {
    money: {
      en: 'Money Momentum',
      es: 'Impulso del Dinero',
      he: 'תנועת הכסף'
    },
    people: {
      en: 'Your People',
      es: 'Tu Gente',
      he: 'האנשים שלך'
    },
    calendar: {
      en: 'Your Calendar',
      es: 'Tu Calendario',
      he: 'היומן שלך'
    },
    collection: {
      en: 'Collecting Payment',
      es: 'Cobrando Pagos',
      he: 'גביית תשלומים'
    },
    this_month: {
      en: 'this month',
      es: 'este mes',
      he: 'החודש'
    },
    new_faces: {
      en: 'new faces this week',
      es: 'caras nuevas esta semana',
      he: 'פנים חדשות השבוע'
    },
    became_clients: {
      en: 'became clients',
      es: 'se volvieron clientes',
      he: 'הפכו ללקוחות'
    },
    went_quiet: {
      en: 'went quiet',
      es: 'se callaron',
      he: 'השתתקו'
    },
    sessions: {
      en: 'sessions',
      es: 'sesiones',
      he: 'פגישות'
    },
    upcoming: {
      en: 'upcoming this week',
      es: 'próximas esta semana',
      he: 'קרובות השבוע'
    },
    waiting: {
      en: 'waiting',
      es: 'esperando',
      he: 'ממתין'
    },
    invoices: {
      en: 'invoices',
      es: 'facturas',
      he: 'חשבוניות'
    },
    people_in_network: {
      en: 'people in your network',
      es: 'personas en tu red',
      he: 'אנשים ברשת שלך'
    },
    send_reminder: {
      en: 'Send Reminder',
      es: 'Enviar Recordatorio',
      he: 'שלח תזכורת'
    }
  };

  // Status label translations
  const statusLabels: Record<string, Record<string, string>> = {
    growing: { en: 'Growing', es: 'Creciendo', he: 'צומח' },
    collect_pending: { en: 'Collect pending', es: 'Cobrar pendientes', he: 'לגבות ממתינים' },
    needs_attention: { en: 'Needs attention', es: 'Necesita atención', he: 'דורש תשומת לב' },
    just_starting: { en: 'Just starting', es: 'Recién empezando', he: 'רק מתחילים' },
    reach_out: { en: 'Reach out', es: 'Contactar', he: 'ליצור קשר' },
    many_quiet: { en: 'Many quiet', es: 'Muchos callados', he: 'רבים שותקים' },
    stable: { en: 'Stable', es: 'Estable', he: 'יציב' },
    busy: { en: 'Busy', es: 'Ocupado', he: 'עמוס' },
    active: { en: 'Active', es: 'Activo', he: 'פעיל' },
    quiet: { en: 'Quiet', es: 'Tranquilo', he: 'שקט' },
    all_collected: { en: 'All collected', es: 'Todo cobrado', he: 'הכל נגבה' },
    some_pending: { en: 'Some pending', es: 'Algunos pendientes', he: 'כמה ממתינים' },
    many_pending: { en: 'Many pending', es: 'Muchos pendientes', he: 'רבים ממתינים' }
  };

  // Card explanations based on health status
  const getMoneyExplanation = () => {
    if (!stats) return '';
    const key = story?.cardHealth?.money?.statusLabel || 'just_starting';
    const explanations: Record<string, Record<string, string>> = {
      growing: {
        en: 'Your pricing is working. People want what you offer.',
        es: 'Tu precio funciona. La gente quiere lo que ofreces.',
        he: 'התמחור שלך עובד. אנשים רוצים את מה שיש לך להציע.'
      },
      collect_pending: {
        en: 'Revenue is coming in. Some invoices need a gentle nudge.',
        es: 'Los ingresos llegan. Algunas facturas necesitan un empujoncito.',
        he: 'הכנסות נכנסות. כמה חשבוניות צריכות דחיפה קלה.'
      },
      needs_attention: {
        en: 'Time to follow up on those pending payments.',
        es: 'Es hora de dar seguimiento a esos pagos pendientes.',
        he: 'הגיע הזמן לעקוב אחרי התשלומים הממתינים.'
      },
      just_starting: {
        en: 'Your business is just getting started. Good things take time.',
        es: 'Tu negocio recién comienza. Las cosas buenas toman tiempo.',
        he: 'העסק שלך רק מתחיל. דברים טובים לוקחים זמן.'
      }
    };
    return explanations[key]?.[language] || explanations.just_starting.en;
  };

  const getPeopleExplanation = () => {
    if (!stats) return '';
    const key = story?.cardHealth?.people?.statusLabel || 'stable';
    const explanations: Record<string, Record<string, string>> = {
      growing: {
        en: 'Your network is growing nicely. Keep building those relationships.',
        es: 'Tu red crece bien. Sigue construyendo esas relaciones.',
        he: 'הרשת שלך צומחת יפה. המשך לבנות את הקשרים האלה.'
      },
      reach_out: {
        en: 'New faces are coming in. Reach out to the quiet ones too.',
        es: 'Caras nuevas llegan. Contacta también a los callados.',
        he: 'פנים חדשות מגיעות. פנה גם לשקטים.'
      },
      many_quiet: {
        en: 'Several contacts went quiet. A friendly check-in might help.',
        es: 'Varios contactos se callaron. Un saludo amigable podría ayudar.',
        he: 'כמה אנשי קשר השתתקו. בדיקה ידידותית עשויה לעזור.'
      },
      stable: {
        en: 'Your network is stable. Keep nurturing those connections.',
        es: 'Tu red es estable. Sigue nutriendo esas conexiones.',
        he: 'הרשת שלך יציבה. המשך לטפח את הקשרים האלה.'
      },
      just_starting: {
        en: 'Building your network takes time. Every contact counts.',
        es: 'Construir tu red toma tiempo. Cada contacto cuenta.',
        he: 'בניית הרשת שלך לוקחת זמן. כל איש קשר חשוב.'
      }
    };
    return explanations[key]?.[language] || explanations.stable.en;
  };

  const getCalendarExplanation = () => {
    if (!stats) return '';
    const key = story?.cardHealth?.calendar?.statusLabel || 'active';
    const explanations: Record<string, Record<string, string>> = {
      busy: {
        en: 'Your calendar is filling up. Clients are booking you consistently.',
        es: 'Tu calendario se llena. Los clientes te reservan constantemente.',
        he: 'היומן שלך מתמלא. לקוחות מזמינים אותך באופן קבוע.'
      },
      active: {
        en: 'Bookings are coming in. Your availability is working.',
        es: 'Las reservas llegan. Tu disponibilidad funciona.',
        he: 'הזמנות נכנסות. הזמינות שלך עובדת.'
      },
      quiet: {
        en: 'Your calendar is quiet. Maybe share your booking link.',
        es: 'Tu calendario está tranquilo. Quizás comparte tu enlace de reservas.',
        he: 'היומן שלך שקט. אולי שתף את קישור ההזמנות שלך.'
      }
    };
    return explanations[key]?.[language] || explanations.active.en;
  };

  const getCollectionExplanation = () => {
    if (!stats) return '';
    const key = story?.cardHealth?.collection?.statusLabel || 'all_collected';
    const explanations: Record<string, Record<string, string>> = {
      all_collected: {
        en: 'All payments are in. Great job staying on top of things.',
        es: 'Todos los pagos están al día. Buen trabajo manteniéndote al día.',
        he: 'כל התשלומים נגבו. עבודה מצוינת להישאר מעודכן.'
      },
      some_pending: {
        en: 'A gentle reminder might help them remember.',
        es: 'Un recordatorio amable podría ayudarles a recordar.',
        he: 'תזכורת עדינה עשויה לעזור להם לזכור.'
      },
      many_pending: {
        en: 'Time to follow up on those invoices.',
        es: 'Es hora de dar seguimiento a esas facturas.',
        he: 'הגיע הזמן לעקוב אחרי החשבוניות האלה.'
      }
    };
    return explanations[key]?.[language] || explanations.all_collected.en;
  };

  const tr = (key: string) => cardTranslations[key]?.[language] || cardTranslations[key]?.en || key;
  const getStatusLabel = (key: string) => statusLabels[key]?.[language] || statusLabels[key]?.en || key;

  const isRTL = language === 'he';

  return (
    <div className="min-h-screen bg-[var(--v2-bg)]" dir={isRTL ? 'rtl' : 'ltr'}>
      <BusinessOSHeader />

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-4">

        {/* Page Header - Compact */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: 'rgba(34, 197, 139, 0.2)' }}
            >
              <BarChart3 className="w-5 h-5" style={{ color: REPORTS_COLOR }} />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-[var(--v2-text-primary)]">
                {t('reports.title') || 'Your Business Story'}
              </h1>
              <p className="text-xs text-[var(--v2-text-secondary)]">
                {t('reports.subtitle') || 'How your business is doing'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Back to Dashboard */}
            <button
              onClick={() => router.push('/business-os')}
              className="p-2 text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] bg-[var(--v2-surface)] border border-[var(--v2-border)] transition-all hover:bg-[var(--v2-border)]"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
              title={t('reports.back_to_dashboard') || 'Back to dashboard'}
            >
              <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
            </button>

            {/* View Mode Tabs */}
            <div
              className="bg-[var(--v2-surface)] border border-[var(--v2-border)] p-1 inline-flex gap-1"
              style={{ borderRadius: 'var(--v2-radius-card)' }}
            >
              <button
                className={`p-2 transition-all border ${
                  viewMode === 'overview'
                    ? 'text-[#22C58B] border-[#22C58B] bg-[#22C58B]/10'
                    : 'text-[var(--v2-text-secondary)] border-transparent hover:text-[var(--v2-text-primary)]'
                }`}
                style={{ borderRadius: 'var(--v2-radius-button)' }}
                onClick={() => setViewMode('overview')}
                title={t('reports.tab_overview') || 'Overview'}
              >
                <LayoutDashboard className="h-4 w-4" />
              </button>
              <button
                className={`p-2 transition-all border ${
                  viewMode === 'transactions'
                    ? 'text-[#22C58B] border-[#22C58B] bg-[#22C58B]/10'
                    : 'text-[var(--v2-text-secondary)] border-transparent hover:text-[var(--v2-text-primary)]'
                }`}
                style={{ borderRadius: 'var(--v2-radius-button)' }}
                onClick={() => setViewMode('transactions')}
                title={t('reports.tab_transactions') || 'Transactions'}
              >
                <List className="h-4 w-4" />
              </button>
              <button
                className={`p-2 transition-all border ${
                  viewMode === 'invoices'
                    ? 'text-[#22C58B] border-[#22C58B] bg-[#22C58B]/10'
                    : 'text-[var(--v2-text-secondary)] border-transparent hover:text-[var(--v2-text-primary)]'
                }`}
                style={{ borderRadius: 'var(--v2-radius-button)' }}
                onClick={() => setViewMode('invoices')}
                title={t('reports.tab_invoices') || 'Invoices'}
              >
                <FileText className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Loading state */}
        {loading ? (
          <div className="flex items-center justify-center min-h-[300px]">
            <div className="text-center space-y-3">
              <div
                className="w-12 h-12 border-3 border-t-transparent rounded-full animate-spin mx-auto"
                style={{ borderColor: REPORTS_COLOR, borderTopColor: 'transparent' }}
              />
              <p className="text-sm text-[var(--v2-text-secondary)]">{t('reports.loading') || 'Loading...'}</p>
            </div>
          </div>
        ) : viewMode === 'overview' ? (
          /* Story-driven Overview - Compact layout */
          <div className="space-y-3">
            {/* Big Picture Summary */}
            <BigPictureSummary
              narrative={story?.bigPicture || ''}
              healthStatus={story?.healthStatus || 'healthy'}
              loading={storyLoading}
              onGenerateInsights={generateInsights}
              hasGeneratedStory={hasGeneratedStory}
            />

            {/* Story Cards Grid - Each card has its own contextual trend graph */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
              {/* Money Card */}
              <StoryCard
                icon={Banknote}
                iconColor={REPORTS_COLOR}
                iconBgColor="rgba(34, 197, 139, 0.15)"
                title={tr('money')}
                mainValue={formatCurrency(stats?.payments.revenue_30d || 0)}
                health={story?.cardHealth?.money?.status || 'healthy'}
                statusLabel={getStatusLabel(story?.cardHealth?.money?.statusLabel || 'growing')}
                explanation={getMoneyExplanation()}
                trendType="revenue"
                currentValue={stats?.payments.revenue_30d || 0}
                previousValue={(stats?.payments.revenue_30d || 0) * 0.85}
              />

              {/* People Card */}
              <StoryCard
                icon={Users}
                iconColor="#8B5CF6"
                iconBgColor="rgba(139, 92, 246, 0.15)"
                title={tr('people')}
                mainValue={`${stats?.crm.total_contacts || 0} ${tr('people_in_network')}`}
                details={[
                  { label: tr('new_faces'), value: stats?.crm.new_this_week || 0 },
                  { label: tr('became_clients'), value: stats?.crm.became_clients_this_week || 0 },
                  { label: tr('went_quiet'), value: stats?.crm.went_quiet || 0, highlight: (stats?.crm.went_quiet || 0) > 0 }
                ]}
                health={story?.cardHealth?.people?.status || 'healthy'}
                statusLabel={getStatusLabel(story?.cardHealth?.people?.statusLabel || 'stable')}
                explanation={getPeopleExplanation()}
                action={stats?.crm.went_quiet && stats.crm.went_quiet > 0 ? {
                  label: tr('send_reminder'),
                  onClick: () => router.push('/business-os/crm?filter=quiet')
                } : undefined}
                trendType="people"
                currentValue={stats?.crm.total_contacts || 0}
                previousValue={(stats?.crm.total_contacts || 0) - (stats?.crm.new_this_week || 0)}
              />

              {/* Calendar Card */}
              <StoryCard
                icon={Calendar}
                iconColor="#14B8A6"
                iconBgColor="rgba(20, 184, 166, 0.15)"
                title={tr('calendar')}
                mainValue={`${stats?.scheduling.bookings_30d || 0} ${tr('sessions')} ${tr('this_month')}`}
                details={[
                  { label: tr('upcoming'), value: stats?.scheduling.upcoming_count || 0 }
                ]}
                health={story?.cardHealth?.calendar?.status || 'healthy'}
                statusLabel={getStatusLabel(story?.cardHealth?.calendar?.statusLabel || 'active')}
                explanation={getCalendarExplanation()}
                trendType="calendar"
                currentValue={stats?.scheduling.bookings_30d || 0}
                previousValue={(stats?.scheduling.bookings_30d || 0) * 0.8}
              />

              {/* Collection Card */}
              <StoryCard
                icon={CreditCard}
                iconColor="#F59E0B"
                iconBgColor="rgba(245, 158, 11, 0.15)"
                title={tr('collection')}
                mainValue={`${stats?.payments.pending_invoices || 0} ${tr('invoices')} ${tr('waiting')}`}
                health={story?.cardHealth?.collection?.status || 'healthy'}
                statusLabel={getStatusLabel(story?.cardHealth?.collection?.statusLabel || 'all_collected')}
                explanation={getCollectionExplanation()}
                action={stats?.payments.pending_invoices && stats.payments.pending_invoices > 0 ? {
                  label: tr('send_reminder'),
                  onClick: () => router.push('/business-os/payments?filter=pending')
                } : undefined}
                trendType="collection"
                currentValue={stats?.payments.pending_invoices || 0}
                previousValue={(stats?.payments.pending_invoices || 0) * 1.2}
              />
            </div>

            {/* Focus List */}
            <FocusList
              items={story?.focusItems || []}
              loading={storyLoading}
              stats={stats}
            />
          </div>
        ) : (
          /* Transactions / Invoices view */
          <div
            className="bg-[var(--v2-surface)] border border-[var(--v2-border)] p-4"
            style={{ borderRadius: 'var(--v2-radius-card)' }}
          >
            {viewMode === 'transactions' && <PaymentTransactionList searchQuery="" />}
            {viewMode === 'invoices' && (
              <PaymentInvoiceList searchQuery="" onCreateInvoice={() => {}} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
