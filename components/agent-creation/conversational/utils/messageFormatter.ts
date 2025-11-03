/**
 * Message Formatting Utilities
 */

import { v4 as uuidv4 } from 'uuid';

export function generateMessageId(): string {
  return uuidv4();
}

export function formatTime(timestamp: Date | string): string {
  try {
    const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
    if (isNaN(date.getTime())) {
      return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (error) {
    console.warn('Error formatting timestamp:', error);
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
}

export function getPlaceholderText(stage: string, waitingForPlugins: boolean, isProcessing: boolean): string {
  if (isProcessing) {
    return 'AI is thinking...';
  }

  if (waitingForPlugins) {
    return 'Please connect the required services above...';
  }

  switch (stage) {
    case 'clarity':
      return 'Describe what you want your agent to do...';
    case 'plugins':
      return 'Connect the required services above to continue...';
    case 'questions':
      return 'Type a message or click an option above...';
    case 'review':
      return 'Review the plan above or describe changes...';
    case 'accepted':
      return 'Preparing to build your agent...';
    default:
      return 'Type a message...';
  }
}

export function getPluginDisplayName(pluginKey: string): string {
  const displayNames: Record<string, string> = {
    gmail: 'Gmail',
    slack: 'Slack',
    calendar: 'Google Calendar',
    sheets: 'Google Sheets',
    drive: 'Google Drive',
    notion: 'Notion',
    github: 'GitHub',
    trello: 'Trello',
    asana: 'Asana',
    jira: 'Jira',
  };

  return displayNames[pluginKey] || pluginKey.charAt(0).toUpperCase() + pluginKey.slice(1);
}

export function getPluginDescription(pluginKey: string): string {
  const descriptions: Record<string, string> = {
    gmail: 'Read and send your emails',
    slack: 'Send messages to your workspace',
    calendar: 'Manage your calendar events',
    sheets: 'Read and write spreadsheet data',
    drive: 'Access your files and folders',
    notion: 'Work with your Notion workspace',
    github: 'Manage repositories and issues',
    trello: 'Manage boards and cards',
    asana: 'Work with tasks and projects',
    jira: 'Manage issues and workflows',
  };

  return descriptions[pluginKey] || 'Connect to this service';
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
}
