// middleware.ts
// Route middleware to handle V1/V2 UI version routing

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Skip middleware for:
  // - Static files
  // - API routes
  // - Marketing pages
  // - Admin pages
  // - Already on V2 route
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/static') ||
    pathname.match(/\.(ico|png|jpg|jpeg|svg|gif|woff|woff2|ttf|eot)$/) ||
    pathname.startsWith('/v2') ||
    pathname.startsWith('/admin') ||
    pathname === '/' ||
    pathname.startsWith('/login') ||
    pathname.startsWith('/signup') ||
    pathname.startsWith('/auth') ||
    pathname.startsWith('/onboarding') ||
    pathname.startsWith('/about') ||
    pathname.startsWith('/features') ||
    pathname.startsWith('/pricing') ||
    pathname.startsWith('/blog') ||
    pathname.startsWith('/contact') ||
    pathname.startsWith('/use-cases') ||
    pathname.startsWith('/test-plugins-v2')
  ) {
    return NextResponse.next()
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
    if (uiVersion === 'v2' && !pathname.startsWith('/v2')) {
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
