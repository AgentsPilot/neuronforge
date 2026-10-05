/**
 * "Set by" has plain words for every allowance layer the server can send
 * (user UI fixes to credit deduction slice 11c, 2026-10-04).
 *
 * The union is read from the server's own declaration of
 * `AdminCreditAllowanceLayer`, because Jest here transpiles without type
 * checks: `Record<CreditAllowanceLayerView, string>` alone would only fail
 * under tsc. A new layer without words is a red test, not a raw code on screen
 * (it would still render, as its raw value, through `allowanceLayerLabel`).
 */

import * as fs from 'fs';
import * as path from 'path';

import { ALLOWANCE_LAYER_COPY, allowanceLayerLabel } from '../creditCopy';

const SERVER_TYPES = 'lib/business-os/credits/adminCreditPositionTypes.ts';
const CLIENT_TYPES = 'app/admin/users/types.ts';

function unionOf(file: string, typeName: string): string[] {
  const source = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
  const match = new RegExp(`export type ${typeName}\\s*=([^;]+);`).exec(source);
  if (!match) throw new Error(`${typeName} not found in ${file}`);
  return [...match[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
}

describe('allowance layer copy', () => {
  const serverLayers = unionOf(SERVER_TYPES, 'AdminCreditAllowanceLayer');

  it('reads a non-empty union from the server types', () => {
    expect(serverLayers.length).toBeGreaterThan(0);
  });

  it('has words for exactly the layers the server can send', () => {
    expect(Object.keys(ALLOWANCE_LAYER_COPY).sort()).toEqual(serverLayers);
    expect(unionOf(CLIENT_TYPES, 'CreditAllowanceLayerView')).toEqual(serverLayers);
  });

  it('never shows a raw layer code for a known layer, and short wording', () => {
    for (const layer of serverLayers) {
      const words = allowanceLayerLabel(layer);
      expect(words).not.toBe(layer);
      expect(words).not.toMatch(/_/);
      expect(words.length).toBeLessThanOrEqual(40);
    }
  });

  it('an unknown layer shows its raw value', () => {
    expect(allowanceLayerLabel('brand_new_layer')).toBe('brand_new_layer');
    expect(allowanceLayerLabel('toString')).toBe('toString');
  });
});
