/**
 * Batch Calibration Page - Complete rewrite for batch calibration system
 *
 * This page orchestrates the batch calibration flow:
 * 1. Setup: Show input form and start calibration
 * 2. Running: Show progress (optional, can be instant)
 * 3. Dashboard: Show all issues and fixes UI
 * 4. Success: Show completion and next steps
 *
 * Uses V2 theme design for clean, game-changing UX.
 */

'use client'

import React, { useState, useEffect, useRef } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useAuth } from '@/components/UserProvider'
import { supabase } from '@/lib/supabaseClient'
import { V2Logo, V2Controls } from '@/components/v2/V2Header'
import { HelpBot } from '@/components/v2/HelpBot'
import { PageLoading } from '@/components/v2/ui/loading'
import { CalibrationSetup } from '@/components/v2/calibration/CalibrationSetup'
import { CalibrationDashboard } from '@/components/v2/calibration/CalibrationDashboard'
import { FixesApplied } from '@/components/v2/calibration/FixesApplied'
import { CalibrationSuccess } from '@/components/v2/calibration/CalibrationSuccess'
import { AgentSetupWizard } from '@/components/v2/wizard/AgentSetupWizard'
import { HardcodeDetector, type DetectionResult } from '@/lib/pilot/shadow/HardcodeDetector'
import { ArrowLeft, Loader2 } from 'lucide-react'
import type { IssueGroups, UserFixes, CalibrationSession } from '@/components/v2/calibration/CalibrationDashboard'

// ─── Types ──────────────────────────────────────────────────

interface Agent {
  id: string
  agent_name: string
  description?: string
  pilot_steps?: any[]
  workflow_steps?: any[]
  input_parameters?: any[]
  input_schema?: any[]
  user_id: string
}

type FlowState = 'setup' | 'running' | 'dashboard' | 'fixes-applied' | 'testing' | 'success'

// ─── Main Component ─────────────────────────────────────────

export default function BatchCalibrationPage() {
  const router = useRouter()
  const params = useParams()
  const { user, loading: authLoading } = useAuth()
  const agentId = params?.agentId as string

  // Check if user wants to start fresh (skip session restoration)
  const searchParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
  const startFresh = searchParams?.get('fresh') === 'true'

  // State
  const [agent, setAgent] = useState<Agent | null>(null)
  const [loading, setLoading] = useState(true)
  const [flowState, setFlowState] = useState<FlowState>('setup')
  const [session, setSession] = useState<CalibrationSession | null>(null)
  const [issues, setIssues] = useState<IssueGroups | null>(null)
  const [fixes, setFixes] = useState<UserFixes>({
    parameters: {},
    parameterizations: {},
    autoRepairs: {}
  })
  const [isApplying, setIsApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fixesSummary, setFixesSummary] = useState<any>(null)
  const [hasHardcodedValues, setHasHardcodedValues] = useState(false)
  const [detectionResult, setDetectionResult] = useState<DetectionResult | null>(null)
  const [showParameterizationWizard, setShowParameterizationWizard] = useState(false)
  const [userDeclinedParameterization, setUserDeclinedParameterization] = useState(false)
  const [inputValues, setInputValues] = useState<Record<string, any>>({})
  const [schemaMetadata, setSchemaMetadata] = useState<Record<string, any[]> | null>(null)
  const [configurationSaved, setConfigurationSaved] = useState(false)
  const [hasParameterizedWorkflow, setHasParameterizedWorkflow] = useState(false)

  // Track if agent has been loaded to prevent re-loading on tab switches
  const hasLoadedAgent = useRef(false)

  // Fetch plugin schema metadata on mount
  useEffect(() => {
    const fetchSchemaMetadata = async () => {
      try {
        const response = await fetch('/api/plugins/schema-metadata')
        if (!response.ok) {
          console.error('Failed to fetch schema metadata:', response.statusText)
          return
        }
        const data = await response.json()
        console.log('[Sandbox Page] Schema metadata loaded:', data.data?.metadata)
        setSchemaMetadata(data.data?.metadata)
      } catch (error) {
        console.error('[Sandbox Page] Error fetching schema metadata:', error)
      }
    }

    fetchSchemaMetadata()
  }, [])

  // Load agent
  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login')
      return
    }

    // Only load once - prevent re-loading when tab switches trigger user object changes
    if (user && agentId && !hasLoadedAgent.current) {
      hasLoadedAgent.current = true
      loadAgent()
    }
  }, [user, authLoading, agentId])

  // Reload saved configuration when returning to setup after saving
  useEffect(() => {
    if (flowState === 'setup' && agent && hasParameterizedWorkflow) {
      // Only reload if we don't already have input values
      if (Object.keys(inputValues).length === 0) {
        console.log('[Sandbox] Returning to setup - reloading saved configuration...')
        loadSavedConfiguration(agent.id)
      }
    }
  }, [flowState, agent, hasParameterizedWorkflow])

  const loadSavedConfiguration = async (agentId: string) => {
    try {
      console.log('[Sandbox] Loading saved configuration for agent:', agentId)
      const response = await fetch(`/api/v2/calibrate/load-configuration?agentId=${agentId}`)

      if (!response.ok) {
        console.warn('[Sandbox] No saved configuration found (or error loading)')
        return
      }

      const result = await response.json()

      if (result.inputValues && Object.keys(result.inputValues).length > 0) {
        console.log('[Sandbox] Loaded saved configuration:', result.inputValues)
        setInputValues(result.inputValues)
        setConfigurationSaved(true) // Mark as already saved
      }
    } catch (error: any) {
      console.error('[Sandbox] Failed to load saved configuration:', error)
      // Non-critical error - just log it
    }
  }

  const loadAgent = async () => {
    try {
      setLoading(true)
      const { data, error: fetchError } = await supabase
        .from('agents')
        .select('*')
        .eq('id', agentId)
        .single()

      if (fetchError) throw fetchError
      if (!data) throw new Error('Agent not found')

      // Authorization check
      if (data.user_id !== user?.id) {
        throw new Error('You do not have permission to access this agent')
      }

      setAgent(data)

      // Load saved configuration (input values) for this agent
      await loadSavedConfiguration(agentId)

      // Check for latest calibration session to restore state after refresh
      await loadLatestSession(agentId)

      // If we're in success state after loading session, check for hardcoded values
      // This needs to happen after setAgent so the detector has access to pilot_steps
      if (data.pilot_steps && data.pilot_steps.length > 0) {
        const detector = new HardcodeDetector()

        // Extract resolved_user_inputs from enhanced_prompt if available
        let resolvedUserInputs: Array<{ key: string; value: any }> | undefined
        if (data.enhanced_prompt) {
          try {
            const enhancedPrompt = typeof data.enhanced_prompt === 'string'
              ? JSON.parse(data.enhanced_prompt)
              : data.enhanced_prompt
            resolvedUserInputs = enhancedPrompt?.specifics?.resolved_user_inputs
          } catch (e) {
            // If parsing fails, continue without resolved inputs
          }
        }

        const detection = detector.detect(data.pilot_steps, resolvedUserInputs)
        const totalDetected = (detection.resource_ids?.length || 0) +
                            (detection.business_logic?.length || 0) +
                            (detection.configuration?.length || 0)
        if (totalDetected > 0) {
          setDetectionResult(detection)
          setHasHardcodedValues(true)
        }
      }
    } catch (err: any) {
      console.error('Failed to load agent:', err)
      setError(err.message || 'Failed to load agent')
    } finally {
      setLoading(false)
    }
  }

  // Load latest calibration session for state restoration
  const loadLatestSession = async (agentId: string) => {
    // Skip restoration if user explicitly wants to start fresh
    if (startFresh) {
      console.log('[Calibration] Skipping session restoration - user requested fresh start')
      return
    }

    try {
      const { data: sessions, error: sessionError } = await supabase
        .from('calibration_sessions')
        .select('*')
        .eq('agent_id', agentId)
        .order('created_at', { ascending: false })
        .limit(1)

      if (sessionError) {
        console.warn('Failed to load calibration session:', sessionError)
        return
      }

      if (!sessions || sessions.length === 0) {
        return // No previous session, stay in setup
      }

      const latestSession = sessions[0]

      // Only restore if session is recent (within last 5 minutes)
      // This helps with accidental refreshes but not old sessions
      const sessionAge = Date.now() - new Date(latestSession.created_at).getTime()
      const fiveMinutes = 5 * 60 * 1000

      if (sessionAge > fiveMinutes) {
        console.log('[Calibration] Session too old, starting fresh')
        return // Session too old, start fresh
      }

      // IMPORTANT: Do NOT auto-restore completed sessions
      // If user comes back to calibration, they want to run a fresh test
      // They can use "Start New Calibration" button if they're on success page
      if (latestSession.status === 'completed') {
        console.log('[Calibration] Found completed session but NOT restoring - user wants fresh calibration')
        return // Don't restore, let them start fresh
      }

      // Restore based on session status
      if (latestSession.status === 'fixes_applied') {
        // Show fixes-applied screen (fixes were applied but not tested yet)
        setSession({
          id: latestSession.id,
          agentId: latestSession.agent_id,
          status: latestSession.status,
          executionId: latestSession.execution_id,
          totalSteps: latestSession.total_steps || 0,
          completedSteps: latestSession.completed_steps || 0,
          failedSteps: latestSession.failed_steps || 0,
          skippedSteps: latestSession.skipped_steps || 0
        })
        setFixesSummary(latestSession.applied_fixes || { parameters: 0, parameterizations: 0, autoRepairs: 0 })
        setFlowState('fixes-applied')
      } else if (latestSession.status === 'awaiting_fixes' && latestSession.issues) {
        // Show dashboard with issues
        setSession({
          id: latestSession.id,
          agentId: latestSession.agent_id,
          status: latestSession.status,
          executionId: latestSession.execution_id,
          totalSteps: latestSession.total_steps || 0,
          completedSteps: latestSession.completed_steps || 0,
          failedSteps: latestSession.failed_steps || 0,
          skippedSteps: latestSession.skipped_steps || 0
        })

        // Parse and categorize issues
        const allIssues = latestSession.issues || []
        const categorizedIssues: IssueGroups = {
          critical: allIssues.filter((i: any) => i.severity === 'critical'),
          warnings: allIssues.filter((i: any) => i.severity === 'medium' || i.severity === 'low'),
          autoRepairs: allIssues.filter((i: any) => i.autoRepair === true)
        }
        setIssues(categorizedIssues)
        setFlowState('dashboard')
      }
    } catch (err) {
      console.error('Error loading latest session:', err)
      // Silently fail and stay in setup
    }
  }

  // Run batch calibration
  const handleRunCalibration = async (inputValues: Record<string, any>) => {
    if (!agent) return

    try {
      setFlowState('running')
      setError(null)

      // Call batch calibration API
      const response = await fetch('/api/v2/calibrate/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: agent.id,
          inputValues
        })
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.message || 'Batch calibration failed')
      }

      // Store session and issues
      setSession({
        id: result.sessionId,
        agentId: agent.id,
        status: result.summary.total === 0 ? 'completed' : 'awaiting_fixes',
        executionId: result.executionId,
        totalSteps: result.summary.totalSteps,
        completedSteps: result.summary.completedSteps,
        failedSteps: result.summary.failedSteps,
        skippedSteps: result.summary.skippedSteps
      })

      setIssues(result.issues)

      // If no issues found, go straight to success (user will approve for production later)
      if (result.summary.total === 0) {
        console.log('[Calibration] No issues found - ready for user approval')

        // Check if workflow has hardcoded values to offer parameterization
        const hasHardcoded = await checkForHardcodedValues()
        setHasHardcodedValues(hasHardcoded)

        setFlowState('success')
        setFixesSummary({ parameters: 0, parameterizations: 0, autoRepairs: 0 })
      } else {
        setFlowState('dashboard')
      }

    } catch (err: any) {
      console.error('Batch calibration failed:', err)
      setError(err.message || 'Failed to run batch calibration')
      setFlowState('setup')
    }
  }

  // Apply fixes
  const handleApplyFixes = async () => {
    if (!session) return

    try {
      setIsApplying(true)
      setError(null)

      // Prepare fixes payload
      const parameterizationsArray = Object.entries(fixes.parameterizations || {})
        .map(([issueId, fix]) => ({
          issueId,
          approved: fix.approved,
          paramName: fix.paramName,
          defaultValue: fix.defaultValue
        }))
        .filter(fix => fix.approved)

      const autoRepairsArray = Object.entries(fixes.autoRepairs || {})
        .map(([issueId, fix]) => ({
          issueId,
          approved: fix.approved
        }))
        .filter(fix => fix.approved)

      const logicFixesArray = Object.entries(fixes.logicFixes || {})
        .map(([issueId, fix]) => ({
          issueId,
          selectedOption: fix.selectedOption,
          userInput: fix.userInput
        }))

      // Call apply-fixes API
      const response = await fetch('/api/v2/calibrate/apply-fixes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: session.id,
          parameters: fixes.parameters || {},
          parameterizations: parameterizationsArray,
          autoRepairs: autoRepairsArray,
          logicFixes: logicFixesArray
        })
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.message || 'Failed to apply fixes')
      }

      // Store summary for fixes-applied screen
      setFixesSummary(result.appliedFixes)

      // CRITICAL: Re-fetch the agent to get the updated input_schema
      // The apply-fixes API updated the agent's input_schema with unique parameter names
      console.log('[Apply Fixes] Re-fetching agent to get updated input_schema...')
      const { data: updatedAgent, error: refetchError } = await supabase
        .from('agents')
        .select('*')
        .eq('id', agent.id)
        .single()

      if (refetchError || !updatedAgent) {
        console.error('[Apply Fixes] Failed to re-fetch agent:', refetchError)
        throw new Error('Failed to load updated agent schema')
      }

      console.log('[Apply Fixes] Updated agent input_schema:', updatedAgent.input_schema)

      // Update agent state with the fresh data
      setAgent(updatedAgent)

      // Build input values from the UPDATED input_schema
      // This ensures we have all parameters with their unique names as set by the API
      const testInputValues: Record<string, any> = {}

      if (updatedAgent.input_schema && updatedAgent.input_schema.length > 0) {
        updatedAgent.input_schema.forEach((field: any) => {
          // Use placeholder as default value if available
          testInputValues[field.name] = field.placeholder || ''
          console.log('[Apply Fixes] Added param from schema:', field.name, '=', testInputValues[field.name])
        })
      }

      console.log('[Apply Fixes] Built test input values from updated schema:', testInputValues)

      // DON'T store placeholder values - keep inputValues empty for first-time parameterization
      // The user should enter their own values, not see pre-filled placeholders
      // Only setInputValues when loading from saved configuration (see loadConfiguration above)

      // Check if workflow has been parameterized (has input_schema)
      if (updatedAgent.input_schema && updatedAgent.input_schema.length > 0) {
        setHasParameterizedWorkflow(true)
        console.log('[Apply Fixes] Workflow has been parameterized with', updatedAgent.input_schema.length, 'parameters')
        // Reset configuration saved flag since we have new parameters
        setConfigurationSaved(false)
        // Clear any previously loaded input values since we have new parameters
        setInputValues({})
      }

      // Move to fixes-applied state (not success yet - need to test)
      setFlowState('fixes-applied')

    } catch (err: any) {
      console.error('Failed to apply fixes:', err)
      setError(err.message || 'Failed to apply fixes')
    } finally {
      setIsApplying(false)
    }
  }

  // Run test after fixes applied
  const handleRunTestAfterFixes = async (providedInputValues?: Record<string, any>) => {
    if (!agent) return

    try {
      setFlowState('testing')
      setError(null)

      // Use provided input values or fall back to stored input values
      const testInputValues = providedInputValues || inputValues

      // Run calibration again to verify fixes
      // Use the input values from parameterizations (default values)
      const response = await fetch('/api/v2/calibrate/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: agent.id,
          inputValues: testInputValues
        })
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.message || 'Test run failed')
      }

      // Check if all issues are resolved
      const totalIssues = result.summary.total || 0

      if (totalIssues === 0) {
        // All issues resolved - ready for user approval
        console.log('[Calibration] All issues resolved - ready for user approval')

        // Check if workflow has hardcoded values to offer parameterization
        const hasHardcoded = await checkForHardcodedValues()
        setHasHardcodedValues(hasHardcoded)

        // Update session and show success!
        setSession({
          id: result.sessionId,
          agentId: agent.id,
          status: 'completed',
          executionId: result.executionId,
          totalSteps: result.summary.totalSteps,
          completedSteps: result.summary.completedSteps,
          failedSteps: result.summary.failedSteps,
          skippedSteps: result.summary.skippedSteps
        })
        setFlowState('success')
      } else {
        // Still have issues - back to dashboard with clear message
        setSession({
          id: result.sessionId,
          agentId: agent.id,
          status: 'awaiting_fixes',
          executionId: result.executionId,
          totalSteps: result.summary.totalSteps,
          completedSteps: result.summary.completedSteps,
          failedSteps: result.summary.failedSteps,
          skippedSteps: result.summary.skippedSteps
        })
        setIssues(result.issues)
        setFlowState('dashboard')

        // Clear, helpful message about what to do next
        const issueWord = totalIssues === 1 ? 'issue' : 'issues'
        setError(`Test revealed ${totalIssues} ${issueWord}. Some issues may have been hidden by the fixes you just applied. Review and fix the remaining ${issueWord}.`)
      }

    } catch (err: any) {
      console.error('Test run failed:', err)
      setError(err.message || 'Failed to run test')
      setFlowState('fixes-applied')
    }
  }

  // Check for hardcoded values in workflow using the HardcodeDetector
  const checkForHardcodedValues = async (): Promise<boolean> => {
    try {
      if (!agent?.pilot_steps || agent.pilot_steps.length === 0) {
        return false
      }

      // Use HardcodeDetector directly on the client side
      const detector = new HardcodeDetector()
      const detection = detector.detect(agent.pilot_steps)

      const totalDetected = (detection.resource_ids?.length || 0) +
                          (detection.business_logic?.length || 0) +
                          (detection.configuration?.length || 0)

      if (totalDetected > 0) {
        setDetectionResult(detection)
        return true
      }

      return false
    } catch (err) {
      console.error('Failed to check for hardcoded values:', err)
      return false
    }
  }

  // Navigate to agent page
  const handleRunAgent = () => {
    // Set flag to show tour on agent page
    if (typeof window !== 'undefined') {
      console.log('[Calibration] Setting calibration-completed flag for agent:', agentId)
      localStorage.setItem(`calibration-completed-${agentId}`, 'true')
      console.log('[Calibration] Flag set, value:', localStorage.getItem(`calibration-completed-${agentId}`))
    }
    router.push(`/v2/agents/${agentId}`)
  }

  // User declined parameterization - show approve button
  const handleDeclineParameterization = () => {
    console.log('[Calibration] User declined parameterization')
    setUserDeclinedParameterization(true)
  }

  // Open parameterization wizard
  const handleParameterizeWorkflow = () => {
    console.log('[Calibration] Opening parameterization wizard')
    setShowParameterizationWizard(true)
  }

  // Approve agent for production
  const handleApproveForProduction = async () => {
    if (!agent) return

    try {
      console.log('[Calibration] Approving agent for production')

      // Set production_ready=true
      const { data: updateData, error: updateError } = await supabase
        .from('agents')
        .update({ production_ready: true })
        .eq('id', agent.id)
        .eq('user_id', agent.user_id)
        .select()

      if (updateError) {
        console.error('[Calibration] Failed to update production_ready:', updateError)
        alert('Failed to approve agent for production')
        return
      }

      console.log('[Calibration] Successfully approved agent:', updateData)

      // Set flag to show tour on agent page
      if (typeof window !== 'undefined') {
        console.log('[Calibration] Setting calibration-completed flag for agent:', agentId)
        localStorage.setItem(`calibration-completed-${agentId}`, 'true')

        // CRITICAL: Clear any previous tour dismissal so the tour can show again
        localStorage.removeItem(`tour-dismissed-${agentId}`)
        console.log('[Calibration] Cleared tour-dismissed flag to allow tour to show')

        // Verify it was set
        const verifyFlag = localStorage.getItem(`calibration-completed-${agentId}`)
        console.log('[Calibration] Verified localStorage flag:', verifyFlag)
      }

      // Small delay to ensure localStorage is written
      await new Promise(resolve => setTimeout(resolve, 100))

      // Navigate to agent page
      console.log('[Calibration] Navigating to agent page:', `/v2/agents/${agentId}`)
      router.push(`/v2/agents/${agentId}`)
    } catch (err) {
      console.error('[Calibration] Error approving agent:', err)
      alert('Failed to approve agent for production')
    }
  }

  // Handle wizard completion
  const handleWizardComplete = async (selectedParams: string[], makeConfigurable: boolean) => {
    setShowParameterizationWizard(false)

    if (makeConfigurable && selectedParams.length > 0 && detectionResult) {
      try {
        // Flatten all detected values
        const allDetected = [
          ...detectionResult.resource_ids,
          ...detectionResult.business_logic,
          ...detectionResult.configuration,
        ]

        // Filter to only the selected paths and build repair selections
        const selections = allDetected
          .filter(d => selectedParams.includes(d.path))
          .map(d => ({
            path: d.path,
            param_name: d.suggested_param,
            value: d.value,
            original_value: d.value,
          }))

        if (selections.length === 0) {
          console.error('[Calibration] No valid selections found')
          router.push(`/v2/agents/${agentId}`)
          return
        }

        console.log('[Calibration] Parameterizing workflow with selections:', selections)

        // Call the repair-hardcode API
        const response = await fetch(`/api/agents/${agentId}/repair-hardcode`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ selections }),
        })

        if (!response.ok) {
          const error = await response.json()
          console.error('[Calibration] Failed to parameterize:', error)
          throw new Error(error.error || 'Failed to parameterize workflow')
        }

        const result = await response.json()
        console.log('[Calibration] Parameterization successful:', result)

        // After parameterization, mark as declined so we show the approve button
        setUserDeclinedParameterization(true)
        // Reload agent to get updated workflow
        await loadAgent()
      } catch (error) {
        console.error('[Calibration] Parameterization error:', error)
        setUserDeclinedParameterization(true)
      }
    } else {
      // User skipped - just mark as declined
      setUserDeclinedParameterization(true)
    }
  }

  // Handle wizard skip - just close wizard and stay on success page
  const handleWizardSkip = () => {
    setShowParameterizationWizard(false)
    // Stay on the success page - don't navigate away
  }

  const handleSaveConfiguration = async (valuesToSave?: Record<string, any>) => {
    // Use valuesToSave if provided (from FixesApplied), otherwise fall back to parent's inputValues
    const values = valuesToSave || inputValues

    if (!agent?.id) {
      console.warn('[Sandbox] Cannot save configuration: missing agent ID')
      throw new Error('Missing agent ID')
    }

    if (Object.keys(values).length === 0) {
      console.warn('[Sandbox] Cannot save configuration: no input values provided')
      throw new Error('No input values to save')
    }

    console.log('[Sandbox] Saving configuration:', {
      agentId: agent.id,
      inputValuesCount: Object.keys(values).length,
      inputValues: values
    })

    try {
      const response = await fetch('/api/v2/calibrate/save-configuration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: agent.id,
          inputValues: values,
          inputSchema: agent.input_schema || null
        })
      })

      if (!response.ok) {
        const errorData = await response.json()
        console.error('[Sandbox] Save configuration API error:', errorData)
        throw new Error(errorData.message || 'Failed to save configuration')
      }

      const result = await response.json()
      console.log('[Sandbox] Configuration saved successfully:', result.configId)

      // Update parent's inputValues state with the saved values
      setInputValues(values)
      setConfigurationSaved(true)

      // Show success toast/notification
      // TODO: Add toast notification here
    } catch (error: any) {
      console.error('[Sandbox] Failed to save configuration:', error)
      // Re-throw error so FixesApplied component can show it
      throw error
    }
  }

  // Loading states
  if (authLoading || loading) {
    return <PageLoading />
  }

  if (error && !agent) {
    return (
      <div className="min-h-screen bg-[var(--v2-bg)] flex items-center justify-center p-4">
        <div className="text-center max-w-md">
          <p className="text-sm sm:text-base text-red-600 dark:text-red-400 mb-4">{error}</p>
          <button
            onClick={() => router.back()}
            className="text-sm sm:text-base text-[var(--v2-primary)] hover:text-[var(--v2-primary-dark)] font-medium transition-colors"
          >
            Go Back
          </button>
        </div>
      </div>
    )
  }

  if (!agent) {
    return <PageLoading />
  }

  return (
    <div className="bg-[var(--v2-bg)] min-h-screen">
      <div className="container mx-auto px-4 py-6 max-w-7xl">
        <div className="space-y-4 sm:space-y-5 lg:space-y-6 pb-12">

          {/* Logo - First Line */}
          <div className="mb-3">
            <V2Logo />
          </div>

          {/* Back Button + Controls */}
          <div className="flex items-center justify-between">
            <button
              onClick={() => router.push(`/v2/agents/${agentId}`)}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] hover:scale-105 transition-all duration-200 text-sm font-medium shadow-[var(--v2-shadow-card)]"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Agent
            </button>
            <V2Controls />
          </div>

          {/* Error Alert */}
          {error && (
            <div className="mb-4 sm:mb-5 lg:mb-6 p-3 sm:p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <p className="text-sm text-red-900 dark:text-red-200">{error}</p>
            </div>
          )}

          {/* Flow States */}
          {flowState === 'setup' && (
            <CalibrationSetup
              agent={agent}
              onRun={handleRunCalibration}
              isRunning={false}
              initialInputValues={inputValues}
            />
          )}

          {flowState === 'running' && (
            <div className="flex flex-col items-center justify-center py-12 sm:py-16 lg:py-20">
              <Loader2 className="w-12 h-12 sm:w-14 sm:h-14 lg:w-16 lg:h-16 text-[var(--v2-primary)] animate-spin mb-3 sm:mb-4" />
              <h2 className="text-xl sm:text-2xl font-semibold text-[var(--v2-text-primary)] mb-1 sm:mb-2">
                Checking Your Workflow
              </h2>
              <p className="text-sm sm:text-base text-[var(--v2-text-secondary)]">
                Looking for improvements...
              </p>
            </div>
          )}

          {flowState === 'dashboard' && session && issues && (
            <CalibrationDashboard
              session={session}
              issues={issues}
              fixes={fixes}
              onFixesChange={setFixes}
              onApplyFixes={handleApplyFixes}
              isApplying={isApplying}
              onBackToCalibration={() => setFlowState('setup')}
            />
          )}

          {flowState === 'fixes-applied' && fixesSummary && (
            <FixesApplied
              agent={agent}
              fixesSummary={fixesSummary}
              onRunTest={handleRunTestAfterFixes}
              onBackToDashboard={() => setFlowState('dashboard')}
              isRunning={false}
              initialInputValues={inputValues}
              schemaMetadata={schemaMetadata}
              configurationSaved={configurationSaved}
              onSaveConfiguration={handleSaveConfiguration}
              onConfigurationChanged={() => setConfigurationSaved(false)}
              parameterErrorFields={issues?.critical
                ?.filter(issue => issue.category === 'parameter_error')
                ?.map(issue => issue.suggestedFix?.action?.parameterName)
                ?.filter(Boolean) || []}
            />
          )}

          {flowState === 'testing' && (
            <div className="flex flex-col items-center justify-center py-12 sm:py-16 lg:py-20">
              <Loader2 className="w-12 h-12 sm:w-14 sm:h-14 lg:w-16 lg:h-16 text-[var(--v2-primary)] animate-spin mb-3 sm:mb-4" />
              <h2 className="text-xl sm:text-2xl font-semibold text-[var(--v2-text-primary)] mb-1 sm:mb-2">
                Testing Fixes
              </h2>
              <p className="text-sm sm:text-base text-[var(--v2-text-secondary)]">
                Running workflow to verify all issues are resolved...
              </p>
            </div>
          )}

          {flowState === 'success' && (
            <CalibrationSuccess
              agent={agent}
              fixesSummary={fixesSummary}
              onRunAgent={handleRunAgent}
              onParameterizeWorkflow={hasHardcodedValues ? handleParameterizeWorkflow : undefined}
              onApproveForProduction={handleApproveForProduction}
              hasHardcodedValues={hasHardcodedValues}
              userDeclinedParameterization={userDeclinedParameterization}
              onDeclineParameterization={handleDeclineParameterization}
              calibrationInputValues={inputValues}
              hasParameterizedWorkflow={hasParameterizedWorkflow}
              configurationSaved={configurationSaved}
              onSaveConfiguration={handleSaveConfiguration}
            />
          )}

        </div>
      </div>

      {/* HelpBot */}
      <HelpBot />

      {/* Parameterization Wizard */}
      {showParameterizationWizard && agent && detectionResult && (
        <AgentSetupWizard
          agentName={agent.agent_name}
          detectionResult={detectionResult}
          existingInputValues={{}}
          inputSchema={agent.input_parameters || []}
          onComplete={handleWizardComplete}
          onSkip={handleWizardSkip}
          isOpen={showParameterizationWizard}
        />
      )}
    </div>
  )
}
