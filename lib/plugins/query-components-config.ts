/**
 * Query Components Configuration
 *
 * Defines how to parse and rebuild complex query strings for various plugins.
 * This allows the UI to break down query strings into editable components
 * and rebuild them when executing the workflow.
 */

export interface QueryComponentOption {
  value: string;
  label: string;
}

export interface QueryComponent {
  key: string;
  label: string;
  type: 'text' | 'keywords' | 'boolean' | 'select';
  pattern: string; // Pattern to build query part, e.g., "subject:({value})"
  parseRegex: string; // Regex to extract value from query string
  placeholder?: string;
  description?: string;
  options?: QueryComponentOption[]; // For select type
}

export interface QueryValidationRule {
  type: 'date_range_conflict' | 'required_dependency' | 'conflicting_flags' | 'at_least_one_required';
  fields: string[];
  message: string;
  // For date_range_conflict: compares two date fields to ensure valid range
  // For required_dependency: ensures field B is set when field A is set
  // For conflicting_flags: warns when both boolean fields are set (unlikely to return results)
  // For at_least_one_required: warns when none of the specified fields have values
}

export interface QueryComponentsConfig {
  syntax: string;
  description: string;
  components: QueryComponent[];
  validationRules?: QueryValidationRule[];
  examples?: Array<{
    description: string;
    components: Record<string, string | boolean>;
    result: string;
  }>;
}

export interface PluginQueryConfig {
  pluginKey: string;
  actionName: string;
  parameterName: string;
  config: QueryComponentsConfig;
}

/**
 * Parse a query string into component values
 */
export function parseQueryToComponents(
  query: string,
  config: QueryComponentsConfig
): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};

  for (const component of config.components) {
    // Skip operator fields during initial parse - they're derived from the main field
    if (component.key.endsWith('_operator')) {
      continue;
    }

    const regex = new RegExp(component.parseRegex, 'i');
    const match = query.match(regex);

    if (match) {
      if (component.type === 'boolean') {
        result[component.key] = true;
      } else {
        // Get the first capturing group, or the second if first is undefined
        const value = match[1] || match[2] || '';
        result[component.key] = value;

        // For keywords type, detect the operator used
        if (component.type === 'keywords' && value) {
          const operatorKey = `${component.key}_operator`;
          // Check if AND is used (case insensitive)
          if (/\s+AND\s+/i.test(value)) {
            result[operatorKey] = 'AND';
          } else {
            // Default to OR (most common in Gmail)
            result[operatorKey] = 'OR';
          }
        }
      }
    }
  }

  return result;
}

/**
 * Build a query string from component values
 */
export function buildQueryFromComponents(
  components: Record<string, string | boolean>,
  config: QueryComponentsConfig
): string {
  const parts: string[] = [];

  for (const component of config.components) {
    const value = components[component.key];

    if (value === undefined || value === '' || value === false) {
      continue;
    }

    // Skip operator fields - they modify other fields, not add to query directly
    if (component.key.endsWith('_operator')) {
      continue;
    }

    if (component.type === 'boolean' && value === true) {
      // Boolean patterns don't have {value} placeholder
      parts.push(component.pattern);
    } else if (typeof value === 'string' && value.trim()) {
      let processedValue = value.trim();

      // Check if this field has an associated operator
      const operatorKey = `${component.key}_operator`;
      const operator = components[operatorKey];

      // For keywords type with operator, process comma-separated values
      if (component.type === 'keywords' && operator && typeof operator === 'string') {
        // Split by comma or existing OR/AND, trim each term
        const terms = processedValue
          .split(/[,]|\s+OR\s+|\s+AND\s+/i)
          .map(t => t.trim())
          .filter(t => t.length > 0);

        if (terms.length > 1) {
          // Join with the selected operator
          processedValue = terms.join(` ${operator} `);
        } else if (terms.length === 1) {
          processedValue = terms[0];
        }
      }

      // Replace {value} placeholder with actual value
      parts.push(component.pattern.replace('{value}', processedValue));
    }
  }

  return parts.join(' ');
}

/**
 * Gmail search query components
 */
const gmailQueryConfig: QueryComponentsConfig = {
  syntax: 'gmail',
  description: 'Gmail search query with operators',
  components: [
    {
      key: 'subject',
      label: 'Subject Contains',
      type: 'keywords',
      pattern: 'subject:({value})',
      parseRegex: 'subject:\\(([^)]+)\\)|subject:(\\S+)',
      placeholder: 'Invoice, Receipt, Bill',
      description: 'Words to search in subject. Separate with commas - they will be combined with the operator below.'
    },
    {
      key: 'subject_operator',
      label: 'Subject Match',
      type: 'select',
      pattern: '', // This doesn't add to query directly, it modifies how 'subject' is built
      parseRegex: '(OR|AND)',
      options: [
        { value: 'OR', label: 'Any word (OR)' },
        { value: 'AND', label: 'All words (AND)' }
      ],
      description: 'Match any of the words or all of them'
    },
    {
      key: 'from',
      label: 'From (optional)',
      type: 'text',
      pattern: 'from:{value}',
      parseRegex: 'from:(\\S+)',
      placeholder: 'sender@example.com',
      description: 'Filter by sender email or name'
    },
    {
      key: 'to',
      label: 'To (optional)',
      type: 'text',
      pattern: 'to:{value}',
      parseRegex: 'to:(\\S+)',
      placeholder: 'recipient@example.com',
      description: 'Filter by recipient email'
    },
    {
      key: 'has_attachment',
      label: 'Has Attachment',
      type: 'boolean',
      pattern: 'has:attachment',
      parseRegex: 'has:attachment',
      description: 'Only show emails with attachments'
    },
    {
      key: 'filename',
      label: 'Attachment Type',
      type: 'select',
      pattern: 'filename:{value}',
      parseRegex: 'filename:(\\S+)',
      options: [
        { value: 'pdf', label: 'PDF' },
        { value: 'doc', label: 'Word Document' },
        { value: 'xls', label: 'Excel Spreadsheet' },
        { value: 'ppt', label: 'PowerPoint' },
        { value: 'jpg OR png OR gif', label: 'Images' },
        { value: 'zip OR rar', label: 'Archives' }
      ],
      description: 'Filter by attachment file type'
    },
    {
      key: 'newer_than',
      label: 'Newer Than',
      type: 'select',
      pattern: 'newer_than:{value}',
      parseRegex: 'newer_than:(\\S+)',
      options: [
        { value: '1d', label: '1 Day' },
        { value: '3d', label: '3 Days' },
        { value: '7d', label: '1 Week' },
        { value: '14d', label: '2 Weeks' },
        { value: '30d', label: '1 Month' },
        { value: '90d', label: '3 Months' }
      ],
      description: 'Show emails newer than the specified time'
    },
    {
      key: 'older_than',
      label: 'Older Than',
      type: 'select',
      pattern: 'older_than:{value}',
      parseRegex: 'older_than:(\\S+)',
      options: [
        { value: '1d', label: '1 Day' },
        { value: '7d', label: '1 Week' },
        { value: '30d', label: '1 Month' },
        { value: '90d', label: '3 Months' },
        { value: '1y', label: '1 Year' }
      ],
      description: 'Show emails older than the specified time'
    },
    {
      key: 'is_unread',
      label: 'Unread Only',
      type: 'boolean',
      pattern: 'is:unread',
      parseRegex: 'is:unread',
      description: 'Only show unread emails'
    },
    {
      key: 'is_starred',
      label: 'Starred Only',
      type: 'boolean',
      pattern: 'is:starred',
      parseRegex: 'is:starred',
      description: 'Only show starred emails'
    },
    {
      key: 'label',
      label: 'Label',
      type: 'text',
      pattern: 'label:{value}',
      parseRegex: 'label:(\\S+)',
      placeholder: 'important',
      description: 'Filter by Gmail label'
    },
    {
      key: 'in_folder',
      label: 'Folder',
      type: 'select',
      pattern: 'in:{value}',
      parseRegex: 'in:(\\S+)',
      options: [
        { value: 'inbox', label: 'Inbox' },
        { value: 'sent', label: 'Sent' },
        { value: 'drafts', label: 'Drafts' },
        { value: 'spam', label: 'Spam' },
        { value: 'trash', label: 'Trash' },
        { value: 'anywhere', label: 'Anywhere' }
      ],
      description: 'Search in specific folder'
    }
  ],
  validationRules: [
    {
      type: 'date_range_conflict',
      fields: ['newer_than', 'older_than'],
      message: 'Invalid date range: "Newer Than" must be a longer period than "Older Than" to create a valid range. For example, "Newer Than 30 days" + "Older Than 7 days" finds emails between 7-30 days old.'
    },
    {
      type: 'required_dependency',
      fields: ['filename', 'has_attachment'],
      message: 'Searching by "Attachment Type" requires "Has Attachment" to be enabled, otherwise the filter may not work correctly.'
    },
    {
      type: 'at_least_one_required',
      fields: ['subject', 'from', 'to', 'has_attachment', 'newer_than', 'older_than', 'is_unread', 'is_starred', 'label', 'in_folder'],
      message: 'Please specify at least one search criterion (subject, sender, date range, etc.) to filter emails.'
    }
  ],
  examples: [
    {
      description: 'Find PDF invoices from the last week',
      components: { subject: 'Invoice', has_attachment: true, filename: 'pdf', newer_than: '7d' },
      result: 'subject:(Invoice) has:attachment filename:pdf newer_than:7d'
    },
    {
      description: 'Unread emails from specific sender',
      components: { from: 'boss@company.com', is_unread: true },
      result: 'from:boss@company.com is:unread'
    }
  ]
};

/**
 * Outlook email search query components (Microsoft Graph API)
 * Uses OData $search and $filter parameters
 */
const outlookQueryConfig: QueryComponentsConfig = {
  syntax: 'outlook',
  description: 'Outlook email search with Microsoft Graph',
  components: [
    {
      key: 'search_query',
      label: 'Search Keywords',
      type: 'keywords',
      pattern: '{value}',
      parseRegex: '^(.+)$',
      placeholder: 'Invoice, Receipt, Bill',
      description: 'Keywords to search in subject, body, from, and to fields'
    },
    {
      key: 'search_query_operator',
      label: 'Keyword Match',
      type: 'select',
      pattern: '',
      parseRegex: '(OR|AND)',
      options: [
        { value: 'OR', label: 'Any word (OR)' },
        { value: 'AND', label: 'All words (AND)' }
      ],
      description: 'Match any of the words or all of them'
    },
    {
      key: 'folder',
      label: 'Folder',
      type: 'select',
      pattern: '',
      parseRegex: '',
      options: [
        { value: 'inbox', label: 'Inbox' },
        { value: 'sentitems', label: 'Sent Items' },
        { value: 'drafts', label: 'Drafts' },
        { value: 'deleteditems', label: 'Deleted Items' }
      ],
      description: 'Search in specific folder'
    },
    {
      key: 'has_attachments',
      label: 'Has Attachments',
      type: 'boolean',
      pattern: 'hasAttachments:true',
      parseRegex: 'hasAttachments:true',
      description: 'Only show emails with attachments'
    },
    {
      key: 'is_read',
      label: 'Read Status',
      type: 'select',
      pattern: 'isRead:{value}',
      parseRegex: 'isRead:(true|false)',
      options: [
        { value: 'false', label: 'Unread Only' },
        { value: 'true', label: 'Read Only' }
      ],
      description: 'Filter by read/unread status'
    },
    {
      key: 'importance',
      label: 'Importance',
      type: 'select',
      pattern: 'importance:{value}',
      parseRegex: 'importance:(low|normal|high)',
      options: [
        { value: 'high', label: 'High' },
        { value: 'normal', label: 'Normal' },
        { value: 'low', label: 'Low' }
      ],
      description: 'Filter by importance level'
    },
    {
      key: 'from_date',
      label: 'From Date',
      type: 'text',
      pattern: 'received>={value}',
      parseRegex: 'received>=([\\d-T:Z]+)',
      placeholder: '2024-01-01',
      description: 'Emails received after this date (YYYY-MM-DD)'
    },
    {
      key: 'to_date',
      label: 'To Date',
      type: 'text',
      pattern: 'received<={value}',
      parseRegex: 'received<=([\\d-T:Z]+)',
      placeholder: '2024-12-31',
      description: 'Emails received before this date (YYYY-MM-DD)'
    }
  ],
  validationRules: [
    {
      type: 'date_range_conflict',
      fields: ['from_date', 'to_date'],
      message: 'Invalid date range: "From Date" must be before "To Date".'
    },
    {
      type: 'at_least_one_required',
      fields: ['search_query', 'has_attachments', 'is_read', 'importance', 'from_date', 'to_date'],
      message: 'Please specify at least one search criterion (keywords, attachments, read status, etc.) to filter emails.'
    }
  ],
  examples: [
    {
      description: 'Find unread invoices with attachments',
      components: { search_query: 'Invoice', has_attachments: true, is_read: 'false' },
      result: 'Invoice hasAttachments:true isRead:false'
    }
  ]
};

/**
 * OneDrive file search query components (Microsoft Graph API)
 */
const oneDriveQueryConfig: QueryComponentsConfig = {
  syntax: 'onedrive',
  description: 'OneDrive file search',
  components: [
    {
      key: 'search_query',
      label: 'Search Keywords',
      type: 'keywords',
      pattern: '{value}',
      parseRegex: '^(.+)$',
      placeholder: 'Report, Budget, Invoice',
      description: 'Keywords to search in file names and content'
    },
    {
      key: 'search_query_operator',
      label: 'Keyword Match',
      type: 'select',
      pattern: '',
      parseRegex: '(OR|AND)',
      options: [
        { value: 'OR', label: 'Any word (OR)' },
        { value: 'AND', label: 'All words (AND)' }
      ],
      description: 'Match any of the words or all of them'
    },
    {
      key: 'file_type',
      label: 'File Type',
      type: 'select',
      pattern: 'filetype:{value}',
      parseRegex: 'filetype:(\\w+)',
      options: [
        { value: 'pdf', label: 'PDF' },
        { value: 'docx', label: 'Word Document' },
        { value: 'xlsx', label: 'Excel Spreadsheet' },
        { value: 'pptx', label: 'PowerPoint' },
        { value: 'jpg', label: 'JPEG Image' },
        { value: 'png', label: 'PNG Image' }
      ],
      description: 'Filter by file type'
    }
  ],
  validationRules: [
    {
      type: 'at_least_one_required',
      fields: ['search_query', 'file_type'],
      message: 'Please specify at least search keywords or a file type to search for files.'
    }
  ],
  examples: [
    {
      description: 'Find PDF reports',
      components: { search_query: 'Report', file_type: 'pdf' },
      result: 'Report filetype:pdf'
    }
  ]
};

/**
 * Dropbox file search query components
 */
const dropboxQueryConfig: QueryComponentsConfig = {
  syntax: 'dropbox',
  description: 'Dropbox file search',
  components: [
    {
      key: 'search_query',
      label: 'Search Keywords',
      type: 'keywords',
      pattern: '{value}',
      parseRegex: '^(.+)$',
      placeholder: 'Invoice, Receipt, Document',
      description: 'Keywords to search in file names and content'
    },
    {
      key: 'search_query_operator',
      label: 'Keyword Match',
      type: 'select',
      pattern: '',
      parseRegex: '(OR|AND)',
      options: [
        { value: 'OR', label: 'Any word (OR)' },
        { value: 'AND', label: 'All words (AND)' }
      ],
      description: 'Match any of the words or all of them'
    },
    {
      key: 'file_extension',
      label: 'File Extension',
      type: 'select',
      pattern: '',
      parseRegex: '',
      options: [
        { value: 'pdf', label: 'PDF' },
        { value: 'docx', label: 'Word Document' },
        { value: 'xlsx', label: 'Excel Spreadsheet' },
        { value: 'pptx', label: 'PowerPoint' },
        { value: 'jpg', label: 'JPEG Image' },
        { value: 'png', label: 'PNG Image' },
        { value: 'txt', label: 'Text File' }
      ],
      description: 'Filter by file extension'
    }
  ],
  validationRules: [
    {
      type: 'at_least_one_required',
      fields: ['search_query', 'file_extension'],
      message: 'Please specify at least search keywords or a file extension to search for files.'
    }
  ],
  examples: [
    {
      description: 'Find PDF invoices',
      components: { search_query: 'Invoice', file_extension: 'pdf' },
      result: 'Invoice'
    }
  ]
};

/**
 * Google Drive search query components
 */
const googleDriveQueryConfig: QueryComponentsConfig = {
  syntax: 'drive',
  description: 'Google Drive search query with operators',
  components: [
    {
      key: 'name_contains',
      label: 'Name Contains',
      type: 'text',
      pattern: "name contains '{value}'",
      parseRegex: "name contains '([^']+)'",
      placeholder: 'Report',
      description: 'Search for files with this text in the name'
    },
    {
      key: 'full_text',
      label: 'Content Contains',
      type: 'text',
      pattern: "fullText contains '{value}'",
      parseRegex: "fullText contains '([^']+)'",
      placeholder: 'budget 2024',
      description: 'Search for files containing this text in content'
    },
    {
      key: 'mime_type',
      label: 'File Type',
      type: 'select',
      pattern: "mimeType = '{value}'",
      parseRegex: "mimeType = '([^']+)'",
      options: [
        { value: 'application/vnd.google-apps.document', label: 'Google Doc' },
        { value: 'application/vnd.google-apps.spreadsheet', label: 'Google Sheet' },
        { value: 'application/vnd.google-apps.presentation', label: 'Google Slides' },
        { value: 'application/pdf', label: 'PDF' },
        { value: 'image/jpeg', label: 'JPEG Image' },
        { value: 'image/png', label: 'PNG Image' },
        { value: 'application/vnd.google-apps.folder', label: 'Folder' }
      ],
      description: 'Filter by file type'
    },
    {
      key: 'modified_after',
      label: 'Modified After',
      type: 'text',
      pattern: "modifiedTime > '{value}'",
      parseRegex: "modifiedTime > '([^']+)'",
      placeholder: '2024-01-01',
      description: 'Files modified after this date (YYYY-MM-DD)'
    },
    {
      key: 'modified_before',
      label: 'Modified Before',
      type: 'text',
      pattern: "modifiedTime < '{value}'",
      parseRegex: "modifiedTime < '([^']+)'",
      placeholder: '2024-12-31',
      description: 'Files modified before this date (YYYY-MM-DD)'
    },
    {
      key: 'is_starred',
      label: 'Starred Only',
      type: 'boolean',
      pattern: 'starred = true',
      parseRegex: 'starred = true',
      description: 'Only show starred files'
    },
    {
      key: 'is_trashed',
      label: 'Include Trashed',
      type: 'boolean',
      pattern: 'trashed = true',
      parseRegex: 'trashed = true',
      description: 'Include files in trash'
    },
    {
      key: 'owner',
      label: 'Owner Email',
      type: 'text',
      pattern: "'{value}' in owners",
      parseRegex: "'([^']+)' in owners",
      placeholder: 'user@example.com',
      description: 'Files owned by this user'
    }
  ],
  validationRules: [
    {
      type: 'date_range_conflict',
      fields: ['modified_after', 'modified_before'],
      message: 'Invalid date range: "Modified After" date must be before "Modified Before" date.'
    },
    {
      type: 'conflicting_flags',
      fields: ['is_starred', 'is_trashed'],
      message: 'Warning: Searching for files that are both "Starred" and "Trashed" is unlikely to return results, as starred files are typically untrashed.'
    },
    {
      type: 'at_least_one_required',
      fields: ['name_contains', 'full_text', 'mime_type', 'modified_after', 'modified_before', 'is_starred', 'owner'],
      message: 'Please specify at least one search criterion (name, content, file type, date range, etc.) to filter files.'
    }
  ],
  examples: [
    {
      description: 'Find Google Docs containing budget',
      components: { full_text: 'budget', mime_type: 'application/vnd.google-apps.document' },
      result: "fullText contains 'budget' and mimeType = 'application/vnd.google-apps.document'"
    }
  ]
};

/**
 * Airtable filter formula components
 */
const airtableFilterConfig: QueryComponentsConfig = {
  syntax: 'airtable',
  description: 'Airtable filter formula',
  components: [
    {
      key: 'field_equals',
      label: 'Field Equals',
      type: 'text',
      pattern: '{{{field}}} = "{value}"',
      parseRegex: '\\{([^}]+)\\}\\s*=\\s*"([^"]+)"',
      placeholder: 'Status = "Active"',
      description: 'Filter where field equals value'
    },
    {
      key: 'field_contains',
      label: 'Field Contains',
      type: 'text',
      pattern: 'FIND("{value}", {{{field}}}) > 0',
      parseRegex: 'FIND\\("([^"]+)",\\s*\\{([^}]+)\\}\\)',
      placeholder: 'FIND("keyword", {Name})',
      description: 'Filter where field contains text'
    },
    {
      key: 'field_not_empty',
      label: 'Field Not Empty',
      type: 'text',
      pattern: '{{{field}}} != ""',
      parseRegex: '\\{([^}]+)\\}\\s*!=\\s*""',
      placeholder: 'Email',
      description: 'Filter where field is not empty'
    },
    {
      key: 'field_is_empty',
      label: 'Field Is Empty',
      type: 'text',
      pattern: '{{{field}}} = ""',
      parseRegex: '\\{([^}]+)\\}\\s*=\\s*""',
      placeholder: 'Notes',
      description: 'Filter where field is empty'
    },
    {
      key: 'date_after',
      label: 'Date After',
      type: 'text',
      pattern: "IS_AFTER({{{field}}}, '{value}')",
      parseRegex: "IS_AFTER\\(\\{([^}]+)\\},\\s*'([^']+)'\\)",
      placeholder: 'Created > 2024-01-01',
      description: 'Filter where date field is after value'
    },
    {
      key: 'checkbox_is_true',
      label: 'Checkbox is True',
      type: 'text',
      pattern: '{{{field}}} = TRUE()',
      parseRegex: '\\{([^}]+)\\}\\s*=\\s*TRUE\\(\\)',
      placeholder: 'Completed',
      description: 'Filter where checkbox field is checked'
    }
  ],
  examples: [
    {
      description: 'Find active records',
      components: { field_equals: 'Status|Active' },
      result: '{Status} = "Active"'
    }
  ]
};

/**
 * Registry of all plugin query configurations
 */
export const PLUGIN_QUERY_CONFIGS: PluginQueryConfig[] = [
  {
    pluginKey: 'google-mail',
    actionName: 'search_emails',
    parameterName: 'query',
    config: gmailQueryConfig
  },
  {
    pluginKey: 'google-drive',
    actionName: 'search_files',
    parameterName: 'query',
    config: googleDriveQueryConfig
  },
  {
    pluginKey: 'outlook',
    actionName: 'search_emails',
    parameterName: 'query',
    config: outlookQueryConfig
  },
  {
    pluginKey: 'onedrive',
    actionName: 'search_files',
    parameterName: 'query',
    config: oneDriveQueryConfig
  },
  {
    pluginKey: 'dropbox',
    actionName: 'search_files',
    parameterName: 'query',
    config: dropboxQueryConfig
  },
  {
    pluginKey: 'airtable',
    actionName: 'list_records',
    parameterName: 'filter_by_formula',
    config: airtableFilterConfig
  }
];

/**
 * Get query config for a specific plugin/action/parameter combination
 */
export function getQueryConfig(
  pluginKey: string,
  actionName: string,
  parameterName: string
): QueryComponentsConfig | null {
  const config = PLUGIN_QUERY_CONFIGS.find(
    c => c.pluginKey === pluginKey &&
         c.actionName === actionName &&
         c.parameterName === parameterName
  );
  return config?.config || null;
}

/**
 * Check if a parameter has query components configuration
 */
export function hasQueryComponents(
  pluginKey: string,
  actionName: string,
  parameterName: string
): boolean {
  return getQueryConfig(pluginKey, actionName, parameterName) !== null;
}

/**
 * Validation error returned by validateQueryComponents
 */
export interface QueryValidationError {
  type: string;
  fields: string[];
  message: string;
}

/**
 * Parse duration string to days (e.g., "7d" -> 7, "1y" -> 365)
 */
function parseDurationToDays(duration: string): number {
  const match = duration.match(/^(\d+)([dmy])$/i);
  if (!match) return 0;

  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();

  switch (unit) {
    case 'd': return value;
    case 'm': return value * 30; // approximate
    case 'y': return value * 365;
    default: return 0;
  }
}

/**
 * Parse ISO date string to timestamp for comparison
 */
function parseISODateToTimestamp(dateStr: string): number {
  // Try parsing as ISO date (YYYY-MM-DD or full ISO)
  const date = new Date(dateStr);
  return isNaN(date.getTime()) ? 0 : date.getTime();
}

/**
 * Validate query components against validation rules
 * Returns array of validation errors (empty if valid)
 */
export function validateQueryComponents(
  components: Record<string, string | boolean>,
  config: QueryComponentsConfig
): QueryValidationError[] {
  const errors: QueryValidationError[] = [];

  if (!config.validationRules) {
    return errors;
  }

  for (const rule of config.validationRules) {
    switch (rule.type) {
      case 'date_range_conflict': {
        // Check if both date fields are set and have conflicting values
        const [newerField, olderField] = rule.fields;
        const newerValue = components[newerField];
        const olderValue = components[olderField];

        if (newerValue && olderValue && typeof newerValue === 'string' && typeof olderValue === 'string') {
          // For Gmail-style duration values (e.g., "7d", "30d")
          const newerDays = parseDurationToDays(newerValue);
          const olderDays = parseDurationToDays(olderValue);

          if (newerDays > 0 && olderDays > 0) {
            // newer_than:7d means emails from last 7 days
            // older_than:30d means emails older than 30 days
            // Valid: newer_than:30d AND older_than:7d (emails between 7-30 days old)
            // Invalid: newer_than:7d AND older_than:30d (nothing can be both newer than 7d AND older than 30d)
            if (newerDays <= olderDays) {
              errors.push({
                type: rule.type,
                fields: rule.fields,
                message: rule.message
              });
            }
          } else {
            // For ISO date strings (e.g., "2024-01-01")
            const newerTimestamp = parseISODateToTimestamp(newerValue);
            const olderTimestamp = parseISODateToTimestamp(olderValue);

            // modified_after (newerField) should be BEFORE modified_before (olderField)
            if (newerTimestamp > 0 && olderTimestamp > 0 && newerTimestamp >= olderTimestamp) {
              errors.push({
                type: rule.type,
                fields: rule.fields,
                message: rule.message
              });
            }
          }
        }
        break;
      }

      case 'required_dependency': {
        // Check if field A is set, field B must also be set
        const [dependentField, requiredField] = rule.fields;
        const dependentValue = components[dependentField];
        const requiredValue = components[requiredField];

        if (dependentValue && !requiredValue) {
          errors.push({
            type: rule.type,
            fields: rule.fields,
            message: rule.message
          });
        }
        break;
      }

      case 'conflicting_flags': {
        // Check if both boolean fields are set (which is unlikely to return results)
        const allFieldsSet = rule.fields.every(field => {
          const value = components[field];
          return value === true || value === 'true';
        });

        if (allFieldsSet) {
          errors.push({
            type: rule.type,
            fields: rule.fields,
            message: rule.message
          });
        }
        break;
      }

      case 'at_least_one_required': {
        // Check if at least one of the specified fields has a value
        const anyFieldSet = rule.fields.some(field => {
          const value = components[field];
          if (typeof value === 'boolean') return value;
          if (typeof value === 'string') return value.trim().length > 0;
          return false;
        });

        if (!anyFieldSet) {
          errors.push({
            type: rule.type,
            fields: rule.fields,
            message: rule.message
          });
        }
        break;
      }
    }
  }

  return errors;
}
