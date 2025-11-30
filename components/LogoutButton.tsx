'use client'

import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

export default function LogoutButton() {
  const router = useRouter()

  const handleLogout = async () => {
    try {
      // Get user before signing out (for audit logging)
      const { data: { user } } = await supabase.auth.getUser()

      // AUDIT TRAIL: Log logout
      if (user) {
        try {
          await fetch('/api/audit/log', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-user-id': user.id
            },
            body: JSON.stringify({
              action: 'USER_LOGOUT',
              entityType: 'user',
              entityId: user.id,
              userId: user.id,
              resourceName: user.email || 'User',
              details: {
                logout_timestamp: new Date().toISOString(),
                method: 'manual'
              },
              severity: 'info',
              complianceFlags: ['SOC2']
            })
          })
          console.log('✅ Logout audit logged')
        } catch (auditError) {
          console.error('⚠️ Audit logging failed (non-critical):', auditError)
        }
      }

      // Sign out
      await supabase.auth.signOut()
      router.push('/login')
    } catch (error) {
      console.error('Logout error:', error)
      // Even if audit fails, proceed with logout
      await supabase.auth.signOut()
      router.push('/login')
    }
  }

  return (
    <button
      onClick={handleLogout}
      className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700 transition"
    >
      Logout
    </button>
  )
}