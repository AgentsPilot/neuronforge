'use client'

import { useEffect } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function Step1Basics({ data, onUpdate, initialPrompt }: {
  data: any,
  onUpdate: (data: any) => void,
  initialPrompt?: string
}) {
  useEffect(() => {
    if (initialPrompt && !data.userPrompt) {
      onUpdate({ userPrompt: initialPrompt })
    }
  }, [initialPrompt, data.userPrompt])

  return (
    <div className="space-y-6">
      <div>
        <Label htmlFor="agentName">Agent Name</Label>
        <Input
          id="agentName"
          value={data.agentName}
          onChange={(e) => onUpdate({ agentName: e.target.value })}
        />
      </div>

      <div>
        <Label htmlFor="description">Description</Label>
        <Input
          id="description"
          value={data.description}
          onChange={(e) => onUpdate({ description: e.target.value })}
        />
      </div>
    </div>
  )
}