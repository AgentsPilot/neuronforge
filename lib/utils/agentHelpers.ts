// utils/agentHelpers.ts - Enhanced version with execution capabilities
import { AgentLibraryItem, AgentExecutor, createExecutableSmartAgent } from '../types/agents';
import { WorkflowStep } from '../types/workflow';

export const createSmartAgentLibrary = (workflowDescription: string): AgentLibraryItem[] => {
  const baseAgents = [
    {
      id: 'email-scanner',
      name: 'Email Scanner',
      description: 'Scans email accounts for specific content and attachments',
      type: 'smart' as const,
      category: 'Communication',
      tags: ['email', 'scanning', 'automation'],
      inputs: [
        { name: 'email_folder', displayName: 'Email Folder', type: 'text', required: true, description: 'The folder to scan for emails' },
        { name: 'search_criteria', displayName: 'Search Criteria', type: 'text', required: false, description: 'Keywords to search for' },
        { name: 'date_range', displayName: 'Date Range', type: 'text', required: false, description: 'Date range for email search' }
      ],
      outputs: [
        { name: 'found_emails', displayName: 'Found Emails', type: 'json', required: true, description: 'List of emails matching criteria' },
        { name: 'attachment_count', displayName: 'Attachment Count', type: 'number', required: true, description: 'Number of attachments found' },
        { name: 'total_emails', displayName: 'Total Emails', type: 'number', required: true, description: 'Total emails processed' }
      ],
      requiredIntegrations: ['gmail', 'outlook'],
      configurationSchema: [
        { key: 'email_provider', label: 'Email Provider', type: 'select', required: true, options: [
          { value: 'gmail', label: 'Gmail' },
          { value: 'outlook', label: 'Outlook' }
        ]},
        { key: 'include_attachments', label: 'Include Attachments', type: 'boolean', required: false, defaultValue: true }
      ]
    },

    {
      id: 'invoice-extractor',
      name: 'Invoice Data Extractor',
      description: 'Extracts structured data from invoice documents using OCR and AI',
      type: 'smart' as const,
      category: 'Document Processing',
      tags: ['invoice', 'ocr', 'data-extraction'],
      inputs: [
        { name: 'documents', displayName: 'Documents', type: 'array', required: true, description: 'Invoice documents to process' },
        { name: 'extraction_fields', displayName: 'Fields to Extract', type: 'array', required: false, description: 'Specific fields to extract' }
      ],
      outputs: [
        { name: 'invoice_data', displayName: 'Invoice Data', type: 'json', required: true, description: 'Extracted invoice information' },
        { name: 'confidence_score', displayName: 'Confidence Score', type: 'number', required: true, description: 'Extraction confidence (0-1)' },
        { name: 'processing_errors', displayName: 'Processing Errors', type: 'array', required: false, description: 'Any errors encountered' }
      ],
      requiredIntegrations: ['google-drive', 'aws-textract'],
      configurationSchema: [
        { key: 'ocr_engine', label: 'OCR Engine', type: 'select', required: true, options: [
          { value: 'textract', label: 'AWS Textract' },
          { value: 'google-vision', label: 'Google Vision' }
        ]},
        { key: 'confidence_threshold', label: 'Confidence Threshold', type: 'number', required: false, defaultValue: 0.8 }
      ]
    },

    {
      id: 'crm-updater',
      name: 'CRM Record Creator',
      description: 'Creates and updates records in CRM systems with validation',
      type: 'smart' as const,
      category: 'CRM',
      tags: ['crm', 'data-sync', 'records'],
      inputs: [
        { name: 'record_data', displayName: 'Record Data', type: 'json', required: true, description: 'Data to create/update in CRM' },
        { name: 'record_type', displayName: 'Record Type', type: 'text', required: true, description: 'Type of CRM record (contact, company, etc.)' }
      ],
      outputs: [
        { name: 'created_records', displayName: 'Created Records', type: 'json', required: true, description: 'Successfully created records' },
        { name: 'updated_records', displayName: 'Updated Records', type: 'json', required: false, description: 'Successfully updated records' },
        { name: 'failed_records', displayName: 'Failed Records', type: 'json', required: false, description: 'Records that failed to process' }
      ],
      requiredIntegrations: ['hubspot', 'salesforce'],
      configurationSchema: [
        { key: 'crm_system', label: 'CRM System', type: 'select', required: true, options: [
          { value: 'hubspot', label: 'HubSpot' },
          { value: 'salesforce', label: 'Salesforce' }
        ]},
        { key: 'duplicate_handling', label: 'Duplicate Handling', type: 'select', required: true, options: [
          { value: 'skip', label: 'Skip Duplicates' },
          { value: 'update', label: 'Update Existing' },
          { value: 'create_new', label: 'Always Create New' }
        ]}
      ]
    }
  ];

  // Convert base agents to executable agents
  return baseAgents.map(baseAgent => createExecutableSmartAgent(baseAgent, createAgentExecutor));
};

// Factory function to create actual executors for different agent types
const createAgentExecutor = (agent: AgentLibraryItem): AgentExecutor => {
  switch (agent.id) {
    case 'email-scanner':
      return createEmailScannerExecutor(agent);
    case 'invoice-extractor':
      return createInvoiceExtractorExecutor(agent);
    case 'crm-updater':
      return createCRMUpdaterExecutor(agent);
    default:
      return createGenericExecutor(agent);
  }
};

// Specific executor implementations
const createEmailScannerExecutor = (agent: AgentLibraryItem): AgentExecutor => ({
  async execute(inputs, configuration) {
    const startTime = Date.now();
    
    // Simulate email scanning logic
    const { email_folder, search_criteria, date_range } = inputs;
    const provider = configuration?.email_provider || 'gmail';
    
    // Mock API call to email provider
    await simulateAPICall(`${provider}-scan`, 1500);
    
    // Generate realistic results
    const emailCount = Math.floor(Math.random() * 50) + 1;
    const attachmentCount = Math.floor(emailCount * 0.3);
    
    const foundEmails = Array.from({ length: emailCount }, (_, i) => ({
      id: `email_${i + 1}`,
      subject: `Invoice ${1000 + i}`,
      from: `sender${i}@company.com`,
      date: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000).toISOString(),
      attachments: Math.random() > 0.7 ? [`invoice_${1000 + i}.pdf`] : []
    }));

    return {
      success: true,
      outputs: {
        found_emails: foundEmails,
        attachment_count: attachmentCount,
        total_emails: emailCount
      },
      executionTime: Date.now() - startTime,
      integrationsCalled: [provider],
      metadata: {
        recordsProcessed: emailCount,
        apiCallsMade: 3,
        dataSize: emailCount * 512
      }
    };
  },

  async validateInputs(inputs) {
    const errors: any[] = [];
    
    if (!inputs.email_folder) {
      errors.push({
        field: 'email_folder',
        message: 'Email folder is required',
        code: 'REQUIRED_FIELD_MISSING'
      });
    }

    return { isValid: errors.length === 0, errors };
  },

  getRequiredIntegrations() {
    return ['gmail'];
  },

  async healthCheck(configuration) {
    const provider = configuration?.email_provider || 'gmail';
    
    try {
      await simulateAPICall(`${provider}-health`, 500);
      return {
        healthy: true,
        issues: [],
        integrationStatus: {
          [provider]: {
            connected: true,
            lastChecked: new Date()
          }
        }
      };
    } catch (error) {
      return {
        healthy: false,
        issues: [{
          severity: 'error' as const,
          message: `Unable to connect to ${provider}`,
          component: 'email-integration'
        }],
        integrationStatus: {
          [provider]: {
            connected: false,
            lastChecked: new Date(),
            error: error.message
          }
        }
      };
    }
  }
});

const createInvoiceExtractorExecutor = (agent: AgentLibraryItem): AgentExecutor => ({
  async execute(inputs, configuration) {
    const startTime = Date.now();
    const { documents, extraction_fields } = inputs;
    const ocrEngine = configuration?.ocr_engine || 'textract';
    
    // Simulate OCR processing
    await simulateAPICall(`${ocrEngine}-process`, 3000);
    
    const documentsArray = Array.isArray(documents) ? documents : [documents];
    const invoiceData = documentsArray.map((doc, i) => ({
      document_id: `doc_${i + 1}`,
      invoice_number: `INV-${1000 + i}`,
      amount: (Math.random() * 5000 + 100).toFixed(2),
      date: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      vendor: `Vendor ${i + 1}`,
      line_items: Array.from({ length: Math.floor(Math.random() * 5) + 1 }, (_, j) => ({
        description: `Item ${j + 1}`,
        quantity: Math.floor(Math.random() * 10) + 1,
        unit_price: (Math.random() * 100 + 10).toFixed(2)
      }))
    }));

    return {
      success: true,
      outputs: {
        invoice_data: invoiceData,
        confidence_score: 0.85 + Math.random() * 0.1,
        processing_errors: []
      },
      executionTime: Date.now() - startTime,
      integrationsCalled: [ocrEngine],
      metadata: {
        recordsProcessed: documentsArray.length,
        apiCallsMade: documentsArray.length,
        dataSize: documentsArray.length * 2048
      }
    };
  },

  async validateInputs(inputs) {
    const errors: any[] = [];
    
    if (!inputs.documents || (Array.isArray(inputs.documents) && inputs.documents.length === 0)) {
      errors.push({
        field: 'documents',
        message: 'At least one document is required',
        code: 'REQUIRED_FIELD_MISSING'
      });
    }

    return { isValid: errors.length === 0, errors };
  },

  getRequiredIntegrations() {
    return ['aws-textract'];
  },

  async healthCheck() {
    return {
      healthy: true,
      issues: [],
      integrationStatus: {
        'aws-textract': {
          connected: true,
          lastChecked: new Date()
        }
      }
    };
  }
});

const createCRMUpdaterExecutor = (agent: AgentLibraryItem): AgentExecutor => ({
  async execute(inputs, configuration) {
    const startTime = Date.now();
    const { record_data, record_type } = inputs;
    const crmSystem = configuration?.crm_system || 'hubspot';
    
    // Simulate CRM API calls
    await simulateAPICall(`${crmSystem}-create`, 1200);
    
    const recordsArray = Array.isArray(record_data) ? record_data : [record_data];
    const createdRecords = recordsArray.map((record, i) => ({
      id: `${crmSystem}_${Date.now()}_${i}`,
      type: record_type,
      ...record,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }));

    return {
      success: true,
      outputs: {
        created_records: createdRecords,
        updated_records: [],
        failed_records: []
      },
      executionTime: Date.now() - startTime,
      integrationsCalled: [crmSystem],
      metadata: {
        recordsProcessed: recordsArray.length,
        apiCallsMade: recordsArray.length,
        dataSize: recordsArray.length * 1024
      }
    };
  },

  async validateInputs(inputs) {
    const errors: any[] = [];
    
    if (!inputs.record_data) {
      errors.push({
        field: 'record_data',
        message: 'Record data is required',
        code: 'REQUIRED_FIELD_MISSING'
      });
    }

    if (!inputs.record_type) {
      errors.push({
        field: 'record_type',
        message: 'Record type is required',
        code: 'REQUIRED_FIELD_MISSING'
      });
    }

    return { isValid: errors.length === 0, errors };
  },

  getRequiredIntegrations() {
    return ['hubspot'];
  },

  async healthCheck(configuration) {
    const crmSystem = configuration?.crm_system || 'hubspot';
    
    return {
      healthy: true,
      issues: [],
      integrationStatus: {
        [crmSystem]: {
          connected: true,
          lastChecked: new Date()
        }
      }
    };
  }
});

const createGenericExecutor = (agent: AgentLibraryItem): AgentExecutor => ({
  async execute(inputs, configuration) {
    const startTime = Date.now();
    
    // Generic execution simulation
    await simulateAPICall('generic-process', 1000);
    
    // Generate outputs based on agent definition
    const outputs: Record<string, any> = {};
    agent.outputs.forEach(output => {
      switch (output.type.toLowerCase()) {
        case 'json':
          outputs[output.name] = { processed: true, input_data: inputs };
          break;
        case 'number':
          outputs[output.name] = Math.floor(Math.random() * 100);
          break;
        case 'boolean':
          outputs[output.name] = Math.random() > 0.5;
          break;
        case 'array':
          outputs[output.name] = ['result1', 'result2', 'result3'];
          break;
        default:
          outputs[output.name] = `processed_${output.name}`;
      }
    });

    return {
      success: true,
      outputs,
      executionTime: Date.now() - startTime,
      integrationsCalled: agent.requiredIntegrations || [],
      metadata: {
        recordsProcessed: 1,
        apiCallsMade: 1,
        dataSize: 1024
      }
    };
  },

  async validateInputs(inputs) {
    const errors: any[] = [];
    
    agent.inputs.forEach(input => {
      if (input.required && !inputs[input.name]) {
        errors.push({
          field: input.name,
          message: `${input.displayName || input.name} is required`,
          code: 'REQUIRED_FIELD_MISSING'
        });
      }
    });

    return { isValid: errors.length === 0, errors };
  },

  getRequiredIntegrations() {
    return agent.requiredIntegrations || [];
  },

  async healthCheck() {
    return {
      healthy: true,
      issues: [],
      integrationStatus: {}
    };
  }
});

// Utility function to simulate API calls
const simulateAPICall = async (apiName: string, delay: number): Promise<void> => {
  console.log(`Calling ${apiName} API...`);
  await new Promise(resolve => setTimeout(resolve, delay));
  
  // Simulate occasional failures (5% chance)
  if (Math.random() < 0.05) {
    throw new Error(`Simulated ${apiName} API failure`);
  }
  
  console.log(`${apiName} API call completed`);
};

// Enhanced AI-generated agents
export const generateAIAgents = (steps: WorkflowStep[]): AgentLibraryItem[] => {
  return steps.map((step, index) => {
    const baseAgent = {
      id: `ai-generated-${index}`,
      name: step.suggestedAgent || `AI Agent ${index + 1}`,
      description: `AI-generated agent for: ${step.description}`,
      type: 'ai-generated' as const,
      category: 'AI Generated',
      tags: ['ai-generated', 'auto-created'],
      inputs: step.inputs || [],
      outputs: step.outputs || [],
      requiredIntegrations: [],
      configurationSchema: []
    };

    return createExecutableSmartAgent(baseAgent, createGenericExecutor);
  });
};