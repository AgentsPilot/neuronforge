/**
 * Simple test: Send real Enhanced Prompt to LLM with semantic skeleton instructions
 * See if LLM can generate simplified business logic structure
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

  // Real enhanced prompt from your workflow
  const enhancedPrompt = {
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
        "- If the extracted amount is greater than $50, append a new row to the specified Google Sheet tab (\"Expenses\").",
        "- If the extracted amount is $50 or less, do not write it to Google Sheets, but still include it in the summary email's \"all transactions\" table."
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

  const systemPrompt = `Generate a simplified workflow structure showing the business logic flow.

Output JSON with this structure:
{
  "goal": "what this workflow achieves",
  "unit_of_work": "attachment|email",
  "flow": [
    {"action": "fetch", "what": "description"},
    {"action": "loop", "over": "collection", "collect_results": true|false, "do": [...]},
    {"action": "extract", "fields": ["field1", "field2"]},
    {"action": "decide", "if": "condition", "then": [...], "else": [...]},
    {"action": "create", "what": "resource"},
    {"action": "upload", "what": "item", "to": "destination"},
    {"action": "send", "what": "message"}
  ]
}

Rules:
- Use nested loops for parent-child (emails → attachments)
- Set collect_results=true only on loop matching unit_of_work
- Show sequential order (create before upload)
- Use natural language, no technical details`

  console.log('Testing semantic skeleton generation...\n')

  const response = await anthropic.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 4000,
    system: systemPrompt,
    messages: [{
      role: 'user',
      content: `Generate workflow structure for:\n\n${JSON.stringify(enhancedPrompt, null, 2)}`
    }]
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : ''
  console.log('LLM Response:\n')
  console.log(text)
  console.log('\n' + '='.repeat(80))

  // Try to extract and parse JSON
  const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/) || text.match(/({[\s\S]*})/)
  if (jsonMatch) {
    try {
      const skeleton = JSON.parse(jsonMatch[1])
      console.log('\n✅ Parsed JSON successfully\n')
      console.log('Key findings:')
      console.log(`- Goal: ${skeleton.goal}`)
      console.log(`- Unit of work: ${skeleton.unit_of_work}`)
      console.log(`- Flow has ${skeleton.flow?.length} top-level steps`)

      // Save to file for inspection
      const fs = require('fs')
      fs.writeFileSync('/tmp/semantic-skeleton-test.json', JSON.stringify(skeleton, null, 2))
      console.log('\n💾 Saved to: /tmp/semantic-skeleton-test.json')

      return skeleton
    } catch (e: any) {
      console.log(`\n❌ JSON parse failed: ${e.message}`)
    }
  } else {
    console.log('\n❌ No JSON found in response')
  }
}

test().catch(console.error)
