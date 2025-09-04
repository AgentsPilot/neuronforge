// outputTypeConfigs.tsx
import React from 'react'
import { Trash2, Plus } from 'lucide-react'
import { SEVERITY_OPTIONS, FIELD_TYPES } from './outputSchemaTypes'

interface ConfigProps {
  errors: Record<string, string>
  touched: Record<string, boolean>
  onFieldBlur: (fieldName: string) => void
  onConfigFocus: () => void
}

// Email Draft Configuration
export const EmailDraftConfig: React.FC<ConfigProps & {
  to: string
  setTo: (value: string) => void
  subject: string
  setSubject: (value: string) => void
  includePdf: boolean
  setIncludePdf: (value: boolean) => void
}> = ({ to, setTo, subject, setSubject, includePdf, setIncludePdf, errors, touched, onFieldBlur, onConfigFocus }) => (
  <div className="space-y-6">
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div>
        <label className="block text-sm font-semibold text-slate-700 mb-3">
          To (Email Address) <span className="text-red-500">*</span>
        </label>
        <input
          type="email"
          value={to}
          onChange={e => setTo(e.target.value)}
          onBlur={() => onFieldBlur('to')}
          onFocus={onConfigFocus}
          placeholder="recipient@example.com"
          className={`w-full px-4 py-3 rounded-xl border-2 focus:outline-none focus:ring-2 transition-all duration-200 ${
            errors.to ? 'border-red-300 focus:border-red-500 focus:ring-red-500 bg-red-50' 
            : 'border-slate-200 focus:border-blue-500 focus:ring-blue-500 bg-white/50'
          }`}
        />
        {errors.to && <p className="text-red-600 text-sm mt-2 font-medium">{errors.to}</p>}
      </div>
      
      <div>
        <label className="block text-sm font-semibold text-slate-700 mb-3">
          Subject <span className="text-red-500">*</span>
        </label>
        <input
          value={subject}
          onChange={e => setSubject(e.target.value)}
          onBlur={() => onFieldBlur('subject')}
          onFocus={onConfigFocus}
          placeholder="Email subject line"
          className={`w-full px-4 py-3 rounded-xl border-2 focus:outline-none focus:ring-2 transition-all duration-200 ${
            errors.subject ? 'border-red-300 focus:border-red-500 focus:ring-red-500 bg-red-50' 
            : 'border-slate-200 focus:border-blue-500 focus:ring-blue-500 bg-white/50'
          }`}
        />
        {errors.subject && <p className="text-red-600 text-sm mt-2 font-medium">{errors.subject}</p>}
      </div>
    </div>
    
    <div className="flex items-center">
      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={includePdf}
          onChange={e => setIncludePdf(e.target.checked)}
          className="w-5 h-5 text-blue-600 border-2 border-slate-300 rounded focus:ring-blue-500 focus:ring-2"
        />
        <span className="text-sm font-medium text-slate-700">Include PDF attachment</span>
      </label>
    </div>
  </div>
)

// Alert Configuration
export const AlertConfig: React.FC<ConfigProps & {
  alertTitle: string
  setAlertTitle: (value: string) => void
  alertMessage: string
  setAlertMessage: (value: string) => void
  alertSeverity: string
  setAlertSeverity: (value: string) => void
  setTouched: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
}> = ({ alertTitle, setAlertTitle, alertMessage, setAlertMessage, alertSeverity, setAlertSeverity, errors, touched, onFieldBlur, onConfigFocus, setTouched }) => (
  <div className="space-y-6">
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div>
        <label className="block text-sm font-semibold text-slate-700 mb-3">
          Alert Title <span className="text-red-500">*</span>
        </label>
        <input
          value={alertTitle}
          onChange={e => setAlertTitle(e.target.value)}
          onBlur={() => onFieldBlur('alertTitle')}
          onFocus={onConfigFocus}
          placeholder="Enter alert title"
          className={`w-full px-4 py-3 rounded-xl border-2 focus:outline-none focus:ring-2 transition-all duration-200 ${
            errors.alertTitle && touched.alertTitle
              ? 'border-red-300 focus:border-red-500 focus:ring-red-500 bg-red-50' 
              : 'border-slate-200 focus:border-blue-500 focus:ring-blue-500 bg-white/50'
          }`}
        />
        {errors.alertTitle && touched.alertTitle && (
          <p className="text-red-600 text-sm mt-2 font-medium">{errors.alertTitle}</p>
        )}
      </div>
      
      <div>
        <label className="block text-sm font-semibold text-slate-700 mb-3">
          Severity Level <span className="text-red-500">*</span>
        </label>
        <div className="grid grid-cols-3 gap-3">
          {SEVERITY_OPTIONS.map((option) => (
            <button
              key={option.value}
              onClick={() => {
                setAlertSeverity(option.value)
                setTouched(prev => ({ ...prev, alertSeverity: true }))
              }}
              onFocus={onConfigFocus}
              className={`p-4 rounded-xl border-2 text-sm font-medium transition-all duration-200 hover:scale-105 ${
                alertSeverity === option.value
                  ? `border-blue-400 bg-gradient-to-r ${option.gradient} text-white shadow-lg`
                  : 'border-slate-200 bg-white/50 hover:border-slate-300 text-slate-700'
              }`}
            >
              <div className="flex flex-col items-center gap-2">
                <span className="text-2xl">{option.emoji}</span>
                <span className="text-xs leading-tight">{option.label}</span>
              </div>
            </button>
          ))}
        </div>
        {errors.alertSeverity && touched.alertSeverity && (
          <p className="text-red-600 text-sm mt-2 font-medium">{errors.alertSeverity}</p>
        )}
      </div>
    </div>
    
    <div>
      <label className="block text-sm font-semibold text-slate-700 mb-3">
        Alert Message <span className="text-red-500">*</span>
      </label>
      <textarea
        value={alertMessage}
        onChange={e => setAlertMessage(e.target.value)}
        onBlur={() => onFieldBlur('alertMessage')}
        onFocus={onConfigFocus}
        placeholder="Enter detailed alert message"
        rows={4}
        className={`w-full px-4 py-3 rounded-xl border-2 focus:outline-none focus:ring-2 transition-all duration-200 resize-none ${
          errors.alertMessage && touched.alertMessage
            ? 'border-red-300 focus:border-red-500 focus:ring-red-500 bg-red-50' 
            : 'border-slate-200 focus:border-blue-500 focus:ring-blue-500 bg-white/50'
        }`}
      />
      {errors.alertMessage && touched.alertMessage && (
        <p className="text-red-600 text-sm mt-2 font-medium">{errors.alertMessage}</p>
      )}
    </div>
  </div>
)

// Decision Configuration
export const DecisionConfig: React.FC<ConfigProps & {
  decisionAnswer: string
  setDecisionAnswer: (value: string) => void
  decisionConfidence: number
  setDecisionConfidence: (value: number) => void
  decisionReasoning: string
  setDecisionReasoning: (value: string) => void
}> = ({ decisionAnswer, setDecisionAnswer, decisionConfidence, setDecisionConfidence, decisionReasoning, setDecisionReasoning, errors, touched, onFieldBlur, onConfigFocus }) => (
  <div className="space-y-6">
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div>
        <label className="block text-sm font-semibold text-slate-700 mb-3">
          Decision Answer <span className="text-red-500">*</span>
        </label>
        <select
          value={decisionAnswer}
          onChange={e => setDecisionAnswer(e.target.value)}
          onBlur={() => onFieldBlur('decisionAnswer')}
          onFocus={onConfigFocus}
          className={`w-full px-4 py-3 rounded-xl border-2 focus:outline-none focus:ring-2 transition-all duration-200 ${
            errors.decisionAnswer && touched.decisionAnswer
              ? 'border-red-300 focus:border-red-500 focus:ring-red-500 bg-red-50' 
              : 'border-slate-200 focus:border-blue-500 focus:ring-blue-500 bg-white/50'
          }`}
        >
          <option value="">Select decision...</option>
          <option value="approve">Approve</option>
          <option value="reject">Reject</option>
          <option value="pending">Pending Review</option>
        </select>
        {errors.decisionAnswer && touched.decisionAnswer && (
          <p className="text-red-600 text-sm mt-2 font-medium">{errors.decisionAnswer}</p>
        )}
      </div>
      
      <div>
        <label className="block text-sm font-semibold text-slate-700 mb-3">
          Confidence Level: {decisionConfidence}%
        </label>
        <input
          type="range"
          min="0"
          max="100"
          value={decisionConfidence}
          onChange={e => setDecisionConfidence(Number(e.target.value))}
          className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer"
        />
        <div className="flex justify-between text-xs text-slate-500 mt-1">
          <span>Low (0%)</span>
          <span>High (100%)</span>
        </div>
      </div>
    </div>
    
    <div>
      <label className="block text-sm font-semibold text-slate-700 mb-3">
        Decision Reasoning <span className="text-red-500">*</span>
      </label>
      <textarea
        value={decisionReasoning}
        onChange={e => setDecisionReasoning(e.target.value)}
        onBlur={() => onFieldBlur('decisionReasoning')}
        onFocus={onConfigFocus}
        placeholder="Explain the reasoning behind this decision"
        rows={4}
        className={`w-full px-4 py-3 rounded-xl border-2 focus:outline-none focus:ring-2 transition-all duration-200 resize-none ${
          errors.decisionReasoning && touched.decisionReasoning
            ? 'border-red-300 focus:border-red-500 focus:ring-red-500 bg-red-50' 
            : 'border-slate-200 focus:border-blue-500 focus:ring-blue-500 bg-white/50'
        }`}
      />
      {errors.decisionReasoning && touched.decisionReasoning && (
        <p className="text-red-600 text-sm mt-2 font-medium">{errors.decisionReasoning}</p>
      )}
    </div>
  </div>
)

// Report Configuration
export const ReportConfig: React.FC<ConfigProps & {
  reportTitle: string
  setReportTitle: (value: string) => void
  reportSections: string[]
  setReportSections: (value: string[]) => void
}> = ({ reportTitle, setReportTitle, reportSections, setReportSections, errors, touched, onFieldBlur, onConfigFocus }) => (
  <div className="space-y-6">
    <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 mb-6">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-yellow-600">⚠️</span>
        <span className="font-medium text-yellow-800">Storage Location Pending</span>
      </div>
      <p className="text-yellow-700 text-sm">
        Report structure will be configured here, but storage location is still being determined.
      </p>
    </div>

    <div>
      <label className="block text-sm font-semibold text-slate-700 mb-3">
        Report Title <span className="text-red-500">*</span>
      </label>
      <input
        value={reportTitle}
        onChange={e => setReportTitle(e.target.value)}
        onBlur={() => onFieldBlur('reportTitle')}
        onFocus={onConfigFocus}
        placeholder="Enter report title"
        className={`w-full px-4 py-3 rounded-xl border-2 focus:outline-none focus:ring-2 transition-all duration-200 ${
          errors.reportTitle && touched.reportTitle
            ? 'border-red-300 focus:border-red-500 focus:ring-red-500 bg-red-50' 
            : 'border-slate-200 focus:border-blue-500 focus:ring-blue-500 bg-white/50'
        }`}
      />
      {errors.reportTitle && touched.reportTitle && (
        <p className="text-red-600 text-sm mt-2 font-medium">{errors.reportTitle}</p>
      )}
    </div>
    
    <div>
      <label className="block text-sm font-semibold text-slate-700 mb-3">
        Report Sections <span className="text-red-500">*</span>
      </label>
      <div className="space-y-3">
        {reportSections.map((section, index) => (
          <div key={index} className="flex gap-2">
            <input
              value={section}
              onChange={e => {
                const newSections = [...reportSections]
                newSections[index] = e.target.value
                setReportSections(newSections)
              }}
              onBlur={() => onFieldBlur('reportSections')}
              onFocus={onConfigFocus}
              placeholder={`Section ${index + 1} title`}
              className="flex-1 px-4 py-3 rounded-xl border-2 border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:outline-none transition-all duration-200 bg-white/50"
            />
            <button
              onClick={() => {
                const newSections = reportSections.filter((_, i) => i !== index)
                setReportSections(newSections.length === 0 ? [''] : newSections)
              }}
              className="px-3 py-3 bg-red-500 text-white rounded-xl hover:bg-red-600 transition-colors"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        <button
          onClick={() => setReportSections([...reportSections, ''])}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-slate-300 rounded-xl hover:border-slate-400 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Add Section
        </button>
      </div>
      {errors.reportSections && touched.reportSections && (
        <p className="text-red-600 text-sm mt-2 font-medium">{errors.reportSections}</p>
      )}
    </div>
  </div>
)