// middleware.ts
// Route middleware to handle:
// 1. Subdomain routing for public websites (*.agentpilot.io)
// 2. Onboarding-v2 redirect for new users
// 3. V1/V2 UI version routing

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createEdgeLogger } from '@/lib/logger/edge'

/*
 * Middleware runs in the Edge Runtime, where Pino cannot initialise — no
 * stdout, no worker threads. `createEdgeLogger` emits the same record shape
 * (level, time, module, msg) through the only sink available, so these lines
 * are indistinguishable from the rest of the platform's logs downstream.
 */
const logger = createEdgeLogger({ module: 'Middleware' })

// List of reserved subdomains that should NOT be treated as user websites
const RESERVED_SUBDOMAINS = [
  'www',
  'app',
  'api',
  'admin',
  'dashboard',
  'localhost',
  'staging',
  'dev',
  'test',
  'preview'
]

/**
 * Paths that must never be rewritten under `/v2`.
 *
 * The V2 rewrite moves everything not on this list to `/v2{path}`. A route
 * added outside these prefixes silently starts 404ing for every V2 account,
 * and the failure looks nothing like its cause — which is exactly what happened
 * when the website preview moved out of `/business-os` and began resolving to
 * `/v2/website-preview/...`.
 *
 * `/website-preview` is here rather than under `/business-os` because that
 * segment's layout paints the platform header and tab bar, and this page is
 * rendered inside a 320px iframe where that chrome has no business appearing.
 */
const V2_REWRITE_EXEMPT = [
  '/v2',
  '/onboarding',
  '/business-os',
  '/invoice',
  '/website-preview',
  // Same reason as the line above: the landing page wizard's preview iframe.
  // It lived under `/business-os`, so it inherited that segment's header and
  // tabs — the whole platform chrome, rendered a second time inside a preview
  // frame — and every load went through the onboarding check on its way there.
  '/landing-preview',
  // Customer-facing public surfaces. These already return early from the
  // onboarding skip list above, so listing them here changes nothing today —
  // it is here so that reordering the two blocks, or adding a path to one and
  // not the other, cannot silently start redirecting a customer's booking or
  // invoice link into `/v2/...`. That is precisely how `/book` broke.
  '/book',
  '/c',
  '/go',
  '/site',
  '/payments/success',
  '/payments/cancelled',
] as const;

/** Whether this path keeps its own URL under the V2 rewrite. */
function isV2Exempt(pathname: string): boolean {
  return V2_REWRITE_EXEMPT.some(prefix => pathname.startsWith(prefix));
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const host = request.headers.get('host') || ''

  /*
   * Every line below carries the path and a correlation id.
   *
   * Middleware sees every request, so its logs were the highest-volume and the
   * least usable in the platform: a dozen emoji-prefixed strings with nothing
   * tying one request's lines together. Following a single user through an
   * onboarding redirect meant reading interleaved output and guessing.
   */
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID()
  const requestLogger = logger.child({ correlationId, pathname })

  // EXPLICIT BYPASS: Never process onboarding-chat through middleware
  if (pathname === '/onboarding-chat' || pathname.startsWith('/onboarding-chat/')) {
    requestLogger.debug('Bypassing all checks for onboarding chat')
    return NextResponse.next()
  }

  // === SUBDOMAIN ROUTING FOR PUBLIC WEBSITES ===
  // Check if this is a subdomain request (e.g., mybusiness.agentpilot.io)
  const isLocalhost = host.includes('localhost') || host.includes('127.0.0.1')
  const baseHost = process.env.NEXT_PUBLIC_WEBSITE_BASE_HOST || 'agentpilot.io'

  if (!isLocalhost && host.endsWith(baseHost)) {
    // Extract subdomain
    const subdomain = host.replace(`.${baseHost}`, '').toLowerCase()

    // Skip if it's a reserved subdomain or the base domain itself
    if (subdomain && !RESERVED_SUBDOMAINS.includes(subdomain) && subdomain !== baseHost) {
      // Rewrite to /site/[subdomain] for public website rendering
      const url = request.nextUrl.clone()
      url.pathname = `/site/${subdomain}${pathname === '/' ? '' : pathname}`
      return NextResponse.rewrite(url)
    }
  }

  // Skip onboarding check for:
  // - Static files (images, fonts, HTML)
  // - API routes
  // - OAuth callbacks
  // - Marketing pages
  // - Login/signup pages
  // - Onboarding pages (to avoid redirect loops)
  // - Public website routes (/site/*)
  const skipOnboardingCheck =
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/oauth') ||
    pathname.startsWith('/static') ||
    pathname.startsWith('/site') || // Public website routes
    pathname.startsWith('/c/') || // Public conversion pages (standalone booking, contact, payment)
    pathname.startsWith('/go/') || // Smart link redirects
    // Public booking management pages (reschedule, cancel, intake).
    // The bare `/book` fallback is matched explicitly: a `startsWith('/book/')`
    // test alone lets `/book` fall through to the V2 rewrite below and redirect
    // to `/v2/book`, which does not exist. A truncated link in a customer's
    // email is exactly the case that page is supposed to catch.
    pathname === '/book' ||
    pathname.startsWith('/book/') ||
    pathname.startsWith('/invoice/') || // Public invoice pages
    // The two generic post-Stripe screens. Matched exactly, because the
    // owner-facing `/payments` dashboard lives under the same first segment and
    // must keep its auth and onboarding checks.
    pathname === '/payments/success' ||
    pathname === '/payments/cancelled' ||
    pathname.match(/\.(ico|png|jpg|jpeg|svg|gif|woff|woff2|ttf|eot|html)$/) ||
    pathname.startsWith('/login') ||
    pathname.startsWith('/signup') ||
    pathname.startsWith('/auth') ||
    pathname.startsWith('/onboarding') || // /onboarding-chat and its build screen
    pathname.startsWith('/about') ||
    pathname.startsWith('/features') ||
    pathname.startsWith('/pricing') ||
    pathname.startsWith('/blog') ||
    pathname.startsWith('/contact') ||
    pathname.startsWith('/use-cases') ||
    pathname.startsWith('/test-plugins-v2')

  // IMPORTANT: /v2, /admin, and / are NOT in the skip list
  // They need to check onboarding status

  if (skipOnboardingCheck) {
    return NextResponse.next()
  }

  // === ONBOARDING CHECK (runs for protected routes) ===
  try {
    // Extract access token from cookies
    const cookies = request.headers.get('cookie') || ''

    requestLogger.debug('Checking onboarding status')

    // Supabase auth cookies are chunked into multiple parts (.0, .1, .2, etc)
    // We need to find all chunks and combine them
    const cookieName = 'sb-jgccgkyhpwirgknnceoh-auth-token'
    const chunks: string[] = []
    let chunkIndex = 0

    while (true) {
      const chunkRegex = new RegExp(`${cookieName}\\.${chunkIndex}=([^;]+)`)
      const match = cookies.match(chunkRegex)
      if (!match) break

      // Remove 'base64-' prefix if present
      const chunkValue = match[1].replace(/^base64-/, '')
      chunks.push(chunkValue)
      chunkIndex++
    }

    requestLogger.debug({ chunks: chunks.length }, 'Auth cookie chunks found')

    if (chunks.length > 0) {
      // Combine all chunks and decode
      const combined = chunks.join('')
      const decoded = Buffer.from(combined, 'base64').toString('utf-8')
      const tokenData = JSON.parse(decoded)
      const accessToken = tokenData.access_token

      requestLogger.debug({ hasAccessToken: !!accessToken }, 'Access token extracted')

      if (accessToken) {
        // Create Supabase client with service role for DB queries
        const supabase = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!
        )

        // Verify the token and get user
        const { data: { user }, error: authError } = await supabase.auth.getUser(accessToken)

        requestLogger.debug({ hasUser: !!user, hasAuthError: !!authError }, 'Token verified')

        if (!authError && user) {
          // Check business_profiles table for onboarding status
          const { data: profile, error: profileError } = await supabase
            .from('business_profiles')
            .select('onboarding_completed')
            .eq('user_id', user.id)
            .single()

          requestLogger.debug(
            {
              userId: user.id,
              hasProfile: !!profile,
              onboardingCompleted: profile?.onboarding_completed ?? null,
              profileError: profileError?.message,
            },
            'Onboarding status resolved'
          )

          // If no profile or onboarding not completed → the onboarding chat.
          // IMPORTANT: We ONLY check business_profiles table, NOT user_metadata
          // This ensures all users go through onboarding, even if they completed
          // an older version of it.
          if (profileError || !profile || !profile.onboarding_completed) {
            requestLogger.info({ userId: user.id }, 'Redirecting to onboarding')
            const url = request.nextUrl.clone()
            url.pathname = '/onboarding-chat'
            return NextResponse.redirect(url)
          } else {
            requestLogger.debug({ userId: user.id }, 'Onboarding complete; continuing')
          }
        }
      }
    }
  } catch (error) {
    requestLogger.error({ err: error }, 'Onboarding check failed; allowing the request through')
    // On error, continue (don't block access)
  }

  // Check for manual override via query param (for testing)
  const uiParam = request.nextUrl.searchParams.get('ui')
  if (uiParam === 'v1' || uiParam === 'v2') {
    // Same exemptions as the database-driven rewrite below — a manual `?ui=v2`
    // must not send a preview iframe somewhere the automatic path would not.
    if (uiParam === 'v2' && !isV2Exempt(pathname)) {
      const url = request.nextUrl.clone()
      url.pathname = `/v2${pathname}`
      return NextResponse.redirect(url)
    }
    if (uiParam === 'v1' && pathname.startsWith('/v2')) {
      const url = request.nextUrl.clone()
      url.pathname = pathname.replace(/^\/v2/, '')
      return NextResponse.redirect(url)
    }
  }

  /*
   * The UI version decides two redirects, and for most paths it decides nothing.
   *
   * Read the two conditions below. `uiVersion === 'v2'` only redirects a path
   * that is NOT v2-exempt; `uiVersion === 'v1'` only redirects a path already
   * under `/v2`. So for an exempt path that is not `/v2` — every `/business-os`
   * page, every `/onboarding` page, every public `/book`, `/c`, `/go`, `/site`
   * and `/invoice` link — both conditions are false whatever the database says,
   * and all three exits return `NextResponse.next()`.
   *
   * The query still ran. A fresh service-role client and a round trip to read
   * one global row, on every navigation, to reach a conclusion already fixed by
   * the pathname. It is the third of three round trips the middleware makes
   * before a page can start rendering, and for the whole Business OS it was
   * pure cost.
   *
   * Skipping it is not a cache and has no staleness: the result could not have
   * changed the response.
   */
  const uiVersionCanRedirect = !isV2Exempt(pathname) || pathname.startsWith('/v2')

  if (!uiVersionCanRedirect) {
    return NextResponse.next()
  }

  // Fetch UI version from database
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { data, error } = await supabase
      .from('system_settings_config')
      .select('value')
      .eq('key', 'ui_version')
      .single()

    if (error) {
      requestLogger.error({ err: error }, 'Could not read the UI version; leaving the path unchanged')
      return NextResponse.next()
    }

    const uiVersion = data?.value as 'v1' | 'v2'

    // If V2 is enabled and not already on V2 route, redirect
    // EXCEPT for onboarding routes, business-os routes, and public invoice pages - they should stay as-is
    if (uiVersion === 'v2' && !isV2Exempt(pathname)) {
      const url = request.nextUrl.clone()
      url.pathname = `/v2${pathname}`
      return NextResponse.redirect(url)
    }

    // If V1 is enabled and currently on V2 route, redirect back
    if (uiVersion === 'v1' && pathname.startsWith('/v2')) {
      const url = request.nextUrl.clone()
      url.pathname = pathname.replace(/^\/v2/, '')
      return NextResponse.redirect(url)
    }
  } catch (error) {
    requestLogger.error({ err: error }, 'UI version routing failed; leaving the path unchanged')
    return NextResponse.next()
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}
