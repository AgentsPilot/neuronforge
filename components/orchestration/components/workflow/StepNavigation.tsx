import { ArrowRight, CheckCircle } from 'lucide-react'
import { Phase } from '../../types/workflow'
import { phases } from '../../constants/phases'

interface StepNavigationProps {
  currentPhase: Phase
  onPhaseChange: (phase: Phase) => void
  onBack?: () => void
}

export const StepNavigation = ({ currentPhase, onPhaseChange, onBack }: StepNavigationProps) => {
  const currentPhaseIndex = phases.findIndex(p => p.id === currentPhase)

  return (
    <div className="mb-8 bg-white/70 backdrop-blur-sm rounded-2xl shadow-lg border border-white/40 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold text-slate-900">Workflow Configuration</h2>
        {onBack && (
          <button
            onClick={onBack}
            className="px-4 py-2 text-slate-600 hover:text-slate-800 transition-colors"
          >
            ← Back
          </button>
        )}
      </div>
      
      <div className="flex items-center justify-between">
        {phases.map((phase, idx) => (
          <div key={phase.id} className="flex items-center">
            <button
              onClick={() => onPhaseChange(phase.id)}
              className={`flex items-center gap-3 px-4 py-2 rounded-lg transition-all ${
                currentPhase === phase.id ? 'bg-purple-100 text-purple-900' :
                idx < currentPhaseIndex ? 'bg-green-100 text-green-900' :
                'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ${
                currentPhase === phase.id ? 'bg-purple-200' :
                idx < currentPhaseIndex ? 'bg-green-200' : 'bg-slate-200'
              }`}>
                {idx < currentPhaseIndex ? <CheckCircle className="h-4 w-4" /> : idx + 1}
              </div>
              <div>
                <div className="font-medium">{phase.name}</div>
                <div className="text-xs opacity-75">{phase.description}</div>
              </div>
            </button>
            {idx < phases.length - 1 && (
              <ArrowRight className="h-4 w-4 text-slate-400 mx-2" />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}