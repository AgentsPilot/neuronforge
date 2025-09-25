import { AgentTemplates } from '../types/agents'

// Smart Agent Templates
export const SMART_AGENT_TEMPLATES: AgentTemplates = {
  emailAgents: [
    {
      id: 'email-scanner',
      name: 'Email Scanner',
      description: 'Scan email inbox for specific types of emails and attachments',
      category: 'Email Processing',
      inputs: [
        { name: 'email_account', type: 'connection', description: 'Email account to scan', required: true },
        { name: 'search_criteria', type: 'config', description: 'What to search for', required: true }
      ],
      outputs: [
        { name: 'found_emails', type: 'email_list', description: 'Emails matching criteria' },
        { name: 'attachments', type: 'file_list', description: 'Files attached to emails' }
      ],
      requiredPlugins: ['google-mail', 'outlook'],
      businessValue: 'Never miss important emails again',
      configurable: true
    }
  ],
  documentAgents: [
    {
      id: 'invoice-extractor',
      name: 'Invoice Data Extractor', 
      description: 'Extract specific data fields from invoices and documents',
      category: 'Document Processing',
      inputs: [
        { name: 'documents', type: 'file_list', description: 'Documents to process', required: true }
      ],
      outputs: [
        { name: 'invoice_data', type: 'structured_data', description: 'Extracted invoice information' }
      ],
      requiredPlugins: [],
      businessValue: 'Extract data 100x faster than manual entry',
      configurable: true
    }
  ],
  crmAgents: [
    {
      id: 'crm-inserter',
      name: 'CRM Record Creator',
      description: 'Create new records in your CRM system',
      category: 'CRM Integration', 
      inputs: [
        { name: 'structured_data', type: 'structured_data', description: 'Data to insert', required: true }
      ],
      outputs: [
        { name: 'crm_records', type: 'crm_data', description: 'Created CRM records' }
      ],
      requiredPlugins: ['salesforce', 'hubspot'],
      businessValue: 'Automatically update CRM with 100% accuracy',
      configurable: true
    }
  ]
}