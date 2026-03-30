# Invoice Extraction Workflow - Test Instructions

## ✅ All Fixes Complete

The workflow is now ready for testing. All code fixes have been applied:

1. ✅ DocumentExtractorPluginExecutor created with real DeterministicExtractor
2. ✅ Plugin registered in PluginExecuterV2
3. ✅ Plugin rules field added
4. ✅ Base64 encoding fixed in Google Drive executor
5. ✅ Flatten field extraction added to compiler
6. ✅ Smart parameter handling in document-extractor (handles file objects OR base64)
7. ✅ Workflow manually fixed: step8 uses `{{attachment_content}}` instead of `{{drive_file}}`

## 🧪 How to Test

### Step 1: Navigate to the Agent Sandbox

Open your browser and go to:
```
http://localhost:3000/v2/sandbox/43ffbc8a-406d-4a43-9f3f-4e7554160eda
```

The dev server is already running on port 3000.

### Step 2: Start the Workflow

Click the **"Start Test"** or **"Run Workflow"** button in the UI.

The workflow will:
1. Search Gmail for unread emails with attachments
2. Extract attachments array
3. Filter for PDF/image attachments
4. Create/find "Invoice_Receipts" folder in Drive
5. Loop over each attachment:
   - Download from Gmail (gets base64 content)
   - Upload to Google Drive
   - **Extract invoice fields** using DeterministicExtractor
   - Merge with email metadata
6. Filter valid transactions
7. Split high-value vs low-value
8. Calculate totals
9. Append high-value transactions to Google Sheets
10. Generate AI email summary
11. Send summary email

### Step 3: Monitor Execution

Watch the execution logs in the UI. Key things to check:

#### ✅ Step6 Success Indicators:
- Should output `attachment_content` with:
  - `content`: base64 string (thousands of chars)
  - `filename`: attachment name
  - `mime_type`: "application/pdf" or "image/..."

#### ✅ Step7 Success Indicators:
- Should show file uploaded to Drive
- **File size should be > 0 bytes** (not 0 B)
- Should output `drive_file` with:
  - `file_id`: Google Drive file ID
  - `web_view_link`: URL to view file
  - `name`: filename

#### ✅ Step8 Success Indicators (CRITICAL):
- Should receive `file_content` from `{{attachment_content}}`
- Logs should show:
  - `"Using provided file content"` or `"Extracted content from file object"`
  - `"Document extraction complete"`
  - `"extractionMethod": "pdf-parse"` (for text PDFs) or `"textract"` (for scanned PDFs)
  - `"confidence": 0.XX` (extraction confidence score)
  - `"fieldsExtracted": 5` (or however many fields found)
- Should output `extracted_fields` with:
  - `date`: invoice date
  - `vendor`: vendor name
  - `amount`: invoice amount (number)
  - `currency`: currency code
  - `invoice_number`: invoice/receipt number

#### ✅ Step16 Success Indicators:
- Should append rows to Google Sheets
- Check the sheet at: https://docs.google.com/spreadsheets/d/1pM8WbXtPgaYqokHn_spgQAfR7SBuql3JUtE1ugDtOpc/edit
- Tab: "Expenses"

#### ✅ Step18 Success Indicators:
- Should send email to offir.omer@gmail.com
- Check inbox for summary email

## 🔍 What Fixed the Core Issue

### The Problem
Step8 was trying to use `{{drive_file}}` for document extraction, but:
- `drive_file` is the OUTPUT of the upload step (step7)
- It only contains: `{ file_id, web_view_link, name }`
- It does NOT contain the file content (base64)

### The Solution
Changed step8 to use `{{attachment_content}}` instead:
- `attachment_content` is the OUTPUT of the download step (step6)
- It contains: `{ content, filename, mime_type }`
- The `content` field has the actual base64 file data

### Smart Executor Handling
The DocumentExtractorPluginExecutor now handles BOTH formats:
- If it receives a string → treats as base64 content
- If it receives an object → extracts `.content` field automatically
- Tries common field names: `content`, `data`, `file_content`
- Plugin-agnostic: works with any file source

## 🐛 If It Fails

### Check Browser Console
Look for any errors in the browser developer console.

### Check Server Logs
If the dev server is logging to console, look for:
- Step execution logs
- Plugin executor logs
- Error messages

### Common Issues

#### Issue 1: "file_content is an object but missing content/data field"
**Cause**: attachment_content doesn't have expected structure
**Fix**: Check step6 output - Gmail attachment download should return object with content field

#### Issue 2: "Plugin executor not found for: document-extractor"
**Cause**: Server not restarted after code changes
**Fix**: Restart dev server:
```bash
npm run dev
```

#### Issue 3: Files still uploading as 0 B
**Cause**: Base64 content not reaching Drive API correctly
**Fix**: Check step6 logs - should show contentLength with large number

#### Issue 4: "AWS Textract not available"
**Cause**: OCR fallback for scanned PDFs
**Solution**:
- Text-based PDFs will still work (uses free pdf-parse)
- To enable OCR for scanned PDFs, configure AWS credentials
- Or test with text-based PDF invoices

## 📊 Expected Results

For a successful test run with 1 invoice attachment:

1. **Step1**: Finds 1+ unread emails with attachments
2. **Step2**: Extracts attachments array (1+ attachments)
3. **Step3**: Filters to PDF/images (1+ candidates)
4. **Step6**: Downloads 1 attachment (~10KB+ base64)
5. **Step7**: Uploads to Drive (file size > 0 B)
6. **Step8**: Extracts 3-5 invoice fields (depending on PDF quality)
7. **Step16**: Adds 1 row to Google Sheets (if amount > $10)
8. **Step17**: Generates HTML email with transaction table
9. **Step18**: Sends email successfully

## 🎯 What to Report Back

After testing, please let me know:

1. ✅ **Did the workflow complete successfully?**
2. ✅ **Did step8 extract invoice fields?** (check logs for "Document extraction complete")
3. ✅ **Were files uploaded to Drive with correct size?** (not 0 B)
4. ✅ **Did rows appear in Google Sheets?**
5. ✅ **Did you receive the summary email?**

If any step failed, please share:
- Error message from UI
- Step that failed
- Any relevant logs visible in the UI

## 📝 Files Changed

All changes are saved and committed:
- [lib/server/document-extractor-plugin-executor.ts](lib/server/document-extractor-plugin-executor.ts) - CREATED
- [lib/server/plugin-executer-v2.ts](lib/server/plugin-executer-v2.ts:45) - Registered executor
- [lib/plugins/definitions/document-extractor-plugin-v2.json](lib/plugins/definitions/document-extractor-plugin-v2.json) - Added rules
- [lib/server/google-drive-plugin-executor.ts](lib/server/google-drive-plugin-executor.ts:629-654) - Fixed base64
- [lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts](lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts:602-619) - Added flatten
- [output/vocabulary-pipeline/pilot-dsl-steps.json](output/vocabulary-pipeline/pilot-dsl-steps.json:202) - Manual fix

Server is running at: http://localhost:3000
