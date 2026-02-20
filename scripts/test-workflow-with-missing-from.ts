/**
 * Test Script: Execute Workflow with Missing "from" Field
 *
 * Purpose: Execute the compiled workflow to capture the exact issue when
 * gather configurations are missing the "from" field.
 *
 * Expected Issue: ParallelExecutor will log "Gathering 0 items" because
 * it doesn't know WHICH variable to collect from each iteration.
 */

import { WorkflowPilot } from '@/lib/pilot/WorkflowPilot'
import { createLogger } from '@/lib/logger'
import type { WorkflowStep } from '@/lib/pilot/types/pilot-dsl-types'

const logger = createLogger({ module: 'Test', service: 'WorkflowMissingFrom' })

const workflow: WorkflowStep[] = [
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
      },
      "condition": {
        "conditionType": "complex_and",
        "conditions": [
          {
            "operator": "eq",
            "value": false,
            "field": "item.amount_missing",
            "conditionType": "simple"
          },
          {
            "operator": "gt",
            "value": 50,
            "field": "item.amount",
            "conditionType": "simple"
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

async function testWorkflowWithMissingFrom() {
  logger.info('=== Starting Workflow Test: Missing "from" Field in Gather ===')
  logger.info('')
  logger.info('Expected Issue:')
  logger.info('  - Inner loop (step4): gather missing "from" field → will collect 0 items')
  logger.info('  - Outer loop (step3): gather missing "from" field → will collect 0 items')
  logger.info('  - Result: all_transactions will be empty array')
  logger.info('  - Summary email will have no data')
  logger.info('')

  const pilot = new WorkflowPilot({ agentId: 'test-missing-from', workflowSteps: workflow })

  try {
    logger.info('Executing workflow...')
    const result = await pilot.execute({})

    logger.info('')
    logger.info('=== Execution Complete ===')
    logger.info(`Status: ${result.status}`)
    logger.info(`Final State:`)
    logger.info(`  - all_transactions: ${JSON.stringify(result.state?.variables?.all_transactions || 'undefined')}`)
    logger.info(`  - email_transactions: ${JSON.stringify(result.state?.variables?.email_transactions || 'undefined')}`)
    logger.info(`  - high_value_transactions: ${JSON.stringify(result.state?.variables?.high_value_transactions || 'undefined')}`)
    logger.info('')

    // Check if arrays are empty
    const allTransactions = result.state?.variables?.all_transactions
    const highValueTransactions = result.state?.variables?.high_value_transactions

    if (Array.isArray(allTransactions) && allTransactions.length === 0) {
      logger.error('❌ BUG CONFIRMED: all_transactions is empty array (should have transaction records)')
      logger.error('   Root cause: gather.from field missing in both loop configurations')
    } else if (Array.isArray(allTransactions)) {
      logger.info(`✅ all_transactions has ${allTransactions.length} items (bug may be fixed!)`)
    } else {
      logger.warn(`⚠️ all_transactions is not an array: ${typeof allTransactions}`)
    }

    if (Array.isArray(highValueTransactions) && highValueTransactions.length === 0) {
      logger.warn('⚠️ high_value_transactions is empty (may be correct if no transactions > $50)')
    } else if (Array.isArray(highValueTransactions)) {
      logger.info(`✅ high_value_transactions has ${highValueTransactions.length} items`)
    }

    logger.info('')
    logger.info('=== Execution Logs ===')
    if (result.logs && result.logs.length > 0) {
      result.logs.forEach(log => {
        // Highlight gather-related logs
        if (log.toLowerCase().includes('gather')) {
          logger.warn(`[LOG] ${log}`)
        } else if (log.toLowerCase().includes('collect')) {
          logger.warn(`[LOG] ${log}`)
        } else {
          logger.info(`[LOG] ${log}`)
        }
      })
    } else {
      logger.info('No logs captured')
    }

    logger.info('')
    logger.info('=== Expected Fix ===')
    logger.info('After applying compiler fix:')
    logger.info('  1. Inner loop gather should have: "from": "transaction_record"')
    logger.info('  2. Outer loop gather should have: "from": "email_transactions"')
    logger.info('  3. all_transactions will be populated with complete records')
    logger.info('  4. Summary email will have all data including Drive links and source email info')

  } catch (error) {
    logger.error('Execution failed:', error)

    if (error instanceof Error) {
      logger.error(`Error message: ${error.message}`)
      logger.error(`Stack trace: ${error.stack}`)
    }
  }
}

// Run the test
testWorkflowWithMissingFrom()
  .then(() => {
    logger.info('')
    logger.info('=== Test Complete ===')
    process.exit(0)
  })
  .catch(error => {
    logger.error('Test failed:', error)
    process.exit(1)
  })
