/**
 * POST /api/crm/contacts
 * GET /api/crm/contacts
 * CRM contacts endpoints - create and list contacts
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { crmContactRepository } from '@/lib/repositories/CRMContactRepository';
import { z } from 'zod';
import { blankAsAbsent } from '@/lib/validation/blankFields';

const logger = createLogger({ module: 'CRMContactsAPI' });
const auditTrail = AuditTrailService.getInstance();

// Validation schemas
// Note: stage accepts any string since stages are dynamic from crm_pipeline_stages table
/*
 * An empty string from a form means "not filled in", so it is read as absent.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `z.string().min(1).optional()` permits UNDEFINED, not "". A browser form has
 * no way to express undefined — every untouched text input posts "" — so
 * adding a contact without choosing a source was refused:
 *
 *     "source: String must contain at least 1 character(s)"
 *
 * `first_name` and `stage` carry the same rule, and `email` is stricter still
 * ("" is not a valid address), so the same submission failed for several
 * reasons at once while the owner was told only "Invalid input".
 *
 * Normalising here rather than only at the one caller: this route is public to
 * every client in the app, and the next form to post a blank field would hit
 * exactly this again.
 * ─────────────────────────────────────────────────────────────────────────────
 */
/* Lifted to `lib/validation/blankFields` when the UPDATE route turned out to
   have the same bug and no helper. The reasoning above still belongs here —
   this is where it was found. */

const createContactSchema = z.object({
  first_name: blankAsAbsent(z.string().min(1).optional()),
  last_name: z.string().optional(),
  email: blankAsAbsent(z.string().email().optional()),
  phone: z.string().optional(),
  stage: blankAsAbsent(z.string().min(1).max(50).optional()),
  tags: z.array(z.string()).optional(),
  custom_fields: z.record(z.any()).optional(),
  source: blankAsAbsent(z.string().min(1).max(50).optional())
});

const listContactsSchema = z.object({
  stage: z.string().optional(),
  tags: z.array(z.string()).optional(),
  search: z.string().optional(),
  limit: z.number().min(1).max(100).optional(),
  offset: z.number().min(0).optional(),
  orderBy: z.enum(['created_at', 'updated_at', 'first_name', 'last_name']).optional(),
  orderDirection: z.enum(['asc', 'desc']).optional()
});

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // 1. Authenticate
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // 2. Validate input
    const body = await request.json();
    const validated = createContactSchema.parse(body);

    requestLogger.info({ userId: user.id }, 'Creating CRM contact');

    // 3. Check for duplicate email
    if (validated.email) {
      const existingContact = await crmContactRepository.findByEmail(validated.email, user.id);
      if (existingContact.data) {
        requestLogger.info({ userId: user.id, email: validated.email }, 'Duplicate contact email detected');
        return NextResponse.json(
          {
            success: false,
            error: 'duplicate_email',
            existingContact: {
              id: existingContact.data.id,
              first_name: existingContact.data.first_name,
              last_name: existingContact.data.last_name,
              email: existingContact.data.email
            }
          },
          { status: 409 }
        );
      }
    }

    // 4. Create contact
    const result = await crmContactRepository.create({
      user_id: user.id,
      ...validated
    });

    if (result.error) {
      requestLogger.error({ err: result.error, userId: user.id }, 'Failed to create contact');
      return NextResponse.json(
        { success: false, error: 'Failed to create contact' },
        { status: 500 }
      );
    }

    // 4. Audit log (non-blocking)
    auditTrail
      .log({
        action: 'CRM_CONTACT_CREATED',
        userId: user.id,
        entityType: 'crm_contact',
        entityId: result.data!.id,
        resourceName: `${result.data!.first_name || ''} ${result.data!.last_name || ''}`.trim() || result.data!.email || 'Contact',
        details: {
          stage: result.data!.stage,
          tags: result.data!.tags
        },
        request
      })
      .catch(err => requestLogger.error({ err }, 'Audit failed'));

    /*
     * The "contact created" timeline entry is NOT written here.
     *
     * It used to be, and this was the only one of about ten creation paths
     * that wrote it -- so a contact added by hand had the entry and one that
     * arrived from a website booking, an intake form or a newsletter did not.
     * `CRMContactRepository.create` now writes it for every path, which is the
     * one place they all pass through. Adding it back here would double-log.
     */

    // 5. Return success
    requestLogger.info({ contactId: result.data!.id, userId: user.id }, 'Contact created successfully');
    return NextResponse.json({
      success: true,
      contact: result.data
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      requestLogger.warn({ err: error }, 'Validation error');

      /*
       * Name the field that was wrong.
       *
       * This answered "Invalid input" and put the detail behind a
       * `NODE_ENV === 'development'` check — so in production the owner was
       * told a form of several fields was invalid, with nothing to say which.
       * The field NAME is not sensitive; it is already visible on the form
       * they are looking at. The values stay out of the response.
       */
      const firstIssue = error.errors[0];
      const fieldName = firstIssue?.path?.filter(part => typeof part === 'string').join('.');

      return NextResponse.json(
        {
          success: false,
          error: fieldName ? `Invalid input: check the ${fieldName.replace(/_/g, ' ')} field` : 'Invalid input',
          field: fieldName || undefined,
          details: process.env.NODE_ENV === 'development' ? error.errors : undefined
        },
        { status: 400 }
      );
    }

    requestLogger.error({ err: error }, 'Request failed');
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // 1. Authenticate
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // 2. Parse query parameters
    const { searchParams } = new URL(request.url);
    const orderBy = searchParams.get('orderBy');
    const orderDirection = searchParams.get('orderDirection');

    const queryParams = {
      stage: searchParams.get('stage') || undefined,
      tags: searchParams.get('tags')?.split(',') || undefined,
      search: searchParams.get('search') || undefined,
      limit: searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : undefined,
      offset: searchParams.get('offset') ? parseInt(searchParams.get('offset')!) : undefined,
      orderBy: orderBy ? orderBy as 'created_at' | 'updated_at' | 'first_name' | 'last_name' : undefined,
      orderDirection: orderDirection ? orderDirection as 'asc' | 'desc' : undefined
    };

    // Validate
    const validated = listContactsSchema.parse(queryParams);

    requestLogger.info({ userId: user.id, params: validated }, 'Listing CRM contacts');

    // 3. Get contacts
    const result = await crmContactRepository.list(user.id, validated);

    if (result.error) {
      requestLogger.error({ err: result.error, userId: user.id }, 'Failed to list contacts');
      return NextResponse.json(
        { success: false, error: 'Failed to list contacts' },
        { status: 500 }
      );
    }

    // 4. Get total count
    const countResult = await crmContactRepository.count(user.id, {
      stage: validated.stage,
      tags: validated.tags,
      search: validated.search
    });

    // 5. Return success
    return NextResponse.json({
      success: true,
      contacts: result.data,
      total: countResult.data || 0,
      limit: validated.limit || 50,
      offset: validated.offset || 0
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      requestLogger.warn({ err: error }, 'Validation error');
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid parameters',
          details: process.env.NODE_ENV === 'development' ? error.errors : undefined
        },
        { status: 400 }
      );
    }

    requestLogger.error({ err: error }, 'Request failed');
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
      },
      { status: 500 }
    );
  }
}
