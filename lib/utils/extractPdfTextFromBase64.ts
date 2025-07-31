// lib/utils/extractPdfTextFromBase64.ts

export async function extractPdfTextFromBase64(base64: string): Promise<string> {
  try {
    // Clean approach - load pdf-parse only when needed
    const pdfParse = eval('require')('pdf-parse')
    
    const base64Data = base64.replace(/^data:application\/pdf;base64,/, '')
    const buffer = Buffer.from(base64Data, 'base64')
    
    console.log('📄 Processing PDF buffer, size:', buffer.length, 'bytes')
    
    // Parse the PDF buffer directly
    const result = await pdfParse(buffer)
    const text = result.text?.trim() || ''
    
    console.log('📄 Extracted PDF Text length:', text.length)
    console.log('📄 First 200 chars:', text.substring(0, 200))
    
    return text
  } catch (error) {
    console.error('❌ PDF parse error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    })
    throw new Error(`Failed to extract PDF text: ${error.message}`)
  }
}