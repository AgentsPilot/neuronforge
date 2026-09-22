/**
 * The business's newsletter audience, and the button that turns one into a client.
 *
 * `GET` lists the roster. `POST` promotes one: creates the CRM contact at the
 * owner's first pipeline stage and marks the roster row as where that contact
 * came from.
 *
 * Promotion is also automatic — a trigger on `crm_contacts` links any contact
 * created for an address that already subscribed, so somebody who simply books
 * ends up in the pipeline without anyone deciding. This route is the owner's
 * explicit version of the same thing.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { businessSubscriberRepository } from '@/lib/repositories/BusinessSubscriberRepository';
import { crmContactRepository } from '@/lib/repositories/CRMContactRepository';
import { marketingConsentRepository } from '@/lib/repositories/MarketingConsentRepository';

const logger = createLogger({ module: 'CRMSubscribersAPI' });

const PromoteSchema = z.object({ subscriberId: z.string().uuid() });

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const includePromoted =
      new URL(request.url).searchParams.get('includePromoted') === 'true';

    const { data: subscribers, error } = await businessSubscriberRepository.list(user.id, {
      includePromoted,
    });

    if (error) throw error;

    /*
     * The live consent answer, alongside the roster's own status.
     *
     * They can disagree: consent can be withdrawn through an unsubscribe link
     * that never touched this table. `marketing_consent_state` is the authority
     * on whether anybody may be emailed, so it is shown rather than inferred —
     * the roster says how far through signing up they got, this says whether
     * they can be written to today.
     */
    const { data: consent } = await marketingConsentRepository.getStateBulk(
      user.id,
      (subscribers ?? []).map((s) => s.email)
    );

    return NextResponse.json({
      success: true,
      subscribers: (subscribers ?? []).map((s) => ({
        ...s,
        mailable: consent?.get(s.email_normalized) === true,
      })),
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to list subscribers');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const parsed = PromoteSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
    }

    /*
     * Scoped to the caller. `list` is user-scoped, so finding the row through it
     * is what stops an id from another tenant being promoted into this one.
     */
    const { data: all } = await businessSubscriberRepository.list(user.id, {
      includePromoted: true,
    });
    const subscriber = (all ?? []).find((s) => s.id === parsed.data.subscriberId);

    if (!subscriber) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }

    if (subscriber.promoted_contact_id) {
      // Already a contact. Idempotent rather than an error: a double-clicked
      // button must not produce a second contact for the same person.
      return NextResponse.json({
        success: true,
        data: { contactId: subscriber.promoted_contact_id, alreadyPromoted: true },
      });
    }

    const { data: stages } = await supabaseServer
      .from('crm_pipeline_stages')
      .select('stage_key')
      .eq('user_id', user.id)
      .order('position', { ascending: true })
      .limit(1);

    const firstStage = stages?.[0]?.stage_key || 'lead';

    /*
     * A name only where one was given. The address is the fallback for display,
     * never written into the name column — inventing "offir.omer" from an
     * address is the bug that filled the CRM with fictional people.
     */
    const parts = subscriber.name?.trim().split(/\s+/) ?? [];

    const { data: contact, error: createError } = await crmContactRepository.create({
      user_id: user.id,
      first_name: parts[0] ?? null,
      last_name: parts.length > 1 ? parts.slice(1).join(' ') : null,
      email: subscriber.email,
      stage: firstStage,
      source: subscriber.source,
      // Where they came from, carried across so the contact keeps its origin.
      source_metadata: subscriber.attribution as never,
    } as never);

    if (createError || !contact) throw createError || new Error('Contact was not created');

    /*
     * The trigger on `crm_contacts` has already linked the roster row by email.
     * This call is belt and braces for the case where the trigger is absent —
     * an environment where the migration has not been applied — and is harmless
     * where it has run, because it writes the same values.
     */
    await businessSubscriberRepository.markPromoted(user.id, subscriber.email, contact.id);

    requestLogger.info(
      { userId: user.id, contactId: contact.id, stage: firstStage },
      'Subscriber promoted to the pipeline'
    );

    return NextResponse.json({
      success: true,
      data: { contactId: contact.id, alreadyPromoted: false },
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to promote a subscriber');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
