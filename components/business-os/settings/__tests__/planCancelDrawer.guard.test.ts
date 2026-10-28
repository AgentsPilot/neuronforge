/**
 * Source guards for the plan Cancel drawer (account-deletion lifecycle SX-2 /
 * D3; workplan §7; SA Q-1, R-6).
 *
 *   - the drawer posts the reason CODE to the cancel route (`reasonCode` stays
 *     optional in the route, SA Q-1, so this guard is what keeps every UI
 *     sender honest until the first engine owner after D3 makes it required);
 *   - no file in Settings posts `{}` to the cancel route any more;
 *   - the drawer, `PlanManage` and the payload mirror import nothing from the
 *     entitlements module (upgrade modal C-6).
 */

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const DIR = join(process.cwd(), 'components', 'business-os', 'settings');
const read = (file: string) => readFileSync(join(DIR, file), 'utf8');
const codeOnly = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the cancel request', () => {
  it('the drawer posts `{ ...requestExtra, reasonCode }` to PLAN_CANCEL_PATH, the code last', () => {
    expect(codeOnly(read('PlanCancelDrawer.tsx'))).toMatch(/postPlanManage\(PLAN_CANCEL_PATH, \{ \.\.\.requestExtra, reasonCode: reason \}\)/);
  });

  it('no Settings file posts to the cancel route without a reason code', () => {
    const files = readdirSync(DIR).filter((file) => /\.tsx?$/.test(file));
    const senders = files.filter((file) => codeOnly(read(file)).includes('PLAN_CANCEL_PATH,'));
    expect(senders).toEqual(['PlanCancelDrawer.tsx']);
    expect(codeOnly(read('PlanManage.tsx'))).not.toMatch(/PLAN_CANCEL_PATH/);
  });

  it('PlanManage posts `{}` only to the reactivate route', () => {
    expect(codeOnly(read('PlanManage.tsx'))).toMatch(/postPlanManage\(PLAN_REACTIVATE_PATH, \{\}\)/);
  });
});

describe('no reach into the entitlements module (C-6)', () => {
  it.each(['PlanCancelDrawer.tsx', 'PlanManage.tsx', 'planPayloadTypes.ts', 'planManageRequest.ts'])('%s', (file) => {
    expect(read(file)).not.toMatch(/from ['"][^'"]*business-os\/entitlements/);
  });
});
