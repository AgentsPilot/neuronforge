// components/v2/wizard/CalibrationStoryView.tsx
// Story-driven calibration progress view for non-technical users
// Shows agent "learning" and "healing" with friendly language

'use client';

import { useState, useEffect } from 'react';
import { CheckCircle, Loader2, AlertCircle, Wrench, Sparkles } from 'lucide-react';

interface CalibrationStep {
  step_id: string;
  friendly_name: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  auto_repaired: boolean;
  friendly_summary: string;
  friendly_error?: string;
  repair_tooltip?: string;
  item_count?: number;
}

interface CalibrationStoryViewProps {
  steps: CalibrationStep[];
  isRunning: boolean;
  currentStepIndex: number;
  agentName: string;
}

export function CalibrationStoryView({
  steps,
  isRunning,
  currentStepIndex,
  agentName,
}: CalibrationStoryViewProps) {
  const [showHealingAnimation, setShowHealingAnimation] = useState(false);
  const [healingMessage, setHealingMessage] = useState('');

  // Detect auto-repair events
  useEffect(() => {
    const currentStep = steps[currentStepIndex];
    if (currentStep?.auto_repaired && currentStep.status === 'running') {
      setShowHealingAnimation(true);
      setHealingMessage(currentStep.repair_tooltip || 'Your agent is learning how to fix this...');

      // Hide after 3 seconds
      setTimeout(() => setShowHealingAnimation(false), 3000);
    }
  }, [currentStepIndex, steps]);

  const completedCount = steps.filter(s => s.status === 'completed').length;
  const failedCount = steps.filter(s => s.status === 'failed').length;
  const repairedCount = steps.filter(s => s.auto_repaired).length;

  const getStoryMessage = (): { title: string; message: string; icon: React.ReactNode } => {
    if (!isRunning && completedCount === steps.length && failedCount === 0) {
      return {
        title: '🎉 Amazing! Your Agent is Ready',
        message: `${agentName} successfully completed all ${steps.length} steps. It's ready to go live!`,
        icon: <Sparkles className="w-8 h-8" style={{ color: 'var(--v2-status-success-text)' }} />,
      };
    }

    if (!isRunning && failedCount > 0 && repairedCount === 0) {
      return {
        title: '🤔 Your Agent Needs Help',
        message: `We ran into ${failedCount} issue${failedCount !== 1 ? 's' : ''}. Let's fix them together.`,
        icon: <AlertCircle className="w-8 h-8" style={{ color: 'var(--v2-status-warning-text)' }} />,
      };
    }

    if (isRunning && currentStepIndex < steps.length) {
      const currentStep = steps[currentStepIndex];
      if (currentStep?.auto_repaired) {
        return {
          title: '🔧 Learning & Adapting',
          message: `${agentName} is figuring out how to handle this...`,
          icon: <Wrench className="w-8 h-8 animate-spin" style={{ color: 'var(--v2-primary)' }} />,
        };
      }
      return {
        title: '🧪 Testing Your Agent',
        message: `${agentName} is working through step ${currentStepIndex + 1} of ${steps.length}...`,
        icon: <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--v2-primary)' }} />,
      };
    }

    if (!isRunning && repairedCount > 0) {
      return {
        title: '✨ Your Agent Learned Something New',
        message: `${agentName} automatically fixed ${repairedCount} issue${repairedCount !== 1 ? 's' : ''} while testing.`,
        icon: <Sparkles className="w-8 h-8" style={{ color: 'var(--v2-secondary)' }} />,
      };
    }

    return {
      title: '👋 Ready to Test',
      message: `Click "Start Testing" to see ${agentName} in action.`,
      icon: <Sparkles className="w-8 h-8" style={{ color: 'var(--v2-primary)' }} />,
    };
  };

  const story = getStoryMessage();

  return (
    <div className="space-y-3">
      {/* Main Status Message */}
      {!isRunning && steps.length > 0 && (
        <div
          className="p-4 border"
          style={{
            borderRadius: 'var(--v2-radius-button)',
            backgroundColor: completedCount === steps.length && failedCount === 0
              ? 'var(--v2-status-success-bg)'
              : failedCount > 0
              ? 'var(--v2-status-warning-bg)'
              : 'var(--v2-status-executing-bg)',
            borderColor: completedCount === steps.length && failedCount === 0
              ? 'var(--v2-status-success-border)'
              : failedCount > 0
              ? 'var(--v2-status-warning-border)'
              : 'var(--v2-status-executing-border)',
          }}
        >
          <div className="flex items-center gap-3">
            <div className="flex-shrink-0">
              {story.icon}
            </div>
            <p
              className="text-sm font-medium"
              style={{
                color: completedCount === steps.length && failedCount === 0
                  ? 'var(--v2-status-success-text)'
                  : failedCount > 0
                  ? 'var(--v2-status-warning-text)'
                  : 'var(--v2-status-executing-text)',
              }}
            >
              {story.message}
            </p>
          </div>
        </div>
      )}

      {/* Healing Animation Overlay */}
      {showHealingAnimation && (
        <div
          className="border-2 p-3 animate-pulse"
          style={{
            borderRadius: 'var(--v2-radius-button)',
            backgroundColor: 'var(--v2-status-warning-bg)',
            borderColor: 'var(--v2-status-warning-border)',
          }}
        >
          <div className="flex items-center gap-3">
            <Wrench className="w-5 h-5 text-purple-600 dark:text-purple-400 animate-bounce" />
            <p className="text-sm font-medium" style={{ color: 'var(--v2-status-warning-text)' }}>
              {healingMessage}
            </p>
          </div>
        </div>
      )}

      {/* Step Timeline */}
      <div className="space-y-2">
        {steps.map((step, index) => (
          <StoryStepCard
            key={step.step_id}
            step={step}
            index={index}
            isActive={index === currentStepIndex && isRunning}
          />
        ))}
      </div>
    </div>
  );
}

// Individual step card with story-driven UI
function StoryStepCard({
  step,
  index,
  isActive,
}: {
  step: CalibrationStep;
  index: number;
  isActive: boolean;
}) {
  const getStepIcon = () => {
    if (step.status === 'completed') {
      return <CheckCircle className="w-4 h-4" style={{ color: 'var(--v2-status-success-text)' }} />;
    }
    if (step.status === 'failed') {
      return <AlertCircle className="w-4 h-4" style={{ color: 'var(--v2-status-error-text)' }} />;
    }
    if (step.status === 'running' || isActive) {
      return <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--v2-primary)' }} />;
    }
    return <div className="w-4 h-4 rounded-full border-2" style={{ borderColor: 'var(--v2-border)' }} />;
  };

  return (
    <div className="flex items-start gap-2 py-2">
      <div className="flex-shrink-0 mt-0.5">
        {getStepIcon()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium truncate" style={{ color: 'var(--v2-text-primary)' }}>
            {step.friendly_name}
          </p>
          {step.auto_repaired && (
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium flex-shrink-0"
              style={{
                borderRadius: 'var(--v2-radius-button)',
                backgroundColor: 'var(--v2-status-warning-bg)',
                color: 'var(--v2-status-warning-text)',
              }}
            >
              <Wrench className="w-3 h-3" />
              Fixed
            </span>
          )}
          {step.item_count !== undefined && step.item_count > 0 && step.status === 'completed' && (
            <span className="text-xs flex-shrink-0" style={{ color: 'var(--v2-text-muted)' }}>
              {step.item_count} item{step.item_count !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        {step.status === 'completed' && step.friendly_summary && (
          <p className="text-xs mt-0.5" style={{ color: 'var(--v2-text-secondary)' }}>
            {step.friendly_summary}
          </p>
        )}
        {step.status === 'failed' && step.friendly_error && (
          <p className="text-xs mt-0.5" style={{ color: 'var(--v2-status-error-text)' }}>
            {step.friendly_error}
          </p>
        )}
        {(step.status === 'running' || isActive) && (
          <p className="text-xs mt-0.5" style={{ color: 'var(--v2-primary)' }}>
            Working on it...
          </p>
        )}
      </div>
    </div>
  );
}
