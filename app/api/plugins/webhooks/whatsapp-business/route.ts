// app/api/plugins/webhooks/whatsapp-business/route.ts

import { NextRequest } from 'next/server';
import { UserPluginConnections } from '@/lib/server/user-plugin-connections';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'WhatsAppWebhook' });
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'your-verify-token-here';

// GET: Handle webhook verification from Meta
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;

    // Meta sends these parameters for webhook verification
    const mode = searchParams.get('hub.mode');
    const token = searchParams.get('hub.verify_token');
    const challenge = searchParams.get('hub.challenge');

    logger.info('Webhook verification request received');

    // Verify the token matches
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      logger.info('Webhook verified successfully');
      // Respond with the challenge to complete verification
      return new Response(challenge, { status: 200 });
    }

    logger.warn('Webhook verification failed - invalid token');
    return new Response('Forbidden', { status: 403 });

  } catch (error) {
    logger.error({ err: error }, 'Webhook verification error');
    return new Response('Internal Server Error', { status: 500 });
  }
}

// POST: Handle incoming webhook events from WhatsApp
export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const body = await request.json();

    requestLogger.debug({ payload: body }, 'Webhook event received');

    // WhatsApp webhook structure
    if (body.object !== 'whatsapp_business_account') {
      requestLogger.debug('Not a WhatsApp Business Account webhook');
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
          requestLogger.warn('No phone_number_id in webhook payload');
          continue;
        }

        // Find user by phone_number_id in their profile_data
        const userConnection = await findUserByPhoneNumberId(phoneNumberId, requestLogger);

        if (!userConnection) {
          requestLogger.warn({ phoneNumberId }, 'No user found for phone_number_id');
          continue;
        }

        requestLogger.info({ userId: userConnection.user_id }, 'Webhook event for user');

        // Handle incoming messages
        if (value.messages && Array.isArray(value.messages)) {
          for (const message of value.messages) {
            await handleIncomingMessage(userConnection, message, displayPhoneNumber, requestLogger);
          }
        }

        // Handle message status updates
        if (value.statuses && Array.isArray(value.statuses)) {
          for (const status of value.statuses) {
            await handleMessageStatus(userConnection, status, requestLogger);
          }
        }
      }
    }

    // Always return 200 to acknowledge receipt
    return new Response('OK', { status: 200 });

  } catch (error) {
    requestLogger.error({ err: error }, 'Webhook processing error');
    // Still return 200 to prevent retries
    return new Response('OK', { status: 200 });
  }
}

// Helper: Find user connection by phone_number_id stored in profile_data
async function findUserByPhoneNumberId(phoneNumberId: string, log: typeof logger): Promise<any | null> {
  try {
    const userConnections = UserPluginConnections.getInstance();
    const connection = await userConnections.findActiveConnectionByProfileData(
      'whatsapp-business',
      { phone_number_id: phoneNumberId }
    );
    return connection;
  } catch (error) {
    log.error({ err: error, phoneNumberId }, 'Error finding user by phone_number_id');
    return null;
  }
}

// Helper: Handle incoming message
async function handleIncomingMessage(
  userConnection: any,
  message: any,
  businessPhone: string | undefined,
  log: typeof logger
): Promise<void> {
  log.info({
    from: message.from,
    messageId: message.id,
    type: message.type,
    userId: userConnection.user_id
  }, 'Incoming message');

  // Extract message details
  const messageData: Record<string, any> = {
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

  log.debug({ messageData }, 'Processed message data');

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
  status: any,
  log: typeof logger
): Promise<void> {
  log.info({
    messageId: status.id,
    status: status.status,
    recipient: status.recipient_id,
    userId: userConnection.user_id
  }, 'Message status update');

  const statusData: Record<string, any> = {
    message_id: status.id,
    status: status.status, // sent, delivered, read, failed
    timestamp: status.timestamp,
    recipient: status.recipient_id,
    user_id: userConnection.user_id
  };

  // Handle errors if present
  if (status.errors && Array.isArray(status.errors)) {
    statusData['errors'] = status.errors;
    log.error({ errors: status.errors, messageId: status.id }, 'Message delivery errors');
  }

  // TODO: Update message status in your database
  // - Update the status of the outgoing message
  // - Notify user of delivery/read status
  // - Handle failed messages
}
