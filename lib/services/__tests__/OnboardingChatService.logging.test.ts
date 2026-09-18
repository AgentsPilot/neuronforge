/**
 * OnboardingChatService.processBio — what reaches the logs (OI-8, D-OI8).
 *
 * The model's response is an extraction of the owner's bio. When it is not
 * valid JSON, the text is kept for local debugging at `debug` only; production
 * runs at `info` (`lib/logger.ts:16`), so it never appears there. The error
 * line carries the error's name and the response length only, because a JSON
 * SyntaxError's own message quotes the start of the text it failed on.
 */

/** Every log call, serialized at call time as Pino would. */
const mockLogged: Array<{ level: string; fields: Record<string, unknown>; msg: string }> = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) {
      logger[level] = (first: unknown, second?: unknown) => {
        const fields =
          typeof first === 'object' && first !== null
            ? JSON.parse(JSON.stringify(first, (_k, v) => (v instanceof Error ? { name: v.name, message: v.message } : v)))
            : {};
        const msg = typeof first === 'string' ? first : String(second ?? '');
        mockLogged.push({ level, fields, msg });
      };
    }
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

const mockChatCompletion = jest.fn();
jest.mock('@/lib/ai/providerFactory', () => ({
  PROVIDERS: { OPENAI: 'openai' },
  ProviderFactory: { getProvider: () => ({ chatCompletion: (...args: unknown[]) => mockChatCompletion(...args) }) },
}));
jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));
jest.mock('@/lib/utils/pricingConfig', () => ({ tokensToPilotCredits: async () => 1 }));

import { OnboardingChatService } from '@/lib/services/OnboardingChatService';

const DERIVED = 'DERIVED-MARKER-wvpj the owner runs a studio';

beforeEach(() => {
  mockLogged.length = 0;
  mockChatCompletion.mockReset();
});

describe('processBio: an unparseable model response (OI-8)', () => {
  it('logs the response text at debug only; the error line has the name and length', async () => {
    const content = `${DERIVED} — not JSON`;
    mockChatCompletion.mockResolvedValue({ choices: [{ message: { content } }], usage: { total_tokens: 10 } });

    const result = await new OnboardingChatService().processBio('a bio', '2f734ed5-3681-4049-880d-3de7b096bea3');
    expect(result.success).toBe(false);

    const visible = mockLogged.filter((l) => !['debug', 'trace'].includes(l.level));
    expect(JSON.stringify(visible)).not.toContain('DERIVED-MARKER');

    const errorLine = mockLogged.find((l) => l.msg === 'Failed to parse LLM JSON response');
    expect(errorLine).toEqual({
      level: 'error',
      fields: { errName: 'SyntaxError', contentLength: content.length },
      msg: 'Failed to parse LLM JSON response',
    });

    // Kept for local debugging.
    const debugLine = mockLogged.find((l) => l.msg === 'Unparseable LLM JSON response');
    expect(debugLine?.level).toBe('debug');
    expect(JSON.stringify(debugLine?.fields)).toContain('DERIVED-MARKER');
  });
});
