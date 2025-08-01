// phases/ProcessDescriptionPhase.tsx

import { useState } from 'react'
import { FileText, Library, Wand2, Sparkles, ArrowDown } from 'lucide-react'
import { WorkflowData, WorkflowStep, IndustryTemplate } from '../types/workflow'

interface ProcessDescriptionPhaseProps {
  data: WorkflowData
  onUpdate: (updates: Partial<WorkflowData>) => void
  onNext: () => void
}

export const ProcessDescriptionPhase = ({ data, onUpdate, onNext }: ProcessDescriptionPhaseProps) => {
  const [isGenerating, setIsGenerating] = useState(false)
  
  const industryTemplates: IndustryTemplate[] = [
    { 
      name: 'Accounting & Finance', 
      icon: '💰', 
      processes: ['Invoice Processing', 'Expense Approval', 'Financial Reporting'],
      description: 'Automate financial workflows and approvals'
    },
    { 
      name: 'Customer Service', 
      icon: '🎧', 
      processes: ['Ticket Resolution', 'Customer Onboarding', 'Feedback Processing'],
      description: 'Streamline customer support operations'
    },
    { 
      name: 'Human Resources', 
      icon: '👥', 
      processes: ['Employee Onboarding', 'Leave Requests', 'Performance Reviews'],
      description: 'Optimize HR processes and employee management'
    },
    { 
      name: 'Sales & Marketing', 
      icon: '📈', 
      processes: ['Lead Qualification', 'Campaign Management', 'Contract Generation'],
      description: 'Accelerate sales cycles and marketing campaigns'
    },
    { 
      name: 'Operations', 
      icon: '⚙️', 
      processes: ['Order Fulfillment', 'Inventory Management', 'Quality Control'],
      description: 'Enhance operational efficiency and control'
    },
    { 
      name: 'Legal & Compliance', 
      icon: '⚖️', 
      processes: ['Contract Review', 'Compliance Monitoring', 'Risk Assessment'],
      description: 'Ensure compliance and reduce legal risks'
    }
  ]

  // 🧠 Updated to call your backend API
  const generateSteps = async () => {
    if (!data.processDescription.trim()) return
    
    setIsGenerating(true)
    
    try {
      const res = await fetch('/api/orchestration/generate-steps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ processDescription: data.processDescription })
      })
      if (!res.ok) {
        throw new Error(`Failed to generate steps: ${await res.text()}`)
      }
      const { steps } = await res.json()
      onUpdate({ generatedSteps: steps, finalSteps: steps })
    } catch (error) {
      console.error('Error generating steps:', error)
      // Optional: show user error
    } finally {
      setIsGenerating(false)
    }
  }

  const selectIndustryTemplate = (template: IndustryTemplate) => {
    onUpdate({ 
      industry: template.name,
      description: template.description 
    })
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Process Overview */}
      <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-lg border border-white/40 p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-gradient-to-r from-green-500 to-emerald-600 rounded-xl flex items-center justify-center">
            <FileText className="h-5 w-5 text-white" />
          </div>
          <h2 className="text-2xl font-semibold text-slate-900">Describe Your Process</h2>
        </div>

        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-3">
                Process Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                placeholder="e.g., Invoice Processing & Payment"
                value={data.title}
                onChange={(e) => onUpdate({ title: e.target.value })}
                className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl focus:border-green-500 focus:ring-green-500 bg-white/50"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-3">
                Industry/Department
              </label>
              <select
                value={data.industry}
                onChange={(e) => {
                  const selectedTemplate = industryTemplates.find(t => t.name === e.target.value)
                  if (selectedTemplate) {
                    selectIndustryTemplate(selectedTemplate)
                  } else {
                    onUpdate({ industry: e.target.value })
                  }
                }}
                className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl focus:border-green-500 focus:ring-green-500 bg-white/50"
              >
                <option value="">Select industry...</option>
                {industryTemplates.map(template => (
                  <option key={template.name} value={template.name}>
                    {template.icon} {template.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-3">
              Brief Description
            </label>
            <textarea
              placeholder="What does this process accomplish? Who benefits from it?"
              value={data.description}
              onChange={(e) => onUpdate({ description: e.target.value })}
              rows={3}
              className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl focus:border-green-500 focus:ring-green-500 bg-white/50 resize-none"
            />
          </div>
        </div>
      </div>

      {/* Industry Templates */}
      {!data.industry && (
        <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-lg border border-white/40 p-8">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-gradient-to-r from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center">
              <Library className="h-5 w-5 text-white" />
            </div>
            <h3 className="text-xl font-semibold text-slate-900">Quick Start Templates</h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {industryTemplates.map(template => (
              <div 
                key={template.name}
                onClick={() => selectIndustryTemplate(template)}
                className="bg-white/50 rounded-xl p-6 border border-slate-200 hover:border-blue-300 transition-all duration-200 cursor-pointer hover:scale-105"
              >
                <div className="text-3xl mb-3">{template.icon}</div>
                <h4 className="font-semibold text-slate-900 mb-2">{template.name}</h4>
                <p className="text-sm text-slate-600 mb-3">{template.description}</p>
                <div className="space-y-1">
                  {template.processes.slice(0, 3).map(process => (
                    <div key={process} className="text-xs text-slate-500">• {process}</div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AI Process Builder */}
      <div className="bg-gradient-to-r from-purple-500 to-pink-600 rounded-2xl p-8 text-white">
        <div className="flex items-center gap-4 mb-6">
          <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
            <Wand2 className="h-6 w-6" />
          </div>
          <div>
            <h3 className="text-2xl font-bold">AI Process Assistant</h3>
            <p className="text-purple-100">Describe your process in plain English</p>
          </div>
        </div>

        <div className="bg-white/10 rounded-xl p-6 backdrop-blur-sm">
          <textarea
            placeholder="Example: We receive invoices via email, need to extract vendor info and amount, validate against our vendor database, create payment records, and notify accounting team..."
            value={data.processDescription}
            onChange={(e) => onUpdate({ processDescription: e.target.value })}
            rows={4}
            className="w-full px-4 py-3 bg-white/20 border border-white/30 rounded-xl text-white placeholder-purple-200 focus:border-white/50 focus:ring-2 focus:ring-white/30 resize-none backdrop-blur-sm"
          />
          
          <div className="flex items-center justify-between mt-4">
            <div className="text-purple-100 text-sm">
              💡 Be specific about inputs, outputs, and decision points
            </div>
            <button
              onClick={generateSteps}
              disabled={!data.processDescription.trim() || isGenerating}
              className="px-6 py-3 bg-white text-purple-600 rounded-xl font-semibold hover:bg-purple-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2"
            >
              {isGenerating ? (
                <>
                  <div className="w-4 h-4 border-2 border-purple-600 border-t-transparent rounded-full animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Generate Process Steps
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Generated Steps Preview */}
      {data.generatedSteps?.length > 0 && (
        <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-lg border border-white/40 p-8">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-gradient-to-r from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center">
              <Sparkles className="h-5 w-5 text-white" />
            </div>
            <h3 className="text-xl font-semibold text-slate-900">Generated Process Steps</h3>
          </div>

          <div className="space-y-4 mb-6">
            {data.generatedSteps.map((step, index) => (
              <div key={step.id} className="relative">
                <div className="bg-blue-50/50 rounded-xl p-6 border border-blue-200">
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 bg-gradient-to-r from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center text-white font-bold flex-shrink-0">
                      {index + 1}
                    </div>
                    <div className="flex-1">
                      <h4 className="font-semibold text-slate-900 mb-2">{step.title}</h4>
                      <p className="text-slate-700 text-sm mb-3">{step.description}</p>
                      <div className="flex items-center gap-4 text-xs">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-slate-600">Suggested Agent:</span>
                          <span className="bg-blue-100 text-blue-700 px-2 py-1 rounded">{step.suggestedAgent}</span>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <div className="text-xs text-slate-600">
                          <span className="font-medium">Inputs:</span> {step.inputs.join(', ')}
                        </div>
                        <span className="text-slate-400">→</span>
                        <div className="text-xs text-slate-600">
                          <span className="font-medium">Outputs:</span> {step.outputs.join(', ')}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                
                {index < data.generatedSteps.length - 1 && (
                  <div className="flex justify-center py-2">
                    <ArrowDown className="h-5 w-5 text-blue-500" />
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between pt-6 border-t border-slate-200">
            <div className="text-sm text-slate-600">
              Review the generated steps and proceed to build your agents
            </div>
            <button
              onClick={onNext}
              className="px-6 py-3 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white rounded-xl font-semibold transition-all duration-200 transform hover:scale-105"
            >
              Build Agents →
            </button>
          </div>
        </div>
      )}

      {/* Continue without AI */}
      {!data.generatedSteps?.length && data.title && (
        <div className="text-center">
          <button
            onClick={onNext}
            className="px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl font-semibold transition-all duration-200"
          >
            Continue Manually →
          </button>
        </div>
      )}
    </div>
  )
}