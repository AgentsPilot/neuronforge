/**
 * Hard Requirements Extractor (LLM-Based)
 *
 * Following OpenAI's compiler approach: Extract machine-checkable constraints
 * from Enhanced Prompt that MUST be enforced through the pipeline.
 *
 * Uses GPT-4o-mini for reliable extraction from natural language.
 * Pattern matching is too brittle for the variety of user phrasings.
 *
 * Principle: Workflow creation is COMPILATION, not generation.
 * Every transformation must be: Lossless, Traceable, Constraint-preserving, Rejectable
 */
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { join } from 'path';
/**
 * Hard Requirements Extractor
 *
 * Extracts machine-checkable constraints from Enhanced Prompt using LLM.
 * LLM-based extraction is necessary to handle natural language variations.
 */
export class HardRequirementsExtractor {
    constructor(config = {}) {
        // Set defaults
        this.config = {
            provider: config.provider || 'openai',
            model: config.model || 'gpt-4o-mini',
            temperature: config.temperature ?? 0.0
        };
        // Initialize LLM client based on provider
        if (this.config.provider === 'openai') {
            this.openai = new OpenAI({
                apiKey: process.env.OPENAI_API_KEY
            });
        }
        else {
            this.anthropic = new Anthropic({
                apiKey: process.env.ANTHROPIC_API_KEY
            });
        }
        // Load system prompt from file
        // Use process.cwd() instead of __dirname for Next.js compatibility
        const promptPath = join(process.cwd(), 'lib', 'agentkit', 'v6', 'requirements', 'prompts', 'hard-requirements-extraction-system.md');
        this.systemPrompt = readFileSync(promptPath, 'utf-8');
    }
    /**
     * Extract hard requirements from Enhanced Prompt using LLM
     */
    async extract(enhancedPrompt) {
        console.log(`[HardRequirementsExtractor] Starting LLM-based extraction (${this.config.provider}/${this.config.model})...`);
        try {
            let content = null;
            if (this.config.provider === 'openai' && this.openai) {
                // Call OpenAI with structured output
                const response = await this.openai.chat.completions.create({
                    model: this.config.model,
                    temperature: this.config.temperature,
                    response_format: { type: 'json_object' },
                    messages: [
                        {
                            role: 'system',
                            content: this.systemPrompt
                        },
                        {
                            role: 'user',
                            content: JSON.stringify(enhancedPrompt, null, 2)
                        }
                    ]
                });
                content = response.choices[0].message.content;
            }
            else if (this.config.provider === 'anthropic' && this.anthropic) {
                // Call Anthropic
                const response = await this.anthropic.messages.create({
                    model: this.config.model,
                    max_tokens: 4000,
                    temperature: this.config.temperature,
                    system: this.systemPrompt,
                    messages: [
                        {
                            role: 'user',
                            content: JSON.stringify(enhancedPrompt, null, 2)
                        }
                    ]
                });
                if (response.content[0].type === 'text') {
                    content = response.content[0].text;
                }
            }
            else {
                throw new Error(`Invalid provider configuration: ${this.config.provider}`);
            }
            if (!content) {
                throw new Error('Empty response from LLM');
            }
            // Extract JSON from markdown code fences if present
            let jsonText = content.trim();
            const jsonMatch = jsonText.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
            if (jsonMatch) {
                jsonText = jsonMatch[1].trim();
            }
            const extracted = JSON.parse(jsonText);
            console.log(`[HardRequirementsExtractor] Extracted ${extracted.requirements?.length || 0} requirements`);
            console.log(`[HardRequirementsExtractor] Unit of work: ${extracted.unit_of_work || 'none'}`);
            console.log(`[HardRequirementsExtractor] Thresholds: ${extracted.thresholds?.length || 0}`);
            console.log(`[HardRequirementsExtractor] Routing rules: ${extracted.routing_rules?.length || 0}`);
            console.log(`[HardRequirementsExtractor] Invariants: ${extracted.invariants?.length || 0}`);
            console.log(`[HardRequirementsExtractor] Required outputs: ${extracted.required_outputs?.length || 0}`);
            return extracted;
        }
        catch (error) {
            console.error('[HardRequirementsExtractor] LLM extraction failed:', error);
            // Fallback to empty requirements rather than failing the entire pipeline
            return {
                requirements: [],
                unit_of_work: null,
                thresholds: [],
                routing_rules: [],
                invariants: [],
                empty_behavior: null,
                required_outputs: [],
                side_effect_constraints: []
            };
        }
    }
    /**
     * Initialize requirement map with all requirement IDs
     */
    createRequirementMap(hardReqs) {
        const map = {};
        hardReqs.requirements.forEach(req => {
            map[req.id] = {
                status: 'pending'
            };
        });
        return map;
    }
}
