/**
 * MX-2b column labels (BUSINESS_OS_EXPORT_MX2B_WORKPLAN.md §5 T-L1…T-L14, SA
 * Workplan Review 2026-10-28 R-1…R-3; requirement
 * BUSINESS_OS_EXPORT_REDESIGN_REQUIREMENT.md §4.2, §4.3, BQ-31).
 *
 * Every rule of `columnLabelProblems` runs over the real set (T-L1) and over a
 * planted bad set (its negative control), so an assertion that cannot fail is
 * visible. L-1, L-2 and L-5 are the plan's required rules; L-3, L-4 and
 * L-6…L-9 get one control each (SA MX2B-6 cap). The real inputs are derived
 * at run time; nothing pins a column count.
 */
import fs from 'fs';
import path from 'path';

// sections.ts imports the repositories; only its registry is read here.
jest.mock('@/lib/repositories/UserProfileRepository', () => ({ userProfileRepository: {} }));
jest.mock('@/lib/repositories/BusinessDataExportRepository', () => ({ businessDataExportRepository: {} }));

import { CSV_BOM, csvPartText } from '@/lib/business-os/data-export/csv';
import { EXPORT_MODULES, type ExportModuleId, type ExportModuleLanguage } from '@/lib/business-os/data-export/exportModules';
import { EXPORT_SECTIONS } from '@/lib/business-os/data-export/sections';
import {
  JOINED_CSV_FIXED_COLUMNS,
  buildJoinedCsv,
  classifiedColumnsOf,
  type JoinedCsvLabels,
} from '@/lib/business-os/data-export/joinedCsv';
import {
  EXPORT_COLUMN_LABELS,
  REAL_COLUMN_LABELS,
  columnLabelProblems,
  columnLabelText,
  joinedCsvLabelsFrom,
  type ColumnLabelRuleInputs,
  type ColumnLabelSet,
  type LooseLabelText,
} from '@/lib/business-os/data-export/columnLabels';

// ── Inputs and helpers ──────────────────────────────────────────────────────

const LANGUAGES: readonly ExportModuleLanguage[] = ['en', 'he', 'es'];

const REAL_INPUTS: ColumnLabelRuleInputs = {
  modules: EXPORT_MODULES.map((m) => ({ id: m.id, sections: m.sections })),
  registeredSections: EXPORT_SECTIONS.map((s) => s.id),
  columnsBySection: Object.fromEntries(EXPORT_MODULES.flatMap((m) => m.sections.map((s) => [s, classifiedColumnsOf(s)]))),
  fixedKeys: JOINED_CSV_FIXED_COLUMNS,
};

const problems = (set: ColumnLabelSet, inputs: ColumnLabelRuleInputs = REAL_INPUTS): string[] => columnLabelProblems(set, inputs);
const withRule = (list: string[], rule: string): string[] => list.filter((p) => p.startsWith(`${rule} `));

/** The real set with some tables replaced (shallow). */
function planted(over: Partial<ColumnLabelSet>): ColumnLabelSet {
  return { ...REAL_COLUMN_LABELS, ...over };
}
function byKeyWith(key: string, label: LooseLabelText | undefined): ColumnLabelSet {
  const byKey: Record<string, LooseLabelText> = { ...REAL_COLUMN_LABELS.byKey };
  if (label === undefined) delete byKey[key];
  else byKey[key] = label;
  return planted({ byKey });
}
const realKey = (key: string): LooseLabelText => {
  const label = REAL_COLUMN_LABELS.byKey[key];
  if (label === undefined) throw new Error(`no real label for ${key}`);
  return label;
};

/** RFC 4180 parse of ONE encoded line. */
function parseLine(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      cells.push(cell);
      cell = '';
    } else cell += ch;
  }
  cells.push(cell);
  return cells;
}

const KEY_ECHO: JoinedCsvLabels = { fixed: (k) => k, recordType: (s) => s, column: (_s, k) => k };

// ── T-L1: the real set ──────────────────────────────────────────────────────

describe('T-L1 the real labels', () => {
  it('columnLabelProblems over the real set and inputs is empty', () => {
    expect(problems(REAL_COLUMN_LABELS)).toEqual([]);
  });
});

// ── T-L2 / T-L3: L-1 coverage and L-2 every language (required) ─────────────

describe('T-L2 L-1 coverage over every section.column pair', () => {
  it('every include column of every section, id aside, resolves to a label with en and he', () => {
    const missing: string[] = [];
    for (const m of EXPORT_MODULES) {
      for (const section of m.sections) {
        for (const column of classifiedColumnsOf(section)) {
          if (column === 'id') continue;
          const label = columnLabelText(section, column);
          if (!label || label.en.trim() === '' || label.he.trim() === '') missing.push(`${section}.${column}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('negative control: a column whose he is removed is reported', () => {
    const real = realKey('stage_entered_at');
    const noHe: LooseLabelText = { en: real.en, es: real.es };
    expect(withRule(problems(byKeyWith('stage_entered_at', noHe)), 'L-1')).toEqual(['L-1 clients.stage_entered_at: no he label']);
  });

  it('negative control: a deleted key entry is reported for every section that uses it', () => {
    const found = withRule(problems(byKeyWith('priority', undefined)), 'L-1');
    expect(found).toEqual(['L-1 client_tasks.priority: no label']);
  });

  it('negative control: a planted include column with no label is reported', () => {
    const inputs: ColumnLabelRuleInputs = {
      ...REAL_INPUTS,
      columnsBySection: { ...REAL_INPUTS.columnsBySection, services: [...classifiedColumnsOf('services'), 'brand_new_column'] },
    };
    expect(withRule(problems(REAL_COLUMN_LABELS, inputs), 'L-1')).toEqual(['L-1 services.brand_new_column: no label']);
  });

  it('negative control: a removed record type is reported', () => {
    const recordTypes: Record<string, LooseLabelText> = { ...REAL_COLUMN_LABELS.recordTypes };
    delete recordTypes.refunds;
    expect(withRule(problems(planted({ recordTypes })), 'L-1')).toEqual(['L-1 refunds: no record type']);
  });
});

describe('T-L3 L-2 every language present', () => {
  it('negative control: an es of spaces is reported', () => {
    const found = withRule(problems(byKeyWith('tags', { ...realKey('tags'), es: '   ' })), 'L-2');
    expect(found).toEqual(['L-2 key.tags: es missing or blank']);
  });

  it('negative control: a fixed label with no en is reported', () => {
    const fixed: Record<string, LooseLabelText> = { ...REAL_COLUMN_LABELS.fixed, record_id: { he: 'מזהה רשומה', es: 'ID del registro' } };
    expect(withRule(problems(planted({ fixed })), 'L-2')).toEqual(['L-2 fixed.record_id: en missing or blank']);
  });
});

// ── T-L4…T-L10: the extra rules, one control each (SA MX2B-6) ──────────────

describe('T-L4 L-3 Hebrew reads right-to-left', () => {
  it('negative control: Latin before the first Hebrew letter, and no Hebrew letter at all, are reported', () => {
    const latinFirst = byKeyWith('stripe_email', { ...realKey('stripe_email'), he: 'Stripe אימייל' });
    expect(withRule(problems(latinFirst), 'L-3')).toEqual(['L-3 key.stripe_email: he starts with a Latin letter']);
    const noHebrew = byKeyWith('color', { ...realKey('color'), he: 'Color' });
    expect(withRule(problems(noHebrew), 'L-3')).toEqual(['L-3 key.color: he has no Hebrew letter']);
  });
});

describe('T-L5 L-4 clean text', () => {
  it('negative control: a leading =, a line feed and an RLM (built from a char code) are each reported', () => {
    expect(withRule(problems(byKeyWith('color', { ...realKey('color'), en: '=Color' })), 'L-4')).toEqual(['L-4 key.color: en starts with =']);
    const lf = `Co${String.fromCharCode(10)}lor`;
    expect(withRule(problems(byKeyWith('color', { ...realKey('color'), es: lf })), 'L-4')).toEqual(['L-4 key.color: es holds char code 10']);
    const rlm = `צבע${String.fromCharCode(0x200f)}`;
    expect(withRule(problems(byKeyWith('color', { ...realKey('color'), he: rlm })), 'L-4')).toEqual(['L-4 key.color: he holds char code 8207']);
  });
});

describe('T-L6 L-5 unique headers per module (required)', () => {
  it('negative control: two keys of one module with the same en are reported', () => {
    const found = withRule(problems(byKeyWith('last_name', { ...realKey('last_name'), en: 'First name' })), 'L-5');
    expect(found).toEqual(['L-5 module clients en: first_name / last_name: "First name"']);
  });

  it('negative control: the same text differing only in case and spacing is reported', () => {
    const found = withRule(problems(byKeyWith('last_name', { ...realKey('last_name'), es: ' nombre DE PILA' })), 'L-4');
    expect(found).toEqual(['L-4 key.last_name: es leading or trailing space']);
    const caseOnly = withRule(problems(byKeyWith('last_name', { ...realKey('last_name'), es: 'nombre DE PILA' })), 'L-5');
    expect(caseOnly).toEqual(['L-5 module clients es: first_name / last_name: "nombre DE PILA"']);
  });

  it('negative control: a column labelled like a fixed header ("Record ID") is reported', () => {
    const found = withRule(problems(byKeyWith('priority', { ...realKey('priority'), en: 'Record ID' })), 'L-5');
    expect(found).toEqual(['L-5 module activities_tasks en: fixed.record_id / priority: "Record ID"']);
  });

  it('boundary: the same text in two different modules is not reported', () => {
    // brand (invoices_payments) and card_brand (payment_plans) already share "Card brand".
    expect(realKey('brand').en).toBe(realKey('card_brand').en);
    expect(withRule(problems(REAL_COLUMN_LABELS), 'L-5')).toEqual([]);
  });

  it('a parent-only key is still counted (no C-2 dependency)', () => {
    // client_documents.contact_id leaves the Clients header (C-2) but is labelled "Client".
    const found = withRule(problems(byKeyWith('contact_id', { ...realKey('contact_id'), en: 'Name' })), 'L-5');
    expect(found).toContain('L-5 module clients en: contact_id / name: "Name"');
  });
});

describe('T-L7 L-6 a shared key has one meaning in its module', () => {
  it('negative control: a section entry giving a shared key another text in one section is reported', () => {
    const bySection = { ...REAL_COLUMN_LABELS.bySection, client_tasks: { title: { en: 'Task title', he: 'כותרת המשימה', es: 'Título de la tarea' } } };
    expect(withRule(problems(planted({ bySection })), 'L-6')).toEqual([
      'L-6 module activities_tasks: title has different en labels in client_activities, client_tasks',
      'L-6 module activities_tasks: title has different he labels in client_activities, client_tasks',
      'L-6 module activities_tasks: title has different es labels in client_activities, client_tasks',
    ]);
  });
});

describe('T-L8 L-7 record types unique per module', () => {
  it('negative control: two sections of one module with the same he record type are reported', () => {
    const recordTypes = { ...REAL_COLUMN_LABELS.recordTypes, client_documents: { en: 'Document', he: 'לקוח', es: 'Documento' } };
    expect(withRule(problems(planted({ recordTypes })), 'L-7')).toEqual(['L-7 module clients he: clients / client_documents: "לקוח"']);
  });
});

describe('T-L9 L-8 no stale entries', () => {
  it('negative control: a section entry for a non-include column and an unused key entry are each reported', () => {
    const bySection = { ...REAL_COLUMN_LABELS.bySection, clients: { password_hash: realKey('color') } };
    const byKey = { ...REAL_COLUMN_LABELS.byKey, removed_column: realKey('color') };
    expect(withRule(problems(planted({ bySection, byKey })), 'L-8')).toEqual([
      'L-8 clients.password_hash: not an include column of the section',
      'L-8 key.removed_column: used by no include column',
    ]);
  });
});

describe('T-L10 L-9 fixed keys', () => {
  it('negative control: a missing and an extra fixed key are reported', () => {
    const fixed: Record<string, LooseLabelText> = { ...REAL_COLUMN_LABELS.fixed, owner_id: realKey('color') };
    delete fixed.parent_id;
    expect(withRule(problems(planted({ fixed })), 'L-9')).toEqual(['L-9 fixed.parent_id: missing', 'L-9 fixed.owner_id: not a fixed column']);
  });
});

// ── T-L11: the builder end-to-end ───────────────────────────────────────────

const DANA = { id: 'c1', first_name: 'Dana', last_name: 'Levi', email: 'dana@x.com', stage: 'lead' };
const STAGES = [{ id: 's1', stage_key: 'lead', stage_label: 'Lead', position: 1 }];

const EXPECTED_CLIENTS: Record<ExportModuleLanguage, { first: string[]; last: string[]; recordType: string }> = {
  en: { first: ['Record type', 'Belongs to'], last: ['Record ID', 'Parent ID'], recordType: 'Client' },
  he: { first: ['סוג רשומה', 'שייך ל־'], last: ['מזהה רשומה', 'מזהה רשומת האב'], recordType: 'לקוח' },
  es: { first: ['Tipo de registro', 'Pertenece a'], last: ['ID del registro', 'ID del registro principal'], recordType: 'Cliente' },
};

describe('T-L11 the builder in en / he / es', () => {
  it.each(LANGUAGES.map((l) => [l]))('Clients in %s: fixed headers, record type; data cells as stored (BQ-31)', (language) => {
    const expected = EXPECTED_CLIENTS[language];
    const csv = buildJoinedCsv({ moduleId: 'clients', language, labels: EXPORT_COLUMN_LABELS, rowsBySection: { clients: [DANA], pipeline_stages: STAGES } });
    const header = parseLine(csv.header);
    expect(header.slice(0, 2)).toEqual(expected.first);
    expect(header.slice(-2)).toEqual(expected.last);
    const firstName = columnLabelText('clients', 'first_name')?.[language];
    const stage = columnLabelText('clients', 'stage')?.[language];
    expect(firstName).toBeDefined();
    expect(stage).toBeDefined();
    const cells = parseLine(csv.lines[0]);
    expect(cells[0]).toBe(expected.recordType);
    expect(cells[header.indexOf(firstName ?? '')]).toBe('Dana');
    expect(cells[header.indexOf(stage ?? '')]).toBe('Lead'); // the stored stage label, never translated

    const noStages = buildJoinedCsv({ moduleId: 'clients', language, labels: EXPORT_COLUMN_LABELS, rowsBySection: { clients: [DANA] } });
    expect(parseLine(noStages.lines[0])[header.indexOf(stage ?? '')]).toBe('lead'); // raw key, never translated
  });

  it.each(EXPORT_MODULES.flatMap((m) => LANGUAGES.map((l): [ExportModuleId, ExportModuleLanguage] => [m.id, l])))(
    '%s in %s: every header cell non-empty and unique; as wide as the key-echo header',
    (moduleId, language) => {
      const header = parseLine(buildJoinedCsv({ moduleId, language, labels: EXPORT_COLUMN_LABELS, rowsBySection: {} }).header);
      const keys = parseLine(buildJoinedCsv({ moduleId, language, labels: KEY_ECHO, rowsBySection: {} }).header);
      expect(header).toHaveLength(keys.length);
      expect(header.every((h) => h.trim() !== '')).toBe(true);
      expect(new Set(header.map((h) => h.trim().normalize('NFC').toLowerCase())).size).toBe(header.length);
      // No raw key leaked as a header (the fallback is never reached for a real column).
      expect(header.filter((h, i) => h === keys[i] && /_/.test(h))).toEqual([]);
    }
  );

  it('a Hebrew part starts with the BOM and gives the Hebrew header back intact', () => {
    const csv = buildJoinedCsv({ moduleId: 'clients', language: 'he', labels: EXPORT_COLUMN_LABELS, rowsBySection: { clients: [DANA] } });
    const text = csvPartText(csv.header, csv.lines);
    expect(text.startsWith(CSV_BOM)).toBe(true);
    const firstLine = text.slice(CSV_BOM.length).split('\r\n')[0];
    expect(parseLine(firstLine)).toEqual(parseLine(csv.header));
    expect(parseLine(firstLine)[0]).toBe('סוג רשומה');
  });
});

// ── T-L12: fallback ─────────────────────────────────────────────────────────

describe('T-L12 fallback: language, then English, then the key; never throws', () => {
  const sparse: ColumnLabelSet = {
    fixed: { record_type: { en: 'Record type' } },
    recordTypes: { clients: { en: 'Client', he: '' } },
    byKey: { first_name: { en: 'First name', he: 'שם פרטי' } },
    bySection: { clients: { last_name: { es: 'Apellido' } } },
  };
  const labels = joinedCsvLabelsFrom(sparse);

  it('column: es missing -> en; section entry en-less in he -> key; unknown key -> key', () => {
    expect(labels.column('clients', 'first_name', 'es')).toBe('First name');
    expect(labels.column('clients', 'first_name', 'he')).toBe('שם פרטי');
    expect(labels.column('clients', 'last_name', 'es')).toBe('Apellido');
    expect(labels.column('clients', 'last_name', 'he')).toBe('last_name');
    expect(labels.column('clients', 'nowhere', 'en')).toBe('nowhere');
  });

  it('fixed and recordType likewise; a blank language counts as missing', () => {
    expect(labels.fixed('record_type', 'he')).toBe('Record type');
    expect(labels.fixed('parent_id', 'he')).toBe('parent_id');
    expect(labels.recordType('clients', 'he')).toBe('Client');
    expect(labels.recordType('refunds', 'es')).toBe('refunds');
  });

  it('a column named like an Object.prototype member resolves to the key, not a function', () => {
    expect(labels.column('clients', 'constructor', 'en')).toBe('constructor');
    expect(EXPORT_COLUMN_LABELS.column('clients', 'toString', 'he')).toBe('toString');
    expect(columnLabelText('clients', 'hasOwnProperty')).toBeUndefined();
  });
});

// ── T-L14: purity and escapes ───────────────────────────────────────────────

const DIR = path.join(__dirname, '..');
const read = (file: string): string => fs.readFileSync(path.join(DIR, file), 'utf8').replace(/\r\n/g, '\n');
const importsOf = (source: string): string[] => [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
const FORBIDDEN = /lib\/repositories|data-export\/sections|lib\/logger|supabase|translations|stageLabels/;
const forbiddenIn = (source: string): string[] => importsOf(source).filter((i) => FORBIDDEN.test(i));
// A backslash then u or x then a hex digit or a brace, built from char codes so this file holds no such sequence.
const BACKSLASH_HEX = new RegExp(`${String.fromCharCode(92, 92)}[ux][0-9a-fA-F{]`);

describe('T-L14 purity and escapes', () => {
  it('columnLabels.ts is server-only with exactly three type-only imports', () => {
    const source = read('columnLabels.ts');
    expect(source).toContain("import 'server-only';");
    expect(importsOf(source).sort()).toEqual([
      '@/lib/business-os/data-export/classificationTypes',
      '@/lib/business-os/data-export/exportModules',
      '@/lib/business-os/data-export/joinedCsv',
    ]);
    const importLines = source.split('\n').filter((l) => l.startsWith('import '));
    expect(importLines.filter((l) => l !== "import 'server-only';").every((l) => l.startsWith('import type '))).toBe(true);
    expect(forbiddenIn(source)).toEqual([]);
    expect(/console\./.test(source)).toBe(false);
  });

  it('negative control: a planted runtime or forbidden import is caught', () => {
    expect(forbiddenIn("import { x } from '@/lib/repositories/X';\nimport { t } from '@/lib/business-os/translations/he';")).toEqual([
      '@/lib/repositories/X',
      '@/lib/business-os/translations/he',
    ]);
  });

  it('no backslash-u / backslash-x escape in either new file (Tailwind scans lib/, PR #180)', () => {
    expect(BACKSLASH_HEX.test(read('columnLabels.ts'))).toBe(false);
    expect(BACKSLASH_HEX.test(read(path.join('__tests__', 'columnLabels.test.ts')))).toBe(false);
  });

  it('negative control: a planted escape is caught', () => {
    expect(BACKSLASH_HEX.test(`const RLM = '${String.fromCharCode(92)}u200F';`)).toBe(true);
  });
});
