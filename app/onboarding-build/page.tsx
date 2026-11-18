'use client';

import React, { useState, useEffect, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Building2,
  Mail,
  Users,
  Calendar,
  CreditCard,
  Globe,
  Check,
  CheckCircle2,
  Loader2,
  ArrowRight,
  ClipboardList,
  FileText,
} from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { marketingLoginUrl } from '@/lib/utils/marketingUrl';
import { Logo } from '@/components/brand/Logo';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { SetupFactCard, SetupFactDeck } from '@/components/business-os/setup/SetupFactCard';
import { LazyConfigurationDialog } from '@/components/business-os/lazyDialogs';
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
    /** And whether that site's enquiries reach a mailbox — the follow-up, asked
     *  only of those owners. Null means "not established". */
    leads_arrive_by_email?: boolean | null;
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
  /* `userId` was held here only to mount the invoice settings panel in place.
     With that panel gone, nothing on this screen needs to know who is looking
     at it: the dashboard's own surfaces resolve the user themselves. */
  const [buildError, setBuildError] = useState<string | null>(null);
  const [buildSteps, setBuildSteps] = useState<BuildStep[]>([]);

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
        /* The follow-up's answer, which is what the mailbox task actually
           depends on: connecting a mailbox is pointless for a site whose
           enquiries never reach one. */
        leadsArriveByEmail: data.configuration?.leads_arrive_by_email === true,
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
        const storedData = sessionStorage.getItem('onboarding_preview_data');
        if (storedData && !cancelled) {
          const parsed = JSON.parse(storedData) as PreviewData;
          setPreviewData(parsed);

          // Came back to a build that already ran: show the report again
          // rather than building everything a second time.
          if (sessionStorage.getItem('onboarding_build_complete') === '1') {
            buildStartedRef.current = true;
            setBuildSteps(initializeBuildSteps(parsed).map((step: BuildStep) =>
              step.yours ? step : { ...step, status: 'completed' as const }
            ));
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

  const outstanding = buildSteps.filter(step => step.yours);


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
  /*
   * THE DEPENDENCY LINK WENT WITH THE CONFIGURATION.
   * ───────────────────────────────────────────────────────────────────────────
   * A measured curve used to leave the spine and come back, joining the row
   * that was blocking to the row that was waiting, with "you can fill this in
   * now, but publishing waits for your hours" under the card. It was drawn
   * carefully and it was answering the wrong question: it existed so an owner
   * could sequence four pieces of configuration by hand, on a screen that no
   * longer configures anything.
   *
   * `dependsOn` is still filled by `ownerTasks` and still read by the plan
   * card, so nothing is lost — what went is this screen's attempt to make an
   * owner hold the graph in their head. Each service now names its own
   * requirements where it is edited, which is the same information with
   * nobody left to sequence it.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const spineRef = React.useRef<HTMLDivElement>(null);


  /**
   * The only way out of this screen.
   *
   * The preview payload and the build-complete marker go: both describe work
   * that is finished, and keeping them would send a returning user back into a
   * build that has already run.
   *
   * `onboarding_build_settled` IS NO LONGER WRITTEN, and that is deliberate.
   *
   * It recorded which owner-only steps were finished ON THIS SCREEN, which was
   * worth carrying to the dashboard while this screen could finish them. It
   * cannot any more: nothing here settles anything, so the key would only ever
   * say "none", and a stale one from an earlier session saying otherwise would
   * be worse than its absence.
   *
   * Not removed from the sign-out sweep in `lib/client/auth-actions.ts`:
   * clearing a key nobody writes costs nothing, and an account that still has
   * one from before this change is tidied up by it.
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
              {/*
                ─────────────────────────────────────────────────────────────
                NO ICON ABOVE THE HEADING.

                A 56px gradient tile sat here carrying a pulsing mark while the
                build ran, a tick when it finished and a warning when it failed.
                Removed on the owner's instruction, and it costs nothing: the
                heading directly below already says which of the three this is,
                in the reader's own language, and the state is repeated by every
                card on the screen and by the progress bar.

                What it did cost was the first impression of the screen that
                shows a business being built: a decorative badge, the biggest
                thing in the header, saying nothing the words did not.
                ─────────────────────────────────────────────────────────────
              */}

              {/*
                ONE HEADLINE FOR A FINISHED BUILD, whatever is outstanding.
                ──────────────────────────────────────────────────────────────
                It read "Almost there" and counted what the owner still owed,
                which made a successful build announce itself as a shortfall.
                The work it was counting is not done here any more — it is
                sequenced on the dashboard, one step at a time — so counting it
                here was both discouraging and a second plan.
              */}
              <h1 className="text-xl font-bold text-[var(--v2-text-primary)] mb-1">
                {buildComplete
                  ? (selectedLanguage === 'he' ? 'המערכת שלך בנויה' : selectedLanguage === 'es' ? 'Tu sistema está listo' : 'Your system is built')
                  : buildError
                  ? (selectedLanguage === 'he' ? 'אירעה שגיאה' : selectedLanguage === 'es' ? 'Ocurrió un error' : 'An Error Occurred')
                  : (selectedLanguage === 'he' ? 'בונה את המערכת שלך' : selectedLanguage === 'es' ? 'Construyendo tu sistema' : 'Building Your System')}
              </h1>

              <p className="text-sm text-[var(--v2-text-secondary)]">
                {buildComplete
                  ? (selectedLanguage === 'he'
                      ? 'הנה מה שבניתי לך. הדשבורד ילווה אותך בשלב הבא.'
                      : selectedLanguage === 'es'
                        ? 'Esto es lo que construí para ti. El panel te guiará por lo que sigue.'
                        : 'Here is what I built for you. Your dashboard takes you through what comes next.')
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
            {/*
                DURING THE BUILD *AND* AFTER IT.
                ──────────────────────────────────────────────────────────────
                These cards — each naming a thing that was built, with the bar
                travelling along the one in progress — ARE this screen. They
                were drawn only while `isBuilding` was true, and replaced on
                completion by a thin text spine saying the same facts again in
                fewer words, so the moment the build finished the thing the
                owner had been watching disappeared.

                Keyed on having steps rather than on a phase: the restore path
                sets `buildComplete` without ever setting `isBuilding`, so a
                refresh lands on the same cards instead of an empty frame.
            */}
            {!buildError && buildSteps.length > 0 && (
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
                     * is what `ownerTasks` names each piece of work by, and
                     * what the spine groups the branches under.
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
                    /* The brand token, not a hardcoded indigo. `--v2-primary` is what
                       every primary surface in the product paints with, orange
                       for this business and indigo by default, and this layout
                       already injects the custom tokens. A literal #4F6EF7 is a
                       rebrand away from being the only blue on the screen. */
                    className="h-full bg-[var(--v2-primary)] transition-all duration-500 ease-out"
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
                {/*
                  ONE ENDING, WHATEVER IS OUTSTANDING.
                  ────────────────────────────────────────────────────────────
                  This branched on `outstanding.length`: a business with work
                  left saw the spine, and a business with none saw an "All set"
                  pill and a button. With the owner's work gone from this
                  screen the split had become actively wrong — the report of
                  what was built, and the capabilities it switched on, would
                  have been hidden from exactly the account that had the most
                  to show.
                */}
                {(
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
                        was the spine that used to sit below, which answered
                        the same question — what is missing, and what it costs
                        — against the build rather than against each service.
                        That has gone too; the dashboard asks it now.

                        Two displays of one fact is what this screen has just
                        spent a day removing, so the one that says it once wins.
                        The strip still lives where its own comment says it
                        belongs, beside the setting being changed: the services
                        editor, the service modal, the publish dialog and the
                        website wizards.
                    */}

                    {/*
                      THE SPINE WAS HERE, and it said the same facts twice.
                      ──────────────────────────────────────────────────────
                      A thin text list — "Your business · Profile created",
                      "What you sell · 2 services created as drafts" — drawn
                      directly beneath the cards that had just said exactly
                      that, with the owner's outstanding work branching off it
                      in orange.

                      Both halves are gone for the same reason. The work is
                      sequenced on the dashboard now, one step at a time, so
                      listing it here was a second plan read before the owner
                      had seen the first. And with the branches gone the spine
                      was a duplicate of the deck above it, in fewer words.

                      The cards stay because they are what the owner watched
                      being built.
                    */}

                    {/*
                        AND IT IS NOW THE WAY ON, NOT THE WAY OUT.
                        ──────────────────────────────────────────────────────
                        This was the escape hatch: bordered, secondary, reading
                        as the alternative to four cards with filled buttons on
                        them. It had already been rescued once from being the
                        faintest thing on the screen.

                        With the configuration gone from this phase there is no
                        longer anything here to escape FROM. The cards above
                        state what is coming, this button goes to the one place
                        that work happens, and so it is the primary action —
                        the same button the finished account gets, which is the
                        point: an owner with three things outstanding and an
                        owner with none both leave by the same door, and
                        neither is made to feel they are skipping something.

                        The cost line that used to sit underneath went with the
                        task cards: it named work this screen no longer lists.
                    */}
                    <button
                      onClick={leaveForDashboard}
                      className="w-full px-4 py-3 bg-[var(--v2-primary)] ap-primary-lift text-white text-[14px] font-semibold rounded-xl transition-all active:scale-[0.97] flex items-center justify-center gap-2"
                    >
                      {selectedLanguage === 'he' ? 'עבור לדשבורד' : selectedLanguage === 'es' ? 'Ir al dashboard' : 'Go to Dashboard'}
                      <ArrowRight className={cn('w-4 h-4', isRTL && 'rotate-180')} />
                    </button>
                    {/* `outstandingCost` went with the task cards. It named
                        what stopping here would cost — "your clients cannot
                        book yet" — which is a sentence about work this screen
                        no longer lists, and the dashboard says it beside the
                        step it belongs to. */}
                  </>
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
                  className="w-full px-4 py-3 bg-[var(--v2-primary)] ap-primary-lift text-white text-sm font-semibold rounded-lg transition-all active:scale-[0.97]"
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
          NOTHING ELSE IS MOUNTED HERE, AND THAT IS THE CHANGE.
          ──────────────────────────────────────────────────────────────────────
          Six configuration surfaces used to hang below this line: the mailbox
          wizard, the services editor, availability, the intake picker, the
          Stripe wizard and the invoice panel. Opening any of them made this
          screen a second place to configure the business, one click after the
          interview and one click before the dashboard, with its own order, its
          own words for the same work and its own idea of when a task was
          finished. Three separate bugs came out of that last part alone: a
          dialog that counted "closed" as "done", a card that nagged about
          finished work, and a gap check that read "nothing to see" as "nothing
          wrong".

          Setup is not a phase any more. A service asks for what it needs where
          it is edited, so the work has one home, one vocabulary and one
          moment. This screen reports what was built, names what is coming, and
          opens the door.

          The closed instance above stays: it is a prewarm, it draws nothing and
          fetches nothing (every effect inside is gated on `isOpen`), and it is
          what keeps the dashboard's own dialogs opening in their first frame.
          ──────────────────────────────────────────────────────────────────────
      */}
    </div>
  );
}
