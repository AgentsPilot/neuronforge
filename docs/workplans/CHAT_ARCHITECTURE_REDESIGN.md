# Chat Architecture Redesign - Implementation Plan

> **Last Updated**: 2026-07-31
> **Status**: Draft - Awaiting Review

## Overview

Transform the Business OS chat from an LLM-driven tool-calling loop to a **deterministic-first command interface** where AI understands intent but AgentPilot executes deterministically.

**Core Principle**: AI understands. AgentPilot executes.

---

## Current State vs Target State

| Aspect | Current | Target |
|--------|---------|--------|
| Every message | Goes to LLM | Pre-classified, LLM only when needed |
| Confirmations | LLM re-interprets "Yes" | Deterministic session lookup |
| Multi-turn flows | Full conversation context to LLM | Command Session state machine |
| Capability definitions | Split across 3+ files | Unified registry |
| Entity resolution | LLM + repository calls | Deterministic resolver with fallback |
| Token usage | High (full context every turn) | Low (minimal LLM calls) |

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              USER MESSAGE                                    │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    PHASE 1: INTERACTION CLASSIFIER                           │
│  ─────────────────────────────────────────────────────────────────────────  │
│  Deterministic checks (NO LLM):                                             │
│  1. Active session + confirmation pattern? → CONFIRM/CANCEL                 │
│  2. Active session + value pattern? → PARAMETER_VALUE                       │
│  3. Slash command? → SLASH_COMMAND                                          │
│  4. Entity selection from choices? → ENTITY_SELECTION                       │
│  5. Otherwise → NATURAL_LANGUAGE (needs LLM)                                │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    │                               │
              Deterministic                   Natural Language
                    │                               │
                    ▼                               ▼
┌─────────────────────────────┐   ┌─────────────────────────────────────────┐
│   PHASE 2: SESSION HANDLER   │   │   PHASE 3: CAPABILITY ROUTER (LLM)      │
│  ─────────────────────────  │   │  ─────────────────────────────────────  │
│  • Load session from DB     │   │  • Minimal system prompt                 │
│  • Execute state transition │   │  • Capability registry as tools          │
│  • No LLM needed            │   │  • Returns: capability + raw params      │
└─────────────────────────────┘   └─────────────────────────────────────────┘
                    │                               │
                    └───────────────┬───────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    PHASE 4: PARAMETER PROCESSOR                              │
│  ─────────────────────────────────────────────────────────────────────────  │
│  Deterministic parsing:                                                      │
│  • Dates: "tomorrow", "next week", "בעוד שבוע" → ISO date                   │
│  • Times: "9am", "morning", "בבוקר" → time string                           │
│  • Money: "100", "₪200", "$50" → { amount, currency }                       │
│  • Durations: "30 minutes", "שעה" → minutes                                 │
│  • Booleans: "yes/no", "כן/לא" → boolean                                    │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    PHASE 5: ENTITY RESOLVER                                  │
│  ─────────────────────────────────────────────────────────────────────────  │
│  Deterministic resolution:                                                   │
│  • Has "[ID: uuid]"? → Use directly                                         │
│  • Exact name match? → Use it                                               │
│  • Multiple matches? → Return choices (no LLM)                              │
│  • No matches? → Return error or suggest creation                           │
│  • Semantic filters? → Map via semantic-schema.ts                           │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    PHASE 6: VALIDATION                                       │
│  ─────────────────────────────────────────────────────────────────────────  │
│  • Required fields present?                                                  │
│  • User has permission?                                                      │
│  • Business rules pass?                                                      │
│  • Confirmation required? → Create session, await confirmation              │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    PHASE 7: CAPABILITY ENGINE                                │
│  ─────────────────────────────────────────────────────────────────────────  │
│  • Execute via registered executor                                           │
│  • All execution is deterministic                                            │
│  • Audit logging                                                             │
│  • Error handling with typed errors                                          │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    PHASE 8: RESPONSE RENDERER                                │
│  ─────────────────────────────────────────────────────────────────────────  │
│  • Template-based responses (no LLM for success/error messages)             │
│  • Language detection from user profile                                      │
│  • Entity cards, choices, confirmations                                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Command Sessions

**Goal**: Persist conversation state so confirmations, corrections, and multi-turn flows don't require LLM re-interpretation.

### 1.1 Database Schema

```sql
-- Migration: 20260731_add_command_sessions.sql

CREATE TABLE command_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Capability being executed
  capability_id TEXT NOT NULL,  -- e.g., "task.create", "invoice.send"

  -- State machine
  status TEXT NOT NULL DEFAULT 'gathering_params',
  -- Values: 'gathering_params', 'awaiting_confirmation', 'executing', 'completed', 'cancelled', 'failed'

  -- Resolved parameters (JSON)
  resolved_params JSONB NOT NULL DEFAULT '{}',

  -- Parameters still needed
  pending_params TEXT[] NOT NULL DEFAULT '{}',

  -- Current entity context (for follow-ups like "change its name")
  entity_context JSONB,  -- { type: 'services', id: 'uuid', data: {...} }

  -- For disambiguation
  pending_choices JSONB,  -- [{ id, label, entity }]

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '10 minutes',

  -- Conversation context (minimal, not full history)
  last_user_message TEXT,
  last_assistant_response TEXT
);

-- Index for fast lookup
CREATE INDEX idx_command_sessions_user_active
  ON command_sessions(user_id, status)
  WHERE status NOT IN ('completed', 'cancelled', 'failed');

-- Auto-cleanup expired sessions
CREATE INDEX idx_command_sessions_expires ON command_sessions(expires_at);

-- RLS
ALTER TABLE command_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can only access their own sessions"
  ON command_sessions FOR ALL
  USING (auth.uid() = user_id);
```

### 1.2 Repository

**File**: `lib/repositories/CommandSessionRepository.ts`

```typescript
import { supabaseServer } from '@/lib/supabaseServer';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ service: 'CommandSessionRepository' });

export type SessionStatus =
  | 'gathering_params'
  | 'awaiting_confirmation'
  | 'awaiting_choice'
  | 'executing'
  | 'completed'
  | 'cancelled'
  | 'failed';

export interface CommandSession {
  id: string;
  user_id: string;
  capability_id: string;
  status: SessionStatus;
  resolved_params: Record<string, unknown>;
  pending_params: string[];
  entity_context: {
    type: string;
    id: string;
    data: Record<string, unknown>;
  } | null;
  pending_choices: Array<{
    id: string;
    label: string;
    entity: Record<string, unknown>;
  }> | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
  last_user_message: string | null;
  last_assistant_response: string | null;
}

export interface CommandSessionResult<T> {
  data: T | null;
  error: Error | null;
}

class CommandSessionRepositoryClass {
  private supabase = supabaseServer;

  /**
   * Get active session for user (non-expired, non-terminal status)
   */
  async getActiveSession(userId: string): Promise<CommandSessionResult<CommandSession>> {
    try {
      const { data, error } = await this.supabase
        .from('command_sessions')
        .select('*')
        .eq('user_id', userId)
        .not('status', 'in', '("completed","cancelled","failed")')
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows
      return { data: data || null, error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to get active session');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Create new session
   */
  async create(
    userId: string,
    capabilityId: string,
    initialParams: Record<string, unknown> = {},
    pendingParams: string[] = []
  ): Promise<CommandSessionResult<CommandSession>> {
    try {
      // First, cancel any existing active sessions
      await this.supabase
        .from('command_sessions')
        .update({ status: 'cancelled' })
        .eq('user_id', userId)
        .not('status', 'in', '("completed","cancelled","failed")');

      const { data, error } = await this.supabase
        .from('command_sessions')
        .insert({
          user_id: userId,
          capability_id: capabilityId,
          resolved_params: initialParams,
          pending_params: pendingParams,
          status: pendingParams.length > 0 ? 'gathering_params' : 'awaiting_confirmation'
        })
        .select()
        .single();

      if (error) throw error;
      logger.info({ sessionId: data.id, capabilityId }, 'Command session created');
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, userId, capabilityId }, 'Failed to create session');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Update session with new params or status
   */
  async update(
    sessionId: string,
    userId: string,
    updates: Partial<Omit<CommandSession, 'id' | 'user_id' | 'created_at'>>
  ): Promise<CommandSessionResult<CommandSession>> {
    try {
      const { data, error } = await this.supabase
        .from('command_sessions')
        .update({
          ...updates,
          updated_at: new Date().toISOString(),
          // Extend expiry on activity
          expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString()
        })
        .eq('id', sessionId)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, sessionId }, 'Failed to update session');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Mark session as completed/cancelled/failed
   */
  async terminate(
    sessionId: string,
    userId: string,
    status: 'completed' | 'cancelled' | 'failed'
  ): Promise<CommandSessionResult<CommandSession>> {
    return this.update(sessionId, userId, { status });
  }

  /**
   * Add resolved parameter and remove from pending
   */
  async resolveParameter(
    sessionId: string,
    userId: string,
    paramName: string,
    value: unknown
  ): Promise<CommandSessionResult<CommandSession>> {
    try {
      // Get current session
      const { data: session, error: fetchError } = await this.supabase
        .from('command_sessions')
        .select('*')
        .eq('id', sessionId)
        .eq('user_id', userId)
        .single();

      if (fetchError) throw fetchError;

      const newResolvedParams = { ...session.resolved_params, [paramName]: value };
      const newPendingParams = session.pending_params.filter((p: string) => p !== paramName);

      return this.update(sessionId, userId, {
        resolved_params: newResolvedParams,
        pending_params: newPendingParams,
        status: newPendingParams.length === 0 ? 'awaiting_confirmation' : 'gathering_params'
      });
    } catch (error) {
      logger.error({ err: error, sessionId, paramName }, 'Failed to resolve parameter');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Set choices for disambiguation
   */
  async setChoices(
    sessionId: string,
    userId: string,
    choices: Array<{ id: string; label: string; entity: Record<string, unknown> }>
  ): Promise<CommandSessionResult<CommandSession>> {
    return this.update(sessionId, userId, {
      pending_choices: choices,
      status: 'awaiting_choice'
    });
  }

  /**
   * Cleanup expired sessions (call via cron)
   */
  async cleanupExpired(): Promise<{ deleted: number }> {
    try {
      const { data, error } = await this.supabase
        .from('command_sessions')
        .delete()
        .lt('expires_at', new Date().toISOString())
        .select('id');

      if (error) throw error;
      const deleted = data?.length || 0;
      if (deleted > 0) {
        logger.info({ deleted }, 'Cleaned up expired sessions');
      }
      return { deleted };
    } catch (error) {
      logger.error({ err: error }, 'Failed to cleanup sessions');
      return { deleted: 0 };
    }
  }
}

export const commandSessionRepository = new CommandSessionRepositoryClass();
```

### 1.3 Session State Machine

**File**: `lib/business-os/chat/SessionStateMachine.ts`

```typescript
import { CommandSession, SessionStatus } from '@/lib/repositories/CommandSessionRepository';

export type SessionTransition =
  | { type: 'PROVIDE_PARAM'; param: string; value: unknown }
  | { type: 'SELECT_CHOICE'; choiceId: string }
  | { type: 'CONFIRM' }
  | { type: 'CANCEL' }
  | { type: 'CORRECT'; correction: Record<string, unknown> }
  | { type: 'TIMEOUT' };

export interface TransitionResult {
  newStatus: SessionStatus;
  updates: Partial<CommandSession>;
  action?: 'execute' | 'ask_param' | 'show_choices' | 'show_confirmation' | 'cancelled';
  nextParam?: string;
}

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

    default:
      // Terminal states - no transitions allowed
      return {
        newStatus: session.status,
        updates: {},
        action: undefined
      };
  }
}

function handleGatheringParams(
  session: CommandSession,
  transition: SessionTransition
): TransitionResult {
  switch (transition.type) {
    case 'PROVIDE_PARAM': {
      const newResolved = { ...session.resolved_params, [transition.param]: transition.value };
      const newPending = session.pending_params.filter(p => p !== transition.param);

      if (newPending.length === 0) {
        return {
          newStatus: 'awaiting_confirmation',
          updates: { resolved_params: newResolved, pending_params: newPending },
          action: 'show_confirmation'
        };
      }

      return {
        newStatus: 'gathering_params',
        updates: { resolved_params: newResolved, pending_params: newPending },
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

    default:
      return { newStatus: session.status, updates: {} };
  }
}

function handleAwaitingChoice(
  session: CommandSession,
  transition: SessionTransition
): TransitionResult {
  switch (transition.type) {
    case 'SELECT_CHOICE': {
      const choice = session.pending_choices?.find(c => c.id === transition.choiceId);
      if (!choice) {
        return { newStatus: session.status, updates: {} };
      }

      // Determine which param this choice resolves
      // Convention: first pending param is the one being disambiguated
      const paramToResolve = session.pending_params[0];
      const newResolved = {
        ...session.resolved_params,
        [paramToResolve]: choice.id,
        [`${paramToResolve}_entity`]: choice.entity
      };
      const newPending = session.pending_params.slice(1);

      return {
        newStatus: newPending.length === 0 ? 'awaiting_confirmation' : 'gathering_params',
        updates: {
          resolved_params: newResolved,
          pending_params: newPending,
          pending_choices: null,
          entity_context: { type: paramToResolve, id: choice.id, data: choice.entity }
        },
        action: newPending.length === 0 ? 'show_confirmation' : 'ask_param',
        nextParam: newPending[0]
      };
    }

    case 'CANCEL':
      return {
        newStatus: 'cancelled',
        updates: {},
        action: 'cancelled'
      };

    default:
      return { newStatus: session.status, updates: {} };
  }
}

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
      // User is correcting a parameter
      const newResolved = { ...session.resolved_params, ...transition.correction };
      return {
        newStatus: 'awaiting_confirmation',
        updates: { resolved_params: newResolved },
        action: 'show_confirmation'
      };
    }

    default:
      return { newStatus: session.status, updates: {} };
  }
}
```

---

## Phase 2: Interaction Classifier

**Goal**: Classify user input deterministically before calling LLM.

### 2.1 Classifier Implementation

**File**: `lib/business-os/chat/InteractionClassifier.ts`

```typescript
import { CommandSession } from '@/lib/repositories/CommandSessionRepository';

export type InteractionType =
  | { type: 'CONFIRMATION'; value: 'confirm' | 'cancel' }
  | { type: 'CHOICE_SELECTION'; choiceId: string }
  | { type: 'PARAMETER_VALUE'; value: string }
  | { type: 'SLASH_COMMAND'; command: string; args: string }
  | { type: 'ENTITY_ID_REFERENCE'; entityId: string }
  | { type: 'NATURAL_LANGUAGE' };

// Confirmation patterns in multiple languages
const CONFIRM_PATTERNS = /^(yes|y|כן|אישור|ok|okay|confirm|sure|בטח|אוקיי|בסדר|מאשר)$/i;
const CANCEL_PATTERNS = /^(no|n|לא|ביטול|cancel|נגמר|עזוב|תשכח)$/i;

// Entity ID pattern: [ID: uuid] or just a UUID
const ENTITY_ID_PATTERN = /\[ID:\s*([a-f0-9-]{36})\]/i;
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

// Slash command pattern
const SLASH_PATTERN = /^\/(\w+)(?:\s+(.*))?$/;

// Short value pattern (likely a parameter value, not a new command)
const SHORT_VALUE_PATTERN = /^.{1,50}$/;

export function classifyInteraction(
  input: string,
  session: CommandSession | null,
  pendingChoices?: Array<{ id: string; label: string }>
): InteractionType {
  const trimmed = input.trim();

  // 1. Check for confirmation/cancellation when awaiting
  if (session?.status === 'awaiting_confirmation') {
    if (CONFIRM_PATTERNS.test(trimmed)) {
      return { type: 'CONFIRMATION', value: 'confirm' };
    }
    if (CANCEL_PATTERNS.test(trimmed)) {
      return { type: 'CONFIRMATION', value: 'cancel' };
    }
  }

  // 2. Check for choice selection when awaiting choice
  if (session?.status === 'awaiting_choice' && pendingChoices) {
    // Direct ID match
    const choice = pendingChoices.find(c =>
      c.id === trimmed ||
      c.label.toLowerCase() === trimmed.toLowerCase()
    );
    if (choice) {
      return { type: 'CHOICE_SELECTION', choiceId: choice.id };
    }

    // Numeric selection (1, 2, 3...)
    const numMatch = /^(\d+)$/.exec(trimmed);
    if (numMatch) {
      const index = parseInt(numMatch[1], 10) - 1;
      if (index >= 0 && index < pendingChoices.length) {
        return { type: 'CHOICE_SELECTION', choiceId: pendingChoices[index].id };
      }
    }
  }

  // 3. Check for entity ID reference
  const idMatch = ENTITY_ID_PATTERN.exec(trimmed);
  if (idMatch) {
    return { type: 'ENTITY_ID_REFERENCE', entityId: idMatch[1] };
  }

  // 4. Check for slash command
  const slashMatch = SLASH_PATTERN.exec(trimmed);
  if (slashMatch) {
    return { type: 'SLASH_COMMAND', command: slashMatch[1], args: slashMatch[2] || '' };
  }

  // 5. If gathering params and input is short, likely a parameter value
  if (session?.status === 'gathering_params' && SHORT_VALUE_PATTERN.test(trimmed)) {
    // Check if it looks like a new command (starts with action verb)
    const NEW_COMMAND_PATTERNS = /^(create|add|make|delete|remove|show|list|find|update|change|send|צור|הוסף|מחק|הצג|שנה|שלח)/i;
    if (!NEW_COMMAND_PATTERNS.test(trimmed)) {
      return { type: 'PARAMETER_VALUE', value: trimmed };
    }
  }

  // 6. Default: needs LLM interpretation
  return { type: 'NATURAL_LANGUAGE' };
}
```

### 2.2 Integration Tests for Classifier

**File**: `lib/business-os/chat/__tests__/InteractionClassifier.test.ts`

```typescript
import { classifyInteraction } from '../InteractionClassifier';
import { CommandSession } from '@/lib/repositories/CommandSessionRepository';

describe('InteractionClassifier', () => {
  const mockSession = (status: string): CommandSession => ({
    id: 'test-id',
    user_id: 'user-id',
    capability_id: 'task.create',
    status: status as any,
    resolved_params: {},
    pending_params: ['due_date'],
    entity_context: null,
    pending_choices: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    expires_at: new Date().toISOString(),
    last_user_message: null,
    last_assistant_response: null
  });

  describe('confirmations', () => {
    it('detects English confirmations', () => {
      const session = mockSession('awaiting_confirmation');
      expect(classifyInteraction('yes', session, undefined)).toEqual({ type: 'CONFIRMATION', value: 'confirm' });
      expect(classifyInteraction('Yes', session, undefined)).toEqual({ type: 'CONFIRMATION', value: 'confirm' });
      expect(classifyInteraction('ok', session, undefined)).toEqual({ type: 'CONFIRMATION', value: 'confirm' });
    });

    it('detects Hebrew confirmations', () => {
      const session = mockSession('awaiting_confirmation');
      expect(classifyInteraction('כן', session, undefined)).toEqual({ type: 'CONFIRMATION', value: 'confirm' });
      expect(classifyInteraction('אישור', session, undefined)).toEqual({ type: 'CONFIRMATION', value: 'confirm' });
    });

    it('detects cancellations', () => {
      const session = mockSession('awaiting_confirmation');
      expect(classifyInteraction('no', session, undefined)).toEqual({ type: 'CONFIRMATION', value: 'cancel' });
      expect(classifyInteraction('לא', session, undefined)).toEqual({ type: 'CONFIRMATION', value: 'cancel' });
      expect(classifyInteraction('cancel', session, undefined)).toEqual({ type: 'CONFIRMATION', value: 'cancel' });
    });

    it('does not detect confirmation when not awaiting', () => {
      const session = mockSession('gathering_params');
      expect(classifyInteraction('yes', session, undefined)).toEqual({ type: 'PARAMETER_VALUE', value: 'yes' });
    });
  });

  describe('choice selection', () => {
    const choices = [
      { id: 'uuid-1', label: 'Coaching Session' },
      { id: 'uuid-2', label: 'Discovery Call' }
    ];

    it('detects exact label match', () => {
      const session = mockSession('awaiting_choice');
      expect(classifyInteraction('Coaching Session', session, choices)).toEqual({
        type: 'CHOICE_SELECTION',
        choiceId: 'uuid-1'
      });
    });

    it('detects numeric selection', () => {
      const session = mockSession('awaiting_choice');
      expect(classifyInteraction('1', session, choices)).toEqual({
        type: 'CHOICE_SELECTION',
        choiceId: 'uuid-1'
      });
      expect(classifyInteraction('2', session, choices)).toEqual({
        type: 'CHOICE_SELECTION',
        choiceId: 'uuid-2'
      });
    });
  });

  describe('slash commands', () => {
    it('detects slash commands', () => {
      expect(classifyInteraction('/help', null, undefined)).toEqual({
        type: 'SLASH_COMMAND',
        command: 'help',
        args: ''
      });
      expect(classifyInteraction('/create task Buy milk', null, undefined)).toEqual({
        type: 'SLASH_COMMAND',
        command: 'create',
        args: 'task Buy milk'
      });
    });
  });

  describe('parameter values', () => {
    it('treats short input as parameter value when gathering params', () => {
      const session = mockSession('gathering_params');
      expect(classifyInteraction('tomorrow', session, undefined)).toEqual({
        type: 'PARAMETER_VALUE',
        value: 'tomorrow'
      });
      expect(classifyInteraction('פגישת היכרות', session, undefined)).toEqual({
        type: 'PARAMETER_VALUE',
        value: 'פגישת היכרות'
      });
    });

    it('detects new command even when gathering params', () => {
      const session = mockSession('gathering_params');
      expect(classifyInteraction('create a new task', session, undefined)).toEqual({
        type: 'NATURAL_LANGUAGE'
      });
    });
  });
});
```

---

## Phase 3: Unified Capability Registry

**Goal**: Single source of truth for all capabilities, replacing scattered definitions.

### 3.1 Registry Schema

**File**: `lib/business-os/chat/CapabilityRegistry.ts`

```typescript
import { z } from 'zod';

// Parameter types
export type ParamType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'date'
  | 'time'
  | 'datetime'
  | 'duration'
  | 'money'
  | 'email'
  | 'phone'
  | 'entity_ref';

export interface CapabilityParam {
  name: string;
  type: ParamType;
  required: boolean;
  description: string;
  description_he?: string;

  // For entity_ref type
  entityType?: string;  // e.g., 'contacts', 'services'

  // For validation
  validation?: z.ZodSchema;

  // Default value
  default?: unknown;

  // Prompt to ask user for this param
  prompt?: string;
  prompt_he?: string;
}

export interface Capability {
  id: string;  // e.g., 'task.create', 'invoice.send'

  // Categorization
  domain: string;  // e.g., 'crm', 'scheduling', 'payments'
  entity: string;  // e.g., 'task', 'contact', 'invoice'
  action: string;  // e.g., 'create', 'update', 'send'

  // For LLM understanding
  description: string;
  description_he?: string;
  examples?: string[];  // Natural language examples that trigger this

  // Parameters
  params: CapabilityParam[];

  // Execution
  executor: string;  // Service method path, e.g., 'TaskService.create'

  // Behavior flags
  confirmationRequired: boolean;
  destructive: boolean;  // Can't be undone

  // Confirmation message template
  confirmationTemplate?: string;
  confirmationTemplate_he?: string;

  // Success message template
  successTemplate?: string;
  successTemplate_he?: string;
}

// The registry
export const CAPABILITY_REGISTRY: Capability[] = [
  // ============== CRM ==============
  {
    id: 'contact.create',
    domain: 'crm',
    entity: 'contact',
    action: 'create',
    description: 'Create a new contact/client/customer',
    description_he: 'יצירת איש קשר/לקוח חדש',
    examples: [
      'add a new contact',
      'create contact for John',
      'הוסף איש קשר חדש',
      'צור לקוח בשם דוד'
    ],
    params: [
      { name: 'first_name', type: 'string', required: true, description: 'First name', prompt: 'What is their first name?', prompt_he: 'מה השם הפרטי?' },
      { name: 'last_name', type: 'string', required: false, description: 'Last name', prompt: 'What is their last name?', prompt_he: 'מה שם המשפחה?' },
      { name: 'email', type: 'email', required: false, description: 'Email address' },
      { name: 'phone', type: 'phone', required: false, description: 'Phone number' }
    ],
    executor: 'CRMContactRepository.create',
    confirmationRequired: false,
    destructive: false,
    successTemplate: 'Contact {first_name} {last_name} created successfully!',
    successTemplate_he: 'איש הקשר {first_name} {last_name} נוצר בהצלחה!'
  },

  {
    id: 'contact.update',
    domain: 'crm',
    entity: 'contact',
    action: 'update',
    description: 'Update an existing contact',
    description_he: 'עדכון איש קשר קיים',
    examples: [
      'update contact',
      'change email for Sarah',
      'עדכן את הטלפון של דוד',
      'שנה את האימייל'
    ],
    params: [
      { name: 'contact_id', type: 'entity_ref', entityType: 'contacts', required: true, description: 'Contact to update' },
      { name: 'first_name', type: 'string', required: false, description: 'New first name' },
      { name: 'last_name', type: 'string', required: false, description: 'New last name' },
      { name: 'email', type: 'email', required: false, description: 'New email' },
      { name: 'phone', type: 'phone', required: false, description: 'New phone' }
    ],
    executor: 'CRMContactRepository.update',
    confirmationRequired: true,
    destructive: false,
    confirmationTemplate: 'Update contact {contact_id.first_name} {contact_id.last_name}?',
    confirmationTemplate_he: 'לעדכן את איש הקשר {contact_id.first_name} {contact_id.last_name}?'
  },

  {
    id: 'contact.delete',
    domain: 'crm',
    entity: 'contact',
    action: 'delete',
    description: 'Permanently delete a contact',
    description_he: 'מחיקה לצמיתות של איש קשר',
    params: [
      { name: 'contact_id', type: 'entity_ref', entityType: 'contacts', required: true, description: 'Contact to delete' }
    ],
    executor: 'CRMContactRepository.delete',
    confirmationRequired: true,
    destructive: true,
    confirmationTemplate: '⚠️ PERMANENTLY delete contact {contact_id.first_name}? This cannot be undone!',
    confirmationTemplate_he: '⚠️ למחוק לצמיתות את {contact_id.first_name}? לא ניתן לשחזר!'
  },

  // ============== TASKS ==============
  {
    id: 'task.create',
    domain: 'crm',
    entity: 'task',
    action: 'create',
    description: 'Create a new task/todo/reminder',
    description_he: 'יצירת משימה/תזכורת חדשה',
    examples: [
      'create a task',
      'add todo',
      'remind me to',
      'צור משימה',
      'הוסף תזכורת'
    ],
    params: [
      { name: 'title', type: 'string', required: true, description: 'Task title/subject', prompt: 'What is the task?', prompt_he: 'מה המשימה?' },
      { name: 'due_date', type: 'date', required: false, description: 'Due date', prompt: 'When is it due?', prompt_he: 'מתי לבצע?' },
      { name: 'priority', type: 'string', required: false, description: 'Priority (low/medium/high)', default: 'medium' },
      { name: 'contact_id', type: 'entity_ref', entityType: 'contacts', required: false, description: 'Related contact' }
    ],
    executor: 'CRMTaskRepository.create',
    confirmationRequired: false,
    destructive: false,
    successTemplate: 'Task "{title}" created!',
    successTemplate_he: 'המשימה "{title}" נוצרה!'
  },

  {
    id: 'task.complete',
    domain: 'crm',
    entity: 'task',
    action: 'complete',
    description: 'Mark a task as completed',
    description_he: 'סימון משימה כהושלמה',
    examples: [
      'complete task',
      'mark as done',
      'finish task',
      'סיים משימה',
      'סמן כבוצע'
    ],
    params: [
      { name: 'task_id', type: 'entity_ref', entityType: 'tasks', required: true, description: 'Task to complete' }
    ],
    executor: 'CRMTaskRepository.complete',
    confirmationRequired: false,
    destructive: false,
    successTemplate: 'Task marked as completed!',
    successTemplate_he: 'המשימה סומנה כהושלמה!'
  },

  // ============== SCHEDULING ==============
  {
    id: 'booking.create',
    domain: 'scheduling',
    entity: 'booking',
    action: 'create',
    description: 'Schedule a new appointment/meeting/booking',
    description_he: 'קביעת פגישה/תור חדש',
    examples: [
      'schedule a meeting',
      'book an appointment',
      'קבע פגישה',
      'תאם תור'
    ],
    params: [
      { name: 'service_id', type: 'entity_ref', entityType: 'services', required: true, description: 'Service type' },
      { name: 'contact_id', type: 'entity_ref', entityType: 'contacts', required: true, description: 'Client' },
      { name: 'start_time', type: 'datetime', required: true, description: 'Appointment time', prompt: 'When should we schedule it?', prompt_he: 'מתי לקבוע?' }
    ],
    executor: 'SchedulingBookingRepository.create',
    confirmationRequired: true,
    destructive: false,
    confirmationTemplate: 'Schedule {service_id.service_name} with {contact_id.first_name} on {start_time}?',
    confirmationTemplate_he: 'לקבוע {service_id.service_name} עם {contact_id.first_name} ב-{start_time}?'
  },

  {
    id: 'booking.reschedule',
    domain: 'scheduling',
    entity: 'booking',
    action: 'reschedule',
    description: 'Reschedule an existing appointment',
    description_he: 'שינוי מועד פגישה קיימת',
    examples: [
      'reschedule meeting',
      'move appointment',
      'change booking time',
      'הזז פגישה',
      'שנה מועד'
    ],
    params: [
      { name: 'booking_id', type: 'entity_ref', entityType: 'bookings', required: true, description: 'Booking to reschedule' },
      { name: 'new_start_time', type: 'datetime', required: true, description: 'New time', prompt: 'When should we reschedule to?', prompt_he: 'למתי להעביר?' }
    ],
    executor: 'SchedulingBookingRepository.reschedule',
    confirmationRequired: true,
    destructive: false
  },

  {
    id: 'booking.cancel',
    domain: 'scheduling',
    entity: 'booking',
    action: 'cancel',
    description: 'Cancel an appointment',
    description_he: 'ביטול פגישה',
    params: [
      { name: 'booking_id', type: 'entity_ref', entityType: 'bookings', required: true, description: 'Booking to cancel' }
    ],
    executor: 'SchedulingBookingRepository.cancel',
    confirmationRequired: true,
    destructive: false,
    confirmationTemplate: 'Cancel appointment with {booking_id.contact_name} on {booking_id.start_time}?',
    confirmationTemplate_he: 'לבטל את הפגישה עם {booking_id.contact_name} ב-{booking_id.start_time}?'
  },

  // ============== SERVICES ==============
  {
    id: 'service.create',
    domain: 'scheduling',
    entity: 'service',
    action: 'create',
    description: 'Create a new service offering',
    description_he: 'יצירת שירות חדש',
    params: [
      { name: 'service_name', type: 'string', required: true, description: 'Service name' },
      { name: 'duration_minutes', type: 'duration', required: true, description: 'Duration' },
      { name: 'price', type: 'money', required: false, description: 'Price' }
    ],
    executor: 'SchedulingServiceRepository.create',
    confirmationRequired: false,
    destructive: false
  },

  {
    id: 'service.deactivate',
    domain: 'scheduling',
    entity: 'service',
    action: 'deactivate',
    description: 'Deactivate/hide a service (can be reactivated later)',
    description_he: 'השבתת שירות (ניתן להפעיל מחדש)',
    params: [
      { name: 'service_id', type: 'entity_ref', entityType: 'services', required: true, description: 'Service to deactivate' }
    ],
    executor: 'SchedulingServiceRepository.deactivate',
    confirmationRequired: true,
    destructive: false,
    confirmationTemplate: 'Deactivate "{service_id.service_name}"? It will be hidden but can be reactivated.',
    confirmationTemplate_he: 'להשבית את "{service_id.service_name}"? השירות יוסתר אך ניתן להפעילו מחדש.'
  },

  // ============== INVOICES ==============
  {
    id: 'invoice.create',
    domain: 'payments',
    entity: 'invoice',
    action: 'create',
    description: 'Create a new invoice',
    description_he: 'יצירת חשבונית חדשה',
    params: [
      { name: 'contact_id', type: 'entity_ref', entityType: 'contacts', required: true, description: 'Client to invoice' },
      { name: 'amount', type: 'money', required: true, description: 'Invoice amount' },
      { name: 'description', type: 'string', required: true, description: 'Invoice description' },
      { name: 'due_date', type: 'date', required: false, description: 'Payment due date' }
    ],
    executor: 'PaymentInvoiceRepository.create',
    confirmationRequired: true,
    destructive: false
  },

  {
    id: 'invoice.send',
    domain: 'payments',
    entity: 'invoice',
    action: 'send',
    description: 'Send an invoice to the client',
    description_he: 'שליחת חשבונית ללקוח',
    params: [
      { name: 'invoice_id', type: 'entity_ref', entityType: 'invoices', required: true, description: 'Invoice to send' }
    ],
    executor: 'PaymentInvoiceRepository.send',
    confirmationRequired: true,
    destructive: false,
    confirmationTemplate: 'Send invoice #{invoice_id.invoice_number} ({invoice_id.amount}) to {invoice_id.contact_name}?',
    confirmationTemplate_he: 'לשלוח חשבונית #{invoice_id.invoice_number} ({invoice_id.amount}) ל-{invoice_id.contact_name}?'
  },

  // ============== EMAIL ==============
  {
    id: 'email.send',
    domain: 'communication',
    entity: 'email',
    action: 'send',
    description: 'Send an email to a contact',
    description_he: 'שליחת אימייל לאיש קשר',
    examples: [
      'send email to',
      'email John',
      'שלח מייל ל',
      'כתוב אימייל'
    ],
    params: [
      { name: 'contact_id', type: 'entity_ref', entityType: 'contacts', required: true, description: 'Recipient' },
      { name: 'subject', type: 'string', required: true, description: 'Email subject', prompt: 'What is the subject?', prompt_he: 'מה הנושא?' },
      { name: 'body', type: 'string', required: true, description: 'Email body', prompt: 'What should the email say?', prompt_he: 'מה לכתוב באימייל?' }
    ],
    executor: 'EmailService.send',
    confirmationRequired: true,
    destructive: false,
    confirmationTemplate: 'Send email to {contact_id.email}?\n\nSubject: {subject}\n\n{body}',
    confirmationTemplate_he: 'לשלוח אימייל ל-{contact_id.email}?\n\nנושא: {subject}\n\n{body}'
  }
];

// Helper functions
export function getCapability(id: string): Capability | undefined {
  return CAPABILITY_REGISTRY.find(c => c.id === id);
}

export function getCapabilitiesForEntity(entity: string): Capability[] {
  return CAPABILITY_REGISTRY.filter(c => c.entity === entity);
}

export function getCapabilitiesForDomain(domain: string): Capability[] {
  return CAPABILITY_REGISTRY.filter(c => c.domain === domain);
}

export function generateLLMToolSchema(): object[] {
  return CAPABILITY_REGISTRY.map(cap => ({
    type: 'function',
    function: {
      name: cap.id.replace('.', '_'),  // task.create → task_create
      description: cap.description,
      parameters: {
        type: 'object',
        properties: Object.fromEntries(
          cap.params.map(p => [
            p.name,
            {
              type: paramTypeToJsonSchema(p.type),
              description: p.description
            }
          ])
        ),
        required: cap.params.filter(p => p.required).map(p => p.name)
      }
    }
  }));
}

function paramTypeToJsonSchema(type: ParamType): string {
  switch (type) {
    case 'number':
    case 'money':
    case 'duration':
      return 'number';
    case 'boolean':
      return 'boolean';
    default:
      return 'string';
  }
}
```

---

## Phase 4: Parameter Processor

**Goal**: Parse natural language parameters into structured values deterministically.

### 4.1 Parameter Parsers

**File**: `lib/business-os/chat/ParameterParsers.ts`

```typescript
import { ParamType } from './CapabilityRegistry';

export interface ParseResult<T> {
  success: boolean;
  value?: T;
  error?: string;
}

// ============== DATE PARSER ==============
const DATE_PATTERNS: Array<{
  pattern: RegExp;
  resolver: (match: RegExpMatchArray) => Date;
}> = [
  // Relative dates (English)
  { pattern: /^today$/i, resolver: () => new Date() },
  { pattern: /^tomorrow$/i, resolver: () => addDays(new Date(), 1) },
  { pattern: /^yesterday$/i, resolver: () => addDays(new Date(), -1) },
  { pattern: /^next\s+week$/i, resolver: () => addDays(new Date(), 7) },
  { pattern: /^next\s+month$/i, resolver: () => addMonths(new Date(), 1) },
  { pattern: /^in\s+(\d+)\s+days?$/i, resolver: (m) => addDays(new Date(), parseInt(m[1])) },
  { pattern: /^in\s+(\d+)\s+weeks?$/i, resolver: (m) => addDays(new Date(), parseInt(m[1]) * 7) },

  // Relative dates (Hebrew)
  { pattern: /^היום$/i, resolver: () => new Date() },
  { pattern: /^מחר$/i, resolver: () => addDays(new Date(), 1) },
  { pattern: /^מחרתיים$/i, resolver: () => addDays(new Date(), 2) },
  { pattern: /^אתמול$/i, resolver: () => addDays(new Date(), -1) },
  { pattern: /^בעוד\s+שבוע$/i, resolver: () => addDays(new Date(), 7) },
  { pattern: /^בעוד\s+חודש$/i, resolver: () => addMonths(new Date(), 1) },
  { pattern: /^בעוד\s+(\d+)\s+ימים$/i, resolver: (m) => addDays(new Date(), parseInt(m[1])) },

  // Day of week (English)
  { pattern: /^(this\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/i,
    resolver: (m) => getNextDayOfWeek(m[2]) },
  { pattern: /^next\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/i,
    resolver: (m) => getNextDayOfWeek(m[1], true) },

  // Day of week (Hebrew)
  { pattern: /^(ביום\s+)?(ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת)$/i,
    resolver: (m) => getNextDayOfWeekHebrew(m[2]) },

  // ISO format
  { pattern: /^(\d{4})-(\d{2})-(\d{2})$/, resolver: (m) => new Date(m[0]) },

  // Common formats
  { pattern: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, resolver: (m) => new Date(parseInt(m[3]), parseInt(m[1]) - 1, parseInt(m[2])) },
  { pattern: /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/, resolver: (m) => new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1])) },
];

export function parseDate(input: string): ParseResult<string> {
  const trimmed = input.trim();

  for (const { pattern, resolver } of DATE_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) {
      const date = resolver(match);
      return { success: true, value: date.toISOString().split('T')[0] };
    }
  }

  // Try native Date parsing as fallback
  const parsed = new Date(trimmed);
  if (!isNaN(parsed.getTime())) {
    return { success: true, value: parsed.toISOString().split('T')[0] };
  }

  return { success: false, error: `Could not parse date: "${input}"` };
}

// ============== TIME PARSER ==============
const TIME_PATTERNS: Array<{
  pattern: RegExp;
  resolver: (match: RegExpMatchArray) => { hours: number; minutes: number };
}> = [
  // 24-hour format
  { pattern: /^(\d{1,2}):(\d{2})$/, resolver: (m) => ({ hours: parseInt(m[1]), minutes: parseInt(m[2]) }) },

  // 12-hour format with am/pm
  { pattern: /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i, resolver: (m) => {
    let hours = parseInt(m[1]);
    const minutes = m[2] ? parseInt(m[2]) : 0;
    if (m[3].toLowerCase() === 'pm' && hours !== 12) hours += 12;
    if (m[3].toLowerCase() === 'am' && hours === 12) hours = 0;
    return { hours, minutes };
  }},

  // Natural language (English)
  { pattern: /^morning$/i, resolver: () => ({ hours: 9, minutes: 0 }) },
  { pattern: /^noon$/i, resolver: () => ({ hours: 12, minutes: 0 }) },
  { pattern: /^afternoon$/i, resolver: () => ({ hours: 14, minutes: 0 }) },
  { pattern: /^evening$/i, resolver: () => ({ hours: 18, minutes: 0 }) },

  // Natural language (Hebrew)
  { pattern: /^בוקר|בבוקר$/i, resolver: () => ({ hours: 9, minutes: 0 }) },
  { pattern: /^צהריים|בצהריים$/i, resolver: () => ({ hours: 12, minutes: 0 }) },
  { pattern: /^אחה"צ|אחרי הצהריים$/i, resolver: () => ({ hours: 14, minutes: 0 }) },
  { pattern: /^ערב|בערב$/i, resolver: () => ({ hours: 18, minutes: 0 }) },
];

export function parseTime(input: string): ParseResult<string> {
  const trimmed = input.trim();

  for (const { pattern, resolver } of TIME_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) {
      const { hours, minutes } = resolver(match);
      return {
        success: true,
        value: `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`
      };
    }
  }

  return { success: false, error: `Could not parse time: "${input}"` };
}

// ============== DURATION PARSER ==============
export function parseDuration(input: string): ParseResult<number> {
  const trimmed = input.trim().toLowerCase();

  // Minutes
  const minMatch = trimmed.match(/^(\d+)\s*(min|minutes?|דקות?)$/i);
  if (minMatch) {
    return { success: true, value: parseInt(minMatch[1]) };
  }

  // Hours
  const hourMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*(h|hour|hours?|שעות?|שעה)$/i);
  if (hourMatch) {
    return { success: true, value: Math.round(parseFloat(hourMatch[1]) * 60) };
  }

  // Combined (e.g., "1 hour 30 minutes")
  const combinedMatch = trimmed.match(/^(\d+)\s*(?:h|hour|hours?|שעות?|שעה)\s+(\d+)\s*(?:min|minutes?|דקות?)$/i);
  if (combinedMatch) {
    return { success: true, value: parseInt(combinedMatch[1]) * 60 + parseInt(combinedMatch[2]) };
  }

  // Just a number (assume minutes)
  const numMatch = trimmed.match(/^(\d+)$/);
  if (numMatch) {
    return { success: true, value: parseInt(numMatch[1]) };
  }

  return { success: false, error: `Could not parse duration: "${input}"` };
}

// ============== MONEY PARSER ==============
export function parseMoney(input: string): ParseResult<{ amount: number; currency: string }> {
  const trimmed = input.trim();

  // With currency symbol
  const symbolMatch = trimmed.match(/^([₪$€£])?\s*(\d+(?:[.,]\d{1,2})?)\s*([₪$€£])?$/);
  if (symbolMatch) {
    const symbol = symbolMatch[1] || symbolMatch[3] || '₪';
    const amount = parseFloat(symbolMatch[2].replace(',', '.'));
    const currencyMap: Record<string, string> = { '₪': 'ILS', '$': 'USD', '€': 'EUR', '£': 'GBP' };
    return { success: true, value: { amount, currency: currencyMap[symbol] || 'ILS' } };
  }

  // With currency code
  const codeMatch = trimmed.match(/^(\d+(?:[.,]\d{1,2})?)\s*(ILS|USD|EUR|GBP|שקל|דולר|שקלים)$/i);
  if (codeMatch) {
    const amount = parseFloat(codeMatch[1].replace(',', '.'));
    const codeMap: Record<string, string> = { 'שקל': 'ILS', 'שקלים': 'ILS', 'דולר': 'USD' };
    const currency = codeMap[codeMatch[2].toLowerCase()] || codeMatch[2].toUpperCase();
    return { success: true, value: { amount, currency } };
  }

  // Just a number (default to ILS)
  const numMatch = trimmed.match(/^(\d+(?:[.,]\d{1,2})?)$/);
  if (numMatch) {
    return { success: true, value: { amount: parseFloat(numMatch[1].replace(',', '.')), currency: 'ILS' } };
  }

  return { success: false, error: `Could not parse amount: "${input}"` };
}

// ============== EMAIL PARSER ==============
export function parseEmail(input: string): ParseResult<string> {
  const trimmed = input.trim().toLowerCase();
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (emailPattern.test(trimmed)) {
    return { success: true, value: trimmed };
  }

  return { success: false, error: `Invalid email format: "${input}"` };
}

// ============== PHONE PARSER ==============
export function parsePhone(input: string): ParseResult<string> {
  // Remove all non-digit characters except +
  const cleaned = input.replace(/[^\d+]/g, '');

  // Basic validation (at least 9 digits)
  if (cleaned.replace(/\D/g, '').length >= 9) {
    return { success: true, value: cleaned };
  }

  return { success: false, error: `Invalid phone number: "${input}"` };
}

// ============== BOOLEAN PARSER ==============
export function parseBoolean(input: string): ParseResult<boolean> {
  const trimmed = input.trim().toLowerCase();

  const truePatterns = ['true', 'yes', 'y', '1', 'כן', 'נכון', 'אמת'];
  const falsePatterns = ['false', 'no', 'n', '0', 'לא', 'שקר'];

  if (truePatterns.includes(trimmed)) {
    return { success: true, value: true };
  }
  if (falsePatterns.includes(trimmed)) {
    return { success: true, value: false };
  }

  return { success: false, error: `Could not parse boolean: "${input}"` };
}

// ============== UNIFIED PARSER ==============
export function parseParameter(
  input: string,
  type: ParamType
): ParseResult<unknown> {
  switch (type) {
    case 'date':
      return parseDate(input);
    case 'time':
      return parseTime(input);
    case 'datetime':
      // Try to parse both date and time from input
      const dateResult = parseDate(input);
      const timeResult = parseTime(input);
      if (dateResult.success && timeResult.success) {
        return { success: true, value: `${dateResult.value}T${timeResult.value}:00` };
      }
      if (dateResult.success) {
        return { success: true, value: `${dateResult.value}T09:00:00` }; // Default to 9am
      }
      return dateResult;
    case 'duration':
      return parseDuration(input);
    case 'money':
      return parseMoney(input);
    case 'email':
      return parseEmail(input);
    case 'phone':
      return parsePhone(input);
    case 'boolean':
      return parseBoolean(input);
    case 'number':
      const num = parseFloat(input);
      return isNaN(num)
        ? { success: false, error: `Invalid number: "${input}"` }
        : { success: true, value: num };
    case 'string':
    default:
      return { success: true, value: input.trim() };
  }
}

// ============== HELPER FUNCTIONS ==============
function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

function getNextDayOfWeek(dayName: string, nextWeek = false): Date {
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const targetDay = days.indexOf(dayName.toLowerCase());
  const today = new Date();
  const currentDay = today.getDay();

  let daysUntil = targetDay - currentDay;
  if (daysUntil <= 0 || nextWeek) {
    daysUntil += 7;
  }

  return addDays(today, daysUntil);
}

function getNextDayOfWeekHebrew(dayName: string): Date {
  const hebrewDays: Record<string, number> = {
    'ראשון': 0, 'שני': 1, 'שלישי': 2, 'רביעי': 3,
    'חמישי': 4, 'שישי': 5, 'שבת': 6
  };
  const targetDay = hebrewDays[dayName];
  const today = new Date();
  const currentDay = today.getDay();

  let daysUntil = targetDay - currentDay;
  if (daysUntil <= 0) {
    daysUntil += 7;
  }

  return addDays(today, daysUntil);
}
```

---

## Phase 5: Entity Resolver

**Goal**: Resolve entity references deterministically without LLM.

### 5.1 Entity Resolver

**File**: `lib/business-os/chat/EntityResolver.ts`

```typescript
import { crmContactRepository } from '@/lib/repositories/CRMContactRepository';
import { crmTaskRepository } from '@/lib/repositories/CRMTaskRepository';
import { schedulingServiceRepository, schedulingBookingRepository } from '@/lib/repositories/SchedulingRepository';
import { paymentInvoiceRepository } from '@/lib/repositories/PaymentRepository';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ service: 'EntityResolver' });

export interface ResolvedEntity {
  id: string;
  type: string;
  data: Record<string, unknown>;
  displayName: string;
}

export interface ResolutionResult {
  status: 'exact' | 'multiple' | 'none' | 'error';
  entity?: ResolvedEntity;
  choices?: Array<{ id: string; label: string; entity: Record<string, unknown> }>;
  error?: string;
}

// Entity ID pattern: [ID: uuid]
const ENTITY_ID_PATTERN = /\[ID:\s*([a-f0-9-]{36})\]/i;
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export class EntityResolver {
  constructor(private userId: string) {}

  /**
   * Resolve an entity reference to actual entity data
   */
  async resolve(
    entityType: string,
    reference: string,
    filters?: Record<string, unknown>
  ): Promise<ResolutionResult> {
    // 1. Check for explicit ID
    const idMatch = ENTITY_ID_PATTERN.exec(reference);
    if (idMatch) {
      return this.resolveById(entityType, idMatch[1]);
    }

    // 2. Check if reference is a raw UUID
    if (UUID_PATTERN.test(reference.trim())) {
      return this.resolveById(entityType, reference.trim());
    }

    // 3. Search by name/text
    return this.resolveBySearch(entityType, reference, filters);
  }

  /**
   * Resolve entity by ID
   */
  private async resolveById(entityType: string, id: string): Promise<ResolutionResult> {
    try {
      let result: { data: unknown | null; error: Error | null };

      switch (entityType) {
        case 'contacts':
          result = await crmContactRepository.findById(id, this.userId);
          break;
        case 'tasks':
          result = await crmTaskRepository.findById(id, this.userId);
          break;
        case 'services':
          result = await schedulingServiceRepository.findById(id, this.userId);
          break;
        case 'bookings':
          result = await schedulingBookingRepository.getById(id, this.userId);
          break;
        case 'invoices':
          result = await paymentInvoiceRepository.findById(id, this.userId);
          break;
        default:
          return { status: 'error', error: `Unknown entity type: ${entityType}` };
      }

      if (result.error || !result.data) {
        return { status: 'none' };
      }

      const entity = result.data as Record<string, unknown>;
      return {
        status: 'exact',
        entity: {
          id,
          type: entityType,
          data: entity,
          displayName: this.getDisplayName(entityType, entity)
        }
      };
    } catch (error) {
      logger.error({ err: error, entityType, id }, 'Failed to resolve entity by ID');
      return { status: 'error', error: 'Failed to resolve entity' };
    }
  }

  /**
   * Resolve entity by search
   */
  private async resolveBySearch(
    entityType: string,
    searchText: string,
    filters?: Record<string, unknown>
  ): Promise<ResolutionResult> {
    try {
      let entities: Array<Record<string, unknown>> = [];

      switch (entityType) {
        case 'contacts': {
          const result = await crmContactRepository.list(this.userId, {
            search: searchText,
            limit: 10
          });
          entities = (result.data || []) as Array<Record<string, unknown>>;
          break;
        }
        case 'tasks': {
          const result = await crmTaskRepository.list(this.userId, {
            search: searchText,
            status: filters?.status as string,
            limit: 10
          });
          entities = (result.data || []) as Array<Record<string, unknown>>;
          break;
        }
        case 'services': {
          const result = await schedulingServiceRepository.listAll(this.userId, true);
          const allServices = (result.data || []) as Array<Record<string, unknown>>;
          // Filter by search
          const searchLower = searchText.toLowerCase();
          entities = allServices.filter(s =>
            (s.service_name as string || '').toLowerCase().includes(searchLower) ||
            (s.description as string || '').toLowerCase().includes(searchLower)
          ).slice(0, 10);
          break;
        }
        case 'bookings': {
          const result = await schedulingBookingRepository.listUpcoming(this.userId, 20);
          const allBookings = (result.data || []) as Array<Record<string, unknown>>;
          // Filter by search (client name, service name)
          const searchLower = searchText.toLowerCase();
          entities = allBookings.filter(b => {
            const clientName = `${b.client_first_name || ''} ${b.client_last_name || ''}`.toLowerCase();
            const serviceName = (b.service_name as string || '').toLowerCase();
            return clientName.includes(searchLower) || serviceName.includes(searchLower);
          }).slice(0, 10);
          break;
        }
        case 'invoices': {
          const result = await paymentInvoiceRepository.list(this.userId, {
            status: filters?.status as string,
            limit: 10,
            includeContact: true
          });
          const allInvoices = (result.data || []) as Array<Record<string, unknown>>;
          // Filter by search (invoice number, contact name)
          const searchLower = searchText.toLowerCase();
          entities = allInvoices.filter(inv =>
            (inv.invoice_number as string || '').toLowerCase().includes(searchLower) ||
            (inv.contact_name as string || '').toLowerCase().includes(searchLower)
          ).slice(0, 10);
          break;
        }
        default:
          return { status: 'error', error: `Unknown entity type: ${entityType}` };
      }

      // Check results
      if (entities.length === 0) {
        return { status: 'none' };
      }

      if (entities.length === 1) {
        const entity = entities[0];
        return {
          status: 'exact',
          entity: {
            id: entity.id as string,
            type: entityType,
            data: entity,
            displayName: this.getDisplayName(entityType, entity)
          }
        };
      }

      // Multiple matches - return choices
      return {
        status: 'multiple',
        choices: entities.map(entity => ({
          id: entity.id as string,
          label: this.getDisplayName(entityType, entity),
          entity
        }))
      };
    } catch (error) {
      logger.error({ err: error, entityType, searchText }, 'Failed to resolve entity by search');
      return { status: 'error', error: 'Failed to search entities' };
    }
  }

  /**
   * Get display name for an entity
   */
  private getDisplayName(entityType: string, entity: Record<string, unknown>): string {
    switch (entityType) {
      case 'contacts':
        return `${entity.first_name || ''} ${entity.last_name || ''}`.trim() || (entity.email as string) || 'Contact';
      case 'tasks':
        return (entity.title as string) || 'Task';
      case 'services':
        return (entity.service_name as string) || 'Service';
      case 'bookings': {
        const date = new Date(entity.start_time as string).toLocaleDateString();
        const clientName = `${entity.client_first_name || ''} ${entity.client_last_name || ''}`.trim();
        return `${entity.service_name || 'Booking'} with ${clientName} on ${date}`;
      }
      case 'invoices':
        return `Invoice #${entity.invoice_number || entity.id}`;
      default:
        return entity.id as string;
    }
  }
}
```

---

## Phase 6: Capability Engine

**Goal**: Execute capabilities deterministically after all parameters are resolved.

### 6.1 Engine Implementation

**File**: `lib/business-os/chat/CapabilityEngine.ts`

```typescript
import { Capability, getCapability } from './CapabilityRegistry';
import { CommandSession } from '@/lib/repositories/CommandSessionRepository';
import { crmContactRepository } from '@/lib/repositories/CRMContactRepository';
import { crmTaskRepository } from '@/lib/repositories/CRMTaskRepository';
import { schedulingServiceRepository, schedulingBookingRepository } from '@/lib/repositories/SchedulingRepository';
import { paymentInvoiceRepository } from '@/lib/repositories/PaymentRepository';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ service: 'CapabilityEngine' });
const auditTrail = AuditTrailService.getInstance();

export interface ExecutionResult {
  success: boolean;
  data?: unknown;
  error?: string;
  message?: string;
  message_he?: string;
}

export class CapabilityEngine {
  constructor(private userId: string) {}

  /**
   * Execute a capability with resolved parameters
   */
  async execute(
    session: CommandSession
  ): Promise<ExecutionResult> {
    const capability = getCapability(session.capability_id);
    if (!capability) {
      return { success: false, error: `Unknown capability: ${session.capability_id}` };
    }

    logger.info(
      { userId: this.userId, capability: session.capability_id, params: session.resolved_params },
      'Executing capability'
    );

    try {
      const result = await this.executeCapability(capability, session.resolved_params);

      // Audit logging (non-blocking)
      auditTrail.log({
        action: `CAPABILITY_${capability.action.toUpperCase()}`,
        entityType: capability.entity,
        entityId: result.data?.id || session.resolved_params.id as string,
        userId: this.userId,
        resourceName: capability.id,
        metadata: { params: session.resolved_params }
      }).catch(err => logger.error({ err }, 'Audit failed'));

      // Generate success message from template
      if (result.success && capability.successTemplate) {
        result.message = this.interpolateTemplate(
          capability.successTemplate,
          session.resolved_params
        );
        if (capability.successTemplate_he) {
          result.message_he = this.interpolateTemplate(
            capability.successTemplate_he,
            session.resolved_params
          );
        }
      }

      return result;
    } catch (error) {
      logger.error({ err: error, capability: session.capability_id }, 'Capability execution failed');
      return { success: false, error: 'Execution failed' };
    }
  }

  /**
   * Route to specific executor based on capability
   */
  private async executeCapability(
    capability: Capability,
    params: Record<string, unknown>
  ): Promise<ExecutionResult> {
    const [entity, action] = capability.id.split('.');

    switch (`${entity}.${action}`) {
      // ============== CONTACTS ==============
      case 'contact.create':
        return this.createContact(params);
      case 'contact.update':
        return this.updateContact(params);
      case 'contact.delete':
        return this.deleteContact(params);

      // ============== TASKS ==============
      case 'task.create':
        return this.createTask(params);
      case 'task.complete':
        return this.completeTask(params);
      case 'task.update':
        return this.updateTask(params);

      // ============== SERVICES ==============
      case 'service.create':
        return this.createService(params);
      case 'service.update':
        return this.updateService(params);
      case 'service.deactivate':
        return this.deactivateService(params);
      case 'service.activate':
        return this.activateService(params);

      // ============== BOOKINGS ==============
      case 'booking.create':
        return this.createBooking(params);
      case 'booking.reschedule':
        return this.rescheduleBooking(params);
      case 'booking.cancel':
        return this.cancelBooking(params);

      // ============== INVOICES ==============
      case 'invoice.create':
        return this.createInvoice(params);
      case 'invoice.send':
        return this.sendInvoice(params);

      default:
        return { success: false, error: `Unimplemented capability: ${capability.id}` };
    }
  }

  // ============== CONTACT EXECUTORS ==============
  private async createContact(params: Record<string, unknown>): Promise<ExecutionResult> {
    const result = await crmContactRepository.create({
      user_id: this.userId,
      first_name: params.first_name as string,
      last_name: params.last_name as string || null,
      email: params.email as string || null,
      phone: params.phone as string || null,
      stage: 'lead',
      tags: [],
      source: 'chat'
    });

    if (result.error) {
      return { success: false, error: result.error.message };
    }

    return { success: true, data: result.data };
  }

  private async updateContact(params: Record<string, unknown>): Promise<ExecutionResult> {
    const contactId = params.contact_id as string;
    const updates: Record<string, unknown> = {};

    if (params.first_name) updates.first_name = params.first_name;
    if (params.last_name) updates.last_name = params.last_name;
    if (params.email) updates.email = params.email;
    if (params.phone) updates.phone = params.phone;

    const result = await crmContactRepository.update(contactId, this.userId, updates);

    if (result.error) {
      return { success: false, error: result.error.message };
    }

    return { success: true, data: result.data };
  }

  private async deleteContact(params: Record<string, unknown>): Promise<ExecutionResult> {
    const contactId = params.contact_id as string;
    const result = await crmContactRepository.delete(contactId, this.userId);

    if (result.error) {
      return { success: false, error: result.error.message };
    }

    return { success: true };
  }

  // ============== TASK EXECUTORS ==============
  private async createTask(params: Record<string, unknown>): Promise<ExecutionResult> {
    const result = await crmTaskRepository.create({
      user_id: this.userId,
      title: params.title as string,
      due_date: params.due_date as string || null,
      priority: (params.priority as string) || 'medium',
      status: 'pending',
      contact_id: params.contact_id as string || null
    });

    if (result.error) {
      return { success: false, error: result.error.message };
    }

    return { success: true, data: result.data };
  }

  private async completeTask(params: Record<string, unknown>): Promise<ExecutionResult> {
    const taskId = params.task_id as string;
    const result = await crmTaskRepository.update(taskId, this.userId, { status: 'completed' });

    if (result.error) {
      return { success: false, error: result.error.message };
    }

    return { success: true, data: result.data };
  }

  private async updateTask(params: Record<string, unknown>): Promise<ExecutionResult> {
    const taskId = params.task_id as string;
    const updates: Record<string, unknown> = {};

    if (params.title) updates.title = params.title;
    if (params.due_date) updates.due_date = params.due_date;
    if (params.priority) updates.priority = params.priority;
    if (params.status) updates.status = params.status;

    const result = await crmTaskRepository.update(taskId, this.userId, updates);

    if (result.error) {
      return { success: false, error: result.error.message };
    }

    return { success: true, data: result.data };
  }

  // ============== SERVICE EXECUTORS ==============
  private async createService(params: Record<string, unknown>): Promise<ExecutionResult> {
    const result = await schedulingServiceRepository.create(this.userId, {
      service_name: params.service_name as string,
      duration_minutes: params.duration_minutes as number,
      price: params.price as number || null,
      is_active: true
    });

    if (result.error) {
      return { success: false, error: result.error.message };
    }

    return { success: true, data: result.data };
  }

  private async updateService(params: Record<string, unknown>): Promise<ExecutionResult> {
    const serviceId = params.service_id as string;
    const updates: Record<string, unknown> = {};

    if (params.service_name) updates.service_name = params.service_name;
    if (params.duration_minutes) updates.duration_minutes = params.duration_minutes;
    if (params.price !== undefined) updates.price = params.price;

    const result = await schedulingServiceRepository.update(serviceId, this.userId, updates);

    if (result.error) {
      return { success: false, error: result.error.message };
    }

    return { success: true, data: result.data };
  }

  private async deactivateService(params: Record<string, unknown>): Promise<ExecutionResult> {
    const serviceId = params.service_id as string;
    const result = await schedulingServiceRepository.update(serviceId, this.userId, { is_active: false });

    if (result.error) {
      return { success: false, error: result.error.message };
    }

    return { success: true, data: result.data };
  }

  private async activateService(params: Record<string, unknown>): Promise<ExecutionResult> {
    const serviceId = params.service_id as string;
    const result = await schedulingServiceRepository.update(serviceId, this.userId, { is_active: true });

    if (result.error) {
      return { success: false, error: result.error.message };
    }

    return { success: true, data: result.data };
  }

  // ============== BOOKING EXECUTORS ==============
  private async createBooking(params: Record<string, unknown>): Promise<ExecutionResult> {
    // Get service to calculate end time
    const serviceResult = await schedulingServiceRepository.findById(
      params.service_id as string,
      this.userId
    );

    if (serviceResult.error || !serviceResult.data) {
      return { success: false, error: 'Service not found' };
    }

    const service = serviceResult.data;
    const startTime = new Date(params.start_time as string);
    const endTime = new Date(startTime.getTime() + service.duration_minutes * 60 * 1000);

    // Get contact info
    const contactResult = await crmContactRepository.findById(
      params.contact_id as string,
      this.userId
    );

    if (contactResult.error || !contactResult.data) {
      return { success: false, error: 'Contact not found' };
    }

    const contact = contactResult.data;

    const result = await schedulingBookingRepository.create(this.userId, {
      service_id: params.service_id as string,
      contact_id: params.contact_id as string,
      start_time: startTime.toISOString(),
      end_time: endTime.toISOString(),
      client_first_name: contact.first_name,
      client_last_name: contact.last_name || '',
      client_email: contact.email || '',
      client_phone: contact.phone || '',
      status: 'confirmed'
    });

    if (result.error) {
      return { success: false, error: result.error.message };
    }

    return { success: true, data: result.data };
  }

  private async rescheduleBooking(params: Record<string, unknown>): Promise<ExecutionResult> {
    const bookingId = params.booking_id as string;
    const newStartTime = new Date(params.new_start_time as string);

    // Get existing booking to calculate new end time
    const bookingResult = await schedulingBookingRepository.getById(bookingId, this.userId);
    if (bookingResult.error || !bookingResult.data) {
      return { success: false, error: 'Booking not found' };
    }

    const booking = bookingResult.data;
    const duration = new Date(booking.end_time).getTime() - new Date(booking.start_time).getTime();
    const newEndTime = new Date(newStartTime.getTime() + duration);

    // TODO: Check for conflicts

    const result = await schedulingBookingRepository.update(bookingId, this.userId, {
      start_time: newStartTime.toISOString(),
      end_time: newEndTime.toISOString()
    });

    if (result.error) {
      return { success: false, error: result.error.message };
    }

    return { success: true, data: result.data };
  }

  private async cancelBooking(params: Record<string, unknown>): Promise<ExecutionResult> {
    const bookingId = params.booking_id as string;
    const result = await schedulingBookingRepository.update(bookingId, this.userId, {
      status: 'cancelled'
    });

    if (result.error) {
      return { success: false, error: result.error.message };
    }

    return { success: true, data: result.data };
  }

  // ============== INVOICE EXECUTORS ==============
  private async createInvoice(params: Record<string, unknown>): Promise<ExecutionResult> {
    const result = await paymentInvoiceRepository.create(this.userId, {
      contact_id: params.contact_id as string,
      amount: (params.amount as { amount: number }).amount || params.amount as number,
      currency: (params.amount as { currency?: string })?.currency || 'ILS',
      line_items: [{
        description: params.description as string,
        quantity: 1,
        unit_price: (params.amount as { amount: number }).amount || params.amount as number,
        total: (params.amount as { amount: number }).amount || params.amount as number
      }],
      due_date: params.due_date as string || null,
      status: 'draft'
    });

    if (result.error) {
      return { success: false, error: result.error.message };
    }

    return { success: true, data: result.data };
  }

  private async sendInvoice(params: Record<string, unknown>): Promise<ExecutionResult> {
    const invoiceId = params.invoice_id as string;

    // Update status to sent
    const result = await paymentInvoiceRepository.update(invoiceId, this.userId, {
      status: 'sent',
      sent_at: new Date().toISOString()
    });

    if (result.error) {
      return { success: false, error: result.error.message };
    }

    // TODO: Actually send the invoice email

    return { success: true, data: result.data };
  }

  // ============== HELPERS ==============
  private interpolateTemplate(
    template: string,
    params: Record<string, unknown>
  ): string {
    return template.replace(/\{([^}]+)\}/g, (match, path) => {
      const parts = path.split('.');
      let value: unknown = params;

      for (const part of parts) {
        if (value && typeof value === 'object') {
          value = (value as Record<string, unknown>)[part];
        } else {
          return match; // Keep original if path not found
        }
      }

      return String(value ?? match);
    });
  }
}
```

---

## Phase 7: Response Renderer

**Goal**: Generate responses from templates without LLM.

### 7.1 Response Templates

**File**: `lib/business-os/chat/ResponseRenderer.ts`

```typescript
import { Capability, CapabilityParam } from './CapabilityRegistry';
import { CommandSession } from '@/lib/repositories/CommandSessionRepository';
import { ExecutionResult } from './CapabilityEngine';

export interface ChatResponse {
  message: string;
  actions: Array<{
    type: string;
    [key: string]: unknown;
  }>;
}

export class ResponseRenderer {
  private isHebrew: boolean;

  constructor(language: 'he' | 'en' = 'en') {
    this.isHebrew = language === 'he';
  }

  /**
   * Render response for asking a parameter
   */
  askParameter(param: CapabilityParam): ChatResponse {
    const prompt = this.isHebrew && param.prompt_he
      ? param.prompt_he
      : param.prompt || `What is the ${param.name}?`;

    return {
      message: prompt,
      actions: []
    };
  }

  /**
   * Render response for showing choices
   */
  showChoices(
    choices: Array<{ id: string; label: string }>,
    prompt?: string
  ): ChatResponse {
    const defaultPrompt = this.isHebrew ? 'בחר אחת מהאפשרויות:' : 'Please select one:';

    return {
      message: prompt || defaultPrompt,
      actions: [{
        type: 'present_choices',
        prompt: prompt || defaultPrompt,
        choices: choices.map((c, i) => ({
          id: c.id,
          label: `${i + 1}. ${c.label}`
        }))
      }]
    };
  }

  /**
   * Render confirmation request
   */
  showConfirmation(
    capability: Capability,
    params: Record<string, unknown>
  ): ChatResponse {
    const template = this.isHebrew && capability.confirmationTemplate_he
      ? capability.confirmationTemplate_he
      : capability.confirmationTemplate || `Confirm ${capability.action} ${capability.entity}?`;

    const message = this.interpolate(template, params);
    const confirmLabel = this.isHebrew ? 'אישור' : 'Confirm';
    const cancelLabel = this.isHebrew ? 'ביטול' : 'Cancel';

    return {
      message,
      actions: [{
        type: 'confirmation',
        destructive: capability.destructive,
        confirmLabel,
        cancelLabel
      }]
    };
  }

  /**
   * Render success response
   */
  showSuccess(result: ExecutionResult): ChatResponse {
    const message = this.isHebrew && result.message_he
      ? result.message_he
      : result.message || (this.isHebrew ? 'בוצע בהצלחה!' : 'Done!');

    return {
      message,
      actions: result.data ? [{
        type: 'success',
        data: result.data
      }] : []
    };
  }

  /**
   * Render error response
   */
  showError(error: string): ChatResponse {
    const prefix = this.isHebrew ? 'שגיאה: ' : 'Error: ';
    return {
      message: prefix + error,
      actions: []
    };
  }

  /**
   * Render entity card
   */
  showEntityCard(
    entityType: string,
    entity: Record<string, unknown>,
    actions: Array<{ type: string; label: string; [key: string]: unknown }>
  ): ChatResponse {
    return {
      message: '',
      actions: [{
        type: 'present_entity_card',
        entityType,
        entityId: entity.id,
        entity,
        actions
      }]
    };
  }

  /**
   * Render cancelled response
   */
  showCancelled(): ChatResponse {
    const message = this.isHebrew ? 'בוטל.' : 'Cancelled.';
    return { message, actions: [] };
  }

  /**
   * Render "not found" response
   */
  showNotFound(entityType: string): ChatResponse {
    const messages: Record<string, { en: string; he: string }> = {
      contacts: { en: 'Contact not found.', he: 'איש הקשר לא נמצא.' },
      tasks: { en: 'Task not found.', he: 'המשימה לא נמצאה.' },
      services: { en: 'Service not found.', he: 'השירות לא נמצא.' },
      bookings: { en: 'Booking not found.', he: 'הפגישה לא נמצאה.' },
      invoices: { en: 'Invoice not found.', he: 'החשבונית לא נמצאה.' }
    };

    const msg = messages[entityType] || { en: 'Not found.', he: 'לא נמצא.' };
    return {
      message: this.isHebrew ? msg.he : msg.en,
      actions: []
    };
  }

  // ============== HELPERS ==============
  private interpolate(template: string, params: Record<string, unknown>): string {
    return template.replace(/\{([^}]+)\}/g, (match, path) => {
      const parts = path.split('.');
      let value: unknown = params;

      for (const part of parts) {
        if (value && typeof value === 'object') {
          value = (value as Record<string, unknown>)[part];
        } else {
          return match;
        }
      }

      return String(value ?? match);
    });
  }
}
```

---

## Phase 8: Orchestrator (Main Entry Point)

**Goal**: Tie all components together in a single orchestrator.

### 8.1 Chat Orchestrator

**File**: `lib/business-os/chat/ChatOrchestrator.ts`

```typescript
import { classifyInteraction, InteractionType } from './InteractionClassifier';
import { commandSessionRepository, CommandSession } from '@/lib/repositories/CommandSessionRepository';
import { transitionSession, SessionTransition } from './SessionStateMachine';
import { Capability, getCapability, CAPABILITY_REGISTRY, generateLLMToolSchema } from './CapabilityRegistry';
import { parseParameter } from './ParameterParsers';
import { EntityResolver, ResolutionResult } from './EntityResolver';
import { CapabilityEngine } from './CapabilityEngine';
import { ResponseRenderer, ChatResponse } from './ResponseRenderer';
import { createLogger } from '@/lib/logger';
import OpenAI from 'openai';

const logger = createLogger({ service: 'ChatOrchestrator' });

export interface ChatRequest {
  message: string;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  activeEntity?: { type: string; id: string };
}

export class ChatOrchestrator {
  private userId: string;
  private language: 'he' | 'en';
  private entityResolver: EntityResolver;
  private capabilityEngine: CapabilityEngine;
  private renderer: ResponseRenderer;
  private openai: OpenAI;

  constructor(userId: string, language: 'he' | 'en' = 'en') {
    this.userId = userId;
    this.language = language;
    this.entityResolver = new EntityResolver(userId);
    this.capabilityEngine = new CapabilityEngine(userId);
    this.renderer = new ResponseRenderer(language);
    this.openai = new OpenAI();
  }

  /**
   * Main entry point - process a user message
   */
  async processMessage(request: ChatRequest): Promise<ChatResponse> {
    const { message } = request;

    logger.info({ userId: this.userId, message }, 'Processing chat message');

    try {
      // 1. Get active session
      const sessionResult = await commandSessionRepository.getActiveSession(this.userId);
      const session = sessionResult.data;

      // 2. Classify interaction
      const pendingChoices = session?.pending_choices?.map(c => ({ id: c.id, label: c.label }));
      const classification = classifyInteraction(message, session, pendingChoices);

      logger.info({ classification, hasSession: !!session }, 'Classified interaction');

      // 3. Handle based on classification
      switch (classification.type) {
        case 'CONFIRMATION':
          return this.handleConfirmation(session!, classification.value);

        case 'CHOICE_SELECTION':
          return this.handleChoiceSelection(session!, classification.choiceId);

        case 'PARAMETER_VALUE':
          return this.handleParameterValue(session!, classification.value);

        case 'SLASH_COMMAND':
          return this.handleSlashCommand(classification.command, classification.args);

        case 'ENTITY_ID_REFERENCE':
          return this.handleEntityReference(session, classification.entityId);

        case 'NATURAL_LANGUAGE':
        default:
          return this.handleNaturalLanguage(message, request.conversationHistory || []);
      }
    } catch (error) {
      logger.error({ err: error, userId: this.userId }, 'Chat processing failed');
      return this.renderer.showError('Something went wrong. Please try again.');
    }
  }

  // ============== HANDLERS ==============

  private async handleConfirmation(
    session: CommandSession,
    value: 'confirm' | 'cancel'
  ): Promise<ChatResponse> {
    if (value === 'cancel') {
      await commandSessionRepository.terminate(session.id, this.userId, 'cancelled');
      return this.renderer.showCancelled();
    }

    // Execute the capability
    const result = await this.capabilityEngine.execute(session);

    if (result.success) {
      await commandSessionRepository.terminate(session.id, this.userId, 'completed');
      return this.renderer.showSuccess(result);
    } else {
      await commandSessionRepository.terminate(session.id, this.userId, 'failed');
      return this.renderer.showError(result.error || 'Execution failed');
    }
  }

  private async handleChoiceSelection(
    session: CommandSession,
    choiceId: string
  ): Promise<ChatResponse> {
    const choice = session.pending_choices?.find(c => c.id === choiceId);
    if (!choice) {
      return this.renderer.showError('Invalid selection');
    }

    // Apply transition
    const transition: SessionTransition = { type: 'SELECT_CHOICE', choiceId };
    const result = transitionSession(session, transition);

    // Update session
    await commandSessionRepository.update(session.id, this.userId, {
      ...result.updates,
      status: result.newStatus
    });

    // Handle next action
    if (result.action === 'show_confirmation') {
      const capability = getCapability(session.capability_id);
      if (capability) {
        const newParams = { ...session.resolved_params, ...result.updates.resolved_params };
        return this.renderer.showConfirmation(capability, newParams);
      }
    }

    if (result.action === 'ask_param' && result.nextParam) {
      const capability = getCapability(session.capability_id);
      const param = capability?.params.find(p => p.name === result.nextParam);
      if (param) {
        return this.renderer.askParameter(param);
      }
    }

    return { message: '', actions: [] };
  }

  private async handleParameterValue(
    session: CommandSession,
    value: string
  ): Promise<ChatResponse> {
    const capability = getCapability(session.capability_id);
    if (!capability) {
      return this.renderer.showError('Session error');
    }

    // Get the current pending parameter
    const paramName = session.pending_params[0];
    const param = capability.params.find(p => p.name === paramName);

    if (!param) {
      return this.renderer.showError('Parameter error');
    }

    // Handle entity_ref type - needs resolution
    if (param.type === 'entity_ref' && param.entityType) {
      const resolution = await this.entityResolver.resolve(param.entityType, value);

      if (resolution.status === 'multiple' && resolution.choices) {
        await commandSessionRepository.setChoices(session.id, this.userId, resolution.choices);
        return this.renderer.showChoices(
          resolution.choices.map(c => ({ id: c.id, label: c.label })),
          this.language === 'he' ? 'בחר:' : 'Select:'
        );
      }

      if (resolution.status === 'none') {
        return this.renderer.showNotFound(param.entityType);
      }

      if (resolution.status === 'exact' && resolution.entity) {
        // Resolved! Save the entity data
        await commandSessionRepository.resolveParameter(
          session.id,
          this.userId,
          paramName,
          resolution.entity.id
        );
        await commandSessionRepository.update(session.id, this.userId, {
          resolved_params: {
            ...session.resolved_params,
            [paramName]: resolution.entity.id,
            [`${paramName}_entity`]: resolution.entity.data
          }
        });

        return this.continueSession(session.id);
      }

      return this.renderer.showError(resolution.error || 'Resolution failed');
    }

    // Parse the parameter value
    const parsed = parseParameter(value, param.type);

    if (!parsed.success) {
      return this.renderer.showError(parsed.error || `Invalid ${param.name}`);
    }

    // Save the parameter
    await commandSessionRepository.resolveParameter(
      session.id,
      this.userId,
      paramName,
      parsed.value
    );

    return this.continueSession(session.id);
  }

  private async continueSession(sessionId: string): Promise<ChatResponse> {
    const sessionResult = await commandSessionRepository.getActiveSession(this.userId);
    const session = sessionResult.data;

    if (!session) {
      return this.renderer.showError('Session expired');
    }

    const capability = getCapability(session.capability_id);
    if (!capability) {
      return this.renderer.showError('Capability not found');
    }

    // Check if we have all required params
    if (session.pending_params.length === 0) {
      // All params collected - show confirmation or execute
      if (capability.confirmationRequired) {
        return this.renderer.showConfirmation(capability, session.resolved_params);
      } else {
        // Execute immediately
        const result = await this.capabilityEngine.execute(session);
        await commandSessionRepository.terminate(session.id, this.userId, result.success ? 'completed' : 'failed');
        return result.success
          ? this.renderer.showSuccess(result)
          : this.renderer.showError(result.error || 'Execution failed');
      }
    }

    // Ask for next param
    const nextParamName = session.pending_params[0];
    const nextParam = capability.params.find(p => p.name === nextParamName);
    if (nextParam) {
      return this.renderer.askParameter(nextParam);
    }

    return { message: '', actions: [] };
  }

  private async handleSlashCommand(command: string, args: string): Promise<ChatResponse> {
    // Map slash commands to capabilities
    const commandMap: Record<string, string> = {
      'create': 'task.create',  // /create will ask what to create
      'task': 'task.create',
      'contact': 'contact.create',
      'book': 'booking.create',
      'invoice': 'invoice.create',
      'help': 'help'
    };

    const capabilityId = commandMap[command.toLowerCase()];

    if (capabilityId === 'help') {
      return {
        message: this.language === 'he'
          ? 'פקודות זמינות:\n/task - יצירת משימה\n/contact - יצירת איש קשר\n/book - קביעת פגישה\n/invoice - יצירת חשבונית'
          : 'Available commands:\n/task - Create a task\n/contact - Create a contact\n/book - Schedule a booking\n/invoice - Create an invoice',
        actions: []
      };
    }

    if (capabilityId) {
      return this.startCapability(capabilityId, args);
    }

    return this.renderer.showError(
      this.language === 'he'
        ? `פקודה לא מוכרת: /${command}`
        : `Unknown command: /${command}`
    );
  }

  private async handleEntityReference(
    session: CommandSession | null,
    entityId: string
  ): Promise<ChatResponse> {
    // TODO: Determine entity type and show card
    return { message: `Entity ID: ${entityId}`, actions: [] };
  }

  private async handleNaturalLanguage(
    message: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }>
  ): Promise<ChatResponse> {
    // Call LLM to determine capability and extract parameters
    const systemPrompt = this.buildMinimalSystemPrompt();
    const tools = generateLLMToolSchema();

    const response = await this.openai.chat.completions.create({
      model: 'gpt-4o-mini',  // Use small model for classification
      messages: [
        { role: 'system', content: systemPrompt },
        ...history.slice(-4),  // Only last 4 messages for context
        { role: 'user', content: message }
      ],
      tools: tools as any,
      tool_choice: 'auto',
      temperature: 0
    });

    const assistantMessage = response.choices[0].message;

    // If no tool call, it's a general question - respond directly
    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      return {
        message: assistantMessage.content || '',
        actions: []
      };
    }

    // Extract capability and parameters from tool call
    const toolCall = assistantMessage.tool_calls[0];
    const capabilityId = toolCall.function.name.replace('_', '.');  // task_create → task.create
    const rawParams = JSON.parse(toolCall.function.arguments);

    return this.startCapability(capabilityId, '', rawParams);
  }

  private async startCapability(
    capabilityId: string,
    argsString: string,
    extractedParams: Record<string, unknown> = {}
  ): Promise<ChatResponse> {
    const capability = getCapability(capabilityId);
    if (!capability) {
      return this.renderer.showError(`Unknown capability: ${capabilityId}`);
    }

    // Determine which params we have and which we need
    const resolvedParams: Record<string, unknown> = {};
    const pendingParams: string[] = [];

    for (const param of capability.params) {
      const value = extractedParams[param.name];

      if (value !== undefined && value !== null && value !== '') {
        // We have this param - parse it
        if (param.type === 'entity_ref') {
          // Entity refs need async resolution - add to pending for now
          resolvedParams[`_raw_${param.name}`] = value;
          pendingParams.push(param.name);
        } else {
          const parsed = parseParameter(String(value), param.type);
          if (parsed.success) {
            resolvedParams[param.name] = parsed.value;
          } else if (param.required) {
            pendingParams.push(param.name);
          }
        }
      } else if (param.required) {
        pendingParams.push(param.name);
      }
    }

    // Create session
    const sessionResult = await commandSessionRepository.create(
      this.userId,
      capabilityId,
      resolvedParams,
      pendingParams
    );

    if (sessionResult.error || !sessionResult.data) {
      return this.renderer.showError('Failed to start command');
    }

    const session = sessionResult.data;

    // If we have entity refs to resolve, do that first
    for (const paramName of [...pendingParams]) {
      const rawValue = resolvedParams[`_raw_${paramName}`];
      if (rawValue) {
        const param = capability.params.find(p => p.name === paramName);
        if (param?.type === 'entity_ref' && param.entityType) {
          const resolution = await this.entityResolver.resolve(param.entityType, String(rawValue));

          if (resolution.status === 'exact' && resolution.entity) {
            await commandSessionRepository.resolveParameter(
              session.id,
              this.userId,
              paramName,
              resolution.entity.id
            );
          } else if (resolution.status === 'multiple' && resolution.choices) {
            await commandSessionRepository.setChoices(session.id, this.userId, resolution.choices);
            return this.renderer.showChoices(
              resolution.choices.map(c => ({ id: c.id, label: c.label }))
            );
          } else if (resolution.status === 'none') {
            return this.renderer.showNotFound(param.entityType);
          }
        }
      }
    }

    return this.continueSession(session.id);
  }

  private buildMinimalSystemPrompt(): string {
    return `You are a command classifier for a business management platform.
Your ONLY job is to:
1. Understand what the user wants to do
2. Select the appropriate capability (tool)
3. Extract any parameters mentioned

Available capabilities:
${CAPABILITY_REGISTRY.map(c => `- ${c.id}: ${c.description}`).join('\n')}

Rules:
- Always call a tool if the user wants to perform an action
- Extract as many parameters as possible from the message
- If the user is just asking a question (not performing an action), respond directly without calling a tool
- Be concise`;
  }
}
```

---

## Implementation Timeline

### Milestone 1: Foundation (Week 1)
- [ ] Database migration for `command_sessions`
- [ ] `CommandSessionRepository` implementation
- [ ] `SessionStateMachine` implementation
- [ ] Unit tests for session state transitions

### Milestone 2: Classification (Week 2)
- [ ] `InteractionClassifier` implementation
- [ ] `ParameterParsers` implementation
- [ ] Unit tests for classification and parsing
- [ ] Support for Hebrew patterns

### Milestone 3: Capability System (Week 3)
- [ ] `CapabilityRegistry` with all existing capabilities
- [ ] `EntityResolver` implementation
- [ ] `CapabilityEngine` implementation
- [ ] Integration tests for end-to-end flows

### Milestone 4: Response & Integration (Week 4)
- [ ] `ResponseRenderer` with templates
- [ ] `ChatOrchestrator` integration
- [ ] Update API route to use new orchestrator
- [ ] E2E tests for common scenarios

### Milestone 5: Migration & Cleanup (Week 5)
- [ ] Feature flag for gradual rollout
- [ ] Side-by-side comparison testing
- [ ] Deprecate old `AIDataLayerService`
- [ ] Documentation update

---

## Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| LLM calls per confirmation | 1-2 | 0 |
| LLM calls per multi-turn flow | 2-4 | 1 |
| Average response latency | ~1.5s | <500ms (deterministic) |
| Token usage per conversation | High | 50% reduction |
| Test coverage | ~40% | >80% |

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Classification errors | Fallback to LLM when confidence is low |
| Missing capabilities | Registry is extensible, add as needed |
| Breaking changes | Feature flag for gradual rollout |
| Complex edge cases | Hybrid mode: deterministic first, LLM fallback |

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-07-31 | Initial draft | Created comprehensive implementation plan |
