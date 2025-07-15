'use client'

import { useState } from 'react'
//import PluginManager from '@/components/PluginManager'
//import GmailCredentialModal from '@/components/modal/GmailCredentialModal'

interface Props {
  data: {
    connectedPlugins: { [key: string]: any }
  }
  onUpdate: (data: Partial<Props['data']>) => void
}

export default function Step4Plugins({ data, onUpdate }: Props) {
  const [isGmailModalOpen, setIsGmailModalOpen] = useState(false)

  const handleGmailSave = (credentials: { email: string; password: string }) => {
    onUpdate({
      connectedPlugins: {
        ...data.connectedPlugins,
        gmail: {
          connected: true,
          credentials,
        },
      },
    })
    setIsGmailModalOpen(false)
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-600">
        Drag a service like Gmail onto the canvas and connect it with credentials.
      </p>


    </div>
  )
}