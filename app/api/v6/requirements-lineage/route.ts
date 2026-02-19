/**
 * API Endpoint: Requirements Lineage Trace
 *
 * POST /api/v6/requirements-lineage
 *
 * Extract and display requirements lineage WITHOUT running full pipeline.
 * Useful for debugging what requirements will be extracted from an Enhanced Prompt.
 *
 * Returns:
 * - Hard requirements extracted
 * - Requirement IDs with stable identifiers
 * - Constraints breakdown (unit_of_work, thresholds, invariants, etc.)
 */

import { NextRequest, NextResponse } from 'next/server'
import { HardRequirementsExtractor } from '@/lib/agentkit/v6/requirements'
import type { EnhancedPrompt } from '@/lib/agentkit/v6/generation/types'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { enhanced_prompt } = body

    // Validate input
    if (!enhanced_prompt) {
      return NextResponse.json(
        { error: 'Missing required field: enhanced_prompt' },
        { status: 400 }
      )
    }

    if (!enhanced_prompt.sections) {
      return NextResponse.json(
        { error: 'Invalid enhanced_prompt: missing sections' },
        { status: 400 }
      )
    }

    console.log('[API] Extracting requirements lineage...')

    // Extract hard requirements
    const extractor = new HardRequirementsExtractor()
    const hardReqs = extractor.extract(enhanced_prompt as EnhancedPrompt)
    const requirementMap = extractor.createRequirementMap(hardReqs)

    console.log(`[API] Extracted ${hardReqs.requirements.length} requirements`)

    // Build detailed breakdown
    const breakdown = {
      total_requirements: hardReqs.requirements.length,
      by_type: {
        unit_of_work: hardReqs.requirements.filter(r => r.type === 'unit_of_work').length,
        threshold: hardReqs.requirements.filter(r => r.type === 'threshold').length,
        routing_rule: hardReqs.requirements.filter(r => r.type === 'routing_rule').length,
        invariant: hardReqs.requirements.filter(r => r.type === 'invariant').length,
        empty_behavior: hardReqs.requirements.filter(r => r.type === 'empty_behavior').length,
        required_output: hardReqs.requirements.filter(r => r.type === 'required_output').length,
        side_effect_constraint: hardReqs.requirements.filter(r => r.type === 'side_effect_constraint').length
      },
      constraints: {
        unit_of_work: hardReqs.unit_of_work,
        thresholds: hardReqs.thresholds,
        routing_rules: hardReqs.routing_rules,
        invariants: hardReqs.invariants,
        empty_behavior: hardReqs.empty_behavior,
        required_outputs: hardReqs.required_outputs,
        side_effect_constraints: hardReqs.side_effect_constraints
      }
    }

    // Return lineage
    return NextResponse.json({
      success: true,
      requirements: hardReqs.requirements,
      requirement_map: requirementMap,
      breakdown,
      metadata: {
        extracted_at: new Date().toISOString(),
        ready_for_pipeline: true
      }
    })
  } catch (error) {
    console.error('[API] Error extracting lineage:', error)

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      },
      { status: 500 }
    )
  }
}
