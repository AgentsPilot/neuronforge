'use client';

import { useState, useEffect } from 'react';
import Joyride, { Step, CallBackProps, STATUS, ACTIONS } from 'react-joyride';
import { CheckCircle2, Calendar, Rocket } from 'lucide-react';

interface DraftAgentTourProps {
  agentId: string;
  agentName: string;
  agentStatus: string;
  productionReady: boolean;
}

export function DraftAgentTour({ agentId, agentName, agentStatus, productionReady }: DraftAgentTourProps) {
  const [runTour, setRunTour] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Track mount to force initial check
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return; // Wait for client-side mount

    // Show tour if:
    // 1. Agent is in draft status AND production_ready is true (completed calibration but not activated yet)
    // OR
    // 2. User just came back from successful calibration (justCalibrated flag)
    // AND user hasn't manually dismissed it

    const isDraftAndProductionReady = agentStatus === 'draft' && productionReady;

    // Check if user just completed calibration (for immediate post-calibration flow)
    const justCalibrated = typeof window !== 'undefined'
      ? localStorage.getItem(`calibration-completed-${agentId}`) === 'true'
      : false;

    const dismissed = typeof window !== 'undefined'
      ? localStorage.getItem(`tour-dismissed-${agentId}`) === 'true'
      : false;

    console.log('[DraftAgentTour] Tour check:', {
      agentId,
      agentStatus,
      productionReady,
      isDraftAndProductionReady,
      justCalibrated,
      dismissed,
      shouldShow: (isDraftAndProductionReady || justCalibrated) && !dismissed
    });

    if ((isDraftAndProductionReady || justCalibrated) && !dismissed) {
      console.log('[DraftAgentTour] Starting tour with 500ms delay');
      // Small delay to let page render
      setTimeout(() => {
        console.log('[DraftAgentTour] Setting runTour=true');
        setRunTour(true);

        // Clear the calibration flag AFTER setting runTour=true
        if (justCalibrated && typeof window !== 'undefined') {
          console.log('[DraftAgentTour] Clearing calibration-completed flag');
          localStorage.removeItem(`calibration-completed-${agentId}`);
        }
      }, 500);
    }
  }, [agentId, agentStatus, productionReady, mounted]);

  const handleTourCallback = (data: CallBackProps) => {
    const { status, action } = data;

    // Handle tour completion or manual skip
    if (status === STATUS.FINISHED || status === STATUS.SKIPPED) {
      setRunTour(false);
      // Only store dismissal if user manually closed/skipped
      if (action === ACTIONS.CLOSE || action === ACTIONS.SKIP) {
        if (typeof window !== 'undefined') {
          localStorage.setItem(`tour-dismissed-${agentId}`, 'true');
        }
      }
    }
  };

  const steps: Step[] = [
    {
      target: 'body',
      content: (
        <div className="p-6">
          <div className="flex items-start gap-4 mb-5">
            <div className="flex-shrink-0 w-12 h-12 bg-emerald-100 dark:bg-emerald-900/30 rounded-full flex items-center justify-center">
              <CheckCircle2 className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="flex-1">
              <h2 className="text-xl font-semibold text-gray-800 dark:text-slate-100 mb-1.5">
                Calibration Complete - Agent Ready!
              </h2>
              <p className="text-sm text-gray-500 dark:text-slate-400 leading-relaxed">
                <span className="font-medium text-gray-800 dark:text-slate-200">{agentName}</span> has been tested, validated, and approved for production
              </p>
            </div>
          </div>
          <div className="bg-gray-50 dark:bg-slate-800/50 border border-gray-100 dark:border-slate-700 rounded-lg p-4 space-y-2">
            <p className="text-sm text-gray-600 dark:text-slate-300 leading-relaxed">
              Your agent went through comprehensive calibration:
            </p>
            <ul className="text-xs text-gray-500 dark:text-slate-400 space-y-1 pl-4">
              <li>✓ Ran multiple test cases to detect issues</li>
              <li>✓ Fixed hardcoded values with dynamic parameters</li>
              <li>✓ Tested with real data and verified results</li>
              <li>✓ Approved and ready for activation</li>
            </ul>
          </div>
        </div>
      ),
      placement: 'center',
      disableBeacon: true,
    },
    {
      target: '[data-tour="status-badge"]',
      content: (
        <div className="p-5">
          <h3 className="text-lg font-semibold text-gray-800 dark:text-slate-100 mb-3">
            Agent Status
          </h3>
          <p className="text-sm text-gray-500 dark:text-slate-400 mb-4 leading-relaxed">
            This badge shows your agent's current lifecycle state. Your agent is in Draft mode - meaning it has passed all calibration tests and is production-ready, awaiting your activation.
          </p>
          <div className="space-y-2.5">
            <div className="flex items-center gap-3 p-2.5 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-100 dark:border-amber-800">
              <div className="w-1.5 h-1.5 bg-amber-500 rounded-full flex-shrink-0"></div>
              <div className="flex-1">
                <p className="font-semibold text-amber-900 dark:text-amber-200 text-sm">Draft</p>
                <p className="text-amber-700 dark:text-amber-400 text-xs">Calibrated & tested, ready to activate</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-2.5 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg border border-emerald-100 dark:border-emerald-800">
              <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full flex-shrink-0"></div>
              <div className="flex-1">
                <p className="font-semibold text-emerald-900 dark:text-emerald-200 text-sm">Active</p>
                <p className="text-emerald-700 dark:text-emerald-400 text-xs">Running live in production</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-2.5 bg-gray-50 dark:bg-slate-800 rounded-lg border border-gray-100 dark:border-slate-700">
              <div className="w-1.5 h-1.5 bg-gray-400 dark:bg-slate-500 rounded-full flex-shrink-0"></div>
              <div className="flex-1">
                <p className="font-semibold text-gray-900 dark:text-slate-200 text-sm">Inactive</p>
                <p className="text-gray-600 dark:text-slate-400 text-xs">Paused temporarily</p>
              </div>
            </div>
          </div>
        </div>
      ),
      placement: 'bottom',
    },
    {
      target: '[data-tour="edit-button"]',
      content: (
        <div className="p-5">
          <h3 className="text-lg font-semibold text-gray-800 dark:text-slate-100 mb-2.5">
            Next Steps: Configure & Activate
          </h3>
          <p className="text-sm text-gray-500 dark:text-slate-400 mb-4 leading-relaxed">
            Click the <strong className="text-gray-800 dark:text-slate-200">Settings</strong> button to configure when your agent should run and activate it for production.
          </p>
          <div className="space-y-3">
            <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 rounded-lg p-3.5">
              <div className="flex items-center gap-2 mb-1">
                <Calendar className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <p className="text-sm font-semibold text-blue-900 dark:text-blue-200">
                  Schedule Configuration
                </p>
              </div>
              <p className="text-xs text-blue-700 dark:text-blue-300 leading-relaxed">
                Choose between scheduled runs (hourly, daily, weekly, monthly) or on-demand execution
              </p>
            </div>
            <div className="bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-700 rounded-lg p-3.5">
              <div className="flex items-center gap-2 mb-1">
                <Rocket className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">
                  Activation
                </p>
              </div>
              <p className="text-xs text-emerald-700 dark:text-emerald-300 leading-relaxed">
                Toggle the status from Draft to Active to deploy your agent to production
              </p>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-gray-200 dark:border-slate-700">
            <p className="text-sm text-emerald-900 dark:text-emerald-200 font-medium">
              You're all set! Your agent passed comprehensive calibration and is ready for deployment.
            </p>
          </div>
        </div>
      ),
      placement: 'bottom',
    },
  ];

  if (!runTour) return null;

  return (
    <>
      <Joyride
        steps={steps}
        run={runTour}
        continuous
        showProgress
        showSkipButton
        callback={handleTourCallback}
        styles={{
        options: {
          overlayColor: 'rgba(0, 0, 0, 0.5)',
          zIndex: 10000,
        },
        tooltip: {
          borderRadius: '16px',
          maxWidth: '480px',
          width: '480px',
        },
        tooltipContainer: {
          textAlign: 'left',
        },
        tooltipContent: {
          padding: 0,
        },
        tooltipFooter: {
          marginTop: 0,
          padding: '16px 24px',
        },
        spotlight: {
          borderRadius: '12px',
          border: '2px solid #6366F1',
        },
      }}
      locale={{
        back: 'Back',
        close: 'Close',
        last: 'Got it!',
        next: 'Next',
        skip: 'Skip Tour',
      }}
      floaterProps={{
        styles: {
          arrow: {
            length: 8,
            spread: 12,
          },
        },
      }}
    />
    </>
  );
}
