import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * Cron job to update shared agent template scores periodically
 * Runs daily to recalculate adoption scores based on import counts and freshness
 *
 * Base execution scores (reliability, efficiency, complexity) remain frozen from share time
 * Only adoption score is updated dynamically
 */
export async function GET(request: NextRequest) {
  try {
    // Verify cron secret (for Vercel Cron Jobs)
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Create admin Supabase client (bypasses RLS)
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )

    // Get all shared agents
    const { data: sharedAgents, error: fetchError } = await supabase
      .from('shared_agents')
      .select('id, import_count, shared_at, quality_score, reliability_score, efficiency_score, complexity_score')

    if (fetchError) {
      console.error('Error fetching shared agents:', fetchError)
      return NextResponse.json(
        { error: 'Failed to fetch shared agents' },
        { status: 500 }
      )
    }

    if (!sharedAgents || sharedAgents.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No shared agents to update',
        updated: 0
      })
    }

    let updatedCount = 0
    const errors: string[] = []

    // Update each shared agent's score
    for (const agent of sharedAgents) {
      try {
        // Calculate adoption score
        const adoptionScore = calculateAdoptionScore({
          import_count: agent.import_count || 0,
          shared_at: agent.shared_at
        })

        // Apply age decay for templates older than 6 months
        const ageDecay = calculateAgeDecay(agent.shared_at)

        // Recalculate overall score
        // Base scores (reliability, efficiency, complexity) are frozen from share time
        // Only adoption is dynamic
        const baseScore = (
          (agent.reliability_score || 0) * 0.40 +
          (agent.efficiency_score || 0) * 0.30 +
          (agent.complexity_score || 0) * 0.10
        )

        const newOverallScore = (baseScore + adoptionScore * 0.20) * ageDecay

        // Update in database
        const { error: updateError } = await supabase
          .from('shared_agents')
          .update({
            adoption_score: adoptionScore,
            quality_score: newOverallScore,
            score_calculated_at: new Date().toISOString()
          })
          .eq('id', agent.id)

        if (updateError) {
          console.error(`Error updating agent ${agent.id}:`, updateError)
          errors.push(`${agent.id}: ${updateError.message}`)
        } else {
          updatedCount++
        }
      } catch (error) {
        console.error(`Error processing agent ${agent.id}:`, error)
        errors.push(`${agent.id}: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
    }

    return NextResponse.json({
      success: true,
      message: `Updated ${updatedCount} out of ${sharedAgents.length} shared agents`,
      updated: updatedCount,
      total: sharedAgents.length,
      errors: errors.length > 0 ? errors : undefined
    })
  } catch (error) {
    console.error('Error in update-template-scores cron:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * Calculate adoption score based on import count and freshness
 */
function calculateAdoptionScore(params: {
  import_count: number
  shared_at: string
}): number {
  // Logarithmic import score (prevents mega-popular dominance)
  // Max score at 40 imports
  const importScore = Math.min(
    Math.log10(params.import_count + 1) * 25,
    100
  )

  // Freshness score (decays over 90 days)
  const daysSinceShared = daysSince(params.shared_at)
  const freshnessScore = Math.max(0, 100 - (daysSinceShared / 90 * 100))

  return (
    importScore * 0.70 +
    freshnessScore * 0.30
  )
}

/**
 * Calculate age decay multiplier for templates older than 6 months
 */
function calculateAgeDecay(sharedAt: string): number {
  const monthsOld = monthsSince(sharedAt)

  if (monthsOld <= 6) {
    return 1.0  // No decay for templates <= 6 months old
  }

  // 5% decay per month after 6 months, minimum 70%
  const decay = Math.max(0.7, 1 - (monthsOld - 6) * 0.05)
  return decay
}

/**
 * Helper: Calculate days since a date
 */
function daysSince(dateString: string): number {
  const date = new Date(dateString)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  return Math.floor(diff / (1000 * 60 * 60 * 24))
}

/**
 * Helper: Calculate months since a date
 */
function monthsSince(dateString: string): number {
  const date = new Date(dateString)
  const now = new Date()

  const yearsDiff = now.getFullYear() - date.getFullYear()
  const monthsDiff = now.getMonth() - date.getMonth()

  return yearsDiff * 12 + monthsDiff
}
