/**
 * Production-Like Workflow Execution Test
 *
 * This script demonstrates the workflow execution through the real pipeline:
 * 1. Store workflow in agent table (as production does)
 * 2. Execute through WorkflowPilot (as production does)
 * 3. Capture all logs and issues
 * 4. Verify gather collection works with "from" field
 */

import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import type { WorkflowStep } from '@/lib/pilot/types/pilot-dsl-types'

// Load .env.local
config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

const workflowSteps: WorkflowStep[] = [
  {
    "id": "step1",
    "step_id": "step1",
    "name": "Fetch Data Using Google-mail",
    "type": "action",
    "output_variable": "emails_result",
    "description": "Fetch data using google-mail",
    "plugin": "google-mail",
    "action": "search_emails",
    "params": {
      "query": "is:unread has:attachment",
      "include_attachments": true
    }
  },
  {
    "id": "step2",
    "step_id": "step2",
    "name": "Deliver Using Google-drive",
    "type": "action",
    "output_variable": "drive_folder",
    "description": "Deliver using google-drive",
    "plugin": "google-drive",
    "action": "create_folder",
    "params": {
      "folder_name": "Email Attachments - Expenses"
    }
  },
  {
    "id": "step3",
    "step_id": "step3",
    "name": "Loop Over Emails_result",
    "type": "scatter_gather",
    "output_variable": "all_transactions",
    "description": "Loop over emails_result",
    "scatter": {
      "input": "{{emails_result.emails}}",
      "itemVariable": "current_email",
      "steps": [
        {
          "id": "step4",
          "step_id": "step4",
          "name": "Loop Over Current_email",
          "type": "scatter_gather",
          "output_variable": "email_transactions",
          "description": "Loop over current_email",
          "scatter": {
            "input": "{{current_email.attachments}}",
            "itemVariable": "current_attachment",
            "steps": [
              {
                "id": "step5",
                "step_id": "step5",
                "name": "Fetch Data Using Google-mail",
                "type": "action",
                "output_variable": "attachment_content",
                "description": "Fetch data using google-mail",
                "plugin": "google-mail",
                "action": "get_email_attachment",
                "params": {
                  "message_id": "{{current_email.id}}",
                  "attachment_id": "{{current_attachment.attachment_id}}"
                }
              },
              {
                "id": "step6",
                "step_id": "step6",
                "name": "Conditional",
                "type": "conditional",
                "description": "Conditional: check_attachment_type",
                "condition": {
                  "conditionType": "complex_or",
                  "conditions": [
                    {
                      "conditionType": "simple",
                      "field": "attachment_content.mimeType",
                      "operator": "equals",
                      "value": "application/pdf"
                    },
                    {
                      "conditionType": "simple",
                      "field": "attachment_content.mimeType",
                      "operator": "contains",
                      "value": "image/"
                    }
                  ]
                },
                "then": [
                  {
                    "id": "step7",
                    "step_id": "step7",
                    "name": "Deliver Using Google-drive",
                    "type": "action",
                    "output_variable": "uploaded_file",
                    "description": "Deliver using google-drive",
                    "plugin": "google-drive",
                    "action": "upload_file",
                    "params": {
                      "file_content": "{{attachment_content.data}}",
                      "file_name": "{{attachment_content.filename}}",
                      "folder_id": "{{drive_folder.folder_id}}",
                      "mime_type": "{{attachment_content.mimeType}}"
                    }
                  },
                  {
                    "id": "step8",
                    "step_id": "step8",
                    "name": "AI",
                    "type": "ai_processing",
                    "output_variable": "extracted_data",
                    "description": "AI: extract",
                    "input": "{{attachment_content.data}}",
                    "prompt": "Extract standard transaction fields from this attachment content. Look for: date of transaction, vendor/merchant name, total amount (numeric), currency (e.g. USD, EUR), and invoice or receipt number. If you cannot confidently determine the amount, set amount to null and set amount_missing to true. Extract all fields you can find even if some are missing.",
                    "config": {
                      "ai_type": "extract",
                      "output_schema": {
                        "type": "object",
                        "properties": {
                          "date": {
                            "type": "string",
                            "description": "Date of the transaction (ISO format or as found in document)"
                          },
                          "vendor": {
                            "type": "string",
                            "description": "Vendor or merchant name"
                          },
                          "amount": {
                            "type": "number",
                            "description": "Total transaction amount as a number. Null if not found."
                          },
                          "currency": {
                            "type": "string",
                            "description": "Currency code (e.g. USD, EUR). Default to USD if not specified."
                          },
                          "invoice_receipt_number": {
                            "type": "string",
                            "description": "Invoice number or receipt number"
                          },
                          "amount_missing": {
                            "type": "boolean",
                            "description": "True if the amount could not be confidently extracted"
                          }
                        },
                        "required": [
                          "date",
                          "vendor",
                          "amount",
                          "currency",
                          "invoice_receipt_number",
                          "amount_missing"
                        ]
                      },
                      "temperature": 0
                    }
                  },
                  {
                    "id": "step9",
                    "step_id": "step9",
                    "name": "AI",
                    "type": "ai_processing",
                    "output_variable": "transaction_record",
                    "description": "AI: generate",
                    "input": "Extracted data: {{extracted_data}}. Drive link: {{uploaded_file.web_view_link}}. Filename: {{attachment_content.filename}}. Source email from: {{current_email.from}}. Source email subject: {{current_email.subject}}. Source email date: {{current_email.date}}. Email ID: {{current_email.id}}.",
                    "prompt": "Combine the extracted transaction data with the provided metadata into a single structured transaction record. Output all fields exactly as provided. Do not modify any values, just merge them into one JSON object.",
                    "config": {
                      "ai_type": "generate",
                      "output_schema": {
                        "type": "object",
                        "properties": {
                          "date": {
                            "type": "string",
                            "description": "Transaction date"
                          },
                          "vendor": {
                            "type": "string",
                            "description": "Vendor name"
                          },
                          "amount": {
                            "type": "number",
                            "description": "Transaction amount"
                          },
                          "currency": {
                            "type": "string",
                            "description": "Currency code"
                          },
                          "invoice_receipt_number": {
                            "type": "string",
                            "description": "Invoice or receipt number"
                          },
                          "amount_missing": {
                            "type": "boolean",
                            "description": "True if amount was not found"
                          },
                          "drive_link": {
                            "type": "string",
                            "description": "Google Drive web view link for the uploaded file"
                          },
                          "filename": {
                            "type": "string",
                            "description": "Original attachment filename"
                          },
                          "source_email_from": {
                            "type": "string",
                            "description": "Sender of the source email"
                          },
                          "source_email_subject": {
                            "type": "string",
                            "description": "Subject of the source email"
                          },
                          "source_email_date": {
                            "type": "string",
                            "description": "Date of the source email"
                          },
                          "source_email_id": {
                            "type": "string",
                            "description": "Gmail message ID of the source email"
                          }
                        },
                        "required": [
                          "date",
                          "vendor",
                          "amount",
                          "currency",
                          "invoice_receipt_number",
                          "amount_missing",
                          "drive_link",
                          "filename",
                          "source_email_from",
                          "source_email_subject",
                          "source_email_date",
                          "source_email_id"
                        ]
                      },
                      "temperature": 0
                    }
                  },
                  {
                    "id": "step10",
                    "step_id": "step10",
                    "name": "Conditional",
                    "type": "conditional",
                    "description": "Conditional: check_amount_for_sheets",
                    "condition": {
                      "conditionType": "complex_and",
                      "conditions": [
                        {
                          "conditionType": "simple",
                          "field": "transaction_record.amount_missing",
                          "operator": "equals",
                          "value": false
                        },
                        {
                          "conditionType": "simple",
                          "field": "transaction_record.amount",
                          "operator": "greater_than",
                          "value": 50
                        }
                      ]
                    },
                    "then": [
                      {
                        "id": "step11",
                        "step_id": "step11",
                        "name": "Deliver Using Google-sheets",
                        "type": "action",
                        "description": "Deliver using google-sheets",
                        "plugin": "google-sheets",
                        "action": "append_rows",
                        "params": {
                          "spreadsheet_id": "1pM8WbXtPgaYqokHn_spgQAfR7SBuql3JUtE1ugDtOpc",
                          "range": "Expenses",
                          "values": [
                            [
                              "{{transaction_record.date}}",
                              "{{transaction_record.vendor}}",
                              "{{transaction_record.amount}}",
                              "{{transaction_record.currency}}",
                              "{{transaction_record.invoice_receipt_number}}",
                              "{{transaction_record.drive_link}}",
                              "{{transaction_record.source_email_from}}",
                              "{{transaction_record.source_email_subject}}"
                            ]
                          ]
                        }
                      }
                    ]
                  }
                ]
              }
            ]
          },
          "gather": {
            "operation": "collect",
            "outputKey": "email_transactions"
            // ❌ MISSING: "from": "transaction_record"
          }
        }
      ]
    },
    "gather": {
      "operation": "collect",
      "outputKey": "all_transactions"
      // ❌ MISSING: "from": "email_transactions"
    }
  },
  {
    "id": "step12",
    "step_id": "step12",
    "name": "Transform",
    "type": "transform",
    "output_variable": "all_transactions",
    "description": "Transform: flatten",
    "operation": "flatten",
    "input": "{{all_transactions}}",
    "config": {}
  },
  {
    "id": "step13",
    "step_id": "step13",
    "name": "Transform",
    "type": "transform",
    "output_variable": "high_value_transactions",
    "description": "Transform: filter",
    "operation": "filter",
    "input": "{{all_transactions}}",
    "config": {
      "filter_expression": {
        "type": "complex",
        "operator": "and",
        "conditions": [
          {
            "type": "simple",
            "variable": "item.amount_missing",
            "operator": "eq",
            "value": false
          },
          {
            "type": "simple",
            "variable": "item.amount",
            "operator": "gt",
            "value": 50
          }
        ]
      }
    }
  },
  {
    "id": "step14",
    "step_id": "step14",
    "name": "AI",
    "type": "ai_processing",
    "output_variable": "summary_email_content",
    "description": "AI: generate",
    "input": "All transactions: {{all_transactions}}. High value transactions (amount > $50): {{high_value_transactions}}.",
    "prompt": "Generate a comprehensive HTML-formatted summary email for expense tracking. The email must include ALL of the following sections:\n\n1. **All Transactions Table**: An HTML table listing EVERY transaction (including those with amount <= $50). Columns: Date, Vendor, Amount, Currency, Invoice/Receipt #, Google Drive Link (as clickable hyperlink), Source Email (sender + subject).\n\n2. **Over $50 Transactions Section**: A separate HTML table listing ONLY transactions where amount > $50. Same columns as above.\n\n3. **Totals Summary Section**: Include:\n   - Total number of transactions extracted\n   - Sum of all transaction amounts\n   - Sum of amounts for transactions > $50\n   - Number of transactions > $50\n   - Number of transactions <= $50\n\n4. **Skipped Attachments Section**: List any attachments where amount_missing is true. For each, show: filename, source email sender, source email subject, and Google Drive link. If none were skipped, state 'No attachments were skipped.'\n\nMake the email professional, well-formatted with clear section headers. Use HTML tables with borders for readability. All Drive links must be clickable hyperlinks.",
    "config": {
      "ai_type": "generate",
      "output_schema": {
        "type": "object",
        "properties": {
          "summary_email_html": {
            "type": "string",
            "description": "Complete HTML email body with all required sections: all transactions table, over-$50 table, totals summary, skipped attachments notes, Drive links, and source email info"
          },
          "subject_line": {
            "type": "string",
            "description": "Email subject line summarizing the processing results"
          }
        },
        "required": [
          "summary_email_html",
          "subject_line"
        ]
      },
      "temperature": 0.3
    }
  },
  {
    "id": "step15",
    "step_id": "step15",
    "name": "Deliver Using Google-mail",
    "type": "action",
    "description": "Deliver using google-mail",
    "plugin": "google-mail",
    "action": "send_email",
    "params": {
      "recipients": {
        "to": [
          "offir.omer@gmail.com"
        ]
      },
      "content": {
        "subject": "{{summary_email_content.subject_line}}",
        "body": "{{summary_email_content.summary_email_html}}",
        "is_html": true
      }
    }
  }
]

async function testProductionExecution() {
  console.log('=== Production Workflow Execution Test ===\n')
  console.log('This test demonstrates the EXACT issue when gather.from is missing:\n')
  console.log('Expected behavior:')
  console.log('  ❌ Inner loop (step4): gather missing "from" → collects 0 items')
  console.log('  ❌ Outer loop (step3): gather missing "from" → collects 0 items')
  console.log('  ❌ all_transactions = [] (empty)')
  console.log('  ❌ Summary email has no data\n')

  const agentId = '43ffbc8a-406d-4a43-9f3f-4e7554160eda'

  try {
    // 1. Use existing agent
    console.log(`Step 1: Using existing agent: ${agentId}`)

    const { data: agent, error: agentError } = await supabase
      .from('agents')
      .select('*')
      .eq('id', agentId)
      .single()

    if (agentError || !agent) {
      console.error('Failed to fetch agent:', agentError)
      return
    }

    console.log(`✅ Agent found: ${agent.name}\n`)
    console.log(`Workflow has ${agent.workflow_steps?.length || 0} steps\n`)

    // 2. Trigger execution through API endpoint
    console.log('Step 2: Executing workflow through production pipeline...')
    console.log('(Making POST request to /api/run-agent-stream)\n')

    const response = await fetch(`http://localhost:3000/api/run-agent-stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        agentId: agent.id,
        inputs: {},
        userId: '08456106-aa50-4810-b12c-7ca84102da31'
      })
    })

    if (!response.ok) {
      console.error('Execution failed:', response.statusText)
      const errorText = await response.text()
      console.error('Error details:', errorText)
      return
    }

    const result = await response.json()

    console.log('=== Execution Complete ===\n')
    console.log(`Status: ${result.status}`)
    console.log(`Execution ID: ${result.execution_id || 'N/A'}\n`)

    // 3. Analyze results
    console.log('=== Results Analysis ===\n')

    const allTransactions = result.final_state?.variables?.all_transactions
    const emailTransactions = result.final_state?.variables?.email_transactions
    const highValueTransactions = result.final_state?.variables?.high_value_transactions

    console.log('Variables in final state:')
    console.log(`  - all_transactions: ${Array.isArray(allTransactions) ? `array with ${allTransactions.length} items` : typeof allTransactions}`)
    console.log(`  - email_transactions: ${Array.isArray(emailTransactions) ? `array with ${emailTransactions.length} items` : typeof emailTransactions}`)
    console.log(`  - high_value_transactions: ${Array.isArray(highValueTransactions) ? `array with ${highValueTransactions.length} items` : typeof highValueTransactions}`)
    console.log('')

    // 4. Check for the bug
    if (Array.isArray(allTransactions) && allTransactions.length === 0) {
      console.log('🔴 BUG CONFIRMED: all_transactions is empty array')
      console.log('   Root cause: gather.from field missing in both loop configurations')
      console.log('   Expected: Should have transaction records with metadata\n')
    } else if (Array.isArray(allTransactions) && allTransactions.length > 0) {
      console.log('✅ all_transactions has data - bug may be fixed!')
      console.log(`   First item: ${JSON.stringify(allTransactions[0], null, 2)}\n`)
    } else {
      console.log(`⚠️ all_transactions is not an array: ${typeof allTransactions}\n`)
    }

    // 5. Check execution logs for gather messages
    console.log('=== Execution Logs (Gather-related) ===\n')

    if (result.logs && result.logs.length > 0) {
      const gatherLogs = result.logs.filter((log: string) =>
        log.toLowerCase().includes('gather') ||
        log.toLowerCase().includes('collect')
      )

      if (gatherLogs.length > 0) {
        gatherLogs.forEach((log: string) => {
          if (log.includes('Gathering 0 items')) {
            console.log(`🔴 ${log}`)
          } else {
            console.log(`📝 ${log}`)
          }
        })
      } else {
        console.log('No gather-related logs found (may be at different log level)')
      }
    }

    console.log('\n=== Expected After Fix ===\n')
    console.log('After applying compiler fix at line 770:')
    console.log('  1. Recompile workflow IR → DSL will have gather.from field')
    console.log('  2. Inner loop gather: "from": "transaction_record"')
    console.log('  3. Outer loop gather: "from": "email_transactions"')
    console.log('  4. all_transactions populated with complete records')
    console.log('  5. Summary email includes Drive links and source email metadata\n')

    // 6. Don't delete the existing agent
    console.log('Note: Agent not deleted (using existing agent)\n')

  } catch (error) {
    console.error('Test failed:', error)
    if (error instanceof Error) {
      console.error('Error details:', error.message)
      console.error('Stack:', error.stack)
    }
  }
}

// Run the test
testProductionExecution()
  .then(() => {
    console.log('=== Test Complete ===')
    process.exit(0)
  })
  .catch(error => {
    console.error('Test error:', error)
    process.exit(1)
  })
