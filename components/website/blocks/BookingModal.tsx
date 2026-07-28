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
import { X, Calendar, Clock, User, CreditCard, FileText, Check } from 'lucide-react';
import { ProcessFlowSection } from './ProcessFlowSection';
import type { PageTheme, FlowStep, SelectedServiceData } from './types';
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
  /** Pre-selected service - skips service selection step */
  initialService?: SelectedServiceData | null;
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

export function BookingModal({
  isOpen,
  onClose,
  theme,
  locale,
  isRTL,
  clientFlow,
  pageId,
  subdomain,
  initialService
}: BookingModalProps) {
  // Default flow includes payment - this is the default booking journey
  const effectiveFlow = clientFlow || ['booking', 'payment', 'confirmation'];
  // Track current step and completed steps for the sticky header
  const [currentStep, setCurrentStep] = useState<CurrentStep>(initialService ? 'datetime' : 'services');
  const [completedSteps, setCompletedSteps] = useState<CurrentStep[]>(initialService ? ['services'] : []);
  const contentRef = useRef<HTMLDivElement>(null);

  const primaryColor = theme?.colors?.primary || '#4F6EF7';

  // Build step sequence based on flow
  const hasPayment = effectiveFlow.includes('payment');
  const hasIntake = effectiveFlow.includes('intake');
  const stepSequence: CurrentStep[] = ['services', 'datetime', 'details'];
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
      setCurrentStep(initialService ? 'datetime' : 'services');
      setCompletedSteps(initialService ? ['services'] : []);
    }
  }, [isOpen, initialService]);

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
                  isPreview={false}
                  onStepChange={handleStepChange}
                />
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
