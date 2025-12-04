# Pilot Workflow Architecture Patterns

This document defines **correct architectural patterns** for building efficient, scalable pilot workflows.

## Core Principle: Minimize LLM Calls

**Golden Rule**: Process data in batches, not loops. Each LLM call costs tokens and latency.

## Pattern 1: Simple Linear Workflow (No Loops)

**Use Case**: Sequential tasks with no iteration
**Example**: "Send daily summary email"

```typescript
[
  {
    id: "step1",
    type: "action",
    name: "Get inbox emails",
    plugin: "google-mail",
    action: "search_emails",
    params: { query: "in:inbox newer_than:1d" }
  },
  {
    id: "step2",
    type: "ai_processing",
    name: "Summarize emails",
    params: {
      input: "{{step1.emails}}",
      prompt: "Summarize key points from today's emails"
    }
  },
  {
    id: "step3",
    type: "action",
    name: "Send summary email",
    plugin: "google-mail",
    action: "send_email",
    params: {
      recipients: { to: ["{{input.recipient}}"] },
      content: {
        subject: "Daily Email Summary",
        body: "{{step2.summary}}"
      }
    }
  }
]
```

**Characteristics**:
- 3-5 steps
- No conditionals or loops
- 1 LLM call for summarization
- Fast and predictable

---

## Pattern 2: Conditional Workflow (If/Else Logic)

**Use Case**: Different paths based on data
**Example**: "Alert if high-value deal created"

```typescript
[
  {
    id: "step1",
    type: "action",
    name: "Get recent deals",
    plugin: "hubspot",
    action: "search_deals",
    params: { filter: "created_date:today" }
  },
  {
    id: "step2",
    type: "comparison",
    name: "Check if any deal > $10k",
    operation: ">",
    left: "{{step1.deals[0].amount}}",
    right: "10000"
  },
  {
    id: "step3",
    type: "conditional",
    name: "Branch on deal size",
    condition: {
      field: "step2.result",
      operator: "==",
      value: "true"
    },
    trueBranch: "step4",
    falseBranch: null  // End workflow
  },
  {
    id: "step4",
    type: "action",
    name: "Send alert to sales team",
    plugin: "google-mail",
    action: "send_email",
    params: {
      recipients: { to: ["{{input.sales_email}}"] },
      content: {
        subject: "High-Value Deal Alert",
        body: "New ${{step1.deals[0].amount}} deal created"
      }
    }
  }
]
```

**Characteristics**:
- Branching logic with conditions
- Comparison step for data evaluation
- No LLM calls (optional)

---

## Pattern 3: Batch Processing (CORRECT for Large Datasets)

**Use Case**: Process 100+ items efficiently
**Example**: "Extract data from 100 customer PDFs"

```typescript
[
  {
    id: "step1",
    type: "action",
    name: "Get all customer folders",
    plugin: "google-drive",
    action: "get_folder_contents",
    params: { folder_id: "{{input.folder_id}}" }
  },
  {
    id: "step2",
    type: "action",
    name: "Get all PDF files from folders",
    plugin: "google-drive",
    action: "list_files",
    params: {
      query: "mimeType='application/pdf' and '{{step1.folders}}' in parents"
    }
  },
  {
    id: "step3",
    type: "ai_processing",
    name: "Extract customer data from ALL PDFs at once",
    params: {
      input: "{{step2.files}}",
      prompt: "For each PDF, extract: customer_name, email, company, package. Return array of objects."
    }
  },
  {
    id: "step4",
    type: "transform",
    name: "Map extracted data to customer objects",
    operation: "map",
    input: "{{step3.customers}}",
    config: {
      map_to: "customer_record"
    }
  },
  {
    id: "step5",
    type: "action",
    name: "Lookup all customers in sheet (batch)",
    plugin: "google-sheets",
    action: "batch_lookup",
    params: {
      spreadsheet_id: "{{input.sheet_id}}",
      lookup_values: "{{step4.customer_emails}}"
    }
  }
]
```

**Token Efficiency**:
- ❌ Loop approach: 100 LLM calls × 500 tokens = 50,000 tokens
- ✅ Batch approach: 1 LLM call × 5,000 tokens = 5,000 tokens
- **10x more efficient!**

---

## Pattern 4: Batch + Loop Hybrid (CORRECT for Mixed Processing)

**Use Case**: Batch AI processing, then individual plugin actions
**Example**: "Process customers, then update HubSpot individually"

```typescript
[
  {
    id: "step1",
    type: "action",
    name: "Get all customers",
    plugin: "google-drive",
    action: "get_folder_contents",
    params: { folder_id: "{{input.folder_id}}" }
  },
  {
    id: "step2",
    type: "ai_processing",
    name: "Extract ALL customer data at once",
    params: {
      input: "{{step1.customers}}",
      prompt: "Extract customer info from each. Return array."
    }
  },
  {
    id: "step3",
    type: "action",
    name: "Search ALL customer emails (batch)",
    plugin: "google-mail",
    action: "batch_search",
    params: {
      queries: "{{step2.customer_emails}}"
    }
  },
  {
    id: "step4",
    type: "ai_processing",
    name: "Summarize ALL email threads at once",
    params: {
      input: "{{step3.email_threads}}",
      prompt: "For each customer, summarize issues. Flag urgent keywords. Return array."
    }
  },
  {
    id: "step5",
    type: "ai_processing",
    name: "Classify ALL package mismatches at once",
    params: {
      input: "{{step2.customers}}",
      prompt: "Compare contract vs sheet package for each. Classify as: Upgrade, Downgrade, or Match. Return array."
    }
  },
  {
    id: "step6",
    type: "loop",
    name: "Update HubSpot for each customer",
    iterateOver: "{{step5.classifications}}",
    maxIterations: 100,
    loopSteps: [
      {
        id: "step6_1",
        type: "conditional",
        name: "Check classification type",
        condition: {
          field: "loop.item.classification",
          operator: "==",
          value: "Upgrade"
        },
        trueBranch: "step6_2",
        falseBranch: "step6_3"
      },
      {
        id: "step6_2",
        type: "action",
        name: "Create HubSpot deal for upgrade",
        plugin: "hubspot",
        action: "create_deal",
        params: {
          name: "Upgrade - {{loop.item.company}}",
          amount: "{{loop.item.new_package_value}}"
        }
      },
      {
        id: "step6_3",
        type: "conditional",
        name: "Check if urgent issue",
        condition: {
          field: "loop.item.has_urgent_issue",
          operator: "==",
          value: "true"
        },
        trueBranch: "step6_4",
        falseBranch: null
      },
      {
        id: "step6_4",
        type: "action",
        name: "Tag contact as urgent",
        plugin: "hubspot",
        action: "update_contact",
        params: {
          email: "{{loop.item.email}}",
          tags: ["URGENT"]
        }
      }
    ]
  },
  {
    id: "step7",
    type: "ai_processing",
    name: "Generate final report",
    params: {
      input: "{{step6.results}}",
      prompt: "Generate HTML report with table of all customers and their status"
    }
  },
  {
    id: "step8",
    type: "action",
    name: "Email report",
    plugin: "google-mail",
    action: "send_email",
    params: {
      recipients: { to: ["{{input.report_recipients}}"] },
      content: {
        subject: "Customer Onboarding Report",
        body: "{{step7.report}}",
        html: true
      }
    }
  }
]
```

**Key Architecture Decisions**:
1. **Batch AI processing first** (steps 2, 4, 5): 3 LLM calls total
2. **Loop only for plugin actions** (step 6): HubSpot updates that must be individual
3. **NO AI inside loop**: All AI done before looping
4. **Final report generation** (step 7): 1 LLM call for summary

**Total LLM Calls**: 4 (vs 400 if AI was inside loop)

---

## Pattern 5: Complex Multi-Branch Conditional

**Use Case**: Multiple outcome paths
**Example**: "Route support ticket by urgency and category"

```typescript
[
  {
    id: "step1",
    type: "action",
    name: "Get new support tickets",
    plugin: "zendesk",
    action: "search_tickets",
    params: { status: "new" }
  },
  {
    id: "step2",
    type: "ai_processing",
    name: "Classify ALL tickets at once",
    params: {
      input: "{{step1.tickets}}",
      prompt: "For each ticket, classify: urgency (low/medium/high), category (billing/technical/sales). Return array."
    }
  },
  {
    id: "step3",
    type: "loop",
    name: "Process each ticket classification",
    iterateOver: "{{step2.classifications}}",
    maxIterations: 50,
    loopSteps: [
      {
        id: "step3_1",
        type: "switch",
        name: "Route by urgency + category",
        evaluate: "{{loop.item.urgency}}_{{loop.item.category}}",
        cases: {
          "high_billing": ["step3_2"],
          "high_technical": ["step3_3"],
          "medium_billing": ["step3_4"],
          "medium_technical": ["step3_5"]
        },
        defaultCase: "step3_6"
      },
      {
        id: "step3_2",
        type: "action",
        name: "Escalate to finance immediately",
        plugin: "slack",
        action: "send_message",
        params: {
          channel: "#finance-urgent",
          message: "Urgent billing issue: {{loop.item.subject}}"
        }
      },
      {
        id: "step3_3",
        type: "action",
        name: "Assign to senior engineer",
        plugin: "zendesk",
        action: "assign_ticket",
        params: {
          ticket_id: "{{loop.item.id}}",
          assignee: "senior-engineer-pool"
        }
      },
      {
        id: "step3_4",
        type: "action",
        name: "Assign to billing team",
        plugin: "zendesk",
        action: "assign_ticket",
        params: {
          ticket_id: "{{loop.item.id}}",
          assignee: "billing-team"
        }
      },
      {
        id: "step3_5",
        type: "action",
        name: "Assign to support team",
        plugin: "zendesk",
        action: "assign_ticket",
        params: {
          ticket_id: "{{loop.item.id}}",
          assignee: "support-team"
        }
      },
      {
        id: "step3_6",
        type: "action",
        name: "Assign to general queue",
        plugin: "zendesk",
        action: "assign_ticket",
        params: {
          ticket_id: "{{loop.item.id}}",
          assignee: "general-queue"
        }
      }
    ]
  }
]
```

**Switch Statement Benefits**:
- Multiple outcome paths (5+ routes)
- Cleaner than nested conditionals
- Evaluate based on combined values

---

## Anti-Patterns (NEVER DO THIS)

### ❌ Anti-Pattern 1: AI Inside Loop

```typescript
// WRONG - 100 LLM calls
{
  type: "loop",
  iterateOver: "{{step1.customers}}",
  loopSteps: [
    {
      type: "ai_processing",  // ❌ DON'T DO THIS
      params: {
        input: "{{loop.item.pdf}}",
        prompt: "Extract customer data"
      }
    }
  ]
}
```

### ✅ Correct: Batch AI Before Loop

```typescript
// CORRECT - 1 LLM call
{
  type: "ai_processing",
  params: {
    input: "{{step1.all_pdfs}}",  // All at once
    prompt: "Extract customer data from each PDF. Return array."
  }
}
```

### ❌ Anti-Pattern 2: Nested Loops with AI

```typescript
// WRONG - N×M LLM calls
{
  type: "loop",
  iterateOver: "{{folders}}",
  loopSteps: [
    {
      type: "loop",  // ❌ Nested loop
      iterateOver: "{{files}}",
      loopSteps: [
        {
          type: "ai_processing"  // ❌❌ AI in nested loop!
        }
      ]
    }
  ]
}
```

### ✅ Correct: Flatten and Batch

```typescript
// CORRECT - 1 LLM call
{
  type: "transform",
  operation: "flatten",
  input: "{{folders.files}}"  // Flatten all files
},
{
  type: "ai_processing",
  params: {
    input: "{{flattened_files}}",
    prompt: "Process all files. Return array."
  }
}
```

---

## Decision Tree: Which Pattern to Use?

```
Does task process multiple items?
├─ NO → Pattern 1: Simple Linear
└─ YES
   └─ Does it need AI analysis?
      ├─ NO → Pattern 2: Conditional OR Simple Loop
      └─ YES
         └─ Are items >10?
            ├─ NO → Pattern 2: Conditional with AI
            └─ YES
               └─ Need individual plugin actions after AI?
                  ├─ NO → Pattern 3: Pure Batch Processing
                  └─ YES → Pattern 4: Batch + Loop Hybrid
```

---

## Performance Comparison

### Scenario: Process 100 customer PDFs with AI extraction

| Approach | LLM Calls | Avg Tokens | Latency | Cost |
|----------|-----------|------------|---------|------|
| AI in loop (❌) | 100 | 50,000 | ~300s | $0.75 |
| Batch AI (✅) | 1 | 5,000 | ~10s | $0.08 |
| **Improvement** | **99% fewer** | **90% fewer** | **97% faster** | **89% cheaper** |

---

## Real-World Examples

### Example 1: Daily Email Digest (Simple Linear)
- Get emails → Summarize with AI → Send digest
- **Pattern**: 1
- **LLM calls**: 1

### Example 2: Lead Scoring (Conditional)
- Get new leads → Score with AI → Route high-value to sales
- **Pattern**: 2
- **LLM calls**: 1

### Example 3: Invoice Processing (Batch)
- Get 500 invoices → Extract data (batch AI) → Upload to accounting
- **Pattern**: 3
- **LLM calls**: 1

### Example 4: Customer Onboarding Review (Batch + Loop)
- Get 100 customers → Extract data (batch AI) → Classify (batch AI) → Update HubSpot (loop)
- **Pattern**: 4
- **LLM calls**: 3-4

### Example 5: Support Ticket Routing (Switch)
- Get tickets → Classify (batch AI) → Route by category (switch in loop)
- **Pattern**: 5
- **LLM calls**: 1

---

## Summary: Best Practices

✅ **DO**:
- Batch all AI processing before loops
- Use loops only for plugin actions that must be individual
- Process arrays in single LLM calls
- Use switch statements for multi-branch logic
- Flatten nested data structures before AI processing

❌ **DON'T**:
- Put ai_processing inside loops
- Create nested loops
- Process items individually when batch is possible
- Use conditionals when switch is clearer
- Ignore token costs in architecture decisions

**Remember**: Every LLM call costs money and time. Design for batch processing first!
