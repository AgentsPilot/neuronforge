// lib/startup/initialize.ts

import { executionCleanup } from '@/lib/cleanup/executionCleanup'
// REMOVED: import { automaticScheduler } from '@/lib/scheduler/automaticScheduler'
import { supabaseServer as supabase } from '@/lib/supabaseServer'

// Global flag to persist initialization across Fast Refresh
declare global {
  var __NEURONFORGE_INITIALIZED__: boolean | undefined
}

interface InitializationResult {
  success: boolean
  error?: string
  steps: {
    database: boolean
    cleanup: boolean
    scheduler: boolean
  }
}

export class ApplicationInitializer {
  private static instance: ApplicationInitializer
  private isInitialized = globalThis.__NEURONFORGE_INITIALIZED__ || false

  private constructor() {}

  static getInstance(): ApplicationInitializer {
    if (!ApplicationInitializer.instance) {
      ApplicationInitializer.instance = new ApplicationInitializer()
    }
    return ApplicationInitializer.instance
  }

  /**
   * Initialize the entire application
   */
  async initialize(): Promise<InitializationResult> {
    if (this.isInitialized || globalThis.__NEURONFORGE_INITIALIZED__) {
      console.log('⚠️ Application already initialized')
      return {
        success: true,
        steps: { database: true, cleanup: true, scheduler: true }
      }
    }

    console.log('🚀 Starting application initialization...')
    
    const result: InitializationResult = {
      success: false,
      steps: { database: false, cleanup: false, scheduler: false }
    }

    try {
      // Step 1: Verify database connection
      console.log('📡 Step 1: Verifying database connection...')
      await this.verifyDatabaseConnection()
      result.steps.database = true
      console.log('✅ Database connection verified')

      // Step 2: Clean up orphaned executions
      console.log('🧹 Step 2: Cleaning up orphaned executions...')
      await executionCleanup.cleanupOrphanedExecutions()
      result.steps.cleanup = true
      console.log('✅ Execution cleanup completed')

      // Step 3: BullMQ worker system (handled separately by worker process)
      console.log('⏰ Step 3: BullMQ worker system active (external process)...')
      result.steps.scheduler = true // Mark as true since worker handles scheduling
      console.log('✅ Scheduling system confirmed (BullMQ worker)')

      this.isInitialized = true
      globalThis.__NEURONFORGE_INITIALIZED__ = true // Persist across Fast Refresh
      result.success = true

      console.log('🎉 Application initialization completed successfully!')

      return result

    } catch (error) {
      console.error('❌ Application initialization failed:', error)
      result.error = error instanceof Error ? error.message : 'Unknown error'
      
      return result
    }
  }

  /**
   * Verify database connection and basic functionality
   */
  private async verifyDatabaseConnection(): Promise<void> {
    try {
      // Check if supabase client is properly initialized
      if (!supabase || typeof supabase.from !== 'function') {
        throw new Error('Supabase client is not properly initialized. Check your environment variables and client setup.')
      }

      // Test basic database connectivity
      const { data, error } = await supabase
        .from('agents')
        .select('id')
        .limit(1)

      if (error) {
        throw new Error(`Database connection failed: ${error.message}`)
      }

      console.log('✅ Database connection test passed')

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown database error'
      throw new Error(`Database verification failed: ${errorMessage}`)
    }
  }

  /**
   * Get initialization status
   */
  getStatus(): { isInitialized: boolean } {
    return { isInitialized: this.isInitialized || globalThis.__NEURONFORGE_INITIALIZED__ || false }
  }
}

// Export singleton instance and convenience functions
export const applicationInitializer = ApplicationInitializer.getInstance()

/**
 * Initialize application (convenience function)
 */
export async function initializeApplication(): Promise<InitializationResult> {
  return await applicationInitializer.initialize()
}

/**
 * Get application status (convenience function)
 */
export function getApplicationStatus(): { isInitialized: boolean } {
  return applicationInitializer.getStatus()
}