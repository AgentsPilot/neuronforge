'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/UserProvider';
import { BusinessOSHeader } from '@/components/business-os/BusinessOSHeader';
import { StoryBeat, SummaryData } from '@/components/business-os/MyDaySection';
import { MyDayInsightSection } from '@/components/business-os/insight';
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
  const [configInitialTab, setConfigInitialTab] = useState<'services' | 'availability' | 'payments'>('services');
  const [configVisibleTabs, setConfigVisibleTabs] = useState<('services' | 'availability' | 'payments')[] | undefined>(undefined);
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

  // My Day data
  const [myDay, setMyDay] = useState<MyDayData>({
    userName: 'there',
    greeting: 'morning',
    summaryData: { key: 'myday.summary.default' },
    storyBeats: []
  });

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
      previousWeek: 0
    },
    config: {
      servicesCount: 0,
      servicesActive: false,
      hoursSet: false,
      openDaysCount: 0,
      paymentsConnected: false,
      paymentsProvider: 'Stripe',
      automationsCount: 0,
      calendarSynced: false,
      calendarProvider: null
    }
  });

  useEffect(() => {
    if (user) {
      fetchDashboardData();
    }
  }, [user]);

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
            reports: {
              weeklyRevenue: s.payments?.revenue_30d || 0,
              weeklyBars: generateWeeklyBars(s.payments?.revenue_30d || 0),
              changePercent: 18, // Placeholder
              previousWeek: Math.floor((s.payments?.revenue_30d || 0) * 0.85)
            },
            config: {
              servicesCount: s.scheduling?.active_services_count || 0,
              servicesActive: (s.scheduling?.active_services_count || 0) > 0,
              hoursSet: (s.scheduling?.open_days_count || 0) > 0,
              openDaysCount: s.scheduling?.open_days_count || 0,
              paymentsConnected: s.scheduling?.stripe_connected || false,
              paymentsProvider: 'Stripe',
              automationsCount: s.automation_engine?.workflows_count || 0,
              calendarSynced: s.scheduling?.calendar_synced || false,
              calendarProvider: s.scheduling?.calendar_provider || null
            }
          });
        }
      }

      setLoading(false);
    } catch {
      // Error handled silently - dashboard shows default state
      setLoading(false);
    }
  };

  // Generate mock weekly bars for chart
  function generateWeeklyBars(total: number): number[] {
    if (total === 0) return [0, 0, 0, 0, 0, 0];
    const avg = total / 6;
    return [
      Math.floor(avg * 0.6),
      Math.floor(avg * 0.8),
      Math.floor(avg * 0.7),
      Math.floor(avg * 1.1),
      Math.floor(avg * 0.9),
      Math.floor(avg * 1.5)
    ];
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
        router.push('/business-os/payments?action=create');
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
            className="w-16 h-16 rounded-full animate-spin mx-auto"
            style={{
              border: '4px solid transparent',
              borderTopColor: '#F97316',
              background: 'linear-gradient(var(--v2-bg), var(--v2-bg)) padding-box, linear-gradient(120deg, #FFB454, #F97316, #EA580C) border-box'
            }}
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
      className="min-h-screen"
      style={{
        background: 'radial-gradient(70% 45% at 12% -5%, #FFE9D6 0%, transparent 50%), radial-gradient(60% 40% at 100% 0%, #FFF0E0 0%, transparent 45%), var(--v2-bg)'
      }}
    >
      {/* Header */}
      <BusinessOSHeader />

      {/* Main Content */}
      <div className="container mx-auto px-3 sm:px-4 lg:px-6 py-4 sm:py-5 lg:py-6 max-w-7xl">

        {/* My Day Section with Insight Integration */}
        <MyDayInsightSection
          userName={myDay.userName}
          greeting={myDay.greeting}
          loading={loading}
          isFullyCollapsed={isMyDayCollapsed}
          onFullyCollapsedChange={setIsMyDayCollapsed}
        />

        {/* Row 3: Chat Panel + Capability Cards - matches mockup exactly */}
        <div
          className="mt-5 grid dashboard-main-grid"
          style={{
            gridTemplateColumns: '390px 1fr',
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

          {/* Right: 4 Capability Cards (2x2 grid) - matches mockup: equal height cards */}
          <div
            className="grid transition-all duration-300 capability-cards-grid"
            style={{
              gridTemplateColumns: '1fr 1fr',
              gridTemplateRows: '1fr 1fr',
              gap: '20px',
              height: isMyDayCollapsed ? '640px' : '460px'
            }}
          >
            <CapabilityCard
              type="website"
              stats={stats.website}
              onClick={() => handleCapabilityClick('website')}
            />
            <CapabilityCard
              type="people"
              stats={stats.people}
              onClick={() => handleCapabilityClick('people')}
            />
            <CapabilityCard
              type="reports"
              stats={stats.reports}
              onClick={() => handleCapabilityClick('reports')}
            />
            <CapabilityCard
              type="config"
              stats={stats.config}
              onClick={() => handleCapabilityClick('config')}
            />
          </div>
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
