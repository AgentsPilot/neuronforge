// /lib/intelligence/validation/QualityValidator.ts

export class QualityValidator {
  static validateResponse(response: string, originalData: any, intent: any): {
    score: number
    grade: string
    confidence: number
    issues: string[]
    actuallyUseful: boolean
  } {
    
    const issues: string[] = []
    let score = 0.5 // Start neutral
    
    // Check if response contains actual extracted data
    const hasSpecificData = this.containsSpecificData(response, originalData)
    const isJustDisclaimer = this.isJustDisclaimerResponse(response)
    
    if (hasSpecificData && !isJustDisclaimer) {
      // This is what we want - actual useful information
      score += 0.4
      
      // Bonus points for structure
      if (this.hasGoodStructure(response)) {
        score += 0.2
      }
      
      // Check completeness based on available data
      if (this.isComplete(response, originalData)) {
        score += 0.2
      }
      
    } else if (isJustDisclaimer) {
      // Heavily penalize disclaimer-only responses when we have good data
      if (this.hasExtractableData(originalData)) {
        score = 0.1 // Very low score for useless responses
        issues.push("Response hides behind disclaimers instead of providing extracted data")
      }
    }
    
    // Additional quality checks
    if (response.length < 100 && !this.isValidShortResponse(response)) {
      score -= 0.1
      issues.push("Response too brief")
    }
    
    if (this.hasVagueLanguage(response) && hasSpecificData === false) {
      score -= 0.2
      issues.push("Response uses vague corporate language instead of specific information")
    }
    
    const finalScore = Math.max(0.1, Math.min(1.0, score))
    const grade = this.scoreToGrade(finalScore)
    const confidence = this.calculateConfidence(finalScore, hasSpecificData, originalData)
    
    return {
      score: finalScore,
      grade,
      confidence,
      issues,
      actuallyUseful: hasSpecificData && !isJustDisclaimer
    }
  }
  
  private static containsSpecificData(response: string, originalData: any): boolean {
    // Check if response contains actual extracted information
    const responseText = response.toLowerCase()
    
    // Look for specific invoice data patterns
    const hasInvoiceNumbers = /(?:invoice|#)\s*(?:number|#)?\s*[:\-]?\s*[a-z0-9\-]+/i.test(response)
    const hasAmounts = /\$\s*[\d,]+(?:\.\d{2})?/.test(response)
    const hasDates = /\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2}|\w+ \d{1,2}, \d{4}/.test(response)
    
    // Check if original data has extractable info
    const originalHasData = this.hasExtractableData(originalData)
    
    if (originalHasData) {
      // If we have extractable data, response should contain specific details
      return hasInvoiceNumbers || hasAmounts || hasDates
    }
    
    return false
  }
  
  private static isJustDisclaimerResponse(response: string): boolean {
    const disclaimerKeywords = [
      'however, due to',
      'limited quality',
      'grade f',
      'reliability is questionable',
      'accuracy is compromised',
      'cannot be confirmed with certainty',
      'recommended to manually verify',
      'inherent quality of the source data',
      'data quality issues',
      'constraints on the accuracy'
    ]
    
    const responseText = response.toLowerCase()
    const disclaimerCount = disclaimerKeywords.filter(keyword => 
      responseText.includes(keyword)
    ).length
    
    // If it has many disclaimer phrases and little specific data, it's just a disclaimer
    return disclaimerCount >= 3 && !this.containsSpecificData(response, null)
  }
  
  private static hasExtractableData(originalData: any): boolean {
    if (!originalData) return false
    
    // Check if we have PDFs with actual text content
    if (originalData.emails) {
      for (const email of originalData.emails) {
        if (email.attachments) {
          for (const attachment of email.attachments) {
            if ((attachment.pdfText || attachment.extractedText) && 
                (attachment.pdfText || attachment.extractedText).length > 50) {
              return true
            }
          }
        }
      }
    }
    
    return false
  }
  
  private static hasGoodStructure(response: string): boolean {
    // Check for organized presentation
    const hasHeaders = /^#+\s/m.test(response) || response.includes('**')
    const hasList = /^\s*[\-\*\d\.]/m.test(response)
    const hasNumbers = /\d+\./g.test(response)
    
    return hasHeaders || hasList || hasNumbers
  }
  
  private static isComplete(response: string, originalData: any): boolean {
    if (!this.hasExtractableData(originalData)) return true
    
    // If we have extractable data, check if response covers the main elements
    const hasInvoiceInfo = response.toLowerCase().includes('invoice')
    const hasAmountInfo = response.includes('$') || response.toLowerCase().includes('amount')
    const hasDateInfo = /\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2}|\w+ \d{1,2}, \d{4}/.test(response)
    
    return hasInvoiceInfo && (hasAmountInfo || hasDateInfo)
  }
  
  private static isValidShortResponse(response: string): boolean {
    // A short response is valid if it's a clear "no data found" or similar
    const validShortPhrases = [
      'no invoices found',
      'no data available',
      'no relevant information',
      'search returned no results'
    ]
    
    const responseText = response.toLowerCase()
    return validShortPhrases.some(phrase => responseText.includes(phrase))
  }
  
  private static hasVagueLanguage(response: string): boolean {
    const vagueKeywords = [
      'may not be fully accurate',
      'questionable given the data quality',
      'cannot be confirmed with certainty',
      'it is assumed that',
      'the reliability of these figures is questionable',
      'accuracy is compromised',
      'consider improvements in data extraction'
    ]
    
    const responseText = response.toLowerCase()
    return vagueKeywords.filter(keyword => responseText.includes(keyword)).length >= 2
  }
  
  private static scoreToGrade(score: number): string {
    if (score >= 0.9) return 'A+'
    if (score >= 0.85) return 'A'
    if (score >= 0.8) return 'A-'
    if (score >= 0.75) return 'B+'
    if (score >= 0.7) return 'B'
    if (score >= 0.65) return 'B-'
    if (score >= 0.6) return 'C+'
    if (score >= 0.55) return 'C'
    if (score >= 0.5) return 'C-'
    if (score >= 0.4) return 'D'
    return 'F'
  }
  
  private static calculateConfidence(score: number, hasSpecificData: boolean, originalData: any): number {
    let confidence = score
    
    // Boost confidence if we have specific data and extractable source data
    if (hasSpecificData && this.hasExtractableData(originalData)) {
      confidence += 0.2
    }
    
    // Reduce confidence for vague responses when we should have good data
    if (!hasSpecificData && this.hasExtractableData(originalData)) {
      confidence *= 0.5
    }
    
    return Math.max(0.1, Math.min(1.0, confidence))
  }
}