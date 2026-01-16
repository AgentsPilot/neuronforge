# Shadow Critic Implementation Plan

## Executive Summary

This document outlines the implementation plan for integrating OpenAI's Shadow Critic system into AgentPilot. The Shadow Critic is a post-execution analysis system that evaluates AI agent performance, identifies issues, and provides actionable feedback to improve agent quality over time.

**Goal**: Enhance AgentPilot's quality assurance by adding automated post-execution critique that identifies mistakes, suggests improvements, and provides quantitative ratings across multiple dimensions.

**Timeline**: 4 phases over 8-12 weeks
**Priority**: High - Critical for production quality assurance

---

## Table of Contents

1. [OpenAI Shadow Critic Overview](#openai-shadow-critic-overview)
2. [Current AgentPilot Architecture](#current-agentpilot-architecture)
3. [Implementation Design](#implementation-design)
4. [Database Schema](#database-schema)
5. [TypeScript Types](#typescript-types)
6. [Repository Layer](#repository-layer)
7. [Service Layer](#service-layer)
8. [Integration Points](#integration-points)
9. [UI Components](#ui-components)
10. [Implementation Phases](#implementation-phases)
11. [Success Metrics](#success-metrics)
12. [Risks and Mitigations](#risks-and-mitigations)

---

## OpenAI Shadow Critic Overview

### What is Shadow Critic?

The Shadow Critic is a meta-analysis system that evaluates AI agent executions after completion. It acts as a "second pair of eyes" that reviews the agent's work and provides structured feedback.

### Original OpenAI Prompt

```
You are a shadow critic. Your role is to analyze the assistant's execution and provide constructive feedback on mistakes, areas for improvement, and overall performance.

Review the conversation and execution logs, then provide:

1. **Critical Mistakes**: Any errors, incorrect assumptions, or problematic decisions
2. **Areas for Improvement**: Suggestions for better approaches or techniques
3. **Positive Observations**: What the assistant did well
4. **Quantitative Ratings** (1-10 scale):
   - Task Understanding: How well the assistant grasped the user's intent
   - Solution Quality: Correctness and effectiveness of the solution
   - Code Quality: If code was written, its maintainability and best practices
   - Communication: Clarity and helpfulness of explanations
   - Efficiency: Resource usage and execution speed

5. **Overall Assessment**: Summary judgment and priority of issues

Output your analysis as structured JSON matching this schema:
{
  "critical_mistakes": [{"issue": "string", "impact": "high|medium|low", "location": "string"}],
  "improvements": [{"area": "string", "suggestion": "string", "priority": "high|medium|low"}],
  "positive_observations": ["string"],
  "ratings": {
    "task_understanding": number,
    "solution_quality": number,
    "code_quality": number,
    "communication": number,
    "efficiency": number
  },
  "overall_assessment": "string",
  "execution_id": "string"
}
```

### Key Benefits

1. **Quality Assurance**: Automated detection of errors and issues
2. **Continuous Improvement**: Identify patterns in agent performance
3. **User Confidence**: Show transparency in agent evaluation
4. **Training Data**: Build dataset for fine-tuning and improvement
5. **Debugging**: Faster identification of systemic issues

---

## Current AgentPilot Architecture

### Execution Flow

```
User Request
    ↓
WorkflowPilot.executeAgent()
    ↓
[Agent Execution with AgentKit]
    ↓
ExecutionMonitor (real-time tracking)
    ↓
Database: agent_executions, execution_steps
    ↓
UniversalQualityValidator (validation)
    ↓
AgentScoreService (quality scoring)
    ↓
AgentIntensityService (complexity metrics)
    ↓
[Execution Complete]
```

### Relevant Database Tables

1. **agent_executions**: Main execution records
   - id, agent_id, user_id, status, created_at, completed_at
   - input_data, output_data, error_message
   - total_tokens, estimated_cost

2. **execution_steps**: Individual step tracking
   - id, execution_id, step_number, step_type
   - input_data, output_data, status
   - tokens_used, started_at, completed_at

3. **token_usage**: Token consumption tracking
   - id, execution_id, step_id
   - prompt_tokens, completion_tokens, total_tokens
   - model, timestamp

4. **agent_intensity_metrics**: Performance metrics
   - id, agent_id, execution_id
   - average_token_cost, quality_score
   - created_at, updated_at

### Existing Quality Systems

1. **UniversalQualityValidator** (`lib/pilot/core/quality-validation.ts`)
   - Validates output structure and completeness
   - Currently focuses on DSL structure validation
   - No post-execution analysis

2. **AgentScoreService** (`lib/services/agent-score-service.ts`)
   - Calculates quality scores based on execution metrics
   - Uses token usage, execution time, error rates
   - No LLM-based evaluation

3. **ExecutionMonitor** (`lib/pilot/core/execution-monitor.ts`)
   - Real-time tracking during execution
   - Logs steps, errors, and progress
   - No post-mortem analysis

### Repository Pattern

AgentPilot uses a repository pattern for data access:

- **AgentRepository**: Agent CRUD operations
- **ExecutionRepository**: Execution queries and token tracking
- **AgentMetricsRepository**: Performance metrics
- **ConfigRepository**: System configuration

**Integration Point**: We'll create `CritiqueRepository` following this pattern.

---

## Implementation Design

### Architecture Overview

```
[Agent Execution Completes]
           ↓
   PostExecutionHook
           ↓
  ShadowCriticService
           ↓
  [Gather Context: execution + steps + logs]
           ↓
  [Call OpenAI API with critique prompt]
           ↓
  [Parse JSON Response]
           ↓
   CritiqueRepository
           ↓
  [Save to agent_execution_critiques]
           ↓
  [Emit Event: critique.created]
           ↓
  [UI Updates + Notifications]
```

### Design Principles

1. **Asynchronous**: Critiques don't block user experience
2. **Opt-in Initially**: Feature flag to enable/disable
3. **Cost-Aware**: Track OpenAI API costs, add budgets
4. **Privacy-Conscious**: Sanitize sensitive data before sending
5. **Extensible**: Support multiple critique models (OpenAI, Anthropic, local)
6. **Actionable**: Link critiques to specific code/steps for easy fixing

---

## Database Schema

### New Table: `agent_execution_critiques`

```sql
CREATE TABLE agent_execution_critiques (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Foreign Keys
  execution_id UUID NOT NULL REFERENCES agent_executions(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Critique Content
  critical_mistakes JSONB NOT NULL DEFAULT '[]',
  improvements JSONB NOT NULL DEFAULT '[]',
  positive_observations TEXT[] DEFAULT '{}',

  -- Ratings (1-10 scale)
  task_understanding INTEGER CHECK (task_understanding >= 1 AND task_understanding <= 10),
  solution_quality INTEGER CHECK (solution_quality >= 1 AND solution_quality <= 10),
  code_quality INTEGER CHECK (code_quality >= 1 AND code_quality <= 10),
  communication INTEGER CHECK (communication >= 1 AND communication <= 10),
  efficiency INTEGER CHECK (efficiency >= 1 AND efficiency <= 10),

  -- Overall Assessment
  overall_assessment TEXT NOT NULL,
  overall_score DECIMAL(3,2) CHECK (overall_score >= 1.0 AND overall_score <= 10.0),

  -- Metadata
  model_used VARCHAR(100) NOT NULL, -- e.g., "gpt-4-turbo-preview"
  tokens_used INTEGER,
  critique_cost DECIMAL(10,6),
  critique_duration_ms INTEGER,

  -- Status
  status VARCHAR(50) DEFAULT 'completed', -- pending, completed, failed
  error_message TEXT,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Indexes
  CONSTRAINT fk_execution FOREIGN KEY (execution_id) REFERENCES agent_executions(id),
  CONSTRAINT fk_agent FOREIGN KEY (agent_id) REFERENCES agents(id),
  CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES auth.users(id)
);

-- Indexes for performance
CREATE INDEX idx_critiques_execution_id ON agent_execution_critiques(execution_id);
CREATE INDEX idx_critiques_agent_id ON agent_execution_critiques(agent_id);
CREATE INDEX idx_critiques_user_id ON agent_execution_critiques(user_id);
CREATE INDEX idx_critiques_created_at ON agent_execution_critiques(created_at DESC);
CREATE INDEX idx_critiques_overall_score ON agent_execution_critiques(overall_score);

-- Trigger for updated_at
CREATE TRIGGER update_agent_execution_critiques_updated_at
  BEFORE UPDATE ON agent_execution_critiques
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

### JSONB Structure

**critical_mistakes** field:
```json
[
  {
    "issue": "Used incorrect API endpoint for Slack notification",
    "impact": "high",
    "location": "step_3:line_42",
    "suggestion": "Use /api/chat.postMessage instead of /api/conversations.create"
  }
]
```

**improvements** field:
```json
[
  {
    "area": "error_handling",
    "suggestion": "Add retry logic for external API calls",
    "priority": "medium",
    "estimated_effort": "1 hour"
  }
]
```

---

## TypeScript Types

### Core Types

```typescript
// lib/repositories/types/critique.ts

export type CritiqueImpact = 'high' | 'medium' | 'low'
export type CritiquePriority = 'high' | 'medium' | 'low'
export type CritiqueStatus = 'pending' | 'completed' | 'failed'

export interface CriticalMistake {
  issue: string
  impact: CritiqueImpact
  location?: string
  suggestion?: string
}

export interface Improvement {
  area: string
  suggestion: string
  priority: CritiquePriority
  estimated_effort?: string
}

export interface CritiqueRatings {
  task_understanding: number // 1-10
  solution_quality: number    // 1-10
  code_quality: number        // 1-10
  communication: number       // 1-10
  efficiency: number          // 1-10
}

export interface AgentExecutionCritique {
  id: string
  execution_id: string
  agent_id: string
  user_id: string

  critical_mistakes: CriticalMistake[]
  improvements: Improvement[]
  positive_observations: string[]

  ratings: CritiqueRatings
  overall_assessment: string
  overall_score: number // Average of all ratings

  model_used: string
  tokens_used?: number
  critique_cost?: number
  critique_duration_ms?: number

  status: CritiqueStatus
  error_message?: string

  created_at: string
  updated_at: string
}

export interface CreateCritiqueParams {
  execution_id: string
  agent_id: string
  user_id: string
  critical_mistakes: CriticalMistake[]
  improvements: Improvement[]
  positive_observations: string[]
  ratings: CritiqueRatings
  overall_assessment: string
  model_used: string
  tokens_used?: number
  critique_cost?: number
  critique_duration_ms?: number
}

export interface CritiqueFilters {
  execution_id?: string
  agent_id?: string
  user_id?: string
  min_score?: number
  max_score?: number
  has_critical_mistakes?: boolean
  status?: CritiqueStatus
  from_date?: Date
  to_date?: Date
}

export interface CritiqueStats {
  total_critiques: number
  average_overall_score: number
  average_task_understanding: number
  average_solution_quality: number
  average_code_quality: number
  average_communication: number
  average_efficiency: number
  total_critical_mistakes: number
  total_improvements_suggested: number
}
```

### OpenAI API Types

```typescript
// lib/services/shadow-critic/types.ts

export interface ShadowCriticPromptContext {
  execution_id: string
  agent_name: string
  user_input: string
  agent_output: string
  execution_steps: ExecutionStepContext[]
  execution_logs: string[]
  token_usage: {
    total_tokens: number
    prompt_tokens: number
    completion_tokens: number
  }
  execution_time_ms: number
  error_occurred: boolean
  error_message?: string
}

export interface ExecutionStepContext {
  step_number: number
  step_type: string
  input_data: any
  output_data: any
  status: string
  tokens_used?: number
}

export interface ShadowCriticResponse {
  critical_mistakes: CriticalMistake[]
  improvements: Improvement[]
  positive_observations: string[]
  ratings: CritiqueRatings
  overall_assessment: string
  execution_id: string
}
```

---

## Repository Layer

### CritiqueRepository

```typescript
// lib/repositories/critique-repository.ts

import { Database } from '@/types/supabase'
import { SupabaseClient } from '@supabase/supabase-js'
import pino from 'pino'
import {
  AgentExecutionCritique,
  CreateCritiqueParams,
  CritiqueFilters,
  CritiqueStats,
  CritiqueRepositoryResult
} from './types/critique'

export class CritiqueRepository {
  private logger: pino.Logger

  constructor(
    private supabase: SupabaseClient<Database>,
    logger?: pino.Logger
  ) {
    this.logger = (logger || pino()).child({ repository: 'CritiqueRepository' })
  }

  /**
   * Create a new critique for an execution
   */
  async create(params: CreateCritiqueParams): Promise<CritiqueRepositoryResult<AgentExecutionCritique>> {
    const methodLogger = this.logger.child({ method: 'create', execution_id: params.execution_id })
    const startTime = Date.now()

    try {
      methodLogger.info('Creating critique')

      const overall_score = this.calculateOverallScore(params.ratings)

      const { data, error } = await this.supabase
        .from('agent_execution_critiques')
        .insert({
          execution_id: params.execution_id,
          agent_id: params.agent_id,
          user_id: params.user_id,
          critical_mistakes: params.critical_mistakes,
          improvements: params.improvements,
          positive_observations: params.positive_observations,
          task_understanding: params.ratings.task_understanding,
          solution_quality: params.ratings.solution_quality,
          code_quality: params.ratings.code_quality,
          communication: params.ratings.communication,
          efficiency: params.ratings.efficiency,
          overall_assessment: params.overall_assessment,
          overall_score,
          model_used: params.model_used,
          tokens_used: params.tokens_used,
          critique_cost: params.critique_cost,
          critique_duration_ms: params.critique_duration_ms,
          status: 'completed'
        })
        .select()
        .single()

      if (error) {
        methodLogger.error({ error }, 'Failed to create critique')
        return { success: false, error: error.message }
      }

      const duration = Date.now() - startTime
      methodLogger.info({ critique_id: data.id, duration }, 'Critique created successfully')

      return { success: true, data: this.mapToCritique(data) }
    } catch (error) {
      methodLogger.error({ error }, 'Unexpected error creating critique')
      return { success: false, error: String(error) }
    }
  }

  /**
   * Get critique by ID
   */
  async getById(id: string): Promise<CritiqueRepositoryResult<AgentExecutionCritique>> {
    const methodLogger = this.logger.child({ method: 'getById', critique_id: id })

    try {
      const { data, error } = await this.supabase
        .from('agent_execution_critiques')
        .select('*')
        .eq('id', id)
        .single()

      if (error) {
        methodLogger.error({ error }, 'Failed to fetch critique')
        return { success: false, error: error.message }
      }

      if (!data) {
        return { success: false, error: 'Critique not found' }
      }

      return { success: true, data: this.mapToCritique(data) }
    } catch (error) {
      methodLogger.error({ error }, 'Unexpected error fetching critique')
      return { success: false, error: String(error) }
    }
  }

  /**
   * Get critique for a specific execution
   */
  async getByExecutionId(execution_id: string): Promise<CritiqueRepositoryResult<AgentExecutionCritique>> {
    const methodLogger = this.logger.child({ method: 'getByExecutionId', execution_id })

    try {
      const { data, error } = await this.supabase
        .from('agent_execution_critiques')
        .select('*')
        .eq('execution_id', execution_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

      if (error) {
        if (error.code === 'PGRST116') {
          // No rows returned
          return { success: false, error: 'No critique found for this execution' }
        }
        methodLogger.error({ error }, 'Failed to fetch critique by execution')
        return { success: false, error: error.message }
      }

      return { success: true, data: this.mapToCritique(data) }
    } catch (error) {
      methodLogger.error({ error }, 'Unexpected error fetching critique by execution')
      return { success: false, error: String(error) }
    }
  }

  /**
   * List critiques with filters
   */
  async list(filters?: CritiqueFilters, limit = 50, offset = 0): Promise<CritiqueRepositoryResult<AgentExecutionCritique[]>> {
    const methodLogger = this.logger.child({ method: 'list', filters })

    try {
      let query = this.supabase
        .from('agent_execution_critiques')
        .select('*')

      if (filters?.execution_id) {
        query = query.eq('execution_id', filters.execution_id)
      }
      if (filters?.agent_id) {
        query = query.eq('agent_id', filters.agent_id)
      }
      if (filters?.user_id) {
        query = query.eq('user_id', filters.user_id)
      }
      if (filters?.status) {
        query = query.eq('status', filters.status)
      }
      if (filters?.min_score !== undefined) {
        query = query.gte('overall_score', filters.min_score)
      }
      if (filters?.max_score !== undefined) {
        query = query.lte('overall_score', filters.max_score)
      }
      if (filters?.from_date) {
        query = query.gte('created_at', filters.from_date.toISOString())
      }
      if (filters?.to_date) {
        query = query.lte('created_at', filters.to_date.toISOString())
      }

      const { data, error } = await query
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)

      if (error) {
        methodLogger.error({ error }, 'Failed to list critiques')
        return { success: false, error: error.message }
      }

      return { success: true, data: data.map(d => this.mapToCritique(d)) }
    } catch (error) {
      methodLogger.error({ error }, 'Unexpected error listing critiques')
      return { success: false, error: String(error) }
    }
  }

  /**
   * Get critique statistics for an agent
   */
  async getAgentStats(agent_id: string): Promise<CritiqueRepositoryResult<CritiqueStats>> {
    const methodLogger = this.logger.child({ method: 'getAgentStats', agent_id })

    try {
      const { data, error } = await this.supabase
        .rpc('get_agent_critique_stats', { p_agent_id: agent_id })

      if (error) {
        methodLogger.error({ error }, 'Failed to fetch agent critique stats')
        return { success: false, error: error.message }
      }

      return { success: true, data: data as CritiqueStats }
    } catch (error) {
      methodLogger.error({ error }, 'Unexpected error fetching agent critique stats')
      return { success: false, error: String(error) }
    }
  }

  /**
   * Delete a critique
   */
  async delete(id: string): Promise<CritiqueRepositoryResult<void>> {
    const methodLogger = this.logger.child({ method: 'delete', critique_id: id })

    try {
      const { error } = await this.supabase
        .from('agent_execution_critiques')
        .delete()
        .eq('id', id)

      if (error) {
        methodLogger.error({ error }, 'Failed to delete critique')
        return { success: false, error: error.message }
      }

      methodLogger.info('Critique deleted successfully')
      return { success: true, data: undefined }
    } catch (error) {
      methodLogger.error({ error }, 'Unexpected error deleting critique')
      return { success: false, error: String(error) }
    }
  }

  // Private helper methods

  private calculateOverallScore(ratings: CritiqueRatings): number {
    const sum =
      ratings.task_understanding +
      ratings.solution_quality +
      ratings.code_quality +
      ratings.communication +
      ratings.efficiency
    return Number((sum / 5).toFixed(2))
  }

  private mapToCritique(row: any): AgentExecutionCritique {
    return {
      id: row.id,
      execution_id: row.execution_id,
      agent_id: row.agent_id,
      user_id: row.user_id,
      critical_mistakes: row.critical_mistakes || [],
      improvements: row.improvements || [],
      positive_observations: row.positive_observations || [],
      ratings: {
        task_understanding: row.task_understanding,
        solution_quality: row.solution_quality,
        code_quality: row.code_quality,
        communication: row.communication,
        efficiency: row.efficiency
      },
      overall_assessment: row.overall_assessment,
      overall_score: row.overall_score,
      model_used: row.model_used,
      tokens_used: row.tokens_used,
      critique_cost: row.critique_cost,
      critique_duration_ms: row.critique_duration_ms,
      status: row.status,
      error_message: row.error_message,
      created_at: row.created_at,
      updated_at: row.updated_at
    }
  }
}

export type { CritiqueRepositoryResult }
```

---

## Service Layer

### ShadowCriticService

```typescript
// lib/services/shadow-critic/shadow-critic-service.ts

import { OpenAI } from 'openai'
import pino from 'pino'
import { CritiqueRepository } from '@/lib/repositories/critique-repository'
import { ExecutionRepository } from '@/lib/repositories/execution-repository'
import {
  ShadowCriticPromptContext,
  ShadowCriticResponse
} from './types'
import { CreateCritiqueParams } from '@/lib/repositories/types/critique'

export class ShadowCriticService {
  private openai: OpenAI
  private logger: pino.Logger
  private critiqueRepository: CritiqueRepository
  private executionRepository: ExecutionRepository

  constructor(
    critiqueRepository: CritiqueRepository,
    executionRepository: ExecutionRepository,
    logger?: pino.Logger
  ) {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    })
    this.logger = (logger || pino()).child({ service: 'ShadowCriticService' })
    this.critiqueRepository = critiqueRepository
    this.executionRepository = executionRepository
  }

  /**
   * Generate a critique for a completed execution
   */
  async generateCritique(execution_id: string): Promise<{ success: boolean; error?: string; critique_id?: string }> {
    const methodLogger = this.logger.child({ method: 'generateCritique', execution_id })
    const startTime = Date.now()

    try {
      methodLogger.info('Starting critique generation')

      // 1. Fetch execution details
      const executionResult = await this.executionRepository.getById(execution_id)
      if (!executionResult.success || !executionResult.data) {
        methodLogger.error('Failed to fetch execution')
        return { success: false, error: 'Execution not found' }
      }

      const execution = executionResult.data

      // 2. Check if critique already exists
      const existingCritique = await this.critiqueRepository.getByExecutionId(execution_id)
      if (existingCritique.success) {
        methodLogger.info('Critique already exists, skipping')
        return { success: true, critique_id: existingCritique.data?.id }
      }

      // 3. Gather execution context
      const context = await this.gatherExecutionContext(execution)

      // 4. Call OpenAI to generate critique
      const critiqueResponse = await this.callOpenAICritic(context)

      // 5. Save critique to database
      const critiqueParams: CreateCritiqueParams = {
        execution_id: execution.id,
        agent_id: execution.agent_id,
        user_id: execution.user_id,
        critical_mistakes: critiqueResponse.critical_mistakes,
        improvements: critiqueResponse.improvements,
        positive_observations: critiqueResponse.positive_observations,
        ratings: critiqueResponse.ratings,
        overall_assessment: critiqueResponse.overall_assessment,
        model_used: 'gpt-4-turbo-preview',
        tokens_used: undefined, // Will be populated from OpenAI response
        critique_cost: undefined,
        critique_duration_ms: Date.now() - startTime
      }

      const createResult = await this.critiqueRepository.create(critiqueParams)
      if (!createResult.success) {
        methodLogger.error({ error: createResult.error }, 'Failed to save critique')
        return { success: false, error: createResult.error }
      }

      const duration = Date.now() - startTime
      methodLogger.info({ critique_id: createResult.data?.id, duration }, 'Critique generated successfully')

      return { success: true, critique_id: createResult.data?.id }
    } catch (error) {
      methodLogger.error({ error }, 'Unexpected error generating critique')
      return { success: false, error: String(error) }
    }
  }

  /**
   * Gather full context for critique generation
   */
  private async gatherExecutionContext(execution: any): Promise<ShadowCriticPromptContext> {
    const methodLogger = this.logger.child({ method: 'gatherExecutionContext', execution_id: execution.id })

    try {
      // Fetch execution steps
      const stepsResult = await this.executionRepository.getExecutionSteps(execution.id)
      const steps = stepsResult.success ? stepsResult.data || [] : []

      // Fetch token usage
      const tokenResult = await this.executionRepository.getTokenUsage(execution.id)
      const tokenUsage = tokenResult.success && tokenResult.data ? tokenResult.data : {
        total_tokens: 0,
        prompt_tokens: 0,
        completion_tokens: 0
      }

      // Calculate execution time
      const execution_time_ms = execution.completed_at && execution.created_at
        ? new Date(execution.completed_at).getTime() - new Date(execution.created_at).getTime()
        : 0

      return {
        execution_id: execution.id,
        agent_name: execution.agent_id, // TODO: Fetch actual agent name
        user_input: execution.input_data || '',
        agent_output: execution.output_data || '',
        execution_steps: steps.map(step => ({
          step_number: step.step_number,
          step_type: step.step_type,
          input_data: step.input_data,
          output_data: step.output_data,
          status: step.status,
          tokens_used: step.tokens_used
        })),
        execution_logs: [], // TODO: Fetch execution logs
        token_usage: {
          total_tokens: tokenUsage.total_tokens || 0,
          prompt_tokens: tokenUsage.prompt_tokens || 0,
          completion_tokens: tokenUsage.completion_tokens || 0
        },
        execution_time_ms,
        error_occurred: execution.status === 'failed',
        error_message: execution.error_message
      }
    } catch (error) {
      methodLogger.error({ error }, 'Error gathering execution context')
      throw error
    }
  }

  /**
   * Call OpenAI to generate critique
   */
  private async callOpenAICritic(context: ShadowCriticPromptContext): Promise<ShadowCriticResponse> {
    const methodLogger = this.logger.child({ method: 'callOpenAICritic' })

    try {
      const systemPrompt = this.buildCriticSystemPrompt()
      const userPrompt = this.buildCriticUserPrompt(context)

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4-turbo-preview',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3,
        max_tokens: 2000
      })

      const content = response.choices[0]?.message?.content
      if (!content) {
        throw new Error('No response from OpenAI')
      }

      const critiqueData = JSON.parse(content) as ShadowCriticResponse
      methodLogger.info({ tokens: response.usage }, 'OpenAI critique generated')

      return critiqueData
    } catch (error) {
      methodLogger.error({ error }, 'Error calling OpenAI critic')
      throw error
    }
  }

  /**
   * Build system prompt for shadow critic
   */
  private buildCriticSystemPrompt(): string {
    return `You are a shadow critic. Your role is to analyze AI agent executions and provide constructive feedback on mistakes, areas for improvement, and overall performance.

Review the execution details provided, then output structured JSON analysis with:

1. **critical_mistakes**: Array of serious errors or issues
   - Each with: issue (string), impact (high/medium/low), location (optional), suggestion (optional)

2. **improvements**: Array of suggestions for enhancement
   - Each with: area (string), suggestion (string), priority (high/medium/low)

3. **positive_observations**: Array of strings highlighting what was done well

4. **ratings**: Quantitative scores on 1-10 scale
   - task_understanding: How well the agent grasped user intent
   - solution_quality: Correctness and effectiveness
   - code_quality: If code was involved, its quality
   - communication: Clarity of responses
   - efficiency: Resource usage and speed

5. **overall_assessment**: Summary judgment (2-3 sentences)

6. **execution_id**: Echo back the execution ID

Be objective, constructive, and specific in your feedback.`
  }

  /**
   * Build user prompt with execution context
   */
  private buildCriticUserPrompt(context: ShadowCriticPromptContext): string {
    return `Analyze this AI agent execution:

**Execution ID**: ${context.execution_id}
**Agent**: ${context.agent_name}
**Status**: ${context.error_occurred ? 'FAILED' : 'COMPLETED'}
${context.error_message ? `**Error**: ${context.error_message}` : ''}

**User Request**:
${context.user_input}

**Agent Output**:
${context.agent_output}

**Execution Steps** (${context.execution_steps.length} steps):
${context.execution_steps.map((step, i) => `
  Step ${i + 1} (${step.step_type}):
  - Input: ${JSON.stringify(step.input_data).substring(0, 200)}
  - Output: ${JSON.stringify(step.output_data).substring(0, 200)}
  - Status: ${step.status}
`).join('\n')}

**Performance Metrics**:
- Total tokens: ${context.token_usage.total_tokens}
- Execution time: ${context.execution_time_ms}ms

Please provide your critique as JSON.`
  }
}
```

---

## Integration Points

### 1. Post-Execution Hook

Add shadow critic call after successful agent execution:

```typescript
// lib/pilot/core/workflow-pilot.ts

import { ShadowCriticService } from '@/lib/services/shadow-critic/shadow-critic-service'

class WorkflowPilot {
  private shadowCriticService: ShadowCriticService

  async executeAgent(agentId: string, input: any): Promise<ExecutionResult> {
    // ... existing execution logic ...

    try {
      const result = await this.agentKit.execute(workflow)

      // Save execution to database
      const execution = await this.executionRepository.create({
        agent_id: agentId,
        user_id: userId,
        input_data: input,
        output_data: result.output,
        status: result.success ? 'completed' : 'failed'
      })

      // Trigger shadow critic asynchronously (don't block user)
      if (process.env.SHADOW_CRITIC_ENABLED === 'true') {
        this.triggerShadowCritic(execution.data.id)
      }

      return result
    } catch (error) {
      // ... error handling ...
    }
  }

  private async triggerShadowCritic(execution_id: string): Promise<void> {
    try {
      // Run in background, don't await
      this.shadowCriticService.generateCritique(execution_id)
        .then(result => {
          if (!result.success) {
            this.logger.warn({ execution_id, error: result.error }, 'Shadow critic failed')
          }
        })
        .catch(error => {
          this.logger.error({ execution_id, error }, 'Shadow critic error')
        })
    } catch (error) {
      // Swallow errors - shadow critic is non-critical
      this.logger.error({ error }, 'Failed to trigger shadow critic')
    }
  }
}
```

### 2. API Endpoints

Create REST API for critique access:

```typescript
// app/api/v2/critiques/[execution_id]/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { createAuthenticatedServerClient } from '@/lib/supabaseServerAuth'
import { CritiqueRepository } from '@/lib/repositories/critique-repository'
import { clientLogger } from '@/lib/logging/client-logger'

export async function GET(
  request: NextRequest,
  { params }: { params: { execution_id: string } }
) {
  try {
    const supabase = await createAuthenticatedServerClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const repository = new CritiqueRepository(supabase, clientLogger)
    const result = await repository.getByExecutionId(params.execution_id)

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 404 })
    }

    return NextResponse.json(result.data)
  } catch (error) {
    clientLogger.error({ error }, 'Failed to fetch critique')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

```typescript
// app/api/v2/agents/[agent_id]/critique-stats/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { createAuthenticatedServerClient } from '@/lib/supabaseServerAuth'
import { CritiqueRepository } from '@/lib/repositories/critique-repository'
import { clientLogger } from '@/lib/logging/client-logger'

export async function GET(
  request: NextRequest,
  { params }: { params: { agent_id: string } }
) {
  try {
    const supabase = await createAuthenticatedServerClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const repository = new CritiqueRepository(supabase, clientLogger)
    const result = await repository.getAgentStats(params.agent_id)

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 })
    }

    return NextResponse.json(result.data)
  } catch (error) {
    clientLogger.error({ error }, 'Failed to fetch critique stats')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

### 3. Feature Flag

Add environment variable for gradual rollout:

```bash
# .env.local
SHADOW_CRITIC_ENABLED=true
SHADOW_CRITIC_MODEL=gpt-4-turbo-preview
SHADOW_CRITIC_MAX_COST_PER_CRITIQUE=0.10 # USD
```

---

## UI Components

### 1. CritiqueCard Component

Display critique summary in execution details:

```typescript
// components/v2/critique/CritiqueCard.tsx

'use client'

import { AgentExecutionCritique } from '@/lib/repositories/types/critique'
import { AlertTriangle, CheckCircle, TrendingUp, Star } from 'lucide-react'

interface CritiqueCardProps {
  critique: AgentExecutionCritique
}

export function CritiqueCard({ critique }: CritiqueCardProps) {
  return (
    <div className="bg-zinc-900 border border-white/10 rounded-lg p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">AI Quality Analysis</h3>
        <div className="flex items-center gap-2">
          <Star className="w-5 h-5 text-yellow-400" />
          <span className="text-2xl font-bold text-white">{critique.overall_score.toFixed(1)}</span>
          <span className="text-sm text-slate-400">/10</span>
        </div>
      </div>

      {/* Ratings Grid */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {Object.entries(critique.ratings).map(([key, value]) => (
          <div key={key} className="text-center">
            <div className="text-2xl font-bold text-orange-400">{value}</div>
            <div className="text-xs text-slate-400 capitalize">
              {key.replace(/_/g, ' ')}
            </div>
          </div>
        ))}
      </div>

      {/* Overall Assessment */}
      <div className="bg-zinc-800/50 rounded-lg p-4">
        <p className="text-sm text-slate-300 leading-relaxed">
          {critique.overall_assessment}
        </p>
      </div>

      {/* Critical Mistakes */}
      {critique.critical_mistakes.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-red-400">
            <AlertTriangle className="w-4 h-4" />
            <h4 className="font-semibold">Critical Issues ({critique.critical_mistakes.length})</h4>
          </div>
          <div className="space-y-2">
            {critique.critical_mistakes.map((mistake, i) => (
              <div key={i} className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                <div className="flex items-start gap-2">
                  <span className={`text-xs px-2 py-1 rounded ${
                    mistake.impact === 'high' ? 'bg-red-500 text-white' :
                    mistake.impact === 'medium' ? 'bg-orange-500 text-white' :
                    'bg-yellow-500 text-black'
                  }`}>
                    {mistake.impact}
                  </span>
                  <div className="flex-1">
                    <p className="text-sm text-white">{mistake.issue}</p>
                    {mistake.location && (
                      <p className="text-xs text-slate-400 mt-1">Location: {mistake.location}</p>
                    )}
                    {mistake.suggestion && (
                      <p className="text-xs text-green-400 mt-2">💡 {mistake.suggestion}</p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Improvements */}
      {critique.improvements.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-blue-400">
            <TrendingUp className="w-4 h-4" />
            <h4 className="font-semibold">Suggested Improvements ({critique.improvements.length})</h4>
          </div>
          <div className="space-y-2">
            {critique.improvements.slice(0, 3).map((improvement, i) => (
              <div key={i} className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
                <div className="flex items-start gap-2">
                  <span className={`text-xs px-2 py-1 rounded ${
                    improvement.priority === 'high' ? 'bg-blue-500 text-white' :
                    improvement.priority === 'medium' ? 'bg-blue-400 text-white' :
                    'bg-blue-300 text-black'
                  }`}>
                    {improvement.priority}
                  </span>
                  <div className="flex-1">
                    <p className="text-xs text-slate-400">{improvement.area}</p>
                    <p className="text-sm text-white mt-1">{improvement.suggestion}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Positive Observations */}
      {critique.positive_observations.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-green-400">
            <CheckCircle className="w-4 h-4" />
            <h4 className="font-semibold">What Went Well</h4>
          </div>
          <ul className="space-y-1">
            {critique.positive_observations.map((observation, i) => (
              <li key={i} className="text-sm text-slate-300 flex items-start gap-2">
                <span className="text-green-400 mt-1">✓</span>
                <span>{observation}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Metadata */}
      <div className="text-xs text-slate-500 pt-4 border-t border-white/5">
        Analyzed by {critique.model_used} in {critique.critique_duration_ms}ms
      </div>
    </div>
  )
}
```

### 2. AgentCritiqueStats Component

Show aggregate critique metrics for an agent:

```typescript
// components/v2/critique/AgentCritiqueStats.tsx

'use client'

import { CritiqueStats } from '@/lib/repositories/types/critique'
import { TrendingUp, AlertTriangle, Star, BarChart } from 'lucide-react'

interface AgentCritiqueStatsProps {
  stats: CritiqueStats
}

export function AgentCritiqueStats({ stats }: AgentCritiqueStatsProps) {
  return (
    <div className="bg-zinc-900 border border-white/10 rounded-lg p-6">
      <div className="flex items-center gap-2 mb-6">
        <BarChart className="w-5 h-5 text-orange-400" />
        <h3 className="text-lg font-semibold text-white">Quality Metrics</h3>
        <span className="text-sm text-slate-400">({stats.total_critiques} executions analyzed)</span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
        {/* Overall Score */}
        <div className="text-center">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Star className="w-5 h-5 text-yellow-400" />
            <span className="text-3xl font-bold text-white">
              {stats.average_overall_score.toFixed(1)}
            </span>
          </div>
          <p className="text-sm text-slate-400">Average Score</p>
        </div>

        {/* Critical Mistakes */}
        <div className="text-center">
          <div className="flex items-center justify-center gap-2 mb-2">
            <AlertTriangle className="w-5 h-5 text-red-400" />
            <span className="text-3xl font-bold text-white">
              {stats.total_critical_mistakes}
            </span>
          </div>
          <p className="text-sm text-slate-400">Critical Issues</p>
        </div>

        {/* Improvements */}
        <div className="text-center">
          <div className="flex items-center justify-center gap-2 mb-2">
            <TrendingUp className="w-5 h-5 text-blue-400" />
            <span className="text-3xl font-bold text-white">
              {stats.total_improvements_suggested}
            </span>
          </div>
          <p className="text-sm text-slate-400">Improvements</p>
        </div>
      </div>

      {/* Detailed Ratings */}
      <div className="mt-6 space-y-3">
        {[
          { label: 'Task Understanding', value: stats.average_task_understanding },
          { label: 'Solution Quality', value: stats.average_solution_quality },
          { label: 'Code Quality', value: stats.average_code_quality },
          { label: 'Communication', value: stats.average_communication },
          { label: 'Efficiency', value: stats.average_efficiency },
        ].map(metric => (
          <div key={metric.label} className="flex items-center gap-3">
            <span className="text-sm text-slate-400 w-32">{metric.label}</span>
            <div className="flex-1 bg-zinc-800 rounded-full h-2 overflow-hidden">
              <div
                className="bg-gradient-to-r from-orange-500 to-amber-500 h-full transition-all"
                style={{ width: `${(metric.value / 10) * 100}%` }}
              />
            </div>
            <span className="text-sm font-semibold text-white w-12 text-right">
              {metric.value.toFixed(1)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
```

### 3. Integration into Execution Details Page

```typescript
// app/v2/executions/[execution_id]/page.tsx

import { CritiqueCard } from '@/components/v2/critique/CritiqueCard'

export default async function ExecutionDetailPage({ params }: { params: { execution_id: string } }) {
  // ... fetch execution data ...

  // Fetch critique
  const critiqueResponse = await fetch(`/api/v2/critiques/${params.execution_id}`)
  const critique = critiqueResponse.ok ? await critiqueResponse.json() : null

  return (
    <div className="space-y-6">
      {/* Existing execution details */}
      <ExecutionSummary execution={execution} />
      <ExecutionSteps steps={steps} />

      {/* Critique section */}
      {critique && (
        <div>
          <h2 className="text-xl font-bold mb-4">Quality Analysis</h2>
          <CritiqueCard critique={critique} />
        </div>
      )}
    </div>
  )
}
```

---

## Implementation Phases

### Phase 1: Foundation (Week 1-2)
**Goal**: Set up database and repository layer

**Tasks**:
1. Create database migration for `agent_execution_critiques` table
2. Implement `CritiqueRepository` with full CRUD operations
3. Add TypeScript types for critiques
4. Write unit tests for repository layer
5. Create database function `get_agent_critique_stats`

**Deliverables**:
- Migration file: `supabase/migrations/YYYYMMDD_create_critiques_table.sql`
- Repository: `lib/repositories/critique-repository.ts`
- Types: `lib/repositories/types/critique.ts`
- Tests: `__tests__/repositories/critique-repository.test.ts`

**Success Criteria**:
- All CRUD operations working
- Tests passing with 90%+ coverage
- Database indexes optimized

### Phase 2: Service Layer (Week 3-4)
**Goal**: Implement critique generation with OpenAI

**Tasks**:
1. Create `ShadowCriticService` class
2. Implement context gathering from executions
3. Build OpenAI integration with proper prompts
4. Add error handling and retry logic
5. Implement cost tracking and budget limits
6. Write integration tests with mocked OpenAI

**Deliverables**:
- Service: `lib/services/shadow-critic/shadow-critic-service.ts`
- Types: `lib/services/shadow-critic/types.ts`
- Config: Environment variables for feature flag
- Tests: `__tests__/services/shadow-critic-service.test.ts`

**Success Criteria**:
- Critique generation works end-to-end
- Proper error handling for API failures
- Cost tracking accurate
- Service can handle 100+ critiques/day

### Phase 3: Integration (Week 5-6)
**Goal**: Integrate into execution flow

**Tasks**:
1. Add post-execution hook in `WorkflowPilot`
2. Create async job queue for critique generation
3. Implement feature flag logic
4. Create API endpoints for critique access
5. Add webhook/event system for critique completion
6. Monitor performance impact

**Deliverables**:
- Updated: `lib/pilot/core/workflow-pilot.ts`
- API routes: `app/api/v2/critiques/*`
- Queue: `lib/services/shadow-critic/critique-queue.ts`
- Monitoring dashboard for critique metrics

**Success Criteria**:
- Zero impact on execution performance
- Critiques generated within 30s of execution
- Feature flag allows easy enable/disable
- API endpoints secured and tested

### Phase 4: UI and Rollout (Week 7-8)
**Goal**: Build UI components and launch to users

**Tasks**:
1. Create `CritiqueCard` component
2. Create `AgentCritiqueStats` component
3. Integrate into execution details page
4. Add agent detail page critique section
5. Create admin dashboard for critique monitoring
6. Write user documentation
7. Soft launch to beta users
8. Gather feedback and iterate

**Deliverables**:
- Components: `components/v2/critique/*`
- Pages: Updated execution and agent detail pages
- Docs: `docs/shadow-critic-user-guide.md`
- Admin dashboard: `/v2/admin/critiques`

**Success Criteria**:
- UI renders critiques beautifully
- Users understand and value the feedback
- 80%+ positive user feedback
- No performance complaints
- Cost per critique under $0.05

---

## Success Metrics

### Technical Metrics

1. **Performance**
   - Critique generation time: < 30 seconds p95
   - Zero impact on execution latency
   - API response time: < 200ms p95

2. **Reliability**
   - Critique success rate: > 95%
   - Service uptime: > 99.5%
   - Error rate: < 1%

3. **Cost**
   - Cost per critique: < $0.05 USD
   - Monthly OpenAI budget: Track and alert
   - ROI: Value of bugs caught vs. cost

### Business Metrics

1. **Adoption**
   - % of executions with critiques: Target 80%
   - % of users viewing critiques: Target 60%
   - Feature usage growth: +20% MoM

2. **Quality Impact**
   - % reduction in reported bugs: Target 30%
   - Average agent score improvement: +1.5 points over 3 months
   - Time to identify issues: Reduce by 50%

3. **User Satisfaction**
   - User feedback score: > 4/5
   - Feature request: Track "most valuable feature" votes
   - Retention impact: Track cohort retention with/without critiques

---

## Risks and Mitigations

### Risk 1: OpenAI API Costs Spiral
**Impact**: High
**Probability**: Medium

**Mitigation**:
- Implement hard cost limits per critique ($0.10 max)
- Add daily/monthly budget caps with alerts
- Use cheaper models (GPT-3.5-turbo) for non-critical critiques
- Cache common critique patterns
- Offer user-controlled critique frequency (all, sample, manual)

### Risk 2: Critique Quality is Poor
**Impact**: High
**Probability**: Medium

**Mitigation**:
- Extensive prompt engineering and testing
- Human-in-the-loop validation for first 100 critiques
- Feedback mechanism for users to rate critiques
- Fine-tune prompts based on user feedback
- Consider fine-tuning custom model over time

### Risk 3: Performance Impact on Executions
**Impact**: High
**Probability**: Low

**Mitigation**:
- Always run critiques asynchronously
- Use job queue with rate limiting
- Monitor execution latency metrics closely
- Easy kill switch via feature flag
- Gradual rollout (5% → 25% → 50% → 100%)

### Risk 4: Privacy Concerns with Sending Data to OpenAI
**Impact**: Medium
**Probability**: Low

**Mitigation**:
- Implement data sanitization (remove PII, credentials)
- Get user consent for critique generation
- Offer opt-out mechanism
- Use OpenAI's zero-retention mode
- Document data handling in privacy policy

### Risk 5: Users Don't Find Value
**Impact**: Medium
**Probability**: Low

**Mitigation**:
- Early user research and feedback loops
- Clear value proposition in UI
- Actionable, specific feedback (not generic)
- Show before/after examples
- Highlight bugs caught and improvements made

### Risk 6: Integration Complexity
**Impact**: Low
**Probability**: Medium

**Mitigation**:
- Phased rollout with clear milestones
- Comprehensive testing at each phase
- Fallback mechanisms for failures
- Clear documentation for developers
- Dedicated Slack channel for issues

---

## Configuration

### Environment Variables

```bash
# Feature Flag
SHADOW_CRITIC_ENABLED=true

# OpenAI Configuration
OPENAI_API_KEY=sk-...
SHADOW_CRITIC_MODEL=gpt-4-turbo-preview

# Cost Controls
SHADOW_CRITIC_MAX_COST_PER_CRITIQUE=0.10
SHADOW_CRITIC_DAILY_BUDGET=10.00
SHADOW_CRITIC_MONTHLY_BUDGET=300.00

# Sampling
SHADOW_CRITIC_SAMPLE_RATE=1.0 # 1.0 = 100%, 0.1 = 10%

# Performance
SHADOW_CRITIC_TIMEOUT_MS=30000
SHADOW_CRITIC_MAX_CONCURRENT=5

# Privacy
SHADOW_CRITIC_SANITIZE_PII=true
SHADOW_CRITIC_REQUIRE_USER_CONSENT=false
```

### Database Seed Data

```sql
-- Insert default config
INSERT INTO config (key, value, description) VALUES
  ('shadow_critic_enabled', 'true', 'Enable/disable shadow critic system'),
  ('shadow_critic_sample_rate', '1.0', 'Percentage of executions to critique (0.0-1.0)'),
  ('shadow_critic_model', 'gpt-4-turbo-preview', 'OpenAI model to use for critiques');
```

---

## Testing Strategy

### Unit Tests

1. **CritiqueRepository**
   - CRUD operations
   - Filter logic
   - Stats aggregation
   - Error handling

2. **ShadowCriticService**
   - Context gathering
   - Prompt building
   - OpenAI response parsing
   - Error handling

### Integration Tests

1. **End-to-End Critique Generation**
   - Mock OpenAI API
   - Test full flow: execution → critique → save
   - Verify database state

2. **API Endpoints**
   - Authentication
   - Authorization
   - Response format
   - Error cases

### Load Tests

1. **Concurrent Critique Generation**
   - Simulate 50 concurrent critiques
   - Verify queue management
   - Monitor resource usage

2. **Database Performance**
   - Test with 10,000+ critiques
   - Verify index effectiveness
   - Query performance benchmarks

### User Acceptance Testing

1. **Beta User Group**
   - 10-20 selected users
   - Survey feedback
   - Usage analytics
   - Issue tracking

---

## Future Enhancements

### Short-term (3-6 months)

1. **Multi-Model Support**
   - Add Claude (Anthropic) as alternative
   - Compare critique quality across models
   - Allow users to choose preferred model

2. **Critique Comparison**
   - Show critique evolution over time
   - Compare similar executions
   - Identify improvement trends

3. **Actionable Insights**
   - Link critiques to specific code fixes
   - Generate suggested code changes
   - One-click apply improvements

### Medium-term (6-12 months)

1. **Fine-Tuned Critique Model**
   - Train custom model on validated critiques
   - Reduce cost and improve quality
   - Domain-specific critique patterns

2. **Automated Improvement Loop**
   - Automatically retry execution with critique feedback
   - Self-healing agents
   - A/B test improvements

3. **Team Collaboration**
   - Share critiques across team
   - Comment on critiques
   - Assign action items from critiques

### Long-term (12+ months)

1. **Predictive Quality**
   - Predict execution quality before running
   - Suggest agent improvements proactively
   - Quality score forecasting

2. **Critique Marketplace**
   - Community-contributed critique templates
   - Domain-specific critique experts
   - Bounties for valuable critiques

---

## References

### External Resources

1. **OpenAI Documentation**
   - [Function Calling](https://platform.openai.com/docs/guides/function-calling)
   - [JSON Mode](https://platform.openai.com/docs/guides/text-generation/json-mode)

2. **Similar Systems**
   - [Constitutional AI (Anthropic)](https://www.anthropic.com/index/constitutional-ai-harmlessness-from-ai-feedback)
   - [Reflexion (Princeton)](https://arxiv.org/abs/2303.11366)

3. **Best Practices**
   - [Prompt Engineering Guide](https://www.promptingguide.ai/)
   - [LLM Evaluation Frameworks](https://github.com/anthropics/evals)

### Internal Resources

1. **Codebase**
   - [lib/pilot/](../../lib/pilot/) - Agent execution system
   - [lib/repositories/](../../lib/repositories/) - Repository pattern
   - [lib/services/](../../lib/services/) - Service layer

2. **Documentation**
   - [REPOSITORY_STRATEGY.md](./REPOSITORY_STRATEGY.md)
   - [SUPABASE_CLIENTS.md](./SUPABASE_CLIENTS.md)

---

## Conclusion

The Shadow Critic system will provide automated, intelligent quality assurance for all agent executions in AgentPilot. By leveraging OpenAI's language models, we can identify issues, suggest improvements, and track quality metrics over time.

This implementation plan provides a clear roadmap from database schema through UI components, with careful attention to costs, performance, and user value. The phased approach allows for iterative development and validation at each step.

**Next Steps**:
1. Review this plan with engineering team
2. Get approval on budget and timeline
3. Assign Phase 1 tasks and begin implementation
4. Schedule weekly sync meetings to track progress

**Questions or Feedback?**
Contact: [Your Name] | [email] | [Slack]

---

**Document Version**: 1.0
**Last Updated**: 2025-12-16
**Status**: Ready for Implementation
