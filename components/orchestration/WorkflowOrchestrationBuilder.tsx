'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Workflow, MessageSquare, Bot, Zap, CheckCircle } from 'lucide-react'
import { ProcessDescriptionPhase } from './phases/ProcessDescriptionPhase'
import { AgentBuildingPhase } from './phases/AgentBuildingPhase'
import DataConnectionPhase  from './phases/DataConnectionPhase'
import { WorkflowData, WorkflowPhase } from './types/workflow'

// 1. Add your mock workflows here (replace with real fetch as needed)
const mockWorkflows: WorkflowData[] = [
  {
    id: 'wf-1',
    title: 'Customer Data Pipeline',
    description: 'Automated pipeline for processing and enriching customer data from multiple sources',
    industry: 'Retail',
    processDescription: 'Automates customer data ETL',
    generatedSteps: [],
    finalSteps: [],
    triggerType: 'manual'
  },
  {
    id: 'wf-4',
    title: 'Email Campaign Automation',
    description: 'Personalized email campaign workflow with A/B testing and performance tracking',
    industry: 'Marketing',
    processDescription: 'Automates email campaigns',
    generatedSteps: [],
    finalSteps: [],
    triggerType: 'manual'
  }
]

export default function WorkflowOrchestrationBuilder() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const viewId = searchParams.get('view')
  const editId = searchParams.get('edit')
  const orchestrationId = viewId || editId

  // 2. Start with empty/default state
  const [currentPhase, setCurrentPhase] = useState<WorkflowPhase>('describe')
  const [workflowData, setWorkflowData] = useState<WorkflowData>({
    title: '',
    description: '',
    industry: '',
    processDescription: '',
    generatedSteps: [],
    finalSteps: [],
    triggerType: 'manual'
  })

  // 3. If a view/edit param is found, load that workflow
  useEffect(() => {
    if (orchestrationId) {
      const found = mockWorkflows.find(wf => wf.id === orchestrationId)
      if (found) setWorkflowData(found)
    }
  }, [orchestrationId])

  const phases = [
    { id: 'describe' as WorkflowPhase, title: 'Describe Process', icon: MessageSquare, color: 'from-green-500 to-emerald-600' },
    { id: 'build' as WorkflowPhase, title: 'Build Agents', icon: Bot, color: 'from-blue-500 to-indigo-600' },
    { id: 'connect' as WorkflowPhase, title: 'Connect Data', icon: Zap, color: 'from-purple-500 to-pink-600' }
  ]

  const updateWorkflowData = (updates: Partial<WorkflowData>) => {
    setWorkflowData(prev => ({ ...prev, ...updates }))
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      <div className="max-w-7xl mx-auto px-4 py-12">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-r from-blue-500 to-indigo-600 rounded-2xl mb-6 shadow-xl">
            <Workflow className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-4xl font-bold bg-gradient-to-r from-slate-800 to-blue-800 bg-clip-text text-transparent mb-4">
            Business Process Orchestrator
          </h1>
          <p className="text-lg text-slate-600 max-w-3xl mx-auto">
            Transform your business processes into intelligent, automated workflows in minutes
          </p>
        </div>

        {/* Phase Progress */}
        <div className="mb-12">
          <div className="flex items-center justify-center gap-8 mb-8">
            {phases.map((phase, index) => {
              const isActive = currentPhase === phase.id
              const isCompleted = phases.findIndex(p => p.id === currentPhase) > index
              const PhaseIcon = phase.icon

              return (
                <div key={phase.id} className="flex items-center">
                  <div className="flex flex-col items-center">
                    <div className={`w-16 h-16 rounded-2xl flex items-center justify-center transition-all duration-300 ${
                      isCompleted 
                        ? 'bg-green-500 shadow-lg' 
                        : isActive 
                        ? `bg-gradient-to-r ${phase.color} shadow-xl scale-110` 
                        : 'bg-slate-200'
                    }`}>
                      {isCompleted ? (
                        <CheckCircle className="h-8 w-8 text-white" />
                      ) : (
                        <PhaseIcon className={`h-8 w-8 ${isActive ? 'text-white' : 'text-slate-500'}`} />
                      )}
                    </div>
                    <div className="mt-3 text-center">
                      <p className={`font-semibold ${isActive ? 'text-blue-600' : isCompleted ? 'text-green-600' : 'text-slate-500'}`}>
                        {phase.title}
                      </p>
                    </div>
                  </div>
                  
                  {index < phases.length - 1 && (
                    <div className={`w-24 h-1 mx-4 rounded-full ${
                      isCompleted ? 'bg-green-500' : 'bg-slate-200'
                    }`} />
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Phase Content */}
        {currentPhase === 'describe' && (
          <ProcessDescriptionPhase 
            data={workflowData} 
            onUpdate={updateWorkflowData}
            onNext={() => setCurrentPhase('build')}
          />
        )}

        {currentPhase === 'build' && (
          <AgentBuildingPhase 
            data={workflowData} 
            onUpdate={updateWorkflowData}
            onNext={() => setCurrentPhase('connect')}
            onBack={() => setCurrentPhase('describe')}
          />
        )}

        {currentPhase === 'connect' && (
          <DataConnectionPhase 
            data={workflowData} 
            onUpdate={updateWorkflowData}
            onBack={() => setCurrentPhase('build')}
            onSave={() => router.push('/workflows')}
          />
        )}
      </div>
    </div>
  )
}