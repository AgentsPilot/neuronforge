/**
 * Intake LLM attribution (rows 13, 14).
 *
 * Both calls went through the shared `complete()` helper with no context, so
 * they landed on the platform account. They must be recorded against the owner,
 * under business-os-intake, with one grouping id per request minted at the
 * route. Provider, auth and repositories mocked; no network, no DB.
 */

/*
 * Layer 2 (Step 2): the call sites take their model, temperature and on/off
 * switch from `resolveBosLlmSettings`. Pinned to the CODE DEFAULTS — today's
 * values — so this file keeps asserting exactly what it asserted before, with
 * no configuration read and no I/O.
 */
jest.mock('@/lib/business-os/llm/modelSettings', () => {
  const actual = jest.requireActual('@/lib/business-os/llm/modelSettings');
  return {
    ...actual,
    resolveBosLlmSettings: async (area: string, callName: string) => actual.bosLlmCodeDefaults(area, callName),
  };
});

jest.mock('@/lib/logger', () => {
  const logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(), child: () => logger };
  return { createLogger: () => logger };
});

const mockComplete = jest.fn();
jest.mock('@/lib/ai/providerFactory', () => ({
  getProviderFactory: () => ({ complete: (...args: unknown[]) => mockComplete(...args) }),
}));

const mockGetUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => mockGetUser() }));

jest.mock('@/lib/repositories/BusinessProfileRepository', () => ({
  businessProfileRepository: {
    findByUserId: jest.fn(async () => ({
      data: { language: 'en', vertical: 'events', business_name: 'Studio', sub_vertical: null },
    })),
  },
}));
jest.mock('@/lib/repositories/SchedulingRepository', () => ({
  schedulingServiceRepository: { listAll: jest.fn(async () => ({ data: [] })) },
}));
jest.mock('@/lib/repositories/IntakeFormRepository', () => ({
  intakeFormRepository: {
    getDraft: jest.fn(async () => ({ data: null, error: null })),
    saveDraft: jest.fn(async (_userId: string, questions: unknown[]) => ({
      data: { id: 'form-1', questions },
      error: null,
    })),
  },
}));

import { NextRequest } from 'next/server';
import { isUuid } from '@/lib/business-os/llm/callCatalog';
import { intakeGenerationService } from '@/lib/services/IntakeGenerationService';
import { POST as inferQuestion } from '@/app/api/intake/form/infer-question/route';
import { POST as generateForm } from '@/app/api/intake/form/generate/route';

const U1 = '11111111-1111-4111-8111-111111111111';
const G1 = '33333333-3333-4333-8333-333333333333';

function request(url: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockResolvedValue({ id: U1 });
});

describe('row 13 — intake form generation', () => {
  it('records the call against the owner under business-os-intake / form_generation', async () => {
    mockComplete.mockResolvedValue({
      content: JSON.stringify({ questions: [{ label: 'What date is your event?', type: 'date', required: true }] }),
    });

    await intakeGenerationService.generateIntakeForm(U1, { groupId: G1 });

    expect(mockComplete).toHaveBeenCalledTimes(1);
    expect(mockComplete.mock.calls[0][1]).toStrictEqual({
      userId: U1,
      feature: 'business-os-intake',
      component: 'form_generation',
      sessionId: G1,
    });
  });

  it('mints a different UUID group for each generate request, from the session account', async () => {
    const generate = jest
      .spyOn(intakeGenerationService, 'generateIntakeForm')
      .mockResolvedValue({ success: true, formId: 'f', questionCount: 1, contentSource: 'llm' });

    await generateForm(request('http://localhost/api/intake/form/generate', {}));
    await generateForm(request('http://localhost/api/intake/form/generate', {}));

    expect(generate).toHaveBeenCalledTimes(2);
    const [first, second] = generate.mock.calls;
    expect(first[0]).toBe(U1);
    expect(isUuid(first[1].groupId)).toBe(true);
    expect(isUuid(second[1].groupId)).toBe(true);
    expect(first[1].groupId).not.toBe(second[1].groupId);

    generate.mockRestore();
  });
});

describe('row 14 — intake question inference', () => {
  it('records the call against the signed-in owner under business-os-intake / question_inference', async () => {
    mockComplete.mockResolvedValue({
      content: JSON.stringify({ label: 'Do you have a venue?', type: 'yes_no', options: [], required: false }),
    });

    const response = await inferQuestion(
      request('http://localhost/api/intake/form/infer-question', { text: 'ask if they have a venue' })
    );

    expect(response.status).toBe(200);
    expect(mockComplete).toHaveBeenCalledTimes(1);
    const context = mockComplete.mock.calls[0][1];
    expect(context).toMatchObject({
      userId: U1,
      feature: 'business-os-intake',
      component: 'question_inference',
    });
    expect(isUuid(context.sessionId)).toBe(true);
  });

  it('ignores any account or group sent in the request', async () => {
    mockComplete.mockResolvedValue({ content: '{}' });

    await inferQuestion(
      request('http://localhost/api/intake/form/infer-question', {
        text: 'ask if they have a venue',
        userId: '99999999-9999-4999-8999-999999999999',
        groupId: G1,
      })
    );

    const context = mockComplete.mock.calls[0][1];
    expect(context.userId).toBe(U1);
    expect(context.sessionId).not.toBe(G1);
  });
});
