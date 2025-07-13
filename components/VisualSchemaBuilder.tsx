// components/VisualSchemaBuilder.tsx
'use client'

import { useState } from 'react'
import {
  DndContext,
  useDraggable,
  useDroppable,
  DragOverlay,
} from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Trash2 } from 'lucide-react'

const FIELD_TYPES = [
  { type: 'string', label: 'Text' },
  { type: 'number', label: 'Number' },
  { type: 'boolean', label: 'Checkbox' },
  { type: 'enum', label: 'Dropdown' },
  { type: 'date', label: 'Date Picker' },
]

export default function VisualSchemaBuilder({ schema, onSchemaChange }: { schema: any[]; onSchemaChange: (val: any[]) => void }) {
  const [draggedType, setDraggedType] = useState<any>(null)

  const handleDrop = () => {
    if (!draggedType) return
    const newField = {
      id: crypto.randomUUID(),
      name: '',
      type: draggedType.type,
      required: false,
      enumOptions: draggedType.type === 'enum' ? ['Option 1'] : undefined,
    }
    onSchemaChange([...schema, newField])
    setDraggedType(null)
  }

  return (
    <DndContext onDragEnd={handleDrop}>
      <div className="grid grid-cols-5 gap-4">
        <div className="col-span-1 space-y-2">
          <h3 className="font-semibold text-gray-700 mb-2">Field Types</h3>
          {FIELD_TYPES.map((field) => (
            <DraggableField key={field.type} field={field} onDragStart={() => setDraggedType(field)} />
          ))}
        </div>

        <DroppableCanvas schema={schema} onSchemaChange={onSchemaChange} />

        <DragOverlay>
          {draggedType ? (
            <div className="p-2 bg-blue-100 border rounded shadow text-sm">{draggedType.label}</div>
          ) : null}
        </DragOverlay>
      </div>
    </DndContext>
  )
}

function DraggableField({ field, onDragStart }: any) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: field.type })

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onMouseDown={onDragStart}
      className="p-2 bg-white border rounded shadow cursor-grab hover:bg-gray-50 text-sm"
    >
      {field.label}
    </div>
  )
}

function DroppableCanvas({ schema, onSchemaChange }: any) {
  const { isOver, setNodeRef } = useDroppable({ id: 'canvas' })

  const updateField = (id: string, key: string, value: any) => {
    onSchemaChange(schema.map((f: any) => (f.id === id ? { ...f, [key]: value } : f)))
  }

  const addEnumOption = (id: string) => {
    onSchemaChange(schema.map((f: any) => f.id === id ? { ...f, enumOptions: [...(f.enumOptions || []), ''] } : f))
  }

  const updateEnum = (id: string, index: number, value: string) => {
    onSchemaChange(schema.map((f: any) => {
      if (f.id !== id) return f
      const updated = [...f.enumOptions]
      updated[index] = value
      return { ...f, enumOptions: updated }
    }))
  }

  const removeField = (id: string) => {
    onSchemaChange(schema.filter((f: any) => f.id !== id))
  }

  return (
    <div
      ref={setNodeRef}
      className={`col-span-4 min-h-[300px] p-6 border-2 rounded-xl ${isOver ? 'border-blue-500 bg-blue-50' : 'border-gray-300'} bg-white space-y-4`}
    >
      {schema.length === 0 && <p className="text-sm text-gray-400">Drag fields here to define your schema</p>}

      {schema.map((field: any) => (
        <div key={field.id} className="border p-4 rounded-lg bg-gray-50 shadow-sm space-y-2">
          <div className="flex justify-between items-center">
            <input
              type="text"
              value={field.name}
              onChange={(e) => updateField(field.id, 'name', e.target.value)}
              placeholder="Field name"
              className="px-3 py-1 border rounded w-full"
            />
            <button onClick={() => removeField(field.id)} className="ml-2 text-red-500 hover:text-red-700">
              <Trash2 size={18} />
            </button>
          </div>
          {field.type === 'enum' && (
            <div className="space-y-1">
              <label className="text-xs font-semibold text-gray-600">Enum Options</label>
              {field.enumOptions?.map((opt: string, i: number) => (
                <input
                  key={i}
                  value={opt}
                  onChange={(e) => updateEnum(field.id, i, e.target.value)}
                  className="w-full px-2 py-1 border rounded"
                  placeholder={`Option ${i + 1}`}
                />
              ))}
              <button
                type="button"
                onClick={() => addEnumOption(field.id)}
                className="text-xs text-blue-600 hover:underline mt-1"
              >
                ➕ Add Option
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}