'use client';

/**
 * IntakeEditModal
 *
 * Modal for editing intake form responses after submission.
 * Uses the same field types as the original intake form.
 */

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  ClipboardList, Save, Loader2, CheckCircle2, AlertTriangle, X
} from 'lucide-react';
import type { IntakeTemplate, IntakeResponses } from './types';

interface IntakeEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  bookingId: string;
  currentResponses: IntakeResponses | null;
  template: IntakeTemplate | null;
  onSave: () => void;
  t: (key: string) => string;
  language: string;
  isRTL: boolean;
}

export function IntakeEditModal({
  isOpen,
  onClose,
  bookingId,
  currentResponses,
  template,
  onSave,
  t,
  language,
  isRTL
}: IntakeEditModalProps) {
  const [responses, setResponses] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Initialize responses when modal opens
  useEffect(() => {
    if (isOpen && currentResponses?.responses) {
      setResponses({ ...currentResponses.responses });
      setError(null);
      setSuccess(false);
    }
  }, [isOpen, currentResponses]);

  if (!template || !currentResponses) return null;

  const getFieldLabel = (field: IntakeTemplate['fields'][0]) => {
    const langKey = `label_${language}` as keyof typeof field;
    return (field[langKey] as string) || field.label_en;
  };

  const getFieldPlaceholder = (field: IntakeTemplate['fields'][0]) => {
    const langKey = `placeholder_${language}` as keyof typeof field;
    return (field[langKey] as string) || '';
  };

  const getOptionLabel = (option: { value: string; label_en: string; label_es: string; label_he: string }) => {
    const langKey = `label_${language}` as keyof typeof option;
    return (option[langKey] as string) || option.label_en;
  };

  const handleFieldChange = (key: string, value: unknown) => {
    setResponses(prev => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/scheduling/bookings/${bookingId}/intake`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ responses })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to update intake responses');
      }

      setSuccess(true);
      onSave();

      setTimeout(() => {
        setSuccess(false);
        onClose();
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update responses');
    } finally {
      setLoading(false);
    }
  };

  const renderField = (field: IntakeTemplate['fields'][0]) => {
    const value = responses[field.key];
    const label = getFieldLabel(field);
    const placeholder = getFieldPlaceholder(field);

    switch (field.type) {
      case 'text':
      case 'email':
      case 'tel':
        return (
          <div key={field.key} className="space-y-1.5">
            <Label className="text-sm font-medium text-[var(--v2-text-secondary)]">
              {label}
              {field.required && <span className="text-red-500 ms-1">*</span>}
            </Label>
            <Input
              type={field.type}
              value={(value as string) || ''}
              onChange={(e) => handleFieldChange(field.key, e.target.value)}
              placeholder={placeholder}
              required={field.required}
              className="bg-[var(--v2-surface)] border-[var(--v2-border)] focus:border-[#8B5CF6] focus:ring-[#8B5CF6]"
              dir={isRTL ? 'rtl' : 'ltr'}
            />
          </div>
        );

      case 'textarea':
        return (
          <div key={field.key} className="space-y-1.5">
            <Label className="text-sm font-medium text-[var(--v2-text-secondary)]">
              {label}
              {field.required && <span className="text-red-500 ms-1">*</span>}
            </Label>
            <textarea
              value={(value as string) || ''}
              onChange={(e) => handleFieldChange(field.key, e.target.value)}
              placeholder={placeholder}
              required={field.required}
              rows={3}
              className="w-full px-3 py-2 text-sm bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-md text-[var(--v2-text-primary)] placeholder:text-[var(--v2-text-muted)] focus:outline-none focus:border-[#8B5CF6] focus:ring-2 focus:ring-[#8B5CF6]/20 resize-none"
              dir={isRTL ? 'rtl' : 'ltr'}
            />
          </div>
        );

      case 'select':
        return (
          <div key={field.key} className="space-y-1.5">
            <Label className="text-sm font-medium text-[var(--v2-text-secondary)]">
              {label}
              {field.required && <span className="text-red-500 ms-1">*</span>}
            </Label>
            <select
              value={(value as string) || ''}
              onChange={(e) => handleFieldChange(field.key, e.target.value)}
              required={field.required}
              className="w-full px-3 py-2 text-sm bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-md text-[var(--v2-text-primary)] focus:outline-none focus:border-[#8B5CF6] focus:ring-2 focus:ring-[#8B5CF6]/20"
              dir={isRTL ? 'rtl' : 'ltr'}
            >
              <option value="">{t('common.select') || 'Select...'}</option>
              {field.options?.map(option => (
                <option key={option.value} value={option.value}>
                  {getOptionLabel(option)}
                </option>
              ))}
            </select>
          </div>
        );

      case 'radio':
        return (
          <div key={field.key} className="space-y-2">
            <Label className="text-sm font-medium text-[var(--v2-text-secondary)]">
              {label}
              {field.required && <span className="text-red-500 ms-1">*</span>}
            </Label>
            <div className="space-y-2">
              {field.options?.map(option => (
                <label
                  key={option.value}
                  className="flex items-center gap-2 cursor-pointer"
                >
                  <input
                    type="radio"
                    name={field.key}
                    value={option.value}
                    checked={value === option.value}
                    onChange={(e) => handleFieldChange(field.key, e.target.value)}
                    required={field.required}
                    className="h-4 w-4 text-[#8B5CF6] border-gray-300 focus:ring-[#8B5CF6]"
                  />
                  <span className="text-sm text-[var(--v2-text-primary)]">
                    {getOptionLabel(option)}
                  </span>
                </label>
              ))}
            </div>
          </div>
        );

      case 'checkbox':
        // For checkbox, value can be boolean or array of selected values
        const isMultiple = field.options && field.options.length > 1;
        if (isMultiple) {
          const selectedValues = Array.isArray(value) ? value : [];
          return (
            <div key={field.key} className="space-y-2">
              <Label className="text-sm font-medium text-[var(--v2-text-secondary)]">
                {label}
                {field.required && <span className="text-red-500 ms-1">*</span>}
              </Label>
              <div className="space-y-2">
                {field.options?.map(option => (
                  <label
                    key={option.value}
                    className="flex items-center gap-2 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      value={option.value}
                      checked={selectedValues.includes(option.value)}
                      onChange={(e) => {
                        const newValues = e.target.checked
                          ? [...selectedValues, option.value]
                          : selectedValues.filter((v: string) => v !== option.value);
                        handleFieldChange(field.key, newValues);
                      }}
                      className="h-4 w-4 rounded text-[#8B5CF6] border-gray-300 focus:ring-[#8B5CF6]"
                    />
                    <span className="text-sm text-[var(--v2-text-primary)]">
                      {getOptionLabel(option)}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          );
        } else {
          // Single checkbox (yes/no)
          return (
            <div key={field.key} className="space-y-1.5">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={value === true || value === 'yes'}
                  onChange={(e) => handleFieldChange(field.key, e.target.checked ? 'yes' : 'no')}
                  className="h-4 w-4 rounded text-[#8B5CF6] border-gray-300 focus:ring-[#8B5CF6]"
                />
                <span className="text-sm font-medium text-[var(--v2-text-secondary)]">
                  {label}
                  {field.required && <span className="text-red-500 ms-1">*</span>}
                </span>
              </label>
            </div>
          );
        }

      default:
        return null;
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="bg-[var(--v2-bg)] border-[var(--v2-border)] max-w-lg max-h-[90vh] overflow-hidden flex flex-col"
        dir={isRTL ? 'rtl' : 'ltr'}
      >
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2 text-[var(--v2-text-primary)]">
            <ClipboardList className="h-5 w-5 text-[#8B5CF6]" />
            {t('crm.intake.edit_title') || 'Edit Intake Form'}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
          <div className="space-y-4 py-4">
            {/* Success Message */}
            {success && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 text-green-600">
                <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                <span className="text-sm">{t('crm.intake.update_success') || 'Intake updated successfully'}</span>
              </div>
            )}

            {/* Error Message */}
            {error && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 text-red-600">
                <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                <span className="text-sm">{error}</span>
              </div>
            )}

            {/* Form Fields */}
            {template.fields.map(renderField)}
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-3 pt-4 border-t border-[var(--v2-border)]">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={loading}
              className="border-[var(--v2-border)]"
            >
              {t('button.cancel') || 'Cancel'}
            </Button>
            <Button
              type="submit"
              disabled={loading || success}
              className="text-white"
              style={{ background: 'linear-gradient(135deg, #8B5CF6 0%, #7C3AED 100%)' }}
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 me-2 animate-spin" />
                  {t('common.saving') || 'Saving...'}
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 me-2" />
                  {t('button.save') || 'Save Changes'}
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
