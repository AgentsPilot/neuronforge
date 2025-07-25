'use client'

import { Button } from '@/components/ui/button'
import { useRouter } from 'next/navigation'

export default function WizardPluginCard({
  pluginKey,
  pluginName,
  description,
  icon,
  isConnected,
  onConnect,
}: {
  pluginKey: string
  pluginName: string
  description: string
  icon: string
  isConnected: boolean
  onConnect: () => void
}) {
  const router = useRouter()

  return (
    <div className="border p-4 rounded shadow-sm bg-white flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <span className="text-2xl">{icon}</span>
        <div>
          <h3 className="font-bold">{pluginName}</h3>
          <p className="text-sm text-gray-600">{description}</p>
        </div>
      </div>
      {isConnected ? (
        <Button disabled className="bg-green-600 hover:bg-green-700 text-white">
          ✅ Connected
        </Button>
      ) : (
        <Button onClick={onConnect} className="bg-blue-600 hover:bg-blue-700 text-white">
          🔌 Connect
        </Button>
      )}
    </div>
  )
}