// components/agent-creation/EditAgentWrapper.tsx
import React, { useState, useEffect } from 'react';
import SmartAgentBuilder from './SmartAgentBuilder/SmartAgentBuilder';
import { Agent } from './SmartAgentBuilder/types/agent';
import { useAuth } from '@/components/UserProvider';
import { useRouter } from 'next/navigation';
import { Loader2, AlertTriangle, Brain, RefreshCw, Lock, Shield } from 'lucide-react';
import { formatScheduleDisplay } from '@/lib/utils/scheduleFormatter';

interface EditAgentWrapperProps {
  agentId: string;
}

export default function EditAgentWrapper({ agentId }: EditAgentWrapperProps) {
  const { user } = useAuth();
  const router = useRouter();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState<any>(null);
  const [showProtectionInfo, setShowProtectionInfo] = useState(false);

  useEffect(() => {
    const fetchAgent = async () => {
      // Wait for auth to load
      if (!user?.id) {
        console.log('Waiting for user authentication...');
        return;
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
          'x-user-id': user.id,
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
        
        // Extract agent from response
        let agentData = null;
        if (data.success && data.agent) {
          agentData = data.agent;
        } else if (data.agent) {
          agentData = data.agent;
        } else if (data.data) {
          agentData = data.data;
        } else if (data.id) {
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
        
        // SCHEDULE DEBUG - Raw agent data from API
        console.log('=== SCHEDULE DEBUG - Raw agent data from API ===');
        console.log('schedule_cron:', agentData.schedule_cron);
        console.log('mode:', agentData.mode);
        console.log('agent_config present:', !!agentData.agent_config);
        console.log('schedule_from_config:', agentData.agent_config?.schedule_cron);
        console.log('mode_from_config:', agentData.agent_config?.mode);
        console.log('===============================================');

        // CRITICAL FIX: Restore schedule from agent_config if main field is missing/null
        if (agentData.agent_config) {
          // Check if schedule exists in agent_config but not in main field
          if (agentData.agent_config.schedule_cron && !agentData.schedule_cron) {
            console.log('⚠️ Schedule found in agent_config but not in main field, restoring...');
            agentData.schedule_cron = agentData.agent_config.schedule_cron;
            agentData.mode = agentData.agent_config.mode || agentData.mode;
          }
          
          // Also check if mode is missing but exists in config
          if (agentData.agent_config.mode && !agentData.mode) {
            console.log('⚠️ Mode found in agent_config but not in main field, restoring...');
            agentData.mode = agentData.agent_config.mode;
          }
        }

        // SCHEDULE DEBUG - Final processed data
        console.log('=== SCHEDULE DEBUG - Final processed data ===');
        console.log('schedule_cron:', agentData.schedule_cron);
        console.log('mode:', agentData.mode);
        console.log('formatScheduleTest:', agentData.schedule_cron ? formatScheduleDisplay('scheduled', agentData.schedule_cron) : 'No schedule to format');
        console.log('============================================');
        
        // ENHANCED: Mark plugin requirements as locked for editing
        if (agentData.plugins_required) {
          agentData._pluginsLocked = true;
          agentData._originalPlugins = [...(agentData.plugins_required || [])];
          console.log('Plugin requirements locked for editing:', agentData.plugins_required);
        }
        
        // ENHANCED: Mark prompts as locked for editing
        if (agentData.system_prompt || agentData.user_prompt) {
          agentData._promptsLocked = true;
          agentData._originalPrompts = {
            system_prompt: agentData.system_prompt,
            user_prompt: agentData.user_prompt
          };
          console.log('System and user prompts locked for editing');
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
      console.log('Waiting for user authentication...');
    } else {
      setError('No agent ID provided');
      setLoading(false);
    }
  }, [agentId, user?.id]);

  const handleAgentUpdated = (updatedAgent: Agent) => {
    console.log('Agent updated:', updatedAgent.agent_name);
    
    // SCHEDULE DEBUG - Check if schedule was preserved during update
    console.log('=== SCHEDULE DEBUG - Agent updated ===');
    console.log('Updated schedule_cron:', updatedAgent.schedule_cron);
    console.log('Updated mode:', updatedAgent.mode);
    console.log('====================================');
    
    // Redirect back to agent details
    router.push(`/agents/${updatedAgent.id}`);
  };

  const handleCancel = () => {
    router.push(`/agents/${agentId}`);
  };

  const handleRetry = () => {
    setError(null);
    setDebugInfo(null);
    setLoading(true);
  };

  // Show loading while waiting for authentication
  if (!user?.id) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 flex items-center justify-center">
        <div className="relative">
          {/* Animated background blur */}
          <div className="absolute inset-0 bg-gradient-to-r from-blue-400/20 to-purple-400/20 rounded-3xl blur-xl animate-pulse"></div>
          
          {/* Main content */}
          <div className="relative bg-white/80 backdrop-blur-xl rounded-3xl p-12 shadow-2xl border border-white/20 text-center max-w-md">
            {/* Animated brain icon */}
            <div className="relative mb-8 mx-auto w-20 h-20">
              <div className="absolute inset-0 bg-gradient-to-r from-blue-500 to-purple-600 rounded-2xl animate-pulse"></div>
              <div className="relative bg-gradient-to-br from-blue-500 via-purple-500 to-indigo-600 rounded-2xl flex items-center justify-center w-full h-full">
                <Brain className="h-10 w-10 text-white" />
              </div>
              {/* Rotating ring */}
              <div className="absolute inset-0 border-4 border-blue-200 border-t-blue-500 rounded-2xl animate-spin"></div>
            </div>
            
            {/* Content */}
            <div className="space-y-4">
              <h3 className="text-2xl font-bold bg-gradient-to-r from-gray-900 to-gray-600 bg-clip-text text-transparent">
                Authenticating
              </h3>
              <p className="text-gray-600">
                Verifying your credentials...
              </p>
              
              {/* Progress dots */}
              <div className="flex justify-center space-x-2 mt-6">
                <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"></div>
                <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="">
        {/* Compact Header skeleton */}
        <div className="bg-white/80 backdrop-blur-sm border-b border-slate-200">
          <div className="max-w-7xl mx-auto px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-slate-200 rounded-lg animate-pulse"></div>
              <div className="space-y-1 flex-1">
                <div className="h-4 bg-slate-200 rounded-lg w-36 animate-pulse"></div>
                <div className="h-3 bg-slate-200 rounded-lg w-24 animate-pulse"></div>
              </div>
            </div>
          </div>
        </div>
        
        {/* Compact Main loading content */}
        <div className="flex items-center justify-center min-h-[calc(100vh-80px)]">
          <div className="relative">
            {/* Smaller floating background elements */}
            <div className="absolute -top-12 -left-12 w-24 h-24 bg-blue-400/10 rounded-full blur-xl animate-pulse"></div>
            <div className="absolute -bottom-12 -right-12 w-24 h-24 bg-purple-400/10 rounded-full blur-xl animate-pulse" style={{ animationDelay: '1s' }}></div>
            
            {/* Compact Main card */}
            <div className="relative bg-white/90 backdrop-blur-xl rounded-2xl p-8 shadow-xl border border-white/20 text-center max-w-md">
              {/* Compact Animated agent icon */}
              <div className="relative mb-6 mx-auto w-20 h-20">
                {/* Outer rotating ring */}
                <div className="absolute inset-0 border-3 border-slate-200 border-t-blue-500 rounded-full animate-spin"></div>
                {/* Inner circle */}
                <div className="absolute inset-2 bg-gradient-to-br from-blue-500 via-purple-500 to-indigo-600 rounded-full flex items-center justify-center shadow-lg">
                  <Brain className="h-8 w-8 text-white" />
                </div>
                {/* Smaller floating particles */}
                <div className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-blue-400 rounded-full animate-ping"></div>
                <div className="absolute -bottom-0.5 -left-0.5 w-1.5 h-1.5 bg-purple-400 rounded-full animate-ping" style={{ animationDelay: '0.5s' }}></div>
              </div>
              
              {/* Compact Content */}
              <div className="space-y-4">
                <div>
                  <h3 className="text-xl font-bold bg-gradient-to-r from-gray-900 to-gray-600 bg-clip-text text-transparent mb-1">
                    Loading Agent
                  </h3>
                  <p className="text-gray-600 text-sm">
                    Preparing your agent for editing...
                  </p>
                </div>
                
                {/* Compact Progress steps */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs">
                    <div className="w-1.5 h-1.5 bg-green-500 rounded-full"></div>
                    <span className="text-gray-500">Authentication verified</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse"></div>
                    <span className="text-gray-700 font-medium">Fetching agent configuration...</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <div className="w-1.5 h-1.5 bg-gray-300 rounded-full"></div>
                    <span className="text-gray-400">Preparing edit interface</span>
                  </div>
                </div>
                
                {/* Compact Loading bar */}
                <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-blue-500 to-purple-500 rounded-full animate-pulse" style={{ width: '60%' }}></div>
                </div>
                
                {/* Compact Meta info */}
                <div className="pt-3 border-t border-gray-100">
                  <div className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
                    <div className="font-medium text-gray-700 mb-1 text-xs">Loading Details:</div>
                    <div className="space-y-0.5">
                      <div>Agent ID: <span className="font-mono text-blue-600">{agentId.substring(0, 8)}...</span></div>
                      <div>User: <span className="text-gray-600">{user.email || 'Authenticated'}</span></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
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

  // Success - show collapsible protection notice and render SmartAgentBuilder in edit mode
  return (
    <div className="min-h-screen bg-white">
      {/* Collapsible Protection Notice */}
      <div className="mx-6 mb-6 pt-6">
        <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-xl overflow-hidden shadow-sm">
          <button 
            onClick={() => setShowProtectionInfo(!showProtectionInfo)}
            className="w-full p-4 flex items-center justify-between hover:bg-amber-100/50 transition-colors text-left"
          >
            <div className="flex items-center gap-3">
              <Shield className="h-5 w-5 text-amber-600" />
              <div>
                <h4 className="font-medium text-amber-800">
                  Some features are protected to keep your agent working properly
                </h4>
                <p className="text-amber-700 text-sm">
                  {showProtectionInfo ? 'Click to hide details' : 'Click to see what\'s protected'}
                </p>
              </div>
            </div>
            <div className={`transform transition-transform ${showProtectionInfo ? 'rotate-180' : ''}`}>
              <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </button>
          
          {showProtectionInfo && (
            <div className="px-4 pb-4 border-t border-amber-200 bg-amber-50/50">
              <div className="pt-4">
                <p className="text-amber-700 text-sm mb-4 leading-relaxed">
                  The required plugins and prompts for this agent cannot be modified during editing to ensure the agent continues to function correctly. 
                  These were determined by AI analysis during creation. You can still edit other agent settings freely.
                </p>
                
                {/* Protected Elements Summary */}
                <div className="space-y-3">
                  {/* Schedule Display */}
                  {agent?.schedule_cron && (
                    <div>
                      <span className="text-amber-800 text-xs font-medium">Current Schedule:</span>
                      <div className="mt-1 flex flex-wrap gap-2">
                        <span className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full border border-blue-200">
                          {formatScheduleDisplay('scheduled', agent.schedule_cron)}
                        </span>
                        <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-800 text-xs rounded-full border border-green-200">
                          Mode: {agent.mode || 'on_demand'}
                        </span>
                      </div>
                    </div>
                  )}
                  
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
          )}
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
        // Prompt lock properties
        promptsLocked={agent._promptsLocked || false}
        originalPrompts={agent._originalPrompts || {}}
      />
    </div>
  );
}