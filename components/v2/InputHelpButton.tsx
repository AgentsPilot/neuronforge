'use client'
import React from 'react'

type InputHelpButtonProps = {
  agentId: string
  fieldName: string
  plugin?: string
  expectedType: string
  // Remove onFill as prop - it shouldn't be used in the button!
  onClick: () => void
}

const InputHelpButton: React.FC<InputHelpButtonProps> = ({
  agentId, fieldName, plugin, expectedType, onClick
}) => {
  return (
    <button
      onClick={onClick}
      className="text-blue-500 hover:underline text-sm"
      aria-label={`Help for ${fieldName}`}
      type="button"
    >
      ?
    </button>
  )
}

export default InputHelpButton