// lib/cleanup/executionCleanup.ts

import { supabaseServer as supabase } from '@/lib/supabaseServer'

interface OrphanedExecution {
  id: string
  agent_id: string
  status: string
  started_at: string
  agent_name?: string
}

export class ExecutionCleanup {
  private readonly EXECUTION_TIMEOUT_MINUTES = 30
  private readonly CLEANUP_INTERVAL_MINUTES = 5

  /**
   * Clean up executions that have been running too long or are stuck
   */
  async cleanupOrphanedExecutions(): Promise<void> {
    try {
      console.log('🧹 Starting execution cleanup...')
      
      const timeoutThreshold = new Date()
      timeoutThreshold.setMinutes(timeoutThreshold.getMinutes() - this.EXECUTION_TIMEOUT_MINUTES)

      // Find stuck executions
      const { data: stuckExecutions, error } = await supabase
        .from('agent_executions')
        .select(`
          id,
          agent_id,
          status,
          started_at,
          agents(agent_name)
        `)
        .in('status', ['running', 'pending'])
        .lt('started_at', timeoutThreshold.toISOString())

      if (error) {
        console.error('❌ Error finding stuck executions:', error)
        return
      }

      if (!stuckExecutions || stuckExecutions.length === 0) {
        console.log('✅ No stuck executions found')
        return
      }

      console.log(`🔍 Found ${stuckExecutions.length} stuck executions`)

      // Clean up each stuck execution
      for (const execution of stuckExecutions) {
        await this.cleanupExecution(execution)
      }

      console.log('✅ Execution cleanup completed')

    } catch (error) {
      console.error('❌ Execution cleanup failed:', error)
    }
  }

  /**
   * Clean up a specific execution
   */
  private async cleanupExecution(execution: OrphanedExecution): Promise<void> {
    try {
      const agentName = execution.agents?.agent_name || 'Unknown Agent'
      
      console.log(`🧹 Cleaning up stuck execution: ${execution.id} (${agentName})`)

      // Update execution status to failed
      const { error: updateError } = await supabase
        .from('agent_executions')
        .update({
          status: 'failed',
          error_message: `Execution timed out after ${this.EXECUTION_TIMEOUT_MINUTES} minutes`,
          ended_at: new Date().toISOString()
        })
        .eq('id', execution.id)

      if (updateError) {
        console.error(`❌ Failed to update execution ${execution.id}:`, updateError)
        return
      }

      console.log(`✅ Cleaned up execution: ${execution.id}`)

    } catch (error) {
      console.error(`❌ Failed to cleanup execution ${execution.id}:`, error)
    }
  }

  /**
   * Get cleanup statistics
   */
  async getCleanupStats(): Promise<{
    stuckExecutions: number
    totalExecutions: number
  }> {
    try {
      const timeoutThreshold = new Date()
      timeoutThreshold.setMinutes(timeoutThreshold.getMinutes() - this.EXECUTION_TIMEOUT_MINUTES)

      // Count stuck executions
      const { count: stuckCount } = await supabase
        .from('agent_executions')
        .select('id', { count: 'exact' })
        .in('status', ['running', 'pending'])
        .lt('started_at', timeoutThreshold.toISOString())

      // Count total executions
      const { count: totalCount } = await supabase
        .from('agent_executions')
        .select('id', { count: 'exact' })

      return {
        stuckExecutions: stuckCount || 0,
        totalExecutions: totalCount || 0
      }

    } catch (error) {
      console.error('❌ Failed to get cleanup stats:', error)
      return {
        stuckExecutions: 0,
        totalExecutions: 0
      }
    }
  }

  /**
   * Start automatic cleanup with interval
   */
  startAutomaticCleanup(): NodeJS.Timeout {
    console.log(`🔄 Starting automatic cleanup every ${this.CLEANUP_INTERVAL_MINUTES} minutes`)
    
    return setInterval(() => {
      this.cleanupOrphanedExecutions()
    }, this.CLEANUP_INTERVAL_MINUTES * 60 * 1000)
  }

  /**
   * Stop automatic cleanup
   */
  stopAutomaticCleanup(intervalId: NodeJS.Timeout): void {
    clearInterval(intervalId)
    console.log('⏹️ Stopped automatic cleanup')
  }
}

// Export singleton instance
export const executionCleanup = new ExecutionCleanup()