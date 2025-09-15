// lib/outputInference.ts

interface OutputAction {
  id: string;
  type: 'EmailDraft' | 'Alert' | 'SummaryBlock' | 'PluginAction';
  category: 'human-facing' | 'machine-facing';
  name: string;
  description: string;
  plugin?: string;
  config: {
    subject?: string;
    recipient?: string;
    format?: string;
    destination?: string;
    template?: string;
  };
  required: boolean;
}

interface OutputInferenceResult {
  outputs: OutputAction[];
  reasoning: string[];
  confidence: number;
}

export class OutputTypeInference {
  private humanFacingKeywords = [
    'send', 'notify', 'alert', 'email', 'message', 'tell', 'inform', 
    'update', 'report', 'summarize', 'brief', 'dashboard', 'show'
  ];

  private machineFacingKeywords = [
    'save', 'store', 'upload', 'create', 'log', 'record', 'write',
    'update', 'sync', 'backup', 'archive', 'organize', 'file'
  ];

  private outputTypePatterns = {
    EmailDraft: ['email', 'send', 'notify', 'mail', 'message'],
    Alert: ['alert', 'notification', 'warn', 'urgent', 'critical'],
    SummaryBlock: ['summary', 'report', 'digest', 'overview', 'brief'],
    PluginAction: ['save', 'store', 'create', 'upload', 'sync', 'backup']
  };

  inferOutputs(
    prompt: string, 
    connectedPlugins: string[] = [],
    userPrompt: string = ''
  ): OutputInferenceResult {
    const fullText = `${prompt} ${userPrompt}`.toLowerCase();
    const reasoning: string[] = [];
    const outputs: OutputAction[] = [];

    // Step 1: Analyze primary intent
    const humanScore = this.calculateScore(fullText, this.humanFacingKeywords);
    const machineScore = this.calculateScore(fullText, this.machineFacingKeywords);

    reasoning.push(`Intent analysis: Human-facing (${humanScore}), Machine-facing (${machineScore})`);

    // Step 2: Detect specific output types
    const detectedTypes = this.detectOutputTypes(fullText);
    reasoning.push(`Detected output types: ${detectedTypes.map(d => d.type).join(', ')}`);

    // Step 3: Match plugin actions to connected plugins
    const pluginActions = this.inferPluginActions(fullText, connectedPlugins);
    reasoning.push(`Plugin actions: ${pluginActions.length} actions for ${connectedPlugins.length} connected plugins`);

    // Step 4: Generate outputs based on analysis
    let outputId = 1;

    // Add human-facing outputs
    detectedTypes.forEach(detected => {
      if (detected.category === 'human-facing') {
        outputs.push({
          id: `output_${outputId++}`,
          type: detected.type,
          category: 'human-facing',
          name: detected.name,
          description: detected.description,
          config: detected.config,
          required: true
        });
      }
    });

    // Add plugin actions
    pluginActions.forEach(action => {
      outputs.push({
        id: `output_${outputId++}`,
        type: 'PluginAction',
        category: 'machine-facing',
        name: action.name,
        description: action.description,
        plugin: action.plugin,
        config: action.config,
        required: true
      });
    });

    // Step 5: Add default outputs if none detected
    if (outputs.length === 0) {
      // Default to summary if no clear intent
      outputs.push({
        id: `output_${outputId++}`,
        type: 'SummaryBlock',
        category: 'human-facing',
        name: 'Results Summary',
        description: 'A formatted summary of the agent\'s work',
        config: { format: 'markdown', template: 'standard' },
        required: true
      });
      reasoning.push('No specific outputs detected - added default summary');
    }

    // Calculate confidence based on keyword matches and plugin availability
    const confidence = this.calculateConfidence(detectedTypes, pluginActions, connectedPlugins);

    return {
      outputs,
      reasoning,
      confidence
    };
  }

  private calculateScore(text: string, keywords: string[]): number {
    return keywords.reduce((score, keyword) => {
      const matches = (text.match(new RegExp(keyword, 'g')) || []).length;
      return score + matches;
    }, 0);
  }

  private detectOutputTypes(text: string): Array<{
    type: OutputAction['type'];
    category: OutputAction['category'];
    name: string;
    description: string;
    config: any;
    confidence: number;
  }> {
    const detected = [];

    // EmailDraft detection
    if (this.hasPatterns(text, this.outputTypePatterns.EmailDraft)) {
      detected.push({
        type: 'EmailDraft' as const,
        category: 'human-facing' as const,
        name: 'Email Notification',
        description: 'Send results via email',
        config: { 
          subject: this.extractEmailSubject(text) || 'Agent Results',
          format: 'html'
        },
        confidence: this.calculateScore(text, this.outputTypePatterns.EmailDraft)
      });
    }

    // Alert detection
    if (this.hasPatterns(text, this.outputTypePatterns.Alert)) {
      detected.push({
        type: 'Alert' as const,
        category: 'human-facing' as const,
        name: 'System Alert',
        description: 'Send alert notification when conditions are met',
        config: { format: 'notification' },
        confidence: this.calculateScore(text, this.outputTypePatterns.Alert)
      });
    }

    // SummaryBlock detection
    if (this.hasPatterns(text, this.outputTypePatterns.SummaryBlock)) {
      detected.push({
        type: 'SummaryBlock' as const,
        category: 'human-facing' as const,
        name: 'Summary Report',
        description: 'Generate a formatted summary of results',
        config: { 
          format: this.detectSummaryFormat(text),
          template: 'standard'
        },
        confidence: this.calculateScore(text, this.outputTypePatterns.SummaryBlock)
      });
    }

    return detected.sort((a, b) => b.confidence - a.confidence);
  }

  private inferPluginActions(text: string, connectedPlugins: string[]): Array<{
    name: string;
    description: string;
    plugin: string;
    config: any;
  }> {
    const actions = [];

    connectedPlugins.forEach(plugin => {
      const action = this.getPluginAction(text, plugin);
      if (action) {
        actions.push(action);
      }
    });

    return actions;
  }

  private getPluginAction(text: string, plugin: string): any {
    const pluginActions = {
      'google-drive': {
        patterns: ['save', 'store', 'upload', 'drive', 'file'],
        action: {
          name: 'Save to Google Drive',
          description: 'Save results as a file in Google Drive',
          plugin: 'google-drive',
          config: {
            destination: this.extractDrivePath(text) || '/Agent Results',
            format: this.detectFileFormat(text)
          }
        }
      },
      'notion': {
        patterns: ['notion', 'page', 'database', 'create', 'log'],
        action: {
          name: 'Update Notion',
          description: 'Create or update a Notion page with results',
          plugin: 'notion',
          config: {
            destination: 'auto-detect',
            format: 'page'
          }
        }
      },
      'slack': {
        patterns: ['slack', 'message', 'post', 'channel'],
        action: {
          name: 'Post to Slack',
          description: 'Send results to a Slack channel',
          plugin: 'slack',
          config: {
            destination: 'general',
            format: 'message'
          }
        }
      },
      'gmail': {
        patterns: ['gmail', 'send', 'email'],
        action: {
          name: 'Send via Gmail',
          description: 'Send results via Gmail',
          plugin: 'gmail',
          config: {
            format: 'email'
          }
        }
      }
    };

    const pluginConfig = pluginActions[plugin as keyof typeof pluginActions];
    if (!pluginConfig) return null;

    const hasPattern = pluginConfig.patterns.some(pattern => 
      text.includes(pattern)
    );

    return hasPattern ? pluginConfig.action : null;
  }

  private hasPatterns(text: string, patterns: string[]): boolean {
    return patterns.some(pattern => text.includes(pattern));
  }

  private extractEmailSubject(text: string): string | null {
    // Try to extract subject from common patterns
    const subjectPatterns = [
      /subject:?\s*"([^"]+)"/i,
      /title:?\s*"([^"]+)"/i,
      /with subject\s*"([^"]+)"/i
    ];

    for (const pattern of subjectPatterns) {
      const match = text.match(pattern);
      if (match) return match[1];
    }

    return null;
  }

  private extractDrivePath(text: string): string | null {
    const pathPatterns = [
      /(?:folder|path|directory):?\s*"([^"]+)"/i,
      /save (?:to|in)\s*"([^"]+)"/i,
      /\/[A-Za-z\s\/]+/g
    ];

    for (const pattern of pathPatterns) {
      const match = text.match(pattern);
      if (match) return match[1] || match[0];
    }

    return null;
  }

  private detectSummaryFormat(text: string): string {
    if (text.includes('pdf')) return 'pdf';
    if (text.includes('markdown') || text.includes('md')) return 'markdown';
    if (text.includes('html')) return 'html';
    if (text.includes('json')) return 'json';
    return 'markdown'; // default
  }

  private detectFileFormat(text: string): string {
    if (text.includes('pdf')) return 'pdf';
    if (text.includes('csv')) return 'csv';
    if (text.includes('json')) return 'json';
    if (text.includes('txt')) return 'txt';
    return 'pdf'; // default for most saves
  }

  private calculateConfidence(
    detectedTypes: any[], 
    pluginActions: any[], 
    connectedPlugins: string[]
  ): number {
    let confidence = 0.5; // base confidence

    // Increase confidence for detected patterns
    confidence += detectedTypes.length * 0.15;
    confidence += pluginActions.length * 0.1;

    // Boost confidence if plugin actions match connected plugins
    if (pluginActions.length > 0 && connectedPlugins.length > 0) {
      confidence += 0.2;
    }

    // Cap at 0.95
    return Math.min(confidence, 0.95);
  }
}

// Usage example for the enhanced generate agent API
export function enhanceOutputInference(
  prompt: string,
  clarificationAnswers: Record<string, any>,
  connectedPlugins: string[]
): OutputInferenceResult {
  const inference = new OutputTypeInference();
  
  // Combine prompt with clarification answers for better inference
  const fullContext = `${prompt}\n\n${Object.entries(clarificationAnswers)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n')}`;

  return inference.inferOutputs(fullContext, connectedPlugins, prompt);
}