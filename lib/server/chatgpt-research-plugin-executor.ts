// lib/server/chatgpt-research-plugin-executor.ts

import { UserPluginConnections } from './user-plugin-connections';
import { PluginManagerV2 } from './plugin-manager-v2';
import { BasePluginExecutor } from './base-plugin-executor';
import OpenAI from 'openai';

const pluginName = 'chatgpt-research';

// Initialize OpenAI client
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

/**
 * Executor for ChatGPT Research plugin actions
 * Provides AI-powered web research, content summarization, and question answering
 */
export class ChatGPTResearchPluginExecutor extends BasePluginExecutor {
  constructor(userConnections: UserPluginConnections, pluginManager: PluginManagerV2) {
    super(pluginName, userConnections, pluginManager);
  }

  // Execute ChatGPT Research action
  protected async executeSpecificAction(
    _connection: any,
    actionName: string,
    parameters: any
  ): Promise<any> {
    switch (actionName) {
      case 'research_topic':
        return await this.researchTopic(parameters);
      case 'summarize_content':
        return await this.summarizeContent(parameters);
      case 'answer_question':
        return await this.answerQuestion(parameters);
      default:
        throw new Error(`Action ${actionName} not supported`);
    }
  }

  /**
   * Research a topic using web search and AI analysis
   */
  private async researchTopic(parameters: any): Promise<any> {
    if (this.debug) console.log('DEBUG: Researching topic via ChatGPT Research');

    const { topic, depth = 'standard', focus = 'general', output_format = 'detailed', max_length = 3000 } = parameters;

    if (!topic) {
      throw new Error('Topic is required for research');
    }

    // Determine number of searches based on depth
    const searchCounts: Record<string, number> = {
      quick: 3,
      standard: 5,
      comprehensive: 8,
      deep_dive: 10
    };
    const numSearches = searchCounts[depth] || 5;

    // Perform web searches
    const searchResults = await this.performWebSearch(topic, numSearches, focus);

    if (!searchResults || searchResults.length === 0) {
      return {
        summary: `No relevant information found for topic: "${topic}". Try different keywords or a broader search.`,
        key_points: [],
        sources: [],
        source_count: 0,
        research_depth: depth
      };
    }

    // Generate AI summary using OpenAI
    const summary = await this.generateResearchSummary(topic, searchResults, output_format, max_length);

    return {
      summary: summary.text,
      key_points: summary.key_points,
      sources: searchResults.map(r => ({
        title: r.title,
        url: r.url,
        snippet: r.snippet
      })),
      source_count: searchResults.length,
      research_depth: depth,
      focus: focus
    };
  }

  /**
   * Summarize provided content using AI
   */
  private async summarizeContent(parameters: any): Promise<any> {
    if (this.debug) console.log('DEBUG: Summarizing content via ChatGPT');

    const { content, length = 'standard', style = 'professional', focus_on = [] } = parameters;

    // Smart handling: if content is too short, return it as-is instead of erroring
    if (!content) {
      throw new Error('Content is required for summarization');
    }

    if (content.length < 50) {
      if (this.debug) console.log('DEBUG: Content too short for summarization, returning as-is');
      return {
        summary: content,
        original_length: content.length,
        summary_length: content.length,
        length_type: 'original',
        style: style,
        tokens_used: 0,
        note: 'Content was already concise enough, no summarization needed'
      };
    }

    if (!openai) {
      throw new Error('OpenAI API key not configured');
    }

    // Determine summary length
    const lengthInstructions: Record<string, string> = {
      brief: '1-2 sentences',
      standard: 'one concise paragraph (3-5 sentences)',
      detailed: 'multiple paragraphs with key details'
    };

    const lengthInstruction = lengthInstructions[length] || lengthInstructions['standard'];

    const focusInstruction = focus_on.length > 0
      ? `\n\nFocus specifically on these aspects: ${focus_on.join(', ')}`
      : '';

    const systemPrompt = `You are a professional content summarizer. Create ${style} summaries that capture the essential information.`;
    const userPrompt = `Summarize the following content in ${lengthInstruction}:${focusInstruction}\n\n${content}`;

    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3,
        max_tokens: 2000 // Optimized for cost
      });

      const summaryText = completion.choices[0].message.content || 'Unable to generate summary';

      return {
        summary: summaryText,
        original_length: content.length,
        summary_length: summaryText.length,
        style: style,
        length_type: length,
        tokens_used: completion.usage?.total_tokens || 0
      };
    } catch (error: any) {
      if (this.debug) console.error('DEBUG: OpenAI summarization failed:', error);
      throw new Error(`AI summarization failed: ${error.message}`);
    }
  }

  /**
   * Answer questions using AI with optional web research
   */
  private async answerQuestion(parameters: any): Promise<any> {
    if (this.debug) console.log('DEBUG: Answering question via ChatGPT');

    const { question, use_web_search = true, detail_level = 'standard', include_sources = true } = parameters;

    if (!question || question.length < 5) {
      throw new Error('Question must be at least 5 characters');
    }

    if (!openai) {
      throw new Error('OpenAI API key not configured');
    }

    let contextData = '';
    let sources: any[] = [];

    // Perform web search if requested
    if (use_web_search) {
      const searchResults = await this.performWebSearch(question, 5, 'general');
      if (searchResults && searchResults.length > 0) {
        contextData = '\n\nRelevant information from web search:\n' +
          searchResults.map(r => `- ${r.title}: ${r.content}`).join('\n');
        sources = searchResults.map(r => ({
          title: r.title,
          url: r.url,
          snippet: r.snippet
        }));
      }
    }

    const detailInstructions: Record<string, string> = {
      concise: 'Provide a brief, direct answer in 1-2 sentences.',
      standard: 'Provide a clear, informative answer in a paragraph.',
      detailed: 'Provide a comprehensive answer with explanation and examples.'
    };

    const detailInstruction = detailInstructions[detail_level] || detailInstructions['standard'];

    const systemPrompt = `You are a knowledgeable AI assistant. Answer questions accurately and clearly.${use_web_search ? ' Use the provided web search results for current information.' : ''}`;
    const userPrompt = `${detailInstruction}\n\nQuestion: ${question}${contextData}`;

    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.5,
        max_tokens: 2000 // Optimized for cost
      });

      const answer = completion.choices[0].message.content || 'Unable to answer the question';

      return {
        answer: answer,
        question: question,
        detail_level: detail_level,
        used_web_search: use_web_search,
        sources: include_sources ? sources : undefined,
        source_count: sources.length,
        tokens_used: completion.usage?.total_tokens || 0
      };
    } catch (error: any) {
      if (this.debug) console.error('DEBUG: OpenAI question answering failed:', error);
      throw new Error(`AI answering failed: ${error.message}`);
    }
  }

  /**
   * Perform web search using Google Custom Search API
   */
  private async performWebSearch(query: string, numResults: number = 5, focus: string = 'general'): Promise<any[]> {
    const cx = process.env.GOOGLE_SEARCH_ENGINE_ID;
    const apiKey = process.env.GOOGLE_SEARCH_API_KEY;

    if (!cx || !apiKey) {
      if (this.debug) console.warn('DEBUG: Google Search API not configured, skipping web search');
      return [];
    }

    try {
      // Modify query based on focus
      let modifiedQuery = query;
      if (focus === 'recent') modifiedQuery += ' after:' + new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      if (focus === 'news') modifiedQuery = `site:news.google.com OR site:bbc.com OR site:reuters.com ${query}`;
      if (focus === 'academic') modifiedQuery = `site:scholar.google.com OR site:.edu ${query}`;
      if (focus === 'technical') modifiedQuery += ' technical documentation';

      const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodeURIComponent(modifiedQuery)}&num=${Math.min(numResults, 10)}`;

      const response = await fetch(searchUrl);

      if (!response.ok) {
        if (this.debug) console.error('DEBUG: Google Search API failed:', response.status);
        return [];
      }

      const data = await response.json();

      if (!data.items || data.items.length === 0) {
        return [];
      }

      // Fetch full content from each result
      const results = [];
      for (const item of data.items) {
        try {
          const pageContent = await this.fetchPageContent(item.link);
          results.push({
            title: item.title,
            url: item.link,
            snippet: item.snippet,
            content: pageContent
          });
        } catch (error) {
          // If page fetch fails, use snippet only
          results.push({
            title: item.title,
            url: item.link,
            snippet: item.snippet,
            content: item.snippet
          });
        }
      }

      return results;
    } catch (error: any) {
      if (this.debug) console.error('DEBUG: Web search error:', error);
      return [];
    }
  }

  /**
   * Fetch full content from a web page
   */
  private async fetchPageContent(url: string): Promise<string> {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; AgentPilot/1.0; +https://agentpilot.com)'
        },
        signal: AbortSignal.timeout(10000) // 10 second timeout
      });

      if (!response.ok) {
        return '';
      }

      const html = await response.text();

      // Basic HTML to text conversion
      let text = html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      // Limit to first 2500 characters - OPTIMIZED for token usage
      return text.substring(0, 2500);
    } catch (error) {
      return '';
    }
  }

  /**
   * Generate research summary using OpenAI
   */
  private async generateResearchSummary(
    topic: string,
    searchResults: any[],
    outputFormat: string,
    maxLength: number
  ): Promise<{ text: string; key_points: string[] }> {
    if (!openai) {
      throw new Error('OpenAI API key not configured');
    }

    const formatInstructions: Record<string, string> = {
      summary: 'a brief summary (2-3 paragraphs)',
      detailed: 'a comprehensive analysis with multiple detailed paragraphs, specific examples, and thorough coverage of all important aspects. Provide substantial depth and detail.',
      bullet_points: 'organized bullet points with clear headings and detailed explanations for each point',
      report: 'a formal report structure with executive summary, detailed findings (multiple paragraphs), specific examples and data, analysis, and actionable recommendations'
    };

    const sourceContext = searchResults
      .map((r, i) => `[Source ${i + 1}] ${r.title}\n${r.content}`)
      .join('\n\n---\n\n');

    const formatInstruction = formatInstructions[outputFormat] || formatInstructions['detailed'];

    const systemPrompt = `You are a professional researcher. Create ${formatInstruction} based on the provided sources. Always cite sources when making claims.

IMPORTANT OUTPUT REQUIREMENTS:
- Provide comprehensive, detailed responses with substantial content
- DO NOT create brief or superficial summaries
- Include specific examples, data points, and evidence from sources
- For detailed/report formats: aim for AT LEAST 400-600 words with multiple paragraphs
- Use clear structure with headings and organized sections`;

    const userPrompt = `Research Topic: ${topic}\n\nProvided Sources:\n${sourceContext}\n\nCreate ${formatInstruction} about "${topic}" using these sources.

REQUIREMENTS:
- Target length: ${maxLength} characters (use most of this space for quality content)
- Provide thorough, detailed coverage of the topic
- Include specific facts, examples, and insights from the research
- Structure with clear sections and comprehensive analysis`;

    try {
      // Determine token limit based on output format - research needs more tokens
      const isDetailedFormat = ['detailed', 'report'].includes(outputFormat);
      const tokenLimit = isDetailedFormat
        ? Math.min(Math.floor(maxLength / 3), 4000) // Detailed: allow up to 4000 tokens
        : Math.min(Math.floor(maxLength / 3), 2500); // Standard: 2500 tokens max

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.5, // Balanced for quality research
        max_tokens: tokenLimit
      });

      const summaryText = completion.choices[0].message.content || 'Unable to generate research summary';

      // Extract key points (first 5 bullet points or main ideas)
      const keyPoints = this.extractKeyPoints(summaryText);

      return {
        text: summaryText.substring(0, maxLength),
        key_points: keyPoints
      };
    } catch (error: any) {
      if (this.debug) console.error('DEBUG: OpenAI research summary failed:', error);
      throw new Error(`AI research summary failed: ${error.message}`);
    }
  }

  /**
   * Extract key points from text
   */
  private extractKeyPoints(text: string): string[] {
    const lines = text.split('\n').filter(line => line.trim());
    const keyPoints: string[] = [];

    for (const line of lines) {
      // Look for bullet points, numbered lists, or headings
      if (line.match(/^[\-\*•]\s+/) || line.match(/^\d+\.\s+/) || line.match(/^#{1,3}\s+/)) {
        const cleaned = line.replace(/^[\-\*•\d\.#\s]+/, '').trim();
        if (cleaned.length > 10 && keyPoints.length < 5) {
          keyPoints.push(cleaned);
        }
      }
    }

    // If no structured points found, extract first few sentences
    if (keyPoints.length === 0) {
      const sentences = text.match(/[^.!?]+[.!?]+/g) || [];
      return sentences.slice(0, 3).map(s => s.trim());
    }

    return keyPoints;
  }
}
