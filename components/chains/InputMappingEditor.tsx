// components/chains/InputMappingEditor.tsx
'use client'

import { useEffect } from 'react'
import { Input } from '@/components/ui/input'

interface InputMappingEditorProps {
  step: any
  index: number
  agents: any[]
  updateStep: (index: number, key: string, value: any) => void
}

export function InputMappingEditor({ step, index, agents, updateStep }: InputMappingEditorProps) {
  const inputMap = step.input_map || []

  const handleFieldChange = (fieldIndex: number, key: string, value: string) => {
    const newMap = [...inputMap]
    newMap[fieldIndex] = { ...newMap[fieldIndex], [key]: value }
    updateStep(index, 'input_map', newMap)
  }

  const addFieldMapping = () => {
    updateStep(index, 'input_map', [...inputMap, { input_key: '', source: '', path: '' }])
  }

  const removeFieldMapping = (fieldIndex: number) => {
    const newMap = inputMap.filter((_, i) => i !== fieldIndex)
    updateStep(index, 'input_map', newMap)
  }

  useEffect(() => {
    if (!Array.isArray(step.input_map)) {
      updateStep(index, 'input_map', [])
    }
  }, [])

  return (
    <div className="space-y-2">
      <h4 className="font-medium text-sm text-gray-700">Input Mapping</h4>
      {inputMap.map((field: any, i: number) => (
        <div key={i} className="flex gap-2">
          <Input
            placeholder="Input Key"
            value={field.input_key || ''}
            onChange={(e) => handleFieldChange(i, 'input_key', e.target.value)}
          />
          <Input
            placeholder="Source Step (e.g. step1)"
            value={field.source || ''}
            onChange={(e) => handleFieldChange(i, 'source', e.target.value)}
          />
          <Input
            placeholder="Output Path (e.g. summary)"
            value={field.path || ''}
            onChange={(e) => handleFieldChange(i, 'path', e.target.value)}
          />
          <button onClick={() => removeFieldMapping(i)} className="text-red-500 font-bold">✕</button>
        </div>
      ))}
      <button onClick={addFieldMapping} className="text-blue-500 text-sm">+ Add Mapping</button>
    </div>
  )
}