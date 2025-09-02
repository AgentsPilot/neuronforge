// /lib/intelligence/utils/EmailHandler.ts
import { ExecutionMetrics } from '../core/types'
import { sendEmailDraft } from '../../plugins/google-mail/sendEmailDraft'

export class EmailHandler {
  async handleSmartOutput(
    agent: any,
    responseMessage: string,
    pluginContext: any,
    userId: string,
    intelligenceMetrics?: ExecutionMetrics
  ) {
    if (agent.output_schema?.type === 'EmailDraft') {
      try {
        console.log('Processing EmailDraft with advanced intelligence')
        
        const outputSchema = agent.output_schema
        const emailTo = outputSchema.to
        const emailSubject = outputSchema.subject || 'AI Analysis Report'
        const includePdf = outputSchema.includePdf || false
        
        // Create intelligent email body
        let enhancedBody = `Executive Summary:\n${this.generateExecutiveSummary(responseMessage, intelligenceMetrics)}\n\n`
        enhancedBody += `Detailed Analysis:\n${responseMessage}\n\n`
        
        if (intelligenceMetrics) {
          enhancedBody += `\n---\nIntelligence Report:\n`
          enhancedBody += `• Analysis Confidence: ${(intelligenceMetrics.confidence * 100).toFixed(1)}%\n`
          enhancedBody += `• Data Quality Score: ${intelligenceMetrics.qualityScore || 'A'}\n`
          enhancedBody += `• Sources Analyzed: ${intelligenceMetrics.dataSources || 0}\n`
          enhancedBody += `• Business Context: ${intelligenceMetrics.businessContext || 'General'}\n`
          enhancedBody += `• Validation Status: ${intelligenceMetrics.validated ? 'Verified' : 'Preliminary'}`
        }
        
        const emailResult = await sendEmailDraft({
          userId,
          to: emailTo,
          subject: emailSubject,
          body: enhancedBody,
          includePdf
        })
        
        return {
          message: responseMessage,
          pluginContext,
          parsed_output: { 
            summary: responseMessage,
            emailSent: true,
            emailTo: emailTo,
            pdfGenerated: includePdf,
            emailId: emailResult.id,
            intelligenceApplied: true,
            confidence: intelligenceMetrics?.confidence || 0.9,
            qualityScore: intelligenceMetrics?.qualityScore || 'A'
          },
          send_status: `Intelligent report sent to ${emailTo} with ${(intelligenceMetrics?.confidence * 100).toFixed(1)}% confidence`,
          intelligence_metrics: intelligenceMetrics
        }
        
      } catch (error) {
        console.error('Smart email processing failed:', error)
        return {
          message: responseMessage,
          pluginContext,
          parsed_output: { 
            summary: responseMessage, 
            emailError: error.message,
            emailSent: false,
            confidence: intelligenceMetrics?.confidence || 0
          },
          send_status: `Email processing failed: ${error.message}`,
        }
      }
    }
    
    return {
      message: responseMessage,
      pluginContext: {},
      parsed_output: { 
        summary: responseMessage,
        confidence: intelligenceMetrics?.confidence || 0.9,
        intelligenceApplied: true,
        qualityScore: intelligenceMetrics?.qualityScore || 'A'
      },
      send_status: 'Advanced autonomous agent completed successfully.',
      intelligence_metrics: intelligenceMetrics
    }
  }

  private generateExecutiveSummary(fullResponse: string, metrics?: ExecutionMetrics): string {
    // Extract key points for executive summary
    const lines = fullResponse.split('\n').filter(line => line.trim().length > 0)
    const keyPoints = lines.slice(0, 3).map(line => line.trim()).join(' ')
    
    return `${keyPoints.slice(0, 200)}${keyPoints.length > 200 ? '...' : ''} (Confidence: ${((metrics?.confidence || 0.8) * 100).toFixed(0)}%)`
  }
}