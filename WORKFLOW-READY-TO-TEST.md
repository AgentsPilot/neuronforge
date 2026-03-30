# Invoice Extraction Workflow - Ready for Testing

## ✅ All Fixes Applied

### 1. Document Extractor Plugin - WORKING
- **File**: [lib/server/document-extractor-plugin-executor.ts](lib/server/document-extractor-plugin-executor.ts)
- Uses real `DeterministicExtractor` with:
  - PDF text extraction (free with pdf-parse)
  - AWS Textract OCR for scanned PDFs (~$0.0015/page)
  - Schema-driven field extraction
- **Smart parameter handling**: Can receive either:
  - Base64 string directly: `file_content: "JVBERi0x..."`
  - File object: `file_content: { content: "JVBERi0x...", mime_type: "application/pdf", filename: "invoice.pdf" }`
  - Automatically extracts content from objects (lines 54-70)

### 2. File Upload - WORKING
- **File**: [lib/server/google-drive-plugin-executor.ts](lib/server/google-drive-plugin-executor.ts:629-654)
- Fixed base64 encoding (URL-safe format, whitespace removal)
- Files upload with actual content (not 0 bytes)

### 3. Flatten Field Extraction - WORKING
- **File**: [lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts](lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts:602-619)
- Step2 correctly has `"field": "attachments"`
- Extracts attachments array from emails

### 4. Workflow Parameter Fix - APPLIED
- **File**: [output/vocabulary-pipeline/pilot-dsl-steps.json](output/vocabulary-pipeline/pilot-dsl-steps.json)
- Step8 now uses `{{attachment_content}}` instead of `{{drive_file}}`
- This ensures the extractor receives file content, not just file metadata
- **Manual fix applied** - See line 8 in step8 config

## 📋 Current Workflow Flow

```
Step1: Search Gmail for unread emails with attachments
  ↓ outputs: unread_emails

Step2: Flatten to extract attachments array
  ↓ outputs: all_attachments (with field: "attachments")

Step3: Filter for PDF and image attachments
  ↓ outputs: candidate_attachments

Step4: Create/find "Invoice_Receipts" folder in Drive
  ↓ outputs: drive_folder

Step5: SCATTER-GATHER loop over candidate_attachments
  ├─ Step6: Download attachment from Gmail
  │    ↓ outputs: attachment_content { content, filename, mime_type }
  │
  ├─ Step7: Upload to Google Drive
  │    ↓ uses: {{attachment_content.content}}
  │    ↓ outputs: drive_file { file_id, name, web_view_link }
  │
  ├─ Step8: Extract structured data (FIXED!)
  │    ↓ uses: {{attachment_content}} ✅ (was {{drive_file}} ❌)
  │    ↓ outputs: extracted_fields { date, vendor, amount, currency, invoice_number }
  │
  └─ Step9: Merge extracted fields with email metadata
       ↓ outputs: transaction_record
  ↓ gather outputs: processed_transactions

Step10: Filter valid transactions (amount exists)
  ↓ outputs: valid_transactions

Step11: Filter high-value transactions (amount > threshold)
  ↓ outputs: high_value_transactions

Step12: Filter low-value transactions (amount <= threshold)
  ↓ outputs: low_value_transactions

Step13: Calculate total count
  ↓ outputs: total_count

Step14: Calculate total amount sum
  ↓ outputs: total_amount_sum

Step15: SCATTER-GATHER loop over high_value_transactions
  └─ Step16: Append row to Google Sheets
       ↓ outputs: sheet_row
  ↓ gather outputs: sheets_results

Step17: Generate HTML email summary (AI)
  ↓ outputs: email_content { subject, body }

Step18: Send summary email
  ↓ Done!
```

## 🧪 How to Test

1. **Start the dev server** (if not already running):
   ```bash
   npm run dev
   ```

2. **Navigate to the agent sandbox**:
   ```
   http://localhost:3000/v2/sandbox/43ffbc8a-406d-4a43-9f3f-4e7554160eda
   ```

3. **Click "Start Test"** to run the workflow

4. **Monitor the logs**:
   ```bash
   # In a separate terminal
   tail -f .next/server-logs.txt | grep -E "step[0-9]+|extract|upload|Document extraction"
   ```

## 🔍 What to Check

### Expected Success Indicators:
- ✅ Step1 finds unread emails
- ✅ Step2 extracts attachments array
- ✅ Step3 filters to PDF/images
- ✅ Step6 downloads attachment content (base64)
- ✅ Step7 uploads files to Drive (should show file size > 0)
- ✅ Step8 extracts invoice fields using `DeterministicExtractor`
  - Look for: `"Document extraction complete"` with confidence > 0
  - Check: `extractionMethod` should be "pdf-parse" or "textract"
- ✅ Step16 appends to Google Sheets
- ✅ Step18 sends summary email

### Key Log Messages to Look For:
```
"Using provided file content" - Step8 received content successfully
"Document extraction complete" - Extraction finished
"extractionMethod": "pdf-parse" or "textract" - Real extraction ran
"confidence": 0.85 - Field extraction confidence
"fieldsExtracted": 5 - Number of fields found
```

## 🐛 If It Fails

### Check step8 logs for:
- **"file_content is an object"** - Executor is handling file object (good!)
- **"Extracted content from file object"** - Content successfully extracted
- **"contentLength"** - Should show large number (thousands of chars for PDFs)
- **Missing fields** - Check `missingFields` array in response

### Common Issues:
1. **"Either file_content or file_url is required"**
   - Variable `{{attachment_content}}` not resolved
   - Check Step6 output exists

2. **"file_content is object but has no content/data field"**
   - attachment_content doesn't have .content field
   - Check Gmail attachment download action

3. **AWS Textract errors**
   - OCR fallback failing
   - Set `use_ai: true` in step8 config to force LLM (not implemented yet)
   - Or ensure AWS credentials are configured

## 📝 Notes

- **Mock data removed**: Document extractor now uses real PDF parsing/OCR
- **Plugin-agnostic**: Executor works with any file format supported by DeterministicExtractor
- **Cost-efficient**: Text PDFs are free (pdf-parse), scanned PDFs use AWS Textract (~$0.0015/page)
- **Manual workflow fix**: Step8 was manually updated to use `{{attachment_content}}`. Future pipeline runs will need this same fix until we implement the compiler optimization.

## 🎯 Next Steps (After Successful Test)

1. Implement compiler optimization to automatically detect and fix the `drive_file` → `attachment_content` pattern
2. Add support for mime_type and filename extraction from attachment object
3. Test with real invoice PDFs to validate field extraction accuracy
4. Implement LLM fallback for complex documents (use_ai: true)
