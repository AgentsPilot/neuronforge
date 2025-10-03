// Import data/run strategies (execution logic)
import { gmailDataStrategy } from './strategies/gmailDataStrategy';
import { googleDriveDataStrategy } from './strategies/googleDriveDataStrategy';
import { chatgptResearchStrategy } from './strategies/chatgptResearchStrategy';

// Import OAuth strategies (connection handling)
import { gmailStrategy as gmailOAuthStrategy } from './strategies/gmailPluginStrategy';
import { googleDriveStrategy as googleDriveOAuthStrategy } from './strategies/googleDrivePluginStrategy';

// Input template types
export interface InputTemplate {
  name: string;
  type: string;
  required: boolean;
  placeholder?: string;
  description: string;
  enum?: string[];
  runtime_populated?: boolean;
  sandboxFetch?: string;
  dependsOn?: string;
}

export interface OutputTemplate {
  type: string;
  description: string;
  schema?: Record<string, any>;
}

export interface PluginDefinition {
  key: string;
  label: string;
  displayName: string;
  icon?: string;
  category: string;
  capabilities: string[];
  usage: ('input' | 'output' | 'both')[];
  requiresMapping: boolean;
  
  // NEW: Input/Output templates for agent generation
  inputTemplates?: {
    [capability: string]: InputTemplate[];
  };
  outputTemplates?: {
    [capability: string]: OutputTemplate;
  };
  
  // Existing methods
  generateInputFields?: (usage: 'input' | 'output') => any[];
  generateOutputSchema?: (usage: 'input' | 'output', prompt: string) => any;
  run: (args: any) => Promise<any>;
  fetchContext?: (userId: string, input: Record<string, any>) => Promise<any>;
  
  // OAuth connection methods
  connect?: (params: { supabase: any; popup: Window; userId: string }) => Promise<void>;
  handleOAuthCallback?: (params: { code: string; state: string; supabase?: any }) => Promise<any>;
  refreshToken?: (connection: any) => Promise<any>;
}

// Single source of truth - Plugin Registry
export const pluginRegistry: Record<string, PluginDefinition> = {
  'google-mail': {
    key: 'google-mail',
    label: 'Gmail',
    displayName: 'Gmail',
    icon: '/icons/gmail.svg',
    category: 'communication',
    capabilities: ['read_email', 'send_email', 'draft_email', 'summarize_email', 'reply_email', 'search_email', 'filter_email'],
    usage: ['input', 'output'],
    requiresMapping: false,
    
    // Input templates for each capability
    inputTemplates: {
      'read_email': [
        {
          name: 'gmail_label',
          type: 'gmail_label_select',
          required: false,
          placeholder: 'Select label during testing',
          description: 'Gmail label to filter emails (inbox, sent, custom labels)',
          runtime_populated: true,
          sandboxFetch: '/api/plugins/gmail/labels'
        },
        {
          name: 'sender_filter',
          type: 'string',
          required: false,
          placeholder: 'sender@example.com',
          description: 'Filter emails from specific sender'
        },
        {
          name: 'subject_keywords',
          type: 'string',
          required: false,
          placeholder: 'important, urgent, meeting',
          description: 'Keywords to search in email subjects'
        },
        {
          name: 'date_range',
          type: 'select',
          required: false,
          enum: ['today', 'yesterday', 'last_week', 'last_month', 'custom'],
          description: 'Time range for email search'
        },
        {
          name: 'max_results',
          type: 'number',
          required: false,
          placeholder: '10',
          description: 'Maximum number of emails to retrieve'
        }
      ],
      'send_email': [
        {
          name: 'recipient_email',
          type: 'email',
          required: true,
          placeholder: 'recipient@example.com',
          description: 'Email address to send to'
        },
        {
          name: 'subject_template',
          type: 'string',
          required: true,
          placeholder: 'Daily Report - {{date}}',
          description: 'Email subject line (supports templates)'
        },
        {
          name: 'email_format',
          type: 'select',
          required: false,
          enum: ['html', 'plain', 'markdown'],
          description: 'Email content format'
        }
      ],
      'search_email': [
        {
          name: 'search_query',
          type: 'string',
          required: true,
          placeholder: 'has:attachment from:john',
          description: 'Gmail search query syntax'
        },
        {
          name: 'search_scope',
          type: 'select',
          required: false,
          enum: ['all', 'inbox', 'sent', 'drafts'],
          description: 'Scope of email search'
        }
      ]
    },

    // Output templates
    outputTemplates: {
      'read_email': {
        type: 'EmailList',
        description: 'List of emails matching the criteria',
        schema: {
          emails: 'array',
          count: 'number',
          hasMore: 'boolean'
        }
      },
      'send_email': {
        type: 'EmailSent',
        description: 'Confirmation of sent email',
        schema: {
          messageId: 'string',
          threadId: 'string',
          success: 'boolean'
        }
      }
    },

    run: gmailDataStrategy.run,
    fetchContext: gmailDataStrategy.fetchContext,
    connect: gmailOAuthStrategy.connect,
    handleOAuthCallback: gmailOAuthStrategy.handleOAuthCallback,
    refreshToken: gmailOAuthStrategy.refreshToken,
  },

  'google-drive': {
    key: 'google-drive',
    label: 'Google Drive',
    displayName: 'Google Drive',
    icon: '/icons/google-drive.svg',
    category: 'storage',
    capabilities: ['read_files', 'upload_files', 'download_files', 'delete_files', 'search_files', 'create_folder', 'move_files', 'share_files'],
    usage: ['input', 'output'],
    requiresMapping: false,

    inputTemplates: {
      'upload_files': [
        {
          name: 'folder_path',
          type: 'gdrive_folder_select',
          required: false,
          placeholder: 'Select folder during testing',
          description: 'Google Drive folder to save files',
          runtime_populated: true,
          sandboxFetch: '/api/plugins/google-drive/folders'
        },
        {
          name: 'file_naming_pattern',
          type: 'string',
          required: false,
          placeholder: 'Report_{{date}}_{{time}}',
          description: 'Pattern for naming uploaded files'
        },
        {
          name: 'sharing_permissions',
          type: 'select',
          required: false,
          enum: ['private', 'anyone_with_link', 'domain', 'public'],
          description: 'File sharing permissions'
        },
        {
          name: 'file_format',
          type: 'select',
          required: false,
          enum: ['pdf', 'docx', 'xlsx', 'txt', 'original'],
          description: 'Format to save file in'
        }
      ],
      'read_files': [
        {
          name: 'folder_path',
          type: 'gdrive_folder_select',
          required: false,
          placeholder: 'Select folder during testing',
          description: 'Google Drive folder to search in',
          runtime_populated: true,
          sandboxFetch: '/api/plugins/google-drive/folders'
        },
        {
          name: 'file_pattern',
          type: 'string',
          required: false,
          placeholder: '*.pdf, Report_*',
          description: 'File name pattern or search term'
        },
        {
          name: 'file_type_filter',
          type: 'select',
          required: false,
          enum: ['all', 'documents', 'spreadsheets', 'presentations', 'images', 'pdfs'],
          description: 'Filter by file type'
        },
        {
          name: 'modified_date',
          type: 'select',
          required: false,
          enum: ['any', 'today', 'last_week', 'last_month'],
          description: 'Filter by modification date'
        }
      ],
      'create_folder': [
        {
          name: 'parent_folder',
          type: 'gdrive_folder_select',
          required: false,
          placeholder: 'Select parent folder during testing',
          description: 'Parent folder for new folder',
          runtime_populated: true,
          sandboxFetch: '/api/plugins/google-drive/folders'
        },
        {
          name: 'folder_name_pattern',
          type: 'string',
          required: true,
          placeholder: 'Reports_{{date}}',
          description: 'Name pattern for new folder'
        }
      ]
    },

    outputTemplates: {
      'upload_files': {
        type: 'DriveFileUploaded',
        description: 'Details of uploaded file',
        schema: {
          fileId: 'string',
          fileName: 'string',
          webViewLink: 'string',
          size: 'number'
        }
      },
      'read_files': {
        type: 'DriveFileList',
        description: 'List of files found',
        schema: {
          files: 'array',
          count: 'number',
          totalSize: 'number'
        }
      }
    },

    run: googleDriveDataStrategy.run,
    connect: googleDriveOAuthStrategy.connect,
    handleOAuthCallback: googleDriveOAuthStrategy.handleOAuthCallback,
    refreshToken: googleDriveOAuthStrategy.refreshToken,
  },

  'chatgpt-research': {
    key: 'chatgpt-research',
    label: 'ChatGPT Research',
    displayName: 'Research',
    icon: '/icons/openai.svg',
    category: 'ai',
    capabilities: ['research', 'analyze', 'summarize', 'generate_content', 'answer_questions'],
    usage: ['input', 'output'],
    requiresMapping: false,

    inputTemplates: {
      'research': [
        {
          name: 'research_query',
          type: 'text',
          required: true,
          placeholder: 'What topic should I research?',
          description: 'Topic or question to research'
        },
        {
          name: 'research_depth',
          type: 'select',
          required: false,
          enum: ['brief', 'standard', 'comprehensive', 'deep_dive'],
          description: 'Level of detail for research'
        },
        {
          name: 'output_format',
          type: 'select',
          required: false,
          enum: ['paragraph', 'bullet_points', 'report', 'summary'],
          description: 'Format for research results'
        },
        {
          name: 'max_length',
          type: 'number',
          required: false,
          placeholder: '500',
          description: 'Maximum length in words'
        }
      ],
      'summarize': [
        {
          name: 'content_source',
          type: 'text',
          required: true,
          placeholder: 'Content to summarize',
          description: 'Text content to be summarized'
        },
        {
          name: 'summary_length',
          type: 'select',
          required: false,
          enum: ['one_sentence', 'brief', 'medium', 'detailed'],
          description: 'Desired summary length'
        },
        {
          name: 'summary_style',
          type: 'select',
          required: false,
          enum: ['neutral', 'bullet_points', 'executive', 'technical'],
          description: 'Style of summary'
        }
      ],
      'analyze': [
        {
          name: 'analysis_target',
          type: 'text',
          required: true,
          placeholder: 'Content to analyze',
          description: 'Data or content to analyze'
        },
        {
          name: 'analysis_type',
          type: 'select',
          required: false,
          enum: ['sentiment', 'themes', 'trends', 'insights', 'comparison'],
          description: 'Type of analysis to perform'
        },
        {
          name: 'focus_areas',
          type: 'string',
          required: false,
          placeholder: 'key metrics, trends, issues',
          description: 'Specific areas to focus analysis on'
        }
      ]
    },

    outputTemplates: {
      'research': {
        type: 'ResearchReport',
        description: 'Comprehensive research findings',
        schema: {
          summary: 'string',
          keyFindings: 'array',
          sources: 'array',
          confidence: 'number'
        }
      },
      'summarize': {
        type: 'ContentSummary',
        description: 'Summarized content',
        schema: {
          summary: 'string',
          keyPoints: 'array',
          originalLength: 'number',
          summaryLength: 'number'
        }
      },
      'analyze': {
        type: 'AnalysisResult',
        description: 'Analysis findings and insights',
        schema: {
          insights: 'array',
          metrics: 'object',
          recommendations: 'array',
          confidence: 'number'
        }
      }
    },

    run: chatgptResearchStrategy.run,
  },
};

// Utility to get input templates for a specific capability
export const getInputTemplatesForCapability = (pluginKey: string, capability: string): InputTemplate[] => {
  const plugin = getPluginDefinition(pluginKey);
  return plugin?.inputTemplates?.[capability] || [];
};

// Utility to get output template for a specific capability
export const getOutputTemplateForCapability = (pluginKey: string, capability: string): OutputTemplate | null => {
  const plugin = getPluginDefinition(pluginKey);
  return plugin?.outputTemplates?.[capability] || null;
};

// Generate input schema for agent based on capabilities used
export const generateInputSchemaForCapabilities = (pluginCapabilities: { plugin: string; capability: string }[]): InputTemplate[] => {
  const inputSchema: InputTemplate[] = [];
  
  pluginCapabilities.forEach(({ plugin, capability }) => {
    const templates = getInputTemplatesForCapability(plugin, capability);
    templates.forEach(template => {
      // Avoid duplicates by checking if field name already exists
      if (!inputSchema.find(field => field.name === template.name)) {
        inputSchema.push(template);
      }
    });
  });
  
  return inputSchema;
};

// Utility functions
export const isPluginAvailable = (pluginKey: string): boolean => {
  return pluginKey in pluginRegistry && !!pluginRegistry[pluginKey].run;
}

export const getAvailablePlugins = (): string[] => {
  return Object.keys(pluginRegistry);
}

export const getPluginDefinition = (pluginKey: string): PluginDefinition | undefined => {
  return pluginRegistry[pluginKey];
}

export const getConnectedPluginsWithMetadata = (connectedPluginKeys: string[]) => {
  return connectedPluginKeys
    .map(key => {
      const definition = getPluginDefinition(key);
      if (!definition) return null;
      
      return { 
        ...definition, 
        isConnected: true,
        displayName: definition.displayName || definition.label || key
      };
    })
    .filter(Boolean) as (PluginDefinition & { isConnected: boolean })[];
}

export const getPluginDisplayNames = (pluginKeys: string[], pluginData?: PluginDefinition[]): string[] => {
  return pluginKeys.map(key => {
    if (pluginData) {
      const plugin = pluginData.find(p => p.key === key);
      if (plugin) return plugin.displayName || plugin.label;
    }
    
    const definition = getPluginDefinition(key);
    if (definition) return definition.displayName || definition.label;
    
    return key.replace(/[-_]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  });
}

// Dynamic service detection using plugin registry
export function detectRequiredPlugins(prompt: string): string[] {
  const lowerPrompt = prompt.toLowerCase();
  const detectedServices: string[] = [];
  
  // Check against registered plugins
  for (const [pluginKey, pluginDef] of Object.entries(pluginRegistry)) {
    const serviceName = pluginDef.label.toLowerCase();
    const keyVariations = [
      pluginKey,
      serviceName,
      serviceName.replace(/\s+/g, ''),
      serviceName.replace(/\s+/g, '_'),
      serviceName.replace(/\s+/g, '-')
    ];
    
    // Check plugin capabilities for semantic matching
    const capabilityKeywords = pluginDef.capabilities.map(cap => 
      cap.replace(/_/g, ' ').toLowerCase()
    );
    
    // Check if prompt mentions this plugin by name or capability
    const isDetected = keyVariations.some(variation => 
      lowerPrompt.includes(variation)
    ) || capabilityKeywords.some(capability => 
      lowerPrompt.includes(capability)
    );
    
    if (isDetected) {
      detectedServices.push(pluginKey);
    }
  }
  
  const uniqueServices = [...new Set(detectedServices)];
  console.log(`Detected required plugins: ${uniqueServices.join(',')}`);
  return uniqueServices;
}

export function validatePluginRequirements(prompt: string, connectedPlugins: string[]): { 
  isValid: boolean;
  missingPlugins: string[];
  requiredServices: string[];
  unsupportedServices: string[];
} {
  const requiredServices = detectRequiredPlugins(prompt);
  
  const missingPlugins: string[] = [];
  const unsupportedServices: string[] = [];
  
  for (const required of requiredServices) {
    if (required in pluginRegistry) {
      if (!connectedPlugins.includes(required)) {
        missingPlugins.push(required);
      }
    } else {
      unsupportedServices.push(required);
    }
  }
  
  const allMissingServices = [...missingPlugins, ...unsupportedServices];
  
  console.log('Plugin validation result:', {
    requiredServices,
    connectedPlugins,
    missingPlugins,
    unsupportedServices,
    isValid: allMissingServices.length === 0
  });
  
  return {
    isValid: allMissingServices.length === 0,
    missingPlugins: allMissingServices,
    requiredServices,
    unsupportedServices
  };
}

export function getPluginCapabilitiesContext(connectedPluginKeys: string[]): string {
  const connectedPlugins = getConnectedPluginsWithMetadata(connectedPluginKeys);
  
  return connectedPlugins
    .map(plugin => `${plugin.label}: ${plugin.capabilities.join(', ')}`)
    .join(' | ');
}

console.log('Plugin Registry Loaded:', {
  totalPlugins: Object.keys(pluginRegistry).length,
  categories: [...new Set(Object.values(pluginRegistry).map(p => p.category))],
  pluginsWithInputTemplates: Object.values(pluginRegistry).filter(p => p.inputTemplates).length,
  pluginsWithOutputTemplates: Object.values(pluginRegistry).filter(p => p.outputTemplates).length
});