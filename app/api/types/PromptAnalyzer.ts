// app/api/types/PromptAnalyzer.ts

// Basic types for prompt analysis
export interface PromptAnalyzerRequirementStatus {
  status: 'clear' | 'partial' | 'missing'
  detected: string
}

export interface PromptAnalyzerRequirementsAnalysis {
  data: PromptAnalyzerRequirementStatus
  timing: PromptAnalyzerRequirementStatus
  output: PromptAnalyzerRequirementStatus
  actions: PromptAnalyzerRequirementStatus
  delivery: PromptAnalyzerRequirementStatus
  error_handling: PromptAnalyzerRequirementStatus
}

export interface PromptAnalyzerSchedulingOption {
  value: string
  label: string
  description: string
}

export interface PromptAnalyzerSchedulingQuestion {
  id: string
  dimension: string
  question: string
  type: string
  options: PromptAnalyzerSchedulingOption[]
  allowCustom: boolean
}

export interface PromptAnalyzerServicesCheck {
  mentionedServices: string[]
  missingServices: string[]
}

export interface PromptAnalyzerServicesWarning {
  hasWarning?: boolean
  missingServices: string[]
  message: string
}

/**
 * PromptAnalyzer - A helper class for analyzing and understanding user prompts
 * Provides methods to extract requirements, detect services, and generate clarification questions
 *
 * This class has NO external dependencies and uses only basic types
 */
export class PromptAnalyzer {
  private prompt: string
  private promptLower: string

  constructor(prompt: string) {
    this.prompt = prompt.trim()
    this.promptLower = this.prompt.toLowerCase()
  }

  /**
   * Get the original prompt
   */
  getPrompt(): string {
    return this.prompt
  }

  /**
   * Get the lowercase version of the prompt
   */
  getPromptLower(): string {
    return this.promptLower
  }

  /**
   * Check if has prompt
   */
  hasPrompt(): boolean {
    return this.prompt !== ''
  }

  /**
   * Check if any of the provided keywords exist in the prompt
   * @param keywords - Array of keywords to check
   * @returns true if any keyword is found in the prompt (case-insensitive)
   */
  containsAny(keywords: string[]): boolean {
    return keywords.some(keyword => this.promptLower.includes(keyword.toLowerCase()))
  }

  /**
   * Check if all of the provided keywords exist in the prompt
   * @param keywords - Array of keywords to check
   * @returns true if all keywords are found in the prompt (case-insensitive)
   */
  containsAll(keywords: string[]): boolean {
    return keywords.every(keyword => this.promptLower.includes(keyword.toLowerCase()))
  }

  /**
   * Analyze all requirements from the prompt
   */
  analyzeRequirements(clarityScore: number, serviceNames: string[] = []): PromptAnalyzerRequirementsAnalysis {
    console.log('🔍 PromptAnalyzer: Analyzing requirements for prompt:', this.prompt.slice(0, 100))
    console.log('🔍 PromptAnalyzer: Connected plugins for analysis:', serviceNames)

    const analysis: PromptAnalyzerRequirementsAnalysis = {
      data: this.analyzeDataRequirement(),
      timing: this.analyzeTimingRequirement(),
      output: this.analyzeOutputRequirement(),
      actions: this.analyzeActionsRequirement(serviceNames),
      delivery: this.analyzeDeliveryRequirement(serviceNames),
      error_handling: this.analyzeErrorHandlingRequirement()
    }

    console.log('✅ PromptAnalyzer: Requirements analysis completed:', analysis)
    return analysis
  }

  /**
   * Analyze data sources mentioned in the prompt
   */
  analyzeDataRequirement(): PromptAnalyzerRequirementStatus {
    // Look for data sources
    if (this.containsAny(['email', 'inbox'])) {
      if (this.containsAny(['last 10', 'recent 10'])) {
        return { status: 'clear', detected: 'Last 10 emails' }
      }
      if (this.promptLower.includes('unread')) {
        return { status: 'clear', detected: 'Unread emails' }
      }
      if (this.promptLower.includes('all emails')) {
        return { status: 'clear', detected: 'All emails' }
      }
      return { status: 'partial', detected: 'Emails (criteria unclear)' }
    }

    if (this.containsAny(['file', 'document'])) {
      return { status: 'partial', detected: 'Files/documents' }
    }

    if (this.containsAny(['calendar', 'meeting'])) {
      return { status: 'partial', detected: 'Calendar data' }
    }

    if (this.containsAny(['spreadsheet', 'sheet'])) {
      return { status: 'partial', detected: 'Spreadsheet data' }
    }

    return { status: 'missing', detected: '' }
  }

  /**
   * Analyze timing/schedule indicators in the prompt
   */
  analyzeTimingRequirement(): PromptAnalyzerRequirementStatus {
    // Look for timing indicators
    if (this.promptLower.includes('daily')) {
      return { status: 'clear', detected: 'Daily' }
    }
    if (this.promptLower.includes('weekly')) {
      if (this.promptLower.includes('monday')) {
        return { status: 'clear', detected: 'Weekly on Monday' }
      }
      return { status: 'clear', detected: 'Weekly' }
    }
    if (this.promptLower.includes('monthly')) {
      return { status: 'clear', detected: 'Monthly' }
    }
    if (this.promptLower.includes('every')) {
      if (this.promptLower.includes('hour')) {
        return { status: 'clear', detected: 'Every hour' }
      }
      return { status: 'partial', detected: 'Recurring schedule' }
    }
    if (this.promptLower.includes('hourly') || this.promptLower.includes('hour')) {
      return { status: 'clear', detected: 'Hourly' }
    }

    return { status: 'missing', detected: '' }
  }

  /**
   * Analyze output format expectations in the prompt
   */
  analyzeOutputRequirement(): PromptAnalyzerRequirementStatus {
    // Look for output types
    if (this.containsAny(['summary', 'summarize'])) {
      if (this.promptLower.includes('email summary')) {
        return { status: 'clear', detected: 'Email summary document' }
      }
      return { status: 'clear', detected: 'Summary document' }
    }

    if (this.promptLower.includes('report')) {
      return { status: 'clear', detected: 'Report' }
    }

    if (this.containsAny(['alert', 'notification'])) {
      return { status: 'clear', detected: 'Alert/notification' }
    }

    if (this.containsAny(['create', 'generate'])) {
      return { status: 'partial', detected: 'Generated content' }
    }

    if (this.promptLower.includes('document')) {
      return { status: 'partial', detected: 'Document' }
    }

    return { status: 'missing', detected: '' }
  }

  /**
   * Analyze actions and map them to available services
   */
  analyzeActionsRequirement(serviceDisplayNames: string[]): PromptAnalyzerRequirementStatus {
    const actions: string[] = []

    // Detect specific actions
    if (this.containsAll(['read', 'email'])) {
      actions.push('Read emails')
    }
    if (this.containsAny(['summarize', 'summary'])) {
      actions.push('Summarize content')
    }
    if (this.containsAny(['save', 'store'])) {
      actions.push('Save data')
    }
    if (this.containsAll(['send', 'email'])) {
      actions.push('Send email')
    }
    if (this.containsAny(['upload', 'drive'])) {
      actions.push('Upload to Drive')
    }
    if (this.containsAny(['analyze', 'analysis'])) {
      actions.push('Analyze data')
    }

    // Build actions string with connected services
    if (actions.length > 0 && serviceDisplayNames.length > 0) {
      return {
        status: 'clear',
        detected: `${actions.join(', ')} using ${serviceDisplayNames.join(', ')}`
      }
    }

    if (actions.length > 0) {
      return { status: 'partial', detected: actions.join(', ') }
    }

    // Fallback based on connected services
    if (serviceDisplayNames.length > 0) {
      return {
        status: 'partial',
        detected: `Summarize and save to ${serviceDisplayNames.join(', ')}`
      }
    }

    return { status: 'missing', detected: '' }
  }

  /**
   * Analyze delivery methods in the prompt
   */
  analyzeDeliveryRequirement(serviceDisplayNames: string[]): PromptAnalyzerRequirementStatus {
    // Look for delivery methods
    if (this.containsAll(['send to', 'manager'])) {
      return { status: 'clear', detected: 'Send to manager' }
    }

    if (this.containsAll(['email', 'send']) || this.containsAll(['email', 'to'])) {
      return { status: 'partial', detected: 'Send via email' }
    }

    if (this.containsAny(['save to', 'upload to'])) {
      return { status: 'partial', detected: 'Save/upload to service' }
    }

    if (this.containsAny(['notification', 'alert'])) {
      return { status: 'partial', detected: 'Send notification' }
    }

    // Use connected services for delivery
    if (serviceDisplayNames.length > 0) {
      return {
        status: 'partial',
        detected: `Deliver via ${serviceDisplayNames.join(', ')}`
      }
    }

    return { status: 'missing', detected: '' }
  }

  /**
   * Analyze error handling mentions in the prompt
   */
  analyzeErrorHandlingRequirement(): PromptAnalyzerRequirementStatus {
    // Look for error handling mentions
    if (this.containsAny(['error', 'fail'])) {
      return { status: 'clear', detected: 'Error handling specified' }
    }

    if (this.containsAny(['retry', 'try again'])) {
      return { status: 'clear', detected: 'Retry on failure' }
    }

    if (this.promptLower.includes('if') && this.containsAny(['problem', 'issue'])) {
      return { status: 'partial', detected: 'Basic error handling' }
    }

    // Most users don't specify error handling - this is expected
    return { status: 'missing', detected: '' }
  }

  /**
   * Check if prompt already has timing specified
   */
  hasTimingInPrompt(): boolean {
    return this.containsAny(['daily', 'weekly', 'monthly', 'every', 'schedule']) ||
           /\d+\s*(am|pm|hour|minute)/.test(this.promptLower)
  }

  /**
   * Check if prompt already has timing specified
   */
  hasErrorHandlingInPrompt(specificKetwords?: string[]): boolean {
    const errorHandlingKeywords = ['error','fail','retry','notify', 'issue', 'problem', 'retry', 'try again', ...specificKetwords?specificKetwords:[]];
    return this.containsAny(errorHandlingKeywords);
  }

  /**
   * Generate context-aware scheduling questions based on prompt and plugin capabilities
   * @param hasEmailCapabilities - Whether connected plugins have email capabilities
   * @param hasFileCapabilities - Whether connected plugins have file capabilities
   */
  generateSchedulingQuestions(hasEmailCapabilities: boolean, hasFileCapabilities: boolean): PromptAnalyzerSchedulingQuestion[] {
    // Check if user already specified timing in prompt
    if (this.hasTimingInPrompt()) {
      console.log('PromptAnalyzer: Timing already specified in prompt, skipping scheduling questions')
      return []
    }

    // Email automations
    if (hasEmailCapabilities && this.containsAny(['email', 'inbox', 'google-mail'])) {
      return [
        {
          id: 'email_schedule',
          dimension: 'timing',
          question: "When should this email automation run?",
          type: 'single_choice',
          options: [
            { value: 'new_emails', label: 'When new emails arrive', description: 'Process emails immediately as they come in (real-time)' },
            { value: 'daily_9am', label: 'Daily at 9:00 AM', description: 'Process all unread emails once per day' },
            { value: 'daily_8am', label: 'Daily at 8:00 AM', description: 'Start of day email processing' },
            { value: 'every_2h_work', label: 'Every 2 hours (9 AM - 5 PM)', description: 'Regular processing during work hours' },
            { value: 'twice_daily', label: 'Twice daily (9 AM & 5 PM)', description: 'Morning and evening processing' },
            { value: 'weekly_monday', label: 'Weekly on Monday 9 AM', description: 'Weekly email summary' }
          ],
          allowCustom: false
        }
      ]
    }

    // File processing automations
    if (hasFileCapabilities && this.containsAny(['file', 'drive', 'upload'])) {
      return [
        {
          id: 'file_schedule',
          dimension: 'timing',
          question: "When should this file automation run?",
          type: 'single_choice',
          options: [
            { value: 'on_change', label: 'When files change', description: 'Process files immediately when they are added or modified' },
            { value: 'daily_2am', label: 'Daily at 2:00 AM', description: 'Process files during off-hours' },
            { value: 'weekly_sunday', label: 'Weekly on Sunday', description: 'Weekly file processing' },
            { value: 'manual_trigger', label: 'Manual trigger only', description: 'Run only when manually triggered' }
          ],
          allowCustom: true
        }
      ]
    }

    // Default for general automations
    return [
      {
        id: 'automation_schedule',
        dimension: 'timing',
        question: "When should this automation run?",
        type: 'single_choice',
        options: [
          { value: 'daily_9am', label: 'Daily at 9:00 AM', description: 'Once per day at start of work' },
          { value: 'weekly_monday', label: 'Weekly on Monday 9:00 AM', description: 'Once per week at start of work week' },
          { value: 'monthly_1st', label: 'Monthly on 1st at 9:00 AM', description: 'Once per month on first day' },
          { value: 'on_demand', label: 'On-demand only', description: 'Manual trigger when needed' },
          { value: 'twice_daily', label: 'Twice daily (9 AM & 5 PM)', description: 'Start and end of work day' }
        ],
        allowCustom: true
      }
    ]
  }

  /**
   * Check if user mentioned unconnected services (for warning)
   * @param connectedServices - Array of connected plugin keys
   * @param availableServices - Map of {pluginKey: pluginName} for all available plugins
   * @param commonServices - Optional map of {serviceKey: keywords[]} for additional services to check
   */
  checkMentionedServices(    
    connectedServices: string[],
    availableServices: string[],
    commonServices?: Record<string, string[]>
  ): PromptAnalyzerServicesCheck {    
    const mentionedServices: string[] = []

    console.log('🔍PromptAnalyzer: checkMentionedServices - Connected Services:', connectedServices)

    // Check against available Services
    for (const serviceName of availableServices) {      
      const keyVariations = [
        serviceName.toLowerCase(),
        serviceName,
        serviceName.replace(/\s+/g, ''),
        serviceName.replace(/\s+/g, '_'),
        serviceName.replace(/\s+/g, '-')
      ]

      const isDetected = keyVariations.some(variation =>
        this.promptLower.includes(variation)
      )

      if (isDetected && !mentionedServices.includes(serviceName)) {
        mentionedServices.push(serviceName)
      }
    }
    
    // Check for commonly mentioned services if provided
    if (commonServices) {
      for (const [serviceKey, keywords] of Object.entries(commonServices)) {
        const isDetected = keywords.some(keyword => this.promptLower.includes(keyword))
        if (isDetected && !mentionedServices.includes(serviceKey)) {
          mentionedServices.push(serviceKey)
        }
      }
    }

    console.log('🔍PromptAnalyzer: checkMentionedServices -  Detected mentioned services:', mentionedServices)

    // Find missing services - services mentioned but not connected
    const missingServices = mentionedServices.filter(service =>
      !connectedServices.includes(service)
    )

    console.log('🔍PromptAnalyzer: checkMentionedServices -  Missing services:', missingServices)

    return { mentionedServices, missingServices }
  }

  /**
   * Apply consistency checks and add scheduling questions
   * @param result - The AI analysis result to validate
   * @param hasEmailCapabilities - Whether connected plugins have email capabilities
   * @param hasFileCapabilities - Whether connected plugins have file capabilities
   */
  validateConsistency(result: any, hasEmailCapabilities: boolean, hasFileCapabilities: boolean): any {
    const scheduleQuestions = this.generateSchedulingQuestions(hasEmailCapabilities, hasFileCapabilities)
    console.log(`PromptAnalyzer: Generated ${scheduleQuestions.length} scheduling questions for consistency check`)

    if (scheduleQuestions.length > 0) {
      result.questionsSequence = [...(result.questionsSequence || []), ...scheduleQuestions]
      console.log(`PromptAnalyzer: Added ${scheduleQuestions.length} scheduling questions. Total questions: ${result.questionsSequence.length}`)
    }

    const finalQuestionCount = result.questionsSequence?.length || 0

    // Adjust clarity score if it doesn't match question count
    if (result.clarityScore > 75 && finalQuestionCount > 2) {
      console.log('PromptAnalyzer: Adjusting clarity score due to high question count')
      result.clarityScore = Math.max(55, result.clarityScore - (finalQuestionCount * 10))
    }

    // Always need clarification if we have any questions (including scheduling)
    result.needsClarification = finalQuestionCount > 0 || result.clarityScore < 65

    return result
  }

  /**
   * Validates if user mentioned missing services and generates a warning
   * @param connectedServices - Array of connected plugin keys
   * @param availableServices - Map of {pluginKey: pluginName} for all available plugins
   * @param commonServices - Optional map of {serviceKey: keywords[]} for additional services to check
   */
  generateWarningIfMenthodMissingServices(    
    connectedServices: string[],
    availableServices: string[],
    commonServices?: Record<string, string[]>
  ): PromptAnalyzerServicesWarning {
    const { mentionedServices, missingServices } = this.checkMentionedServices(connectedServices, availableServices, commonServices);
    let pluginWarning: PromptAnalyzerServicesWarning = { hasWarning: false, missingServices: [], message: '' };

    if (missingServices.length > 0) {
      console.log('⚠️ PromptAnalyzer: User mentioned unconnected services:', missingServices)
      
      // TO REMOVE
      //const missingDisplayNames = missingServices.map(service => pluginManager.getPluginDisplayName(service));
      //const missingDisplayNames = missingServices;
      
      const pluginWarning: PromptAnalyzerServicesWarning = {
        hasWarning: true,
        missingServices: missingServices,
        message: `Note: Your request mentions ${missingServices.join(', ')} but ${missingServices.length === 1 ? 'this service isn\'t' : 'these services aren\'t'} connected. Questions will focus on connected services only.`
      }
      console.log('✅ Plugin warning created:', pluginWarning.message)
    }
    return pluginWarning;
  }
}
