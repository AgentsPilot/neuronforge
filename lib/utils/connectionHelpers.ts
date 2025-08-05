import { Connection } from '../../components/orchestration/types/workflow'
import { IOItem } from '../../components/orchestration/types/connections'

/**
 * Validate if a connection is valid
 */
export const validateConnection = (
  fromStep: number, 
  toStep: number, 
  fromIO: IOItem, 
  toInput?: IOItem
): { isValid: boolean; reason?: string } => {
  // Can't connect to the same step
  if (fromStep === toStep) {
    return { isValid: false, reason: 'Cannot connect to the same step' }
  }
  
  // Can only connect to next steps (forward flow)
  if (toStep <= fromStep) {
    return { isValid: false, reason: 'Can only connect to later steps in the workflow' }
  }
  
  // Check if data types are compatible (simplified)
  if (toInput && fromIO.type !== toInput.type && toInput.type !== 'any') {
    return { isValid: false, reason: `Incompatible data types: ${fromIO.type} → ${toInput.type}` }
  }
  
  return { isValid: true }
}

/**
 * Check if connection already exists
 */
export const connectionExists = (
  connections: Connection[], 
  fromStep: number, 
  toStep: number,
  fromIO?: IOItem
): boolean => {
  return connections.some(conn => 
    conn.fromStep === fromStep && 
    conn.toStep === toStep &&
    (!fromIO || (typeof conn.fromIO === 'object' ? conn.fromIO.name === fromIO.name : conn.fromIO === fromIO.name))
  )
}

/**
 * Create a new connection
 */
export const createConnection = (
  fromStep: number,
  toStep: number, 
  fromIO: IOItem,
  toInput?: IOItem
): Connection => {
  return {
    id: `${fromStep}-${toStep}-${Date.now()}`,
    fromStep,
    toStep,
    fromIO,
    toInput,
    type: 'data_flow'
  }
}

/**
 * Get connections for a specific step
 */
export const getStepConnections = (connections: Connection[], stepIndex: number): {
  incoming: Connection[]
  outgoing: Connection[]
} => {
  return {
    incoming: connections.filter(conn => conn.toStep === stepIndex),
    outgoing: connections.filter(conn => conn.fromStep === stepIndex)
  }
}

/**
 * Remove connections for a step
 */
export const removeStepConnections = (connections: Connection[], stepIndex: number): Connection[] => {
  return connections.filter(conn => conn.fromStep !== stepIndex && conn.toStep !== stepIndex)
}

/**
 * Update step indices in connections after step removal
 */
export const updateConnectionIndices = (connections: Connection[], removedStepIndex: number): Connection[] => {
  return connections
    .filter(conn => conn.fromStep !== removedStepIndex && conn.toStep !== removedStepIndex)
    .map(conn => ({
      ...conn,
      fromStep: conn.fromStep > removedStepIndex ? conn.fromStep - 1 : conn.fromStep,
      toStep: conn.toStep > removedStepIndex ? conn.toStep - 1 : conn.toStep
    }))
}

/**
 * Validate entire workflow connections
 */
export const validateWorkflowConnections = (connections: Connection[], stepCount: number): {
  isValid: boolean
  issues: string[]
} => {
  const issues: string[] = []
  
  // Check for orphaned steps (no connections)
  for (let i = 0; i < stepCount; i++) {
    const stepConnections = getStepConnections(connections, i)
    if (i > 0 && stepConnections.incoming.length === 0) {
      issues.push(`Step ${i + 1} has no incoming data connections`)
    }
    if (i < stepCount - 1 && stepConnections.outgoing.length === 0) {
      issues.push(`Step ${i + 1} has no outgoing data connections`)
    }
  }
  
  // Check for circular dependencies (simplified)
  connections.forEach(conn => {
    if (conn.fromStep >= conn.toStep) {
      issues.push(`Invalid connection: Step ${conn.fromStep + 1} → Step ${conn.toStep + 1} (backwards flow)`)
    }
  })
  
  return {
    isValid: issues.length === 0,
    issues
  }
}