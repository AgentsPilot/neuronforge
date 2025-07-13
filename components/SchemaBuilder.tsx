'use client'

import { useState } from 'react'
import { DndContext, closestCenter } from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import { GripVertical, Trash2 } from 'lucide-react'

const fieldTypes = ['string', 'number', 'boolean', 'object', 'array']

export default function SchemaBuilder({
  title,
  schema,
  setSchema,
  tooltip,
}: {
  title: string
  schema: any[]
  setSchema: (fields: any[]) => void
  tooltip?: string
}) {
  const handleDragEnd = (event: any) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = schema.findIndex((item) => item.id === active.id)
    const newIndex = schema.findIndex((item) => item.id === over.id)
    setSchema(arrayMove(schema, oldIndex, newIndex))
  }

  const addField = () => {
    setSchema([
      ...schema,
      {
        id: crypto.randomUUID(),
        name: '',
        type: 'string',
        required: false,
      },
    ])
  }

  const updateField = (id: string, key: string, value: any) => {
    setSchema(schema.map((field) => (field.id === id ? { ...field, [key]: value } : field)))
  }

  const removeField = (id: string) => {
    setSchema(schema.filter((field) => field.id !== id))
  }

  return (
    <div className="space-y-4">
      <div className="mb-2">
        <h2 className="text-md font-semibold text-gray-700">{title}</h2>
        {tooltip && <p className="text-xs text-gray-500">{tooltip}</p>}
      </div>

      <DndContext
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
        modifiers={[restrictToVerticalAxis]}
      >
        <SortableContext items={schema.map((f) => f.id)} strategy={verticalListSortingStrategy}>
          {schema.map((field) => (
            <SortableField
              key={field.id}
              field={field}
              onChange={updateField}
              onRemove={removeField}
            />
          ))}
        </SortableContext>
      </DndContext>

      <button
        type="button"
        onClick={addField}
        className="text-sm px-4 py-2 bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
      >
        ➕ Add Field
      </button>
    </div>
  )
}

function SortableField({ field, onChange, onRemove }: any) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: field.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="border p-4 bg-white rounded-lg shadow-sm flex flex-col gap-3"
    >
      <div className="flex justify-between items-center">
        <div {...listeners} {...attributes} className="cursor-grab text-gray-400">
          <GripVertical size={18} />
        </div>
        <button onClick={() => onRemove(field.id)} className="text-red-500 hover:text-red-700">
          <Trash2 size={18} />
        </button>
      </div>

      <input
        type="text"
        placeholder="Field name"
        value={field.name}
        onChange={(e) => onChange(field.id, 'name', e.target.value)}
        className="w-full px-3 py-2 border rounded"
      />

      <select
        value={field.type}
        onChange={(e) => onChange(field.id, 'type', e.target.value)}
        className="w-full px-3 py-2 border rounded"
      >
        {fieldTypes.map((type) => (
          <option key={type} value={type}>
            {type}
          </option>
        ))}
      </select>

      <label className="text-sm flex items-center gap-2">
        <input
          type="checkbox"
          checked={field.required}
          onChange={(e) => onChange(field.id, 'required', e.target.checked)}
        />
        Required
      </label>
    </div>
  )
}