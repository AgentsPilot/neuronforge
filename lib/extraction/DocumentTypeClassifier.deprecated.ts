/**
 * DocumentTypeClassifier
 *
 * Pattern-based document classification to route to appropriate extractor.
 * Classifies documents as: invoice, receipt, form, contract, or generic.
 */

import { createLogger } from '@/lib/logger';
import type { DocumentType, DocumentClassification } from './types';

const logger = createLogger({ module: 'DocumentTypeClassifier', service: 'extraction' });

// Classification patterns for each document type
const CLASSIFICATION_PATTERNS: Record<DocumentType, {
  patterns: RegExp[];
  weight: number;  // Base weight for this document type
}> = {
  invoice: {
    patterns: [
      /invoice/i,
      /inv(?:oice)?\s*(?:#|no\.?|number)/i,
      /bill\s*to/i,
      /amount\s*due/i,
      /payment\s*due/i,
      /subtotal/i,
      /tax\s*(?:amount|rate)?/i,
      /due\s*date/i,
      /purchase\s*order/i,
    ],
    weight: 1.0,
  },
  receipt: {
    patterns: [
      /receipt/i,
      /(?:sales|purchase)\s*receipt/i,
      /thank\s*you\s*for\s*(?:your\s*)?(?:purchase|order)/i,
      /transaction\s*(?:#|no\.?|number)/i,
      /card\s*ending/i,
      /paid\s*(?:by|with|via)/i,
      /change\s*due/i,
      /cash\s*back/i,
    ],
    weight: 0.9,
  },
  form: {
    patterns: [
      /(?:please\s*)?(?:fill|complete)\s*(?:out|in|the)/i,
      /\[\s*\]/g,  // Empty checkboxes
      /\[x\]/gi,   // Checked checkboxes
      /signature\s*(?:line|required|here)/i,
      /date\s*of\s*birth/i,
      /(?:first|last|middle)\s*name/i,
      /(?:street\s*)?address/i,
      /zip\s*(?:code)?/i,
      /social\s*security/i,
      /application\s*(?:form)?/i,
    ],
    weight: 0.85,
  },
  contract: {
    patterns: [
      /(?:this\s*)?agreement/i,
      /(?:this\s*)?contract/i,
      /(?:by\s*and\s*)?between/i,
      /party\s*[a-z]/i,
      /terms\s*and\s*conditions/i,
      /effective\s*date/i,
      /governing\s*law/i,
      /jurisdiction/i,
      /hereby\s*agree/i,
      /witness\s*whereof/i,
      /executed\s*(?:on|as\s*of)/i,
      /binding\s*(?:agreement|contract)/i,
    ],
    weight: 0.95,
  },
  generic: {
    patterns: [], // Fallback type
    weight: 0.3,
  },
};

export class DocumentTypeClassifier {
  /**
   * Classify a document based on its text content
   */
  classify(text: string): DocumentClassification {
    const normalizedText = text.toLowerCase();
    const scores: Record<DocumentType, { score: number; matches: string[] }> = {
      invoice: { score: 0, matches: [] },
      receipt: { score: 0, matches: [] },
      form: { score: 0, matches: [] },
      contract: { score: 0, matches: [] },
      generic: { score: 0, matches: [] },
    };

    // Score each document type based on pattern matches
    for (const [docType, config] of Object.entries(CLASSIFICATION_PATTERNS)) {
      if (docType === 'generic') continue;

      for (const pattern of config.patterns) {
        const matches = normalizedText.match(pattern);
        if (matches) {
          // Weight by number of matches (global patterns) or just 1
          const matchCount = pattern.global ? matches.length : 1;
          scores[docType as DocumentType].score += matchCount;
          scores[docType as DocumentType].matches.push(matches[0]);
        }
      }

      // Apply base weight
      scores[docType as DocumentType].score *= config.weight;
    }

    // Find the type with highest score
    let bestType: DocumentType = 'generic';
    let bestScore = 0;

    for (const [docType, { score }] of Object.entries(scores)) {
      if (score > bestScore) {
        bestScore = score;
        bestType = docType as DocumentType;
      }
    }

    // If best score is too low, classify as generic
    if (bestScore < 2) {
      bestType = 'generic';
    }

    // Calculate confidence (normalize score)
    const maxPossibleScore = 10; // Approximate max meaningful score
    const confidence = Math.min(bestScore / maxPossibleScore, 1);

    logger.info({
      classifiedAs: bestType,
      score: bestScore,
      confidence,
      matchCount: scores[bestType].matches.length,
    }, 'DocumentTypeClassifier: Classification complete');

    return {
      type: bestType,
      confidence,
      matchedPatterns: scores[bestType].matches.slice(0, 5), // Top 5 matches
    };
  }

  /**
   * Check if text matches a specific document type
   */
  isType(text: string, targetType: DocumentType): boolean {
    const classification = this.classify(text);
    return classification.type === targetType && classification.confidence > 0.3;
  }

  /**
   * Get all pattern matches for analysis
   */
  getDetailedAnalysis(text: string): Record<DocumentType, { score: number; matches: string[] }> {
    const normalizedText = text.toLowerCase();
    const analysis: Record<DocumentType, { score: number; matches: string[] }> = {
      invoice: { score: 0, matches: [] },
      receipt: { score: 0, matches: [] },
      form: { score: 0, matches: [] },
      contract: { score: 0, matches: [] },
      generic: { score: 0, matches: [] },
    };

    for (const [docType, config] of Object.entries(CLASSIFICATION_PATTERNS)) {
      if (docType === 'generic') continue;

      for (const pattern of config.patterns) {
        const matches = normalizedText.match(pattern);
        if (matches) {
          const matchCount = pattern.global ? matches.length : 1;
          analysis[docType as DocumentType].score += matchCount;
          // Add unique matches
          for (const match of (pattern.global ? matches : [matches[0]])) {
            if (!analysis[docType as DocumentType].matches.includes(match)) {
              analysis[docType as DocumentType].matches.push(match);
            }
          }
        }
      }

      analysis[docType as DocumentType].score *= config.weight;
    }

    return analysis;
  }
}
