import { Mail, FileText, Users } from 'lucide-react'
import { Plugin } from '../types/agents'

// Available Plugins/Integrations
export const availablePlugins: Plugin[] = [
  { 
    id: 'gmail', 
    name: 'Gmail', 
    icon: Mail, 
    category: 'Email', 
    description: 'Connect to Gmail account',
    status: 'disconnected',
    testEndpoint: '/api/gmail/test',
    authUrl: 'https://accounts.google.com/oauth/authorize'
  },
  { 
    id: 'outlook', 
    name: 'Outlook', 
    icon: Mail, 
    category: 'Email', 
    description: 'Connect to Outlook account',
    status: 'disconnected',
    testEndpoint: '/api/outlook/test',
    authUrl: 'https://login.microsoftonline.com/common/oauth2/authorize'
  },
  { 
    id: 'salesforce', 
    name: 'Salesforce', 
    icon: Users, 
    category: 'CRM', 
    description: 'Connect to Salesforce CRM',
    status: 'disconnected',
    testEndpoint: '/api/salesforce/test',
    authUrl: 'https://login.salesforce.com/services/oauth2/authorize'
  },
  { 
    id: 'hubspot', 
    name: 'HubSpot', 
    icon: Users, 
    category: 'CRM', 
    description: 'Connect to HubSpot CRM',
    status: 'disconnected',
    testEndpoint: '/api/hubspot/test',
    authUrl: 'https://app.hubspot.com/oauth/authorize'
  },
  { 
    id: 'notion', 
    name: 'Notion', 
    icon: FileText, 
    category: 'Documents', 
    description: 'Connect to Notion workspace',
    status: 'disconnected',
    testEndpoint: '/api/notion/test',
    authUrl: 'https://api.notion.com/v1/oauth/authorize'
  },
  { 
    id: 'google-drive', 
    name: 'Google Drive', 
    icon: FileText, 
    category: 'Documents', 
    description: 'Connect to Google Drive',
    status: 'disconnected',
    testEndpoint: '/api/gdrive/test',
    authUrl: 'https://accounts.google.com/oauth/authorize'
  },
]