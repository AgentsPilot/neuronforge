'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ChevronDown, ChevronUp, Sparkles, Plus, X, AlertTriangle } from 'lucide-react';
import {
  QueryComponentsConfig,
  QueryComponent,
  parseQueryToComponents,
  buildQueryFromComponents,
  validateQueryComponents,
  QueryValidationError,
} from '@/lib/plugins/query-components-config';
import { cn } from '@/lib/utils';

interface QueryComponentsFieldProps {
  value: string;
  onChange: (value: string) => void;
  config: QueryComponentsConfig;
  label?: string;
  description?: string;
  disabled?: boolean;
}

// Parse keywords string into array of terms
function parseKeywordsToArray(value: string): string[] {
  if (!value) return [''];
  // Split by OR or AND (case insensitive), trim each term
  const terms = value
    .split(/\s+(?:OR|AND)\s+/i)
    .map(t => t.trim())
    .filter(t => t.length > 0);
  return terms.length > 0 ? terms : [''];
}

// Join array of terms with operator
function joinKeywordsArray(terms: string[], operator: string): string {
  const filtered = terms.filter(t => t.trim().length > 0);
  return filtered.join(` ${operator} `);
}

export function QueryComponentsField({
  value,
  onChange,
  config,
  label,
  description,
  disabled = false,
}: QueryComponentsFieldProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [componentValues, setComponentValues] = useState<Record<string, string | boolean>>({});
  // Store keywords as arrays for multi-value editing
  const [keywordsArrays, setKeywordsArrays] = useState<Record<string, string[]>>({});
  const [isInitialized, setIsInitialized] = useState(false);
  const [validationErrors, setValidationErrors] = useState<QueryValidationError[]>([]);

  // Parse initial value into components
  useEffect(() => {
    if (!isInitialized && value) {
      const parsed = parseQueryToComponents(value, config);
      setComponentValues(parsed);

      // Initialize keywords arrays from parsed values
      const arrays: Record<string, string[]> = {};
      config.components.forEach(comp => {
        if (comp.type === 'keywords' && typeof parsed[comp.key] === 'string') {
          arrays[comp.key] = parseKeywordsToArray(parsed[comp.key] as string);
        }
      });
      setKeywordsArrays(arrays);

      // Run initial validation
      const errors = validateQueryComponents(parsed, config);
      setValidationErrors(errors);

      setIsInitialized(true);
    } else if (!isInitialized) {
      // Initialize empty arrays for keywords fields
      const arrays: Record<string, string[]> = {};
      config.components.forEach(comp => {
        if (comp.type === 'keywords') {
          arrays[comp.key] = [''];
        }
      });
      setKeywordsArrays(arrays);
      setIsInitialized(true);
    }
  }, [value, config, isInitialized]);

  // Validate and update errors when components change
  const runValidation = useCallback(
    (components: Record<string, string | boolean>) => {
      const errors = validateQueryComponents(components, config);
      setValidationErrors(errors);
      return errors;
    },
    [config]
  );

  // Rebuild query when components change
  const handleComponentChange = useCallback(
    (key: string, newValue: string | boolean) => {
      // Convert __none__ sentinel back to empty string (Radix UI doesn't allow empty string values)
      const actualValue = newValue === '__none__' ? '' : newValue;
      const updated = { ...componentValues, [key]: actualValue };
      setComponentValues(updated);
      runValidation(updated);
      const query = buildQueryFromComponents(updated, config);
      onChange(query);
    },
    [componentValues, config, onChange, runValidation]
  );

  // Handle keywords array changes
  const handleKeywordsChange = useCallback(
    (componentKey: string, index: number, newValue: string) => {
      const currentArray = keywordsArrays[componentKey] || [''];
      const newArray = [...currentArray];
      newArray[index] = newValue;

      setKeywordsArrays(prev => ({ ...prev, [componentKey]: newArray }));

      // Get operator
      const operatorKey = `${componentKey}_operator`;
      const operator = (componentValues[operatorKey] as string) || 'OR';

      // Update the combined value
      const combinedValue = joinKeywordsArray(newArray, operator);
      const updated = { ...componentValues, [componentKey]: combinedValue };
      setComponentValues(updated);
      runValidation(updated);
      const query = buildQueryFromComponents(updated, config);
      onChange(query);
    },
    [keywordsArrays, componentValues, config, onChange, runValidation]
  );

  // Add new keyword input
  const addKeywordInput = useCallback(
    (componentKey: string) => {
      const currentArray = keywordsArrays[componentKey] || [''];
      setKeywordsArrays(prev => ({ ...prev, [componentKey]: [...currentArray, ''] }));
    },
    [keywordsArrays]
  );

  // Remove keyword input
  const removeKeywordInput = useCallback(
    (componentKey: string, index: number) => {
      const currentArray = keywordsArrays[componentKey] || [''];
      if (currentArray.length <= 1) return; // Keep at least one input

      const newArray = currentArray.filter((_, i) => i !== index);
      setKeywordsArrays(prev => ({ ...prev, [componentKey]: newArray }));

      // Get operator and update combined value
      const operatorKey = `${componentKey}_operator`;
      const operator = (componentValues[operatorKey] as string) || 'OR';
      const combinedValue = joinKeywordsArray(newArray, operator);
      const updated = { ...componentValues, [componentKey]: combinedValue };
      setComponentValues(updated);
      runValidation(updated);
      const query = buildQueryFromComponents(updated, config);
      onChange(query);
    },
    [keywordsArrays, componentValues, config, onChange, runValidation]
  );

  // Handle operator change for keywords
  const handleOperatorChange = useCallback(
    (componentKey: string, newOperator: string) => {
      const operatorKey = `${componentKey}_operator`;
      const actualOperator = newOperator === '__none__' ? 'OR' : newOperator;

      // Update operator in componentValues
      const updated = { ...componentValues, [operatorKey]: actualOperator };

      // Rebuild the keywords value with new operator
      const currentArray = keywordsArrays[componentKey] || [''];
      const combinedValue = joinKeywordsArray(currentArray, actualOperator);
      updated[componentKey] = combinedValue;

      setComponentValues(updated);
      runValidation(updated);
      const query = buildQueryFromComponents(updated, config);
      onChange(query);
    },
    [keywordsArrays, componentValues, config, onChange, runValidation]
  );

  // Check if a field has validation errors
  const getFieldError = useCallback(
    (fieldKey: string): string | null => {
      const error = validationErrors.find(e => e.fields.includes(fieldKey));
      return error ? error.message : null;
    },
    [validationErrors]
  );

  const renderComponent = (component: QueryComponent) => {
    const currentValue = componentValues[component.key];

    switch (component.type) {
      case 'boolean':
        return (
          <div key={component.key} className="flex items-center justify-between py-1.5">
            <div className="space-y-0.5">
              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                {component.label}
              </span>
              {component.description && (
                <p className="text-[10px] text-gray-500 dark:text-gray-400">
                  {component.description}
                </p>
              )}
            </div>
            <Switch
              checked={currentValue === true}
              onCheckedChange={(checked) => handleComponentChange(component.key, checked)}
              disabled={disabled}
              className="scale-90"
            />
          </div>
        );

      case 'select':
        return (
          <div key={component.key} className="space-y-1">
            <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
              {component.label}
            </span>
            <Select
              value={typeof currentValue === 'string' && currentValue !== '' ? currentValue : '__none__'}
              onValueChange={(val) => handleComponentChange(component.key, val)}
              disabled={disabled}
            >
              <SelectTrigger className="w-full h-8 text-xs bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600">
                <SelectValue placeholder={`Select ${component.label.toLowerCase()}`} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__" className="text-xs">None</SelectItem>
                {component.options?.map((option) => (
                  <SelectItem key={option.value} value={option.value} className="text-xs">
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {component.description && (
              <p className="text-[10px] text-gray-500 dark:text-gray-400">
                {component.description}
              </p>
            )}
          </div>
        );

      case 'keywords':
        // Multi-value keywords with operator selector
        const keywordsArray = keywordsArrays[component.key] || [''];
        const operatorKey = `${component.key}_operator`;
        const currentOperator = (componentValues[operatorKey] as string) || 'OR';

        return (
          <div key={component.key} className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                {component.label}
              </span>
              <div className="flex items-center gap-2">
                <Select
                  value={currentOperator}
                  onValueChange={(val) => handleOperatorChange(component.key, val)}
                  disabled={disabled}
                >
                  <SelectTrigger className="h-6 w-20 text-[10px] bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="OR" className="text-xs">OR</SelectItem>
                    <SelectItem value="AND" className="text-xs">AND</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              {keywordsArray.map((term, index) => (
                <div key={index} className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={term}
                    onChange={(e) => handleKeywordsChange(component.key, index, e.target.value)}
                    placeholder={component.placeholder || 'Enter keyword...'}
                    disabled={disabled}
                    className="flex-1 px-2.5 py-1.5 border text-xs focus:outline-none focus:ring-1 bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 focus:ring-indigo-500 focus:border-indigo-500 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500"
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                  />
                  {keywordsArray.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeKeywordInput(component.key, index)}
                      disabled={disabled}
                      className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {index === keywordsArray.length - 1 && (
                    <button
                      type="button"
                      onClick={() => addKeywordInput(component.key)}
                      disabled={disabled}
                      className="p-1 text-gray-400 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>

            {component.description && (
              <p className="text-[10px] text-gray-500 dark:text-gray-400">
                {component.description}
              </p>
            )}
          </div>
        );

      case 'text':
      default:
        return (
          <div key={component.key} className="space-y-1">
            <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
              {component.label}
            </span>
            <input
              type="text"
              value={typeof currentValue === 'string' ? currentValue : ''}
              onChange={(e) => handleComponentChange(component.key, e.target.value)}
              placeholder={component.placeholder}
              disabled={disabled}
              className="w-full px-2.5 py-1.5 border text-xs focus:outline-none focus:ring-1 bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 focus:ring-indigo-500 focus:border-indigo-500 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            />
            {component.description && (
              <p className="text-[10px] text-gray-500 dark:text-gray-400">
                {component.description}
              </p>
            )}
          </div>
        );
    }
  };

  // Group components by type for better layout
  const booleanComponents = config.components.filter((c) => c.type === 'boolean');
  // Filter out operator fields from display (they're handled inline with keywords)
  const otherComponents = config.components.filter((c) => c.type !== 'boolean' && !c.key.endsWith('_operator'));

  return (
    <div className="space-y-0">
      {/* Emphasized Header */}
      <div
        className={cn(
          "flex items-center justify-between px-3 py-2.5 rounded-t-lg",
          "bg-gradient-to-r from-indigo-500/10 via-purple-500/10 to-indigo-500/10",
          "dark:from-indigo-500/20 dark:via-purple-500/20 dark:to-indigo-500/20",
          "border border-b-0 border-indigo-200 dark:border-indigo-800/50"
        )}
      >
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-md bg-indigo-500/20 dark:bg-indigo-500/30">
            <Sparkles className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div>
            <span className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">
              {label || 'Search Builder'}
            </span>
            {description && (
              <p className="text-[10px] text-indigo-600/70 dark:text-indigo-400/70">{description}</p>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="p-1.5 hover:bg-indigo-100 dark:hover:bg-indigo-900/30 rounded-md transition-colors"
        >
          {isExpanded ? (
            <ChevronUp className="w-4 h-4 text-indigo-500 dark:text-indigo-400" />
          ) : (
            <ChevronDown className="w-4 h-4 text-indigo-500 dark:text-indigo-400" />
          )}
        </button>
      </div>

      {isExpanded && (
        <div
          className={cn(
            'rounded-b-lg border border-t-0 border-indigo-200 dark:border-indigo-800/50 p-4 space-y-4',
            'bg-gradient-to-b from-indigo-50/50 to-white dark:from-indigo-950/20 dark:to-gray-900/50'
          )}
        >
          {/* Text and select components */}
          <div className="grid gap-3 grid-cols-1">
            {otherComponents.map(renderComponent)}
          </div>

          {/* Boolean toggles */}
          {booleanComponents.length > 0 && (
            <div className="border-t border-indigo-100 dark:border-indigo-900/50 pt-3">
              <span className="text-[10px] font-medium text-indigo-600/70 dark:text-indigo-400/70 uppercase tracking-wide mb-2 block">
                Filters
              </span>
              <div className="grid gap-1 grid-cols-1">
                {booleanComponents.map(renderComponent)}
              </div>
            </div>
          )}

          {/* Validation errors */}
          {validationErrors.length > 0 && (
            <div className="border-t border-red-200 dark:border-red-800 pt-3">
              {validationErrors.map((error, idx) => (
                <div
                  key={idx}
                  className="flex items-start gap-1.5 p-2 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800"
                >
                  <AlertTriangle className="w-3.5 h-3.5 text-red-500 flex-shrink-0 mt-0.5" />
                  <span className="text-[10px] text-red-700 dark:text-red-400">
                    {error.message}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Show generated query */}
          <div className="border-t border-indigo-100 dark:border-indigo-900/50 pt-3">
            <span className="text-[10px] font-medium text-indigo-600/70 dark:text-indigo-400/70 uppercase tracking-wide">
              Generated Query
            </span>
            <div className={cn(
              "mt-1.5 p-2 rounded-md border text-[10px] font-mono break-all",
              validationErrors.length > 0
                ? "bg-red-50 dark:bg-red-900/20 border-red-300 dark:border-red-700 text-red-600 dark:text-red-400"
                : "bg-indigo-50/50 dark:bg-indigo-950/30 border-indigo-200 dark:border-indigo-800/50 text-indigo-700 dark:text-indigo-300"
            )}>
              {value || '(empty)'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
