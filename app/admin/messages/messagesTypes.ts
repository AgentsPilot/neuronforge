/**
 * The contact-message shapes the list route answers (Admin Layout Standard
 * L-7: moved out of `page.tsx` unchanged, apart from the two named unions).
 * No markup and no read here.
 */

export type MessageStatus = 'unread' | 'read' | 'replied';

export type MessagePriority = 'low' | 'normal' | 'high' | 'urgent';

export interface ContactMessage {
  id: string;
  name: string;
  email: string;
  message: string;
  status: MessageStatus;
  email_sent: boolean;
  created_at: string;
  // New optional fields we'll add to the table
  subject?: string;
  phone?: string;
  company?: string;
  priority?: MessagePriority;
  source?: 'contact_form' | 'email' | 'phone' | 'chat';
  updated_at?: string;
  admin_notes?: string;
  replies?: MessageReply[];
}

export interface MessageReply {
  id: string;
  message_id: string;
  sender: 'admin' | 'user';
  content: string;
  created_at: string;
  admin_id?: string;
}
