// lib/types/plugin-definition-context.ts

import { PluginDefinition, ActionDefinition, IPluginDefinitionContext, InputTemplate, OutputTemplate } from './plugin-types';

export interface IPluginContext {
  key: string;
  displayName: string;
  context: string;
  category: string;
  capabilities: string[];
}

/**
 * Wrapper class for PluginDefinition that provides context helper methods
 * for LLM interactions and context generation.
 */
export class PluginDefinitionContext implements IPluginDefinitionContext {
  // Properties from IPluginDefinitionContext
  key: string;
  label: string;
  displayName: string;
  icon?: string;
  category: string;
  capabilities: string[];
  usage: ('input' | 'output' | 'both')[];
  requiresMapping: boolean;
  inputTemplates?: { [capability: string]: InputTemplate[] };
  outputTemplates?: { [capability: string]: OutputTemplate };

  // Properties from PluginDefinition
  plugin: PluginDefinition['plugin'];
  actions: Record<string, ActionDefinition>;

  constructor(definition: PluginDefinition) {
    // Assign PluginDefinition properties
    this.plugin = definition.plugin;
    this.actions = definition.actions;

    // Assign context properties
    this.key = definition.plugin.name;
    this.label = definition.plugin.label || definition.plugin.name;
    this.displayName = definition.plugin.displayName || definition.plugin.name;
    this.icon = definition.plugin.icon as string || '';
    this.category = definition.plugin.category;

    this.capabilities = this.getActionNames(); // Default to all action names
    this.usage = ["both"]; // Default to 'both' if not specified
    this.requiresMapping = false;
    
    this.inputTemplates = undefined;  // TO FIX
    this.outputTemplates = undefined; // TO FIX
  }

  /**
   * convert PluginDefinition action to InputTemplate format
   */
  // private convertActionToInputTemplate(action: ActionDefinition): InputTemplate {
  //   const inputTemplate: InputTemplate = {
  //     name: action.name,
  //     type: 'object', // Assuming action parameters are objects
  //   }

  //   return inputTemplate
  // }  

  /**
   * Get the plugin's display name (prioritizing displayName > Label > name)
   */
  getDisplayName(): string {
    return (
      this.plugin.displayName ||
      this.plugin.label ||
      this.plugin.name
    );
  }

  /**
   * Get the plugin's internal name
   */
  getName(): string {
    return this.plugin.name;
  }

  /**
   * Get the plugin's description
   */
  getDescription(): string {
    return this.plugin.description;
  }

  /**
   * Get the plugin's context information
   */
  getContext(): string {
    return this.plugin.context;
  }

  /**
   * Get the plugin's Category information (default to 'other' if not set)
   */
  getCategory(): string {
    return this.plugin.category || 'other';
  }

  /**
   * Get all action names available in this plugin
   */
  getActionNames(): string[] {
    return Object.keys(this.actions);
  }

  /**
   * Get a specific action definition by name
   */
  getActionDefinition(actionName: string): ActionDefinition | undefined {
    return this.actions[actionName];
  }

  /**
   * Get the raw plugin definition
   */
  getRawDefinition(): PluginDefinition {
    return {
      plugin: this.plugin,
      actions: this.actions
    };
  }

  /**
   * Check if a specific action contains a keyword in its description or usage_context
   */
  isActionIncludeKeyword(actionName: string, keyword: string): boolean {
    const action = this.actions[actionName];
    if (!action) return false;

    const searchText = `${actionName} ${action.description} ${action.usage_context}`.toLowerCase();
    return searchText.includes(keyword.toLowerCase());
  }

  /**
   * Check if a specific action contains a keyword in its description or usage_context
   */
  someActionsIncludeKeyword(keyword: string): boolean {
    return Object.keys(this.actions).some((actionName) =>
      this.isActionIncludeKeyword(actionName, keyword));
  }

  /**
   * Filter actions by keyword (searches in description and usage_context)
   * Returns an array of action names that match the keyword
   */
  filterActionsByKeyword(keyword: string): string[] {
    return Object.keys(this.actions).filter((actionName) =>
      this.isActionIncludeKeyword(actionName, keyword)
    );
  }

  /**
   * Generate LLM context structure similar to LLMContext interface
   * Returns plugin information formatted for LLM consumption
   */
  toLongLLMContext(): {
    name: string;
    key: string;
    description: string;
    context: string;
    actions: Record<string, {
      description: string;
      usage_context: string;
      parameters: any;
      output_schema?: any;
    }>;
  } {
    const actions: Record<string, {
      description: string;
      usage_context: string;
      parameters: any;
      output_schema?: any;
    }> = {};

    Object.entries(this.actions).forEach(([actionName, actionDef]) => {
      actions[actionName] = {
        description: actionDef.description,
        usage_context: actionDef.usage_context,
        parameters: actionDef.parameters,
        output_schema: actionDef.output_schema,
      };
    });

    return {
      name: this.plugin.name,
      key: this.key,
      description: this.plugin.description,
      context: this.plugin.context,
      actions,
    };
  }

  /**
   * Generate LLM context structure similar to LLMContext interface, but shorter
   * Returns plugin basic information and actions names formatted for LLM consumption
   */
  toShortLLMContext(): IPluginContext {
    return {      
      key: this.key,
      displayName: this.getDisplayName(),
      context: this.plugin.context,
      category: this.plugin.category,      
      capabilities: this.capabilities,
    };
  }
}
