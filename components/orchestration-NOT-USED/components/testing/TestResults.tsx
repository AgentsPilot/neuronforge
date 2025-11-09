// components/orchestration/components/testing/TestResults.tsx
import React, { useState } from 'react'
import { 
  CheckCircle, 
  XCircle, 
  AlertTriangle, 
  Clock, 
  Download, 
  Eye, 
  EyeOff,
  ChevronDown,
  ChevronRight,
  FileText,
  Activity,
  Zap
} from 'lucide-react'
import { TestResult } from '../../types/workflow'

interface TestResultsProps {
  results: TestResult[]
  title?: string
  className?: string
  showExport?: boolean
}

interface GroupedResults {
  success: TestResult[]
  error: TestResult[]
  warning: TestResult[]
}

export const TestResults: React.FC<TestResultsProps> = ({
  results,
  title = "Test Results",
  className = '',
  showExport = true
}) => {
  const [expandedResults, setExpandedResults] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState<'all' | 'success' | 'error' | 'warning'>('all')
  const [showDetails, setShowDetails] = useState(true)

  const toggleExpanded = (stepId: string) => {
    const newExpanded = new Set(expandedResults)
    if (newExpanded.has(stepId)) {
      newExpanded.delete(stepId)
    } else {
      newExpanded.add(stepId)
    }
    setExpandedResults(newExpanded)
  }

  const groupedResults: GroupedResults = {
    success: results.filter(r => r.status === 'success'),
    error: results.filter(r => r.status === 'error'),
    warning: results.filter(r => r.status === 'warning')
  }

  const filteredResults = filter === 'all' ? results : groupedResults[filter]

  const totalDuration = results.reduce((acc, result) => {
    return acc + (result.duration || 0)
  }, 0)

  const exportResults = () => {
    const dataStr = JSON.stringify({
      timestamp: new Date().toISOString(),
      summary: {
        total: results.length,
        success: groupedResults.success.length,
        error: groupedResults.error.length,
        warning: groupedResults.warning.length,
        totalDuration
      },
      results
    }, null, 2)

    const dataBlob = new Blob([dataStr], { type: 'application/json' })
    const url = URL.createObjectURL(dataBlob)
    const link = document.createElement('a')
    link.href = url
    link.download = `workflow-test-results-${new Date().toISOString().split('T')[0]}.json`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const getStatusIcon = (status: TestResult['status']) => {
    switch (status) {
      case 'success':
        return <CheckCircle className="h-4 w-4 text-green-600" />
      case 'error':
        return <XCircle className="h-4 w-4 text-red-600" />
      case 'warning':
        return <AlertTriangle className="h-4 w-4 text-amber-600" />
      default:
        return <Clock className="h-4 w-4 text-slate-400" />
    }
  }

  const getStatusColor = (status: TestResult['status']) => {
    switch (status) {
      case 'success':
        return 'border-green-200 bg-green-50'
      case 'error':
        return 'border-red-200 bg-red-50'
      case 'warning':
        return 'border-amber-200 bg-amber-50'
      default:
        return 'border-slate-200 bg-slate-50'
    }
  }

  if (results.length === 0) {
    return (
      <div className={`border border-slate-200 rounded-lg p-8 text-center bg-white ${className}`}>
        <Activity className="h-12 w-12 mx-auto mb-3 text-slate-400" />
        <h3 className="font-medium text-slate-900 mb-1">No Test Results</h3>
        <p className="text-sm text-slate-600">Run some tests to see results here.</p>
      </div>
    )
  }

  return (
    <div className={`border border-slate-200 rounded-lg bg-white ${className}`}>
      {/* Header */}
      <div className="border-b border-slate-200 p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gradient-to-r from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center">
              <FileText className="h-4 w-4 text-white" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
              <p className="text-sm text-slate-600">
                {results.length} test{results.length !== 1 ? 's' : ''} completed in {totalDuration}ms
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="px-3 py-2 text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors flex items-center gap-2 text-sm"
            >
              {showDetails ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              {showDetails ? 'Hide' : 'Show'} Details
            </button>

            {showExport && (
              <button
                onClick={exportResults}
                className="px-3 py-2 text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors flex items-center gap-2 text-sm"
              >
                <Download className="h-4 w-4" />
                Export
              </button>
            )}
          </div>
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-4 gap-4 mt-4">
          <div className="text-center">
            <div className="text-2xl font-bold text-slate-900">{results.length}</div>
            <div className="text-xs text-slate-600">Total</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-green-600">{groupedResults.success.length}</div>
            <div className="text-xs text-slate-600">Success</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-amber-600">{groupedResults.warning.length}</div>
            <div className="text-xs text-slate-600">Warnings</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-red-600">{groupedResults.error.length}</div>
            <div className="text-xs text-slate-600">Errors</div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="border-b border-slate-200 p-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-700">Filter:</span>
          {(['all', 'success', 'warning', 'error'] as const).map((filterType) => (
            <button
              key={filterType}
              onClick={() => setFilter(filterType)}
              className={`px-3 py-1 text-sm rounded-full transition-colors ${
                filter === filterType
                  ? 'bg-blue-100 text-blue-700 font-medium'
                  : 'text-slate-600 hover:text-slate-800 hover:bg-slate-100'
              }`}
            >
              {filterType.charAt(0).toUpperCase() + filterType.slice(1)}
              {filterType !== 'all' && (
                <span className="ml-1 text-xs">
                  ({filterType === 'success' ? groupedResults.success.length :
                    filterType === 'warning' ? groupedResults.warning.length :
                    groupedResults.error.length})
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Results List */}
      <div className="divide-y divide-slate-200">
        {filteredResults.map((result) => {
          const isExpanded = expandedResults.has(result.stepId)
          
          return (
            <div key={result.stepId} className="p-4">
              {/* Result Header */}
              <div 
                className="flex items-center justify-between cursor-pointer"
                onClick={() => toggleExpanded(result.stepId)}
              >
                <div className="flex items-center gap-3">
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4 text-slate-400" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-slate-400" />
                  )}
                  {getStatusIcon(result.status)}
                  <div>
                    <div className="font-medium text-slate-900">{result.stepName}</div>
                    <div className="text-sm text-slate-600">{result.message}</div>
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-sm font-medium text-slate-900">
                    {result.duration ? `${result.duration}ms` : 'N/A'}
                  </div>
                  <div className="text-xs text-slate-500">
                    {result.timestamp.toLocaleTimeString()}
                  </div>
                </div>
              </div>

              {/* Expanded Details */}
              {isExpanded && showDetails && (
                <div className="mt-4 ml-7 space-y-3">
                  {/* Output */}
                  {result.output && (
                    <div>
                      <h5 className="text-sm font-medium text-slate-700 mb-2">Output</h5>
                      <div className="bg-slate-50 rounded-lg p-3 max-h-40 overflow-auto">
                        <pre className="text-xs text-slate-600 whitespace-pre-wrap">
                          {typeof result.output === 'string' 
                            ? result.output 
                            : JSON.stringify(result.output, null, 2)}
                        </pre>
                      </div>
                    </div>
                  )}

                  {/* Error Details */}
                  {result.error && (
                    <div>
                      <h5 className="text-sm font-medium text-red-700 mb-2">Error Details</h5>
                      <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                        <p className="text-sm text-red-700">{result.error}</p>
                      </div>
                    </div>
                  )}

                  {/* Metadata */}
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="font-medium text-slate-700">Step ID:</span>
                      <span className="ml-2 text-slate-600">{result.stepId}</span>
                    </div>
                    <div>
                      <span className="font-medium text-slate-700">Timestamp:</span>
                      <span className="ml-2 text-slate-600">{result.timestamp.toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {filteredResults.length === 0 && (
        <div className="p-8 text-center text-slate-500">
          <p>No results match the current filter.</p>
        </div>
      )}
    </div>
  )
}