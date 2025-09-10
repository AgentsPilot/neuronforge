import React, { useState } from 'react';
import { 
  FileText, 
  ChevronDown, 
  Calendar,
  Hash,
  Type,
  ToggleLeft,
  ToggleRight,
  AlertCircle,
  CheckCircle2
} from 'lucide-react';
import type { InputSchema } from '../types';

interface Props {
  inputSchema: InputSchema[];
  values: Record<string, any>;
  onChange: (fieldId: string, value: any) => void;
  errors?: Record<string, string>;
  className?: string;
}

export function InputSchemaCard({ inputSchema, values, onChange, errors = {}, className = "" }: Props) {
  const [focusedField, setFocusedField] = useState<string | null>(null);

  const getFieldIcon = (type: string) => {
    switch (type) {
      case 'text':
      case 'textarea':
        return <Type className="h-4 w-4" />;
      case 'number':
      case 'slider':
        return <Hash className="h-4 w-4" />;
      case 'date':
        return <Calendar className="h-4 w-4" />;
      case 'boolean':
        return values[type] ? <ToggleRight className="h-4 w-4" /> : <ToggleLeft className="h-4 w-4" />;
      default:
        return <FileText className="h-4 w-4" />;
    }
  };

  const renderField = (field: InputSchema) => {
    const value = values[field.id] || field.defaultValue || '';
    const hasError = errors[field.id];
    const isFocused = focusedField === field.id;

    const baseClasses = `w-full px-4 py-3 border rounded-xl transition-all duration-200 ${
      hasError 
        ? 'border-red-300 bg-red-50 focus:border-red-500 focus:ring-2 focus:ring-red-200' 
        : isFocused
          ? 'border-blue-500 bg-blue-50 focus:border-blue-500 focus:ring-2 focus:ring-blue-200'
          : 'border-gray-300 bg-white hover:border-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-200'
    } focus:outline-none`;

    switch (field.type) {
      case 'text':
        return (
          <input
            type="text"
            value={value}
            placeholder={field.placeholder}
            className={baseClasses}
            onChange={(e) => onChange(field.id, e.target.value)}
            onFocus={() => setFocusedField(field.id)}
            onBlur={() => setFocusedField(null)}
          />
        );

      case 'textarea':
        return (
          <textarea
            value={value}
            placeholder={field.placeholder}
            rows={3}
            className={baseClasses}
            onChange={(e) => onChange(field.id, e.target.value)}
            onFocus={() => setFocusedField(field.id)}
            onBlur={() => setFocusedField(null)}
          />
        );

      case 'dropdown':
        return (
          <div className="relative">
            <select
              value={value}
              className={`${baseClasses} appearance-none cursor-pointer pr-10`}
              onChange={(e) => onChange(field.id, e.target.value)}
              onFocus={() => setFocusedField(field.id)}
              onBlur={() => setFocusedField(null)}
            >
              {!field.required && <option value="">Select an option</option>}
              {field.options?.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400 pointer-events-none" />
          </div>
        );

      case 'multiselect':
        const selectedValues = Array.isArray(value) ? value : [];
        return (
          <div className="space-y-2">
            {field.options?.map((option) => (
              <label key={option} className="flex items-center gap-3 p-3 border rounded-lg hover:bg-gray-50 cursor-pointer transition-colors">
                <input
                  type="checkbox"
                  checked={selectedValues.includes(option)}
                  onChange={(e) => {
                    const newValues = e.target.checked
                      ? [...selectedValues, option]
                      : selectedValues.filter(v => v !== option);
                    onChange(field.id, newValues);
                  }}
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">{option}</span>
              </label>
            ))}
          </div>
        );

      case 'number':
        return (
          <input
            type="number"
            value={value}
            min={field.min}
            max={field.max}
            step={field.step}
            placeholder={field.placeholder}
            className={baseClasses}
            onChange={(e) => onChange(field.id, Number(e.target.value))}
            onFocus={() => setFocusedField(field.id)}
            onBlur={() => setFocusedField(null)}
          />
        );

      case 'slider':
        return (
          <div className="space-y-3">
            <input
              type="range"
              value={value}
              min={field.min || 0}
              max={field.max || 100}
              step={field.step || 1}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer slider"
              onChange={(e) => onChange(field.id, Number(e.target.value))}
            />
            <div className="flex justify-between text-sm text-gray-500">
              <span>{field.min || 0}</span>
              <span className="font-medium text-blue-600">{value}</span>
              <span>{field.max || 100}</span>
            </div>
          </div>
        );

      case 'boolean':
        return (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => onChange(field.id, !value)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                value ? 'bg-blue-600' : 'bg-gray-200'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  value ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
            <span className="text-sm text-gray-700">
              {value ? 'Yes' : 'No'}
            </span>
          </div>
        );

      case 'date':
        return (
          <input
            type="date"
            value={value}
            className={baseClasses}
            onChange={(e) => onChange(field.id, e.target.value)}
            onFocus={() => setFocusedField(field.id)}
            onBlur={() => setFocusedField(null)}
          />
        );

      default:
        return (
          <input
            type="text"
            value={value}
            placeholder={field.placeholder}
            className={baseClasses}
            onChange={(e) => onChange(field.id, e.target.value)}
            onFocus={() => setFocusedField(field.id)}
            onBlur={() => setFocusedField(null)}
          />
        );
    }
  };

  if (!inputSchema.length) {
    return null;
  }

  return (
    <div className={`bg-white rounded-2xl shadow-xl border border-blue-100 p-6 ${className}`}>
      <div className="mb-6">
        <h3 className="text-xl font-bold text-gray-900 mb-2 flex items-center gap-2">
          <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
            <FileText className="h-5 w-5 text-blue-600" />
          </div>
          Required Information
        </h3>
        <p className="text-gray-600 text-sm">
          Please provide the following information to customize your workflow
        </p>
      </div>

      <div className="space-y-6">
        {inputSchema.map((field) => {
          const hasError = errors[field.id];
          const isValid = values[field.id] && !hasError;

          return (
            <div key={field.id} className="space-y-2">
              {/* Field Label */}
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                  <div className="w-5 h-5 text-blue-600 flex-shrink-0">
                    {getFieldIcon(field.type)}
                  </div>
                  {field.label}
                  {field.required && (
                    <span className="text-red-500 text-xs">*</span>
                  )}
                </label>
                
                {/* Status Indicator */}
                <div className="flex items-center gap-1">
                  {hasError ? (
                    <AlertCircle className="h-4 w-4 text-red-500" />
                  ) : isValid ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                  ) : null}
                  <span className="text-xs text-gray-500 capitalize">
                    {field.type}
                  </span>
                </div>
              </div>

              {/* Field Description */}
              {field.description && (
                <p className="text-xs text-gray-600 ml-7">
                  {field.description}
                </p>
              )}

              {/* Field Input */}
              <div className="ml-7">
                {renderField(field)}
              </div>

              {/* Error Message */}
              {hasError && (
                <p className="text-xs text-red-600 ml-7 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  {hasError}
                </p>
              )}

              {/* Validation Rules Display */}
              {field.validation && (
                <div className="ml-7 text-xs text-gray-500">
                  {field.validation.minLength && (
                    <span>Min {field.validation.minLength} chars</span>
                  )}
                  {field.validation.maxLength && (
                    <span className="ml-2">Max {field.validation.maxLength} chars</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Form Summary */}
      <div className="mt-8 pt-6 border-t border-gray-200">
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-600">
            {inputSchema.filter(f => f.required).length} required fields
          </span>
          <span className="text-gray-600">
            {Object.keys(values).length} / {inputSchema.length} completed
          </span>
        </div>
        
        {/* Progress Bar */}
        <div className="mt-3 w-full bg-gray-200 rounded-full h-2">
          <div 
            className="bg-blue-600 h-2 rounded-full transition-all duration-300"
            style={{ 
              width: `${(Object.keys(values).length / inputSchema.length) * 100}%` 
            }}
          />
        </div>
      </div>
    </div>
  );
}