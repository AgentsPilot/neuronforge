// lib/memory/UserMemoryService.ts
// Service for managing cross-agent user preferences and context

import { SupabaseClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { AUDIT_EVENTS } from '@/lib/audit/events';

export interface UserMemory {
  id?: string;
  user_id: string;
  memory_key: string;
  memory_value: string;
  memory_type: 'preference' | 'context' | 'pattern' | 'fact';
  importance: number;
  usage_count?: number;
  last_used_at?: string;
  source?: string;
  source_agent_id?: string;
  source_execution_id?: string;
  metadata?: Record<string, any>;
  created_at?: string;
  updated_at?: string;
}

export interface ExtractedMemory {
  memory_key: string;
  memory_value: string;
  memory_type: 'preference' | 'context' | 'pattern' | 'fact';
  importance: number;
  confidence: number; // 0-1 confidence in extraction
}

/**
 * UserMemoryService
 *
 * Manages persistent user preferences and context across all agents
 * Uses LLM to extract preferences from conversations and execution patterns
 */
export class UserMemoryService {
  private openai: OpenAI;
  private auditTrail: AuditTrailService;

  constructor(
    private supabase: SupabaseClient,
    openaiApiKey?: string
  ) {
    this.openai = new OpenAI({
      apiKey: openaiApiKey || process.env.OPENAI_API_KEY
    });
    this.auditTrail = AuditTrailService.getInstance();
  }

  /**
   * Get user memories (top N by importance)
   */
  async getUserMemories(userId: string, limit: number = 5): Promise<UserMemory[]> {
    const { data, error } = await this.supabase
      .from('user_memory')
      .select('*')
      .eq('user_id', userId)
      .order('importance', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('❌ [UserMemoryService] Error fetching user memories:', error);
      return [];
    }

    return data || [];
  }

  /**
   * Save or update a user memory
   */
  async saveMemory(memory: UserMemory): Promise<boolean> {
    try {
      // Check if memory with this key already exists
      const { data: existing } = await this.supabase
        .from('user_memory')
        .select('id, memory_value, importance')
        .eq('user_id', memory.user_id)
        .eq('memory_key', memory.memory_key)
        .single();

      if (existing) {
        // Update existing memory
        const { error } = await this.supabase
          .from('user_memory')
          .update({
            memory_value: memory.memory_value,
            importance: memory.importance,
            memory_type: memory.memory_type,
            source: memory.source,
            source_agent_id: memory.source_agent_id,
            source_execution_id: memory.source_execution_id,
            metadata: memory.metadata,
            updated_at: new Date().toISOString()
          })
          .eq('id', existing.id);

        if (error) {
          console.error('❌ [UserMemoryService] Error updating user memory:', error);
          return false;
        }

        console.log(`✅ [UserMemoryService] Updated user memory: ${memory.memory_key}`);

        // Audit log
        await this.auditTrail.log({
          action: AUDIT_EVENTS.USER_MEMORY_UPDATED,
          entityType: 'user',
          entityId: memory.user_id,
          userId: memory.user_id,
          details: {
            memory_key: memory.memory_key,
            old_value: existing.memory_value,
            new_value: memory.memory_value,
            old_importance: existing.importance,
            new_importance: memory.importance
          },
          severity: 'info'
        });
      } else {
        // Insert new memory
        const { error } = await this.supabase
          .from('user_memory')
          .insert({
            user_id: memory.user_id,
            memory_key: memory.memory_key,
            memory_value: memory.memory_value,
            memory_type: memory.memory_type,
            importance: memory.importance,
            usage_count: 0,
            source: memory.source,
            source_agent_id: memory.source_agent_id,
            source_execution_id: memory.source_execution_id,
            metadata: memory.metadata || {}
          });

        if (error) {
          console.error('❌ [UserMemoryService] Error inserting user memory:', error);
          return false;
        }

        console.log(`✅ [UserMemoryService] Created user memory: ${memory.memory_key}`);

        // Audit log
        await this.auditTrail.log({
          action: AUDIT_EVENTS.USER_MEMORY_SAVED,
          entityType: 'user',
          entityId: memory.user_id,
          userId: memory.user_id,
          details: {
            memory_key: memory.memory_key,
            memory_value: memory.memory_value,
            memory_type: memory.memory_type,
            importance: memory.importance,
            source: memory.source
          },
          severity: 'info'
        });
      }

      return true;
    } catch (error) {
      console.error('❌ [UserMemoryService] Error saving user memory:', error);
      return false;
    }
  }

  /**
   * Extract user preferences from agent input/output using LLM
   *
   * Analyzes conversation to detect:
   * - User preferences (timezone, communication style, etc.)
   * - Domain expertise and context
   * - Recurring patterns
   * - Important facts to remember
   */
  async extractMemoriesFromExecution(
    userId: string,
    agentId: string,
    executionId: string,
    agentName: string,
    userInput: string,
    agentOutput: string,
    agentDescription?: string
  ): Promise<ExtractedMemory[]> {
    try {
      console.log(`🧠 [UserMemoryService] Extracting user memories from execution ${executionId}`);

      const prompt = this.buildExtractionPrompt(
        agentName,
        agentDescription || '',
        userInput,
        agentOutput
      );

      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 500,
        response_format: { type: 'json_object' }
      });

      const responseText = completion.choices[0].message.content;
      if (!responseText) {
        console.log('⚠️ [UserMemoryService] Empty LLM response');
        return [];
      }

      const response = JSON.parse(responseText);
      const extracted: ExtractedMemory[] = response.memories || [];

      console.log(`✅ [UserMemoryService] Extracted ${extracted.length} user memories`);

      // Filter by confidence threshold (only save high-confidence memories)
      const highConfidence = extracted.filter(m => m.confidence >= 0.7);

      // Audit log: extraction completed
      if (highConfidence.length > 0) {
        await this.auditTrail.log({
          action: AUDIT_EVENTS.USER_MEMORY_EXTRACTED,
          entityType: 'user',
          entityId: userId,
          userId: userId,
          details: {
            agent_id: agentId,
            agent_name: agentName,
            execution_id: executionId,
            total_extracted: extracted.length,
            high_confidence_count: highConfidence.length,
            memories: highConfidence.map(m => ({
              key: m.memory_key,
              type: m.memory_type,
              confidence: m.confidence
            }))
          },
          severity: 'info'
        });
      }

      // Save extracted memories to database
      for (const memory of highConfidence) {
        await this.saveMemory({
          user_id: userId,
          memory_key: memory.memory_key,
          memory_value: memory.memory_value,
          memory_type: memory.memory_type,
          importance: memory.importance,
          source: 'extracted_from_conversation',
          source_agent_id: agentId,
          source_execution_id: executionId,
          metadata: {
            confidence: memory.confidence,
            extracted_at: new Date().toISOString()
          }
        });
      }

      return highConfidence;
    } catch (error) {
      console.error('❌ [UserMemoryService] Error extracting user memories:', error);
      return [];
    }
  }

  /**
   * Build LLM prompt for extracting user preferences
   */
  private buildExtractionPrompt(
    agentName: string,
    agentDescription: string,
    userInput: string,
    agentOutput: string
  ): string {
    return `You are a user preference extraction AI for NeuronForge.

Your task: Analyze this agent interaction and extract PERSISTENT user preferences/context that should be remembered across ALL future agent executions.

Agent: ${agentName}
${agentDescription ? `Description: ${agentDescription}` : ''}

User Input:
${userInput.substring(0, 1000)}

Agent Output:
${agentOutput.substring(0, 1000)}

EXTRACT USER MEMORIES (JSON only):
{
  "memories": [
    {
      "memory_key": "unique_snake_case_key",
      "memory_value": "Clear, concise description of preference/context",
      "memory_type": "preference" | "context" | "pattern" | "fact",
      "importance": 0.0-1.0,
      "confidence": 0.0-1.0
    }
  ]
}

MEMORY TYPES:
- "preference": User's explicit preferences (timezone, communication style, format preferences)
- "context": User's background/expertise (job role, industry, tech stack)
- "pattern": Recurring behaviors (runs agents daily at 9am, always uses specific plugins)
- "fact": Important facts about user (company name, project details, goals)

EXTRACTION RULES:
✅ ONLY extract PERSISTENT info (not one-time requests)
✅ ONLY extract HIGH-CONFIDENCE info (explicitly stated or strongly implied)
✅ Use descriptive memory_key (e.g., "timezone", "communication_style", "domain_expertise")
✅ memory_value should be complete sentence (e.g., "User prefers EST timezone" not "EST")
✅ importance: How critical is this for agent personalization? (0.5-1.0 for important, 0.0-0.4 for minor)
✅ confidence: How sure are you this is accurate? (>0.7 to save, <0.7 ignore)

❌ DON'T extract one-time requests (e.g., "analyze this file")
❌ DON'T extract obvious/generic info (e.g., "user uses English")
❌ DON'T extract agent-specific settings (those belong in agent config)
❌ DON'T guess - only extract what's clearly stated/implied

EXAMPLES:

Good extractions:
{
  "memories": [
    {
      "memory_key": "timezone",
      "memory_value": "User operates in EST timezone and prefers scheduling during business hours (9am-5pm EST)",
      "memory_type": "preference",
      "importance": 0.8,
      "confidence": 0.9
    },
    {
      "memory_key": "communication_style",
      "memory_value": "User prefers concise, bullet-point responses with actionable next steps",
      "memory_type": "preference",
      "importance": 0.7,
      "confidence": 0.85
    },
    {
      "memory_key": "domain_expertise",
      "memory_value": "User is a software engineer working on full-stack web applications with React and Node.js",
      "memory_type": "context",
      "importance": 0.9,
      "confidence": 0.95
    }
  ]
}

Bad extractions (DO NOT DO):
{
  "memories": [
    {
      "memory_key": "current_task",
      "memory_value": "User wants to analyze emails",
      "memory_type": "fact",
      "importance": 0.5,
      "confidence": 1.0
    }
  ]
}
^ This is BAD because it's a one-time request, not a persistent preference.

If NO persistent preferences found, return empty array:
{
  "memories": []
}

Response (JSON only):`;
  }

  /**
   * Increment usage count and update last_used_at when memory is injected
   */
  async recordMemoryUsage(memoryId: string): Promise<void> {
    try {
      const { error } = await this.supabase
        .from('user_memory')
        .update({
          usage_count: this.supabase.rpc('increment', { row_id: memoryId }),
          last_used_at: new Date().toISOString()
        })
        .eq('id', memoryId);

      if (error) {
        console.error('❌ [UserMemoryService] Error recording memory usage:', error);
      }
    } catch (error) {
      console.error('❌ [UserMemoryService] Error recording memory usage:', error);
    }
  }

  /**
   * Delete a user memory
   */
  async deleteMemory(userId: string, memoryId: string): Promise<boolean> {
    try {
      const { error } = await this.supabase
        .from('user_memory')
        .delete()
        .eq('id', memoryId)
        .eq('user_id', userId);

      if (error) {
        console.error('❌ [UserMemoryService] Error deleting user memory:', error);
        return false;
      }

      // Audit log
      await this.auditTrail.log({
        action: AUDIT_EVENTS.MEMORY_DELETED,
        entityType: 'user',
        entityId: userId,
        userId: userId,
        details: {
          memory_id: memoryId
        },
        severity: 'info'
      });

      console.log(`✅ [UserMemoryService] Deleted user memory: ${memoryId}`);
      return true;
    } catch (error) {
      console.error('❌ [UserMemoryService] Error deleting user memory:', error);
      return false;
    }
  }
}
