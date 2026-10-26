/**
 * Export module map (MX-0; BUSINESS_OS_EXPORT_MX0_WORKPLAN.md §5 T-1…T-13,
 * SA conditions C-1…C-9; requirement BUSINESS_OS_EXPORT_REDESIGN_REQUIREMENT.md
 * §4.1, §7 MX-0, XC-21).
 *
 * Every rule of `exportModuleProblems` is run twice: once over the real map
 * and the real descriptors / registry, once over a planted bad input (the
 * negative control), so an assertion that cannot fail is visible. The real
 * inputs are derived at run time; nothing here pins a descriptor count
 * (SA C-6: other streams add descriptors).
 *
 * The drawer-hides and route-refuses halves of "a module switched off" are
 * MX-1b's tests (SA C-9); this file proves the helper and schema half.
 */

import fs from 'fs';
import path from 'path';

// sections.ts imports the repositories; only its registry is read here (SA C-7).
jest.mock('@/lib/repositories/UserProfileRepository', () => ({ userProfileRepository: {} }));
jest.mock('@/lib/repositories/BusinessDataExportRepository', () => ({ businessDataExportRepository: {} }));

import { PURGE_DESCRIPTORS } from '@/lib/business-os/purge/descriptors';
import type { PurgeDescriptor } from '@/lib/business-os/purge/types';
import { EXPORT_SECTIONS } from '@/lib/business-os/data-export/sections';
import { NON_TABLE_SECTIONS } from '@/lib/business-os/data-export/classificationTypes';
import { viaParentOf } from '@/lib/business-os/data-export/classification';
import {
  EXPORT_MODULE_IDS,
  EXPORT_MODULES,
  enabledModules,
  exportModuleProblems,
  isModuleEnabled,
  moduleOfSection,
  sectionsOfModule,
  type ExportModuleDefinition,
  type ExportModuleRuleInputs,
  type ExportModuleRuleModule,
} from '@/lib/business-os/data-export/exportModules';
import { ExportModuleIdSchema, requestedModulesSchema } from '@/lib/business-os/data-export/exportModuleSchema';

// ── Inputs ──────────────────────────────────────────────────────────────────

/** Declared "needs" pairs (old SA-8; MX0-5: kept here, not in the map). */
const DECLARED_REQUIRES: readonly { section: string; requires: string }[] = [
  { section: 'email_sequence_steps', requires: 'email_sequences' },
  { section: 'email_sequence_enrollments', requires: 'email_sequences' },
];

/**
 * The rule's inputs from a descriptor set. `viaParent.parent` is a TABLE
 * name, so the parent's section is resolved through the descriptors with
 * `viaParentOf` (which fails closed), never assumed equal (SA C-5).
 */
function inputsFrom(descriptors: readonly PurgeDescriptor[]): ExportModuleRuleInputs {
  const includeSections: string[] = [];
  const viaParentLinks: { childSection: string; parentSection: string }[] = [];
  for (const d of descriptors) {
    if (d.export.kind !== 'include') continue;
    includeSections.push(d.export.section);
    if (d.export.viaParent === undefined) continue;
    const parent: PurgeDescriptor | undefined = viaParentOf(d, descriptors);
    if (!parent) throw new Error(`${d.table}: viaParent parent table ${d.export.viaParent.parent} has no descriptor`);
    if (parent.export.kind !== 'include') throw new Error(`${d.table}: viaParent parent is not an include`);
    viaParentLinks.push({ childSection: d.export.section, parentSection: parent.export.section });
  }
  return {
    registeredSections: EXPORT_SECTIONS.map((s) => s.id),
    includeSections,
    nonTableSections: Object.keys(NON_TABLE_SECTIONS),
    viaParentLinks,
    declaredRequires: DECLARED_REQUIRES,
  };
}

const REAL_INPUTS = inputsFrom(PURGE_DESCRIPTORS);

/** A mutable copy of the real map in the rule's loose shape, for planting. */
function looseMap(): ExportModuleRuleModule[] {
  return EXPORT_MODULES.map((m) => ({ ...m, name: { ...m.name }, sections: [...m.sections] }));
}

function withModule(
  map: ExportModuleRuleModule[],
  id: string,
  change: (m: ExportModuleRuleModule) => ExportModuleRuleModule
): ExportModuleRuleModule[] {
  return map.map((m) => (m.id === id ? change(m) : m));
}

/** Moves a section from wherever it is to `target`. */
function moveSection(section: string, target: string): ExportModuleRuleModule[] {
  return looseMap().map((m) => {
    const without = m.sections.filter((s) => s !== section);
    return { ...m, sections: m.id === target ? [...without, section] : without };
  });
}

// ── T-1 … T-10: the CI rule ─────────────────────────────────────────────────

describe('export module map: CI rule over the real map', () => {
  it('T-1: the real map has no problems', () => {
    expect(exportModuleProblems(EXPORT_MODULES, REAL_INPUTS)).toEqual([]);
  });

  it('T-2: every registered section is in exactly one module (non-vacuous: 13 modules, 39 sections)', () => {
    const mapped = EXPORT_MODULES.flatMap((m) => m.sections);
    expect(EXPORT_MODULES).toHaveLength(13);
    expect(mapped).toHaveLength(39);
    expect(new Set(mapped).size).toBe(mapped.length);
    expect([...mapped].sort()).toEqual(EXPORT_SECTIONS.map((s) => s.id).sort());
  });

  it('T-2 control: a section left out is reported (R-4)', () => {
    const map = withModule(looseMap(), 'website', (m) => ({ ...m, sections: m.sections.filter((s) => s !== 'images') }));
    expect(exportModuleProblems(map, REAL_INPUTS)).toEqual(['section images: in no module']);
  });

  it('T-2 control: a section in two modules is reported (R-3)', () => {
    const map = withModule(looseMap(), 'services', (m) => ({ ...m, sections: [...m.sections, 'clients'] }));
    expect(exportModuleProblems(map, REAL_INPUTS)).toEqual(['section clients: in two modules (clients, services)']);
  });

  it('T-2 control: a section twice in one module is reported (R-3)', () => {
    const map = withModule(looseMap(), 'quotes', (m) => ({ ...m, sections: [...m.sections, 'quotes'] }));
    expect(exportModuleProblems(map, REAL_INPUTS)).toEqual(['section quotes: listed twice in module quotes']);
  });

  it('T-3: every include descriptor section is in the map', () => {
    expect(REAL_INPUTS.includeSections.length).toBeGreaterThan(0);
    for (const s of REAL_INPUTS.includeSections) expect(moduleOfSection(s)).not.toBeNull();
  });

  it('T-3 control: a new include on a section neither registered nor mapped is reported (R-4, SA C-4)', () => {
    // Equivalent to a descriptor copy with one extra include: includeSections
    // is all the rule reads from the descriptors.
    const planted: ExportModuleRuleInputs = {
      ...REAL_INPUTS,
      includeSections: [...REAL_INPUTS.includeSections, 'planted_new_section'],
    };
    expect(exportModuleProblems(EXPORT_MODULES, planted)).toEqual(['section planted_new_section: in no module']);
  });

  it('T-4: every mapped section is backed by exactly one include descriptor or is a non-table section', () => {
    const counts = new Map<string, number>();
    for (const s of REAL_INPUTS.includeSections) counts.set(s, (counts.get(s) ?? 0) + 1);
    for (const s of EXPORT_MODULES.flatMap((m) => m.sections)) {
      const isNonTable = s in NON_TABLE_SECTIONS;
      expect({ s, ok: isNonTable ? (counts.get(s) ?? 0) === 0 : counts.get(s) === 1 }).toEqual({ s, ok: true });
    }
  });

  it('T-4 control: a never-exported table planted into a switched-on module is reported (R-5 + R-6)', () => {
    const map = withModule(looseMap(), 'website', (m) => ({
      ...m,
      on: true,
      sections: [...m.sections, 'plugin_connections', 'website_page_views'],
    }));
    expect(exportModuleProblems(map, REAL_INPUTS)).toEqual([
      'section plugin_connections (module website): not a registered section',
      'section plugin_connections (module website): not exportable (0 include descriptors)',
      'section website_page_views (module website): not a registered section',
      'section website_page_views (module website): not exportable (0 include descriptors)',
    ]);
  });

  it('T-4 control: a mapped section whose descriptor is flipped to exclude is reported (R-6)', () => {
    const flipped = PURGE_DESCRIPTORS.map((d): PurgeDescriptor =>
      d.export.kind === 'include' && d.export.section === 'smart_links'
        ? { ...d, export: { kind: 'exclude', reason: 'planted for the negative control' } }
        : d
    );
    expect(exportModuleProblems(EXPORT_MODULES, inputsFrom(flipped))).toEqual([
      'section smart_links (module smart_links): not exportable (0 include descriptors)',
    ]);
  });

  it('T-5 control: an unknown section id is reported (R-5)', () => {
    const map = withModule(looseMap(), 'forms', (m) => ({ ...m, sections: [...m.sections, 'not_a_section'] }));
    expect(exportModuleProblems(map, REAL_INPUTS)).toContain('section not_a_section (module forms): not a registered section');
  });

  it('T-6 control: a duplicate id, a bad id and an empty module are reported (R-1, R-2)', () => {
    const dup = withModule(looseMap(), 'quotes', (m) => ({ ...m, id: 'services' }));
    expect(exportModuleProblems(dup, REAL_INPUTS)).toContain('module services: duplicate id');

    const bad = withModule(looseMap(), 'quotes', (m) => ({ ...m, id: 'Bad-Id' }));
    expect(exportModuleProblems(bad, REAL_INPUTS)).toEqual(['module "Bad-Id": id is not well-formed']);

    const empty = [...looseMap(), { id: 'empty_module', name: { en: 'Empty', he: 'ריק', es: 'Vacío' }, sections: [], on: true }];
    expect(exportModuleProblems(empty, REAL_INPUTS)).toEqual(['module empty_module: has no sections']);
  });

  it('T-7: every module has en, he and es names, he with a Hebrew letter', () => {
    for (const m of EXPORT_MODULES) {
      expect(m.name.en.trim()).not.toBe('');
      expect(m.name.es.trim()).not.toBe('');
      expect(m.name.he).toMatch(/[א-ת]/);
    }
  });

  it('T-7 control: an empty es, a Latin-only he and a shared en name are reported (R-7)', () => {
    const noEs = withModule(looseMap(), 'forms', (m) => ({ ...m, name: { ...m.name, es: ' ' } }));
    expect(exportModuleProblems(noEs, REAL_INPUTS)).toEqual(['module forms: no es name']);

    const latinHe = withModule(looseMap(), 'forms', (m) => ({ ...m, name: { ...m.name, he: 'Forms' } }));
    expect(exportModuleProblems(latinHe, REAL_INPUTS)).toEqual(['module forms: he name has no Hebrew letter']);

    const sameEn = withModule(looseMap(), 'services', (m) => ({ ...m, name: { ...m.name, en: 'Clients' } }));
    expect(exportModuleProblems(sameEn, REAL_INPUTS)).toEqual(['module services: en name "Clients" also used by clients']);
  });

  it('T-8: module ids are pinned, and the map follows the tuple in order (ids are durable from MX-1a; a rename needs SA)', () => {
    expect([...EXPORT_MODULE_IDS]).toEqual([
      'clients',
      'activities_tasks',
      'bookings',
      'services',
      'quotes',
      'invoices_payments',
      'payment_plans',
      'forms',
      'email_campaigns',
      'newsletter_subscribers',
      'website',
      'smart_links',
      'account_business',
    ]);
    expect(EXPORT_MODULES.map((m) => m.id)).toEqual([...EXPORT_MODULE_IDS]);
  });

  it('T-9: viaParent children share their parent section module (website_blocks -> website_pages)', () => {
    expect(REAL_INPUTS.viaParentLinks.length).toBeGreaterThan(0);
    expect(REAL_INPUTS.viaParentLinks).toContainEqual({ childSection: 'website_blocks', parentSection: 'website_pages' });
    for (const link of REAL_INPUTS.viaParentLinks) {
      expect(moduleOfSection(link.childSection)).toBe(moduleOfSection(link.parentSection));
    }
  });

  it('T-9 control: a viaParent child moved to another module is reported (R-8)', () => {
    expect(exportModuleProblems(moveSection('website_blocks', 'smart_links'), REAL_INPUTS)).toEqual([
      'viaParent: section website_blocks (module smart_links) is not in the module of website_pages (module website)',
    ]);
  });

  it('T-10 control: a declared requires pair split across modules is reported (R-9)', () => {
    expect(exportModuleProblems(moveSection('email_sequence_steps', 'forms'), REAL_INPUTS)).toEqual([
      'requires: section email_sequence_steps (module forms) is not in the module of email_sequences (module email_campaigns)',
    ]);
  });
});

// ── T-11: helpers ───────────────────────────────────────────────────────────

/**
 * Injected maps (QA-1): the helper and schema tests never assume the REAL map
 * is all on, so switching a real module off does not break them.
 */
const ALL_ON: readonly ExportModuleDefinition[] = EXPORT_MODULES.map((m) => ({ ...m, on: true }));
const WEBSITE_OFF: readonly ExportModuleDefinition[] = ALL_ON.map((m) => (m.id === 'website' ? { ...m, on: false } : m));

describe('export module map: helpers', () => {
  it('enabledModules keeps map order and drops a switched-off module', () => {
    expect(enabledModules(ALL_ON).map((m) => m.id)).toEqual([...EXPORT_MODULE_IDS]);
    expect(enabledModules(WEBSITE_OFF).map((m) => m.id)).toEqual(EXPORT_MODULE_IDS.filter((id) => id !== 'website'));
  });

  it('isModuleEnabled is false for an unknown id and for a switched-off module', () => {
    expect(isModuleEnabled('clients', ALL_ON)).toBe(true);
    expect(isModuleEnabled('website', ALL_ON)).toBe(true);
    expect(isModuleEnabled('website', WEBSITE_OFF)).toBe(false);
    expect(isModuleEnabled('not_a_module', ALL_ON)).toBe(false);
  });

  it('moduleOfSection finds every registered section and returns null for an unknown one', () => {
    for (const s of EXPORT_SECTIONS) expect(moduleOfSection(s.id)).not.toBeNull();
    expect(moduleOfSection('website_blocks')).toBe('website');
    expect(moduleOfSection('not_a_section')).toBeNull();
  });

  it('sectionsOfModule returns map order, and nothing for an unknown id', () => {
    expect(sectionsOfModule('clients')).toEqual(['clients', 'pipeline_stages', 'client_documents']);
    expect(sectionsOfModule('not_a_module')).toEqual([]);
  });
});

// ── T-12: schemas ───────────────────────────────────────────────────────────

describe('export module map: schemas', () => {
  it('ExportModuleIdSchema accepts map ids only', () => {
    expect(ExportModuleIdSchema.safeParse('clients').success).toBe(true);
    expect(ExportModuleIdSchema.safeParse('plugin_connections').success).toBe(false);
  });

  it('requestedModulesSchema accepts one module and all 13', () => {
    expect(requestedModulesSchema(ALL_ON).safeParse(['clients']).success).toBe(true);
    expect(requestedModulesSchema(ALL_ON).safeParse([...EXPORT_MODULE_IDS]).success).toBe(true);
  });

  it.each<[string, unknown]>([
    ['an empty list', []],
    ['an unknown id', ['not_a_module']],
    ['a duplicate', ['clients', 'clients']],
    ['a non-string', [1]],
    ['not an array', 'clients'],
  ])('requestedModulesSchema refuses %s', (_label, input) => {
    expect(requestedModulesSchema().safeParse(input).success).toBe(false);
  });

  it('requestedModulesSchema refuses more than the map holds', () => {
    const result = requestedModulesSchema().safeParse([...EXPORT_MODULE_IDS, 'clients']);
    expect(result.success).toBe(false);
    expect(result.success ? [] : result.error.issues.map((i) => i.code)).toContain('too_big');
  });

  it('requestedModulesSchema refuses a switched-off module (injected map)', () => {
    expect(requestedModulesSchema(WEBSITE_OFF).safeParse(['website']).success).toBe(false);
    expect(requestedModulesSchema(WEBSITE_OFF).safeParse(['clients']).success).toBe(true);
  });
});

// ── T-13: purity ────────────────────────────────────────────────────────────

interface ImportRule {
  /** True when an import of `from` (type-only or not) is allowed. */
  isAllowed: (from: string, isTypeOnly: boolean) => boolean;
}

/**
 * Problems with a source's imports, as a pure function over a string so the
 * control can be a planted string (SA C-7). CRLF is normalised first (the
 * Windows source-scan flake). Matches single- and multi-line `import` and
 * `export … from`; any `require(`, dynamic `import(` or quoted `'server-only'`
 * is a problem regardless of the rule.
 */
function importProblems(rawSource: string, rule: ImportRule): string[] {
  const source = rawSource.replace(/\r\n/g, '\n');
  const problems: string[] = [];
  const statements = [
    /^[ \t]*import\s+(type\s+)?(?:[\w*{}\s,]+?\s+from\s+)?['"]([^'"]+)['"]/gm,
    /^[ \t]*export\s+(type\s+)?(?:\*|\{[\w\s,]*\})\s+from\s+['"]([^'"]+)['"]/gm,
  ];
  for (const pattern of statements) {
    for (const match of source.matchAll(pattern)) {
      const from = match[2];
      if (!rule.isAllowed(from, match[1] !== undefined)) problems.push(`import not allowed: ${from}${match[1] ? ' (type)' : ''}`);
    }
  }
  if (/\brequire\s*\(/.test(source)) problems.push('uses require(');
  if (/\bimport\s*\(/.test(source)) problems.push('uses a dynamic import');
  // A quoted module name, not a word in a comment: the headers explain why
  // the files have no server-only import.
  if (/['"]server-only['"]/.test(source)) problems.push('names the server-only module');
  return problems;
}

const MAP_RULE: ImportRule = {
  isAllowed: (from, isTypeOnly) => isTypeOnly && from === '@/lib/business-os/data-export/classificationTypes',
};
const SCHEMA_RULE: ImportRule = {
  isAllowed: (from) => from === 'zod' || from === '@/lib/business-os/data-export/exportModules',
};

function readSource(file: string): string {
  return fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
}

describe('export module map: purity (T-13)', () => {
  it('exportModules.ts has one type-only import from classificationTypes and nothing at runtime', () => {
    const source = readSource('exportModules.ts');
    expect(source).toContain("import type { ExportSectionId } from '@/lib/business-os/data-export/classificationTypes'");
    expect(importProblems(source, MAP_RULE)).toEqual([]);
  });

  it('exportModuleSchema.ts imports only zod and the map', () => {
    expect(importProblems(readSource('exportModuleSchema.ts'), SCHEMA_RULE)).toEqual([]);
  });

  it('control: planted imports are reported (CRLF, multi-line, runtime from classificationTypes, server-only)', () => {
    const planted = [
      "import type { ExportSectionId } from '@/lib/business-os/data-export/classificationTypes';",
      "import { NON_TABLE_SECTIONS } from '@/lib/business-os/data-export/classificationTypes';",
      'import {',
      '  PURGE_DESCRIPTORS,',
      "} from '@/lib/business-os/purge/descriptors';",
      "import 'server-only';",
      'import "server-only";',
      "import { z } from 'zod';",
      "export * from '@/lib/business-os/data-export/sections';",
    ].join('\r\n');
    expect(importProblems(planted, MAP_RULE)).toEqual([
      'import not allowed: @/lib/business-os/data-export/classificationTypes',
      'import not allowed: @/lib/business-os/purge/descriptors',
      'import not allowed: server-only',
      'import not allowed: server-only',
      'import not allowed: zod',
      'import not allowed: @/lib/business-os/data-export/sections',
      'names the server-only module',
    ]);
    expect(importProblems("const x = require('fs');", MAP_RULE)).toEqual(['uses require(']);
  });
});
