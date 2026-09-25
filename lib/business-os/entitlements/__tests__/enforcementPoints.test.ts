/**
 * The registry that makes the "no gate built yet" marker self-clearing (SA R-1).
 *
 * A note in a component that somebody has to remember to delete is not a
 * mechanism — it is a promise about a future code review. This suite is the
 * mechanism, and it works in both directions:
 *
 *   **Forward.** Every file `ENFORCEMENT_POINTS` names must exist and must
 *   actually contain the capability id it claims to gate. A registry entry is
 *   therefore a checkable claim, not a declaration.
 *
 *   **Backward.** A scan finds every file outside this module that names a
 *   capability id. If one appears that is not registered, this fails — so a
 *   gate cannot ship while the page still says none exists.
 *
 * The marker on the page disappears for a capability in the same commit that
 * makes it false, and cannot be removed before then.
 */

import * as fs from 'fs';
import * as path from 'path';

import { CAPABILITIES } from '@/lib/business-os/entitlements/config/catalog';
import {
  ENFORCEMENT_POINTS,
  hasEnforcementPoint,
} from '@/lib/business-os/entitlements/config/enforcementPoints';

const ROOT = process.cwd();
const CAPABILITY_IDS = Object.keys(CAPABILITIES);

/** Where a capability id may legitimately appear without being a gate. */
const NOT_A_GATE = [
  // The module itself: config, resolver, schema, report, the admin view.
  'lib/business-os/entitlements/',
  // Tests and fixtures anywhere.
  '__tests__/',
  '__fixtures__/',
  '__mocks__/',
  'tests/',
  // Documentation and SQL.
  'docs/',
  'supabase/',
  'scripts/',
];

/** Source files that could hold a gate. Walked, never listed. */
function productFiles(): string[] {
  const found: string[] = [];

  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const relative = full.replace(ROOT + path.sep, '').split(path.sep).join('/');

      if (entry.isDirectory()) {
        if (['node_modules', '.next', '.git', '.claude'].includes(entry.name)) continue;
        walk(full);
        continue;
      }
      if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) continue;
      if (NOT_A_GATE.some((prefix) => relative.startsWith(prefix) || relative.includes(prefix))) continue;
      found.push(relative);
    }
  };

  for (const dir of ['app', 'lib', 'components', 'hooks']) walk(path.join(ROOT, dir));
  return found.sort();
}

/**
 * Places a capability id appears for an unrelated reason.
 *
 * Checked by EQUALITY, like the FR-12 baseline: if one of these stops naming
 * the id, its entry must go in the same commit, so the list cannot go slack.
 * Each needs a reason — "it is noisy" is not one.
 */
const KNOWN_NON_GATES: ReadonlyArray<{ file: string; capability: string; why: string }> = [
  {
    file: 'lib/business-os/LanguageContext.tsx',
    capability: 'payments.invoices',
    why: 'A UI translation dictionary keyed by dotted strings. The key collides with the capability id by coincidence and gates nothing — it maps to the word "Invoices" in three languages.',
  },
];

const files = productFiles();
const read = (relative: string) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

/** Source with comments removed: prose about a capability is not a gate. */
function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('forward: every registered gate is a real one', () => {
  const entries = Object.entries(ENFORCEMENT_POINTS);

  it('registers only capabilities the catalog has', () => {
    for (const [capability] of entries) {
      expect({ capability, known: CAPABILITY_IDS.includes(capability) }).toEqual({
        capability,
        known: true,
      });
    }
  });

  it.each(entries.length > 0 ? entries : [['(none registered)', [] as readonly string[]]])(
    '%s is gated by files that exist and name it',
    (capability, gateFiles) => {
      if (capability === '(none registered)') {
        // Slice 1 wired no call site. This case exists so the suite states that
        // rather than passing silently on an empty list.
        expect(Object.keys(ENFORCEMENT_POINTS)).toEqual([]);
        return;
      }

      for (const file of gateFiles) {
        expect({ file, exists: fs.existsSync(path.join(ROOT, file)) }).toEqual({ file, exists: true });
        expect({ file, names: codeOf(read(file)).includes(capability) }).toEqual({ file, names: true });
      }
    }
  );
});

describe('backward: a gate cannot ship unregistered', () => {
  it('scans a non-trivial part of the product', () => {
    // A scan whose file list quietly stopped matching would pass for ever.
    expect(files.length).toBeGreaterThan(300);
  });

  it('finds no capability id in product code that the registry does not know about', () => {
    // This is the assertion that makes the page's marker trustworthy: the day
    // somebody writes the chat surface gate (FR-46), this fails until the
    // registry names it — and registering it is what clears the marker.
    const unregistered: string[] = [];

    for (const relative of files) {
      const code = codeOf(read(relative));
      for (const capability of CAPABILITY_IDS) {
        if (!code.includes(`'${capability}'`) && !code.includes(`"${capability}"`)) continue;
        if ((ENFORCEMENT_POINTS[capability] ?? []).includes(relative)) continue;
        if (KNOWN_NON_GATES.some((entry) => entry.file === relative && entry.capability === capability)) continue;
        unregistered.push(`${relative} names ${capability}`);
      }
    }

    expect(unregistered).toEqual([]);
  });

  /**
   * The literal scan alone is not enough (QA NEW-5).
   *
   * A plausible Slice 2 gate writes no capability id at all:
   *
   *     import { CHAT_SURFACE } from '@/lib/business-os/entitlements/…';
   *     const decision = decide({ capability: CHAT_SURFACE, … });
   *
   * The string lives in the entitlements module, which this scan excludes, so
   * nothing matches and the page would go on saying "no gate yet" for ever —
   * defeating the self-clearing property R-1 is built on.
   *
   * So the second rule is about REACHING the module at all. Anything outside it
   * that imports from it is either a gate, or something that must say why it is
   * not. That is a much coarser net, and it is the right coarseness: a file
   * cannot refuse a capability without talking to the resolver.
   */
  const ENTITLEMENT_IMPORT = /from\s+['"][^'"]*business-os\/entitlements\//;

  /**
   * Files that reach the module for a reason that is not a gate.
   *
   * Equality-checked like the other list: an entry that stops applying must be
   * removed in the same commit.
   */
  /**
   * Files that reach the module for a reason that is not a gate — and the exact
   * symbols each may import.
   *
   * ── Why symbols and not call names (QA R3-1) ───────────────────────────────
   * This was a DENYLIST: chat-v4 was asserted not to contain `decide(`,
   * `.check(`, `requireEntitlement` or `withEntitlement`. QA walked a plausible
   * FR-46 gate straight through it — `resolveEntitlements` imported, the call
   * named `qaChatSurfaceGate`, no capability literal anywhere — and all sixteen
   * tests stayed green while the page would have gone on saying "no gate yet".
   *
   * A denylist has to predict the name somebody will choose. An allow-list does
   * not: a gate has to reach the resolver **through some imported symbol**, and
   * every symbol here is one nobody can gate with. Adding an import to one of
   * these files now fails this suite until a human says which it is.
   *
   * Equality-checked, so an entry that stops applying must be removed in the
   * same commit.
   */
  const KNOWN_NON_GATE_IMPORTERS: ReadonlyArray<{
    file: string;
    symbols: readonly string[];
    why: string;
  }> = [
    {
      file: 'app/api/business-os/chat-v4/route.ts',
      // The one symbol that cannot refuse anything: it RECORDS what a plan
      // would have needed. This is the file the real gate will be added to
      // (FR-46), and the day it imports anything else this suite says so.
      symbols: ['shadowChatPlan'],
      why: 'SHADOW recording, not a gate: `shadowChatPlan` records what a plan WOULD have needed and can refuse nothing. On the day this file gains a gate it moves into ENFORCEMENT_POINTS, which is what clears the marker on the admin screen.',
    },
    {
      file: 'app/api/admin/business-os/entitlements/plans/route.ts',
      symbols: ['buildAdminPlansView'],
      why: 'The admin read endpoint. It renders the configuration for a screen and refuses nothing.',
    },
    {
      file: 'app/api/admin/business-os/entitlements/accounts/[accountId]/route.ts',
      symbols: [
        'adminOpSchema',
        'executeAdminOp',
        'isBusinessOsTenant',
        'describeCapabilityValue',
        'isGrantingValue',
        'getEntitlementConfig',
        'getEntitlementService',
        'CACHE_TTL_SECONDS',
        'resolveAccountId',
        'getEntitlementMode',
      ],
      why: 'The admin inspect-and-change endpoint. It reports and edits ONE account plan through the audited op union; it gates no product feature. `isGrantingValue` here answers a question for a screen, it does not refuse a request.',
    },
    {
      file: 'app/api/admin/business-os/entitlements/launch/route.ts',
      symbols: ['getEntitlementConfig'],
      why: 'The admin launch operation. Slice 2 owns its execution; it refuses no capability.',
    },
    {
      file: 'app/api/admin/business-os/entitlements/shadow-report/route.ts',
      symbols: ['buildShadowReport', 'getEntitlementMode'],
      why: 'The admin shadow report. It counts what WOULD be refused and refuses nothing itself.',
    },
    {
      file: 'app/api/admin/business-os/accounts/[accountId]/summary/route.ts',
      symbols: ['isBusinessOsTenant'],
      why: 'The admin Businesses panel summary (admin reorganisation slice 2b). It asks whether an account is a Business OS tenant so the panel can say "Not a Business OS account", using the same check as the entitlements route; it is read-only and refuses no capability.',
    },
  ];

  /** Every symbol a file imports from the entitlements module. */
  function entitlementImports(relative: string): string[] {
    const code = codeOf(read(relative));
    const found = new Set<string>();

    // `import { a, b as c } from '…/business-os/entitlements/…'`, across lines.
    for (const match of code.matchAll(
      /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"][^'"]*business-os\/entitlements\/[^'"]*['"]/g
    )) {
      for (const part of match[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/)[0].trim();
        if (name) found.add(name);
      }
    }

    // `import X from` and `import * as X from`, which would otherwise be
    // invisible to the rule above.
    for (const match of code.matchAll(
      /import\s+(?:\*\s+as\s+)?([A-Za-z_$][\w$]*)\s*(?:,\s*\{[^}]*\}\s*)?from\s*['"][^'"]*business-os\/entitlements\/[^'"]*['"]/g
    )) {
      found.add(match[1]);
    }

    return [...found].sort();
  }

  it('finds every file that reaches the entitlements module, and each is accounted for', () => {
    const importers = files.filter((relative) => ENTITLEMENT_IMPORT.test(codeOf(read(relative))));

    // Non-vacuity: the four admin routes import it today, so a scan finding
    // nothing would mean the regex stopped matching rather than that the
    // product stopped asking.
    expect(importers.length).toBeGreaterThanOrEqual(4);

    const unaccounted = importers.filter(
      (relative) =>
        !KNOWN_NON_GATE_IMPORTERS.some((entry) => entry.file === relative) &&
        !Object.values(ENFORCEMENT_POINTS).some((gateFiles) => gateFiles.includes(relative))
    );

    // A gate added in Slice 2 lands here whether or not it writes the id as a
    // literal, which is the property the marker depends on.
    expect(unaccounted).toEqual([]);
  });

  it.each(KNOWN_NON_GATE_IMPORTERS.map((entry) => [entry.file, entry.why] as const))(
    '%s still imports the module, for the reason recorded',
    (file, why) => {
      expect(ENTITLEMENT_IMPORT.test(codeOf(read(file)))).toBe(true);
      expect(why.length).toBeGreaterThan(30);
    }
  );

  it.each(KNOWN_NON_GATE_IMPORTERS.map((entry) => [entry.file, entry.symbols] as const))(
    '%s imports exactly the symbols its exemption allows',
    (file, symbols) => {
      // The assertion QA's mutation defeats if it is a denylist: a gate must
      // reach the resolver through SOME symbol, and none of these is one it can
      // be reached through. An extra import fails here, by name, until somebody
      // decides whether it is a gate.
      expect(entitlementImports(file)).toEqual([...symbols].sort());
    }
  );

  it('the symbol reader sees the shapes an import can take', () => {
    // Non-vacuity: a reader that silently returned [] would make every
    // assertion above pass on a file full of gates.
    expect(entitlementImports('app/api/business-os/chat-v4/route.ts')).toEqual(['shadowChatPlan']);
    expect(
      entitlementImports('app/api/admin/business-os/entitlements/accounts/[accountId]/route.ts').length
    ).toBeGreaterThan(5);
  });

  it('the import rule would catch a gate that writes no literal', () => {
    // The negative control, as the real thing would look. Both spellings, since
    // an alias and a relative path reach the same module.
    const aliased = "import { decide } from '@/lib/business-os/entitlements/decide';";
    const relative = "import { decide } from '../../lib/business-os/entitlements/decide';";
    const unrelated = "import { thing } from '@/lib/business-os/crm/contacts';";

    expect(ENTITLEMENT_IMPORT.test(aliased)).toBe(true);
    expect(ENTITLEMENT_IMPORT.test(relative)).toBe(true);
    expect(ENTITLEMENT_IMPORT.test(unrelated)).toBe(false);
  });

  it.each(KNOWN_NON_GATES.map((entry) => [entry.file, entry.capability, entry.why] as const))(
    '%s still names %s for the reason recorded',
    (file, capability, why) => {
      // The ratchet: an exemption that no longer applies must be removed, not
      // left behind to hide the next real hit in that file.
      expect(codeOf(read(file))).toContain(`'${capability}'`);
      expect(why.length).toBeGreaterThan(30);
    }
  );
});

describe('what the page reads', () => {
  it('reports no gate for every capability today, because none is built', () => {
    // Slice 1 resolves and records; it refuses nothing. If this ever starts
    // failing it is good news, and the page updates itself.
    for (const capability of CAPABILITY_IDS) {
      expect({ capability, gated: hasEnforcementPoint(capability) }).toEqual({
        capability,
        gated: false,
      });
    }
  });

  it('is total: an unknown capability is simply not gated, never a crash', () => {
    expect(hasEnforcementPoint('chat.telepathy')).toBe(false);
  });

  it('would report a gate the moment one is registered — through the real function', () => {
    // QA NEW-6: this used to build a record and assert its own array was
    // non-empty, never calling `hasEnforcementPoint` at all. It reduced to
    // `expect(true).toBe(true)` while reading as coverage of the mechanism.
    const registered: Record<string, readonly string[]> = {
      'chat.access': ['app/api/business-os/chat/route.ts'],
    };

    expect(hasEnforcementPoint('chat.access', registered)).toBe(true);
    expect(hasEnforcementPoint('crm.core', registered)).toBe(false);
    // An entry with no files is not a gate: the page must not clear its marker
    // because somebody wrote the key and nothing else.
    expect(hasEnforcementPoint('chat.access', { 'chat.access': [] })).toBe(false);
  });
});
