/**
 * MX-2a joined CSV builder (BUSINESS_OS_EXPORT_MX2A_WORKPLAN.md §5 T-1…T-17,
 * SA conditions C-2…C-11; requirement BUSINESS_OS_EXPORT_REDESIGN_REQUIREMENT.md
 * §4.2, XC-8, XC-10, BQ-26).
 *
 * Pure: literal fixture rows, the real descriptors and the real module map
 * (an injected map or classification where a test needs a module off or a
 * target excluded). Headers come from the key-echo labels defined below (test
 * only; MX-2b SA R-1 keeps them out of production code), so every assertion is
 * on keys, not wording (the words are columnLabels.test.ts).
 */
import fs from 'fs';
import path from 'path';

// zipExport (C-9 parity only) logs through Pino; nothing else here does.
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

import { CSV_BOM, csvPartText } from '@/lib/business-os/data-export/csv';
import { ExportClassificationError } from '@/lib/business-os/data-export/classification';
import type { ExportSectionId } from '@/lib/business-os/data-export/classificationTypes';
import { EXPORT_MODULES, type ExportModuleDefinition, type ExportModuleId } from '@/lib/business-os/data-export/exportModules';
import { LOOKUP_TARGETS } from '@/lib/business-os/data-export/joinedCsvReferences';
import { sectionColumns } from '@/lib/business-os/data-export/zipExport';
import {
  CLASSIFIED,
  JOINED_CSV_FIXED_COLUMNS,
  buildJoinedCsv,
  classifiedColumnsOf,
  isClassifiedExportable,
  labelOfRow,
  lookupSectionsFor,
  lookupTargetAvailable,
  type JoinedCsv,
  type JoinedCsvClassification,
  type JoinedCsvInput,
  type JoinedCsvLabels,
} from '@/lib/business-os/data-export/joinedCsv';

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Echoes the keys (the fixed key, the section id, the column key). Defined here,
 * not exported from joinedCsv.ts, so no production module can import it
 * (MX-2b SA R-1).
 */
const KEY_ECHO_LABELS: JoinedCsvLabels = {
  fixed: (key) => key,
  recordType: (section) => section,
  column: (_section, key) => key,
};

/** RFC 4180 parse of ONE encoded line (a quoted cell may hold CR / LF). */
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

/** The lines as records keyed by the (key-echo, unique) header. Asserts every line is as wide as the header. */
function table(csv: JoinedCsv): Record<string, string>[] {
  const header = parseLine(csv.header);
  return csv.lines.map((line) => {
    const cells = parseLine(line);
    expect(cells).toHaveLength(header.length);
    return Object.fromEntries(header.map((key, i) => [key, cells[i]]));
  });
}

function build(
  moduleId: ExportModuleId,
  rest: Omit<JoinedCsvInput, 'moduleId' | 'language' | 'labels'> & { labels?: JoinedCsvLabels }
): JoinedCsv {
  return buildJoinedCsv({ moduleId, language: 'en', labels: KEY_ECHO_LABELS, ...rest });
}

function mapWithOff(id: ExportModuleId): ExportModuleDefinition[] {
  return EXPORT_MODULES.map((m) => (m.id === id ? { ...m, on: false } : m));
}

// ── Fixtures ────────────────────────────────────────────────────────────────

const DANA = { id: 'c1', first_name: 'Dana', last_name: 'Levi', email: 'dana@x.com', stage: 'lead', tags: ['vip'], created_at: '2026-01-01T00:00:00+00:00' };
const AVI = { id: 'c2', first_name: 'Avi', email: 'avi@x.com', stage: 'vip' };
const STAGES = [
  { id: 's1', stage_key: 'lead', stage_label: 'Lead', position: 1 },
  { id: 's2', stage_key: 'won', stage_label: 'Won', position: 2 },
];
const DOCS = [
  { id: 'd1', contact_id: 'c1', name: 'Contract', created_at: '2026-02-01T00:00:00+00:00' },
  { id: 'd2', contact_id: 'c2', name: 'ID card' },
  { id: 'd3', contact_id: 'c-gone', name: 'Orphan' },
];
const clientsCsv = (): JoinedCsv =>
  build('clients', { rowsBySection: { clients: [DANA, AVI], pipeline_stages: STAGES, client_documents: DOCS } });

const SERVICE = { id: 'sv1', service_name: 'Massage', price: 100 };
const BOOKING = { id: 'b1', service_id: 'sv1', contact_id: 'c1', start_time: '2026-03-01T09:00:00+00:00' };

// ── T-1…T-4: the shape ──────────────────────────────────────────────────────

describe('T-1 Clients module (requirement AC)', () => {
  it('one header + 7 lines; record type per section; documents belong to their client', () => {
    const csv = clientsCsv();
    expect(csv.lines).toHaveLength(7);
    const rows = table(csv);
    expect(rows.map((r) => r.record_type)).toEqual([
      'clients', 'clients', 'pipeline_stages', 'pipeline_stages', 'client_documents', 'client_documents', 'client_documents',
    ]);
    expect(rows.map((r) => r.belongs_to)).toEqual(['', '', '', '', 'Dana Levi (dana@x.com)', 'Avi (avi@x.com)', 'c-gone']);
    expect(csv.rowCountBySection).toEqual({ clients: 2, pipeline_stages: 2, client_documents: 3 });
  });

  it('negative control: a document whose client is not found shows the raw id, not blank and not another name', () => {
    const orphan = table(clientsCsv())[6];
    expect(orphan.belongs_to).toBe('c-gone');
    expect(orphan.parent_id).toBe('c-gone');
  });
});

describe('T-2 column union', () => {
  it('real Clients header: fixed columns around the union, each key once, id and the parent column out', () => {
    const header = parseLine(clientsCsv().header);
    expect(header.slice(0, 2)).toEqual(['record_type', 'belongs_to']);
    expect(header.slice(-2)).toEqual(['record_id', 'parent_id']);
    expect(new Set(header).size).toBe(header.length);
    expect(header).not.toContain('id');
    expect(header).not.toContain('contact_id');
    const clientCols = classifiedColumnsOf('clients').filter((c) => c !== 'id');
    expect(header.slice(2, 2 + clientCols.length)).toEqual(clientCols);
    for (const key of ['created_at', 'updated_at', 'tags']) expect(header.filter((h) => h === key)).toHaveLength(1);
    expect(header.indexOf('stage_label')).toBeGreaterThan(header.indexOf('utm_campaign'));
    expect(header.indexOf('file_name')).toBeGreaterThan(header.indexOf('stage_label'));
  });

  it("a document's created_at lands in the same column as a client's", () => {
    const rows = table(clientsCsv());
    expect(rows[0].created_at).toBe('2026-01-01T00:00:00+00:00');
    expect(rows[4].created_at).toBe('2026-02-01T00:00:00+00:00');
  });

  it('negative control: a key planted in a second and third section is still one column (exact header)', () => {
    const columns: Record<string, readonly string[]> = {
      clients: ['id', 'a', 'b'],
      pipeline_stages: ['id', 'b', 'c'],
      client_documents: ['id', 'contact_id', 'c', 'd'],
    };
    const classification: JoinedCsvClassification = {
      columnsOf: (s) => columns[s] ?? [],
      isExportableSection: () => true,
    };
    const csv = build('clients', { rowsBySection: {}, classification });
    expect(parseLine(csv.header)).toEqual(['record_type', 'belongs_to', 'a', 'b', 'c', 'd', 'record_id', 'parent_id']);
  });
});

describe('T-3 blanks', () => {
  it('a stage line has as many cells as the header and blanks under every client-only column', () => {
    const csv = clientsCsv();
    const stage = table(csv)[2];
    for (const key of ['first_name', 'last_name', 'email', 'phone', 'stage', 'utm_source']) expect(stage[key]).toBe('');
    expect(stage.stage_label).toBe('Lead');
  });
});

describe('T-4 ids last', () => {
  it('record id is the row id, parent id the raw contact_id', () => {
    const rows = table(clientsCsv());
    expect(rows[0].record_id).toBe('c1');
    expect(rows[0].parent_id).toBe('');
    expect(rows[4].record_id).toBe('d1');
    expect(rows[4].parent_id).toBe('c1');
  });

  it('consent_settings (no id column) has a blank record id', () => {
    const csv = build('newsletter_subscribers', { rowsBySection: { consent_settings: [{ capture_enabled: true, statement_en: 'Yes' }] } });
    const [row] = table(csv);
    expect(row.record_type).toBe('consent_settings');
    expect(row.record_id).toBe('');
    expect(row.capture_enabled).toBe('true');
  });
});

// ── T-5, T-6: the cell rule (reused, not re-written) ────────────────────────

describe('T-5 BC-1 through csv.ts', () => {
  it('formula-looking strings get an apostrophe, also in Belongs to and in a looked-up label', () => {
    const evil = { id: 'c9', first_name: '=HYPERLINK("x")', email: 'e@x.com' };
    const docs = ['+1', '-x', '@x', '\tx', '\rx'].map((name, i) => ({ id: `d${i}`, contact_id: 'c9', name }));
    const rows = table(build('clients', { rowsBySection: { clients: [evil], client_documents: docs } }));
    expect(rows[0].first_name).toBe(`'=HYPERLINK("x")`);
    expect(rows.slice(1).map((r) => r.name)).toEqual(["'+1", "'-x", "'@x", "'\tx", "'\rx"]);
    for (const r of rows.slice(1)) expect(r.belongs_to).toBe(`'=HYPERLINK("x") (e@x.com)`);
  });

  it('negative control: numbers are untouched; the same text as a string is prefixed', () => {
    const docs = [
      { id: 'd1', contact_id: 'c1', file_size: -5 },
      { id: 'd2', contact_id: 'c1', file_size: 5 },
      { id: 'd3', contact_id: 'c1', name: '-5' },
    ];
    const rows = table(build('clients', { rowsBySection: { client_documents: docs } }));
    expect(rows.map((r) => r.file_size)).toEqual(['-5', '5', '']);
    expect(rows[2].name).toBe("'-5");
  });
});

describe('T-6 numbers, jsonb, booleans as in the ZIP', () => {
  it('12.5, JSON text in one cell, true, NaN -> empty', () => {
    const csv = build('services', {
      rowsBySection: { services: [{ id: 'sv1', price: 12.5, availability: ['a'], is_active: true, duration_minutes: Number.NaN }] },
    });
    const [row] = table(csv);
    expect(row.price).toBe('12.5');
    expect(row.availability).toBe('["a"]');
    expect(csv.lines[0]).toContain('"[""a""]"');
    expect(row.is_active).toBe('true');
    expect(row.duration_minutes).toBe('');
  });
});

// ── T-7…T-11, C-2: lookups ──────────────────────────────────────────────────

describe('T-7 stage lookup', () => {
  it('clients.stage shows the stage label, matched on stage_key', () => {
    expect(table(clientsCsv())[0].stage).toBe('Lead');
  });

  it('negative control: an unknown stage key stays as stored', () => {
    expect(table(clientsCsv())[1].stage).toBe('vip');
  });
});

describe('T-8 service lookup (cross-module) and the client in Belongs to', () => {
  it('service_id shows the service name; the booking belongs to its client', () => {
    const [row] = table(build('bookings', {
      rowsBySection: { bookings: [BOOKING] },
      lookupRowsBySection: { services: [SERVICE], clients: [DANA] },
    }));
    expect(row.service_id).toBe('Massage');
    expect(row.belongs_to).toBe('Dana Levi (dana@x.com)');
    expect(row.parent_id).toBe('c1');
  });

  it('negative control: no services rows -> the raw id', () => {
    const [row] = table(build('bookings', { rowsBySection: { bookings: [BOOKING] }, lookupRowsBySection: { clients: [DANA] } }));
    expect(row.service_id).toBe('sv1');
  });
});

describe('T-9 a switched-off target keeps the id', () => {
  const input = { rowsBySection: { bookings: [BOOKING] }, lookupRowsBySection: { services: [SERVICE], clients: [DANA] } };

  it('services module off (rows still passed) -> raw service_id', () => {
    const [row] = table(build('bookings', { ...input, map: mapWithOff('services') }));
    expect(row.service_id).toBe('sv1');
    expect(row.belongs_to).toBe('Dana Levi (dana@x.com)');
  });

  it('clients module off -> Belongs to shows the raw contact_id', () => {
    const [row] = table(build('bookings', { ...input, map: mapWithOff('clients') }));
    expect(row.belongs_to).toBe('c1');
    expect(row.service_id).toBe('Massage');
  });

  it('negative control: the real (all-on) map with the same input gives labels', () => {
    const [row] = table(build('bookings', { ...input, map: EXPORT_MODULES }));
    expect([row.service_id, row.belongs_to]).toEqual(['Massage', 'Dana Levi (dana@x.com)']);
  });
});

describe('T-10 / C-4 excluded target keeps the id; own-section errors propagate', () => {
  const input = { rowsBySection: { bookings: [BOOKING] }, lookupRowsBySection: { services: [SERVICE], clients: [DANA] } };

  it('target not exportable -> raw id', () => {
    const classification: JoinedCsvClassification = { ...CLASSIFIED, isExportableSection: (s) => s !== 'services' };
    expect(table(build('bookings', { ...input, classification }))[0].service_id).toBe('sv1');
  });

  it('the exportability check throwing for the target -> raw id, not an error', () => {
    const classification: JoinedCsvClassification = {
      ...CLASSIFIED,
      isExportableSection: (s) => {
        if (s === 'services') throw new ExportClassificationError('unknown_section', s, 'planted');
        return true;
      },
    };
    expect(table(build('bookings', { ...input, classification }))[0].service_id).toBe('sv1');
  });

  it("the target's columns throwing (e.g. a denied column) -> raw id, not an error", () => {
    const classification: JoinedCsvClassification = {
      ...CLASSIFIED,
      columnsOf: (s) => {
        if (s === 'services') throw new ExportClassificationError('denied_column', 'scheduling_services', 'planted');
        return classifiedColumnsOf(s);
      },
    };
    expect(table(build('bookings', { ...input, classification }))[0].service_id).toBe('sv1');
  });

  it("a label column missing from the target's columns -> raw id", () => {
    const classification: JoinedCsvClassification = {
      ...CLASSIFIED,
      columnsOf: (s) => (s === 'services' ? ['id', 'price'] : classifiedColumnsOf(s)),
    };
    expect(table(build('bookings', { ...input, classification }))[0].service_id).toBe('sv1');
  });

  it("an own section's classification error propagates (fail closed, never swallowed)", () => {
    const classification: JoinedCsvClassification = {
      ...CLASSIFIED,
      columnsOf: (s) => {
        if (s === 'bookings') throw new ExportClassificationError('denied_column', 'scheduling_bookings', 'planted');
        return classifiedColumnsOf(s);
      },
    };
    expect(() => build('bookings', { ...input, classification })).toThrow(ExportClassificationError);
  });

  it('the default seam: exportable sections, non-table section, unknown section', () => {
    expect(isClassifiedExportable('services')).toBe(true);
    expect(isClassifiedExportable('account_identity')).toBe(true);
    expect(isClassifiedExportable('nope' as ExportSectionId)).toBe(false);
    expect(lookupTargetAvailable('services')).toBe(true);
    expect(lookupTargetAvailable('services', mapWithOff('services'))).toBe(false);
  });
});

describe('T-11 own-module lookups only', () => {
  it('payments.invoice_id -> invoice number (own module)', () => {
    const [, payment] = table(build('invoices_payments', {
      rowsBySection: { invoices: [{ id: 'i1', contact_id: 'c1', invoice_number: 'INV-1' }], payments: [{ id: 'p1', contact_id: 'c1', invoice_id: 'i1' }] },
    }));
    expect(payment.invoice_id).toBe('INV-1');
  });

  it('installments.invoice_id (Invoices is another module) stays the id even with invoices passed as lookup rows', () => {
    const [plan, inst] = table(build('payment_plans', {
      rowsBySection: {
        payment_plans: [{ id: 'pp1', name: '3 payments' }],
        installments: [{ id: 'in1', invoice_id: 'i1', payment_plan_id: 'pp1', contact_id: 'c1' }],
      },
      lookupRowsBySection: { invoices: [{ id: 'i1', invoice_number: 'INV-1' }], clients: [DANA] },
    }));
    expect(plan.record_type).toBe('payment_plans');
    expect(inst.invoice_id).toBe('i1');
    expect(inst.payment_plan_id).toBe('3 payments');
    expect(inst.belongs_to).toBe('Dana Levi (dana@x.com)');
  });
});

describe('C-2 the same key is the same column, even when one section uses it as its parent', () => {
  const csv = (): JoinedCsv => build('invoices_payments', {
    rowsBySection: {
      invoices: [{ id: 'i1', contact_id: 'c1', invoice_number: 'INV-1' }],
      payments: [{ id: 'p1', contact_id: 'c1', invoice_id: 'i1' }],
      refunds: [{ id: 'r1', invoice_id: 'i1', amount: 5 }],
    },
    lookupRowsBySection: { clients: [DANA] },
  });

  it('invoice_id is one column; refund rows fill it with the invoice number, plus Belongs to and Parent ID', () => {
    const header = parseLine(csv().header);
    expect(header.filter((h) => h === 'invoice_id')).toHaveLength(1);
    expect(header).not.toContain('contact_id');
    const [, payment, refund] = table(csv());
    expect(payment.belongs_to).toBe('Dana Levi (dana@x.com)');
    expect(payment.invoice_id).toBe('INV-1');
    expect(refund.invoice_id).toBe('INV-1');
    expect(refund.belongs_to).toBe('INV-1');
    expect(refund.parent_id).toBe('i1');
  });

  it('negative control: the refund row does not leave invoice_id blank', () => {
    expect(table(csv())[2].invoice_id).not.toBe('');
  });
});

// ── C-3: empty or ambiguous labels ──────────────────────────────────────────

describe('C-3 label fallbacks', () => {
  it('client: "First Last (email)", name only, email only, neither -> raw id; blanks trimmed', () => {
    const clients = [
      { id: 'a', first_name: 'Dana', last_name: 'Levi', email: 'd@x' },
      { id: 'b', first_name: 'Noa' },
      { id: 'c', email: 'c@x' },
      { id: 'd' },
      { id: 'e', first_name: '  ', email: '' },
    ];
    const docs = clients.map((c) => ({ id: `doc-${c.id}`, contact_id: c.id }));
    const rows = table(build('clients', { rowsBySection: { clients, client_documents: docs } }));
    expect(rows.slice(5).map((r) => r.belongs_to)).toEqual(['Dana Levi (d@x)', 'Noa', 'c@x', 'd', 'e']);
  });

  it('a key that appears twice in the lookup rows is ambiguous -> raw id', () => {
    const clients = [{ id: 'z', first_name: 'One' }, { id: 'z', first_name: 'Two' }];
    const rows = table(build('clients', { rowsBySection: { clients, client_documents: [{ id: 'dz', contact_id: 'z' }] } }));
    expect(rows[2].belongs_to).toBe('z');
  });

  it('a draft invoice with no number -> the refund belongs to the raw invoice id', () => {
    const rows = table(build('invoices_payments', {
      rowsBySection: { invoices: [{ id: 'i2', invoice_number: null }], refunds: [{ id: 'r2', invoice_id: 'i2' }] },
    }));
    expect(rows[1].belongs_to).toBe('i2');
    expect(rows[1].invoice_id).toBe('i2'); // C-2 column, same fallback
  });

  it('website page: title, else slug, else raw id', () => {
    const rows = table(build('website', {
      rowsBySection: {
        website_pages: [{ id: 'pg1', title: 'Home', slug: 'home' }, { id: 'pg2', slug: 'about' }, { id: 'pg3' }],
        website_blocks: [{ id: 'bk1', page_id: 'pg1' }, { id: 'bk2', page_id: 'pg2' }, { id: 'bk3', page_id: 'pg3' }],
      },
    }));
    expect(rows.slice(3).map((r) => r.belongs_to)).toEqual(['Home', 'about', 'pg3']);
    expect(parseLine(build('website', { rowsBySection: {} }).header)).not.toContain('page_id');
  });

  it('labelOfRow directly', () => {
    expect(labelOfRow(LOOKUP_TARGETS.client, { first_name: 'A', last_name: 'B', email: 'e' })).toBe('A B (e)');
    expect(labelOfRow(LOOKUP_TARGETS.client, { last_name: 'B' })).toBe('B');
    expect(labelOfRow(LOOKUP_TARGETS.client, {})).toBe('');
    expect(labelOfRow(LOOKUP_TARGETS.website_page, { title: '', slug: 's' })).toBe('s');
  });
});

// ── T-12, T-13, C-11: nothing outside the classification, other sections ignored ─

describe('T-12 / C-11 no column outside the classification', () => {
  it('stray row keys never reach the header or a line; a lookup row cannot leak a non-label column', () => {
    const csv = build('bookings', {
      rowsBySection: { bookings: [{ ...BOOKING, user_id: 'u-1', storage_path: 'secret/path', secret: 'shh' }] },
      lookupRowsBySection: { clients: [{ ...DANA, phone: '0501234567', user_id: 'u-1' }], services: [SERVICE] },
    });
    const text = [csv.header, ...csv.lines].join('\n');
    for (const leaked of ['user_id', 'storage_path', 'secret', 'u-1', 'shh', '0501234567', 'phone']) expect(text).not.toContain(leaked);
  });
});

describe('T-13 rows of another section are ignored', () => {
  it('invoices rows passed to the Clients module are not written; quotes lookup rows are ignored', () => {
    const csv = build('clients', {
      rowsBySection: { clients: [DANA], invoices: [{ id: 'i1', invoice_number: 'INV-1' }] },
      lookupRowsBySection: { quotes: [{ id: 'q1', title: 'Quote' }] },
    });
    expect(csv.lines).toHaveLength(1);
    expect(csv.lines.join('')).not.toContain('INV-1');
    expect(Object.keys(csv.rowCountBySection).sort()).toEqual(['client_documents', 'clients', 'pipeline_stages']);
  });
});

// ── T-14: an array of lines (XC-8) ──────────────────────────────────────────

describe('T-14 an array of lines', () => {
  it('lines is a string[]; no line holds an unquoted CR or LF; a multi-line cell is quoted inside its line', () => {
    const csv = build('clients', { rowsBySection: { clients: [{ ...DANA, notes: 'line one\r\nline two' }, AVI] } });
    expect(Array.isArray(csv.lines)).toBe(true);
    expect(csv.lines).toHaveLength(2);
    for (const line of csv.lines) {
      const outsideQuotes = line.replace(/"(?:[^"]|"")*"/g, '');
      expect(outsideQuotes).not.toMatch(/[\r\n]/);
    }
    expect(table(csv)[0].notes).toBe('line one\r\nline two');
  });

  it('csvPartText(header, lines) starts with the BOM bytes and ends with CRLF', () => {
    const csv = clientsCsv();
    const text = csvPartText(csv.header, csv.lines);
    expect(Array.from(new TextEncoder().encode(text).slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    expect(text.startsWith(CSV_BOM + csv.header + '\r\n')).toBe(true);
    expect(text.endsWith('\r\n')).toBe(true);
  });
});

// ── T-15: the label interface ───────────────────────────────────────────────

describe('T-15 labels interface', () => {
  const HEBREW: JoinedCsvLabels = {
    fixed: (key, language) => `${language}:קבוע:${key}`,
    recordType: (section, language) => `${language}:סוג:${section}`,
    column: (_section, key, language) => `${language}:עמודה:${key}`,
  };

  // T-L13 (MX-2b): replaces MX-2a's "key echo by default". Jest is
  // transpile-only, so the required type proves nothing on its own.
  it('labels are required: a call without them throws', () => {
    const noLabels = { moduleId: 'clients', language: 'en', rowsBySection: { clients: [DANA] } } as unknown as JoinedCsvInput;
    expect(() => buildJoinedCsv(noLabels)).toThrow('Joined CSV labels are required');
    const partial = { ...noLabels, labels: { fixed: KEY_ECHO_LABELS.fixed, recordType: KEY_ECHO_LABELS.recordType } } as unknown as JoinedCsvInput;
    expect(() => buildJoinedCsv(partial)).toThrow('Joined CSV labels are required');
  });

  it('negative control: the test key-echo labels build the header from keys', () => {
    expect(parseLine(clientsCsv().header)[0]).toBe('record_type');
  });

  it('injected labels name the header and the record type in the requested language; data cells unchanged', () => {
    const csv = buildJoinedCsv({ moduleId: 'clients', language: 'he', labels: HEBREW, rowsBySection: { clients: [DANA] } });
    const header = parseLine(csv.header);
    expect(header[0]).toBe('he:קבוע:record_type');
    expect(header[header.length - 1]).toBe('he:קבוע:parent_id');
    expect(header).toContain('he:עמודה:first_name');
    const cells = parseLine(csv.lines[0]);
    expect(cells[0]).toBe('he:סוג:clients');
    expect(cells[header.indexOf('he:עמודה:first_name')]).toBe('Dana');
    expect(cells[header.indexOf('he:עמודה:stage')]).toBe('lead'); // no stages passed: raw, never translated
  });

  it('boundary: labels that repeat are written as given (de-duplication is MX-2b CI, not the builder)', () => {
    const same: JoinedCsvLabels = { ...KEY_ECHO_LABELS, column: () => 'X' };
    const header = parseLine(build('clients', { rowsBySection: {}, labels: same }).header);
    expect(header.filter((h) => h === 'X').length).toBe(header.length - 4);
  });
});

// ── C-5: lookupSectionsFor ──────────────────────────────────────────────────

describe('C-5 lookupSectionsFor, derived from the declared references', () => {
  const EXPECTED: Record<ExportModuleId, ExportSectionId[]> = {
    clients: [],
    activities_tasks: ['clients'],
    bookings: ['clients', 'services'],
    services: [],
    quotes: ['clients', 'services'],
    invoices_payments: ['clients', 'services'],
    payment_plans: ['clients', 'services'],
    forms: [],
    email_campaigns: ['clients'],
    newsletter_subscribers: ['clients'],
    website: [],
    smart_links: [],
    account_business: [],
  };

  it.each(EXPORT_MODULES.map((m) => [m.id]))('%s over the real map', (id) => {
    expect(lookupSectionsFor(id)).toEqual(EXPECTED[id]);
  });

  it('a switched-off target is not asked for', () => {
    expect(lookupSectionsFor('bookings', mapWithOff('services'))).toEqual(['clients']);
  });
});

// ── C-8, C-9: guards over the real map ──────────────────────────────────────

/** Include columns of the map's sections named like a fixed column. */
function fixedColumnCollisions(columnsOf: (s: ExportSectionId) => readonly string[]): string[] {
  const fixed = new Set<string>(JOINED_CSV_FIXED_COLUMNS);
  return EXPORT_MODULES.flatMap((m) => m.sections.flatMap((s) => columnsOf(s).filter((c) => fixed.has(c)).map((c) => `${s}.${c}`)));
}

describe('C-8 fixed header keys never collide with a column', () => {
  it('no include column of any module is named record_type, belongs_to, record_id or parent_id', () => {
    expect(fixedColumnCollisions(classifiedColumnsOf)).toEqual([]);
  });

  it('negative control: a planted record_id column is reported', () => {
    const planted = (s: ExportSectionId): readonly string[] => (s === 'services' ? [...classifiedColumnsOf(s), 'record_id'] : classifiedColumnsOf(s));
    expect(fixedColumnCollisions(planted)).toEqual(['services.record_id']);
  });
});

describe('C-9 classifiedColumnsOf has parity with the ZIP (zipExport.sectionColumns, until MX-6)', () => {
  it.each(EXPORT_MODULES.flatMap((m) => m.sections.map((s) => [s])))('%s', (section) => {
    expect(classifiedColumnsOf(section)).toEqual(sectionColumns(section));
  });
});

// ── T-17 purity, C-7 no backslash-hex escapes ──────────────────────────────

const DIR = path.join(__dirname, '..');
const read = (file: string): string => fs.readFileSync(path.join(DIR, file), 'utf8').replace(/\r\n/g, '\n');
const importsOf = (source: string): string[] => [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
const FORBIDDEN = /server-only|lib\/repositories|data-export\/sections|ownerClock|lib\/logger|lib\/payments\/csv|supabase/;
const forbiddenIn = (source: string): string[] => importsOf(source).filter((i) => FORBIDDEN.test(i)).concat(source.includes("import 'server-only'") ? ['server-only'] : []);
// A backslash then u or x then a hex digit or a brace, built from char codes so this file holds no such sequence.
const BACKSLASH_HEX = new RegExp(`${String.fromCharCode(92, 92)}[ux][0-9a-fA-F{]`);

describe('T-17 purity and C-7', () => {
  it('joinedCsv.ts imports only the pure export modules', () => {
    expect(importsOf(read('joinedCsv.ts')).sort()).toEqual([
      '@/lib/business-os/data-export/classification',
      '@/lib/business-os/data-export/classificationTypes',
      '@/lib/business-os/data-export/csv',
      '@/lib/business-os/data-export/exportModules',
      '@/lib/business-os/data-export/joinedCsvReferences',
    ]);
    expect(forbiddenIn(read('joinedCsv.ts'))).toEqual([]);
  });

  it('joinedCsvReferences.ts has one type-only import', () => {
    const source = read('joinedCsvReferences.ts');
    expect(importsOf(source)).toEqual(['@/lib/business-os/data-export/classificationTypes']);
    expect(source).toContain("import type { ExportSectionId } from '@/lib/business-os/data-export/classificationTypes';");
    expect(forbiddenIn(source)).toEqual([]);
  });

  it('negative control: a planted import is caught', () => {
    expect(forbiddenIn("import 'server-only';\nimport { x } from '@/lib/repositories/X';")).toEqual(['@/lib/repositories/X', 'server-only']);
  });

  it('no backslash-u / backslash-x escape in csv.ts or the new files (Tailwind scans lib/, PR #180)', () => {
    for (const file of ['csv.ts', 'joinedCsv.ts', 'joinedCsvReferences.ts']) expect(BACKSLASH_HEX.test(read(file))).toBe(false);
  });

  it('negative control: a planted escape is caught', () => {
    expect(BACKSLASH_HEX.test(`const BOM = '${String.fromCharCode(92)}uFEFF';`)).toBe(true);
  });
});
