// app/test-plugins-v2/page.tsx
'use client';

import { useState, useEffect } from 'react';
import { PluginAPIClient } from '@/lib/client/plugin-api-client';
import { PluginInfo, UserPluginStatus, ExecutionResult } from '@/lib/types/plugin-types';
import { v4 as uuidv4 } from 'uuid';

interface DebugLog {
  timestamp: string;
  type: 'info' | 'error' | 'success';
  message: string;
}

type TabType = 'plugins' | 'ai-services' | 'thread-conversation';

const PARAMETER_TEMPLATES = {
  "google-mail": {
    send_email: {
      recipients: {
        to: ["recipient@example.com"],
        cc: ["cc@example.com"],
        bcc: []
      },
      content: {
        subject: "Test Email Subject",
        body: "This is a test email body.",
        html_body: "<p>This is a <strong>test</strong> email body.</p>"
      },
      options: {
        send_immediately: true,
        request_read_receipt: false
      }
    },
    search_emails: {
      query: "from:example@gmail.com subject:test",
      max_results: 5,
      include_attachments: false,
      folder: "inbox"
    },
    create_draft: {
      recipients: {
        to: ["recipient@example.com"],
        cc: [],
        bcc: []
      },
      content: {
        subject: "Draft Email Subject",
        body: "This is a draft email body.",
        html_body: "<p>This is a <strong>draft</strong> email body.</p>"
      },
      save_location: "drafts"
    }
  },
  "google-drive": {
    list_files: {
      folder_id: "1a2b3c4d5e6f7g8h9i0j",
      max_results: 20,
      order_by: "modifiedTime",
      file_types: ["document", "spreadsheet"],
      include_trashed: false
    },
    search_files: {
      query: "name contains 'budget'",
      max_results: 20,
      search_scope: "all",
      file_types: ["document", "spreadsheet"]
    },
    get_file_metadata: {
      file_id: "1a2b3c4d5e6f7g8h9i0j",
      include_permissions: false,
      include_export_links: false
    },
    read_file_content: {
      file_id: "1a2b3c4d5e6f7g8h9i0j",
      export_format: "text/plain",
      max_size_mb: 5
    },
    get_folder_contents: {
      folder_id: "1a2b3c4d5e6f7g8h9i0j",
      max_results: 50,
      recursive: false,
      order_by: "name"
    }
  },
  "google-sheets": {
    read_range: {
      spreadsheet_id: "1a2b3c4d5e6f7g8h9i0j",
      range: "Sheet1!A1:D10",
      include_formula_values: false,
      major_dimension: "ROWS"
    },
    write_range: {
      spreadsheet_id: "1a2b3c4d5e6f7g8h9i0j",
      range: "Sheet1!A1:D5",
      values: [
        ["Name", "Age", "City", "Score"],
        ["Alice", "30", "New York", "95"],
        ["Bob", "25", "San Francisco", "87"],
        ["Charlie", "35", "Boston", "92"],
        ["Diana", "28", "Seattle", "88"]
      ],
      input_option: "USER_ENTERED",
      overwrite_existing: true
    },
    append_rows: {
      spreadsheet_id: "1a2b3c4d5e6f7g8h9i0j",
      range: "Sheet1!A:D",
      values: [
        ["Eve", "32", "Chicago", "91"],
        ["Frank", "29", "Austin", "85"]
      ],
      input_option: "USER_ENTERED",
      insert_data_option: "INSERT_ROWS"
    },
    create_spreadsheet: {
      title: "Test Spreadsheet from API",
      sheet_names: ["Data", "Analysis", "Summary"],
      initial_data: {
        range: "A1",
        values: [
          ["Column 1", "Column 2", "Column 3"],
          ["Value 1", "Value 2", "Value 3"],
          ["Value 4", "Value 5", "Value 6"]
        ]
      }
    },
    get_spreadsheet_info: {
      spreadsheet_id: "1a2b3c4d5e6f7g8h9i0j",
      include_sheet_data: true,
      include_data_ranges: false
    }
  },
  "google-docs": {
    read_document: {
      document_id: "1a2b3c4d5e6f7g8h9i0j",
      include_formatting: false,
      plain_text_only: true
    },
    insert_text: {
      document_id: "1a2b3c4d5e6f7g8h9i0j",
      text: "This text will be inserted at the specified position in the document.",
      index: 1
    },
    append_text: {
      document_id: "1a2b3c4d5e6f7g8h9i0j",
      text: "This text will be appended to the end of the document.",
      add_line_break: true
    },
    create_document: {
      title: "Test Document from API",
      initial_content: "This is the initial content of the newly created document.\n\nIt can contain multiple paragraphs and will be added automatically when the document is created."
    },
    get_document_info: {
      document_id: "1a2b3c4d5e6f7g8h9i0j",
      include_content_summary: true
    }
  },
  "google-calendar": {
    list_events: {
      calendar_id: "primary",
      time_min: "2025-01-01T00:00:00Z",
      time_max: "2025-01-31T23:59:59Z",
      max_results: 50,
      single_events: true,
      order_by: "startTime"
    },
    create_event: {
      calendar_id: "primary",
      summary: "Team Meeting - Q1 Planning",
      description: "Quarterly planning session to discuss goals and objectives for Q1.",
      location: "Conference Room A",
      start_time: "2025-01-15T10:00:00Z",
      end_time: "2025-01-15T11:00:00Z",
      attendees: ["colleague1@example.com", "colleague2@example.com"],
      reminders: {
        use_default: false,
        overrides: [
          { method: "email", minutes: 60 },
          { method: "popup", minutes: 10 }
        ]
      },
      send_notifications: true,
      conference_solution: "hangoutsMeet"
    },
    update_event: {
      calendar_id: "primary",
      event_id: "abc123xyz456",
      summary: "Updated Team Meeting - Q1 Planning",
      description: "Updated description for quarterly planning session.",
      location: "Conference Room B",
      start_time: "2025-01-15T14:00:00Z",
      end_time: "2025-01-15T15:00:00Z",
      attendees: ["colleague1@example.com", "colleague2@example.com", "colleague3@example.com"],
      send_notifications: false
    },
    delete_event: {
      calendar_id: "primary",
      event_id: "abc123xyz456",
      send_notifications: false
    },
    get_event_details: {
      calendar_id: "primary",
      event_id: "abc123xyz456"
    }
  },
  "slack": {
    send_message: {
      channel_id: "C1234567890",
      message_text: "Hello from the Slack plugin! This is a test message.",
      thread_timestamp: "",
      as_user: true
    },
    read_messages: {
      channel_id: "C1234567890",
      limit: 20,
      oldest_timestamp: "",
      latest_timestamp: "",
      include_all_metadata: true
    },
    update_message: {
      channel_id: "C1234567890",
      message_timestamp: "1234567890.123456",
      new_message_text: "This message has been updated via the API."
    },
    add_reaction: {
      channel_id: "C1234567890",
      message_timestamp: "1234567890.123456",
      emoji_name: "thumbsup"
    },
    remove_reaction: {
      channel_id: "C1234567890",
      message_timestamp: "1234567890.123456",
      emoji_name: "thumbsup"
    },
    create_channel: {
      channel_name: "test-api-channel",
      is_private: false,
      description: "This channel was created via the Slack API for testing purposes."
    },
    list_channels: {
      types: "public_channel,private_channel",
      limit: 50,
      exclude_archived: true
    },
    list_users: {
      limit: 100,
      include_deleted: false
    },
    get_user_info: {
      user_id: "U1234567890"
    },
    upload_file: {
      filename: "test-file.txt",
      file_content: "VGhpcyBpcyBhIHRlc3QgZmlsZSB1cGxvYWRlZCB2aWEgdGhlIFNsYWNrIEFQSS4=",
      channel_ids: ["C1234567890"],
      title: "Test File Upload",
      initial_comment: "Here is the test file uploaded via the API."
    }
  },
  "hubspot": {
    "get_contact": {
      "contact_identifier": "test@example.com",
      "identifier_type": "email",
      "properties": ["firstname", "lastname", "email", "phone", "company", "lifecyclestage", "jobtitle"],
      "include_associations": true
    },
    "get_contact_deals": {
      "contact_id": "12345",
      "limit": 50,
      "include_deal_details": true,
      "deal_properties": ["dealname", "amount", "dealstage", "closedate", "pipeline", "hubspot_owner_id"]
    },
    "get_contact_activities": {
      "contact_id": "12345",
      "activity_types": ["calls", "emails", "notes", "meetings", "tasks"],
      "limit": 25,
      "since_date": ""
    },
    "search_contacts": {
      "query": "john",
      "filters": {},
      "limit": 25,
      "properties": ["firstname", "lastname", "email", "company", "phone"],
      "sort_by": "lastmodifieddate",
      "sort_direction": "DESCENDING"
    },
    "get_deal": {
      "deal_id": "67890",
      "properties": ["dealname", "amount", "dealstage", "closedate", "pipeline", "hubspot_owner_id", "createdate"],
      "include_associations": true
    }
  },
  "linkedin": {
    "get_profile": {
      "projection": "(id,firstName,lastName,profilePicture(displayImage~:playableStreams))"
    },
    "get_user_info": {},
    "create_post": {
      "text": "Excited to share my latest project! This is a test post created via the LinkedIn API. #automation #innovation",
      "visibility": "PUBLIC",
      "media_url": "https://example.com/article",
      "media_title": "Check out this article",
      "media_description": "An interesting article about API automation"
    },
    "get_posts": {
      "count": 10,
      "sort_by": "LAST_MODIFIED"
    },
    "get_organization": {
      "organization_id": "12345678"
    },
    "search_organizations": {
      "keywords": "technology consulting",
      "industry": "Information Technology and Services",
      "company_size": "51-200",
      "max_results": 10
    },
    "get_organization_posts": {
      "organization_id": "12345678",
      "count": 10
    },
    "get_connections": {
      "start": 0,
      "count": 50
    }
  },
  "airtable": {
    "list_bases": {},
    "list_records": {
      "base_id": "appXXXXXXXXXXXXXX",
      "table_name": "Contacts",
      "view": "All Contacts",
      "fields": ["Name", "Email", "Status", "Created"],
      "filter_by_formula": "{Status} = 'Active'",
      "sort": [
        {
          "field": "Created",
          "direction": "desc"
        }
      ],
      "max_records": 100,
      "page_size": 50
    },
    "get_record": {
      "base_id": "appXXXXXXXXXXXXXX",
      "table_name": "Contacts",
      "record_id": "recXXXXXXXXXXXXXX"
    },
    "create_records": {
      "base_id": "appXXXXXXXXXXXXXX",
      "table_name": "Contacts",
      "records": [
        {
          "fields": {
            "Name": "John Doe",
            "Email": "john.doe@example.com",
            "Status": "Active",
            "Notes": "New contact added via API"
          }
        },
        {
          "fields": {
            "Name": "Jane Smith",
            "Email": "jane.smith@example.com",
            "Status": "Pending",
            "Notes": "Follow up needed"
          }
        }
      ],
      "typecast": true
    },
    "update_records": {
      "base_id": "appXXXXXXXXXXXXXX",
      "table_name": "Contacts",
      "records": [
        {
          "id": "recXXXXXXXXXXXXXX",
          "fields": {
            "Status": "Complete",
            "Notes": "Updated via API"
          }
        }
      ],
      "typecast": true,
      "destructive": false
    },
    "list_tables": {
      "base_id": "appXXXXXXXXXXXXXX"
    },
    "upload_attachment": {
      "base_id": "appXXXXXXXXXXXXXX",
      "table_name": "Contacts",
      "record_id": "recXXXXXXXXXXXXXX",
      "field_name": "Attachments",
      "attachment": {
        "url": "https://example.com/documents/sample.pdf",
        "filename": "sample.pdf"
      }
    },
    "get_attachment_urls": {
      "base_id": "appXXXXXXXXXXXXXX",
      "table_name": "Contacts",
      "record_id": "recXXXXXXXXXXXXXX",
      "field_name": "Attachments"
    }
  }
};

const AI_SERVICE_TEMPLATES = {
  "analyze-prompt-clarity": {
    prompt: "Create an automation that sends me daily email summaries of my calendar events",
    userId: "test_user_123",
    sessionId: "550e8400-e29b-41d4-a716-446655440000",
    agentId: "660e8400-e29b-41d4-a716-446655440001",
    connected_plugins: {},
    bypassPluginValidation: false
  },
  "enhance-prompt": {
    prompt: "Send emails automatically",
    userId: "test_user_123",
    sessionId: "550e8400-e29b-41d4-a716-446655440000",
    agentId: "660e8400-e29b-41d4-a716-446655440001",
    clarificationAnswers: {
      "timing": "daily_9am",
      "recipients": "manager@example.com"
    },
    connected_plugins: {},
    missingPlugins: [],
    pluginWarning: null
  },
  "generate-clarification-questions": {
    prompt: "I need to track project tasks and send updates",
    agentName: "Task Tracker Agent",
    description: "An agent that helps track project tasks and send updates",
    userId: "test_user_123",
    sessionId: "550e8400-e29b-41d4-a716-446655440000",
    agentId: "660e8400-e29b-41d4-a716-446655440001",
    connectedPlugins: {},
    analysis: {
      clarityScore: 45,
      questionsCount: 0,
      needsClarification: true,
      aiValidationFailed: false,
      bypassedPluginValidation: false,
      hadPluginWarning: false,
      missingPlugins: [],
      requiredServices: [],
      suggestions: []
    }
  }
};

export default function TestPluginsPage() {
  // Tab state
  const [activeTab, setActiveTab] = useState<TabType>('plugins');

  // Core state
  const [userId, setUserId] = useState('');
  const [apiClient] = useState(() => new PluginAPIClient());
  
  // Plugin data
  const [availablePlugins, setAvailablePlugins] = useState<PluginInfo[]>([]);
  const [userStatus, setUserStatus] = useState<UserPluginStatus | null>(null);
  const [selectedPlugin, setSelectedPlugin] = useState<string>('');
  const [selectedAction, setSelectedAction] = useState<string>('');
  
  // Execution state
  const [parameters, setParameters] = useState<string>('{}');
  const [lastResponse, setLastResponse] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);

  // AI Services state
  const [selectedAIService, setSelectedAIService] = useState<string>('');
  const [aiServiceRequestBody, setAiServiceRequestBody] = useState<string>('{}');
  const [aiServiceResponse, setAiServiceResponse] = useState<any>(null);

  // Thread Conversation state
  const [threadId, setThreadId] = useState<string | null>(null);
  const [currentPhase, setCurrentPhase] = useState<1 | 2 | 3>(1);
  const [initialPrompt, setInitialPrompt] = useState('');
  const [conversationHistory, setConversationHistory] = useState<Array<{
    role: 'user' | 'assistant';
    content: string;
    data?: any;
  }>>([]);
  const [currentQuestions, setCurrentQuestions] = useState<any[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [userAnswer, setUserAnswer] = useState('');
  const [clarificationAnswers, setClarificationAnswers] = useState<Record<string, string>>({});
  const [enhancedPrompt, setEnhancedPrompt] = useState<any>(null);
  const [clarityScore, setClarityScore] = useState(0);
  const [analysisData, setAnalysisData] = useState<any>(null);
  const [missingPlugins, setMissingPlugins] = useState<string[]>([]);

  // Debug logging
  const [debugLogs, setDebugLogs] = useState<DebugLog[]>([]);
  const addDebugLog = (type: 'info' | 'error' | 'success', message: string) => {
    const log: DebugLog = {
      timestamp: new Date().toLocaleTimeString(),
      type,
      message
    };
    setDebugLogs(prev => [...prev.slice(-49), log]); // Keep last 50 logs
  };

  const [copySuccess, setCopySuccess] = useState(false);
  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(lastResponse, null, 2));
      setCopySuccess(true);
      addDebugLog('success', 'Response copied to clipboard');
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (error: any) {
      addDebugLog('error', `Failed to copy: ${error.message}`);
    }
  };

  // Load available plugins on mount
  useEffect(() => {
    loadAvailablePlugins();
  }, []);

  // Load user status when userId changes
  useEffect(() => {
    if (userId.trim()) {
      loadUserStatus();
    } else {
      setUserStatus(null);
    }
  }, [userId]);

  // Update parameter template when action changes
  useEffect(() => {
    if (selectedPlugin && selectedAction) {
      updateParameterTemplate();
    }
  }, [selectedPlugin, selectedAction]);

  const loadAvailablePlugins = async () => {
    try {
      addDebugLog('info', 'Loading available plugins...');
      const plugins = await apiClient.getAvailablePlugins();
      setAvailablePlugins(plugins);
      addDebugLog('success', `Loaded ${plugins.length} available plugins`);
    } catch (error: any) {
      addDebugLog('error', `Failed to load plugins: ${error.message}`);
    }
  };

  const loadUserStatus = async () => {
    if (!userId.trim()) return;
    
    try {
      addDebugLog('info', `Loading status for user: ${userId}`);
      const status = await apiClient.getUserPluginStatus(userId);
      setUserStatus(status);
      addDebugLog('success', `User has ${status.summary.connected_count} connected, ${status.summary.disconnected_count} disconnected plugins`);
    } catch (error: any) {
      addDebugLog('error', `Failed to load user status: ${error.message}`);
      setUserStatus(null);
    }
  };

  const connectPlugin = async (pluginKey: string) => {
    if (!userId.trim()) {
      addDebugLog('error', 'User ID is required to connect plugins');
      return;
    }

    setIsLoading(true);
    try {
      addDebugLog('info', `Initiating OAuth for plugin: ${pluginKey}`);
      const result = await apiClient.connectPlugin(userId, pluginKey);
      
      if (result.success) {
        addDebugLog('success', `Successfully connected ${pluginKey}`);
        await loadUserStatus(); // Refresh status
      } else {
        addDebugLog('error', `Failed to connect ${pluginKey}: ${result.error}`);
      }
      
      setLastResponse(result);
    } catch (error: any) {
      addDebugLog('error', `Connection error: ${error.message}`);
      setLastResponse({ success: false, error: error.message });
    } finally {
      setIsLoading(false);
    }
  };

  const disconnectPlugin = async (pluginKey: string) => {
    if (!userId.trim()) {
      addDebugLog('error', 'User ID is required to disconnect plugins');
      return;
    }

    setIsLoading(true);
    try {
      addDebugLog('info', `Disconnecting plugin: ${pluginKey}`);
      const result = await apiClient.disconnectPlugin(userId, pluginKey);
      
      if (result.success) {
        addDebugLog('success', `Successfully disconnected ${pluginKey}`);
        await loadUserStatus(); // Refresh status
      } else {
        addDebugLog('error', `Failed to disconnect ${pluginKey}: ${result.error}`);
      }
      
      setLastResponse(result);
    } catch (error: any) {
      addDebugLog('error', `Disconnection error: ${error.message}`);
      setLastResponse({ success: false, error: error.message });
    } finally {
      setIsLoading(false);
    }
  };

  const executeAction = async () => {
    if (!userId.trim() || !selectedPlugin || !selectedAction) {
      addDebugLog('error', 'User ID, plugin, and action are required');
      return;
    }

    let parsedParameters;
    try {
      parsedParameters = JSON.parse(parameters);
    } catch (error) {
      addDebugLog('error', 'Invalid JSON in parameters');
      return;
    }

    setIsLoading(true);
    try {
      addDebugLog('info', `Executing ${selectedPlugin}.${selectedAction}`);
      const result = await apiClient.executeAction(userId, selectedPlugin, selectedAction, parsedParameters);
      
      if (result.success) {
        addDebugLog('success', `Action executed successfully`);
      } else {
        addDebugLog('error', `Action failed: ${result.error}`);
      }
      
      setLastResponse(result);
    } catch (error: any) {
      addDebugLog('error', `Execution error: ${error.message}`);
      setLastResponse({ success: false, error: error.message });
    } finally {
      setIsLoading(false);
    }
  };

  const updateParameterTemplate = () => {
    const template = (PARAMETER_TEMPLATES as any)[selectedPlugin]?.[selectedAction];
    if (template) {
      setParameters(JSON.stringify(template, null, 2));
      addDebugLog('info', `Loaded parameter template for ${selectedPlugin}.${selectedAction}`);
    } else {
      setParameters('{}');
      addDebugLog('info', `No template available for ${selectedPlugin}.${selectedAction}`);
    }
  };

  const getPluginActions = (pluginKey: string): string[] => {
    const plugin = availablePlugins.find(p => p.key === pluginKey);
    return plugin?.actions || [];
  };

  const isPluginConnected = (pluginKey: string): boolean => {
    return userStatus?.connected.some(p => p.key === pluginKey) || false;
  };

  const refreshAll = async () => {
    await loadAvailablePlugins();
    if (userId.trim()) {
      await loadUserStatus();
    }
    addDebugLog('info', 'Refreshed all data');
  };

  const clearLogs = () => {
    setDebugLogs([]);
  };

  // AI Services functions
  const generateNewSessionId = () => {
    const newSessionId = uuidv4();
    try {
      const currentBody = JSON.parse(aiServiceRequestBody);
      currentBody.sessionId = newSessionId;
      setAiServiceRequestBody(JSON.stringify(currentBody, null, 2));
      addDebugLog('success', `Generated new session ID: ${newSessionId}`);
    } catch (error: any) {
      addDebugLog('error', `Failed to update session ID: ${error.message}`);
    }
  };

  const generateNewAgentId = () => {
    const newAgentId = uuidv4();
    try {
      const currentBody = JSON.parse(aiServiceRequestBody);
      currentBody.agentId = newAgentId;
      setAiServiceRequestBody(JSON.stringify(currentBody, null, 2));
      addDebugLog('success', `Generated new agent ID: ${newAgentId}`);
    } catch (error: any) {
      addDebugLog('error', `Failed to update agent ID: ${error.message}`);
    }
  };

  const resetToAITemplate = () => {
    if (selectedAIService) {
      const template = (AI_SERVICE_TEMPLATES as any)[selectedAIService];
      if (template) {
        // Generate fresh UUIDs for the template
        const templateWithNewIds = {
          ...template,
          sessionId: uuidv4(),
          agentId: uuidv4()
        };
        setAiServiceRequestBody(JSON.stringify(templateWithNewIds, null, 2));
        addDebugLog('info', `Reset to template for ${selectedAIService} with new IDs`);
      }
    }
  };

  const executeAIService = async () => {
    if (!selectedAIService) {
      addDebugLog('error', 'AI service is required');
      return;
    }

    let parsedRequestBody;
    try {
      parsedRequestBody = JSON.parse(aiServiceRequestBody);
    } catch (error) {
      addDebugLog('error', 'Invalid JSON in request body');
      return;
    }

    setIsLoading(true);
    try {
      addDebugLog('info', `Calling AI service: /api/${selectedAIService}`);
      const response = await fetch(`/api/${selectedAIService}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': parsedRequestBody.userId || 'anonymous',
          'x-session-id': parsedRequestBody.sessionId || '',
          'x-agent-id': parsedRequestBody.agentId || '',
        },
        body: JSON.stringify(parsedRequestBody),
      });

      const result = await response.json();

      if (response.ok) {
        addDebugLog('success', `AI service executed successfully`);
      } else {
        addDebugLog('error', `AI service failed: ${result.error || 'Unknown error'}`);
      }

      setAiServiceResponse(result);
    } catch (error: any) {
      addDebugLog('error', `Execution error: ${error.message}`);
      setAiServiceResponse({ success: false, error: error.message });
    } finally {
      setIsLoading(false);
    }
  };

  // Update AI service template when selection changes
  useEffect(() => {
    if (selectedAIService) {
      resetToAITemplate();
    }
  }, [selectedAIService]);

  // Thread Conversation Functions
  const startThread = async () => {
    if (!userId || !initialPrompt.trim()) {
      addDebugLog('error', 'User ID and initial prompt are required');
      return;
    }

    try {
      setIsLoading(true);
      addDebugLog('info', 'Starting new thread...');

      const response = await fetch('/api/agent-creation/init-thread', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: userId,
          userPrompt: initialPrompt,
          userContext: {
            full_name: 'Test User',
            email: userId + '@example.com'
          }
        })
      });

      const data = await response.json();

      if (response.ok && data.thread_id) {
        setThreadId(data.thread_id);
        setCurrentPhase(1);

        // Add user message to history
        setConversationHistory([{
          role: 'user',
          content: initialPrompt,
          data: null
        }]);

        addDebugLog('success', `Thread created: ${data.thread_id}`);

        // Process Phase 1 - pass threadId directly since state hasn't updated yet
        await processMessage(1, undefined, data.thread_id);
      } else {
        const errorMsg = data.error || 'Unknown error';
        const errorDetails = data.details ? ` - ${data.details}` : '';
        addDebugLog('error', `Failed to create thread: ${errorMsg}${errorDetails}`);
      }
    } catch (error: any) {
      addDebugLog('error', `Thread creation error: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const processMessage = async (phase: number, answers?: Record<string, string>, explicitThreadId?: string) => {
    const currentThreadId = explicitThreadId || threadId;

    if (!currentThreadId) {
      addDebugLog('error', 'No active thread');
      return;
    }

    try {
      setIsLoading(true);
      addDebugLog('info', `Processing Phase ${phase}...`);

      const requestBody: any = {
        thread_id: currentThreadId,
        phase: phase
      };

      // Phase 1 requires user_prompt
      if (phase === 1) {
        requestBody.user_prompt = initialPrompt;
      }

      // Phase 2 can optionally include enhanced_prompt for refinement (V7 feature)
      if (phase === 2 && enhancedPrompt) {
        requestBody.enhanced_prompt = enhancedPrompt;
      }

      // Phase 3 requires clarification_answers
      if (phase === 3 && answers) {
        requestBody.clarification_answers = answers;
      }

      const response = await fetch('/api/agent-creation/process-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      const data = await response.json();

      if (response.ok) {
        // Store analysis data
        if (data.analysis) {
          setAnalysisData(data.analysis);
        }

        // Update clarity score and missing plugins
        if (data.clarityScore !== undefined) {
          setClarityScore(data.clarityScore);
        }
        if (data.missingPlugins) {
          setMissingPlugins(data.missingPlugins);
        }

        // Handle Phase 1 response - show analysis and proceed to Phase 2 if needed
        if (phase === 1) {
          // Add AI analysis to history
          setConversationHistory(prev => [...prev, {
            role: 'assistant',
            content: data.conversationalSummary || 'Analysis complete',
            data: { analysis: data.analysis, clarityScore: data.clarityScore }
          }]);

          addDebugLog('success', `Phase 1 complete - Clarity Score: ${data.clarityScore}%`);

          // If clarification is needed, proceed to Phase 2
          if (data.needsClarification) {
            addDebugLog('info', 'Clarification needed, proceeding to Phase 2...');
            await processMessage(2, undefined, currentThreadId);
          } else {
            // If no clarification needed, go directly to Phase 3
            addDebugLog('info', 'No clarification needed, proceeding to Phase 3...');
            await processMessage(3, {}, currentThreadId);
          }
        }
        // Handle Phase 2 response with questions
        else if (phase === 2 && data.questionsSequence && data.questionsSequence.length > 0) {
          setCurrentQuestions(data.questionsSequence);
          setCurrentQuestionIndex(0);
          setCurrentPhase(2);

          // Add AI response to history
          setConversationHistory(prev => [...prev, {
            role: 'assistant',
            content: data.conversationalSummary || 'Let me ask you some questions...',
            data: { questions: data.questionsSequence, analysis: data.analysis }
          }]);

          addDebugLog('success', `Phase 2 complete - ${data.questionsSequence.length} questions generated`);
        }
        // Handle Phase 3 response with enhanced prompt
        else if (phase === 3 && data.enhanced_prompt) {
          setEnhancedPrompt(data.enhanced_prompt);
          setCurrentPhase(3);

          // Add AI response to history
          setConversationHistory(prev => [...prev, {
            role: 'assistant',
            content: data.conversationalSummary || 'Here is your automation plan...',
            data: { enhanced_prompt: data.enhanced_prompt, analysis: data.analysis }
          }]);

          addDebugLog('success', `Phase 3 complete - Enhanced prompt generated`);
        }
      } else {
        addDebugLog('error', `Phase ${phase} failed: ${data.error || 'Unknown error'}`);
      }
    } catch (error: any) {
      addDebugLog('error', `Process message error: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAnswerSubmit = () => {
    if (!userAnswer.trim()) {
      addDebugLog('error', 'Please provide an answer');
      return;
    }

    const currentQuestion = currentQuestions[currentQuestionIndex];
    const updatedAnswers = {
      ...clarificationAnswers,
      [currentQuestion.id]: userAnswer
    };

    setClarificationAnswers(updatedAnswers);

    // Add answer to conversation history
    setConversationHistory(prev => [...prev, {
      role: 'user',
      content: `Q: ${currentQuestion.question}\nA: ${userAnswer}`,
      data: null
    }]);

    if (currentQuestionIndex < currentQuestions.length - 1) {
      // Move to next question
      setCurrentQuestionIndex(currentQuestionIndex + 1);
      setUserAnswer('');
      addDebugLog('info', `Question ${currentQuestionIndex + 2} of ${currentQuestions.length}`);
    } else {
      // All questions answered, proceed to Phase 3
      setUserAnswer('');
      addDebugLog('info', 'All questions answered, generating enhanced prompt...');
      processMessage(3, updatedAnswers);
    }
  };

  const handleRefinePlan = () => {
    addDebugLog('info', 'Refining plan - going back to Phase 2...');
    setCurrentQuestionIndex(0);
    setUserAnswer('');
    processMessage(2);
  };

  const handleAcceptPlan = () => {
    addDebugLog('success', 'Plan accepted! Ready for implementation.');
    // In the real flow, this would trigger agent creation
  };

  const resetThreadConversation = () => {
    setThreadId(null);
    setCurrentPhase(1);
    setInitialPrompt('');
    setConversationHistory([]);
    setCurrentQuestions([]);
    setCurrentQuestionIndex(0);
    setUserAnswer('');
    setClarificationAnswers({});
    setEnhancedPrompt(null);
    setClarityScore(0);
    setAnalysisData(null);
    setMissingPlugins([]);
    addDebugLog('info', 'Thread conversation reset');
  };

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '20px', fontFamily: 'monospace' }}>
      <h1>Plugin System Testing Interface</h1>

      {/* Tab Navigation */}
      <div style={{ marginBottom: '30px', borderBottom: '2px solid #ccc' }}>
        <button
          onClick={() => setActiveTab('plugins')}
          style={{
            padding: '10px 20px',
            marginRight: '5px',
            backgroundColor: activeTab === 'plugins' ? '#007bff' : '#f8f9fa',
            color: activeTab === 'plugins' ? 'white' : '#333',
            border: 'none',
            borderBottom: activeTab === 'plugins' ? '3px solid #0056b3' : 'none',
            cursor: 'pointer',
            fontSize: '16px',
            fontWeight: activeTab === 'plugins' ? 'bold' : 'normal'
          }}
        >
          Plugins
        </button>
        <button
          onClick={() => setActiveTab('ai-services')}
          style={{
            padding: '10px 20px',
            marginRight: '5px',
            backgroundColor: activeTab === 'ai-services' ? '#007bff' : '#f8f9fa',
            color: activeTab === 'ai-services' ? 'white' : '#333',
            border: 'none',
            borderBottom: activeTab === 'ai-services' ? '3px solid #0056b3' : 'none',
            cursor: 'pointer',
            fontSize: '16px',
            fontWeight: activeTab === 'ai-services' ? 'bold' : 'normal'
          }}
        >
          AI Services
        </button>
        <button
          onClick={() => setActiveTab('thread-conversation')}
          style={{
            padding: '10px 20px',
            backgroundColor: activeTab === 'thread-conversation' ? '#007bff' : '#f8f9fa',
            color: activeTab === 'thread-conversation' ? 'white' : '#333',
            border: 'none',
            borderBottom: activeTab === 'thread-conversation' ? '3px solid #0056b3' : 'none',
            cursor: 'pointer',
            fontSize: '16px',
            fontWeight: activeTab === 'thread-conversation' ? 'bold' : 'normal'
          }}
        >
          Thread Conversation
        </button>
      </div>

      {/* User Section */}
      <div style={{ marginBottom: '30px', padding: '15px', border: '1px solid #ccc', borderRadius: '5px' }}>
        <h2>User Configuration</h2>
        <div style={{ marginBottom: '10px' }}>
          <label htmlFor="userId" style={{ display: 'block', marginBottom: '5px' }}>User ID:</label>
          <input
            id="userId"
            type="text"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="Enter user ID"
            style={{ width: '300px', padding: '8px', fontSize: '14px' }}
          />
        </div>
        {userStatus && (
          <div style={{ fontSize: '14px', color: '#666' }}>
            Status: {userStatus.summary.connected_count} connected, {userStatus.summary.disconnected_count} disconnected
          </div>
        )}
      </div>

      {/* Plugins Tab Content */}
      {activeTab === 'plugins' && (
        <>
          {/* Plugin Management */}
          <div style={{ marginBottom: '30px', padding: '15px', border: '1px solid #ccc', borderRadius: '5px' }}>
            <h2>Plugin Management</h2>
        <div style={{ marginBottom: '15px' }}>
          <label htmlFor="pluginSelect" style={{ display: 'block', marginBottom: '5px' }}>Select Plugin:</label>
          <select
            id="pluginSelect"
            value={selectedPlugin}
            onChange={(e) => {
              setSelectedPlugin(e.target.value);
              setSelectedAction('');
            }}
            style={{ width: '300px', padding: '8px', fontSize: '14px' }}
          >
            <option value="">-- Select Plugin --</option>
            {availablePlugins.map(plugin => (
              <option
                key={plugin.key}
                value={plugin.key}
                style={{
                  color: isPluginConnected(plugin.key) ? 'green' : 'red'
                }}
              >
                {plugin.name} (v{plugin.version})
              </option>
            ))}
          </select>
        </div>
        
        {selectedPlugin && (
          <div style={{ marginBottom: '15px' }}>
            <div style={{ marginBottom: '10px', fontSize: '14px' }}>
              Status: {isPluginConnected(selectedPlugin) ? 
                <span style={{ color: 'green' }}>✓ Connected</span> : 
                <span style={{ color: 'red' }}>✗ Not Connected</span>
              }
            </div>
            <button
              onClick={() => isPluginConnected(selectedPlugin) ? 
                disconnectPlugin(selectedPlugin) : 
                connectPlugin(selectedPlugin)
              }
              disabled={isLoading || !userId.trim()}
              style={{ 
                padding: '10px 20px', 
                marginRight: '10px',
                backgroundColor: isPluginConnected(selectedPlugin) ? '#dc3545' : '#007bff',
                color: 'white',
                border: 'none',
                borderRadius: '3px',
                cursor: isLoading || !userId.trim() ? 'not-allowed' : 'pointer'
              }}
            >
              {isLoading ? 'Processing...' : 
                isPluginConnected(selectedPlugin) ? 'Disconnect' : 'Connect'
              }
            </button>
          </div>
        )}
      </div>

      {/* Action Testing */}
      <div style={{ marginBottom: '30px', padding: '15px', border: '1px solid #ccc', borderRadius: '5px' }}>
        <h2>Action Testing</h2>
        {selectedPlugin && (
          <>
            <div style={{ marginBottom: '15px' }}>
              <label htmlFor="actionSelect" style={{ display: 'block', marginBottom: '5px' }}>Select Action:</label>
              <select
                id="actionSelect"
                value={selectedAction}
                onChange={(e) => setSelectedAction(e.target.value)}
                style={{ width: '300px', padding: '8px', fontSize: '14px' }}
              >
                <option value="">-- Select Action --</option>
                {getPluginActions(selectedPlugin).map(action => (
                  <option key={action} value={action}>
                    {action}
                  </option>
                ))}
              </select>
            </div>

            {selectedAction && (
              <>
                <div style={{ marginBottom: '15px' }}>
                  <label htmlFor="parameters" style={{ display: 'block', marginBottom: '5px' }}>Parameters (JSON):</label>
                  <textarea
                    id="parameters"
                    value={parameters}
                    onChange={(e) => setParameters(e.target.value)}
                    rows={12}
                    style={{ 
                      width: '100%', 
                      padding: '8px', 
                      fontSize: '12px', 
                      fontFamily: 'monospace',
                      border: '1px solid #ccc',
                      borderRadius: '3px'
                    }}
                  />
                </div>
                
                <button
                  onClick={executeAction}
                  disabled={isLoading || !userId.trim() || !isPluginConnected(selectedPlugin)}
                  style={{ 
                    padding: '10px 20px',
                    backgroundColor: '#28a745',
                    color: 'white',
                    border: 'none',
                    borderRadius: '3px',
                    cursor: isLoading || !userId.trim() || !isPluginConnected(selectedPlugin) ? 'not-allowed' : 'pointer'
                  }}
                >
                  {isLoading ? 'Executing...' : 'Execute Action'}
                </button>
                
                {!isPluginConnected(selectedPlugin) && (
                  <div style={{ marginTop: '10px', color: '#dc3545', fontSize: '14px' }}>
                    ⚠ Plugin must be connected to execute actions
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

          {/* Response Display */}
          {lastResponse && (
            <div style={{ marginBottom: '30px', padding: '15px', border: '1px solid #ccc', borderRadius: '5px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <h2 style={{ margin: 0 }}>Last API Response</h2>
                <button
                  onClick={copyToClipboard}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: copySuccess ? '#28a745' : '#007bff',
                    color: 'white',
                    border: 'none',
                    borderRadius: '3px',
                    cursor: 'pointer',
                    fontSize: '14px'
                  }}
                >
                  {copySuccess ? '✓ Copied!' : 'Copy to Clipboard'}
                </button>
              </div>
              <pre style={{
                backgroundColor: '#f8f9fa',
                padding: '15px',
                borderRadius: '3px',
                overflow: 'auto',
                fontSize: '12px',
                maxHeight: '300px'
              }}>
                {JSON.stringify(lastResponse, null, 2)}
              </pre>
            </div>
          )}
        </>
      )}

      {/* AI Services Tab Content */}
      {activeTab === 'ai-services' && (
        <>
          {/* AI Service Selection */}
          <div style={{ marginBottom: '30px', padding: '15px', border: '1px solid #ccc', borderRadius: '5px' }}>
            <h2>AI Service Selection</h2>
            <div style={{ marginBottom: '15px' }}>
              <label htmlFor="aiServiceSelect" style={{ display: 'block', marginBottom: '5px' }}>Select AI Service:</label>
              <select
                id="aiServiceSelect"
                value={selectedAIService}
                onChange={(e) => setSelectedAIService(e.target.value)}
                style={{ width: '300px', padding: '8px', fontSize: '14px' }}
              >
                <option value="">-- Select AI Service --</option>
                {Object.keys(AI_SERVICE_TEMPLATES).map(serviceKey => (
                  <option key={serviceKey} value={serviceKey}>
                    {serviceKey}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Request Configuration */}
          {selectedAIService && (
            <>
              <div style={{ marginBottom: '30px', padding: '15px', border: '1px solid #ccc', borderRadius: '5px' }}>
                <h2>Request Body Configuration</h2>

                {/* Helper Buttons */}
                <div style={{ marginBottom: '15px', display: 'flex', gap: '10px' }}>
                  <button
                    onClick={generateNewSessionId}
                    style={{
                      padding: '8px 16px',
                      backgroundColor: '#17a2b8',
                      color: 'white',
                      border: 'none',
                      borderRadius: '3px',
                      cursor: 'pointer',
                      fontSize: '14px'
                    }}
                  >
                    Generate New Session ID
                  </button>
                  <button
                    onClick={generateNewAgentId}
                    style={{
                      padding: '8px 16px',
                      backgroundColor: '#17a2b8',
                      color: 'white',
                      border: 'none',
                      borderRadius: '3px',
                      cursor: 'pointer',
                      fontSize: '14px'
                    }}
                  >
                    Generate New Agent ID
                  </button>
                  <button
                    onClick={resetToAITemplate}
                    style={{
                      padding: '8px 16px',
                      backgroundColor: '#6c757d',
                      color: 'white',
                      border: 'none',
                      borderRadius: '3px',
                      cursor: 'pointer',
                      fontSize: '14px'
                    }}
                  >
                    Reset to Template
                  </button>
                </div>

                {/* Request Body Editor */}
                <div style={{ marginBottom: '15px' }}>
                  <label htmlFor="aiServiceRequestBody" style={{ display: 'block', marginBottom: '5px' }}>Request Body (JSON):</label>
                  <textarea
                    id="aiServiceRequestBody"
                    value={aiServiceRequestBody}
                    onChange={(e) => setAiServiceRequestBody(e.target.value)}
                    rows={16}
                    style={{
                      width: '100%',
                      padding: '8px',
                      fontSize: '12px',
                      fontFamily: 'monospace',
                      border: '1px solid #ccc',
                      borderRadius: '3px'
                    }}
                  />
                </div>

                {/* Execute Button */}
                <button
                  onClick={executeAIService}
                  disabled={isLoading}
                  style={{
                    padding: '10px 20px',
                    backgroundColor: '#28a745',
                    color: 'white',
                    border: 'none',
                    borderRadius: '3px',
                    cursor: isLoading ? 'not-allowed' : 'pointer',
                    fontSize: '16px',
                    fontWeight: 'bold'
                  }}
                >
                  {isLoading ? 'Executing...' : 'Execute AI Service'}
                </button>
              </div>

              {/* AI Service Response Display */}
              {aiServiceResponse && (
                <div style={{ marginBottom: '30px', padding: '15px', border: '1px solid #ccc', borderRadius: '5px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <h2 style={{ margin: 0 }}>AI Service Response</h2>
                    <button
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(JSON.stringify(aiServiceResponse, null, 2));
                          addDebugLog('success', 'AI service response copied to clipboard');
                        } catch (error: any) {
                          addDebugLog('error', `Failed to copy: ${error.message}`);
                        }
                      }}
                      style={{
                        padding: '8px 16px',
                        backgroundColor: '#007bff',
                        color: 'white',
                        border: 'none',
                        borderRadius: '3px',
                        cursor: 'pointer',
                        fontSize: '14px'
                      }}
                    >
                      Copy to Clipboard
                    </button>
                  </div>
                  <pre style={{
                    backgroundColor: '#f8f9fa',
                    padding: '15px',
                    borderRadius: '3px',
                    overflow: 'auto',
                    fontSize: '12px',
                    maxHeight: '400px'
                  }}>
                    {JSON.stringify(aiServiceResponse, null, 2)}
                  </pre>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* Thread Conversation Tab */}
      {activeTab === 'thread-conversation' && (
        <div>
          {/* Session Info */}
          <div style={{ marginBottom: '30px', padding: '15px', border: '1px solid #28a745', borderRadius: '5px', backgroundColor: '#f0f9f0' }}>
            <h2>Thread Session Info</h2>
            <div style={{ fontSize: '14px', color: '#333' }}>
              <div><strong>Thread ID:</strong> {threadId || 'Not started'}</div>
              <div><strong>Current Phase:</strong> {currentPhase}</div>
              <div><strong>Clarity Score:</strong> {clarityScore}%</div>
              {missingPlugins.length > 0 && (
                <div><strong>Missing Plugins:</strong> {missingPlugins.join(', ')}</div>
              )}
            </div>
          </div>

          {/* Initial Prompt Input */}
          {!threadId && (
            <div style={{ marginBottom: '30px', padding: '15px', border: '1px solid #ccc', borderRadius: '5px' }}>
              <h2>Start New Thread</h2>
              <div style={{ marginBottom: '15px' }}>
                <label htmlFor="initialPrompt" style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                  Initial Prompt:
                </label>
                <textarea
                  id="initialPrompt"
                  value={initialPrompt}
                  onChange={(e) => setInitialPrompt(e.target.value)}
                  placeholder="Example: Send me weekly email summaries of my boss's emails to Slack"
                  style={{
                    width: '100%',
                    height: '100px',
                    padding: '10px',
                    fontSize: '14px',
                    fontFamily: 'monospace',
                    border: '1px solid #ccc',
                    borderRadius: '3px'
                  }}
                />
              </div>
              <button
                onClick={startThread}
                disabled={isLoading || !userId || !initialPrompt.trim()}
                style={{
                  padding: '10px 20px',
                  backgroundColor: !userId || !initialPrompt.trim() ? '#ccc' : '#28a745',
                  color: 'white',
                  border: 'none',
                  borderRadius: '3px',
                  cursor: !userId || !initialPrompt.trim() ? 'not-allowed' : 'pointer',
                  fontSize: '16px',
                  fontWeight: 'bold'
                }}
              >
                {isLoading ? 'Starting...' : 'Start Thread'}
              </button>
            </div>
          )}

          {/* Conversation History */}
          {conversationHistory.length > 0 && (
            <div style={{ marginBottom: '30px', padding: '15px', border: '1px solid #ccc', borderRadius: '5px' }}>
              <h2>Conversation History</h2>
              <div style={{
                maxHeight: '400px',
                overflowY: 'auto',
                padding: '10px',
                backgroundColor: '#f8f9fa',
                borderRadius: '3px'
              }}>
                {conversationHistory.map((msg, idx) => (
                  <div
                    key={idx}
                    style={{
                      marginBottom: '15px',
                      padding: '10px',
                      backgroundColor: msg.role === 'user' ? '#e3f2fd' : '#fff3cd',
                      borderLeft: `4px solid ${msg.role === 'user' ? '#2196f3' : '#ffc107'}`,
                      borderRadius: '3px'
                    }}
                  >
                    <div style={{ fontWeight: 'bold', marginBottom: '5px', color: '#333' }}>
                      {msg.role === 'user' ? 'User' : 'Assistant'}
                    </div>
                    <div style={{ whiteSpace: 'pre-wrap', fontSize: '14px' }}>
                      {msg.content}
                    </div>
                    {msg.data && (
                      <details style={{ marginTop: '10px' }}>
                        <summary style={{ cursor: 'pointer', color: '#007bff' }}>View Data</summary>
                        <pre style={{ fontSize: '11px', marginTop: '5px', overflow: 'auto' }}>
                          {JSON.stringify(msg.data, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Current Question (Phase 2) */}
          {currentPhase === 2 && currentQuestions.length > 0 && currentQuestionIndex < currentQuestions.length && (
            <div style={{ marginBottom: '30px', padding: '15px', border: '2px solid #007bff', borderRadius: '5px', backgroundColor: '#f0f8ff' }}>
              <h2>Question {currentQuestionIndex + 1} of {currentQuestions.length}</h2>
              <div style={{ marginBottom: '15px' }}>
                <div style={{ fontWeight: 'bold', marginBottom: '10px', fontSize: '16px' }}>
                  {currentQuestions[currentQuestionIndex].question}
                </div>
                <div style={{ fontSize: '12px', color: '#666', marginBottom: '10px' }}>
                  Dimension: {currentQuestions[currentQuestionIndex].dimension}
                </div>
                <textarea
                  value={userAnswer}
                  onChange={(e) => setUserAnswer(e.target.value)}
                  placeholder="Type your answer here..."
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleAnswerSubmit();
                    }
                  }}
                  style={{
                    width: '100%',
                    height: '80px',
                    padding: '10px',
                    fontSize: '14px',
                    fontFamily: 'monospace',
                    border: '1px solid #ccc',
                    borderRadius: '3px'
                  }}
                />
              </div>
              <button
                onClick={handleAnswerSubmit}
                disabled={isLoading || !userAnswer.trim()}
                style={{
                  padding: '10px 20px',
                  backgroundColor: !userAnswer.trim() ? '#ccc' : '#007bff',
                  color: 'white',
                  border: 'none',
                  borderRadius: '3px',
                  cursor: !userAnswer.trim() ? 'not-allowed' : 'pointer',
                  fontSize: '16px',
                  fontWeight: 'bold'
                }}
              >
                {isLoading ? 'Submitting...' : 'Submit Answer'}
              </button>
            </div>
          )}

          {/* Enhanced Prompt Preview (Phase 3) */}
          {currentPhase === 3 && enhancedPrompt && (
            <div style={{ marginBottom: '30px', padding: '15px', border: '2px solid #28a745', borderRadius: '5px', backgroundColor: '#f0fff0' }}>
              <h2>Enhanced Prompt (Phase 3)</h2>
              <div style={{ marginBottom: '15px' }}>
                <h3>{enhancedPrompt.plan_title || 'Automation Plan'}</h3>
                <p style={{ fontSize: '14px', color: '#666' }}>
                  {enhancedPrompt.plan_description || 'No description available'}
                </p>
              </div>

              {/* JSON Preview */}
              <details style={{ marginBottom: '15px' }}>
                <summary style={{ cursor: 'pointer', fontWeight: 'bold', color: '#007bff' }}>
                  View Full Enhanced Prompt JSON
                </summary>
                <pre style={{
                  backgroundColor: '#f8f9fa',
                  padding: '15px',
                  borderRadius: '3px',
                  overflow: 'auto',
                  fontSize: '12px',
                  maxHeight: '400px',
                  marginTop: '10px'
                }}>
                  {JSON.stringify(enhancedPrompt, null, 2)}
                </pre>
              </details>

              {/* Analysis Data */}
              {analysisData && (
                <details style={{ marginBottom: '15px' }}>
                  <summary style={{ cursor: 'pointer', fontWeight: 'bold', color: '#007bff' }}>
                    View Analysis Data
                  </summary>
                  <pre style={{
                    backgroundColor: '#f8f9fa',
                    padding: '15px',
                    borderRadius: '3px',
                    overflow: 'auto',
                    fontSize: '12px',
                    maxHeight: '400px',
                    marginTop: '10px'
                  }}>
                    {JSON.stringify(analysisData, null, 2)}
                  </pre>
                </details>
              )}

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  onClick={handleAcceptPlan}
                  disabled={isLoading}
                  style={{
                    padding: '12px 24px',
                    backgroundColor: '#28a745',
                    color: 'white',
                    border: 'none',
                    borderRadius: '3px',
                    cursor: isLoading ? 'not-allowed' : 'pointer',
                    fontSize: '16px',
                    fontWeight: 'bold'
                  }}
                >
                  Accept Plan
                </button>
                <button
                  onClick={handleRefinePlan}
                  disabled={isLoading}
                  style={{
                    padding: '12px 24px',
                    backgroundColor: '#ffc107',
                    color: '#333',
                    border: 'none',
                    borderRadius: '3px',
                    cursor: isLoading ? 'not-allowed' : 'pointer',
                    fontSize: '16px',
                    fontWeight: 'bold'
                  }}
                >
                  Refine Further (V7 Feature)
                </button>
              </div>
            </div>
          )}

          {/* Reset Button */}
          {threadId && (
            <div style={{ marginBottom: '30px', padding: '15px', border: '1px solid #ccc', borderRadius: '5px' }}>
              <h2>Testing Controls</h2>
              <button
                onClick={resetThreadConversation}
                disabled={isLoading}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#dc3545',
                  color: 'white',
                  border: 'none',
                  borderRadius: '3px',
                  cursor: isLoading ? 'not-allowed' : 'pointer',
                  fontSize: '14px'
                }}
              >
                Reset Thread
              </button>
            </div>
          )}
        </div>
      )}

      {/* Control Panel */}
      <div style={{ marginBottom: '30px', padding: '15px', border: '1px solid #ccc', borderRadius: '5px' }}>
        <h2>Controls</h2>
        <button
          onClick={refreshAll}
          disabled={isLoading}
          style={{ 
            padding: '10px 20px', 
            marginRight: '10px',
            backgroundColor: '#6c757d',
            color: 'white',
            border: 'none',
            borderRadius: '3px',
            cursor: isLoading ? 'not-allowed' : 'pointer'
          }}
        >
          Refresh Status
        </button>
        <button
          onClick={clearLogs}
          style={{ 
            padding: '10px 20px',
            backgroundColor: '#dc3545',
            color: 'white',
            border: 'none',
            borderRadius: '3px',
            cursor: 'pointer'
          }}
        >
          Clear Debug Logs
        </button>
      </div>

      {/* Debug Logs */}
      <div style={{ padding: '15px', border: '1px solid #ccc', borderRadius: '5px' }}>
        <h2>Debug Logs</h2>
        <div style={{ 
          backgroundColor: '#f8f9fa', 
          padding: '15px', 
          borderRadius: '3px', 
          height: '300px',
          overflow: 'auto',
          fontSize: '12px',
          fontFamily: 'monospace'
        }}>
          {debugLogs.length === 0 ? (
            <div style={{ color: '#666' }}>No debug logs yet...</div>
          ) : (
            debugLogs.map((log, index) => (
              <div 
                key={index} 
                style={{ 
                  marginBottom: '5px',
                  color: log.type === 'error' ? '#dc3545' : 
                         log.type === 'success' ? '#28a745' : '#666'
                }}
              >
                [{log.timestamp}] {log.type.toUpperCase()}: {log.message}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}