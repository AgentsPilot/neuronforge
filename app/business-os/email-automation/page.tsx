'use client';

import { useState } from 'react';
import { BusinessOSHeader } from '@/components/business-os/BusinessOSHeader';
import { EmailSequenceList } from '@/components/email-automation/EmailSequenceList';
import { EmailSendStats } from '@/components/email-automation/EmailSendStats';

export default function EmailAutomationPage() {
  const [activeTab, setActiveTab] = useState<'sequences' | 'stats'>('sequences');

  return (
    <div className="flex flex-col h-screen bg-[var(--v2-bg)]">
      <BusinessOSHeader />

      <div className="flex-1 overflow-auto">
        <div className="max-w-7xl mx-auto p-8">
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
