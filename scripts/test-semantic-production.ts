/**
 * Test semantic skeleton generation with PRODUCTION system prompt
 * This uses the real system prompt file, not a hardcoded test prompt
 */

import Anthropic from '@anthropic-ai/sdk'
import { readFileSync } from 'fs'
import { join } from 'path'

async function test() {
  // Load ANTHROPIC_API_KEY from .env.local
  const envPath = join(process.cwd(), '.env.local')
  const envContent = readFileSync(envPath, 'utf-8')
  const apiKeyMatch = envContent.match(/ANTHROPIC_API_KEY=(.+)/)
  const apiKey = apiKeyMatch ? apiKeyMatch[1].trim() : process.env.ANTHROPIC_API_KEY

  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not found in .env.local or environment')
  }

  const anthropic = new Anthropic({ apiKey })

  // Load PRODUCTION system prompt
  const systemPromptPath = join(process.cwd(), 'lib/agentkit/v6/semantic-plan/prompts/semantic-skeleton-system.md')
  const systemPrompt = readFileSync(systemPromptPath, 'utf-8')

  // Test with Invoice/Receipt scenario
  const enhancedPrompt1 = {
    "plan_title": "Invoice & Receipt Extraction Agent (Gmail → Drive + Sheets + Summary Email)",
    "plan_description": "Extracts invoices/receipts from unread Gmail emails, stores the files in Google Drive, logs transactions over $50 to a Google Sheet tab, and emails you a summary of all extracted transactions.",
    "sections": {
      "data": [
        "- Scan Gmail for unread emails only.",
        "- From each unread email, consider PDF attachments and image attachments (e.g., .pdf, .jpg, .png) as candidate invoices/receipts.",
        "- Treat each attachment as a separate candidate transaction (do not combine multiple attachments into one transaction).",
        "- Capture source email metadata for each attachment: sender and subject.",
        "- Store each attachment file in a newly created Google Drive folder (folder name to be confirmed).",
        "- Extract standard transaction fields from each attachment: date, vendor, amount, currency, and invoice/receipt number."
      ],
      "actions": [
        "- For each candidate attachment, extract the standard fields (date, vendor, amount, currency, invoice/receipt number) as structured data.",
        "- If the agent cannot confidently find an amount for an attachment, skip creating a transaction record for it and add a note about it in the summary email (include sender + subject and the Drive file link).",
        "- If the extracted amount is greater than $50, append a new row to the specified Google Sheet tab ('Expenses').",
        "- If the extracted amount is $50 or less, do not write it to Google Sheets, but still include it in the summary email's 'all transactions' table."
      ],
      "output": [
        "- Produce an email-friendly summary that includes a table of all extracted transactions (including transactions with amount <= $50).",
        "- Include a separate section listing only transactions with amount > $50.",
        "- Include a Google Drive link for each stored file.",
        "- Include source email info for each transaction (sender and subject).",
        "- Include totals summary (at minimum: number of transactions extracted, sum of amounts for all extracted transactions, and sum of amounts for the > $50 subset).",
        "- Include a separate note section listing any attachments that were skipped because the amount was missing/unclear."
      ],
      "delivery": ["- Send the summary email to offir.omer@gmail.com."],
      "processing_steps": [
        "- Find unread emails in Gmail.",
        "- For each unread email, collect PDF and image attachments.",
        "- Create (or ensure) the target Google Drive folder exists, then upload/store each attachment there.",
        "- Extract standard fields from each stored attachment.",
        "- Split extracted transactions into two groups: amount > $50 and amount <= $50.",
        "- Append only the amount > $50 group to the specified Google Sheet tab.",
        "- Generate the summary email content with the required tables/sections and send it."
      ]
    },
    "specifics": {
      "resolved_user_inputs": [
        {"key": "user_email", "value": "offir.omer@gmail.com"},
        {"key": "amount_threshold_usd", "value": "50"},
        {"key": "sheet_tab_name", "value": "Expenses"}
      ]
    }
  }

  console.log('='.repeat(80))
  console.log('TEST 1: Invoice & Receipt Extraction')
  console.log('='.repeat(80))

  const response1 = await anthropic.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 4000,
    system: systemPrompt,
    messages: [{
      role: 'user',
      content: `Generate workflow structure for:\n\n${JSON.stringify(enhancedPrompt1, null, 2)}`
    }]
  })

  const text1 = response1.content[0].type === 'text' ? response1.content[0].text : ''
  console.log('\nLLM Response:\n')
  console.log(text1)

  // Try to parse JSON
  try {
    const skeleton1 = JSON.parse(text1)
    console.log('\n✅ Parsed JSON successfully')
    console.log(`- Goal: ${skeleton1.goal}`)
    console.log(`- Unit of work: ${skeleton1.unit_of_work}`)
    console.log(`- Flow has ${skeleton1.flow?.length} top-level steps`)

    const fs = require('fs')
    fs.writeFileSync('/tmp/semantic-test1-production.json', JSON.stringify(skeleton1, null, 2))
    console.log('\n💾 Saved to: /tmp/semantic-test1-production.json')
  } catch (e: any) {
    console.log(`\n❌ JSON parse failed: ${e.message}`)
  }

  // Test with Complaint Logger scenario
  const enhancedPrompt2 = {
    "plan_title": "Customer Complaint Email Logger (Gmail → Google Sheets)",
    "plan_description": "Scans your Gmail Inbox for the last 7 days, finds emails that contain complaint keywords, and appends only those complaint emails into the 'UrgentEmails' tab of your Google Sheet while skipping duplicates based on Gmail message link/id.",
    "sections": {
      "data": [
        "- Scan Gmail Inbox messages from the last 7 days.",
        "- Treat an email as a complaint if the email content contains any of these keywords (case-insensitive match): 'complaint', 'refund', 'angry', 'not working'.",
        "- Use the Google Sheet with spreadsheet id '1pM8WbXtPgaYqokHn_spgQAfR7SBuql3JUtE1ugDtOpc' as the destination.",
        "- Use the worksheet/tab name 'UrgentEmails' inside that spreadsheet as the destination tab.",
        "- Read existing rows from the destination tab to identify already-logged complaint emails by Gmail message link/id."
      ],
      "actions": [
        "- For each Gmail message in scope, check whether the message content contains any of: 'complaint', 'refund', 'angry', 'not working'.",
        "- If the message matches the complaint rule, extract these fields: sender email, subject, date, and the full email text.",
        "- If the message matches the complaint rule, also capture the Gmail message link/id to use as a unique identifier.",
        "- If the Gmail message link/id already exists in the destination tab, do not add a new row for that message.",
        "- If the Gmail message link/id does not exist in the destination tab, append exactly one new row for that message.",
        "- Treat each matching message independently (if a thread has multiple matching messages, log every matching message as its own row)."
      ],
      "output": [
        "- Append one row per complaint email to the destination Google Sheet tab.",
        "- Each appended row must include (in this order): sender email, subject, date, full email text, Gmail message link/id."
      ],
      "delivery": [
        "- Deliver results by writing/appending rows into the Google Sheet tab 'UrgentEmails' (no email/slack notification)."
      ],
      "processing_steps": [
        "- Fetch Gmail messages from Inbox for the last 7 days.",
        "- Load existing rows from the 'UrgentEmails' tab and build a set of existing Gmail message link/id values.",
        "- Filter messages by keyword match against the email content (case-insensitive).",
        "- For each matching message, extract required fields and append a new row only if its Gmail message link/id is not already present."
      ]
    },
    "specifics": {
      "services_involved": ["google-mail", "google-sheets"],
      "resolved_user_inputs": [
        {"key": "user_email", "value": "offir.omer@gmail.com"},
        {"key": "spreadsheet_id", "value": "1pM8WbXtPgaYqokHn_spgQAfR7SBuql3JUtE1ugDtOpc"},
        {"key": "sheet_tab_name", "value": "UrgentEmails"},
        {"key": "gmail_scope", "value": "Inbox"},
        {"key": "data_time_window", "value": "last 7 days"},
        {"key": "complaint_keywords", "value": "complaint, refund, angry, not working"}
      ]
    }
  }

  console.log('\n\n' + '='.repeat(80))
  console.log('TEST 2: Complaint Email Logger')
  console.log('='.repeat(80))

  const response2 = await anthropic.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 4000,
    system: systemPrompt,
    messages: [{
      role: 'user',
      content: `Generate workflow structure for:\n\n${JSON.stringify(enhancedPrompt2, null, 2)}`
    }]
  })

  const text2 = response2.content[0].type === 'text' ? response2.content[0].text : ''
  console.log('\nLLM Response:\n')
  console.log(text2)

  // Try to parse JSON
  try {
    const skeleton2 = JSON.parse(text2)
    console.log('\n✅ Parsed JSON successfully')
    console.log(`- Goal: ${skeleton2.goal}`)
    console.log(`- Unit of work: ${skeleton2.unit_of_work}`)
    console.log(`- Flow has ${skeleton2.flow?.length} top-level steps`)

    const fs = require('fs')
    fs.writeFileSync('/tmp/semantic-test2-production.json', JSON.stringify(skeleton2, null, 2))
    console.log('\n💾 Saved to: /tmp/semantic-test2-production.json')
  } catch (e: any) {
    console.log(`\n❌ JSON parse failed: ${e.message}`)
  }

  console.log('\n\n' + '='.repeat(80))
  console.log('TESTING COMPLETE')
  console.log('='.repeat(80))
}

test().catch(console.error)
