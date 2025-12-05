'use client';

import { useState, useEffect } from 'react';
import Joyride, { Step, CallBackProps, STATUS, ACTIONS } from 'react-joyride';
import { CheckCircle2 } from 'lucide-react';

interface DraftAgentTourProps {
  agentId: string;
  agentName: string;
  agentStatus: string;
}

export function DraftAgentTour({ agentId, agentName, agentStatus }: DraftAgentTourProps) {
  const [runTour, setRunTour] = useState(false);

  useEffect(() => {
    // Show tour if:
    // 1. Agent is in draft status
    // 2. User hasn't manually dismissed it
    const isDraft = agentStatus === 'draft';
    const dismissed = typeof window !== 'undefined'
      ? localStorage.getItem(`tour-dismissed-${agentId}`) === 'true'
      : false;

    if (isDraft && !dismissed) {
      // Small delay to let page render
      setTimeout(() => setRunTour(true), 500);
    }
  }, [agentId, agentStatus]);

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
                Agent Created Successfully!
              </h2>
              <p className="text-sm text-gray-500 dark:text-slate-400 leading-relaxed">
                <span className="font-medium text-gray-800 dark:text-slate-200">{agentName}</span> is now in{' '}
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">Draft</span> mode
              </p>
            </div>
          </div>
          <div className="bg-gray-50 dark:bg-slate-800/50 border border-gray-100 dark:border-slate-700 rounded-lg p-4">
            <p className="text-sm text-gray-600 dark:text-slate-300 leading-relaxed">
              Your agent is safe to test and won't run automatically. Let's quickly show you the 3 key actions available.
            </p>
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
            This badge shows your agent's current lifecycle state:
          </p>
          <div className="space-y-2.5">
            <div className="flex items-center gap-3 p-2.5 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-100 dark:border-amber-800">
              <div className="w-1.5 h-1.5 bg-amber-500 rounded-full flex-shrink-0"></div>
              <div className="flex-1">
                <p className="font-semibold text-amber-900 dark:text-amber-200 text-sm">Draft</p>
                <p className="text-amber-700 dark:text-amber-400 text-xs">Safe to test and modify</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-2.5 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg border border-emerald-100 dark:border-emerald-800">
              <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full flex-shrink-0"></div>
              <div className="flex-1">
                <p className="font-semibold text-emerald-900 dark:text-emerald-200 text-sm">Active</p>
                <p className="text-emerald-700 dark:text-emerald-400 text-xs">Running live</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-2.5 bg-gray-50 dark:bg-slate-800 rounded-lg border border-gray-100 dark:border-slate-700">
              <div className="w-1.5 h-1.5 bg-gray-400 dark:bg-slate-500 rounded-full flex-shrink-0"></div>
              <div className="flex-1">
                <p className="font-semibold text-gray-900 dark:text-slate-200 text-sm">Inactive</p>
                <p className="text-gray-600 dark:text-slate-400 text-xs">Paused</p>
              </div>
            </div>
          </div>
        </div>
      ),
      placement: 'bottom',
    },
    {
      target: '[data-tour="test-button"]',
      content: (
        <div className="p-5">
          <h3 className="text-lg font-semibold text-gray-800 dark:text-slate-100 mb-2.5">
            Test Your Agent
          </h3>
          <p className="text-sm text-gray-500 dark:text-slate-400 mb-4 leading-relaxed">
            Click here to run your agent in a safe sandbox environment before going live.
          </p>
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3.5">
            <p className="text-sm text-amber-900 dark:text-amber-200 font-medium">
              We highly recommend testing before activating to ensure everything works as expected.
            </p>
          </div>
        </div>
      ),
      placement: 'bottom',
    },
    {
      target: '[data-tour="activate-button"]',
      content: (
        <div className="p-5">
          <h3 className="text-lg font-semibold text-gray-800 dark:text-slate-100 mb-2.5">
            Launch Your Agent
          </h3>
          <p className="text-sm text-gray-500 dark:text-slate-400 mb-3 leading-relaxed">
            When you're ready, click here to activate your agent and make it live.
          </p>
          <p className="text-sm text-gray-500 dark:text-slate-400 mb-4 leading-relaxed">
            Once activated, your agent will run according to its configured schedule or trigger settings.
          </p>
          <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg p-3.5">
            <p className="text-sm text-emerald-900 dark:text-emerald-200 font-medium">
              Pro tip: Always test first, then activate for the best results!
            </p>
          </div>
        </div>
      ),
      placement: 'bottom',
    },
  ];

  if (!runTour) return null;

  return (
    <Joyride
      steps={steps}
      run={runTour}
      continuous
      showProgress
      showSkipButton
      callback={handleTourCallback}
      styles={{
        options: {
          overlayColor: 'rgba(0, 0, 0, 0.4)',
          zIndex: 10000,
        },
        tooltipContainer: {
          textAlign: 'left',
        },
        tooltipContent: {
          padding: 0,
        },
        tooltipFooter: {
          marginTop: 0,
          padding: '12px 20px',
        },
        buttonClose: {
          display: 'none',
        },
        spotlight: {
          borderRadius: '8px',
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
  );
}
