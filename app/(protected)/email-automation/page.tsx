'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { EmailSequenceList } from '@/components/email-automation/EmailSequenceList';
import { EmailSendStats } from '@/components/email-automation/EmailSendStats';

export default function EmailAutomationPage() {
  const [activeTab, setActiveTab] = useState<'sequences' | 'stats'>('sequences');

  return (
    <div className="min-h-screen bg-slate-50 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-900">Email Automation</h1>
          <p className="text-slate-600 mt-2">Automated email sequences and campaigns</p>
        </div>

        {/* Tabs */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
          <div className="border-b border-slate-200">
            <nav className="flex space-x-8 px-6" aria-label="Tabs">
              <button
                onClick={() => setActiveTab('sequences')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'sequences'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                }`}
              >
                Sequences
              </button>
              <button
                onClick={() => setActiveTab('stats')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'stats'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
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
  );
}
