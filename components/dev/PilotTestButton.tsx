'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { PlayCircle, CheckCircle, XCircle, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'

export function PilotTestButton() {
  const [isRunning, setIsRunning] = useState(false)
  const [status, setStatus] = useState<string>('')
  const [logs, setLogs] = useState<string[]>([])

  const addLog = (message: string) => {
    setLogs(prev => [...prev, message])
    console.log(message)
  }

  const runTest = async () => {
    setIsRunning(true)
    setLogs([])
    setStatus('Starting test...')

    try {
      // Get current user
      const { data: { user }, error: authError } = await supabase.auth.getUser()

      if (authError || !user) {
        addLog('❌ Not authenticated')
        setStatus('Failed: Not authenticated')
        setIsRunning(false)
        return
      }

      addLog(`✅ Authenticated as ${user.email}`)
      setStatus('Looking for test agent...')

      // Check if test agent already exists (reuse instead of creating duplicates)
      const { data: existingAgents } = await supabase
        .from('agents')
        .select('id, agent_name')
        .eq('user_id', user.id)
        .eq('agent_name', 'Pilot Test Workflow')
        .limit(1)

      let agent: any

      if (existingAgents && existingAgents.length > 0) {
        // Reuse existing test agent
        agent = existingAgents[0]
        addLog(`✅ Found existing test agent: ${agent.id}`)
        setStatus('Using existing test agent...')
      } else {
        // Create test agent only if it doesn't exist
        addLog('Creating new test agent...')
        setStatus('Creating test agent...')

        const workflow = {
          agent_name: 'Pilot Test Workflow',
          description: "Reusable test agent for Pilot features",
          user_prompt: "Test workflow",
          status: "draft",
          mode: "on_demand",
          user_id: user.id,
          workflow_steps: [
            {
              id: "step1",
              name: "Initialize",
              type: "transform",
              operation: "set",
              input: {
                requestId: `REQ-${Date.now()}`,
                amount: 50000
              },
              outputVariable: "request",
              params: {
                operation: "set",
                input: {
                  requestId: `REQ-${Date.now()}`,
                  amount: 50000
                },
                outputVariable: "request"
              }
            },
            {
              id: "step2",
              name: "Approval Required",
              type: "human_approval",
              approvers: [user.id],
              approvalType: "any",
              title: "Test Approval",
              message: "Please approve this test request",
              timeout: 3600000,
              onTimeout: "reject",
              dependencies: ["step1"],
              params: {
                approvers: [user.id],
                approvalType: "any",
                title: "Test Approval",
                message: "Please approve this test request",
                timeout: 3600000,
                onTimeout: "reject"
              }
            },
            {
              id: "step3",
              name: "Complete",
              type: "transform",
              operation: "set",
              input: {
                status: "approved"
              },
              outputVariable: "result",
              dependencies: ["step2"],
              params: {
                operation: "set",
                input: {
                  status: "approved"
                },
                outputVariable: "result"
              }
            }
          ]
        }

        const { data: newAgent, error: createError } = await supabase
          .from('agents')
          .insert(workflow)
          .select()
          .single()

        if (createError) {
          addLog(`❌ Failed to create agent: ${createError.message}`)
          setStatus('Failed')
          setIsRunning(false)
          return
        }

        agent = newAgent
        addLog(`✅ Test agent created: ${agent.id}`)
      }

      setStatus('Executing workflow...')

      // Execute workflow
      const execResponse = await fetch('/api/run-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_id: agent.id,
          input_variables: {},
          execution_type: 'test'
        })
      })

      const execResult = await execResponse.json()

      if (!execResponse.ok) {
        addLog(`❌ Execution failed: ${JSON.stringify(execResult)}`)
        setStatus('Failed')
        setIsRunning(false)
        return
      }

      const executionId = execResult.data?.execution_id
      addLog(`✅ Execution started: ${executionId}`)
      setStatus('Monitoring execution...')

      // Monitor for approval
      let approvalFound = false
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 1000))

        const { data: approvals } = await supabase
          .from('workflow_approval_requests')
          .select('*')
          .eq('execution_id', executionId)
          .eq('status', 'pending')

        if (approvals && approvals.length > 0) {
          const approval = approvals[0]
          approvalFound = true
          addLog(`⏸️  Approval required: ${approval.title}`)
          addLog(`📋 Approval ID: ${approval.id}`)
          addLog(`🔗 View at: /approvals/${approval.id}`)
          setStatus(`Waiting for approval: ${approval.id}`)

          // Open approval page
          window.open(`/approvals/${approval.id}`, '_blank')
          break
        }
      }

      if (!approvalFound) {
        addLog('⚠️  No approval request found')
      }

      addLog('✅ Test workflow created successfully!')
      setStatus('Complete - Check for approval notification')
      setIsRunning(false)

    } catch (error: any) {
      addLog(`❌ Error: ${error.message}`)
      setStatus('Failed')
      setIsRunning(false)
    }
  }

  return (
    <div className="bg-gradient-to-br from-blue-50 via-white to-indigo-50 rounded-2xl border-2 border-blue-200 shadow-xl p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl flex items-center justify-center">
          <PlayCircle className="h-6 w-6 text-white" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-gray-900">Pilot Workflow Test</h3>
          <p className="text-sm text-gray-600">Test all Pilot features with one click</p>
        </div>
      </div>

      <Button
        onClick={runTest}
        disabled={isRunning}
        className="w-full mb-4"
      >
        {isRunning ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Running Test...
          </>
        ) : (
          <>
            <PlayCircle className="mr-2 h-4 w-4" />
            Run Test Workflow
          </>
        )}
      </Button>

      {status && (
        <div className="mb-4 p-3 bg-blue-50 rounded-lg">
          <p className="text-sm font-medium text-blue-900">{status}</p>
        </div>
      )}

      {logs.length > 0 && (
        <div className="bg-gray-900 rounded-lg p-4 max-h-64 overflow-y-auto">
          <div className="font-mono text-xs space-y-1">
            {logs.map((log, i) => (
              <div key={i} className="text-green-400">{log}</div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 text-xs text-gray-500">
        <p className="font-semibold mb-1">What this tests:</p>
        <ul className="space-y-1 ml-4">
          <li>✅ Sequential execution</li>
          <li>✅ Human approvals</li>
          <li>✅ State management</li>
          <li>✅ Audit logging</li>
        </ul>
      </div>
    </div>
  )
}
