'use client';

import { useState } from 'react';
import { EmailSequenceList } from '@/components/email-automation/EmailSequenceList';
import { EmailSendStats } from '@/components/email-automation/EmailSendStats';
import { PAGE_CONTAINER } from '@/lib/business-os/pageContainer';

export default function EmailAutomationPage() {
  const [activeTab, setActiveTab] = useState<'sequences' | 'stats'>('sequences');

  /*
   * NO SECOND SCROLLER, AND NO SECOND VIEWPORT.
   *
   * This was a `100dvh` flex column with its own `overflow-auto` body — a full
   * window's height starting BELOW the header and tabs, so the page ran past
   * the bottom of the screen and scrolled in two places at once.
   *
   * The layout owns the scrolling now: the chrome sits outside it and the body
   * scrolls under the tabs. This page just fills what it is given.
   */
  return (
    <div className="min-h-full bg-[var(--v2-bg)]">

      <div>
        <div className={`${PAGE_CONTAINER} py-8`}>
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-[var(--v2-text-primary)]">📧 Automated emails</h1>
            <p className="text-[var(--v2-text-secondary)] mt-2">Automated email sequences and campaigns</p>
          </div>

          {/* Tabs */}
          <div className="bg-[var(--v2-surface)] border border-[var(--v2-border)] overflow-hidden" style={{ borderRadius: 'var(--v2-radius-card)' }}>
            <div className="border-b border-[var(--v2-border)]">
              <nav className="flex space-x-8 px-6" aria-label="Tabs">
                <button
                  onClick={() => setActiveTab('sequences')}
                  className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                    activeTab === 'sequences'
                      ? 'border-[var(--v2-primary)] text-[var(--v2-primary)]'
                      : 'border-transparent text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)]'
                  }`}
                >
                  Sequences
                </button>
                <button
                  onClick={() => setActiveTab('stats')}
                  className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                    activeTab === 'stats'
                      ? 'border-[var(--v2-primary)] text-[var(--v2-primary)]'
                      : 'border-transparent text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)]'
                  }`}
                >
                  Statistics
                </button>
              </nav>
            </div>

            <div className="p-6">
              {activeTab === 'sequences' && <EmailSequenceList />}
              {activeTab === 'stats' && <EmailSendStats />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
