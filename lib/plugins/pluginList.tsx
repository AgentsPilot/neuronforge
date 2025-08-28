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
} from 'lucide-react'

export type PluginCategory = 
  | 'communication'
  | 'productivity'
  | 'development'
  | 'analytics'
  | 'storage'
  | 'media'
  | 'ecommerce'
  | 'cloud'
  | 'social'
  | 'ai'

export type PluginDefinition = {
  pluginKey: string
  name: string
  description: string
  icon: React.ReactNode
  category: PluginCategory
  isPopular?: boolean
}

export const pluginList: PluginDefinition[] = [
  // AI & Research
  {
    pluginKey: 'chatgpt-research',
    name: 'ChatGPT Research',
    description: 'AI-powered web research and analysis for any topic using ChatGPT-4',
    icon: <Bot className="w-5 h-5 text-green-600" />,
    category: 'ai',
    isPopular: true,
  },
  // Communication
  {
    pluginKey: 'google-mail',
    name: 'Gmail',
    description: 'Access and send emails via Gmail',
    icon: <Mail className="w-5 h-5 text-red-600" />,
    category: 'communication',
    isPopular: true,
  },
  {
    pluginKey: 'outlook',
    name: 'Outlook',
    description: 'Handle Microsoft Outlook inbox and calendar',
    icon: <Mail className="w-5 h-5 text-blue-600" />,
    category: 'communication',
    isPopular: true,
  },
  {
    pluginKey: 'slack',
    name: 'Slack',
    description: 'Send messages and read channels',
    icon: <Slack className="w-5 h-5 text-purple-600" />,
    category: 'communication',
    isPopular: true,
  },
  {
    pluginKey: 'whatsapp',
    name: 'WhatsApp Business',
    description: 'Send messages via WhatsApp Business API',
    icon: <MessageCircle className="w-5 h-5 text-green-600" />,
    category: 'communication',
  },
  {
    pluginKey: 'twilio',
    name: 'Twilio',
    description: 'Send SMS and manage phone communications',
    icon: <Phone className="w-5 h-5 text-red-500" />,
    category: 'communication',
  },

  // Productivity
  {
    pluginKey: 'google-calendar',
    name: 'Google Calendar',
    description: 'Manage and schedule events',
    icon: <Calendar className="w-5 h-5 text-blue-500" />,
    category: 'productivity',
    isPopular: true,
  },
  {
    pluginKey: 'notion',
    name: 'Notion',
    description: 'Create and update Notion pages and databases',
    icon: <FileText className="w-5 h-5 text-gray-800" />,
    category: 'productivity',
    isPopular: true,
  },
  {
    pluginKey: 'airtable',
    name: 'Airtable',
    description: 'Manage databases and collaborative workspaces',
    icon: <Database className="w-5 h-5 text-yellow-600" />,
    category: 'productivity',
  },

  // Development
  {
    pluginKey: 'github',
    name: 'GitHub',
    description: 'Access repositories, issues, and pull requests',
    icon: <Github className="w-5 h-5 text-gray-800" />,
    category: 'development',
    isPopular: true,
  },
  {
    pluginKey: 'figma',
    name: 'Figma',
    description: 'Access designs and collaborate on UI/UX files',
    icon: <LayoutGrid className="w-5 h-5 text-purple-500" />,
    category: 'development',
  },
  {
    pluginKey: 'vercel',
    name: 'Vercel',
    description: 'Deploy and manage web applications',
    icon: <Zap className="w-5 h-5 text-black" />,
    category: 'development',
  },

  // Analytics
  {
    pluginKey: 'google-analytics',
    name: 'Google Analytics',
    description: 'Track website traffic and user behavior',
    icon: <BarChart3 className="w-5 h-5 text-orange-600" />,
    category: 'analytics',
    isPopular: true,
  },
  {
    pluginKey: 'mixpanel',
    name: 'Mixpanel',
    description: 'Advanced product and user analytics',
    icon: <PieChart className="w-5 h-5 text-blue-600" />,
    category: 'analytics',
  },

  // Storage & Cloud
  {
    pluginKey: 'google-drive',
    name: 'Google Drive',
    description: 'Access and manage Google Drive files',
    icon: <Folder className="w-5 h-5 text-blue-600" />,
    category: 'storage',
    isPopular: true,
  },
  {
    pluginKey: 'dropbox',
    name: 'Dropbox',
    description: 'Access and sync Dropbox files',
    icon: <CloudUpload className="w-5 h-5 text-blue-700" />,
    category: 'storage',
  },
  {
    pluginKey: 'aws',
    name: 'AWS S3',
    description: 'Manage cloud storage and services',
    icon: <Cloud className="w-5 h-5 text-orange-500" />,
    category: 'cloud',
  },
  {
    pluginKey: 'firebase',
    name: 'Firebase',
    description: 'Backend services including Firestore and Auth',
    icon: <Cloud className="w-5 h-5 text-yellow-600" />,
    category: 'cloud',
  },

  // Database
  {
    pluginKey: 'postgres',
    name: 'PostgreSQL',
    description: 'Query and manage PostgreSQL databases',
    icon: <Database className="w-5 h-5 text-blue-800" />,
    category: 'development',
  },
  {
    pluginKey: 'mongodb',
    name: 'MongoDB',
    description: 'Work with MongoDB collections and documents',
    icon: <Database className="w-5 h-5 text-green-600" />,
    category: 'development',
  },

  // Media
  {
    pluginKey: 'unsplash',
    name: 'Unsplash',
    description: 'Search and download high-quality stock photos',
    icon: <Image className="w-5 h-5 text-black" />,
    category: 'media',
  },
  {
    pluginKey: 'youtube',
    name: 'YouTube',
    description: 'Manage videos, analytics, and channel content',
    icon: <Play className="w-5 h-5 text-red-600" />,
    category: 'media',
    isPopular: true,
  },
  {
    pluginKey: 'spotify',
    name: 'Spotify',
    description: 'Access music data and manage playlists',
    icon: <Video className="w-5 h-5 text-green-500" />,
    category: 'media',
  },

  // E-commerce
  {
    pluginKey: 'shopify',
    name: 'Shopify',
    description: 'Manage products, orders, and store analytics',
    icon: <ShoppingCart className="w-5 h-5 text-green-600" />,
    category: 'ecommerce',
  },
  {
    pluginKey: 'stripe',
    name: 'Stripe',
    description: 'Handle payments and financial transactions',
    icon: <Building2 className="w-5 h-5 text-purple-600" />,
    category: 'ecommerce',
  },

  // Social
  {
    pluginKey: 'linkedin',
    name: 'LinkedIn',
    description: 'Manage professional posts and connections',
    icon: <Users className="w-5 h-5 text-blue-700" />,
    category: 'social',
  },
  {
    pluginKey: 'twitter',
    name: 'Twitter/X',
    description: 'Post tweets and manage social presence',
    icon: <Globe className="w-5 h-5 text-black" />,
    category: 'social',
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
  ai: {
    label: 'AI & Research',
    description: 'Artificial intelligence and research tools',
    icon: <Bot className="w-4 h-4" />
  },
  communication: {
    label: 'Communication',
    description: 'Email, messaging, and team collaboration',
    icon: <Mail className="w-4 h-4" />
  },
  productivity: {
    label: 'Productivity',
    description: 'Task management and workflow tools',
    icon: <Calendar className="w-4 h-4" />
  },
  development: {
    label: 'Development',
    description: 'Code repositories and development tools',
    icon: <Github className="w-4 h-4" />
  },
  analytics: {
    label: 'Analytics',
    description: 'Data tracking and business intelligence',
    icon: <BarChart3 className="w-4 h-4" />
  },
  storage: {
    label: 'Storage',
    description: 'File storage and document management',
    icon: <Folder className="w-4 h-4" />
  },
  media: {
    label: 'Media',
    description: 'Images, videos, and content creation',
    icon: <Image className="w-4 h-4" />
  },
  ecommerce: {
    label: 'E-commerce',
    description: 'Online stores and payment processing',
    icon: <ShoppingCart className="w-4 h-4" />
  },
  cloud: {
    label: 'Cloud Services',
    description: 'Cloud infrastructure and backend services',
    icon: <Cloud className="w-4 h-4" />
  },
  social: {
    label: 'Social Media',
    description: 'Social platforms and community management',
    icon: <Users className="w-4 h-4" />
  }
}