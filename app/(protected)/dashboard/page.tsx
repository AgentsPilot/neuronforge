'use client'

import React from 'react'
import LogoutButton from '@/components/LogoutButton'
import Link from 'next/link'

export default function DashboardPage() {
  return (
    <div className="min-h-screen relative flex flex-col items-center justify-center">
      {/* Top-right Logout Button */}
      <div className="absolute top-4 right-4">
        <LogoutButton />
      </div>

      {/* Centered Content */}
      <h1 className="text-3xl font-bold mb-6">Welcome to your Dashboard!</h1>

      <Link
        href="/agents/new"
        className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition"
      >
        Create New Agent
      </Link>
    </div>
  )
}