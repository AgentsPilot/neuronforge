'use client'

import { Dialog } from '@headlessui/react'
import { Fragment } from 'react'

export default function AgentResultModal({
  isOpen,
  onClose,
  title,
  result,
}: {
  isOpen: boolean
  onClose: () => void
  title: string
  result: string
}) {
  return (
    <Dialog open={isOpen} onClose={onClose} as={Fragment}>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
        <Dialog.Panel className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6">
          <Dialog.Title className="text-xl font-semibold mb-2 text-gray-800">
            {title}
          </Dialog.Title>
          <Dialog.Description className="text-gray-600 mb-4">
            Output from your agent:
          </Dialog.Description>
          <div className="bg-gray-100 p-4 rounded text-sm text-gray-800 whitespace-pre-wrap">
            {result}
          </div>
          <div className="mt-6 text-right">
            <button
              onClick={onClose}
              className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition"
            >
              Close
            </button>
          </div>
        </Dialog.Panel>
      </div>
    </Dialog>
  )
}