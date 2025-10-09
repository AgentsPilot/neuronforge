'use client'

import React from 'react'
import { supabase } from '@/lib/supabaseClient'
import { 
  Brain, Database, FileText, Cog, CheckCircle, AlertCircle, Clock, Target, 
  Shield, Lightbulb, Cpu, Activity, Eye, EyeOff, ArrowRight, Play, Send,
  Download, Zap, Settings, Info, ChevronDown, ChevronUp, Loader2, Sparkles,
  Rocket, Timer, Star, Puzzle, Wand2, Coffee, Heart, Smile, PartyPopper,
  TrendingUp, Award, CheckCircle2, AlertTriangle, Terminal, Gauge, Save
} from 'lucide-react'

import { AgentSandboxProps, PHASE_PATTERNS } from './types'
import { useAgentSandbox } from './useAgentSandbox'

export default function AgentSandbox(props: AgentSandboxProps) {
  const {
    // State
    formData,
    result,
    loading,
    sendStatus,
    executionTime,
    validationErrors,
    executionContext,
    showVisualizer,
    expandedSections,
    executionLogs,
    dynamicPhases,
    executionMetrics,
    isLiveExecution,
    
    // Configuration state
    savedConfiguration,
    isConfigurationSaved,
    
    // Loading states
    loadingConfiguration,
    loadingSchema,
    schemaLoaded,
    
    // Schema debugging
    dbInputSchema,
    actualInputSchema,
    
    // Computed values
    safeInputSchema,
    safeOutputSchema,
    safePluginsRequired,
    filteredInputSchema,
    missingPlugins,
    canRun,
    
    // Handlers
    setExecutionContext,
    setShowVisualizer,
    toggleSection,
    handleInputChange,
    handleRun,
    handleDownloadPDF,
    handleSendEmail,
    handleFileUpload,
    formatDuration,
    getPluginStatus,
    isFieldRequiredInCurrentContext,
    isFormValid
  } = useAgentSandbox(props)

  const handleFormSubmit = (e: React.FormEvent, withVisualizer = false) => {
    e.preventDefault()
    handleRun(withVisualizer)
  }

  // Check if required fields are filled in configure mode
  const hasRequiredFieldsInConfigureMode = () => {
    if (executionContext !== 'configure') return true
    
    const requiredFields = filteredInputSchema.filter(field => field.required)
    return requiredFields.every(field => {
      const value = formData[field.name]
      return value !== undefined && value !== null && value !== ''
    })
  }

  return (
    <div className="space-y-4">
      {/* Header Controls - More Compact */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-gradient-to-r from-blue-50 via-purple-50 to-pink-50 rounded-xl border border-blue-200">
        <div className="flex items-center gap-2">
          <div className="relative">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center shadow-md">
              <Rocket className="h-4 w-4 text-white" />
            </div>
            {loading && (
              <div className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-green-400 rounded-full animate-pulse">
                <div className="w-full h-full bg-green-500 rounded-full animate-ping"></div>
              </div>
            )}
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900">
              {executionContext === 'test' ? 'Test Your Agent' : 'Configure Agent'}
            </h2>
            <p className="text-slate-600 text-xs">
              {executionContext === 'test' 
                ? "Let's see what magic it can do!" 
                : "Set up your agent for activation"
              }
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {/* Configuration Status Indicator */}
          {isConfigurationSaved && (
            <div className="flex items-center gap-1 px-2 py-1 bg-green-100 rounded-lg border border-green-200">
              <CheckCircle2 className="h-3 w-3 text-green-600" />
              <span className="text-green-700 font-medium text-xs">Configured</span>
            </div>
          )}
          
          {/* Execution Context Toggle */}
          <div className="flex items-center bg-white rounded-lg p-0.5 border border-slate-200">
            <button
              onClick={() => setExecutionContext('test')}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-all duration-300 ${
                executionContext === 'test'
                  ? 'bg-gradient-to-r from-blue-500 to-purple-500 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <div className="flex items-center gap-1">
                <Play className="h-3 w-3" />
                Test Mode
              </div>
            </button>
            <button
              onClick={() => setExecutionContext('configure')}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-all duration-300 ${
                executionContext === 'configure'
                  ? 'bg-gradient-to-r from-emerald-500 to-green-500 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <div className="flex items-center gap-1">
                <Settings className="h-3 w-3" />
                Configure
              </div>
            </button>
          </div>
          
          {executionContext === 'test' && (
            <button
              onClick={() => setShowVisualizer(!showVisualizer)}
              className={`flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-medium transition-all duration-300 ${
                showVisualizer 
                  ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-md transform scale-105'
                  : 'bg-white text-slate-700 border border-slate-200 hover:border-purple-300 hover:shadow-sm'
              }`}
            >
              {showVisualizer ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
              Live Mode
            </button>
          )}
          
          {executionTime && (
            <div className="flex items-center gap-1 px-2 py-1 bg-white rounded-lg border border-green-200 text-green-700">
              <Timer className="h-3 w-3" />
              <span className="font-medium text-xs">{formatDuration(executionTime)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Configuration Warning for Configure Mode */}
      {executionContext === 'configure' && !hasRequiredFieldsInConfigureMode() && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-amber-100 rounded-lg flex items-center justify-center">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
            </div>
            <div>
              <h4 className="font-semibold text-amber-900 text-sm">Configuration Required</h4>
              <p className="text-amber-700 text-xs">
                Please fill out all required fields below to activate your agent. Required fields must have values before the agent can be configured.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Input Form */}
      <form onSubmit={(e) => handleFormSubmit(e, false)} className="space-y-4">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div 
            className="bg-gradient-to-r from-slate-50 to-gray-50 p-3 border-b border-slate-200 cursor-pointer hover:from-slate-100 hover:to-gray-100 transition-colors"
            onClick={() => toggleSection('inputs')}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-gradient-to-br from-slate-600 to-gray-700 rounded-lg flex items-center justify-center">
                  <FileText className="h-4 w-4 text-white" />
                </div>
                <div>
                  <h3 className="font-semibold text-slate-900 text-sm">
                    {executionContext === 'test' ? 'What do you need?' : 'Agent Configuration'}
                  </h3>
                  <p className="text-slate-600 text-xs">
                    {filteredInputSchema.length === 0 
                      ? 'All set! No input needed'
                      : executionContext === 'test'
                      ? `Fill out the form below to test your agent`
                      : `Configure all required settings for agent activation`
                    }
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="text-xs text-slate-600">
                  {filteredInputSchema.length} field{filteredInputSchema.length !== 1 ? 's' : ''}
                </div>
                {expandedSections.inputs ? 
                  <ChevronUp className="h-4 w-4 text-slate-600" /> : 
                  <ChevronDown className="h-4 w-4 text-slate-600" />
                }
              </div>
            </div>
          </div>

          {/* Context Information */}
          {expandedSections.inputs && (
            <div className={`border-b p-3 ${
              executionContext === 'test' 
                ? 'bg-blue-50 border-blue-200' 
                : 'bg-green-50 border-green-200'
            }`}>
              <div className="flex items-center gap-2">
                <div className={`w-6 h-6 rounded-lg flex items-center justify-center ${
                  executionContext === 'test' ? 'bg-blue-100' : 'bg-green-100'
                }`}>
                  {executionContext === 'test' ? (
                    <Info className="h-3 w-3 text-blue-600" />
                  ) : (
                    <Save className="h-3 w-3 text-green-600" />
                  )}
                </div>
                <div>
                  <h4 className={`font-medium text-sm ${
                    executionContext === 'test' ? 'text-blue-900' : 'text-green-900'
                  }`}>
                    {executionContext === 'test' ? 'Test Mode Active' : 'Configuration Mode Active'}
                  </h4>
                  <p className={`text-xs ${
                    executionContext === 'test' ? 'text-blue-700' : 'text-green-700'
                  }`}>
                    {executionContext === 'test' 
                      ? 'All fields are optional for testing - fill in only what you need. Switch to Configure mode to set required fields for production.'
                      : 'Please fill out all required fields. These values will be saved and used when your agent is activated.'
                    }
                  </p>
                </div>
              </div>
            </div>
          )}

          {expandedSections.inputs && (
            <div className="p-4">
              {filteredInputSchema.length === 0 ? (
                <div className="text-center py-8">
                  <div className="w-12 h-12 bg-gradient-to-br from-green-100 to-emerald-100 rounded-xl flex items-center justify-center mx-auto mb-3">
                    <Smile className="h-6 w-6 text-green-600" />
                  </div>
                  <h4 className="font-semibold text-slate-900 mb-1 text-sm">You're all set!</h4>
                  <p className="text-slate-600 text-sm">
                    This agent works automatically with your connected tools. Just hit the {executionContext === 'test' ? 'run' : 'save'} button below!
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {filteredInputSchema.map((field, index) => {
                    const isRequired = isFieldRequiredInCurrentContext(field)
                    
                    return (
                      <div key={index} className="space-y-2">
                        <label className="block">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-sm font-medium text-slate-900">
                              {field.name}
                            </span>
                            {isRequired && (
                              <span className="text-red-500 text-sm">*</span>
                            )}
                            {executionContext === 'test' && field.required && (
                              <span className="bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-full font-medium">
                                optional in test mode
                              </span>
                            )}
                            {executionContext === 'configure' && field.required && (
                              <span className="bg-red-100 text-red-700 text-xs px-2 py-0.5 rounded-full font-medium">
                                required for activation
                              </span>
                            )}
                            <span className="bg-slate-100 text-slate-600 text-xs px-2 py-0.5 rounded-full font-medium">
                              {field.type}
                            </span>
                          </div>
                          
                          {field.description && (
                            <div className="mb-2 p-2 bg-blue-50 border border-blue-200 rounded-lg">
                              <p className="text-xs text-blue-800">{field.description}</p>
                            </div>
                          )}
                          
                          {field.type === 'enum' || field.type === 'select' ? (
                            <select
                              className={`w-full px-3 py-2 border rounded-lg text-sm transition-all focus:outline-none focus:ring-2 focus:border-blue-500 bg-white ${
                                validationErrors[field.name] 
                                  ? 'border-red-400 focus:ring-red-500 focus:border-red-500 bg-red-50' 
                                  : 'border-slate-300 hover:border-slate-400 focus:ring-blue-500'
                              }`}
                              onChange={(e) => handleInputChange(field.name, e.target.value)}
                              value={formData[field.name] || ''}
                            >
                              <option value="" className="text-slate-500">
                                {field.placeholder || 'Select an option...'}
                              </option>
                              {(field.enum || field.options || []).map((opt) => (
                                <option key={opt} value={opt}>{opt}</option>
                              ))}
                            </select>
                          ) : field.type === 'file' ? (
                            <div className="space-y-2">
                              <input
                                type="file"
                                accept="application/pdf,image/*,.txt,.csv"
                                className={`w-full px-3 py-2 border rounded-lg text-sm transition-all focus:outline-none focus:ring-2 focus:border-blue-500 bg-white file:mr-3 file:py-1 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 ${
                                  validationErrors[field.name] 
                                    ? 'border-red-400 focus:ring-red-500 focus:border-red-500' 
                                    : 'border-slate-300 hover:border-slate-400 focus:ring-blue-500'
                                }`}
                                onChange={(e) => handleFileUpload(e, field.name)}
                              />
                              {formData[field.name] && (
                                <div className="flex items-center gap-2 text-green-700 text-xs bg-green-50 border border-green-200 rounded-lg p-2">
                                  <CheckCircle2 className="h-3 w-3" />
                                  File uploaded successfully
                                </div>
                              )}
                            </div>
                          ) : field.type === 'boolean' ? (
                            <div className={`flex items-center gap-2 p-2 border rounded-lg ${
                              validationErrors[field.name] 
                                ? 'bg-red-50 border-red-300' 
                                : 'bg-slate-50 border-slate-300'
                            }`}>
                              <input
                                type="checkbox"
                                id={`field-${field.name}`}
                                className="rounded border-slate-400 h-3 w-3 text-blue-600 focus:ring-blue-500 focus:ring-2"
                                onChange={(e) => handleInputChange(field.name, e.target.checked)}
                                checked={formData[field.name] || false}
                              />
                              <label htmlFor={`field-${field.name}`} className="text-xs text-slate-700 cursor-pointer">
                                {field.placeholder || `Enable ${field.name}`}
                              </label>
                            </div>
                          ) : (
                            <input
                              type={
                                field.type === 'number' ? 'number' : 
                                field.type === 'date' ? 'date' : 
                                field.type === 'email' ? 'email' :
                                field.type === 'time' ? 'time' :
                                'text'
                              }
                              className={`w-full px-3 py-2 border rounded-lg text-sm transition-all focus:outline-none focus:ring-2 focus:border-blue-500 bg-white ${
                                validationErrors[field.name] 
                                  ? 'border-red-400 focus:ring-red-500 focus:border-red-500 bg-red-50' 
                                  : 'border-slate-300 hover:border-slate-400 focus:ring-blue-500'
                              }`}
                              placeholder={
                                field.type === 'time' ? 'HH:MM (e.g., 09:00)' : 
                                field.placeholder || `Enter ${field.name.toLowerCase()}...`
                              }
                              onChange={(e) => handleInputChange(field.name, e.target.value)}
                              value={formData[field.name] || ''}
                            />
                          )}
                        </label>
                        
                        {validationErrors[field.name] && (
                          <div className="flex items-center gap-2 text-red-600 text-xs bg-red-50 border border-red-200 rounded-lg p-2">
                            <AlertCircle className="h-3 w-3 flex-shrink-0" />
                            <span>{validationErrors[field.name]}</span>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Run Controls - More Compact */}
        <div className="bg-gradient-to-r from-blue-50 via-purple-50 to-pink-50 rounded-xl border border-blue-200 p-4">
          <div className="text-center space-y-3">
            <div className="flex items-center justify-center gap-2 mb-3">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center shadow-md ${
                executionContext === 'configure' 
                  ? 'bg-gradient-to-br from-green-500 to-emerald-500'
                  : 'bg-gradient-to-br from-purple-500 to-pink-500'
              }`}>
                {executionContext === 'configure' ? (
                  <Save className="h-4 w-4 text-white" />
                ) : (
                  <Sparkles className="h-4 w-4 text-white" />
                )}
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  {executionContext === 'configure' ? 'Ready to Configure?' : 'Ready to Launch?'}
                </h3>
                <p className="text-slate-600 text-sm">
                  {executionContext === 'configure' 
                    ? 'Save your configuration to activate your agent' 
                    : 'Your agent is waiting to show you what it can do!'
                  }
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3">
              <button
                type="submit"
                className={`px-6 py-3 rounded-xl flex items-center gap-2 font-bold transition-all duration-300 ${
                  canRun && !loading
                    ? executionContext === 'configure'
                      ? 'bg-gradient-to-r from-green-600 to-emerald-600 text-white hover:from-green-700 hover:to-emerald-700 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 hover:scale-105'
                      : 'bg-gradient-to-r from-blue-600 to-purple-600 text-white hover:from-blue-700 hover:to-purple-700 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 hover:scale-105'
                    : 'bg-slate-300 text-slate-500 cursor-not-allowed'
                }`}
                disabled={!canRun || loading}
              >
                {loading && !showVisualizer ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    {executionContext === 'test' ? 'Testing...' : 'Saving configuration...'}
                  </>
                ) : (
                  <>
                    {executionContext === 'configure' ? (
                      <>
                        <Save className="h-5 w-5" />
                        Save & Configure!
                      </>
                    ) : (
                      <>
                        <Rocket className="h-5 w-5" />
                        Test Agent!
                      </>
                    )}
                  </>
                )}
              </button>

              {showVisualizer && executionContext === 'test' && (
                <button
                  type="button"
                  className={`px-6 py-3 rounded-xl flex items-center gap-2 font-bold transition-all duration-300 ${
                    canRun && !loading
                      ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white hover:from-purple-700 hover:to-pink-700 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 hover:scale-105'
                      : 'bg-slate-300 text-slate-500 cursor-not-allowed'
                  }`}
                  onClick={() => handleRun(true)}
                  disabled={!canRun || loading}
                >
                  {loading && showVisualizer && isLiveExecution ? (
                    <>
                      <Loader2 className="h-5 w-5 animate-spin" />
                      Live streaming...
                    </>
                  ) : (
                    <>
                      <Eye className="h-5 w-5" />
                      Watch It Work!
                    </>
                  )}
                </button>
              )}
            </div>
            
            {!canRun && !loading && (
              <div className="flex items-center justify-center gap-2 text-amber-700 bg-amber-100 px-3 py-2 rounded-lg border border-amber-200">
                <AlertTriangle className="h-4 w-4" />
                <span className="font-medium text-sm">
                  {missingPlugins.length > 0 
                    ? 'Connect your tools first!'
                    : !isFormValid() 
                    ? `Fill out the required fields above ${executionContext === 'configure' ? 'to save configuration' : ''}`
                    : 'Unable to proceed'
                  }
                </span>
              </div>
            )}
          </div>
        </div>
      </form>

      {/* Live Execution Visualizer - Slightly More Compact */}
      {showVisualizer && executionContext === 'test' && (dynamicPhases.length > 0 || executionLogs.length > 0) && (
        <div className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-purple-900 to-indigo-900 opacity-95 rounded-xl"></div>
          <div className="relative p-4 text-white">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-gradient-to-br from-pink-500 to-purple-600 rounded-lg flex items-center justify-center animate-pulse">
                  <Brain className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-lg font-bold">Your Agent is Working!</h3>
                  <p className="text-blue-300 text-sm">Watch the magic happen in real-time</p>
                </div>
              </div>
              {isLiveExecution && (
                <div className="flex items-center gap-1 bg-green-500/20 px-2 py-1 rounded-lg border border-green-400/30">
                  <div className="w-2 h-2 bg-green-400 rounded-full animate-ping"></div>
                  <span className="text-green-400 font-bold text-xs">LIVE</span>
                </div>
              )}
            </div>
            
            {/* Fun Metrics - More Compact */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <div className="bg-white/10 backdrop-blur-sm rounded-lg p-3 text-center border border-white/20">
                <div className="text-lg font-bold text-yellow-400">{executionLogs.length}</div>
                <div className="text-slate-300 text-xs">Steps Taken</div>
              </div>
              <div className="bg-white/10 backdrop-blur-sm rounded-lg p-3 text-center border border-white/20">
                <div className="text-lg font-bold text-green-400">
                  {executionMetrics.confidence > 0 ? (executionMetrics.confidence * 100).toFixed(0) + '%' : '—'}
                </div>
                <div className="text-slate-300 text-xs">Confidence</div>
              </div>
              <div className="bg-white/10 backdrop-blur-sm rounded-lg p-3 text-center border border-white/20">
                <div className="text-lg font-bold text-purple-400">
                  {executionMetrics.qualityScore}
                </div>
                <div className="text-slate-300 text-xs">Quality</div>
              </div>
              <div className="bg-white/10 backdrop-blur-sm rounded-lg p-3 text-center border border-white/20">
                <div className="text-lg font-bold text-cyan-400">
                  {executionTime ? formatDuration(executionTime) : formatDuration(executionMetrics.duration)}
                </div>
                <div className="text-slate-300 text-xs">Time</div>
              </div>
            </div>

            {/* Execution Steps - More Compact */}
            <div className="space-y-3">
              <h4 className="font-bold text-white mb-3 flex items-center gap-2 text-sm">
                <Activity className="h-4 w-4" />
                What's Happening
              </h4>
              
              {dynamicPhases.map((phase, index) => {
                const IconComponent = phase.icon
                const pattern = PHASE_PATTERNS.find(p => p.id === phase.id)
                return (
                  <div
                    key={phase.id}
                    className={`bg-white/10 backdrop-blur-sm rounded-lg p-3 border transition-all duration-500 ${
                      phase.status === 'active' 
                        ? 'border-yellow-400/50 shadow-lg shadow-yellow-400/20 scale-105' 
                        : phase.status === 'completed'
                        ? 'border-green-400/50'
                        : phase.status === 'error'
                        ? 'border-red-400/50'
                        : 'border-white/20'
                    }`}
                  >
                    <div className="flex items-center gap-3 mb-2">
                      <div className={`p-2 rounded-lg bg-gradient-to-r ${phase.color} shadow-md`}>
                        <IconComponent className="h-4 w-4 text-white" />
                      </div>
                      <div className="flex-1">
                        <h5 className="font-bold text-white text-sm">{phase.title}</h5>
                        <p className="text-slate-300 text-xs">
                          {pattern?.friendlyName || phase.title}
                        </p>
                      </div>
                      <div>
                        {phase.status === 'completed' && (
                          <div className="flex items-center gap-1 text-green-400">
                            <CheckCircle2 className="h-4 w-4" />
                            <span className="text-xs font-medium">Done!</span>
                          </div>
                        )}
                        {phase.status === 'active' && (
                          <div className="flex items-center gap-1 text-yellow-400">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            <span className="text-xs font-medium">Working...</span>
                          </div>
                        )}
                        {phase.status === 'error' && (
                          <div className="flex items-center gap-1 text-red-400">
                            <AlertTriangle className="h-4 w-4" />
                            <span className="text-xs font-medium">Oops!</span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="mb-2">
                      <div className="w-full bg-white/20 rounded-full h-1.5 overflow-hidden">
                        <div
                          className={`h-full bg-gradient-to-r ${phase.color} transition-all duration-1000 rounded-full`}
                          style={{ width: `${phase.progress}%` }}
                        />
                      </div>
                      <div className="text-right text-xs text-slate-400 mt-1">
                        {phase.progress.toFixed(0)}%
                      </div>
                    </div>

                    {phase.logs.length > 0 && (
                      <div className="space-y-1">
                        <div className="text-xs text-slate-400">Latest updates:</div>
                        {phase.logs.slice(-1).map((log, logIndex) => (
                          <div
                            key={logIndex}
                            className="text-xs p-2 rounded-lg bg-black/30 text-slate-200 border border-white/10"
                          >
                            <div className="font-mono break-all">
                              {log.message.slice(0, 100)}
                              {log.message.length > 100 && '...'}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Status Message - More Compact */}
      {sendStatus && (
        <div className={`p-3 rounded-xl border flex items-center gap-2 ${
          sendStatus.includes('successfully') 
            ? 'bg-green-50 border-green-200 text-green-800' 
            : sendStatus.includes('failed') || sendStatus.includes('Failed')
            ? 'bg-red-50 border-red-200 text-red-800'
            : 'bg-blue-50 border-blue-200 text-blue-800'
        }`}>
          <div className={`w-6 h-6 rounded-lg flex items-center justify-center ${
            sendStatus.includes('successfully') ? 'bg-green-100' :
            sendStatus.includes('failed') ? 'bg-red-100' : 'bg-blue-100'
          }`}>
            {sendStatus.includes('successfully') ? (
              <PartyPopper className="h-4 w-4" />
            ) : sendStatus.includes('failed') || sendStatus.includes('Failed') ? (
              <AlertCircle className="h-4 w-4" />
            ) : (
              <Clock className="h-4 w-4" />
            )}
          </div>
          <p className="font-semibold text-sm">{sendStatus}</p>
        </div>
      )}

      {/* Results Display - More Compact */}
      {result && executionContext === 'test' && (
        <div className={`border rounded-xl overflow-hidden ${
          result.error 
            ? 'bg-red-50 border-red-200' 
            : 'bg-white border-green-200'
        }`}>
          <div className={`p-3 border-b ${
            result.error ? 'border-red-200 bg-red-100' : 'border-green-200 bg-green-50'
          }`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                  result.error ? 'bg-red-200' : 'bg-green-200'
                }`}>
                  {result.error ? (
                    <AlertCircle className="h-4 w-4 text-red-600" />
                  ) : (
                    <PartyPopper className="h-4 w-4 text-green-600" />
                  )}
                </div>
                <div>
                  <h3 className={`font-bold text-sm ${
                    result.error ? 'text-red-900' : 'text-green-900'
                  }`}>
                    {result.error ? 'Oops! Something went wrong' : 'Ta-da! Your results are ready'}
                  </h3>
                  <p className={`text-xs ${
                    result.error ? 'text-red-700' : 'text-green-700'
                  }`}>
                    {result.error ? 'Don\'t worry, we can try again' : 'Your agent did an amazing job!'}
                  </p>
                </div>
              </div>
              
              {!result.error && executionContext === 'test' && (
                <div className="flex gap-2">
                  {(getPluginStatus('google-mail') && result?.to && result?.subject && result?.body) && (
                    <button
                      className="bg-gradient-to-r from-blue-600 to-purple-600 text-white px-3 py-1 rounded-lg hover:from-blue-700 hover:to-purple-700 flex items-center gap-1 font-medium transition-all transform hover:scale-105 text-xs"
                      onClick={handleSendEmail}
                    >
                      <Send className="h-3 w-3" />
                      Send Email
                    </button>
                  )}

                  {(safeOutputSchema.some((f) => ['SummaryBlock', 'EmailDraft'].includes(f.type))) && (
                    <button
                      className="bg-gradient-to-r from-slate-600 to-gray-700 text-white px-3 py-1 rounded-lg hover:from-slate-700 hover:to-gray-800 flex items-center gap-1 font-medium transition-all transform hover:scale-105 text-xs"
                      onClick={handleDownloadPDF}
                    >
                      <Download className="h-3 w-3" />
                      Download PDF
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="p-4">
            {result.error ? (
              <div className="bg-white border border-red-200 rounded-lg p-3">
                <code className="text-red-700 text-xs font-mono">{result.error}</code>
              </div>
            ) : typeof result === 'object' ? (
              <div className="space-y-3">
                {safeOutputSchema.map((field) => (
                  <div key={field.name} className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-bold text-slate-900 text-sm">{field.name}</span>
                      <span className="bg-slate-200 text-slate-700 text-xs px-2 py-0.5 rounded-lg">
                        {field.type}
                      </span>
                    </div>
                    <div className="text-slate-900">
                      {result[field.name] ? (
                        typeof result[field.name] === 'object' ? (
                          <pre className="text-xs bg-white p-3 rounded-lg overflow-x-auto font-mono border border-slate-200">
                            {JSON.stringify(result[field.name], null, 2)}
                          </pre>
                        ) : (
                          <div className="break-words bg-white p-3 rounded-lg border border-slate-200 text-sm">
                            {result[field.name]}
                          </div>
                        )
                      ) : (
                        <div className="text-slate-500 italic bg-white p-3 rounded-lg border-2 border-dashed border-slate-200 text-center text-sm">
                          No data was returned for this field
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                <p className="break-words text-slate-900 text-sm">{result}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}