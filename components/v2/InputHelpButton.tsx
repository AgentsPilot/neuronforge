'use client'
import React from 'react'
import { Sparkles } from 'lucide-react'

type InputHelpButtonProps = {
  agentId: string
  fieldName: string
  plugin?: string
  expectedType: string
  onClick: () => void
}

const InputHelpButton: React.FC<InputHelpButtonProps> = ({
  fieldName, onClick
}) => {
  return (
    <button
      onClick={onClick}
      className="group inline-flex items-center justify-center w-6 h-6 text-[var(--v2-primary)] hover:text-white hover:bg-[var(--v2-primary)] active:scale-95 transition-all duration-200 border border-[var(--v2-primary)]"
      style={{ borderRadius: 'var(--v2-radius-button)' }}
      aria-label={`Get AI help for ${fieldName}`}
      type="button"
      title={`AI Help for ${fieldName}`}
    >
      <Sparkles className="w-3.5 h-3.5" />
    </button>
  )
}

export default InputHelpButton