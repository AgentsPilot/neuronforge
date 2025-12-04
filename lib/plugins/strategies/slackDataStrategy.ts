/**
 * @deprecated This entire file is deprecated and should not be used.
 * Please use the v2 plugin system instead.
 */

// Required environment variables:
// NEXT_PUBLIC_SLACK_CLIENT_ID - Slack OAuth client ID (public)
// NEXT_PUBLIC_SLACK_CLIENT_SECRET - Slack OAuth client secret (server-side only)
// NEXT_PUBLIC_APP_URL - Base URL of the application

// Make sure the file 'slackPluginStrategy.ts' exists in the same directory.
// If it does not exist, create it or update the import path to the correct location.
import { slackStrategy } from './slackPluginStrategy';
import { SupabaseClient } from '@supabase/supabase-js';

// CRITICAL: NO INTERFACES IN DATA STRATEGY FILE - Following breaking rule #1
// NO INTERFACES - SIMPLE OBJECT EXPORT ONLY as specified

// Configuration constants
const SLACK_API_BASE = 'https://slack.com/api';

// Helper functions
const processGenericInputs = (input_variables: Record<string, any>): any => {
  console.log('📱 Processing generic input variables dynamically');
  
  const processed = {
    action: 'send_message',
    channel: '',
    message: '',
    limit: 50,
    originalInputs: input_variables
  };

  // Process various input formats dynamically
  Object.entries(input_variables).forEach(([key, value]) => {
    const lowerKey = key.toLowerCase();
    
    // Detect action type
    if (lowerKey.includes('send') || lowerKey.includes('post') || lowerKey.includes('message')) {
      processed.action = 'send_message';
    } else if (lowerKey.includes('list') || lowerKey.includes('channel')) {
      processed.action = 'list_channels';
    } else if (lowerKey.includes('get') && (lowerKey.includes('message') || lowerKey.includes('history'))) {
      processed.action = 'get_messages';
    } else if (lowerKey.includes('summarize') || lowerKey.includes('thread')) {
      processed.action = 'summarize_thread';
    }
    
    // Detect channel/target
    if (lowerKey.includes('channel') || lowerKey.includes('to') || lowerKey.includes('room')) {
      processed.channel = String(value).trim();
    }
    
    // Detect message content
    if (lowerKey.includes('message') || lowerKey.includes('text') || lowerKey.includes('content') || lowerKey.includes('body')) {
      processed.message = String(value).trim();
    }
    
    // Detect limit/count
    if (lowerKey.includes('limit') || lowerKey.includes('count') || lowerKey.includes('max') || lowerKey.includes('number')) {
      const numValue = parseInt(String(value), 10);
      if (!isNaN(numValue) && numValue > 0) {
        processed.limit = Math.min(numValue, 100); // Cap at 100 for performance
      }
    }
  });

  return processed;
};

const sendMessage = async (accessToken: string, channel: string, text: string): Promise<any> => {
  console.log('📱 Sending message to Slack');
  
  const response = await fetch(`${SLACK_API_BASE}/chat.postMessage`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      channel: channel,
      text: text
    })
  });
  
  if (!response.ok) {
    throw new Error(`Slack API error: ${response.status} ${response.statusText}`);
  }
  
  const data = await response.json();
  if (!data.ok) {
    throw new Error(`Slack API error: ${data.error}`);
  }
  
  return data;
};

const getChannels = async (accessToken: string): Promise<any> => {
  console.log('📱 Fetching channels from Slack');
  
  const response = await fetch(`${SLACK_API_BASE}/conversations.list`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    }
  });
  
  if (!response.ok) {
    throw new Error(`Slack API error: ${response.status} ${response.statusText}`);
  }
  
  const data = await response.json();
  if (!data.ok) {
    throw new Error(`Slack API error: ${data.error}`);
  }
  
  return data;
};

const getMessages = async (accessToken: string, channel: string, limit?: number): Promise<any> => {
  console.log('📱 Fetching messages from Slack');
  
  const params = new URLSearchParams({
    channel: channel,
    limit: String(limit || 50)
  });
  
  const response = await fetch(`${SLACK_API_BASE}/conversations.history?${params}`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    }
  });
  
  if (!response.ok) {
    throw new Error(`Slack API error: ${response.status} ${response.statusText}`);
  }
  
  const data = await response.json();
  if (!data.ok) {
    throw new Error(`Slack API error: ${data.error}`);
  }
  
  return data;
};

const getThread = async (accessToken: string, channel: string, threadTs: string): Promise<any> => {
  console.log('📱 Fetching thread replies from Slack');
  
  const params = new URLSearchParams({
    channel: channel,
    ts: threadTs
  });
  
  const response = await fetch(`${SLACK_API_BASE}/conversations.replies?${params}`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    }
  });
  
  if (!response.ok) {
    throw new Error(`Slack API error: ${response.status} ${response.statusText}`);
  }
  
  const data = await response.json();
  if (!data.ok) {
    throw new Error(`Slack API error: ${data.error}`);
  }
  
  return data;
};

const summarizeThread = async (messages: any[]): Promise<string> => {
  console.log('📱 Summarizing thread messages');
  
  if (!messages || messages.length === 0) {
    return 'No messages found in thread';
  }
  
  const messageTexts = messages
    .filter(msg => msg.text && msg.text.trim())
    .map(msg => msg.text.trim())
    .slice(0, 20); // Limit to first 20 messages
  
  const summary = `Thread contains ${messages.length} messages. Key topics discussed: ${messageTexts.join(' | ')}`;
  
  return summary;
};

const resolveChannelId = async (accessToken: string, channelName: string): Promise<string> => {
  console.log('📱 Resolving channel ID for:', channelName);
  
  // If it's already a channel ID (starts with C), return as-is
  if (channelName.startsWith('C') || channelName.startsWith('D') || channelName.startsWith('G')) {
    return channelName;
  }
  
  // Remove # if present
  const cleanChannelName = channelName.replace(/^#/, '');
  
  try {
    const channelsData = await getChannels(accessToken);
    const channel = channelsData.channels.find((ch: any) => ch.name === cleanChannelName);
    
    if (channel) {
      return channel.id;
    }
    
    // Fallback: return original name (might be a DM or valid ID)
    return channelName;
  } catch (error) {
    console.warn('⚠️ Failed to resolve channel ID:', error);
    return channelName;
  }
};

// Main data strategy object export with strategy delegation
/** @deprecated Use v2 plugin system instead */
export const slackDataStrategy = {
  // Import all methods from slackStrategy using spread operator
  ...slackStrategy,

  /**
   * Main execution method for Slack operations - returns structured error objects, doesn't throw
   */
  run: async ({ connection, userId, input_variables }: {
    connection: any;
    userId: string;
    input_variables: Record<string, any>;
  }): Promise<any> => {
    try {
      console.log('📱 Starting Slack operation for user:', userId);
      
      // Process generic inputs using dynamic detection
      const processedInputs = processGenericInputs(input_variables);
      console.log('📋 Processed inputs:', processedInputs);
      
      const { action, channel, message, limit } = processedInputs;
      const accessToken = connection.access_token;
      
      let result: any = {};
      
      switch (action) {
        case 'send_message': {
          if (!channel || !message) {
            throw new Error('Channel and message are required for sending messages');
          }
          
          const channelId = await resolveChannelId(accessToken, channel);
          const response = await sendMessage(accessToken, channelId, message);
          
          result = {
            summary: `Message sent successfully to ${channel}`,
            success: true,
            action: 'send_message',
            channel: channelId,
            message: message,
            timestamp: response.ts,
            fetchedAt: new Date().toISOString()
          };
          break;
        }
        
        case 'list_channels': {
          const response = await getChannels(accessToken);
          
          result = {
            summary: `Found ${response.channels.length} channels`,
            success: true,
            action: 'list_channels',
            channels: response.channels.map((ch: any) => ({
              id: ch.id,
              name: ch.name,
              is_private: ch.is_private,
              is_member: ch.is_member,
              topic: ch.topic?.value || '',
              purpose: ch.purpose?.value || ''
            })),
            totalChannels: response.channels.length,
            fetchedAt: new Date().toISOString()
          };
          break;
        }
        
        case 'get_messages': {
          if (!channel) {
            throw new Error('Channel is required for getting messages');
          }
          
          const channelId = await resolveChannelId(accessToken, channel);
          const response = await getMessages(accessToken, channelId, limit);
          
          result = {
            summary: `Retrieved ${response.messages.length} messages from ${channel}`,
            success: true,
            action: 'get_messages',
            channel: channelId,
            messages: response.messages.map((msg: any) => ({
              ts: msg.ts,
              user: msg.user,
              text: msg.text,
              thread_ts: msg.thread_ts,
              reply_count: msg.reply_count || 0
            })),
            totalMessages: response.messages.length,
            fetchedAt: new Date().toISOString()
          };
          break;
        }
        
        case 'summarize_thread': {
          if (!channel) {
            throw new Error('Channel is required for summarizing threads');
          }
          
          // Look for thread timestamp in input
          const threadTs = input_variables.thread_ts || input_variables.timestamp || input_variables.ts;
          if (!threadTs) {
            throw new Error('Thread timestamp is required for summarizing threads');
          }
          
          const channelId = await resolveChannelId(accessToken, channel);
          const response = await getThread(accessToken, channelId, threadTs);
          const summary = await summarizeThread(response.messages);
          
          result = {
            summary: summary,
            success: true,
            action: 'summarize_thread',
            channel: channelId,
            thread_ts: threadTs,
            messageCount: response.messages.length,
            fetchedAt: new Date().toISOString()
          };
          break;
        }
        
        default: {
          throw new Error(`Unknown action: ${action}`);
        }
      }
      
      console.log('✅ Slack operation completed successfully');
      return result;
      
    } catch (error) {
      console.error('❌ Slack operation failed:', error);
      // Return structured error objects with troubleshooting steps
      return {
        summary: "Unable to perform Slack operation at this time.",
        error: typeof error === 'object' && error !== null && 'message' in error ? (error as any).message : String(error),
        success: false,
        errorType: typeof error === 'object' && error !== null && 'constructor' in error && (error as any).constructor.name ? (error as any).constructor.name : typeof error,
        troubleshooting: [
          "Verify Slack connection is active",
          "Check if bot has required permissions",
          "Ensure channel/user exists"
        ]
      };
    }
  },

  /**
   * Processes generic input variables dynamically
   */
  processGenericInputs,

  /**
   * Send message to channel or user
   */
  sendMessage,

  /**
   * Get list of channels
   */
  getChannels,

  /**
   * Get messages from channel
   */
  getMessages,

  /**
   * Get thread replies
   */
  getThread,

  /**
   * Summarize thread messages
   */
  summarizeThread,

  /**
   * Resolve channel name to ID
   */
  resolveChannelId
};