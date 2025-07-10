'use client'

import React from 'react'
import LogoutButton from '@/components/LogoutButton'

export default function DashboardPage() {
  return (
    <div className="min-h-screen p-6">
      <div className="flex justify-end">
        <LogoutButton />
      </div>
      <div className="flex flex-col items-center justify-center mt-20">
        <h1 className="text-3xl font-bold">Welcome to your Dashboard!</h1>
      </div>
    </div>
  )
}