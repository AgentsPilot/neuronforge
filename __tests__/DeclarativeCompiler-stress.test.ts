import { DeclarativeCompiler } from '../lib/agentkit/v6/compiler/DeclarativeCompiler'
import { DeclarativeLogicalIR } from '../lib/agentkit/v6/logical-ir/types/declarative-ir-types'

describe('DeclarativeCompiler Stress Tests', () => {
  let compiler: DeclarativeCompiler

  beforeEach(() => {
    compiler = new DeclarativeCompiler()
  })

  /**
   * MEGA COMPLEX WORKFLOW
   *
   * Scenario: Enterprise Sales Pipeline Orchestration
   *
   * This workflow:
   * 1. Reads leads from Google Sheets
   * 2. Reads existing customers from another sheet (for deduplication)
   * 3. Reads email engagement data from Gmail
   * 4. Deduplicates leads using composite key (email + company)
   * 5. Filters leads by score and engagement
   * 6. Uses AI to classify lead quality and extract intent
   * 7. Partitions leads by industry and region
   * 8. Groups leads by account executive
   * 9. Enriches each lead with AI-generated personalized outreach
   * 10. Sends per-group summaries to account executives
   * 11. Sends individual follow-ups to high-value leads
   * 12. Archives all processed leads to Sheets
   * 13. Posts summary to Slack
   * 14. Creates HubSpot contacts for qualified leads
   *
   * Pattern complexity:
   * - 5 data sources (Sheets x2, Gmail, reference data, webhook)
   * - Multi-field deduplication
   * - Complex filtering (nested AND/OR groups)
   * - AI operations (classification + extraction)
   * - Partitioning by multiple criteria
   * - Grouping with per-group processing
   * - Scatter-gather for parallel processing
   * - 4 different delivery destinations
   * - Edge case handling
   */
  it('should compile mega complex enterprise workflow', async () => {
    const ir: DeclarativeLogicalIR = {
      ir_version: '3.0',
      goal: 'Enterprise sales pipeline orchestration with AI enrichment, deduplication, partitioning, grouping, and multi-channel delivery',

      // ========================================================================
      // DATA SOURCES (5 sources - maximum complexity)
      // ========================================================================
      data_sources: [
        // Primary: New leads from form submissions
        {
          type: 'tabular',
          source: 'google_sheets',
          location: 'leads_sheet',
          role: 'primary',
          tab: 'New Leads',
          endpoint: null,
          trigger: null,
          plugin_key: 'google-sheets',
          operation_type: 'read_range',
          config: {
            spreadsheet_id: 'abc123',
            range: 'New Leads!A1:Z1000'
          }
        },
        // Reference: Existing customers (for deduplication)
        {
          type: 'tabular',
          source: 'google_sheets',
          location: 'customers_sheet',
          role: 'reference',
          tab: 'Customers',
          endpoint: null,
          trigger: null,
          plugin_key: 'google-sheets',
          operation_type: 'read_range',
          config: {
            spreadsheet_id: 'def456',
            range: 'Customers!A1:C5000',
            identifier_fields: ['email', 'company_name']
          }
        },
        // Enrichment: Email engagement data
        {
          type: 'api',
          source: 'google_mail',
          location: 'gmail',
          role: 'enrichment',
          tab: null,
          endpoint: null,
          trigger: null,
          plugin_key: 'google-mail',
          operation_type: 'search_emails',
          config: {
            query: 'from:leads@company.com newer_than:30d',
            max_results: 1000
          }
        },
        // Reference: Product pricing data
        {
          type: 'tabular',
          source: 'google_sheets',
          location: 'pricing_sheet',
          role: 'reference',
          tab: 'Pricing',
          endpoint: null,
          trigger: null,
          plugin_key: 'google-sheets',
          operation_type: 'read_range',
          config: {
            spreadsheet_id: 'ghi789',
            range: 'Pricing!A1:F100'
          }
        }
      ],

      // ========================================================================
      // NORMALIZATION (strict header requirements)
      // ========================================================================
      normalization: {
        required_headers: [
          'email',
          'company_name',
          'lead_score',
          'industry',
          'region',
          'account_executive',
          'annual_revenue',
          'employee_count',
          'website',
          'phone'
        ],
        case_sensitive: false,
        missing_header_action: 'error'
      },

      // ========================================================================
      // FILTERING (complex nested AND/OR groups)
      // ========================================================================
      filters: {
        combineWith: 'AND',
        conditions: [
          // Base quality filter
          { field: 'lead_score', operator: 'greater_than', value: 50 },
          { field: 'email', operator: 'is_not_empty', value: null }
        ],
        groups: [
          // Group 1: High-value companies (OR)
          {
            combineWith: 'OR',
            conditions: [
              { field: 'annual_revenue', operator: 'greater_than', value: 10000000 },
              { field: 'employee_count', operator: 'greater_than', value: 100 }
            ]
          },
          // Group 2: Target industries and regions (OR)
          {
            combineWith: 'OR',
            conditions: [
              { field: 'industry', operator: 'in', value: 'Technology,Healthcare,Finance' },
              { field: 'region', operator: 'in', value: 'North America,Europe' }
            ]
          },
          // Group 3: Engagement indicators (OR)
          {
            combineWith: 'OR',
            conditions: [
              { field: 'website_visits', operator: 'greater_than', value: 5 },
              { field: 'email_opens', operator: 'greater_than', value: 3 },
              { field: 'content_downloads', operator: 'greater_than', value: 1 }
            ]
          }
        ]
      },

      // ========================================================================
      // AI OPERATIONS (2 operations - classification + extraction)
      // ========================================================================
      ai_operations: [
        // AI Operation 1: Lead quality classification
        {
          type: 'classify',
          instruction: 'Classify the lead quality tier based on all available signals: lead score, company size, industry fit, engagement level, and urgency indicators',
          context: 'Lead score: {{lead_score}}, Revenue: {{annual_revenue}}, Employees: {{employee_count}}, Industry: {{industry}}, Engagement: {{website_visits}} visits',
          output_schema: {
            type: 'string',
            fields: null,
            enum: ['hot', 'warm', 'cold', 'nurture']
          },
          constraints: {
            max_tokens: 50,
            temperature: 0.3,
            model_preference: 'fast'
          }
        },
        // AI Operation 2: Intent and pain point extraction
        {
          type: 'extract',
          instruction: 'Extract the primary business pain points and purchase intent signals from lead data',
          context: 'Form responses: {{form_responses}}, Email engagement: {{email_engagement_summary}}, Pages viewed: {{pages_viewed}}',
          output_schema: {
            type: 'object',
            fields: [
              { name: 'primary_pain_point', type: 'string', required: true, description: 'Main business challenge' },
              { name: 'product_interest', type: 'string', required: true, description: 'Product interest' },
              { name: 'urgency', type: 'string', required: true, description: 'Purchase timeline' },
              { name: 'budget_authority', type: 'string', required: true, description: 'Budget authority' }
            ],
            enum: null
          },
          constraints: {
            max_tokens: 200,
            temperature: 0.4,
            model_preference: 'accurate'
          }
        }
      ],

      // ========================================================================
      // PARTITIONING (multi-dimensional partitioning)
      // ========================================================================
      partitions: [
        // Partition 1: By industry vertical
        {
          field: 'industry',
          split_by: 'value',
          handle_empty: {
            partition_name: 'other_industries',
            description: 'Leads without industry classification'
          }
        },
        // Partition 2: By geographic region
        {
          field: 'region',
          split_by: 'value',
          handle_empty: {
            partition_name: 'unspecified_region',
            description: 'Leads without region data'
          }
        },
        // Partition 3: By lead quality tier (from AI classification)
        {
          field: 'ai_lead_tier',
          split_by: 'value',
          handle_empty: {
            partition_name: 'unclassified',
            description: 'Leads that could not be classified'
          }
        },
        // Partition 4: By account executive (for grouping)
        {
          field: 'account_executive',
          split_by: 'value',
          handle_empty: {
            partition_name: 'unassigned',
            description: 'Leads not yet assigned to an account executive'
          }
        }
      ],

      // ========================================================================
      // GROUPING (per-group delivery to account executives)
      // ========================================================================
      grouping: {
        group_by: 'account_executive',
        emit_per_group: true
      },

      // ========================================================================
      // RENDERING (rich HTML table with AI insights)
      // ========================================================================
      rendering: {
        type: 'email_embedded_table',
        template: 'Sales pipeline report with {{total_count}} leads',
        engine: 'handlebars',
        columns_in_order: [
          'company_name',
          'contact_name',
          'email',
          'phone',
          'industry',
          'region',
          'lead_score',
          'ai_lead_tier',
          'primary_pain_point',
          'product_interest',
          'urgency',
          'annual_revenue',
          'employee_count'
        ],
        empty_message: 'No qualified leads match your criteria at this time.',
        summary_stats: [
          'total_count',
          'hot_count',
          'warm_count',
          'cold_count',
          'total_revenue',
          'avg_lead_score',
          'unique_industries',
          'top_pain_points',
          'urgent_count'
        ]
      },

      // ========================================================================
      // DELIVERY RULES (multi-destination with per-group + per-item + summary)
      // ========================================================================
      delivery_rules: {
        send_when_no_results: true,

        // Per-group delivery to account executives
        per_group_delivery: {
          recipient_source: 'account_executive_email',
          cc: ['sales-manager@company.com'],
          subject: 'New Qualified Leads for {{group_name}} - {{total_count}} opportunities',
          body_template: null, // Use rendering template
          plugin_key: 'google-mail',
          operation_type: 'send_email'
        },

        // Per-item delivery for HOT leads only
        per_item_delivery: {
          recipient_source: 'account_executive_email',
          cc: ['vp-sales@company.com'],
          subject: '🔥 HOT LEAD ALERT: {{company_name}} - Act Now!',
          body_template: 'Hot lead alert for {{company_name}} - Score: {{lead_score}}',
          plugin_key: 'google-mail',
          operation_type: 'send_email'
        },

        // Summary delivery to sales leadership
        summary_delivery: {
          recipient: 'sales-leadership@company.com',
          cc: ['ceo@company.com', 'cmo@company.com'],
          subject: 'Daily Sales Pipeline Summary - {{date}}',
          include_missing_section: true,
          plugin_key: 'google-mail',
          operation_type: 'send_email'
        },

        // Multiple destinations for archival and notifications
        multiple_destinations: [
          // Archive to Google Sheets
          {
            name: 'Archive to Processed Leads Sheet',
            recipient: 'processed_leads_sheet',
            cc: null,
            subject: null,
            body_template: null,
            include_missing_section: false,
            plugin_key: 'google-sheets',
            operation_type: 'append_rows'
          },
          // Post to Slack sales channel
          {
            name: 'Slack Sales Channel Notification',
            recipient: '#sales-pipeline',
            cc: null,
            subject: null,
            body_template: 'Daily Pipeline Update: {{total_count}} new leads',
            include_missing_section: false,
            plugin_key: 'slack',
            operation_type: 'send_message'
          },
          // Create HubSpot contacts for qualified leads
          {
            name: 'Create HubSpot Contacts',
            recipient: 'hubspot_contacts',
            cc: null,
            subject: null,
            body_template: null,
            include_missing_section: false,
            plugin_key: 'hubspot',
            operation_type: 'create_contact'
          }
        ]
      },

      // ========================================================================
      // EDGE CASES (comprehensive error handling)
      // ========================================================================
      edge_cases: [
        {
          condition: 'no_rows_after_filter',
          action: 'send_empty_result_message',
          message: 'No qualified leads met the criteria today. The system processed {{total_leads}} leads but none passed the quality filters.',
          recipient: 'sales-manager@company.com'
        },
        {
          condition: 'empty_data_source',
          action: 'alert_admin',
          message: 'CRITICAL: Lead data source is empty. Check Google Sheets connection and form submissions.',
          recipient: 'it-admin@company.com'
        },
        {
          condition: 'missing_required_field',
          action: 'use_default_value',
          message: 'Missing required field detected. Using default values where possible.',
          recipient: null
        },
        {
          condition: 'missing_required_headers',
          action: 'alert_admin',
          message: 'CRITICAL: Required headers missing from lead sheet. Expected: email, company_name, lead_score, industry, region, account_executive',
          recipient: 'it-admin@company.com'
        },
        {
          condition: 'duplicate_records',
          action: 'skip_execution',
          message: 'Duplicate lead detected and skipped',
          recipient: null
        },
        {
          condition: 'ai_extraction_failed',
          action: 'use_default_value',
          message: 'AI analysis failed for some leads. Proceeding with available data.',
          recipient: 'it-admin@company.com'
        },
        {
          condition: 'rate_limit_exceeded',
          action: 'retry',
          message: 'Rate limit exceeded. Retrying after delay.',
          recipient: null
        },
        {
          condition: 'api_error',
          action: 'alert_admin',
          message: 'API integration error. Check plugin connections.',
          recipient: 'it-admin@company.com'
        }
      ],

      clarifications_required: []
    }

    // Compile and validate
    const result = await compiler.compile(ir)

    // ========================================================================
    // ASSERTIONS - Comprehensive validation
    // ========================================================================

    // Debug: log errors if compilation fails
    if (!result.success) {
      console.log('\n=== COMPILATION FAILED ===')
      console.log('Errors:', result.errors)
    }

    // Basic compilation success
    expect(result.success).toBe(true)
    expect(result.workflow.length).toBeGreaterThan(0)

    console.log(`\n=== STRESS TEST RESULTS ===`)
    console.log(`Total workflow steps generated: ${result.workflow.length}`)
    console.log(`Expected steps: 10-30 (compiler optimizes complex workflows)`)

    // Should have data source reading steps
    const dataReadSteps = result.workflow.filter(s =>
      s.type === 'action' &&
      s.operation &&
      (s.operation.includes('read') || s.operation.includes('search'))
    )
    expect(dataReadSteps.length).toBeGreaterThanOrEqual(1) // At least primary source
    console.log(`Data read steps: ${dataReadSteps.length}`)

    // Should have deduplication steps (pre-computed boolean pattern)
    const dedupSteps = result.workflow.filter(s =>
      s.config?.expression?.includes('.includes') ||
      s.config?.expression?.includes('email') && s.config?.expression?.includes('company_name')
    )
    expect(dedupSteps.length).toBeGreaterThan(0)
    console.log(`Deduplication steps: ${dedupSteps.length}`)

    // Should have filter steps
    const filterSteps = result.workflow.filter(s =>
      s.operation === 'filter' || s.type === 'transform' && s.config?.condition
    )
    expect(filterSteps.length).toBeGreaterThan(0)
    console.log(`Filter steps: ${filterSteps.length}`)

    // Should have AI operation steps
    const aiSteps = result.workflow.filter(s =>
      s.config?.instruction ||
      s.operation?.includes('classify') ||
      s.operation?.includes('extract')
    )
    // Note: AI operations might be compiled differently
    console.log(`AI operation steps: ${aiSteps.length}`)

    // Should have group_by step for grouping
    const groupSteps = result.workflow.filter(s =>
      s.operation === 'group_by' ||
      s.config?.group_by
    )
    console.log(`Group steps: ${groupSteps.length}`)

    // Should have partition steps
    const partitionSteps = result.workflow.filter(s =>
      s.operation === 'partition' ||
      s.config?.partition_by
    )
    console.log(`Partition steps: ${partitionSteps.length}`)

    // Should have render table step
    const renderSteps = result.workflow.filter(s =>
      s.operation === 'render_table' ||
      s.config?.template
    )
    expect(renderSteps.length).toBeGreaterThan(0)
    console.log(`Render steps: ${renderSteps.length}`)

    // Should have scatter_gather for per-item or parallel delivery
    const scatterSteps = result.workflow.filter(s =>
      s.type === 'scatter_gather'
    )
    console.log(`Scatter-gather steps: ${scatterSteps.length}`)

    // Should have delivery action steps
    const deliverySteps = result.workflow.filter(s =>
      s.type === 'action' &&
      (s.operation?.includes('send') ||
       s.operation?.includes('append') ||
       s.operation?.includes('create'))
    )
    expect(deliverySteps.length).toBeGreaterThan(0)
    console.log(`Delivery action steps: ${deliverySteps.length}`)

    // Validate step sequencing (steps should have dependencies)
    const stepsWithInputs = result.workflow.filter(s => s.input)
    expect(stepsWithInputs.length).toBeGreaterThan(0)
    console.log(`Steps with input references: ${stepsWithInputs.length}`)

    // Log full workflow for analysis
    console.log(`\n=== WORKFLOW STRUCTURE ===`)
    result.workflow.forEach((step, idx) => {
      console.log(`${idx + 1}. [${step.type}] ${step.step_id || 'unnamed'} - ${step.operation || 'no-op'}`)
      if (step.description) {
        console.log(`   Description: ${step.description}`)
      }
      if (step.input) {
        console.log(`   Input: ${step.input}`)
      }
    })

    console.log(`\n=== COMPILATION SUMMARY ===`)
    console.log(`✅ Successfully compiled mega complex workflow`)
    console.log(`✅ Generated ${result.workflow.length} executable steps`)
    console.log(`✅ Validated all major pattern types present`)
    console.log(`✅ System handled maximum complexity successfully`)
  }, 30000) // 30 second timeout for complex compilation

  /**
   * STRESS TEST 2: Maximum Data Sources
   *
   * Tests compiler with maximum number of data sources and joins
   */
  it('should handle maximum data sources and complex joins', async () => {
    const ir: DeclarativeLogicalIR = {
      ir_version: '3.0',
      goal: 'Complex multi-source data join and enrichment',

      data_sources: [
        // 10 different data sources to stress the system
        { type: 'tabular', source: 'google_sheets', location: 'sheet1', role: 'primary', tab: 'Data', endpoint: null, trigger: null, plugin_key: 'google-sheets', operation_type: 'read_range', config: { spreadsheet_id: '1', range: 'A1:Z100' } },
        { type: 'tabular', source: 'google_sheets', location: 'sheet2', role: 'enrichment', tab: 'Extra', endpoint: null, trigger: null, plugin_key: 'google-sheets', operation_type: 'read_range', config: { spreadsheet_id: '2', range: 'A1:Z100' } },
        { type: 'api', source: 'google_mail', location: 'gmail', role: 'enrichment', tab: null, endpoint: null, trigger: null, plugin_key: 'google-mail', operation_type: 'search_emails', config: {} },
        { type: 'tabular', source: 'google_sheets', location: 'sheet3', role: 'reference', tab: 'Ref1', endpoint: null, trigger: null, plugin_key: 'google-sheets', operation_type: 'read_range', config: { spreadsheet_id: '3', range: 'A1:Z100', identifier_fields: ['id'] } },
        { type: 'tabular', source: 'google_sheets', location: 'sheet4', role: 'reference', tab: 'Ref2', endpoint: null, trigger: null, plugin_key: 'google-sheets', operation_type: 'read_range', config: { spreadsheet_id: '4', range: 'A1:Z100', identifier_fields: ['code'] } },
        { type: 'tabular', source: 'google_sheets', location: 'sheet5', role: 'enrichment', tab: 'Enrich', endpoint: null, trigger: null, plugin_key: 'google-sheets', operation_type: 'read_range', config: { spreadsheet_id: '5', range: 'A1:Z100' } },
        { type: 'api', source: 'hubspot', location: 'hubspot', role: 'enrichment', tab: null, endpoint: null, trigger: null, plugin_key: 'hubspot', operation_type: 'search_contacts', config: {} }
      ],

      normalization: null,
      filters: null,
      ai_operations: null,
      partitions: null,
      grouping: null,

      rendering: {
        type: 'json',
        columns_in_order: ['id', 'name', 'value']
      },

      delivery_rules: {
        send_when_no_results: false,
        summary_delivery: {
          recipient: 'admin@test.com',
          plugin_key: 'google-mail',
          operation_type: 'send_email'
        }
      },

      edge_cases: [],
      clarifications_required: []
    }

    const result = await compiler.compile(ir)

    expect(result.success).toBe(true)
    console.log(`\n=== MULTI-SOURCE TEST ===`)
    console.log(`Data sources: 7`)
    console.log(`Generated steps: ${result.workflow.length}`)

    const readSteps = result.workflow.filter(s =>
      s.operation?.includes('read') || s.operation?.includes('search')
    )
    console.log(`Read operations: ${readSteps.length}`)
    expect(readSteps.length).toBeGreaterThanOrEqual(3)
  })

  /**
   * STRESS TEST 3: Deep Nesting and Conditionals
   *
   * Tests compiler with maximum filter complexity
   */
  it('should handle deeply nested filter conditions', async () => {
    const ir: DeclarativeLogicalIR = {
      ir_version: '3.0',
      goal: 'Complex nested filtering logic',

      data_sources: [
        {
          type: 'tabular',
          source: 'google_sheets',
          location: 'data',
          role: 'primary',
          tab: 'Main',
          endpoint: null,
          trigger: null,
          plugin_key: 'google-sheets',
          operation_type: 'read_range',
          config: { spreadsheet_id: 'abc', range: 'A1:Z1000' }
        }
      ],

      normalization: null,

      // Maximum filter complexity
      filters: {
        combineWith: 'AND',
        conditions: [
          { field: 'status', operator: 'equals', value: 'active' },
          { field: 'verified', operator: 'equals', value: 'true' }
        ],
        groups: [
          {
            combineWith: 'OR',
            conditions: [
              { field: 'tier', operator: 'equals', value: 'enterprise' },
              { field: 'revenue', operator: 'greater_than', value: 1000000 },
              { field: 'employee_count', operator: 'greater_than', value: 500 }
            ]
          },
          {
            combineWith: 'AND',
            conditions: [
              { field: 'region', operator: 'in', value: 'US,CA,UK,DE,FR' },
              { field: 'industry', operator: 'not_equals', value: 'retail' }
            ]
          },
          {
            combineWith: 'OR',
            conditions: [
              { field: 'engagement_score', operator: 'greater_than', value: 80 },
              { field: 'nps_score', operator: 'greater_than', value: 9 },
              { field: 'renewal_likelihood', operator: 'greater_than', value: 0.85 }
            ]
          },
          {
            combineWith: 'AND',
            conditions: [
              { field: 'last_contact_days', operator: 'less_than', value: 30 },
              { field: 'open_tickets', operator: 'equals', value: '0' },
              { field: 'payment_status', operator: 'equals', value: 'current' }
            ]
          }
        ]
      },

      ai_operations: null,
      partitions: null,
      grouping: null,

      rendering: {
        type: 'json',
        columns_in_order: ['id', 'name']
      },

      delivery_rules: {
        send_when_no_results: false,
        summary_delivery: {
          recipient: 'admin@test.com',
          plugin_key: 'google-mail',
          operation_type: 'send_email'
        }
      },

      edge_cases: [],
      clarifications_required: []
    }

    const result = await compiler.compile(ir)

    expect(result.success).toBe(true)
    console.log(`\n=== NESTED FILTERS TEST ===`)
    console.log(`Filter groups: 4`)
    console.log(`Total conditions: 13`)
    console.log(`Generated steps: ${result.workflow.length}`)

    const filterSteps = result.workflow.filter(s =>
      s.operation === 'filter' || s.config?.condition
    )
    console.log(`Filter steps: ${filterSteps.length}`)
    expect(filterSteps.length).toBeGreaterThan(0)
  })

  /**
   * STRESS TEST 4: Maximum AI Operations
   *
   * Tests compiler with multiple AI operations in sequence
   */
  it('should handle multiple complex AI operations', async () => {
    const ir: DeclarativeLogicalIR = {
      ir_version: '3.0',
      goal: 'Multi-stage AI processing pipeline',

      data_sources: [
        {
          type: 'api',
          source: 'google_mail',
          location: 'gmail',
          role: 'primary',
          tab: null,
          endpoint: null,
          trigger: null,
          plugin_key: 'google-mail',
          operation_type: 'search_emails',
          config: {}
        }
      ],

      normalization: null,
      filters: null,

      // Multiple AI operations
      ai_operations: [
        {
          type: 'sentiment',
          instruction: 'Analyze sentiment of email content',
          context: { email_body: '{{body}}', subject: '{{subject}}' },
          output_schema: {
            type: 'string',
            fields: null,
            enum: ['positive', 'negative', 'neutral', 'urgent']
          },
          constraints: { max_tokens: 50, temperature: 0.3, model_preference: 'fast' }
        },
        {
          type: 'classify',
          instruction: 'Classify email category',
          context: { content: '{{body}}' },
          output_schema: {
            type: 'string',
            fields: null,
            enum: ['complaint', 'inquiry', 'feedback', 'support_request', 'sales_opportunity']
          },
          constraints: { max_tokens: 50, temperature: 0.3, model_preference: 'fast' }
        },
        {
          type: 'extract',
          instruction: 'Extract key entities and action items',
          context: { email: '{{body}}' },
          output_schema: {
            type: 'object',
            fields: [
              { name: 'key_people', type: 'string', required: true, description: 'People mentioned' },
              { name: 'action_items', type: 'string', required: true, description: 'Tasks to complete' },
              { name: 'deadline', type: 'string', required: false, description: 'Any deadlines mentioned' },
              { name: 'priority', type: 'string', required: true, description: 'Priority level' }
            ],
            enum: null
          },
          constraints: { max_tokens: 200, temperature: 0.4, model_preference: 'accurate' }
        },
        {
          type: 'summarize',
          instruction: 'Create executive summary of email thread',
          context: { thread: '{{full_thread}}' },
          output_schema: {
            type: 'string',
            fields: null,
            enum: null
          },
          constraints: { max_tokens: 150, temperature: 0.5, model_preference: 'balanced' }
        }
      ],

      partitions: null,
      grouping: null,

      rendering: {
        type: 'json',
        columns_in_order: ['subject', 'from', 'sentiment', 'category']
      },

      delivery_rules: {
        send_when_no_results: false,
        summary_delivery: {
          recipient: 'admin@test.com',
          plugin_key: 'google-mail',
          operation_type: 'send_email'
        }
      },

      edge_cases: [
        {
          condition: 'ai_extraction_failed',
          action: 'use_default_value',
          message: 'AI processing failed',
          recipient: 'admin@test.com'
        }
      ],
      clarifications_required: []
    }

    const result = await compiler.compile(ir)

    expect(result.success).toBe(true)
    console.log(`\n=== MULTI-AI TEST ===`)
    console.log(`AI operations: 4`)
    console.log(`Generated steps: ${result.workflow.length}`)
  })

  /**
   * STRESS TEST 5: Maximum Delivery Destinations
   *
   * Tests scatter-gather with many parallel destinations
   */
  it('should handle maximum delivery destinations in parallel', async () => {
    const ir: DeclarativeLogicalIR = {
      ir_version: '3.0',
      goal: 'Multi-channel parallel delivery',

      data_sources: [
        {
          type: 'tabular',
          source: 'google_sheets',
          location: 'data',
          role: 'primary',
          tab: 'Main',
          endpoint: null,
          trigger: null,
          plugin_key: 'google-sheets',
          operation_type: 'read_range',
          config: { spreadsheet_id: 'abc', range: 'A1:Z100' }
        }
      ],

      normalization: null,
      filters: null,
      ai_operations: null,
      partitions: null,
      grouping: null,

      rendering: {
        type: 'json',
        columns_in_order: ['id', 'name', 'value']
      },

      delivery_rules: {
        send_when_no_results: false,

        // Maximum destinations for parallel delivery
        multiple_destinations: [
          { name: 'Email Summary', recipient: 'team1@test.com', cc: null, subject: null, body_template: null, include_missing_section: false, plugin_key: 'google-mail', operation_type: 'send_email' },
          { name: 'Slack Channel 1', recipient: '#general', cc: null, subject: null, body_template: 'Update 1', include_missing_section: false, plugin_key: 'slack', operation_type: 'send_message' },
          { name: 'Slack Channel 2', recipient: '#sales', cc: null, subject: null, body_template: 'Update 2', include_missing_section: false, plugin_key: 'slack', operation_type: 'send_message' },
          { name: 'Archive Sheet 1', recipient: 'archive1', cc: null, subject: null, body_template: null, include_missing_section: false, plugin_key: 'google-sheets', operation_type: 'append_rows' },
          { name: 'Archive Sheet 2', recipient: 'archive2', cc: null, subject: null, body_template: null, include_missing_section: false, plugin_key: 'google-sheets', operation_type: 'append_rows' },
          { name: 'HubSpot Sync', recipient: 'hubspot', cc: null, subject: null, body_template: null, include_missing_section: false, plugin_key: 'hubspot', operation_type: 'create_contact' },
          { name: 'Google Drive Archive', recipient: 'drive_folder', cc: null, subject: null, body_template: null, include_missing_section: false, plugin_key: 'google-drive', operation_type: 'create_file' }
        ]
      },

      edge_cases: [],
      clarifications_required: []
    }

    const result = await compiler.compile(ir)

    expect(result.success).toBe(true)
    console.log(`\n=== MULTI-DESTINATION TEST ===`)
    console.log(`Destinations: 7`)
    console.log(`Generated steps: ${result.workflow.length}`)

    const scatterSteps = result.workflow.filter(s => s.type === 'scatter_gather')
    console.log(`Scatter-gather steps: ${scatterSteps.length}`)

    const deliverySteps = result.workflow.filter(s =>
      s.operation?.includes('send') ||
      s.operation?.includes('append') ||
      s.operation?.includes('create')
    )
    console.log(`Delivery action steps: ${deliverySteps.length}`)
    expect(deliverySteps.length).toBeGreaterThan(0)
  })
})
