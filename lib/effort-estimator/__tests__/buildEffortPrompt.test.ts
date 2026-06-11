/**
 * Effort Estimator — prompt builder tests.
 *
 * Locks the SHAPE of the constructed prompt (not the wording — wording is
 * Dev's call). Three concerns:
 *  - persona string injected verbatim into the system prompt
 *  - sparse user context: empty fields omitted from the user prompt
 *  - JSON-schema description references the persisted shape's field names
 */
import { buildEffortPrompt } from '../buildEffortPrompt';

describe('buildEffortPrompt', () => {
  const baseArgs = {
    persona: 'logistics-ops manager at a marketing SMB',
    userContext: { role: 'logistics-ops manager', domain: 'marketing' },
    enhancedPrompt: 'Summarize my last 10 Gmail emails and save to Notion.',
  };

  it('injects persona verbatim into the system prompt', () => {
    const { system } = buildEffortPrompt(baseArgs);
    expect(system).toContain('logistics-ops manager at a marketing SMB');
  });

  it('mentions all required output field names in the system prompt', () => {
    const { system } = buildEffortPrompt(baseArgs);
    expect(system).toContain('reasoning');
    expect(system).toContain('is_bulk_workflow');
    expect(system).toContain('total_manual_time_seconds');
    expect(system).toContain('confidence');
  });

  it('includes the workflow description in the user prompt', () => {
    const { user } = buildEffortPrompt(baseArgs);
    expect(user).toContain('Summarize my last 10 Gmail emails and save to Notion.');
  });

  it('omits empty user-context fields from the user prompt (sparse-data handling)', () => {
    const { user } = buildEffortPrompt({
      ...baseArgs,
      userContext: { role: 'founder', domain: '', company: '   ' },
    });
    expect(user).toContain('role: founder');
    expect(user).not.toContain('domain:');
    expect(user).not.toContain('company:');
  });

  it('emits the generic-context placeholder when no fields are present', () => {
    const { user } = buildEffortPrompt({
      ...baseArgs,
      userContext: {},
    });
    expect(user).toMatch(/generic SMB-owner persona/i);
  });

  it('handles a completely empty enhanced prompt without crashing', () => {
    const { user } = buildEffortPrompt({
      ...baseArgs,
      enhancedPrompt: '',
    });
    expect(user).toContain('no workflow description provided');
  });
});
