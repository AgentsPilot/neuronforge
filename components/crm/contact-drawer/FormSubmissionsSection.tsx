'use client';

/**
 * FormSubmissionsSection
 *
 * Displays website contact form submissions from the contact's custom_fields
 * and activities logged with source_capability='website'.
 */

import { useState } from 'react';
import {
  Globe, MessageSquare, Briefcase, Users, MapPin, Clock,
  ChevronDown, ChevronUp, ExternalLink
} from 'lucide-react';
import { CollapsibleSection } from '../CollapsibleSection';
import type { CRMContact, CRMActivity } from './types';

interface FormSubmissionsProps {
  contact: CRMContact;
  activities: CRMActivity[];
  t: (key: string) => string;
  isRTL: boolean;
  language: string;
  isOpen?: boolean;
  onToggle?: (isOpen: boolean) => void;
}

interface FormSubmission {
  id: string;
  message: string;
  serviceInterest?: string;
  referralSource?: string;
  pageUrl?: string;
  timestamp: string;
  isInitial: boolean;
}

export function FormSubmissionsSection({
  contact,
  activities,
  t,
  isRTL,
  language,
  isOpen,
  onToggle
}: FormSubmissionsProps) {
  const [expandedSubmissions, setExpandedSubmissions] = useState<Set<string>>(new Set());

  // Extract form submissions from contact custom_fields and activities
  const getFormSubmissions = (): FormSubmission[] => {
    const submissions: FormSubmission[] = [];
    const customFields = contact.custom_fields as Record<string, unknown> || {};

    // Initial submission from custom_fields
    if (customFields.first_website_message) {
      submissions.push({
        id: 'initial',
        message: customFields.first_website_message as string,
        serviceInterest: customFields.service_interest as string | undefined,
        referralSource: customFields.referral_source as string | undefined,
        pageUrl: customFields.page_url as string | undefined,
        timestamp: contact.created_at,
        isInitial: true
      });
    }

    // Additional submissions from activities
    const websiteActivities = activities.filter(a =>
      (a as { source_capability?: string }).source_capability === 'website' ||
      a.title?.toLowerCase().includes('website') ||
      a.title?.toLowerCase().includes('contact form')
    );

    websiteActivities.forEach(activity => {
      // Skip if this matches the initial submission
      if (submissions.length > 0 && activity.description === customFields.first_website_message) {
        return;
      }

      submissions.push({
        id: activity.id,
        message: activity.description || '',
        timestamp: activity.activity_date || activity.created_at,
        isInitial: false
      });
    });

    // Sort by timestamp, newest first
    return submissions.sort((a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  };

  const submissions = getFormSubmissions();

  // Don't render if no submissions
  if (submissions.length === 0) {
    return null;
  }

  const toggleSubmission = (id: string) => {
    setExpandedSubmissions(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString(language, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatRelativeTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return t('common.today') || 'Today';
    if (diffDays === 1) return t('common.yesterday') || 'Yesterday';
    if (diffDays < 7) return `${diffDays} ${t('common.days_ago') || 'days ago'}`;
    return formatDate(dateString);
  };

  return (
    <CollapsibleSection
      title={t('crm.forms.website_submissions') || 'Website Forms'}
      icon={<Globe className="h-4 w-4 text-[var(--v2-text-muted)]" />}
      defaultOpen={false}
      isOpen={isOpen}
      onToggle={onToggle}
      isRTL={isRTL}
      badge={
        submissions.length > 0 && (
          <span className="text-xs text-[var(--v2-text-muted)]">
            {submissions.length} {submissions.length === 1
              ? (t('crm.forms.submission') || 'submission')
              : (t('crm.forms.submissions') || 'submissions')}
          </span>
        )
      }
    >
      <div className="space-y-3" dir={isRTL ? 'rtl' : 'ltr'}>
        {submissions.map((submission) => {
          const isExpanded = expandedSubmissions.has(submission.id);
          const hasDetails = submission.serviceInterest || submission.referralSource || submission.pageUrl;

          return (
            <div
              key={submission.id}
              className={`border rounded-lg overflow-hidden transition-all ${
                submission.isInitial
                  ? 'border-purple-500/50 bg-purple-500/5'
                  : 'border-[var(--v2-border)] bg-[var(--v2-surface)]'
              }`}
            >
              {/* Header */}
              <button
                type="button"
                onClick={() => hasDetails && toggleSubmission(submission.id)}
                className={`w-full flex items-start gap-3 p-3 text-start ${
                  hasDetails ? 'cursor-pointer hover:bg-[var(--v2-surface)]/80' : ''
                } transition-colors`}
                disabled={!hasDetails}
              >
                <MessageSquare className={`h-4 w-4 mt-0.5 flex-shrink-0 ${
                  submission.isInitial ? 'text-purple-500' : 'text-[var(--v2-text-muted)]'
                }`} />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    {submission.isInitial && (
                      <span className="text-xs font-medium text-purple-500 bg-purple-500/10 px-2 py-0.5 rounded-full">
                        {t('crm.forms.first_contact') || 'First Contact'}
                      </span>
                    )}
                    <span className="text-xs text-[var(--v2-text-muted)] flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatRelativeTime(submission.timestamp)}
                    </span>
                  </div>

                  <p className="text-sm text-[var(--v2-text-primary)] line-clamp-2">
                    {submission.message || (t('common.no_message') || 'No message')}
                  </p>
                </div>

                {hasDetails && (
                  isExpanded
                    ? <ChevronUp className="h-4 w-4 text-[var(--v2-text-muted)] flex-shrink-0" />
                    : <ChevronDown className="h-4 w-4 text-[var(--v2-text-muted)] flex-shrink-0" />
                )}
              </button>

              {/* Expanded Details */}
              {isExpanded && hasDetails && (
                <div className="px-3 pb-3 pt-0 border-t border-[var(--v2-border)]">
                  <div className="grid gap-2 mt-2">
                    {submission.serviceInterest && (
                      <div className="flex items-center gap-2 text-sm">
                        <Briefcase className="h-3.5 w-3.5 text-[var(--v2-text-muted)]" />
                        <span className="text-[var(--v2-text-muted)]">
                          {t('crm.forms.service_interest') || 'Service Interest'}:
                        </span>
                        <span className="text-[var(--v2-text-primary)]">
                          {submission.serviceInterest}
                        </span>
                      </div>
                    )}

                    {submission.referralSource && (
                      <div className="flex items-center gap-2 text-sm">
                        <Users className="h-3.5 w-3.5 text-[var(--v2-text-muted)]" />
                        <span className="text-[var(--v2-text-muted)]">
                          {t('crm.forms.referral_source') || 'Referred by'}:
                        </span>
                        <span className="text-[var(--v2-text-primary)]">
                          {submission.referralSource}
                        </span>
                      </div>
                    )}

                    {submission.pageUrl && (
                      <div className="flex items-center gap-2 text-sm">
                        <MapPin className="h-3.5 w-3.5 text-[var(--v2-text-muted)]" />
                        <span className="text-[var(--v2-text-muted)]">
                          {t('crm.forms.submitted_from') || 'Submitted from'}:
                        </span>
                        <a
                          href={submission.pageUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[#8B5CF6] hover:underline flex items-center gap-1 truncate"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {new URL(submission.pageUrl).pathname || '/'}
                          <ExternalLink className="h-3 w-3 flex-shrink-0" />
                        </a>
                      </div>
                    )}

                    {/* Full timestamp */}
                    <div className="text-xs text-[var(--v2-text-muted)] mt-1">
                      {formatDate(submission.timestamp)}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </CollapsibleSection>
  );
}
