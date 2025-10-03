// components/agent-creation/EditAgentWrapper.tsx
import React, { useState, useEffect } from 'react';
import SmartAgentBuilder from './SmartAgentBuilder/SmartAgentBuilder';
import { Agent } from './SmartAgentBuilder/types/agent';
import { useAuth } from '@/components/UserProvider';
import { useRouter } from 'next/navigation';
import { Loader2, AlertTriangle, Brain, RefreshCw, Lock, Shield } from 'lucide-react';

interface EditAgentWrapperProps {
  agentId: string;
}

export default function EditAgentWrapper({ agentId }: EditAgentWrapperProps) {
  const { user } = useAuth(); // Use your existing auth hook
  const router = useRouter();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState<any>(null);

  useEffect(() => {
    const fetchAgent = async () => {
      // Wait for auth to load
      if (!user?.id) {
        console.log('Waiting for user authentication...');
        return; // Don't start fetching until we have user
      }

      try {
        setLoading(true);
        setError(null);
        setDebugInfo(null);
        
        console.log('Fetching agent with ID:', agentId);
        console.log('User ID:', user.id);
        
        const endpoint = `/api/agents/${agentId}`;
        
        // Prepare headers with user authentication
        const headers = {
          'Content-Type': 'application/json',
          'x-user-id': user.id, // Your API expects this header
        };
        
        // Add authorization token if available
        try {
          const supabaseAuth = localStorage.getItem('supabase.auth.token');
          if (supabaseAuth) {
            const authData = JSON.parse(supabaseAuth);
            if (authData.access_token) {
              headers['authorization'] = `Bearer ${authData.access_token}`;
            }
          }
        } catch (e) {
          // Auth token not available, but x-user-id should be sufficient
          console.log('No auth token found, using user ID header only');
        }
        
        console.log(`Fetching from: ${endpoint}`);
        console.log('Request headers:', headers);
        
        const response = await fetch(endpoint, {
          method: 'GET',
          headers
        });
        
        console.log('Response status:', response.status);
        console.log('Response headers:', Object.fromEntries(response.headers.entries()));
        
        // Get response text first for better error handling
        const responseText = await response.text();
        console.log('Raw response (first 200 chars):', responseText.substring(0, 200));
        
        if (!response.ok) {
          // Try to parse error response
          let errorData;
          try {
            errorData = JSON.parse(responseText);
          } catch (e) {
            errorData = { error: `HTTP ${response.status}`, details: responseText };
          }
          
          // Collect debug information
          const debug = {
            agentId,
            userId: user.id,
            endpoint,
            status: response.status,
            responseHeaders: Object.fromEntries(response.headers.entries()),
            errorData,
            requestHeaders: headers
          };
          setDebugInfo(debug);
          
          let errorMessage = `Failed to fetch agent (${response.status})`;
          if (errorData.error) {
            errorMessage += `: ${errorData.error}`;
          }
          if (errorData.details) {
            errorMessage += ` - ${errorData.details}`;
          }
          
          throw new Error(errorMessage);
        }
        
        // Check if response is HTML instead of JSON
        if (responseText.includes('<!DOCTYPE') || responseText.includes('<html')) {
          throw new Error(
            `API endpoint ${endpoint} returned HTML instead of JSON. ` +
            'This usually means the endpoint doesn\'t exist or there\'s a routing issue.'
          );
        }
        
        // Parse JSON response
        let data;
        try {
          data = JSON.parse(responseText);
        } catch (parseError) {
          throw new Error(
            `Invalid JSON response from ${endpoint}. ` +
            `Parse error: ${parseError.message}. ` +
            `Response: ${responseText.substring(0, 100)}`
          );
        }
        
        console.log('Parsed response data:', data);
        
        // Extract agent from response (your API returns {success: true, agent: {...}})
        let agentData = null;
        if (data.success && data.agent) {
          agentData = data.agent;
        } else if (data.agent) {
          agentData = data.agent;
        } else if (data.data) {
          agentData = data.data;
        } else if (data.id) {
          // Direct agent object
          agentData = data;
        } else {
          throw new Error(
            `Unexpected response structure from ${endpoint}. ` +
            `Expected {success: true, agent: ...}. ` +
            `Got keys: ${JSON.stringify(Object.keys(data))}`
          );
        }
        
        if (!agentData) {
          throw new Error(`No agent data found in response from ${endpoint}`);
        }
        
        // ENHANCED: Mark plugin requirements as locked for editing
        if (agentData.plugins_required) {
          agentData._pluginsLocked = true;
          agentData._originalPlugins = [...(agentData.plugins_required || [])];
          console.log('🔒 Plugin requirements locked for editing:', agentData.plugins_required);
        }
        
        // ENHANCED: Mark prompts as locked for editing
        if (agentData.system_prompt || agentData.user_prompt) {
          agentData._promptsLocked = true;
          agentData._originalPrompts = {
            system_prompt: agentData.system_prompt,
            user_prompt: agentData.user_prompt
          };
          console.log('🔒 System and user prompts locked for editing');
        }
        
        console.log('Successfully loaded agent:', agentData.agent_name || 'Unnamed Agent');
        setAgent(agentData);
        
      } catch (err) {
        console.error('Error fetching agent:', err);
        const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
        setError(errorMessage);
      } finally {
        setLoading(false);
      }
    };

    // Only fetch when we have both agentId and authenticated user
    if (agentId && user?.id) {
      fetchAgent();
    } else if (agentId && !user?.id) {
      // Still loading auth
      console.log('Waiting for user authentication...');
    } else {
      setError('No agent ID provided');
      setLoading(false);
    }
  }, [agentId, user?.id]); // Re-run when user.id changes

  const handleAgentUpdated = (updatedAgent: Agent) => {
    console.log('Agent updated:', updatedAgent.agent_name);
    // Redirect back to agent details
    router.push(`/agents/${updatedAgent.id}`);
  };

  const handleCancel = () => {
    // Go back to agent details or agents list
    router.push(`/agents/${agentId}`);
  };

  const handleRetry = () => {
    setError(null);
    setDebugInfo(null);
    setLoading(true);
    // The useEffect will automatically retry when dependencies change
  };

  // Show loading while waiting for authentication
  if (!user?.id) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 flex items-center justify-center p-6">
        <div className="bg-white/70 backdrop-blur-xl rounded-2xl p-8 shadow-xl border border-white/20 text-center max-w-md">
          <div className="w-16 h-16 bg-gradient-to-br from-blue-500 via-purple-500 to-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Brain className="h-8 w-8 text-white" />
          </div>
          <Loader2 className="h-6 w-6 animate-spin mx-auto mb-4 text-blue-600" />
          <h3 className="text-xl font-bold text-gray-900 mb-2">Authenticating</h3>
          <p className="text-gray-600 text-sm">
            Please wait while we verify your authentication...
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 flex items-center justify-center p-6">
        <div className="bg-white/70 backdrop-blur-xl rounded-2xl p-8 shadow-xl border border-white/20 text-center max-w-md">
          <div className="w-16 h-16 bg-gradient-to-br from-blue-500 via-purple-500 to-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Brain className="h-8 w-8 text-white" />
          </div>
          <Loader2 className="h-6 w-6 animate-spin mx-auto mb-4 text-blue-600" />
          <h3 className="text-xl font-bold text-gray-900 mb-2">Loading Agent</h3>
          <p className="text-gray-600 text-sm">
            Fetching agent data for editing...
          </p>
          <div className="text-gray-500 text-xs mt-2 space-y-1">
            <p>Agent ID: {agentId}</p>
            <p>User: {user.email || user.id}</p>
          </div>
        </div>
      </div>
    );
  }

  if (error || !agent) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-red-50 to-orange-50 flex items-center justify-center p-6">
        <div className="bg-white/70 backdrop-blur-xl rounded-2xl p-8 shadow-xl border border-white/20 text-center max-w-2xl">
          <AlertTriangle className="h-12 w-12 mx-auto mb-4 text-red-600" />
          <h3 className="text-xl font-bold text-gray-900 mb-4">Failed to Load Agent</h3>
          
          <div className="text-left bg-red-50/80 rounded-xl p-4 mb-6 border border-red-200">
            <h4 className="font-medium text-red-800 mb-2">Error Details:</h4>
            <p className="text-red-600 text-sm mb-3">{error || 'Agent not found'}</p>
            
            {debugInfo && (
              <div className="mt-4 text-xs">
                <details className="cursor-pointer">
                  <summary className="text-red-700 font-medium">Debug Information</summary>
                  <pre className="mt-2 text-red-600 overflow-x-auto text-xs bg-red-100/50 p-2 rounded">
                    {JSON.stringify(debugInfo, null, 2)}
                  </pre>
                </details>
              </div>
            )}
          </div>
          
          <div className="bg-yellow-50/80 rounded-xl p-4 mb-6 border border-yellow-200 text-left">
            <h4 className="font-medium text-yellow-800 mb-2">Common Issues:</h4>
            <ul className="text-yellow-700 text-sm space-y-1 list-disc list-inside">
              <li>Agent ID might be incorrect: <code className="bg-yellow-200 px-1 rounded">{agentId}</code></li>
              <li>You might not have permission to access this agent</li>
              <li>The agent might not exist or has been deleted</li>
              <li>Database connection issues</li>
              <li>Authentication issues</li>
            </ul>
          </div>
          
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={handleRetry}
              className="bg-blue-600 text-white px-6 py-3 rounded-xl hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
            >
              <RefreshCw className="h-4 w-4" />
              Try Again
            </button>
            <button
              onClick={() => router.push('/agents')}
              className="bg-gray-600 text-white px-6 py-3 rounded-xl hover:bg-gray-700 transition-colors"
            >
              Back to Agents List
            </button>
            <button
              onClick={handleCancel}
              className="bg-white text-gray-700 px-6 py-3 rounded-xl hover:bg-gray-50 transition-colors border border-gray-200"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Success - show protection notice and render SmartAgentBuilder in edit mode
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      {/* Protection Notice - Only shown in edit mode */}
      <div className="bg-gradient-to-r from-amber-50 to-orange-50 border-l-4 border-amber-400 p-4 mb-6 mx-6 rounded-r-xl shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex-shrink-0">
            <Shield className="h-5 w-5 text-amber-600" />
          </div>
          <div className="flex-1">
            <h4 className="font-medium text-amber-800 flex items-center gap-2">
              <Lock className="h-4 w-4" />
              Agent Core Components Protected
            </h4>
            <p className="text-amber-700 text-sm mt-1">
              The required plugins and prompts for this agent cannot be modified during editing to ensure the agent continues to function correctly. 
              These were determined by AI analysis during creation. You can still edit other agent settings freely.
            </p>
            
            {/* Protected Elements Summary */}
            <div className="mt-3 space-y-2">
              {/* Plugins */}
              {agent?.plugins_required && agent.plugins_required.length > 0 && (
                <div>
                  <span className="text-amber-800 text-xs font-medium">Protected Plugins:</span>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {agent.plugins_required.map((plugin, index) => (
                      <span 
                        key={index}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-amber-100 text-amber-800 text-xs rounded-full border border-amber-200"
                      >
                        <Lock className="h-3 w-3" />
                        {typeof plugin === 'string' ? plugin : plugin.name || plugin.key || 'Unknown Plugin'}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Prompts */}
              <div>
                <span className="text-amber-800 text-xs font-medium">Protected Prompts:</span>
                <div className="mt-1 flex flex-wrap gap-2">
                  <span className="inline-flex items-center gap-1 px-2 py-1 bg-orange-100 text-orange-800 text-xs rounded-full border border-orange-200">
                    <Lock className="h-3 w-3" />
                    System Prompt
                  </span>
                  <span className="inline-flex items-center gap-1 px-2 py-1 bg-orange-100 text-orange-800 text-xs rounded-full border border-orange-200">
                    <Lock className="h-3 w-3" />
                    User Prompt
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* SmartAgentBuilder in edit mode */}
      <SmartAgentBuilder
        prompt={agent.user_prompt || ''}
        promptType="edit"
        clarificationAnswers={{}}
        restoredAgent={agent}
        editMode={true}
        sessionId={`edit-${agentId}-${Date.now()}`}
        onAgentCreated={handleAgentUpdated}
        onCancel={handleCancel}
        // Plugin lock properties
        pluginsLocked={agent._pluginsLocked || false}
        originalPlugins={agent._originalPlugins || []}
        // NEW: Prompt lock properties
        promptsLocked={agent._promptsLocked || false}
        originalPrompts={agent._originalPrompts || {}}
      />
    </div>
  );
}