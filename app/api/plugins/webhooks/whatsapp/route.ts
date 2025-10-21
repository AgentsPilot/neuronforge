// app/api/plugins/webhooks/whatsapp/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { UserPluginConnections } from '@/lib/server/user-plugin-connections';

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'your-verify-token-here';

// GET: Handle webhook verification from Meta
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    
    // Meta sends these parameters for webhook verification
    const mode = searchParams.get('hub.mode');
    const token = searchParams.get('hub.verify_token');
    const challenge = searchParams.get('hub.challenge');

    console.log('DEBUG: WhatsApp webhook verification request received');

    // Verify the token matches
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('DEBUG: WhatsApp webhook verified successfully');
      // Respond with the challenge to complete verification
      return new Response(challenge, { status: 200 });
    }

    console.error('DEBUG: WhatsApp webhook verification failed - invalid token');
    return new Response('Forbidden', { status: 403 });

  } catch (error: any) {
    console.error('DEBUG: WhatsApp webhook verification error:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}

// POST: Handle incoming webhook events from WhatsApp
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    console.log('DEBUG: WhatsApp webhook event received:', JSON.stringify(body, null, 2));

    // WhatsApp webhook structure
    if (body.object !== 'whatsapp_business_account') {
      console.log('DEBUG: Not a WhatsApp Business Account webhook');
      return new Response('OK', { status: 200 });
    }

    // Process each entry in the webhook
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value;

        // Extract metadata
        const phoneNumberId = value.metadata?.phone_number_id;
        const displayPhoneNumber = value.metadata?.display_phone_number;

        if (!phoneNumberId) {
          console.log('DEBUG: No phone_number_id in webhook payload');
          continue;
        }

        // Find user by phone_number_id in their profile_data
        const userConnection = await findUserByPhoneNumberId(phoneNumberId);
        
        if (!userConnection) {
          console.log(`DEBUG: No user found for phone_number_id: ${phoneNumberId}`);
          continue;
        }

        console.log(`DEBUG: Webhook event for user: ${userConnection.user_id}`);

        // Handle incoming messages
        if (value.messages && Array.isArray(value.messages)) {
          for (const message of value.messages) {
            await handleIncomingMessage(userConnection, message, displayPhoneNumber);
          }
        }

        // Handle message status updates
        if (value.statuses && Array.isArray(value.statuses)) {
          for (const status of value.statuses) {
            await handleMessageStatus(userConnection, status);
          }
        }
      }
    }

    // Always return 200 to acknowledge receipt
    return new Response('OK', { status: 200 });

  } catch (error: any) {
    console.error('DEBUG: WhatsApp webhook processing error:', error);
    // Still return 200 to prevent retries
    return new Response('OK', { status: 200 });
  }
}

// Helper: Find user connection by phone_number_id
async function findUserByPhoneNumberId(phoneNumberId: string): Promise<any | null> {
  try {
    const userConnections = UserPluginConnections.getInstance();
    
    // This is a simplified implementation
    // You'll need to implement a method in UserPluginConnections to query by profile_data
    // For now, this is a placeholder that you'll need to adapt to your database schema
    
    // Option 1: If you have a method to get all connections and filter
    // const allConnections = await userConnections.getAllConnections();
    // return allConnections.find(conn => 
    //   conn.plugin_name === 'whatsapp' && 
    //   conn.profile_data?.phone_number_id === phoneNumberId
    // );

    // Option 2: Implement a new method in UserPluginConnections
    // return await userConnections.findByPhoneNumberId('whatsapp', phoneNumberId);

    console.log(`DEBUG: Looking for user with phone_number_id: ${phoneNumberId}`);
    
    // TODO: Implement proper database query
    // This requires adding a method to UserPluginConnections or querying your database directly
    
    return null;

  } catch (error) {
    console.error('DEBUG: Error finding user by phone_number_id:', error);
    return null;
  }
}

// Helper: Handle incoming message
async function handleIncomingMessage(
  userConnection: any,
  message: any,
  businessPhone: string | undefined
): Promise<void> {
  console.log('DEBUG: Incoming message:', {
    from: message.from,
    id: message.id,
    type: message.type,
    timestamp: message.timestamp
  });

  // Extract message details
  const messageData = {
    message_id: message.id,
    from: message.from,
    timestamp: message.timestamp,
    type: message.type,
    business_phone: businessPhone,
    user_id: userConnection.user_id
  };

  // Handle different message types
  switch (message.type) {
    case 'text':
      messageData['text'] = message.text?.body;
      break;
    case 'image':
      messageData['media_id'] = message.image?.id;
      messageData['caption'] = message.image?.caption;
      break;
    case 'document':
      messageData['media_id'] = message.document?.id;
      messageData['filename'] = message.document?.filename;
      messageData['caption'] = message.document?.caption;
      break;
    case 'audio':
      messageData['media_id'] = message.audio?.id;
      break;
    case 'video':
      messageData['media_id'] = message.video?.id;
      messageData['caption'] = message.video?.caption;
      break;
    case 'button':
      messageData['button_text'] = message.button?.text;
      messageData['button_payload'] = message.button?.payload;
      break;
    case 'interactive':
      if (message.interactive?.type === 'button_reply') {
        messageData['button_id'] = message.interactive.button_reply?.id;
        messageData['button_title'] = message.interactive.button_reply?.title;
      } else if (message.interactive?.type === 'list_reply') {
        messageData['list_id'] = message.interactive.list_reply?.id;
        messageData['list_title'] = message.interactive.list_reply?.title;
        messageData['list_description'] = message.interactive.list_reply?.description;
      }
      break;
  }

  console.log('DEBUG: Processed message data:', messageData);

  // TODO: Store in your database, trigger automation, notify user, etc.
  // Examples of what you might do:
  // - Store message in a messages table
  // - Trigger an LLM automation workflow
  // - Send a push notification to the user
  // - Queue for processing by your automation system
}

// Helper: Handle message status update
async function handleMessageStatus(
  userConnection: any,
  status: any
): Promise<void> {
  console.log('DEBUG: Message status update:', {
    message_id: status.id,
    status: status.status,
    timestamp: status.timestamp,
    recipient: status.recipient_id
  });

  const statusData = {
    message_id: status.id,
    status: status.status, // sent, delivered, read, failed
    timestamp: status.timestamp,
    recipient: status.recipient_id,
    user_id: userConnection.user_id
  };

  // Handle errors if present
  if (status.errors && Array.isArray(status.errors)) {
    statusData['errors'] = status.errors;
    console.error('DEBUG: Message delivery errors:', status.errors);
  }

  // TODO: Update message status in your database
  // - Update the status of the outgoing message
  // - Notify user of delivery/read status
  // - Handle failed messages
}