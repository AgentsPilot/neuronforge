// app/test-plugins-v2/page.tsx
'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { PluginAPIClient } from '@/lib/client/plugin-api-client';
import { PluginInfo, UserPluginStatus, ExecutionResult } from '@/lib/types/plugin-types';
import { v4 as uuidv4 } from 'uuid';
import { useDebugStream, DebugState, StepStatus } from '@/hooks/useDebugStream';
import { DebugControls } from '@/components/debug/DebugControls';
import { StepVisualizer } from '@/components/debug/StepVisualizer';

// Workflow step interface for step visualization
interface WorkflowStep {
  id: string;
  name: string;
  type?: string;
  description?: string;
  action?: string;
  plugin?: string;
}

interface DebugLog {
  timestamp: string;
  type: 'info' | 'error' | 'success';
  message: string;
}

type TabType = 'plugins' | 'ai-services' | 'thread-conversation' | 'free-tier-users' | 'agent-execution';

// Helper function to format relative time
function getTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  return date.toLocaleDateString();
}

// Provider and model options for AI provider selection
const PROVIDER_OPTIONS = ['openai', 'anthropic', 'kimi'] as const;
type ProviderOption = typeof PROVIDER_OPTIONS[number];

const MODELS_BY_PROVIDER: Record<ProviderOption, { value: string; label: string }[]> = {
  openai: [
    // GPT-5.2 Series (Latest)
    { value: 'gpt-5.2', label: 'GPT-5.2 (Latest)' },
    { value: 'gpt-5.2-pro', label: 'GPT-5.2 Pro (Highest Accuracy)' },
    // GPT-5.1 Series
    { value: 'gpt-5.1', label: 'GPT-5.1 (Flagship)' },
    // GPT-5 Series
    { value: 'gpt-5', label: 'GPT-5 (Advanced Reasoning)' },
    { value: 'gpt-5-mini', label: 'GPT-5 Mini (Balanced)' },
    { value: 'gpt-5-nano', label: 'GPT-5 Nano (Fastest)' },
    // GPT-4.1 Series
    { value: 'gpt-4.1', label: 'GPT-4.1 (Coding, 1M Context)' },
    { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
    { value: 'gpt-4.1-nano', label: 'GPT-4.1 Nano' },
    // o-Series Reasoning
    { value: 'o3', label: 'o3 (Powerful Reasoning)' },
    { value: 'o4-mini', label: 'o4-mini (Fast Reasoning)' },
    // GPT-4o Series
    { value: 'gpt-4o', label: 'GPT-4o (Multimodal)' },
    { value: 'gpt-4o-mini', label: 'GPT-4o Mini (Cost-Effective)' },
    // Legacy
    { value: 'gpt-4-turbo', label: 'GPT-4 Turbo (Legacy)' },
    { value: 'gpt-4', label: 'GPT-4 (Legacy)' },
    { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo (Legacy)' }
  ],
  anthropic: [
    // Claude 4.5 Series (Latest)
    { value: 'claude-opus-4-5-20251101', label: 'Claude 4.5 Opus (Most Intelligent)' },
    { value: 'claude-sonnet-4-5-20250929', label: 'Claude 4.5 Sonnet (Best Balance)' },
    { value: 'claude-haiku-4-5-20251001', label: 'Claude 4.5 Haiku (Fastest)' },
    // Claude 4.1 Series
    { value: 'claude-opus-4-1-20250805', label: 'Claude 4.1 Opus (Agentic)' },
    // Claude 4 Series
    { value: 'claude-opus-4-20250514', label: 'Claude 4 Opus (Coding)' },
    { value: 'claude-sonnet-4-20250514', label: 'Claude 4 Sonnet (Reasoning)' },
    // Claude 3.7 Series
    { value: 'claude-3-7-sonnet-20250219', label: 'Claude 3.7 Sonnet (Hybrid)' },
    // Claude 3.5 Series (Legacy)
    { value: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet (Legacy)' },
    { value: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku (Legacy)' },
    // Claude 3 Series (Legacy)
    { value: 'claude-3-opus-20240229', label: 'Claude 3 Opus (Legacy)' },
    { value: 'claude-3-sonnet-20240229', label: 'Claude 3 Sonnet (Retired)' },
    { value: 'claude-3-haiku-20240307', label: 'Claude 3 Haiku (Budget)' }
  ],
  kimi: [
    // K2 Series (Latest)
    { value: 'kimi-k2-0905-preview', label: 'Kimi K2 Preview (Latest, 256K)' },
    { value: 'kimi-k2-thinking', label: 'Kimi K2 Thinking (Reasoning)' },
    { value: 'kimi-k2-0711-preview', label: 'Kimi K2 Original (128K)' },
    // K1.5 Series
    { value: 'kimi-k1.5', label: 'Kimi K1.5 (Multimodal)' },
    { value: 'kimi-k1.5-long', label: 'Kimi K1.5 Long (Step-by-Step)' },
    // Linear Series
    { value: 'kimi-linear-48b', label: 'Kimi Linear (1M Context, 6x Faster)' },
    // Specialized
    { value: 'kimi-dev-72b', label: 'Kimi Dev (Coding, SWE-bench)' },
    { value: 'kimi-vl', label: 'Kimi VL (Vision-Language)' }
  ]
};

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
  // HIDDEN LEGACY SERVICES - May be removed in future cleanup
  // "analyze-prompt-clarity": {
  //   prompt: "Create an automation that sends me daily email summaries of my calendar events",
  //   userId: "test_user_123",
  //   sessionId: "550e8400-e29b-41d4-a716-446655440000",
  //   agentId: "660e8400-e29b-41d4-a716-446655440001",
  //   connected_plugins: {},
  //   bypassPluginValidation: false
  // },
  // "enhance-prompt": {
  //   prompt: "Send emails automatically",
  //   userId: "test_user_123",
  //   sessionId: "550e8400-e29b-41d4-a716-446655440000",
  //   agentId: "660e8400-e29b-41d4-a716-446655440001",
  //   clarificationAnswers: {
  //     "timing": "daily_9am",
  //     "recipients": "manager@example.com"
  //   },
  //   connected_plugins: {},
  //   missingPlugins: [],
  //   pluginWarning: null
  // },
  // "generate-clarification-questions": {
  //   prompt: "I need to track project tasks and send updates",
  //   agentName: "Task Tracker Agent",
  //   description: "An agent that helps track project tasks and send updates",
  //   userId: "test_user_123",
  //   sessionId: "550e8400-e29b-41d4-a716-446655440000",
  //   agentId: "660e8400-e29b-41d4-a716-446655440001",
  //   connectedPlugins: {},
  //   analysis: {
  //     clarityScore: 45,
  //     questionsCount: 0,
  //     needsClarification: true,
  //     aiValidationFailed: false,
  //     bypassedPluginValidation: false,
  //     hadPluginWarning: false,
  //     missingPlugins: [],
  //     requiredServices: [],
  //     suggestions: []
  //   }
  // },
  // END HIDDEN LEGACY SERVICES (1-3)

  "generate/input-schema": {
    prompt: "Create an agent that schedules meetings and sends confirmation emails",
    plugins: ["google-calendar", "google-mail"],
    userId: "test_user_123",
    sessionId: "550e8400-e29b-41d4-a716-446655440000",
    agentId: "660e8400-e29b-41d4-a716-446655440001"
  },
  // HIDDEN LEGACY SERVICES (5-7) - May be removed in future cleanup
  // "test/analyze-prompt": {
  //   userId: "test_user_123",
  //   prompt: "Research the top 10 retail technology blogs from Israel and send me a daily summary via email",
  //   availablePlugins: ["google-mail", "chatgpt-research"],
  //   sessionId: "550e8400-e29b-41d4-a716-446655440000",
  //   // Provider configuration (optional - defaults to OpenAI GPT-4o)
  //   // Options: "openai", "anthropic", "kimi"
  //   provider: "openai",
  //   // Model options per provider:
  //   // OpenAI: "gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-4", "gpt-3.5-turbo"
  //   // Anthropic: "claude-opus-4-20250514", "claude-sonnet-4-20250514", "claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022"
  //   // Kimi: "kimi-k2-0905-preview", "kimi-k2-thinking", "kimi-k2-0711-preview"
  //   model: "gpt-4o"
  // },
  // "generate-agent-v2": {
  //   prompt: "Research the top 10 retail technology blogs from Israel and send me a daily summary via email",
  //   sessionId: "550e8400-e29b-41d4-a716-446655440000"
  // },
  // "generate-agent-v3": {
  //   prompt: "Research the top 10 retail technology blogs from Israel and send me a daily summary via email",
  //   sessionId: "550e8400-e29b-41d4-a716-446655440000",
  //   agentId: "660e8400-e29b-41d4-a716-446655440001",
  //   clarificationAnswers: {}
  // },
  // END HIDDEN LEGACY SERVICES (5-7)

  "generate-agent-v4": {
    // REQUIRED: One of: enhancedPrompt, prompt, OR enhancedPromptTechnicalWorkflow
    // Option 1: Enhanced prompt from Phase 3
    enhancedPrompt: "Research the top 10 retail technology blogs from Israel and send me a daily summary via email. The user wants comprehensive coverage of Israeli retail tech innovation, delivered as a formatted email digest.",
    // Option 2: Raw prompt (API will use as-is, may result in less accurate workflow)
    // prompt: "Research the top 10 retail technology blogs from Israel and send me a daily summary via email",
    // Option 3: Technical workflow from Phase 4 (bypasses Stage 1 LLM, uses DSL builder directly)
    // To use this, comment out enhancedPrompt above and uncomment below:
    // enhancedPromptTechnicalWorkflow: {
    //   technical_workflow: [
    //     { step_number: 1, action_type: "plugin_action", plugin: "google-sheets", action: "read_range", description: "Read data from spreadsheet", inputs: { spreadsheet_id: "{{input.spreadsheet_id}}", range: "{{input.range}}" }, outputs: ["rows_data"] },
    //     { step_number: 2, action_type: "ai_processing", description: "Process and filter the data", inputs: { data: "{{step1.rows_data}}" }, outputs: ["filtered_data"] },
    //     { step_number: 3, action_type: "plugin_action", plugin: "google-mail", action: "send_email", description: "Send email with results", inputs: { recipients: "{{input.recipients}}", content: "{{step2.filtered_data}}" }, outputs: ["email_sent"] }
    //   ],
    //   technical_inputs_required: [
    //     { name: "spreadsheet_id", type: "text", description: "Google Sheets ID", required: true },
    //     { name: "range", type: "text", description: "Cell range to read", required: true },
    //     { name: "recipients", type: "object", description: "Email recipients object", required: true }
    //   ],
    //   feasibility: { can_execute: true, confidence: 0.9, issues: [] }
    // },

    // Session/Agent identifiers (auto-generated if not provided)
    sessionId: "550e8400-e29b-41d4-a716-446655440000",
    agentId: "660e8400-e29b-41d4-a716-446655440001",

    // Clarification answers from Phase 2 (includes plan_description, originalPrompt)
    clarificationAnswers: {
      // originalPrompt: "Original user prompt",
      // plan_description: "Short summary from clarity phase"
    },

    // Optional: Plugin-related parameters
    // connectedPlugins: Array of plugin keys (e.g., ["google-mail", "slack"])
    connectedPlugins: [],
    // connectedPluginData: Array of plugin context objects from enhance-prompt
    connectedPluginData: [],
    // services_involved: Filter workflow to only use these plugins (token optimization)
    services_involved: ["google-mail", "chatgpt-research"]
  },
  "test/generate-agent-v5-test-wrapper": {
    // V5 Workflow Generator Test Wrapper
    // Tests the LLM review flow for technical workflows
    //
    // Input: enhancedPrompt (stringified JSON) containing:
    //   - sections: { data, output, actions, delivery, processing_steps }
    //   - specifics: { services_involved, resolved_user_inputs }
    //   - plan_title, plan_description
    //
    // The API auto-extracts from enhancedPrompt:
    //   - required_services (from specifics.services_involved)
    //   - technicalWorkflow.enhanced_prompt (plan_title, plan_description, specifics)
    //
    // provider and model are injected from the dropdown selectors

    // Enhanced prompt (stringified JSON) - use "Import JSON" button
    enhancedPrompt: "",

    // Optional: Pre-built technical workflow steps (for LLM review path)
    // If provided, these steps will be reviewed/repaired by LLM
    technicalWorkflow: {
      technical_workflow: []
    },

    // Skip DSL building and return only reviewed workflow (for testing LLM review in isolation)
    // When true: returns reviewedWorkflow only, workflow is undefined
    // When false: runs full flow including DSL building
    skipDslBuilder: true,

    // User ID to load connected plugins
    userId: "test_user_123"
  }
};

export default function TestPluginsPage() {
  // Tab state
  const [activeTab, setActiveTab] = useState<TabType>('plugins');

  // Core state
  // Initialize userId from env variable if available (add NEXT_PUBLIC_TEST_PAGE_USER_ID to .env.local)
  const [userId, setUserId] = useState(process.env.NEXT_PUBLIC_TEST_PAGE_USER_ID || '');
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

  // JSON Prompt Import modal state
  const [showJsonPromptModal, setShowJsonPromptModal] = useState(false);
  const [jsonPromptImportValue, setJsonPromptImportValue] = useState('');
  const [jsonPromptImportError, setJsonPromptImportError] = useState<string | null>(null);
  const [jsonImportTargetField, setJsonImportTargetField] = useState<'prompt' | 'enhancedPrompt' | 'enhancedPromptTechnicalWorkflow' | 'technicalWorkflow'>('enhancedPrompt');

  // Provider/Model selection state (shared by test/analyze-prompt and thread-conversation)
  const [selectedProvider, setSelectedProvider] = useState<ProviderOption>('openai');
  const [selectedModel, setSelectedModel] = useState<string>('gpt-5.2');

  // Plugin loading state (for test/analyze-prompt)
  const [userConnectedPluginKeys, setUserConnectedPluginKeys] = useState<string[]>([]);
  const [isLoadingPlugins, setIsLoadingPlugins] = useState(false);

  // Thread Conversation state
  const [threadId, setThreadId] = useState<string | null>(null);
  const [currentPhase, setCurrentPhase] = useState<1 | 2 | 3 | 4>(1);
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

  // Recent Threads state (for resuming conversations)
  const [threadMode, setThreadMode] = useState<'new' | 'existing'>('new');
  const [selectedThreadId, setSelectedThreadId] = useState<string>('');
  const [recentThreads, setRecentThreads] = useState<Array<{
    id: string;
    openai_thread_id: string;
    status: string;
    current_phase: number;
    user_prompt: string | null;
    ai_provider: string;
    ai_model: string;
    created_at: string;
    updated_at: string;
    expires_at: string;
    metadata: any;
  }>>([]);
  const [isLoadingRecentThreads, setIsLoadingRecentThreads] = useState(false);
  const [isLoadingThread, setIsLoadingThread] = useState(false);

  // Phase 4 state (technical workflow generation)
  const [technicalWorkflow, setTechnicalWorkflow] = useState<any[]>([]);
  const [technicalInputsRequired, setTechnicalInputsRequired] = useState<any[]>([]);
  const [feasibility, setFeasibility] = useState<any>(null);
  const [phase4Response, setPhase4Response] = useState<any>(null);
  const [technicalInputsCollected, setTechnicalInputsCollected] = useState<Record<string, string>>({});

  // Agent Generation state (V4)
  const [generatedAgent, setGeneratedAgent] = useState<any>(null);
  const [isGeneratingAgent, setIsGeneratingAgent] = useState(false);
  const [agentGenerationError, setAgentGenerationError] = useState<string | null>(null);

  // Ref for conversation history auto-scroll
  const conversationHistoryRef = useRef<HTMLDivElement>(null);

  // Ref for debug logs auto-scroll
  const debugLogsRef = useRef<HTMLDivElement>(null);

  // Mini-cycle state (for user_inputs_required refinement)
  const [isInMiniCycle, setIsInMiniCycle] = useState(false);
  const [miniCyclePhase3, setMiniCyclePhase3] = useState<any>(null);

  // Communication tracking for download
  const [apiCommunications, setApiCommunications] = useState<Array<{
    timestamp: string;
    phase: number | string;
    endpoint: string;
    request: any;
    response: any;
  }>>([]);

  // Free Tier Users state
  const [freeTierUserId, setFreeTierUserId] = useState('');
  const [freeTierResponse, setFreeTierResponse] = useState<any>(null);

  // Agent Execution state
  const [agentId, setAgentId] = useState('');
  const [agentInputVariables, setAgentInputVariables] = useState('{}');
  const [agentOverridePrompt, setAgentOverridePrompt] = useState('');
  const [agentExecutionResult, setAgentExecutionResult] = useState<any>(null);
  const [isExecutingAgent, setIsExecutingAgent] = useState(false);
  const [useAgentKit, setUseAgentKit] = useState(true);
  const [agentsList, setAgentsList] = useState<Array<{id: string; agent_name: string; status: string; pilot_steps?: any[]; workflow_steps?: any[]}>>([]);

  // Step-by-step Debug Execution state
  const [debugModeEnabled, setDebugModeEnabled] = useState(false);
  const [selectedAgentDetails, setSelectedAgentDetails] = useState<any>(null);
  const [agentWorkflowSteps, setAgentWorkflowSteps] = useState<WorkflowStep[]>([]);

  // Sandbox Mode state (inline workflow execution without DB)
  const [sandboxMode, setSandboxMode] = useState(false);
  const [sandboxAgentName, setSandboxAgentName] = useState('Sandbox Test Agent');
  const [sandboxPilotSteps, setSandboxPilotSteps] = useState('[]');
  const [sandboxPluginsRequired, setSandboxPluginsRequired] = useState('[]');
  const [sandboxJsonImport, setSandboxJsonImport] = useState('');
  const [showJsonImportModal, setShowJsonImportModal] = useState(false);

  // Debug stream hook
  const debugStream = useDebugStream({
    onEvent: (event) => {
      addDebugLog('info', `[Debug] ${event.type}: ${event.stepName || event.stepId || ''}`);
    },
    onComplete: (result) => {
      addDebugLog('success', 'Debug execution completed');
      setAgentExecutionResult(result);
      setIsExecutingAgent(false);
    },
    onError: (error) => {
      addDebugLog('error', `Debug execution error: ${error}`);
      setIsExecutingAgent(false);
    }
  });

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

  // Auto-scroll conversation history to bottom when new messages are added
  useEffect(() => {
    if (conversationHistoryRef.current) {
      conversationHistoryRef.current.scrollTop = conversationHistoryRef.current.scrollHeight;
    }
  }, [conversationHistory]);

  // Auto-scroll debug logs to bottom when new logs are added
  useEffect(() => {
    if (debugLogsRef.current) {
      debugLogsRef.current.scrollTop = debugLogsRef.current.scrollHeight;
    }
  }, [debugLogs]);

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
      addDebugLog('success', `User has ${status.summary.connected_count} connected, ${status.summary.active_expired_count} expired, ${status.summary.disconnected_count} disconnected plugins`);
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

  const refreshPluginToken = async (pluginKey: string) => {
    if (!userId.trim()) {
      addDebugLog('error', 'User ID is required to refresh token');
      return;
    }

    setIsLoading(true);
    try {
      addDebugLog('info', `Refreshing token for ${pluginKey}...`);
      const response = await fetch('/api/plugins/refresh-token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': userId,
        },
        body: JSON.stringify({ pluginKeys: [pluginKey] }),
      });

      const result = await response.json();
      setLastResponse(result);

      if (result.success && result.refreshed?.includes(pluginKey)) {
        addDebugLog('success', `Token refreshed for ${pluginKey}`);
      } else if (result.failed?.includes(pluginKey)) {
        addDebugLog('error', `Token refresh failed for ${pluginKey}`);
      } else {
        addDebugLog('info', `Token refresh skipped for ${pluginKey} (already valid or no refresh token)`);
      }

      // Always refresh status after any refresh-token operation to sync UI with backend
      console.log('DEBUG: About to call loadUserStatus after token refresh');
      await loadUserStatus();
      console.log('DEBUG: loadUserStatus completed');
    } catch (error: any) {
      addDebugLog('error', `Token refresh error: ${error.message}`);
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

  type PluginConnectionStatus = 'connected' | 'token_expired' | 'not_connected';

  const getPluginStatus = (pluginKey: string): PluginConnectionStatus => {
    if (userStatus?.connected.some(p => p.key === pluginKey)) {
      return 'connected';
    }
    if (userStatus?.active_expired?.includes(pluginKey)) {
      return 'token_expired';
    }
    return 'not_connected';
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
        // Copy userId from input box if available (for test/analyze-prompt and other services)
        if (userId.trim()) {
          templateWithNewIds.userId = userId;
        }
        setAiServiceRequestBody(JSON.stringify(templateWithNewIds, null, 2));
        addDebugLog('info', `Reset to template for ${selectedAIService} with new IDs${userId.trim() ? ` and userId: ${userId}` : ''}`);
      }
    }
  };

  // Update provider/model in request body (for test/analyze-prompt only - v5 wrapper injects at execution time)
  const updateProviderInRequestBody = (provider: ProviderOption, model: string) => {
    // Skip updating request body for v5 wrapper - provider/model are injected at execution time
    if (selectedAIService === 'test/generate-agent-v5-test-wrapper') {
      addDebugLog('info', `Selected provider: ${provider}, model: ${model} (will be injected at execution)`);
      return;
    }
    try {
      const currentBody = JSON.parse(aiServiceRequestBody);
      currentBody.provider = provider;
      currentBody.model = model;
      setAiServiceRequestBody(JSON.stringify(currentBody, null, 2));
      addDebugLog('info', `Updated provider to ${provider} with model ${model}`);
    } catch (error: any) {
      addDebugLog('error', `Failed to update provider/model: ${error.message}`);
    }
  };

  const handleProviderChange = (newProvider: ProviderOption) => {
    setSelectedProvider(newProvider);
    // Set default model for the new provider
    const defaultModel = MODELS_BY_PROVIDER[newProvider][0].value;
    setSelectedModel(defaultModel);
    updateProviderInRequestBody(newProvider, defaultModel);
  };

  const handleModelChange = (newModel: string) => {
    setSelectedModel(newModel);
    updateProviderInRequestBody(selectedProvider, newModel);
  };

  // Update availablePlugins in request body (for test/analyze-prompt)
  const updatePluginsInRequestBody = (pluginKeys: string[]) => {
    try {
      const currentBody = JSON.parse(aiServiceRequestBody);
      currentBody.availablePlugins = pluginKeys;
      setAiServiceRequestBody(JSON.stringify(currentBody, null, 2));
      addDebugLog('info', `Updated availablePlugins: ${pluginKeys.join(', ') || '(none)'}`);
    } catch (error: any) {
      addDebugLog('error', `Failed to update plugins: ${error.message}`);
    }
  };

  // Import JSON prompt into request body - intelligently extracts relevant field based on target selection
  const importJsonPromptIntoRequestBody = (jsonText: string) => {
    setJsonPromptImportError(null); // Clear previous error

    try {
      // Parse the imported JSON to validate it's valid JSON
      const importedData = JSON.parse(jsonText);

      // Intelligently extract the relevant field based on the target selection
      let extractedData = importedData;
      let extractionNote = '';

      // Try to extract the specific field if the imported data is a larger object
      if (typeof importedData === 'object' && importedData !== null) {
        switch (jsonImportTargetField) {
          case 'prompt':
            // Look for prompt field in the imported data
            if (importedData.prompt !== undefined) {
              extractedData = importedData.prompt;
              extractionNote = ' (extracted from .prompt)';
            } else if (importedData.user_prompt !== undefined) {
              extractedData = importedData.user_prompt;
              extractionNote = ' (extracted from .user_prompt)';
            }
            break;

          case 'enhancedPrompt':
            // Look for enhanced_prompt or enhancedPrompt field
            if (importedData.enhanced_prompt !== undefined) {
              extractedData = importedData.enhanced_prompt;
              extractionNote = ' (extracted from .enhanced_prompt)';
            } else if (importedData.enhancedPrompt !== undefined) {
              extractedData = importedData.enhancedPrompt;
              extractionNote = ' (extracted from .enhancedPrompt)';
            }
            break;

          case 'enhancedPromptTechnicalWorkflow':
            // Look for technical_workflow in various places
            if (importedData.technical_workflow !== undefined) {
              extractedData = { technical_workflow: importedData.technical_workflow };
              if (importedData.enhanced_prompt) {
                extractedData.enhanced_prompt = importedData.enhanced_prompt;
              }
              extractionNote = ' (extracted .technical_workflow)';
            } else if (importedData.enhanced_prompt?.technical_workflow !== undefined) {
              extractedData = {
                technical_workflow: importedData.enhanced_prompt.technical_workflow,
                enhanced_prompt: importedData.enhanced_prompt
              };
              extractionNote = ' (extracted from .enhanced_prompt.technical_workflow)';
            }
            break;

          case 'technicalWorkflow':
            // Look for technical_workflow array and wrap in expected object structure
            if (importedData.technical_workflow !== undefined) {
              // Wrap the array in the expected object structure
              extractedData = { technical_workflow: importedData.technical_workflow };
              extractionNote = ' (extracted .technical_workflow into wrapper object)';
            } else if (Array.isArray(importedData) && importedData[0]?.kind) {
              // Already a technical workflow array, wrap it
              extractedData = { technical_workflow: importedData };
              extractionNote = ' (detected workflow array, wrapped in object)';
            }
            // If importedData already has the correct structure {technical_workflow: [...]}, use as-is
            break;
        }
      }

      // Stringify the extracted data
      const stringifiedJson = JSON.stringify(extractedData);

      // Parse current request body
      const currentBody = JSON.parse(aiServiceRequestBody);

      // Set the stringified JSON into the target field
      currentBody[jsonImportTargetField] = stringifiedJson;

      setAiServiceRequestBody(JSON.stringify(currentBody, null, 2));
      addDebugLog('success', `Imported JSON (${stringifiedJson.length} chars) into "${jsonImportTargetField}"${extractionNote}`);
      setShowJsonPromptModal(false);
      setJsonPromptImportValue('');
      setJsonPromptImportError(null);
      return true;
    } catch (error: any) {
      const errorMsg = `Invalid JSON: ${error.message}`;
      setJsonPromptImportError(errorMsg);
      addDebugLog('error', `Failed to import JSON: ${error.message}`);
      return false;
    }
  };

  // Load user's connected plugins from /api/plugins/user-status
  const loadUserPluginsForTest = async () => {
    // Get userId from request body
    let bodyUserId = '';
    try {
      const currentBody = JSON.parse(aiServiceRequestBody);
      bodyUserId = currentBody.userId || '';
    } catch {
      addDebugLog('error', 'Invalid JSON in request body');
      return;
    }

    if (!bodyUserId.trim()) {
      addDebugLog('error', 'userId is required in request body to load plugins');
      return;
    }

    setIsLoadingPlugins(true);
    try {
      addDebugLog('info', `Loading plugins for user: ${bodyUserId}`);
      const response = await fetch(`/api/plugins/user-status?userId=${bodyUserId}`);
      const data = await response.json();

      if (data.success) {
        // Include both connected and active_expired plugins
        const connectedKeys = data.connected.map((p: any) => p.key);
        const expiredKeys = data.active_expired || [];
        const allPluginKeys = [...connectedKeys, ...expiredKeys];

        setUserConnectedPluginKeys(allPluginKeys);
        updatePluginsInRequestBody(allPluginKeys);
        addDebugLog('success', `Loaded ${allPluginKeys.length} plugins (${connectedKeys.length} connected, ${expiredKeys.length} expired): ${allPluginKeys.join(', ') || '(none)'}`);
      } else {
        addDebugLog('error', `Failed to load plugins: ${data.error || 'Unknown error'}`);
      }
    } catch (error: any) {
      addDebugLog('error', `Error loading plugins: ${error.message}`);
    } finally {
      setIsLoadingPlugins(false);
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

    // Inject provider and model from dropdown selectors for services that use them
    if (selectedAIService === 'test/generate-agent-v5-test-wrapper' || selectedAIService === 'test/analyze-prompt') {
      parsedRequestBody.provider = selectedProvider;
      parsedRequestBody.model = selectedModel;
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
      // Sync provider/model state from template for test/analyze-prompt
      if (selectedAIService === 'test/analyze-prompt') {
        const template = (AI_SERVICE_TEMPLATES as any)[selectedAIService];
        if (template?.provider && PROVIDER_OPTIONS.includes(template.provider)) {
          const provider = template.provider as ProviderOption;
          setSelectedProvider(provider);
          setSelectedModel(template.model || MODELS_BY_PROVIDER[provider][0].value);
        }
      }
      // Set default provider/model for v5 wrapper (not stored in template, injected at execution)
      if (selectedAIService === 'test/generate-agent-v5-test-wrapper') {
        setSelectedProvider('anthropic');
        setSelectedModel('claude-sonnet-4-20250514');
      }
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

      const initThreadRequest = {
        userId: userId,
        userPrompt: initialPrompt,
        userContext: {
          full_name: 'Test User',
          email: userId + '@example.com'
        },
        ai_provider: selectedProvider,
        ai_model: selectedModel
      };

      const response = await fetch('/api/agent-creation/init-thread', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(initThreadRequest)
      });

      const data = await response.json();

      // Capture init-thread communication
      setApiCommunications(prev => [...prev, {
        timestamp: new Date().toISOString(),
        phase: 'init',
        endpoint: '/api/agent-creation/init-thread',
        request: initThreadRequest,
        response: data
      }]);

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

  // Load recent threads for the current user
  const loadRecentThreads = async () => {
    if (!userId) {
      addDebugLog('error', 'User ID is required to load recent threads');
      return;
    }

    try {
      setIsLoadingRecentThreads(true);
      addDebugLog('info', 'Loading recent threads...');

      const response = await fetch(`/api/agent-creation/threads?limit=10&status=active,completed`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setRecentThreads(data.threads || []);
        addDebugLog('success', `Loaded ${data.count} recent threads`);
      } else {
        const errorMsg = data.error || 'Unknown error';
        addDebugLog('error', `Failed to load recent threads: ${errorMsg}`);
      }
    } catch (error: any) {
      addDebugLog('error', `Error loading recent threads: ${error.message}`);
    } finally {
      setIsLoadingRecentThreads(false);
    }
  };

  // Load a specific thread and its messages
  const loadThread = async (openaiThreadId: string) => {
    try {
      setIsLoadingThread(true);
      addDebugLog('info', `Loading thread: ${openaiThreadId}...`);

      const response = await fetch(`/api/agent-creation/thread/${openaiThreadId}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });

      const data = await response.json();

      if (response.ok && data.success) {
        const thread = data.thread;
        const messages = data.messages || [];

        // Set thread state
        setThreadId(thread.openai_thread_id);
        setCurrentPhase(thread.current_phase as 1 | 2 | 3 | 4);
        setSelectedProvider(thread.ai_provider || 'openai');
        setSelectedModel(thread.ai_model || 'gpt-4o');

        // Restore metadata if available
        if (thread.metadata) {
          if (thread.metadata.user_prompt) {
            setInitialPrompt(thread.metadata.user_prompt);
          }
          if (thread.metadata.analysis) {
            setAnalysisData(thread.metadata.analysis);
          }
          if (thread.metadata.clarification_answers) {
            setClarificationAnswers(thread.metadata.clarification_answers);
          }
          if (thread.metadata.last_phase3_response?.enhanced_prompt) {
            setEnhancedPrompt(thread.metadata.last_phase3_response.enhanced_prompt);
          }
          if (thread.metadata.last_phase3_response?.clarityScore) {
            setClarityScore(thread.metadata.last_phase3_response.clarityScore);
          }
          if (thread.metadata.last_phase3_response?.missingPlugins) {
            setMissingPlugins(thread.metadata.last_phase3_response.missingPlugins);
          }
        }

        // Convert messages to conversation history format
        const history = messages.map((msg: any) => ({
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
          data: null
        }));
        setConversationHistory(history);

        addDebugLog('success', `Thread loaded: Phase ${thread.current_phase}, ${messages.length} messages`);

        // Keep recentThreads loaded for dropdown - don't clear
      } else {
        const errorMsg = data.error || 'Unknown error';
        const details = data.details ? ` - ${data.details}` : '';
        addDebugLog('error', `Failed to load thread: ${errorMsg}${details}`);
      }
    } catch (error: any) {
      addDebugLog('error', `Error loading thread: ${error.message}`);
    } finally {
      setIsLoadingThread(false);
    }
  };

  // Reset thread state (for starting fresh)
  const resetThreadState = () => {
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
    setTechnicalWorkflow([]);
    setTechnicalInputsRequired([]);
    setFeasibility(null);
    setPhase4Response(null);
    setTechnicalInputsCollected({});
    setGeneratedAgent(null);
    setAgentGenerationError(null);
    setIsInMiniCycle(false);
    setMiniCyclePhase3(null);
    setApiCommunications([]);
    // Keep recentThreads loaded, just reset selection
    setSelectedThreadId('');
    setThreadMode('new');
    addDebugLog('info', 'Thread state reset');
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

      // Phase 2 can optionally include enhanced_prompt and connected_services for refinement (v8 feature)
      if (phase === 2) {
        requestBody.enhanced_prompt = enhancedPrompt || null;
        requestBody.connected_services = null; // Can be populated if user connects new service
      }

      // Phase 3 requires clarification_answers
      if (phase === 3 && answers) {
        requestBody.clarification_answers = answers;
      }

      // Phase 4: Technical workflow generation (enhanced_prompt is in thread context)
      if (phase === 4) {
        // If we have collected technical inputs, map them to resolved_user_inputs in enhanced_prompt
        if (enhancedPrompt && Object.keys(technicalInputsCollected).length > 0) {
          // Map technical inputs to ResolvedUserInput format: { key, value }
          const newResolvedInputs = Object.entries(technicalInputsCollected).map(([key, value]) => ({
            key,
            value
          }));

          // Merge with existing resolved_user_inputs if any
          const existingResolved = enhancedPrompt.specifics?.resolved_user_inputs || [];
          const mergedResolved = [...existingResolved];

          // Add or update resolved inputs (avoid duplicates by key)
          newResolvedInputs.forEach(newInput => {
            const existingIndex = mergedResolved.findIndex((r: { key: string }) => r.key === newInput.key);
            if (existingIndex >= 0) {
              mergedResolved[existingIndex] = newInput;
            } else {
              mergedResolved.push(newInput);
            }
          });

          // Create updated enhanced_prompt with resolved inputs
          requestBody.enhanced_prompt = {
            ...enhancedPrompt,
            specifics: {
              ...enhancedPrompt.specifics,
              resolved_user_inputs: mergedResolved
            }
          };

          addDebugLog('info', `Mapped ${newResolvedInputs.length} technical inputs to resolved_user_inputs`);
        } else {
          // Pass enhanced_prompt as-is if no technical inputs collected
          requestBody.enhanced_prompt = enhancedPrompt || null;
        }
      }

      const response = await fetch('/api/agent-creation/process-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      const data = await response.json();

      // Capture process-message communication
      setApiCommunications(prev => [...prev, {
        timestamp: new Date().toISOString(),
        phase: phase,
        endpoint: '/api/agent-creation/process-message',
        request: requestBody,
        response: data
      }]);

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

          // Check if mini-cycle is needed (user_inputs_required exists and not empty)
          const userInputsRequired = data.enhanced_prompt?.specifics?.user_inputs_required;
          if (userInputsRequired && Array.isArray(userInputsRequired) && userInputsRequired.length > 0 && !isInMiniCycle) {
            addDebugLog('info', `User inputs required detected: ${userInputsRequired.join(', ')}`);
            addDebugLog('info', 'Starting mini-cycle to refine user inputs...');

            // Store Phase 3 result for mini-cycle
            setMiniCyclePhase3(data.enhanced_prompt);
            setIsInMiniCycle(true);

            // Trigger Phase 2 mini with enhanced_prompt
            await processMessage(2, undefined, currentThreadId);
          }
        }
        // Handle Phase 4 response with technical workflow
        else if (phase === 4 && data.technical_workflow) {
          setTechnicalWorkflow(data.technical_workflow);
          setTechnicalInputsRequired(data.technical_inputs_required || []);
          setFeasibility(data.feasibility);
          setPhase4Response(data);
          setCurrentPhase(4);

          // Add AI response to history
          setConversationHistory(prev => [...prev, {
            role: 'assistant',
            content: data.conversationalSummary || 'Technical workflow generated.',
            data: {
              technical_workflow: data.technical_workflow,
              technical_inputs_required: data.technical_inputs_required,
              feasibility: data.feasibility,
              metadata: data.metadata
            }
          }]);

          const phase4Metadata = data.metadata?.phase4;
          addDebugLog('success', `Phase 4 complete - ${data.technical_workflow.length} workflow steps generated`);

          // Log feasibility status
          if (data.feasibility?.can_execute) {
            addDebugLog('success', 'Feasibility check passed - workflow can be executed');
          } else {
            addDebugLog('info', `Feasibility issues: ${data.feasibility?.blocking_issues?.length || 0} blocking, ${data.feasibility?.warnings?.length || 0} warnings`);
          }

          // Check if technical inputs are needed
          if (phase4Metadata?.needs_technical_inputs && data.technical_inputs_required?.length > 0) {
            addDebugLog('info', `Technical inputs required: ${data.technical_inputs_required.map((i: any) => i.key).join(', ')}`);
          }

          // Check if ready for generation
          if (data.metadata?.ready_for_generation) {
            addDebugLog('success', 'Agent is ready for generation!');
          }
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

      if (isInMiniCycle) {
        addDebugLog('info', 'Mini-cycle questions answered, generating refined enhanced prompt...');
        // Mini-cycle: Generate Phase 3 refined
        processMessage(3, updatedAnswers);
        // Reset mini-cycle state after Phase 3 completes
        setIsInMiniCycle(false);
        setMiniCyclePhase3(null);
      } else {
        addDebugLog('info', 'All questions answered, generating enhanced prompt...');
        // Regular flow: Generate Phase 3
        processMessage(3, updatedAnswers);
      }
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
    // Automatically trigger agent generation
    generateAgentV4();
  };

  // Generate Agent using V4 API (OpenAI 3-Stage Architecture)
  const generateAgentV4 = async () => {
    // Check for any valid input: Phase 4 technical workflow, enhanced prompt, or raw prompt
    const hasTechnicalWorkflow = technicalWorkflow && technicalWorkflow.length > 0;
    if (!hasTechnicalWorkflow && !enhancedPrompt && !initialPrompt) {
      addDebugLog('error', 'No prompt available for agent generation');
      setAgentGenerationError('No prompt available. Complete Phase 3 or Phase 4 first.');
      return;
    }

    setIsGeneratingAgent(true);
    setAgentGenerationError(null);
    setGeneratedAgent(null);

    try {
      // Log which path we're taking
      if (hasTechnicalWorkflow) {
        addDebugLog('info', `Starting V4 agent generation with Phase 4 technical workflow (${technicalWorkflow.length} steps)...`);
      } else {
        addDebugLog('info', 'Starting V4 agent generation (OpenAI 3-Stage)...');
      }

      // Build clarification answers with plan description
      const fullClarificationAnswers = {
        ...clarificationAnswers,
        originalPrompt: initialPrompt,
        plan_description: enhancedPrompt?.description || analysisData?.plan_description || '',
        sessionId: threadId,
        agentId: uuidv4(),
      };

      // Extract services involved from enhanced prompt or Phase 4 response
      const servicesInvolved = phase4Response?.metadata?.services_involved ||
                               enhancedPrompt?.specifics?.services_involved ||
                               analysisData?.services_involved ||
                               [];

      // Build request body - Priority: Phase 4 technical workflow > enhanced prompt > raw prompt
      let promptPayload: Record<string, any>;
      if (hasTechnicalWorkflow) {
        // Use Phase 4 technical workflow (bypasses Stage 1 LLM, uses DSL builder directly)
        promptPayload = {
          enhancedPromptTechnicalWorkflow: {
            technical_workflow: technicalWorkflow,
            technical_inputs_required: technicalInputsRequired,
            feasibility: feasibility,
          }
        };
      } else if (enhancedPrompt) {
        // Use enhanced prompt from Phase 3
        promptPayload = { enhancedPrompt: JSON.stringify(enhancedPrompt) };
      } else {
        // Fallback to raw prompt
        promptPayload = { prompt: initialPrompt };
      }

      const requestBody = {
        ...promptPayload,
        clarificationAnswers: fullClarificationAnswers,
        services_involved: servicesInvolved,
        sessionId: threadId,
        agentId: fullClarificationAnswers.agentId,
      };

      addDebugLog('info', `Calling /api/generate-agent-v4 with ${servicesInvolved.length} services${hasTechnicalWorkflow ? ' (technical workflow path)' : ''}...`);

      // Track API call
      const apiCallRecord = {
        timestamp: new Date().toISOString(),
        phase: 'agent-generation-v4',
        endpoint: '/api/generate-agent-v4',
        request: requestBody,
        response: null as any,
      };

      const response = await fetch('/api/generate-agent-v4', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      const data = await response.json();
      apiCallRecord.response = data;
      setApiCommunications(prev => [...prev, apiCallRecord]);

      if (data.success) {
        setGeneratedAgent(data);
        addDebugLog('success', `Agent generated successfully: ${data.agent?.agent_name || 'Unnamed'}`);
        addDebugLog('info', `Agent ID: ${data.agentId}`);
        addDebugLog('info', `Workflow steps: ${data.agent?.workflow_steps?.length || 0}`);
        addDebugLog('info', `Latency: ${data.extraction_details?.latency_ms || 0}ms`);

        // Add to conversation history
        setConversationHistory(prev => [...prev, {
          role: 'assistant',
          content: `Agent "${data.agent?.agent_name}" generated successfully with ${data.agent?.workflow_steps?.length || 0} workflow steps.`,
          data: {
            agentId: data.agentId,
            agent_name: data.agent?.agent_name,
            workflow_steps_count: data.agent?.workflow_steps?.length,
            plugins_required: data.agent?.plugins_required,
            metadata: data.metadata,
          }
        }]);
      } else {
        const errorMsg = data.error || 'Unknown error during agent generation';
        setAgentGenerationError(errorMsg);
        addDebugLog('error', `Agent generation failed: ${errorMsg}`);
        if (data.stage_failed) {
          addDebugLog('error', `Stage failed: ${data.stage_failed}`);
        }
        if (data.warnings?.length > 0) {
          data.warnings.forEach((w: string) => addDebugLog('info', `Warning: ${w}`));
        }
      }
    } catch (error: any) {
      const errorMsg = error.message || 'Network error during agent generation';
      setAgentGenerationError(errorMsg);
      addDebugLog('error', `Agent generation exception: ${errorMsg}`);
    } finally {
      setIsGeneratingAgent(false);
    }
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
    setApiCommunications([]);
    setIsInMiniCycle(false);
    setMiniCyclePhase3(null);
    // Reset Phase 4 state
    setTechnicalWorkflow([]);
    setTechnicalInputsRequired([]);
    setFeasibility(null);
    setPhase4Response(null);
    setTechnicalInputsCollected({});
    // Reset Agent Generation state
    setGeneratedAgent(null);
    setAgentGenerationError(null);
    addDebugLog('info', 'Thread conversation reset');
  };

  const downloadCommunicationHistory = () => {
    // Group communications by type for summary
    const initThreadComms = apiCommunications.filter(c => c.phase === 'init');
    const phase1Comms = apiCommunications.filter(c => c.phase === 1);
    const phase2Comms = apiCommunications.filter(c => c.phase === 2);
    const phase3Comms = apiCommunications.filter(c => c.phase === 3);

    const communicationData = {
      metadata: {
        thread_id: threadId,
        user_id: userId,
        initial_prompt: initialPrompt,
        exported_at: new Date().toISOString(),
        total_communications: apiCommunications.length,
        summary: {
          init_thread_calls: initThreadComms.length,
          phase_1_calls: phase1Comms.length,
          phase_2_calls: phase2Comms.length,
          phase_3_calls: phase3Comms.length
        }
      },
      communications: apiCommunications,
      final_state: {
        current_phase: currentPhase,
        clarity_score: clarityScore,
        missing_plugins: missingPlugins,
        enhanced_prompt: enhancedPrompt,
        analysis_data: analysisData
      }
    };

    const jsonString = JSON.stringify(communicationData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `thread-communications-${threadId || 'unknown'}-${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    addDebugLog('success', 'Communication history downloaded');
  };

  // Free Tier User Creation Functions
  const createFreeTierUser = async () => {
    if (!freeTierUserId.trim()) {
      addDebugLog('error', 'User ID is required');
      return;
    }

    setIsLoading(true);
    setFreeTierResponse(null);

    try {
      addDebugLog('info', `Creating free tier subscription for user: ${freeTierUserId}`);

      const response = await fetch('/api/onboarding/allocate-free-tier', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: freeTierUserId
        }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        addDebugLog('success', `Free tier created successfully for ${freeTierUserId}`);
        setFreeTierResponse(data);
      } else {
        addDebugLog('error', `Failed to create free tier: ${data.error || 'Unknown error'}`);
        setFreeTierResponse(data);
      }
    } catch (error: any) {
      addDebugLog('error', `API error: ${error.message}`);
      setFreeTierResponse({ success: false, error: error.message });
    } finally {
      setIsLoading(false);
    }
  };

  const resetFreeTierForm = () => {
    setFreeTierUserId('');
    setFreeTierResponse(null);
    addDebugLog('info', 'Free tier form reset');
  };

  // Agent Execution functions
  const loadUserAgents = async () => {
    if (!userId.trim()) {
      addDebugLog('error', 'User ID is required to load agents');
      return;
    }

    try {
      addDebugLog('info', 'Loading user agents...');
      const response = await fetch(`/api/agents?user_id=${userId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': userId
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      const agents = result.agents || result.data || result || [];
      setAgentsList(Array.isArray(agents) ? agents : []);
      addDebugLog('success', `Loaded ${agents.length} agents`);
    } catch (error: any) {
      addDebugLog('error', `Failed to load agents: ${error.message}`);
      setAgentsList([]);
    }
  };

  // Load full agent details including pilot_steps
  const loadAgentDetails = async (agentIdToLoad: string) => {
    if (!agentIdToLoad.trim()) return;

    try {
      addDebugLog('info', `Loading agent details for ${agentIdToLoad}...`);
      const response = await fetch(`/api/agents/${agentIdToLoad}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': userId
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      const agent = result.agent || result.data || result;
      setSelectedAgentDetails(agent);

      // Extract workflow steps (pilot_steps has priority over workflow_steps)
      const steps = agent.pilot_steps || agent.workflow_steps || [];
      const workflowSteps: WorkflowStep[] = steps.map((step: any, index: number) => ({
        id: step.id || step.step_id || `step-${index}`,
        name: step.name || step.step_name || `Step ${index + 1}`,
        type: step.type || step.step_type,
        description: step.description,
        action: step.action,
        plugin: step.plugin
      }));

      setAgentWorkflowSteps(workflowSteps);

      // Initialize step statuses in debug stream
      debugStream.initializeSteps(workflowSteps.map(s => ({ id: s.id, name: s.name })));

      addDebugLog('success', `Loaded agent "${agent.agent_name}" with ${workflowSteps.length} workflow steps`);
    } catch (error: any) {
      addDebugLog('error', `Failed to load agent details: ${error.message}`);
      setSelectedAgentDetails(null);
      setAgentWorkflowSteps([]);
    }
  };

  // Handle agent selection change
  const handleAgentSelection = (newAgentId: string) => {
    setAgentId(newAgentId);
    if (newAgentId) {
      loadAgentDetails(newAgentId);
    } else {
      setSelectedAgentDetails(null);
      setAgentWorkflowSteps([]);
    }
  };

  const executeAgent = async () => {
    if (!agentId.trim()) {
      addDebugLog('error', 'Agent ID is required');
      return;
    }

    let parsedInputs: Record<string, any> = {};
    try {
      parsedInputs = JSON.parse(agentInputVariables);
    } catch (error) {
      addDebugLog('error', 'Invalid JSON in input variables');
      return;
    }

    setIsExecutingAgent(true);
    setAgentExecutionResult(null);

    try {
      addDebugLog('info', `Executing agent ${agentId}...`);
      const startTime = Date.now();

      const response = await fetch('/api/run-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_id: agentId,
          input_variables: parsedInputs,
          override_user_prompt: agentOverridePrompt || undefined,
          execution_type: 'test',
          use_agentkit: useAgentKit,
        }),
      });

      const result = await response.json();
      const executionTime = Date.now() - startTime;

      setAgentExecutionResult({
        ...result,
        _meta: {
          executionTimeMs: executionTime,
          timestamp: new Date().toISOString(),
        }
      });

      if (result.success) {
        addDebugLog('success', `Agent executed successfully in ${executionTime}ms | Tokens: ${result.data?.tokens_used || 'N/A'}`);
      } else {
        addDebugLog('error', `Agent execution failed: ${result.error || 'Unknown error'}`);
      }
    } catch (error: any) {
      addDebugLog('error', `Execution error: ${error.message}`);
      setAgentExecutionResult({ success: false, error: error.message });
    } finally {
      setIsExecutingAgent(false);
    }
  };

  // Execute workflow in sandbox mode (inline, no DB)
  const executeSandbox = async () => {
    if (!sandboxAgentName.trim()) {
      addDebugLog('error', 'Agent name is required for sandbox execution');
      return;
    }

    let parsedSteps: any[] = [];
    let parsedPlugins: string[] = [];
    let parsedInputs: Record<string, any> = {};

    try {
      parsedSteps = JSON.parse(sandboxPilotSteps);
      if (!Array.isArray(parsedSteps) || parsedSteps.length === 0) {
        addDebugLog('error', 'Pilot steps must be a non-empty array');
        return;
      }
    } catch (error) {
      addDebugLog('error', 'Invalid JSON in pilot steps');
      return;
    }

    try {
      parsedPlugins = JSON.parse(sandboxPluginsRequired);
      if (!Array.isArray(parsedPlugins)) {
        addDebugLog('error', 'Plugins required must be an array');
        return;
      }
    } catch (error) {
      addDebugLog('error', 'Invalid JSON in plugins required');
      return;
    }

    try {
      parsedInputs = JSON.parse(agentInputVariables);
    } catch (error) {
      addDebugLog('error', 'Invalid JSON in input variables');
      return;
    }

    setIsExecutingAgent(true);
    setAgentExecutionResult(null);

    // Update workflow steps for visualization
    setAgentWorkflowSteps(parsedSteps);

    // Generate debug run ID if debug mode is enabled
    const runId = debugModeEnabled ? uuidv4() : undefined;

    // If debug mode, connect to SSE stream before starting execution
    if (debugModeEnabled && runId) {
      addDebugLog('info', `[Sandbox] Starting debug execution with runId: ${runId}`);

      // Reset and initialize step statuses for visualization
      debugStream.reset();
      debugStream.initializeSteps(parsedSteps.map((s: any) => ({ id: s.id, name: s.name })));

      // Connect to debug stream FIRST (before starting execution)
      debugStream.connect(runId);

      // Small delay to ensure SSE connection is established
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    try {
      addDebugLog('info', `[Sandbox] Executing "${sandboxAgentName}" with ${parsedSteps.length} steps...`);
      const startTime = Date.now();

      const response = await fetch('/api/run-agent-sandbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_name: sandboxAgentName,
          pilot_steps: parsedSteps,
          plugins_required: parsedPlugins,
          input_variables: parsedInputs,
          user_prompt: agentOverridePrompt || undefined,
          debugMode: debugModeEnabled,
          debugRunId: runId,
        }),
      });

      const result = await response.json();
      const executionTime = Date.now() - startTime;

      // If debug mode is active, the detailed results come through SSE events
      // But we still show the final result
      if (debugModeEnabled && !result.success) {
        // If failed immediately (not in debug mode), disconnect
        debugStream.disconnect();
      }

      setAgentExecutionResult({
        ...result,
        _meta: {
          executionTimeMs: executionTime,
          timestamp: new Date().toISOString(),
          sandbox: true,
        }
      });

      if (result.success) {
        addDebugLog('success', `[Sandbox] Executed successfully in ${executionTime}ms | Tokens: ${result.data?.tokens_used || 'N/A'}`);
      } else {
        addDebugLog('error', `[Sandbox] Execution failed: ${result.error || 'Unknown error'}`);
      }
    } catch (error: any) {
      addDebugLog('error', `[Sandbox] Execution error: ${error.message}`);
      setAgentExecutionResult({ success: false, error: error.message, sandbox: true });
      if (debugModeEnabled) {
        debugStream.disconnect();
      }
    } finally {
      setIsExecutingAgent(false);
    }
  };

  // Import agent JSON into sandbox fields
  const importSandboxJson = () => {
    try {
      const parsed = JSON.parse(sandboxJsonImport);

      // Extract agent data - support both root-level agent and direct agent object
      const agent = parsed.agent || parsed;

      if (!agent) {
        addDebugLog('error', 'No agent data found in JSON');
        return;
      }

      // Extract agent name
      if (agent.agent_name) {
        setSandboxAgentName(agent.agent_name);
      }

      // Extract pilot_steps (prefer pilot_steps over workflow_steps)
      const steps = agent.pilot_steps || agent.workflow_steps;
      if (steps && Array.isArray(steps)) {
        setSandboxPilotSteps(JSON.stringify(steps, null, 2));
        // Also update workflow steps for visualization
        setAgentWorkflowSteps(steps);
      }

      // Extract plugins_required
      if (agent.plugins_required && Array.isArray(agent.plugins_required)) {
        setSandboxPluginsRequired(JSON.stringify(agent.plugins_required));
      }

      // Extract input_schema and generate default input_variables
      if (agent.input_schema && Array.isArray(agent.input_schema)) {
        const defaultInputs: Record<string, string> = {};
        agent.input_schema.forEach((field: any) => {
          if (field.name) {
            defaultInputs[field.name] = field.placeholder || field.description || '';
          }
        });
        if (Object.keys(defaultInputs).length > 0) {
          setAgentInputVariables(JSON.stringify(defaultInputs, null, 2));
        }
      }

      // Close modal and log success
      setShowJsonImportModal(false);
      setSandboxJsonImport('');

      const stepCount = steps?.length || 0;
      const pluginCount = agent.plugins_required?.length || 0;
      addDebugLog('success', `[Sandbox] Imported "${agent.agent_name}" with ${stepCount} steps and ${pluginCount} plugins`);

    } catch (error: any) {
      addDebugLog('error', `[Sandbox] JSON import failed: ${error.message}`);
    }
  };

  // Start debug execution with step-by-step mode
  const startDebugExecution = async () => {
    if (!agentId.trim()) {
      addDebugLog('error', 'Agent ID is required');
      return;
    }

    let parsedInputs: Record<string, any> = {};
    try {
      parsedInputs = JSON.parse(agentInputVariables);
    } catch (error) {
      addDebugLog('error', 'Invalid JSON in input variables');
      return;
    }

    // Generate a debug run ID
    const runId = uuidv4();
    addDebugLog('info', `Starting debug execution with runId: ${runId}`);

    setIsExecutingAgent(true);
    setAgentExecutionResult(null);

    // Reset and initialize step statuses
    debugStream.reset();
    debugStream.initializeSteps(agentWorkflowSteps.map(s => ({ id: s.id, name: s.name })));

    try {
      // Connect to debug stream FIRST (before starting execution)
      debugStream.connect(runId);

      // Small delay to ensure SSE connection is established
      await new Promise(resolve => setTimeout(resolve, 500));

      addDebugLog('info', `Executing agent ${agentId} in debug mode...`);

      // Start execution with debug mode enabled
      const response = await fetch('/api/run-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_id: agentId,
          input_variables: parsedInputs,
          override_user_prompt: agentOverridePrompt || undefined,
          execution_type: 'test',
          use_agentkit: false, // Use Pilot for debug mode
          debugMode: true,
          debugRunId: runId,
        }),
      });

      const result = await response.json();

      if (!result.success && !result.debugMode) {
        // If not in debug mode or failed immediately, show result
        setAgentExecutionResult(result);
        setIsExecutingAgent(false);
        debugStream.disconnect();

        if (!result.success) {
          addDebugLog('error', `Debug execution failed: ${result.error || 'Unknown error'}`);
        }
      }
      // If debug mode is active, the result will come through SSE events
    } catch (error: any) {
      addDebugLog('error', `Debug execution error: ${error.message}`);
      setAgentExecutionResult({ success: false, error: error.message });
      setIsExecutingAgent(false);
      debugStream.disconnect();
    }
  };

  // Debug control handlers
  const handleDebugPause = () => {
    addDebugLog('info', 'Pausing execution...');
    debugStream.pause();
  };

  const handleDebugResume = () => {
    addDebugLog('info', 'Resuming execution...');
    debugStream.resume();
  };

  const handleDebugStep = () => {
    addDebugLog('info', 'Stepping to next...');
    debugStream.step();
  };

  const handleDebugStop = () => {
    addDebugLog('info', 'Stopping execution...');
    debugStream.stop();
    setIsExecutingAgent(false);
  };

  const handleDebugReset = () => {
    debugStream.reset();
    setAgentExecutionResult(null);
    debugStream.initializeSteps(agentWorkflowSteps.map(s => ({ id: s.id, name: s.name })));
    addDebugLog('info', 'Debug session reset');
  };

  const resetAgentExecutionForm = () => {
    setAgentId('');
    setAgentInputVariables('{}');
    setAgentOverridePrompt('');
    setAgentExecutionResult(null);
    setSelectedAgentDetails(null);
    setAgentWorkflowSteps([]);
    debugStream.reset();
    addDebugLog('info', 'Agent execution form reset');
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
            marginRight: '5px',
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
        <button
          onClick={() => setActiveTab('free-tier-users')}
          style={{
            padding: '10px 20px',
            marginRight: '5px',
            backgroundColor: activeTab === 'free-tier-users' ? '#007bff' : '#f8f9fa',
            color: activeTab === 'free-tier-users' ? 'white' : '#333',
            border: 'none',
            borderBottom: activeTab === 'free-tier-users' ? '3px solid #0056b3' : 'none',
            cursor: 'pointer',
            fontSize: '16px',
            fontWeight: activeTab === 'free-tier-users' ? 'bold' : 'normal'
          }}
        >
          Free Tier Users
        </button>
        <button
          onClick={() => setActiveTab('agent-execution')}
          style={{
            padding: '10px 20px',
            backgroundColor: activeTab === 'agent-execution' ? '#007bff' : '#f8f9fa',
            color: activeTab === 'agent-execution' ? 'white' : '#333',
            border: 'none',
            borderBottom: activeTab === 'agent-execution' ? '3px solid #0056b3' : 'none',
            cursor: 'pointer',
            fontSize: '16px',
            fontWeight: activeTab === 'agent-execution' ? 'bold' : 'normal'
          }}
        >
          Agent Execution
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
            Status: {userStatus.summary.connected_count} connected
            {userStatus.summary.active_expired_count > 0 && (
              <span style={{ color: 'orange' }}>, {userStatus.summary.active_expired_count} expired</span>
            )}
            , {userStatus.summary.disconnected_count} disconnected
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
            {availablePlugins.map(plugin => {
              const status = getPluginStatus(plugin.key);
              const statusColor = status === 'connected' ? 'green' : status === 'token_expired' ? 'orange' : 'red';
              return (
                <option
                  key={plugin.key}
                  value={plugin.key}
                  style={{ color: statusColor }}
                >
                  {plugin.name} (v{plugin.version}){status === 'token_expired' ? ' [Expired]' : ''}
                </option>
              );
            })}
          </select>
        </div>
        
        {selectedPlugin && (
          <div style={{ marginBottom: '15px' }}>
            <div style={{ marginBottom: '10px', fontSize: '14px' }}>
              Status: {(() => {
                const status = getPluginStatus(selectedPlugin);
                switch (status) {
                  case 'connected':
                    return <span style={{ color: 'green' }}>✓ Connected</span>;
                  case 'token_expired':
                    return <span style={{ color: 'orange' }}>⚠ Token Expired</span>;
                  default:
                    return <span style={{ color: 'red' }}>✗ Not Connected</span>;
                }
              })()}
            </div>
            {getPluginStatus(selectedPlugin) === 'token_expired' ? (
              <button
                onClick={() => refreshPluginToken(selectedPlugin)}
                disabled={isLoading || !userId.trim()}
                style={{
                  padding: '10px 20px',
                  marginRight: '10px',
                  backgroundColor: '#ffc107',
                  color: 'black',
                  border: 'none',
                  borderRadius: '3px',
                  cursor: isLoading || !userId.trim() ? 'not-allowed' : 'pointer'
                }}
              >
                {isLoading ? 'Refreshing...' : 'Refresh Token'}
              </button>
            ) : (
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
            )}
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

                {/* Provider/Model Selector - for test/analyze-prompt and test/generate-agent-v5-test-wrapper */}
                {(selectedAIService === 'test/analyze-prompt' || selectedAIService === 'test/generate-agent-v5-test-wrapper') && (
                  <div style={{
                    marginBottom: '20px',
                    padding: '15px',
                    backgroundColor: '#e7f3ff',
                    borderRadius: '5px',
                    border: '1px solid #b3d7ff'
                  }}>
                    <h3 style={{ marginTop: 0, marginBottom: '15px', color: '#0056b3' }}>
                      AI Provider Selection
                    </h3>
                    <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                      <div>
                        <label htmlFor="providerSelect" style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                          Provider:
                        </label>
                        <select
                          id="providerSelect"
                          value={selectedProvider}
                          onChange={(e) => handleProviderChange(e.target.value as ProviderOption)}
                          style={{
                            padding: '8px 12px',
                            fontSize: '14px',
                            borderRadius: '3px',
                            border: '1px solid #ccc',
                            minWidth: '150px'
                          }}
                        >
                          {PROVIDER_OPTIONS.map(provider => (
                            <option key={provider} value={provider}>
                              {provider.charAt(0).toUpperCase() + provider.slice(1)}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label htmlFor="modelSelect" style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                          Model:
                        </label>
                        <select
                          id="modelSelect"
                          value={selectedModel}
                          onChange={(e) => handleModelChange(e.target.value)}
                          style={{
                            padding: '8px 12px',
                            fontSize: '14px',
                            borderRadius: '3px',
                            border: '1px solid #ccc',
                            minWidth: '280px'
                          }}
                        >
                          {MODELS_BY_PROVIDER[selectedProvider].map(model => (
                            <option key={model.value} value={model.value}>
                              {model.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div style={{ marginTop: '10px', fontSize: '12px', color: '#666' }}>
                      Note: OpenAI supports native JSON schema mode. Other providers use prompt-based JSON instructions.
                    </div>
                  </div>
                )}

                {/* Plugin Loader - only for test/analyze-prompt */}
                {selectedAIService === 'test/analyze-prompt' && (
                  <div style={{
                    marginBottom: '20px',
                    padding: '15px',
                    backgroundColor: '#f0fff0',
                    borderRadius: '5px',
                    border: '1px solid #90ee90'
                  }}>
                    <h3 style={{ marginTop: 0, marginBottom: '15px', color: '#228b22' }}>
                      Plugin Context
                    </h3>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                      <button
                        onClick={loadUserPluginsForTest}
                        disabled={isLoadingPlugins}
                        style={{
                          padding: '8px 16px',
                          backgroundColor: isLoadingPlugins ? '#ccc' : '#228b22',
                          color: 'white',
                          border: 'none',
                          borderRadius: '3px',
                          cursor: isLoadingPlugins ? 'not-allowed' : 'pointer',
                          fontSize: '14px'
                        }}
                      >
                        {isLoadingPlugins ? 'Loading...' : 'Load My Plugins'}
                      </button>
                      <span style={{ fontSize: '14px', color: '#555' }}>
                        {userConnectedPluginKeys.length > 0
                          ? `Loaded: ${userConnectedPluginKeys.join(', ')}`
                          : 'Click to load user\'s connected plugins'}
                      </span>
                    </div>
                    <div style={{ marginTop: '10px', fontSize: '12px', color: '#666' }}>
                      Loads connected plugins from /api/plugins/user-status and updates availablePlugins in request body.
                    </div>
                  </div>
                )}

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
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px' }}>
                    <label htmlFor="aiServiceRequestBody">Request Body (JSON):</label>
                    <button
                      onClick={() => {
                        setJsonPromptImportError(null);
                        setShowJsonPromptModal(true);
                      }}
                      style={{
                        padding: '4px 10px',
                        backgroundColor: '#6f42c1',
                        color: 'white',
                        border: 'none',
                        borderRadius: '3px',
                        cursor: 'pointer',
                        fontSize: '12px'
                      }}
                      title="Import JSON with prompt field to merge into request body"
                    >
                      Import JSON Prompt
                    </button>
                  </div>
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
              <h2 style={{ margin: 0 }}>Thread Session Info</h2>
              <div style={{ display: 'flex', gap: '10px' }}>
                {threadId && (
                  <>
                    <button
                      onClick={resetThreadState}
                      style={{
                        padding: '8px 16px',
                        backgroundColor: '#6c757d',
                        color: 'white',
                        border: 'none',
                        borderRadius: '3px',
                        cursor: 'pointer',
                        fontSize: '14px'
                      }}
                      title="Reset and start a new thread"
                    >
                      🔄 New Thread
                    </button>
                    <button
                      onClick={downloadCommunicationHistory}
                      disabled={apiCommunications.length === 0}
                      style={{
                        padding: '8px 16px',
                        backgroundColor: apiCommunications.length === 0 ? '#ccc' : '#17a2b8',
                        color: 'white',
                        border: 'none',
                        borderRadius: '3px',
                        cursor: apiCommunications.length === 0 ? 'not-allowed' : 'pointer',
                        fontSize: '14px'
                      }}
                      title={`Download all API communications (${apiCommunications.length} calls)`}
                    >
                      📥 Download JSON ({apiCommunications.length})
                    </button>
                  </>
                )}
              </div>
            </div>
            <div style={{ fontSize: '14px', color: '#333' }}>
              <div><strong>Thread ID:</strong> {threadId || 'Not started'}</div>
              <div><strong>Current Phase:</strong> {currentPhase} {isInMiniCycle && <span style={{ color: '#ff6b6b', fontWeight: 'bold' }}>(Mini-Cycle Active)</span>}</div>
              <div><strong>AI Provider:</strong> {selectedProvider.charAt(0).toUpperCase() + selectedProvider.slice(1)} / {selectedModel}</div>
              <div><strong>Clarity Score:</strong> {clarityScore}%</div>
              <div><strong>API Calls Tracked:</strong> {apiCommunications.length}</div>
              {apiCommunications.length > 0 && (
                <div style={{ marginTop: '10px', padding: '8px', backgroundColor: '#e7f3ff', borderRadius: '3px' }}>
                  <strong>Captured Communications:</strong>
                  <div style={{ marginTop: '5px', fontSize: '12px' }}>
                    {apiCommunications.map((comm, idx) => (
                      <div key={idx} style={{ marginBottom: '3px' }}>
                        • {comm.phase === 'init' ? 'Init Thread' : `Phase ${comm.phase}`} - {new Date(comm.timestamp).toLocaleTimeString()}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {missingPlugins.length > 0 && (
                <div><strong>Missing Plugins:</strong> {missingPlugins.join(', ')}</div>
              )}
            </div>
          </div>

          {/* Thread Mode Selection - Toggle between New and Existing */}
          {!threadId && (
            <div style={{ marginBottom: '30px', padding: '15px', border: '1px solid #6c757d', borderRadius: '5px', backgroundColor: '#f8f9fa' }}>
              {/* Mode Toggle */}
              <div style={{ display: 'flex', gap: '0', marginBottom: '20px' }}>
                <button
                  onClick={() => setThreadMode('new')}
                  style={{
                    flex: 1,
                    padding: '12px 20px',
                    backgroundColor: threadMode === 'new' ? '#007bff' : '#e9ecef',
                    color: threadMode === 'new' ? 'white' : '#495057',
                    border: '1px solid #6c757d',
                    borderRadius: '5px 0 0 5px',
                    cursor: 'pointer',
                    fontSize: '16px',
                    fontWeight: threadMode === 'new' ? 'bold' : 'normal',
                    transition: 'all 0.2s'
                  }}
                >
                  ➕ Start New Thread
                </button>
                <button
                  onClick={() => {
                    setThreadMode('existing');
                    // Auto-load threads when switching to existing mode
                    if (userId && recentThreads.length === 0) {
                      loadRecentThreads();
                    }
                  }}
                  style={{
                    flex: 1,
                    padding: '12px 20px',
                    backgroundColor: threadMode === 'existing' ? '#17a2b8' : '#e9ecef',
                    color: threadMode === 'existing' ? 'white' : '#495057',
                    border: '1px solid #6c757d',
                    borderRadius: '0 5px 5px 0',
                    cursor: 'pointer',
                    fontSize: '16px',
                    fontWeight: threadMode === 'existing' ? 'bold' : 'normal',
                    transition: 'all 0.2s'
                  }}
                >
                  📂 Load Existing Thread
                </button>
              </div>

              {/* Existing Thread Mode - Dropdown */}
              {threadMode === 'existing' && (
                <div style={{ padding: '15px', backgroundColor: '#e7f5ff', borderRadius: '5px', border: '1px solid #17a2b8' }}>
                  {!userId ? (
                    <div style={{ padding: '10px', backgroundColor: '#fff3cd', borderRadius: '3px' }}>
                      ⚠️ Enter a User ID above to load recent threads
                    </div>
                  ) : (
                    <>
                      <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', marginBottom: '15px' }}>
                        <div style={{ flex: 1 }}>
                          <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                            Select Thread:
                          </label>
                          <select
                            value={selectedThreadId}
                            onChange={(e) => setSelectedThreadId(e.target.value)}
                            style={{
                              width: '100%',
                              padding: '10px',
                              fontSize: '14px',
                              border: '1px solid #ccc',
                              borderRadius: '3px',
                              backgroundColor: 'white'
                            }}
                          >
                            <option value="">-- Select a thread --</option>
                            {recentThreads.map((thread) => {
                              const createdAt = new Date(thread.created_at);
                              const dateStr = createdAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                              // Use top-level user_prompt column, fallback to metadata for older rows
                              const userPrompt = thread.user_prompt || thread.metadata?.user_prompt || '';
                              const promptPreview = userPrompt
                                ? userPrompt.substring(0, 60) + (userPrompt.length > 60 ? '...' : '')
                                : 'No prompt';
                              const shortId = thread.id.substring(0, 8);
                              const isExpired = new Date(thread.expires_at) < new Date();
                              return (
                                <option
                                  key={thread.id}
                                  value={thread.openai_thread_id}
                                  style={{ color: isExpired ? '#dc3545' : '#28a745' }}
                                >
                                  {isExpired ? '⏰ ' : '✅ '}{dateStr} | P{thread.current_phase} | {thread.status} | {shortId} | {promptPreview}
                                </option>
                              );
                            })}
                          </select>
                        </div>
                        <button
                          onClick={loadRecentThreads}
                          disabled={isLoadingRecentThreads}
                          style={{
                            padding: '10px 16px',
                            backgroundColor: '#17a2b8',
                            color: 'white',
                            border: 'none',
                            borderRadius: '3px',
                            cursor: isLoadingRecentThreads ? 'not-allowed' : 'pointer',
                            fontSize: '14px',
                            whiteSpace: 'nowrap'
                          }}
                          title="Refresh thread list"
                        >
                          {isLoadingRecentThreads ? '...' : '🔄'}
                        </button>
                        <button
                          onClick={() => selectedThreadId && loadThread(selectedThreadId)}
                          disabled={!selectedThreadId || isLoadingThread}
                          style={{
                            padding: '10px 20px',
                            backgroundColor: !selectedThreadId ? '#ccc' : '#28a745',
                            color: 'white',
                            border: 'none',
                            borderRadius: '3px',
                            cursor: !selectedThreadId ? 'not-allowed' : 'pointer',
                            fontSize: '14px',
                            fontWeight: 'bold',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          {isLoadingThread ? 'Loading...' : 'Load Thread'}
                        </button>
                      </div>

                      {/* Selected Thread Details Preview */}
                      {selectedThreadId && (() => {
                        const thread = recentThreads.find(t => t.openai_thread_id === selectedThreadId);
                        if (!thread) return null;
                        return (
                          <div style={{ padding: '10px', backgroundColor: 'white', borderRadius: '3px', border: '1px solid #ddd' }}>
                            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '8px' }}>
                              <span style={{
                                padding: '2px 8px',
                                borderRadius: '3px',
                                fontSize: '12px',
                                fontWeight: 'bold',
                                backgroundColor: thread.current_phase === 4 ? '#28a745' : thread.current_phase === 3 ? '#ffc107' : '#007bff',
                                color: thread.current_phase === 3 ? '#000' : 'white'
                              }}>
                                Phase {thread.current_phase}
                              </span>
                              <span style={{
                                padding: '2px 8px',
                                borderRadius: '3px',
                                fontSize: '12px',
                                backgroundColor: thread.status === 'completed' ? '#d4edda' : thread.status === 'active' ? '#cce5ff' : '#f8d7da',
                                color: thread.status === 'completed' ? '#155724' : thread.status === 'active' ? '#004085' : '#721c24'
                              }}>
                                {thread.status}
                              </span>
                              <span style={{ fontSize: '12px', color: '#666' }}>
                                {thread.ai_provider} / {thread.ai_model}
                              </span>
                              <span style={{ fontSize: '12px', color: '#888' }}>
                                {getTimeAgo(new Date(thread.created_at))}
                              </span>
                            </div>
                            <div style={{ fontSize: '14px', color: '#333' }}>
                              <strong>Prompt:</strong> {thread.metadata?.user_prompt || 'No prompt saved'}
                            </div>
                          </div>
                        );
                      })()}

                      {recentThreads.length === 0 && !isLoadingRecentThreads && (
                        <div style={{ padding: '15px', textAlign: 'center', color: '#666', backgroundColor: 'white', borderRadius: '3px' }}>
                          No recent threads found. Click 🔄 to refresh or start a new thread.
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* New Thread Mode - Provider/Model/Prompt */}
              {threadMode === 'new' && (
                <div style={{ padding: '15px', backgroundColor: '#e7f3ff', borderRadius: '5px', border: '1px solid #007bff' }}>

              {/* Provider and Model Selection */}
              <div style={{ marginBottom: '15px', display: 'flex', gap: '15px', flexWrap: 'wrap' }}>
                <div style={{ flex: '1', minWidth: '200px' }}>
                  <label htmlFor="providerSelect" style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                    AI Provider:
                  </label>
                  <select
                    id="providerSelect"
                    value={selectedProvider}
                    onChange={(e) => {
                      const newProvider = e.target.value as ProviderOption;
                      setSelectedProvider(newProvider);
                      // Reset model to first option when provider changes
                      setSelectedModel(MODELS_BY_PROVIDER[newProvider][0].value);
                    }}
                    style={{
                      width: '100%',
                      padding: '8px',
                      fontSize: '14px',
                      border: '1px solid #ccc',
                      borderRadius: '3px',
                      backgroundColor: 'white'
                    }}
                  >
                    {PROVIDER_OPTIONS.map(provider => (
                      <option key={provider} value={provider}>
                        {provider.charAt(0).toUpperCase() + provider.slice(1)}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ flex: '2', minWidth: '250px' }}>
                  <label htmlFor="modelSelect" style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                    Model:
                  </label>
                  <select
                    id="modelSelect"
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px',
                      fontSize: '14px',
                      border: '1px solid #ccc',
                      borderRadius: '3px',
                      backgroundColor: 'white'
                    }}
                  >
                    {MODELS_BY_PROVIDER[selectedProvider].map(model => (
                      <option key={model.value} value={model.value}>
                        {model.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

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
            </div>
          )}

          {/* Conversation History */}
          {conversationHistory.length > 0 && (
            <div style={{ marginBottom: '30px', padding: '15px', border: '1px solid #ccc', borderRadius: '5px' }}>
              <h2>Conversation History</h2>
              <div
                ref={conversationHistoryRef}
                style={{
                  maxHeight: '400px',
                  overflowY: 'auto',
                  padding: '10px',
                  backgroundColor: '#f8f9fa',
                  borderRadius: '3px'
                }}
              >
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
            <div style={{ marginBottom: '30px', padding: '15px', border: `2px solid ${isInMiniCycle ? '#ff6b6b' : '#007bff'}`, borderRadius: '5px', backgroundColor: isInMiniCycle ? '#fff5f5' : '#f0f8ff' }}>
              <h2>
                {isInMiniCycle && '🔄 Mini-Cycle: '}
                Question {currentQuestionIndex + 1} of {currentQuestions.length}
              </h2>
              {isInMiniCycle && (
                <div style={{ marginBottom: '15px', padding: '10px', backgroundColor: '#ffe0e0', borderRadius: '3px', fontSize: '14px', color: '#d63031' }}>
                  <strong>Refining User Inputs:</strong> The system needs more details about the required user inputs to make the workflow fully executable.
                </div>
              )}
              <div style={{ marginBottom: '15px' }}>
                <div style={{ fontWeight: 'bold', marginBottom: '10px', fontSize: '16px' }}>
                  {currentQuestions[currentQuestionIndex].question}
                </div>
                <div style={{ fontSize: '12px', color: '#666', marginBottom: '10px' }}>
                  {currentQuestions[currentQuestionIndex].theme ?
                    `Theme: ${currentQuestions[currentQuestionIndex].theme}` :
                    `Dimension: ${currentQuestions[currentQuestionIndex].dimension}`
                  }
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

                {/* Display sections if available (v8 format) */}
                {enhancedPrompt.sections && (
                  <div style={{ marginTop: '15px', padding: '10px', backgroundColor: '#f8f9fa', borderRadius: '3px' }}>
                    <h4 style={{ marginTop: 0 }}>Workflow Sections:</h4>
                    {enhancedPrompt.sections.data && (
                      <div style={{ marginBottom: '10px' }}>
                        <strong>Data:</strong> {enhancedPrompt.sections.data}
                      </div>
                    )}
                    {enhancedPrompt.sections.actions && (
                      <div style={{ marginBottom: '10px' }}>
                        <strong>Actions:</strong> {enhancedPrompt.sections.actions}
                      </div>
                    )}
                    {enhancedPrompt.sections.processing_steps && Array.isArray(enhancedPrompt.sections.processing_steps) && (
                      <div style={{ marginBottom: '10px' }}>
                        <strong>Processing Steps:</strong>
                        <ul style={{ marginTop: '5px', marginBottom: 0 }}>
                          {enhancedPrompt.sections.processing_steps.map((step: string, idx: number) => (
                            <li key={idx}>{step}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {enhancedPrompt.sections.output && (
                      <div style={{ marginBottom: '10px' }}>
                        <strong>Output:</strong> {enhancedPrompt.sections.output}
                      </div>
                    )}
                    {enhancedPrompt.sections.delivery && (
                      <div style={{ marginBottom: '10px' }}>
                        <strong>Delivery:</strong> {enhancedPrompt.sections.delivery}
                      </div>
                    )}
                    {enhancedPrompt.sections.error_handling && (
                      <div style={{ marginBottom: '10px' }}>
                        <strong>Error Handling:</strong> {enhancedPrompt.sections.error_handling}
                      </div>
                    )}
                  </div>
                )}

                {/* Display specifics if available (v8 format) */}
                {enhancedPrompt.specifics && (
                  <div style={{ marginTop: '15px', padding: '10px', backgroundColor: '#fff3cd', borderRadius: '3px' }}>
                    <h4 style={{ marginTop: 0 }}>Specifics:</h4>
                    {enhancedPrompt.specifics.services_involved && enhancedPrompt.specifics.services_involved.length > 0 && (
                      <div style={{ marginBottom: '10px' }}>
                        <strong>Services Involved:</strong> {enhancedPrompt.specifics.services_involved.join(', ')}
                      </div>
                    )}
                    {enhancedPrompt.specifics.user_inputs_required && enhancedPrompt.specifics.user_inputs_required.length > 0 && (
                      <div style={{ marginBottom: '10px' }}>
                        <strong>User Inputs Required:</strong> {enhancedPrompt.specifics.user_inputs_required.join(', ')}
                      </div>
                    )}
                    {enhancedPrompt.specifics.trigger_scope && (
                      <div>
                        <strong>Trigger Scope:</strong> {enhancedPrompt.specifics.trigger_scope}
                      </div>
                    )}
                  </div>
                )}
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
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <button
                  onClick={() => processMessage(4)}
                  disabled={isLoading}
                  style={{
                    padding: '12px 24px',
                    backgroundColor: '#6f42c1',
                    color: 'white',
                    border: 'none',
                    borderRadius: '3px',
                    cursor: isLoading ? 'not-allowed' : 'pointer',
                    fontSize: '16px',
                    fontWeight: 'bold'
                  }}
                >
                  {isLoading ? 'Generating...' : '🔧 Generate Technical Workflow (Phase 4)'}
                </button>
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
                  Accept Plan (Skip Phase 4)
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
                  Refine Further (user feedback)
                </button>
                <button
                  onClick={downloadCommunicationHistory}
                  disabled={apiCommunications.length === 0}
                  style={{
                    padding: '12px 24px',
                    backgroundColor: apiCommunications.length === 0 ? '#ccc' : '#17a2b8',
                    color: 'white',
                    border: 'none',
                    borderRadius: '3px',
                    cursor: apiCommunications.length === 0 ? 'not-allowed' : 'pointer',
                    fontSize: '16px',
                    fontWeight: 'bold'
                  }}
                  title={`Download all API communications (${apiCommunications.length} calls)`}
                >
                  📥 Download JSON ({apiCommunications.length})
                </button>
              </div>
            </div>
          )}

          {/* Technical Workflow Preview (Phase 4) */}
          {currentPhase === 4 && phase4Response && (
            <div style={{ marginBottom: '30px', padding: '15px', border: '2px solid #6f42c1', borderRadius: '5px', backgroundColor: '#f8f4ff' }}>
              <h2>🔧 Technical Workflow (Phase 4)</h2>

              {/* Feasibility Status */}
              {feasibility && (
                <div style={{
                  marginBottom: '15px',
                  padding: '10px',
                  backgroundColor: feasibility.can_execute ? '#d4edda' : '#f8d7da',
                  borderRadius: '3px',
                  border: `1px solid ${feasibility.can_execute ? '#28a745' : '#dc3545'}`
                }}>
                  <strong>Feasibility:</strong> {feasibility.can_execute ? '✅ Can Execute' : '❌ Cannot Execute'}
                  {feasibility.blocking_issues?.length > 0 && (
                    <div style={{ marginTop: '10px' }}>
                      <strong style={{ color: '#dc3545' }}>Blocking Issues:</strong>
                      <ul style={{ margin: '5px 0', paddingLeft: '20px' }}>
                        {feasibility.blocking_issues.map((issue: any, idx: number) => (
                          <li key={idx} style={{ color: '#dc3545' }}>[{issue.type}] {issue.description}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {feasibility.warnings?.length > 0 && (
                    <div style={{ marginTop: '10px' }}>
                      <strong style={{ color: '#856404' }}>Warnings:</strong>
                      <ul style={{ margin: '5px 0', paddingLeft: '20px' }}>
                        {feasibility.warnings.map((warning: any, idx: number) => (
                          <li key={idx} style={{ color: '#856404' }}>[{warning.type}] {warning.description}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* Technical Inputs Required */}
              {technicalInputsRequired.length > 0 && (
                <div style={{ marginBottom: '15px', padding: '15px', backgroundColor: '#fff3cd', borderRadius: '3px', border: '1px solid #ffc107' }}>
                  <h3 style={{ marginTop: 0, color: '#856404' }}>📝 Technical Inputs Required</h3>
                  <p style={{ fontSize: '14px', color: '#856404', marginBottom: '15px' }}>
                    Please provide the following technical inputs to complete the workflow:
                  </p>
                  {technicalInputsRequired.map((input: any, idx: number) => (
                    <div key={idx} style={{ marginBottom: '15px' }}>
                      <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                        {input.description} <span style={{ color: '#666', fontWeight: 'normal' }}>({input.plugin})</span>
                      </label>
                      <input
                        type="text"
                        placeholder={`Enter ${input.key}...`}
                        value={technicalInputsCollected[input.key] || ''}
                        onChange={(e) => setTechnicalInputsCollected(prev => ({
                          ...prev,
                          [input.key]: e.target.value
                        }))}
                        style={{
                          width: '100%',
                          padding: '8px',
                          fontSize: '14px',
                          border: '1px solid #ccc',
                          borderRadius: '3px'
                        }}
                      />
                      <div style={{ fontSize: '12px', color: '#666', marginTop: '3px' }}>
                        Key: <code>{input.key}</code> | Type: {input.type || 'string'}
                      </div>
                    </div>
                  ))}
                  <button
                    onClick={() => processMessage(4)}
                    disabled={isLoading}
                    style={{
                      padding: '10px 20px',
                      backgroundColor: '#6f42c1',
                      color: 'white',
                      border: 'none',
                      borderRadius: '3px',
                      cursor: isLoading ? 'not-allowed' : 'pointer',
                      fontSize: '14px',
                      fontWeight: 'bold'
                    }}
                  >
                    {isLoading ? 'Re-running...' : '🔄 Re-run Phase 4 with Inputs'}
                  </button>
                </div>
              )}

              {/* Technical Workflow Steps */}
              <div style={{ marginBottom: '15px' }}>
                <h3>Workflow Steps ({technicalWorkflow.length})</h3>
                <div style={{ backgroundColor: '#f8f9fa', padding: '10px', borderRadius: '3px' }}>
                  {technicalWorkflow.map((step: any, idx: number) => (
                    <div key={idx} style={{
                      marginBottom: '10px',
                      padding: '10px',
                      backgroundColor: 'white',
                      border: '1px solid #ddd',
                      borderRadius: '3px',
                      borderLeft: `4px solid ${step.kind === 'operation' ? '#28a745' : step.kind === 'transform' ? '#17a2b8' : '#ffc107'}`
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px' }}>
                        <strong>{step.id}</strong>
                        <span style={{
                          padding: '2px 8px',
                          borderRadius: '3px',
                          fontSize: '12px',
                          backgroundColor: step.kind === 'operation' ? '#d4edda' : step.kind === 'transform' ? '#d1ecf1' : '#fff3cd'
                        }}>
                          {step.kind}
                        </span>
                      </div>
                      <div style={{ fontSize: '14px', marginBottom: '5px' }}>{step.description}</div>
                      {step.kind === 'operation' && (
                        <div style={{ fontSize: '12px', color: '#666' }}>
                          Plugin: <code>{step.plugin}</code> | Action: <code>{step.action}</code>
                        </div>
                      )}
                      {step.kind === 'transform' && (
                        <div style={{ fontSize: '12px', color: '#666' }}>
                          Type: <code>{step.operation?.type}</code>
                        </div>
                      )}
                      {step.kind === 'control' && step.control && (
                        <div style={{ fontSize: '12px', color: '#666' }}>
                          Condition: <code>{step.control.condition}</code>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* JSON Preview */}
              <details style={{ marginBottom: '15px' }}>
                <summary style={{ cursor: 'pointer', fontWeight: 'bold', color: '#6f42c1' }}>
                  View Full Phase 4 Response JSON
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
                  {JSON.stringify(phase4Response, null, 2)}
                </pre>
              </details>

              {/* Metadata Status */}
              <div style={{ marginBottom: '15px', padding: '10px', backgroundColor: '#e7f3ff', borderRadius: '3px' }}>
                <strong>Status:</strong>
                <div style={{ marginTop: '5px', fontSize: '14px' }}>
                  • Ready for Generation: {phase4Response.metadata?.ready_for_generation ? '✅ Yes' : '❌ No'}
                  <br />
                  • Needs Technical Inputs: {phase4Response.metadata?.phase4?.needs_technical_inputs ? '⚠️ Yes' : '✅ No'}
                  <br />
                  • Needs User Feedback: {phase4Response.metadata?.phase4?.needs_user_feedback ? '⚠️ Yes' : '✅ No'}
                </div>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                {phase4Response.metadata?.ready_for_generation && (
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
                    ✅ Create Agent
                  </button>
                )}
                <button
                  onClick={() => {
                    setCurrentPhase(3);
                    setPhase4Response(null);
                    setTechnicalWorkflow([]);
                    setTechnicalInputsRequired([]);
                    setFeasibility(null);
                  }}
                  disabled={isLoading}
                  style={{
                    padding: '12px 24px',
                    backgroundColor: '#6c757d',
                    color: 'white',
                    border: 'none',
                    borderRadius: '3px',
                    cursor: isLoading ? 'not-allowed' : 'pointer',
                    fontSize: '16px',
                    fontWeight: 'bold'
                  }}
                >
                  ← Back to Phase 3
                </button>
                <button
                  onClick={downloadCommunicationHistory}
                  disabled={apiCommunications.length === 0}
                  style={{
                    padding: '12px 24px',
                    backgroundColor: apiCommunications.length === 0 ? '#ccc' : '#17a2b8',
                    color: 'white',
                    border: 'none',
                    borderRadius: '3px',
                    cursor: apiCommunications.length === 0 ? 'not-allowed' : 'pointer',
                    fontSize: '16px',
                    fontWeight: 'bold'
                  }}
                  title={`Download all API communications (${apiCommunications.length} calls)`}
                >
                  📥 Download JSON ({apiCommunications.length})
                </button>
              </div>
            </div>
          )}

          {/* Generated Agent Display */}
          {(generatedAgent || isGeneratingAgent || agentGenerationError) && (
            <div style={{
              marginBottom: '30px',
              padding: '15px',
              border: `2px solid ${generatedAgent ? '#28a745' : agentGenerationError ? '#dc3545' : '#007bff'}`,
              borderRadius: '5px',
              backgroundColor: generatedAgent ? '#f0fff0' : agentGenerationError ? '#fff0f0' : '#f0f8ff'
            }}>
              <h2>🤖 Generated Agent (V4)</h2>

              {/* Loading State */}
              {isGeneratingAgent && (
                <div style={{ textAlign: 'center', padding: '30px' }}>
                  <div style={{
                    display: 'inline-block',
                    width: '40px',
                    height: '40px',
                    border: '4px solid #f3f3f3',
                    borderTop: '4px solid #007bff',
                    borderRadius: '50%',
                    animation: 'spin 1s linear infinite'
                  }} />
                  <p style={{ marginTop: '15px', color: '#666' }}>
                    Generating agent using V4 OpenAI 3-Stage Architecture...
                  </p>
                  <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
                </div>
              )}

              {/* Error State */}
              {agentGenerationError && !isGeneratingAgent && (
                <div style={{ padding: '15px', backgroundColor: '#f8d7da', borderRadius: '3px', color: '#721c24' }}>
                  <strong>❌ Generation Failed:</strong>
                  <p style={{ margin: '10px 0 0 0' }}>{agentGenerationError}</p>
                  <button
                    onClick={generateAgentV4}
                    style={{
                      marginTop: '15px',
                      padding: '10px 20px',
                      backgroundColor: '#dc3545',
                      color: 'white',
                      border: 'none',
                      borderRadius: '3px',
                      cursor: 'pointer'
                    }}
                  >
                    🔄 Retry Generation
                  </button>
                </div>
              )}

              {/* Success State */}
              {generatedAgent && !isGeneratingAgent && (
                <>
                  {/* Agent Summary */}
                  <div style={{
                    padding: '15px',
                    backgroundColor: '#d4edda',
                    borderRadius: '3px',
                    marginBottom: '15px'
                  }}>
                    <h3 style={{ margin: '0 0 10px 0', color: '#155724' }}>
                      ✅ {generatedAgent.agent?.agent_name || 'Agent Generated'}
                    </h3>
                    <p style={{ margin: '0', color: '#155724' }}>
                      {generatedAgent.agent?.description || 'No description'}
                    </p>
                  </div>

                  {/* Agent Details Grid */}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                    gap: '15px',
                    marginBottom: '15px'
                  }}>
                    <div style={{ padding: '10px', backgroundColor: '#e9ecef', borderRadius: '3px' }}>
                      <strong>Agent ID:</strong>
                      <div style={{ fontFamily: 'monospace', fontSize: '12px', wordBreak: 'break-all' }}>
                        {generatedAgent.agentId}
                      </div>
                    </div>
                    <div style={{ padding: '10px', backgroundColor: '#e9ecef', borderRadius: '3px' }}>
                      <strong>Session ID:</strong>
                      <div style={{ fontFamily: 'monospace', fontSize: '12px', wordBreak: 'break-all' }}>
                        {generatedAgent.sessionId}
                      </div>
                    </div>
                    <div style={{ padding: '10px', backgroundColor: '#e9ecef', borderRadius: '3px' }}>
                      <strong>Workflow Steps:</strong>
                      <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#28a745' }}>
                        {generatedAgent.agent?.workflow_steps?.length || 0}
                      </div>
                    </div>
                    <div style={{ padding: '10px', backgroundColor: '#e9ecef', borderRadius: '3px' }}>
                      <strong>Latency:</strong>
                      <div style={{ fontSize: '18px', fontWeight: 'bold' }}>
                        {generatedAgent.extraction_details?.latency_ms || 0}ms
                      </div>
                    </div>
                  </div>

                  {/* Plugins Required */}
                  {generatedAgent.agent?.plugins_required?.length > 0 && (
                    <div style={{ marginBottom: '15px' }}>
                      <strong>Plugins Required:</strong>
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' }}>
                        {generatedAgent.agent.plugins_required.map((plugin: string) => (
                          <span key={plugin} style={{
                            padding: '4px 12px',
                            backgroundColor: '#007bff',
                            color: 'white',
                            borderRadius: '15px',
                            fontSize: '12px'
                          }}>
                            {plugin}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Input Schema */}
                  {generatedAgent.agent?.input_schema?.length > 0 && (
                    <div style={{ marginBottom: '15px' }}>
                      <strong>Required Inputs:</strong>
                      <div style={{
                        marginTop: '8px',
                        padding: '10px',
                        backgroundColor: '#fff3cd',
                        borderRadius: '3px'
                      }}>
                        {generatedAgent.agent.input_schema.map((input: any, idx: number) => (
                          <div key={idx} style={{ marginBottom: idx < generatedAgent.agent.input_schema.length - 1 ? '8px' : 0 }}>
                            <code>{input.name}</code> ({input.type}) {input.required && <span style={{ color: '#dc3545' }}>*</span>}
                            {input.description && <span style={{ color: '#666', marginLeft: '8px' }}>- {input.description}</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Workflow Steps Preview */}
                  <details style={{ marginBottom: '15px' }}>
                    <summary style={{ cursor: 'pointer', fontWeight: 'bold', color: '#28a745' }}>
                      View Workflow Steps ({generatedAgent.agent?.workflow_steps?.length || 0})
                    </summary>
                    <div style={{ marginTop: '10px' }}>
                      {generatedAgent.agent?.workflow_steps?.map((step: any, idx: number) => (
                        <div key={step.id || idx} style={{
                          padding: '10px',
                          backgroundColor: '#f8f9fa',
                          borderLeft: '4px solid #28a745',
                          marginBottom: '8px',
                          borderRadius: '0 3px 3px 0'
                        }}>
                          <strong>Step {idx + 1}:</strong> {step.name}
                          <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
                            Type: {step.type} | Plugin: {step.plugin || 'N/A'} | Action: {step.action || 'N/A'}
                          </div>
                          {step.description && (
                            <div style={{ fontSize: '12px', color: '#333', marginTop: '4px' }}>
                              {step.description}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </details>

                  {/* Full JSON */}
                  <details style={{ marginBottom: '15px' }}>
                    <summary style={{ cursor: 'pointer', fontWeight: 'bold', color: '#6c757d' }}>
                      View Full Agent JSON
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
                      {JSON.stringify(generatedAgent, null, 2)}
                    </pre>
                  </details>

                  {/* Warnings */}
                  {generatedAgent.warnings?.length > 0 && (
                    <div style={{
                      padding: '10px',
                      backgroundColor: '#fff3cd',
                      borderRadius: '3px',
                      marginBottom: '15px'
                    }}>
                      <strong>⚠️ Warnings:</strong>
                      <ul style={{ margin: '5px 0 0 0', paddingLeft: '20px' }}>
                        {generatedAgent.warnings.map((w: string, idx: number) => (
                          <li key={idx}>{w}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(generatedAgent.agentId);
                        addDebugLog('info', 'Agent ID copied to clipboard');
                      }}
                      style={{
                        padding: '10px 20px',
                        backgroundColor: '#6c757d',
                        color: 'white',
                        border: 'none',
                        borderRadius: '3px',
                        cursor: 'pointer'
                      }}
                    >
                      📋 Copy Agent ID
                    </button>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(JSON.stringify(generatedAgent.agent, null, 2));
                        addDebugLog('info', 'Agent JSON copied to clipboard');
                      }}
                      style={{
                        padding: '10px 20px',
                        backgroundColor: '#17a2b8',
                        color: 'white',
                        border: 'none',
                        borderRadius: '3px',
                        cursor: 'pointer'
                      }}
                    >
                      📋 Copy Full JSON
                    </button>
                    <button
                      onClick={generateAgentV4}
                      style={{
                        padding: '10px 20px',
                        backgroundColor: '#ffc107',
                        color: '#333',
                        border: 'none',
                        borderRadius: '3px',
                        cursor: 'pointer'
                      }}
                    >
                      🔄 Regenerate
                    </button>
                  </div>
                </>
              )}
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

      {/* Free Tier Users Tab Content */}
      {activeTab === 'free-tier-users' && (
        <>
          {/* Free Tier User Creation Form */}
          <div style={{ marginBottom: '30px', padding: '15px', border: '1px solid #ccc', borderRadius: '5px' }}>
            <h2>Create Free Tier User Subscription</h2>
            <div style={{ marginBottom: '15px', padding: '10px', backgroundColor: '#e7f3ff', borderRadius: '3px' }}>
              <p style={{ margin: 0, fontSize: '14px', color: '#0066cc' }}>
                <strong>ℹ️ Info:</strong> This will create a new record in the <code>user_subscriptions</code> table with free tier quotas.
                The user must already exist in the <code>auth.users</code> table (created during signup).
              </p>
            </div>

            <div style={{ marginBottom: '15px' }}>
              <label htmlFor="freeTierUserId" style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                User ID (UUID):
              </label>
              <input
                id="freeTierUserId"
                type="text"
                value={freeTierUserId}
                onChange={(e) => setFreeTierUserId(e.target.value)}
                placeholder="e.g., 550e8400-e29b-41d4-a716-446655440000"
                style={{
                  width: '500px',
                  padding: '10px',
                  fontSize: '14px',
                  fontFamily: 'monospace',
                  border: '1px solid #ccc',
                  borderRadius: '3px'
                }}
              />
              <div style={{ marginTop: '5px', fontSize: '12px', color: '#666' }}>
                Enter the UUID of the user from auth.users table
              </div>
            </div>

            <div style={{ marginBottom: '15px', padding: '10px', backgroundColor: '#f8f9fa', borderRadius: '3px' }}>
              <h4 style={{ marginTop: 0 }}>What will be created:</h4>
              <ul style={{ margin: '10px 0', paddingLeft: '20px', fontSize: '14px' }}>
                <li><strong>Pilot Tokens:</strong> 20,834 tokens (from system config)</li>
                <li><strong>Storage Quota:</strong> 1,000 MB (from system config)</li>
                <li><strong>Execution Quota:</strong> Unlimited (null)</li>
                <li><strong>Free Tier Duration:</strong> 30 days (from system config)</li>
                <li><strong>Status:</strong> active</li>
                <li><strong>Account Frozen:</strong> false</li>
              </ul>
              <div style={{ fontSize: '12px', color: '#666', marginTop: '10px' }}>
                Note: If the user already has a subscription, the free tier allocation will be added to their existing balance.
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={createFreeTierUser}
                disabled={isLoading || !freeTierUserId.trim()}
                style={{
                  padding: '12px 24px',
                  backgroundColor: !freeTierUserId.trim() ? '#ccc' : '#28a745',
                  color: 'white',
                  border: 'none',
                  borderRadius: '3px',
                  cursor: !freeTierUserId.trim() ? 'not-allowed' : 'pointer',
                  fontSize: '16px',
                  fontWeight: 'bold'
                }}
              >
                {isLoading ? 'Creating...' : 'Create Free Tier Subscription'}
              </button>
              <button
                onClick={resetFreeTierForm}
                disabled={isLoading}
                style={{
                  padding: '12px 24px',
                  backgroundColor: '#6c757d',
                  color: 'white',
                  border: 'none',
                  borderRadius: '3px',
                  cursor: isLoading ? 'not-allowed' : 'pointer',
                  fontSize: '16px',
                  fontWeight: 'bold'
                }}
              >
                Reset Form
              </button>
            </div>
          </div>

          {/* Response Display */}
          {freeTierResponse && (
            <div style={{ marginBottom: '30px', padding: '15px', border: `2px solid ${freeTierResponse.success ? '#28a745' : '#dc3545'}`, borderRadius: '5px', backgroundColor: freeTierResponse.success ? '#f0fff0' : '#fff0f0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <h2 style={{ margin: 0 }}>
                  {freeTierResponse.success ? '✅ Success' : '❌ Error'}
                </h2>
                <button
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(JSON.stringify(freeTierResponse, null, 2));
                      addDebugLog('success', 'Response copied to clipboard');
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

              {freeTierResponse.success && freeTierResponse.allocation && (
                <div style={{ marginBottom: '15px', padding: '10px', backgroundColor: 'white', borderRadius: '3px', border: '1px solid #28a745' }}>
                  <h3 style={{ marginTop: 0 }}>Allocation Details:</h3>
                  <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '14px' }}>
                    <li><strong>Pilot Tokens:</strong> {freeTierResponse.allocation.pilot_tokens?.toLocaleString() || 'N/A'}</li>
                    <li><strong>Raw Tokens:</strong> {freeTierResponse.allocation.raw_tokens?.toLocaleString() || 'N/A'}</li>
                    <li><strong>Storage MB:</strong> {freeTierResponse.allocation.storage_mb?.toLocaleString() || 'N/A'}</li>
                    <li><strong>Executions:</strong> {freeTierResponse.allocation.executions === null ? 'Unlimited' : freeTierResponse.allocation.executions}</li>
                  </ul>
                  {freeTierResponse.message && (
                    <div style={{ marginTop: '10px', fontStyle: 'italic', color: '#28a745' }}>
                      {freeTierResponse.message}
                    </div>
                  )}
                </div>
              )}

              {!freeTierResponse.success && (
                <div style={{ padding: '10px', backgroundColor: 'white', borderRadius: '3px', border: '1px solid #dc3545' }}>
                  <strong>Error Message:</strong>
                  <div style={{ marginTop: '5px', color: '#dc3545' }}>
                    {freeTierResponse.error || 'Unknown error occurred'}
                  </div>
                </div>
              )}

              <details style={{ marginTop: '15px' }}>
                <summary style={{ cursor: 'pointer', fontWeight: 'bold', color: '#007bff' }}>
                  View Full API Response
                </summary>
                <pre style={{
                  backgroundColor: '#f8f9fa',
                  padding: '15px',
                  borderRadius: '3px',
                  overflow: 'auto',
                  fontSize: '12px',
                  maxHeight: '300px',
                  marginTop: '10px'
                }}>
                  {JSON.stringify(freeTierResponse, null, 2)}
                </pre>
              </details>
            </div>
          )}
        </>
      )}

      {/* Agent Execution Tab Content */}
      {activeTab === 'agent-execution' && (
        <>
          {/* Agent Selection */}
          <div style={{ marginBottom: '30px', padding: '15px', border: '1px solid #ccc', borderRadius: '5px' }}>
            <h2>Execute Agent</h2>
            <div style={{ marginBottom: '15px', padding: '10px', backgroundColor: '#e7f3ff', borderRadius: '3px' }}>
              <p style={{ margin: 0, fontSize: '14px', color: '#0066cc' }}>
                <strong>Info:</strong> {sandboxMode
                  ? 'Sandbox mode - execute workflows in-memory without saving to DB. Uses /api/run-agent-sandbox endpoint.'
                  : 'Test agent execution using the /api/run-agent endpoint. Make sure a valid User ID is set above.'}
              </p>
            </div>

            {/* Mode Toggle: Load from DB vs Sandbox */}
            <div style={{ marginBottom: '20px', padding: '10px', backgroundColor: '#f8f9fa', borderRadius: '5px' }}>
              <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="executionMode"
                    checked={!sandboxMode}
                    onChange={() => setSandboxMode(false)}
                  />
                  <span style={{ fontWeight: !sandboxMode ? 'bold' : 'normal' }}>Load from DB</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="executionMode"
                    checked={sandboxMode}
                    onChange={() => setSandboxMode(true)}
                  />
                  <span style={{ fontWeight: sandboxMode ? 'bold' : 'normal', color: sandboxMode ? '#28a745' : 'inherit' }}>
                    Sandbox Mode (inline)
                  </span>
                </label>
              </div>
            </div>

            {/* === SANDBOX MODE INPUTS === */}
            {sandboxMode && (
              <>
                {/* Load from JSON Button */}
                <div style={{ marginBottom: '15px' }}>
                  <button
                    onClick={() => setShowJsonImportModal(true)}
                    style={{
                      padding: '10px 16px',
                      backgroundColor: '#6f42c1',
                      color: 'white',
                      border: 'none',
                      borderRadius: '3px',
                      cursor: 'pointer',
                      fontSize: '14px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}
                  >
                    <span>📋</span> Load from JSON
                  </button>
                  <p style={{ margin: '5px 0 0 0', fontSize: '12px', color: '#666' }}>
                    Paste a full agent generation response to auto-populate all fields
                  </p>
                </div>

                {/* Agent Name */}
                <div style={{ marginBottom: '15px' }}>
                  <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                    Agent Name:
                  </label>
                  <input
                    type="text"
                    value={sandboxAgentName}
                    onChange={(e) => setSandboxAgentName(e.target.value)}
                    placeholder="Enter agent name"
                    style={{ width: '100%', padding: '10px', fontSize: '14px' }}
                  />
                </div>

                {/* Pilot Steps */}
                <div style={{ marginBottom: '15px' }}>
                  <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                    Pilot Steps (JSON array):
                  </label>
                  <textarea
                    value={sandboxPilotSteps}
                    onChange={(e) => setSandboxPilotSteps(e.target.value)}
                    placeholder='[{"id": "step1", "name": "Step 1", "type": "action", "plugin": "gmail", "action": "listEmails", "params": {}}]'
                    style={{
                      width: '100%',
                      height: '200px',
                      padding: '10px',
                      fontSize: '13px',
                      fontFamily: 'monospace',
                      resize: 'vertical'
                    }}
                  />
                </div>

                {/* Plugins Required */}
                <div style={{ marginBottom: '15px' }}>
                  <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                    Plugins Required (JSON array):
                  </label>
                  <input
                    type="text"
                    value={sandboxPluginsRequired}
                    onChange={(e) => setSandboxPluginsRequired(e.target.value)}
                    placeholder='["gmail", "calendar"]'
                    style={{ width: '100%', padding: '10px', fontSize: '14px', fontFamily: 'monospace' }}
                  />
                </div>

                {/* JSON Import Modal */}
                {showJsonImportModal && (
                  <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: 'rgba(0,0,0,0.5)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 1000
                  }}>
                    <div style={{
                      backgroundColor: 'white',
                      padding: '20px',
                      borderRadius: '8px',
                      width: '80%',
                      maxWidth: '800px',
                      maxHeight: '80vh',
                      display: 'flex',
                      flexDirection: 'column'
                    }}>
                      <h3 style={{ marginTop: 0 }}>Import Agent JSON</h3>
                      <p style={{ fontSize: '14px', color: '#666', marginBottom: '15px' }}>
                        Paste the full agent generation response JSON. The following fields will be extracted:
                        <br />
                        <code>agent.agent_name</code>, <code>agent.pilot_steps</code>, <code>agent.plugins_required</code>, <code>agent.input_schema</code>
                      </p>
                      <textarea
                        value={sandboxJsonImport}
                        onChange={(e) => setSandboxJsonImport(e.target.value)}
                        placeholder='{"success": true, "agent": { "agent_name": "...", "pilot_steps": [...], ... }}'
                        style={{
                          flex: 1,
                          minHeight: '300px',
                          padding: '10px',
                          fontSize: '12px',
                          fontFamily: 'monospace',
                          resize: 'vertical',
                          marginBottom: '15px'
                        }}
                      />
                      <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                        <button
                          onClick={() => {
                            setShowJsonImportModal(false);
                            setSandboxJsonImport('');
                          }}
                          style={{
                            padding: '10px 20px',
                            backgroundColor: '#6c757d',
                            color: 'white',
                            border: 'none',
                            borderRadius: '3px',
                            cursor: 'pointer'
                          }}
                        >
                          Cancel
                        </button>
                        <button
                          onClick={importSandboxJson}
                          disabled={!sandboxJsonImport.trim()}
                          style={{
                            padding: '10px 20px',
                            backgroundColor: sandboxJsonImport.trim() ? '#28a745' : '#6c757d',
                            color: 'white',
                            border: 'none',
                            borderRadius: '3px',
                            cursor: sandboxJsonImport.trim() ? 'pointer' : 'not-allowed'
                          }}
                        >
                          Import
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* === DB MODE INPUTS === */}
            {!sandboxMode && (
              <>
                {/* Agent ID Input */}
                <div style={{ marginBottom: '15px' }}>
                  <label htmlFor="agentIdInput" style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                    Agent ID (UUID):
                  </label>
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <input
                      id="agentIdInput"
                      type="text"
                      value={agentId}
                      onChange={(e) => setAgentId(e.target.value)}
                      placeholder="Enter agent UUID or select from list"
                      style={{ flex: 1, padding: '10px', fontSize: '14px', fontFamily: 'monospace' }}
                    />
                    <button
                      onClick={loadUserAgents}
                      disabled={!userId.trim()}
                      style={{
                        padding: '10px 16px',
                        backgroundColor: userId.trim() ? '#17a2b8' : '#6c757d',
                        color: 'white',
                        border: 'none',
                        borderRadius: '3px',
                        cursor: userId.trim() ? 'pointer' : 'not-allowed',
                        fontSize: '14px'
                      }}
                    >
                      Load My Agents
                    </button>
                  </div>
                </div>
              </>
            )}

            {/* Agents List (if loaded) - DB mode only */}
            {!sandboxMode && agentsList.length > 0 && (
              <div style={{ marginBottom: '15px' }}>
                <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                  Select from your agents:
                </label>
                <select
                  value={agentId}
                  onChange={(e) => handleAgentSelection(e.target.value)}
                  style={{ width: '100%', padding: '10px', fontSize: '14px' }}
                >
                  <option value="">-- Select an agent --</option>
                  {agentsList.map(agent => (
                    <option key={agent.id} value={agent.id}>
                      {agent.agent_name} ({agent.status}) - {agent.id.substring(0, 8)}...
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Selected Agent Info - DB mode only */}
            {!sandboxMode && selectedAgentDetails && (
              <div style={{
                marginBottom: '15px',
                padding: '10px',
                backgroundColor: '#f8f9fa',
                borderRadius: '5px',
                border: '1px solid #dee2e6'
              }}>
                <div style={{ fontWeight: 'bold', marginBottom: '5px' }}>
                  Selected: {selectedAgentDetails.agent_name}
                </div>
                <div style={{ fontSize: '12px', color: '#666' }}>
                  {agentWorkflowSteps.length > 0 ? (
                    <span style={{ color: '#28a745' }}>
                      ✓ {agentWorkflowSteps.length} workflow steps found - Debug mode available
                    </span>
                  ) : (
                    <span style={{ color: '#ffc107' }}>
                      ⚠ No workflow steps - Standard execution only
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Input Variables */}
            <div style={{ marginBottom: '15px' }}>
              <label htmlFor="agentInputVars" style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                Input Variables (JSON):
              </label>
              <textarea
                id="agentInputVars"
                value={agentInputVariables}
                onChange={(e) => setAgentInputVariables(e.target.value)}
                placeholder='{"variable_name": "value"}'
                style={{
                  width: '100%',
                  height: '120px',
                  padding: '10px',
                  fontSize: '14px',
                  fontFamily: 'monospace',
                  resize: 'vertical'
                }}
              />
            </div>

            {/* Override User Prompt */}
            <div style={{ marginBottom: '15px' }}>
              <label htmlFor="agentOverridePromptInput" style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                Override User Prompt (optional):
              </label>
              <textarea
                id="agentOverridePromptInput"
                value={agentOverridePrompt}
                onChange={(e) => setAgentOverridePrompt(e.target.value)}
                placeholder="Leave empty to use agent's default prompt"
                style={{
                  width: '100%',
                  height: '80px',
                  padding: '10px',
                  fontSize: '14px',
                  resize: 'vertical'
                }}
              />
            </div>

            {/* Execution Options */}
            <div style={{ marginBottom: '15px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {/* Use AgentKit - only show in DB mode */}
              {!sandboxMode && (
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={useAgentKit}
                    onChange={(e) => {
                      setUseAgentKit(e.target.checked);
                      if (e.target.checked) setDebugModeEnabled(false); // Debug mode uses Pilot, not AgentKit
                    }}
                    disabled={debugModeEnabled}
                  />
                  <span>Use AgentKit execution (recommended for standard runs)</span>
                </label>
              )}

              {/* Debug Mode - available in both modes */}
              <label style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                cursor: (sandboxMode || agentWorkflowSteps.length > 0) ? 'pointer' : 'not-allowed',
                opacity: (sandboxMode || agentWorkflowSteps.length > 0) ? 1 : 0.5
              }}>
                <input
                  type="checkbox"
                  checked={debugModeEnabled}
                  onChange={(e) => {
                    setDebugModeEnabled(e.target.checked);
                    if (e.target.checked) setUseAgentKit(false); // Debug mode uses Pilot
                  }}
                  disabled={!sandboxMode && agentWorkflowSteps.length === 0}
                />
                <span>
                  Step-by-Step Debug Mode
                  {!sandboxMode && agentWorkflowSteps.length === 0 && ' (requires agent with workflow steps)'}
                  {sandboxMode && ' (uses pilot_steps from above)'}
                </span>
              </label>
            </div>

            {/* Action Buttons - Standard Mode */}
            {!debugModeEnabled && (
              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  onClick={sandboxMode ? executeSandbox : executeAgent}
                  disabled={isExecutingAgent || (sandboxMode ? !sandboxAgentName.trim() : !agentId.trim())}
                  style={{
                    padding: '12px 24px',
                    backgroundColor: isExecutingAgent || (sandboxMode ? !sandboxAgentName.trim() : !agentId.trim()) ? '#6c757d' : (sandboxMode ? '#17a2b8' : '#28a745'),
                    color: 'white',
                    border: 'none',
                    borderRadius: '3px',
                    cursor: isExecutingAgent || (sandboxMode ? !sandboxAgentName.trim() : !agentId.trim()) ? 'not-allowed' : 'pointer',
                    fontSize: '16px',
                    fontWeight: 'bold'
                  }}
                >
                  {isExecutingAgent ? 'Executing...' : (sandboxMode ? 'Execute Sandbox' : 'Execute Agent')}
                </button>
                <button
                  onClick={resetAgentExecutionForm}
                  disabled={isExecutingAgent}
                  style={{
                    padding: '12px 24px',
                    backgroundColor: '#6c757d',
                    color: 'white',
                    border: 'none',
                    borderRadius: '3px',
                    cursor: isExecutingAgent ? 'not-allowed' : 'pointer',
                    fontSize: '16px',
                    fontWeight: 'bold'
                  }}
                >
                  Reset Form
                </button>
              </div>
            )}

            {/* Debug Mode Controls */}
            {debugModeEnabled && (
              <DebugControls
                debugState={debugStream.debugState}
                onStart={sandboxMode ? executeSandbox : startDebugExecution}
                onPause={handleDebugPause}
                onResume={handleDebugResume}
                onStep={handleDebugStep}
                onStop={handleDebugStop}
                onReset={handleDebugReset}
                disabled={sandboxMode ? !sandboxAgentName.trim() : !agentId.trim()}
                currentStepName={debugStream.currentStepId ? debugStream.getStepStatus(debugStream.currentStepId)?.stepName : undefined}
              />
            )}
          </div>

          {/* Step Visualization - Debug Mode */}
          {debugModeEnabled && agentWorkflowSteps.length > 0 && (
            <div style={{ marginBottom: '30px', padding: '15px', border: '1px solid #007bff', borderRadius: '5px' }}>
              <h2 style={{ marginTop: 0, color: '#007bff' }}>Workflow Steps</h2>
              <StepVisualizer
                steps={agentWorkflowSteps}
                stepStatuses={debugStream.stepStatuses}
                currentStepId={debugStream.currentStepId}
                onStepClick={(stepId) => addDebugLog('info', `Clicked step: ${stepId}`)}
              />
            </div>
          )}

          {/* Debug Events Log */}
          {debugModeEnabled && debugStream.events.length > 0 && (
            <div style={{ marginBottom: '30px', padding: '15px', border: '1px solid #17a2b8', borderRadius: '5px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <h2 style={{ margin: 0, color: '#17a2b8' }}>Debug Events ({debugStream.events.length})</h2>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(JSON.stringify(debugStream.events, null, 2));
                    addDebugLog('success', 'Debug events copied to clipboard');
                  }}
                  style={{
                    padding: '6px 12px',
                    backgroundColor: '#17a2b8',
                    color: 'white',
                    border: 'none',
                    borderRadius: '3px',
                    cursor: 'pointer',
                    fontSize: '12px'
                  }}
                >
                  Copy Events
                </button>
              </div>
              <div style={{
                maxHeight: '200px',
                overflow: 'auto',
                backgroundColor: '#f8f9fa',
                padding: '10px',
                borderRadius: '4px',
                fontFamily: 'monospace',
                fontSize: '12px'
              }}>
                {debugStream.events.slice(-20).map((event, index) => (
                  <div
                    key={event.id || index}
                    style={{
                      padding: '4px 8px',
                      marginBottom: '4px',
                      backgroundColor: event.type === 'step_failed' ? '#fff0f0'
                        : event.type === 'step_complete' ? '#f0fff0'
                        : event.type === 'paused' ? '#fff8e0'
                        : 'white',
                      borderLeft: `3px solid ${
                        event.type === 'step_failed' ? '#dc3545'
                        : event.type === 'step_complete' ? '#28a745'
                        : event.type === 'paused' ? '#ffc107'
                        : event.type === 'step_start' ? '#007bff'
                        : '#6c757d'
                      }`,
                      borderRadius: '2px'
                    }}
                  >
                    <span style={{ color: '#6c757d' }}>
                      {new Date(event.timestamp).toLocaleTimeString()}
                    </span>
                    {' '}
                    <span style={{ fontWeight: 'bold' }}>[{event.type}]</span>
                    {' '}
                    {event.stepName && <span style={{ color: '#007bff' }}>{event.stepName}</span>}
                    {event.error && <span style={{ color: '#dc3545' }}> - {event.error}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Execution Result Display */}
          {agentExecutionResult && (
            <div style={{
              marginBottom: '30px',
              padding: '15px',
              border: `2px solid ${agentExecutionResult.success ? '#28a745' : '#dc3545'}`,
              borderRadius: '5px',
              backgroundColor: agentExecutionResult.success ? '#f0fff0' : '#fff0f0'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <h2 style={{ margin: 0 }}>
                  {agentExecutionResult.success ? '✅ Execution Success' : '❌ Execution Failed'}
                </h2>
                <button
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(JSON.stringify(agentExecutionResult, null, 2));
                      addDebugLog('success', 'Result copied to clipboard');
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

              {/* Success Details */}
              {agentExecutionResult.success && agentExecutionResult.data && (
                <div style={{ marginBottom: '15px', padding: '10px', backgroundColor: 'white', borderRadius: '3px', border: '1px solid #28a745' }}>
                  <h3 style={{ marginTop: 0 }}>Execution Details:</h3>
                  <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '14px' }}>
                    <li><strong>Agent:</strong> {agentExecutionResult.data.agent_name || agentExecutionResult.data.agent_id}</li>
                    <li><strong>Execution Type:</strong> {agentExecutionResult.data.execution_type || 'N/A'}</li>
                    <li><strong>Tokens Used:</strong> {agentExecutionResult.data.tokens_used?.toLocaleString() || 'N/A'}</li>
                    {agentExecutionResult.data.raw_tokens && (
                      <li><strong>Raw Tokens:</strong> {agentExecutionResult.data.raw_tokens?.toLocaleString()}</li>
                    )}
                    {agentExecutionResult.data.intensity_multiplier && (
                      <li><strong>Intensity Multiplier:</strong> {agentExecutionResult.data.intensity_multiplier?.toFixed(2)}x</li>
                    )}
                    <li><strong>Execution Time:</strong> {agentExecutionResult.data.execution_time_ms || agentExecutionResult._meta?.executionTimeMs || 'N/A'}ms</li>
                    {agentExecutionResult.data.tool_calls_count !== undefined && (
                      <li><strong>Tool Calls:</strong> {agentExecutionResult.data.tool_calls_count} ({agentExecutionResult.data.successful_tool_calls} successful, {agentExecutionResult.data.failed_tool_calls} failed)</li>
                    )}
                    {agentExecutionResult.data.stepsCompleted !== undefined && (
                      <li><strong>Steps:</strong> {agentExecutionResult.data.stepsCompleted} completed, {agentExecutionResult.data.stepsFailed} failed, {agentExecutionResult.data.stepsSkipped} skipped</li>
                    )}
                  </ul>
                </div>
              )}

              {/* Message/Response */}
              {agentExecutionResult.message && (
                <div style={{ marginBottom: '15px', padding: '10px', backgroundColor: 'white', borderRadius: '3px', border: '1px solid #ccc' }}>
                  <h3 style={{ marginTop: 0 }}>Response Message:</h3>
                  <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '13px' }}>
                    {agentExecutionResult.message}
                  </pre>
                </div>
              )}

              {/* Error Message */}
              {!agentExecutionResult.success && (
                <div style={{ padding: '10px', backgroundColor: 'white', borderRadius: '3px', border: '1px solid #dc3545' }}>
                  <strong>Error:</strong>
                  <div style={{ marginTop: '5px', color: '#dc3545' }}>
                    {agentExecutionResult.error || 'Unknown error occurred'}
                  </div>
                </div>
              )}

              {/* Full Response */}
              <details style={{ marginTop: '15px' }}>
                <summary style={{ cursor: 'pointer', fontWeight: 'bold', color: '#007bff' }}>
                  View Full API Response
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
                  {JSON.stringify(agentExecutionResult, null, 2)}
                </pre>
              </details>
            </div>
          )}
        </>
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
        <div
          ref={debugLogsRef}
          style={{
            backgroundColor: '#f8f9fa',
            padding: '15px',
            borderRadius: '3px',
            height: '300px',
            overflow: 'auto',
            fontSize: '12px',
            fontFamily: 'monospace'
          }}
        >
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

      {/* JSON Prompt Import Modal */}
      {showJsonPromptModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <div style={{
            backgroundColor: 'white',
            padding: '25px',
            borderRadius: '8px',
            width: '90%',
            maxWidth: '700px',
            maxHeight: '80vh',
            overflow: 'auto',
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
              <h2 style={{ margin: 0 }}>Import JSON Prompt</h2>
              <button
                onClick={() => {
                  setShowJsonPromptModal(false);
                  setJsonPromptImportValue('');
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '24px',
                  cursor: 'pointer',
                  color: '#666'
                }}
              >
                &times;
              </button>
            </div>

            <p style={{ color: '#666', marginBottom: '15px', fontSize: '14px' }}>
              Paste any valid JSON object. It will be <code>JSON.stringify()</code>'d and placed into the selected target field.
            </p>

            {/* Target Field Toggle */}
            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
                Target Field:
              </label>
              <div style={{ display: 'flex', gap: '15px', flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="targetField"
                    value="enhancedPrompt"
                    checked={jsonImportTargetField === 'enhancedPrompt'}
                    onChange={() => setJsonImportTargetField('enhancedPrompt')}
                    style={{ cursor: 'pointer' }}
                  />
                  <code style={{ backgroundColor: '#e9ecef', padding: '2px 6px', borderRadius: '3px' }}>enhancedPrompt</code>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="targetField"
                    value="prompt"
                    checked={jsonImportTargetField === 'prompt'}
                    onChange={() => setJsonImportTargetField('prompt')}
                    style={{ cursor: 'pointer' }}
                  />
                  <code style={{ backgroundColor: '#e9ecef', padding: '2px 6px', borderRadius: '3px' }}>prompt</code>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="targetField"
                    value="enhancedPromptTechnicalWorkflow"
                    checked={jsonImportTargetField === 'enhancedPromptTechnicalWorkflow'}
                    onChange={() => setJsonImportTargetField('enhancedPromptTechnicalWorkflow')}
                    style={{ cursor: 'pointer' }}
                  />
                  <code style={{ backgroundColor: '#d4edda', padding: '2px 6px', borderRadius: '3px' }}>enhancedPromptTechnicalWorkflow</code>
                  <span style={{ fontSize: '11px', color: '#666' }}>(Phase 4)</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="targetField"
                    value="technicalWorkflow"
                    checked={jsonImportTargetField === 'technicalWorkflow'}
                    onChange={() => setJsonImportTargetField('technicalWorkflow')}
                    style={{ cursor: 'pointer' }}
                  />
                  <code style={{ backgroundColor: '#fff3cd', padding: '2px 6px', borderRadius: '3px' }}>technicalWorkflow</code>
                  <span style={{ fontSize: '11px', color: '#666' }}>(V5 Test Wrapper)</span>
                </label>
              </div>
            </div>

            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                JSON Content:
              </label>
              <textarea
                value={jsonPromptImportValue}
                onChange={(e) => {
                  setJsonPromptImportValue(e.target.value);
                  setJsonPromptImportError(null); // Clear error when typing
                }}
                placeholder={`{\n  "task": "Research and summarize...",\n  "context": {\n    "domain": "technology",\n    "sources": ["web", "database"]\n  },\n  "parameters": {\n    "maxResults": 10,\n    "format": "markdown"\n  }\n}`}
                rows={15}
                style={{
                  width: '100%',
                  padding: '10px',
                  fontSize: '12px',
                  fontFamily: 'monospace',
                  border: jsonPromptImportError ? '2px solid #dc3545' : '1px solid #ccc',
                  borderRadius: '4px',
                  resize: 'vertical'
                }}
              />
            </div>

            {/* Error display */}
            {jsonPromptImportError && (
              <div style={{
                marginBottom: '15px',
                padding: '10px',
                backgroundColor: '#f8d7da',
                border: '1px solid #f5c6cb',
                borderRadius: '4px',
                color: '#721c24',
                fontSize: '13px'
              }}>
                {jsonPromptImportError}
              </div>
            )}

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => {
                  setShowJsonPromptModal(false);
                  setJsonPromptImportValue('');
                  setJsonPromptImportError(null);
                }}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#6c757d',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '14px'
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => importJsonPromptIntoRequestBody(jsonPromptImportValue)}
                disabled={!jsonPromptImportValue.trim()}
                style={{
                  padding: '10px 20px',
                  backgroundColor: jsonPromptImportValue.trim() ? '#6f42c1' : '#ccc',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: jsonPromptImportValue.trim() ? 'pointer' : 'not-allowed',
                  fontSize: '14px',
                  fontWeight: 'bold'
                }}
              >
                Stringify & Import
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}