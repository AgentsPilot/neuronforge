// components/agent-creation/SmartAgentBuilder/components/TestRunner.tsx

import React, { useState } from 'react';
import { CheckCircle, AlertCircle, X, ChevronDown, ChevronUp, Clock } from 'lucide-react';
import { TestRunnerProps } from '../types/agent';

export default function TestRunner({
  testResults,
  onClearResults
}: TestRunnerProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  if (!testResults) return null;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
            testResults.success ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'
          }`}>
            {testResults.success ? <CheckCircle className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          </div>
          <h3 className="font-semibold text-gray-900">Test Results</h3>
          <span className={`text-xs px-2 py-1 rounded-full font-medium ${
            testResults.success 
              ? 'bg-green-100 text-green-700' 
              : 'bg-red-100 text-red-700'
          }`}>
            {testResults.success ? 'PASSED' : 'FAILED'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-gray-500 hover:text-gray-700 transition-colors"
          >
            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          <button
            onClick={onClearResults}
            className="text-gray-500 hover:text-gray-700 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      
      <div className={`rounded-lg p-4 ${testResults.success ? 'bg-green-50' : 'bg-red-50'}`}>
        {testResults.success ? (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle className="h-5 w-5 text-green-600" />
              <p className="text-green-800 font-medium">Test completed successfully!</p>
            </div>
            
            {testResults.executionTime && (
              <div className="flex items-center gap-2 mb-3">
                <Clock className="h-4 w-4 text-green-600" />
                <p className="text-sm text-green-700">
                  Execution time: {testResults.executionTime}ms
                </p>
              </div>
            )}

            {isExpanded && testResults.output && (
              <div className="mt-4">
                <p className="text-sm text-green-700 font-medium mb-2">Output Details:</p>
                <div className="bg-white border border-green-200 rounded p-3 max-h-96 overflow-auto">
                  {typeof testResults.output === 'object' ? (
                    <div className="space-y-2">
                      {testResults.output.message && (
                        <div>
                          <span className="text-xs font-medium text-green-600">Message:</span>
                          <p className="text-sm text-gray-700">{testResults.output.message}</p>
                        </div>
                      )}
                      {testResults.output.summary && (
                        <div>
                          <span className="text-xs font-medium text-green-600">Summary:</span>
                          <p className="text-sm text-gray-700">{testResults.output.summary}</p>
                        </div>
                      )}
                      {testResults.output.inputData && (
                        <div>
                          <span className="text-xs font-medium text-green-600">Input Data:</span>
                          <pre className="text-xs text-gray-600 bg-gray-50 p-2 rounded mt-1 overflow-auto">
                            {JSON.stringify(testResults.output.inputData, null, 2)}
                          </pre>
                        </div>
                      )}
                      {testResults.output.results && (
                        <div>
                          <span className="text-xs font-medium text-green-600">Results:</span>
                          <pre className="text-xs text-gray-600 bg-gray-50 p-2 rounded mt-1 overflow-auto">
                            {JSON.stringify(testResults.output.results, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  ) : (
                    <pre className="text-xs text-green-600 whitespace-pre-wrap">
                      {JSON.stringify(testResults.output, null, 2)}
                    </pre>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <AlertCircle className="h-5 w-5 text-red-600" />
              <p className="text-red-800 font-medium">Test failed</p>
            </div>
            <p className="text-sm text-red-700 mb-3">{testResults.error}</p>
            
            {isExpanded && (
              <div className="bg-white border border-red-200 rounded p-3">
                <p className="text-xs font-medium text-red-600 mb-2">Error Details:</p>
                <p className="text-xs text-red-700 font-mono">{testResults.error}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Test Summary */}
      {isExpanded && testResults.success && (
        <div className="mt-4 pt-4 border-t border-gray-200">
          <h4 className="text-sm font-medium text-gray-700 mb-2">Test Summary</h4>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-gray-500">Status:</span>
              <span className="ml-2 text-green-600 font-medium">Passed</span>
            </div>
            {testResults.executionTime && (
              <div>
                <span className="text-gray-500">Duration:</span>
                <span className="ml-2 text-gray-700">{testResults.executionTime}ms</span>
              </div>
            )}
            <div>
              <span className="text-gray-500">Timestamp:</span>
              <span className="ml-2 text-gray-700">{new Date().toLocaleTimeString()}</span>
            </div>
            <div>
              <span className="text-gray-500">Result:</span>
              <span className="ml-2 text-gray-700">
                {testResults.output?.results?.status || 'Completed'}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}