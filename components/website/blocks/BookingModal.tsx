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

type CurrentStep = 'services' | 'datetime' | 'details' | 'payment' | 'intake' | 'confirmation';

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
                  isPast || isCompleted ? '' : 'bg-gray-200 dark:bg-gray-700'
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
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500'
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
  paymentsEnabled
}: BookingModalProps) {
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
    initialService?.is_scheduled !== undefined || initialService?.collection !== undefined;

  const effectiveFlow: FlowStep[] = serviceHasJourneyFacts
    ? (journeySteps(
        {
          is_scheduled: initialService?.is_scheduled,
          collection: initialService?.collection,
          price: initialService?.price,
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

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
    };
  }, [isOpen, handleEscape]);

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
            className="fixed inset-4 md:inset-8 lg:inset-16 z-50 flex items-center justify-center"
          >
            <div
              // One direction for the whole dialog rather than per fragment.
              // The indicator and the footer each set their own, so anything
              // between them — the close button's side, logical padding, the
              // scroll area — was left to inherit from whatever wrapped the
              // modal, which on a preview page is not the site's language.
              dir={isRTL ? 'rtl' : 'ltr'}
              className="relative w-full max-w-2xl flex flex-col rounded-2xl shadow-2xl overflow-hidden"
              style={{
                backgroundColor: theme?.colors?.background || '#ffffff',
                color: theme?.colors?.text || '#1a1a1a',
                height: '80vh',
                maxHeight: '700px',
                minHeight: '500px'
              }}
            >
              {/* Sticky Header with Step Indicator */}
              <div
                className="flex-shrink-0 px-6 pt-4 pb-3 border-b"
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
                  className="flex-shrink-0 border-t border-gray-100 dark:border-slate-700 px-8 py-4 md:px-12"
                  style={{ backgroundColor: theme?.colors?.background || '#ffffff' }}
                  dir={isRTL ? 'rtl' : 'ltr'}
                >
                  <div className="flex items-center gap-3">
                    {footerActions.onBack && (
                      <button
                        type="button"
                        onClick={footerActions.onBack}
                        className="flex items-center gap-2 px-4 py-3 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white text-sm font-medium"
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
