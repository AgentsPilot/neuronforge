// components/v2/insights/HardcodeRepairModal.tsx
// UI component for repairing hardcoded values in agent workflows
// Displays detected hardcoded values grouped by priority/category
// Allows user to select which to parameterize and provide new values

'use client';

import { useState, useEffect } from 'react';
import { DetectedValue, DetectionResult } from '@/lib/pilot/shadow/HardcodeDetector';

interface HardcodeRepairModalProps {
  detectionResult: DetectionResult;
  agentId: string;
  onRepair: (selections: Array<{ path: string; param_name: string; value: any; original_value: any }>) => Promise<void>;
  onCancel: () => void;
  isRepairing?: boolean;
}

export function HardcodeRepairModal({
  detectionResult,
  agentId,
  onRepair,
  onCancel,
  isRepairing = false,
}: HardcodeRepairModalProps) {
  // Track which values user wants to parameterize
  const [selectedValues, setSelectedValues] = useState<Set<string>>(new Set());

  // Track new values user provides
  const [newValues, setNewValues] = useState<Record<string, any>>({});

  // Auto-select critical and high priority items
  useEffect(() => {
    const autoSelect = new Set<string>();

    [...detectionResult.resource_ids, ...detectionResult.business_logic].forEach(item => {
      if (item.priority === 'critical' || item.priority === 'high') {
        autoSelect.add(item.path);
        // Initialize with original value
        setNewValues(prev => ({
          ...prev,
          [item.suggested_param]: item.value,
        }));
      }
    });

    setSelectedValues(autoSelect);
  }, [detectionResult]);

  const handleToggleSelection = (item: DetectedValue) => {
    const newSelected = new Set(selectedValues);

    if (newSelected.has(item.path)) {
      newSelected.delete(item.path);
      // Remove from newValues
      setNewValues(prev => {
        const updated = { ...prev };
        delete updated[item.suggested_param];
        return updated;
      });
    } else {
      newSelected.add(item.path);
      // Initialize with original value
      setNewValues(prev => ({
        ...prev,
        [item.suggested_param]: item.value,
      }));
    }

    setSelectedValues(newSelected);
  };

  const handleValueChange = (paramName: string, value: any) => {
    setNewValues(prev => ({
      ...prev,
      [paramName]: value,
    }));
  };

  const handleSubmit = async () => {
    // Build selections array
    const selections = Array.from(selectedValues).map(path => {
      const item = [...detectionResult.resource_ids, ...detectionResult.business_logic, ...detectionResult.configuration]
        .find(v => v.path === path);

      if (!item) return null;

      return {
        path: item.path,
        param_name: item.suggested_param,
        value: newValues[item.suggested_param],
        original_value: item.value,
      };
    }).filter(Boolean) as Array<{ path: string; param_name: string; value: any; original_value: any }>;

    await onRepair(selections);
  };

  const renderValueGroup = (title: string, items: DetectedValue[], bgColor: string, borderColor: string) => {
    if (items.length === 0) return null;

    return (
      <div className={`p-4 rounded-lg border ${borderColor} ${bgColor}`}>
        <h3 className="text-sm font-semibold text-[var(--v2-text-primary)] mb-3">{title}</h3>
        <div className="space-y-3">
          {items.map((item) => {
            const isSelected = selectedValues.has(item.path);
            const isCritical = item.priority === 'critical' || item.priority === 'high';

            return (
              <div key={item.path} className="flex items-start space-x-3">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => handleToggleSelection(item)}
                  className="mt-1 h-4 w-4 text-[var(--v2-primary)] focus:ring-[var(--v2-primary)] border-[var(--v2-border)] rounded"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-[var(--v2-text-primary)]">
                      {item.label}
                      {isCritical && (
                        <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400">
                          {item.priority}
                        </span>
                      )}
                    </label>
                  </div>

                  <p className="text-xs text-[var(--v2-text-muted)] mt-1">{item.reason}</p>

                  <div className="mt-2 text-xs text-[var(--v2-text-secondary)]">
                    <span className="font-mono bg-[var(--v2-hover)] px-2 py-1 rounded">
                      {String(item.value).length > 50
                        ? String(item.value).substring(0, 50) + '...'
                        : String(item.value)}
                    </span>
                  </div>

                  <div className="text-xs text-[var(--v2-text-muted)] mt-1">
                    Used in: {item.stepIds.join(', ')}
                  </div>

                  {isSelected && (
                    <div className="mt-3">
                      <label className="text-xs font-medium text-[var(--v2-text-primary)]">
                        New value for testing:
                      </label>
                      {item.type === 'select' && item.value && typeof item.value === 'object' ? (
                        <select
                          value={newValues[item.suggested_param] || ''}
                          onChange={(e) => handleValueChange(item.suggested_param, e.target.value)}
                          className="mt-1 block w-full px-3 py-2 text-sm border border-[var(--v2-border)] bg-[var(--v2-surface)] text-[var(--v2-text-primary)] rounded-md focus:outline-none focus:ring-[var(--v2-primary)] focus:border-[var(--v2-primary)]"
                        >
                          {Object.keys(item.value).map(key => (
                            <option key={key} value={item.value[key]}>{key}</option>
                          ))}
                        </select>
                      ) : item.type === 'number' ? (
                        <input
                          type="number"
                          value={newValues[item.suggested_param] || ''}
                          onChange={(e) => handleValueChange(item.suggested_param, Number(e.target.value))}
                          className="mt-1 block w-full px-3 py-2 text-sm border border-[var(--v2-border)] bg-[var(--v2-surface)] text-[var(--v2-text-primary)] rounded-md focus:outline-none focus:ring-[var(--v2-primary)] focus:border-[var(--v2-primary)]"
                        />
                      ) : item.type === 'email' ? (
                        <input
                          type="email"
                          value={newValues[item.suggested_param] || ''}
                          onChange={(e) => handleValueChange(item.suggested_param, e.target.value)}
                          placeholder="email@example.com"
                          className="mt-1 block w-full px-3 py-2 text-sm border border-[var(--v2-border)] bg-[var(--v2-surface)] text-[var(--v2-text-primary)] rounded-md focus:outline-none focus:ring-[var(--v2-primary)] focus:border-[var(--v2-primary)]"
                        />
                      ) : item.type === 'url' ? (
                        <input
                          type="url"
                          value={newValues[item.suggested_param] || ''}
                          onChange={(e) => handleValueChange(item.suggested_param, e.target.value)}
                          placeholder="https://example.com"
                          className="mt-1 block w-full px-3 py-2 text-sm border border-[var(--v2-border)] bg-[var(--v2-surface)] text-[var(--v2-text-primary)] rounded-md focus:outline-none focus:ring-[var(--v2-primary)] focus:border-[var(--v2-primary)]"
                        />
                      ) : (
                        <input
                          type="text"
                          value={newValues[item.suggested_param] || ''}
                          onChange={(e) => handleValueChange(item.suggested_param, e.target.value)}
                          className="mt-1 block w-full px-3 py-2 text-sm border border-[var(--v2-border)] bg-[var(--v2-surface)] text-[var(--v2-text-primary)] rounded-md focus:outline-none focus:ring-[var(--v2-primary)] focus:border-[var(--v2-primary)]"
                        />
                      )}
                      <p className="text-xs text-[var(--v2-text-muted)] mt-1">
                        Will be saved as: <span className="font-mono">{'{{input.' + item.suggested_param + '}}'}</span>
                      </p>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const canSubmit = selectedValues.size > 0 &&
    Array.from(selectedValues).every(path => {
      const item = [...detectionResult.resource_ids, ...detectionResult.business_logic, ...detectionResult.configuration]
        .find(v => v.path === path);
      return item && newValues[item.suggested_param] !== undefined && newValues[item.suggested_param] !== '';
    });

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
        {/* Background overlay */}
        <div className="fixed inset-0 transition-opacity bg-black/60 backdrop-blur-sm" onClick={onCancel} />

        {/* Modal panel */}
        <div className="inline-block align-bottom bg-[var(--v2-surface)] rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-4xl sm:w-full border border-[var(--v2-border)]">
          <div className="bg-[var(--v2-surface)] px-6 pt-6 pb-4">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-xl font-semibold text-[var(--v2-text-primary)]">
                  Hardcoded Values Detected
                </h2>
                <p className="mt-2 text-sm text-[var(--v2-text-muted)]">
                  We found {detectionResult.total_count} hardcoded value{detectionResult.total_count !== 1 ? 's' : ''} in your workflow.
                  Select which ones to convert to input parameters for easier testing.
                </p>
              </div>
              <button
                onClick={onCancel}
                className="text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)]"
              >
                <span className="sr-only">Close</span>
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="mt-6 space-y-4 max-h-96 overflow-y-auto">
              {renderValueGroup(
                'Critical - Resource IDs',
                detectionResult.resource_ids,
                'bg-red-50 dark:bg-red-900/20',
                'border-red-200 dark:border-red-800'
              )}

              {renderValueGroup(
                'Business Logic - Filters & Conditions',
                detectionResult.business_logic,
                'bg-yellow-50 dark:bg-yellow-900/20',
                'border-yellow-200 dark:border-yellow-800'
              )}

              {renderValueGroup(
                'Configuration - Optional Settings',
                detectionResult.configuration,
                'bg-blue-50 dark:bg-blue-900/20',
                'border-blue-200 dark:border-blue-800'
              )}
            </div>
          </div>

          <div className="bg-[var(--v2-hover)] px-6 py-4 flex items-center justify-between border-t border-[var(--v2-border)]">
            <div className="text-sm text-[var(--v2-text-muted)]">
              {selectedValues.size} value{selectedValues.size !== 1 ? 's' : ''} selected
            </div>
            <div className="flex space-x-3">
              <button
                onClick={onCancel}
                disabled={isRepairing}
                className="px-4 py-2 text-sm font-medium text-[var(--v2-text-primary)] bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-md hover:bg-[var(--v2-hover)] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={!canSubmit || isRepairing}
                className="px-4 py-2 text-sm font-medium text-white bg-[var(--v2-primary)] border border-transparent rounded-md hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isRepairing ? 'Repairing...' : 'Save & Repair Agent'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
