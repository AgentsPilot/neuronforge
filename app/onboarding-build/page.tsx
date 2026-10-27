'use client';

import React, { useState, useEffect, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Building2,
  Mail,
  Users,
  Calendar,
  Check,
  CreditCard,
  Globe,
  CheckCircle2,
  Loader2,
  Sparkles,
  ArrowRight,
  AlertCircle,
  ClipboardList,
  FileText,
  X,
} from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { marketingLoginUrl } from '@/lib/utils/marketingUrl';
import { Logo } from '@/components/brand/Logo';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { SetupFactCard, SetupFactDeck } from '@/components/business-os/setup/SetupFactCard';
import { LazyConfigurationDialog } from '@/components/business-os/lazyDialogs';
import { StripeConnectWizard } from '@/components/payments/StripeConnectWizard';
import { InvoiceSettingsSection } from '@/components/business-os/settings/InvoiceSettingsSection';
import { InboxChannelSetupDialog } from '@/components/business-os/leads/InboxChannelSetupDialog';
import type { InboxChannelStatus } from '@/lib/business-os/leads/inboxChannel';
import { ownerTasks } from '@/lib/business-os/onboarding/ownerTasks';
import { cn } from '@/lib/utils';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'OnboardingBuildPage' });

interface PreviewData {
  businessProfile?: {
    company_name?: string;
    vertical?: string;
    verticalDisplayName?: string;
    language?: string;
  };
  pipelineStages?: Array<{
    stage_key: string;
    stage_label: string;
    position: number;
    color: string;
  }>;
  services?: Array<{
    service_name: string;
    duration_minutes: number | null;
    price: number | null;
    currency?: string;
    /** Does a client pick a time? Decides the date step, and whether hours are owed. */
    is_scheduled?: boolean;
    /** How the money arrives. Decides whether a processor or bank details are owed. */
    collection?: 'online' | 'invoice' | null;
  }>;
  businessDescription?: string;
  configuration?: {
    /**
     * What the interview learned about the business itself — see
     * `lib/business-os/onboarding/businessBrief`.
     *
     * Shown back before the build because this is the owner's last chance to
     * catch a misunderstanding. Everything they spent five questions saying
     * otherwise goes straight into a profile column and is seen again only
     * once a site has been generated from it and published.
     */
    business_brief?: {
      audience?: string[];
      outcome?: string[];
      differentiators?: string[];
      credentials?: string[];
      objections?: string[];
      voice?: 'individual' | 'team' | null;
    };
    company_name?: string;
    vertical?: string;
    description?: string;
    clients_per_week?: number;
    pain_points?: string[];
    goals?: string[];
    tools?: string[];
    services?: Array<{
      name: string;
      duration_minutes?: number | null;
      price?: number;
      is_scheduled?: boolean;
    }>;
    /**
     * How many services the build will create.
     *
     * The interview asks for a count, not a catalogue, so `services` above is
     * normally empty and this holds the answer. Undeclared, it reads as
     * `undefined` and the services step vanished from the plan.
     */
    service_count?: number;
    /**
     * The two answers the owner gave about HOW they sell, business-wide.
     *
     * Undeclared until now, for the same reason and with the same cost as
     * `service_count` above: the object carries them, the type did not, so
     * they read as `undefined` here. That is what made the owner-only cards
     * below impossible to produce — see the comment on `wantsHours`.
     */
    sells_scheduled?: boolean;
    collection_method?: 'card_online' | 'invoice' | 'in_person' | 'mixed' | 'none' | null;
    /** Clients fill in a form before their appointment. */
    needs_intake?: boolean;
    online_presence_mode?: 'full_website' | 'booking_only' | 'website_only' | 'none';
    /** They told us they already have a site. Null means "not established". */
    has_website?: boolean | null;
    payment_mode?: 'none' | 'upfront' | 'invoicing' | 'installments';
    needs_stripe_connect?: boolean;
    pipeline_stages?: Array<{
      stage_key: string;
      stage_label: string;
      position: number;
      color: string;
    }>;
    capabilities?: string[];
    building_blocks?: Record<string, string[]>;
    capability_reasons?: Record<string, string>;
  };
}

interface BuildStep {
  id: string;
  label: string;
  status: 'pending' | 'in_progress' | 'completed' | 'error';
  icon: React.ReactNode;
  /** What the card reports once the work is finished — a result, not "completed". */
  result?: string;
  /** The colour of the part of the platform this belongs to. */
  color?: string;
  /**
   * Work only this person can do. Never turned green by the build, because the
   * build cannot do it — it stays open so the next action is obvious without a
   * screen announcing it.
   */
  yours?: boolean;
  /** Owner tasks that must be finished before this one can be. */
  dependsOn?: string[];
}

// Loading component for Suspense fallback
function BuildPageLoading() {
  return (
    <div className="min-h-screen bg-[var(--v2-bg)] flex items-center justify-center">
      <div className="text-center">
        <Loader2 className="w-12 h-12 animate-spin mx-auto mb-4 text-[var(--v2-primary)]" />
        <p className="text-lg text-[var(--v2-text-secondary)]">Loading...</p>
      </div>
    </div>
  );
}

// Main page component that wraps content in Suspense
export default function OnboardingBuildPage() {
  return (
    <Suspense fallback={<BuildPageLoading />}>
      <OnboardingBuildContent />
    </Suspense>
  );
}

// Inner component that uses useSearchParams
function OnboardingBuildContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { language: contextLanguage, t } = useLanguage();

  // Get language from URL params or context
  const languageParam = searchParams.get('lang') as 'en' | 'he' | 'es' | null;
  const selectedLanguage = languageParam || contextLanguage || 'en';
  const isRTL = selectedLanguage === 'he';

  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isBuilding, setIsBuilding] = useState(false);
  const [buildComplete, setBuildComplete] = useState(false);
  /**
   * The owner-only steps still open, and the doors they open.
   *
   * Each is settled in place rather than navigated to: the configuration
   * dialogs are self-contained and already fetch their own data, so mounting
   * one here keeps the user on the screen that is telling them why it matters.
   */
  const [settled, setSettled] = useState<Record<string, boolean>>({});

  /**
   * Proof that a card's work is DONE, asked directly.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * This was a map from card to `journeyGaps` kind, and it was wrong in the
   * one direction that matters. Asked without naming services, that endpoint
   * filters `is_active = true`; a catalogue of DRAFTS matches nothing,
   * `journeyGaps` short-circuits on an empty list, and the answer comes back
   * "ready" with no gaps at all. The route's own comment says it outright:
   * "we found nothing to check" must not read as "nothing is wrong".
   *
   * So an account fresh out of onboarding — every service a draft, which is
   * all of them — reported no gaps, and the re-check concluded that hours and
   * a catalogue were finished and kept both cards hidden. Reported as "services
   * and availability still missing", with bank and intake showing beside them
   * only because those two had never been opened and so were never settled.
   *
   * Each entry now asks for POSITIVE evidence instead. `null` means the work
   * cannot be verified from here, and an unverifiable card is never settled by
   * this path: it waits for the owner to finish it or to leave.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const PROOF_OF_DONE: Record<string, (() => Promise<boolean>) | undefined> = {
    availability: async () => {
      const response = await fetch('/api/scheduling/availability');
      if (!response.ok) return false;
      const body = await response.json();
      const hours = body?.availability;
      /* An object with at least one day carrying a window. */
      return !!hours && Object.values(hours).some(
        (day: unknown) =>
          Array.isArray(day) ? day.length > 0 : !!(day as { enabled?: boolean })?.enabled
      );
    },
    services: async () => {
      /*
       * ONE PUBLISHED SERVICE IS ENOUGH.
       *
       * This asked for every service to carry a length and a price. That is
       * the wrong bar for this screen: onboarding drafts three rows from a
       * count, and a business may well want to open with one of them and
       * leave the others for later. Holding the card up until all three are
       * finished turns a reasonable choice into an outstanding chore.
       *
       * Published, not merely filled in, because publishing is the moment the
       * service passes the gate: a row with a price and no working hours
       * behind it is not something a client can buy. So the card goes when
       * there is something real to sell, and not before.
       */
      const response = await fetch('/api/scheduling/services');
      if (!response.ok) return false;
      const body = await response.json();
      const rows = body?.services ?? body?.data ?? [];
      if (!Array.isArray(rows) || rows.length === 0) return false;

      return rows.some((row: { status?: string | null }) => row?.status === 'active');
    },
    /*
     * AN INVOICE NEEDS FOUR THINGS, and this card used to check none of them.
     *
     * It was the only card that settled on a button press rather than on the
     * work being done, so an owner who filled in their bank name and account
     * and left the tax ID blank watched it disappear, then met the publish
     * gate refusing them over a field whose card was gone.
     *
     * The same four the gate itself asks for, via `missingInvoiceFields`: a
     * company name, a tax ID and an address are what make an invoice a legal
     * document, and a payment method is how the client is told where to send
     * the money. Kept in the same order as that function so the two read as
     * the one rule they are.
     */
    bank: async () => {
      const response = await fetch('/api/business-os/invoice-settings');
      if (!response.ok) return false;

      const body = await response.json();
      const invoice = body?.data ?? body;
      const has = (value: unknown) => typeof value === 'string' && value.trim().length > 0;

      const address = invoice?.invoice_address;
      const addressOk = !!address && (has(address.street) || has(address.line1) || has(address.city));

      const payable =
        (has(invoice?.invoice_bank_name) && has(invoice?.invoice_bank_account))
        || has(invoice?.invoice_payment_instructions);

      return (
        has(invoice?.invoice_company_name)
        && has(invoice?.invoice_tax_id)
        && addressOk
        && payable
      );
    },
    /*
     * A channel exists, or it does not. Positive evidence, like the rest: the
     * status route answers from the agent row itself, so a connected mailbox
     * that has not run yet still counts as done — the owner's part is finished
     * and the first sweep is ours.
     */
    mailbox: async () => {
      const response = await fetch('/api/business-os/leads/inbox/status', { cache: 'no-store' });
      if (!response.ok) return false;
      const body = await response.json();
      return Boolean(body?.success) && (body.data?.channels?.length ?? 0) > 0;
    },
    /* Stripe settles from the wizard's own completion, and intake leaves no
       trace to check: reading a form is not observable. */
    stripe: undefined,
    intake: undefined,
  };
  const [openStep, setOpenStep] = useState<
    'availability' | 'stripe' | 'bank' | 'intake' | 'services' | 'mailbox' | null
  >(null);
  /** Needed to mount the invoice settings in place rather than navigating to them. */
  const [userId, setUserId] = useState<string | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [buildSteps, setBuildSteps] = useState<BuildStep[]>([]);

  /*
   * The mailbox lead channel, for the offer at the end of the build.
   *
   * Fetched by this page rather than by the card, because the setup dialog
   * needs the same answer — its first screen offers the mailboxes this owner
   * has actually connected — and one read cannot disagree with itself.
   *
   * Only once the build is complete: before then this screen is a progress
   * view, and a request whose answer is not drawn until the end has no reason
   * to compete with the build for the network.
   */
  const [inboxChannel, setInboxChannel] = useState<InboxChannelStatus | null>(null);
  const [inboxSetupOpen, setInboxSetupOpen] = useState(false);

  const refreshInboxChannel = useCallback(async () => {
    try {
      const response = await fetch('/api/business-os/leads/inbox/status', { cache: 'no-store' });
      const body = await response.json();
      if (body?.success) setInboxChannel(body.data as InboxChannelStatus);
    } catch {
      /* The card renders nothing without a status, which is the right
         behaviour for "we could not ask". */
    }
  }, []);

  /*
   * On mount, not on `buildComplete`.
   *
   * The task row exists from the moment the steps are built, so an owner can
   * press it while the build is still running — and the setup dialog needs the
   * status to know which mailboxes it may offer. Fetched once, early, so that
   * press never opens an empty first screen.
   */
  useEffect(() => {
    void refreshInboxChannel();
  }, [refreshInboxChannel]);

  // Ref to prevent double build calls in StrictMode
  const buildStartedRef = React.useRef(false);

  const initializeBuildSteps = useCallback((data: PreviewData): BuildStep[] => {
    const hasWebsite = data.configuration?.online_presence_mode === 'full_website' ||
                       data.configuration?.online_presence_mode === 'website_only';
    /*
     * The COUNT counts. The interview asks how many services there are rather
     * than for a list of them, so both catalogues read here are normally
     * empty while `service_count` holds the answer and the build creates that
     * many drafts from it. Reading only the catalogues dropped the whole step
     * from the plan on the ordinary path, and made the line below say "0
     * services created" about three rows that were about to exist.
     */
    const plannedServices = Math.max(
      data.services?.length || 0,
      data.configuration?.services?.length || 0,
      data.configuration?.service_count || 0
    );
    const hasServices = plannedServices > 0;
    const hasPipeline = (data.pipelineStages?.length || 0) > 0 ||
                        (data.configuration?.pipeline_stages?.length || 0) > 0;
    const hasPayments = data.configuration?.payment_mode !== 'none';

    const steps: BuildStep[] = [
      {
        id: 'profile',
        label: selectedLanguage === 'he' ? 'העסק שלך' : selectedLanguage === 'es' ? 'Tu negocio' : 'Your business',
        status: 'pending',
        icon: <Building2 className="w-4 h-4" />,
        color: '#8B5CF6',
        result: selectedLanguage === 'he' ? 'הפרופיל נוצר' : selectedLanguage === 'es' ? 'Perfil creado' : 'Profile created',
      }
    ];

    if (hasPipeline) {
      steps.push({
        id: 'pipeline',
        label: selectedLanguage === 'he' ? 'מסע הלקוח שלך' : selectedLanguage === 'es' ? 'Tu recorrido de cliente' : 'Your client journey',
        status: 'pending',
        icon: <Users className="w-4 h-4" />,
        color: '#8B5CF6',
        result: `${(data.pipelineStages?.length || data.configuration?.pipeline_stages?.length || 0)} ${
          selectedLanguage === 'he' ? 'שלבים נוצרו' : selectedLanguage === 'es' ? 'etapas creadas' : 'stages created'
        }`,
      });
    }

    if (hasServices) {
      steps.push({
        id: 'services',
        label: selectedLanguage === 'he' ? 'מה שאתה מוכר' : selectedLanguage === 'es' ? 'Lo que vendes' : 'What you sell',
        status: 'pending',
        icon: <Calendar className="w-4 h-4" />,
        color: '#D14E97',
        result: `${plannedServices} ${
          selectedLanguage === 'he' ? 'שירותים נוצרו כטיוטות' : selectedLanguage === 'es' ? 'servicios creados como borradores' : 'services created as drafts'
        }`,
      });
    }

    if (hasPayments) {
      /*
       * ───────────────────────────────────────────────────────────────────────
       * IT SAID "INVOICE NUMBERING / READY TO INVOICE". NEITHER WAS TRUE.
       *
       * Reported by an owner looking at this screen: "how is the invoice
       * ready?". It was not, twice over.
       *
       * Nothing is NUMBERED. The build route writes no invoice settings at
       * all — it sets `collection` on each service and grants the payments
       * capability, and that is the whole of it. There is no numbering row to
       * create here.
       *
       * And it is not READY. `journeyReadiness` counts missing bank details as
       * a real gap, and this very screen says so two cards further down: "Your
       * bank details. Needs you." A card claiming the invoice is ready, beside
       * a card saying it cannot go out, is the screen arguing with itself.
       *
       * Same failure as "Your site is published" before it, which
       * `theChatTellsTheTruth` was written for: the expensive direction for a
       * false claim, because an owner told a thing is done has no reason to go
       * and finish it.
       *
       * What IS true is that invoicing is switched on for this account, so
       * that is what it now says. What is still needed is on the bank card,
       * where it belongs, said once.
       * ───────────────────────────────────────────────────────────────────────
       */
      steps.push({
        id: 'payments',
        label: selectedLanguage === 'he' ? 'חיוב' : selectedLanguage === 'es' ? 'Facturación' : 'Invoicing',
        status: 'pending',
        icon: <CreditCard className="w-4 h-4" />,
        color: '#22C58B',
        result: selectedLanguage === 'he' ? 'הופעל' : selectedLanguage === 'es' ? 'Activada' : 'Switched on',
      });
    }

    {
      steps.push({
        id: 'website',
        label: selectedLanguage === 'he' ? 'איך לקוחות מגיעים אליך' : selectedLanguage === 'es' ? 'Cómo te encuentran' : 'How clients reach you',
        status: 'pending',
        icon: <Globe className="w-4 h-4" />,
        color: '#4F6EF7',
        /*
         * "Your site is published" was false, and falsely in the one direction
         * that costs the owner something.
         *
         * `WebsiteGenerationService` writes the page with `status: 'draft'`,
         * under a comment that says so outright: "Website starts as draft, user
         * must explicitly publish". So an owner told their site was live had no
         * reason to ever go and publish it, and no reason to look for it when
         * nobody arrived.
         *
         * The build genuinely did its half, which is why this still turns
         * green. Naming what is left is the difference between a finished step
         * and a finished website.
         */
        result: hasWebsite
          ? (selectedLanguage === 'he' ? 'האתר שלך מוכן לפרסום' : selectedLanguage === 'es' ? 'Tu sitio está listo para publicar' : 'Your site is ready for you to publish')
          : (selectedLanguage === 'he' ? 'הלינק להזמנות מוכן' : selectedLanguage === 'es' ? 'Tu enlace de reserva está listo' : 'Your booking link is ready'),
      });
    }

    // The cards the build never turns green.
    //
    // Read off the services, not off one business-wide answer: a practice that
    // takes a card for a session and invoices for a programme owes both, and a
    // consultancy that invoices for everything owes neither a processor nor an
    // explanation of why it was asked for one.
    /*
     * ───────────────────────────────────────────────────────────────────────
     * THE CATALOGUE FIRST, THEN THE ANSWER. NEVER THE PRICE.
     *
     * All three of these were read off `priced` — the services filtered to
     * `price > 0`. The interview does not ask for prices and says so twice in
     * this file already (see `plannedServices` above), so `priced` is empty on
     * every ordinary conversation, all three were false, and NO owner card was
     * ever produced. The screen then congratulated the owner with "System
     * Ready!" and sent them to a dashboard listing the setup it had just
     * decided they did not need.
     *
     * The per-service read stays and stays FIRST — a practice that takes a
     * card for a session and invoices for a programme owes both, and that is
     * the whole reason this was written off the services rather than off one
     * business-wide answer. What is added is the fallback for the ordinary
     * case, where the catalogue does not exist yet because the build is about
     * to create it from a count.
     * ───────────────────────────────────────────────────────────────────────
     */
    /*
     * ONE LIST, SHARED WITH THE PLAN SCREEN.
     *
     * These four were worked out here and the plan screen kept its own two, so
     * the plan promised "1 needs you" where this screen then showed three. The
     * conditions and the words now live in `lib/business-os/onboarding/
     * ownerTasks`; what stays here is the rendering, because this draws steps
     * whose `result` is a sentence while the plan draws cards with a separate
     * note line.
     */
    const icons: Record<string, React.ReactNode> = {
      services: <FileText className="w-4 h-4" />,
      availability: <Calendar className="w-4 h-4" />,
      intake: <ClipboardList className="w-4 h-4" />,
      stripe: <CreditCard className="w-4 h-4" />,
      bank: <Building2 className="w-4 h-4" />,
      mailbox: <Mail className="w-4 h-4" />,
    };

    const howLong = (minutes: number) =>
      selectedLanguage === 'he'
        ? `בערך ${minutes} דקות.`
        : selectedLanguage === 'es'
          ? `Unos ${minutes} minutos.`
          : `About ${minutes} minutes.`;

    for (const task of ownerTasks(
      {
        services: data.services,
        /*
         * `plannedServices`, not `service_count` alone.
         *
         * The count lives in whichever of THREE places knows it, and this
         * passed only one of them. On an account whose catalogue sits in
         * `configuration.services`, `hasServices` came out false and took two
         * cards with it: the services card, and the working hours, which are
         * only owed when there is something to book. Reported as "services and
         * availability still missing".
         */
        serviceCount: plannedServices,
        sellsScheduled: data.configuration?.sells_scheduled,
        collectionMethod: data.configuration?.collection_method,
        needsIntake: data.configuration?.needs_intake,
        /* What they SAID, not what the presence mode implies: a business that
           keeps its own site shares `booking_only` with one that has no web
           presence at all, so the mode cannot tell them apart. */
        hasOwnWebsite: data.configuration?.has_website === true,
      },
      selectedLanguage as 'en' | 'he' | 'es'
    )) {
      steps.push({
        id: task.key,
        label: task.title,
        status: 'pending',
        icon: icons[task.key],
        yours: true,
        result: `${task.body} ${howLong(task.minutes)}`,
        dependsOn: task.dependsOn,
      });
    }

    return steps;
  }, [selectedLanguage]);

  const startBuild = useCallback(async (data: PreviewData) => {
    setIsBuilding(true);
    setBuildError(null);

    const steps = initializeBuildSteps(data);
    setBuildSteps(steps);

    // Helper to update step status
    const updateStep = (stepId: string, status: 'pending' | 'in_progress' | 'completed' | 'error') => {
      setBuildSteps(prev => prev.map(s => s.id === stepId ? { ...s, status } : s));
    };

    // Simulate step-by-step progress with the actual API call
    const simulateProgress = async () => {
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        updateStep(step.id, 'in_progress');
        await new Promise(resolve => setTimeout(resolve, 800 + Math.random() * 600));
        updateStep(step.id, 'completed');
      }
    };

    try {
      // Start progress simulation
      const progressPromise = simulateProgress();

      const response = await fetch('/api/onboarding/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          configuration: data.configuration,
          profile: {
            company_name: data.businessProfile?.company_name,
            vertical: data.businessProfile?.vertical,
            language: data.businessProfile?.language || selectedLanguage,
            description: data.businessDescription
          },
          services: data.services,
          pipelineStages: data.pipelineStages,
          language: selectedLanguage,
          /*
           * The clock this business runs on.
           *
           * The chat never asks, and the build route is server-side — on Vercel
           * that means UTC, so every account built here landed on the column
           * default and the platform could not tell "never asked" from "chose
           * UTC". The browser is the only thing in this request that knows, and
           * it is right far more often than UTC is.
           *
           * A guess, offered as the answer and changeable in Settings — not a
           * question added to a flow that exists to be fast.
           */
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
        })
      });

      if (!response.ok) {
        throw new Error('Build failed');
      }

      const result = await response.json();

      // Wait for progress animation to complete
      await progressPromise;

      // What actually got written, said out loud.
      //
      // The progress animation marked every step green on a timer, so a build
      // that created no services still ended with a row of ticks. A step now
      // reports what the server did with it, and a failure says which service
      // and why rather than leaving the user to find an empty table later.
      const failed: Array<{ name: string; reason: string }> = result.services_failed || [];
      const created: unknown[] = result.services || [];
      const stagesFailed: Array<{ name: string; reason: string }> = result.pipeline_stages_failed || [];

      if (stagesFailed.length > 0) {
        setBuildSteps(prev => prev.map(step => step.id !== 'pipeline' ? step : {
          ...step,
          status: 'error' as const,
          result: selectedLanguage === 'he'
            ? `${stagesFailed.length} שלבים לא נשמרו: ${stagesFailed.map(f => f.name).join(', ')}`
            : selectedLanguage === 'es'
              ? `${stagesFailed.length} etapas no se guardaron: ${stagesFailed.map(f => f.name).join(', ')}`
              : `${stagesFailed.length} stages could not be saved: ${stagesFailed.map(f => f.name).join(', ')}`,
        }));
      }

      if (failed.length > 0) {
        setBuildSteps(prev => prev.map(step => step.id !== 'services' ? step : {
          ...step,
          status: 'error' as const,
          result: selectedLanguage === 'he'
            ? `${failed.length} שירותים לא נשמרו: ${failed.map(f => f.name).join(', ')}`
            : selectedLanguage === 'es'
              ? `${failed.length} servicios no se guardaron: ${failed.map(f => f.name).join(', ')}`
              : `${failed.length} services could not be saved: ${failed.map(f => f.name).join(', ')}`,
        }));
      } else if (created.length > 0) {
        setBuildSteps(prev => prev.map(step => step.id !== 'services' ? step : {
          ...step,
          status: 'completed' as const,
          result: selectedLanguage === 'he'
            ? `${created.length} שירותים נוצרו`
            : selectedLanguage === 'es'
              ? `${created.length} servicios creados`
              : `${created.length} services created`,
        }));
      }

      // Kept, not cleared.
      //
      // Clearing here meant a refresh on the last mile found nothing and
      // bounced the user out — losing a screen that was in the middle of
      // telling them what they still owed. The data is thrown away when they
      // deliberately leave, and not before.
      sessionStorage.setItem('onboarding_build_complete', '1');

      // Mark as complete
      setBuildComplete(true);

      // No redirect.
      //
      // This is where the build used to print "הושלם!" and leave for the
      // dashboard two seconds later — while the orange cards on this same
      // screen, the work only the owner can do, were still open. The business
      // arrived at a dashboard that congratulated it over a booking link
      // leading to an empty calendar.
      //
      // Setup ends when the business can trade, not when the rows are written,
      // so the screen stays and the remaining work becomes actionable.

    } catch (error) {
      logger.error({ err: error }, 'Build error');
      setBuildError(
        selectedLanguage === 'he'
          ? 'אירעה שגיאה בבניית המערכת. אנא נסה שוב.'
          : selectedLanguage === 'es'
          ? 'Hubo un error al construir el sistema. Por favor, inténtalo de nuevo.'
          : 'There was an error building the system. Please try again.'
      );
      setIsBuilding(false);
    }
  }, [router, selectedLanguage, initializeBuildSteps]);

  // Load preview data from session storage
  useEffect(() => {
    let cancelled = false;

    const loadPreviewData = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) {
          // Sign-in lives on the marketing site, on its own origin.
          window.location.href = marketingLoginUrl();
          return;
        }
        if (!cancelled) setUserId(session.user.id);

        const storedData = sessionStorage.getItem('onboarding_preview_data');
        if (storedData && !cancelled) {
          const parsed = JSON.parse(storedData) as PreviewData;
          setPreviewData(parsed);

          // Came back to a build that already ran: show the last mile again
          // rather than building everything a second time. The owner-only
          // steps that were settled before the refresh are remembered too, so
          // connecting Stripe and then reloading does not ask for it again.
          if (sessionStorage.getItem('onboarding_build_complete') === '1') {
            buildStartedRef.current = true;
            setBuildSteps(initializeBuildSteps(parsed).map((step: BuildStep) =>
              step.yours ? step : { ...step, status: 'completed' as const }
            ));
            try {
              setSettled(JSON.parse(sessionStorage.getItem('onboarding_build_settled') || '{}'));
            } catch {
              setSettled({});
            }
            setBuildComplete(true);
          }

          setIsLoading(false);
        } else if (!cancelled) {
          /*
           * ─────────────────────────────────────────────────────────────────
           * NO sessionStorage: ASK THE SERVER before giving up.
           *
           * This used to push straight back to `/onboarding-chat`, which then
           * composed a fresh welcome — so the owner was returned to the first
           * question with no explanation, and nothing was built. Every path
           * that loses the key ended there: a storage write that throws, a new
           * tab, a link opened cold, a restored session.
           *
           * Measured on a real account: the conversation sat on `preview` with
           * a complete configuration, three named services and an intake
           * answer, while services, pipeline stages and the website were all
           * empty. The plan existed on the server the whole time; nothing
           * could ask for it.
           * ─────────────────────────────────────────────────────────────────
           */
          try {
            const response = await fetch('/api/onboarding/chat');
            const recovered = response.ok ? await response.json() : null;
            const plan = recovered?.data?.previewData ?? null;

            if (plan && !cancelled) {
              logger.info({ step: recovered?.data?.currentStep }, 'Recovered the plan from the server');
              sessionStorage.setItem('onboarding_preview_data', JSON.stringify(plan));
              setPreviewData(plan as PreviewData);
              setIsLoading(false);
              return;
            }
          } catch (err) {
            /* Falling back to the chat is still the right answer when there is
               genuinely no plan to build. */
            logger.error({ err }, 'Could not recover the plan from the server');
          }

          if (!cancelled) router.push('/onboarding-chat');
        }
      } catch (error) {
        logger.error({ err: error }, 'Error loading preview data');
        if (!cancelled) {
          router.push('/onboarding-chat');
        }
      }
    };

    loadPreviewData();
    return () => { cancelled = true; };
    // `initializeBuildSteps` is needed to restore a finished build on refresh.
  }, [router, initializeBuildSteps]);

  // Auto-start build when preview data is loaded (with StrictMode protection)
  useEffect(() => {
    if (previewData && !buildStartedRef.current && !isBuilding && !buildComplete) {
      const hasData = previewData.configuration || previewData.businessProfile;
      if (hasData) {
        buildStartedRef.current = true; // Mark synchronously to prevent double-calls
        const timeoutId = setTimeout(() => startBuild(previewData), 500);
        return () => clearTimeout(timeoutId);
      }
    }
  }, [previewData, isBuilding, buildComplete, startBuild]);

  const handleRetry = () => {
    if (previewData) {
      startBuild(previewData);
    }
  };

  const handleGoBack = () => {
    router.push('/onboarding-chat');
  };

  /** Mandatory work this business still owes, in the order the build named it. */
  /**
   * Ask the server what is actually done, and make the cards agree.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * BOTH DIRECTIONS, which the first version of this deliberately refused.
   *
   * It only ever dropped FALSE claims: a card settled by the old
   * settle-on-close bug, whose work turned out not to be done. It never
   * settled a card whose work WAS done, on the reasoning that a missing
   * signal must not be read as completion.
   *
   * That reasoning holds for `intake`, which has no proof at all and is
   * therefore never touched here. It does not hold for the others, whose
   * proofs are positive evidence: working hours either exist or they do not,
   * and reading them is as sound an answer to "is this finished" as to "is
   * this unfinished".
   *
   * One direction left this screen contradicting the gate it is supposed to
   * prepare the owner for. The cards come from the PLAN — what the chat was
   * told — and disappear only on a settle recorded in sessionStorage. Clear
   * that cache, or open the build in another tab, and every card returns,
   * including the ones whose work was finished days ago. Reported as working
   * hours showing outstanding on a business that had set them.
   *
   * Still never settles what it cannot verify: a task with no proof keeps
   * whatever state it had.
   * ───────────────────────────────────────────────────────────────────────────
   */
  useEffect(() => {
    if (!buildComplete) return;

    /* Every verifiable task, settled or not: the answer decides which way. */
    const verifiable = Object.keys(PROOF_OF_DONE).filter(id => PROOF_OF_DONE[id]);
    if (verifiable.length === 0) return;

    let cancelled = false;

    (async () => {
      const done: string[] = [];
      const notDone: string[] = [];

      for (const id of verifiable) {
        try {
          (await PROOF_OF_DONE[id]!() ? done : notDone).push(id);
        } catch (error) {
          /* Unverifiable is neither: leave this card exactly as it was. */
          logger.warn({ err: error, step: id }, 'Could not verify a card against the server');
        }
      }

      if (cancelled) return;

      setSettled(prev => {
        const next = { ...prev };
        let changed = false;

        for (const id of done) {
          if (!next[id]) { next[id] = true; changed = true; }
        }
        for (const id of notDone) {
          if (next[id]) { delete next[id]; changed = true; }
        }

        if (!changed) return prev;
        logger.info({ done, notDone }, 'Reconciled the owner cards with the server');
        sessionStorage.setItem('onboarding_build_settled', JSON.stringify(next));
        return next;
      });
    })();

    return () => { cancelled = true; };
    /* Once the build is finished; `settled` changes below are its own writes. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildComplete]);

  const outstanding = buildSteps.filter(step => step.yours && !settled[step.id]);

  /**
   * The build as a spine: what was finished, and where it branches out to you.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * Each owner task hangs off the built step it COMPLETES, so the reason for a
   * piece of work is never more than a line away from the work.
   *
   *   services    the catalogue it finishes
   *   bank        the invoicing it makes sendable
   *   stripe      the same, for a card
   *
   * `availability` and `intake` have no built step to hang from, and are not
   * given a fabricated one: the build writes no "scheduling" or "intake" card,
   * and inventing a line saying it did would be the kind of claim this screen
   * has already been wrong about twice. They take a row of their own, between
   * the steps they sit between in the client's order.
   *
   * Nothing here decides WHAT is owed. `outstanding` does that, from
   * `ownerTasks`, exactly as before; this only decides where each one is drawn.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const SPINE = (() => {
    const built = buildSteps.filter(step => !step.yours);
    const owed = (id: string) => outstanding.filter(step => step.id === id);

    /*
     * FINISHED WORK STAYS ON THE SPINE, in green.
     *
     * A settled task used to leave `outstanding` and take its whole row with
     * it: `availability` has no built step behind it, so once the hours were
     * set the row had neither a fact nor a branch and was filtered away. The
     * owner configured something and watched a step vanish from the flow.
     *
     * Reported as "I configured the availability and it hid the card but it
     * shall show it as green in its node", which is right twice over. A flow
     * that loses a step stops being a flow, and the one moment somebody has
     * earned a tick is the worst moment to take the line away.
     */
    const finished = (id: string) =>
      buildSteps.filter(step => step.yours && step.id === id && settled[step.id]);

    const at = (builtId: string, ...taskIds: string[]) => ({
      key: builtId,
      built: built.find(step => step.id === builtId) ?? null,
      branches: taskIds.flatMap(owed),
      done: taskIds.flatMap(finished),
    });

    const alone = (taskId: string) => ({
      key: taskId,
      built: null as BuildStep | null,
      branches: owed(taskId),
      done: finished(taskId),
    });

    return [
      at('profile'),
      at('pipeline'),
      at('services', 'services'),
      alone('availability'),
      at('payments', 'bank', 'stripe'),
      alone('intake'),
      /* `mailbox` branches off the website row rather than standing alone:
         "how clients reach you" is one question, and a business that kept its
         own site is answering it the other way round. */
      at('website', 'mailbox'),
      /* A row with neither a fact to report nor work to offer is not a row. */
    ].filter(row => row.built || row.branches.length > 0 || row.done.length > 0);
  })();

  /**
   * Which rows are holding another row up, so the spine can draw the link.
   *
   * Read off `dependsOn`, which `ownerTasks` already fills: the services task
   * names the hours and the bank details it waits for. A row is a BLOCKER when
   * one of its own branches is named by somebody else, and WAITING when one of
   * its branches names somebody. The animation runs between the two.
   *
   * Only among work that is still owed. A dependency already finished is not a
   * link worth drawing, and `outstanding` has dropped it by the time we get
   * here.
   */
  const blockedBy = new Set(
    outstanding.flatMap(step => (step.dependsOn ?? []).filter(id =>
      outstanding.some(other => other.id === id)
    ))
  );
  const rowBlocks = (row: { branches: BuildStep[] }) =>
    row.branches.some(step => blockedBy.has(step.id));
  const rowWaits = (row: { branches: BuildStep[] }) =>
    row.branches.some(step => (step.dependsOn ?? []).some(id => blockedBy.has(id)));

  /**
   * The two ends of the dependency, as row indices.
   *
   * Earliest to latest among the rows involved, whichever end the blocker is
   * on. The first version ran from the blocker DOWN to the waiter, assuming a
   * dependency always sits above what needs it; here it is the other way
   * round, "Finish your services" sits with the catalogue and waits on rows
   * below it, so the range came out backwards and nothing drew at all.
   */
  const linkEnds = (() => {
    const involved = SPINE
      .map((row, index) => (rowBlocks(row) || rowWaits(row) ? index : -1))
      .filter(index => index !== -1);
    if (involved.length < 2) return null;
    return { first: Math.min(...involved), last: Math.max(...involved) };
  })();

  /**
   * Where those two ends actually are on screen, measured rather than guessed.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * The link was drawn as a straight segment lying on the spine, which made it
   * indistinguishable from the spine: a line from A to B that follows the same
   * path as the thing it is drawn over says nothing. A link has to LEAVE the
   * line and come back, and a curve cannot be positioned without knowing how
   * tall the rows between its ends happen to be.
   *
   * Rows are as tall as their cards, and the cards hold sentences that wrap
   * differently per language and per width, so the only honest source for that
   * is the DOM. Measured after layout, and again on resize.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const spineRef = React.useRef<HTMLDivElement>(null);
  const [linkSpan, setLinkSpan] = useState<{ top: number; height: number } | null>(null);

  React.useLayoutEffect(() => {
    if (!linkEnds) { setLinkSpan(null); return; }

    const measure = () => {
      const host = spineRef.current;
      if (!host) return;

      const from = host.querySelector<HTMLElement>(`[data-spine-node="${linkEnds.first}"]`);
      const to = host.querySelector<HTMLElement>(`[data-spine-node="${linkEnds.last}"]`);
      if (!from || !to) { setLinkSpan(null); return; }

      const base = host.getBoundingClientRect().top;
      const a = from.getBoundingClientRect();
      const b = to.getBoundingClientRect();
      const top = a.top - base + a.height / 2;
      const height = (b.top - base + b.height / 2) - top;

      setLinkSpan(height > 8 ? { top, height } : null);
    };

    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
    /* Re-measured whenever the rows could have changed shape. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkEnds?.first, linkEnds?.last, outstanding.length, settled, selectedLanguage]);

  /**
   * What stopping here costs, named for the first thing outstanding.
   *
   * Hours come first because without them nothing can be booked at all; the
   * others narrow what works rather than stopping it.
   */
  const outstandingCost = (() => {
    const first = outstanding[0]?.id;
    if (first === 'availability') {
      return selectedLanguage === 'he'
        ? 'בלי שעות פעילות אף אחד לא יוכל להזמין תור.'
        : selectedLanguage === 'es'
          ? 'Sin horario nadie podrá reservar.'
          : 'Without working hours nobody will be able to book.';
    }
    if (first === 'stripe') {
      return selectedLanguage === 'he'
        ? 'שירותים שנגבים בכרטיס לא יוכלו לקבל תשלום עד שתחבר את סטרייפ.'
        : selectedLanguage === 'es'
          ? 'Los servicios cobrados con tarjeta no podrán cobrar hasta conectar Stripe.'
          : 'Services collected by card cannot charge until Stripe is connected.';
    }
    if (first === 'intake') {
      return selectedLanguage === 'he'
        ? 'לקוחות יזמינו בלי למלא טופס, ותצטרך לשאול אותם בעצמך.'
        : selectedLanguage === 'es'
          ? 'Los clientes reservarán sin rellenar un formulario y tendrás que preguntarles tú.'
          : 'Clients will book without filling anything in, and you will have to ask them yourself.';
    }
    return selectedLanguage === 'he'
      ? 'החשבוניות יצאו בלי פרטי החברה שלך, והלקוח לא יידע לאן להעביר.'
      : selectedLanguage === 'es'
        ? 'Las facturas saldrán sin tus datos y el cliente no sabrá dónde transferir.'
        : 'Invoices will go out without your details, so clients will not know where to send the money.';
  })();

  /*
   * Every id the owner-task list can produce must be openable here.
   *
   * `services` was added to that list and not to this one, so its card had a
   * button that did nothing: the owner pressed "Fill in details" on "Finish
   * your services" and the screen sat there. A card naming work the platform
   * cannot route to is worse than no card, because it reads as broken rather
   * than as unfinished.
   *
   * Guarded by `OWNER_TASK_KEYS` rather than a hand-written list, so the next
   * task added to the shared module fails a test here instead of going quiet
   * on the screen.
   */
  const openOwnerStep = (id: string) => {
    if (
      id === 'availability' ||
      id === 'stripe' ||
      id === 'bank' ||
      id === 'intake' ||
      id === 'services' ||
      id === 'mailbox'
    ) {
      setOpenStep(id);
    }
  };

  /** Marks a step done and closes whatever was open for it. */
  /**
   * Does anything in this catalogue take a card?
   *
   * The same test the owner-step list makes, lifted to the component so the
   * bank panel can decide whether connecting a processor is still worth
   * offering — there is nothing to offer a business that is already set up to
   * be paid that way.
   */
  /*
   * NOT GATED ON A PRICE. The sixth time this gate has been found here.
   *
   * It read `(service.price || 0) > 0 && collection === 'online'`, and the
   * interview collects no prices at all, so it was ALWAYS FALSE. What it
   * decides is whether the bank panel still offers to connect a processor,
   * and `!collectsOnlineSome` meant that offer was shown to every business
   * including ones already set up to take cards.
   *
   * Harmless-looking in isolation, which is exactly why it keeps being
   * written: "does this business take money" reads like a price question
   * right up until you notice nobody is asked for one. The collection is the
   * answer, on its own.
   */
  const collectsOnlineSome = (previewData?.services || []).some(
    service => service.collection === 'online'
  );

  /**
   * Close a dialog, and settle the card only if the work is actually done.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * Reported: "I opened the availability, didn't wait for a sec and closed the
   * dialog, the card got disappeared." It had `settleOwnerStep` as its
   * `onClose`, so shutting a dialog counted as finishing the work.
   *
   * Making close mean close fixed that and introduced the opposite complaint:
   * a card the owner HAD finished stayed on screen. Neither guess is good
   * enough, so this asks.
   *
   * `journey-readiness` is the same function the publish gate uses, so a card
   * disappears exactly when the thing it was asking for stops blocking the
   * business. That is a far better test than "did a dialog close", and it is
   * the test that was already refusing the owner at the other end.
   *
   *   hours      availability     catalogue   services
   *   processor  stripe           invoicing   bank
   *
   * INTAKE IS NOT IN THAT LIST, and cannot be: its work is READING a form the
   * platform already generated and switched on, which leaves no trace to check
   * for. It stays until the owner leaves for the dashboard. Better a card that
   * outstays its welcome than one that claims a form was read when nobody read
   * it, which is the mistake this whole change is undoing.
   *
   * A failed check settles nothing. The cost of being wrong is asymmetric: an
   * extra card is a moment's annoyance, a missing one is a business that
   * cannot take a booking and was told it was finished.
   * ───────────────────────────────────────────────────────────────────────────
   */

  /**
   * Settle a card if its work is now done, WITHOUT closing it otherwise.
   *
   * For the save-in-place path: pressing Save on a complete form should take
   * the card away, and pressing it on an incomplete one should leave the
   * dialog open so the missing field can be filled. `closeOwnerStep` always
   * closes, which is right for a close button and wrong for this.
   */
  const verifyOwnerStep = async (id: string) => {
    const proof = PROOF_OF_DONE[id];
    if (!proof) return;
    try {
      if (await proof()) {
        settleOwnerStep(id);
        logger.info({ step: id }, 'Owner step settled after a save that completed it');
      }
    } catch (error) {
      logger.warn({ err: error, step: id }, 'Could not verify a step after saving it');
    }
  };

  const closeOwnerStep = async (id: string) => {
    setOpenStep(null);

    const proof = PROOF_OF_DONE[id];
    if (!proof) return;

    try {
      if (await proof()) {
        settleOwnerStep(id);
        logger.info({ step: id }, 'Owner step settled because the work is done');
      }
    } catch (error) {
      /* Never settle on our own failure to check. */
      logger.warn({ err: error, step: id }, 'Could not verify a step after closing it');
    }
  };

  const settleOwnerStep = (id: string) => {
    setSettled(prev => {
      const next = { ...prev, [id]: true };
      // Survives a reload: connecting Stripe and then refreshing must not ask
      // for Stripe again.
      sessionStorage.setItem('onboarding_build_settled', JSON.stringify(next));
      return next;
    });
    setOpenStep(null);
  };

  /**
   * The only way out of this screen.
   *
   * The preview payload and the build-complete marker go: both describe work
   * that is finished, and keeping them would send a returning user back into a
   * build that has already run.
   *
   * `onboarding_build_settled` STAYS. It records which of the owner-only steps
   * were actually done here, and it used to be thrown away at this exact line —
   * so a user who set their hours, skipped Stripe and clicked through arrived
   * at a dashboard that had to work the whole question out again from the
   * database, and the screen's own knowledge of what was left died at the door.
   * Coming back to finish the last mile then started from nothing.
   *
   * It is a small key and it expires with the session; the cost of keeping it
   * is nil next to re-deriving what this screen already knew.
   */
  const leaveForDashboard = () => {
    sessionStorage.removeItem('onboarding_preview_data');
    sessionStorage.removeItem('onboarding_build_complete');
    router.push('/business-os');
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[var(--v2-bg)] flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin mx-auto mb-4 text-[var(--v2-primary)]" />
          <p className="text-lg text-[var(--v2-text-secondary)]">
            {selectedLanguage === 'he' ? 'טוען...' : selectedLanguage === 'es' ? 'Cargando...' : 'Loading...'}
          </p>
        </div>
      </div>
    );
  }

  return (
    /*
     * The chrome does not scroll, as in Business OS and as on the chat page
     * beside this one. See `app/onboarding-chat/page.tsx` for the full
     * reasoning: a 100dvh flex column with `shrink-0` chrome over a `flex-1
     * overflow-y-auto` body, copied from `app/business-os/layout.tsx` rather
     * than built with `position: sticky`.
     */
    <div
      className="flex h-[100dvh] w-full flex-col overflow-hidden bg-[var(--v2-bg)]"
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      {/* Header */}
      <div className="relative z-50 shrink-0 border-b border-[var(--v2-border)] bg-[var(--v2-surface)]">
        <div dir="ltr" className="max-w-4xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-4">
          {/* THE SAME LOGO THE CHAT BEFORE IT SHOWS, and the platform's.
              This was `V2Logo` — `/images/AgentPilot_Logo.png`, the old square
              mark from a name the product no longer carries — while the chat
              one click earlier had already moved to the wordmark in
              `components/brand/Logo`, which `BusinessOSHeader` also uses. So
              the brand changed between the two screens of one flow. See the
              fuller note at the chat page's header, including why it is not a
              link: `V2Logo` wrapped one to `/v2/dashboard`, a legacy screen
              with no route back, and there is nowhere useful to go from a
              build that is still running. */}
          <Logo placement="header" priority />
          {/* Whose account this is.
              The chat header one screen earlier already carries this, under a
              comment that says why: it is true of every screen from here on,
              not a line belonging to one of them. This screen is "from here
              on", and the name simply vanished on arriving at it. */}
          {previewData?.businessProfile?.company_name && (
            <span
              dir={isRTL ? 'rtl' : 'ltr'}
              className="text-sm font-semibold text-[var(--v2-text-primary)] truncate min-w-0"
            >
              {previewData.businessProfile.company_name}
            </span>
          )}
        </div>
      </div>

      {/* Main Content.
          Wide enough for the deck to be a deck. The cards lay themselves out
          at a 220px minimum, so inside a 28rem column exactly one fitted and
          six facts became a column tall enough to scroll — the build reads as
          a queue rather than as the plan filling in. Three across keeps the
          whole thing on one screen, which is the only way the user can watch
          it happen. */}
      {/* The scroller is the outer div and runs full width, so its scrollbar
          sits at the edge of the window rather than inside the centred
          column. The inner div keeps the measure it always had. */}
      <div className="flex-1 overflow-y-auto">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        <div className="relative">
          {/* Compact Card */}
          <div className="relative bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-2xl p-6 shadow-lg">
            {/* Header Section - Compact */}
            <div className="relative text-center mb-6">
              <div className="w-14 h-14 mx-auto mb-4 bg-gradient-to-br from-[var(--v2-primary)] to-[var(--v2-primary)]/70 rounded-xl flex items-center justify-center shadow-md">
                {buildComplete ? (
                  <CheckCircle2 className="w-7 h-7 text-white" />
                ) : buildError ? (
                  <AlertCircle className="w-7 h-7 text-white" />
                ) : (
                  <Sparkles className="w-7 h-7 text-white animate-pulse" />
                )}
              </div>

              <h1 className="text-xl font-bold text-[var(--v2-text-primary)] mb-1">
                {buildComplete
                  ? outstanding.length > 0
                    ? (selectedLanguage === 'he' ? 'כמעט שם' : selectedLanguage === 'es' ? 'Casi listo' : 'Almost there')
                    : (selectedLanguage === 'he' ? 'המערכת מוכנה!' : selectedLanguage === 'es' ? '¡Sistema listo!' : 'System Ready!')
                  : buildError
                  ? (selectedLanguage === 'he' ? 'אירעה שגיאה' : selectedLanguage === 'es' ? 'Ocurrió un error' : 'An Error Occurred')
                  : (selectedLanguage === 'he' ? 'בונה את המערכת שלך' : selectedLanguage === 'es' ? 'Construyendo tu sistema' : 'Building Your System')}
              </h1>

              <p className="text-sm text-[var(--v2-text-secondary)]">
                {buildComplete
                  ? outstanding.length > 0
                    // Says how much is left and whose it is. "Redirecting to
                    // dashboard" was the sentence that walked away from an
                    // unfinished setup.
                    ? (selectedLanguage === 'he'
                        ? `בניתי את כל מה שיכולתי. ${outstanding.length === 1 ? 'נשאר דבר אחד שרק את/ה יכול/ה לעשות.' : `נשארו ${outstanding.length} דברים שרק את/ה יכול/ה לעשות.`}`
                        : selectedLanguage === 'es'
                          ? `Construí todo lo que pude. ${outstanding.length === 1 ? 'Queda una cosa que solo tú puedes hacer.' : `Quedan ${outstanding.length} cosas que solo tú puedes hacer.`}`
                          : `I built everything I could. ${outstanding.length === 1 ? 'One thing is left that only you can do.' : `${outstanding.length} things are left that only you can do.`}`)
                    : (selectedLanguage === 'he' ? 'הכל מוכן. אפשר להתחיל.' : selectedLanguage === 'es' ? 'Todo listo. Puedes empezar.' : 'All set. You can start.')
                  : buildError
                  ? buildError
                  : (selectedLanguage === 'he' ? 'רק עוד רגע...' : selectedLanguage === 'es' ? 'Solo un momento...' : 'Just a moment...')}
              </p>
            </div>

            {/* Business Summary - Compact inline */}
            {previewData?.businessProfile?.company_name && !buildComplete && (
              <div className="relative mb-5 p-3 bg-[var(--v2-bg)] border border-[var(--v2-border)] rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 bg-[var(--v2-primary)]/10 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Building2 className="w-4 h-4 text-[var(--v2-primary)]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    {/* No text-align of its own: the page carries dir, so the
                        name sits on the reading-start side in Hebrew and in
                        English without a rule for each. */}
                    <p className="font-medium text-sm text-[var(--v2-text-primary)] truncate">
                      {previewData.businessProfile.company_name}
                    </p>
                  </div>
                  {previewData.businessProfile.verticalDisplayName && (
                    <span className="text-[10px] font-medium text-[var(--v2-primary)] bg-[var(--v2-primary)]/10 px-2 py-1 rounded-full flex-shrink-0">
                      {previewData.businessProfile.verticalDisplayName}
                    </span>
                  )}
                </div>

                {/*
                  WHAT WE UNDERSTOOD, shown back before anything is built.
                  ───────────────────────────────────────────────────────────
                  The card named the business and its trade and stopped there.
                  Everything the owner just spent five questions telling us —
                  who their clients are, what those clients get, what makes
                  them the choice — went into a profile column unseen, and the
                  first sight of our reading of it was a published website.

                  Each line is their own words, so a misunderstanding is
                  obvious at a glance rather than inferred from the copy.
                */}
                {(() => {
                  const brief = previewData.configuration?.business_brief;
                  if (!brief) return null;

                  const candidates: Array<[string, string[] | undefined]> = [
                    [t('onboarding.brief.audience') || 'Clients', brief.audience],
                    [t('onboarding.brief.outcome') || 'What they get', brief.outcome],
                    [t('onboarding.brief.differentiators') || 'What sets you apart', brief.differentiators],
                    [t('onboarding.brief.credentials') || 'Background', brief.credentials],
                    [t('onboarding.brief.objections') || 'What holds people back', brief.objections],
                  ];

                  /* Typed on the way out: `.filter` alone widens the tuple to
                     `any[][]` and the pair stops being a pair. */
                  const lines: Array<[string, string[]]> = candidates.flatMap(([label, values]) =>
                    values?.length ? [[label, values] as [string, string[]]] : []
                  );

                  if (!lines.length) return null;

                  return (
                    <div className="mt-3 pt-3 border-t border-[var(--v2-border)] space-y-1.5">
                      {lines.map(([label, values]) => (
                        <p key={label} className="text-[11px] leading-snug text-[var(--v2-text-secondary)]">
                          <span className="text-[var(--v2-text-muted)]">{label}: </span>
                          <bdi>{(values ?? []).join(' · ')}</bdi>
                        </p>
                      ))}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* The cards from the plan, filling in.
                The build used to be a list of rows ticking off — a progress
                log, which threw away the screen the user had just studied.
                These are the same facts in the same order, each reporting what
                actually happened rather than the word "completed". */}
            {/*
                ALSO AFTER A REFRESH, not only while the build runs.
                ──────────────────────────────────────────────────────────────
                This was `isBuilding && !buildError`, and `isBuilding` goes
                false the moment the build finishes. On a reload the restore
                path sets `buildComplete` and never sets `isBuilding`, so every
                card reporting what WAS built vanished: the profile, the client
                journey, the services, the invoicing, the website. Reported as
                "refresh of the page make these disappear".

                The build can be over in either of two ways and the screen has
                to survive both: finishing in front of the owner, and being
                found already finished when the page is opened again.
                ──────────────────────────────────────────────────────────────
            */}
            {/* While it runs. Once it is finished the spine below takes over,
                which is what survives a refresh. */}
            {isBuilding && !buildError && (
              <SetupFactDeck>
                {/*
                    WHAT THE PLATFORM BUILT, and only that.
                    ──────────────────────────────────────────────────────────
                    This mapped every step, owner ones included, which was
                    harmless while the deck only showed DURING the build: the
                    owner's section had not appeared yet. Making the deck
                    survive a refresh put both on screen at once, so "Your
                    working hours", "Your bank details", "Your intake form"
                    and "Finish your services" each appeared twice, a few
                    hundred pixels apart, once as a fact and once as a button.

                    The two halves answer different questions. This one is
                    "what did you do for me"; the section below is "what is
                    left for me to do". A card cannot belong to both.
                */}
                {buildSteps.filter(step => !step.yours).map(step => (
                  <SetupFactCard
                    /*
                     * COMPOSITE, because two steps legitimately share an id.
                     *
                     * `services` is pushed twice on purpose: once as the
                     * platform's own work ("3 services created as drafts") and
                     * once as the owner's ("Finish your services"). They are
                     * the same subject at two stages, and both belong in this
                     * deck, so the id cannot be the key.
                     *
                     * React warned "Encountered two children with the same
                     * key, `services`" and warned that children may be
                     * duplicated or omitted. The id itself stays as it is: it
                     * is what `openOwnerStep` and `PROOF_OF_DONE` route on.
                     */
                    key={`${step.yours ? 'yours' : 'built'}-${step.id}`}
                    color={step.color || '#4F6EF7'}
                    icon={step.icon}
                    title={step.label}
                    yours={step.yours}
                    // Work only the user can do is never claimed as built, and
                    // never dimmed as "waiting" either: it is not queued behind
                    // anything, it is simply theirs.
                    state={
                      step.yours ? 'plan'
                        : step.status === 'completed' ? 'done'
                          : step.status === 'in_progress' ? 'busy'
                            : step.status === 'error' ? 'error'
                              : 'pending'
                    }
                    value={step.status === 'completed' || step.yours ? step.result : undefined}
                    note={
                      step.status === 'in_progress'
                        ? (selectedLanguage === 'he' ? 'בונה…' : selectedLanguage === 'es' ? 'Construyendo…' : 'Building…')
                        : step.status === 'error'
                          ? (selectedLanguage === 'he' ? 'לא הצלחנו. אפשר לנסות שוב אחר כך' : selectedLanguage === 'es' ? 'No se pudo. Puedes reintentarlo luego' : 'Could not finish. You can retry later')
                          : step.status === 'pending' && !step.yours
                            ? (selectedLanguage === 'he' ? 'ממתין' : selectedLanguage === 'es' ? 'En espera' : 'Waiting')
                            : undefined
                    }
                  />
                ))}
              </SetupFactDeck>
            )}

            {/* Overall Progress Bar - Compact */}
            {isBuilding && !buildError && buildSteps.length > 0 && (
              <div className="mt-5">
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#4F6EF7] transition-all duration-500 ease-out"
                    style={{
                      // Only the platform's own work counts: including a step
                      // it cannot do would leave the bar permanently short of
                      // full through no fault of the user's.
                      width: `${
                        (buildSteps.filter(s => !s.yours && s.status === 'completed').length /
                          Math.max(1, buildSteps.filter(s => !s.yours).length)) * 100
                      }%`
                    }}
                  />
                </div>
                {/*
                    IT SAID "5 / 5 steps" UNDER EIGHT CARDS.
                    ────────────────────────────────────────────────────────────
                    Reported as "what is 5/5 means in the bottom?", and the
                    honest answer was buried in a filter: it counts the steps
                    the PLATFORM does, deliberately excluding the `yours` ones,
                    so the bar cannot sit permanently short through no fault of
                    the owner's. Good reasoning, invisible from the screen —
                    eight cards above a counter that stops at five reads like
                    three of them failed.

                    So the count now names what it is counting. The owner cards
                    are not behind in a race; they are a different kind of
                    thing, and the heading beneath this already says so.
                */}
                <p className="text-center text-xs text-[var(--v2-text-muted)] mt-2">
                  {selectedLanguage === 'he'
                    ? `${buildSteps.filter(s => !s.yours && s.status === 'completed').length} מתוך ${buildSteps.filter(s => !s.yours).length} דברים שאני מקים עבורך`
                    : selectedLanguage === 'es'
                      ? `${buildSteps.filter(s => !s.yours && s.status === 'completed').length} de ${buildSteps.filter(s => !s.yours).length} cosas que monto por ti`
                      : `${buildSteps.filter(s => !s.yours && s.status === 'completed').length} of ${buildSteps.filter(s => !s.yours).length} things I set up for you`}
                </p>
              </div>
            )}

            {/* The last mile.
                Only what is mandatory for THIS business, which the services
                above already decided — hours where something is booked, a
                processor where something takes a card, bank details where
                something is invoiced. A business needing none of them sees
                none of this and goes straight through. */}
            {buildComplete && (
              <div className="mt-5">
                {outstanding.length > 0 ? (
                  <>
                    {/*
                        THE CLIENT JOURNEY STRIP WAS HERE, and was removed on
                        2026-10-24 at the owner's request: "this card displayed
                        in the previous stage so we do not really need it
                        again".

                        It drew, per service, the path a client walks and
                        dashed the steps that cannot happen yet. Worth keeping
                        in mind if it is ever reinstated: it is not actually on
                        the plan screen before this one. What made it redundant
                        is the SPINE below, which arrived in the same change and
                        answers the same question — what is missing, and what it
                        costs — against the build rather than against each
                        service.

                        Two displays of one fact is what this screen has just
                        spent a day removing, so the one that says it once wins.
                        The strip still lives where its own comment says it
                        belongs, beside the setting being changed: the services
                        editor, the service modal, the publish dialog and the
                        website wizards.
                    */}

                    {/*
                        THREE TO A ROW, not a column of full-width bars.
                        ──────────────────────────────────────────────────────
                        Stacked, five outstanding cards pushed the "I'll do
                        this later" button and the cost sentence beneath it off
                        the fold, so the screen's own way out was the thing you
                        had to scroll to find.

                        `items-stretch` with the action row pinned by `mt-auto`
                        so the buttons line up across a row whatever length the
                        sentences are: three cards of different heights with
                        their buttons at three different levels reads as three
                        unrelated things.
                    */}
                    {/*
                        ──────────────────────────────────────────────────────
                        THE BUILD AS A SPINE, WITH BRANCHES WHERE IT STOPPED.

                        What the platform finished is a LINE. Where it could go
                        no further, the line branches out to the owner with the
                        one control that continues it.

                        This replaces two separate displays that said the same
                        thing twice: a deck of cards reporting finished work,
                        and a grid of orange cards reporting what was left. Nine
                        cards of equal weight, no order, and the reason for each
                        piece of work a screen-length away from the work itself.

                        Every handler, dialog and condition below is the one
                        that was there before. `outstanding` still decides what
                        needs doing, `openOwnerStep` still routes, `dependsOn`
                        still names what a task waits for. Only the drawing
                        changed.
                        ──────────────────────────────────────────────────────
                    */}
                    <div ref={spineRef} className="mb-4 ps-5 relative">
                      {/*
                          THE DEPENDENCY, DRAWN RATHER THAN ONLY SAID.
                          ────────────────────────────────────────────────────
                          "Publishing waits for your working hours and your
                          bank details" is a sentence at the bottom of one
                          branch, naming two others a screen apart. The eye has
                          to do the joining.

                          So the spine between them flows. A travelling dash
                          runs from each blocker down to the branch that is
                          waiting, and the blockers' nodes pulse in the same
                          rhythm, which is what makes the two read as one
                          relationship rather than two decorations.

                          The dashes run DOWN the spine, which is reading
                          order. They do not claim a direction of dependency:
                          the blocked task can sit above its blockers as easily
                          as below, and here it does.
                      */}
                      <style>{`
                        /*
                         * A DASHED STROKE THAT TRAVELS, WITH ROOM BETWEEN DASHES.
                         *
                         * Three things were wrong before, in turn, and each is
                         * worth keeping written down.
                         *
                         * It did not move at all. A lone "to" keyframe setting
                         * background-position-y asks the browser to interpolate
                         * from the computed start, and with no
                         * background-position on the rule that start is the
                         * initial "0% 0%". A percentage-to-length tween is the
                         * kind of thing engines quietly decline, and it did.
                         *
                         * Then it moved and looked wrong: a 6px dash with an
                         * 8px gap on a 2px line reads as angled, because the
                         * marks are close enough to be taken as one jagged
                         * edge. The gap is now more than twice the dash.
                         *
                         * Then it was straight, lying along the spine, which
                         * made it indistinguishable from the spine. It is a
                         * stroke on a curve now, so the dash travels the path
                         * rather than a rectangle: stroke-dashoffset, not
                         * background-position.
                         */
                        @keyframes spine-flow {
                          from { stroke-dashoffset: 20; }
                          to   { stroke-dashoffset: 0; }
                        }
                        .spine-link {
                          stroke-dasharray: 6 14;
                          animation: spine-flow 1.1s linear infinite;
                        }
                        .spine-node-blocking { animation: spine-node-pulse 1.8s ease-in-out infinite; }
                        @media (prefers-reduced-motion: reduce) {
                          /* The dashed line stays, which is what carries the
                             meaning. Only the travel stops. */
                          .spine-link { animation: none; }
                          .spine-node-blocking { animation: none; }
                        }
                      `}</style>

                      {/* The spine itself, behind the rows. */}
                      <div
                        className="absolute top-2 bottom-2 w-[2px]"
                        style={{ insetInlineStart: '5px', background: 'var(--v2-border)' }}
                      />

                      {/*
                          THE DEPENDENCY, AS A CURVE THAT LEAVES THE SPINE.
                          ──────────────────────────────────────────────────────
                          Drawn once over the whole run rather than as a segment
                          per row, because a link that follows the same path as
                          the spine it lies on says nothing: it reads as the
                          spine. This bows out into the gap between the line and
                          the cards, so it is visibly a connection BETWEEN two
                          nodes rather than a stretch of the line itself.

                          Positioned from measurement. Rows are as tall as their
                          cards and the cards hold sentences that wrap
                          differently per language, so where the two ends sit is
                          not something that can be guessed in CSS.
                      */}
                      {linkSpan && (
                        <svg
                          aria-hidden
                          className="absolute pointer-events-none overflow-visible"
                          style={{
                            insetInlineStart: '1px',
                            top: `${linkSpan.top}px`,
                            width: '10px',
                            height: `${linkSpan.height}px`,
                          }}
                          viewBox={`0 0 10 ${linkSpan.height}`}
                          preserveAspectRatio="none"
                        >
                          {/*
                              A CUBIC, not a quadratic. One control point
                              gives a single shallow belly that barely leaves
                              the spine; two, held at a quarter and
                              three-quarters of the run, hold the curve out for
                              most of its length and make the departure and the
                              return the only steep parts. That is what reads
                              as a deliberate detour rather than a bent line.
                              `preserveAspectRatio="none"` keeps the vertical
                              scale honest while the 10px width stays 10px, so
                              the bow is the same depth on a short run and a
                              long one.

                              Bows AWAY from the cards, into the margin, so the
                              curve never passes under the text it is linking
                              and the cards keep a clean edge. `overflow-visible`
                              on the svg is what lets it draw outside its own
                              10px box to get there.

                              SVG coordinates do not mirror with `dir`, so RTL
                              is handled by flipping the control point's sign:
                              the spine sits on the right there, so its margin
                              is the positive direction rather than the
                              negative one.
                              because the spine sits on the opposite edge there
                              and a curve bowing the same way would cross the
                              text. `overflow-visible` is what lets it draw
                              outside its own box to reach the margin.
                          */}
                          <path
                            d={`M 5 0 C ${isRTL ? 23 : -13} ${linkSpan.height * 0.25} ${isRTL ? 23 : -13} ${linkSpan.height * 0.75} 5 ${linkSpan.height}`}
                            fill="none"
                            stroke="#C2410C"
                            strokeWidth="2"
                            strokeLinecap="round"
                            vectorEffect="non-scaling-stroke"
                            className="spine-link"
                          />
                        </svg>
                      )}

                      {SPINE.map((row, index) => (
                        <div key={row.key} className="relative py-2">
                          {/* The node on the spine: green where we finished,
                              orange where it is waiting for the owner, and
                              pulsing where somebody else is waiting on it. */}
                          <span
                            data-spine-node={index}
                            className={cn(
                              'absolute w-[9px] h-[9px] rounded-full',
                              rowBlocks(row) && 'spine-node-blocking'
                            )}
                            style={{
                              insetInlineStart: '-18px',
                              /*
                               * Beside whatever the row actually starts with.
                               *
                               * Every node sat at 15px, which is the height of
                               * a line of text. A row that HAS no line of text
                               * — the intake form, and the hours before they
                               * were set, neither of which the build reports —
                               * put its node in empty space above its card,
                               * attached to nothing. Measured against the
                               * card's own title instead, it reads as the
                               * card's node rather than as a stray dot.
                               */
                              top: row.built || row.done.length ? '15px' : '27px',
                              /* Orange only while something on this row is
                                 still owed. A row whose task is finished goes
                                 green like any other completed step. */
                              background: row.branches.length ? '#C2410C' : '#22C58B',
                              boxShadow: '0 0 0 2px var(--v2-bg)',
                            }}
                          />

                          {row.built && (
                            <p className="text-[12.5px] m-0 text-[var(--v2-text-muted)]">
                              <span className="text-[var(--v2-text-secondary)] font-medium">
                                {row.built.label}
                              </span>
                              {row.built.result ? ` · ${row.built.result}` : ''}
                            </p>
                          )}

                          {/* What the owner has finished since arriving here.
                              Drawn like a built line rather than like a card,
                              because that is what it now is: a thing that is
                              done. The tick is the only difference, and it is
                              theirs rather than ours. */}
                          {row.done.map(step => (
                            <p
                              key={step.id}
                              className="text-[12.5px] m-0 text-[var(--v2-text-muted)] flex items-center gap-1.5"
                            >
                              <Check className="w-3 h-3 flex-shrink-0" style={{ color: '#22C58B' }} />
                              <span className="text-[var(--v2-text-secondary)] font-medium">
                                {step.label}
                              </span>
                              <span>
                                {selectedLanguage === 'he' ? '· הוגדר' : selectedLanguage === 'es' ? '· listo' : '· done'}
                              </span>
                            </p>
                          ))}

                          {row.branches.map(step => {
                            const waitingOn = (step.dependsOn ?? []).filter(id =>
                              outstanding.some(other => other.id === id)
                            );
                            const names = waitingOn
                              .map(id => outstanding.find(other => other.id === id)?.label ?? id)
                              .join(selectedLanguage === 'he' ? ' ו' : selectedLanguage === 'es' ? ' y ' : ' and ');

                            return (
                              <div
                                key={step.id}
                                /* A grid, not a wrapping flex row. The
                                   button sat wherever the sentence left it:
                                   on the end of the last line for a short
                                   one, dropped onto its own line for a long
                                   one, so no two cards agreed on where the
                                   control was. A fixed second column puts
                                   every button on the same edge whatever the
                                   text does, and `items-start` keeps it level
                                   with the title rather than floating in the
                                   middle of a three-line card. */
                                className="mt-1.5 rounded-[10px] p-3 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3"
                                style={{
                                  background: 'rgba(194, 65, 12, 0.05)',
                                  border: '1.5px solid rgba(194, 65, 12, 0.45)',
                                }}
                              >
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span style={{ color: '#C2410C' }}>{step.icon}</span>
                                    <h4 className="text-[13px] font-semibold text-[var(--v2-text-primary)] m-0">
                                      {step.label}
                                    </h4>
                                  </div>
                                  <p className="text-[12px] leading-snug text-[var(--v2-text-secondary)] m-0 mt-1">
                                    {step.result}
                                  </p>
                                  {names && (
                                    <p className="text-[11.5px] leading-snug m-0 mt-1" style={{ color: '#C2410C' }}>
                                      {selectedLanguage === 'he'
                                        ? `אפשר למלא עכשיו, אבל הפרסום ימתין ל${names}.`
                                        : selectedLanguage === 'es'
                                          ? `Puedes completarlo ahora, pero publicar esperará a ${names}.`
                                          : `You can fill this in now, but publishing waits for ${names}.`}
                                    </p>
                                  )}
                                </div>
                                <button
                                  onClick={() => openOwnerStep(step.id)}
                                  className="px-3 py-1.5 text-[12px] font-semibold text-white rounded-lg whitespace-nowrap flex-shrink-0"
                                  style={{ background: '#C2410C' }}
                                >
                                  {step.id === 'availability'
                                    ? (selectedLanguage === 'he' ? 'הגדר שעות' : selectedLanguage === 'es' ? 'Definir horario' : 'Set hours')
                                    : step.id === 'intake'
                                      ? (selectedLanguage === 'he' ? 'בחר טופס' : selectedLanguage === 'es' ? 'Elegir formulario' : 'Choose a form')
                                      : step.id === 'stripe'
                                        ? (selectedLanguage === 'he' ? 'חבר את סטרייפ' : selectedLanguage === 'es' ? 'Conectar Stripe' : 'Connect Stripe')
                                        : step.id === 'mailbox'
                                          ? (selectedLanguage === 'he' ? 'חבר את תיבת הדואר' : selectedLanguage === 'es' ? 'Conectar el buzón' : 'Connect your mailbox')
                                          : (selectedLanguage === 'he' ? 'מלא פרטים' : selectedLanguage === 'es' ? 'Completar datos' : 'Fill in details')}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>

                    {/* The consequence of stopping here, said plainly. The
                        platform states the cost and then respects the choice,
                        which is the opposite of both nagging and deciding. */}
                    {/*
                        THE WAY OUT IS NOT THE FAINTEST THING ON THE SCREEN.
                        ──────────────────────────────────────────────────────
                        It was muted text in a hairline box, under four orange
                        cards with filled orange buttons, below the fold. The
                        platform states the cost and then respects the choice
                        — but a choice drawn as an afterthought is not being
                        respected, it is being discouraged.

                        Still secondary to the work above it, which is right:
                        bordered rather than filled, so it reads as the
                        alternative and not as the next step. What changed is
                        that it is now legible at a glance, which is the least
                        an escape hatch owes anybody.
                    */}
                    <button
                      onClick={leaveForDashboard}
                      className="w-full px-4 py-3 text-[14px] font-semibold text-[var(--v2-text-primary)] border-2 border-[var(--v2-border)] rounded-xl hover:border-[var(--v2-text-muted)] hover:bg-[var(--v2-surface)] transition-all"
                    >
                      {selectedLanguage === 'he' ? 'אעשה את זה מאוחר יותר' : selectedLanguage === 'es' ? 'Lo haré más tarde' : "I'll do this later"}
                    </button>
                    <p className="text-[11px] text-[var(--v2-text-muted)] text-center mt-2 mb-0 leading-snug">
                      {outstandingCost}
                    </p>
                  </>
                ) : (
                  <div className="text-center">
                    <div className="inline-flex items-center gap-1.5 text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-full mb-4 text-sm">
                      <CheckCircle2 className="w-4 h-4" />
                      <span className="font-medium">
                        {selectedLanguage === 'he' ? 'הכול מוכן' : selectedLanguage === 'es' ? 'Todo listo' : 'All set'}
                      </span>
                    </div>
                    <button
                      onClick={leaveForDashboard}
                      className="w-full px-4 py-3 bg-[#4F6EF7] text-white text-sm font-semibold rounded-lg hover:bg-[#3B5AE5] transition-all flex items-center justify-center gap-2"
                    >
                      {selectedLanguage === 'he' ? 'עבור לדשבורד' : selectedLanguage === 'es' ? 'Ir al dashboard' : 'Go to Dashboard'}
                      <ArrowRight className={cn('w-4 h-4', isRTL && 'rotate-180')} />
                    </button>
                  </div>
                )}
              </div>
            )}

            {/*
                The mailbox channel used to have a card of its own here, below
                the owner tasks. It is an owner task now — "only you can sign in
                to your own mailbox" is exactly what that list is for — so the
                card is gone and there is one surface with one state instead of
                two that can disagree.
            */}

            {/* Error State - Compact */}
            {buildError && (
              <div className="mt-5 space-y-2">
                <button
                  onClick={handleRetry}
                  className="w-full px-4 py-3 bg-[#4F6EF7] text-white text-sm font-semibold rounded-lg hover:bg-[#3B5AE5] transition-all"
                >
                  {selectedLanguage === 'he' ? 'נסה שוב' : selectedLanguage === 'es' ? 'Intentar de nuevo' : 'Try Again'}
                </button>

                <button
                  onClick={handleGoBack}
                  className="w-full px-4 py-2.5 bg-[var(--v2-surface)] text-[var(--v2-text-primary)] text-sm font-medium border border-[var(--v2-border)] rounded-lg hover:bg-gray-50 transition-all"
                >
                  {selectedLanguage === 'he' ? 'חזור לצ\'אט' : selectedLanguage === 'es' ? 'Volver al chat' : 'Go Back to Chat'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      {/* closes the scroller opened above */}
      </div>

      {/* The work only the owner can do, opened where they are.
          These are the dialogs the dashboard uses — self-contained, fetching
          their own data — so mounting one here costs nothing and keeps the
          user on the screen that is telling them why it matters. */}
      {/* PERF-1: the dialog is lazy, and this page sits outside the Business OS
          layout whose closed instance warms it everywhere else. This closed
          instance does the same here: it draws nothing and fetches nothing
          (every effect inside is gated on `isOpen`), but mounting it loads the
          chunk after first paint, so the dialogs below open in their first
          frame, exactly as when the dialog shipped with the page. */}
      <LazyConfigurationDialog isOpen={false} onClose={() => undefined} />

      {/*
        The same four-screen setup the dashboard opens, mounted here so the
        owner task does not send anybody to another page to do it.

        Opened by EITHER route: `openStep === 'mailbox'` is the task row, which
        is what `thePlanAndTheBuildAgree` checks for, and `inboxSetupOpen` is
        kept because the dialog closes itself and the step has to clear with it.
      */}
      <InboxChannelSetupDialog
        open={openStep === 'mailbox' || inboxSetupOpen}
        onOpenChange={open => {
          setInboxSetupOpen(open);
          if (!open && openStep === 'mailbox') closeOwnerStep('mailbox');
        }}
        status={inboxChannel}
        onEnabled={status => {
          setInboxChannel(status);
          /* Connected is the whole of this task, so it settles on the spot
             rather than waiting for the reconciliation pass. */
          settleOwnerStep('mailbox');
        }}
        onStatusChanged={setInboxChannel}
      />

      {/*
          CLOSING IS NOT FINISHING.
          ──────────────────────────────────────────────────────────────────────
          These three passed `settleOwnerStep` as their `onClose`, so opening a
          card and shutting it again marked the work done and took the card off
          the screen. An owner who opened their working hours, looked, and
          closed without setting any had the reminder removed for them.

          The two cards that were not wired this way show what right looks
          like: Stripe settles on `onComplete` and merely closes on
          `onCancel`, and the bank panel settles on its own Done button. A
          dialog's close button means "not now", and the platform has a
          separate, explicit way to say "later" for the whole screen, which is
          the "I'll do this later" button below the cards.

          So these now only close. A card stays until the owner either
          finishes the work or leaves for the dashboard, which is where they
          can finish it in their own time.
          ──────────────────────────────────────────────────────────────────────
      */}
      {/* The same dialog the dashboard uses, opened on its services tab.
          Prices and durations are what the drafts are missing, and this is
          where they are typed everywhere else in the product. */}
      {openStep === 'services' && (
        <LazyConfigurationDialog
          isOpen
          initialTab="services"
          visibleTabs={['services']}
          onClose={() => closeOwnerStep('services')}
        />
      )}

      {openStep === 'availability' && (
        <LazyConfigurationDialog
          isOpen
          initialTab="availability"
          visibleTabs={['availability']}
          onClose={() => closeOwnerStep('availability')}
        />
      )}

      {openStep === 'intake' && (
        <LazyConfigurationDialog
          isOpen
          initialTab="intake"
          visibleTabs={['intake']}
          onClose={() => closeOwnerStep('intake')}
        />
      )}

      {/* The wizard renders as a bare `max-w-lg mx-auto` with no ground of its
          own — inside the configuration dialog it sits on that dialog's
          surface. Dropped straight onto a scrim it was transparent, so the
          surface has to come from here. */}
      {openStep === 'stripe' && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-3">
          {/*
            A flex COLUMN, not one scrolling box.

            This was a single `overflow-y-auto` panel with everything inside it,
            which is why the wizard's sticky step indicator never held: sticky
            pins to the nearest scrolling ancestor, and that was the same element
            as the title, so the header scrolled away with the form. A column
            with its own non-scrolling header and a bounded body gives the
            indicator something to stick to — and gives the dialog the shape
            every other dialog in the platform has.

            `max-h`, NOT a fixed height. A fixed one forced every step to the
            full 90dvh, so the country step — a title and one field — opened as
            a tall box with a large empty area under its buttons. It also broke
            the footer: `sticky bottom-0` cannot push an element past its own
            parent, and the parent was only as tall as the short form, so the
            buttons sat at the end of the content with the dead space below
            them rather than at the foot of the dialog.

            With `max-h` the panel hugs its content and the buttons land at the
            bottom because the bottom is where the content ends. On a long step
            the body overflows, and the same sticky footer then has room to pin.

            `dvh` because a phone reports `vh` without its address bar.
          */}
          <div
            className="w-full max-w-2xl max-h-[90dvh] flex flex-col overflow-hidden bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-2xl shadow-2xl"
            dir={isRTL ? 'rtl' : 'ltr'}
          >
            {/* Header — the same shape the invoice and ledger dialogs use: a
                tinted icon tile, the name, and what the screen is for. It was a
                14px bold line with a close button, which read as a section
                label rather than the title of a five-step form. */}
            <div className="flex-shrink-0 flex items-start gap-3 border-b border-[var(--v2-border)] px-5 py-4">
              <span
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center"
                style={{ backgroundColor: 'rgba(99, 91, 255, 0.12)', borderRadius: 'var(--v2-radius-button)' }}
              >
                <CreditCard className="h-5 w-5" style={{ color: '#635BFF' }} />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="m-0 text-[15px] font-semibold text-[var(--v2-text-primary)]">
                  {selectedLanguage === 'he' ? 'חיבור תשלומים' : selectedLanguage === 'es' ? 'Conectar pagos' : 'Connect payments'}
                </h3>
                <p className="mt-0.5 text-[12px] text-[var(--v2-text-muted)]">
                  {selectedLanguage === 'he'
                    ? 'כדי שתוכל/י לקבל תשלומים בכרטיס'
                    : selectedLanguage === 'es'
                      ? 'Para que puedas cobrar con tarjeta'
                      : 'So you can take card payments'}
                </p>
              </div>
              <button
                onClick={() => closeOwnerStep('stripe')}
                className="flex-shrink-0 p-1 text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)]"
                aria-label={selectedLanguage === 'he' ? 'סגור' : selectedLanguage === 'es' ? 'Cerrar' : 'Close'}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body — the only thing that scrolls, so the wizard's own sticky
                indicator and buttons pin to THIS and stay on screen. */}
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <StripeConnectWizard
                onComplete={() => settleOwnerStep('stripe')}
                onCancel={() => closeOwnerStep('stripe')}
              />
            </div>
          </div>
        </div>
      )}

      {/* Bank and company details, in place.
          These used to send the user to the settings page, which walked away
          from the last mile with every other open item still on it — the exact
          failure this screen exists to prevent, reintroduced for one card. The
          settings section is a component, so it can be mounted here like the
          rest. */}
      {/* The panel fits the window; the FORM scrolls inside it.
          It used to grow to whatever the invoice form needed and let the
          backdrop scroll, which pushed the title off the top and the Done
          button below the fold — so the way out of the dialog was the one
          thing you could not see. Header and footer are pinned, and only the
          middle moves. */}
      {openStep === 'bank' && userId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-3">
          <div
            className="w-full max-w-2xl max-h-[calc(100dvh-1.5rem)] flex flex-col bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-2xl shadow-2xl overflow-hidden"
            dir={isRTL ? 'rtl' : 'ltr'}
          >
            <div className="flex-shrink-0 flex items-center justify-between gap-3 px-4 pt-4 pb-2.5">
              <h3 className="text-[14px] font-bold text-[var(--v2-text-primary)] m-0">
                {selectedLanguage === 'he' ? 'פרטי החברה והבנק' : selectedLanguage === 'es' ? 'Datos de empresa y banco' : 'Company and bank details'}
              </h3>
              <button
                onClick={() => closeOwnerStep('bank')}
                className="p-0.5 text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)]"
                aria-label={selectedLanguage === 'he' ? 'סגור' : selectedLanguage === 'es' ? 'Cerrar' : 'Close'}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/*
                THE PANEL'S TITLE, PINNED, WITHOUT THE COLLAPSE CONTROL.
                ──────────────────────────────────────────────────────────────
                The section draws its own accordion header when `chrome` is on,
                and that header came with a chevron: a control offering to
                collapse the only thing this dialog exists to show, under a
                second title a few pixels below the dialog's own.

                Turning `chrome` off removed the chevron and the title with it,
                and the title was worth keeping. So it is drawn here instead,
                OUTSIDE the scroller, which is the other half of the same fix:
                the heading stays put and the form scrolls beneath it, rather
                than the heading sliding away and the scrollbar starting above
                the words it belongs to.

                Same translation keys the section uses, so the two cannot drift
                into saying different things about one panel.
            */}
            <div className="flex-shrink-0 px-4 pb-2 flex items-center gap-2.5">
              <FileText className="w-4 h-4 flex-shrink-0 text-[var(--v2-text-muted)]" />
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-[var(--v2-text-primary)] m-0 leading-tight">
                  {t('settings.invoice.title') || 'Invoice Settings'}
                </p>
                <p className="text-[11.5px] text-[var(--v2-text-muted)] m-0 leading-snug">
                  {t('settings.invoice.subtitle') || 'Set how your invoices look and what they say'}
                </p>
              </div>
            </div>

            {/* `pb-4` because the panel's own Save sits at the very bottom of
                this scroller and the footer below has a top border: with no
                room between them the button touched the rule and read as
                overlapping it. Padding inside the scroller rather than a
                margin on the footer, so the gap scrolls with the content
                instead of eating height from the fixed part. */}
            <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
              {/* No processor here.
                  This step exists BECAUSE the business invoices — it is the
                  bank details that go on the invoice so a client knows where to
                  send the money. A "connect payments" panel inside it offers
                  the opposite arrangement, and this screen already carries its
                  own Stripe step for the businesses that take cards. Two doors
                  to the same place, one of them in the wrong room. */}
              <InvoiceSettingsSection
                userId={userId}
                /*
                 * NO ACCORDION HEADER INSIDE A DIALOG THAT ALREADY HAS A TITLE.
                 *
                 * `chrome` defaults to true, so this drew "Invoice Settings /
                 * Set how your invoices look and what they say" with a collapse
                 * chevron, directly beneath the dialog's own "Company and bank
                 * details". Two titles for one panel, and a control that
                 * offered to hide the only thing the dialog exists to show.
                 *
                 * The prop's own comment says exactly this about the settings
                 * tab, which was the other caller that had already hit it: "a
                 * header here would be a second title for the same thing, and
                 * the collapse control would hide content the tab exists to
                 * show." A dialog is the same situation.
                 *
                 * `expanded` and `onToggle` are ignored once chrome is off, and
                 * are kept only because the props are not optional.
                 */
                chrome={false}
                expanded
                onToggle={() => {}}
                showProcessor={false}
                /* A save that completes the details takes the card away. One
                   that does not leaves the dialog open on the missing field,
                   rather than closing on work that is not finished. */
                onSaved={() => { void verifyOwnerStep('bank'); }}
              />
            </div>

            <div className="flex-shrink-0 border-t border-[var(--v2-border)] px-4 pb-4 pt-3 space-y-3">
              {/* Asked, not assumed.
                  A business that invoices may still want a card taken now and
                  then, and this is the moment it is thinking about getting
                  paid. What was here before was a "Payment Setup Required"
                  panel that announced a requirement — for something this
                  business chose not to do. An offer with a plain no is the
                  same door, without the accusation.

                  Hidden once connected: there is nothing left to offer. */}
              {!collectsOnlineSome && (
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <p className="text-[12px] text-[var(--v2-text-muted)] m-0 min-w-0">
                    {selectedLanguage === 'he'
                      ? 'רוצה שלקוחות יוכלו גם לשלם בכרטיס?'
                      : selectedLanguage === 'es'
                        ? '¿Quieres que tus clientes también puedan pagar con tarjeta?'
                        : 'Want clients to be able to pay by card as well?'}
                  </p>
                  <button
                    onClick={() => setOpenStep('stripe')}
                    className="flex-shrink-0 px-3 py-1.5 text-[12px] font-medium rounded-lg border border-[var(--v2-border)] text-[var(--v2-text-primary)] hover:bg-[var(--v2-bg)] transition-colors"
                  >
                    {selectedLanguage === 'he' ? 'חבר תשלומים' : selectedLanguage === 'es' ? 'Conectar pagos' : 'Connect payments'}
                  </button>
                </div>
              )}

              {/*
                  THE "DONE" BUTTON WAS HERE, and it was the worst control on
                  the screen.
                  ──────────────────────────────────────────────────────────────
                  The panel above has its own Save, which writes. This was a
                  second button, wider and brighter, which did not: it only
                  marked the card settled. So the dialog offered two buttons
                  that looked like the same promise, and the louder one threw
                  the work away.

                  Reported exactly that way: "I typed the tax ID and then on
                  done button not saved, it first didn't save it and the card
                  was gone again. The save and done together can mislead."

                  Both halves of that are right, and removing this fixes both.
                  There is now ONE button that commits, the panel's own Save,
                  and the X closes. The card settles when a save leaves the
                  invoice details complete, which `onSaved` below reports and
                  `PROOF_OF_DONE.bank` checks against the same four fields the
                  publish gate asks for.
              */}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
