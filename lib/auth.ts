import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { supabaseUrl, supabaseAnonKey } from './supabaseClient'

export async function getUser(req: Request) {
  const cookieStore = cookies()
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: () => cookieStore
  })

  const {
    data: { user },
    error
  } = await supabase.auth.getUser()

  if (error || !user) return null
  return user
}