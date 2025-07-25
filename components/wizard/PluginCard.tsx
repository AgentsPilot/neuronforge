'use client'

import React from 'react'

type PluginCardProps = {
  pluginKey: string
  pluginName: string
  icon: React.ReactNode
  description: string
  connected: boolean
  selected: boolean
  disabled?: boolean
  onToggle: () => void
}

export default function PluginCard({
  pluginKey,
  pluginName,
  icon,
  description,
  connected,
  selected,
  disabled = false,
  onToggle,
}: PluginCardProps) {
  return (
    <div
      className={`border rounded-lg p-4 shadow-sm transition ${
        disabled ? 'opacity-50 cursor-not-allowed' : 'hover:shadow-md cursor-pointer'
      } ${selected ? 'border-blue-500' : 'border-gray-200'}`}
      onClick={() => {
        if (!disabled) onToggle()
      }}
    >
      <div className="flex items-center space-x-2 mb-2">
        {icon}
        <h3 className="font-semibold">{pluginName}</h3>
      </div>
      <p className="text-sm text-gray-600">{description}</p>
      {connected ? (
        <p className="text-xs text-green-600 mt-2">Connected</p>
      ) : (
        <p className="text-xs text-gray-400 mt-2">Not Connected</p>
      )}
    </div>
  )
}