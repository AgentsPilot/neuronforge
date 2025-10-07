// app/test-plugins-v2/page.tsx
'use client';

import { useState, useEffect } from 'react';
import { PluginAPIClient } from '@/lib/client/plugin-api-client';
import { PluginInfo, UserPluginStatus, ExecutionResult } from '@/lib/types/plugin-types';

interface DebugLog {
  timestamp: string;
  type: 'info' | 'error' | 'success';
  message: string;
}

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
  }
};

export default function TestPluginsPage() {
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

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '20px', fontFamily: 'monospace' }}>
      <h1>Plugin System Testing Interface</h1>
      
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