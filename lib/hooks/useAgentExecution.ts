import { useState, useEffect, useCallback, useRef } from 'react';
import { AgentExecution } from '@/lib/database/executionHelpers';

export interface ExecutionStatus {
  isRunning: boolean;
  latestExecution: AgentExecution | null;
  runningExecutions: AgentExecution[];
  nextRun: string | null;
  nextRunFormatted: string;
  agentMode: string;
  agentStatus: string;
}

export function useAgentExecution(agentId: string) {
  const [executionStatus, setExecutionStatus] = useState<ExecutionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const fetchExecutionStatus = useCallback(async () => {
    if (!agentId) {
      setLoading(false);
      return;
    }

    try {
      setError(null);
      
      const response = await fetch(`/api/agents/${agentId}/execution-status`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        cache: 'no-store',
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      
      if (data.success) {
        const executionData: ExecutionStatus = {
          isRunning: data.isRunning,
          latestExecution: data.latestExecution,
          runningExecutions: data.runningExecutions || [],
          nextRun: data.nextRun,
          nextRunFormatted: data.nextRunFormatted,
          agentMode: data.agentMode,
          agentStatus: data.agentStatus
        };
        
        console.log(`Status for agent ${agentId}: running=${executionData.isRunning}`);
        setExecutionStatus(executionData);
        setError(null);
      } else {
        setError(data.error || 'Failed to fetch execution status');
      }
    } catch (err) {
      console.error('Error fetching execution status:', err);
      
      if (err instanceof TypeError && err.message.includes('fetch')) {
        setError('Network connection error');
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Unknown error occurred');
      }
      
      setExecutionStatus({
        isRunning: false,
        latestExecution: null,
        runningExecutions: [],
        nextRun: null,
        nextRunFormatted: 'Unknown',
        agentMode: 'manual',
        agentStatus: 'active'
      });
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  // Fetch status on mount
  useEffect(() => {
    if (agentId) {
      fetchExecutionStatus();
    }
  }, [agentId, fetchExecutionStatus]);

  // Polling logic - poll more frequently and always poll while running
  useEffect(() => {
    // Clear any existing interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (!agentId) return;

    // Always poll, but more frequently when running
    const pollInterval = executionStatus?.isRunning ? 2000 : 5000; // 2s when running, 5s when not
    
    console.log(`Agent ${agentId}: Starting polls every ${pollInterval}ms (running: ${executionStatus?.isRunning})`);
    
    intervalRef.current = setInterval(() => {
      fetchExecutionStatus();
    }, pollInterval);

    // Cleanup function
    return () => {
      if (intervalRef.current) {
        console.log(`Agent ${agentId}: Cleaning up polling interval`);
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [agentId, executionStatus?.isRunning, fetchExecutionStatus]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  const refresh = useCallback(() => {
    fetchExecutionStatus();
  }, [fetchExecutionStatus]);

  return {
    executionStatus,
    loading,
    error,
    refresh
  };
}

export function useExecuteAgent() {
  const [executing, setExecuting] = useState<Set<string>>(new Set());

  // UPDATED: Use the new queue-based execution system
  const executeAgent = useCallback(async (agentId: string, userId?: string | null) => {
    console.log(`Starting queue-based execution for agent ${agentId}`);
    setExecuting(prev => new Set(prev).add(agentId));

    try {
      // Use the new unified /api/run-agent endpoint
      const response = await fetch('/api/run-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          agent_id: agentId,
          use_queue: true, // Force queue-based execution
          user_id: userId || null
        })
      });

      const result = await response.json();

      if (result.success) {
        console.log(`Queue execution started for agent ${agentId}:`, result.data.execution_id);
        
        // Keep tracking until polling detects completion
        return { success: true, executionId: result.data.execution_id };
      } else {
        console.error(`Failed to queue agent ${agentId}:`, result.error);
        setExecuting(prev => {
          const newSet = new Set(prev);
          newSet.delete(agentId);
          return newSet;
        });
        return { success: false, error: result.error };
      }
    } catch (error) {
      console.error(`Error executing agent ${agentId}:`, error);
      setExecuting(prev => {
        const newSet = new Set(prev);
        newSet.delete(agentId);
        return newSet;
      });
      return { success: false, error: 'Network error' };
    }
  }, []);

  const isExecuting = useCallback((agentId: string) => {
    return executing.has(agentId);
  }, [executing]);

  const stopTracking = useCallback((agentId: string) => {
    console.log(`Stopping execution tracking for agent ${agentId}`);
    setExecuting(prev => {
      const newSet = new Set(prev);
      newSet.delete(agentId);
      return newSet;
    });
  }, []);

  return {
    executeAgent,
    isExecuting,
    stopTracking
  };
}