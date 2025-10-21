'use client'

import { useState, useEffect, Fragment } from 'react'
import { Dialog, Transition } from '@headlessui/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, Edit, Eye, X } from 'lucide-react'
import { AdditionalConfig } from '@/lib/types/plugin-additional-config'

interface AdditionalConfigModalProps {
  isOpen: boolean
  onClose: () => void
  pluginKey: string
  pluginName: string
  additionalConfig: AdditionalConfig
  existingData?: Record<string, any>
  mode: 'create' | 'view' | 'edit'
  userId: string
  onSuccess: (data: Record<string, any>) => void
  onCancel: () => void
}

export default function AdditionalConfigModal({
  isOpen,
  onClose,
  pluginKey,
  pluginName,
  additionalConfig,
  existingData = {},
  mode: initialMode,
  userId,
  onSuccess,
  onCancel
}: AdditionalConfigModalProps) {
  const [mode, setMode] = useState<'create' | 'view' | 'edit'>(initialMode)
  const [formData, setFormData] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [generalError, setGeneralError] = useState<string | null>(null)

  // Initialize form data with existing data or empty strings
  useEffect(() => {
    const initialData: Record<string, string> = {}
    additionalConfig.fields.forEach(field => {
      initialData[field.key] = existingData[field.key] || ''
    })
    setFormData(initialData)
  }, [additionalConfig, existingData])

  // Reset mode when modal opens/closes
  useEffect(() => {
    setMode(initialMode)
    setErrors({})
    setGeneralError(null)
  }, [isOpen, initialMode])

  const isViewMode = mode === 'view'
  const isCreateMode = mode === 'create'

  const handleInputChange = (key: string, value: string) => {
    setFormData(prev => ({ ...prev, [key]: value }))
    // Clear error for this field when user types
    if (errors[key]) {
      setErrors(prev => {
        const newErrors = { ...prev }
        delete newErrors[key]
        return newErrors
      })
    }
  }

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {}

    additionalConfig.fields.forEach(field => {
      if (field.required && (!formData[field.key] || formData[field.key].trim() === '')) {
        newErrors[field.key] = `${field.label} is required`
      }
    })

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async () => {
    if (!validateForm()) {
      return
    }

    setIsSubmitting(true)
    setGeneralError(null)

    try {
      const endpoint = isCreateMode ? '/api/plugins/additional-config' : '/api/plugins/additional-config'
      const method = isCreateMode ? 'POST' : 'PUT'

      const response = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          pluginKey,
          additionalData: formData
        })
      })

      const result = await response.json()

      if (!result.success) {
        throw new Error(result.error || 'Failed to save configuration')
      }

      onSuccess(formData)
      onClose()

    } catch (error: any) {
      console.error('Error saving additional config:', error)
      setGeneralError(error.message || 'Failed to save configuration')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCancel = async () => {
    // Check if there are required fields and if we're in create mode
    if (isCreateMode) {
      const hasRequiredFields = additionalConfig.fields.some(f => f.required)
      const allRequiredFieldsFilled = additionalConfig.fields
        .filter(f => f.required)
        .every(f => formData[f.key] && formData[f.key].trim() !== '')

      if (hasRequiredFields && !allRequiredFieldsFilled) {
        // User is canceling without filling required fields - trigger disconnect
        if (confirm(`${pluginName} requires additional information to work properly. If you cancel, the plugin will be disconnected. Continue?`)) {
          onCancel()
          onClose()
        }
      } else {
        // Optional fields or all required fields filled
        onClose()
      }
    } else {
      // View or edit mode - just close
      onClose()
    }
  }

  const handleEdit = () => {
    setMode('edit')
  }

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={handleCancel}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black bg-opacity-25" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4 text-center">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-md transform overflow-hidden rounded-2xl bg-white p-6 text-left align-middle shadow-xl transition-all">
                <div className="flex items-center justify-between mb-4">
                  <Dialog.Title className="text-lg font-medium leading-6 text-gray-900 flex items-center gap-2">
                    {isViewMode ? <Eye className="w-5 h-5" /> : <Edit className="w-5 h-5" />}
                    {isViewMode ? 'View' : (isCreateMode ? 'Configure' : 'Edit')} {pluginName} Settings
                  </Dialog.Title>
                  <button
                    onClick={handleCancel}
                    className="text-gray-400 hover:text-gray-500 transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <Dialog.Description className="text-sm text-gray-500 mb-4">
                  {isViewMode
                    ? 'View your plugin configuration details'
                    : `${isCreateMode ? 'Complete the configuration' : 'Update the configuration'} for ${pluginName}`
                  }
                </Dialog.Description>

                <div className="space-y-4">
                  {additionalConfig.fields.map(field => (
                    <div key={field.key} className="space-y-2">
                      <Label htmlFor={field.key}>
                        {field.label}
                        {field.required && !isViewMode && <span className="text-red-500 ml-1">*</span>}
                      </Label>

                      {field.description && (
                        <p className="text-xs text-gray-500">{field.description}</p>
                      )}

                      <Input
                        id={field.key}
                        type={field.type}
                        value={formData[field.key] || ''}
                        onChange={(e) => handleInputChange(field.key, e.target.value)}
                        placeholder={field.placeholder}
                        disabled={isViewMode || isSubmitting}
                        className={errors[field.key] ? 'border-red-500' : ''}
                        readOnly={isViewMode}
                      />

                      {errors[field.key] && (
                        <p className="text-xs text-red-500">{errors[field.key]}</p>
                      )}
                    </div>
                  ))}

                  {generalError && (
                    <div className="p-3 bg-red-50 border border-red-200 rounded">
                      <p className="text-sm text-red-700">{generalError}</p>
                    </div>
                  )}
                </div>

                <div className="mt-6 flex justify-end gap-2">
                  {isViewMode ? (
                    <>
                      <Button variant="outline" onClick={onClose}>
                        Close
                      </Button>
                      <Button onClick={handleEdit}>
                        <Edit className="w-4 h-4 mr-2" />
                        Edit
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button variant="outline" onClick={handleCancel} disabled={isSubmitting}>
                        Cancel
                      </Button>
                      <Button onClick={handleSubmit} disabled={isSubmitting}>
                        {isSubmitting ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin mr-2" />
                            Saving...
                          </>
                        ) : (
                          'Save'
                        )}
                      </Button>
                    </>
                  )}
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  )
}
