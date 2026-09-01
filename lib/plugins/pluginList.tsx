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
  MapPin,
  Send,
  Headphones,
  FileSpreadsheet,
  Grid3X3,

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
    description: 'Send messages to channels, manage servers, automate community interactions',
    detailedDescription: 'Community platform for team communication and gaming communities. Send messages to channels, manage servers, create and update channels, handle roles and permissions, and automate community interactions.',
    icon: <MessageCircle className="w-5 h-5 text-indigo-600" />,
    category: 'communication',
  },
  {
    pluginKey: 'linkedin',
    name: 'LinkedIn',
    description: 'Access profile, create posts, manage connections, interact with professional network',
    detailedDescription: 'Professional networking platform for career development and business networking. Enables accessing your profile information, creating and publishing posts, managing professional connections, viewing organization details, and engaging with your professional network.',
    icon: <Briefcase className="w-5 h-5 text-blue-700" />,
    category: 'communication',
    isPopular: true,
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
    detailedDescription: 'Database-spreadsheet hybrid for structured data management. Provides record creation and updates, view filtering, field management, attachment handling, and API integration for building custom applications and workflows.',
    icon: <Database className="w-5 h-5 text-yellow-600" />,
    category: 'productivity',
    isPopular: true,
  },
  {
    pluginKey: 'document-extractor',
    name: 'Document Extractor',
    description: 'Extract structured data from documents, invoices, receipts, and images using OCR',
    detailedDescription: 'Deterministic document data extraction using OCR and parsing. Extract structured fields from PDFs, images, invoices, receipts, and forms without AI for fast, reliable, and cost-effective processing. Supports automatic MIME type detection and multiple input formats.',
    icon: <FileText className="w-5 h-5 text-blue-600" />,
    category: 'productivity',
    isPopular: true,
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

  // 📈 Marketing & Ads
  {
    pluginKey: 'google-analytics',
    name: 'Google Analytics',
    description: 'See your website traffic and where visitors come from',
    detailedDescription: 'Read-only Google Analytics 4 reporting: sessions, users, page views, landing pages, and which sources send traffic. Works for any GA4-measured site, including ones not hosted here. Cannot change any GA4 setting.',
    icon: <TrendingUp className="w-5 h-5 text-orange-500" />,
    category: 'marketing',
    isPopular: true,
  },
  {
    pluginKey: 'google-business-profile',
    name: 'Google Business Profile',
    description: 'See how people find you on Google Search and Maps',
    detailedDescription: 'Read-only Business Profile performance: how often your listing appeared on Search and Maps, and how many people called, asked for directions, or visited your website. Cannot edit your listing or reply to reviews.',
    icon: <MapPin className="w-5 h-5 text-blue-600" />,
    category: 'marketing',
    isPopular: true,
  },
  {
    pluginKey: 'meta-insights',
    name: 'Facebook & Instagram',
    description: 'See how many people your Page and Instagram reach',
    detailedDescription: 'Read-only insights for your Facebook Page and linked Instagram Business account: reach, impressions, engagement, profile views, follower growth, and per-post performance including boosted reach. Cannot post content or change any setting.',
    icon: <Camera className="w-5 h-5 text-pink-600" />,
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

  // 💰 Finance & Billing
  {
    pluginKey: 'stripe',
    name: 'Stripe',
    description: 'Accept payments, manage subscriptions, process refunds',
    detailedDescription: 'Connect your Stripe account to accept payments, create checkout sessions, manage recurring subscriptions, process refunds, and automate payment workflows. Supports both new Stripe account creation and connecting existing accounts.',
    icon: <CreditCard className="w-5 h-5 text-purple-600" />,
    category: 'finance',
    isPopular: true,
  },

  // 🔄 Integration Platforms
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