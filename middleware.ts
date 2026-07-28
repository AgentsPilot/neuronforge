// middleware.ts
// Route middleware to handle:
// 1. Subdomain routing for public websites (*.agentpilot.io)
// 2. Onboarding-v2 redirect for new users
// 3. V1/V2 UI version routing

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'

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
    pathname.match(/\.(ico|png|jpg|jpeg|svg|gif|woff|woff2|ttf|eot|html)$/) ||
    pathname.startsWith('/login') ||
    pathname.startsWith('/signup') ||
    pathname.startsWith('/auth') ||
    pathname.startsWith('/onboarding') || // Both /onboarding and /onboarding-v2
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

    console.log('🔍 [MIDDLEWARE] Checking onboarding for path:', pathname)

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

    console.log('🔍 [MIDDLEWARE] Found', chunks.length, 'cookie chunks')

    if (chunks.length > 0) {
      // Combine all chunks and decode
      const combined = chunks.join('')
      const decoded = Buffer.from(combined, 'base64').toString('utf-8')
      const tokenData = JSON.parse(decoded)
      const accessToken = tokenData.access_token

      console.log('🔍 [MIDDLEWARE] Access token extracted:', !!accessToken)

      if (accessToken) {
        // Create Supabase client with service role for DB queries
        const supabase = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!
        )

        // Verify the token and get user
        const { data: { user }, error: authError } = await supabase.auth.getUser(accessToken)

        console.log('🔍 [MIDDLEWARE] User found:', !!user, 'Auth error:', !!authError)

        if (!authError && user) {
          // Check business_profiles table for onboarding status
          const { data: profile, error: profileError } = await supabase
            .from('business_profiles')
            .select('onboarding_completed')
            .eq('user_id', user.id)
            .single()

          console.log('🔍 [MIDDLEWARE] Profile:', profile, 'Error:', profileError?.message)
          console.log('🔍 [MIDDLEWARE] Onboarding completed:', profile?.onboarding_completed)

          // If no profile or onboarding not completed → redirect to onboarding-v2
          // IMPORTANT: We ONLY check business_profiles table, NOT user_metadata
          // This ensures all users go through onboarding-v2, even if they completed old onboarding
          if (profileError || !profile || !profile.onboarding_completed) {
            console.log('✅ [MIDDLEWARE] REDIRECTING TO /onboarding-v2')
            const url = request.nextUrl.clone()
            url.pathname = '/onboarding-v2'
            return NextResponse.redirect(url)
          } else {
            console.log('⏭️  [MIDDLEWARE] Onboarding completed, skipping redirect')
          }
        }
      }
    }
  } catch (error) {
    console.error('❌ [MIDDLEWARE] Onboarding check error:', error)
    // On error, continue (don't block access)
  }

  // Check for manual override via query param (for testing)
  const uiParam = request.nextUrl.searchParams.get('ui')
  if (uiParam === 'v1' || uiParam === 'v2') {
    if (uiParam === 'v2' && !pathname.startsWith('/v2')) {
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
      console.error('Middleware: Error fetching UI version:', error)
      return NextResponse.next()
    }

    const uiVersion = data?.value as 'v1' | 'v2'

    // If V2 is enabled and not already on V2 route, redirect
    // EXCEPT for onboarding routes and business-os routes - they should stay as-is
    if (uiVersion === 'v2' && !pathname.startsWith('/v2') && !pathname.startsWith('/onboarding') && !pathname.startsWith('/business-os')) {
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
    console.error('Middleware: Error:', error)
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
