// lib/pdfParseWrapper.ts

// This file must not import anything from pdf-parse at top-level
import type { Buffer } from 'node:buffer'

export async function parsePdf(buffer: Buffer): Promise<string> {
  const pdfParse = require('pdf-parse') as (data: Buffer) => Promise<{ text: string }>
  const result = await pdfParse(buffer)
  return result.text.trim()
}