'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'StepEditor' });

interface EmailSequenceStep {
  id: string;
  step_number: number;
  delay_minutes: number;
  subject: string;
  body_html: string;
  body_text?: string;
}

interface Props {
  sequenceId: string;
  stepNumber: number;
  existingStep?: EmailSequenceStep;
  onClose: () => void;
  onSave: () => void;
}

export function StepEditor({ sequenceId, stepNumber, existingStep, onClose, onSave }: Props) {
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    subject: '',
    body_html: '',
    delay_minutes: 0,
    delay_unit: 'minutes' as 'minutes' | 'hours' | 'days',
    delay_value: 0,
  });

  useEffect(() => {
    if (existingStep) {
      const minutes = existingStep.delay_minutes;
      let unit: 'minutes' | 'hours' | 'days' = 'minutes';
      let value = minutes;

      if (minutes >= 1440) {
        unit = 'days';
        value = minutes / 1440;
      } else if (minutes >= 60) {
        unit = 'hours';
        value = minutes / 60;
      }

      setFormData({
        subject: existingStep.subject,
        body_html: existingStep.body_html,
        delay_minutes: existingStep.delay_minutes,
        delay_unit: unit,
        delay_value: value,
      });
    }
  }, [existingStep]);

  const calculateDelayMinutes = (value: number, unit: 'minutes' | 'hours' | 'days') => {
    if (unit === 'minutes') return value;
    if (unit === 'hours') return value * 60;
    return value * 1440; // days
  };

  const handleDelayChange = (value: number, unit: 'minutes' | 'hours' | 'days') => {
    setFormData({
      ...formData,
      delay_value: value,
      delay_unit: unit,
      delay_minutes: calculateDelayMinutes(value, unit),
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const url = existingStep
        ? `/api/email/sequences/${sequenceId}/steps/${existingStep.id}`
        : `/api/email/sequences/${sequenceId}/steps`;
      const method = existingStep ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          step_number: stepNumber,
          delay_minutes: formData.delay_minutes,
          subject: formData.subject,
          body_html: formData.body_html,
        }),
      });

      const result = await response.json();

      if (result.success) {
        onSave();
      } else {
        logger.error({ error: result.error }, 'Failed to save step');
        alert('Failed to save step. Please try again.');
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to save step');
      alert('Failed to save step. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-slate-900">
          {existingStep ? `Edit Step ${stepNumber + 1}` : `Add Step ${stepNumber + 1}`}
        </h2>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
      </div>

      {/* Step Editor Form */}
      <form onSubmit={handleSubmit} className="bg-white border border-slate-200 rounded-lg p-6 space-y-6">
        {/* Delay */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">
            Send After {stepNumber === 0 ? '(trigger)' : '(previous step)'}
          </label>
          <div className="flex gap-3">
            <Input
              type="number"
              min="0"
              value={formData.delay_value}
              onChange={(e) => handleDelayChange(parseFloat(e.target.value) || 0, formData.delay_unit)}
              className="w-32"
            />
            <select
              className="px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={formData.delay_unit}
              onChange={(e) => handleDelayChange(formData.delay_value, e.target.value as any)}
            >
              <option value="minutes">Minutes</option>
              <option value="hours">Hours</option>
              <option value="days">Days</option>
            </select>
          </div>
          {stepNumber === 0 && formData.delay_minutes > 0 && (
            <p className="text-sm text-amber-600 mt-2">
              Note: Step 1 will wait {formData.delay_value} {formData.delay_unit} after the trigger before sending.
            </p>
          )}
        </div>

        {/* Subject */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">
            Email Subject *
          </label>
          <Input
            value={formData.subject}
            onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
            placeholder="e.g., Welcome to our practice!"
            required
          />
        </div>

        {/* Email Body */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">
            Email Body (HTML) *
          </label>
          <textarea
            className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
            rows={12}
            value={formData.body_html}
            onChange={(e) => setFormData({ ...formData, body_html: e.target.value })}
            placeholder="<p>Hi {{contact.first_name}},</p>&#10;<p>Welcome! We're excited to have you...</p>"
            required
          />
          <p className="text-xs text-slate-500 mt-2">
            Tip: Use {'{{'} contact.first_name {'}}' } or {'{{'} contact.last_name {'}}' } for personalization
          </p>
        </div>

        {/* Preview */}
        {formData.body_html && (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Preview
            </label>
            <div className="border border-slate-200 rounded-lg p-4 bg-slate-50">
              <div className="bg-white p-6 rounded shadow-sm">
                <div
                  dangerouslySetInnerHTML={{
                    __html: formData.body_html.replace(/{{contact\.(\w+)}}/g, '[Contact $1]')
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 border-t pt-4">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={loading}>
            {loading ? 'Saving...' : 'Save Step'}
          </Button>
        </div>
      </form>
    </div>
  );
}
