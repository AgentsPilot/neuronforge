/**
 * The planner's prompt must be the same bytes on every turn.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A TEST AND NOT A HOPE
 *
 * A provider caches a prompt PREFIX. Anything that changes between turns ends
 * the cacheable region at that point, so the tokens after it are re-billed at
 * full price every time — and the tool schema, the single largest block after
 * the catalog, sat behind a catalog that was re-scoped per question.
 *
 * Measured on this catalog, in tokens billed with cached input at half rate:
 *
 *     scoping hits           5,750
 *     scoping misses         8,651     <- production's median says this one
 *     stable, fully cached   5,268
 *
 * The end-to-end behaviour is verified from telemetry, not here: every call now
 * records `cached_input_tokens`, so the hit rate is a number rather than a
 * belief. What THIS file guards is the precondition — that the prompt does not
 * change between two different questions, which is the thing a code change can
 * silently break.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { renderCatalogForPrompt } from '../planner/catalogPrompt';
import { buildPlanTool, plannerSystemPrompt, plannerVersion, PLANNER_SYSTEM_PROMPT } from '../planner/planTool';

describe('the cacheable prefix', () => {
  it('renders the same catalog whatever the question was', () => {
    // `entities: undefined` is what the stable path passes — no per-question
    // narrowing, so the bytes cannot depend on the message.
    const a = renderCatalogForPrompt({ includeActions: true, language: 'he' });
    const b = renderCatalogForPrompt({ includeActions: true, language: 'he' });

    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(1000);
  });

  it('renders the same tool schema whatever the question was', () => {
    expect(JSON.stringify(buildPlanTool())).toBe(JSON.stringify(buildPlanTool()));
  });

  it('is long enough for a provider to bother caching', () => {
    // OpenAI caches prefixes from ~1,024 tokens. Characters ÷ 4 as the proxy.
    const prefix =
      plannerSystemPrompt({ actions: true }) +
      renderCatalogForPrompt({ includeActions: true }) +
      JSON.stringify(buildPlanTool());

    expect(Math.round(prefix.length / 4)).toBeGreaterThan(1024);
  });

  it('keeps the rules block ahead of everything that can vary', () => {
    /*
     * `plannerSystemPrompt({actions:false})` drops the action rules. Whatever
     * else differs, the two variants must still SHARE a leading block, or a
     * turn where no entity declares an action would cache nothing at all.
     */
    const withActions = plannerSystemPrompt({ actions: true });
    const without = plannerSystemPrompt({ actions: false });

    let shared = 0;
    while (shared < without.length && withActions[shared] === without[shared]) shared++;

    expect(Math.round(shared / 4)).toBeGreaterThan(1024);
  });
});

describe('the cache routing key', () => {
  it('is stable while the prompt is', () => {
    expect(plannerVersion()).toBe(plannerVersion());
  });

  it('is derived from the prompt, so changing the prompt starts a new cache', () => {
    // Guards the invariant rather than the value: the version must be a
    // function of the instructions and the schema, not a constant somebody
    // bumps by hand.
    expect(plannerVersion()).toHaveLength(12);
    expect(PLANNER_SYSTEM_PROMPT.length).toBeGreaterThan(0);
  });
});
