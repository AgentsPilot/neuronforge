/**
 * GET / PATCH /api/business-os/preferences
 *
 * The server side of `LanguageContext`. Its reads and writes used to run from
 * the browser straight against Supabase, which breaks CLAUDE.md rule 1. They
 * now come here and go through the repositories, scoped to the session user.
 *
 * GET returns the stored values RAW, in two independent halves:
 *
 *   locale    { preferredLanguage, timezone } from `user_preferences`
 *   currency  { businessCurrency } from `business_profiles.currency`
 *
 * A value is `null` when unset; a HALF is `null` when it could not be read, so
 * one failing read does not discard the other, and the client can still tell
 * "nothing stored" (which triggers the language backfill) from "unknown"
 * (which must not). 500 only when both fail. The client validates the values,
 * as it always has.
 *
 * PATCH takes one setting per request, because the two have different failure
 * rules:
 *
 *   { language }  writes BOTH `user_preferences.preferred_language` and
 *                 `business_profiles.language`. They are always written
 *                 together (see `lib/business-os/userLanguage.ts`).
 *
 *   { currency }  writes `business_profiles.currency`, the business's DEFAULT.
 *                 The database refuses a change once money exists in the old
 *                 currency (`business_currency_lock`), and that comes back as
 *                 409 `CURRENCY_LOCKED` so the picker can revert and explain.
 *
 * The currency sent must be the owner's pick. The client's display currency
 * (`currencyCode`, localStorage-backed) must never be sent here.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { SUPPORTED_LANGUAGES } from '@/lib/business-os/userLanguage';
import { userPreferencesRepository } from '@/lib/repositories/UserPreferencesRepository';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';

const logger = createLogger({ module: 'BusinessOsPreferencesAPI' });
const auditTrail = AuditTrailService.getInstance();

/** The currencies the picker offers (`CURRENCY_CONFIGS` in LanguageContext). */
const BUSINESS_CURRENCIES = ['USD', 'EUR', 'ILS', 'GBP'] as const;

/** SQLSTATE raised by `business_currency_lock` (20261008_currency_locks.sql). */
const CHECK_VIOLATION = '23514';

const preferencesSchema = z.union([
  z.object({ language: z.enum(SUPPORTED_LANGUAGES) }).strict(),
  z.object({ currency: z.enum(BUSINESS_CURRENCIES) }).strict(),
]);

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const [localeResult, currencyResult] = await Promise.all([
      userPreferencesRepository.findLocale(user.id),
      businessProfileRepository.findDefaultCurrency(user.id),
    ]);

    if (localeResult.error || currencyResult.error) {
      requestLogger.error(
        {
          userId: user.id,
          localeFailed: Boolean(localeResult.error),
          currencyFailed: Boolean(currencyResult.error),
        },
        'Preferences read failed'
      );
    }

    if (localeResult.error && currencyResult.error) {
      return NextResponse.json(
        { success: false, error: 'Failed to load preferences' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        locale: localeResult.error
          ? null
          : {
              preferredLanguage: localeResult.data?.preferredLanguage ?? null,
              timezone: localeResult.data?.timezone ?? null,
            },
        currency: currencyResult.error ? null : { businessCurrency: currencyResult.data ?? null },
      },
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Preferences read request failed');
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details:
          process.env.NODE_ENV === 'development'
            ? error instanceof Error
              ? error.message
              : String(error)
            : undefined,
      },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
    }
    const validated = preferencesSchema.parse(body);

    if ('language' in validated) {
      const { language } = validated;
      requestLogger.info({ userId: user.id, language }, 'Language update requested');

      const [prefResult, profileResult] = await Promise.all([
        userPreferencesRepository.upsertPreferredLanguage(user.id, language),
        businessProfileRepository.updateLanguage(user.id, language),
      ]);

      if (prefResult.error || profileResult.error) {
        requestLogger.error(
          {
            userId: user.id,
            preferencesFailed: Boolean(prefResult.error),
            profileFailed: Boolean(profileResult.error),
          },
          'Language update failed'
        );
        return NextResponse.json(
          { success: false, error: 'Failed to save the language' },
          { status: 500 }
        );
      }

      auditTrail
        .log({
          action: AUDIT_EVENTS.SETTINGS_PREFERENCES_UPDATED,
          entityType: 'settings',
          entityId: user.id,
          userId: user.id,
          changes: { after: { language } },
          request,
        })
        .catch(err => requestLogger.error({ err }, 'Audit failed (non-blocking)'));

      return NextResponse.json({ success: true, data: { language } });
    }

    const { currency } = validated;
    requestLogger.info({ userId: user.id, currency }, 'Business currency update requested');

    const { error } = await businessProfileRepository.updateDefaultCurrency(user.id, currency);

    if (error) {
      if ((error as Error & { code?: string }).code === CHECK_VIOLATION) {
        requestLogger.info({ userId: user.id, currency }, 'Business currency change refused: money exists');
        return NextResponse.json(
          {
            success: false,
            error: 'The currency cannot change once invoices or payments exist in it',
            code: 'CURRENCY_LOCKED',
          },
          { status: 409 }
        );
      }

      requestLogger.error({ err: error, userId: user.id }, 'Business currency update failed');
      return NextResponse.json(
        { success: false, error: 'Failed to save the currency' },
        { status: 500 }
      );
    }

    auditTrail
      .log({
        action: AUDIT_EVENTS.SETTINGS_CURRENCY_CHANGED,
        entityType: 'business_profile',
        entityId: user.id,
        userId: user.id,
        changes: { after: { currency } },
        request,
      })
      .catch(err => requestLogger.error({ err }, 'Audit failed (non-blocking)'));

    return NextResponse.json({ success: true, data: { currency } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid input', details: error.flatten() },
        { status: 400 }
      );
    }
    requestLogger.error({ err: error }, 'Preferences request failed');
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details:
          process.env.NODE_ENV === 'development'
            ? error instanceof Error
              ? error.message
              : String(error)
            : undefined,
      },
      { status: 500 }
    );
  }
}
