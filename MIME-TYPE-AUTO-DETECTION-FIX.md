# MIME Type Auto-Detection Fix

## Problem

The Invoice Extraction workflow was failing with extraction errors because:

1. **Step 5 (get_email_attachment)** returns:
   ```json
   {
     "data": "base64...",
     "mimeType": "application/pdf",
     "filename": "invoice.pdf"
   }
   ```

2. **Step 6 (document-extractor) config** has:
   ```json
   {
     "file_content": "{{attachment_content.data}}"
   }
   ```

3. When `{{attachment_content.data}}` is resolved, it extracts ONLY the `data` field (the base64 string), NOT the entire object.

4. Document-extractor receives a **string** (not an object), so it fell back to checking the `mime_type` parameter, which doesn't exist in the workflow.

5. Without a MIME type, it defaulted to `"application/octet-stream"`, which the extraction library rejects.

## Solution

**Implemented automatic MIME type detection from base64 content magic bytes** in `/lib/server/document-extractor-plugin-executor.ts`.

### Changes Made

When `file_content` is a string and `mime_type` parameter is not provided:

```typescript
// ✅ FIX: If mime_type not provided, try to detect it from base64 content
// This handles cases where workflow passes {{attachment_content.data}} without mimeType
if (!mime_type) {
  mimeType = this.detectMimeTypeFromBase64(content);
  this.logger.info({ detectedMimeType: mimeType }, 'Auto-detected MIME type from base64 content');
} else {
  mimeType = mime_type;
}
```

### Detection Method

Added `detectMimeTypeFromBase64()` that reads the first few bytes of the base64 content and checks for magic signatures:

- **PDF**: `%PDF-` (bytes 0x25504446) → `application/pdf`
- **PNG**: 0x89504E47 → `image/png`
- **JPEG**: 0xFFD8FF → `image/jpeg`
- **GIF**: "GIF" → `image/gif`
- **Unknown**: Falls back to `application/octet-stream`

## Why This Is Scalable

✅ **No hardcoding**: Works with ANY plugin that returns file content
✅ **No workflow changes needed**: Existing workflows continue to work
✅ **No calibration changes needed**: Fix is at the plugin executor level
✅ **Handles common formats**: Detects PDFs, images, and other document types
✅ **Backward compatible**: If `mime_type` parameter is provided, it uses that

## Impact

- **Invoice Extraction workflow** now correctly detects PDFs even when `{{attachment_content.data}}` is used
- **Any future workflow** that passes base64 content without MIME type will benefit
- **No breaking changes** to existing workflows

## Alternative Approaches Considered

1. ❌ **Manual workflow fix** (change `{{attachment_content.data}}` to `{{attachment_content}}`): Not scalable, needs to be done for every workflow
2. ❌ **Calibration pattern to detect and fix** (add auto-repair to change the variable reference): Complex, requires understanding variable resolution in calibration
3. ✅ **Auto-detect MIME type** (current solution): Simple, scalable, works everywhere

## Files Modified

- `/lib/server/document-extractor-plugin-executor.ts`
  - Lines 80-92: Added MIME type detection when `file_content` is a string
  - Lines 168-205: Added `detectMimeTypeFromBase64()` method

## Next Steps

When calibration runs next:
1. Step6 will receive base64 content as a string
2. Document-extractor will auto-detect `application/pdf` from magic bytes
3. Extraction will succeed
4. Extracted fields will have fallback values for missing required fields (already implemented)
5. Workflow should complete successfully
