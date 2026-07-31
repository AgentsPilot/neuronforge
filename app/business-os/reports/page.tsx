'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { BusinessOSHeader } from '@/components/business-os/BusinessOSHeader';
import { BigPictureSummary } from '@/components/business-os/reports/BigPictureSummary';
import { StoryCard } from '@/components/business-os/reports/StoryCard';
import {
  ArrowLeft,
  BarChart3,
  Users,
  Calendar,
  CreditCard,
  LayoutDashboard,
  List,
  FileText,
  Banknote,
  Globe
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
  const searchParams = useSearchParams();
  const { t, language, formatCurrency } = useLanguage();

  // Check URL params for initial view mode and invoice filter
  const tabParam = searchParams.get('tab');
  const invoiceIdParam = searchParams.get('invoice');
  const initialViewMode = tabParam === 'invoices' || tabParam === 'transactions' ? tabParam : 'overview';

  const [viewMode, setViewMode] = useState<ViewMode>(initialViewMode);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(invoiceIdParam);
  const [loading, setLoading] = useState(true);
  const [storyLoading, setStoryLoading] = useState(false);
  const [stats, setStats] = useState<BusinessStats | null>(null);
  const [story, setStory] = useState<StoryResponse | null>(null);
  const [hasGeneratedStory, setHasGeneratedStory] = useState(false);
  const [websiteAnalytics, setWebsiteAnalytics] = useState<{
    total_views: number;
    unique_visitors: number;
    visitors_today: number;
    visitors_7d: number;
    visitors_30d: number;
  } | null>(null);
  // Detailed stats from the API for expandable cards
  const [detailedStats, setDetailedStats] = useState<{
    scheduling: {
      confirmed_30d: number;
      completed_30d: number;
      cancelled_30d: number;
      no_show_30d: number;
      total_revenue_30d: number;
    };
    payments: {
      successful_transactions_30d: number;
      failed_transactions_30d: number;
      refunded_30d: number;
      invoices_sent_30d: number;
      invoices_paid_30d: number;
      invoices_overdue: number;
      average_invoice_amount: number;
    };
    crm: {
      active_leads: number;
      active_clients: number;
      contacts_by_source: { source: string; count: number }[];
    };
    website: {
      form_submissions_30d: number;
    };
  } | null>(null);

  // Fetch stats on mount (no LLM call - just static data)
  useEffect(() => {
    fetchStats();
    fetchWebsiteAnalytics();
  }, []);

  // Update view mode when URL params change
  useEffect(() => {
    const tab = searchParams.get('tab');
    const invoice = searchParams.get('invoice');
    if (tab === 'invoices' || tab === 'transactions') {
      setViewMode(tab);
    }
    if (invoice) {
      setSelectedInvoiceId(invoice);
    }
  }, [searchParams]);

  const fetchStats = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/business-os/stats', { cache: 'no-store' });
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

        // Extract detailed stats for expandable cards
        setDetailedStats({
          scheduling: {
            confirmed_30d: data.stats.scheduling?.confirmed_30d || 0,
            completed_30d: data.stats.scheduling?.completed_30d || 0,
            cancelled_30d: data.stats.scheduling?.cancelled_30d || 0,
            no_show_30d: data.stats.scheduling?.no_show_30d || 0,
            total_revenue_30d: data.stats.scheduling?.total_revenue_30d || 0,
          },
          payments: {
            successful_transactions_30d: data.stats.payments?.successful_transactions_30d || 0,
            failed_transactions_30d: data.stats.payments?.failed_transactions_30d || 0,
            refunded_30d: data.stats.payments?.refunded_30d || 0,
            invoices_sent_30d: data.stats.payments?.invoices_sent_30d || 0,
            invoices_paid_30d: data.stats.payments?.invoices_paid_30d || 0,
            invoices_overdue: data.stats.payments?.invoices_overdue || 0,
            average_invoice_amount: data.stats.payments?.average_invoice_amount || 0,
          },
          crm: {
            active_leads: data.stats.crm?.active_leads || 0,
            active_clients: data.stats.crm?.active_clients || 0,
            contacts_by_source: data.stats.crm?.contacts_by_source || [],
          },
          website: {
            form_submissions_30d: data.stats.website?.form_submissions_30d || 0,
          },
        });

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

  const fetchWebsiteAnalytics = async () => {
    try {
      const response = await fetch('/api/website/analytics', { cache: 'no-store' });
      const data = await response.json();
      if (data.success && data.analytics) {
        setWebsiteAnalytics(data.analytics);
      }
    } catch (error) {
      console.error('Failed to fetch website analytics:', error);
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
    website: {
      en: 'Website Traffic',
      es: 'Tráfico del Sitio',
      he: 'תנועה באתר'
    },
    visitors: {
      en: 'visitors',
      es: 'visitantes',
      he: 'מבקרים'
    },
    views: {
      en: 'page views',
      es: 'vistas',
      he: 'צפיות'
    },
    today: {
      en: 'today',
      es: 'hoy',
      he: 'היום'
    },
    last_7_days: {
      en: 'last 7 days',
      es: 'últimos 7 días',
      he: '7 ימים אחרונים'
    },
    last_30_days: {
      en: 'last 30 days',
      es: 'últimos 30 días',
      he: '30 ימים אחרונים'
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
    },
    // Detailed stats translations
    confirmed: {
      en: 'Confirmed',
      es: 'Confirmadas',
      he: 'מאושר'
    },
    completed: {
      en: 'Completed',
      es: 'Completadas',
      he: 'הושלם'
    },
    cancelled: {
      en: 'Cancelled',
      es: 'Canceladas',
      he: 'בוטל'
    },
    no_show: {
      en: 'No-Show',
      es: 'No asistió',
      he: 'לא הגיע'
    },
    booking_revenue: {
      en: 'Revenue',
      es: 'Ingresos',
      he: 'הכנסות'
    },
    successful: {
      en: 'Successful',
      es: 'Exitosas',
      he: 'הצליחו'
    },
    failed: {
      en: 'Failed',
      es: 'Fallidas',
      he: 'נכשלו'
    },
    refunded: {
      en: 'Refunded',
      es: 'Reembolsadas',
      he: 'הוחזרו'
    },
    invoices_sent: {
      en: 'Sent',
      es: 'Enviadas',
      he: 'נשלחו'
    },
    invoices_paid: {
      en: 'Paid',
      es: 'Pagadas',
      he: 'שולמו'
    },
    overdue: {
      en: 'Overdue',
      es: 'Vencidas',
      he: 'באיחור'
    },
    average_amount: {
      en: 'Avg. Amount',
      es: 'Monto Prom.',
      he: 'סכום ממוצע'
    },
    active_leads: {
      en: 'Active Leads',
      es: 'Leads Activos',
      he: 'לידים פעילים'
    },
    active_clients: {
      en: 'Active Clients',
      es: 'Clientes Activos',
      he: 'לקוחות פעילים'
    },
    form_submissions: {
      en: 'Form Submissions',
      es: 'Envíos de Formulario',
      he: 'הגשות טפסים'
    },
    breakdown_30d: {
      en: '30-day breakdown',
      es: 'Desglose de 30 días',
      he: 'פירוט 30 יום'
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
    many_pending: { en: 'Many pending', es: 'Muchos pendientes', he: 'רבים ממתינים' },
    getting_traffic: { en: 'Getting traffic', es: 'Recibiendo tráfico', he: 'מקבל תנועה' },
    no_traffic: { en: 'No traffic yet', es: 'Sin tráfico aún', he: 'אין תנועה עדיין' }
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

  const getWebsiteExplanation = () => {
    if (!websiteAnalytics) return '';
    const hasTraffic = websiteAnalytics.visitors_30d > 0;
    const explanations: Record<string, Record<string, string>> = {
      getting_traffic: {
        en: 'People are finding your website. Keep sharing your link.',
        es: 'La gente está encontrando tu sitio. Sigue compartiendo tu enlace.',
        he: 'אנשים מוצאים את האתר שלך. המשך לשתף את הקישור.'
      },
      no_traffic: {
        en: 'Your website is ready. Share your link to get visitors.',
        es: 'Tu sitio está listo. Comparte tu enlace para conseguir visitantes.',
        he: 'האתר שלך מוכן. שתף את הקישור שלך כדי לקבל מבקרים.'
      }
    };
    const key = hasTraffic ? 'getting_traffic' : 'no_traffic';
    return explanations[key]?.[language] || explanations.no_traffic.en;
  };

  const getWebsiteHealth = (): HealthStatus => {
    if (!websiteAnalytics) return 'healthy';
    if (websiteAnalytics.visitors_30d > 0) return 'healthy';
    return 'watch';
  };

  const getWebsiteStatusLabel = (): string => {
    if (!websiteAnalytics) return 'no_traffic';
    return websiteAnalytics.visitors_30d > 0 ? 'getting_traffic' : 'no_traffic';
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

            {/* Story Cards Grid - 3 cards per row, equal heights */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" style={{ gridAutoRows: 'minmax(280px, auto)' }}>
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
                expandedTitle={tr('breakdown_30d')}
                expandedDetails={[
                  { label: tr('successful'), value: detailedStats?.payments.successful_transactions_30d || 0, color: 'green' },
                  { label: tr('failed'), value: detailedStats?.payments.failed_transactions_30d || 0, color: detailedStats?.payments.failed_transactions_30d ? 'red' : 'default' },
                  { label: tr('refunded'), value: detailedStats?.payments.refunded_30d || 0 },
                  { label: tr('average_amount'), value: formatCurrency(detailedStats?.payments.average_invoice_amount || 0) },
                ]}
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
                expandedTitle={tr('breakdown_30d')}
                expandedDetails={[
                  { label: tr('active_leads'), value: detailedStats?.crm.active_leads || 0 },
                  { label: tr('active_clients'), value: detailedStats?.crm.active_clients || 0, color: 'green' },
                  { label: tr('went_quiet'), value: stats?.crm.went_quiet || 0, color: stats?.crm.went_quiet ? 'amber' : 'default' },
                  { label: tr('became_clients'), value: stats?.crm.became_clients_this_week || 0 },
                ]}
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
                expandedTitle={tr('breakdown_30d')}
                expandedDetails={[
                  { label: tr('confirmed'), value: detailedStats?.scheduling.confirmed_30d || 0 },
                  { label: tr('completed'), value: detailedStats?.scheduling.completed_30d || 0, color: 'green' },
                  { label: tr('cancelled'), value: detailedStats?.scheduling.cancelled_30d || 0, color: detailedStats?.scheduling.cancelled_30d ? 'red' : 'default' },
                  { label: tr('no_show'), value: detailedStats?.scheduling.no_show_30d || 0, color: detailedStats?.scheduling.no_show_30d ? 'amber' : 'default' },
                ]}
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
                expandedTitle={tr('breakdown_30d')}
                expandedDetails={[
                  { label: tr('invoices_sent'), value: detailedStats?.payments.invoices_sent_30d || 0 },
                  { label: tr('invoices_paid'), value: detailedStats?.payments.invoices_paid_30d || 0, color: 'green' },
                  { label: tr('overdue'), value: detailedStats?.payments.invoices_overdue || 0, color: detailedStats?.payments.invoices_overdue ? 'red' : 'default' },
                  { label: tr('waiting'), value: stats?.payments.pending_invoices || 0, color: stats?.payments.pending_invoices ? 'amber' : 'default' },
                ]}
              />

              {/* Website Card */}
              <StoryCard
                icon={Globe}
                iconColor="#3B82F6"
                iconBgColor="rgba(59, 130, 246, 0.15)"
                title={tr('website')}
                mainValue={`${websiteAnalytics?.visitors_30d || 0} ${tr('visitors')} ${tr('last_30_days')}`}
                health={getWebsiteHealth()}
                statusLabel={getStatusLabel(getWebsiteStatusLabel())}
                explanation={getWebsiteExplanation()}
                action={{
                  label: language === 'he' ? 'צפה באתר' : language === 'es' ? 'Ver sitio' : 'View site',
                  onClick: () => router.push('/business-os/website')
                }}
                trendType="people"
                currentValue={websiteAnalytics?.visitors_30d || 0}
                previousValue={(websiteAnalytics?.visitors_30d || 0) * 0.8}
                expandedTitle={tr('breakdown_30d')}
                expandedDetails={[
                  { label: tr('today'), value: websiteAnalytics?.visitors_today || 0 },
                  { label: tr('last_7_days'), value: websiteAnalytics?.visitors_7d || 0 },
                  { label: tr('form_submissions'), value: detailedStats?.website.form_submissions_30d || 0, color: detailedStats?.website.form_submissions_30d ? 'green' : 'default' },
                  { label: tr('views'), value: websiteAnalytics?.total_views || 0 },
                ]}
              />
            </div>
          </div>
        ) : (
          /* Transactions / Invoices view */
          <div
            className="bg-[var(--v2-surface)] border border-[var(--v2-border)] p-4"
            style={{ borderRadius: 'var(--v2-radius-card)' }}
          >
            {viewMode === 'transactions' && <PaymentTransactionList searchQuery="" />}
            {viewMode === 'invoices' && (
              <PaymentInvoiceList
                searchQuery=""
                onCreateInvoice={() => {}}
                highlightId={selectedInvoiceId}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
