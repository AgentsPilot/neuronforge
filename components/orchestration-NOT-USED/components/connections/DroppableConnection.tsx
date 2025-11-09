import { useState } from 'react'
import { IOItem } from '../../types/connections'

interface DroppableConnectionProps {
  stepIndex: number
  type: 'input' | 'output'
  input?: IOItem | string
  onConnect: (connection: any) => void
}

export const DroppableConnection = ({ 
  stepIndex, 
  type, 
  input,
  onConnect 
}: DroppableConnectionProps) => {
  const [isOver, setIsOver] = useState(false)

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsOver(true)
  }

  const handleDragLeave = () => {
    setIsOver(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsOver(false)
    
    try {
      const dragData = JSON.parse(e.dataTransfer.getData('application/json'))
      
      // Only allow output to input connections
      if (dragData.type === 'io' && dragData.ioType === 'output' && type === 'input') {
        onConnect({
          fromStep: dragData.stepIndex,
          toStep: stepIndex,
          fromIO: dragData.item,
          toInput: input
        })
      }
    } catch (error) {
      console.error('Failed to parse dropped connection data:', error)
    }
  }

  const inputName = typeof input === 'object' ? input.name : input
  const inputDescription = typeof input === 'object' ? input.description : undefined

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`border-2 border-dashed rounded-lg p-3 text-center transition-all min-h-[60px] flex items-center justify-center ${
        isOver ? 'border-purple-400 bg-purple-50' : 'border-slate-300 bg-slate-50 hover:border-blue-300 hover:bg-blue-50'
      }`}
    >
      <div className="flex items-center gap-2">
        <div className={`w-3 h-3 rounded-full ${type === 'input' ? 'bg-blue-500' : 'bg-green-500'}`} />
        <div className="text-sm">
          {input ? (
            <div>
              <div className="font-medium text-slate-900">{inputName}</div>
              {inputDescription && (
                <div className="text-xs text-slate-600">{inputDescription}</div>
              )}
            </div>
          ) : (
            <span className="text-slate-600">
              {isOver ? `Drop ${type === 'input' ? 'output' : 'input'} here` : `Connect ${type}`}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}