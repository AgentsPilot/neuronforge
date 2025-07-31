'use client'

import { FC } from 'react'
import { 
  Bot, 
  MessageSquare, 
  Database, 
  FileText, 
  Puzzle, 
  Settings, 
  Edit3, 
  CheckCircle, 
  Clock, 
  Zap,
  PlayCircle,
  Calendar,
  AlertTriangle,
  Mail,
  Eye
} from 'lucide-react'

interface SchemaField {
  name: string
  type: string
  description?: string
  required?: boolean
}

interface OutputSchema {
  type?: string
  fields?: SchemaField[]
}

interface Step6ReviewProps {
  data: {
    agentName: string
    description: string
    systemPrompt: string
    userPrompt: string
    inputSchema: SchemaField[]
    outputSchema: OutputSchema
    plugins: Record<string, any>
    mode: string
    schedule_cron: string
    trigger_conditions: string
  }
  onEditStep: (step: number) => void
}

const FIELD_TYPE_ICONS: Record<string, string> = {
  string: '📝',
  number: '🔢',
  boolean: '✅',
  date: '📅',
  enum: '📋',
  file: '📎'
}

const OUTPUT_TYPE_CONFIG: Record<string, { icon: any; label: string; color: string }> = {
  SummaryBlock: { icon: FileText, label: 'Summary Block', color: 'from-blue-500 to-cyan-600' },
  EmailDraft: { icon: Mail, label: 'Email Draft', color: 'from-green-500 to-emerald-600' },
  Alert: { icon: AlertTriangle, label: 'Dashboard Alert', color: 'from-orange-500 to-red-600' },
  StructuredData: { icon: Database, label: 'Structured Data', color: 'from-purple-500 to-indigo-600' }
}

const MODE_CONFIG: Record<string, { icon: any; label: string; color: string; description: string }> = {
  on_demand: { 
    icon: PlayCircle, 
    label: 'On Demand', 
    color: 'from-blue-500 to-indigo-600',
    description: 'Runs manually when triggered'
  },
  scheduled: { 
    icon: Clock, 
    label: 'Scheduled', 
    color: 'from-green-500 to-emerald-600',
    description: 'Runs automatically on schedule'
  },
  triggered: { 
    icon: Zap, 
    label: 'Event Triggered', 
    color: 'from-purple-500 to-pink-600',
    description: 'Runs when conditions are met'
  }
}

const renderSchemaTable = (schema: SchemaField[] | { fields?: SchemaField[] }, title: string) => {
  const fields = Array.isArray(schema) ? schema : schema?.fields ?? []

  if (!fields || fields.length === 0) {
    return (
      <div className="text-center py-8">
        <div className="text-4xl mb-2">📝</div>
        <p className="text-slate-500">No {title.toLowerCase()} fields defined</p>
      </div>
    )
  }

  return (
    <div className="bg-white/50 backdrop-blur-sm rounded-xl border border-slate-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gradient-to-r from-slate-50 to-blue-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-6 py-4 font-semibold text-slate-700">Name</th>
              <th className="text-left px-6 py-4 font-semibold text-slate-700">Type</th>
              <th className="text-left px-6 py-4 font-semibold text-slate-700">Description</th>
              <th className="text-left px-6 py-4 font-semibold text-slate-700">Required</th>
            </tr>
          </thead>
          <tbody>
            {fields.map((field, index) => (
              <tr key={index} className="border-b border-slate-100 hover:bg-blue-50/50 transition-colors duration-200">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm bg-slate-100 px-2 py-1 rounded">
                      {field.name}
                    </span>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{FIELD_TYPE_ICONS[field.type] || '📝'}</span>
                    <span className="text-slate-700 capitalize">{field.type}</span>
                  </div>
                </td>
                <td className="px-6 py-4 text-slate-600">
                  {field.description || <span className="text-slate-400 italic">No description</span>}
                </td>
                <td className="px-6 py-4">
                  {field.required ? (
                    <span className="inline-flex items-center gap-1 px-2 py-1 bg-red-100 text-red-700 rounded-full text-xs font-medium">
                      <CheckCircle className="h-3 w-3" />
                      Required
                    </span>
                  ) : (
                    <span className="text-slate-400 text-sm">Optional</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const Step6Review: FC<Step6ReviewProps> = ({ data, onEditStep }) => {
  const renderModeDetails = () => {
    const modeConfig = MODE_CONFIG[data.mode] || MODE_CONFIG.on_demand
    const ModeIcon = modeConfig.icon

    switch (data.mode) {
      case 'scheduled':
        return (
          <div className="space-y-3">
            <div className="flex items-center gap-3 p-4 bg-green-50 rounded-xl border border-green-200">
              <Clock className="h-5 w-5 text-green-600" />
              <div>
                <p className="font-medium text-green-900">Cron Schedule</p>
                <p className="text-sm text-green-700 font-mono">
                  {data.schedule_cron || 'No schedule defined'}
                </p>
              </div>
            </div>
          </div>
        )
      case 'triggered':
        return (
          <div className="space-y-3">
            <div className="p-4 bg-purple-50 rounded-xl border border-purple-200">
              <div className="flex items-center gap-2 mb-3">
                <Zap className="h-5 w-5 text-purple-600" />
                <p className="font-medium text-purple-900">Trigger Conditions</p>
              </div>
              <div className="bg-white/70 rounded-lg p-3 border border-purple-200">
                <pre className="text-sm text-slate-700 overflow-auto whitespace-pre-wrap">
                  {data.trigger_conditions || '{}'}
                </pre>
              </div>
            </div>
          </div>
        )
      default:
        return (
          <div className="flex items-center gap-3 p-4 bg-blue-50 rounded-xl border border-blue-200">
            <PlayCircle className="h-5 w-5 text-blue-600" />
            <p className="text-blue-800">This agent runs manually when you trigger it</p>
          </div>
        )
    }
  }

  const renderOutputSchema = () => {
    const outputType = data.outputSchema?.type
    const outputConfig = outputType ? OUTPUT_TYPE_CONFIG[outputType] : null
    
    if (!outputType) {
      return (
        <div className="text-center py-8">
          <div className="text-4xl mb-2">📤</div>
          <p className="text-slate-500">No output schema configured</p>
        </div>
      )
    }

    const OutputIcon = outputConfig?.icon || FileText

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 p-4 bg-white/50 rounded-xl border border-slate-200">
          <div className={`w-10 h-10 bg-gradient-to-r ${outputConfig?.color || 'from-slate-500 to-slate-600'} rounded-xl flex items-center justify-center`}>
            <OutputIcon className="h-5 w-5 text-white" />
          </div>
          <div>
            <p className="font-semibold text-slate-900">{outputConfig?.label || outputType}</p>
            <p className="text-sm text-slate-600">Output format type</p>
          </div>
        </div>
        
        {outputType === 'StructuredData' && (
          <div>
            <h4 className="font-medium text-slate-900 mb-3">Output Fields</h4>
            {renderSchemaTable(data.outputSchema, 'Output')}
          </div>
        )}
      </div>
    )
  }

  const sections = [
    {
      id: 1,
      title: 'Agent Information',
      icon: Bot,
      color: 'from-blue-500 to-indigo-600',
      content: (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white/50 p-4 rounded-xl border border-slate-200">
              <p className="text-sm font-medium text-slate-600 mb-1">Agent Name</p>
              <p className="text-lg font-semibold text-slate-900">{data.agentName}</p>
            </div>
            <div className="bg-white/50 p-4 rounded-xl border border-slate-200">
              <p className="text-sm font-medium text-slate-600 mb-1">Description</p>
              <p className="text-slate-700">{data.description || <span className="italic text-slate-400">No description provided</span>}</p>
            </div>
          </div>
        </div>
      )
    },
    {
      id: 2,
      title: 'Prompts Configuration',
      icon: MessageSquare,
      color: 'from-green-500 to-emerald-600',
      content: (
        <div className="space-y-4">
          <div className="bg-white/50 p-4 rounded-xl border border-slate-200">
            <div className="flex items-center gap-2 mb-3">
              <Settings className="h-4 w-4 text-blue-600" />
              <p className="font-medium text-slate-900">System Prompt</p>
              <span className="text-xs text-slate-500 bg-slate-100 px-2 py-1 rounded">Optional</span>
            </div>
            <div className="bg-slate-50 p-3 rounded-lg border">
              <p className="text-sm text-slate-700">
                {data.systemPrompt || <span className="italic text-slate-400">No system prompt defined</span>}
              </p>
            </div>
          </div>
          
          <div className="bg-white/50 p-4 rounded-xl border border-slate-200">
            <div className="flex items-center gap-2 mb-3">
              <MessageSquare className="h-4 w-4 text-green-600" />
              <p className="font-medium text-slate-900">User Prompt</p>
              <span className="text-xs text-red-600 bg-red-100 px-2 py-1 rounded">Required</span>
            </div>
            <div className="bg-slate-50 p-3 rounded-lg border">
              <p className="text-sm text-slate-700">{data.userPrompt}</p>
            </div>
          </div>
        </div>
      )
    },
    {
      id: 3,
      title: 'Connected Plugins',
      icon: Puzzle,
      color: 'from-purple-500 to-pink-600',
      content: (
        <div>
          {Object.keys(data.plugins).length > 0 ? (
            <div className="flex flex-wrap gap-3">
              {Object.entries(data.plugins).map(([key, value]) => {
                const isEnabled = value === true || (typeof value === 'object' && value !== null)
                return (
                  <div key={key} className={`flex items-center gap-2 px-4 py-2 rounded-xl border ${
                    isEnabled 
                      ? 'bg-blue-50 border-blue-200 text-blue-800' 
                      : 'bg-slate-50 border-slate-200 text-slate-500'
                  }`}>
                    <div className={`w-2 h-2 rounded-full ${isEnabled ? 'bg-green-500' : 'bg-slate-400'}`} />
                    <span className="font-medium">{key}</span>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="text-center py-8">
              <div className="text-4xl mb-2">🔌</div>
              <p className="text-slate-500">No plugins connected</p>
              <p className="text-sm text-slate-400 mt-1">Your agent will work without external integrations</p>
            </div>
          )}
        </div>
      )
    },
    {
      id: 4,
      title: 'Input Schema',
      icon: Database,
      color: 'from-orange-500 to-red-600',
      content: renderSchemaTable(data.inputSchema, 'Input')
    },
    {
      id: 5,
      title: 'Output Schema',
      icon: FileText,
      color: 'from-indigo-500 to-purple-600',
      content: renderOutputSchema()
    },
    {
      id: 6,
      title: 'Execution Mode',
      icon: Settings,
      color: 'from-teal-500 to-cyan-600',
      content: (
        <div className="space-y-4">
          <div className="flex items-center gap-4 p-4 bg-white/50 rounded-xl border border-slate-200">
            <div className={`w-12 h-12 bg-gradient-to-r ${MODE_CONFIG[data.mode]?.color || 'from-slate-500 to-slate-600'} rounded-xl flex items-center justify-center`}>
              {(() => {
                const ModeIcon = MODE_CONFIG[data.mode]?.icon || PlayCircle
                return <ModeIcon className="h-6 w-6 text-white" />
              })()}
            </div>
            <div>
              <p className="font-semibold text-slate-900">{MODE_CONFIG[data.mode]?.label || data.mode}</p>
              <p className="text-sm text-slate-600">{MODE_CONFIG[data.mode]?.description || 'Custom execution mode'}</p>
            </div>
          </div>
          {renderModeDetails()}
        </div>
      )
    }
  ]

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      <div className="max-w-6xl mx-auto px-4 py-12">
        {/* Header Section */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-r from-blue-500 to-indigo-600 rounded-2xl mb-6 shadow-xl">
            <Eye className="h-8 w-8 text-white" />
          </div>
          <h2 className="text-4xl font-bold bg-gradient-to-r from-slate-800 to-blue-800 bg-clip-text text-transparent mb-4">
            Review & Deploy
          </h2>
          <p className="text-lg text-slate-600 max-w-2xl mx-auto">
            Review your agent configuration and deploy when ready
          </p>
        </div>

        {/* Agent Summary Card */}
        <div className="bg-gradient-to-r from-blue-500 to-indigo-600 rounded-2xl p-8 text-white mb-8">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center">
              <Bot className="h-8 w-8" />
            </div>
            <div>
              <h3 className="text-2xl font-bold">{data.agentName}</h3>
              <p className="text-blue-100">Ready for deployment</p>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
            <div className="bg-white/10 rounded-xl p-3 text-center backdrop-blur-sm">
              <div className="text-2xl font-bold">{data.inputSchema?.length || 0}</div>
              <div className="text-sm text-blue-100">Input Fields</div>
            </div>
            <div className="bg-white/10 rounded-xl p-3 text-center backdrop-blur-sm">
              <div className="text-2xl font-bold">{Object.keys(data.plugins).length}</div>
              <div className="text-sm text-blue-100">Plugins</div>
            </div>
            <div className="bg-white/10 rounded-xl p-3 text-center backdrop-blur-sm">
              <div className="text-2xl font-bold">{data.outputSchema?.type ? '1' : '0'}</div>
              <div className="text-sm text-blue-100">Output Type</div>
            </div>
            <div className="bg-white/10 rounded-xl p-3 text-center backdrop-blur-sm">
              <div className="text-2xl font-bold">{MODE_CONFIG[data.mode]?.label || data.mode}</div>
              <div className="text-sm text-blue-100">Execution</div>
            </div>
          </div>
        </div>

        {/* Configuration Sections */}
        <div className="space-y-8">
          {sections.map((section) => {
            const SectionIcon = section.icon
            return (
              <div key={section.id} className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-lg border border-white/40 p-8">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-4">
                    <div className={`w-12 h-12 bg-gradient-to-r ${section.color} rounded-xl flex items-center justify-center shadow-lg`}>
                      <SectionIcon className="h-6 w-6 text-white" />
                    </div>
                    <div>
                      <h3 className="text-2xl font-semibold text-slate-900">{section.title}</h3>
                      <p className="text-slate-600">Step {section.id} configuration</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => onEditStep(section.id)}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-xl transition-all duration-200 hover:scale-105 border border-blue-200"
                  >
                    <Edit3 className="h-4 w-4" />
                    Edit
                  </button>
                </div>
                <div className="pl-16">
                  {section.content}
                </div>
              </div>
            )
          })}
        </div>

        {/* Deployment Ready Status */}
        <div className="mt-12 bg-gradient-to-r from-green-500 to-emerald-600 rounded-2xl p-8 text-white text-center">
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center">
              <CheckCircle className="h-6 w-6" />
            </div>
            <h3 className="text-2xl font-bold">Ready to Deploy!</h3>
          </div>
          <p className="text-green-100 mb-6 max-w-2xl mx-auto">
            Your agent configuration is complete and ready for deployment. Click "Create Agent" to make it live.
          </p>
          <div className="flex items-center justify-center gap-4 text-sm">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4" />
              <span>Configuration Valid</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4" />
              <span>Ready for Production</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Step6Review