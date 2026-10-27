'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Bot, Loader2, Send, User, Sparkles, Check, Plus, Trash2, X, Building2, Users, Calendar, ClipboardList, CreditCard, Globe, Share2, XCircle, Lock, FileText } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { SessionHandler } from '@/components/SessionHandler';
import { Logo } from '@/components/brand/Logo';
import { useV2Theme } from '@/lib/design-system-v2';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { SetupFactCard, SetupFactDeck } from '@/components/business-os/setup/SetupFactCard';
import { currencySymbol, currencyForLanguage, currencyFromText } from '@/lib/business-os/currency';
import { ServicePaymentOptions } from '@/components/scheduling/ServicePaymentOptions';
import { ServiceCurrencySelect, getCurrencySymbol } from '@/components/scheduling/ServiceCurrencySelect';
import { ownerTasks } from '@/lib/business-os/onboarding/ownerTasks';
import { cn } from '@/lib/utils';
import { clientLogger } from '@/lib/logger/client';

const logger = clientLogger.child({ module: 'OnboardingChatPage' });

/**
 * The two voices of the interview, as a tint of the surface beneath them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The bubble and the avatar beside it are ONE object visually, so they share
 * one definition here rather than repeating a `color-mix` in two places that
 * can drift apart. Change a number once and the pair moves together.
 *
 * Tints, never literals. `--v2-primary` is overridden per business — indigo by
 * default, orange on some — so a fixed rgba would be correct for exactly one
 * tenant. Mixing with `--v2-surface` also keeps each honest in both themes:
 * the same percentage lands on white in light mode and on #1E293B in dark,
 * instead of one pale colour glowing on a dark page.
 *
 * WHY 34 AGAINST 9. The assistant is the quieter half: it asks, and its words
 * should sit on the page rather than shout from it. The person's own answers
 * are what they scan back through, so that side carries more of the brand.
 * They were first brought to 14 and 9, which made the two bubbles the same
 * object in two barely different shades and lost the sense of a dialogue
 * altogether. Contrast does not bound these numbers — the text clears AA on
 * every theme-and-brand pair well past 50% — staying quieter than a solid fill
 * does.
 *
 * Where `color-mix` is unsupported the declarations are dropped and the plain
 * surface classes beneath still paint: quieter than intended, never broken.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const VOICE_TINT = {
  assistant: {
    background: 'color-mix(in srgb, var(--v2-secondary) 9%, var(--v2-surface))',
    borderColor: 'color-mix(in srgb, var(--v2-secondary) 30%, var(--v2-border))',
  },
  user: {
    background: 'color-mix(in srgb, var(--v2-primary) 34%, var(--v2-surface))',
    borderColor: 'color-mix(in srgb, var(--v2-primary) 55%, var(--v2-border))',
  },
} as const;

/**
 * The platform orange, for a button that moves the owner forward.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `#F97316` with `#EA580C` beneath it is what every primary action in Business
 * OS is painted with — the dashboard, the chat command panel, the preview
 * panel. This page used `--v2-primary` for all of its buttons, which is the
 * indigo, so the onboarding looked like a different product from the one it
 * was setting up.
 *
 * A RAW HEX, matching the hundred-odd other uses of it. It is not a token,
 * which it should be: a brand colour spelled out in a hundred files is one
 * find-and-replace away from a rebrand that misses a few. Introducing
 * `--v2-brand` is a design-system change and wants SA review rather than being
 * slipped in under a button fix, so this at least keeps the page down to one
 * definition instead of adding more scattered copies.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const ORANGE_BUTTON =
  'text-white bg-[#F97316] border border-[#EA580C] hover:bg-[#EA580C] ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F97316] focus-visible:ring-offset-1';

interface ServiceInput {
  name: string;
  duration: string;
  price: string;
  /**
   * What this service is charged in — and, through it, what the BUSINESS is.
   *
   * Chosen, not inferred from the interface language: a practice working in
   * Hebrew and serving clients abroad charges in dollars, and a symbol derived
   * from the reading language put the wrong one on every price it had.
   *
   * NULL UNTIL SOMEBODY CHOOSES. It used to be pre-filled on every row, which
   * broke the thing it was feeding: `resolveBusinessCurrency` takes the first
   * service carrying a currency and only falls back to the language when none
   * does — so a pre-filled row meant that fallback could never run, and the
   * default arrived looking exactly like a deliberate answer.
   *
   * Worse, the first row's pre-fill was evaluated at first render, when
   * `selectedLanguage` is still its `'en'` default and before the owner has
   * said a word. A Hebrew business that never opened the picker got USD on
   * service one — and service one is the row that decides the business.
   *
   * Same lesson as `user_preferences.timezone`: a field that cannot express
   * "nobody said" cannot be read reliably for what anybody did say.
   */
  currency: 'USD' | 'EUR' | 'ILS' | 'GBP' | null;
  /**
   * The two facts that decide this service's client journey, asked here
   * because this is where the person is already typing a duration and a price.
   * Whether the business needs working hours or a card processor is then read
   * off the services rather than asked as a question of its own.
   */
  isScheduled: boolean;
  /**
   * The gap needed between appointments.
   *
   * Asked beside the duration because it is the same kind of fact and the same
   * person is already typing one — and because it was never asked at all
   * before, so every service set up in onboarding silently took the platform's
   * fifteen minutes whether or not that suited the work.
   */
  bufferMinutes: string;
  /**
   * Can a client buy this outright, or is it quoted first?
   *
   * Asked here rather than inferred from a blank price. The inference is what
   * this codebase had to do before the fact existed, and it gets the common
   * case right and the important one wrong: a programme with a real figure that
   * is still quoted per client came out directly bookable.
   */
  saleMode: 'direct' | 'proposal';
  collection: 'online' | 'invoice';
  /** Mirrors `scheduling_services.payment_type`. */
  paymentType: 'full' | 'installments';
  installmentCount: string;
  installmentFrequency: 'weekly' | 'biweekly' | 'monthly' | 'quarterly';
  /** Mirrors the service settings: when the first instalment falls due. */
  firstPaymentDue: 'on_booking' | 'days_after';
  firstPaymentDays: string;
}

interface Message {
  role: 'assistant' | 'user';
  content: string;
  suggestions?: string[];
  multiSelect?: boolean;  // If true, show checkboxes instead of single-select buttons
}

interface PreviewData {
  businessProfile?: {
    company_name?: string;
    vertical?: string;
    verticalDisplayName?: string; // Translated display name for the vertical
    language?: string;
  };
  pipelineStages?: Array<{
    stage_key: string;
    stage_label: string;
    position: number;
    color: string;
    /** What the stage means. One of them is where a contact becomes a client. */
    stage_type?: 'lead' | 'prospect' | 'client' | 'past_client' | 'lost' | 'archived';
    is_primary_client_stage?: boolean;
  }>;
  services?: Array<{
    service_name: string;
    duration_minutes: number | null;
    price: number | null;
    currency?: string;
    /** Does a client pick a time? Decides the date step in this service's journey. */
    is_scheduled?: boolean;
    /** The gap needed between appointments. Absent means the platform default. */
    buffer_minutes?: number | null;
    /**
     * Can a client buy this outright, or is it quoted first?
     *
     * Carried through the editor because the chat can already infer it — the
     * extraction prompt has worked examples in both languages — and rebuilding
     * the service without it on confirm silently turned every quoted service
     * into a directly bookable one.
     */
    sale_mode?: 'direct' | 'proposal';
    /** How the money arrives. Null while the service is free. */
    collection?: 'online' | 'invoice' | null;
    /** Paying over time. Independent of the price: a quoted project can still
        be three monthly payments, agreed once the figure is. */
    payment_plan?: {
      installment_count: number;
      installment_frequency: 'weekly' | 'biweekly' | 'monthly' | 'quarterly';
    } | null;
  }>;
  businessDescription?: string;
  // Full configuration from OnboardingConfigurationService
  configuration?: {
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
      currency?: string | null;
      payment_plan?: {
        installment_count: number;
        installment_frequency: 'weekly' | 'biweekly' | 'monthly' | 'quarterly';
      } | null;
      is_scheduled?: boolean;
      buffer_minutes?: number;
      sale_mode?: 'direct' | 'proposal';
    }>;
    /**
     * HOW MANY services to create, which is usually all the interview knows.
     *
     * ───────────────────────────────────────────────────────────────────────
     * Why the plan card showed nothing about services.
     *
     * The services question asks for a COUNT, not a catalogue: the chat used
     * to render a fifteen-column grid to collect every field of every service
     * before anything existed, which is not a conversation and is where owners
     * stopped. So `services` is normally EMPTY and `service_count` holds the
     * answer, and the build creates that many drafts from it.
     *
     * This card rendered its services block on `services.length > 0` alone,
     * and this field was not even declared on the type, so the one number that
     * knew three services were coming was invisible to the page. Three rows
     * were created by a build whose own plan screen had not mentioned them.
     * ───────────────────────────────────────────────────────────────────────
     */
    service_count?: number;
    online_presence_mode?: 'full_website' | 'booking_only' | 'website_only' | 'none';
    /** They told us they already have a site. Null means "not established". */
    has_website?: boolean | null;
    /** How money actually arrives — the answer that decides whether Stripe is needed at all. */
    collection_method?: 'card_online' | 'invoice' | 'in_person' | 'mixed' | 'none';
    /*
     * Two facts the interview settles that this type never declared.
     *
     * Both are real `ConfigFactKey`s (lib/business-os/onboarding/
     * configurationInference.ts) and both are carried through
     * `computeConfiguration` — `theChainHoldsEndToEnd.test.ts` sends
     * `sells_scheduled: true` down exactly this path. The preview reads them
     * a few hundred lines below; without them on the type the reads were
     * errors, and TypeScript was right to say the shape did not admit them.
     */
    sells_scheduled?: boolean;
    needs_intake?: boolean;
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

export default function OnboardingChatPage() {
  const router = useRouter();
  /**
   * The scrolling message list itself.
   *
   * Needed because `scrollIntoView` cannot be told to leave the WINDOW alone:
   * it walks up and scrolls every scrollable ancestor until the target is in
   * view, and this page's root is `min-h-screen`, so the window is one of them.
   * Setting `scrollTop` on this element moves this element and nothing else.
   */
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  /** First paint should land at the bottom, not animate to it. */
  const hasScrolledOnce = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { mode } = useV2Theme();
  // `t` is pulled in so the payment dialog can use the very same strings the
  // service settings dialog does, rather than a second translation of the same
  // three controls.
  const { setLanguage, t } = useLanguage();

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [currentStep, setCurrentStep] = useState<string>('welcome');
  /*
   * The question outstanding within the step.
   *
   * `service_details` is a loop — details, "any more?", details again — and
   * the step does not change across it. Without this the form could only be
   * opened once.
   */
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  /**
   * What the conversation knows so far, in the shape the setup chain reads.
   *
   * Arrives on every turn, not only at the preview: the panel beside the chat
   * is the point — the user watches their setup assemble while they answer,
   * and watches steps come off the board when an answer removes them.
   */
  /** Which service row has its payment options open, if any. */
  const [paymentDialogIndex, setPaymentDialogIndex] = useState<number | null>(null);
  /**
   * Clients fill in a form before their appointment.
   *
   * One answer for the business rather than a column per service, because the
   * platform stores a single form. Asked here, in the form they are already
   * filling in, rather than as a question of its own — it is a yes or no, and
   * a whole conversational turn is too much to spend on one.
   */
  const [needsIntake, setNeedsIntake] = useState(false);
  /**
   * The plan is a screen, not the last message in a thread.
   *
   * It is the moment the user decides whether to build a business on this, and
   * reading it at the bottom of a conversation — under the scroll, beside the
   * composer, competing with the transcript — made a decision look like a
   * remark. The chat gives way to it, and comes back the moment they say
   * something needs changing.
   */
  const [adjustingPlan, setAdjustingPlan] = useState(false);
  /**
   * The business name, being corrected on the plan.
   *
   * It is never asked for: it is inferred from whatever they wrote about their
   * business, and falls back to "your business" when they never said it. There
   * was then nowhere to fix it — the adjustment flow understands services,
   * pipeline and payments, and nothing about a name — so a business could be
   * built under the wrong one, and every invoice and email would carry it.
   *
   * A name is a text field, not a sentence to be interpreted.
   */
  const [editingName, setEditingName] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);

  // Track the language selected during THIS onboarding session
  // IMPORTANT: Always start in English (LTR) - only switch to Hebrew after user explicitly selects it
  const [selectedLanguage, setSelectedLanguage] = useState<'en' | 'he' | 'es'>('en');

  // Services form modal state
  const [showServicesForm, setShowServicesForm] = useState(false);
  const [servicesInput, setServicesInput] = useState<ServiceInput[]>([
    {
      name: '',
      duration: '60',
      price: '',
      // Null until chosen — see the field's own note. A value here is
      // indistinguishable from an answer, and this one would be a stale 'en'.
      currency: null,
      isScheduled: true,
      bufferMinutes: '15',
      saleMode: 'direct',
      collection: 'invoice',
      paymentType: 'full',
      installmentCount: '3',
      installmentFrequency: 'monthly',
      firstPaymentDue: 'on_booking',
      firstPaymentDays: '7',
    },
  ]);

  // Multi-select state for Q4 (digital tools selection)
  const [multiSelectChoices, setMultiSelectChoices] = useState<Set<string>>(new Set());

  /**
   * The single-select option the owner has just pressed.
   *
   * A single-select chip sent its answer and showed nothing: `isSending` only
   * dimmed every option equally, so the chip that was actually chosen looked
   * the same as the ones that were not, for as long as the model took to
   * answer. On the deepening step that is two model calls — long enough to
   * press a second chip, which sends a second answer to a question that has
   * already moved on.
   *
   * Cleared when the next question arrives, keyed by the message count so a
   * stale selection cannot survive into the question after it.
   */
  const [pressedChoice, setPressedChoice] = useState<{ option: string; atMessage: number } | null>(null);

  // Pipeline stages editor state
  const [showPipelineEditor, setShowPipelineEditor] = useState(false);
  const [editingPipelineStages, setEditingPipelineStages] = useState<Array<{
    stage_key: string;
    stage_label: string;
    position: number;
    color: string;
    stage_type?: 'lead' | 'prospect' | 'client' | 'past_client' | 'lost' | 'archived';
    is_primary_client_stage?: boolean;
  }>>([]);

  const isRTL = selectedLanguage === 'he';

  // Initialize - check auth and start conversation
  useEffect(() => {
    async function initialize() {
      try {
        /*
         * ───────────────────────────────────────────────────────────────────
         * ASKED MORE THAN ONCE, BECAUSE THE SESSION CAN ARRIVE LATE.
         *
         * This page is the far end of the cross-origin sign-in, and a single
         * `getSession()` on mount can run before the session has been written
         * to storage. Reading "no session" here is not harmless: the checks
         * below are skipped, so an owner who finished onboarding weeks ago is
         * shown the welcome message and a fresh conversation is started for
         * them — the one outcome this page must never produce by accident.
         *
         * `/auth/handoff` now confirms the write before sending anyone here,
         * so this is the second line rather than the first. It costs at most
         * half a second on a page that is already waiting on the network, and
         * it removes the only way a completed account lands back in setup.
         * ───────────────────────────────────────────────────────────────────
         */
        let session = (await supabase.auth.getSession()).data.session;
        for (let attempt = 0; !session && attempt < 10; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 50));
          session = (await supabase.auth.getSession()).data.session;
        }

        if (session?.user) {
          // Check if already completed onboarding
          // Allow access via ?reset=true query param for testing/reconfiguration
          const urlParams = new URLSearchParams(window.location.search);
          const allowReset = urlParams.get('reset') === 'true';

          if (!allowReset) {
            const { data: businessProfile } = await supabase
              .from('business_profiles')
              .select('onboarding_completed')
              .eq('user_id', session.user.id)
              .single();

            if (businessProfile?.onboarding_completed) {
              /*
               * A document navigation, not `router.push`.
               *
               * This page is the far end of the cross-origin sign-in handoff,
               * and it runs while the session is still being installed from the
               * URL fragment. A client-side push is an in-flight RSC request
               * that any concurrent re-render of this tree cancels — and when
               * it was cancelled there was nothing to notice: this branch has
               * already returned, deliberately leaving the spinner up for a
               * navigation that never arrived. The server log showed middleware
               * waving `/business-os` through, the route compiling, and no page
               * render ever following.
               *
               * `replace`, not `assign`: an onboarded business has no reason to
               * come back here with the Back button, and returning would only
               * bounce them forward again.
               */
              window.location.replace('/business-os');
              return;
            }
          }

          // ALWAYS clear old conversation data when starting fresh onboarding
          // This prevents stale data from old onboarding flows causing issues
          // The delete is done via API to ensure proper auth
          try {
            await fetch('/api/onboarding/chat/reset', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' }
            });
          } catch (err) {
            // Non-blocking - continue even if reset fails
            logger.warn({ err }, 'Failed to reset old conversation data');
          }
        }

        // Start conversation - ALWAYS in English
        // The first question is always in English with LTR direction
        // Only after user selects their language will we switch
        const welcomeMessage: Message = {
          role: 'assistant',
          content: 'Welcome to AgentsPilot! Let\'s set up your Business OS. What language would you like to use?',
          /*
             The language's own name, no flag. A flag names a COUNTRY and these
             are languages: Spanish is not Spain to most of the people who speak
             it. Each name reads in the script of the thing it offers, which is
             the clearer signal anyway.

             Kept character-for-character identical to the same list in
             `getNextResponse` (`language_selection`), because `updateStateFromMessage`
             resolves the choice by matching these words. Two copies of one chip
             set is the real fault here and is noted on that one.
          */
          suggestions: ['English', 'עברית (Hebrew)', 'Español (Spanish)']
        };

        setMessages([welcomeMessage]);
        setIsLoading(false);
      } catch (err) {
        logger.error({ err }, 'Onboarding chat initialization failed');
        setIsLoading(false);
      }
    }

    initialize();
  }, [router]);

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * KEEP THE LIST AT THE BOTTOM, and move nothing else.
   *
   * Reported as "when selecting the chips or typing the chat jumps all over and
   * back". Three separate things were fighting:
   *
   *  1. `scrollIntoView` cannot be scoped. It walks up and scrolls EVERY
   *     scrollable ancestor until the target is visible, and this page's root
   *     is `min-h-screen`, so the window was one of them. Setting `scrollTop`
   *     on the list moves the list alone.
   *
   *  2. `focus()` scrolls its element into view INSTANTLY, and it ran on the
   *     same tick as a SMOOTH scroll. So every turn started an animation and
   *     then yanked it: the jump out, and the jump back. `preventScroll` ends
   *     that, and the input is already on screen in a fixed-height column.
   *
   *  3. The first paint animated from the top of an empty list, which reads as
   *     the page settling rather than a chat opening.
   *
   * Still one effect, because the two actions have to stay ordered: focus after
   * the scroll, never during it.
   * ───────────────────────────────────────────────────────────────────────────
   */
  useEffect(() => {
    const list = messagesScrollRef.current;
    if (list) {
      list.scrollTo({
        top: list.scrollHeight,
        behavior: hasScrolledOnce.current ? 'smooth' : 'auto',
      });
      hasScrolledOnce.current = true;
    }

    if (!isSending && !showPreview && !showServicesForm) {
      inputRef.current?.focus({ preventScroll: true });
    }
  }, [messages, isSending, showPreview, showServicesForm]);

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * THE SERVICES FORM NEVER OPENS.
   *
   * It was a fifteen-column grid rendered under the conversation, asking for
   * every field of every service before a single one existed — a spreadsheet
   * in a chat window, and the point people stopped.
   *
   * `service_details` now asks two chip questions and a number instead
   * (`sell_scheduled`, `sell_collection`, `service_count` in
   * `OnboardingConversationManager`), and the catalogue is created as drafts
   * the owner finishes in the services editor, which already has every field
   * this grid had plus a publish button.
   *
   * Held at `false` here rather than deleted in the same change, so the switch
   * can be reverted on its own if the new questions misbehave. The grid's JSX
   * and its row handlers are unreachable from this point and come out next.
   *
   * It used to open whenever `service_details` had no pending question. The
   * new flow always has one — and `OnboardingConversationManager.attribution`
   * has a test pinning that, because a branch that cleared `pendingQuestion`
   * without moving the step would put the grid straight back on screen.
   * ───────────────────────────────────────────────────────────────────────────
   */
  useEffect(() => {
    setShowServicesForm(false);
  }, [currentStep, pendingQuestion]);

  const sendMessage = async (
    message: string,
    /**
     * The services form's own rows, when the turn came from it.
     *
     * Sent ALONGSIDE the sentence, not instead of it: the extraction still
     * reads the business-wide answers out of the prose. What this removes is
     * the round trip for the services themselves, where a model returning
     * three of four lost the fourth with nothing counting them.
     */
    structuredServices?: Array<Record<string, unknown>>
  ) => {
    if (!message.trim() || isSending) return;

    // Add user message
    const userMessage: Message = { role: 'user', content: message };
    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsSending(true);

    try {
      const requestBody: {
        message: string;
        language: string;
        conversationId?: string;
        services?: Array<Record<string, unknown>>;
      } = {
        message,
        language: selectedLanguage,
      };
      if (structuredServices?.length) {
        requestBody.services = structuredServices;
      }
      // Only include conversationId if we have one
      if (conversationId) {
        requestBody.conversationId = conversationId;
      }

      const response = await fetch('/api/onboarding/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) throw new Error('Failed to process message');

      const result = await response.json();

      // Store conversationId for subsequent messages
      if (result.conversationId && !conversationId) {
        setConversationId(result.conversationId);
      }

      // Update language if changed (during language selection step)
      if (message.toLowerCase().includes('עברית') || message.toLowerCase().includes('hebrew')) {
        setSelectedLanguage('he');
        setLanguage('he'); // Also update global context for rest of app
      } else if (message.toLowerCase().includes('español') || message.toLowerCase().includes('spanish')) {
        setSelectedLanguage('es');
        setLanguage('es');
      } else if (message.toLowerCase().includes('english')) {
        setSelectedLanguage('en');
        setLanguage('en');
      }

      // Add assistant response
      const assistantMessage: Message = {
        role: 'assistant',
        content: result.response,
        suggestions: result.suggestions,
        multiSelect: result.multiSelect  // Include multi-select flag from API
      };
      setMessages(prev => [...prev, assistantMessage]);

      // Reset multi-select choices when entering a new step
      setMultiSelectChoices(new Set());

      // Update state
      setCurrentStep(result.currentStep);
      setPendingQuestion(result.pendingQuestion ?? null);

      if (result.setup) {
      }

      // A fresh plan means the adjustment they asked for has been made.
      if (result.showPreview) setAdjustingPlan(false);

      // Handle preview
      if (result.showPreview && result.previewData) {
        setShowPreview(true);
        setPreviewData(result.previewData);
      }

    } catch (error) {
      logger.error({ err: error }, 'Onboarding chat message send failed');
      const errorMessage: Message = {
        role: 'assistant',
        content: selectedLanguage === 'he'
          ? 'מצטער, היתה שגיאה. אנא נסה שוב.'
          : selectedLanguage === 'es'
          ? 'Lo siento, hubo un error. Por favor, inténtalo de nuevo.'
          : 'Sorry, there was an error. Please try again.'
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsSending(false);
      // Keep focus in the input field after sending
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  const handleSuggestionClick = (suggestion: string) => {
    sendMessage(suggestion);
    // Keep focus in input after suggestion click
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  // Services form handlers
  const addServiceRow = () => {
    // A new row inherits the currency already chosen: a business charges in one
    // currency far more often than in two, and re-picking it per service is
    // work with no decision in it.
    setServicesInput(prev => [
      ...prev,
      {
        name: '',
        duration: '60',
        price: '',
        // Inherits what the first row settled on, including "nobody has said".
        currency: prev[prev.length - 1]?.currency ?? null,
        isScheduled: true,
        bufferMinutes: '15',
      saleMode: 'direct',
        collection: 'invoice',
        paymentType: 'full',
        installmentCount: '3',
        installmentFrequency: 'monthly',
        firstPaymentDue: 'on_booking',
        firstPaymentDays: '7',
      },
    ]);
  };

  const removeServiceRow = (index: number) => {
    if (servicesInput.length > 1) {
      setServicesInput(prev => prev.filter((_, i) => i !== index));
    }
  };

  // `isScheduled` is a boolean, so the setter can no longer take strings only.
  const updateServiceRow = (index: number, field: keyof ServiceInput, value: string | boolean) => {
    /*
     * CURRENCY IS ONE DECISION FOR THE WHOLE BUSINESS, TAKEN ON THE FIRST ROW.
     *
     * It is not really a property of a row here, however it is stored: what is
     * picked in this form becomes `business_profiles.currency` by way of
     * `resolveBusinessCurrency`, which reads the FIRST service that names one.
     * Per-row pickers therefore offered a choice that silently did not exist —
     * set row two to ILS behind a USD row one and the business is still USD,
     * with a services table that disagrees with itself and no rate anywhere to
     * reconcile it.
     *
     * So it applies to every row, and only the first row offers it. A business
     * that genuinely prices one service in another currency changes that
     * service afterwards, in settings, against real data — not here, where the
     * change would quietly redefine the business.
     */
    if (field === 'currency') {
      setServicesInput(prev => prev.map(service => ({
        ...service,
        currency: value as ServiceInput['currency'],
      })));
      return;
    }

    setServicesInput(prev => prev.map((service, i) => {
      if (i !== index) return service;

      /*
       * Quoting clears the money.
       *
       * Price, collection and payment plan all describe a figure nobody has
       * named yet, so a value left behind a greyed cell is how a quoted job
       * comes out with a published price on it. The services settings clear
       * the same three, in the same words.
       */
      if (field === 'saleMode' && value === 'proposal') {
        return {
          ...service,
          saleMode: 'proposal' as const,
          price: '',
          paymentType: 'full' as const,
        };
      }

      /*
       * Emptying the price empties the plan.
       *
       * The button goes dead the moment there is no figure, and a plan left
       * behind a dead control is the same failure as a price left behind a
       * greyed cell — it is invisible and it still gets sent.
       */
      if (field === 'price') {
        const next = { ...service, price: value as string };
        return canSplit(next.saleMode, next.price)
          ? next
          : { ...next, paymentType: 'full' as const };
      }

      return { ...service, [field]: value };
    }));
  };

  /**
   * Closing the services form, and being told why it comes back.
   *
   * Services decide most of what the platform can configure afterwards: which
   * journeys exist, whether working hours are needed, whether a card processor
   * is, what the website lists. So this step cannot be skipped — and the honest
   * way to say that is to say it, rather than to leave a button on screen and
   * let somebody work out for themselves that they are stuck.
   *
   * The form returns after the sentence lands, so the answer is visible before
   * the thing it is answering for reappears.
   */
  const dismissServicesForm = () => {
    setShowServicesForm(false);
    setMessages(prev => [
      ...prev,
      {
        role: 'assistant',
        content:
          selectedLanguage === 'he'
            ? 'אני צריך את השירותים כדי להמשיך. בלעדיהם אי אפשר לדעת מה מזמינים, מה מחייבים ומה יופיע באתר. אפשר להוסיף שירות אחד עכשיו ולשנות הכל אחר כך.'
            : selectedLanguage === 'es'
              ? 'Necesito tus servicios para continuar. Sin ellos no puedo saber qué se reserva, qué se cobra ni qué aparece en la web. Añade uno ahora y podrás cambiarlo todo después.'
              : 'I need your services before we can go on. Without them there is no way to know what gets booked, what gets charged, or what the website lists. Add one now and you can change all of it later.',
      },
    ]);

    // Long enough to read the sentence, short enough not to feel stuck.
    setTimeout(() => setShowServicesForm(true), 900);
  };

  const submitServices = () => {
    // Filter out empty services and format as text
    const validServices = servicesInput.filter(s => (s.name ?? '').trim());
    if (validServices.length === 0) return;

    // Format services as a natural language message
    const intakeNote = needsIntake
      ? (selectedLanguage === 'he'
          ? ' לקוחות ממלאים טופס לפני הפגישה.'
          : selectedLanguage === 'es'
            ? ' Los clientes rellenan un formulario antes de la cita.'
            : ' Clients fill in a form before the appointment.')
      : '';

    const servicesText = validServices.map(s => {
      const parts = [s.name];
      // Said in words, because the extraction reads words rather than the form.
      // A product with no duration would otherwise arrive looking like a
      // service somebody forgot to time.
      // Only for something booked against a time. The field is hidden once the
      // answer is no, so sending its last value would describe a length the
      // person can no longer see or correct — and the extraction would read it.
      if (s.isScheduled && s.duration) {
        parts.push(`${s.duration} ${selectedLanguage === 'he' ? 'דקות' : selectedLanguage === 'es' ? 'minutos' : 'minutes'}`);
      }
      /*
       * The gap, in words, where they asked for one.
       *
       * Only when it differs from nothing: saying "0 minutes between clients"
       * is noise, and the extraction reads words rather than the form.
       */
      if (s.isScheduled && s.bufferMinutes && parseInt(s.bufferMinutes) > 0) {
        parts.push(
          selectedLanguage === 'he'
            ? `${s.bufferMinutes} דקות הפסקה בין פגישות`
            : selectedLanguage === 'es'
              ? `${s.bufferMinutes} minutos de pausa entre citas`
              : `${s.bufferMinutes} minutes between appointments`
        );
      }
      if (!s.isScheduled) {
        parts.push(selectedLanguage === 'he' ? 'ללא קביעת תור' : selectedLanguage === 'es' ? 'sin cita' : 'no appointment needed');
      }
      /*
       * Quoted, in words.
       *
       * The extraction prompt already recognises exactly this phrasing — its
       * worked examples are "I quote each project after a site visit" and the
       * Hebrew equivalent — so saying it is enough to reach `sale_mode`.
       */
      if (s.saleMode === 'proposal') {
        parts.push(
          selectedLanguage === 'he'
            ? 'מתומחר בהצעת מחיר לכל עבודה'
            : selectedLanguage === 'es'
              ? 'se cotiza por trabajo'
              : 'quoted per job'
        );
      }
      if (s.price) {
        // If they wrote a currency into the price box — "$80", "150 ש"ח" —
        // keep it exactly as typed. Otherwise use the one they picked for the
        // row, which is the whole point of the selector.
        const wroteCurrency = currencyFromText(s.price) !== null;
        // `s.currency` is null until somebody chooses, and `currencySymbol`
        // returns '' for null — which would send a bare number into the
        // conversation. The language default is the right thing to SHOW while
        // nothing has been chosen; it is still not stored.
        const symbol = currencySymbol(s.currency ?? currencyForLanguage(selectedLanguage));
        parts.push(wroteCurrency ? s.price : `${symbol}${s.price}`);
      }

      // How this one is collected, in words too — so a business that takes a
      // card for one service and invoices for another is not flattened into a
      // single answer on the way through.
      const priced = s.price.trim() !== '' && parseFloat(s.price) > 0;
      if (priced) {
        parts.push(
          s.collection === 'online'
            ? (selectedLanguage === 'he' ? 'תשלום בכרטיס אונליין' : selectedLanguage === 'es' ? 'pago con tarjeta en línea' : 'paid by card online')
            : (selectedLanguage === 'he' ? 'תשלום בחשבונית' : selectedLanguage === 'es' ? 'pago con factura' : 'paid against an invoice')
        );
      }

      // Said in words, because the extraction reads words. "12 תשלומים
      // חודשיים" is the sentence a person would type, and it lands in
      // payment_plan with its frequency intact.
      const installments = parseInt(s.installmentCount, 10);
      if (s.paymentType === 'installments' && installments > 1) {
        const frequency = {
          weekly: { he: 'שבועיים', es: 'semanales', en: 'weekly' },
          biweekly: { he: 'דו-שבועיים', es: 'quincenales', en: 'biweekly' },
          monthly: { he: 'חודשיים', es: 'mensuales', en: 'monthly' },
          quarterly: { he: 'רבעוניים', es: 'trimestrales', en: 'quarterly' },
        }[s.installmentFrequency];

        parts.push(
          selectedLanguage === 'he'
            ? `${installments} תשלומים ${frequency.he}`
            : selectedLanguage === 'es'
              ? `${installments} pagos ${frequency.es}`
              : `${installments} ${frequency.en} payments`
        );
      }
      /*
       * A middot, not a hyphen. This line is sent through `sendMessage`, so
       * it appears in the thread as the owner's OWN message: "Weekly coaching
       * - 60 min - $80" was theirs to read. The rest of the product separates
       * facts on one line with "·" ("about 2 minutes · after setup"), and a
       * hyphen between a duration and a price reads like a range or a minus.
       */
      return parts.join(' · ');
    }).join('\n');

    // Reset form and close modal. Not a dismissal: the services were sent, and
    // the assistant's own follow-up takes it from here.
    setShowServicesForm(false);
    setServicesInput([{
      name: '',
      duration: '60',
      price: '',
      // Null until chosen — see the field's own note. A value here is
      // indistinguishable from an answer, and this one would be a stale 'en'.
      currency: null,
      isScheduled: true,
      bufferMinutes: '15',
      saleMode: 'direct',
      collection: 'invoice',
      paymentType: 'full',
      installmentCount: '3',
      installmentFrequency: 'monthly',
      firstPaymentDue: 'on_booking',
      firstPaymentDays: '7',
    }]);

    /*
     * The rows themselves, beside the sentence describing them.
     *
     * Every value here was typed or chosen, so none of it needs reading back
     * out of prose. The sentence still goes, because the business-wide answers
     * in it — how clients pay, whether an intake form is wanted — are not per
     * service and are still extracted.
     */
    const structuredServices = validServices.map(s => {
      const scheduled = s.isScheduled !== false;
      const quoted = s.saleMode === 'proposal';
      const priceValue = parseFloat(s.price);
      const installments = parseInt(s.installmentCount, 10);

      return {
        name: s.name.trim(),
        duration_minutes: scheduled ? parseInt(s.duration, 10) || null : null,
        buffer_minutes: scheduled ? parseInt(s.bufferMinutes, 10) || 0 : null,
        // Null is "agreed per client"; only a typed zero is free.
        price: quoted || s.price.trim() === '' ? null : (Number.isFinite(priceValue) ? priceValue : null),
        currency: s.currency,
        is_scheduled: scheduled,
        sale_mode: s.saleMode,
        collection: quoted || !(priceValue > 0) ? null : s.collection,
        payment_plan:
          !quoted && s.paymentType === 'installments' && installments >= 2
            ? { installment_count: installments, installment_frequency: s.installmentFrequency }
            : null,
      };
    });

    // Send as message, with the one business-wide answer appended so the
    // extraction sees it in the same turn as the services it applies to.
    sendMessage(servicesText + intakeNote, structuredServices);
  };

  // Pipeline stages editor handlers
  const openPipelineEditor = () => {
    if (previewData?.pipelineStages) {
      setEditingPipelineStages([...previewData.pipelineStages]);
      setShowPipelineEditor(true);
    }
  };

  const updatePipelineStageLabel = (index: number, newLabel: string) => {
    setEditingPipelineStages(prev => prev.map((stage, i) =>
      i === index ? { ...stage, stage_label: newLabel } : stage
    ));
  };

  const addPipelineStage = () => {
    const newPosition = editingPipelineStages.length;
    const colors = ['#3b82f6', '#8b5cf6', '#ec4899', '#f97316', '#22c55e', '#06b6d4'];
    const newStage = {
      stage_key: `stage_${Date.now()}`,
      stage_label: selectedLanguage === 'he' ? 'שלב חדש' : selectedLanguage === 'es' ? 'Nueva etapa' : 'New Stage',
      position: newPosition,
      color: colors[newPosition % colors.length]
    };
    setEditingPipelineStages(prev => [...prev, newStage]);
  };

  const removePipelineStage = (index: number) => {
    // The client stage is the one the platform reads to know a contact became
    // a customer — auto-promotion after payment, the funnel's paying station,
    // every "how many clients" figure. Guarded here as well as on the button,
    // because a disabled button is a hint and this is a rule.
    if (editingPipelineStages[index]?.is_primary_client_stage) return;

    if (editingPipelineStages.length > 2) {
      setEditingPipelineStages(prev =>
        prev.filter((_, i) => i !== index).map((stage, i) => ({ ...stage, position: i }))
      );
    }
  };

  const movePipelineStage = (index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= editingPipelineStages.length) return;

    setEditingPipelineStages(prev => {
      const newStages = [...prev];
      [newStages[index], newStages[newIndex]] = [newStages[newIndex], newStages[index]];
      return newStages.map((stage, i) => ({ ...stage, position: i }));
    });
  };

  const savePipelineChanges = () => {
    if (previewData) {
      const updatedPreviewData = {
        ...previewData,
        pipelineStages: editingPipelineStages,
        configuration: previewData.configuration ? {
          ...previewData.configuration,
          pipeline_stages: editingPipelineStages
        } : undefined
      };
      setPreviewData(updatedPreviewData);
    }
    setShowPipelineEditor(false);
  };

/**
   * The plan, in sentences.
   *
   * Each card states a consequence rather than a setting: "you invoice, they
   * transfer — no card processor" is something a person can check, while
   * "payment_mode: invoicing" and a tile reading "Payments ✓" are not.
   */
  const configuration = previewData?.configuration as any;

  /**
   * How many services this build will create, and how many of them we can name.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * The interview asks how MANY services there are rather than for a list of
   * them, so `previewData.services` is normally empty and `service_count`
   * carries the answer. Reading only the first of those is why the plan card
   * showed no services section at all on the ordinary path.
   *
   * `Math.max` because the two can disagree in both directions: a count of
   * three with one service named, or a catalogue of four against a stale count
   * of two. The build creates `service_count` rows and tops up from the
   * catalogue, so the larger figure is the honest promise.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const namedServices = previewData?.services ?? [];
  const plannedServiceCount = Math.max(
    namedServices.length,
    typeof configuration?.service_count === 'number' ? configuration.service_count : 0
  );
  const unnamedServiceCount = Math.max(0, plannedServiceCount - namedServices.length);
  const changeLabel = selectedLanguage === 'he' ? 'שנה' : selectedLanguage === 'es' ? 'cambiar' : 'change';

  /**
   * Changing a fact, where the fact is.
   *
   * Every card's change link used to drop the user back into the conversation
   * to re-describe something they were already looking at — so correcting one
   * price meant a paragraph, another extraction pass, and a new plan in which
   * something else might have moved. A card states one decision; its change
   * link edits that decision and nothing else. The conversation stays for what
   * no card covers.
   */
  const [planEditor, setPlanEditor] = useState<'services' | 'presence' | 'collection' | null>(null);
  /** A working copy, so closing without saving leaves the plan as it was. */
  const [draftServices, setDraftServices] = useState<NonNullable<PreviewData['services']>>([]);
  /** Which draft row has its payment options open, if any. */

  const openServicesEditor = () => {
    setDraftServices((previewData?.services || []).map(service => ({ ...service })));
    setPlanEditor('services');
  };


  const updateDraftService = (
    index: number,
    field:
      | 'service_name'
      | 'duration_minutes'
      | 'buffer_minutes'
      | 'price'
      | 'currency'
      | 'is_scheduled'
      | 'collection'
      | 'sale_mode',
    value: string | boolean
  ) => {
    setDraftServices(rows => rows.map((row, i) => {
      if (i !== index) return row;
      if (field === 'is_scheduled') return { ...row, is_scheduled: value as boolean };
      /*
       * Quoting clears the money — all three of it.
       *
       * Price, collection and payment plan describe a figure nobody has named
       * yet, and a value left behind a greyed cell is how a quoted job comes
       * out with a published price on it. The services settings clear exactly
       * these three, in these words, and the two forms must not differ.
       */
      if (field === 'sale_mode') {
        const mode = value as 'direct' | 'proposal';
        // A quoted job carries neither: both are settled on the proposal.
        return mode === 'proposal'
          ? { ...row, sale_mode: mode, price: null, collection: null, payment_plan: null }
          : { ...row, sale_mode: mode };
      }
      if (field === 'collection') return { ...row, collection: value as 'online' | 'invoice' };
      if (field === 'service_name') return { ...row, service_name: value as string };
      if (field === 'currency') return { ...row, currency: value as string };
      const text = value as string;
      if (field === 'duration_minutes') {
        return { ...row, duration_minutes: text.trim() === '' ? null : (parseInt(text, 10) || null) };
      }
      /*
       * Its own branch, before the price fallback below.
       *
       * Zero is a real answer here — a business that books back to back — so
       * `|| null` would be wrong: it would read "no gap" as "not answered" and
       * hand the service the platform's fifteen minutes instead.
       */
      if (field === 'buffer_minutes') {
        if (text.trim() === '') return { ...row, buffer_minutes: null };
        const minutes = parseInt(text, 10);
        return { ...row, buffer_minutes: Number.isFinite(minutes) ? minutes : null };
      }
      // Empty is not zero. A blank price means the fee is agreed per client;
      // a 0 means the service is free, and publishing one as the other is how
      // a consultancy advertises its work for nothing.
      const nextPrice = text.trim() === '' ? null : Number(text);
      // A plan needs a figure to split. Emptying the price empties the plan,
      // rather than leaving one behind a button that has just gone dead.
      return canSplit(row.sale_mode, nextPrice)
        ? { ...row, price: nextPrice }
        : { ...row, price: nextPrice, payment_plan: null };
    }));
  };

  const saveServicesEditor = () => {
    if (!previewData) return;
    const kept = draftServices.filter(service => service.service_name.trim());

    // Whether a processor is needed follows from the services, so it is
    // recomputed here rather than left at whatever the extraction guessed.
    /*
     * NOT GATED ON A PRICE. This editor is names-only — it says so on its face,
     * "prices, durations and how you take payment are set later" — so
     * `price > 0` was never true here and a processor was never wanted,
     * whatever the owner had answered one screen earlier.
     */
    const wantsProcessor = kept.some(
      service => (service.collection ?? 'invoice') === 'online'
    );

    setPreviewData({
      ...previewData,
      services: kept,
      // Both arrays, because the build prefers this one but falls back to the
      // other — an edit written to only one of them survives or vanishes
      // depending on whether the user deleted every row.
      configuration: previewData.configuration
        ? {
          ...previewData.configuration,
          needs_stripe_connect: wantsProcessor,
          services: kept.map(service => ({
            name: service.service_name,
            // A product has no length. Hiding the field and then sending its
            // last value would create a 60-minute download — the field would be
            // gone from the form and still on the record.
            duration_minutes: service.is_scheduled === false ? null : service.duration_minutes,
            price: service.price ?? undefined,
            currency: service.currency,
            payment_plan: service.payment_plan ?? null,
            is_scheduled: service.is_scheduled !== false,
            // Only for something booked against a time — a product has no gap
            // to leave after it, and sending one would describe a diary rule
            // for something that never reaches the diary.
            buffer_minutes:
              service.is_scheduled === false ? undefined : service.buffer_minutes ?? undefined,
            sale_mode: service.sale_mode ?? 'direct',
            /*
             * A quoted job has no collection method.
             *
             * Nobody has said what the work costs, so there is no money for a
             * method to describe — it is settled on the proposal. Same rule as
             * the settings dialog, which is the other place this is decided.
             */
            /*
             * THE PRICE TEST HERE WAS DESTRUCTIVE, not merely dead.
             *
             * Every service arrives at this editor with no price, because the
             * interview collects none and this editor edits names. So
             * `price > 0` was false for all of them and this wrote
             * `collection: null` over the answer the owner gave two questions
             * earlier: opening the service names and saving them, changing
             * nothing, silently erased how the whole business gets paid.
             *
             * A quote still clears it, which is the real rule this was reaching
             * for: there is no collection method to record on a proposal
             * because it is settled on the proposal itself.
             */
            collection:
              service.sale_mode === 'proposal' ? null : (service.collection ?? 'invoice'),
          })),
        }
        : previewData.configuration,
    });
    setPlanEditor(null);
  };

  const setPresenceMode = (mode: NonNullable<NonNullable<PreviewData['configuration']>['online_presence_mode']>) => {
    if (!previewData?.configuration) return;
    setPreviewData({
      ...previewData,
      configuration: { ...previewData.configuration, online_presence_mode: mode },
    });
    setPlanEditor(null);
  };

  /**
   * How money arrives, changed from the plan screen.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * WHY THIS IS BACK.
   *
   * A chooser lived here and was deliberately removed, under the reasoning
   * that collection "moved onto each service, so its chooser is gone rather
   * than left to overwrite three per-service answers with one". Sound at the
   * time. But the services editor on this screen was LATER stripped to names
   * only — its own copy now reads "Prices, durations and how you take payment
   * are set later, in the services screen" — and nobody updated the money
   * card, whose Change link still opened it.
   *
   * So an owner pressing Change on "How you get paid" got a dialog titled
   * "What you sell" that told them payment is set somewhere else. Reported as
   * exactly that. Between the two edits, the plan screen lost any way to
   * change the one answer it was showing.
   *
   * The original objection does not apply here. On this screen every service's
   * collection was just stamped from this single answer, moments ago, by
   * `draftServices` — there are no distinct per-service answers to overwrite
   * yet. Restamping them is what answering the chat question again would have
   * done. Per-service divergence is real and belongs to the services screen,
   * after the build, where each row is edited against its own price.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const setCollectionMethod = (
    method: NonNullable<NonNullable<PreviewData['configuration']>['collection_method']>
  ) => {
    if (!previewData?.configuration) return;

    /*
     * `payment_mode` is a projection of this, not a second opinion — the same
     * rule `computePaymentMode` follows. Left untouched it would say
     * "invoicing" under a card now reading "pays by card", and the build
     * reads the mode rather than the method.
     */
    const paymentMode =
      method === 'card_online' || method === 'mixed'
        ? 'upfront'
        : method === 'none'
          ? 'none'
          : 'invoicing';

    setPreviewData({
      ...previewData,
      configuration: {
        ...previewData.configuration,
        collection_method: method,
        payment_mode: paymentMode,
      },
      /* The card reads services first, so they have to agree or it lies. */
      services: (previewData.services || []).map(service => ({
        ...service,
        collection: method === 'none' ? null : method === 'card_online' ? 'online' : 'invoice',
      })),
    });
    setPlanEditor(null);
  };

  const saveBusinessName = () => {
    const name = (editingName || '').trim();
    setEditingName(null);
    if (!name || !previewData) return;

    setPreviewData({
      ...previewData,
      businessProfile: { ...previewData.businessProfile, company_name: name },
      // The build reads `configuration.company_name` first and falls back to
      // the profile, so both have to change or the correction is lost.
      configuration: previewData.configuration
        ? { ...previewData.configuration, company_name: name }
        : previewData.configuration,
    });
  };

  /**
   * The plan has the page, unless they have asked to change something — then
   * the conversation comes back so they can say what.
   */
  const showPlanScreen =
    showPreview && !!previewData && !adjustingPlan &&
    (currentStep === 'preview' || currentStep === 'building');

  /**
   * How money reaches this business, read off its services.
   *
   * The old business-wide `collection_method` could not describe what people
   * actually sell: this account has a free service, one billed against an
   * invoice and one taking a card, and a single answer called the whole thing
   * "invoice". Whatever the services say is the truth, because the services are
   * what a client walks through.
   */
  const collectionShape = (() => {
    /*
     * ─────────────────────────────────────────────────────────────────────────
     * NOT FROM PRICES. THE CHAT NEVER ASKS FOR ONE.
     *
     * This filtered to `price > 0` first, so `priced` was ALWAYS EMPTY: the
     * interview collects a count, whether clients book, and how money arrives,
     * and leaves every price to the services editor. Every branch below then
     * fell through to the last one, and an owner who had just answered "I
     * collect the money myself: invoice, transfer or cash" was told on the
     * plan screen that NOTHING IS CHARGED.
     *
     * The fifth site with this same gate. The others were the build page's
     * owner cards, `computePaymentMode`, the per-service `collection`, and the
     * `payments` capability. A price gate reads as a reasonable test for "does
     * this business take money" right up until you notice nobody is asked.
     *
     * Services still win where they say anything, for the reason the original
     * comment gives and which still holds: this account can have one free
     * service, one invoiced and one taking a card, and no single business-wide
     * answer describes that. What is new is the fallback — the answer the
     * owner actually gave — for the plan screen, which is shown BEFORE any
     * service row has a collection set on it.
     * ─────────────────────────────────────────────────────────────────────────
     */
    const stated = (previewData?.services || []).filter(service => !!service.collection);

    if (stated.length) {
      return {
        online: stated.some(service => service.collection === 'online'),
        invoiced: stated.some(service => service.collection !== 'online'),
        takesMoney: true,
      };
    }

    const method = previewData?.configuration?.collection_method;
    return {
      online: method === 'card_online' || method === 'mixed',
      invoiced: method === 'invoice' || method === 'in_person' || method === 'mixed',
      /* 'none' is the one answer that means the plan may say nothing is charged. */
      takesMoney: !!method && method !== 'none',
    };
  })();

  const collectionSummary = (() => {
    const { online, invoiced, takesMoney } = collectionShape;

    if (online && invoiced) {
      return selectedLanguage === 'he'
        ? 'חלק מהשירותים נגבים בכרטיס בזמן ההזמנה, וחלק בחשבונית אחרי, לפי מה שהגדרת לכל שירות.'
        : selectedLanguage === 'es'
          ? 'Algunos servicios se cobran con tarjeta al reservar y otros por factura, según lo que definiste en cada uno.'
          : 'Some services are paid by card at booking and some are invoiced after, per what you set on each one.';
    }
    if (online) {
      return selectedLanguage === 'he'
        ? 'לקוחות משלמים בכרטיס בזמן ההזמנה.'
        : selectedLanguage === 'es'
          ? 'Los clientes pagan con tarjeta al reservar.'
          : 'Clients pay by card when booking.';
    }
    if (invoiced) {
      return selectedLanguage === 'he'
        ? 'אתה שולח חשבונית והם מעבירים. בלי מנפיק תשלומים: פרטי הבנק שלך יופיעו בחשבונית.'
        : selectedLanguage === 'es'
          ? 'Tú facturas y ellos transfieren. Sin procesador: tus datos bancarios van en la factura.'
          : 'You invoice, they transfer. No card processor: your bank details go on the invoice.';
    }
    /*
     * Takes money, and we cannot say how. Reachable now rather than dead: it
     * needed a priced service, and nothing is priced at this point. Both
     * `invoice` and `in_person` resolve to the invoiced branch above, so what
     * reaches here is a business that sells something with no collection
     * recorded either way.
     */
    if (takesMoney) {
      return selectedLanguage === 'he'
        ? 'משלמים לך ישירות. אין מה להגדיר.'
        : selectedLanguage === 'es'
          ? 'Te pagan directamente. Nada que configurar.'
          : 'They pay you directly. Nothing to set up.';
    }
    return selectedLanguage === 'he'
      ? 'אין גבייה כרגע.'
      : selectedLanguage === 'es'
        ? 'No se cobra nada por ahora.'
        : 'Nothing is charged.';
  })();

  /**
   * What the site will actually do for them.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * `full_website` and `website_only` shared one sentence, ending "That is
   * where clients book you". The two modes differ by exactly that: `full_website`
   * carries a booking surface and `website_only` is the mode that means there
   * is none. So the plan promised booking to the one business that had just
   * said it sells nothing — and to any business selling something not booked
   * against a time.
   *
   * It is the worst place for that claim. The plan is what the owner approves,
   * and they approve it before anything exists to contradict it; the same
   * mistake on the build page ("Your site is published", when it is a draft) is
   * recorded there as a promise people acted on.
   *
   * Not "and publish" either, in any branch: the site is created as a DRAFT and
   * the owner publishes it. That half was already right and is kept.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const presenceSummary = (() => {
    const mode = configuration?.online_presence_mode;

    if (mode === 'full_website') {
      return selectedLanguage === 'he'
        ? 'אבנה את האתר שלך ואשאיר אותו מוכן לפרסום. משם לקוחות מזמינים.'
        : selectedLanguage === 'es'
          ? 'Construiré tu sitio y lo dejaré listo para publicar. Es donde reservan.'
          : "I'll build your site and leave it ready for you to publish. That is where clients book you.";
    }

    /*
     * A site and a contact form, and no booking — which is what this mode
     * means. True whether the catalogue is empty or holds things nobody books
     * a time for, so it does not need to read the count to stay honest.
     */
    if (mode === 'website_only') {
      return selectedLanguage === 'he'
        ? 'אבנה את האתר שלך ואשאיר אותו מוכן לפרסום. משם לקוחות מוצאים אותך ויוצרים קשר, וכל פנייה נכנסת לאנשי הקשר שלך.'
        : selectedLanguage === 'es'
          ? 'Construiré tu sitio y lo dejaré listo para publicar. Es donde te encuentran y te escriben, y cada consulta entra en tus contactos.'
          : "I'll build your site and leave it ready for you to publish. That is where clients find you and get in touch, and every enquiry lands in your contacts.";
    }

    /*
     * "No website" is only half the truth for somebody who HAS one.
     *
     * A business keeping its own site shares `booking_only` with one that has
     * no web presence at all — the mode records what WE build, not what they
     * own. Telling an owner who just said "I already have a website" that they
     * have no website reads as though we had not listened.
     */
    if (configuration?.has_website === true) {
      return selectedLanguage === 'he'
        ? 'לינק להזמנות להדביק באתר שלך, ואקרא משם את הפניות שמגיעות למייל.'
        : selectedLanguage === 'es'
          ? 'Un enlace de reserva para pegar en tu sitio, y leeré las consultas que llegan a tu correo.'
          : "A booking link to paste into your own site, and I'll read the enquiries it emails you.";
    }

    return selectedLanguage === 'he'
      ? 'לינק להזמנות שאפשר לשלוח בוואטסאפ. בלי אתר.'
      : selectedLanguage === 'es'
        ? 'Un enlace de reserva para WhatsApp. Sin sitio web.'
        : 'A booking link you can paste into WhatsApp. No website.';
  })();

  /**
   * The one card the platform cannot fill in.
   *
   * Named here, on the plan, with a time estimate — so the user decides with
   * the cost in view and can still change their mind about how they collect.
   */
  /** How many of the cards below are the platform's own work. */
  const planBuildCount = 2 // the business, and how clients reach them
    + ((previewData?.services?.length || 0) > 0 ? 1 : 0)
    + ((previewData?.pipelineStages?.length || 0) > 0 ? 1 : 0)
    + 1; // how they get paid

  /**
   * Everything only this person can do — which can be more than one thing.
   *
   * A single card assumed the business collected exactly one way. A practice
   * with a card-paid session and an invoiced programme owes both a processor
   * and its bank details, and naming only the first left the other to be
   * discovered from a client's confused email.
   */
  const yoursCards = (() => {
    /*
     * ONE LIST, SHARED WITH THE BUILD SCREEN.
     *
     * This screen kept its own and knew two of the five, so the plan said
     * "1 needs you" where the build one click later showed three. The
     * conditions and the words now live in `lib/business-os/onboarding/
     * ownerTasks`, which both screens read; what stays here is the rendering,
     * because this draws cards with a note and the build draws steps with a
     * result line.
     */
    const tasks = ownerTasks(
      {
        services: previewData?.services,
        /*
         * Whichever of the three knows the count. The build screen reads all
         * three and this read one; on an account whose catalogue sits in
         * `configuration.services`, the plan would have shown neither the
         * services card nor the working hours, which are only owed when there
         * is something to book.
         */
        serviceCount: Math.max(
          previewData?.services?.length || 0,
          previewData?.configuration?.services?.length || 0,
          previewData?.configuration?.service_count || 0
        ),
        sellsScheduled: previewData?.configuration?.sells_scheduled,
        collectionMethod: previewData?.configuration?.collection_method,
        needsIntake: previewData?.configuration?.needs_intake,
      },
      selectedLanguage as 'en' | 'he' | 'es'
    );

    const icons: Record<string, React.ReactNode> = {
      services: <FileText className="w-3.5 h-3.5" />,
      availability: <Calendar className="w-3.5 h-3.5" />,
      intake: <ClipboardList className="w-3.5 h-3.5" />,
      stripe: <CreditCard className="w-3.5 h-3.5" />,
      bank: <Building2 className="w-3.5 h-3.5" />,
    };

    /* "about 2 minutes · after setup" — this screen's phrasing for `minutes`,
       which the build screen renders as a sentence instead. */
    const note = (minutes: number) =>
      selectedLanguage === 'he'
        ? `בערך ${minutes} דקות · אחרי ההקמה`
        : selectedLanguage === 'es'
          ? `unos ${minutes} minutos · después`
          : `about ${minutes} minutes · after setup`;

    return tasks.map(task => ({
      key: task.key,
      icon: icons[task.key],
      title: task.title,
      value: task.body,
      note: note(task.minutes),
    }));
  })();

  const handleBuild = async () => {
    if (!previewData) return;

    /*
     * The handoff is a CONVENIENCE now, not the only path.
     *
     * `sessionStorage.setItem` throws on a quota or in some private modes, and
     * it threw from inside this click handler — so the button did nothing at
     * all, with no error anywhere the owner could see, and the build never
     * ran. The build page can now recover the plan from the server, so the
     * navigation must happen whether or not this write succeeds.
     */
    try {
      sessionStorage.setItem('onboarding_preview_data', JSON.stringify(previewData));
    } catch (err) {
      logger.error({ err }, 'Could not hand the plan over in sessionStorage; the build page will refetch it');
    }

    router.push(`/onboarding-build?lang=${selectedLanguage}`);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[var(--v2-bg)] flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin mx-auto mb-4 text-[var(--v2-primary)]" />
          <p className="text-lg text-[var(--v2-text-secondary)]">
            Loading...
          </p>
        </div>
      </div>
    );
  }

  return (
    /*
     * ─────────────────────────────────────────────────────────────────────────
     * THE CHROME DOES NOT SCROLL, exactly as in Business OS.
     *
     * This was `min-h-screen`, so the header scrolled away with the document
     * and an owner halfway down the plan had no logo, no business name and no
     * sense of which product they were in.
     *
     * Copied from `app/business-os/layout.tsx` rather than invented: a
     * `100dvh` flex column, `overflow-hidden`, with `shrink-0` chrome above a
     * `flex-1 min-h-0` body. The platform makes that body the scroller; here
     * it is only a SIZED REGION and each screen scrolls inside it, because the
     * conversation has a scroller of its own and two nested ones broke the
     * auto-scroll. See the comment on the body itself. NOT `position: sticky`, which is what
     * this would have been built with — `BusinessOSHeader` carries a comment
     * recording that it used to be sticky and no longer needs to be, because
     * out of the scroller entirely it simply does not move, the scrollbar runs
     * beside the body rather than past the header, and nobody has to hardcode
     * the header's height into an offset.
     *
     * `100dvh` and not `100vh`: on a phone `vh` is the viewport measured with
     * the address bar collapsed, which is taller than what you can see, so the
     * bottom of the page sits under the browser chrome with no way to reach it.
     * ─────────────────────────────────────────────────────────────────────────
     */
    <div
      className="flex h-[100dvh] w-full flex-col overflow-hidden bg-[var(--v2-bg)]"
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      {/*
        Mounted HERE, and only here.

        This is the one address a sign-in handoff has ever landed on. It used to
        be mounted in `PlatformShell`, so it ran on every page and would adopt an
        `access_token` from any url's fragment — which, with the fragment left in
        browser history, is how a Back button could sign someone back in after
        they had logged out.
      */}
      <SessionHandler />

      {/* Header */}
      {/* `shrink-0` so a long thread cannot squeeze the chrome, `relative
          z-50` so anything the header opens sits over the body. */}
      <div className="relative z-50 shrink-0 border-b border-[var(--v2-border)] bg-[var(--v2-surface)]">
        {/* Pinned to LTR on purpose.
            Where the logo sits is a layout decision, not a reading direction:
            it belongs on the left in every language, with the account's name
            opposite it. Letting `dir` order this row put the logo on the right
            in Hebrew, which moves the one fixed landmark on the page. The name
            inside still renders in its own direction. */}
        <div dir="ltr" className="max-w-4xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-4">
          {/* ── THE PLATFORM'S LOGO, AND NOT A LINK ──────────────────────
              ─────────────────────────────────────────────────────────────
              This was `V2Logo`, which renders `/images/AgentPilot_Logo.png`
              — the old square mark, from the name the product no longer
              carries. The platform's logo is the wordmark in
              `components/brand/Logo`, which `BusinessOSHeader` already
              uses, so the first screen a new owner sees was the one screen
              showing a different brand.

              `placement="header"` is the same call the main header makes,
              so the two line up at the same height rather than agreeing by
              coincidence. The theme swap is CSS inside the component, which
              matters here: this header sits on `--v2-surface`.

              NOT WRAPPED IN A LINK, which `V2Logo` was. Its destination is
              `/v2/dashboard`, the legacy agent platform — a screen with no
              route back, as `BusinessOSHeader` records. There is also
              nowhere useful to go from here: onboarding is the one thing
              this page is for, and middleware sends an owner who has not
              finished it straight back. A logo that bounces you to where
              you already are reads as broken. It is a landmark, which is
              what the comment above already calls it.
              ───────────────────────────────────────────────────────────── */}
          <Logo placement="header" priority />
          {/* Whose account this is, once they have said.
              In the header rather than on the plan: it is true of every screen
              from here on, not a line belonging to one of them. */}
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

      {/* Main Content
          ──────────────────────────────────────────────────────────────────
          Two elements where there was one. The scroller is the OUTER div and
          runs the full width, so its scrollbar sits at the edge of the window
          the way the platform's does, rather than inside the centred column.
          The inner div keeps the measure and the padding it always had. */}
      {/*
          ──────────────────────────────────────────────────────────────────────
          ONE SCROLLER PER SCREEN, AND IT IS NEVER THIS ONE.

          This div was `overflow-y-auto`, which gave the chat screen TWO nested
          scrollers: this one and the message list inside the card. Everything
          reported followed from that.

            two scrollbars   the message list reaches its height and this one
                             starts taking the overflow, so both are live
            jumping          the composing indicator changes the height of
                             content inside a scroller that is itself inside a
                             scroller, and both adjust
            no auto-scroll   the one that matters. The effect calls `scrollTo`
                             on the MESSAGE LIST, and once the overflow has
                             moved out here that list has `scrollHeight ===
                             clientHeight`, so the call does nothing at all and
                             every new question has to be scrolled to by hand.

          So this is a SIZED REGION, not a scroller: `flex-1 min-h-0` below the
          frozen header, and each screen owns its own scrolling inside it. The
          conversation never grows, and its message list is the only thing that
          moves. The plan screen, which is genuinely taller than the window,
          carries its own `overflow-y-auto` on the block below.

          `min-h-0` on both: without it a flex item refuses to shrink below its
          content, which is precisely how the overflow escapes to an ancestor
          and the whole problem starts again.
          ──────────────────────────────────────────────────────────────────────
      */}
      {/*
          WHICH ELEMENT SCROLLS DEPENDS ON WHICH SCREEN IS UP, and that is not
          a hedge: the two screens want opposite things.

            PLAN         the page scrolls. The scrollbar belongs at the edge of
                         the WINDOW, which means the scrolling element has to
                         be this full-width wrapper. Giving the plan block its
                         own scroller put the bar at the edge of the centred
                         column instead, floating in the middle of the screen
                         beside the cards, which is what was reported.

            CONVERSATION nothing here scrolls. The message list inside the card
                         is the scroller, and it has to be the only one: two
                         nested scrollers is what broke the auto-scroll, since
                         the effect calls `scrollTo` on that list and the call
                         does nothing once the overflow has moved to an
                         ancestor.

          Which side the bar lands on is the browser's to decide from `dir`,
          inherited from the root — left for Hebrew, right otherwise. Nothing
          here needs to know.
      */}
      <div
        className={cn(
          'flex w-full flex-1 min-h-0 flex-col',
          showPlanScreen ? 'overflow-y-auto' : 'overflow-hidden'
        )}
      >
      {/* `flex-1 min-h-0` only for the conversation, which has to be given a
          height to fill. On the plan it would let the column shrink below its
          own content, so it grows naturally instead and the wrapper scrolls. */}
      <div
        className={cn(
          'flex w-full max-w-4xl mx-auto flex-col px-4 sm:px-6 py-6 sm:py-8',
          !showPlanScreen && 'flex-1 min-h-0'
        )}
      >
        {/* The conversation fills whatever is left after the panel below it,
            rather than a fixed height tuned to the chrome above.
            `calc(100vh - 280px)` was measured against a progress bar that no
            longer exists, which left the composer floating short of the bottom
            — and would have gone wrong again the next time anything above it
            changed. One number for the header, and flex does the rest. */}
        {/* The plan — a screen, not a message.
            Rendered instead of the conversation, so the thing the user is
            deciding on has the page to itself. */}
        {showPlanScreen && previewData && (
          /* NOT a scroller. The wrapper above takes that job while the plan is
             up, so the scrollbar sits at the window edge rather than at the
             edge of this column. */
          <div dir={isRTL ? 'rtl' : 'ltr'}>
                {/* The business, as the heading of its own plan.
                    This was a sentence with `**asterisks**` around the name,
                    written for a markdown renderer that never ran — so the
                    plan opened with literal stars around the business. The
                    name is the title of what follows, and it inherits the
                    page's direction rather than being wrapped in a sentence
                    whose punctuation has to be flipped by hand. */}
                {/*
                    ONE SENTENCE, ONE TYPE SIZE.
                    ─────────────────────────────────────────────────────────
                    This was a `p` above an `h2`, which broke "My plan for"
                    away from the name it governs and left a stranded
                    preposition on its own line. Putting them on one
                    baseline-aligned row fixed the break and introduced a
                    different problem: `text-xs` muted beside `text-xl` bold is
                    a four-step size jump across a shared baseline, which reads
                    as two fragments that happen to be adjacent.

                    So it is simply a sentence now, at one size. The name still
                    carries the weight and the full-contrast colour, so it is
                    plainly the subject, and the words around it stop competing
                    for the same job.
                */}
                <p className="mb-4 text-lg text-[var(--v2-text-secondary)] break-words">
                  {selectedLanguage === 'he' ? 'התוכנית שלי עבור' : selectedLanguage === 'es' ? 'Mi plan para' : 'My plan for'}{' '}
                  <bdi className="font-bold text-[var(--v2-text-primary)]">
                    {previewData.businessProfile?.company_name
                      || (selectedLanguage === 'he' ? 'העסק שלך' : selectedLanguage === 'es' ? 'tu negocio' : 'your business')}
                  </bdi>
                </p>

                <div className="bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-2xl shadow-xl overflow-hidden">
                  {/* The promise, as a number.
                      A coloured banner repeating the business name was the
                      receipt talking: the name is already in the sentence
                      above and on the first card. What belongs here is the
                      only figure that matters before anything is built —
                      how much of this the platform does, and how much is
                      left for them. */}
                  <div className="px-5 pt-5 flex items-baseline justify-between gap-3 flex-wrap">
                    <h3 className="text-base font-bold text-[var(--v2-text-primary)]">
                      {selectedLanguage === 'he' ? 'הנה ההגדרות שלך' : selectedLanguage === 'es' ? 'Aquí está tu configuración' : 'Here is your setup'}
                    </h3>
                    <span className="text-xs text-[var(--v2-text-muted)] flex items-center gap-3">
                      <span>
                        <strong className="text-[15px] text-[var(--v2-text-primary)]">{planBuildCount}</strong>{' '}
                        {selectedLanguage === 'he' ? 'אני בונה' : selectedLanguage === 'es' ? 'lo construyo yo' : 'I build'}
                      </span>
                      {yoursCards.length > 0 && (
                        <span>
                          <strong className="text-[15px]" style={{ color: '#C2410C' }}>{yoursCards.length}</strong>{' '}
                          {selectedLanguage === 'he' ? 'דורש אותך' : selectedLanguage === 'es' ? 'te necesita' : 'needs you'}
                        </span>
                      )}
                    </span>
                  </div>

                  {/* One card per fact, each changeable.
                      This was one tall summary — a header, a pipeline strip,
                      feature tiles, a service list — which read as a receipt
                      of what the user had said. What they need at this moment
                      is a set of decisions they can still touch, so each fact
                      gets its own card, states what will happen in a sentence,
                      and carries the same quiet change affordance in the same
                      corner. The one thing only they can do looks different
                      and offers no change link, because there is nothing to
                      change — only something to do. */}
                  <div className="p-5">
                    <SetupFactDeck>
                      <SetupFactCard
                        color="#8B5CF6"
                        icon={<Building2 className="w-3.5 h-3.5" />}
                        title={selectedLanguage === 'he' ? 'העסק שלך' : selectedLanguage === 'es' ? 'Tu negocio' : 'Your business'}
                        value={
                          editingName !== null ? (
                            <span className="flex items-center gap-2">
                              <input
                                autoFocus
                                value={editingName}
                                onChange={e => setEditingName(e.target.value)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') saveBusinessName();
                                  if (e.key === 'Escape') setEditingName(null);
                                }}
                                placeholder={selectedLanguage === 'he' ? 'שם העסק' : selectedLanguage === 'es' ? 'Nombre del negocio' : 'Business name'}
                                className={cn(
                                  'flex-1 min-w-0 px-2 py-1 text-sm bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-md text-[var(--v2-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--v2-primary)]',
                                  isRTL && 'text-right'
                                )}
                              />
                              <button
                                onClick={saveBusinessName}
                                className="text-[var(--v2-primary)] hover:opacity-80 flex-shrink-0"
                                aria-label={selectedLanguage === 'he' ? 'שמור' : selectedLanguage === 'es' ? 'Guardar' : 'Save'}
                              >
                                <Check className="w-4 h-4" />
                              </button>
                            </span>
                          ) : (
                            [
                              previewData.businessProfile?.company_name,
                              previewData.businessProfile?.verticalDisplayName,
                            ].filter(Boolean).join(' · ')
                          )
                        }
                        // Corrected here rather than by describing it to the
                        // chat: it is a name, and the extraction that guessed
                        // it wrong once would only be guessing again.
                        onChange={() => setEditingName(previewData.businessProfile?.company_name || '')}
                        changeLabel={changeLabel}
                      />

                      {/*
                        WHAT WE UNDERSTOOD, in their own words — its own card,
                        full width, directly under the name.
                        ─────────────────────────────────────────────────────────
                        The name card said "David KPMG · Service Provider" and
                        stopped there. Everything the owner had just spent five
                        questions telling us — who their clients are, what those
                        clients leave with, what trained them for it — went into
                        a profile column unseen, and their first sight of our
                        reading of it was a published website.

                        This paragraph is the text the site is written from, so
                        it belongs on the screen where the plan is approved,
                        while it still costs a sentence to correct.

                        Stretched rather than sat in the grid because it is
                        prose: at 220px a column it would wrap to eight lines
                        and read as a wall beside two one-line facts.

                        No change link. The others point at an editor that owns
                        the fact; this one was composed from the interview, and
                        the honest way to change it is to say so to the chat —
                        an input here would be a second, competing source of the
                        same sentence.
                      */}
                      {previewData.businessDescription && (
                        <div style={{ gridColumn: '1/-1' }}>
                          <SetupFactCard
                            color="#8B5CF6"
                            icon={<FileText className="w-3.5 h-3.5" />}
                            title={
                              selectedLanguage === 'he'
                                ? 'איך נתאר את העסק שלך'
                                : selectedLanguage === 'es'
                                  ? 'Cómo describiremos tu negocio'
                                  : 'How we will describe your business'
                            }
                            value={
                              <span className={cn('block text-[12.5px] leading-relaxed font-normal', isRTL && 'text-right')}>
                                <bdi>{previewData.businessDescription}</bdi>
                              </span>
                            }
                          />
                        </div>
                      )}

                      {/* Every service, with the journey each one produces.
                          Three chips reading "name · price" said nothing about
                          what a client would actually walk through, and hid the
                          rest of the list behind a count. The differences
                          between services are the point — one takes a card at
                          booking, one is invoiced after, one is free — so they
                          are shown side by side. */}
                      {/*
                        Rendered on the COUNT as well as the catalogue.
                        ───────────────────────────────────────────────────────
                        `previewData.services` is normally empty: the interview
                        asks how MANY services there are, not for a list of
                        them, because collecting a catalogue field by field in
                        a chat is where owners stopped. The build then creates
                        that many drafts.

                        So gating this block on `services.length` hid the whole
                        section from the exact account the common path produces:
                        three services created by a build whose plan screen had
                        said nothing about any services at all.
                      */}
                      {plannedServiceCount > 0 && (
                        <div style={{ gridColumn: '1/-1' }}>
                          <div className="bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-[14px] p-4">
                            <div className="flex items-center justify-between gap-3 mb-3">
                              <div className="flex items-center gap-2.5 min-w-0">
                                <span
                                  className="w-[27px] h-[27px] rounded-[9px] grid place-items-center flex-shrink-0"
                                  style={{ background: 'rgba(209, 78, 151, 0.12)', color: '#D14E97' }}
                                >
                                  <Calendar className="w-3.5 h-3.5" />
                                </span>
                                <h4 className="text-[13.5px] font-semibold text-[var(--v2-text-primary)] m-0">
                                  {selectedLanguage === 'he' ? 'מה שאתה מוכר' : selectedLanguage === 'es' ? 'Lo que vendes' : 'What you sell'}
                                </h4>
                              </div>
                              <button
                                onClick={openServicesEditor}
                                className="text-[10.5px] text-[var(--v2-text-muted)] border border-[var(--v2-border)] rounded-full px-2.5 py-0.5 bg-[var(--v2-surface)] flex-shrink-0"
                              >
                                {changeLabel}
                              </button>
                            </div>

                            {/*
                              NAMES, AND THAT THEY ARE DRAFTS.
                              ───────────────────────────────────────────────
                              This listed a price, a duration and a client
                              journey per service. Every service created by
                              onboarding is a PLACEHOLDER whose price and
                              length the owner sets in the editor afterwards,
                              so each of those three was showing a decision
                              nobody had made: with no price given, the row
                              printed "On request", which is not a blank, it
                              is a published pricing policy. The journey strip
                              was drawn from a `collection` value nobody had
                              been asked for either.

                              What is true and worth showing is the list of
                              things that will exist, and that they arrive
                              unfinished. The price belongs on the one screen
                              built for entering prices, which the change link
                              already opens.
                            */}
                            <p className="text-[11.5px] text-[var(--v2-text-muted)] m-0 mb-2.5 leading-snug">
                              {namedServices.length === 0
                                ? (selectedLanguage === 'he'
                                    ? `ניצור ${plannedServiceCount} טיוטות. את השמות, המחירים והמשך תגדירו אחר כך.`
                                    : selectedLanguage === 'es'
                                      ? `Crearemos ${plannedServiceCount} borradores. Los nombres, precios y duraciones los defines después.`
                                      : `We will create ${plannedServiceCount} drafts. You name, price and time them later.`)
                                : (selectedLanguage === 'he'
                                    ? 'ניצור את אלה כטיוטות. מחירים ומשך תגדירו אחר כך.'
                                    : selectedLanguage === 'es'
                                      ? 'Los crearemos como borradores. Los precios y las duraciones los defines después.'
                                      : 'We will create these as drafts. You set prices and durations later.')}
                            </p>

                            <div className="flex flex-wrap gap-1.5">
                              {namedServices.map((service, idx) => (
                                <span
                                  key={idx}
                                  className="inline-flex items-center gap-1.5 text-[12px] text-[var(--v2-text-primary)] bg-[var(--v2-bg)] border border-[var(--v2-border)] rounded-full px-2.5 py-1 max-w-full"
                                >
                                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: '#D14E97' }} />
                                  <bdi className="truncate">{service.service_name}</bdi>
                                </span>
                              ))}

              {/* The ones still unnamed when the naming call could not
                                  reach the count, or failed. Dashed rather than
                                  given a made-up name here, because this card
                                  is where the owner approves the plan: a name
                                  invented in the UI is one they never see a
                                  chance to correct. The build names these
                                  itself. */}
                              {Array.from({ length: unnamedServiceCount }).map((_, idx) => (
                                <span
                                  key={`unnamed-${idx}`}
                                  className="inline-flex items-center gap-1.5 text-[12px] text-[var(--v2-text-muted)] bg-transparent border border-dashed border-[var(--v2-border)] rounded-full px-2.5 py-1"
                                >
                                  <span className="w-1.5 h-1.5 rounded-full border border-[var(--v2-text-muted)] flex-shrink-0" />
                                  {selectedLanguage === 'he'
                                    ? 'שירות ללא שם'
                                    : selectedLanguage === 'es'
                                      ? 'servicio sin nombre'
                                      : 'unnamed service'}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* The pipeline drawn as a pipeline.
                          A row of coloured pills is a set, and a client journey
                          is a sequence — the one thing pills cannot show is
                          that a contact moves from each stage to the next,
                          which is the entire idea. Numbered, connected, and in
                          the reading direction. */}
                      {previewData.pipelineStages && previewData.pipelineStages.length > 0 && (
                        <div style={{ gridColumn: '1/-1' }}>
                          <div className="bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-[14px] p-4">
                            <div className="flex items-center justify-between gap-3 mb-4">
                              <div className="flex items-center gap-2.5 min-w-0">
                                <span
                                  className="w-[27px] h-[27px] rounded-[9px] grid place-items-center flex-shrink-0"
                                  style={{ background: 'rgba(139, 92, 246, 0.12)', color: '#8B5CF6' }}
                                >
                                  <Users className="w-3.5 h-3.5" />
                                </span>
                                <h4 className="text-[13.5px] font-semibold text-[var(--v2-text-primary)] m-0">
                                  {selectedLanguage === 'he' ? 'מסע הלקוח שלך' : selectedLanguage === 'es' ? 'Tu recorrido de cliente' : 'Your client journey'}
                                </h4>
                              </div>
                              <button
                                onClick={openPipelineEditor}
                                className="text-[10.5px] text-[var(--v2-text-muted)] border border-[var(--v2-border)] rounded-full px-2.5 py-0.5 bg-[var(--v2-surface)] flex-shrink-0"
                              >
                                {changeLabel}
                              </button>
                            </div>

                            <div className="flex items-stretch gap-0 overflow-x-auto pb-1">
                              {previewData.pipelineStages.map((stage, idx) => (
                                <div key={stage.stage_key} className="flex items-center flex-shrink-0">
                                  {idx > 0 && (
                                    <span
                                      className="w-5 h-[2px] flex-shrink-0"
                                      style={{
                                        background: `linear-gradient(${isRTL ? 'to left' : 'to right'}, ${previewData.pipelineStages![idx - 1].color}, ${stage.color})`,
                                      }}
                                    />
                                  )}
                                  <div
                                    className="flex flex-col gap-1.5 px-3 py-2.5 rounded-xl border min-w-[104px]"
                                    style={{
                                      borderColor: `${stage.color}55`,
                                      background: `${stage.color}0F`,
                                    }}
                                  >
                                    <div className="flex items-center gap-1.5">
                                      <span
                                        className="w-[18px] h-[18px] rounded-full grid place-items-center text-[10px] font-bold text-white flex-shrink-0"
                                        style={{ background: stage.color }}
                                      >
                                        {idx + 1}
                                      </span>
                                      <span
                                        className="text-[12px] font-semibold truncate"
                                        style={{ color: stage.color }}
                                      >
                                        {stage.stage_label}
                                      </span>
                                    </div>
                                    <span className="text-[10.5px] text-[var(--v2-text-muted)]">
                                      {idx === 0
                                        ? (selectedLanguage === 'he' ? 'נכנס לכאן' : selectedLanguage === 'es' ? 'entra aquí' : 'enters here')
                                        : idx === previewData.pipelineStages!.length - 1
                                          ? (selectedLanguage === 'he' ? 'סיום' : selectedLanguage === 'es' ? 'final' : 'done')
                                          : (selectedLanguage === 'he' ? 'בתהליך' : selectedLanguage === 'es' ? 'en curso' : 'in progress')}
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>

                            <p className="text-[11px] text-[var(--v2-text-muted)] mt-3 mb-0 leading-relaxed">
                              {selectedLanguage === 'he'
                                ? 'כל פנייה נכנסת לשלב הראשון, ואתה מזיז אותה קדימה. כך תדע תמיד מי ממתין לך.'
                                : selectedLanguage === 'es'
                                  ? 'Cada consulta entra en la primera etapa y tú la mueves hacia adelante. Así siempre sabes quién te espera.'
                                  : 'Every enquiry lands in the first stage and you move it along. That is how you always know who is waiting on you.'}
                            </p>
                          </div>
                        </div>
                      )}

                      <SetupFactCard
                        color="#22C58B"
                        icon={<CreditCard className="w-3.5 h-3.5" />}
                        title={selectedLanguage === 'he' ? 'איך מקבלים תשלום' : selectedLanguage === 'es' ? 'Cómo cobras' : 'How you get paid'}
                        value={collectionSummary}
                        /*
                         * Its own chooser, not the services dialog.
                         *
                         * This opened `openServicesEditor`, which was right
                         * while that editor carried a per-service collection
                         * control. It was later cut back to names only and
                         * says so on its face, so Change on "How you get
                         * paid" led to a dialog titled "What you sell" that
                         * told the owner payment is set elsewhere. See
                         * `setCollectionMethod`.
                         */
                        onChange={() => setPlanEditor('collection')}
                        changeLabel={changeLabel}
                      />

                      <SetupFactCard
                        color="#4F6EF7"
                        icon={<Globe className="w-3.5 h-3.5" />}
                        title={selectedLanguage === 'he' ? 'איך לקוחות מגיעים אליך' : selectedLanguage === 'es' ? 'Cómo te encuentran' : 'How clients reach you'}
                        value={presenceSummary}
                        onChange={() => setPlanEditor('presence')}
                        changeLabel={changeLabel}
                      />

                      {yoursCards.map(card => (
                        <SetupFactCard
                          key={card.key}
                          color="#C2410C"
                          yours
                          icon={card.icon}
                          title={card.title}
                          value={card.value}
                          note={card.note}
                        />
                      ))}
                    </SetupFactDeck>
                  </div>

                  {/* CTA Section */}
                  <div className="px-5 pb-5">
                    <div className="bg-[var(--v2-primary)]/10 rounded-xl p-4 border border-[var(--v2-primary)]/20">
                      <p className="text-sm text-[var(--v2-text-secondary)] mb-3">
                        {selectedLanguage === 'he'
                          ? 'הכל נראה טוב?'
                          : selectedLanguage === 'es'
                          ? '¿Todo bien?'
                          : 'All good?'}
                      </p>
                      {/* One action. There used to be a second — a return to
                          the conversation — which named a destination nobody
                          could picture: the plan is the screen, and "back to
                          the chat" read as undoing it. Every card carries its
                          own change link now, so there is nothing left for a
                          general escape hatch to do. */}
                      <div className="flex flex-col gap-2">
                        <button
                          onClick={handleBuild}
                          disabled={isSending}
                          className="w-full px-6 py-3.5 bg-[var(--v2-primary)] text-white font-bold rounded-xl hover:opacity-90 transition-all shadow-lg hover:shadow-xl hover:scale-[1.02] disabled:opacity-50 disabled:hover:scale-100 flex items-center justify-center gap-2"
                        >
                          {isSending ? (
                            <Loader2 className="w-5 h-5 animate-spin" />
                          ) : (
                            <>
                              <Sparkles className="w-5 h-5" />
                              {selectedLanguage === 'he' ? 'בנה את המערכת שלי!' : selectedLanguage === 'es' ? '¡Construir mi sistema!' : 'Build My System!'}
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
          </div>
        )}

        <div
          /*
           * ───────────────────────────────────────────────────────────────────
           * THE CONVERSATION IS SIZED AND NEVER GROWS.
           *
           * `flex-1` takes exactly what is left under the frozen header;
           * `min-h-0` lets it be smaller than its own content so the MESSAGE
           * LIST inside becomes the overflow container. That is what makes the
           * list the single scroller on this screen, and what makes the
           * auto-scroll effect work: it calls `scrollTo` on the list, which
           * only does anything while the list is the element that overflows.
           *
           * TWO THINGS DELIBERATELY REMOVED, both of which pushed the overflow
           * up to an ancestor and produced a second scrollbar:
           *
           *   height: calc(100dvh - 150px)
           *     The viewport less a guess at the chrome above it. Every such
           *     guess is wrong the moment the header changes, and this one
           *     already was: the header and padding come to about 120px, so
           *     the thread sat short and the window scrolled to make it up.
           *     An earlier `calc(100vh - 280px)` was measured against a
           *     progress bar that no longer exists. Freezing the header is
           *     what lets the number go.
           *
           *   minHeight: 420px
           *     A floor against the thread collapsing on a short window, and
           *     the direct cause of the doubled scrollbar: 420px against a
           *     shorter space is overflow, and overflow here escapes to an
           *     ancestor. It is not needed to keep the composer reachable
           *     either — the list shrinks and the composer is `shrink-0`
           *     beneath it, so on a short window you get a small thread with
           *     its own scroll rather than a tall one the page has to scroll.
           * ───────────────────────────────────────────────────────────────────
           */
          className={cn('flex flex-1 min-h-0 flex-col gap-4', showPlanScreen && 'hidden')}
        >

        <div className="bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg shadow-lg flex-1 min-h-0">
          <div className="flex flex-col h-full">
            {/* Messages Area */}
            <div ref={messagesScrollRef} className="flex-1 overflow-y-auto px-6 py-6 space-y-4">
              {messages.map((message, index) => {
                // Skip rendering empty assistant messages (visual preview handles the display)
                if (message.role === 'assistant' && !message.content?.trim() && !message.suggestions?.length) {
                  return null;
                }
                return (
                <div
                  key={index}
                  // No direction conditionals here on purpose.
                  //
                  // The page root already carries dir="rtl" for Hebrew, which
                  // reverses flex order and makes justify-start/end resolve to
                  // the inline start and end. Adding `isRTL ? 'flex-row-reverse'`
                  // on top flipped it a second time, so the assistant's avatar
                  // came back to the left in Hebrew — the direction cancelled
                  // itself out. Logical properties already do this correctly.
                  className={cn(
                    'flex gap-3',
                    message.role === 'user' ? 'flex-row-reverse justify-end' : 'flex-row justify-start'
                  )}
                >
                  {/* Avatar */}
                  {/*
                      TWO SPEAKERS, TWO HUES.
                      ───────────────────────────────────────────────────────
                      Both avatars were `--v2-primary`, and the user's bubble
                      was filled with it too, so the ONLY thing separating the
                      two speakers was which side of the thread they sat on.
                      That is a weak cue while scrolling and a weaker one in
                      Hebrew, where the eye is already working right to left.

                      So the palette carries it: indigo (`--v2-primary`) is the
                      owner, violet (`--v2-secondary`) is the assistant. Both
                      tokens already exist and already appear together on the
                      plan screen, so nothing new enters the palette.
                  */}
                  {message.role === 'assistant' && (
                    /*
                     * The avatar wears the same tint as the bubble it belongs
                     * to. Left solid, the two chips stayed the loudest marks
                     * on a page whose bubbles had just been quietened, so the
                     * eye went to the icons rather than to the words.
                     */
                    <div
                      className="w-8 h-8 border bg-[var(--v2-surface)] border-[var(--v2-border)] flex items-center justify-center flex-shrink-0 rounded-lg"
                      style={VOICE_TINT.assistant}
                    >
                      <Bot className="h-4 w-4 text-[var(--v2-text-primary)]" />
                    </div>
                  )}

                  {/* Message Content */}
                  <div className="max-w-[75%]">
                    <div
                      className={cn(
                        'px-4 py-3 rounded-lg',
                        /*
                         * One base for both voices now. The side, the avatar
                         * and the hue of the tint below are what tell them
                         * apart — not one being filled and the other drawn.
                         * These classes are also the no-`color-mix` fallback.
                         */
                        'border border-[var(--v2-border)] bg-[var(--v2-surface)] text-[var(--v2-text-primary)]',
                        isRTL ? 'text-right' : 'text-left'
                      )}
                      /*
                       * Both voices, from the one definition at the top of
                       * this file — the same object the avatar beside this
                       * bubble is painted with, so a bubble and its icon can
                       * never disagree.
                       */
                      style={VOICE_TINT[message.role === 'user' ? 'user' : 'assistant']}
                    >
                      <p className="text-sm whitespace-pre-wrap leading-relaxed">
                        {message.content}
                      </p>

{/* Suggestions are now rendered outside the message card - see below */}
                    </div>
                  </div>

                  {/* User Avatar */}
                  {message.role === 'user' && (
                    <div
                      className="w-8 h-8 border bg-[var(--v2-surface)] border-[var(--v2-border)] flex items-center justify-center flex-shrink-0 rounded-lg"
                      style={VOICE_TINT.user}
                    >
                      <User className="h-4 w-4 text-[var(--v2-text-primary)]" />
                    </div>
                  )}
                </div>
              );
              })}

              {/* Standalone Suggestions - rendered outside message cards, no wrapper/icon */}
              {messages.length > 0 && (() => {
                const lastMessage = messages[messages.length - 1];
                if (lastMessage.role !== 'assistant' || !lastMessage.suggestions || showPreview) {
                  return null;
                }
                /*
                 * ───────────────────────────────────────────────────────────
                 * THE CHIPS, AS THE PLATFORM ALREADY DRAWS THEM.
                 *
                 * `CHIP_BASE` and `CHIP_ON`/`CHIP_OFF` below are the refund
                 * reason chips from `components/payments/RefundModal.tsx`,
                 * which is the pattern this product already uses for "pick
                 * from the usual answers". Two things it gets right that the
                 * rows here did not:
                 *
                 *   SELECTED IS AN INVERSION, not a tint. A chosen option was
                 *   a 10% wash of the accent with an accent border — one step
                 *   from the hover state of an unchosen one, and on a
                 *   multi-select that is the whole question: an owner could
                 *   not tell what they had ticked, or that ticking several was
                 *   allowed at all.
                 *
                 *   SELECTED INK, NOT SELECTED ACCENT. The fill is
                 *   `--v2-text-primary`, so a chosen chip never competes with
                 *   the Continue button, which is the accent. Choosing is not
                 *   the same act as proceeding and should not look like it.
                 *
                 * WHAT IS DELIBERATELY NOT COPIED: the refund chips wrap, and
                 * these only wrap when every label is SHORT. The reason the
                 * rows exist is in the comment below, and it still holds —
                 * these answers carry their consequence in the label ("I
                 * collect the money myself: invoice, transfer or cash"), and
                 * wrapped they read as a paragraph of buttons. So the layout
                 * follows the labels: pills for "English / עברית / Español",
                 * rows for a sentence. That is the same rule the old comment
                 * was reaching for, now applied per question instead of
                 * assumed for all of them.
                 * ───────────────────────────────────────────────────────────
                 */
                const CHIP_BASE =
                  'transition-colors disabled:opacity-40 disabled:cursor-not-allowed ' +
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--v2-primary)] focus-visible:ring-offset-1';
                const CHIP_ON = 'bg-[var(--v2-text-primary)] text-[var(--v2-bg)] border border-[var(--v2-text-primary)]';
                const CHIP_OFF =
                  'bg-[var(--v2-surface)] border border-[var(--v2-border)] text-[var(--v2-text-secondary)] ' +
                  'hover:border-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)]';

                /*
                 * Short enough to sit side by side. Measured against the
                 * longest label rather than each one, so a question never
                 * splits into some pills and some rows — which reads as two
                 * kinds of answer to one question.
                 */
                const longest = Math.max(...lastMessage.suggestions.map(option => option.length));
                const asPills = longest <= 28;
                const shape = asPills
                  ? 'inline-flex items-center gap-2 px-3.5 py-2 text-[13px] font-medium'
                  : cn('flex w-full items-center gap-2 px-4 py-2.5 text-sm font-medium', isRTL ? 'text-right' : 'text-left');
                const layout = asPills ? 'flex flex-wrap gap-2' : 'flex flex-col gap-2';
                const radius = asPills ? '999px' : '0.5rem';

                return (
                  <div className={cn('mt-4', isRTL ? 'text-right' : 'text-left')}>
                    {lastMessage.multiSelect ? (
                      // Multi-select with toggle buttons and platform icons
                      <div className="space-y-3">
                        {/* One answer per row.
                            Wrapped chips give each option a different width and
                            a different line depending on how long its text is,
                            so they read as a paragraph of buttons rather than a
                            list of choices — and the answers now carry their
                            consequence in the label ("— בלי סליקה"), which
                            makes them far too long to sit side by side. */}
                        <div className={layout}>
                          {(() => {
                            // "Not now" and the rest cannot both be true, and
                            // the rule is worth showing rather than enforcing
                            // silently: picking a website used to make the
                            // "not now" chip quietly deselect itself, which
                            // reads as the interface changing its mind.
                            const isNone = (option: string) =>
                              option.toLowerCase().includes('none') ||
                              option.includes('לא צריך') ||
                              option.includes('no necesito') ||
                              option.toLowerCase().includes("don't need");

                            return lastMessage.suggestions!.map((suggestion, idx) => {
                            const isSelected = multiSelectChoices.has(suggestion);
                            // Detect "none" option by checking for common patterns across languages
                            // One definition, shared with the disabled state
                            // above — the English option reads "Don't need it
                            // now" and contains no "none" at all, so a second
                            // copy of this test would have disagreed with the
                            // first about which chip is the exclusive one.
                            const isNoneOption = isNone(suggestion);

                            // Map suggestion to icon based on content
                            const getIcon = () => {
                              const lower = suggestion.toLowerCase();
                              if (lower.includes('website') || lower.includes('אתר') || lower.includes('sitio')) {
                                return <Globe className="w-4 h-4" />;
                              }
                              if (lower.includes('facebook') || lower.includes('instagram') || lower.includes('google') ||
                                  lower.includes('פייסבוק') || lower.includes('אינסטגרם') || lower.includes('גוגל')) {
                                return <Share2 className="w-4 h-4" />;
                              }
                              if (isNoneOption) {
                                return <XCircle className="w-4 h-4" />;
                              }
                              return null;
                            };

                            const icon = getIcon();

                            return (
                              <button
                                key={idx}
                                onClick={() => {
                                  // Every option toggles on its own.
                                  //
                                  // Declining a website says nothing about
                                  // whether someone wants their Facebook and
                                  // Google connected — those are separate
                                  // questions, and the old "not now" chip
                                  // answered both at once. Making that chip
                                  // exclusive only moved the problem: picking
                                  // it then cleared the channels the user did
                                  // want. Nothing blocks anything now, and the
                                  // parser ignores a stray "not now" whenever a
                                  // real option was chosen with it.
                                  setMultiSelectChoices(prev => {
                                    const next = new Set(prev);
                                    if (next.has(suggestion)) next.delete(suggestion);
                                    else next.add(suggestion);
                                    return next;
                                  });
                                }}
                                disabled={isSending}
                                aria-pressed={isSelected}
                                style={{ borderRadius: radius }}
                                className={cn(
                                  // Still identical to the single-select
                                  // options, which was always right: they are
                                  // the same kind of thing, and a shadow or a
                                  // scale on the chosen one made picking an
                                  // answer look like a different mechanism.
                                  // What changed is that BOTH now invert when
                                  // chosen instead of taking a 10% wash.
                                  CHIP_BASE,
                                  shape,
                                  isSelected ? CHIP_ON : CHIP_OFF
                                )}
                              >
                                {/*
                                    THE TICK IS WHAT SAYS "PICK AS MANY AS YOU
                                    LIKE". Nothing did: the only difference
                                    between this question and a single-select
                                    one was that an answer did not send, which
                                    an owner discovers by waiting. A box that
                                    fills is the one convention everybody
                                    already reads, and it costs a 14px square.
                                */}
                                <span
                                  aria-hidden
                                  className={cn(
                                    'inline-flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-[3px] border',
                                    isSelected
                                      ? 'border-[var(--v2-bg)] bg-[var(--v2-bg)]/15'
                                      : 'border-[var(--v2-text-muted)]'
                                  )}
                                >
                                  {isSelected && <Check className="h-[10px] w-[10px]" strokeWidth={3} />}
                                </span>
                                {icon}
                                {suggestion}
                              </button>
                            );
                            });
                          })()}
                        </div>
                        {/* Always offered, including with nothing ticked.
                            The blanket "not now" chip used to carry that
                            answer, but it made declining a website and
                            declining channel tracking the same act — they are
                            not. Wanting neither is simply choosing nothing and
                            carrying on. */}
                        {(
                          <button
                            onClick={() => {
                              const chosen = Array.from(multiSelectChoices);
                              sendMessage(
                                chosen.length > 0
                                  ? chosen.join(', ')
                                  // Said in the words the parser reads, so an
                                  // empty selection records both as declined
                                  // rather than arriving as an empty message.
                                  : selectedLanguage === 'he'
                                    ? 'לא צריך כרגע'
                                    : selectedLanguage === 'es'
                                      ? 'No necesito por ahora'
                                      : "Don't need it now"
                              );
                              setMultiSelectChoices(new Set());
                            }}
                            disabled={isSending}
                            className={cn(
                              // Same shape as the options above it — a row of
                              // the same width, height and radius. A gradient
                              // pill with a shadow read as a different kind of
                              // thing entirely, which is how it ends up looking
                              // like an advert rather than the next step.
                              'w-full px-4 py-2.5 text-sm font-semibold rounded-lg transition-all disabled:opacity-50',
                              /*
                               * THE PLATFORM ORANGE, which this page did not
                               * use anywhere: every button here was
                               * `--v2-primary`, the indigo, while every
                               * primary action in Business OS is #F97316. So
                               * onboarding looked like a different product
                               * from the one it was setting up.
                               *
                               * It also resolves the collision the chips
                               * created. Selecting is ink, proceeding is
                               * orange: two different acts, two different
                               * colours, and neither competing with the
                               * other. That was already the argument for
                               * giving a chosen chip the ink fill rather than
                               * the accent — this is the other half of it.
                               */
                              ORANGE_BUTTON,
                              'flex items-center gap-2',
                              'justify-center'
                            )}
                          >
                            {isSending ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <>
                                <Check className="w-4 h-4" />
                                {multiSelectChoices.size > 0
                                  ? (selectedLanguage === 'he' ? 'המשך' : selectedLanguage === 'es' ? 'Continuar' : 'Continue')
                                  : (selectedLanguage === 'he' ? 'המשך בלי אלה' : selectedLanguage === 'es' ? 'Continuar sin esto' : 'Continue without these')}
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className={layout}>
                        {lastMessage.suggestions.map((suggestion, idx) => {
                          /*
                           * The pressed one INVERTS and the rest fade, for the
                           * wait the owner is about to have.
                           *
                           * Pressing a chip used to change nothing: `isSending`
                           * dimmed all of them equally, so the answer that was
                           * chosen looked exactly like the ones that were not,
                           * for as long as the model took. The chip that was
                           * pressed is the one piece of information the screen
                           * has at that moment and it was the one thing not
                           * shown.
                           *
                           * Scoped to this message, so the inversion cannot
                           * survive into the next question: `atMessage` pins it
                           * to the thread length it was pressed at.
                           */
                          const isPressed =
                            pressedChoice?.option === suggestion
                            && pressedChoice.atMessage === messages.length;

                          return (
                            <button
                              key={idx}
                              onClick={() => {
                                setPressedChoice({ option: suggestion, atMessage: messages.length });
                                handleSuggestionClick(suggestion);
                              }}
                              disabled={isSending}
                              style={{ borderRadius: radius }}
                              className={cn(CHIP_BASE, shape, isPressed ? CHIP_ON : CHIP_OFF)}
                            >
                              {suggestion}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })()}


              {/*
                  THE ASSISTANT IS COMPOSING.
                  ─────────────────────────────────────────────────────────────
                  `isSending` only ever disabled buttons and spun a spinner
                  inside them, so the THREAD said nothing at all: the owner
                  answered, the screen went still, and the next question
                  appeared some seconds later with nothing in between. On the
                  deepening step that gap is two model calls long, which is
                  long enough to wonder whether the answer was received.

                  Built as a real message rather than a status line: same row,
                  same avatar, same tinted bubble, so the dots occupy exactly
                  the space the reply is about to fill and nothing jumps when
                  it arrives.

                  The negative delays matter. Three dots sharing one animation
                  bounce in unison, which reads as a loading toy; starting each
                  one part-way through its cycle is what makes it a wave.
              */}
              {isSending && (
                <div className="flex gap-3 flex-row justify-start" aria-live="polite">
                  {/* The assistant is about to speak, so it wears exactly what
                      it speaks in — the same chip and the same tint as a real
                      message, or the page changes colour the moment one
                      arrives. */}
                  <div
                    className="w-8 h-8 border bg-[var(--v2-surface)] border-[var(--v2-border)] flex items-center justify-center flex-shrink-0 rounded-lg"
                    style={VOICE_TINT.assistant}
                  >
                    <Bot className="h-4 w-4 text-[var(--v2-text-primary)]" />
                  </div>

                  <div
                    className="px-4 py-3 rounded-lg bg-[var(--v2-surface)] border border-[var(--v2-border)]"
                    style={VOICE_TINT.assistant}
                  >
                    <span className="sr-only">
                      {selectedLanguage === 'he'
                        ? 'כותב...'
                        : selectedLanguage === 'es'
                          ? 'Escribiendo...'
                          : 'Typing...'}
                    </span>

                    <span className="flex items-center gap-1 h-5" aria-hidden="true">
                      {[0, 1, 2].map(i => (
                        <span
                          key={i}
                          className="w-1.5 h-1.5 rounded-full animate-bounce motion-reduce:animate-none"
                          style={{
                            background: 'var(--v2-secondary)',
                            /* Part-way through the cycle, so they travel as a
                               wave instead of in unison. */
                            animationDelay: `${-320 + i * 160}ms`,
                            animationDuration: '1.1s',
                          }}
                        />
                      ))}
                    </span>
                  </div>
                </div>
              )}

            </div>

            {/* Services Form Modal */}
            {showServicesForm && (
              <div className="px-6 py-4 border-t border-[var(--v2-border)] bg-[var(--v2-surface)]">
                <div className="bg-[var(--v2-primary)]/5 border border-[var(--v2-primary)]/20 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-semibold text-[var(--v2-text-primary)]">
                      {selectedLanguage === 'he' ? 'הוסף שירותים' : selectedLanguage === 'es' ? 'Agregar servicios' : 'Add Services'}
                    </h3>
                    <button
                      onClick={dismissServicesForm}
                      className="p-1 text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Header Row */}
                  <div className={cn('grid grid-cols-[repeat(15,minmax(0,1fr))] gap-2 mb-2 text-xs font-medium text-[var(--v2-text-secondary)]', isRTL && 'text-right')}>
                    <div className="col-span-3">
                      {selectedLanguage === 'he' ? 'שם השירות' : selectedLanguage === 'es' ? 'Nombre del servicio' : 'Service Name'}
                    </div>
                    <div className="col-span-2">
                      {selectedLanguage === 'he' ? 'דורש תור?' : selectedLanguage === 'es' ? '¿Cita?' : 'Appointment?'}
                    </div>
                    <div className="col-span-2">
                      {selectedLanguage === 'he' ? 'איך נמכר?' : selectedLanguage === 'es' ? '¿Cómo se vende?' : 'How sold?'}
                    </div>
                    <div className="col-span-2">
                      {selectedLanguage === 'he' ? 'משך / הפסקה' : selectedLanguage === 'es' ? 'Duración / Pausa' : 'Duration / Break'}
                    </div>
                    <div className="col-span-2">
                      {selectedLanguage === 'he' ? 'מחיר' : selectedLanguage === 'es' ? 'Precio' : 'Price'}
                      {/* Says out loud that the box can be left empty. A price
                          field with a 0 in it reads as required, so a business
                          that quotes per client types a number it does not
                          mean — and that number goes on a public page. */}
                      <span className="block text-[10px] font-normal text-[var(--v2-text-muted)] leading-tight">
                        {selectedLanguage === 'he'
                          ? 'ריק = לפי הצעת מחיר'
                          : selectedLanguage === 'es'
                            ? 'vacío = a convenir'
                            : 'empty = on request'}
                      </span>
                    </div>
                    <div className="col-span-2">
                      {selectedLanguage === 'he' ? 'איך משלמים?' : selectedLanguage === 'es' ? '¿Cómo se paga?' : 'How paid?'}
                    </div>
                    <div className="col-span-1">
                      {selectedLanguage === 'he' ? 'תשלומים' : selectedLanguage === 'es' ? 'Cuotas' : 'Plan'}
                    </div>
                    <div className="col-span-1"></div>
                  </div>

                  {/* Service Rows */}
                  <div className="space-y-2">
                    {servicesInput.map((service, index) => (
                      <div key={index} className="grid grid-cols-[repeat(15,minmax(0,1fr))] gap-2">
                        <input
                          type="text"
                          value={service.name}
                          onChange={(e) => updateServiceRow(index, 'name', e.target.value)}
                          placeholder={selectedLanguage === 'he' ? 'לדוגמה: ייעוץ אישי' : selectedLanguage === 'es' ? 'Ej: Consulta personal' : 'e.g. Personal Consultation'}
                          className={cn(
                            'col-span-3 px-3 py-2 text-sm bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--v2-primary)] text-[var(--v2-text-primary)] placeholder:text-[var(--v2-text-muted)]',
                            isRTL && 'text-right'
                          )}
                        />

                        {/* Does a client pick a time for this? A product does
                            not, and saying so here is what keeps the platform
                            from asking this business for working hours it will
                            never use. */}
                        <div className="col-span-2 flex gap-1">
                          {([true, false] as const).map(value => (
                            <button
                              key={String(value)}
                              type="button"
                              onClick={() => updateServiceRow(index, 'isScheduled', value)}
                              className={cn(
                                'flex-1 px-1 py-2 text-[11px] rounded-lg border transition-colors',
                                service.isScheduled === value
                                  ? 'border-[#14B8A6] bg-[#14B8A6]/10 text-[#14B8A6] font-semibold'
                                  : 'border-[var(--v2-border)] text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)]'
                              )}
                            >
                              {value
                                ? (selectedLanguage === 'he' ? 'כן' : selectedLanguage === 'es' ? 'Sí' : 'Yes')
                                : (selectedLanguage === 'he' ? 'לא' : selectedLanguage === 'es' ? 'No' : 'No')}
                            </button>
                          ))}
                        </div>

                        {/* Bought outright, or quoted first. The same question
                            the service settings ask, in the same words — a
                            business must not be able to answer it one way here
                            and another way there. */}
                        <div className="col-span-2 flex gap-1">
                          {(['direct', 'proposal'] as const).map(value => (
                            <button
                              key={value}
                              type="button"
                              onClick={() => updateServiceRow(index, 'saleMode', value)}
                              className={cn(
                                'flex-1 px-1 py-2 text-[11px] rounded-lg border transition-colors truncate',
                                service.saleMode === value
                                  ? 'border-[#14B8A6] bg-[#14B8A6]/10 text-[#14B8A6] font-semibold'
                                  : 'border-[var(--v2-border)] text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)]'
                              )}
                            >
                              {value === 'direct'
                                ? (selectedLanguage === 'he' ? 'ישירות' : selectedLanguage === 'es' ? 'Directo' : 'Direct')
                                : (selectedLanguage === 'he' ? 'הצעה' : selectedLanguage === 'es' ? 'Cotizar' : 'Quote')}
                            </button>
                          ))}
                        </div>

                        {/* Present but dead once the answer is no.
                            A service nobody books against a time has no
                            length, so the field stops accepting one — but it
                            stays on screen, because this is a ROW in a grid the
                            person is reading across, and a cell that vanishes
                            mid-typing moves the columns under their eye.
                            Greyed says "not for this one"; gone says "did I
                            break something".

                            The value is kept, not cleared: answer "כן" again
                            and the same number is live again. It is dropped on
                            the way out instead, so nothing downstream inherits
                            a length that is no longer being asked for. */}
                        <div className="col-span-2 flex gap-1">
                          <input
                            type="number"
                            value={service.duration}
                            onChange={(e) => updateServiceRow(index, 'duration', e.target.value)}
                            disabled={service.isScheduled === false}
                            placeholder="60"
                            title={selectedLanguage === 'he' ? 'משך' : selectedLanguage === 'es' ? 'Duración' : 'Duration'}
                            className={cn(
                              'w-1/2 px-1.5 py-2 text-sm bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--v2-primary)] text-[var(--v2-text-primary)] tabular-nums',
                              service.isScheduled === false && 'opacity-40 cursor-not-allowed',
                              isRTL && 'text-right'
                            )}
                          />
                          {/* The gap to leave after it. Dies with the duration:
                              a service nobody books against a time has neither.
                              Never asked before, so every service set up here
                              silently took the platform's fifteen minutes. */}
                          <input
                            type="number"
                            min="0"
                            max="120"
                            value={service.bufferMinutes}
                            onChange={(e) => updateServiceRow(index, 'bufferMinutes', e.target.value)}
                            disabled={service.isScheduled === false}
                            placeholder="15"
                            title={selectedLanguage === 'he' ? 'הפסקה בין פגישות' : selectedLanguage === 'es' ? 'Pausa entre citas' : 'Break between meetings'}
                            className={cn(
                              'w-1/2 px-1.5 py-2 text-sm bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--v2-primary)] text-[var(--v2-text-muted)] tabular-nums',
                              service.isScheduled === false && 'opacity-40 cursor-not-allowed',
                              isRTL && 'text-right'
                            )}
                          />
                        </div>
                        <div className="col-span-2 relative">
                          {/* The currency is picked here, in the row, where
                              the price is typed — not behind the payment
                              dialog, which is about how a price is split, not
                              what it is denominated in. Same dropdown the
                              service settings use, with a trigger small enough
                              to sit inside the field.

                              ONCE, ON THE FIRST ROW. What is chosen here
                              becomes the business's own currency, so a second
                              row offering the choice again was offering one
                              that does not exist — see `updateServiceRow`.
                              Every row shows it; only the first can change it.

                              The displayed value falls back to the language
                              while nobody has chosen, WITHOUT storing that
                              fallback: a stored default cannot be told from an
                              answer, and the build route needs to tell them
                              apart.

                              THE LOCK IS ABOUT CONSISTENCY, NOT PERMANENCE.
                              Nothing here is frozen: the first row stays
                              editable for as long as onboarding is open, a
                              change there rewrites every row, and deleting the
                              first row promotes the next one to editable. So
                              the reason text says WHERE to change it rather
                              than only that this row cannot. */}
                          <div className={cn(
                            'absolute top-1/2 -translate-y-1/2 z-10',
                            isRTL ? 'right-2.5' : 'left-2.5'
                          )}>
                            <ServiceCurrencySelect
                              value={service.currency ?? currencyForLanguage(selectedLanguage)}
                              onChange={code => updateServiceRow(index, 'currency', code)}
                              compact
                              locked={index > 0}
                              lockedReason={
                                selectedLanguage === 'he'
                                  ? 'אפשר לשנות בשירות הראשון: הוא קובע את המטבע של העסק'
                                  : selectedLanguage === 'es'
                                    ? 'Cámbiala en el primer servicio: define la moneda del negocio'
                                    : 'Change it on the first service: it sets the currency for the whole business'
                              }
                            />
                          </div>
                          <input
                            type="number"
                            value={service.price}
                            onChange={(e) => updateServiceRow(index, 'price', e.target.value)}
                            disabled={service.saleMode === 'proposal'}
                            placeholder="—"
                            className={cn(
                              // Dead on a quote: the figure is named in the
                              // proposal. Same rule as the service settings.
                              service.saleMode === 'proposal' && 'opacity-40 cursor-not-allowed',
                              'w-full px-3 py-2 text-sm bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--v2-primary)] text-[var(--v2-text-primary)]',
                              isRTL ? 'pr-11 text-right' : 'pl-11'
                            )}
                          />
                        </div>

                        {/* Opens the same payment options the service
                            settings dialog offers. A row this narrow cannot
                            hold a payment type, a count and a frequency, and
                            splitting them across two different shapes would
                            mean learning the feature twice. */}
                        {/* How the money arrives — replacing the question the
                            chat used to ask the business once, which could not
                            describe a practice that takes a card for a session
                            and invoices for a programme. */}
                        <div className="col-span-2 flex gap-1">
                          {(['online', 'invoice'] as const).map(value => {
                            // `?? ''` because a row reaching here without a
                            // price throws inside render, and a thrown render
                            // takes the whole form down — every button in it
                            // stops responding, which reads as "the send is
                            // disabled" rather than as a crash.
                            const priceText = service.price ?? '';
                            /*
                             * A quoted job has no collection method either.
                             *
                             * Nobody has said what the work costs, so there is
                             * no money for a method to describe — it is settled
                             * on the proposal. The service settings apply the
                             * same rule, and these two must not disagree.
                             */
                            const priced =
                              service.saleMode !== 'proposal' &&
                              priceText.trim() !== '' &&
                              parseFloat(priceText) > 0;
                            return (
                              <button
                                key={value}
                                type="button"
                                disabled={!priced}
                                onClick={() => updateServiceRow(index, 'collection', value)}
                                className={cn(
                                  'flex-1 px-1 py-2 text-[11px] rounded-lg border transition-colors truncate',
                                  !priced
                                    ? 'border-[var(--v2-border)] text-[var(--v2-text-muted)] opacity-40'
                                    : service.collection === value
                                      ? 'border-[#22C58B] bg-[#22C58B]/10 text-[#22C58B] font-semibold'
                                      : 'border-[var(--v2-border)] text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)]'
                                )}
                              >
                                {value === 'online'
                                  ? (selectedLanguage === 'he' ? 'כרטיס' : selectedLanguage === 'es' ? 'Tarjeta' : 'Card')
                                  : (selectedLanguage === 'he' ? 'חשבונית' : selectedLanguage === 'es' ? 'Factura' : 'Invoice')}
                              </button>
                            );
                          })}
                        </div>

                        {/* Greyed on a quote, with price and collection.
                            A quoted service has no price yet, so a payment plan
                            describes money that does not exist — the same rule
                            the services settings apply, in the same words. The
                            cell stays in place rather than disappearing: a row
                            whose cells move as you change a toggle is harder to
                            read than one whose cells grey out. */}
                        <button
                          type="button"
                          onClick={() => setPaymentDialogIndex(index)}
                          disabled={!canSplit(service.saleMode, service.price)}
                          className={cn(
                            'col-span-1 px-1 py-2 text-xs rounded-lg border transition-colors truncate',
                            !canSplit(service.saleMode, service.price) && 'opacity-40 cursor-not-allowed',
                            service.paymentType === 'installments'
                              ? 'border-[#14B8A6] text-[#14B8A6] bg-[#14B8A6]/10'
                              : 'border-[var(--v2-border)] text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)]'
                          )}
                        >
                          {service.paymentType === 'installments'
                            ? `${service.installmentCount}×`
                            : (selectedLanguage === 'he' ? 'תשלום מלא' : selectedLanguage === 'es' ? 'Pago único' : 'Full')}
                        </button>

                        <button
                          onClick={() => removeServiceRow(index)}
                          disabled={servicesInput.length === 1}
                          className="col-span-1 flex items-center justify-center text-[var(--v2-text-muted)] hover:text-red-500 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>

                  {/* One question about the business, under the services it
                      applies to. A switch rather than a tick because it is a
                      setting being turned on, not an item being selected. */}
                  <div className="flex items-center justify-between gap-3 mt-4 pt-3 border-t border-[var(--v2-border)]">
                    <div className="min-w-0">
                      <span className="block text-sm text-[var(--v2-text-primary)]">
                        {selectedLanguage === 'he'
                          ? 'לקוחות ממלאים טופס לפני הפגישה?'
                          : selectedLanguage === 'es'
                            ? '¿Los clientes rellenan un formulario antes de la cita?'
                            : 'Do clients fill in a form before the appointment?'}
                      </span>
                      <span className="block text-[11px] text-[var(--v2-text-muted)] mt-0.5 leading-snug">
                        {selectedLanguage === 'he'
                          ? 'את השאלות עצמן תבחר אחר כך. אני רק צריך לדעת אם צריך.'
                          : selectedLanguage === 'es'
                            ? 'Las preguntas las eliges después. Solo necesito saber si hace falta.'
                            : 'You pick the questions later. I just need to know whether to set one up.'}
                      </span>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={needsIntake}
                      onClick={() => setNeedsIntake(v => !v)}
                      className={cn(
                        'relative w-11 h-6 rounded-full transition-colors flex-shrink-0',
                        needsIntake ? 'bg-[#8B5CF6]' : 'bg-[var(--v2-border)]'
                      )}
                    >
                      <span
                        className={cn(
                          'absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all',
                          needsIntake
                            ? (isRTL ? 'left-0.5' : 'right-0.5')
                            : (isRTL ? 'right-0.5' : 'left-0.5')
                        )}
                      />
                    </button>
                  </div>

                  {/* Actions */}
                  {/* justify-between already resolves against dir; reversing
                      on top of it put "add service" back on the wrong side. */}
                  <div className="flex items-center justify-between mt-4">
                    <button
                      onClick={addServiceRow}
                      className="flex items-center gap-1 text-sm text-[var(--v2-primary)] hover:text-[var(--v2-primary)]/80 transition-colors"
                    >
                      <Plus className="w-4 h-4" />
                      {selectedLanguage === 'he' ? 'הוסף שירות' : selectedLanguage === 'es' ? 'Agregar servicio' : 'Add Service'}
                    </button>
                    <button
                      onClick={submitServices}
                      disabled={!servicesInput.some(s => (s.name ?? '').trim())}
                      className="px-4 py-2 text-sm font-medium bg-[var(--v2-primary)] text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
                    >
                      {selectedLanguage === 'he' ? 'שלח' : selectedLanguage === 'es' ? 'Enviar' : 'Submit'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Input Area - hide when services form is shown */}
            {!showServicesForm && (
              /* `shrink-0` stated rather than relied on. A flex item will not
                 shrink below its own content anyway, so this held by accident;
                 the composer staying reachable on a short window is the reason
                 the thread no longer carries a 420px floor, and a behaviour
                 that load-bearing should not be implicit. */
              <div className="shrink-0 px-6 py-4 border-t border-[var(--v2-border)]">
                <div className={cn('flex gap-2', isRTL && 'flex-row-reverse')}>
                  <input
                    ref={inputRef}
                    type="text"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        sendMessage(inputValue);
                      }
                    }}
                    placeholder={
                      selectedLanguage === 'he' ? 'הקלד את התשובה שלך...'
                      : selectedLanguage === 'es' ? 'Escribe tu respuesta...'
                      : 'Type your answer...'
                    }
                    disabled={isSending || (showPreview && currentStep !== 'preview_adjustment' && currentStep !== 'preview')}
                    className={cn(
                      'flex-1 px-4 py-2.5 bg-[var(--v2-surface)] border border-[var(--v2-border)] text-sm text-[var(--v2-text-primary)] placeholder:text-[var(--v2-text-muted)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--v2-primary)] disabled:opacity-50',
                      isRTL && 'text-right'
                    )}
                  />

                  <button
                    onClick={() => sendMessage(inputValue)}
                    disabled={isSending || !inputValue.trim() || (showPreview && currentStep !== 'preview_adjustment' && currentStep !== 'preview')}
                    className="px-4 py-2 bg-[var(--v2-primary)] text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
                  >
                    {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

      {/*
          The setup panel was here, under the conversation, and was removed on
          2026-10-14 at the owner's request.

          It drew the same capability chain the dashboard shows, assembling as
          the interview went. The argument for it was that it measured the thing
          the interview is FOR rather than the interview itself. The argument
          against is that it competes: the screen is one question at a time, and
          a panel beneath it gives the eye somewhere else to be at the exact
          moment the question needs answering. The plan screen at the end is
          where the whole picture belongs, and it is now richer than this was.
      */}
        </div>

{/* Pipeline Editor Modal.
    At page level because its trigger is the "change" link on the plan
    screen, and the plan screen replaces the conversation — a modal
    living inside the hidden chat would have opened where nobody
    could see it. It is fixed-position anyway, so it belongs to
    neither. */}
{showPipelineEditor && (
  <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
    <div className="bg-[var(--v2-surface)] rounded-2xl shadow-2xl max-w-md w-full max-h-[80dvh] overflow-hidden" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-[var(--v2-border)]">
        <h3 className="text-lg font-semibold text-[var(--v2-text-primary)]">
          {selectedLanguage === 'he' ? 'עריכת שלבי צינור' : selectedLanguage === 'es' ? 'Editar etapas' : 'Edit Pipeline Stages'}
        </h3>
        <button
          onClick={() => setShowPipelineEditor(false)}
          className="p-1 text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Stages List */}
      <div className="p-4 space-y-2 overflow-y-auto max-h-[50dvh]">
        {editingPipelineStages.map((stage, index) => (
          <div
            key={stage.stage_key}
            className="flex items-center gap-2 p-3 bg-[var(--v2-bg)] rounded-lg border border-[var(--v2-border)]"
          >
            {/* Drag Handle / Position Controls */}
            <div className="flex flex-col gap-0.5">
              <button
                onClick={() => movePipelineStage(index, 'up')}
                disabled={index === 0}
                className="p-0.5 text-[var(--v2-text-muted)] hover:text-[var(--v2-primary)] disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                </svg>
              </button>
              <button
                onClick={() => movePipelineStage(index, 'down')}
                disabled={index === editingPipelineStages.length - 1}
                className="p-0.5 text-[var(--v2-text-muted)] hover:text-[var(--v2-primary)] disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>

            {/* Color Indicator */}
            <div
              className="w-3 h-8 rounded-full flex-shrink-0"
              style={{ backgroundColor: stage.color }}
            />

            {/* Stage Label Input.
                Renaming is theirs — a clinic says "Active Client", a school
                "Enrolled", a gym "Member". What cannot go is the stage itself:
                it is what the platform reads to answer whether a contact became
                a customer, so the name travels and the meaning stays. */}
            <input
              type="text"
              value={stage.stage_label}
              onChange={(e) => updatePipelineStageLabel(index, e.target.value)}
              className={cn(
                'flex-1 px-3 py-1.5 text-sm bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--v2-primary)] text-[var(--v2-text-primary)]',
                isRTL && 'text-right'
              )}
            />

            {/* Delete Button */}
            <button
              onClick={() => removePipelineStage(index)}
              disabled={editingPipelineStages.length <= 2 || stage.is_primary_client_stage}
              title={stage.is_primary_client_stage
                ? (selectedLanguage === 'he'
                    ? 'אי אפשר למחוק את שלב הלקוח.'
                    : selectedLanguage === 'es'
                      ? 'La etapa de cliente no se puede eliminar.'
                      : 'The client stage cannot be deleted.')
                : undefined}
              className="p-1.5 text-[var(--v2-text-muted)] hover:text-red-500 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {stage.is_primary_client_stage ? <Lock className="w-4 h-4" /> : <Trash2 className="w-4 h-4" />}
            </button>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-[var(--v2-border)] space-y-3">
        <button
          onClick={addPipelineStage}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-[var(--v2-primary)] bg-[var(--v2-primary)]/10 rounded-lg hover:bg-[var(--v2-primary)]/20 transition-colors"
        >
          <Plus className="w-4 h-4" />
          {selectedLanguage === 'he' ? 'הוסף שלב' : selectedLanguage === 'es' ? 'Agregar etapa' : 'Add Stage'}
        </button>
        <button
          onClick={savePipelineChanges}
          className="w-full px-4 py-2.5 bg-[var(--v2-primary)] text-white font-medium rounded-lg hover:opacity-90 transition-opacity"
        >
          {selectedLanguage === 'he' ? 'שמור שינויים' : selectedLanguage === 'es' ? 'Guardar cambios' : 'Save Changes'}
        </button>
      </div>
    </div>
  </div>
)}

        {/* Payment options for one service.
          The same three controls the service settings dialog offers — payment
          type, how many instalments, how often — using the same wording, so a
          plan built during onboarding and one built later are the same feature
          rather than two that resemble each other. */}
      {paymentDialogIndex !== null && servicesInput[paymentDialogIndex] && (() => {
        const index = paymentDialogIndex;
        const service = servicesInput[index];
        const price = parseFloat(service.price) || 0;
        const count = Math.max(2, parseInt(service.installmentCount, 10) || 2);

        return (
          <>
            <div className="fixed inset-0 bg-black/50 z-50" onClick={() => setPaymentDialogIndex(null)} />
            <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[min(420px,92vw)]">
              <div
                className="bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-2xl shadow-2xl p-5 space-y-4"
                dir={isRTL ? 'rtl' : 'ltr'}
              >
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-[var(--v2-text-muted)] uppercase tracking-wide flex items-center gap-2">
                    <CreditCard className="h-4 w-4" />
                    {t('scheduling.modal.payment_options')}
                  </h3>
                  <button onClick={() => setPaymentDialogIndex(null)} className="p-1 text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)]">
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <p className="text-sm text-[var(--v2-text-primary)] font-medium truncate">
                  {service.name || (selectedLanguage === 'he' ? 'שירות ללא שם' : selectedLanguage === 'es' ? 'Servicio sin nombre' : 'Unnamed service')}
                </p>

                {/* Literally the settings dialog's own payment section, not a
                    copy of it: same component, same controls, same wording. A
                    plan built here and one built later in the service settings
                    cannot drift apart, because there is only one of them. */}
                <ServicePaymentOptions
                  formData={{
                    price,
                    // `ServicePaymentOptions` requires a concrete currency; the row's is
                    // null until somebody chooses. Same display fallback used by the
                    // picker, and still not stored.
                    currency: service.currency ?? currencyForLanguage(selectedLanguage),
                    payment_type: service.paymentType,
                    installment_count: count,
                    installment_frequency: service.installmentFrequency,
                    first_payment_due: service.firstPaymentDue,
                    first_payment_days: parseInt(service.firstPaymentDays, 10) || 7,
                  }}
                  setFormData={updater => {
                    const next = updater({
                      price,
                      // `ServicePaymentOptions` requires a concrete currency; the row's is
                    // null until somebody chooses. Same display fallback used by the
                    // picker, and still not stored.
                    currency: service.currency ?? currencyForLanguage(selectedLanguage),
                      payment_type: service.paymentType,
                      installment_count: count,
                      installment_frequency: service.installmentFrequency,
                      first_payment_due: service.firstPaymentDue,
                      first_payment_days: parseInt(service.firstPaymentDays, 10) || 7,
                    });
                    updateServiceRow(index, 'paymentType', next.payment_type);
                    updateServiceRow(index, 'installmentCount', String(next.installment_count));
                    updateServiceRow(index, 'installmentFrequency', next.installment_frequency);
                    updateServiceRow(index, 'firstPaymentDue', next.first_payment_due);
                    updateServiceRow(index, 'firstPaymentDays', String(next.first_payment_days));
                  }}
                  getCurrencySymbol={getCurrencySymbol}
                  // No price typed means it is agreed with each client, not
                  // that the work is free — and a quoted project is exactly the
                  // kind that gets paid in instalments.
                  quoted={(service.price ?? '').trim() === ''}
                />

                <button
                  onClick={() => setPaymentDialogIndex(null)}
                  className="w-full px-4 py-2.5 bg-[var(--v2-primary)] text-white text-sm font-medium rounded-lg hover:opacity-90"
                >
                  {selectedLanguage === 'he' ? 'סיום' : selectedLanguage === 'es' ? 'Listo' : 'Done'}
                </button>
              </div>
            </div>
          </>
        );
      })()}

{/* Editing one fact from the plan.
    Each of these opens from the change link on the card it belongs to and
    changes only what that card states. They sit at page level for the same
    reason the two above do: the plan screen replaces the conversation, and
    a modal rendered inside it would open unseen. */}
{planEditor === 'services' && (
  <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
    {/* Wide enough to read a service name.
        Five columns of content in a 32rem dialog left the name field about
        160px, so anything longer than two words scrolled inside its own box —
        and the whole point of the editor is checking what it says. */}
    <div className="bg-[var(--v2-surface)] rounded-2xl shadow-2xl max-w-4xl w-full max-h-[80dvh] overflow-hidden flex flex-col" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="flex items-center justify-between p-4 border-b border-[var(--v2-border)]">
        <h3 className="text-lg font-semibold text-[var(--v2-text-primary)]">
          {selectedLanguage === 'he' ? 'מה שאתה מוכר' : selectedLanguage === 'es' ? 'Lo que vendes' : 'What you sell'}
        </h3>
        <button onClick={() => setPlanEditor(null)} className="p-1 text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)]">
          <X className="w-5 h-5" />
        </button>
      </div>

      {/*
          NAMES ONLY.
          ─────────────────────────────────────────────────────────────────────
          This was the services settings form: fifteen grid columns carrying a
          price, a currency, a duration, a scheduled toggle, a sale mode and a
          payment plan, so that "a price is typed the one way it is typed
          everywhere".

          It now contradicts the card that opens it. Onboarding creates
          PLACEHOLDERS and the card says so in as many words: "We will create
          these as drafts. You set prices and durations later." Offering a
          pricing grid behind that sentence asks the owner to do the work twice
          and to decide, at the least informed moment they will ever have, what
          each thing costs.

          So the only field here is the one the drafts actually carry and the
          only one the owner can judge right now: what the thing is called. The
          full form still exists, in the services editor, which is where the
          card points them next.
      */}
      <div className="p-4 overflow-y-auto space-y-2">
        <p className="text-[12px] text-[var(--v2-text-muted)] m-0 pb-1 leading-snug">
          {selectedLanguage === 'he'
            ? 'רק השמות בשלב הזה. מחירים, משך ואופן התשלום מוגדרים אחר כך במסך השירותים.'
            : selectedLanguage === 'es'
              ? 'Solo los nombres por ahora. Los precios, las duraciones y el cobro se definen después en la pantalla de servicios.'
              : 'Just the names for now. Prices, durations and how you take payment are set later, in the services screen.'}
        </p>

        {draftServices.map((service, index) => (
          <div key={index} className="flex items-center gap-2">
            <span
              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{ background: '#D14E97' }}
            />
            <input
              value={service.service_name}
              onChange={e => updateDraftService(index, 'service_name', e.target.value)}
              placeholder={
                selectedLanguage === 'he' ? 'שם השירות' : selectedLanguage === 'es' ? 'Nombre del servicio' : 'Service name'
              }
              className={cn(
                'flex-1 min-w-0 px-3 py-2 text-sm bg-[var(--v2-bg)] border border-[var(--v2-border)] rounded-lg text-[var(--v2-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--v2-primary)]',
                isRTL && 'text-right'
              )}
            />
            <button
              type="button"
              onClick={() => setDraftServices(rows => rows.filter((_, i) => i !== index))}
              className="p-1.5 text-[var(--v2-text-muted)] hover:text-[#EF4444] transition-colors flex-shrink-0"
              aria-label={selectedLanguage === 'he' ? 'הסר' : selectedLanguage === 'es' ? 'Quitar' : 'Remove'}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}

        <button
          type="button"
          onClick={() => setDraftServices(rows => [...rows, {
            service_name: '',
            duration_minutes: null,
            price: null,
            currency: currencyForLanguage(selectedLanguage),
            is_scheduled: configuration?.sells_scheduled !== false,
            collection: null,
            sale_mode: 'direct' as const,
            payment_plan: null,
          }])}
          className="flex items-center gap-1 text-sm text-[var(--v2-primary)] hover:opacity-80 transition-opacity pt-1"
        >
          <Plus className="w-4 h-4" />
          {selectedLanguage === 'he' ? 'הוסף שירות' : selectedLanguage === 'es' ? 'Agregar servicio' : 'Add service'}
        </button>
      </div>

      <div className="flex items-center justify-end gap-2 p-4 border-t border-[var(--v2-border)]">
        <button
          onClick={() => setPlanEditor(null)}
          className="px-4 py-2 text-sm text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] transition-colors"
        >
          {selectedLanguage === 'he' ? 'ביטול' : selectedLanguage === 'es' ? 'Cancelar' : 'Cancel'}
        </button>
        <button
          onClick={saveServicesEditor}
          className="px-4 py-2 text-sm font-medium bg-[var(--v2-primary)] text-white rounded-lg hover:opacity-90 transition-opacity"
        >
          {selectedLanguage === 'he' ? 'שמור שינויים' : selectedLanguage === 'es' ? 'Guardar cambios' : 'Save changes'}
        </button>
      </div>
    </div>
  </div>
)}

{/* Paying over time, for a service on the plan.
    Above the services editor rather than inside it, so the two do not fight
    over the same stacking context — and it is the very component the service
    settings use, so a plan agreed here is the plan the settings will show. */}
{/*
    The instalment-plan sub-dialog was here, and was removed on 2026-10-14.

    It let the owner turn one service into "three payments of 200" while still
    on the plan screen. Its only trigger was a button inside the services
    pricing grid, and that grid is now a list of names: onboarding creates
    placeholders, so a payment plan here would be attached to a service that
    has no price yet.

    `setDraftPaymentIndex` was left callable with `null` alone, which is to say
    the dialog could be closed and never opened. Instalments are set in the
    services editor, beside the price they divide.
*/}

{/*
    THE SAME THREE ANSWERS THE CHAT OFFERED, in the same words.

    Not a new vocabulary: the owner picked one of these a minute ago, and a
    dialog that renamed them would read as a different question about the same
    thing. The wording is the chip wording from `payment_collection_options`.

    On why a business-wide chooser is right on THIS screen when it would be
    wrong later, see `setCollectionMethod`.
*/}
{planEditor === 'collection' && (() => {
  const method = previewData?.configuration?.collection_method;

  const options: Array<{ key: string; title: string; body: string; selected: boolean; apply: () => void }> = [
    {
      key: 'card_online',
      title: selectedLanguage === 'he'
        ? 'הלקוח משלם אונליין בכרטיס'
        : selectedLanguage === 'es'
          ? 'El cliente paga online con tarjeta'
          : 'The client pays online by card',
      body: selectedLanguage === 'he'
        ? 'נחבר סליקה. סטרייפ תבקש תעודת זהות וחשבון בנק.'
        : selectedLanguage === 'es'
          ? 'Conectamos el cobro. Stripe pedirá tu identificación y una cuenta bancaria.'
          : 'We connect a processor. Stripe will ask for your ID and a bank account.',
      selected: method === 'card_online' || method === 'mixed',
      apply: () => setCollectionMethod('card_online'),
    },
    {
      key: 'invoice',
      title: selectedLanguage === 'he'
        ? 'אני גובה בעצמי: חשבונית, העברה או מזומן'
        : selectedLanguage === 'es'
          ? 'Yo cobro: factura, transferencia o efectivo'
          : 'I collect the money myself: invoice, transfer or cash',
      body: selectedLanguage === 'he'
        ? 'בלי סליקה. פרטי הבנק שלך מופיעים על החשבונית.'
        : selectedLanguage === 'es'
          ? 'Sin procesador. Tus datos bancarios van en la factura.'
          : 'No processor. Your bank details go on the invoice.',
      selected: method === 'invoice' || method === 'in_person',
      apply: () => setCollectionMethod('invoice'),
    },
    {
      key: 'none',
      title: selectedLanguage === 'he'
        ? 'מה שאני מוכר לא בתשלום'
        : selectedLanguage === 'es'
          ? 'Nada de lo que vendo se paga'
          : 'Nothing I sell is paid for',
      body: selectedLanguage === 'he'
        ? 'לא נגדיר גבייה בכלל.'
        : selectedLanguage === 'es'
          ? 'No configuramos ningún cobro.'
          : 'We set up no collection at all.',
      selected: method === 'none',
      apply: () => setCollectionMethod('none'),
    },
  ];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[var(--v2-surface)] rounded-2xl shadow-2xl max-w-md w-full overflow-hidden" dir={isRTL ? 'rtl' : 'ltr'}>
        <div className="flex items-center justify-between p-4 border-b border-[var(--v2-border)]">
          <h3 className="text-lg font-semibold text-[var(--v2-text-primary)]">
            {selectedLanguage === 'he' ? 'איך מקבלים תשלום' : selectedLanguage === 'es' ? 'Cómo cobras' : 'How you get paid'}
          </h3>
          <button onClick={() => setPlanEditor(null)} className="p-1 text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)]">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 flex flex-col gap-2">
          {options.map(option => (
            <button
              key={option.key}
              onClick={option.apply}
              className={cn(
                'w-full p-3 rounded-xl border transition-colors',
                isRTL ? 'text-right' : 'text-left',
                option.selected
                  ? 'border-[var(--v2-primary)] bg-[var(--v2-primary)]/10'
                  : 'border-[var(--v2-border)] hover:bg-[var(--v2-surface-hover)]'
              )}
            >
              <span className="flex items-center gap-2">
                <span className="text-sm font-semibold text-[var(--v2-text-primary)]">{option.title}</span>
                {option.selected && <Check className="w-4 h-4 text-[var(--v2-primary)] flex-shrink-0" />}
              </span>
              <span className="block text-[12px] text-[var(--v2-text-muted)] mt-1 leading-relaxed">
                {option.body}
              </span>
            </button>
          ))}

          {/*
              Said once, here, because this is the screen where an owner is
              most likely to want a mixed catalogue and cannot have one yet.
              Better than letting them hunt for it.
          */}
          <p className="text-[11px] text-[var(--v2-text-muted)] m-0 mt-1 leading-relaxed">
            {selectedLanguage === 'he'
              ? 'אפשר לשנות את זה לכל שירות בנפרד אחר כך, במסך השירותים.'
              : selectedLanguage === 'es'
                ? 'Puedes cambiarlo servicio por servicio después, en la pantalla de servicios.'
                : 'You can set this per service later, in the services screen.'}
          </p>
        </div>
      </div>
    </div>
  );
})()}

{/* Presence is the other business-wide question on this screen. */}
{planEditor === 'presence' && (() => {
  const options: Array<{ key: string; title: string; body: string; selected: boolean; apply: () => void }> = [
      {
        key: 'full_website',
        title: selectedLanguage === 'he' ? 'אתר מלא' : selectedLanguage === 'es' ? 'Un sitio completo' : 'A full website',
        body: selectedLanguage === 'he'
          ? 'אבנה אתר עם השירותים שלך ואשאיר אותו מוכן לפרסום, ומשם מזמינים.'
          : selectedLanguage === 'es'
            ? 'Construyo un sitio con tus servicios y lo dejo listo para publicar, y ahí reservan.'
            : "I build a site with your services and leave it ready for you to publish, and that is where clients book.",
        selected: configuration?.online_presence_mode === 'full_website' || configuration?.online_presence_mode === 'website_only',
        apply: () => setPresenceMode('full_website'),
      },
      {
        key: 'booking_only',
        title: selectedLanguage === 'he' ? 'לינק להזמנות בלבד' : selectedLanguage === 'es' ? 'Solo un enlace de reserva' : 'A booking link only',
        body: selectedLanguage === 'he'
          ? 'לינק שאפשר לשלוח בוואטסאפ או להוסיף לאתר שכבר יש לך.'
          : selectedLanguage === 'es'
            ? 'Un enlace para WhatsApp o para el sitio que ya tienes.'
            : 'A link to paste into WhatsApp, or into the site you already have.',
        selected: configuration?.online_presence_mode === 'booking_only' || configuration?.online_presence_mode === 'none',
        apply: () => setPresenceMode('booking_only'),
      },
  ];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[var(--v2-surface)] rounded-2xl shadow-2xl max-w-md w-full overflow-hidden" dir={isRTL ? 'rtl' : 'ltr'}>
        <div className="flex items-center justify-between p-4 border-b border-[var(--v2-border)]">
          <h3 className="text-lg font-semibold text-[var(--v2-text-primary)]">
            {selectedLanguage === 'he' ? 'איך לקוחות מגיעים אליך' : selectedLanguage === 'es' ? 'Cómo te encuentran' : 'How clients reach you'}
          </h3>
          <button onClick={() => setPlanEditor(null)} className="p-1 text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)]">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 flex flex-col gap-2">
          {options.map(option => (
            <button
              key={option.key}
              onClick={option.apply}
              className={cn(
                'w-full p-3 rounded-xl border transition-colors',
                isRTL ? 'text-right' : 'text-left',
                option.selected
                  ? 'border-[var(--v2-primary)] bg-[var(--v2-primary)]/10'
                  : 'border-[var(--v2-border)] hover:bg-[var(--v2-surface-hover)]'
              )}
            >
              <span className="flex items-center gap-2">
                <span className="text-sm font-semibold text-[var(--v2-text-primary)]">{option.title}</span>
                {option.selected && <Check className="w-4 h-4 text-[var(--v2-primary)] flex-shrink-0" />}
              </span>
              <span className="block text-xs text-[var(--v2-text-secondary)] mt-1 leading-relaxed">{option.body}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
})()}

      </div>
      {/* closes the scroller opened beside "Main Content" */}
      </div>
    </div>
  );
}

/**
 * Can this service's fee be split into instalments?
 *
 * Only where there IS a fee. Two ways there is not: the work is quoted, so the
 * figure is named per client in the proposal; or nobody has typed one yet.
 * Instalments of an unknown amount are not a plan — the dialog behind this
 * button cannot even show what each payment would be.
 *
 * Shared by both service grids because they ask the same question, and the
 * services settings apply the same rule: their payment section renders nothing
 * unless the service is quoted or priced above zero.
 */
function canSplit(
  saleMode: 'direct' | 'proposal' | undefined,
  price: string | number | null | undefined
): boolean {
  if (saleMode === 'proposal') return false;
  const amount = typeof price === 'string' ? parseFloat(price) : price;
  return typeof amount === 'number' && Number.isFinite(amount) && amount > 0;
}
