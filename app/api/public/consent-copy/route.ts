/**
 * The consent sentence a public form should show.
 *
 * Public and unauthenticated, because every caller is a form on a page a
 * visitor is looking at. It returns only what is already printed on that page:
 * the business's own wording and a link to its own privacy notice.
 *
 * One endpoint rather than threading props through six different form
 * components — the website blocks, the smart-link pages and the two booking
 * widgets have no shared parent to thread them from, and a second copy of this
 * resolution is how the checkbox on one surface ends up saying something the
 * ledger does not record.
 *
 * `capture_enabled: false` returns no statement. The form then renders no
 * checkbox at all, which is a different thing from a hidden pre-ticked one.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { resolveStatement } from '@/lib/consent/defaultStatements';
import { resolvePrivacyPolicyUrl } from '@/lib/consent/privacyPolicyUrl';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { marketingConsentRepository } from '@/lib/repositories/MarketingConsentRepository';
import { resolvePublicBranding } from '@/lib/branding/publicBranding';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'ConsentCopyAPI' });

const QuerySchema = z
  .object({
    subdomain: z.string().max(100).optional(),
    userCode: z.string().max(100).optional(),
    locale: z.string().max(8).optional(),
  })
  .refine((q) => Boolean(q.subdomain || q.userCode), {
    message: 'Either subdomain or userCode is required',
  });

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const url = new URL(request.url);
    const parsed = QuerySchema.safeParse({
      subdomain: url.searchParams.get('subdomain') || undefined,
      userCode: url.searchParams.get('userCode') || undefined,
      locale: url.searchParams.get('locale') || undefined,
    });

    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
    }

    const { subdomain, userCode, locale } = parsed.data;

    const brand = await resolvePublicBranding(
      subdomain ? { by: 'subdomain', subdomain } : { by: 'userCode', userCode: userCode! }
    );

    if (!brand) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }

    const [{ data: settings }, { data: profile }] = await Promise.all([
      marketingConsentRepository.settings(brand.userId),
      businessProfileRepository.findByUserId(brand.userId),
    ]);

    // Off means this business does not do marketing email. No statement, so
    // the form renders no checkbox.
    if (settings && settings.capture_enabled === false) {
      return NextResponse.json({ success: true, data: { enabled: false } });
    }

    const statement = resolveStatement({
      locale: locale || brand.locale,
      businessName: brand.businessName,
      tenantStatements: settings,
    });

    const privacyPolicyUrl = await resolvePrivacyPolicyUrl(brand.userId, settings, profile);

    return NextResponse.json(
      {
        success: true,
        data: {
          enabled: true,
          text: statement.text,
          locale: statement.locale,
          version: statement.version,
          privacyPolicyUrl,
        },
      },
      {
        // Short, and short deliberately. A longer cache means a visitor agrees
        // to wording the business has already replaced, which `recordConsent`
        // then has to flag as a mismatch.
        headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=120' },
      }
    );
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to resolve consent copy');
    // A form must render without this. The checkbox is simply absent.
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
