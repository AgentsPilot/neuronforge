'use client'

/**
 * V6 Review & Customize UI Component
 *
 * Displays the 5-layer ambiguity detection results and collects user decisions
 * for the Intent Validation flow.
 *
 * Sections:
 * 1. Must Confirm (blocking) - Red border, must resolve all to proceed
 * 2. Should Review (expanded) - Yellow border, expanded by default
 * 3. Looks Good (collapsed) - Green border, pre-approved items
 * 4. Grounding Ambiguities - Multiple matches found during grounding
 */

import React, { useState, useMemo } from 'react'
import {
  AlertTriangle,
  AlertCircle,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Info,
  Shield,
  Zap,
  Eye,
  XCircle
} from 'lucide-react'

// ============================================================================
// Types (matching ambiguity-detection/types.ts)
// ============================================================================

interface MustConfirmItem {
  id: string
  layer: 1 | 2 | 3 | 4 | 5
  type: string
  title: string
  description: string
  options: Array<{
    id: string
    label: string
    description: string
    impact?: string
  }>
  recommended?: string
  source_assumption_id?: string
}

interface ShouldReviewItem {
  id: string
  type: string
  assumption: string
  confidence: number
  grounding_result?: string
  source_assumption_id?: string
}

interface LooksGoodItem {
  id: string
  assumption: string
  confidence: number
  validated_by: string
  source_assumption_id?: string
}

interface GroundingAmbiguity {
  id: string
  field: string
  description: string
  discovered_options: Array<{
    id: string
    label: string
    metadata?: Record<string, any>
  }>
  source: 'grounding' | 'semantic'
}

interface AmbiguityReport {
  must_confirm: MustConfirmItem[]
  should_review: ShouldReviewItem[]
  looks_good: LooksGoodItem[]
  grounding_ambiguities: GroundingAmbiguity[]
  overall_confidence: number
}

interface UserDecisions {
  confirmed_patterns: Record<string, string>
  resolved_ambiguities: Record<string, string>
  fake_validation_acks: string[]
  approved_assumptions: string[]
  disabled_assumptions: string[]
  edge_case_handling: Record<string, string>
  input_parameters: Record<string, any>
}

interface V6ReviewCustomizeUIProps {
  ambiguityReport: AmbiguityReport
  semanticPlan?: {
    goal: string
    assumptions?: Array<{ id: string; assumption: string; confidence: number }>
  }
  onDecisionsChange?: (decisions: UserDecisions) => void
  onCreateAgent?: (decisions: UserDecisions) => void
  isLoading?: boolean
}

// ============================================================================
// Helper Components
// ============================================================================

const ConfidenceBadge: React.FC<{ confidence: number }> = ({ confidence }) => {
  const percentage = Math.round(confidence * 100)
  let colorClass = 'bg-green-100 text-green-800'
  if (percentage < 50) colorClass = 'bg-red-100 text-red-800'
  else if (percentage < 80) colorClass = 'bg-yellow-100 text-yellow-800'

  return (
    <span className={`px-2 py-1 text-xs font-medium rounded-full ${colorClass}`}>
      {percentage}%
    </span>
  )
}

const LayerBadge: React.FC<{ layer: number }> = ({ layer }) => {
  const layerNames: Record<number, string> = {
    1: 'Confidence',
    2: 'Patterns',
    3: 'Conflicts',
    4: 'Language',
    5: 'Risk'
  }
  return (
    <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded">
      L{layer}: {layerNames[layer]}
    </span>
  )
}

const SectionHeader: React.FC<{
  title: string
  count: number
  icon: React.ReactNode
  color: string
  isExpanded: boolean
  onToggle: () => void
}> = ({ title, count, icon, color, isExpanded, onToggle }) => (
  <button
    onClick={onToggle}
    className={`w-full flex items-center justify-between p-4 rounded-t-lg border-b ${color} hover:opacity-90 transition-opacity`}
  >
    <div className="flex items-center gap-3">
      {icon}
      <span className="font-semibold text-gray-800">{title}</span>
      <span className="px-2 py-0.5 text-sm bg-white/50 rounded-full">{count}</span>
    </div>
    {isExpanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
  </button>
)

// ============================================================================
// Main Component
// ============================================================================

export default function V6ReviewCustomizeUI({
  ambiguityReport,
  semanticPlan,
  onDecisionsChange,
  onCreateAgent,
  isLoading = false
}: V6ReviewCustomizeUIProps) {
  // Section expansion state
  const [expandedSections, setExpandedSections] = useState({
    mustConfirm: true,
    shouldReview: true,
    looksGood: false,
    groundingAmbiguities: true
  })

  // User decisions state
  const [decisions, setDecisions] = useState<UserDecisions>({
    confirmed_patterns: {},
    resolved_ambiguities: {},
    fake_validation_acks: [],
    approved_assumptions: [],
    disabled_assumptions: [],
    edge_case_handling: {},
    input_parameters: {}
  })

  // Track which must_confirm items have been resolved
  const resolvedMustConfirm = useMemo(() => {
    const resolved = new Set<string>()
    for (const [itemId, optionId] of Object.entries(decisions.confirmed_patterns)) {
      if (optionId) resolved.add(itemId)
    }
    for (const [itemId, optionId] of Object.entries(decisions.resolved_ambiguities)) {
      if (optionId) resolved.add(itemId)
    }
    for (const ackId of decisions.fake_validation_acks) {
      resolved.add(ackId)
    }
    return resolved
  }, [decisions])

  // Check if all must_confirm items are resolved
  const allMustConfirmResolved = useMemo(() => {
    return ambiguityReport.must_confirm.every(item => resolvedMustConfirm.has(item.id))
  }, [ambiguityReport.must_confirm, resolvedMustConfirm])

  // Update decisions and notify parent
  const updateDecisions = (newDecisions: Partial<UserDecisions>) => {
    const updated = { ...decisions, ...newDecisions }
    setDecisions(updated)
    onDecisionsChange?.(updated)
  }

  // Handle option selection for must_confirm items
  const handleMustConfirmSelect = (itemId: string, optionId: string, itemType: string) => {
    if (itemType === 'semantic_ambiguity' || itemType === 'vague_language') {
      updateDecisions({
        resolved_ambiguities: { ...decisions.resolved_ambiguities, [itemId]: optionId }
      })
    } else if (itemType === 'fake_validation') {
      updateDecisions({
        fake_validation_acks: [...decisions.fake_validation_acks, itemId]
      })
    } else {
      updateDecisions({
        confirmed_patterns: { ...decisions.confirmed_patterns, [itemId]: optionId }
      })
    }
  }

  // Handle grounding ambiguity selection
  const handleGroundingAmbiguitySelect = (ambiguityId: string, optionId: string) => {
    updateDecisions({
      resolved_ambiguities: { ...decisions.resolved_ambiguities, [ambiguityId]: optionId }
    })
  }

  // Handle should_review toggle
  const handleShouldReviewToggle = (itemId: string, approved: boolean) => {
    if (approved) {
      updateDecisions({
        approved_assumptions: [...decisions.approved_assumptions.filter(id => id !== itemId), itemId],
        disabled_assumptions: decisions.disabled_assumptions.filter(id => id !== itemId)
      })
    } else {
      updateDecisions({
        approved_assumptions: decisions.approved_assumptions.filter(id => id !== itemId),
        disabled_assumptions: [...decisions.disabled_assumptions.filter(id => id !== itemId), itemId]
      })
    }
  }

  // Toggle section expansion
  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }))
  }

  // Handle create agent
  const handleCreateAgent = () => {
    if (allMustConfirmResolved && onCreateAgent) {
      onCreateAgent(decisions)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header with confidence score */}
      <div className="flex items-center justify-between p-4 bg-gradient-to-r from-indigo-50 to-purple-50 rounded-lg border border-indigo-200">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Review & Customize</h2>
          <p className="text-sm text-gray-600">
            {semanticPlan?.goal || 'Review the detected items before creating your agent'}
          </p>
        </div>
        <div className="text-right">
          <div className="text-sm text-gray-500">Overall Confidence</div>
          <div className="text-2xl font-bold text-indigo-600">
            {Math.round(ambiguityReport.overall_confidence * 100)}%
          </div>
        </div>
      </div>

      {/* Must Confirm Section */}
      {ambiguityReport.must_confirm.length > 0 && (
        <div className="border-2 border-red-300 rounded-lg overflow-hidden">
          <SectionHeader
            title="Must Confirm"
            count={ambiguityReport.must_confirm.length}
            icon={<AlertTriangle className="h-5 w-5 text-red-600" />}
            color="bg-red-50"
            isExpanded={expandedSections.mustConfirm}
            onToggle={() => toggleSection('mustConfirm')}
          />
          {expandedSections.mustConfirm && (
            <div className="p-4 space-y-4 bg-red-50/30">
              <p className="text-sm text-red-700 flex items-center gap-2">
                <XCircle className="h-4 w-4" />
                You must resolve all items below before creating your agent
              </p>
              {ambiguityReport.must_confirm.map(item => (
                <div
                  key={item.id}
                  className={`p-4 bg-white rounded-lg border ${
                    resolvedMustConfirm.has(item.id) ? 'border-green-300' : 'border-red-200'
                  }`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <h4 className="font-semibold text-gray-900">{item.title}</h4>
                      <p className="text-sm text-gray-600 mt-1">{item.description}</p>
                    </div>
                    <LayerBadge layer={item.layer} />
                  </div>
                  <div className="mt-3 space-y-2">
                    {item.options.map(option => (
                      <label
                        key={option.id}
                        className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                          (decisions.confirmed_patterns[item.id] === option.id ||
                            decisions.resolved_ambiguities[item.id] === option.id)
                            ? 'border-indigo-500 bg-indigo-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <input
                          type="radio"
                          name={`must-confirm-${item.id}`}
                          value={option.id}
                          checked={
                            decisions.confirmed_patterns[item.id] === option.id ||
                            decisions.resolved_ambiguities[item.id] === option.id
                          }
                          onChange={() => handleMustConfirmSelect(item.id, option.id, item.type)}
                          className="mt-1"
                        />
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-gray-900">{option.label}</span>
                            {item.recommended === option.id && (
                              <span className="px-2 py-0.5 text-xs bg-green-100 text-green-700 rounded">
                                Recommended
                              </span>
                            )}
                          </div>
                          {option.description && (
                            <p className="text-sm text-gray-500 mt-1">{option.description}</p>
                          )}
                          {option.impact && (
                            <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                              <Zap className="h-3 w-3" />
                              {option.impact}
                            </p>
                          )}
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Should Review Section */}
      {ambiguityReport.should_review.filter(item => item.assumption).length > 0 && (
        <div className="border-2 border-yellow-300 rounded-lg overflow-hidden">
          <SectionHeader
            title="Should Review"
            count={ambiguityReport.should_review.filter(item => item.assumption).length}
            icon={<Eye className="h-5 w-5 text-yellow-600" />}
            color="bg-yellow-50"
            isExpanded={expandedSections.shouldReview}
            onToggle={() => toggleSection('shouldReview')}
          />
          {expandedSections.shouldReview && (
            <div className="p-4 space-y-3 bg-yellow-50/30">
              <p className="text-sm text-yellow-700 flex items-center gap-2">
                <Info className="h-4 w-4" />
                These items have medium confidence. Review and approve or disable them.
              </p>
              {ambiguityReport.should_review
                .filter(item => item.assumption) // Filter out items without assumption text
                .map(item => {
                const isApproved = decisions.approved_assumptions.includes(item.id)
                const isDisabled = decisions.disabled_assumptions.includes(item.id)
                return (
                  <div
                    key={item.id}
                    className={`p-4 bg-white rounded-lg border ${
                      isDisabled ? 'border-gray-300 opacity-60' : 'border-yellow-200'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <p className="text-gray-800">{item.assumption}</p>
                        {item.grounding_result && (
                          <p className="text-sm text-gray-500 mt-1">
                            Grounding: {item.grounding_result}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-3 ml-4">
                        <ConfidenceBadge confidence={item.confidence} />
                        <div className="flex gap-1">
                          <button
                            onClick={() => handleShouldReviewToggle(item.id, true)}
                            className={`p-2 rounded ${
                              isApproved
                                ? 'bg-green-100 text-green-700'
                                : 'bg-gray-100 text-gray-400 hover:bg-green-50'
                            }`}
                            title="Approve"
                          >
                            <CheckCircle className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleShouldReviewToggle(item.id, false)}
                            className={`p-2 rounded ${
                              isDisabled
                                ? 'bg-red-100 text-red-700'
                                : 'bg-gray-100 text-gray-400 hover:bg-red-50'
                            }`}
                            title="Disable"
                          >
                            <XCircle className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Grounding Ambiguities Section */}
      {ambiguityReport.grounding_ambiguities.length > 0 && (
        <div className="border-2 border-blue-300 rounded-lg overflow-hidden">
          <SectionHeader
            title="Multiple Matches Found"
            count={ambiguityReport.grounding_ambiguities.length}
            icon={<AlertCircle className="h-5 w-5 text-blue-600" />}
            color="bg-blue-50"
            isExpanded={expandedSections.groundingAmbiguities}
            onToggle={() => toggleSection('groundingAmbiguities')}
          />
          {expandedSections.groundingAmbiguities && (
            <div className="p-4 space-y-4 bg-blue-50/30">
              <p className="text-sm text-blue-700 flex items-center gap-2">
                <Info className="h-4 w-4" />
                Multiple options were found during validation. Select the correct one.
              </p>
              {ambiguityReport.grounding_ambiguities.map(amb => (
                <div key={amb.id} className="p-4 bg-white rounded-lg border border-blue-200">
                  <h4 className="font-semibold text-gray-900 mb-1">{amb.field}</h4>
                  <p className="text-sm text-gray-600 mb-3">{amb.description}</p>
                  <div className="grid grid-cols-2 gap-2">
                    {amb.discovered_options.map(option => (
                      <label
                        key={option.id}
                        className={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-colors ${
                          decisions.resolved_ambiguities[amb.id] === option.id
                            ? 'border-indigo-500 bg-indigo-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <input
                          type="radio"
                          name={`grounding-${amb.id}`}
                          value={option.id}
                          checked={decisions.resolved_ambiguities[amb.id] === option.id}
                          onChange={() => handleGroundingAmbiguitySelect(amb.id, option.id)}
                        />
                        <span className="text-sm text-gray-800">{option.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Looks Good Section */}
      {ambiguityReport.looks_good.length > 0 && (
        <div className="border-2 border-green-300 rounded-lg overflow-hidden">
          <SectionHeader
            title="Looks Good"
            count={ambiguityReport.looks_good.length}
            icon={<CheckCircle className="h-5 w-5 text-green-600" />}
            color="bg-green-50"
            isExpanded={expandedSections.looksGood}
            onToggle={() => toggleSection('looksGood')}
          />
          {expandedSections.looksGood && (
            <div className="p-4 space-y-2 bg-green-50/30">
              <p className="text-sm text-green-700 flex items-center gap-2">
                <Shield className="h-4 w-4" />
                These items passed validation with high confidence
              </p>
              {ambiguityReport.looks_good.map(item => (
                <div
                  key={item.id}
                  className="flex items-center justify-between p-3 bg-white rounded-lg border border-green-200"
                >
                  <div className="flex-1">
                    <p className="text-gray-800">{item.assumption}</p>
                    <p className="text-xs text-gray-500 mt-1">
                      Validated by: {item.validated_by}
                    </p>
                  </div>
                  <ConfidenceBadge confidence={item.confidence} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Summary & Action */}
      <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200">
        <div className="text-sm text-gray-600">
          <span className="font-medium">
            {resolvedMustConfirm.size} / {ambiguityReport.must_confirm.length}
          </span>{' '}
          required items resolved
          {ambiguityReport.should_review.length > 0 && (
            <>
              {' | '}
              <span className="font-medium">
                {decisions.approved_assumptions.length + decisions.disabled_assumptions.length}
              </span>{' '}
              reviewed
            </>
          )}
        </div>
        <button
          onClick={handleCreateAgent}
          disabled={!allMustConfirmResolved || isLoading}
          className={`px-6 py-2 rounded-lg font-semibold transition-colors ${
            allMustConfirmResolved && !isLoading
              ? 'bg-indigo-600 text-white hover:bg-indigo-700'
              : 'bg-gray-300 text-gray-500 cursor-not-allowed'
          }`}
        >
          {isLoading ? 'Processing...' : 'Compile and Generate DSL'}
        </button>
      </div>
    </div>
  )
}

// Export types for consumers
export type {
  AmbiguityReport,
  UserDecisions,
  MustConfirmItem,
  ShouldReviewItem,
  LooksGoodItem,
  GroundingAmbiguity,
  V6ReviewCustomizeUIProps
}
