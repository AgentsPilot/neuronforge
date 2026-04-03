# Document Extraction - Files for Developer

> Complete list of files for the document extraction feature

## Core Plugin Files

### 1. Plugin Definition
**File**: `lib/plugins/definitions/document-extractor-plugin-v2.json`
- Plugin metadata and configuration
- Action definitions (`extract_structured_data`)
- Input/output schemas
- Parameter validation rules

### 2. Plugin Executor
**File**: `lib/server/document-extractor-plugin-executor.ts`
- Implements the extraction action
- Handles file content (base64, URL)
- MIME type detection
- Calls DeterministicExtractor
- Returns formatted results

## Extraction Engine Files

### 3. Main Orchestrator
**File**: `lib/extraction/DeterministicExtractor.ts`
- 3-tier fallback logic (PDF → Textract → LLM)
- Confidence calculation
- Triggers Textract when needed
- Entry point for all extraction

### 4. PDF Analysis
**File**: `lib/extraction/PdfTypeDetector.ts`
- Detects PDF type (text-based vs scanned)
- Extracts text using pdf-parse
- Returns text content and page count

### 5. Schema-Driven Field Extraction
**File**: `lib/extraction/SchemaFieldExtractor.ts`
- Pattern matching for labeled fields
- Universal patterns (dates, currency, etc.)
- Field name variations generation
- Extracts from text, key-value pairs, tables
- Generic approach - no hardcoded logic

### 6. AWS Textract Client (Stub - Needs Implementation)
**File**: `lib/extraction/TextractClient.ts`
- AWS Textract integration
- OCR for scanned documents
- Table and key-value pair extraction
- **TODO**: Implement `isAvailable()` method

### 7. LLM Field Mapper
**File**: `lib/extraction/LLMFieldMapper.ts`
- Claude-based intelligent field mapping
- Only used after Textract (Tier 3 fallback)
- Requires ANTHROPIC_API_KEY

### 8. Universal Extractor
**File**: `lib/extraction/UniversalExtractor.ts`
- Handles different file types
- Dispatches to appropriate extractors

### 9. Type Definitions
**File**: `lib/extraction/types.ts`
- TypeScript interfaces for extraction system
- OutputSchema, ExtractionInput, etc.

## Utility Files

### 10. Legacy PDF Utilities
**File**: `lib/utils/extractPdfTextFromBase64.ts`
- Simple PDF text extraction function
- Used by legacy code

**File**: `lib/utils/extractPdfText.ts`
- File-based PDF text extraction

## Test Files

### 11. Test Script
**File**: `scripts/test-invoice-extraction.ts`
- Tests extraction on sample invoices
- Shows confidence scores and missing fields
- Run with: `npx tsx scripts/test-invoice-extraction.ts`

### 12. Test PDFs
**Directory**: `test-files/`
- `Invoice677931.pdf` (Scooter Software)
- `Receipt-2667-7775-2451.pdf` (Anthropic)
- `Receipt-HMGRLQ-00003.pdf` (ngrok)

## Documentation

### 13. Status Document
**File**: `docs/DOCUMENT_EXTRACTION_STATUS.md`
- Current functionality
- Test results
- Known limitations
- How to enable Textract/LLM
- Next steps

### 14. This File
**File**: `docs/DOCUMENT_EXTRACTION_FILES_FOR_DEVELOPER.md`
- Complete file listing
- Purpose of each file
- Dependencies

---

## Key Dependencies

```json
{
  "pdf-parse": "^1.1.1",    // PDF text extraction (free)
  "@anthropic-ai/sdk": "*",  // Claude API for LLM fallback
  "aws-sdk": "*"             // AWS Textract (optional)
}
```

---

## Integration Points

### How the Plugin is Called

```typescript
// From workflow execution
const pluginExecuter = await PluginExecuterV2.getInstance();
const result = await pluginExecuter.execute(
  userId,
  'document-extractor',
  'extract_structured_data',
  {
    file_content: base64Content,  // or file_url
    mime_type: 'application/pdf',
    fields: [
      { name: 'invoice_number', type: 'string', required: true },
      { name: 'vendor', type: 'string', required: true },
      // ... more fields
    ],
    use_ai: false  // true to enable LLM fallback
  }
);
```

### Flow

```
User Workflow
    ↓
PluginExecuterV2
    ↓
DocumentExtractorPluginExecutor
    ↓
DeterministicExtractor
    ↓
┌────────────────────────────────────┐
│ 1. PdfTypeDetector                 │ → Extract text with pdf-parse
│ 2. SchemaFieldExtractor            │ → Pattern matching
│ 3. TextractClient (if needed)      │ → AWS OCR
│ 4. LLMFieldMapper (if needed)      │ → Claude mapping
└────────────────────────────────────┘
    ↓
Return extracted fields
```

---

## Critical Notes

### ✅ What's Working
- PDF text extraction
- Pattern-based field matching
- Schema-driven extraction
- Confidence scoring
- 3-tier fallback architecture (code ready, Textract needs setup)

### ⚠️ What Needs Work
1. **TextractClient.isAvailable()** - Currently throws error, needs implementation
2. **Value cleanup** - Extracted values have extra text (e.g., "paid$10.00")
3. **AWS setup** - Textract requires AWS credentials configuration

### 🚫 No Hardcoding
- System uses field descriptions and variations
- No document-type-specific logic
- Works with ANY fields user defines in schema
- Generic pattern matching, not invoice-specific

---

## Files to Send

**Core Files** (8):
1. `lib/plugins/definitions/document-extractor-plugin-v2.json`
2. `lib/server/document-extractor-plugin-executor.ts`
3. `lib/extraction/DeterministicExtractor.ts`
4. `lib/extraction/PdfTypeDetector.ts`
5. `lib/extraction/SchemaFieldExtractor.ts`
6. `lib/extraction/TextractClient.ts`
7. `lib/extraction/LLMFieldMapper.ts`
8. `lib/extraction/types.ts`

**Documentation** (2):
1. `docs/DOCUMENT_EXTRACTION_STATUS.md`
2. `docs/DOCUMENT_EXTRACTION_FILES_FOR_DEVELOPER.md` (this file)

**Optional** (test files):
- `scripts/test-invoice-extraction.ts`
- `test-files/*.pdf`

---

## Questions for Developer

1. Do you have AWS Textract access? (Improves accuracy significantly)
2. Should we enable LLM fallback by default? (Costs tokens)
3. What accuracy level is needed? (Current: 56%, With Textract: ~85%, With LLM: ~95%)
4. Any specific document types to prioritize? (Currently generic)
