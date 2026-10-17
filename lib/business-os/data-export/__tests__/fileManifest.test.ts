/**
 * DE-8b T-9 (workplan §9; SA Q-13, Q-16, C-4, C-5, C-11, C-14): which stored
 * files are "Your files", under which names. The REAL files repository runs
 * over an in-memory Storage and table fake, so the prefix and row rules are
 * exercised end to end.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { BusinessDataExportFilesRepository } from '@/lib/repositories/BusinessDataExportFilesRepository';
import { createExportFileSource, fileIndexRow, newFileBudget } from '../fileManifest';
import { isAllowedEntryName } from '../zipEntries';

jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C1 = 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1';
const C2 = 'c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2';

type World = {
  buckets: Record<string, Record<string, { size: number; mimetype?: string }>>;
  tables: Record<string, Array<Record<string, unknown>>>;
};

function world(w: World) {
  const downloads: string[] = [];
  const lists: string[] = [];
  const storage = {
    from: (bucket: string) => ({
      list: async (prefix: string, opts: { limit: number; offset: number }) => {
        lists.push(`${bucket}:${prefix}`);
        const children = new Map<string, Record<string, unknown>>();
        for (const key of Object.keys(w.buckets[bucket] ?? {})) {
          const rest = prefix === '' ? key : key.startsWith(`${prefix}/`) ? key.slice(prefix.length + 1) : null;
          if (rest === null) continue;
          const [head, ...tail] = rest.split('/');
          if (tail.length === 0) children.set(head, { name: head, id: `id:${key}`, metadata: w.buckets[bucket][key] });
          else if (!children.has(head)) children.set(head, { name: head, id: null });
        }
        return { data: [...children.values()].slice(opts.offset, opts.offset + opts.limit), error: null };
      },
      download: async (key: string) => {
        downloads.push(`${bucket}:${key}`);
        if (!w.buckets[bucket]?.[key]) return { data: null, error: { message: 'not found' } };
        const bytes = new TextEncoder().encode(key);
        return { data: { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }, error: null };
      },
    }),
  };
  const from = (table: string) => {
    const filters: Array<[string, string, unknown]> = [];
    let limit = Infinity;
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (c: string, v: unknown) => (filters.push(['eq', c, v]), builder),
      neq: (c: string, v: unknown) => (filters.push(['neq', c, v]), builder),
      gt: (c: string, v: unknown) => (filters.push(['gt', c, v]), builder),
      order: () => builder,
      limit: (n: number) => ((limit = n), builder),
      then: (resolve: (v: unknown) => void) => {
        let rows = [...(w.tables[table] ?? [])];
        for (const [op, c, v] of filters) {
          if (op === 'eq') rows = rows.filter((r) => r[c] === v);
          if (op === 'neq') rows = rows.filter((r) => r[c] !== v);
          if (op === 'gt') rows = rows.filter((r) => String(r[c]) > String(v));
        }
        rows.sort((x, y) => (String(x.id) < String(y.id) ? -1 : 1));
        resolve({ data: rows.slice(0, limit), error: null });
      },
    };
    return builder;
  };
  const repo = new BusinessDataExportFilesRepository({ storage, from } as unknown as SupabaseClient);
  return { source: createExportFileSource(repo), downloads, lists };
}

const log = { warn: jest.fn(), error: jest.fn() };
const doc = (id: string, user: string, contact: string | null, storagePath: string, fileName: string | null, status = 'active', bucket: string | null = null) => ({
  id,
  user_id: user,
  contact_id: contact,
  storage_path: storagePath,
  storage_bucket: bucket,
  file_name: fileName,
  mime_type: 'application/pdf',
  status,
});

// The repository's clock is the real one here, so the budget never runs out by time.
const budget = () => ({ ...newFileBudget(Date.now()), deadlineAt: Number.MAX_SAFE_INTEGER });

it('newFileBudget: 15 s and 300 list calls from now', () => {
  expect(newFileBudget(1_000)).toEqual({ deadlineAt: 16_000, callsLeft: 300 });
});

describe('contact documents: the live rows are the authority (C-11)', () => {
  const base = (): World => ({
    buckets: {
      'contact-documents': {
        [`${A}/${C1}/1_contract.pdf`]: { size: 100 },
        [`${A}/${C1}/2________.pdf`]: { size: 50 },
        [`${A}/${C1}/3_deleted.pdf`]: { size: 10 },
        [`${A}/${C2}/4_orphan.pdf`]: { size: 7 },
        [`${B}/${C1}/9_b-file.pdf`]: { size: 999 },
      },
      'website-images': {},
    },
    tables: {
      contact_documents: [
        doc('d1', A, C1, `${A}/${C1}/1_contract.pdf`, 'contract.pdf'),
        doc('d2', A, C1, `${A}/${C1}/2________.pdf`, 'חוזה לקוח.pdf'),
        doc('d3', A, C1, `${A}/${C1}/3_deleted.pdf`, 'deleted.pdf', 'deleted'),
        doc('d5', A, C1, `${A}/${C1}/5_missing.pdf`, 'missing.pdf'),
        // Crossed pointer: tenant A's row points at tenant B's object.
        doc('d6', A, C1, `${B}/${C1}/9_b-file.pdf`, 'b-file.pdf'),
      ],
      user_media: [],
    },
  });

  it('includes linked documents under client id + the ORIGINAL name (Hebrew survives)', async () => {
    const { source } = world(base());
    const result = await source.inventory(A, budget(), log);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.inventory.files.map((f) => [f.entryPath, f.recordSection, f.recordId, f.sizeBytes])).toEqual([
      [`files/client-documents/${C1}/contract.pdf`, 'client_documents', 'd1', 100],
      [`files/client-documents/${C1}/חוזה לקוח.pdf`, 'client_documents', 'd2', 50],
    ]);
    expect(result.inventory.totalBytes).toBe(150);
  });

  it('orphans: a deleted row\'s object and a row-less object are skipped and counted, never named', async () => {
    const { source } = world(base());
    const result = await source.inventory(A, budget(), log);
    if (!result.ok) throw new Error('expected ok');
    expect(result.inventory.orphanSkipped).toBe(2);
    expect(result.inventory.files.some((f) => f.key.includes('deleted') || f.key.includes('orphan'))).toBe(false);
  });

  it('a live row with no object, and the crossed pointer, count as records without a file', async () => {
    const { source } = world(base());
    const result = await source.inventory(A, budget(), log);
    if (!result.ok) throw new Error('expected ok');
    expect(result.inventory.recordsWithoutFile).toBe(2);
  });

  it('crossed pointer: tenant B\'s object is never listed and never downloaded', async () => {
    const { source, downloads, lists } = world(base());
    const result = await source.inventory(A, budget(), log);
    if (!result.ok) throw new Error('expected ok');
    for (const file of result.inventory.files) await source.download(A, file);
    expect(downloads.some((d) => d.includes(B))).toBe(false);
    expect(lists.every((l) => l.split(':')[1].startsWith(A))).toBe(true);
  });

  it('a row whose client id is not a uuid is never used as a folder (counted instead)', async () => {
    const w = base();
    w.tables.contact_documents = [doc('d1', A, '../../etc', `${A}/${C1}/1_contract.pdf`, 'contract.pdf')];
    const { source } = world(w);
    const result = await source.inventory(A, budget(), log);
    if (!result.ok) throw new Error('expected ok');
    expect(result.inventory.files).toEqual([]);
    expect(result.inventory.recordsWithoutFile).toBe(1);
  });

  it('a row naming another bucket does not match', async () => {
    const w = base();
    w.tables.contact_documents = [doc('d1', A, C1, `${A}/${C1}/1_contract.pdf`, 'contract.pdf', 'active', 'website-images')];
    const { source } = world(w);
    const result = await source.inventory(A, budget(), log);
    if (!result.ok) throw new Error('expected ok');
    expect(result.inventory.files).toEqual([]);
  });

  it('hostile uploader names stay inside the zip and duplicates get (2), deterministically (C-4, C-14)', async () => {
    const w = base();
    w.tables.contact_documents = [
      doc('d1', A, C1, `${A}/${C1}/1_contract.pdf`, '../../x.pdf'),
      doc('d2', A, C1, `${A}/${C1}/2________.pdf`, '..\\..\\X.PDF'),
    ];
    const run = async () => {
      const result = await world(w).source.inventory(A, budget(), log);
      if (!result.ok) throw new Error('expected ok');
      return result.inventory.files.map((f) => f.entryPath);
    };
    const first = await run();
    expect(first).toEqual([`files/client-documents/${C1}/-..-x.pdf`, `files/client-documents/${C1}/-..-X (2).PDF`]);
    for (const name of first) expect(isAllowedEntryName(name)).toBe(true);
    expect(await run()).toEqual(first);
  });
});

describe('website images: the listing is the authority (Q10b, BC-4)', () => {
  const w = (): World => ({
    buckets: {
      'contact-documents': {},
      'website-images': {
        [`${A}/m1.png`]: { size: 5, mimetype: 'image/png' },
        [`${A}/logo/l.png`]: { size: 3, mimetype: 'image/png' },
        [`${A}/stock/s.jpg`]: { size: 2, mimetype: 'image/jpeg' },
        [`${B}/theirs.png`]: { size: 9 },
        ['public/stray.png']: { size: 1 },
      },
    },
    tables: {
      contact_documents: [],
      user_media: [{ id: 'mm1', user_id: A, storage_path: `${A}/m1.png` }, { id: 'mb', user_id: B, storage_path: `${B}/theirs.png` }],
    },
  });

  it('every owner object is in; user_media links the ones with a record', async () => {
    const result = await world(w()).source.inventory(A, budget(), log);
    if (!result.ok) throw new Error('expected ok');
    expect(result.inventory.files.map((f) => [f.entryPath, f.recordSection, f.recordId, f.contentType])).toEqual([
      ['files/website-images/logo/l.png', '', '', 'image/png'],
      ['files/website-images/stock/s.jpg', '', '', 'image/jpeg'],
      ['files/website-images/m1.png', 'images', 'mm1', 'image/png'],
    ]);
    expect(result.inventory.filesWithoutRecord).toBe(2);
  });

  it('S-1b: another owner and non-uuid root folders never appear', async () => {
    const { source, lists } = world(w());
    const result = await source.inventory(A, budget(), log);
    if (!result.ok) throw new Error('expected ok');
    expect(result.inventory.files.some((f) => f.key.includes(B) || f.key.includes('public'))).toBe(false);
    expect(lists.every((l) => l.split(':')[1].startsWith(A))).toBe(true);
  });
});

describe('failure modes', () => {
  it('Q-16: a truncated listing fails the inventory (never a partial "Your files")', async () => {
    const many: Record<string, { size: number }> = {};
    for (let i = 0; i < 5; i += 1) many[`${A}/d${i}/x.png`] = { size: 1 };
    const { source } = world({ buckets: { 'contact-documents': {}, 'website-images': many }, tables: { contact_documents: [], user_media: [] } });
    expect(await source.inventory(A, { deadlineAt: Number.MAX_SAFE_INTEGER, callsLeft: 3 }, log)).toEqual({ ok: false, reason: 'truncated' });
  });

  it('a non-uuid user id is an error with no call', async () => {
    const { source, lists } = world({ buckets: {}, tables: {} });
    expect(await source.inventory('../x', budget(), log)).toEqual({ ok: false, reason: 'error' });
    expect(lists).toEqual([]);
  });

  it('download retries once, then gives null (could not be read)', async () => {
    const { source, downloads } = world({ buckets: { 'website-images': {} }, tables: {} });
    const file = { bucket: 'website-images', key: `${A}/gone.png`, entryPath: 'files/website-images/gone.png', folder: 'website-images', sizeBytes: 1, contentType: 'image/png', recordSection: '' as const, recordId: '' };
    expect(await source.download(A, file)).toBeNull();
    expect(downloads).toHaveLength(2);
    expect(fileIndexRow(file, 'could_not_be_read')).toEqual({
      path_in_export: 'files/website-images/gone.png',
      folder: 'website-images',
      size_bytes: 1,
      content_type: 'image/png',
      record_section: '',
      record_id: '',
      status: 'could_not_be_read',
    });
  });

  it('the index row never carries the storage key', () => {
    const row = fileIndexRow(
      { bucket: 'contact-documents', key: `${A}/${C1}/1_x.pdf`, entryPath: `files/client-documents/${C1}/x.pdf`, folder: 'client-documents', sizeBytes: 1, contentType: 'application/pdf', recordSection: 'client_documents', recordId: 'd1' },
      'included'
    );
    expect(JSON.stringify(row)).not.toContain(`${A}/`);
  });
});
