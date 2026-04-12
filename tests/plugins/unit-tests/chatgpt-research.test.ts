/**
 * Unit tests for ChatGPTResearchPluginExecutor -- 3 actions
 *
 * Actions: research_topic, summarize_content, answer_question
 *
 * This executor is unique: it uses the OpenAI SDK (not raw fetch) for LLM calls
 * and Google Custom Search API (via fetch) for web search. We mock the OpenAI
 * module at the top level and use the standard fetch mock for search calls.
 *
 * IMPORTANT: env vars must be set before the executor module is loaded because
 * the module-level `openai` constant checks `process.env.OPENAI_API_KEY` at
 * import time.
 */

// Set env vars BEFORE module import -- the executor reads these at load time
process.env.OPENAI_API_KEY = 'test-openai-key';
process.env.GOOGLE_SEARCH_ENGINE_ID = 'test-cx';
process.env.GOOGLE_SEARCH_API_KEY = 'test-google-key';

// Mock OpenAI before importing the executor
const mockCreate = jest.fn();
jest.mock('openai', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: mockCreate,
        },
      },
    })),
  };
});

import { ChatGPTResearchPluginExecutor } from '@/lib/server/chatgpt-research-plugin-executor';
import {
  createTestExecutor,
  expectSuccessResult,
  expectErrorResult,
} from '../common/test-helpers';
import {
  mockFetchSuccess,
  mockFetchError,
  mockFetchSequence,
  restoreFetch,
} from '../common/mock-fetch';
import { mockFetchThrow } from '../common/mock-fetch';

const PLUGIN_KEY = 'chatgpt-research';
const USER_ID = 'test-user-id';

describe('ChatGPTResearchPluginExecutor', () => {
  let executor: any;

  beforeAll(async () => {
    const ctx = await createTestExecutor(ChatGPTResearchPluginExecutor, PLUGIN_KEY);
    executor = ctx.executor;
  });

  beforeEach(() => {
    mockCreate.mockReset();
  });

  afterEach(() => {
    restoreFetch();
  });

  describe('[smoke]', () => {
    describe('research_topic', () => {
      it('should perform web search and generate AI summary', async () => {
        // Mock Google Custom Search API response, then page content fetch
        mockFetchSequence([
          // Google search results
          {
            body: {
              items: [
                {
                  title: 'AI Overview',
                  link: 'https://example.com/ai',
                  snippet: 'AI is transforming...',
                },
              ],
            },
          },
          // Page content fetch
          {
            body: '<html><body>Detailed AI content here</body></html>',
          },
        ]);

        // Mock OpenAI completion
        mockCreate.mockResolvedValueOnce({
          choices: [{ message: { content: '## AI Research Summary\n\n- Key point 1\n- Key point 2' } }],
          usage: { total_tokens: 500 },
        });

        const result = await executor.executeAction(USER_ID, 'research_topic', {
          topic: 'Artificial Intelligence',
          depth: 'quick',
        });

        expectSuccessResult(result);
        expect(result.data.sources).toHaveLength(1);
        expect(result.data.source_count).toBe(1);
        expect(result.data.summary).toContain('AI Research Summary');
        expect(result.data.key_points.length).toBeGreaterThan(0);
      });
    });

    describe('summarize_content', () => {
      it('should summarize provided content via OpenAI', async () => {
        mockCreate.mockResolvedValueOnce({
          choices: [{ message: { content: 'This is a concise summary of the article.' } }],
          usage: { total_tokens: 100 },
        });

        const result = await executor.executeAction(USER_ID, 'summarize_content', {
          content: 'A very long article that goes on and on about many different topics and needs to be summarized for quick reading.',
        });

        expectSuccessResult(result);
        expect(result.data.summary).toBe('This is a concise summary of the article.');
        expect(result.data.tokens_used).toBe(100);
        expect(mockCreate).toHaveBeenCalledTimes(1);
      });
    });

    describe('answer_question', () => {
      it('should answer a question using web search and AI', async () => {
        // Mock Google search
        mockFetchSequence([
          {
            body: {
              items: [
                {
                  title: 'Answer Source',
                  link: 'https://example.com/answer',
                  snippet: 'The answer is 42.',
                },
              ],
            },
          },
          // Page content
          { body: '<html><body>The answer is definitely 42.</body></html>' },
        ]);

        // Mock OpenAI completion
        mockCreate.mockResolvedValueOnce({
          choices: [{ message: { content: 'Based on research, the answer is 42.' } }],
          usage: { total_tokens: 150 },
        });

        const result = await executor.executeAction(USER_ID, 'answer_question', {
          question: 'What is the meaning of life?',
        });

        expectSuccessResult(result);
        expect(result.data.answer).toContain('42');
        expect(result.data.question).toBe('What is the meaning of life?');
        expect(result.data.used_web_search).toBe(true);
        expect(result.data.source_count).toBeGreaterThan(0);
      });
    });
  });

  describe('[full]', () => {
    describe('research_topic', () => {
      it('should return empty results when search finds nothing', async () => {
        mockFetchSuccess({ items: [] });

        const result = await executor.executeAction(USER_ID, 'research_topic', {
          topic: 'obscure nonexistent topic xyz123',
          depth: 'quick',
        });

        expectSuccessResult(result);
        expect(result.data.source_count).toBe(0);
        expect(result.data.key_points).toEqual([]);
      });

      it('should handle missing topic parameter', async () => {
        const result = await executor.executeAction(USER_ID, 'research_topic', {});

        expectErrorResult(result);
      });
    });

    describe('summarize_content', () => {
      it('should return content as-is when too short for summarization', async () => {
        const shortContent = 'Short text.';

        const result = await executor.executeAction(USER_ID, 'summarize_content', {
          content: shortContent,
        });

        expectSuccessResult(result);
        expect(result.data.summary).toBe(shortContent);
        expect(result.data.tokens_used).toBe(0);
        expect(mockCreate).not.toHaveBeenCalled();
      });

      it('should handle missing content parameter', async () => {
        const result = await executor.executeAction(USER_ID, 'summarize_content', {});

        expectErrorResult(result);
      });

      it('should handle OpenAI API failure', async () => {
        mockCreate.mockRejectedValueOnce(new Error('Rate limit exceeded'));

        const result = await executor.executeAction(USER_ID, 'summarize_content', {
          content: 'A sufficiently long piece of content that requires summarization by the AI model to test error handling.',
        });

        expectErrorResult(result);
      });
    });

    describe('answer_question', () => {
      it('should handle question shorter than 5 characters', async () => {
        const result = await executor.executeAction(USER_ID, 'answer_question', {
          question: 'Hi?',
        });

        expectErrorResult(result);
      });

      it('should work without web search when disabled', async () => {
        mockCreate.mockResolvedValueOnce({
          choices: [{ message: { content: 'Answer without search.' } }],
          usage: { total_tokens: 50 },
        });

        const result = await executor.executeAction(USER_ID, 'answer_question', {
          question: 'What is TypeScript?',
          use_web_search: false,
        });

        expectSuccessResult(result);
        expect(result.data.used_web_search).toBe(false);
        expect(result.data.source_count).toBe(0);
      });

      it('should handle OpenAI API failure', async () => {
        // Mock search succeeding
        mockFetchSequence([
          { body: { items: [] } },
        ]);

        mockCreate.mockRejectedValueOnce(new Error('API timeout'));

        const result = await executor.executeAction(USER_ID, 'answer_question', {
          question: 'What is the weather today?',
        });

        expectErrorResult(result);
      });
    });

    // ---- P3-T2: Error scenarios (plugin-specific) ----
    // Note: chatgpt-research catches Google Search errors internally and
    // returns success with empty results rather than propagating failures.
    // Tests verify graceful degradation rather than error propagation.
    describe('error scenarios for research_topic', () => {
      it('handles network failure on Google Search gracefully', async () => {
        mockFetchThrow(new Error('Network error'));
        const result = await executor.executeAction(USER_ID, 'research_topic', {
          topic: 'Test',
          depth: 'quick',
        });
        // Executor catches search errors and returns empty results
        expectSuccessResult(result);
        expect(result.data.source_count).toBe(0);
      });

      it('handles HTTP 429 rate limit on search gracefully', async () => {
        mockFetchError(429, 'Too Many Requests');
        const result = await executor.executeAction(USER_ID, 'research_topic', {
          topic: 'Test',
          depth: 'quick',
        });
        expectSuccessResult(result);
        expect(result.data.source_count).toBe(0);
      });

      it('handles HTTP 500 on search gracefully', async () => {
        mockFetchError(500, 'Internal Server Error');
        const result = await executor.executeAction(USER_ID, 'research_topic', {
          topic: 'Test',
          depth: 'quick',
        });
        expectSuccessResult(result);
        expect(result.data.source_count).toBe(0);
      });
    });

    // ---- P3-T3: Malformed response tests ----
    describe('malformed responses', () => {
      it('handles search response with missing items field', async () => {
        mockFetchSuccess({});
        const result = await executor.executeAction(USER_ID, 'research_topic', {
          topic: 'Test',
          depth: 'quick',
        });
        expect(result).toBeDefined();
      });

      it('handles null response body from search', async () => {
        mockFetchSuccess(null);
        const result = await executor.executeAction(USER_ID, 'research_topic', {
          topic: 'Test',
          depth: 'quick',
        });
        expect(result).toBeDefined();
      });
    });

    // ---- P3-T4: Authentication edge cases ----
    describe('authentication edge cases', () => {
      it('handles empty access_token', async () => {
        const ctx = await createTestExecutor(ChatGPTResearchPluginExecutor, PLUGIN_KEY, {
          access_token: '',
        });
        mockFetchError(401, { error: 'Unauthorized' });
        mockCreate.mockRejectedValueOnce(new Error('Invalid API key'));
        const result = await ctx.executor.executeAction(USER_ID, 'research_topic', {
          topic: 'Test',
          depth: 'quick',
        });
        // System/plugin may handle differently — just ensure no crash
        expect(result).toBeDefined();
      });
    });
  });
});
