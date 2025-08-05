import { CheckCircle, AlertCircle, TrendingUp } from 'lucide-react'
import { WorkflowStep } from '../../types/workflow'

interface WorkflowProgressProps {
  steps: WorkflowStep[]
  variant?: 'build' | 'connect' | 'configure' | 'test'
}

export const WorkflowProgress = ({ steps, variant = 'build' }: WorkflowProgressProps) => {
  const configuredStepsCount = steps.filter((s) => !!s.selectedAgent && s.configurationComplete).length
  const hasAgentCount = steps.filter((s) => !!s.selectedAgent).length
  const remainingStepsCount = steps.length - hasAgentCount
  const needsConfigCount = hasAgentCount - configuredStepsCount
  const isReadyForNext = steps.length > 0 && remainingStepsCount === 0

  if (variant === 'build') {
    return (
      <div className="mb-6 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl border border-blue-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-900">{steps.length}</div>
              <div className="text-xs text-blue-700">Steps</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-yellow-600">{hasAgentCount}</div>
              <div className="text-xs text-yellow-700">Assigned</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">{configuredStepsCount}</div>
              <div className="text-xs text-green-700">Configured</div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-lg font-bold text-slate-900 mb-1">
              {steps.length > 0 ? Math.round((hasAgentCount / steps.length) * 100) : 0}% Assigned
            </div>
            <div className="w-40 h-3 bg-slate-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-blue-500 to-green-500 transition-all duration-500"
                style={{
                  width: `${steps.length > 0 ? (hasAgentCount / steps.length) * 100 : 0}%`,
                }}
              />
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (variant === 'connect') {
    return (
      <div className="mb-6 p-4 bg-gradient-to-r from-green-50 to-emerald-50 rounded-xl border border-green-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div className="text-center">
              <div className="text-2xl font-bold text-green-900">0</div>
              <div className="text-xs text-green-700">Connections</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-900">{steps.length - 1}</div>
              <div className="text-xs text-blue-700">Possible Links</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-900">0%</div>
              <div className="text-xs text-purple-700">Connected</div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-lg font-bold text-slate-900 mb-1">Data Flow Status</div>
            <div className="w-40 h-3 bg-slate-200 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-green-500 to-blue-500 transition-all duration-500 w-0" />
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-lg border border-white/40 p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-8 h-8 bg-gradient-to-r from-green-500 to-emerald-600 rounded-lg flex items-center justify-center">
          <TrendingUp className="h-4 w-4 text-white" />
        </div>
        <h3 className="font-bold text-slate-900">Build Progress</h3>
      </div>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-600">Workflow Steps</span>
          <span className="font-semibold text-slate-900">{steps.length}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-600">Agents Assigned</span>
          <span className="font-semibold text-yellow-600">{hasAgentCount}</span>
        </div>
        
        {isReadyForNext ? (
          <div className="mt-4 p-3 bg-green-50 rounded-lg border border-green-200">
            <div className="flex items-center gap-2 text-green-800">
              <CheckCircle className="h-4 w-4" />
              <span className="text-sm font-medium">Ready for next phase!</span>
            </div>
            <p className="text-xs text-green-700 mt-1">
              All agents assigned - time to connect data flow
            </p>
          </div>
        ) : (
          <div className="mt-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
            <div className="flex items-center gap-2 text-blue-800">
              <AlertCircle className="h-4 w-4" />
              <span className="text-sm font-medium">Next Steps:</span>
            </div>
            <ul className="text-xs text-blue-700 mt-2 space-y-1">
              {remainingStepsCount > 0 && (
                <li>• Assign agents to {remainingStepsCount} steps</li>
              )}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}