'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { pluginList as availablePlugins } from '@/lib/plugins/pluginList'
import PluginCard from '@/components/settings/PluginCard'

export default function ConnectionsPage() {
  const [search, setSearch] = useState('')

  const filteredPlugins = availablePlugins.filter((plugin) =>
    plugin.name.toLowerCase().includes(search.toLowerCase()) ||
    plugin.description.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="max-w-5xl mx-auto px-4 py-10">
      <h1 className="text-3xl font-bold text-gray-800 mb-6">Connect Your Services</h1>

      <div className="mb-8">
        <Input
          placeholder="Search for an integration (e.g. Gmail, Notion, Slack...)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-md px-4 py-2 border border-gray-300 rounded-lg shadow-sm"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
        {filteredPlugins.length > 0 ? (
          filteredPlugins.map((plugin) => (
            <PluginCard
              key={plugin.pluginKey}
              pluginKey={plugin.pluginKey}
              pluginName={plugin.pluginName}
              description={plugin.description}
              icon={plugin.icon}
            />
          ))
        ) : (
          <p className="text-gray-500 col-span-full">No integrations found.</p>
        )}
      </div>
    </div>
  )
}