'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/UserProvider';
import { StoryBeat, SummaryData } from '@/components/business-os/MyDaySection';
import { LiveDashboard, SetupItem, FunnelStats, MilestoneData, PipelineStage, ChannelPerformance } from '@/components/business-os/insight';
import { shapeFromProfile, UNKNOWN_SHAPE, type BusinessShape } from '@/lib/business-os/setup/setupGraph';
import { ChatCommandPanel, ChatCommandPanelRef } from '@/components/business-os/ChatCommandPanel';
import { ConfigurationDialog } from '@/components/business-os/ConfigurationDialog';
import { CHANNELS_CARD_ID } from '@/components/business-os/insight/ChannelsOverviewCard';
import { CRMContactModal } from '@/components/crm/CRMContactModal';
import { SchedulingDialog } from '@/components/business-os/SchedulingDialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { PAGE_CONTAINER } from '@/lib/business-os/pageContainer';

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
  const [pipelineStages, setPipelineStages] = useState<PipelineStage[]>([]);

  // Scheduling dialog state
  const [isSchedulingDialogOpen, setIsSchedulingDialogOpen] = useState(false);
  const [schedulingInitialDate, setSchedulingInitialDate] = useState<string | undefined>(undefined);
  const [schedulingInitialBookingId, setSchedulingInitialBookingId] = useState<string | undefined>(undefined);

  // My Day section collapsed state - controls expanded height for chat and cards
  const [isMyDayCollapsed, setIsMyDayCollapsed] = useState(false);

  // Insight card collapsed state
  const [isInsightCollapsed, setIsInsightCollapsed] = useState(false);


  // My Day data - use time-based greeting as initial state
  const [myDay, setMyDay] = useState<MyDayData>(() => ({
    userName: '', // Empty until loaded from API
    greeting: getGreetingFromTime(),
    summaryData: { key: 'myday.summary.default' },
    storyBeats: []
  }));


  // LiveDashboard data state
  const [setupItems, setSetupItems] = useState<SetupItem[]>([]);
  /**
   * The three answers from the onboarding chat, read off the same stats call.
   * They decide which steps this business is asked for at all — without them
   * the readiness chain shows a card processor to someone who takes cash.
   */
  const [setupShape, setSetupShape] = useState<BusinessShape>(UNKNOWN_SHAPE);
  const [funnelStats, setFunnelStats] = useState<FunnelStats | undefined>(undefined);
  /**
   * Whether a client can reach this business at all, and by what.
   *
   * `is_reachable` is a live page OR an active smart link — a smart link is the
   * publication for a business that needs no website, so neither is hardcoded
   * as THE way to be live. The dashboard used to infer this from the website
   * setup item and got it wrong for exactly those businesses.
   */
  const [reach, setReach] = useState<{
    isReachable: boolean;
    livePages: boolean;
    smartLinks: boolean;
    /** Live pages split by kind, so a surface can be named rather than guessed. */
    websiteCount: number;
    landingCount: number;
    smartLinkCount: number;
    /** Pages that exist but are not live, so the panel can say "publish". */
    websiteDrafts: number;
    landingDrafts: number;
  } | undefined>(undefined);
  const [milestoneData, setMilestoneData] = useState<MilestoneData | undefined>(undefined);
  const [channelPerformance, setChannelPerformance] = useState<ChannelPerformance | undefined>(undefined);

  const [draftPageId, setDraftPageId] = useState<string | undefined>(undefined);
  const [publishingWebsite, setPublishingWebsite] = useState(false);


  /**
   * Bound to the language, because it writes translated text into state.
   *
   * The setup items are built here — titles, descriptions and the "still
   * needs" line all resolved through `t` at fetch time rather than at render.
   * As a plain function it was captured by callbacks with empty dependency
   * lists, which froze the version from the first render — and on the first
   * render the language context has not resolved the user's language yet, so
   * that version speaks English. Closing a dialog re-ran the frozen copy and
   * two rows of a Hebrew card turned English.
   */
  const fetchDashboardData = useCallback(async () => {
    try {
      // Fetch My Day data, stats, and pipeline stages in parallel
      // Use cache: 'no-store' to ensure fresh data on each load
      const [myDayResponse, statsResponse, stagesResponse, channelsResponse] = await Promise.all([
        fetch('/api/business-os/my-day', { cache: 'no-store' }),
        fetch('/api/business-os/stats', { cache: 'no-store' }),
        fetch('/api/crm/pipeline-stages', { cache: 'no-store' }),
        fetch('/api/business-os/channel-insights?period=month', { cache: 'no-store' })
      ]);

      // Where clients came from. Failing here must degrade only that section,
      // never the whole dashboard.
      //
      // The visit total also feeds the funnel's first station below, so it is
      // held here rather than read off state — setChannelPerformance won't have
      // applied by the time the funnel is built in this same pass.
      let channelVisits: number | undefined;
      try {
        const channelsData = await channelsResponse.json();
        const performance = channelsData.success ? channelsData.data : undefined;
        setChannelPerformance(performance);
        channelVisits = performance?.visits?.total;
      } catch {
        setChannelPerformance(undefined);
      }


      // Pipeline stages come from two endpoints. /stats returns the same rows
      // with a contact count per stage, which the funnel needs; this endpoint
      // returns them without counts. Applying this one immediately would just be
      // overwritten by /stats a few lines below — so it's held as a fallback and
      // only used if the stats call fails, which keeps the contact modal working
      // rather than leaving it with no stages at all.
      let fallbackStages: CRMPipelineStage[] | null = null;
      if (stagesResponse.ok) {
        const stagesData = await stagesResponse.json();
        if (stagesData.success && stagesData.stages) {
          fallbackStages = stagesData.stages;
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
          const s = statsData.stats;
          // What the chat decided, before deciding what to ask for.
          setSetupShape(
            shapeFromProfile({
              payment_mode: s.business_shape?.payment_mode,
              collection_method: s.business_shape?.collection_method,
              online_presence_mode: s.business_shape?.online_presence_mode,
              hasPricedServices: s.business_shape?.has_priced_services ?? null,
              plans: s.business_shape?.plans ?? null,
              // What the services actually say — these decide whether hours, a
              // card processor or bank details are asked for at all.
              activeServices: s.scheduling?.active_services_count ?? 0,
              scheduledServices: s.scheduling?.scheduled_services_count ?? 0,
              onlineServices: s.scheduling?.online_services_count ?? 0,
              invoicedServices: s.scheduling?.invoiced_services_count ?? 0,
            })
          );

          // Compute setup items for LiveDashboard from stats
          const computedSetupItems: SetupItem[] = [];

          // A way for clients to reach and book.
          //
          // Publishing a website is only one of the three: a live landing page
          // or an active smart link sells just as well. A business that took
          // the smart-link route was being told to build a site it does not
          // need, so the step asks whether ANY of them exists.
          //
          // The step is about being reachable, not about wanting a site, so it
          // is pushed whenever nobody can reach them — including for a business
          // that declined a website. Gating it on `wants_website` meant that
          // business got no step at all, and the dashboard, seeing no website
          // item, concluded it was live and started reporting on a funnel with
          // no entrance.
          if (!s.website?.is_reachable) {
            computedSetupItems.push({
              id: 'website',
              title: t('setup.website.todo'),
              description: t('setup.website.why'),
              completed: false,
              // Two different pieces of work behind one step: publishing a
              // site, or creating the link that stands in for one.
              action: s.website?.wants_website ? 'publish_website' : 'create_booking_link'
            });
            // Store draft page ID for quick publish
            if (s.website?.draft_page_id) {
              setDraftPageId(s.website.draft_page_id);
            }
          } else if (s.website?.is_reachable) {
            computedSetupItems.push({
              id: 'website',
              title: t('setup.website.done'),
              description:
                s.website?.url ||
                (s.website?.has_smart_links ? t('setup.website.via_smart_link') : ''),
              completed: true,
              // NOT 'publish_website': that action publishes a draft when one
              // exists, so clicking a node that already reads "clients can
              // reach you" would push a page live that nobody asked to publish.
              action: 'open_website'
            });
          }

          // Services setup
          if ((s.scheduling?.active_services_count || 0) === 0) {
            computedSetupItems.push({
              id: 'services',
              title: t('setup.services.todo'),
              description: t('setup.services.why'),
              completed: false,
              action: 'add_services'
            });
          } else {
            computedSetupItems.push({
              id: 'services',
              title: t('setup.services.done', { count: s.scheduling.active_services_count }),
              description: '',
              completed: true,
              action: 'add_services'
            });
          }

          // Service descriptions — recommended, never blocking.
          //
          // A business with no descriptions can still take a client end to end,
          // so this must not stand between them and trading. It is here because
          // the website's copy for a service is written from its description:
          // without one, the model writes a paragraph guessed from the name.
          //
          // Deliberately absent from the onboarding chat, where speed wins.
          const undescribed = s.scheduling?.services_without_description || [];
          if ((s.scheduling?.active_services_count || 0) > 0) {
            computedSetupItems.push({
              id: 'service_descriptions',
              title: undescribed.length === 0
                ? t('setup.descriptions.done')
                : t('setup.descriptions.todo'),
              description: undescribed.length === 0 ? '' : t('setup.descriptions.why'),
              completed: undescribed.length === 0,
              action: 'add_services',
              required: false,
              // Named, so the card says which services are still silent rather
              // than only that something is.
              missing: undescribed.length > 0 ? undescribed : undefined,
            });
          }

          // Availability setup
          if ((s.scheduling?.open_days_count || 0) === 0) {
            computedSetupItems.push({
              id: 'availability',
              title: t('setup.availability.todo'),
              description: t('setup.availability.why'),
              completed: false,
              action: 'set_hours'
            });
          } else {
            computedSetupItems.push({
              id: 'availability',
              title: t('setup.availability.done', { count: s.scheduling.open_days_count }),
              description: '',
              completed: true,
              action: 'set_hours'
            });
          }

          // Payments setup
          if (!s.scheduling?.stripe_connected) {
            computedSetupItems.push({
              id: 'payments',
              title: t('setup.payments.todo'),
              description: t('setup.payments.why'),
              completed: false,
              action: 'connect_payments'
            });
          } else {
            computedSetupItems.push({
              id: 'payments',
              title: t('setup.payments.done'),
              description: 'Stripe',
              completed: true,
              action: 'connect_payments'
            });
          }

          // Business profile and invoice details. Both recommended, and both
          // configured in user settings rather than the configuration dialog,
          // so their chips route to /business-os/settings instead of opening a
          // tab.
          //
          // Rendered only when the stats call could actually read the fields.
          // An absent block means "not known", which must not be shown as
          // unfinished work — see profile_readiness in the stats route.
          if (s.profile_readiness) {
            /** Field codes into the words the user reads on the form. */
            const fieldLabel = (field: string) => t(`setup.field.${field}`);

            const profileDone = s.profile_readiness.profile_complete;
            computedSetupItems.push({
              id: 'profile',
              title: profileDone ? t('setup.profile.done') : t('setup.profile.todo'),
              description: profileDone ? '' : t('setup.profile.why'),
              completed: profileDone,
              action: 'complete_profile',
              required: false,
              missing: profileDone ? [] : (s.profile_readiness.profile_missing || []).map(fieldLabel),
            });

            const invoicingDone = s.profile_readiness.invoicing_complete;
            computedSetupItems.push({
              id: 'invoicing',
              title: invoicingDone ? t('setup.invoicing.done') : t('setup.invoicing.todo'),
              description: invoicingDone ? '' : t('setup.invoicing.why'),
              completed: invoicingDone,
              action: 'setup_invoicing',
              required: false,
              missing: invoicingDone ? [] : (s.profile_readiness.invoicing_missing || []).map(fieldLabel),
            });
          }

          // Brand look — recommended, not required. Listed here because the theme
          // is not only the website's: the invoice PDF and every transactional
          // email are drawn from the same colours and fonts, so a business that
          // never opens the builder sends the platform's look to its clients.
          {
            const designDone = !!s.website?.theme_customized;
            computedSetupItems.push({
              id: 'design',
              title: designDone ? t('setup.design.done') : t('setup.design.todo'),
              description: designDone ? '' : t('setup.design.why'),
              completed: designDone,
              action: 'customize_design',
              required: false
            });
          }

          // Calendar sync — recommended, not required. Bookings work without it,
          // but nothing stops a client booking over something already in your diary.
          if (!s.scheduling?.calendar_synced) {
            computedSetupItems.push({
              id: 'calendar',
              title: t('setup.calendar.todo'),
              description: t('setup.calendar.why'),
              completed: false,
              action: 'sync_calendar',
              required: false
            });
          } else {
            computedSetupItems.push({
              id: 'calendar',
              title: t('setup.calendar.done'),
              description: s.scheduling?.calendar_provider === 'outlook' ? 'Outlook' : 'Google Calendar',
              completed: true,
              action: 'sync_calendar',
              required: false
            });
          }

          /*
           * Intake form — three states, not two.
           *
           * A written-but-unpublished form is not "not set up": the work is
           * done and one click stands between it and the client. Telling that
           * owner to "set up your intake" sends them looking for a task they
           * have already finished, and the form stays unpublished because
           * nothing ever said that was the thing to do.
           */
          if (s.scheduling?.intake_draft_pending) {
            computedSetupItems.push({
              id: 'intake',
              title: t('setup.intake.review'),
              description: t('setup.intake.review_why'),
              completed: false,
              action: 'setup_intake',
              // Not merely recommended once a form is waiting: an unpublished
              // intake collects nothing, and the business believes it does.
              required: true
            });
          } else if (!s.scheduling?.intake_enabled && !s.scheduling?.intake_published) {
            // Nothing written and nothing published: genuinely not set up.
            computedSetupItems.push({
              id: 'intake',
              title: t('setup.intake.todo'),
              description: t('setup.intake.why'),
              completed: false,
              action: 'setup_intake',
              required: false
            });
          } else {
            computedSetupItems.push({
              id: 'intake',
              title: t('setup.intake.done'),
              description: '',
              completed: true,
              action: 'setup_intake',
              required: false
            });
          }

          // Meta and Google — recommended, and shown to EVERY business.
          //
          // Two steps rather than one, because they are two connections: a Meta
          // login brings Facebook and its linked Instagram together, and a
          // Google one covers Analytics and the business listing. Combined,
          // the row could not say WHICH of the two was still outstanding, which
          // is the only thing it is there to say.
          //
          // Not gated on the onboarding answer, unlike the channels card. That
          // answer said what this business wanted on day one; it is not a
          // permanent ruling. Someone who declined and later starts advertising
          // on Instagram, or opens a Google listing, has to find the way in —
          // and this chain is the one place that lists everything configurable.
          //
          // `s.channels` is already on this response, per platform, so no extra
          // request. A platform is null when it is not connected.
          const metaConnected = Boolean(s.channels?.meta || s.channels?.instagram);
          const googleConnected = Boolean(
            s.channels?.google_analytics || s.channels?.google_business_profile
          );

          computedSetupItems.push({
            id: 'meta_insights',
            title: metaConnected ? t('setup.meta.done') : t('setup.meta.todo'),
            description: metaConnected ? '' : t('setup.meta.why'),
            completed: metaConnected,
            action: 'connect_channels',
            required: false
          });

          computedSetupItems.push({
            id: 'google_analytics',
            title: googleConnected ? t('setup.google.done') : t('setup.google.todo'),
            description: googleConnected ? '' : t('setup.google.why'),
            completed: googleConnected,
            action: 'connect_channels',
            required: false
          });

          setSetupItems(computedSetupItems);

          // Funnel numbers for LiveDashboard.
          //
          // `booked` and `paid` previously read `bookings_count` and
          // `paid_count`, neither of which this endpoint returns — `s` is
          // untyped, so both silently resolved to 0 and every downstream branch
          // that tested them (the "everything's running" verdict, the ops and
          // wins vectors, the booked/paid drawers) was permanently dead.
          //
          // Windows differ by necessity and are labelled as such in the UI:
          // visitors is a rolling 30 days, bookings and revenue follow the
          // stats period (a month by default), and the contact total is
          // all-time because a pipeline is a snapshot of where people are now,
          // not a flow through a window.
          setReach({
            isReachable: !!s.website?.is_reachable,
            livePages: !!s.website?.has_live_pages,
            smartLinks: !!s.website?.has_smart_links,
            websiteCount: s.website?.live_website_count ?? 0,
            landingCount: s.website?.live_landing_count ?? 0,
            smartLinkCount: s.website?.smart_links_count ?? 0,
            websiteDrafts: s.website?.draft_website_count ?? 0,
            landingDrafts: s.website?.draft_landing_count ?? 0,
          });

          setFunnelStats({
            // Everyone who arrived at anything this business owns, not just the
            // main website: landing pages and booking/form pages reached
            // through a smart link count too, and an analytics property
            // supersedes our own page count where it covers the same page.
            // `visitors_30d` alone left the top of the funnel reading 0 for a
            // business whose traffic arrives through any other surface.
            //
            // Falls back to the website figure when the channels call failed,
            // rather than showing nothing.
            found: channelVisits ?? s.website?.visitors_30d ?? 0,
            touch: s.crm?.total_contacts || 0,
            booked: s.scheduling?.bookings_30d || 0,
            // Payments received: card transactions plus invoices settled
            // outside one. Both are counted over the same period as the money.
            paid: (s.payments?.successful_transactions_30d || 0) + (s.payments?.invoices_paid_30d || 0),
            // Was revenue_this_week, which put a 7-day figure beside a 30-day
            // visitor count in the same row of the same card.
            paidAmount: s.payments?.revenue_30d || 0
          });

          // Set real CRM pipeline stages (preferred over funnelStats)
          if (s.crm?.pipeline_stages && Array.isArray(s.crm.pipeline_stages)) {
            setPipelineStages(s.crm.pipeline_stages);
            fallbackStages = null;
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

      // Only reached when /stats gave us no stages — see the note above. These
      // rows carry no contact counts, so the funnel shows an empty pipeline;
      // that matches the rest of the card, which is also empty when the stats
      // call is what failed.
      if (fallbackStages) {
        setPipelineStages(
          fallbackStages.map(stage => ({
            stage_key: stage.stage_key,
            stage_label: stage.stage_label,
            color: stage.color || '#94A3B8',
            count: 0,
          }))
        );
      }

      setLoading(false);
    } catch {
      // Error handled silently - dashboard shows default state
      setLoading(false);
    }
  }, [language]);

  useEffect(() => {
    if (user) {
      fetchDashboardData();
    }
  }, [user, fetchDashboardData]);

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
        router.push('/business-os/orders?action=create');
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
    } else if (stepId === 'design') {
      // The theme lives in the website builder — one editor, not a second copy
      // here, since the same colours and fonts drive invoices and emails too.
      router.push('/business-os/website?view=design');
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
  }, [fetchDashboardData]);

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
  }, [fetchDashboardData]);

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

      {/* Main Content */}
      <div className={`${PAGE_CONTAINER} py-4 sm:py-5 lg:py-6`}>

        {/* Live Dashboard - Mockup-based Insight Section */}
        <div className="relative">
          <LiveDashboard
            userName={myDay.userName}
            greeting={myDay.greeting}
            setupItems={setupItems}
            setupShape={setupShape}
            channelPerformance={channelPerformance}
            onChannelsChanged={fetchDashboardData}
            isReachable={reach?.isReachable}
            reachSurfaces={reach && { livePages: reach.livePages, smartLinks: reach.smartLinks }}
            ownedSurfaces={reach && {
              website: reach.websiteCount,
              landing: reach.landingCount,
              smartLinks: reach.smartLinkCount,
              websiteDrafts: reach.websiteDrafts,
              landingDrafts: reach.landingDrafts,
            }}
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
              } else if (action === 'create_booking_link') {
                // A business without a website reaches clients through a link,
                // and the links page is where one is made and copied.
                router.push('/business-os/website?view=links');
              } else if (action === 'open_website') {
                router.push('/business-os/website');
              } else if (action === 'sync_calendar') {
                handleQuickSetupClick('calendar');
              } else if (action === 'setup_intake') {
                handleQuickSetupClick('intake');
              } else if (action === 'connect_channels') {
                /*
                 * Scroll to the channels card rather than opening a dialog.
                 *
                 * The card is already on this page — connecting an account, and
                 * what those accounts produced, both live in it. A modal would
                 * have put a second copy of the same UI on top of the first,
                 * which is a worse answer to "where do I do this?" than simply
                 * showing the reader where it is.
                 *
                 * The steps are only rendered when the card is (both follow
                 * `showChannels`), so this never scrolls to nothing.
                 */
                const target = document.getElementById(CHANNELS_CARD_ID);
                if (target) {
                  // Offset by the sticky header and tab bar, which would
                  // otherwise cover the top of the card we just scrolled to.
                  const chrome = document.querySelector('.sticky');
                  const chromeHeight = chrome ? chrome.getBoundingClientRect().height : 0;
                  const top = target.getBoundingClientRect().top + window.scrollY - chromeHeight - 12;
                  window.scrollTo({ top: Math.max(top, 0), behavior: 'smooth' });
                }
              } else if (action === 'complete_profile') {
                router.push('/business-os/settings?section=business');
              } else if (action === 'setup_invoicing') {
                router.push('/business-os/settings?section=invoice');
              } else if (action === 'customize_design') {
                router.push('/business-os/website?view=design');
              } else if (action === 'view_funnel') {
                // Navigate to CRM page to view the funnel/pipeline
                router.push('/business-os/crm');
              }
            }}
          />
        </div>

        {/* Row 3: Chat Panel.
            Was a two-column grid whose second column held the four capability
            cards. With those gone the grid has one child, so the panel is the
            row. */}
        <div className="mt-5">
          <ChatCommandPanel
            ref={chatPanelRef}
            onAction={handleChatAction}
            onPublishDraft={pendingDraftService ? publishDraftService : undefined}
            onConfirmUpdate={pendingServiceUpdate ? confirmServiceUpdate : undefined}
            onCancelUpdate={pendingServiceUpdate ? cancelServiceUpdate : undefined}
            expanded={isMyDayCollapsed}
          />
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

        /* The .dashboard-main-grid and .capability-cards-grid rules that were
           here have gone with the four capability cards: the first sized the
           two-column row that held them beside the chat panel, the other two
           reflowed the 2x2 card grid. Neither element exists any more.
           (No backticks in this block — it is inside a template literal.) */

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
