import React from 'react';
import { getPluginByKey, pluginList, getPluginsByCategory } from '@/lib/plugins/pluginList';
import type { PluginStep, RequiredInput, Output } from './types';

export interface GeneratedPlan {
  steps: PluginStep[];
  requiredInputs: RequiredInput[];
  outputs: Output[];
  missingPlugins: string[];
  unconnectedPlugins: string[];
  confidence: number;
  reasoning: string;
  detectedCategories: string[];
  suggestedAlternatives: string[];
}

// ChatGPT Workflow Analysis Integration - Pure workflow generation
export const analyzeWorkflowWithChatGPT = async (userPrompt: string, userId?: string): Promise<GeneratedPlan> => {
  try {
    const systemPrompt = `You are an expert workflow automation analyst. Your task is to analyze user workflow requests and recommend the optimal sequence of plugins to accomplish their goals.

Available Plugins:
${pluginList.map(plugin => `${plugin.pluginKey}: ${plugin.name} - ${plugin.description} (Category: ${plugin.category})`).join('\n')}

Available Internal System Outputs (can be used alongside or instead of plugin outputs):
- dashboard-alert: Dashboard Alert Feed - Real-time notifications displayed in platform dashboard
- pdf-report: PDF Report Download - Generate downloadable PDF reports with analysis results  
- summary-block: Dashboard Summary Widget - Condensed summary displayed as dashboard widget
- agent-log: Agent Execution Log - Detailed log of agent execution for monitoring and debugging

Analyze the user's request and respond with a JSON object in this exact format:
{
  "workflowSteps": [
    {
      "pluginKey": "exact-plugin-key-from-list-or-internal-system-key",
      "action": "specific action to perform",
      "description": "detailed description of what this step accomplishes",
      "phase": "input|process|output",
      "reasoning": "why this plugin/option is the optimal choice for this step"
    }
  ],
  "requiredInputs": [
    {
      "name": "input name",
      "type": "string|enum|number",
      "description": "what this input is used for",
      "required": true|false,
      "placeholder": "example value",
      "options": ["option1", "option2"]
    }
  ],
  "confidence": 85,
  "reasoning": "overall explanation of the workflow logic and design decisions",
  "detectedCategories": ["category1", "category2"]
}

Guidelines:
- Use ONLY pluginKey values that exist in the provided plugin list above OR internal system keys
- Consider internal system outputs (dashboard-alert, pdf-report, summary-block, agent-log) as viable alternatives to external plugins
- Create logical workflow phases: input (data collection) → process (analysis/transformation) → output (delivery/storage)
- For output phase, decide between external plugins vs internal system outputs based on user needs
- Recommend the BEST possible workflow regardless of user's current plugin connections
- Avoid duplicate plugins unless absolutely necessary for the workflow
- Consider the user's specific needs and context carefully
- Generate contextually relevant inputs based on the chosen plugins/outputs
- Provide clear, actionable step descriptions
- Ensure the workflow makes logical sense from start to finish`;

    console.log('Sending request to ChatGPT via backend API...');

    const requestBody = {
      systemPrompt,
      userMessage: `Analyze this workflow request and create an optimal plugin sequence: "${userPrompt}"`
    };

    // Include userId in request body if available
    if (userId) {
      requestBody.userId = userId;
    }

    const response = await fetch('/api/analyze-workflow', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Also include userId in headers as fallback
        ...(userId && { 'x-user-id': userId })
      },
      body: JSON.stringify(requestBody)
    });

    console.log('Backend API response status:', response.status);

    if (!response.ok) {
      let errorMessage = `Backend API failed with status ${response.status}`;
      try {
        const errorData = await response.json();
        errorMessage = errorData.error || errorMessage;
      } catch (e) {
        const errorText = await response.text();
        errorMessage = errorText || errorMessage;
      }
      console.error('Backend API error:', errorMessage);
      throw new Error(errorMessage);
    }

    const data = await response.json();
    console.log('Received data from backend:', data);
    
    if (!data.analysis) {
      throw new Error('Invalid response format: missing analysis data');
    }

    // Log usage information if available
    if (data.usage) {
      console.log('Usage tracking info:', {
        provider: data.usage.provider,
        model: data.usage.model,
        inputTokens: data.usage.inputTokens,
        outputTokens: data.usage.outputTokens,
        totalTokens: data.usage.totalTokens
      });
    }

    return transformChatGPTResponse(data.analysis);

  } catch (error) {
    console.error('ChatGPT workflow analysis failed:', error);
    throw error;
  }
};

// Transform ChatGPT response to our internal format
export const transformChatGPTResponse = (chatGPTAnalysis: any): GeneratedPlan => {
  const steps: PluginStep[] = [];
  const requiredInputs: RequiredInput[] = [];
  const outputs: Output[] = [];
  const detectedCategories: string[] = [];

  if (chatGPTAnalysis.workflowSteps && Array.isArray(chatGPTAnalysis.workflowSteps)) {
    chatGPTAnalysis.workflowSteps.forEach((step: any, index: number) => {
      // Handle internal system outputs
      if (['dashboard-alert', 'pdf-report', 'summary-block', 'agent-log'].includes(step.pluginKey)) {
        const systemOutputs = {
          'dashboard-alert': { name: 'Dashboard Alert Feed', category: 'system', icon: '🔔' },
          'pdf-report': { name: 'PDF Report Download', category: 'system', icon: '📄' },
          'summary-block': { name: 'Dashboard Summary Widget', category: 'system', icon: '📊' },
          'agent-log': { name: 'Agent Execution Log', category: 'system', icon: '📝' }
        };

        const systemOutput = systemOutputs[step.pluginKey as keyof typeof systemOutputs];
        
        steps.push({
          id: index + 1,
          pluginKey: step.pluginKey,
          pluginName: systemOutput.name,
          action: step.action || 'Generate system output',
          description: step.description || `Generate ${systemOutput.name.toLowerCase()}`,
          icon: React.createElement('span', { className: 'text-2xl' }, systemOutput.icon),
          order: index + 1,
          phase: step.phase || 'output',
          confidence: 90
        });

        if (!detectedCategories.includes('system')) {
          detectedCategories.push('system');
        }

        if (step.phase === 'output') {
          const systemOutputFormats = {
            'dashboard-alert': {
              type: 'Dashboard Alert',
              format: 'Real-time alert notification displayed in platform dashboard alert feed'
            },
            'pdf-report': {
              type: 'PDF Report',
              format: 'Downloadable PDF report with formatted analysis results and charts'
            },
            'summary-block': {
              type: 'Summary Widget',
              format: 'Condensed summary displayed as interactive dashboard widget'
            },
            'agent-log': {
              type: 'Execution Log', 
              format: 'Detailed log of agent execution steps for monitoring and debugging'
            }
          };

          const outputFormat = systemOutputFormats[step.pluginKey as keyof typeof systemOutputFormats];
          outputs.push({
            type: outputFormat.type,
            destination: systemOutput.name,
            format: outputFormat.format,
            pluginKey: step.pluginKey
          });
        }

        return;
      }

      // Handle regular plugins
      const plugin = getPluginByKey(step.pluginKey);
      
      if (!plugin) {
        console.warn(`Plugin not found in plugin list: ${step.pluginKey}`);
        return;
      }

      steps.push({
        id: index + 1,
        pluginKey: plugin.pluginKey,
        pluginName: plugin.name,
        action: step.action || 'Process data',
        description: step.description || `Use ${plugin.name} for workflow processing`,
        icon: plugin.icon,
        order: index + 1,
        phase: step.phase || 'process',
        confidence: 90
      });

      if (!detectedCategories.includes(plugin.category)) {
        detectedCategories.push(plugin.category);
      }

      if (step.phase === 'output') {
        outputs.push({
          type: getOutputTypeForCategory(plugin.category),
          destination: plugin.name,
          format: step.description || `Data processed and delivered via ${plugin.name}`,
          pluginKey: plugin.pluginKey
        });
      }
    });
  }

  const generatedInputs = generateComprehensiveInputSchemas(steps);
  const chatGPTInputs = chatGPTAnalysis.requiredInputs || [];
  const mergedInputs = [...generatedInputs];

  chatGPTInputs.forEach((chatGPTInput: any) => {
    const exists = mergedInputs.some(input => 
      input.name.toLowerCase().includes(chatGPTInput.name.toLowerCase()) ||
      chatGPTInput.name.toLowerCase().includes(input.name.toLowerCase())
    );
    
    if (!exists) {
      mergedInputs.push({
        name: chatGPTInput.name || 'Additional Input',
        type: chatGPTInput.type || 'string',
        description: chatGPTInput.description || 'Additional workflow input',
        required: chatGPTInput.required !== false,
        placeholder: chatGPTInput.placeholder,
        options: chatGPTInput.options
      });
    }
  });

  // Return plan with no connection filtering - let UI handle connection status
  return {
    steps,
    requiredInputs: mergedInputs,
    outputs,
    missingPlugins: [], // Will be calculated later based on actual plugin availability
    unconnectedPlugins: [], // Will be calculated later based on user connections
    confidence: chatGPTAnalysis.confidence || 75,
    reasoning: chatGPTAnalysis.reasoning || 'ChatGPT analysis completed successfully',
    detectedCategories: chatGPTAnalysis.detectedCategories || detectedCategories,
    suggestedAlternatives: []
  };
};

export const getOutputTypeForCategory = (category: string): string => {
  const outputTypeMap: Record<string, string> = {
    'productivity': 'Documents/Files',
    'communication': 'Messages/Notifications', 
    'crm': 'CRM Records',
    'project': 'Tasks/Projects',
    'marketing': 'Campaign Data',
    'finance': 'Financial Records',
    'integration': 'Automated Workflows',
    'ai': 'Processed Insights'
  };
  
  return outputTypeMap[category] || 'Processed Data';
};

export const generateComprehensiveInputSchemas = (steps: PluginStep[]): RequiredInput[] => {
  const inputs: RequiredInput[] = [];
  const processedPlugins = new Set<string>();

  steps.forEach(step => {
    if (processedPlugins.has(step.pluginKey)) return;
    processedPlugins.add(step.pluginKey);

    const plugin = getPluginByKey(step.pluginKey);
    if (!plugin) return;

    addPluginInputs(plugin, step.phase, inputs);
  });

  return inputs;
};

export const addPluginInputs = (plugin: any, phase: string, inputs: RequiredInput[]) => {
  const namePrefix = plugin.name;

  switch (plugin.category) {
    case 'communication':
      if (plugin.pluginKey === 'google-mail') {
        if (phase === 'input') {
          inputs.push(
            {
              name: `${namePrefix} Search Query`,
              type: 'string',
              description: 'Search criteria for Gmail emails',
              required: false,
              placeholder: 'is:unread newer_than:2d from:(client|customer)'
            },
            {
              name: `${namePrefix} Time Range`,
              type: 'enum',
              description: 'Time period for email analysis',
              required: false,
              options: ['Last 24 hours', 'Last 3 days', 'Last week', 'Last month']
            }
          );
        }
        if (phase === 'output') {
          inputs.push({
            name: `${namePrefix} Recipient`,
            type: 'string',
            description: 'Email recipient for notifications',
            required: true,
            placeholder: 'user@example.com'
          });
        }
      }
      break;

    case 'productivity':
      if (plugin.pluginKey === 'google-drive') {
        inputs.push({
          name: `${namePrefix} Folder Path`,
          type: 'string',
          description: 'Google Drive folder for file operations',
          required: false,
          placeholder: '/Workflow Results/Analysis Reports'
        });
      }
      break;
  }

  // Add system output configurations
  if (['dashboard-alert', 'pdf-report', 'summary-block', 'agent-log'].includes(plugin.pluginKey)) {
    if (plugin.pluginKey === 'dashboard-alert') {
      inputs.push({
        name: `${namePrefix} Priority Level`,
        type: 'enum',
        description: 'Priority level for dashboard alerts',
        required: false,
        options: ['Low', 'Medium', 'High', 'Critical']
      });
    }
  }
};

// Main function - now takes connected plugins array and uses it only for post-processing
export const generateAgentPlan = async (prompt: string, connectedPlugins: string[], userId?: string): Promise<GeneratedPlan> => {
  if (!prompt || prompt.trim().length < 5) {
    return {
      steps: [],
      requiredInputs: [],
      outputs: [],
      missingPlugins: [],
      unconnectedPlugins: [],
      confidence: 0,
      reasoning: 'No prompt provided for analysis',
      detectedCategories: [],
      suggestedAlternatives: []
    };
  }

  try {
    // Get optimal workflow from ChatGPT (no connection filtering)
    const chatGPTPlan = await analyzeWorkflowWithChatGPT(prompt, userId);
    
    // Now calculate connection status for UI display purposes only
    const missingPlugins: string[] = [];
    const unconnectedPlugins: string[] = [];

    chatGPTPlan.steps.forEach(step => {
      // Skip internal system outputs - they're always "available"
      if (['dashboard-alert', 'pdf-report', 'summary-block', 'agent-log'].includes(step.pluginKey)) {
        return;
      }
      
      const plugin = getPluginByKey(step.pluginKey);
      if (!plugin) {
        // Plugin doesn't exist in our system
        missingPlugins.push(step.pluginKey);
      } else if (!connectedPlugins.includes(step.pluginKey)) {
        // Plugin exists but isn't connected
        unconnectedPlugins.push(step.pluginKey);
      }
    });

    // Generate suggested alternatives for unconnected plugins
    const suggestedAlternatives: string[] = [];
    unconnectedPlugins.forEach(pluginKey => {
      const plugin = getPluginByKey(pluginKey);
      if (plugin) {
        const alternatives = getPluginsByCategory(plugin.category)
          .filter(p => p.pluginKey !== pluginKey && connectedPlugins.includes(p.pluginKey))
          .slice(0, 2);
        suggestedAlternatives.push(...alternatives.map(p => p.name));
      }
    });

    // Adjust confidence based on connection availability
    const totalRequiredPlugins = chatGPTPlan.steps.filter(step => 
      !['dashboard-alert', 'pdf-report', 'summary-block', 'agent-log'].includes(step.pluginKey)
    ).length;
    
    const availablePluginsCount = totalRequiredPlugins - missingPlugins.length - unconnectedPlugins.length;
    const availabilityRatio = totalRequiredPlugins > 0 ? (availablePluginsCount / totalRequiredPlugins) : 1;
    const availabilityScore = Math.round(availabilityRatio * 100);
    const adjustedConfidence = Math.round((chatGPTPlan.confidence + availabilityScore) / 2);

    // Add connection status to reasoning
    let reasoningAddition = '';
    if (missingPlugins.length > 0) {
      reasoningAddition = ` Note: ${missingPlugins.length} plugins are not available in the system and need to be added.`;
    } else if (unconnectedPlugins.length > 0) {
      reasoningAddition = ` Note: ${unconnectedPlugins.length} plugins need to be connected to execute this workflow.`;
    } else {
      reasoningAddition = ' All required plugins are connected and ready to execute.';
    }

    const enhancedReasoning = `${chatGPTPlan.reasoning}${reasoningAddition}`;

    return {
      ...chatGPTPlan,
      missingPlugins,
      unconnectedPlugins,
      suggestedAlternatives: [...new Set(suggestedAlternatives)],
      confidence: adjustedConfidence,
      reasoning: enhancedReasoning
    };

  } catch (error: any) {
    console.error('Workflow generation failed:', error);
    return {
      steps: [],
      requiredInputs: [],
      outputs: [],
      missingPlugins: [],
      unconnectedPlugins: [],
      confidence: 10,
      reasoning: `ChatGPT analysis failed: ${error.message}. Please check your API configuration and try again.`,
      detectedCategories: [],
      suggestedAlternatives: []
    };
  }
};