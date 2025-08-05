import { Plus, Bot, AlertCircle } from 'lucide-react'
import { WorkflowStep, Connection, Phase } from '../types/workflow'
import { AgentLibraryItem } from '../types/agents'
import { WorkflowStep as WorkflowStepComponent } from '../components/workflow/WorkflowStep'
import { DroppableStep } from '../components/workflow/DroppableStep'
import { WorkflowProgress } from '../components/workflow/WorkflowProgress'
import { AgentLibrary } from '../components/agents/AgentLibrary'
import { AgentRecommendations } from '../components/agents/AgentRecommendations'

interface BuildWorkflowPhaseProps {
  steps: WorkflowStep[]
  connections: Connection[]
  selectedStep: number | null
  aiGeneratedAgents: AgentLibraryItem[]
  smartAgentLibrary: AgentLibraryItem[]
  workflowDescription: string
  onUpdateStep: (index: number, updates: Partial<WorkflowStep>) => void
  onAddStep: () => void
  onRemoveStep: (index: number) => void
  onSelectStep: (index: number | null) => void
  onTestStep: (index: number) => void
  onAgentAssignment: (agent: AgentLibraryItem, stepIndex?: number) => void
  onPhaseChange: (phase: Phase) => void
  onBack: () => void
}

export const BuildWorkflowPhase = ({
  steps,
  connections,
  selectedStep,
  aiGeneratedAgents,
  smartAgentLibrary,
  workflowDescription,
  onUpdateStep,
  onAddStep,
  onRemoveStep,
  onSelectStep,
  onTestStep,
  onAgentAssignment,
  onPhaseChange,
  onBack
}: BuildWorkflowPhaseProps) => {
  // Calculate progress
  const hasAgentCount = steps.filter((s) => !!s.selectedAgent).length
  const remainingStepsCount = steps.length - hasAgentCount
  const isReadyForNext = steps.length > 0 && remainingStepsCount === 0

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
      {/* Main Content */}
      <div className="lg:col-span-3 space-y-6">
        <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-lg border border-white/40 p-8">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-r from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center">
                <Bot className="h-5 w-5 text-white" />
              </div>
              <div>
                <h3 className="text-xl font-semibold text-slate-900">
                  Phase 1: Build Your Workflow
                </h3>
                <p className="text-slate-600">Assign agents to automate each step</p>
              </div>
            </div>
          </div>

          {/* Progress Summary */}
          <WorkflowProgress steps={steps} variant="build" />

          {/* Workflow Steps */}
          <div className="space-y-6">
            {steps.map((step, index) => (
              <DroppableStep
                key={step.id}
                step={step}
                index={index}
                onAgentDrop={onAgentAssignment}
              >
                <WorkflowStepComponent
                  step={step}
                  index={index}
                  isSelected={selectedStep === index}
                  onSelect={() => onSelectStep(selectedStep === index ? null : index)}
                  onUpdate={(updates) => onUpdateStep(index, updates)}
                  onRemove={() => onRemoveStep(index)}
                  onTest={() => onTestStep(index)}
                  totalSteps={steps.length}
                  nextStep={steps[index + 1]}
                  connections={connections}
                />
              </DroppableStep>
            ))}

            <div className="text-center pt-6">
              <button
                onClick={onAddStep}
                className="inline-flex items-center gap-3 px-6 py-3 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white rounded-xl font-semibold transition-all duration-200 transform hover:scale-105"
              >
                <Plus className="h-5 w-5" />
                Add Another Step
              </button>
            </div>
          </div>

          {/* Navigation */}
          <div className="flex justify-between mt-8 pt-6 border-t border-slate-200">
            <button
              onClick={onBack}
              className="px-6 py-3 border border-slate-300 text-slate-700 rounded-xl hover:bg-slate-50 transition-colors"
            >
              ← Previous
            </button>
            <button
              onClick={() => onPhaseChange('connect')}
              disabled={!isReadyForNext}
              className="px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 disabled:from-slate-400 disabled:to-slate-500 text-white rounded-xl font-semibold transition-all disabled:cursor-not-allowed"
            >
              {!isReadyForNext ? `Assign ${remainingStepsCount} More Agents` : 'Next: Connect Data →'}
            </button>
          </div>
        </div>
      </div>

      {/* Sidebar */}
      <div className="space-y-6">
        {/* AI-Generated Recommended Agents */}
        <AgentRecommendations
          workflowDescription={workflowDescription}
          recommendedAgents={aiGeneratedAgents}
          onAssignAgent={(agent) => onAgentAssignment(agent)}
        />

        {/* Smart Agents */}
        <AgentLibrary
          title="Smart Agents"
          description="Advanced configurable agents with full customization"
          agents={smartAgentLibrary}
          onAssignAgent={(agent) => onAgentAssignment(agent)}
        />

        {/* Progress Summary */}
        <WorkflowProgress steps={steps} />
      </div>
    </div>
  )
}