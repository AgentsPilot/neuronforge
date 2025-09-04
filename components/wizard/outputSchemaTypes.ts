// outputSchemaTypes.ts

export type OutputSchemaType = 'emailDraft' | 'alert' | 'decision' | 'taskList' | 'report' | 'summaryBlock' | 'textSummary' | 'jsonData' | ''

export type OutputField = {
  id: string
  name: string
  type: 'string' | 'number' | 'boolean'
  required: boolean
  description?: string
}

export const OUTPUT_TYPES = [
  {
    value: 'emailDraft',
    label: 'Email Draft',
    description: 'Create a ready-to-send email with routing to Gmail plugin',
    icon: 'Mail',
    color: 'from-green-500 to-emerald-600',
    bgColor: 'bg-green-50',
    textColor: 'text-green-700',
    borderColor: 'border-green-200',
    requiresRouting: true,
    examplePlugin: 'Gmail, Outlook'
  },
  {
    value: 'alert',
    label: 'Alert',
    description: 'Send notifications with severity levels to Slack/Teams',
    icon: 'AlertTriangle',
    color: 'from-orange-500 to-red-600',
    bgColor: 'bg-orange-50',
    textColor: 'text-orange-700',
    borderColor: 'border-orange-200',
    requiresRouting: true,
    examplePlugin: 'Slack, Microsoft Teams'
  },
  {
    value: 'decision',
    label: 'Decision',
    description: 'Binary decision with confidence level for CRM approval',
    icon: 'CheckCircle',
    color: 'from-blue-500 to-cyan-600',
    bgColor: 'bg-blue-50',
    textColor: 'text-blue-700',
    borderColor: 'border-blue-200',
    requiresRouting: true,
    examplePlugin: 'Salesforce, HubSpot'
  },
  {
    value: 'taskList',
    label: 'Task List',
    description: 'Create organized tasks with due dates in project management',
    icon: 'Plus',
    color: 'from-purple-500 to-indigo-600',
    bgColor: 'bg-purple-50',
    textColor: 'text-purple-700',
    borderColor: 'border-purple-200',
    requiresRouting: true,
    examplePlugin: 'Notion, ClickUp, Asana'
  },
  {
    value: 'report',
    label: 'Report',
    description: 'Structured report with sections for documentation platforms',
    icon: 'FileText',
    color: 'from-indigo-500 to-purple-600',
    bgColor: 'bg-indigo-50',
    textColor: 'text-indigo-700',
    borderColor: 'border-indigo-200',
    requiresRouting: true,
    examplePlugin: 'Notion, PDF Export'
  },
  {
    value: 'summaryBlock',
    label: 'Summary Block',
    description: 'Formatted summary sections for Slack or documentation',
    icon: 'Database',
    color: 'from-teal-500 to-blue-600',
    bgColor: 'bg-teal-50',
    textColor: 'text-teal-700',
    borderColor: 'border-teal-200',
    requiresRouting: true,
    examplePlugin: 'Slack, Notion'
  },
  {
    value: 'textSummary',
    label: 'Text Summary',
    description: 'Simple text output (optional plugin routing)',
    icon: 'MessageSquare',
    color: 'from-gray-500 to-slate-600',
    bgColor: 'bg-gray-50',
    textColor: 'text-gray-700',
    borderColor: 'border-gray-200',
    requiresRouting: false,
    examplePlugin: 'Email, Slack (optional)'
  },
  {
    value: 'jsonData',
    label: 'JSON Data',
    description: 'Structured data object for universal plugin integration',
    icon: 'Sparkles',
    color: 'from-violet-500 to-purple-600',
    bgColor: 'bg-violet-50',
    textColor: 'text-violet-700',
    borderColor: 'border-violet-200',
    requiresRouting: true,
    examplePlugin: 'Any API, Database'
  }
]

export const SEVERITY_OPTIONS = [
  { value: 'low', label: 'Low Priority', color: 'bg-blue-100 text-blue-800 border-blue-300', emoji: '💙', gradient: 'from-blue-400 to-blue-600' },
  { value: 'medium', label: 'Medium Priority', color: 'bg-yellow-100 text-yellow-800 border-yellow-300', emoji: '⚠️', gradient: 'from-yellow-400 to-orange-500' },
  { value: 'high', label: 'High Priority', color: 'bg-red-100 text-red-800 border-red-300', emoji: '🚨', gradient: 'from-red-400 to-red-600' }
]

export const FIELD_TYPES = [
  { value: 'string', label: 'Text', icon: '📝', color: 'bg-blue-500' },
  { value: 'number', label: 'Number', icon: '🔢', color: 'bg-green-500' },
  { value: 'boolean', label: 'True/False', icon: '✅', color: 'bg-purple-500' }
]

export const AI_ASSISTANCE_MESSAGES = {
  emailDraft: [
    "Email Draft creates ready-to-send emails with Gmail/Outlook integration!",
    "Don't forget to specify the recipient and subject line - these are required fields.",
    "Perfect for automated customer responses, notifications, or follow-up emails."
  ],
  alert: [
    "Alert messages are logged to agent_log for monitoring and tracking!",
    "Choose the right severity level - it helps with log filtering and analysis.",
    "Currently implemented and working - great for debugging and monitoring agent behavior."
  ],
  decision: [
    "Decision output provides binary answers with confidence levels for CRM systems!",
    "Include reasoning to help users understand why the decision was made.",
    "Great for approval workflows, risk assessment, and automated screening."
  ],
  report: [
    "Report format creates structured documents with sections and formatting!",
    "Define clear section titles that organize information logically.",
    "Storage location is still being determined - focus on structure for now."
  ],
  jsonData: [
    "JSON Data creates structured objects for universal plugin integration!",
    "Add fields that match exactly what your target system expects.",
    "Perfect for webhooks, database inserts, or custom integrations."
  ]
}