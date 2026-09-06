/**
 * Heebo Font for jsPDF
 *
 * This file contains the Heebo font (Variable Weight) embedded as base64
 * for use in PDF generation with Hebrew text support.
 *
 * Font: Heebo (Google Fonts)
 * License: SIL Open Font License 1.1
 */

import { jsPDF } from 'jspdf';
import * as fs from 'fs';
import * as path from 'path';

let heeboFontBase64: string | null = null;

/**
 * Load the Heebo font from file (lazy loading)
 */
function loadHeeboFont(): string {
  if (heeboFontBase64) {
    return heeboFontBase64;
  }

  const fontPath = path.join(process.cwd(), 'lib/pdf/fonts/Heebo-VariableFont_wght.ttf');
  const fontBuffer = fs.readFileSync(fontPath);
  heeboFontBase64 = fontBuffer.toString('base64');
  return heeboFontBase64;
}

/**
 * Register the Heebo font with a jsPDF document
 * Must be called before using the font
 */
export function registerHeeboFont(doc: jsPDF): void {
  const fontData = loadHeeboFont();

  // Add font to virtual file system
  doc.addFileToVFS('Heebo-Regular.ttf', fontData);

  // Register the font
  doc.addFont('Heebo-Regular.ttf', 'Heebo', 'normal');
}

/**
 * Check if a string contains Hebrew characters
 */
export function containsHebrew(text: string): boolean {
  // Hebrew Unicode range: \u0590-\u05FF
  return /[\u0590-\u05FF]/.test(text);
}

/**
 * Reverse text for RTL display in jsPDF
 * jsPDF doesn't natively support RTL, so we need to reverse the text
 * This also handles mixed Hebrew/Latin text
 */
export function reverseForRTL(text: string): string {
  if (!containsHebrew(text)) {
    return text;
  }

  // Split into segments of Hebrew and non-Hebrew
  const segments: { text: string; isHebrew: boolean }[] = [];
  let currentSegment = '';
  let isCurrentHebrew = false;

  for (const char of text) {
    const charIsHebrew = /[\u0590-\u05FF]/.test(char);

    if (currentSegment === '') {
      currentSegment = char;
      isCurrentHebrew = charIsHebrew;
    } else if (charIsHebrew === isCurrentHebrew) {
      currentSegment += char;
    } else {
      segments.push({ text: currentSegment, isHebrew: isCurrentHebrew });
      currentSegment = char;
      isCurrentHebrew = charIsHebrew;
    }
  }

  if (currentSegment) {
    segments.push({ text: currentSegment, isHebrew: isCurrentHebrew });
  }

  // Reverse Hebrew segments and the overall order for RTL
  const processedSegments = segments.map(seg => {
    if (seg.isHebrew) {
      // Reverse Hebrew characters
      return seg.text.split('').reverse().join('');
    }
    return seg.text;
  });

  // Reverse the order of all segments for RTL flow
  return processedSegments.reverse().join('');
}

/**
 * Process text for RTL PDF rendering
 * Returns the processed text and alignment
 */
export function processTextForPDF(
  text: string,
  language: 'en' | 'es' | 'he'
): { text: string; align: 'left' | 'right' } {
  if (language === 'he' || containsHebrew(text)) {
    return {
      text: reverseForRTL(text),
      align: 'right'
    };
  }
  return { text, align: 'left' };
}
