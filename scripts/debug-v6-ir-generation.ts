#!/usr/bin/env tsx
/**
 * Debug V6 IR Generation
 * Shows what steps are being generated from the enhanced prompt
 */

import { readFileSync } from 'fs';

// Read the enhanced prompt from the user's message
const enhancedPrompt = {
  "enhanced_prompt": {
    "plan_title": "Expense & Invoice Intake Agent (Gmail → Drive + Sheets + Email Summary)",
    "plan_description": "Scans Gmail using a fixed search query to find invoice/receipt emails with attachments, extracts basic fields, stores attachments in Google Drive organized by vendor, appends rows to a Google Sheet (Invoices vs Expenses tabs), and emails a summary to you. Items with missing amounts are included in the summary only.",
    "sections": {
      "data": [
        "- Search Gmail using the query: \"subject:(invoice OR receipt OR bill) has:attachment\".",
        "- For each matched email, use the email metadata (subject, sender, date) and attachment files as the source content.",
        "- Extract the following basic fields for each detected item: date, vendor, amount, currency.",
        "- Capture the Google Drive link of each stored attachment file.",
        "- Use the Google Drive folder ID \"1BoYgIIQj5QB6F0mWLzD_0-2pMLoxHVp-\" as the main storage folder.",
        "- Use the extracted vendor name to determine the vendor subfolder name under the main Drive folder.",
        "- Use Google Sheet ID \"1RHLbBXzrKv24gNgp7a4Lr7RlMIrP9fjacfGWjhPAbOE\" as the destination spreadsheet.",
        "- Use the tab name \"Invoices\" for items classified as invoices.",
        "- Use the tab name \"Expenses\" for items classified as expenses."
      ],
      "actions": [
        "- For each matched email, classify the item as either an invoice or an expense based on the email subject/body and attachment filename/content cues (for example: the presence of the word \"invoice\" vs \"receipt\").",
        "- For each classified item, extract: date, vendor, amount, currency.",
        "- If the email has one or more attachments, store each attachment in Google Drive under: main folder (ID: 1BoYgIIQj5QB6F0mWLzD_0-2pMLoxHVp-) / vendor subfolder.",
        "- If the email has multiple attachments, treat each attachment as a separate stored file and create a separate summary line item per attachment.",
        "- Build a summary line item for each stored file that includes: date, vendor, amount, currency, and the Google Drive link to the stored file.",
        "- If an amount is found (regardless of currency), append a new row to the Google Sheet (ID: 1RHLbBXzrKv24gNgp7a4Lr7RlMIrP9fjacfGWjhPAbOE) in the \"Invoices\" tab when classified as invoice.",
        "- If an amount is found (regardless of currency), append a new row to the Google Sheet (ID: 1RHLbBXzrKv24gNgp7a4Lr7RlMIrP9fjacfGWjhPAbOE) in the \"Expenses\" tab when classified as expense.",
        "- When appending a row, write the columns in this order: Date, Vendor, Amount, Currency, Drive Link.",
        "- If the agent cannot confidently extract the amount (or key fields), include the item in the email summary only and do not append it to Google Sheets."
      ],
      "output": [
        "- Produce an email-friendly summary that lists each detected invoice/expense as a separate line item.",
        "- For each line item, include: date, vendor, amount, currency, and a Google Drive link.",
        "- Produce a structured Google Sheets row payload with: Date, Vendor, Amount, Currency, Drive Link.",
        "- Produce a separate section in the email summary titled \"Needs review (not added to Google Sheets)\" for items where the amount (or key fields) could not be extracted."
      ],
      "delivery": [
        "- Send the summary email to meiribarak@gmail.com.",
        "- In the email, include two sections: \"Invoices\" and \"Expenses\" (based on the classification).",
        "- In the email, include a third section: \"Needs review (not added to Google Sheets)\"."
      ],
      "processing_steps": [
        "- Run the Gmail search query to collect candidate emails.",
        "- For each candidate email, classify it as invoice vs expense.",
        "- Extract basic fields from the email and attachments.",
        "- Store attachments in Google Drive under the vendor subfolder.",
        "- Append a row to the correct Google Sheet tab (Invoices or Expenses) when an amount is found.",
        "- Build the final email summary with three sections (Invoices, Expenses, Needs review).",
        "- Send the summary email to the user."
      ]
    },
    "specifics": {
      "services_involved": [
        "google-mail",
        "google-drive",
        "google-sheets",
        "chatgpt-research"
      ],
      "user_inputs_required": [],
      "resolved_user_inputs": [
        {
          "key": "user_email",
          "value": "meiribarak@gmail.com"
        },
        {
          "key": "gmail_search_query",
          "value": "subject:(invoice OR receipt OR bill) has:attachment"
        },
        {
          "key": "drive_main_folder_id",
          "value": "1BoYgIIQj5QB6F0mWLzD_0-2pMLoxHVp-"
        },
        {
          "key": "google_sheet_id",
          "value": "1RHLbBXzrKv24gNgp7a4Lr7RlMIrP9fjacfGWjhPAbOE"
        },
        {
          "key": "google_sheet_tab_invoices",
          "value": "Invoices"
        },
        {
          "key": "google_sheet_tab_expenses",
          "value": "Expenses"
        }
      ]
    }
  }
};

console.log('📋 Enhanced Prompt Analysis\n');
console.log('══════════════════════════════════════════════════════════════\n');

console.log('🔧 Services Involved:');
enhancedPrompt.enhanced_prompt.specifics.services_involved.forEach(s => {
  console.log(`   - ${s}`);
});

console.log('\n📊 Expected Steps Based on Prompt:');
console.log('   1. Gmail Search (data source)');
console.log('   2. Extract fields (AI operation - classification + extraction)');
console.log('   3. **Google Drive - Store attachments** ← MISSING?');
console.log('   4. Google Sheets - Append rows');
console.log('   5. Email summary (delivery)');

console.log('\n🔍 Key Actions Mentioned:');
enhancedPrompt.enhanced_prompt.sections.actions
  .filter(a => a.includes('Drive') || a.includes('store'))
  .forEach(action => {
    console.log(`   ${action}`);
  });

console.log('\n💡 Problem Hypothesis:');
console.log('   The IRFormalizer is likely treating "store attachments in Drive"');
console.log('   as an implicit data operation rather than an explicit step.');
console.log('   This is because the formalization prompt may not have clear');
console.log('   instructions for "storage" operations.');

console.log('\n✅ Solution:');
console.log('   The formalization prompt needs explicit mapping rules for:');
console.log('   - "store in Drive" → ai_operations with plugin_key: google-drive');
console.log('   - operation_type: "upload_file" or "store_attachment"');
console.log('   - Config should include: folder_id, file_source (from attachments)');

console.log('\n══════════════════════════════════════════════════════════════\n');
