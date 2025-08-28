// utils/agentHelpers.ts - Self-contained version with local type definitions
// Local type definitions to avoid import issues
interface AgentInput {
  name: string;
  displayName: string;
  type: string;
  required: boolean;
  description: string;
}

interface AgentOutput {
  name: string;
  displayName: string;
  type: string;
  required: boolean;
  description: string;
}

interface ConfigurationOption {
  value: string;
  label: string;
}

interface ConfigurationField {
  key: string;
  label: string;
  type: string;
  required: boolean;
  options?: ConfigurationOption[];
  defaultValue?: any;
}

interface ExecutionResult {
  success: boolean;
  outputs: Record<string, any>;
  executionTime: number;
  integrationsCalled: string[];
  metadata: {
    recordsProcessed: number;
    apiCallsMade: number;
    dataSize: number;
  };
}

interface ValidationResult {
  isValid: boolean;
  errors: Array<{
    field: string;
    message: string;
    code: string;
  }>;
}

interface HealthCheckResult {
  healthy: boolean;
  issues: Array<{
    severity: 'error' | 'warning';
    message: string;
    component: string;
  }>;
  integrationStatus: Record<string, {
    connected: boolean;
    lastChecked: Date;
    error?: string;
  }>;
}

export interface AgentExecutor {
  execute(inputs: Record<string, any>, configuration?: Record<string, any>): Promise<ExecutionResult>;
  validateInputs(inputs: Record<string, any>): Promise<ValidationResult>;
  getRequiredIntegrations(): string[];
  healthCheck(configuration?: Record<string, any>): Promise<HealthCheckResult>;
}

export interface AgentLibraryItem {
  id: string;
  name: string;
  description: string;
  type: 'smart' | 'ai-generated';
  category: string;
  tags: string[];
  inputs: AgentInput[];
  outputs: AgentOutput[];
  requiredIntegrations: string[];
  configurationSchema: ConfigurationField[];
  executor?: AgentExecutor;
}

interface WorkflowStepInput {
  name: string;
  type: string;
  required?: boolean;
  description?: string;
}

interface WorkflowStepOutput {
  name: string;
  type: string;
  required?: boolean;
  description?: string;
}

export interface WorkflowStep {
  id?: string;
  description: string;
  suggestedAgent?: string;
  inputs?: WorkflowStepInput[];
  outputs?: WorkflowStepOutput[];
}

// Factory function to create executable smart agents
export const createExecutableSmartAgent = (
  baseAgent: Omit<AgentLibraryItem, 'executor'>, 
  executorFactory: (agent: AgentLibraryItem) => AgentExecutor
): AgentLibraryItem => {
  const agent = baseAgent as AgentLibraryItem;
  agent.executor = executorFactory(agent);
  return agent;
};

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
    },

    {
      id: 'data-validator',
      name: 'Data Validator',
      description: 'Validates and cleans data according to specified rules',
      type: 'smart' as const,
      category: 'Data Processing',
      tags: ['validation', 'data-quality', 'cleaning'],
      inputs: [
        { name: 'input_data', displayName: 'Input Data', type: 'json', required: true, description: 'Data to validate and clean' },
        { name: 'validation_rules', displayName: 'Validation Rules', type: 'json', required: true, description: 'Rules for data validation' }
      ],
      outputs: [
        { name: 'valid_data', displayName: 'Valid Data', type: 'json', required: true, description: 'Data that passed validation' },
        { name: 'invalid_data', displayName: 'Invalid Data', type: 'json', required: false, description: 'Data that failed validation' },
        { name: 'validation_report', displayName: 'Validation Report', type: 'json', required: true, description: 'Detailed validation results' }
      ],
      requiredIntegrations: [],
      configurationSchema: [
        { key: 'strict_mode', label: 'Strict Mode', type: 'boolean', required: false, defaultValue: false },
        { key: 'auto_fix', label: 'Auto Fix Issues', type: 'boolean', required: false, defaultValue: true }
      ]
    },

    {
      id: 'report-generator',
      name: 'Report Generator',
      description: 'Generates formatted reports from structured data',
      type: 'smart' as const,
      category: 'Reporting',
      tags: ['reports', 'formatting', 'visualization'],
      inputs: [
        { name: 'data_source', displayName: 'Data Source', type: 'json', required: true, description: 'Source data for the report' },
        { name: 'report_template', displayName: 'Report Template', type: 'text', required: false, description: 'Template for report formatting' }
      ],
      outputs: [
        { name: 'generated_report', displayName: 'Generated Report', type: 'text', required: true, description: 'The formatted report' },
        { name: 'report_metrics', displayName: 'Report Metrics', type: 'json', required: true, description: 'Summary metrics from the data' },
        { name: 'chart_data', displayName: 'Chart Data', type: 'json', required: false, description: 'Data formatted for charts' }
      ],
      requiredIntegrations: ['google-sheets', 'excel'],
      configurationSchema: [
        { key: 'output_format', label: 'Output Format', type: 'select', required: true, options: [
          { value: 'pdf', label: 'PDF' },
          { value: 'html', label: 'HTML' },
          { value: 'markdown', label: 'Markdown' }
        ]},
        { key: 'include_charts', label: 'Include Charts', type: 'boolean', required: false, defaultValue: true }
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
    case 'data-validator':
      return createDataValidatorExecutor(agent);
    case 'report-generator':
      return createReportGeneratorExecutor(agent);
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
    const errors: Array<{ field: string; message: string; code: string }> = [];
    
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
    } catch (error: any) {
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
    const errors: Array<{ field: string; message: string; code: string }> = [];
    
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
    const errors: Array<{ field: string; message: string; code: string }> = [];
    
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

const createDataValidatorExecutor = (agent: AgentLibraryItem): AgentExecutor => ({
  async execute(inputs, configuration) {
    const startTime = Date.now();
    const { input_data, validation_rules } = inputs;
    const strictMode = configuration?.strict_mode || false;
    const autoFix = configuration?.auto_fix || true;
    
    await simulateAPICall('data-validation', 800);
    
    const dataArray = Array.isArray(input_data) ? input_data : [input_data];
    const validData = dataArray.filter(() => Math.random() > 0.2); // 80% pass rate
    const invalidData = dataArray.filter(() => Math.random() > 0.8); // 20% fail rate
    
    const validationReport = {
      totalRecords: dataArray.length,
      validRecords: validData.length,
      invalidRecords: invalidData.length,
      validationRate: (validData.length / dataArray.length * 100).toFixed(2) + '%',
      issues: invalidData.map((item, i) => ({
        recordIndex: i,
        issues: ['Invalid email format', 'Missing required field'][Math.floor(Math.random() * 2)]
      }))
    };

    return {
      success: true,
      outputs: {
        valid_data: validData,
        invalid_data: invalidData,
        validation_report: validationReport
      },
      executionTime: Date.now() - startTime,
      integrationsCalled: [],
      metadata: {
        recordsProcessed: dataArray.length,
        apiCallsMade: 1,
        dataSize: dataArray.length * 256
      }
    };
  },

  async validateInputs(inputs) {
    const errors: Array<{ field: string; message: string; code: string }> = [];
    
    if (!inputs.input_data) {
      errors.push({
        field: 'input_data',
        message: 'Input data is required',
        code: 'REQUIRED_FIELD_MISSING'
      });
    }

    if (!inputs.validation_rules) {
      errors.push({
        field: 'validation_rules',
        message: 'Validation rules are required',
        code: 'REQUIRED_FIELD_MISSING'
      });
    }

    return { isValid: errors.length === 0, errors };
  },

  getRequiredIntegrations() {
    return [];
  },

  async healthCheck() {
    return {
      healthy: true,
      issues: [],
      integrationStatus: {}
    };
  }
});

const createReportGeneratorExecutor = (agent: AgentLibraryItem): AgentExecutor => ({
  async execute(inputs, configuration) {
    const startTime = Date.now();
    const { data_source, report_template } = inputs;
    const outputFormat = configuration?.output_format || 'html';
    const includeCharts = configuration?.include_charts || true;
    
    await simulateAPICall('report-generation', 2000);
    
    const reportMetrics = {
      totalRecords: Array.isArray(data_source) ? data_source.length : 1,
      generatedAt: new Date().toISOString(),
      format: outputFormat,
      chartsIncluded: includeCharts
    };

    const chartData = includeCharts ? [
      { label: 'Category A', value: Math.floor(Math.random() * 100) },
      { label: 'Category B', value: Math.floor(Math.random() * 100) },
      { label: 'Category C', value: Math.floor(Math.random() * 100) }
    ] : null;

    const generatedReport = `
# Data Report - ${new Date().toLocaleDateString()}

## Summary
This report contains analysis of ${reportMetrics.totalRecords} records.

## Key Metrics
- Total Records: ${reportMetrics.totalRecords}
- Generated: ${reportMetrics.generatedAt}
- Format: ${reportMetrics.format}

${includeCharts ? '## Charts\nCharts have been generated and included in the chart_data output.' : ''}

## Conclusion
Report generation completed successfully.
    `.trim();

    return {
      success: true,
      outputs: {
        generated_report: generatedReport,
        report_metrics: reportMetrics,
        chart_data: chartData
      },
      executionTime: Date.now() - startTime,
      integrationsCalled: [],
      metadata: {
        recordsProcessed: reportMetrics.totalRecords,
        apiCallsMade: 1,
        dataSize: generatedReport.length
      }
    };
  },

  async validateInputs(inputs) {
    const errors: Array<{ field: string; message: string; code: string }> = [];
    
    if (!inputs.data_source) {
      errors.push({
        field: 'data_source',
        message: 'Data source is required',
        code: 'REQUIRED_FIELD_MISSING'
      });
    }

    return { isValid: errors.length === 0, errors };
  },

  getRequiredIntegrations() {
    return [];
  },

  async healthCheck() {
    return {
      healthy: true,
      issues: [],
      integrationStatus: {}
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
    const errors: Array<{ field: string; message: string; code: string }> = [];
    
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
      inputs: step.inputs?.map(input => ({
        name: input.name,
        displayName: input.name,
        type: input.type,
        required: input.required || false,
        description: input.description || ''
      })) || [],
      outputs: step.outputs?.map(output => ({
        name: output.name,
        displayName: output.name,
        type: output.type,
        required: output.required || false,
        description: output.description || ''
      })) || [],
      requiredIntegrations: [],
      configurationSchema: []
    };

    return createExecutableSmartAgent(baseAgent, createGenericExecutor);
  });
};