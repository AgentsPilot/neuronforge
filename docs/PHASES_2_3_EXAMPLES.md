# Phases 2-3 Implementation: Example Workflows

**Date**: November 2, 2025
**Status**: Implementation Complete
**Phases**: 2 (Enhanced Conditionals) & 3 (Advanced Parallel Patterns)

---

## 🎯 Overview

This document provides comprehensive examples for the new workflow capabilities added in Phases 2 and 3:

- **Phase 2**: Switch/case conditionals for discrete value routing
- **Phase 3**: Scatter-gather pattern for parallel processing with aggregation

---

## 📋 Phase 2: Enhanced Conditionals (Switch/Case)

### Switch Step Type Definition

```typescript
{
  type: 'switch',
  id: 'route_by_priority',
  name: 'Route by Priority',
  evaluate: '{{email.priority}}',  // Expression to evaluate
  cases: {
    'high': ['notify_manager', 'create_urgent_ticket'],
    'medium': ['add_to_queue', 'send_ack'],
    'low': ['batch_process']
  },
  default: ['log_unknown_priority']  // Optional fallback
}
```

### Example 1: Email Priority Routing

**Use Case**: Route incoming emails based on priority level

```json
{
  "agent_name": "Email Priority Router",
  "workflow_steps": [
    {
      "id": "classify_email",
      "type": "action",
      "name": "Classify Email Priority",
      "plugin": "openai",
      "action": "analyze_text",
      "params": {
        "text": "{{input.email_body}}",
        "instruction": "Classify this email as high, medium, or low priority"
      }
    },
    {
      "id": "route_by_priority",
      "type": "switch",
      "name": "Route Based on Priority",
      "evaluate": "{{classify_email.data.priority}}",
      "cases": {
        "high": ["notify_manager", "create_ticket", "send_urgent_notification"],
        "medium": ["add_to_queue", "send_acknowledgment"],
        "low": ["batch_for_later"]
      },
      "default": ["log_error", "manual_review"],
      "dependencies": ["classify_email"]
    },
    {
      "id": "notify_manager",
      "type": "action",
      "name": "Notify Manager",
      "plugin": "slack",
      "action": "send_message",
      "params": {
        "channel": "#urgent",
        "message": "High priority email received: {{input.email_subject}}"
      },
      "dependencies": ["route_by_priority"]
    },
    {
      "id": "create_ticket",
      "type": "action",
      "name": "Create Support Ticket",
      "plugin": "zendesk",
      "action": "create_ticket",
      "params": {
        "priority": "high",
        "subject": "{{input.email_subject}}",
        "description": "{{input.email_body}}"
      },
      "dependencies": ["route_by_priority"]
    }
  ]
}
```

**Execution Flow**:
1. Classify email priority using OpenAI
2. Switch evaluates `{{classify_email.data.priority}}`
3. If "high" → executes `notify_manager` and `create_ticket`
4. If "medium" → executes `add_to_queue` and `send_acknowledgment`
5. If "low" → executes `batch_for_later`
6. If unmatched → executes `log_error` and `manual_review`

---

### Example 2: Customer Tier Routing

**Use Case**: Route customer requests based on subscription tier

```json
{
  "agent_name": "Customer Support Router",
  "workflow_steps": [
    {
      "id": "lookup_customer",
      "type": "action",
      "name": "Lookup Customer Account",
      "plugin": "database",
      "action": "query",
      "params": {
        "query": "SELECT tier FROM customers WHERE id = {{input.customer_id}}"
      }
    },
    {
      "id": "route_by_tier",
      "type": "switch",
      "name": "Route by Subscription Tier",
      "evaluate": "{{lookup_customer.data.tier}}",
      "cases": {
        "enterprise": ["assign_dedicated_rep", "priority_queue", "send_premium_response"],
        "professional": ["assign_team_queue", "send_standard_response"],
        "basic": ["assign_general_queue", "send_basic_response"],
        "trial": ["check_upgrade_opportunity", "send_trial_response"]
      },
      "default": ["send_error_response"],
      "dependencies": ["lookup_customer"]
    },
    {
      "id": "assign_dedicated_rep",
      "type": "action",
      "name": "Assign to Dedicated Rep",
      "plugin": "zendesk",
      "action": "assign_ticket",
      "params": {
        "assignee": "{{lookup_customer.data.account_manager}}",
        "priority": "high"
      },
      "dependencies": ["route_by_tier"]
    }
  ]
}
```

---

### Example 3: Multi-Language Routing

**Use Case**: Route content to appropriate translation service

```json
{
  "id": "detect_language",
  "type": "action",
  "name": "Detect Language",
  "plugin": "google_translate",
  "action": "detect",
  "params": {
    "text": "{{input.content}}"
  }
},
{
  "id": "route_translation",
  "type": "switch",
  "name": "Route to Translation Service",
  "evaluate": "{{detect_language.data.language}}",
  "cases": {
    "es": ["translate_spanish"],
    "fr": ["translate_french"],
    "de": ["translate_german"],
    "ja": ["translate_japanese"],
    "zh": ["translate_chinese"]
  },
  "default": ["use_generic_translator"],
  "dependencies": ["detect_language"]
}
```

---

## 🎯 Phase 3: Advanced Parallel Patterns (Scatter-Gather)

### Scatter-Gather Step Type Definition

```typescript
{
  type: 'scatter_gather',
  id: 'process_emails',
  name: 'Process Multiple Emails',
  scatter: {
    input: '{{emails}}',              // Array to iterate over
    steps: [...],                      // Steps to execute for each item
    maxConcurrency: 5,                 // Optional: limit parallel execution
    itemVariable: 'email'              // Optional: variable name (default: 'item')
  },
  gather: {
    operation: 'collect',              // 'collect' | 'merge' | 'reduce'
    outputKey: 'processed_emails',     // Optional: where to store results
    reduceExpression: '...'            // For 'reduce' operation
  }
}
```

---

### Example 1: Bulk Email Processing

**Use Case**: Process multiple emails in parallel, then aggregate results

```json
{
  "agent_name": "Bulk Email Processor",
  "workflow_steps": [
    {
      "id": "fetch_emails",
      "type": "action",
      "name": "Fetch Unread Emails",
      "plugin": "gmail",
      "action": "list_emails",
      "params": {
        "query": "is:unread",
        "max_results": 20
      }
    },
    {
      "id": "process_all_emails",
      "type": "scatter_gather",
      "name": "Process All Emails in Parallel",
      "scatter": {
        "input": "{{fetch_emails.data}}",
        "itemVariable": "email",
        "maxConcurrency": 5,
        "steps": [
          {
            "id": "classify_email",
            "type": "action",
            "name": "Classify Email",
            "plugin": "openai",
            "action": "analyze_text",
            "params": {
              "text": "{{email.body}}",
              "instruction": "Classify as: important, spam, or normal"
            }
          },
          {
            "id": "extract_entities",
            "type": "action",
            "name": "Extract Key Information",
            "plugin": "openai",
            "action": "extract_entities",
            "params": {
              "text": "{{email.body}}",
              "entities": ["person", "company", "date", "action_item"]
            }
          },
          {
            "id": "generate_summary",
            "type": "action",
            "name": "Generate Summary",
            "plugin": "openai",
            "action": "summarize",
            "params": {
              "text": "{{email.body}}",
              "max_length": 100
            }
          }
        ]
      },
      "gather": {
        "operation": "collect",
        "outputKey": "processed_emails"
      },
      "dependencies": ["fetch_emails"]
    },
    {
      "id": "generate_report",
      "type": "transform",
      "name": "Generate Processing Report",
      "operation": "aggregate",
      "input": "{{process_all_emails.data}}",
      "config": {
        "aggregations": [
          { "field": "classify_email.category", "operation": "count", "alias": "email_categories" },
          { "field": "extract_entities.action_items", "operation": "count", "alias": "total_action_items" }
        ]
      },
      "dependencies": ["process_all_emails"]
    }
  ]
}
```

**Execution Flow**:
1. Fetch 20 unread emails from Gmail
2. **Scatter**: Process each email in parallel (max 5 at a time):
   - Classify email category
   - Extract entities (people, companies, dates, action items)
   - Generate summary
3. **Gather**: Collect all results into array
4. Generate aggregate report from processed emails

**Performance**:
- Sequential: 20 emails × 3 steps × 2s = **120 seconds**
- Scatter-gather (5 concurrent): 4 batches × 3 steps × 2s = **24 seconds** ⚡

---

### Example 2: Customer Data Enrichment

**Use Case**: Enrich customer records with data from multiple sources

```json
{
  "agent_name": "Customer Data Enricher",
  "workflow_steps": [
    {
      "id": "fetch_customers",
      "type": "action",
      "name": "Fetch Customer List",
      "plugin": "database",
      "action": "query",
      "params": {
        "query": "SELECT * FROM customers WHERE last_enriched < NOW() - INTERVAL '30 days'"
      }
    },
    {
      "id": "enrich_customers",
      "type": "scatter_gather",
      "name": "Enrich Customer Data",
      "scatter": {
        "input": "{{fetch_customers.data}}",
        "itemVariable": "customer",
        "maxConcurrency": 10,
        "steps": [
          {
            "id": "lookup_clearbit",
            "type": "action",
            "name": "Clearbit Company Lookup",
            "plugin": "clearbit",
            "action": "company_lookup",
            "params": {
              "domain": "{{customer.email_domain}}"
            }
          },
          {
            "id": "lookup_linkedin",
            "type": "action",
            "name": "LinkedIn Profile Lookup",
            "plugin": "linkedin",
            "action": "profile_search",
            "params": {
              "name": "{{customer.name}}",
              "company": "{{customer.company}}"
            }
          },
          {
            "id": "check_social_media",
            "type": "action",
            "name": "Social Media Presence",
            "plugin": "custom_api",
            "action": "social_lookup",
            "params": {
              "name": "{{customer.name}}"
            }
          }
        ]
      },
      "gather": {
        "operation": "merge",
        "outputKey": "enriched_customers"
      },
      "dependencies": ["fetch_customers"]
    },
    {
      "id": "update_database",
      "type": "action",
      "name": "Update Customer Records",
      "plugin": "database",
      "action": "bulk_update",
      "params": {
        "table": "customers",
        "records": "{{enrich_customers.data}}"
      },
      "dependencies": ["enrich_customers"]
    }
  ]
}
```

**Gather Operation: `merge`**
- Merges all enrichment data into consolidated customer objects
- Each customer gets data from Clearbit + LinkedIn + Social Media combined

---

### Example 3: Image Processing Pipeline

**Use Case**: Process multiple images with various transformations

```json
{
  "agent_name": "Bulk Image Processor",
  "workflow_steps": [
    {
      "id": "list_images",
      "type": "action",
      "name": "List Images from S3",
      "plugin": "aws_s3",
      "action": "list_objects",
      "params": {
        "bucket": "uploads",
        "prefix": "unprocessed/"
      }
    },
    {
      "id": "process_images",
      "type": "scatter_gather",
      "name": "Process All Images",
      "scatter": {
        "input": "{{list_images.data}}",
        "itemVariable": "image",
        "maxConcurrency": 8,
        "steps": [
          {
            "id": "resize_image",
            "type": "action",
            "name": "Resize Image",
            "plugin": "imagemagick",
            "action": "resize",
            "params": {
              "url": "{{image.url}}",
              "width": 800,
              "height": 600
            }
          },
          {
            "id": "optimize",
            "type": "action",
            "name": "Optimize for Web",
            "plugin": "imagemagick",
            "action": "optimize",
            "params": {
              "url": "{{resize_image.data.url}}",
              "quality": 85
            }
          },
          {
            "id": "detect_faces",
            "type": "action",
            "name": "Detect Faces",
            "plugin": "aws_rekognition",
            "action": "detect_faces",
            "params": {
              "image_url": "{{optimize.data.url}}"
            }
          },
          {
            "id": "generate_tags",
            "type": "action",
            "name": "Auto-tag Image",
            "plugin": "aws_rekognition",
            "action": "detect_labels",
            "params": {
              "image_url": "{{optimize.data.url}}"
            }
          }
        ]
      },
      "gather": {
        "operation": "collect",
        "outputKey": "processed_images"
      },
      "dependencies": ["list_images"]
    },
    {
      "id": "save_metadata",
      "type": "action",
      "name": "Save Image Metadata",
      "plugin": "database",
      "action": "bulk_insert",
      "params": {
        "table": "image_metadata",
        "records": "{{process_images.data}}"
      },
      "dependencies": ["process_images"]
    }
  ]
}
```

---

### Example 4: API Data Aggregation with Reduce

**Use Case**: Fetch data from multiple APIs and calculate totals

```json
{
  "id": "fetch_regional_sales",
  "type": "scatter_gather",
  "name": "Aggregate Regional Sales Data",
  "scatter": {
    "input": "{{regions}}",
    "itemVariable": "region",
    "maxConcurrency": 5,
    "steps": [
      {
        "id": "fetch_sales",
        "type": "action",
        "name": "Fetch Sales for Region",
        "plugin": "salesforce",
        "action": "query",
        "params": {
          "query": "SELECT SUM(amount) FROM sales WHERE region = {{region.name}}"
        }
      }
    ]
  },
  "gather": {
    "operation": "reduce",
    "outputKey": "total_sales"
  }
}
```

**Gather Operation: `reduce`**
- Automatically sums numeric results
- Returns single aggregated value instead of array

---

## 🔄 Combining Switch and Scatter-Gather

### Example: Dynamic Email Processing with Priority Routing

**Use Case**: Fetch emails, classify them, then process each priority tier differently

```json
{
  "agent_name": "Intelligent Email Processor",
  "workflow_steps": [
    {
      "id": "fetch_emails",
      "type": "action",
      "name": "Fetch Emails",
      "plugin": "gmail",
      "action": "list_emails",
      "params": {
        "max_results": 50
      }
    },
    {
      "id": "classify_all",
      "type": "scatter_gather",
      "name": "Classify All Emails",
      "scatter": {
        "input": "{{fetch_emails.data}}",
        "itemVariable": "email",
        "maxConcurrency": 10,
        "steps": [
          {
            "id": "classify",
            "type": "action",
            "name": "Classify Priority",
            "plugin": "openai",
            "action": "classify",
            "params": {
              "text": "{{email.subject}} {{email.body}}",
              "categories": ["urgent", "normal", "low"]
            }
          }
        ]
      },
      "gather": {
        "operation": "collect"
      },
      "dependencies": ["fetch_emails"]
    },
    {
      "id": "group_by_priority",
      "type": "transform",
      "name": "Group Emails by Priority",
      "operation": "group",
      "input": "{{classify_all.data}}",
      "config": {
        "field": "classify.category"
      },
      "dependencies": ["classify_all"]
    },
    {
      "id": "route_urgent",
      "type": "scatter_gather",
      "name": "Process Urgent Emails",
      "scatter": {
        "input": "{{group_by_priority.data.urgent}}",
        "itemVariable": "email",
        "maxConcurrency": 3,
        "steps": [
          {
            "id": "notify_team",
            "type": "action",
            "name": "Notify Team",
            "plugin": "slack",
            "action": "send_message",
            "params": {
              "channel": "#urgent",
              "message": "Urgent: {{email.subject}}"
            }
          },
          {
            "id": "create_ticket",
            "type": "action",
            "name": "Create High Priority Ticket",
            "plugin": "zendesk",
            "action": "create_ticket",
            "params": {
              "priority": "urgent",
              "subject": "{{email.subject}}"
            }
          }
        ]
      },
      "gather": {
        "operation": "collect"
      },
      "dependencies": ["group_by_priority"]
    }
  ]
}
```

---

## 📊 Performance Comparison

### Sequential vs. Scatter-Gather Processing

**Scenario**: Process 100 customer records, each requiring 3 API calls averaging 2 seconds each

| Approach | Total Time | Speedup |
|----------|-----------|---------|
| **Sequential** | 100 × 3 × 2s = **600 seconds (10 min)** | 1x |
| **Scatter-Gather (5 concurrent)** | 20 batches × 3 × 2s = **120 seconds (2 min)** | **5x faster** ⚡ |
| **Scatter-Gather (10 concurrent)** | 10 batches × 3 × 2s = **60 seconds (1 min)** | **10x faster** ⚡⚡ |

---

## 🧪 Testing Your Workflows

### Test Switch Step

```bash
curl -X POST http://localhost:3000/api/run-agent \
  -H "Content-Type: application/json" \
  -d '{
    "agent_id": "your_agent_id",
    "input_variables": {
      "email": {
        "priority": "high",
        "subject": "Critical Issue"
      }
    }
  }'
```

**Expected Console Output**:
```
🔀 [StepExecutor] Switch on "{{email.priority}}" = "high"
✅ [StepExecutor] Matched case "high" → steps: notify_manager, create_ticket
```

---

### Test Scatter-Gather Step

```bash
curl -X POST http://localhost:3000/api/run-agent \
  -H "Content-Type: application/json" \
  -d '{
    "agent_id": "your_agent_id",
    "input_variables": {
      "emails": [
        {"subject": "Email 1", "body": "..."},
        {"subject": "Email 2", "body": "..."},
        {"subject": "Email 3", "body": "..."}
      ]
    }
  }'
```

**Expected Console Output**:
```
🎯 [ParallelExecutor] Executing scatter-gather: Process All Emails
🎯 [ParallelExecutor] Scattering over 3 items (max concurrency: 5)
🎯 [ParallelExecutor] Scatter item 1
🎯 [ParallelExecutor] Scatter item 2
🎯 [ParallelExecutor] Scatter item 3
🎯 [ParallelExecutor] Scatter complete, gathering 3 results
🎯 [ParallelExecutor] Gathering with operation: collect
✅ [ParallelExecutor] Scatter-gather complete for process_all_emails
```

---

## 🔍 Database Verification

### Check Step Execution Logs

```sql
-- View scatter-gather execution
SELECT
  wse.step_id,
  wse.step_name,
  wse.status,
  wse.execution_metadata->'item_count' as items_processed,
  wse.execution_metadata->'execution_time' as duration_ms
FROM workflow_step_executions wse
WHERE wse.step_name LIKE '%scatter%'
ORDER BY wse.created_at DESC;
```

### Check Switch Routing

```sql
-- View switch step decisions
SELECT
  wse.step_id,
  wse.execution_metadata->'matchedCase' as matched_case,
  wse.execution_metadata->'matchedSteps' as routed_steps,
  wse.execution_metadata->'totalCases' as total_cases
FROM workflow_step_executions wse
WHERE wse.step_type = 'switch'
ORDER BY wse.created_at DESC;
```

---

## ✅ Success Criteria

### Phase 2 (Switch) Verification:
- ✅ Switch step evaluates expressions correctly
- ✅ Cases match based on evaluated values
- ✅ Default fallback works when no case matches
- ✅ Step routing follows matched branch
- ✅ Console logs show switch evaluation details

### Phase 3 (Scatter-Gather) Verification:
- ✅ Scatter distributes work across items
- ✅ Concurrency limit is respected
- ✅ Steps execute for each item
- ✅ Gather aggregates results correctly
- ✅ All three gather operations work (collect, merge, reduce)
- ✅ Performance improvement over sequential processing

---

## 🚀 Next Steps

After testing Phases 2-3:

1. **Monitor Performance**: Check execution times in `workflow_step_executions`
2. **Optimize Concurrency**: Adjust `maxConcurrency` based on API rate limits
3. **Create Reusable Patterns**: Build workflow templates for common use cases
4. **Move to Phase 4**: Data operations (enrichment, validation, comparison)

---

## 📚 Additional Resources

- **Phase 1 Testing Guide**: `/docs/PHASE_1_TESTING_GUIDE.md`
- **Implementation Roadmap**: `/docs/PHASES_2_9_IMPLEMENTATION_ROADMAP.md`
- **Pilot Design**: `/docs/PILOT_DESIGN.md`
- **Type Definitions**: `/lib/pilot/types.ts`

---

**Documentation Version**: 1.0
**Last Updated**: November 2, 2025
**Status**: Ready for Testing
