'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/UserProvider';
import { BusinessOSHeader } from '@/components/business-os/BusinessOSHeader';
import { StoryBeat, SummaryData } from '@/components/business-os/MyDaySection';
import { LiveDashboard, SetupItem, FunnelStats, MilestoneData } from '@/components/business-os/insight';
import { ChatCommandPanel, ChatCommandPanelRef } from '@/components/business-os/ChatCommandPanel';
import { CapabilityCard, WebsiteStats, PeopleStats, ReportsStats, ConfigStats } from '@/components/business-os/CapabilityCard';
import { ConfigurationDialog } from '@/components/business-os/ConfigurationDialog';
import { CRMContactModal } from '@/components/crm/CRMContactModal';
import { SchedulingDialog } from '@/components/business-os/SchedulingDialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import type { DialogAction } from '@/lib/business-os/DraftManagerTypes';
import type { CRMContact } from '@/lib/repositories/CRMContactRepository';
import type { CRMPipelineStage } from '@/lib/repositories/CRMPipelineStagesRepository';

interface MyDayData {
  userName: string;
  greeting: 'morning' | 'afternoon' | 'evening';
  summaryData: SummaryData;
  storyBeats: StoryBeat[];
}

// Calculate greeting based on current time
function getGreetingFromTime(): 'morning' | 'afternoon' | 'evening' {
  const hour = new Date().getHours();
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

interface DashboardStats {
  website: WebsiteStats;
  people: PeopleStats;
  reports: ReportsStats;
  config: ConfigStats;
}

function BusinessOSContent() {
  const router = useRouter();
  const { user } = useAuth();
  const { t, language } = useLanguage();
  const chatPanelRef = useRef<ChatCommandPanelRef>(null);
  const [loading, setLoading] = useState(true);
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [configInitialTab, setConfigInitialTab] = useState<'services' | 'availability' | 'intake' | 'payments'>('services');
  const [configVisibleTabs, setConfigVisibleTabs] = useState<('services' | 'availability' | 'intake' | 'payments')[] | undefined>(undefined);
  const [configServiceToEdit, setConfigServiceToEdit] = useState<string | undefined>(undefined);
  const [configServicePrefill, setConfigServicePrefill] = useState<Record<string, any> | undefined>(undefined);
  const [configAvailabilityDays, setConfigAvailabilityDays] = useState<string[] | undefined>(undefined); // Days to pre-select in availability editor
  const [pendingDraftService, setPendingDraftService] = useState<{ name: string; duration: number; price: number; currency: string } | null>(null);
  const [pendingServiceUpdate, setPendingServiceUpdate] = useState<{ serviceId: string; serviceName: string; updates: Record<string, any>; updateDescription: string } | null>(null);

  // Delete confirmation dialog state
  const [deleteConfirmation, setDeleteConfirmation] = useState<{
    entityType: 'service' | 'contact' | 'booking' | 'task' | 'invoice';
    entityId: string;
    entityName: string;
  } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Contact modal state
  const [isContactModalOpen, setIsContactModalOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<CRMContact | undefined>(undefined);
  const [contactPrefill, setContactPrefill] = useState<Record<string, any> | undefined>(undefined);
  const [pipelineStages, setPipelineStages] = useState<CRMPipelineStage[]>([]);

  // Scheduling dialog state
  const [isSchedulingDialogOpen, setIsSchedulingDialogOpen] = useState(false);
  const [schedulingInitialDate, setSchedulingInitialDate] = useState<string | undefined>(undefined);
  const [schedulingInitialBookingId, setSchedulingInitialBookingId] = useState<string | undefined>(undefined);

  // My Day section collapsed state - controls expanded height for chat and cards
  const [isMyDayCollapsed, setIsMyDayCollapsed] = useState(false);

  // Insight card collapsed state
  const [isInsightCollapsed, setIsInsightCollapsed] = useState(false);

  // Capability cards visibility (hidden by default)
  const [showCapabilityCards, setShowCapabilityCards] = useState(false);

  // Active capabilities - determines which cards to show
  const [activeCapabilities, setActiveCapabilities] = useState<Set<string>>(new Set());
  const [capabilitiesLoading, setCapabilitiesLoading] = useState(true);


  // My Day data - use time-based greeting as initial state
  const [myDay, setMyDay] = useState<MyDayData>(() => ({
    userName: '', // Empty until loaded from API
    greeting: getGreetingFromTime(),
    summaryData: { key: 'myday.summary.default' },
    storyBeats: []
  }));

  // Capability stats
  const [stats, setStats] = useState<DashboardStats>({
    website: {
      url: 'your-site.agentspilot.site',
      visitorsToday: 0,
      bookingStarts: 0,
      status: 'draft'
    },
    people: {
      totalContacts: 0,
      newThisWeek: 0,
      becameClients: 0,
      wentQuiet: 0,
      pipeline: []
    },
    reports: {
      weeklyRevenue: 0,
      weeklyBars: [0, 0, 0, 0, 0, 0],
      changePercent: 0,
      previousWeek: 0,
      outstanding: 0
    },
    config: {
      servicesCount: 0,
      servicesActive: false,
      hoursSet: false,
      openDaysCount: 0,
      paymentsConnected: false,
      paymentsProvider: null, // Will be set from API if connected
      automationsCount: 0,
      calendarSynced: false,
      calendarProvider: null
    }
  });

  // LiveDashboard data state
  const [setupItems, setSetupItems] = useState<SetupItem[]>([]);
  const [funnelStats, setFunnelStats] = useState<FunnelStats | undefined>(undefined);
  const [milestoneData, setMilestoneData] = useState<MilestoneData | undefined>(undefined);
  const [draftPageId, setDraftPageId] = useState<string | undefined>(undefined);
  const [publishingWebsite, setPublishingWebsite] = useState(false);

  useEffect(() => {
    if (user) {
      fetchCapabilities();
      fetchDashboardData();
    }
  }, [user]);

  const fetchCapabilities = async () => {
    try {
      const response = await fetch('/api/capabilities', { cache: 'no-store' });
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.enabledKeys) {
          setActiveCapabilities(new Set(data.enabledKeys));
        }
      }
    } catch (error) {
      // Error handled silently - default to no capabilities
      console.error('Failed to load capabilities:', error);
    } finally {
      setCapabilitiesLoading(false);
    }
  };

  const fetchDashboardData = async () => {
    try {
      // Fetch My Day data, stats, and pipeline stages in parallel
      // Use cache: 'no-store' to ensure fresh data on each load
      const [myDayResponse, statsResponse, stagesResponse] = await Promise.all([
        fetch('/api/business-os/my-day', { cache: 'no-store' }),
        fetch('/api/business-os/stats', { cache: 'no-store' }),
        fetch('/api/crm/pipeline-stages', { cache: 'no-store' })
      ]);

      // Fetch pipeline stages for contact modal
      if (stagesResponse.ok) {
        const stagesData = await stagesResponse.json();
        if (stagesData.success && stagesData.stages) {
          setPipelineStages(stagesData.stages);
        }
      }

      if (myDayResponse.ok) {
        const myDayData = await myDayResponse.json();
        if (myDayData.success && myDayData.data) {
          setMyDay(myDayData.data);
        }
      }

      if (statsResponse.ok) {
        const statsData = await statsResponse.json();
        if (statsData.success && statsData.stats) {
          // Transform stats data into capability card format
          const s = statsData.stats;

          setStats({
            website: {
              url: s.website?.url || 'your-site.agentspilot.site',
              visitorsToday: s.website?.visitors_30d || 0,
              bookingStarts: s.website?.bookings_30d || 0,
              status: s.website?.has_live_pages ? 'live' : 'draft',
              wantsWebsite: s.website?.wants_website || false,
              hasLivePages: s.website?.has_live_pages || false
            },
            people: {
              totalContacts: s.crm?.total_contacts || 0,
              newThisWeek: s.crm?.new_this_week || 0,
              becameClients: s.crm?.became_clients_this_week || 0,
              wentQuiet: s.crm?.went_quiet || 0,
              pipeline: s.crm?.pipeline_stages || []
            },
            reports: (() => {
              // The card is labelled "booked this week", so it shows what clients
              // ordered — priced from the service, whether or not payment cleared.
              // Money actually collected lives on the reports page instead.
              const bookedThisWeek = s.scheduling?.booked_value_this_week || 0;
              const bookedLastWeek = s.scheduling?.booked_value_last_week || 0;
              return {
                weeklyRevenue: bookedThisWeek,
                weeklyBars: generateWeeklyBars(bookedThisWeek, bookedLastWeek),
                changePercent: calculateChangePercent(bookedThisWeek, bookedLastWeek),
                previousWeek: bookedLastWeek,
                // Unpaid invoices of any age — same figure the reports page shows as "Owed".
                outstanding: s.payments?.pending_invoices_amount || 0
              };
            })(),
            config: {
              servicesCount: s.scheduling?.active_services_count || 0,
              servicesActive: (s.scheduling?.active_services_count || 0) > 0,
              hoursSet: (s.scheduling?.open_days_count || 0) > 0,
              openDaysCount: s.scheduling?.open_days_count || 0,
              paymentsConnected: s.scheduling?.stripe_connected || false,
              paymentsProvider: s.scheduling?.stripe_connected ? 'Stripe' : null, // Only show provider if connected
              automationsCount: s.automation_engine?.workflows_count || 0,
              calendarSynced: s.scheduling?.calendar_synced || false,
              calendarProvider: s.scheduling?.calendar_provider || null
            }
          });

          // Compute setup items for LiveDashboard from stats
          const computedSetupItems: SetupItem[] = [];

          // Website setup
          if (s.website?.wants_website && !s.website?.has_live_pages) {
            computedSetupItems.push({
              id: 'website',
              title: language === 'he' ? 'פרסם אתר' : 'Publish website',
              description: language === 'he' ? 'לקוחות לא יכולים למצוא אותך או להזמין' : 'Clients cannot find you or book',
              completed: false,
              action: 'publish_website'
            });
            // Store draft page ID for quick publish
            if (s.website?.draft_page_id) {
              setDraftPageId(s.website.draft_page_id);
            }
          } else if (s.website?.has_live_pages) {
            computedSetupItems.push({
              id: 'website',
              title: language === 'he' ? 'אתר פורסם' : 'Website published',
              description: s.website?.url || '',
              completed: true
            });
          }

          // Services setup
          if ((s.scheduling?.active_services_count || 0) === 0) {
            computedSetupItems.push({
              id: 'services',
              title: language === 'he' ? 'הוסף שירותים' : 'Add services',
              description: language === 'he' ? 'אין מה להזמין — דף ההזמנות ריק' : 'There is nothing to book — the booking page is empty',
              completed: false,
              action: 'add_services'
            });
          } else {
            computedSetupItems.push({
              id: 'services',
              title: language === 'he' ? `${s.scheduling.active_services_count} שירותים פעילים` : `${s.scheduling.active_services_count} active services`,
              description: '',
              completed: true
            });
          }

          // Availability setup
          if ((s.scheduling?.open_days_count || 0) === 0) {
            computedSetupItems.push({
              id: 'availability',
              title: language === 'he' ? 'הגדר שעות פעילות' : 'Set availability',
              description: language === 'he' ? 'אין זמנים פנויים להצגה ללקוח' : 'No available times to show a client',
              completed: false,
              action: 'set_hours'
            });
          } else {
            computedSetupItems.push({
              id: 'availability',
              title: language === 'he' ? `${s.scheduling.open_days_count} ימים פתוחים` : `${s.scheduling.open_days_count} days open`,
              description: '',
              completed: true
            });
          }

          // Payments setup
          if (!s.scheduling?.stripe_connected) {
            computedSetupItems.push({
              id: 'payments',
              title: language === 'he' ? 'חבר תשלומים' : 'Connect payments',
              description: language === 'he' ? 'לא ניתן לגבות תשלום בזמן ההזמנה' : 'You cannot take payment at booking',
              completed: false,
              action: 'connect_payments'
            });
          } else {
            computedSetupItems.push({
              id: 'payments',
              title: language === 'he' ? 'תשלומים מחוברים' : 'Payments connected',
              description: 'Stripe',
              completed: true
            });
          }

          // Calendar sync — recommended, not required. Bookings work without it,
          // but nothing stops a client booking over something already in your diary.
          if (!s.scheduling?.calendar_synced) {
            computedSetupItems.push({
              id: 'calendar',
              title: language === 'he' ? 'סנכרן יומן' : 'Sync calendar',
              description: language === 'he' ? 'מנע הזמנות כפולות מול היומן שלך' : 'Stop clients booking over what you already have',
              completed: false,
              action: 'sync_calendar',
              required: false
            });
          } else {
            computedSetupItems.push({
              id: 'calendar',
              title: language === 'he' ? 'היומן מסונכרן' : 'Calendar synced',
              description: s.scheduling?.calendar_provider === 'outlook' ? 'Outlook' : 'Google Calendar',
              completed: true,
              required: false
            });
          }

          // Intake form — recommended. Opt-in feature, so an absent settings row
          // is a legitimate choice rather than an unfinished step.
          if (!s.scheduling?.intake_enabled) {
            computedSetupItems.push({
              id: 'intake',
              title: language === 'he' ? 'הגדר טופס קליטה' : 'Set up intake form',
              description: language === 'he' ? 'אסוף פרטים מהלקוח לפני הפגישה' : 'Collect client details before the session',
              completed: false,
              action: 'setup_intake',
              required: false
            });
          } else {
            computedSetupItems.push({
              id: 'intake',
              title: language === 'he' ? 'טופס קליטה פעיל' : 'Intake form active',
              description: '',
              completed: true,
              required: false
            });
          }

          setSetupItems(computedSetupItems);

          // Compute funnel stats for LiveDashboard (legacy fallback)
          setFunnelStats({
            found: s.website?.visitors_30d || 0,
            touch: s.crm?.total_contacts || 0,
            booked: s.scheduling?.bookings_count || 0,
            paid: s.payments?.paid_count || 0,
            paidAmount: s.payments?.revenue_this_week || 0
          });

          // Set real CRM pipeline stages (preferred over funnelStats)
          if (s.crm?.pipeline_stages && Array.isArray(s.crm.pipeline_stages)) {
            setPipelineStages(s.crm.pipeline_stages);
          }

          // Compute milestone data
          setMilestoneData({
            firstVisitor: s.website?.first_visitor_date ? {
              date: s.website.first_visitor_date,
              source: s.website.first_visitor_source || 'direct'
            } : undefined,
            firstEnquiry: s.crm?.first_contact_date ? {
              date: s.crm.first_contact_date,
              responseTime: s.crm.first_response_time || '—'
            } : undefined,
            // Note: first_booking_amount removed - total_amount no longer on scheduling_bookings
            firstBooking: s.scheduling?.first_booking_date ? {
              date: s.scheduling.first_booking_date,
              amount: 0  // Amount no longer available from booking table
            } : undefined
          });
        }
      }

      setLoading(false);
    } catch {
      // Error handled silently - dashboard shows default state
      setLoading(false);
    }
  };

  // Generate weekly bars for chart based on this week and last week revenue
  function generateWeeklyBars(thisWeek: number, lastWeek: number): number[] {
    if (thisWeek === 0 && lastWeek === 0) return [0, 0, 0, 0, 0, 0];
    // Show a simple progression: last week average in first 3 bars, this week average in last 3 bars
    const lastWeekAvg = lastWeek / 3;
    const thisWeekAvg = thisWeek / 3;
    return [
      Math.floor(lastWeekAvg * 0.8),
      Math.floor(lastWeekAvg),
      Math.floor(lastWeekAvg * 1.1),
      Math.floor(thisWeekAvg * 0.9),
      Math.floor(thisWeekAvg),
      Math.floor(thisWeekAvg * 1.1)
    ];
  }

  // Calculate percentage change between this week and last week
  function calculateChangePercent(thisWeek: number, lastWeek: number): number {
    if (lastWeek === 0) return thisWeek > 0 ? 100 : 0;
    return Math.round(((thisWeek - lastWeek) / lastWeek) * 100);
  }

  // Handle chat actions (open dialogs, etc.)
  const handleChatAction = useCallback(async (action: DialogAction) => {
    switch (action.type) {
      case 'open_service_dialog':
      case 'open_service_modal':
        // Open ConfigurationDialog with services tab only
        setConfigInitialTab('services');
        setConfigVisibleTabs(['services']); // Only show Services tab
        if (action.mode === 'edit' && action.serviceId) {
          // Edit mode - pass service ID to ConfigurationDialog
          setConfigServiceToEdit(action.serviceId);
          setConfigServicePrefill(action.prefill);
        } else {
          // Create mode - auto-start new row with prefill data
          setConfigServiceToEdit(undefined);
          setConfigServicePrefill(action.prefill);
        }
        setIsConfigOpen(true);
        break;

      case 'open_contact_dialog':
        if (action.mode === 'edit' && action.contactId) {
          // Fetch the contact data to edit
          try {
            const response = await fetch(`/api/crm/contacts/${action.contactId}`);
            if (response.ok) {
              const data = await response.json();
              if (data.success && data.contact) {
                setEditingContact(data.contact);
                setContactPrefill(action.prefill);
                setIsContactModalOpen(true);
              }
            }
          } catch {
            // Error fetching contact
          }
        } else {
          // Create mode - use prefill
          setEditingContact(undefined);
          setContactPrefill(action.prefill);
          setIsContactModalOpen(true);
        }
        break;

      case 'open_availability_dialog':
        // Open ConfigurationDialog with availability tab only (hide other tabs)
        setConfigInitialTab('availability');
        setConfigVisibleTabs(['availability']); // Only show Availability tab
        setConfigAvailabilityDays(action.days); // Pre-select days if provided
        setIsConfigOpen(true);
        break;

      case 'open_booking_dialog':
        // Open scheduling dialog
        setSchedulingInitialDate(undefined);
        setSchedulingInitialBookingId(undefined);
        setIsSchedulingDialogOpen(true);
        break;

      case 'open_booking_calendar':
        // Open scheduling dialog, optionally focused on a date
        setSchedulingInitialDate(action.date);
        setSchedulingInitialBookingId(undefined);
        setIsSchedulingDialogOpen(true);
        break;

      case 'open_booking':
        // Open scheduling dialog focused on a specific booking
        setSchedulingInitialDate(undefined);
        setSchedulingInitialBookingId(action.bookingId);
        setIsSchedulingDialogOpen(true);
        break;

      case 'show_booking_list':
        // Show bookings as clickable cards in chat
        if (chatPanelRef.current && action.bookings) {
          const bookingListHtml = action.bookings.map((b: { id: string; client_name: string; service_name: string; start_time: string; status: string }) => {
            const date = new Date(b.start_time);
            const dateStr = date.toLocaleDateString(language === 'he' ? 'he-IL' : 'en-US', { weekday: 'short', month: 'short', day: 'numeric' });
            const timeStr = date.toLocaleTimeString(language === 'he' ? 'he-IL' : 'en-US', { hour: '2-digit', minute: '2-digit' });
            return `<button onclick="window.viewBooking('${b.id}')" class="booking-list-item" style="display: block; width: 100%; text-align: start; padding: 10px 12px; margin: 6px 0; background: var(--v2-bg); border: 1px solid var(--v2-border); border-radius: 10px; cursor: pointer; transition: all 0.15s;" onmouseover="this.style.borderColor='#F97316'" onmouseout="this.style.borderColor='var(--v2-border)'"><b style="display: block; font-size: 14px; color: var(--v2-text-primary);">${b.client_name}</b><span style="font-size: 12px; color: var(--v2-text-muted);">${b.service_name} · ${dateStr} ${timeStr}</span></button>`;
          }).join('');
          chatPanelRef.current.addMessage('ai', bookingListHtml);
        }
        break;

      case 'confirm_booking_cancel':
        // Show confirmation dialog for booking cancellation
        if (chatPanelRef.current) {
          const date = new Date(action.startTime);
          const dateStr = date.toLocaleDateString(language === 'he' ? 'he-IL' : 'en-US', { weekday: 'long', month: 'short', day: 'numeric' });
          const confirmHtml = language === 'he'
            ? `לבטל את הפגישה עם <b>${action.clientName}</b> ב${dateStr}?`
            : `Cancel booking with <b>${action.clientName}</b> on ${dateStr}?`;
          chatPanelRef.current.addMessage('ai', confirmHtml);
          chatPanelRef.current.setSuggestions([
            language === 'he' ? '✓ כן, בטל' : '✓ Yes, cancel',
            language === 'he' ? 'לא, השאר' : 'No, keep it',
          ]);
          // Store pending cancellation for confirmation handler
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (window as any).pendingBookingCancel = action.bookingId;
        }
        break;

      case 'open_invoice_dialog':
        router.push('/business-os/reports?tab=invoices&action=create');
        break;

      case 'show_service_list':
        // Show services as clickable cards in chat
        if (chatPanelRef.current && action.services) {
          const serviceListHtml = action.services.map((s: { id: string; name: string; price: number; currency: string; duration: number }) => {
            const currencySymbol = s.currency === 'ILS' ? '₪' : s.currency === 'EUR' ? '€' : s.currency === 'GBP' ? '£' : '$';
            const priceText = s.price > 0 ? `${currencySymbol}${s.price}` : (language === 'he' ? 'חינם' : 'Free');
            return `<button onclick="window.editService('${s.id}')" class="service-list-item" style="display: block; width: 100%; text-align: start; padding: 10px 12px; margin: 6px 0; background: var(--v2-bg); border: 1px solid var(--v2-border); border-radius: 10px; cursor: pointer; transition: all 0.15s;" onmouseover="this.style.borderColor='#F97316'" onmouseout="this.style.borderColor='var(--v2-border)'"><b style="display: block; font-size: 14px; color: var(--v2-text-primary);">${s.name}</b><span style="font-size: 12px; color: var(--v2-text-muted);">${s.duration} ${language === 'he' ? 'דק׳' : 'min'} · ${priceText}</span></button>`;
          }).join('');
          chatPanelRef.current.addMessage('ai', serviceListHtml);
        }
        break;

      case 'confirm_service_update':
        // Show confirmation in chat for direct update
        setPendingServiceUpdate({
          serviceId: action.serviceId,
          serviceName: action.serviceName,
          updates: action.updates,
          updateDescription: action.updateDescription,
        });
        if (chatPanelRef.current) {
          const confirmHtml = language === 'he'
            ? `לעדכן את <b>${action.serviceName}</b>? ${action.updateDescription}`
            : `Update <b>${action.serviceName}</b>? ${action.updateDescription}`;
          chatPanelRef.current.addMessage('ai', confirmHtml);
          chatPanelRef.current.setSuggestions([
            language === 'he' ? '✓ כן, עדכן' : '✓ Yes, update',
            language === 'he' ? 'לא, בטל' : 'No, cancel',
          ]);
        }
        break;

      case 'show_delete_confirmation':
        // Show delete confirmation dialog (popup)
        setDeleteConfirmation({
          entityType: action.entityType,
          entityId: action.entityId,
          entityName: action.entityName,
        });
        break;
    }
  }, [router, language]);

  // Publish the pending draft service
  const publishDraftService = useCallback(async () => {
    if (!pendingDraftService) return;

    try {
      // Find the draft service and publish it
      const response = await fetch('/api/scheduling/services');
      const data = await response.json();
      if (data.success && data.services) {
        // Find the draft service by name
        const draftService = data.services.find(
          (s: { service_name: string; status: string }) =>
            s.service_name === pendingDraftService.name && s.status === 'draft'
        );

        if (draftService) {
          // Publish it
          const publishResponse = await fetch(`/api/scheduling/services/${draftService.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'active', is_active: true })
          });

          if (publishResponse.ok) {
            // Add success message
            if (chatPanelRef.current) {
              const message = language === 'he'
                ? `מעולה! <b>${pendingDraftService.name}</b> פורסם והוא זמין עכשיו להזמנות.`
                : `Done! <b>${pendingDraftService.name}</b> is now live and available for bookings.`;
              chatPanelRef.current.addMessage('success', message);
            }

            setPendingDraftService(null);
            fetchDashboardData(); // Refresh stats
          }
        }
      }
    } catch {
      // Error handled silently
    }
  }, [pendingDraftService, language]);

  // Handle editing a service from the inline list - open ConfigurationDialog with service selected
  const handleEditService = useCallback((serviceId: string) => {
    setConfigInitialTab('services');
    setConfigVisibleTabs(['services']); // Only show Services tab
    setConfigServiceToEdit(serviceId);
    setConfigServicePrefill(undefined);
    setIsConfigOpen(true);
  }, []);

  // Handle quick setup clicks from OperationalStatusCard (services, availability, payments, etc.)
  const handleQuickSetupClick = useCallback((stepId: string) => {
    // Map step IDs to config tabs
    const tabMapping: Record<string, 'services' | 'availability' | 'intake' | 'payments'> = {
      services: 'services',
      availability: 'availability',
      payments: 'payments',
      intake: 'intake',
    };

    const tab = tabMapping[stepId];
    if (tab) {
      setConfigInitialTab(tab);
      setConfigVisibleTabs([tab]); // Only show the relevant tab
      setConfigServiceToEdit(undefined);
      setConfigServicePrefill(undefined);
      setConfigAvailabilityDays(undefined);
      setIsConfigOpen(true);
    } else if (stepId === 'calendar') {
      // CalendarSyncSettings is rendered at the top of the availability tab.
      setConfigInitialTab('availability');
      setConfigVisibleTabs(['availability']);
      setConfigServiceToEdit(undefined);
      setConfigServicePrefill(undefined);
      setConfigAvailabilityDays(undefined);
      setIsConfigOpen(true);
    } else if (stepId === 'website') {
      // Navigate to website builder
      router.push('/business-os/website');
    }
  }, [router]);

  // Handle confirming a direct service update
  const confirmServiceUpdate = useCallback(async () => {
    if (!pendingServiceUpdate) return;

    try {
      const response = await fetch(`/api/scheduling/services/${pendingServiceUpdate.serviceId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pendingServiceUpdate.updates),
      });

      if (response.ok) {
        // Show success message
        if (chatPanelRef.current) {
          const message = language === 'he'
            ? `עודכן <b>${pendingServiceUpdate.serviceName}</b>: ${pendingServiceUpdate.updateDescription}`
            : `Updated <b>${pendingServiceUpdate.serviceName}</b>: ${pendingServiceUpdate.updateDescription}`;
          chatPanelRef.current.addMessage('success', message);
          chatPanelRef.current.setSuggestions([
            language === 'he' ? 'שנה שירות אחר' : 'Change another service',
            language === 'he' ? 'הצג שירותים' : 'View services',
          ]);
        }
        fetchDashboardData(); // Refresh stats
      } else {
        throw new Error('Failed to update service');
      }
    } catch {
      if (chatPanelRef.current) {
        const errorMsg = language === 'he'
          ? 'לא הצלחתי לעדכן את השירות. נסה שוב.'
          : "Couldn't update the service. Please try again.";
        chatPanelRef.current.addMessage('ai', errorMsg);
      }
    } finally {
      setPendingServiceUpdate(null);
    }
  }, [pendingServiceUpdate, language]);

  // Cancel pending service update
  const cancelServiceUpdate = useCallback(() => {
    setPendingServiceUpdate(null);
    if (chatPanelRef.current) {
      const message = language === 'he' ? 'בסדר, לא עודכן.' : 'Okay, no changes made.';
      chatPanelRef.current.addMessage('ai', message);
    }
  }, [language]);

  // Handle confirming entity deletion
  const confirmDelete = useCallback(async () => {
    if (!deleteConfirmation) return;

    setIsDeleting(true);
    try {
      let endpoint = '';
      switch (deleteConfirmation.entityType) {
        case 'service':
          endpoint = `/api/scheduling/services/${deleteConfirmation.entityId}`;
          break;
        case 'contact':
          endpoint = `/api/crm/contacts/${deleteConfirmation.entityId}`;
          break;
        case 'booking':
          endpoint = `/api/scheduling/bookings/${deleteConfirmation.entityId}`;
          break;
        case 'task':
          endpoint = `/api/crm/tasks/${deleteConfirmation.entityId}`;
          break;
        case 'invoice':
          endpoint = `/api/payments/invoices/${deleteConfirmation.entityId}`;
          break;
      }

      const response = await fetch(endpoint, { method: 'DELETE' });

      if (response.ok) {
        // Show success message
        if (chatPanelRef.current) {
          const message = language === 'he'
            ? `<b>${deleteConfirmation.entityName}</b> נמחק בהצלחה.`
            : `<b>${deleteConfirmation.entityName}</b> has been deleted.`;
          chatPanelRef.current.addMessage('success', message);
        }
        fetchDashboardData(); // Refresh stats
      } else {
        throw new Error('Failed to delete');
      }
    } catch {
      if (chatPanelRef.current) {
        const errorMsg = language === 'he'
          ? 'לא הצלחתי למחוק. נסה שוב.'
          : "Couldn't delete. Please try again.";
        chatPanelRef.current.addMessage('ai', errorMsg);
      }
    } finally {
      setIsDeleting(false);
      setDeleteConfirmation(null);
    }
  }, [deleteConfirmation, language]);

  // Cancel entity deletion
  const cancelDelete = useCallback(() => {
    setDeleteConfirmation(null);
    if (chatPanelRef.current) {
      const message = language === 'he' ? 'בוטל.' : 'Cancelled.';
      chatPanelRef.current.addMessage('ai', message);
    }
  }, [language]);

  // Handle viewing a booking from inline list
  const handleViewBooking = useCallback((bookingId: string) => {
    setSchedulingInitialDate(undefined);
    setSchedulingInitialBookingId(bookingId);
    setIsSchedulingDialogOpen(true);
  }, []);

  // Expose functions to window for inline buttons
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).publishDraftService = publishDraftService;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).editService = handleEditService;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).confirmServiceUpdate = confirmServiceUpdate;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).cancelServiceUpdate = cancelServiceUpdate;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).viewBooking = handleViewBooking;
    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).publishDraftService;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).editService;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).confirmServiceUpdate;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).cancelServiceUpdate;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).viewBooking;
    };
  }, [publishDraftService, handleEditService, confirmServiceUpdate, cancelServiceUpdate, handleViewBooking]);

  // Handle service created from chat (before publish)
  const handleServiceCreated = useCallback((service: { name: string; duration: number; price: number; currency: string }) => {
    setPendingDraftService(service);

    // Format currency symbol
    const currencySymbol = service.currency === 'ILS' ? '₪' : service.currency === 'EUR' ? '€' : service.currency === 'GBP' ? '£' : '$';
    const priceText = service.price > 0 ? `${currencySymbol}${service.price}` : (language === 'he' ? 'חינם' : 'Free');

    // Add success message to chat based on language
    if (chatPanelRef.current) {
      const message = language === 'he'
        ? `נוסף <b>${service.name}</b> (${service.duration} דק׳ · ${priceText}). השירות נשמר כטיוטה — לחץ על הכפתור למטה לפרסום.`
        : `Added <b>${service.name}</b> (${service.duration} min · ${priceText}). Saved as draft — tap the button below to publish.`;

      chatPanelRef.current.addMessage('ai', message);

      // Add publish suggestion (marked as primary) and add another option
      const publishSuggestion = language === 'he' ? '✓ פרסם שירות' : '✓ Publish service';
      const addAnother = language === 'he' ? 'הוסף שירות נוסף' : 'Add another service';
      chatPanelRef.current.setSuggestions([publishSuggestion, addAnother]);
    }
  }, [language]);

  // Handle config dialog close and refresh
  const handleConfigClose = useCallback(() => {
    setIsConfigOpen(false);
    setConfigServiceToEdit(undefined);
    setConfigVisibleTabs(undefined); // Reset to show all tabs
    setConfigServicePrefill(undefined); // Reset prefill
    setConfigAvailabilityDays(undefined); // Reset availability days
    // Refresh dashboard stats
    fetchDashboardData();
  }, []);

  // Handle config dialog close with unpublished changes - notify chat
  const handleCloseWithUnpublished = useCallback((serviceName: string) => {
    // Send message to chat about unpublished service
    const message = language === 'he'
      ? `"${serviceName}" נשמר כטיוטה. תוכל לפרסם אותו מאוחר יותר מההגדרות.`
      : language === 'es'
      ? `"${serviceName}" guardado como borrador. Puedes publicarlo más tarde desde la configuración.`
      : `"${serviceName}" saved as draft. You can publish it later from settings.`;

    chatPanelRef.current?.addMessage('ai', message);
  }, [language]);

  // Handle service published from within the dialog - clear pending draft and notify chat
  const handleServicePublishedFromDialog = useCallback((serviceName: string) => {
    // Clear pending draft if it matches the published service
    if (pendingDraftService && pendingDraftService.name === serviceName) {
      setPendingDraftService(null);

      // Add success message to chat
      const message = language === 'he'
        ? `מעולה! <b>${serviceName}</b> פורסם והוא זמין עכשיו להזמנות.`
        : language === 'es'
        ? `¡Listo! <b>${serviceName}</b> está publicado y disponible para reservas.`
        : `Done! <b>${serviceName}</b> is now live and available for bookings.`;

      chatPanelRef.current?.addMessage('success', message);

      // Clear the publish suggestion
      chatPanelRef.current?.setSuggestions([]);
    }

    // Refresh dashboard stats
    fetchDashboardData();
  }, [pendingDraftService, language]);

  // Handle contact modal close and refresh
  const handleContactUpdated = useCallback(() => {
    setIsContactModalOpen(false);
    setEditingContact(undefined);
    setContactPrefill(undefined);
    // Refresh dashboard stats
    fetchDashboardData();
  }, []);

  // Handle website publish from dashboard
  const handlePublishWebsite = useCallback(async () => {
    if (!draftPageId || publishingWebsite) return;

    try {
      setPublishingWebsite(true);
      const response = await fetch(`/api/website/pages/${draftPageId}/publish`, {
        method: 'POST'
      });
      const data = await response.json();

      if (data.success) {
        // Refresh dashboard to update setup items
        fetchDashboardData();
        // Show success message in chat if available
        if (chatPanelRef.current) {
          const message = language === 'he'
            ? 'האתר שלך פורסם בהצלחה! 🎉'
            : 'Your website is now live! 🎉';
          chatPanelRef.current.addMessage('success', message);
        }
      } else {
        // Show error in chat
        if (chatPanelRef.current) {
          const message = language === 'he'
            ? 'שגיאה בפרסום האתר. נסה שוב.'
            : 'Failed to publish website. Please try again.';
          chatPanelRef.current.addMessage('ai', message);
        }
      }
    } catch (error) {
      console.error('Failed to publish website:', error);
      if (chatPanelRef.current) {
        const message = language === 'he'
          ? 'שגיאה בפרסום האתר. נסה שוב.'
          : 'Failed to publish website. Please try again.';
        chatPanelRef.current.addMessage('ai', message);
      }
    } finally {
      setPublishingWebsite(false);
    }
  }, [draftPageId, publishingWebsite, language]);

  const handleCapabilityClick = (type: 'website' | 'people' | 'reports' | 'config') => {
    switch (type) {
      case 'website':
        router.push('/business-os/website');
        break;
      case 'people':
        router.push('/business-os/crm');
        break;
      case 'reports':
        router.push('/business-os/reports');
        break;
      case 'config':
        // Open config dialog with all tabs visible (from capability card)
        setConfigInitialTab('services');
        setConfigVisibleTabs(undefined); // Show all tabs
        setConfigServiceToEdit(undefined);
        setConfigServicePrefill(undefined);
        setIsConfigOpen(true);
        break;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[var(--v2-bg)]">
        <div className="text-center space-y-4">
          <div
            className="w-16 h-16 rounded-full animate-spin mx-auto border-4 border-[var(--v2-border)] border-t-orange-500"
          />
          <p className="text-[var(--v2-text-secondary)] font-medium">
            {t('loading.dashboard') || 'Loading your dashboard...'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen bg-[var(--v2-bg)]"
    >
      {/* Header */}
      <BusinessOSHeader />

      {/* Main Content */}
      <div className="container mx-auto px-3 sm:px-4 lg:px-6 py-4 sm:py-5 lg:py-6 max-w-7xl">

        {/* Live Dashboard - Mockup-based Insight Section */}
        <div className="relative">
          <LiveDashboard
            userName={myDay.userName}
            greeting={myDay.greeting}
            setupItems={setupItems}
            funnelStats={funnelStats}
            pipelineStages={pipelineStages}
            milestoneData={milestoneData}
            onConfigureClick={handleQuickSetupClick}
            collapsed={isInsightCollapsed}
            onToggleCollapse={() => setIsInsightCollapsed(!isInsightCollapsed)}
            onAction={(action) => {
              // Handle actions from LiveDashboard
              if (action === 'publish_website') {
                // Publish website directly if we have a draft page ID
                if (draftPageId) {
                  handlePublishWebsite();
                } else {
                  // Fallback to website page if no draft page ID
                  router.push('/business-os/website');
                }
              } else if (action === 'add_services') {
                handleQuickSetupClick('services');
              } else if (action === 'set_hours') {
                handleQuickSetupClick('availability');
              } else if (action === 'connect_payments') {
                handleQuickSetupClick('payments');
              } else if (action === 'sync_calendar') {
                handleQuickSetupClick('calendar');
              } else if (action === 'setup_intake') {
                handleQuickSetupClick('intake');
              } else if (action === 'view_funnel') {
                // Navigate to CRM page to view the funnel/pipeline
                router.push('/business-os/crm');
              }
            }}
          />
        </div>

        {/* Row 3: Chat Panel + Capability Cards (hidden by default) */}
        <div
          className="mt-5 grid dashboard-main-grid"
          style={{
            gridTemplateColumns: showCapabilityCards ? '390px 1fr' : '1fr',
            gap: '20px',
            alignItems: 'start'
          }}
        >
          {/* Left: Chat Command Panel */}
          <ChatCommandPanel
            ref={chatPanelRef}
            onAction={handleChatAction}
            onPublishDraft={pendingDraftService ? publishDraftService : undefined}
            onConfirmUpdate={pendingServiceUpdate ? confirmServiceUpdate : undefined}
            onCancelUpdate={pendingServiceUpdate ? cancelServiceUpdate : undefined}
            expanded={isMyDayCollapsed}
          />

          {/* Right: 4 Capability Cards (2x2 grid) - hidden by default */}
          {showCapabilityCards && (
            <div
              className="grid transition-all duration-300 capability-cards-grid"
              style={{
                gridTemplateColumns: '1fr 1fr',
                gridTemplateRows: '1fr 1fr',
                gap: '20px',
                height: isMyDayCollapsed ? '640px' : '460px'
              }}
            >
              {/* Website Card - only show if capability active */}
              {activeCapabilities.has('website') && (
                <CapabilityCard
                  type="website"
                  stats={stats.website}
                  onClick={() => handleCapabilityClick('website')}
                />
              )}

              {/* CRM Card - only show if capability active */}
              {activeCapabilities.has('crm') && (
                <CapabilityCard
                  type="people"
                  stats={stats.people}
                  onClick={() => handleCapabilityClick('people')}
                />
              )}

              {/* Reports Card - only show if capability active */}
              {activeCapabilities.has('reports') && (
                <CapabilityCard
                  type="reports"
                  stats={stats.reports}
                  onClick={() => handleCapabilityClick('reports')}
                />
              )}

              {/* Config Card - always show (manages capabilities) */}
              <CapabilityCard
                type="config"
                stats={stats.config}
                onClick={() => handleCapabilityClick('config')}
              />
            </div>
          )}
        </div>

        {/* Show/Hide Capability Cards Button */}
        <div className="flex justify-center mt-4">
          <button
            onClick={() => setShowCapabilityCards(!showCapabilityCards)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] bg-[var(--v2-bg)] border border-[var(--v2-border)] rounded-full transition-all hover:border-orange-300"
          >
            {showCapabilityCards ? (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="18 15 12 9 6 15"></polyline>
                </svg>
                {t('dashboard.hideCards') || 'Hide cards'}
              </>
            ) : (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
                {t('dashboard.showCards') || 'Show quick access cards'}
              </>
            )}
          </button>
        </div>

      </div>

      {/* Configuration Dialog (for services, availability, payments) */}
      <ConfigurationDialog
        isOpen={isConfigOpen}
        onClose={handleConfigClose}
        initialTab={configInitialTab}
        serviceToEdit={configServiceToEdit}
        visibleTabs={configVisibleTabs}
        servicePrefill={configServicePrefill}
        availabilityDaysToAdd={configAvailabilityDays}
        onServiceCreated={configServicePrefill ? handleServiceCreated : undefined}
        onCloseWithUnpublished={handleCloseWithUnpublished}
        onServicePublished={handleServicePublishedFromDialog}
      />

      {/* Contact Modal (for chat-triggered contact creation/editing) */}
      <CRMContactModal
        isOpen={isContactModalOpen}
        onClose={() => {
          setIsContactModalOpen(false);
          setEditingContact(undefined);
          setContactPrefill(undefined);
        }}
        onContactUpdated={handleContactUpdated}
        contact={editingContact}
        stages={pipelineStages}
        prefill={contactPrefill}
      />

      {/* Scheduling Dialog (popup calendar from chat) */}
      <SchedulingDialog
        isOpen={isSchedulingDialogOpen}
        onClose={() => {
          setIsSchedulingDialogOpen(false);
          setSchedulingInitialDate(undefined);
          setSchedulingInitialBookingId(undefined);
        }}
        initialDate={schedulingInitialDate}
        initialBookingId={schedulingInitialBookingId}
        onBookingCreated={() => {
          // Refresh dashboard data when booking created
          fetchDashboardData();
        }}
        onBookingUpdated={() => {
          // Refresh dashboard data when booking updated
          fetchDashboardData();
        }}
      />

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteConfirmation} onOpenChange={(open) => !open && cancelDelete()}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {language === 'he' ? 'מחיקת ' : 'Delete '}
              {deleteConfirmation?.entityType === 'service' && (language === 'he' ? 'שירות' : 'Service')}
              {deleteConfirmation?.entityType === 'contact' && (language === 'he' ? 'איש קשר' : 'Contact')}
              {deleteConfirmation?.entityType === 'booking' && (language === 'he' ? 'פגישה' : 'Booking')}
              {deleteConfirmation?.entityType === 'task' && (language === 'he' ? 'משימה' : 'Task')}
              {deleteConfirmation?.entityType === 'invoice' && (language === 'he' ? 'חשבונית' : 'Invoice')}
            </DialogTitle>
            <DialogDescription>
              {language === 'he' ? (
                <>האם אתה בטוח שברצונך למחוק את <b className="text-[var(--v2-text-primary)]">{deleteConfirmation?.entityName}</b>? פעולה זו לא ניתנת לביטול.</>
              ) : (
                <>Are you sure you want to delete <b className="text-[var(--v2-text-primary)]">{deleteConfirmation?.entityName}</b>? This action cannot be undone.</>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={cancelDelete}
              disabled={isDeleting}
            >
              {language === 'he' ? 'ביטול' : 'Cancel'}
            </Button>
            <Button
              variant="default"
              onClick={confirmDelete}
              disabled={isDeleting}
              className="bg-red-500 hover:bg-red-600 text-white border-0"
            >
              {isDeleting ? (
                language === 'he' ? 'מוחק...' : 'Deleting...'
              ) : (
                language === 'he' ? 'מחק' : 'Delete'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Space Grotesk font */}
      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap');

        /* Animation keyframes */
        @keyframes fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes slide-in-from-bottom-2 {
          from { transform: translateY(8px); }
          to { transform: translateY(0); }
        }

        .animate-in {
          animation: fade-in 0.3s ease-out, slide-in-from-bottom-2 0.3s ease-out;
        }

        /* Responsive adjustments - mobile-first */

        /* Tablet and below - stack chat and cards vertically */
        @media (max-width: 1024px) {
          .dashboard-main-grid {
            grid-template-columns: 1fr !important;
            gap: 16px !important;
          }

          .capability-cards-grid {
            height: auto !important;
            grid-template-rows: auto auto !important;
          }
        }

        /* Mobile - single column capability cards */
        @media (max-width: 640px) {
          .capability-cards-grid {
            grid-template-columns: 1fr !important;
            grid-template-rows: auto !important;
            gap: 12px !important;
          }
        }

        /* Small mobile - reduce padding */
        @media (max-width: 480px) {
          .container {
            padding-left: 12px !important;
            padding-right: 12px !important;
          }
        }
      `}</style>
    </div>
  );
}

export default function BusinessOSPage() {
  return <BusinessOSContent />;
}
