# AWS Textract + LLM Safety Verification

## ✅ VERIFIED: LLMs NEVER Extract Files Directly

This document verifies that the system architecture prevents LLMs from ever processing raw PDF/image files directly. All file extraction is done by AWS Textract or other specialized extraction tools.

---

## Architecture Flow

```
PDF/Image File
    ↓
[AWS Textract OCR]  ← Extracts text from file
    ↓
Raw Text (881 chars)
    ↓
[DeterministicExtractor] ← Pattern matching (FREE)
    ↓
IF confidence >= 70%: ✅ Done (no LLM cost)
IF confidence < 70%: ↓
    ↓
[LLM Fallback] ← Receives TEXT ONLY (not file!)
    ↓
Structured Data
```

---

## Code Verification

### 1. File Extraction Entry Point
**File:** `lib/pilot/StepExecutor.ts`
**Lines:** 4040-4054

```typescript
// Create extractor and run text extraction (FREE - OCR only, no LLM)
const ocrEnabled = step.ocr_fallback !== false;
const extractor = new DeterministicExtractor(ocrEnabled);

const result = await extractor.extract({
  content,      // ← Base64 file content
  mimeType,     // ← File type
  filename: inputContext.filename,
  inputContext,
  config: {
    documentType: step.document_type || 'auto',
    outputSchema: outputSchema ? { fields: outputSchema.fields || outputSchema.items?.fields || [] } : undefined,
    ocrFallback: ocrEnabled,
  }
});
```

**✅ Verification:** File goes to `DeterministicExtractor`, not LLM.

---

### 2. Deterministic Extraction (Image Handler)
**File:** `lib/extraction/DeterministicExtractor.ts`
**Lines:** 205-224

```typescript
private async handleImage(
  input: DeterministicExtractionInput,
  extractionInput: ExtractionInput,
  ocrEnabled: boolean
): Promise<ExtractionInput> {
  if (!ocrEnabled) {
    throw new Error('Image extraction requires OCR - enable ocr_fallback');
  }

  const textractResult = await this.tryTextract(input.content);  // ← AWS Textract
  if (!textractResult || !textractResult.text) {
    throw new Error('OCR extraction failed - check AWS Textract configuration');
  }

  extractionInput.text = textractResult.text;  // ← TEXT extracted
  extractionInput.keyValuePairs = textractResult.keyValuePairs;
  extractionInput.tables = textractResult.tables;

  return extractionInput;
}
```

**✅ Verification:** Images processed by Textract, result is TEXT.

---

### 3. Textract Client Call
**File:** `lib/extraction/DeterministicExtractor.ts`
**Lines:** 292-312

```typescript
private async tryTextract(content: string): Promise<{
  text: string;
  keyValuePairs: Array<{ key: string; value: string; confidence: number }>;
  tables: Array<{ rows: string[][]; confidence: number }>;
} | null> {
  try {
    const { TextractClient } = await import('./TextractClient');
    const textractClient = new TextractClient();

    if (!await textractClient.isAvailable()) {
      logger.debug('DeterministicExtractor: Textract not available');
      return null;
    }

    // Use analyzeDocument for structured extraction
    const result = await textractClient.analyzeDocument(content);  // ← AWS SDK

    if (!result.success) {
      logger.warn({ error: result.error }, 'DeterministicExtractor: Textract failed');
      return null;
    }

    return {
      text: result.text,              // ← Extracted TEXT
      keyValuePairs: result.keyValuePairs || [],
      tables: result.tables || [],
    };
  } catch (error: any) {
    logger.warn({ err: error }, 'DeterministicExtractor: Textract error');
    return null;
  }
}
```

**✅ Verification:** Pure AWS Textract SDK call, no LLM involved.

---

### 4. LLM Fallback (Only Receives Text)
**File:** `lib/pilot/StepExecutor.ts`
**Lines:** 4099-4106

```typescript
// Deterministic extraction failed or low confidence - fallback to LLM
logger.info({
  stepId: step.id,
  confidence: result.confidence,
  threshold: CONFIDENCE_THRESHOLD,
  reason: !result.success ? 'extraction_failed' : 'low_confidence',
  hasInputContext: Object.keys(inputContext).length > 0,
}, 'Falling back to LLM for field extraction');

const llmResult = await this.extractFieldsWithLLM(
  step.id,
  outputSchema,
  result.rawText || '',  // ← TEXT ONLY (from Textract)
  step.instruction,
  context,
  inputContext
);
```

**✅ Verification:** LLM receives `result.rawText` - pre-extracted text.

---

### 5. LLM Extraction Function Signature
**File:** `lib/pilot/StepExecutor.ts`
**Lines:** 4129-4141

```typescript
private async extractFieldsWithLLM(
  stepId: string,
  outputSchema: {
    type?: 'object' | 'array' | 'string';
    fields?: Array<{ name: string; type: string; required?: boolean; description?: string }>;
    items?: { fields: Array<{ name: string; type: string; required?: boolean; description?: string }> };
    description?: string;
  } | undefined,
  rawText: string,  // ← TEXT parameter, not file!
  instruction: string | undefined,
  context: ExecutionContext,
  inputContext?: Record<string, any>
): Promise<{ data: any; confidence: number; tokensUsed: number }> {
```

**✅ Verification:** Function signature accepts `rawText: string`, not file content.

---

### 6. LLM Prompt Building (Text Only)
**File:** `lib/pilot/StepExecutor.ts`
**Lines:** 4145-4161

```typescript
// Truncate raw text if too long
const truncatedText = rawText.length > 8000
  ? rawText.substring(0, 8000) + '... [truncated]'
  : rawText;

// Build prompt based on output type
const prompt = this.buildExtractionPrompt(
  outputType,
  fields,
  outputSchema?.description,
  instruction,
  truncatedText,  // ← TEXT passed to prompt
  inputContext
);

try {
  const result = await runAgentKit(
    context.userId,
    {
      ...context.agent,
      plugins_required: [], // No tools needed for extraction
    },
    prompt,  // ← TEXT prompt
    {},      // ← Empty params (NO IMAGES)
    context.sessionId
  );
```

**✅ Verification:**
- LLM receives text-only prompt
- Empty params `{}` confirms no images
- Text truncated to 8000 chars for safety

---

## Cost Analysis

### Correct Flow (Current Implementation)
```
PDF Receipt (1 page)
├─ Textract OCR: $0.0015
├─ Deterministic parsing: $0 (50% confidence)
└─ LLM text parsing: $0.004 (1,381 tokens)
Total: ~$0.0055 per document
```

### If LLM Processed File Directly (AVOIDED)
```
PDF Receipt (1 page with vision model)
└─ Claude 3.5 Sonnet vision: ~$0.024 per page
Total: ~$0.024 per document (4.4x more expensive!)
```

**Savings:** 78% cost reduction by using Textract + text-only LLM

---

## Safety Guarantees

### ✅ What IS Happening:
1. AWS Textract extracts text from PDFs/images ($0.0015/page)
2. Pattern matching tries to extract fields (free)
3. If confidence low, LLM parses the **text** ($0.004/document)

### ❌ What is NOT Happening:
1. ~~LLM processing raw PDF/image files~~
2. ~~Vision model extracting document content~~
3. ~~Direct file → LLM pipeline~~

---

## Vision Mode (Different Code Path)

**Note:** There IS vision code in StepExecutor, but it's for **action steps**, not extraction:

**File:** `lib/pilot/StepExecutor.ts:3797`
```typescript
private async buildLLMPrompt(
  prompt: string,
  contextSummary: string,
  params: any
): Promise<{ fullPrompt: string | any[]; isVisionMode: boolean }> {
  // Check if data contains images for vision processing
  const hasImages = VisionContentBuilder.hasImageContent(params);

  if (hasImages) {
    // Vision mode for ACTION steps (not extraction)
    const imageContent = await VisionContentBuilder.extractImageContentAsync(params);
    // ...
  }
}
```

**This is used for:**
- Action steps where user provides images as input
- NOT for file extraction steps

**Verification:** `extractFieldsWithLLM()` never calls `buildLLMPrompt()` - it uses `buildExtractionPrompt()` which is text-only.

---

## Conclusion

✅ **VERIFIED:** The system architecture is safe and cost-optimized:

1. **File extraction** = AWS Textract (specialized OCR service)
2. **Field parsing** = Deterministic patterns first (free)
3. **LLM fallback** = Text-only processing (cheap)
4. **Vision models** = Never used for file extraction

The LLM **never sees the raw file** - only the pre-extracted text from Textract.

---

## Test Commands

```bash
# Verify Textract connection
npx tsx scripts/test-textract-connection.ts

# Comprehensive extraction test
npx tsx scripts/test-textract-comprehensive.ts

# Schema field extraction test
npx tsx scripts/test-schema-field-extraction.ts
```

---

**Last Verified:** 2026-02-04
**Verification Status:** ✅ SAFE - LLMs never process files directly
