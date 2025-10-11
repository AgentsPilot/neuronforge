// lib/plugins/pluginList.ts
import {
  Mail,
  Github,
  Slack,
  FileText,
  MessageCircle,
  Calendar,
  Database,
  Cloud,
  LayoutGrid,
  PieChart,
  Folder,
  Image,
  ShoppingCart,
  Video,
  User,
  Phone,
  BarChart3,
  Users,
  Zap,
  CloudUpload,
  Search,
  Play,
  Building2,
  Globe,
  Bot,
  CreditCard,
  Target,
  TrendingUp,
  CheckSquare,
  Settings,
  DollarSign,
  Mic,
  UserPlus,
  BookOpen,
  Briefcase,
  Camera,
  Send,
  Headphones,
  FileSpreadsheet,
  Grid3X3,
  ClipboardList,
  Activity,
  Bell,
} from 'lucide-react'

export type PluginCategory = 
  | 'communication'
  | 'productivity'
  | 'crm'
  | 'marketing'
  | 'project'
  | 'finance'
  | 'integration'
  | 'ai'

export type PluginDefinition = {
  pluginKey: string
  name: string
  description: string
  detailedDescription: string
  icon: React.ReactNode
  category: PluginCategory
  isPopular?: boolean
}

export const pluginList: PluginDefinition[] = [
  // 🧠 AI Enhancements (Optional)
  {
    pluginKey: 'chatgpt-research',
    name: 'ChatGPT / GPT-4',
    description: 'For agents who generate copy, summaries, etc. (already core)',
    detailedDescription: 'Enables AI-powered content generation, text analysis, summarization, and creative writing. Provides natural language understanding and response generation capabilities for conversational agents.',
    icon: <Bot className="w-5 h-5 text-green-600" />,
    category: 'ai',
    isPopular: true,
  },
  {
    pluginKey: 'anthropic-claude',
    name: 'Anthropic Claude',
    description: 'Optional future support',
    detailedDescription: 'Advanced AI assistant for complex reasoning, analysis, and coding tasks. Offers enhanced safety features and nuanced conversation capabilities with strong performance on technical content.',
    icon: <Bot className="w-5 h-5 text-purple-600" />,
    category: 'ai',
  },
  {
    pluginKey: 'serpapi',
    name: 'SerpAPI',
    description: 'Real-time web search support',
    detailedDescription: 'Real-time web search engine results scraping. Provides structured access to Google, Bing, and other search engines with parsed results, images, news, and shopping data.',
    icon: <Search className="w-5 h-5 text-blue-600" />,
    category: 'ai',
  },
  {
    pluginKey: 'brave-search',
    name: 'Brave Search API',
    description: 'Real-time web search support',
    detailedDescription: 'Privacy-focused web search with real-time results. Delivers independent search results without tracking, including web pages, news, and image search capabilities.',
    icon: <Search className="w-5 h-5 text-orange-600" />,
    category: 'ai',
  },

  // 📧 Communication & Collaboration
  {
    pluginKey: 'google-mail',
    name: 'Gmail',
    description: 'Read, draft, send emails',
    detailedDescription: 'Comprehensive email management including reading emails with subject, sender, content, timestamp, and metadata like labels. Supports drafting, sending, organizing with labels, and advanced search filtering.',
    icon: <Mail className="w-5 h-5 text-red-600" />,
    category: 'communication',
    isPopular: true,
  },
  {
    pluginKey: 'google-calendar',
    name: 'Google Calendar',
    description: 'Fetch events, create meetings, reminders',
    detailedDescription: 'Full calendar management including creating events, scheduling meetings, setting reminders, and managing attendees. Supports recurring events, time zone handling, and Google Meet integration for video conferences.',
    icon: <Calendar className="w-5 h-5 text-blue-500" />,
    category: 'communication',
    isPopular: true,
  },
  {
    pluginKey: 'outlook',
    name: 'Microsoft Outlook',
    description: 'Mail and calendar for Office users',
    detailedDescription: 'Integrated email and calendar management for Microsoft 365 users. Provides email reading, sending, calendar event creation, and contact management with full Exchange server integration.',
    icon: <Mail className="w-5 h-5 text-blue-600" />,
    category: 'communication',
    isPopular: true,
  },
  {
    pluginKey: 'slack',
    name: 'Slack',
    description: 'Send/receive messages, summarize threads',
    detailedDescription: 'Unified workspace communication including sending messages to channels, direct messages, and threads. Supports reading conversation history, managing channels, and integrating with Slack\'s rich formatting and file sharing.',
    icon: <Slack className="w-5 h-5 text-purple-600" />,
    category: 'communication',
    isPopular: true,
  },
  {
    pluginKey: 'microsoft-teams',
    name: 'Microsoft Teams',
    description: 'Notifications, summaries, meeting links',
    detailedDescription: 'Enterprise collaboration platform for chat, meetings, and file sharing. Enables message sending, meeting scheduling, channel management, and integration with Microsoft 365 applications.',
    icon: <Users className="w-5 h-5 text-blue-700" />,
    category: 'communication',
    isPopular: true,
  },
  {
    pluginKey: 'zoom',
    name: 'Zoom',
    description: 'Create meetings, fetch recordings, auto-schedule',
    detailedDescription: 'Video conferencing platform integration for creating meetings, managing recordings, and scheduling calls. Provides meeting links, participant management, and automated scheduling capabilities.',
    icon: <Video className="w-5 h-5 text-blue-600" />,
    category: 'communication',
    isPopular: true,
  },
  {
    pluginKey: 'google-meet',
    name: 'Google Meet',
    description: 'Scheduling, links, meeting context',
    detailedDescription: 'Google\'s video conferencing solution integrated with Calendar. Enables automatic meeting link generation, scheduling integration, and participant management for virtual meetings.',
    icon: <Video className="w-5 h-5 text-green-600" />,
    category: 'communication',
  },
  {
    pluginKey: 'twilio',
    name: 'Twilio',
    description: 'Send SMS, make voice calls, manage call logs and responses',
    detailedDescription: 'Communications platform for SMS, voice calls, and messaging. Supports sending text messages, making phone calls, managing call logs, and automating communication workflows via API.',
    icon: <Phone className="w-5 h-5 text-red-500" />,
    category: 'communication',
  },
  {
    pluginKey: 'whatsapp-business',
    name: 'WhatsApp Business API',
    description: 'Send/receive templated messages, manage customer chats, automate responses',
    detailedDescription: 'Business messaging platform for customer communication. Enables sending templated messages, managing customer chats, automating responses, and handling media attachments through WhatsApp.',
    icon: <MessageCircle className="w-5 h-5 text-green-600" />,
    category: 'communication',
  },
  {
    pluginKey: 'discord',
    name: 'Discord',
    description: 'Post messages to channels, fetch conversation threads, manage server notifications',
    detailedDescription: 'Community communication platform for servers and channels. Supports posting messages, fetching conversation threads, managing server notifications, and integrating with Discord bots and webhooks.',
    icon: <MessageCircle className="w-5 h-5 text-indigo-600" />,
    category: 'communication',
  },

  // 📁 Documents & Notes
  {
    pluginKey: 'google-drive',
    name: 'Google Drive',
    description: 'Search, fetch docs, read text',
    detailedDescription: 'Cloud file storage with comprehensive search, file access, and content reading capabilities. Supports searching files by name, type, and content, reading documents, managing permissions, and handling both personal and shared drives.',
    icon: <Folder className="w-5 h-5 text-blue-600" />,
    category: 'productivity',
    isPopular: true,
  },
  {
    pluginKey: 'notion',
    name: 'Notion',
    description: 'Summarize pages, update databases',
    detailedDescription: 'All-in-one workspace for notes, databases, and collaboration. Enables reading and updating pages, querying databases, managing properties, and organizing content with rich text, tables, and multimedia support.',
    icon: <FileText className="w-5 h-5 text-gray-800" />,
    category: 'productivity',
    isPopular: true,
  },
  {
    pluginKey: 'evernote',
    name: 'Evernote',
    description: 'Fetch notes, add content',
    detailedDescription: 'Note-taking application for capturing, organizing, and searching notes. Supports creating notebooks, adding tags, searching content, and syncing notes across devices with rich media attachments.',
    icon: <BookOpen className="w-5 h-5 text-green-600" />,
    category: 'productivity',
  },
  {
    pluginKey: 'dropbox',
    name: 'Dropbox',
    description: 'Retrieve files, summarize PDFs',
    detailedDescription: 'File hosting service for secure cloud storage and sharing. Provides file upload, download, organization, and sharing capabilities with version history and collaboration features.',
    icon: <CloudUpload className="w-5 h-5 text-blue-700" />,
    category: 'productivity',
  },
  {
    pluginKey: 'onedrive',
    name: 'OneDrive',
    description: 'File interaction for MS Office users',
    detailedDescription: 'Microsoft\'s cloud storage service integrated with Office 365. Enables file management, document collaboration, sharing, and real-time editing with Microsoft Office applications.',
    icon: <Cloud className="w-5 h-5 text-blue-600" />,
    category: 'productivity',
  },
  {
    pluginKey: 'google-sheets',
    name: 'Google Sheets',
    description: 'Read/write rows, update cells, append data, use as structured input/output for agents',
    detailedDescription: 'Spreadsheet application for data management and analysis. Supports reading and writing cells, managing rows and columns, creating formulas, generating charts, and collaborative editing with real-time updates.',
    icon: <FileSpreadsheet className="w-5 h-5 text-green-600" />,
    category: 'productivity',
    isPopular: true,
  },
  {
    pluginKey: 'google-docs',
    name: 'Google Docs',
    description: 'Create, read, and edit documents with collaborative real-time editing and formatting tools',
    detailedDescription: 'Word processing application for creating and editing text documents. Supports formatting, inserting images and tables, tracking changes, comments, collaborative editing in real time, and exporting in multiple formats (PDF, DOCX, etc.). Ideal for drafting, reviewing, and sharing written content.',
    icon: <FileText className="w-5 h-5 text-gray-800" />,
    category: 'productivity',
    isPopular: true,
  },
  {
    pluginKey: 'airtable',
    name: 'Airtable',
    description: 'Read/write records, filter and query views, use structured data for workflows and dashboards',
    detailedDescription: 'Database-spreadsheet hybrid for structured data management. Provides record creation and updates, view filtering, field management, and API integration for building custom applications and workflows.',
    icon: <Database className="w-5 h-5 text-yellow-600" />,
    category: 'productivity',
  },
  {
    pluginKey: 'clickup-docs',
    name: 'ClickUp',
    description: 'Create tasks, update status, fetch lists and priorities, automate project and task workflows',
    detailedDescription: 'Project management platform with task tracking, document collaboration, and workflow automation. Supports creating and updating tasks, managing project status, time tracking, and team collaboration features.',
    icon: <ClipboardList className="w-5 h-5 text-purple-600" />,
    category: 'productivity',
  },

  // 📊 CRM & Sales
  {
    pluginKey: 'hubspot',
    name: 'HubSpot',
    description: 'Retrieve contact data, recent activity, deal summaries',
    detailedDescription: 'Customer relationship management platform for sales, marketing, and service. Provides contact management, deal tracking, lead scoring, email campaigns, and detailed analytics and reporting capabilities.',
    icon: <UserPlus className="w-5 h-5 text-orange-600" />,
    category: 'crm',
    isPopular: true,
  },
  {
    pluginKey: 'salesforce',
    name: 'Salesforce',
    description: 'Access leads, opportunities, reports',
    detailedDescription: 'Enterprise CRM platform for sales automation and customer management. Enables lead and opportunity management, account tracking, sales forecasting, and custom object creation with extensive reporting.',
    icon: <Cloud className="w-5 h-5 text-blue-500" />,
    category: 'crm',
    isPopular: true,
  },
  {
    pluginKey: 'pipedrive',
    name: 'Pipedrive',
    description: 'Pipeline and deal management',
    detailedDescription: 'Sales-focused CRM with visual pipeline management. Provides deal tracking, sales activity logging, pipeline customization, sales reporting, and integration with communication tools for sales teams.',
    icon: <Target className="w-5 h-5 text-green-600" />,
    category: 'crm',
  },
  {
    pluginKey: 'zoho-crm',
    name: 'Zoho CRM',
    description: 'Customer tracking, lead enrichment',
    detailedDescription: 'Comprehensive CRM solution for lead management and customer tracking. Offers contact management, sales automation, marketing campaigns, customer support ticketing, and business analytics.',
    icon: <User className="w-5 h-5 text-red-600" />,
    category: 'crm',
  },

  // 📈 Marketing & Ads
  {
    pluginKey: 'google-ads',
    name: 'Google Ads',
    description: 'Campaign insights, performance summaries',
    detailedDescription: 'Online advertising platform for campaign management and performance tracking. Provides campaign creation, keyword management, ad performance analytics, budget optimization, and conversion tracking.',
    icon: <TrendingUp className="w-5 h-5 text-blue-600" />,
    category: 'marketing',
    isPopular: true,
  },
  {
    pluginKey: 'meta-ads',
    name: 'Meta Ads (Facebook + Instagram)',
    description: 'Ad insights and summaries',
    detailedDescription: 'Social media advertising platform for Facebook and Instagram campaigns. Enables ad creation, audience targeting, performance monitoring, budget management, and multi-platform campaign optimization.',
    icon: <Camera className="w-5 h-5 text-blue-700" />,
    category: 'marketing',
    isPopular: true,
  },
  {
    pluginKey: 'mailchimp',
    name: 'Mailchimp',
    description: 'Fetch campaigns, contact performance',
    detailedDescription: 'Email marketing platform for automated campaigns and audience management. Supports email template creation, list management, campaign analytics, automation workflows, and A/B testing capabilities.',
    icon: <Send className="w-5 h-5 text-yellow-600" />,
    category: 'marketing',
  },
  {
    pluginKey: 'activecampaign',
    name: 'ActiveCampaign',
    description: 'Email sequences, performance',
    detailedDescription: 'Marketing automation platform combining email marketing, CRM, and sales automation. Provides advanced segmentation, behavioral triggers, lead scoring, and multichannel campaign management.',
    icon: <Activity className="w-5 h-5 text-blue-600" />,
    category: 'marketing',
  },

  // 📂 Project & Task Management
  {
    pluginKey: 'trello',
    name: 'Trello',
    description: 'Read/update board status',
    detailedDescription: 'Kanban-style project management tool for organizing tasks and workflows. Supports board creation, card management, list organization, team collaboration, and progress tracking with customizable workflows.',
    icon: <Grid3X3 className="w-5 h-5 text-blue-600" />,
    category: 'project',
  },
  {
    pluginKey: 'asana',
    name: 'Asana',
    description: 'Task tracking and summaries',
    detailedDescription: 'Project management platform for team collaboration and task tracking. Provides project organization, task assignment, timeline management, team communication, and progress reporting with multiple view options.',
    icon: <CheckSquare className="w-5 h-5 text-red-600" />,
    category: 'project',
  },
  {
    pluginKey: 'clickup-project',
    name: 'ClickUp',
    description: 'Project progress, automated updates',
    detailedDescription: 'All-in-one project management suite with customizable workflows. Offers task management, time tracking, goal setting, document collaboration, and team productivity analytics with flexible hierarchy structures.',
    icon: <ClipboardList className="w-5 h-5 text-purple-600" />,
    category: 'project',
  },
  {
    pluginKey: 'jira',
    name: 'Jira',
    description: 'Ticket summaries, project status (technical + business use)',
    detailedDescription: 'Issue and project tracking software for agile development teams. Provides bug tracking, sprint planning, workflow customization, reporting dashboards, and integration with development tools.',
    icon: <Settings className="w-5 h-5 text-blue-600" />,
    category: 'project',
  },

  // 💰 Finance & Billing
  {
    pluginKey: 'quickbooks',
    name: 'QuickBooks',
    description: 'Invoices, expenses, summaries',
    detailedDescription: 'Accounting software for small business financial management. Handles invoicing, expense tracking, tax preparation, payroll processing, and financial reporting with bank integration and automated bookkeeping.',
    icon: <DollarSign className="w-5 h-5 text-green-600" />,
    category: 'finance',
    isPopular: true,
  },
  {
    pluginKey: 'xero',
    name: 'Xero',
    description: 'Financial reports, invoices',
    detailedDescription: 'Cloud-based accounting platform for business financial management. Provides invoice creation, expense management, bank reconciliation, financial reporting, and multi-currency support with real-time collaboration.',
    icon: <BarChart3 className="w-5 h-5 text-blue-600" />,
    category: 'finance',
  },
  {
    pluginKey: 'stripe',
    name: 'Stripe',
    description: 'Transaction summaries, customer billing',
    detailedDescription: 'Payment processing platform for online transactions and billing. Enables payment collection, subscription management, customer billing, transaction monitoring, and financial reporting with extensive API capabilities.',
    icon: <CreditCard className="w-5 h-5 text-purple-600" />,
    category: 'finance',
    isPopular: true,
  },
  {
    pluginKey: 'paypal',
    name: 'PayPal',
    description: 'Transaction lookup, basic financial insights',
    detailedDescription: 'Digital payment platform for sending, receiving, and managing transactions. Supports payment processing, invoice creation, transaction history, dispute management, and integration with e-commerce platforms.',
    icon: <CreditCard className="w-5 h-5 text-blue-600" />,
    category: 'finance',
  },

  // 🔄 Integration Platforms
  {
    pluginKey: 'zapier',
    name: 'Zapier',
    description: 'Trigger or observe workflows',
    detailedDescription: 'Workflow automation platform connecting apps and services. Enables trigger-based automation, multi-step workflows, data transformation, and integration between thousands of applications without coding.',
    icon: <Zap className="w-5 h-5 text-orange-600" />,
    category: 'integration',
    isPopular: true,
  },
  {
    pluginKey: 'make',
    name: 'Make (Integromat)',
    description: 'Basic support to connect to broader automations',
    detailedDescription: 'Advanced automation platform for complex workflow creation. Provides visual workflow builder, data manipulation, conditional logic, error handling, and real-time monitoring for sophisticated integrations.',
    icon: <Settings className="w-5 h-5 text-purple-600" />,
    category: 'integration',
  },
  {
    pluginKey: 'calendly',
    name: 'Calendly',
    description: 'Meeting scheduling automation',
    detailedDescription: 'Meeting scheduling tool for automated appointment booking. Handles calendar integration, availability management, meeting confirmations, timezone handling, and customizable booking workflows with team coordination.',
    icon: <Calendar className="w-5 h-5 text-blue-600" />,
    category: 'integration',
  },
]

// Helper functions for organizing plugins
export const getPluginsByCategory = (category: PluginCategory): PluginDefinition[] => {
  return pluginList.filter(plugin => plugin.category === category)
}

export const getPopularPlugins = (): PluginDefinition[] => {
  return pluginList.filter(plugin => plugin.isPopular)
}

export const getPluginByKey = (pluginKey: string): PluginDefinition | undefined => {
  return pluginList.find(plugin => plugin.pluginKey === pluginKey)
}

export const searchPlugins = (query: string): PluginDefinition[] => {
  const searchTerm = query.toLowerCase()
  return pluginList.filter(plugin => 
    plugin.name.toLowerCase().includes(searchTerm) ||
    plugin.description.toLowerCase().includes(searchTerm) ||
    plugin.category.toLowerCase().includes(searchTerm)
  )
}

// Category metadata for UI organization
export const categoryMetadata: Record<PluginCategory, { label: string; description: string; icon: React.ReactNode }> = {
  communication: {
    label: 'Communication & Collaboration',
    description: 'Email, messaging, and team collaboration',
    icon: <Mail className="w-4 h-4" />
  },
  productivity: {
    label: 'Documents & Notes',
    description: 'File storage, document management, and productivity tools',
    icon: <FileText className="w-4 h-4" />
  },
  crm: {
    label: 'CRM & Sales',
    description: 'Customer relationship and sales management',
    icon: <UserPlus className="w-4 h-4" />
  },
  marketing: {
    label: 'Marketing & Ads',
    description: 'Marketing automation and advertising platforms',
    icon: <TrendingUp className="w-4 h-4" />
  },
  project: {
    label: 'Project & Task Management',
    description: 'Project tracking and task management tools',
    icon: <CheckSquare className="w-4 h-4" />
  },
  finance: {
    label: 'Finance & Billing',
    description: 'Financial management and payment processing',
    icon: <DollarSign className="w-4 h-4" />
  },
  integration: {
    label: 'Integration Platforms',
    description: 'Workflow automation and integration tools',
    icon: <Zap className="w-4 h-4" />
  },
  ai: {
    label: 'AI Enhancements',
    description: 'Artificial intelligence and research tools',
    icon: <Bot className="w-4 h-4" />
  },
}