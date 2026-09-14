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
    // The quote a client opens from their email. Unauthenticated by design —
    // the signed token in the URL is the authorisation — so it must never be
    // rewritten under /v2, where it 404s.
    pathname.startsWith('/proposal/') ||
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
    pathname.startsWith('/test-plugins-v2') ||
    pathname.startsWith('/test-business-os')

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

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * The V2 rewrite used to live here, and is gone.
   *
   * It read `system_settings_config.ui_version` on every navigation and, while
   * that row said `v2`, moved any path not on an exemption list to `/v2{path}`.
   * It was the switch for the V1 dashboard → V2 dashboard migration, and it
   * outlived both: Business OS is the product now, and it was exempt, so the
   * rewrite decided nothing for any page a user actually visits.
   *
   * What it still did was break the ones nobody had thought to exempt. `/`
   * redirected to `/v2`, which is not a page — a 404 on the app's own root.
   * `/reset-password` redirected to `/v2/reset-password`, likewise. `/book` and
   * `/proposal` had each been fixed by adding another prefix to the list.
   *
   * Removing it also removes a service-role client and a round trip to read one
   * global row, on every request, before a page could begin rendering.
   *
   * `/v2/*` pages still exist and still resolve if visited directly; nothing
   * sends anyone there. `lib/design-system-v2` and `components/v2/V2Header` are
   * a separate matter and very much alive — Business OS renders both.
   * ───────────────────────────────────────────────────────────────────────────
   */

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
