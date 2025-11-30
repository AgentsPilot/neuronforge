/**
 * @deprecated This entire file is deprecated and should not be used.
 * Please use the v2 plugin system instead.
 */

import { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { pluginRegistry } from '@/lib/plugins/pluginRegistry'

/** @deprecated Use v2 plugin system instead */
export async function GET(req: NextRequest, { params }: { params: { plugin: string } }) {
  const pluginKey = params.plugin
  const strategy = pluginRegistry[pluginKey]

  if (!strategy) {
    return new Response(`Plugin "${pluginKey}" not found`, { status: 404 })
  }

  const cookieStore = cookies()

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (key) => cookieStore.get(key)?.value,
        set: () => {},
        remove: () => {},
      },
    }
  )

  try {
    // 🧠 Connect logic defined per plugin (e.g., Gmail, Slack)
    const popup = {
      location: { href: '' },
      document: { write: () => {} },
      close: () => {},
    }

    // This fake popup lets the strategy build the URL
    await strategy.connect({ supabase, popup })

    return new Response(null, {
      status: 302,
      headers: {
        Location: popup.location.href,
      },
    })
  } catch (err: any) {
    return new Response(`Failed to start OAuth: ${err.message}`, { status: 500 })
  }
}