/**
 * The effective fields of a ledger row (N-10, SA Q-5): a correction belongs
 * wherever the charge it corrects belongs.
 */

import { AI_ACTION_DECLARATIONS } from '@/lib/business-os/llm/aiActionAudit';
import { areaFor, diaryLabelFor, resolveEffectiveFields, type EffectiveFieldsInput } from '../effectiveFields';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const ORIGINAL_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';

const charge = (extra: Partial<EffectiveFieldsInput> = {}): EffectiveFieldsInput => ({
  kind: 'charge',
  user_id: A,
  action_id: ORIGINAL_ID,
  adjusts_action_id: null,
  service: 'ai',
  action_type: 'insight_run',
  triggered_by: 'scheduled',
  ...extra,
});

const adjustment = (extra: Partial<EffectiveFieldsInput> = {}): EffectiveFieldsInput => ({
  kind: 'adjustment',
  user_id: A,
  action_id: null,
  adjusts_action_id: ORIGINAL_ID,
  service: null,
  action_type: null,
  triggered_by: null,
  ...extra,
});

describe('areaFor (N-11: keyed on service AND action type)', () => {
  it('gives the declared area of every AI action type', () => {
    for (const [type, declaration] of Object.entries(AI_ACTION_DECLARATIONS)) {
      expect(areaFor('ai', type)).toBe(declaration.area);
    }
  });

  it('is "not declared" (null) for another service, an unknown type or no type', () => {
    expect(areaFor('sms_fixture', 'insight_run')).toBeNull();
    expect(areaFor('ai', 'no_such_type')).toBeNull();
    expect(areaFor('ai', null)).toBeNull();
    expect(areaFor(null, 'insight_run')).toBeNull();
    // Not fooled by an inherited property name.
    expect(areaFor('ai', 'toString')).toBeNull();
  });
});

describe('resolveEffectiveFields', () => {
  it('a charge answers for itself', () => {
    expect(resolveEffectiveFields(charge(), new Map())).toEqual({
      resolved: true,
      effectiveService: 'ai',
      effectiveActionType: 'insight_run',
      effectiveArea: 'insights',
      effectiveTrigger: 'scheduled',
    });
  });

  it('a charge of another service is counted with area "not declared"', () => {
    const f = resolveEffectiveFields(charge({ service: 'sms_fixture', action_type: 'reminder_sms' }), new Map());
    expect(f).toMatchObject({ resolved: true, effectiveService: 'sms_fixture', effectiveArea: null });
  });

  it('an adjustment inherits service, action type, area and trigger from its charge', () => {
    const originals = new Map([[ORIGINAL_ID, charge()]]);
    expect(resolveEffectiveFields(adjustment(), originals)).toEqual({
      resolved: true,
      effectiveService: 'ai',
      effectiveActionType: 'insight_run',
      effectiveArea: 'insights',
      effectiveTrigger: 'scheduled',
    });
  });

  it('an adjustment whose charge is missing is unresolved, never guessed', () => {
    expect(resolveEffectiveFields(adjustment(), new Map())).toEqual({
      resolved: false,
      effectiveService: null,
      effectiveActionType: null,
      effectiveArea: null,
      effectiveTrigger: null,
    });
    expect(resolveEffectiveFields(adjustment({ adjusts_action_id: null }), new Map()).resolved).toBe(false);
  });

  it('an adjustment whose "original" is itself an adjustment is unresolved', () => {
    const originals = new Map([[ORIGINAL_ID, adjustment()]]);
    expect(resolveEffectiveFields(adjustment(), originals).resolved).toBe(false);
  });

  it('an adjustment whose charge sits on ANOTHER account is unresolved, so no figure moves between accounts', () => {
    const originals = new Map([[ORIGINAL_ID, charge({ user_id: B })]]);
    expect(resolveEffectiveFields(adjustment(), originals).resolved).toBe(false);
  });
});

describe('diaryLabelFor (slice 7a; N-11: keyed on service AND action type)', () => {
  it('answers the declared label of an AI action, in the three languages', () => {
    expect(diaryLabelFor('ai', 'chat_turn')).toEqual(AI_ACTION_DECLARATIONS.chat_turn.diaryLabels);
  });

  it('carries the D-q wording for a setup conversation turn', () => {
    expect(diaryLabelFor('ai', 'onboarding_turn')?.en).toBe('Replied in your setup conversation');
  });

  it('is null for another service, even with an AI action type name (never by action type alone)', () => {
    expect(diaryLabelFor('notification_email', 'chat_turn')).toBeNull();
    expect(diaryLabelFor(null, 'chat_turn')).toBeNull();
  });

  it('is null for an undeclared action type and for no action type', () => {
    expect(diaryLabelFor('ai', 'not_declared')).toBeNull();
    expect(diaryLabelFor('ai', 'toString')).toBeNull();
    expect(diaryLabelFor('ai', null)).toBeNull();
  });

  it('returns a copy, so a caller cannot change the declarations', () => {
    const label = diaryLabelFor('ai', 'chat_turn')!;
    label.en = 'changed';
    expect(AI_ACTION_DECLARATIONS.chat_turn.diaryLabels.en).toBe('Answered a question');
  });
});
