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
  Bell,
  File,
  Book,
  Camera,
  Globe,
  Phone,
} from 'lucide-react'

export type PluginDefinition = {
  pluginKey: string
  name: string
  description: string
  icon: React.ReactNode
}

export const pluginList: PluginDefinition[] = [
  {
    pluginKey: 'google-mail',
    name: 'Gmail',
    description: 'Access and send emails via Gmail',
    icon: <Mail className="w-5 h-5 text-red-600" />,
  },
  {
    pluginKey: 'outlook', // ✅ same here
    name: 'Outlook',
    icon: <Mail className="w-5 h-5 text-red-600" />,
    description: 'Handle Microsoft Outlook inbox',
  },
  {
    pluginKey: 'github',
    name: 'GitHub',
    description: 'Access repositories and issues',
    icon: <Github className="w-5 h-5 text-gray-700" />,
  },
  {
    pluginKey: 'slack',
    name: 'Slack',
    description: 'Send messages and read channels',
    icon: <Slack className="w-5 h-5 text-purple-600" />,
  },
  {
    pluginKey: 'notion',
    name: 'Notion',
    description: 'Create and update Notion pages',
    icon: <FileText className="w-5 h-5 text-black" />,
  },
  {
    pluginKey: 'whatsapp',
    name: 'WhatsApp',
    description: 'Send messages via WhatsApp Business API',
    icon: <MessageCircle className="w-5 h-5 text-green-600" />,
  },
  {
    pluginKey: 'google-calendar',
    name: 'Google Calendar',
    description: 'Manage and schedule events',
    icon: <Calendar className="w-5 h-5 text-blue-500" />,
  },
  {
    pluginKey: 'postgres',
    name: 'Postgres DB',
    description: 'Query Postgres databases',
    icon: <Database className="w-5 h-5 text-indigo-600" />,
  },
  {
    pluginKey: 'aws',
    name: 'AWS',
    description: 'Access cloud services via AWS SDK',
    icon: <Cloud className="w-5 h-5 text-yellow-600" />,
  },
  {
    pluginKey: 'figma',
    name: 'Figma',
    description: 'Access designs and files from Figma',
    icon: <LayoutGrid className="w-5 h-5 text-pink-500" />,
  },
  {
    pluginKey: 'google-analytics',
    name: 'Google Analytics',
    description: 'Read traffic and behavior data',
    icon: <PieChart className="w-5 h-5 text-orange-600" />,
  },
  {
    pluginKey: 'dropbox',
    name: 'Dropbox',
    description: 'Access and manage Dropbox files',
    icon: <Folder className="w-5 h-5 text-blue-700" />,
  },
  {
    pluginKey: 'unsplash',
    name: 'Unsplash',
    description: 'Search and download high-quality images',
    icon: <Image className="w-5 h-5 text-amber-500" />,
  },
  {
    pluginKey: 'shopify',
    name: 'Shopify',
    description: 'Manage your e-commerce store',
    icon: <ShoppingCart className="w-5 h-5 text-emerald-600" />,
  },
  {
    pluginKey: 'youtube',
    name: 'YouTube',
    description: 'Manage videos and analytics',
    icon: <Video className="w-5 h-5 text-red-500" />,
  },
  {
    pluginKey: 'linkedin',
    name: 'LinkedIn',
    description: 'Manage posts and messages',
    icon: <User className="w-5 h-5 text-blue-800" />,
  },
  {
    pluginKey: 'twilio',
    name: 'Twilio',
    description: 'Send SMS and manage phone calls',
    icon: <Phone className="w-5 h-5 text-purple-700" />,
  },
  {
    pluginKey: 'calendar',
    name: 'Calendar',
    description: 'Access generic calendar services',
    icon: <Calendar className="w-5 h-5 text-cyan-600" />,
  },
  {
    pluginKey: 'firebase',
    name: 'Firebase',
    description: 'Use Firebase services like Firestore and Auth',
    icon: <Cloud className="w-5 h-5 text-orange-600" />,
  },
]