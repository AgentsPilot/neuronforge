/**
 * SessionStateMachine
 *
 * Defines state transitions for command sessions.
 * Pure functions - no side effects, easy to test.
 */

import type { CommandSession, SessionStatus } from './CommandSessionRepository';

export type SessionTransition =
  | { type: 'PROVIDE_PARAM'; param: string; value: unknown }
  | { type: 'SELECT_CHOICE'; choiceId: string }
  | { type: 'CONFIRM' }
  | { type: 'CANCEL' }
  | { type: 'CORRECT'; correction: Record<string, unknown> }
  | { type: 'EXECUTE_SUCCESS'; result: unknown }
  | { type: 'EXECUTE_FAILURE'; error: string }
  | { type: 'TIMEOUT' };

export type SessionAction =
  | 'execute'
  | 'ask_param'
  | 'show_choices'
  | 'show_confirmation'
  | 'show_success'
  | 'show_error'
  | 'cancelled';

export interface TransitionResult {
  newStatus: SessionStatus;
  updates: Partial<CommandSession>;
  action?: SessionAction;
  nextParam?: string;
  error?: string;
  result?: unknown;
}

/**
 * Pure state transition function
 */
export function transitionSession(
  session: CommandSession,
  transition: SessionTransition
): TransitionResult {
  switch (session.status) {
    case 'gathering_params':
      return handleGatheringParams(session, transition);

    case 'awaiting_choice':
      return handleAwaitingChoice(session, transition);

    case 'awaiting_confirmation':
      return handleAwaitingConfirmation(session, transition);

    case 'executing':
      return handleExecuting(session, transition);

    // Terminal states - no transitions allowed
    case 'completed':
    case 'cancelled':
    case 'failed':
      return {
        newStatus: session.status,
        updates: {},
        error: `Cannot transition from terminal state: ${session.status}`
      };

    default:
      return {
        newStatus: session.status,
        updates: {},
        error: `Unknown state: ${session.status}`
      };
  }
}

/**
 * Handle transitions from 'gathering_params' state
 */
function handleGatheringParams(
  session: CommandSession,
  transition: SessionTransition
): TransitionResult {
  switch (transition.type) {
    case 'PROVIDE_PARAM': {
      const newResolved = {
        ...session.resolved_params,
        [transition.param]: transition.value
      };
      const newPending = session.pending_params.filter(p => p !== transition.param);

      if (newPending.length === 0) {
        // All params collected - move to confirmation
        return {
          newStatus: 'awaiting_confirmation',
          updates: {
            resolved_params: newResolved,
            pending_params: newPending
          },
          action: 'show_confirmation'
        };
      }

      // More params needed
      return {
        newStatus: 'gathering_params',
        updates: {
          resolved_params: newResolved,
          pending_params: newPending
        },
        action: 'ask_param',
        nextParam: newPending[0]
      };
    }

    case 'CANCEL':
      return {
        newStatus: 'cancelled',
        updates: {},
        action: 'cancelled'
      };

    case 'TIMEOUT':
      return {
        newStatus: 'cancelled',
        updates: {},
        action: 'cancelled'
      };

    default:
      // Invalid transition for this state
      return {
        newStatus: session.status,
        updates: {},
        error: `Invalid transition '${transition.type}' for state 'gathering_params'`
      };
  }
}

/**
 * Handle transitions from 'awaiting_choice' state
 */
function handleAwaitingChoice(
  session: CommandSession,
  transition: SessionTransition
): TransitionResult {
  switch (transition.type) {
    case 'SELECT_CHOICE': {
      const choice = session.pending_choices?.find(c => c.id === transition.choiceId);
      if (!choice) {
        return {
          newStatus: session.status,
          updates: {},
          error: `Invalid choice ID: ${transition.choiceId}`
        };
      }

      // The first pending param is the one being disambiguated
      const paramToResolve = session.pending_params[0];
      if (!paramToResolve) {
        return {
          newStatus: session.status,
          updates: {},
          error: 'No pending parameter to resolve'
        };
      }

      const newResolved = {
        ...session.resolved_params,
        [paramToResolve]: choice.id,
        [`${paramToResolve}_entity`]: choice.entity
      };
      const newPending = session.pending_params.slice(1);

      if (newPending.length === 0) {
        // All params collected - move to confirmation
        return {
          newStatus: 'awaiting_confirmation',
          updates: {
            resolved_params: newResolved,
            pending_params: newPending,
            pending_choices: null,
            entity_context: {
              type: paramToResolve.replace('_id', 's'), // contact_id → contacts
              id: choice.id,
              data: choice.entity
            }
          },
          action: 'show_confirmation'
        };
      }

      // More params needed
      return {
        newStatus: 'gathering_params',
        updates: {
          resolved_params: newResolved,
          pending_params: newPending,
          pending_choices: null,
          entity_context: {
            type: paramToResolve.replace('_id', 's'),
            id: choice.id,
            data: choice.entity
          }
        },
        action: 'ask_param',
        nextParam: newPending[0]
      };
    }

    case 'CANCEL':
      return {
        newStatus: 'cancelled',
        updates: { pending_choices: null },
        action: 'cancelled'
      };

    case 'TIMEOUT':
      return {
        newStatus: 'cancelled',
        updates: { pending_choices: null },
        action: 'cancelled'
      };

    default:
      return {
        newStatus: session.status,
        updates: {},
        error: `Invalid transition '${transition.type}' for state 'awaiting_choice'`
      };
  }
}

/**
 * Handle transitions from 'awaiting_confirmation' state
 */
function handleAwaitingConfirmation(
  session: CommandSession,
  transition: SessionTransition
): TransitionResult {
  switch (transition.type) {
    case 'CONFIRM':
      return {
        newStatus: 'executing',
        updates: {},
        action: 'execute'
      };

    case 'CANCEL':
      return {
        newStatus: 'cancelled',
        updates: {},
        action: 'cancelled'
      };

    case 'CORRECT': {
      // User is correcting a parameter before confirming
      const newResolved = {
        ...session.resolved_params,
        ...transition.correction
      };
      return {
        newStatus: 'awaiting_confirmation',
        updates: { resolved_params: newResolved },
        action: 'show_confirmation'
      };
    }

    case 'TIMEOUT':
      return {
        newStatus: 'cancelled',
        updates: {},
        action: 'cancelled'
      };

    default:
      return {
        newStatus: session.status,
        updates: {},
        error: `Invalid transition '${transition.type}' for state 'awaiting_confirmation'`
      };
  }
}

/**
 * Handle transitions from 'executing' state
 */
function handleExecuting(
  session: CommandSession,
  transition: SessionTransition
): TransitionResult {
  switch (transition.type) {
    case 'EXECUTE_SUCCESS':
      return {
        newStatus: 'completed',
        updates: {},
        action: 'show_success',
        result: transition.result
      };

    case 'EXECUTE_FAILURE':
      return {
        newStatus: 'failed',
        updates: {},
        action: 'show_error',
        error: transition.error
      };

    default:
      return {
        newStatus: session.status,
        updates: {},
        error: `Invalid transition '${transition.type}' for state 'executing'`
      };
  }
}

/**
 * Check if a session can be transitioned
 */
export function canTransition(
  session: CommandSession,
  transitionType: SessionTransition['type']
): boolean {
  const terminalStates: SessionStatus[] = ['completed', 'cancelled', 'failed'];
  if (terminalStates.includes(session.status)) {
    return false;
  }

  const validTransitions: Record<SessionStatus, SessionTransition['type'][]> = {
    gathering_params: ['PROVIDE_PARAM', 'CANCEL', 'TIMEOUT'],
    awaiting_choice: ['SELECT_CHOICE', 'CANCEL', 'TIMEOUT'],
    awaiting_confirmation: ['CONFIRM', 'CANCEL', 'CORRECT', 'TIMEOUT'],
    executing: ['EXECUTE_SUCCESS', 'EXECUTE_FAILURE'],
    completed: [],
    cancelled: [],
    failed: []
  };

  return validTransitions[session.status]?.includes(transitionType) ?? false;
}

/**
 * Get human-readable state description
 */
export function getStateDescription(
  status: SessionStatus,
  language: 'en' | 'he' = 'en'
): string {
  const descriptions: Record<SessionStatus, { en: string; he: string }> = {
    gathering_params: {
      en: 'Collecting information',
      he: 'אוסף מידע'
    },
    awaiting_choice: {
      en: 'Waiting for selection',
      he: 'ממתין לבחירה'
    },
    awaiting_confirmation: {
      en: 'Waiting for confirmation',
      he: 'ממתין לאישור'
    },
    executing: {
      en: 'Executing',
      he: 'מבצע'
    },
    completed: {
      en: 'Completed',
      he: 'הושלם'
    },
    cancelled: {
      en: 'Cancelled',
      he: 'בוטל'
    },
    failed: {
      en: 'Failed',
      he: 'נכשל'
    }
  };

  return descriptions[status]?.[language] ?? status;
}
