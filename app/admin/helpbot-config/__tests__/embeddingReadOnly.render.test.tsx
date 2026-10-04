/**
 * @jest-environment jsdom
 */

/**
 * The HelpBot page shows the embedding model read-only and never sends it.
 *
 * The key is shared with Business OS chat; changing it invalidates every stored
 * vector, so the server no longer writes it and refuses a changed value
 * (app/api/admin/helpbot-config/route.ts). The page used to offer a <select>
 * and send the value on every save.
 *
 * Renders the real page in jsdom (Playwright is not installed — CLAUDE.md § Testing).
 *
 * @see docs/workplans/ADMIN_HELPBOT_LOCK_AND_AUDIT_EMAIL_WORKPLAN.md
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import HelpBotConfigPage from '../page';

const STORED_MODEL = 'text-embedding-3-large';

const loadedConfig = {
  general: { model: 'llama-3.1-8b-instant', temperature: 0.2, maxTokens: 300 },
  input: { model: 'llama-3.1-8b-instant', temperature: 0.3, maxTokens: 400 },
  semantic: {
    enabled: true,
    embeddingModel: STORED_MODEL,
    cacheThreshold: 0.85,
    faqThreshold: 0.8,
    autoPromoteEnabled: false,
    autoPromoteThreshold: 10,
    autoPromoteMinThumbsUp: 3,
  },
  prompts: { generalPrompt: null, inputPrompt: null },
  theme: {
    primaryColor: '#8b5cf6',
    secondaryColor: '#9333ea',
    borderColor: '#e2e8f0',
    shadowColor: 'rgba(139, 92, 246, 0.2)',
    closeButtonColor: '#ef4444',
  },
  welcomeMessages: { default: null, inputHelp: null },
  provider: 'groq',
  enabled: true,
  cacheEnabled: true,
  faqEnabled: true,
};

let fetchMock: jest.Mock;

beforeEach(() => {
  fetchMock = jest.fn(async (_url: string, init?: { method?: string }) => ({
    ok: true,
    json: async () =>
      init?.method === 'PUT'
        ? { success: true, message: 'saved' }
        : { success: true, config: loadedConfig },
  }));
  (global as unknown as { fetch: jest.Mock }).fetch = fetchMock;
});

describe('HelpBot page — embedding model is read-only', () => {
  it('P-1: renders the stored value in a read-only field with the warning', async () => {
    render(<HelpBotConfigPage />);

    const field = (await screen.findByLabelText('Embedding Model')) as HTMLInputElement;
    expect(field.tagName).toBe('INPUT');
    expect(field.readOnly).toBe(true);
    expect(field.value).toBe(STORED_MODEL);

    // The old control was a <select> offering other models.
    expect(screen.queryByRole('option', { name: /text-embedding-3-small/ })).toBeNull();

    // Typing does nothing to a read-only field's controlled value.
    fireEvent.change(field, { target: { value: 'text-embedding-ada-002' } });
    expect(field.value).toBe(STORED_MODEL);

    expect(screen.getByText(/shared with Business OS chat/)).toBeTruthy();
    expect(screen.getByText(/invalidates every stored vector/)).toBeTruthy();
    expect(screen.getByText(/data migration, not a setting/)).toBeTruthy();
  });

  it('P-2: Save sends the config without semantic.embeddingModel', async () => {
    render(<HelpBotConfigPage />);
    await screen.findByLabelText('Embedding Model');

    fireEvent.click(screen.getByRole('button', { name: /Save Changes/ }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(true)
    );
    const [, init] = fetchMock.mock.calls.find(([, i]) => i?.method === 'PUT') as [string, { body: string }];
    const sent = JSON.parse(init.body);

    expect(sent.config.semantic).not.toHaveProperty('embeddingModel');
    // Everything else still goes.
    expect(sent.config.semantic.cacheThreshold).toBe(0.85);
    expect(sent.config.general.model).toBe('llama-3.1-8b-instant');
  });
});
