/**
 * The Business OS plugin definition must match the catalog it was generated from.
 *
 * WHY THIS TEST IS THE POINT OF GENERATING IT
 *
 * The other 23 plugin definitions are hand-written because each wraps someone
 * else's API. This one wraps a catalog we already own, so a hand-written copy
 * would be a second description of our own data — and second descriptions drift.
 *
 * The drift is not hypothetical: the insight kernel's `TriggerableProcesses.ts`
 * is a hand-written registry of 4 processes, and ~24 detectors reference paired
 * processes nobody remembered to add, so their action buttons fail at runtime
 * with "Process not found". This test is what stops the plugin becoming that:
 * add an entity to the catalog without regenerating, and it fails here rather
 * than in a generated workflow.
 *
 *   npx tsx --import ./scripts/env-preload.ts scripts/generate-business-os-plugin.ts
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { CATALOG } from '@/lib/business-os/catalog';

const definition = JSON.parse(
  readFileSync(
    join(process.cwd(), 'lib/plugins/definitions/business-os-plugin-v2.json'),
    'utf8'
  )
) as {
  plugin: Record<string, unknown> & { auth_config: { auth_type: string } };
  actions: Record<string, Record<string, unknown>>;
};

describe('business-os plugin definition', () => {
  it('exposes a find action for every catalog entity', () => {
    const expected = Object.keys(CATALOG.entities).map((e) => `find_${e}`).sort();
    const actual = Object.keys(definition.actions).filter((a) => a.startsWith('find_')).sort();

    expect(actual).toEqual(expected);
  });

  it('exposes an action for every catalog action, and no others', () => {
    const expected: string[] = [];
    for (const [entityKey, entity] of Object.entries(CATALOG.entities)) {
      expected.push(`find_${entityKey}`);
      for (const actionKey of Object.keys(entity.actions ?? {})) {
        expected.push(`${actionKey}_${entityKey}`);
      }
    }

    expect(Object.keys(definition.actions).sort()).toEqual(expected.sort());
  });

  it('never advertises a field the catalog marks unreadable', () => {
    for (const [entityKey, entity] of Object.entries(CATALOG.entities)) {
      const hidden = Object.keys(entity.fields).filter((k) => entity.fields[k].readable === false);
      if (hidden.length === 0) continue;

      const advertised = definition.actions[`find_${entityKey}`].output_fields as string[];
      for (const field of hidden) {
        expect({ entityKey, field, advertised: advertised.includes(field) }).toEqual({
          entityKey,
          field,
          advertised: false,
        });
      }
    }
  });

  it('only offers writable fields in a write action\'s data', () => {
    for (const [entityKey, entity] of Object.entries(CATALOG.entities)) {
      for (const [actionKey, action] of Object.entries(entity.actions ?? {})) {
        // An action declaring PARAMETERS rather than columns has nothing to
        // check against the table — a message's subject, a weekday, a pair of
        // times. It says so with `writesRow: false`, and the catalog build
        // applies the same exemption.
        if (action.writesRow === false) continue;

        const params = definition.actions[`${actionKey}_${entityKey}`].parameters as {
          properties: { data?: { properties?: Record<string, unknown> } };
        };

        for (const field of Object.keys(params.properties.data?.properties ?? {})) {
          expect({ entityKey, actionKey, field, writable: entity.fields[field]?.writable }).toEqual({
            entityKey,
            actionKey,
            field,
            writable: true,
          });
        }
      }
    }
  });

  it('declares a fan-out cap for exactly the actions the catalog allows in bulk', () => {
    for (const [entityKey, entity] of Object.entries(CATALOG.entities)) {
      for (const [actionKey, action] of Object.entries(entity.actions ?? {})) {
        const published = definition.actions[`${actionKey}_${entityKey}`] as {
          rules?: { limits?: { max_fanout?: { condition: string } } };
        };
        const cap = published.rules?.limits?.max_fanout;

        if (action.allowBulk && action.maxFanout) {
          expect(cap?.condition).toBe(`targets > ${action.maxFanout}`);
        } else {
          // A cap on a non-bulk action would advertise bulk capability that the
          // executor refuses — a workflow would be generated and then fail.
          expect({ entityKey, actionKey, cap: cap ?? null }).toEqual({
            entityKey,
            actionKey,
            cap: null,
          });
        }
      }
    }
  });

  it('needs no connection — the credential is the user, not a token', () => {
    // `platform_key` is what makes this reachable without an OAuth flow, and
    // `isSystem` is the marker the other two connection-less plugins carry.
    expect(definition.plugin.auth_config.auth_type).toBe('platform_key');
    expect(definition.plugin.isSystem).toBe(true);
  });

  it('carries the keys every other plugin action carries', () => {
    // Matching the V2 shape is what lets the manager, the validator and the
    // generation pipeline treat this like the hand-written 23.
    const required = ['description', 'usage_context', 'parameters', 'output_schema', 'output_guidance'];

    for (const [name, action] of Object.entries(definition.actions)) {
      for (const key of required) {
        expect({ name, key, present: key in action }).toEqual({ name, key, present: true });
      }
    }
  });
});
