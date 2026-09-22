'use client';

/**
 * Booking Modal
 *
 * A modal wrapper for ProcessFlowSection that enables booking flow
 * from the website builder preview. Uses real API calls (useLiveData=true)
 * to create actual bookings and save intake responses.
 *
 * The modal has a sticky header with step indicator that stays fixed
 * while the content scrolls below it.
 */

import { useEffect, useCallback, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Calendar, Clock, User, CreditCard, FileText, Check, ArrowLeft, ArrowRight, Loader2 } from 'lucide-react';
import { ProcessFlowSection, type ProcessFlowFooterActions } from './ProcessFlowSection';
import type { PageTheme, FlowStep, SelectedServiceData } from './types';
import { journeySteps } from '@/lib/business-os/clientJourney';
import { flowHasScheduling, flowHasClientInfo } from './types';
import type { Locale } from '@/lib/i18n/config';

/*
 * A THIRD copy of this union, and the reason the compiler caught this at all.
 *
 * `clientJourney.ts` documents the same hazard — it was three unions once
 * before, and adding a step to one left the others silently behind. Adding
 * `request` to ProcessFlowSection's two and not this one made passing a step
 * handler between them a type error, which is the union earning its keep.
 */
type CurrentStep = 'services' | 'datetime' | 'details' | 'request' | 'payment' | 'intake' | 'confirmation';

interface BookingModalProps {
  isOpen: boolean;
  onClose: () => void;
  theme?: PageTheme;
  locale: Locale;
  isRTL: boolean;
  clientFlow?: FlowStep[];
  /** Page ID for authenticated API calls in preview mode */
  pageId?: string;
  /** Website subdomain - required for intake and booking API calls */
  subdomain?: string;
  /**
   * A smart link's business identifier, where there is no subdomain.
   *
   * Without it this modal could not run on `/c/{userCode}/book` at all, which
   * is why that surface had a second booking implementation of its own.
   */
  userCode?: string;
  /**
   * Where on the page the button that opened this sits, in document pixels.
   *
   * The dialog centres itself with `position: fixed`, which anchors to the
   * VIEWPORT — correct on a published page, wrong in the editor's preview,
   * where the page renders inside an iframe sized to its own full height. The
   * iframe's viewport is then the WHOLE document, so "centred" meant the middle
   * of a page thousands of pixels tall and a button clicked halfway down opened
   * a dialog nowhere near it.
   *
   * Given a value, the dialog positions itself against the document at that
   * point instead. Null keeps the old centring, which is what every published
   * page still wants.
   */
  anchorTop?: number | null;
  /** Pre-selected service - skips service selection step */
  initialService?: SelectedServiceData | null;
  /**
   * Whether this business can actually take a card right now.
   *
   * Undefined means the caller does not know, and is read as ready — removing a
   * payment step a business can honour is worse than leaving one it cannot,
   * since this component only renders in the owner's own preview.
   */
  paymentsEnabled?: boolean;
}

// Step Indicator Component (moved from ProcessFlowSection for sticky header)
interface StepIndicatorProps {
  steps: CurrentStep[];
  currentStep: CurrentStep;
  completedSteps: CurrentStep[];
  primaryColor: string;
  isRTL: boolean;
}

function StepIndicator({ steps, currentStep, completedSteps, primaryColor, isRTL }: StepIndicatorProps) {
  const stepIcons: Record<CurrentStep, React.ReactNode> = {
    services: <Calendar className="w-4 h-4" />,
    datetime: <Clock className="w-4 h-4" />,
    details: <User className="w-4 h-4" />,
    request: <FileText className="w-4 h-4" />,
    payment: <CreditCard className="w-4 h-4" />,
    intake: <FileText className="w-4 h-4" />,
    confirmation: <Check className="w-4 h-4" />
  };

  const currentIndex = steps.indexOf(currentStep);

  return (
    <div className="flex items-center justify-center gap-2" dir={isRTL ? 'rtl' : 'ltr'}>
      {steps.map((step, index) => {
        const isActive = step === currentStep;
        const isCompleted = completedSteps.includes(step);
        const isPast = index < currentIndex;

        return (
          <div key={step} className="flex items-center">
            {index > 0 && (
              <div
                className={`w-8 h-0.5 mx-1 transition-colors ${
                  isPast || isCompleted ? '' : 'ap-card-2'
                }`}
                style={isPast || isCompleted ? { backgroundColor: primaryColor } : {}}
              />
            )}
            <div
              className={`flex items-center justify-center w-8 h-8 rounded-full transition-all ${
                isActive
                  ? 'text-white shadow-lg'
                  : isCompleted || isPast
                  ? 'text-white'
                  : 'ap-card-2 ap-ink-3'
              }`}
              style={
                isActive || isCompleted || isPast
                  ? { backgroundColor: primaryColor, opacity: isActive ? 1 : 0.7 }
                  : {}
              }
            >
              {isCompleted ? <Check className="w-4 h-4" /> : stepIcons[step]}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** `journeySteps` names its steps differently from this modal's flow keys. */
const STEP_TO_FLOW: Record<string, FlowStep | undefined> = {
  // Choosing what to buy is the modal's own 'services' screen, not a flow step.
  service: undefined,
  datetime: 'scheduling',
  details: 'client_info',
  // Where a quoted service ends: the client has asked, and the owner replies
  // with a proposal. Not a form — the details step just before it collected
  // everything — but the screen that says so.
  request: 'request',
  payment: 'payment',
  intake: 'intake',
  confirmation: 'confirmation',
};

export function BookingModal({
  isOpen,
  onClose,
  theme,
  locale,
  isRTL,
  clientFlow,
  pageId,
  subdomain,
  userCode,
  initialService,
  paymentsEnabled,
  anchorTop = null
}: BookingModalProps) {
  /*
   * The dialog, so it can put itself in front of whoever opened it.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * WHY POSITION ALONE IS NOT ENOUGH
   *
   * `position: fixed` is supposed to anchor to the viewport, and in the editor's
   * preview it does not — for two compounding reasons, both introduced by the
   * template work:
   *
   *   1. The public surface declares `container-type: inline-size` so the
   *      breakpoints can measure the page. That implies `contain: layout`, and
   *      layout containment makes the element a CONTAINING BLOCK for fixed and
   *      absolutely positioned descendants. The dialog stopped tracking the
   *      viewport and started tracking `<main>`.
   *   2. The preview renders inside an iframe sized to the page's full height,
   *      so even a true viewport anchor would centre on a document thousands of
   *      pixels tall.
   *
   * Either one alone puts the dialog far from the button. Rather than chase the
   * geometry through two layers of containment, it is placed at the trigger and
   * then scrolled into view — which is the thing actually being asked for, and
   * is true whatever the containing block turns out to be.
   */
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Published pages pass no anchor: their dialog centres in a real viewport
    // and must not be scrolled to.
    if (!isOpen || anchorTop === null) return;

    /*
     * Centred after paint AND again whenever the dialog changes height.
     *
     * One `requestAnimationFrame` was not enough: the services list arrives
     * from the network, so the first frame centres a nearly empty panel and the
     * dialog then grows downward — past the bottom of what the reader can see,
     * with its own footer and half the list beyond reach. The scroll position
     * was correct for a dialog that no longer existed.
     *
     * A ResizeObserver catches every growth, including the step changes that
     * resize it later. It only acts when the dialog is ACTUALLY out of view,
     * because a dialog that already fits should not lurch about while somebody
     * is reading it.
     */
    const bringIntoView = () => {
      const el = dialogRef.current;
      if (!el) return;

      const box = el.getBoundingClientRect();
      const viewport = window.innerHeight || document.documentElement.clientHeight;
      const fullyVisible = box.top >= 0 && box.bottom <= viewport;
      if (fullyVisible) return;

      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    };

    const frame = requestAnimationFrame(bringIntoView);

    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(bringIntoView) : null;
    if (observer && dialogRef.current) observer.observe(dialogRef.current);

    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [isOpen, anchorTop]);

  /*
   * The journey belongs to the SERVICE the client just picked.
   *
   * This used to take a page-level `clientFlow` and, failing that, a hardcoded
   * ['scheduling','client_info','payment','confirmation'] — one journey for a
   * whole website, which is wrong for any business selling more than one kind
   * of thing. A product with no date was asked to choose an appointment; an
   * invoiced programme was asked for a card. The service CARD beside this modal
   * was already printing the correct journey from the same two facts, so the
   * client could read one thing and then be walked through another.
   *
   * `journeySteps` is the resolver every other surface already uses — the
   * services list, the "how it works" section, and the standalone booking page
   * a smart link opens. Using it here makes four surfaces agree instead of
   * three agreeing and one improvising.
   *
   * The stored flow remains the fallback for a page whose blocks predate these
   * facts, and for the catalogue step where no service has been chosen yet.
   */
  // Defaults to true: a caller that cannot answer should not silently remove a
  // step the business may well be able to honour.
  const processorReady = paymentsEnabled !== false;

  const serviceHasJourneyFacts =
    initialService?.is_scheduled !== undefined ||
    initialService?.collection !== undefined ||
    initialService?.sale_mode !== undefined;

  const effectiveFlow: FlowStep[] = serviceHasJourneyFacts
    ? (journeySteps(
        {
          is_scheduled: initialService?.is_scheduled,
          collection: initialService?.collection,
          price: initialService?.price,
          sale_mode: initialService?.sale_mode,
        },
        // Whether a card can actually be charged. This was hardcoded `true`,
        // which left the payment screen to refuse — showing the visitor an error
        // about the business's payment setup. That is the owner's concern, never
        // the client's, so the step is dropped instead and the booking completes
        // unpaid. Defaults to ready when the caller does not know, so a preview
        // still renders the full journey.
        { processorReady }
      )
        .map(step => STEP_TO_FLOW[step])
        .filter((step): step is FlowStep => Boolean(step)))
    : (clientFlow || ['scheduling', 'client_info', 'payment', 'confirmation']);

  // Use helper functions to handle both legacy 'booking' and new 'scheduling'/'client_info' steps
  const hasScheduling = flowHasScheduling(effectiveFlow);
  const hasClientInfo = flowHasClientInfo(effectiveFlow);
  const hasPayment = effectiveFlow.includes('payment');
  const hasIntake = effectiveFlow.includes('intake');

  // Determine initial step based on flow configuration
  const getInitialStep = (): CurrentStep => {
    if (!initialService) return 'services';
    if (hasScheduling) return 'datetime';
    if (hasClientInfo) return 'details';
    return 'services';
  };

  /**
   * The step's controls, drawn by the modal rather than by the step.
   *
   * Frozen at the bottom edge the way the step indicator is frozen at the top:
   * a sibling of the scrolling region, not a child of it. Inside the flow they
   * could not be — they sit under a slider that clips with `overflow-hidden`
   * and keeps a transform on the moving panel, either of which defeats
   * `position: sticky`.
   */
  const [footerActions, setFooterActions] = useState<ProcessFlowFooterActions | null>(null);

  // Track current step and completed steps for the sticky header
  const [currentStep, setCurrentStep] = useState<CurrentStep>(getInitialStep());
  const [completedSteps, setCompletedSteps] = useState<CurrentStep[]>(initialService ? ['services'] : []);
  const contentRef = useRef<HTMLDivElement>(null);

  const primaryColor = theme?.colors?.primary || '#4F6EF7';

  // Build step sequence dynamically based on capabilities
  // - 'services' is always first (unless pre-selected)
  // - 'datetime' is included only if scheduling is needed
  // - 'details' (client info) is included if client_info is in flow OR scheduling is in flow
  const stepSequence: CurrentStep[] = ['services'];
  if (hasScheduling) stepSequence.push('datetime');
  if (hasClientInfo) stepSequence.push('details');
  if (hasPayment) stepSequence.push('payment');
  if (hasIntake) stepSequence.push('intake');
  stepSequence.push('confirmation');

  // Handle escape key
  const handleEscape = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  }, [onClose]);

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * THE SCROLL LOCK IS ONLY RIGHT FOR THE CENTRED DIALOG.
   *
   * Locking the page is correct when the dialog is `fixed`: it fills the
   * viewport, so there is nothing behind worth scrolling and letting the page
   * move under it feels broken.
   *
   * In the ANCHORED case it is the opposite. That dialog is `absolute`,
   * positioned in the DOCUMENT beside whatever was clicked, because the preview
   * renders in an auto-height iframe where `fixed` has no viewport to attach
   * to. A 700px panel placed part way down a long page extends below what the
   * reader can see — and locking the scroll takes away the only means of
   * reaching the rest of it. The dialog opens, the services list is cut off
   * mid-row, and nothing moves.
   *
   * So the lock follows the positioning: fixed dialog, locked page; anchored
   * dialog, page still scrolls.
   */
  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      if (anchorTop === null) {
        document.body.style.overflow = 'hidden';
      }
    }
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
    };
  }, [isOpen, handleEscape, anchorTop]);

  // Reset state when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setCurrentStep(getInitialStep());
      setCompletedSteps(initialService ? ['services'] : []);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialService, hasScheduling, hasClientInfo]);

  // Callback to sync step state from ProcessFlowSection
  const handleStepChange = useCallback((step: CurrentStep, completed: CurrentStep[]) => {
    setCurrentStep(step);
    setCompletedSteps(completed);
  }, []);

  // Show step indicator only on middle steps (not services or confirmation)
  const showStepIndicator = currentStep !== 'services' && currentStep !== 'confirmation';

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50"
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            /*
              Anchored to the button, or centred in the viewport.
              See `anchorTop` on the props for why a preview needs the first.
            */
            className={
              anchorTop === null
                /*
                  ─────────────────────────────────────────────────────────────
                  PADDING, NOT INSETS — THE PANEL MUST FIT ITS CONTAINER.

                  This was `inset-4 md:inset-8 lg:inset-16`, which reserves up
                  to 128px of height, while the panel below asked for a
                  `minHeight` of `calc(100dvh - 2rem)` — only 32px less than the
                  whole screen. The panel was therefore ~96px TALLER than the
                  box holding it, and being centred it overflowed equally top
                  and bottom: the footer sat below the viewport with the page
                  behind it scroll-locked, so a client could not reach Continue
                  and could not scroll to it either.

                  `inset-0` with padding puts the reserve INSIDE the box, so
                  `max-h-full` on the panel is a promise the container can keep.
                */
                ? 'fixed inset-0 z-50 flex items-center justify-center p-4 md:p-8'
                : 'absolute z-50 flex justify-center px-4'
            }
            style={
              anchorTop === null
                ? undefined
                : {
                    // Slightly above the control, so the dialog opens over what
                    // was clicked rather than pushing it out of sight — and
                    // never above the top of the page.
                    top: Math.max(16, anchorTop - 80),
                    insetInlineStart: 0,
                    insetInlineEnd: 0,
                  }
            }
          >
            <div
              // One direction for the whole dialog rather than per fragment.
              // The indicator and the footer each set their own, so anything
              // between them — the close button's side, logical padding, the
              // scroll area — was left to inherit from whatever wrapped the
              // modal, which on a preview page is not the site's language.
              ref={dialogRef}
              dir={isRTL ? 'rtl' : 'ltr'}
              className="relative w-full max-w-2xl flex flex-col rounded-2xl shadow-2xl overflow-hidden"
              style={{
                backgroundColor: theme?.colors?.background || '#ffffff',
                color: theme?.colors?.text || '#1a1a1a',
                /*
                  `vh` is meaningless in the anchored case: the preview's iframe
                  viewport is the whole page, so `80vh` would be 80% of a
                  document thousands of pixels tall. A pixel cap instead, which
                  is what `maxHeight` was already doing for the centred case.
                */
                /*
                  ───────────────────────────────────────────────────────────
                  THREE HEIGHTS, AND TWO OF THEM COULD EXCEED THE SCREEN.

                  `80vh` is not 80% of what a phone shows. Mobile browsers
                  report `vh` against the viewport WITHOUT the address bar, so
                  a `vh`-sized panel is taller than the visible area until the
                  chrome scrolls away — which it cannot here, because the page
                  behind a modal does not scroll.

                  `minHeight: 500px` was the worse one: a floor, obeyed even
                  when the screen is shorter than it. A phone in landscape is
                  often under 400px tall, and the panel is centred, so it
                  overflowed equally top and bottom with the step indicator and
                  the Continue button both off-screen and unreachable. A client
                  could not finish a booking.

                  Both are now bounded by the viewport itself. The floor still
                  applies whenever there is room for it — this dialog looks
                  wrong at 300px on a desktop — it simply stops winning against
                  a screen that is smaller.
                */
                /*
                  Bounded by the CONTAINER, not by the viewport.

                  `100%` here is the padded box above, which already accounts
                  for the margin the dialog wants from the screen edge. Sizing
                  against `dvh` instead is what let the panel outgrow its own
                  container — two rules measuring different things and no way
                  for them to agree.

                  The 500px floor is kept for roomy screens and yields to
                  `100%` on short ones, so it can never push the footer out of
                  reach.
                */
                height: anchorTop === null ? '80dvh' : 'auto',
                maxHeight: anchorTop === null ? 'min(700px, 100%)' : '700px',
                minHeight: 'min(500px, 100%)'
              }}
            >
              {/* Sticky Header with Step Indicator */}
              <div
                /*
                  `min-h` so the bottom border clears the close button.
                  
                  The button is positioned absolutely — `top-3` plus `p-2`
                  around a 20px icon, so it reaches about 48px down. The header
                  itself is only its padding when the step indicator is hidden,
                  which is every step that does not show one: roughly 28px, so
                  the border ran straight through the X. Reserving the button's
                  own height fixes it without moving the button, which has to
                  stay in the corner.
                */
                className="flex-shrink-0 px-6 pt-4 pb-3 border-b min-h-[3.25rem]"
                style={{
                  backgroundColor: theme?.colors?.background || '#ffffff',
                  borderColor: theme?.colors?.textSecondary ? `${theme.colors.textSecondary}20` : '#e5e7eb'
                }}
              >
                {/* Close button */}
                <button
                  onClick={onClose}
                  className="absolute top-3 p-2 rounded-full hover:bg-black/5 transition-colors z-10"
                  style={{ [isRTL ? 'left' : 'right']: '0.75rem' }}
                  aria-label="Close"
                >
                  <X className="w-5 h-5" style={{ color: theme?.colors?.textSecondary || '#666' }} />
                </button>

                {/* Step Indicator */}
                {showStepIndicator && (
                  <div className="pt-1">
                    <StepIndicator
                      steps={stepSequence}
                      currentStep={currentStep}
                      completedSteps={completedSteps}
                      primaryColor={primaryColor}
                      isRTL={isRTL}
                    />
                  </div>
                )}
              </div>

              {/* Scrollable Content */}
              <div ref={contentRef} className="flex-1 overflow-auto px-8 py-6 md:px-12 md:py-8">
                <ProcessFlowSection
                  content={{
                    flow: effectiveFlow,
                    initialService: initialService || undefined
                  }}
                  theme={theme}
                  locale={locale}
                  isRTL={isRTL}
                  useLiveData={true}
                  pageId={pageId}
                  subdomain={subdomain}
            userCode={userCode}
                  isPreview={true}
                  onStepChange={handleStepChange}
                  onFooterActionsChange={setFooterActions}
                />
              </div>

              {/* Frozen footer — outside the scrolling region, like the header. */}
              {footerActions && (
                <div
                  className="flex-shrink-0 border-t ap-line px-8 py-4 md:px-12"
                  style={{ backgroundColor: theme?.colors?.background || '#ffffff' }}
                  dir={isRTL ? 'rtl' : 'ltr'}
                >
                  <div className="flex items-center gap-3">
                    {footerActions.onBack && (
                      <button
                        type="button"
                        onClick={footerActions.onBack}
                        className="flex items-center gap-2 px-4 py-3 ap-ink-2 ap-hover-ink text-sm font-medium"
                      >
                        {isRTL ? <ArrowRight className="w-4 h-4" /> : <ArrowLeft className="w-4 h-4" />}
                        {footerActions.backLabel}
                      </button>
                    )}
                    {footerActions.primary && (
                      <button
                        type="button"
                        onClick={footerActions.primary.onClick}
                        disabled={footerActions.primary.disabled}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-3 text-white font-medium rounded-lg transition-all hover:opacity-90 disabled:opacity-50"
                        style={{ backgroundColor: primaryColor, borderRadius: theme?.borderRadius || '0.5rem' }}
                      >
                        {footerActions.primary.busy ? (
                          <>
                            <Loader2 className="w-5 h-5 animate-spin" />
                            {footerActions.busyLabel}
                          </>
                        ) : (
                          <>
                            {footerActions.primary.label}
                            {isRTL ? <ArrowLeft className="w-5 h-5" /> : <ArrowRight className="w-5 h-5" />}
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
