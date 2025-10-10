// lib/types/plugin-definition-context.ts

import { PluginDefinition, ActionDefinition } from './plugin-types';

/**
 * Wrapper class for PluginDefinition that provides context helper methods
 * for LLM interactions and context generation.
 */
export class PluginDefinitionContext {
  private definition: PluginDefinition;

  constructor(definition: PluginDefinition) {
    this.definition = definition;
  }

  /**
   * Get the plugin's display name (prioritizing DisplayName > Label > name)
   */
  getDisplayName(): string {
    return (
      this.definition.plugin.DisplayName ||
      this.definition.plugin.Label ||
      this.definition.plugin.name
    );
  }

  /**
   * Get the plugin's internal name
   */
  getName(): string {
    return this.definition.plugin.name;
  }

  /**
   * Get the plugin's description
   */
  getDescription(): string {
    return this.definition.plugin.description;
  }

  /**
   * Get the plugin's context information
   */
  getContext(): string {
    return this.definition.plugin.context;
  }

  /**
   * Get the plugin's Category information (default to 'other' if not set)
   */
  getCategory(): string {
    return this.definition.plugin.category || 'other';
  }

  /**
   * Get all action names available in this plugin
   */
  getActionNames(): string[] {
    return Object.keys(this.definition.actions);
  }

  /**
   * Get a specific action definition by name
   */
  getActionDefinition(actionName: string): ActionDefinition | undefined {
    return this.definition.actions[actionName];
  }

  /**
   * Get the raw plugin definition
   */
  getRawDefinition(): PluginDefinition {
    return this.definition;
  }

  /**
   * Check if a specific action contains a keyword in its description or usage_context
   */
  isActionIncludeKeyword(actionName: string, keyword: string): boolean {
    const action = this.definition.actions[actionName];
    if (!action) return false;

    const searchText = `${actionName} ${action.description} ${action.usage_context}`.toLowerCase();
    return searchText.includes(keyword.toLowerCase());
  }

  /**
   * Check if a specific action contains a keyword in its description or usage_context
   */
  someActionsIncludeKeyword(keyword: string): boolean {
    return Object.keys(this.definition.actions).some((actionName) =>
      this.isActionIncludeKeyword(actionName, keyword));
  }

  /**
   * Filter actions by keyword (searches in description and usage_context)
   * Returns an array of action names that match the keyword
   */
  filterActionsByKeyword(keyword: string): string[] {
    return Object.keys(this.definition.actions).filter((actionName) =>
      this.isActionIncludeKeyword(actionName, keyword)
    );
  }

  /**
   * Generate LLM context structure similar to LLMContext interface
   * Returns plugin information formatted for LLM consumption
   */
  toLongLLMContext(): {
    name: string;
    description: string;
    context: string;
    actions: Record<string, {
      description: string;
      usage_context: string;
      parameters: any;
    }>;
  } {
    const actions: Record<string, {
      description: string;
      usage_context: string;
      parameters: any;
    }> = {};

    Object.entries(this.definition.actions).forEach(([actionName, actionDef]) => {
      actions[actionName] = {
        description: actionDef.description,
        usage_context: actionDef.usage_context,
        parameters: actionDef.parameters,
      };
    });

    return {
      name: this.definition.plugin.name,
      description: this.definition.plugin.description,
      context: this.definition.plugin.context,
      actions,
    };
  }

  /**
   * Generate LLM context structure similar to LLMContext interface, but shorter
   * Returns plugin basic information and actions names formatted for LLM consumption
   */
  toShortLLMContext(): {
    name: string;    
    context: string;
    key_actions: string[];
  } {    
    return {
      name: this.definition.plugin.name,      
      context: this.definition.plugin.context,
      key_actions: this.getActionNames(),
    };
  }
}
