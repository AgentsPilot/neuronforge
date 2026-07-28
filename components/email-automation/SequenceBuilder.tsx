'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createLogger } from '@/lib/logger';
import { StepEditor } from './StepEditor';

const logger = createLogger({ module: 'SequenceBuilder' });

interface EmailSequence {
  id: string;
  name: string;
  description: string | null;
  trigger_type: 'manual' | 'contact_created' | 'booking_confirmed' | 'payment_received' | 'tag_added';
  is_active: boolean;
}

interface EmailSequenceStep {
  id: string;
  step_number: number;
  delay_minutes: number;
  subject: string;
  body_html: string;
}

interface Props {
  sequence: EmailSequence | null;
  onClose: () => void;
}

export function SequenceBuilder({ sequence, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    trigger_type: 'manual' as const,
  });
  const [steps, setSteps] = useState<EmailSequenceStep[]>([]);
  const [sequenceId, setSequenceId] = useState<string | null>(sequence?.id || null);
  const [editingStep, setEditingStep] = useState<number | null>(null);

  useEffect(() => {
    if (sequence) {
      setFormData({
        name: sequence.name,
        description: sequence.description || '',
        trigger_type: sequence.trigger_type,
      });
      fetchSteps(sequence.id);
    }
  }, [sequence]);

  const fetchSteps = async (seqId: string) => {
    try {
      const response = await fetch(`/api/email/sequences/${seqId}/steps`);
      const result = await response.json();

      if (result.success) {
        setSteps(result.data || []);
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to fetch steps');
    }
  };

  const handleSaveSequence = async () => {
    if (!formData.name) {
      alert('Please enter a sequence name');
      return;
    }

    setLoading(true);

    try {
      const url = sequenceId
        ? `/api/email/sequences/${sequenceId}`
        : '/api/email/sequences';
      const method = sequenceId ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      const result = await response.json();

      if (result.success) {
        if (!sequenceId) {
          setSequenceId(result.data.id);
        }
        alert('Sequence saved successfully');
      } else {
        logger.error({ error: result.error }, 'Failed to save sequence');
        alert('Failed to save sequence. Please try again.');
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to save sequence');
      alert('Failed to save sequence. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleAddStep = () => {
    if (!sequenceId) {
      alert('Please save the sequence first before adding steps');
      return;
    }
    setEditingStep(steps.length);
  };

  const handleStepSaved = () => {
    setEditingStep(null);
    if (sequenceId) {
      fetchSteps(sequenceId);
    }
  };

  const handleDeleteStep = async (stepId: string) => {
    if (!confirm('Are you sure you want to delete this step?')) return;

    try {
      const response = await fetch(`/api/email/sequences/${sequenceId}/steps/${stepId}`, {
        method: 'DELETE',
      });

      const result = await response.json();

      if (result.success) {
        if (sequenceId) {
          fetchSteps(sequenceId);
        }
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to delete step');
    }
  };

  const formatDelay = (minutes: number) => {
    if (minutes === 0) return 'Immediately';
    if (minutes < 60) return `${minutes} minutes`;
    if (minutes < 1440) return `${Math.floor(minutes / 60)} hours`;
    return `${Math.floor(minutes / 1440)} days`;
  };

  if (editingStep !== null) {
    return (
      <StepEditor
        sequenceId={sequenceId!}
        stepNumber={editingStep}
        existingStep={steps.find(s => s.step_number === editingStep)}
        onClose={() => setEditingStep(null)}
        onSave={handleStepSaved}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-slate-900">
          {sequence ? 'Edit Sequence' : 'Create Sequence'}
        </h2>
        <Button variant="outline" onClick={onClose}>
          Back to List
        </Button>
      </div>

      {/* Sequence Details */}
      <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
        <h3 className="text-lg font-semibold text-slate-900">Sequence Details</h3>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">
            Sequence Name *
          </label>
          <Input
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="e.g., New Client Welcome"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">
            Description
          </label>
          <textarea
            className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            rows={2}
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            placeholder="What is this sequence for?"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">
            Trigger Type *
          </label>
          <select
            className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={formData.trigger_type}
            onChange={(e) => setFormData({ ...formData, trigger_type: e.target.value as any })}
          >
            <option value="manual">Manual</option>
            <option value="contact_created">New Contact Created</option>
            <option value="booking_confirmed">Booking Confirmed</option>
            <option value="payment_received">Payment Received</option>
            <option value="tag_added">Tag Added</option>
          </select>
        </div>

        <div className="flex gap-3">
          <Button onClick={handleSaveSequence} disabled={loading}>
            {loading ? 'Saving...' : 'Save Sequence'}
          </Button>
        </div>
      </div>

      {/* Email Steps */}
      {sequenceId && (
        <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-slate-900">Email Steps</h3>
            <Button onClick={handleAddStep}>
              + Add Step
            </Button>
          </div>

          {steps.length === 0 ? (
            <div className="text-center py-8">
              <svg className="mx-auto h-10 w-10 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
              <p className="mt-2 text-sm text-slate-600">No steps added yet. Click "Add Step" to get started.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {steps.map((step, index) => (
                <div
                  key={step.id}
                  className="border border-slate-200 rounded-lg p-4 hover:border-blue-300 transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3">
                        <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 text-blue-700 font-semibold text-sm">
                          {index + 1}
                        </span>
                        <div>
                          <h4 className="font-semibold text-slate-900">{step.subject}</h4>
                          <p className="text-sm text-slate-500">
                            Send {formatDelay(step.delay_minutes)} after previous step
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEditingStep(step.step_number)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDeleteStep(step.id)}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
