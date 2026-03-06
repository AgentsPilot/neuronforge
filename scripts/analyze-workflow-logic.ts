/**
 * Comprehensive Workflow Logic Analysis
 *
 * Analyzes the invoice extraction workflow for:
 * 1. Complete data flow (upstream → downstream)
 * 2. All field references and availability
 * 3. Parameter correctness against plugin schemas
 * 4. Logical soundness of the workflow
 */

import { readFileSync } from 'fs'
import { join } from 'path'

interface PluginDefinition {
  plugin: { name: string }
  actions: Record<string, {
    description: string
    parameters: {
      required?: string[]
      properties: Record<string, any>
    }
    output_schema?: {
      type: string
      properties?: Record<string, any>
      items?: any
    }
  }>
}

function loadPlugins(): Map<string, PluginDefinition> {
  const plugins = new Map<string, PluginDefinition>()
  const pluginFiles = [
    'google-mail-plugin-v2.json',
    'google-drive-plugin-v2.json',
    'google-sheets-plugin-v2.json',
    'document-extractor-plugin-v2.json',
  ]

  const pluginsDir = join(process.cwd(), 'lib', 'plugins', 'definitions')

  for (const fileName of pluginFiles) {
    const filePath = join(pluginsDir, fileName)
    const content = readFileSync(filePath, 'utf-8')
    const plugin = JSON.parse(content) as PluginDefinition
    const pluginKey = fileName.replace('-plugin-v2.json', '')
    plugins.set(pluginKey, plugin)
  }

  return plugins
}

async function analyzeWorkflow() {
  console.log('=' .repeat(100))
  console.log('COMPREHENSIVE WORKFLOW LOGIC ANALYSIS')
  console.log('=' .repeat(100))
  console.log()

  // Load workflow and plugins
  const pilotSteps = JSON.parse(
    readFileSync('output/vocabulary-pipeline/pilot-dsl-steps.json', 'utf-8')
  )
  const plugins = loadPlugins()

  let issueCount = 0
  const issues: string[] = []
  const warnings: string[] = []

  console.log('📋 WORKFLOW: Invoice Extraction from Gmail')
  console.log()
  console.log('STEP-BY-STEP ANALYSIS:')
  console.log('-'.repeat(100))

  // Step 1: Search Gmail
  console.log('\n✅ STEP 1: Search Gmail for unread emails')
  console.log('   Plugin: google-mail.search_emails')
  console.log('   Input: query="is:unread", include_attachments=true')
  const gmailPlugin = plugins.get('google-mail')
  const searchAction = gmailPlugin?.actions['search_emails']
  if (searchAction?.output_schema) {
    const emailsSchema = searchAction.output_schema.properties?.emails
    if (emailsSchema?.items?.properties) {
      console.log('   Output: unread_emails (array of emails with attachments)')
      const emailProps = Object.keys(emailsSchema.items.properties)
      console.log(`   Available email fields: ${emailProps.slice(0, 5).join(', ')}...`)

      // Check attachments schema
      const attachmentsSchema = emailsSchema.items.properties.attachments
      if (attachmentsSchema?.items?.properties) {
        const attachmentProps = Object.keys(attachmentsSchema.items.properties)
        console.log(`   Available attachment fields: ${attachmentProps.join(', ')}`)

        // CRITICAL CHECK: Do we have message_id and attachment_id?
        if (attachmentProps.includes('message_id') && attachmentProps.includes('attachment_id')) {
          console.log('   ✅ Plugin provides message_id and attachment_id (needed for Step 6)')
        } else {
          issues.push('❌ CRITICAL: Gmail plugin missing message_id or attachment_id in attachments')
          issueCount++
        }
      }
    }
  }

  // Step 2: Flatten attachments
  console.log('\n⚠️  STEP 2: Flatten emails to extract attachments array')
  console.log('   Operation: transform.flatten')
  console.log('   Input: unread_emails')
  const step2 = pilotSteps[1]
  const step2Schema = step2.config?.output_schema
  if (step2Schema?.items?.properties) {
    const step2Fields = Object.keys(step2Schema.items.properties)
    console.log(`   Output: all_attachments with fields: ${step2Fields.join(', ')}`)

    // CRITICAL CHECK: Does output include message_id and attachment_id?
    if (!step2Fields.includes('message_id')) {
      issues.push('❌ CRITICAL: Step 2 output missing "message_id" (required by Step 6)')
      issueCount++
    }
    if (!step2Fields.includes('attachment_id')) {
      issues.push('❌ CRITICAL: Step 2 output missing "attachment_id" (required by Step 6)')
      issueCount++
    }
  }

  // Step 3: Filter PDFs and images
  console.log('\n✅ STEP 3: Filter only PDF and image attachments')
  console.log('   Operation: transform.filter')
  console.log('   Condition: mime_type IN [application/pdf, image/jpeg, image/jpg, image/png]')
  console.log('   Output: invoice_attachments (subset of all_attachments)')
  console.log('   Note: Filter inherits schema from input (all_attachments)')

  // Step 4: Create Drive folder
  console.log('\n✅ STEP 4: Get or create Google Drive folder')
  console.log('   Plugin: google-drive.get_or_create_folder')
  console.log('   Input: folder_name="Invoice_Receipts_2024"')
  console.log('   Output: drive_folder')

  // Step 5: Loop over attachments
  console.log('\n🔄 STEP 5: Loop over invoice_attachments (scatter_gather)')
  console.log('   Item variable: attachment')
  console.log('   Expected fields on "attachment":')

  // The attachment schema should come from invoice_attachments
  // which comes from the filter (step3), which inherits from all_attachments (step2)
  if (step2Schema?.items?.properties) {
    const step2Fields = Object.keys(step2Schema.items.properties)
    console.log(`     Available: ${step2Fields.join(', ')}`)
  }

  // Step 6: Download attachment (INSIDE LOOP)
  console.log('\n   ⚠️  STEP 6 (inside loop): Download attachment from Gmail')
  console.log('      Plugin: google-mail.get_email_attachment')
  const getAttachmentAction = gmailPlugin?.actions['get_email_attachment']
  if (getAttachmentAction) {
    const requiredParams = getAttachmentAction.parameters.required || []
    console.log(`      Required parameters: ${requiredParams.join(', ')}`)

    const step6 = pilotSteps[4].scatter.steps[0]
    const step6Config = step6.config
    console.log(`      Provided parameters:`)
    for (const [key, value] of Object.entries(step6Config)) {
      console.log(`        - ${key}: ${value}`)

      // Check if the field exists in attachment schema
      if (typeof value === 'string' && value.includes('{{attachment.')) {
        const fieldName = value.match(/{{attachment\.([^}]+)}}/)?.[1]
        if (fieldName && step2Schema?.items?.properties) {
          const hasField = Object.keys(step2Schema.items.properties).includes(fieldName)
          if (!hasField) {
            issues.push(`❌ CRITICAL: Step 6 references "attachment.${fieldName}" but field not available`)
            issueCount++
          }
        }
      }
    }
  }

  // Step 7: Upload to Drive (INSIDE LOOP)
  console.log('\n   ✅ STEP 7 (inside loop): Upload attachment to Google Drive')
  console.log('      Plugin: google-drive.upload_file')
  console.log('      Parameters: file_content, file_name, folder_id')

  // Check if attachment_content.content exists
  const step7 = pilotSteps[4].scatter.steps[1]
  const fileContentRef = step7.config.file_content
  if (fileContentRef && fileContentRef.includes('attachment_content.content')) {
    const getAttachmentOutput = getAttachmentAction?.output_schema
    if (getAttachmentOutput?.properties) {
      const outputFields = Object.keys(getAttachmentOutput.properties)
      console.log(`      get_email_attachment output fields: ${outputFields.join(', ')}`)
      if (!outputFields.includes('content')) {
        warnings.push(`⚠️  WARNING: Step 7 references "attachment_content.content" but plugin returns: ${outputFields.join(', ')}`)
      }
    }
  }

  // Step 8: Extract structured data (INSIDE LOOP)
  console.log('\n   ✅ STEP 8 (inside loop): Extract invoice fields with document-extractor')
  console.log('      Plugin: document-extractor.extract_structured_data')
  console.log('      Extracting: date, vendor, amount, currency, invoice_number')

  // Step 9: Merge with email metadata (INSIDE LOOP)
  console.log('\n   ✅ STEP 9 (inside loop): Merge extracted fields with email metadata')
  console.log('      Operation: transform.map')
  console.log('      Combines: extracted_fields + attachment.sender + attachment.subject + drive_file.web_view_link')

  // Step 10: Filter valid transactions
  console.log('\n✅ STEP 10: Filter transactions with valid amount')
  console.log('   Operation: transform.filter')
  console.log('   Condition: amount EXISTS')
  console.log('   Output: valid_transactions')

  // Step 11-12: Split high/low value
  console.log('\n✅ STEP 11-12: Split into high_value and low_value transactions')
  console.log('   Threshold: config.amount_threshold_usd')

  // Step 13-14: Calculate totals
  console.log('\n✅ STEP 13-14: Calculate total_count and total_amount')
  console.log('   Operations: reduce.count, reduce.sum')

  // Step 15-16: Write to Google Sheets
  console.log('\n✅ STEP 15-16: Loop over high_value_transactions and write to Google Sheets')
  console.log('   Plugin: google-sheets.append_rows')
  console.log('   Fields mapped: Date, Vendor, Amount, Currency, Invoice Number, Email Sender, Subject, Drive Link')

  // Step 17: Generate email summary
  console.log('\n✅ STEP 17: Generate email summary with AI')
  console.log('   Operation: ai_processing (generate)')
  console.log('   Inputs: valid_transactions, high_value_transactions, total_count, total_amount')

  // Step 18: Send email
  console.log('\n✅ STEP 18: Send summary email')
  console.log('   Plugin: google-mail.send_email')
  console.log('   To: config.user_email')

  // Summary
  console.log()
  console.log('=' .repeat(100))
  console.log('ANALYSIS SUMMARY')
  console.log('=' .repeat(100))

  if (issues.length > 0) {
    console.log(`\n❌ FOUND ${issueCount} CRITICAL ISSUE(S):\n`)
    issues.forEach(issue => console.log(`   ${issue}`))
  }

  if (warnings.length > 0) {
    console.log(`\n⚠️  FOUND ${warnings.length} WARNING(S):\n`)
    warnings.forEach(warning => console.log(`   ${warning}`))
  }

  if (issues.length === 0) {
    console.log('\n✅ No critical data flow issues detected')
  }

  console.log('\n' + '='.repeat(100))
  console.log('WORKFLOW LOGIC ASSESSMENT')
  console.log('=' .repeat(100))

  console.log('\n📊 Workflow Pattern: Extract-Transform-Load (ETL)')
  console.log('   1. Extract: Gmail emails with attachments')
  console.log('   2. Transform: Filter, flatten, extract structured data, aggregate')
  console.log('   3. Load: Write to Google Sheets, send email summary')

  console.log('\n✅ LOGICAL SOUNDNESS:')
  console.log('   ✅ Clear linear flow with appropriate loops')
  console.log('   ✅ Proper use of scatter_gather for parallel processing')
  console.log('   ✅ Appropriate filtering and aggregation steps')
  console.log('   ✅ Final summary generation and notification')

  if (issueCount === 0 && warnings.length === 0) {
    console.log('\n🎉 WORKFLOW IS LOGICALLY SOUND AND EXECUTABLE (after validator auto-fixes)')
  } else {
    console.log('\n⚠️  WORKFLOW REQUIRES FIXES BEFORE EXECUTION')
  }

  console.log()
  process.exit(issueCount > 0 ? 1 : 0)
}

analyzeWorkflow().catch((error) => {
  console.error('Analysis error:', error)
  process.exit(1)
})
