# Phase 5 Examples: Sub-Workflows

**Phase**: 5 of 9 - Sub-Workflows
**Status**: ✅ Complete
**Last Updated**: November 2, 2025

---

## 📚 Table of Contents

1. [Basic Sub-Workflow](#1-basic-sub-workflow)
2. [Database-Loaded Sub-Workflow](#2-database-loaded-sub-workflow)
3. [Input/Output Mapping](#3-inputoutput-mapping)
4. [Context Inheritance](#4-context-inheritance)
5. [Error Handling Strategies](#5-error-handling-strategies)
6. [Timeout Protection](#6-timeout-protection)
7. [Nested Sub-Workflows](#7-nested-sub-workflows)
8. [Parallel Sub-Workflows](#8-parallel-sub-workflows)
9. [Conditional Sub-Workflows](#9-conditional-sub-workflows)
10. [Real-World Use Cases](#10-real-world-use-cases)

---

## 1. Basic Sub-Workflow

**Use Case**: Simple inline sub-workflow for data validation

```json
{
  "agent_name": "Order Processor",
  "workflow_steps": [
    {
      "id": "receive_order",
      "name": "Receive Order",
      "type": "action",
      "plugin": "http",
      "action": "parse_request",
      "params": {
        "body": "{{inputs.request_body}}"
      }
    },
    {
      "id": "validate_order",
      "name": "Validate Order Data",
      "type": "sub_workflow",
      "workflowSteps": [
        {
          "id": "validate_schema",
          "name": "Validate Order Schema",
          "type": "validation",
          "input": "{{orderData}}",
          "schema": {
            "type": "object",
            "required": ["customer_id", "items", "total"],
            "properties": {
              "total": { "type": "number", "min": 0 },
              "items": { "type": "array", "minLength": 1 }
            }
          }
        },
        {
          "id": "check_customer",
          "name": "Check Customer Exists",
          "type": "action",
          "plugin": "database",
          "action": "query",
          "params": {
            "table": "customers",
            "filter": { "id": "{{orderData.customer_id}}" }
          },
          "dependencies": ["validate_schema"]
        }
      ],
      "inputs": {
        "orderData": "{{receive_order.data}}"
      },
      "outputMapping": {
        "validatedOrder": "{{validate_schema.data}}",
        "customer": "{{check_customer.data}}"
      },
      "dependencies": ["receive_order"]
    },
    {
      "id": "process_order",
      "name": "Process Valid Order",
      "type": "action",
      "plugin": "orders",
      "action": "create",
      "params": {
        "order": "{{validate_order.data.validatedOrder}}",
        "customer": "{{validate_order.data.customer}}"
      },
      "dependencies": ["validate_order"]
    }
  ]
}
```

**Output**:
```json
{
  "validate_order": {
    "data": {
      "validatedOrder": { "customer_id": "123", "items": [...], "total": 99.99 },
      "customer": { "id": "123", "name": "John Doe", "email": "john@example.com" }
    },
    "metadata": {
      "success": true,
      "executionTime": 245,
      "subWorkflowStepCount": 2
    }
  }
}
```

---

## 2. Database-Loaded Sub-Workflow

**Use Case**: Reusable workflow stored in database

### Step 1: Create Reusable Workflow Agent

```sql
INSERT INTO agents (agent_name, workflow_steps, created_by)
VALUES (
  'Customer Data Processor',
  '[
    {
      "id": "fetch_profile",
      "name": "Fetch Customer Profile",
      "type": "action",
      "plugin": "crm",
      "action": "get_customer",
      "params": {
        "customerId": "{{customerId}}"
      }
    },
    {
      "id": "fetch_orders",
      "name": "Fetch Order History",
      "type": "action",
      "plugin": "database",
      "action": "query",
      "params": {
        "table": "orders",
        "filter": { "customer_id": "{{customerId}}" },
        "limit": 10
      },
      "dependencies": ["fetch_profile"]
    },
    {
      "id": "enrich_data",
      "name": "Enrich Customer Data",
      "type": "enrichment",
      "sources": [
        { "key": "profile", "from": "{{fetch_profile.data}}" },
        { "key": "orders", "from": "{{fetch_orders.data}}" }
      ],
      "strategy": "deep_merge",
      "dependencies": ["fetch_profile", "fetch_orders"]
    }
  ]',
  'admin-user-id'
);
```

### Step 2: Use in Multiple Workflows

**Workflow A: Customer Support**
```json
{
  "workflow_steps": [
    {
      "id": "identify_customer",
      "type": "action",
      "plugin": "support",
      "action": "identify",
      "params": {
        "email": "{{inputs.email}}"
      }
    },
    {
      "id": "load_customer_data",
      "type": "sub_workflow",
      "name": "Load Customer Data",
      "workflowId": "customer-data-processor-id",
      "inputs": {
        "customerId": "{{identify_customer.data.id}}"
      },
      "timeout": 30000,
      "dependencies": ["identify_customer"]
    },
    {
      "id": "display_profile",
      "type": "action",
      "plugin": "ui",
      "action": "render",
      "params": {
        "template": "customer_profile",
        "data": "{{load_customer_data.data}}"
      },
      "dependencies": ["load_customer_data"]
    }
  ]
}
```

**Workflow B: Analytics Report**
```json
{
  "workflow_steps": [
    {
      "id": "get_customer_list",
      "type": "action",
      "plugin": "database",
      "action": "query",
      "params": {
        "table": "customers",
        "filter": { "segment": "premium" }
      }
    },
    {
      "id": "process_customers",
      "type": "scatter_gather",
      "scatter": {
        "input": "{{get_customer_list.data}}",
        "steps": [
          {
            "id": "process_one_customer",
            "type": "sub_workflow",
            "workflowId": "customer-data-processor-id",
            "inputs": {
              "customerId": "{{item.id}}"
            },
            "timeout": 10000,
            "onError": "continue"
          }
        ],
        "maxConcurrency": 5
      },
      "gather": {
        "operation": "collect"
      },
      "dependencies": ["get_customer_list"]
    }
  ]
}
```

**Benefits**:
- ✅ Single source of truth
- ✅ Update once, applies everywhere
- ✅ Version control via database
- ✅ Easy testing and debugging

---

## 3. Input/Output Mapping

**Use Case**: Transform and map data between contexts

```json
{
  "workflow_steps": [
    {
      "id": "fetch_raw_data",
      "name": "Fetch Raw API Data",
      "type": "action",
      "plugin": "http",
      "action": "get",
      "params": {
        "url": "https://api.example.com/data",
        "headers": {
          "Authorization": "Bearer {{inputs.apiToken}}"
        }
      }
    },
    {
      "id": "transform_and_validate",
      "name": "Transform & Validate Data",
      "type": "sub_workflow",
      "workflowSteps": [
        {
          "id": "transform",
          "name": "Transform Structure",
          "type": "transform",
          "operation": "map",
          "input": "{{rawData}}",
          "expression": "{id: item.id, name: item.title, value: item.amount}"
        },
        {
          "id": "validate",
          "name": "Validate Transformed Data",
          "type": "validation",
          "input": "{{transform.data}}",
          "schema": {
            "type": "array",
            "minLength": 1
          },
          "dependencies": ["transform"]
        },
        {
          "id": "add_metadata",
          "name": "Add Processing Metadata",
          "type": "enrichment",
          "sources": [
            { "key": "data", "from": "{{validate.data.data}}" },
            { "key": "metadata", "from": "{{processingMetadata}}" }
          ],
          "strategy": "merge",
          "dependencies": ["validate"]
        }
      ],
      "inputs": {
        "rawData": "{{fetch_raw_data.data.results}}",
        "processingMetadata": {
          "processed_at": "{{context.startedAt}}",
          "processor": "transform_and_validate",
          "version": "1.0"
        }
      },
      "outputMapping": {
        "transformedData": "{{add_metadata.data.data}}",
        "metadata": "{{add_metadata.data.metadata}}",
        "recordCount": "{{transform.data.length}}"
      },
      "dependencies": ["fetch_raw_data"]
    },
    {
      "id": "save_results",
      "name": "Save Processed Data",
      "type": "action",
      "plugin": "database",
      "action": "bulk_insert",
      "params": {
        "table": "processed_data",
        "records": "{{transform_and_validate.data.transformedData}}",
        "metadata": "{{transform_and_validate.data.metadata}}"
      },
      "dependencies": ["transform_and_validate"]
    }
  ]
}
```

**Input Mapping**:
```
Parent Context                     Sub-Workflow Context
─────────────────                  ────────────────────
fetch_raw_data.data.results   →   rawData
{ processed_at: ..., ... }     →   processingMetadata
```

**Output Mapping**:
```
Sub-Workflow Context               Parent Context
────────────────────              ──────────────
add_metadata.data.data        →   transformedData
add_metadata.data.metadata    →   metadata
transform.data.length         →   recordCount
```

---

## 4. Context Inheritance

**Use Case**: Sub-workflow needs access to many parent variables

### Without Inheritance (Explicit Mapping)

```json
{
  "id": "process_data",
  "type": "sub_workflow",
  "workflowSteps": [...],
  "inputs": {
    "userId": "{{context.userId}}",
    "sessionId": "{{context.sessionId}}",
    "orgId": "{{context.orgId}}",
    "tenantId": "{{context.tenantId}}",
    "requestId": "{{context.requestId}}",
    "timestamp": "{{context.startedAt}}",
    "data": "{{step1.data}}"
  }
}
```

**Problem**: Verbose, must map every variable explicitly

### With Inheritance (Implicit Access)

```json
{
  "id": "process_data",
  "type": "sub_workflow",
  "workflowSteps": [
    {
      "id": "log_processing",
      "type": "action",
      "plugin": "logger",
      "action": "log",
      "params": {
        "message": "Processing data",
        "userId": "{{userId}}",
        "sessionId": "{{sessionId}}",
        "orgId": "{{orgId}}",
        "data": "{{data}}"
      }
    }
  ],
  "inputs": {
    "data": "{{step1.data}}"
  },
  "inheritContext": true
}
```

**Benefits**:
- ✅ Concise input mapping
- ✅ Access to all parent variables
- ✅ Explicit inputs take precedence
- ✅ Useful for logging, auditing, context propagation

---

## 5. Error Handling Strategies

### Strategy A: `throw` (Critical Sub-Workflows)

```json
{
  "workflow_steps": [
    {
      "id": "process_payment",
      "name": "Process Payment",
      "type": "sub_workflow",
      "workflowId": "payment-processing",
      "inputs": {
        "orderId": "{{create_order.data.id}}",
        "amount": "{{create_order.data.total}}"
      },
      "onError": "throw",
      "timeout": 30000,
      "dependencies": ["create_order"]
    },
    {
      "id": "fulfill_order",
      "name": "Fulfill Order",
      "type": "action",
      "plugin": "fulfillment",
      "action": "fulfill",
      "params": {
        "orderId": "{{create_order.data.id}}"
      },
      "dependencies": ["process_payment"]
    }
  ]
}
```

**Behavior**: If payment fails, entire workflow halts. Order is not fulfilled.

### Strategy B: `continue` (Optional Sub-Workflows)

```json
{
  "workflow_steps": [
    {
      "id": "create_order",
      "type": "action",
      "plugin": "orders",
      "action": "create",
      "params": {...}
    },
    {
      "id": "enrich_with_recommendations",
      "name": "Add Product Recommendations",
      "type": "sub_workflow",
      "workflowId": "recommendation-engine",
      "inputs": {
        "customerId": "{{create_order.data.customer_id}}",
        "items": "{{create_order.data.items}}"
      },
      "onError": "continue",
      "timeout": 5000,
      "dependencies": ["create_order"]
    },
    {
      "id": "send_confirmation",
      "name": "Send Order Confirmation",
      "type": "action",
      "plugin": "email",
      "action": "send",
      "params": {
        "to": "{{create_order.data.customer_email}}",
        "template": "order_confirmation",
        "recommendations": "{{enrich_with_recommendations.data}}"
      },
      "dependencies": ["enrich_with_recommendations"]
    }
  ]
}
```

**Behavior**: If recommendations fail, workflow continues. Email may not have recommendations.

### Strategy C: `return_error` (Conditional Logic)

```json
{
  "workflow_steps": [
    {
      "id": "validate_user",
      "name": "Validate User Permissions",
      "type": "sub_workflow",
      "workflowSteps": [
        {
          "id": "check_permissions",
          "type": "action",
          "plugin": "auth",
          "action": "check_permissions",
          "params": {
            "userId": "{{userId}}",
            "resource": "{{resource}}",
            "action": "{{action}}"
          }
        },
        {
          "id": "validate_result",
          "type": "validation",
          "input": "{{check_permissions.data}}",
          "rules": [
            {
              "field": "allowed",
              "condition": { "operator": "equals", "value": true },
              "message": "User does not have permission"
            }
          ],
          "dependencies": ["check_permissions"]
        }
      ],
      "inputs": {
        "userId": "{{inputs.userId}}",
        "resource": "{{inputs.resource}}",
        "action": "{{inputs.action}}"
      },
      "onError": "return_error"
    },
    {
      "id": "check_validation",
      "name": "Check if Validation Passed",
      "type": "conditional",
      "condition": {
        "field": "{{validate_user.data.error}}",
        "operator": "not_exists"
      },
      "trueBranch": "proceed_with_action",
      "falseBranch": "return_unauthorized",
      "dependencies": ["validate_user"]
    },
    {
      "id": "proceed_with_action",
      "name": "Execute Authorized Action",
      "type": "action",
      "plugin": "business_logic",
      "action": "execute",
      "params": {...},
      "executeIf": {
        "field": "{{validate_user.data.error}}",
        "operator": "not_exists"
      }
    },
    {
      "id": "return_unauthorized",
      "name": "Return Unauthorized Error",
      "type": "action",
      "plugin": "http",
      "action": "respond",
      "params": {
        "status": 403,
        "body": {
          "error": "Unauthorized",
          "details": "{{validate_user.data.error}}"
        }
      },
      "executeIf": {
        "field": "{{validate_user.data.error}}",
        "operator": "exists"
      }
    }
  ]
}
```

**Behavior**: Validation failure captured in output, workflow branches based on result.

---

## 6. Timeout Protection

**Use Case**: Prevent long-running external service calls from blocking workflow

```json
{
  "workflow_steps": [
    {
      "id": "fetch_from_external_api",
      "name": "Fetch Data from External API",
      "type": "sub_workflow",
      "workflowSteps": [
        {
          "id": "api_call",
          "type": "action",
          "plugin": "http",
          "action": "get",
          "params": {
            "url": "https://slow-external-api.com/data",
            "timeout": 25000
          }
        },
        {
          "id": "transform_response",
          "type": "transform",
          "operation": "map",
          "input": "{{api_call.data}}",
          "expression": "{id: item.id, value: item.result}",
          "dependencies": ["api_call"]
        }
      ],
      "inputs": {
        "apiKey": "{{inputs.apiKey}}"
      },
      "timeout": 30000,
      "onError": "return_error"
    },
    {
      "id": "check_timeout",
      "name": "Check if API Call Succeeded",
      "type": "conditional",
      "condition": {
        "field": "{{fetch_from_external_api.data.error}}",
        "operator": "contains",
        "value": "timeout"
      },
      "trueBranch": "use_cached_data",
      "falseBranch": "use_fresh_data",
      "dependencies": ["fetch_from_external_api"]
    },
    {
      "id": "use_cached_data",
      "name": "Fallback to Cached Data",
      "type": "action",
      "plugin": "cache",
      "action": "get",
      "params": {
        "key": "external_api_cache"
      },
      "executeIf": {
        "field": "{{fetch_from_external_api.data.error}}",
        "operator": "contains",
        "value": "timeout"
      }
    },
    {
      "id": "use_fresh_data",
      "name": "Use Fresh API Data",
      "type": "transform",
      "operation": "identity",
      "input": "{{fetch_from_external_api.data}}",
      "executeIf": {
        "field": "{{fetch_from_external_api.data.error}}",
        "operator": "not_exists"
      }
    }
  ]
}
```

**Error Output on Timeout**:
```json
{
  "fetch_from_external_api": {
    "data": {
      "error": "Sub-workflow timeout after 30000ms"
    },
    "metadata": {
      "success": false,
      "error": "Sub-workflow timeout after 30000ms"
    }
  }
}
```

---

## 7. Nested Sub-Workflows

**Use Case**: Complex multi-level business process

```json
{
  "agent_name": "E-Commerce Order Fulfillment",
  "workflow_steps": [
    {
      "id": "receive_order",
      "type": "action",
      "plugin": "orders",
      "action": "create",
      "params": {...}
    },
    {
      "id": "fulfill_order",
      "name": "Complete Order Fulfillment",
      "type": "sub_workflow",
      "workflowSteps": [
        {
          "id": "payment_processing",
          "name": "Process Payment",
          "type": "sub_workflow",
          "workflowSteps": [
            {
              "id": "validate_card",
              "type": "action",
              "plugin": "payment",
              "action": "validate_card",
              "params": {
                "cardNumber": "{{paymentInfo.card_number}}"
              }
            },
            {
              "id": "charge_card",
              "type": "action",
              "plugin": "payment",
              "action": "charge",
              "params": {
                "amount": "{{amount}}",
                "cardNumber": "{{paymentInfo.card_number}}"
              },
              "dependencies": ["validate_card"]
            },
            {
              "id": "send_receipt",
              "type": "action",
              "plugin": "email",
              "action": "send",
              "params": {
                "to": "{{customerEmail}}",
                "template": "payment_receipt",
                "transactionId": "{{charge_card.data.transaction_id}}"
              },
              "dependencies": ["charge_card"]
            }
          ],
          "inputs": {
            "paymentInfo": "{{paymentInfo}}",
            "amount": "{{orderTotal}}",
            "customerEmail": "{{customerEmail}}"
          },
          "outputMapping": {
            "transactionId": "{{charge_card.data.transaction_id}}",
            "receiptSent": "{{send_receipt.data.success}}"
          },
          "timeout": 30000
        },
        {
          "id": "inventory_management",
          "name": "Allocate Inventory",
          "type": "sub_workflow",
          "workflowSteps": [
            {
              "id": "check_availability",
              "type": "action",
              "plugin": "inventory",
              "action": "check_stock",
              "params": {
                "items": "{{orderItems}}"
              }
            },
            {
              "id": "reserve_items",
              "type": "action",
              "plugin": "inventory",
              "action": "reserve",
              "params": {
                "items": "{{orderItems}}",
                "orderId": "{{orderId}}"
              },
              "dependencies": ["check_availability"]
            }
          ],
          "inputs": {
            "orderItems": "{{orderItems}}",
            "orderId": "{{orderId}}"
          },
          "outputMapping": {
            "reservationId": "{{reserve_items.data.reservation_id}}"
          },
          "dependencies": ["payment_processing"]
        },
        {
          "id": "shipping",
          "name": "Schedule Shipping",
          "type": "sub_workflow",
          "workflowSteps": [
            {
              "id": "calculate_shipping",
              "type": "action",
              "plugin": "shipping",
              "action": "calculate",
              "params": {
                "items": "{{orderItems}}",
                "address": "{{shippingAddress}}"
              }
            },
            {
              "id": "create_shipment",
              "type": "action",
              "plugin": "shipping",
              "action": "create",
              "params": {
                "orderId": "{{orderId}}",
                "items": "{{orderItems}}",
                "address": "{{shippingAddress}}",
                "method": "{{calculate_shipping.data.recommended_method}}"
              },
              "dependencies": ["calculate_shipping"]
            },
            {
              "id": "notify_warehouse",
              "type": "action",
              "plugin": "warehouse",
              "action": "queue_pick",
              "params": {
                "shipmentId": "{{create_shipment.data.shipment_id}}"
              },
              "dependencies": ["create_shipment"]
            }
          ],
          "inputs": {
            "orderItems": "{{orderItems}}",
            "orderId": "{{orderId}}",
            "shippingAddress": "{{shippingAddress}}"
          },
          "outputMapping": {
            "shipmentId": "{{create_shipment.data.shipment_id}}",
            "trackingNumber": "{{create_shipment.data.tracking_number}}"
          },
          "dependencies": ["inventory_management"]
        }
      ],
      "inputs": {
        "orderId": "{{receive_order.data.id}}",
        "orderItems": "{{receive_order.data.items}}",
        "orderTotal": "{{receive_order.data.total}}",
        "paymentInfo": "{{receive_order.data.payment}}",
        "shippingAddress": "{{receive_order.data.shipping_address}}",
        "customerEmail": "{{receive_order.data.customer_email}}"
      },
      "outputMapping": {
        "transactionId": "{{payment_processing.data.transactionId}}",
        "trackingNumber": "{{shipping.data.trackingNumber}}"
      },
      "dependencies": ["receive_order"]
    },
    {
      "id": "send_confirmation",
      "type": "action",
      "plugin": "email",
      "action": "send",
      "params": {
        "to": "{{receive_order.data.customer_email}}",
        "template": "order_confirmation",
        "data": {
          "orderId": "{{receive_order.data.id}}",
          "trackingNumber": "{{fulfill_order.data.trackingNumber}}"
        }
      },
      "dependencies": ["fulfill_order"]
    }
  ]
}
```

**Nesting Structure**:
```
Main Workflow
  └─ fulfill_order (Sub-Workflow Level 1)
      ├─ payment_processing (Sub-Workflow Level 2)
      │   ├─ validate_card (Action)
      │   ├─ charge_card (Action)
      │   └─ send_receipt (Action)
      ├─ inventory_management (Sub-Workflow Level 2)
      │   ├─ check_availability (Action)
      │   └─ reserve_items (Action)
      └─ shipping (Sub-Workflow Level 2)
          ├─ calculate_shipping (Action)
          ├─ create_shipment (Action)
          └─ notify_warehouse (Action)
```

**Benefits**:
- ✅ Clear separation of concerns
- ✅ Each sub-process is independently testable
- ✅ Error boundaries at each level
- ✅ Easy to add/remove/modify sub-processes

---

## 8. Parallel Sub-Workflows

**Use Case**: Execute multiple independent sub-workflows simultaneously

```json
{
  "workflow_steps": [
    {
      "id": "fetch_user_data",
      "type": "action",
      "plugin": "database",
      "action": "query",
      "params": {
        "table": "users",
        "filter": { "id": "{{inputs.userId}}" }
      }
    },
    {
      "id": "enrich_parallel",
      "name": "Parallel Data Enrichment",
      "type": "parallel_group",
      "steps": [
        {
          "id": "enrich_financial",
          "name": "Financial Data Enrichment",
          "type": "sub_workflow",
          "workflowId": "financial-enrichment-v2",
          "inputs": {
            "userId": "{{fetch_user_data.data.id}}",
            "accountNumber": "{{fetch_user_data.data.account_number}}"
          },
          "timeout": 10000,
          "onError": "continue"
        },
        {
          "id": "enrich_social",
          "name": "Social Profile Enrichment",
          "type": "sub_workflow",
          "workflowId": "social-enrichment-v1",
          "inputs": {
            "userId": "{{fetch_user_data.data.id}}",
            "socialProfiles": "{{fetch_user_data.data.social_links}}"
          },
          "timeout": 10000,
          "onError": "continue"
        },
        {
          "id": "enrich_behavioral",
          "name": "Behavioral Analytics Enrichment",
          "type": "sub_workflow",
          "workflowId": "behavioral-analytics-v3",
          "inputs": {
            "userId": "{{fetch_user_data.data.id}}",
            "since": "{{inputs.analyticsStartDate}}"
          },
          "timeout": 15000,
          "onError": "continue"
        }
      ],
      "dependencies": ["fetch_user_data"]
    },
    {
      "id": "merge_enrichments",
      "name": "Merge All Enrichment Data",
      "type": "enrichment",
      "sources": [
        { "key": "base", "from": "{{fetch_user_data.data}}" },
        { "key": "financial", "from": "{{enrich_financial.data}}" },
        { "key": "social", "from": "{{enrich_social.data}}" },
        { "key": "behavioral", "from": "{{enrich_behavioral.data}}" }
      ],
      "strategy": "deep_merge",
      "dependencies": ["enrich_parallel"]
    }
  ]
}
```

**Execution Timeline**:
```
Time (ms)
0    ──┐ fetch_user_data (100ms)
     │
100  ├─┬─ enrich_financial (8000ms)
     │ ├─ enrich_social (5000ms)
     │ └─ enrich_behavioral (12000ms)
     │
12100├── All parallel enrichments complete
     │
12150└── merge_enrichments (50ms)
```

**Total Time**: ~12.2 seconds (vs ~25.1 seconds sequential)

---

## 9. Conditional Sub-Workflows

**Use Case**: Execute different sub-workflows based on conditions

```json
{
  "workflow_steps": [
    {
      "id": "assess_complexity",
      "name": "Assess Request Complexity",
      "type": "llm_decision",
      "prompt": "Assess the complexity of this request: {{inputs.userRequest}}. Respond with 'simple', 'moderate', or 'complex'.",
      "params": {
        "model": "gpt-4",
        "temperature": 0
      }
    },
    {
      "id": "route_by_complexity",
      "name": "Route Based on Complexity",
      "type": "switch",
      "evaluate": "{{assess_complexity.data.decision}}",
      "cases": {
        "simple": ["process_simple"],
        "moderate": ["process_moderate"],
        "complex": ["process_complex"]
      },
      "default": ["process_moderate"],
      "dependencies": ["assess_complexity"]
    },
    {
      "id": "process_simple",
      "name": "Simple Request Processing",
      "type": "sub_workflow",
      "workflowSteps": [
        {
          "id": "quick_lookup",
          "type": "action",
          "plugin": "database",
          "action": "query",
          "params": {
            "table": "faq",
            "filter": { "question": "{{userRequest}}" }
          }
        },
        {
          "id": "format_response",
          "type": "transform",
          "operation": "map",
          "input": "{{quick_lookup.data}}",
          "expression": "{answer: item.answer, confidence: 0.95}",
          "dependencies": ["quick_lookup"]
        }
      ],
      "inputs": {
        "userRequest": "{{inputs.userRequest}}"
      },
      "executeIf": {
        "field": "{{assess_complexity.data.decision}}",
        "operator": "equals",
        "value": "simple"
      }
    },
    {
      "id": "process_moderate",
      "name": "Moderate Request Processing",
      "type": "sub_workflow",
      "workflowId": "moderate-request-handler",
      "inputs": {
        "userRequest": "{{inputs.userRequest}}",
        "context": "{{inputs.context}}"
      },
      "timeout": 30000,
      "executeIf": {
        "field": "{{assess_complexity.data.decision}}",
        "operator": "equals",
        "value": "moderate"
      }
    },
    {
      "id": "process_complex",
      "name": "Complex Request Processing",
      "type": "sub_workflow",
      "workflowId": "complex-request-handler",
      "inputs": {
        "userRequest": "{{inputs.userRequest}}",
        "context": "{{inputs.context}}",
        "history": "{{inputs.conversationHistory}}"
      },
      "timeout": 60000,
      "executeIf": {
        "field": "{{assess_complexity.data.decision}}",
        "operator": "equals",
        "value": "complex"
      }
    }
  ]
}
```

**Execution Flow**:
```
User Request
    ↓
LLM assesses complexity
    ↓
    ├─ "simple" → process_simple (inline, 100ms)
    ├─ "moderate" → process_moderate (database, 5s)
    └─ "complex" → process_complex (database, 15s)
    ↓
Return result
```

---

## 10. Real-World Use Cases

### Use Case A: Multi-Tenant Data Processing

```json
{
  "agent_name": "Multi-Tenant Report Generator",
  "workflow_steps": [
    {
      "id": "get_tenants",
      "type": "action",
      "plugin": "database",
      "action": "query",
      "params": {
        "table": "tenants",
        "filter": { "active": true }
      }
    },
    {
      "id": "process_tenants",
      "type": "scatter_gather",
      "scatter": {
        "input": "{{get_tenants.data}}",
        "steps": [
          {
            "id": "process_tenant",
            "type": "sub_workflow",
            "workflowId": "tenant-report-generator",
            "inputs": {
              "tenantId": "{{item.id}}",
              "tenantName": "{{item.name}}",
              "reportDate": "{{inputs.reportDate}}"
            },
            "timeout": 120000,
            "onError": "continue",
            "inheritContext": true
          }
        ],
        "maxConcurrency": 3
      },
      "gather": {
        "operation": "collect"
      },
      "dependencies": ["get_tenants"]
    },
    {
      "id": "aggregate_reports",
      "type": "transform",
      "operation": "reduce",
      "input": "{{process_tenants.data}}",
      "expression": "aggregate all tenant metrics",
      "dependencies": ["process_tenants"]
    }
  ]
}
```

### Use Case B: Approval Workflow with Escalation

```json
{
  "workflow_steps": [
    {
      "id": "request_approval",
      "type": "sub_workflow",
      "name": "Request Manager Approval",
      "workflowId": "approval-request",
      "inputs": {
        "requestId": "{{inputs.requestId}}",
        "requestType": "expense",
        "amount": "{{inputs.amount}}",
        "approverId": "{{inputs.managerId}}"
      },
      "timeout": 86400000,
      "onError": "return_error"
    },
    {
      "id": "check_approval",
      "type": "conditional",
      "condition": {
        "field": "{{request_approval.data.approved}}",
        "operator": "equals",
        "value": true
      },
      "trueBranch": "process_approved",
      "falseBranch": "escalate_to_director",
      "dependencies": ["request_approval"]
    },
    {
      "id": "escalate_to_director",
      "type": "sub_workflow",
      "name": "Escalate to Director",
      "workflowId": "approval-request",
      "inputs": {
        "requestId": "{{inputs.requestId}}",
        "requestType": "expense_escalated",
        "amount": "{{inputs.amount}}",
        "approverId": "{{inputs.directorId}}",
        "escalatedFrom": "{{inputs.managerId}}"
      },
      "timeout": 86400000,
      "executeIf": {
        "field": "{{request_approval.data.approved}}",
        "operator": "not_equals",
        "value": true
      }
    }
  ]
}
```

---

## 🧪 Testing Sub-Workflows

### Test 1: Inline Sub-Workflow

```bash
curl -X POST http://localhost:3000/api/run-agent \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "sub-workflow-test",
    "inputs": {
      "testData": "value"
    }
  }'
```

### Test 2: Database-Loaded Sub-Workflow

```bash
# First create the reusable workflow
curl -X POST http://localhost:3000/api/agents \
  -H "Content-Type: application/json" \
  -d '{
    "agent_name": "Reusable Data Processor",
    "workflow_steps": [...]
  }'

# Then use it in a parent workflow
curl -X POST http://localhost:3000/api/run-agent \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "parent-workflow",
    "inputs": {...}
  }'
```

### Test 3: Error Handling

```json
{
  "id": "test_error_handling",
  "type": "sub_workflow",
  "workflowSteps": [
    {
      "id": "fail_step",
      "type": "action",
      "plugin": "test",
      "action": "simulate_error",
      "params": {
        "errorType": "validation"
      }
    }
  ],
  "inputs": {},
  "onError": "return_error"
}
```

---

## 📊 Performance Comparison

### Sequential vs Sub-Workflow with Parallel Groups

**Sequential Approach** (No Sub-Workflows):
```
Total Time: 45 seconds
Complexity: High
Maintainability: Low
```

**Sub-Workflow Approach** (With Parallel Execution):
```
Total Time: 18 seconds (60% faster)
Complexity: Low (modular)
Maintainability: High (reusable components)
```

---

## 🎯 Best Practices

1. **Use Database-Loaded Sub-Workflows for Reusability**
   - Store common workflows once
   - Update centrally
   - Version control via database

2. **Set Appropriate Timeouts**
   - External API calls: 10-30s
   - Database operations: 5-15s
   - Complex processing: 30-120s

3. **Choose Error Strategies Wisely**
   - `throw`: Critical operations
   - `continue`: Optional enrichments
   - `return_error`: Validation checks

4. **Map Only Required Outputs**
   - Don't map everything
   - Map only what parent needs
   - Reduces context size

5. **Use Context Inheritance Sparingly**
   - Prefer explicit mapping
   - Use only when many variables needed
   - Be aware of variable shadowing

---

**Phase 5 Examples Complete**
*Last Updated: November 2, 2025*
