/**
 * Test semantic skeleton generation with complaint email logger scenario
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

  // Complaint email logger enhanced prompt
  const enhancedPrompt = {
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
      "services_involved": [
        "google-mail",
        "google-sheets"
      ],
      "user_inputs_required": [],
      "resolved_user_inputs": [
        {
          "key": "user_email",
          "value": "offir.omer@gmail.com"
        },
        {
          "key": "spreadsheet_id",
          "value": "1pM8WbXtPgaYqokHn_spgQAfR7SBuql3JUtE1ugDtOpc"
        },
        {
          "key": "sheet_tab_name",
          "value": "UrgentEmails"
        },
        {
          "key": "gmail_scope",
          "value": "Inbox"
        },
        {
          "key": "data_time_window",
          "value": "last 7 days"
        },
        {
          "key": "complaint_keywords",
          "value": "complaint, refund, angry, not working"
        },
        {
          "key": "sheet_dedup_rule",
          "value": "skip if Gmail message link/id already exists in the sheet"
        },
        {
          "key": "thread_handling",
          "value": "log every message that matches the complaint rule"
        },
        {
          "key": "sheet_columns",
          "value": "sender email, subject, date, full email text, Gmail message link/id"
        }
      ]
    }
  }

  const systemPrompt = `Generate a simplified workflow structure showing the business logic flow.

Output JSON with this structure:
{
  "goal": "what this workflow achieves",
  "unit_of_work": "email|message|attachment|row",
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

  console.log('Testing semantic skeleton generation (Complaint Logger)...\n')

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
      fs.writeFileSync('/tmp/semantic-skeleton-complaint.json', JSON.stringify(skeleton, null, 2))
      console.log('\n💾 Saved to: /tmp/semantic-skeleton-complaint.json')

      return skeleton
    } catch (e: any) {
      console.log(`\n❌ JSON parse failed: ${e.message}`)
    }
  } else {
    console.log('\n❌ No JSON found in response')
  }
}

test().catch(console.error)
