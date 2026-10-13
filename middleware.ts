// middleware.ts
// Route middleware to handle:
// 1. Subdomain routing for public websites (*.agentspilot.ai)
// 2. Onboarding-v2 redirect for new users
// 3. V1/V2 UI version routing

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createEdgeLogger } from '@/lib/logger/edge'
import { isReservedPrefix } from '@/lib/business-os/reservedPrefixes'
import { publicSiteHost, publicSitePath } from '@/lib/utils/origins'
import { onboardingVerdict } from '@/lib/security/onboardingVerdict'

/*
 * Middleware runs in the Edge Runtime, where Pino cannot initialise — no
 * stdout, no worker threads. `createEdgeLogger` emits the same record shape
 * (level, time, module, msg) through the only sink available, so these lines
 * are indistinguishable from the rest of the platform's logs downstream.
 */
const logger = createEdgeLogger({ module: 'Middleware' })

/*
 * The reserved list lives in `lib/business-os/reservedPrefixes.ts` now.
 *
 * It used to be declared here AND in the availability checker, and the two
 * disagreed: `preview` was reserved here but reported available there, so a
 * business could be told the name was free, have the write succeed, and end up
 * with a permanently unreachable site — this file would treat `preview` as
 * reserved and serve the platform instead. Silently, with no error anywhere.
 *
 * One list, three importers: this file, the checker, and the write path.
 */

/**
 * Paths whose URL IS a credential.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Every one of these carries a signed token or an unguessable id in the PATH,
 * and that path is what a browser puts in the `Referer` header when the visitor
 * follows a link off the page. The portal renders the business's own website
 * and social links, so "follows a link off the page" is a thing clients
 * routinely do from a page whose URL opens their booking.
 *
 * Modern browsers default to `strict-origin-when-cross-origin`, which withholds
 * the path cross-origin, so the practical exposure today is small. It is a
 * default, not a guarantee: it does not bind older browsers, embedded webviews,
 * or a page that sets a looser policy of its own. `no-referrer` closes it by
 * construction, costs nothing these pages use, and was already the decision for
 * `/invite` — this only extends it to the four surfaces that carry the same
 * class of secret.
 * ─────────────────────────────────────────────────────────────────────────────
 */
function carriesASecretInTheUrl(pathname: string): boolean {
  return (
    pathname.startsWith('/book/manage/') ||
    pathname.startsWith('/invoice/') ||
    pathname.startsWith('/proposal/') ||
    pathname.startsWith('/consent/') ||
    pathname === '/invite' ||
    pathname.startsWith('/invite/')
  )
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

  /*
   * === A BUSINESS'S PUBLIC PAGES ===
   *
   * `joesgym.agentspilot.ai/book` is served by `/s/joesgym/book`, rewritten
   * INTERNALLY so the visitor's address bar keeps the business's own address.
   * `app.agentspilot.ai` is the platform and reaches none of this, because
   * `app` is on the reserved list — which is the only thing standing between a
   * business and the platform's own hostname.
   *
   * The old guard here was `!isLocalhost && host.endsWith(baseHost)`, with
   * `baseHost` defaulting to `agentpilot.io` — a domain that was never served,
   * and one that matched none of the three the interface displayed.
   *
   * Two changes. The host now comes from `publicSiteHost()`, the single place
   * any address is decided. And the check is "is this host the configured
   * public-site host" rather than "is this local": bailing on anything
   * containing `localhost` meant the subdomain path could not be exercised off
   * production, so it would have shipped having never run. With
   * NEXT_PUBLIC_PUBLIC_SITE_HOST=lvh.me:3000, `joesgym.lvh.me:3000` now goes
   * through this exact code on a laptop.
   */
  const siteHost = publicSiteHost()

  if (siteHost && host !== siteHost && host.endsWith(`.${siteHost}`)) {
    const prefix = host.slice(0, -(siteHost.length + 1)).toLowerCase()

    /*
     * One label only. `a.b.agentspilot.ai` is not a business — the write path
     * rejects dots in a prefix, so anything deeper than one label here is
     * either stale DNS or someone probing, and it falls through to the app
     * rather than being served as somebody's site.
     */
    if (prefix && !prefix.includes('.') && !isReservedPrefix(prefix)) {
      const url = request.nextUrl.clone()
      url.pathname = publicSitePath(prefix, pathname === '/' ? '' : pathname)
      return NextResponse.rewrite(url)
    }
  }

  /*
   * === THE PUBLIC INVITE PAGE (Business OS invite-only signup) ===
   *
   * `/invite#t=…` is opened by people who have no account yet, and by admins
   * testing a link they just created. It must never be sent to onboarding: a
   * signed-in visitor whose onboarding is incomplete would otherwise land on
   * `/onboarding-chat` instead of the invitation (SA F-6).
   *
   * `Referrer-Policy: no-referrer` because this page carries a secret (T-7).
   * The token itself is in the fragment, which no browser sends, but nothing
   * about this page should ever leak its address to another origin.
   *
   * After the subdomain rewrite above on purpose: a business's own site may
   * have an `/invite` page of its own, and that is still served as its site.
   */
  if (pathname === '/invite' || pathname.startsWith('/invite/')) {
    const response = NextResponse.next()
    response.headers.set('Referrer-Policy', 'no-referrer')
    return response
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
    // The marketing-consent confirmation a client opens from their email.
    // Public for the same reason as the two above — the signed token in the
    // URL is the authorisation — and it was the one client-facing surface
    // missing from this list. A visitor with no session fell through
    // harmlessly, but a client who also happens to be a signed-in AgentPilot
    // user with onboarding unfinished was redirected into onboarding instead
    // of being allowed to confirm, which is a consent decision silently lost.
    pathname.startsWith('/consent/') ||
    // The two generic post-Stripe screens. Matched exactly, because the
    // owner-facing `/payments` dashboard lives under the same first segment and
    // must keep its auth and onboarding checks.
    pathname === '/payments/success' ||
    pathname === '/payments/cancelled' ||
    /*
     * Anything a browser or a tool fetches on its own.
     *
     * `.json` and `/.well-known/` were missing, and Chrome asks for
     * `/.well-known/appspecific/com.chrome.devtools.json` unprompted on every
     * page — which measured 1.85 SECONDS of onboarding work, because the
     * remote `auth.getUser` below took 1.58s and the profile read another
     * 262ms. For a file no human asked for.
     */
    pathname.match(
      /\.(ico|png|jpg|jpeg|svg|gif|webp|avif|woff|woff2|ttf|eot|html|json|txt|xml|map|webmanifest)$/
    ) ||
    pathname.startsWith('/.well-known/') ||
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
    const response = NextResponse.next()

    if (carriesASecretInTheUrl(pathname)) {
      /* The booking portal, an invoice, a quote, a consent confirmation: the
         URL is the credential, so it must not travel in a `Referer` header. */
      response.headers.set('Referrer-Policy', 'no-referrer')

      /*
       * And must never be held by anything between us and the client.
       *
       * These pages render one client's appointment, address and bill. The
       * route-segment config says the same thing to Next; this says it to
       * every proxy, CDN and browser cache in between, which is the half that
       * matters once the credential moves out of the path and one URL starts
       * rendering different content per caller.
       */
      response.headers.set('Cache-Control', 'private, no-store, max-age=0, must-revalidate')
    }

    return response
  }

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * WHY THERE IS NO PREFETCH SHORTCUT HERE.
   *
   * Next's App Router prefetches every `<Link>` in the viewport, and each
   * prefetch is a real request to a real page path, so none of the exemptions
   * above catch them. A dozen links means a dozen of these at once, which is
   * the burst that took the server down.
   *
   * The obvious answer — skip when `Next-Router-Prefetch: 1` is present — does
   * not work, and it is worth recording why so nobody tries it again. Next
   * STRIPS its own routing headers before middleware runs. Measured: a request
   * sent with `Next-Router-Prefetch`, `RSC` and `purpose` reached this function
   * with only
   *
   *     accept, host, purpose, user-agent, x-forwarded-*
   *
   * Both Next headers were gone. A prefetch is indistinguishable from a
   * navigation here.
   *
   * So the burst is handled where it actually lands: `onboardingVerdict`
   * below shares ONE in-flight lookup between every concurrent request for the
   * same token, instead of starting a dozen.
   * ───────────────────────────────────────────────────────────────────────────
   */

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
        const verdict = await onboardingVerdict(accessToken, requestLogger)

        if (verdict === 'onboard') {
          requestLogger.info('Redirecting to onboarding')
          const url = request.nextUrl.clone()
          url.pathname = '/onboarding-chat'
          return NextResponse.redirect(url)
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
