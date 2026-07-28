'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { createLogger } from '@/lib/logger';
import { SequenceBuilder } from './SequenceBuilder';

const logger = createLogger({ module: 'EmailSequenceList' });

interface EmailSequence {
  id: string;
  name: string;
  description: string | null;
  trigger_type: 'manual' | 'contact_created' | 'booking_confirmed' | 'payment_received' | 'tag_added';
  is_active: boolean;
  total_sent: number;
  total_opened: number;
  total_clicked: number;
  created_at: string;
}

export function EmailSequenceList() {
  const [sequences, setSequences] = useState<EmailSequence[]>([]);
  const [loading, setLoading] = useState(true);
  const [showBuilder, setShowBuilder] = useState(false);
  const [selectedSequence, setSelectedSequence] = useState<EmailSequence | null>(null);

  useEffect(() => {
    fetchSequences();
  }, []);

  const fetchSequences = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/email/sequences');
      const result = await response.json();

      if (result.success) {
        setSequences(result.data || []);
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to fetch sequences');
    } finally {
      setLoading(false);
    }
  };

  const toggleActive = async (sequenceId: string, currentStatus: boolean) => {
    try {
      const response = await fetch(`/api/email/sequences/${sequenceId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !currentStatus }),
      });

      const result = await response.json();

      if (result.success) {
        fetchSequences();
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to toggle sequence');
    }
  };

  const getTriggerLabel = (trigger: EmailSequence['trigger_type']) => {
    const labels = {
      manual: 'Manual',
      contact_created: 'New Contact',
      booking_confirmed: 'Booking Confirmed',
      payment_received: 'Payment Received',
      tag_added: 'Tag Added',
    };
    return labels[trigger];
  };

  const getOpenRate = (sequence: EmailSequence) => {
    if (sequence.total_sent === 0) return 0;
    return Math.round((sequence.total_opened / sequence.total_sent) * 100);
  };

  const getClickRate = (sequence: EmailSequence) => {
    if (sequence.total_sent === 0) return 0;
    return Math.round((sequence.total_clicked / sequence.total_sent) * 100);
  };

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="border border-slate-200 rounded-lg p-4 animate-pulse">
            <div className="h-6 bg-slate-200 rounded w-1/3 mb-2"></div>
            <div className="h-4 bg-slate-200 rounded w-1/2"></div>
          </div>
        ))}
      </div>
    );
  }

  if (showBuilder) {
    return (
      <SequenceBuilder
        sequence={selectedSequence}
        onClose={() => {
          setShowBuilder(false);
          setSelectedSequence(null);
          fetchSequences();
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">Email Sequences</h2>
        <Button onClick={() => setShowBuilder(true)}>
          + Create Sequence
        </Button>
      </div>

      {/* Sequences List */}
      {sequences.length === 0 ? (
        <div className="text-center py-12">
          <svg className="mx-auto h-12 w-12 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          <h3 className="mt-2 text-sm font-medium text-slate-900">No sequences</h3>
          <p className="mt-1 text-sm text-slate-500">
            Create your first automated email sequence.
          </p>
          <div className="mt-6">
            <Button onClick={() => setShowBuilder(true)}>
              + Create Sequence
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {sequences.map((sequence) => (
            <div
              key={sequence.id}
              className="border border-slate-200 rounded-lg p-4 hover:border-blue-300 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <h3 className="text-lg font-semibold text-slate-900">
                      {sequence.name}
                    </h3>
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                      sequence.is_active
                        ? 'bg-green-100 text-green-800 border-green-200'
                        : 'bg-gray-100 text-gray-800 border-gray-200'
                    }`}>
                      {sequence.is_active ? 'Active' : 'Inactive'}
                    </span>
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 border border-blue-200">
                      {getTriggerLabel(sequence.trigger_type)}
                    </span>
                  </div>
                  {sequence.description && (
                    <p className="text-sm text-slate-600 mt-1">{sequence.description}</p>
                  )}
                  <div className="flex items-center gap-6 mt-3 text-sm">
                    <div>
                      <span className="text-slate-500">Sent:</span>
                      <span className="ml-2 font-semibold text-slate-900">{sequence.total_sent}</span>
                    </div>
                    <div>
                      <span className="text-slate-500">Open Rate:</span>
                      <span className="ml-2 font-semibold text-slate-900">{getOpenRate(sequence)}%</span>
                    </div>
                    <div>
                      <span className="text-slate-500">Click Rate:</span>
                      <span className="ml-2 font-semibold text-slate-900">{getClickRate(sequence)}%</span>
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSelectedSequence(sequence);
                      setShowBuilder(true);
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    variant={sequence.is_active ? 'outline' : 'default'}
                    size="sm"
                    onClick={() => toggleActive(sequence.id, sequence.is_active)}
                  >
                    {sequence.is_active ? 'Deactivate' : 'Activate'}
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
