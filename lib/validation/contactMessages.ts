// lib/validation/contactMessages.ts
// Zod schemas for the contact-form inbox: the public POST /api/contact body,
// and the admin routes under /api/admin/messages (list query, PATCH body, id).
// Workplan: docs/workplans/contact-inbox-standard-workplan.md (D-3, D-5).

import { z } from 'zod';

/** The status values a contact message may hold. One list, used by the schemas and the repository type. */
export const CONTACT_MESSAGE_STATUSES = ['unread', 'read', 'replied'] as const;

/** The list filter: a status, or every status. */
export const CONTACT_MESSAGE_LIST_FILTERS = ['all', ...CONTACT_MESSAGE_STATUSES] as const;

/** Length caps (D-5). */
export const CONTACT_NAME_MAX = 200;
export const CONTACT_EMAIL_MAX = 254;
export const CONTACT_MESSAGE_MAX = 5000;
export const ADMIN_MESSAGES_SEARCH_MAX = 100;
export const ADMIN_NOTES_MAX = 5000;

/** POST /api/contact. Trimmed before the length checks; unknown keys are dropped. */
export const contactFormBodySchema = z.object({
  name: z.string().trim().min(1).max(CONTACT_NAME_MAX),
  email: z.string().trim().max(CONTACT_EMAIL_MAX).email(),
  message: z.string().trim().min(1).max(CONTACT_MESSAGE_MAX),
});

export type ContactFormBody = z.infer<typeof contactFormBodySchema>;

/** GET /api/admin/messages query. The page always sends both, often with an empty search. */
export const adminMessagesListQuerySchema = z.object({
  filter: z.enum(CONTACT_MESSAGE_LIST_FILTERS).default('all'),
  search: z.string().trim().max(ADMIN_MESSAGES_SEARCH_MAX).default(''),
});

export type AdminMessagesListQuery = z.infer<typeof adminMessagesListQuerySchema>;

/**
 * PATCH /api/admin/messages/[id] body. Strict: any key outside these three is
 * refused. `updated_at` is accepted only because the page sends it with every
 * save; it is never passed on, the server sets the time (D-3).
 */
export const adminMessagePatchSchema = z
  .object({
    status: z.enum(CONTACT_MESSAGE_STATUSES).optional(),
    // '' is allowed so notes can be cleared.
    admin_notes: z.string().max(ADMIN_NOTES_MAX).optional(),
    updated_at: z.string().optional(),
  })
  .strict()
  .refine((body) => body.status !== undefined || body.admin_notes !== undefined, {
    message: 'Nothing to update',
  });

export type AdminMessagePatch = z.infer<typeof adminMessagePatchSchema>;

/** The `[id]` route segment. */
export const adminMessageIdParamSchema = z.string().uuid();
