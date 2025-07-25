'use client'

import { useAuth } from '@/components/UserProvider'
import { redirect, usePathname } from 'next/navigation'
import { useEffect } from 'react'
import Link from 'next/link'
import clsx from 'clsx'

const SidebarLink = ({
  href,
  label,
}: {
  href: string
  label: string
}) => {
  const pathname = usePathname()

  return (
    <Link
      href={href}
      className={clsx(
        'text-sm px-3 py-2 rounded hover:bg-gray-200 dark:hover:bg-gray-800',
        pathname === href && 'bg-gray-300 dark:bg-gray-800 font-semibold'
      )}
    >
      {label}
    </Link>
  )
}

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()

  useEffect(() => {
    if (!user) {
      redirect('/login')
    }
  }, [user])

  if (!user) return null

  return (
    <div className="flex min-h-screen bg-white dark:bg-gray-950 text-gray-900 dark:text-white">
      {/* Sidebar */}
      <aside className="w-64 bg-gray-100 dark:bg-gray-900 p-6 border-r border-gray-200 dark:border-gray-800 shadow-sm">
        <h2 className="text-xl font-bold mb-8 text-blue-600">🧠 AgentPilot</h2>
        <nav className="flex flex-col gap-3">
          <SidebarLink href="/dashboard" label="📊 Dashboard" />
          <SidebarLink href="/agents" label="🤖 Agent(s)" />
          <SidebarLink href="/settings/connections" label="🔌 Connections" />
        </nav>
      </aside>

      {/* Main content */}
      <main className="flex-1 p-8 overflow-y-auto">{children}</main>
    </div>
  )
}