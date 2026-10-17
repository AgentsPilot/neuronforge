/**
 * DE-8b T-8 (workplan §14 bounds F-1 ... F-6; SA C-5, C-6): the read-only
 * files repository. Storage and tables are faked in memory and injected.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { BusinessDataExportFilesRepository, includedBucketFolder, isOwnerObjectKey } from '../BusinessDataExportFilesRepository';
import type { ExportFileBudget } from '../types';

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
const C1 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

type Obj = { size?: number; mimetype?: string };

/** A bucket as a flat map of full keys; `list(prefix)` returns its immediate children like Storage. */
function fakeStorage(buckets: Record<string, Record<string, Obj>>) {
  const listCalls: Array<{ bucket: string; prefix: string }> = [];
  const downloadCalls: Array<{ bucket: string; key: string }> = [];
  const extraEntries: Record<string, Array<Record<string, unknown>>> = {};
  const storage = {
    from: (bucket: string) => ({
      list: async (prefix: string, opts: { limit: number; offset: number }) => {
        listCalls.push({ bucket, prefix });
        const keys = Object.keys(buckets[bucket] ?? {});
        const children = new Map<string, Record<string, unknown>>();
        for (const key of keys) {
          const rest = prefix === '' ? key : key.startsWith(`${prefix}/`) ? key.slice(prefix.length + 1) : null;
          if (rest === null) continue;
          const [head, ...tail] = rest.split('/');
          if (tail.length === 0) {
            const meta = buckets[bucket][key];
            children.set(head, { name: head, id: `id-${key}`, metadata: { size: meta.size, mimetype: meta.mimetype } });
          } else if (!children.has(head)) {
            children.set(head, { name: head, id: null });
          }
        }
        const all = [...children.values(), ...(extraEntries[`${bucket}|${prefix}`] ?? [])];
        return { data: all.slice(opts.offset, opts.offset + opts.limit), error: null };
      },
      download: async (key: string) => {
        downloadCalls.push({ bucket, key });
        if (!(buckets[bucket] ?? {})[key]) return { data: null, error: { message: 'Object not found' } };
        const bytes = new TextEncoder().encode(`bytes of ${key}`);
        return { data: { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }, error: null };
      },
    }),
  };
  return { storage, listCalls, downloadCalls, extraEntries };
}

/** A table query builder that records filters and pages through `rows`. */
function fakeTables(tables: Record<string, Array<Record<string, unknown>>>) {
  const calls: Array<{ table: string; select?: string; filters: Array<[string, string, unknown]> }> = [];
  const from = (table: string) => {
    const call = { table, select: undefined as string | undefined, filters: [] as Array<[string, string, unknown]> };
    calls.push(call);
    let limit = Infinity;
    const builder: Record<string, unknown> = {
      select: (cols: string) => ((call.select = cols), builder),
      eq: (c: string, v: unknown) => (call.filters.push(['eq', c, v]), builder),
      neq: (c: string, v: unknown) => (call.filters.push(['neq', c, v]), builder),
      gt: (c: string, v: unknown) => (call.filters.push(['gt', c, v]), builder),
      order: () => builder,
      limit: (n: number) => ((limit = n), builder),
      then: (resolve: (v: unknown) => void) => {
        let rows = [...(tables[table] ?? [])];
        for (const [op, c, v] of call.filters) {
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
  return { from, calls };
}

function repoWith(buckets: Record<string, Record<string, Obj>>, tables: Record<string, Array<Record<string, unknown>>> = {}, clock = () => 0) {
  const s = fakeStorage(buckets);
  const t = fakeTables(tables);
  const client = { storage: s.storage, from: t.from } as unknown as SupabaseClient;
  return { repo: new BusinessDataExportFilesRepository(client, clock), ...s, tableCalls: t.calls };
}

const budget = (): ExportFileBudget => ({ deadlineAt: Number.MAX_SAFE_INTEGER, callsLeft: 300 });

describe('listOwnerObjects', () => {
  it('walks recursively from the owner folder, with sizes and types', async () => {
    const { repo } = repoWith({
      'contact-documents': {
        [`${A}/${C1}/1_a.pdf`]: { size: 10, mimetype: 'application/pdf' },
        [`${A}/${C1}/intake/x.png`]: { size: 5, mimetype: 'image/png' },
      },
    });
    const { data, error } = await repo.listOwnerObjects('contact-documents', A, budget());
    expect(error).toBeNull();
    expect(data!.truncated).toBe(false);
    expect(data!.objects.map((o) => [o.key, o.size, o.contentType]).sort()).toEqual([
      [`${A}/${C1}/1_a.pdf`, 10, 'application/pdf'],
      [`${A}/${C1}/intake/x.png`, 5, 'image/png'],
    ]);
  });

  it('pages a folder of more than 1000 entries', async () => {
    const many: Record<string, Obj> = {};
    for (let i = 0; i < 1500; i += 1) many[`${A}/f${String(i).padStart(4, '0')}.png`] = { size: 1 };
    const { repo, listCalls } = repoWith({ 'website-images': many });
    const { data } = await repo.listOwnerObjects('website-images', A, budget());
    expect(data!.objects).toHaveLength(1500);
    expect(listCalls.filter((c) => c.prefix === A)).toHaveLength(2);
  });

  it('the budget gives truncated, never a silently partial listing', async () => {
    const { repo } = repoWith({ 'website-images': { [`${A}/a/b/c.png`]: { size: 1 } } });
    const { data } = await repo.listOwnerObjects('website-images', A, { deadlineAt: Number.MAX_SAFE_INTEGER, callsLeft: 1 });
    expect(data!.truncated).toBe(true);
  });

  it('the wall clock budget also truncates', async () => {
    const { repo } = repoWith({ 'website-images': { [`${A}/c.png`]: { size: 1 } } }, {}, () => 100);
    const { data } = await repo.listOwnerObjects('website-images', A, { deadlineAt: 50, callsLeft: 300 });
    expect(data!.truncated).toBe(true);
  });

  it('S-1b / C-5: another owner and non-uuid root folders are never listed, downloaded or returned', async () => {
    const { repo, listCalls, downloadCalls } = repoWith({
      'website-images': {
        [`${A}/mine.png`]: { size: 1 },
        [`${B}/theirs.png`]: { size: 1 },
        ['public/stray.png']: { size: 1 },
        ['templates/x.png']: { size: 1 },
      },
    });
    const { data } = await repo.listOwnerObjects('website-images', A, budget());
    expect(data!.objects.map((o) => o.key)).toEqual([`${A}/mine.png`]);
    for (const call of listCalls) expect(call.prefix === A || call.prefix.startsWith(`${A}/`)).toBe(true);
    expect(downloadCalls).toEqual([]);
  });

  it('F-3: a listing that returns ../other-uid/x or a slashed name is rejected and counted', async () => {
    const { repo, extraEntries } = repoWith({ 'website-images': { [`${A}/ok.png`]: { size: 1 } } });
    extraEntries[`website-images|${A}`] = [
      { name: `../${B}/x.png`, id: 'evil-1', metadata: { size: 1 } },
      { name: `${B}/x.png`, id: 'evil-2', metadata: { size: 1 } },
      { name: '..', id: null },
      { name: 'a\u0000b', id: 'evil-3', metadata: {} },
    ];
    const { data } = await repo.listOwnerObjects('website-images', A, budget());
    expect(data!.objects.map((o) => o.key)).toEqual([`${A}/ok.png`]);
    expect(data!.rejected).toBe(4);
  });

  it('F-2: an exclude bucket is refused with no call', async () => {
    const { repo, listCalls } = repoWith({});
    for (const bucket of ['business-data-exports', 'business-purge-snapshots', 'unknown-bucket']) {
      const { data, error } = await repo.listOwnerObjects(bucket, A, budget());
      expect(data).toBeNull();
      expect(error).not.toBeNull();
    }
    expect(listCalls).toEqual([]);
  });

  it('C-5: a user id that is not a uuid is refused with no call (no empty or slashed prefix)', async () => {
    const { repo, listCalls } = repoWith({});
    for (const bad of ['', '/', `${A}/..`, 'x']) {
      const { error } = await repo.listOwnerObjects('website-images', bad, budget());
      expect(error).not.toBeNull();
    }
    expect(listCalls).toEqual([]);
  });
});

describe('downloadOwnerObject', () => {
  it('reads the owner object bytes', async () => {
    const { repo } = repoWith({ 'website-images': { [`${A}/a.png`]: { size: 1 } } });
    const { data } = await repo.downloadOwnerObject('website-images', A, `${A}/a.png`);
    expect(new TextDecoder().decode(data!)).toBe(`bytes of ${A}/a.png`);
  });

  it('another owner key, a traversal key or an exclude bucket is refused with no call', async () => {
    const { repo, downloadCalls } = repoWith({ 'website-images': { [`${B}/a.png`]: { size: 1 } } });
    for (const [bucket, key] of [
      ['website-images', `${B}/a.png`],
      ['website-images', `${A}/../${B}/a.png`],
      ['website-images', `${A}/a\\..\\b`],
      ['business-data-exports', `${A}/x/1.zip`],
    ]) {
      const { error } = await repo.downloadOwnerObject(bucket, A, key);
      expect(error).not.toBeNull();
    }
    expect(downloadCalls).toEqual([]);
  });

  it('a missing object is an error, never a throw', async () => {
    const { repo } = repoWith({ 'website-images': {} });
    const { data, error } = await repo.downloadOwnerObject('website-images', A, `${A}/gone.png`);
    expect(data).toBeNull();
    expect(error).not.toBeNull();
  });
});

describe('listOwnerFolders (the size watch, cron only)', () => {
  it('returns uuid folders only and counts the rest', async () => {
    const { repo } = repoWith({
      'website-images': { [`${A}/a.png`]: {}, [`${B}/b.png`]: {}, ['public/x.png']: {}, ['root.png']: {} },
    });
    const { data } = await repo.listOwnerFolders('website-images', budget());
    expect(data!.owners.sort()).toEqual([A, B]);
    expect(data!.skipped).toBe(2);
  });

  it('refuses an exclude bucket', async () => {
    const { repo, listCalls } = repoWith({});
    expect((await repo.listOwnerFolders('business-data-exports', budget())).error).not.toBeNull();
    expect(listCalls).toEqual([]);
  });
});

describe('record tables', () => {
  const docs = [
    { id: '01', user_id: A, contact_id: C1, storage_path: `${A}/${C1}/1_a.pdf`, storage_bucket: null, file_name: 'a.pdf', mime_type: 'application/pdf', status: 'active' },
    { id: '02', user_id: A, contact_id: C1, storage_path: `${A}/${C1}/2_b.pdf`, storage_bucket: null, file_name: 'b.pdf', mime_type: null, status: 'deleted' },
    { id: '03', user_id: B, contact_id: C1, storage_path: `${B}/${C1}/3_c.pdf`, storage_bucket: null, file_name: 'c.pdf', mime_type: null, status: 'active' },
  ];

  it('listLiveDocumentFiles: the owner live rows only, scoped by user_id, deleted out', async () => {
    const { repo, tableCalls } = repoWith({}, { contact_documents: docs });
    const { data } = await repo.listLiveDocumentFiles(A, 100);
    expect(data!.map((r) => r.id)).toEqual(['01']);
    expect(tableCalls[0].filters).toEqual(expect.arrayContaining([['eq', 'user_id', A], ['neq', 'status', 'deleted']]));
    expect(tableCalls[0].select).toBe('id, contact_id, storage_path, storage_bucket, file_name, mime_type');
  });

  it('listMediaPaths: scoped by user_id, two columns', async () => {
    const { repo, tableCalls } = repoWith({}, { user_media: [{ id: 'm1', user_id: A, storage_path: `${A}/x.png` }, { id: 'm2', user_id: B, storage_path: `${B}/y.png` }] });
    const { data } = await repo.listMediaPaths(A, 100);
    expect(data).toEqual([{ id: 'm1', user_id: A, storage_path: `${A}/x.png` }]);
    expect(tableCalls[0].select).toBe('id, storage_path');
    expect(tableCalls[0].filters).toContainEqual(['eq', 'user_id', A]);
  });

  it('keyset pages to the end, and more rows than maxRows is an error', async () => {
    const rows = Array.from({ length: 2500 }, (_, i) => ({ id: String(i).padStart(5, '0'), user_id: A, storage_path: null }));
    const { repo } = repoWith({}, { user_media: rows });
    expect((await repo.listMediaPaths(A, 5000)).data).toHaveLength(2500);
    expect((await repo.listMediaPaths(A, 2000)).error).not.toBeNull();
  });

  it('a bad user id is refused with no query', async () => {
    const { repo, tableCalls } = repoWith({}, {});
    expect((await repo.listLiveDocumentFiles('nope', 10)).error).not.toBeNull();
    expect((await repo.listMediaPaths('', 10)).error).not.toBeNull();
    expect(tableCalls).toEqual([]);
  });
});

describe('helpers', () => {
  it('includedBucketFolder follows STORAGE_DESCRIPTORS', () => {
    expect(includedBucketFolder('contact-documents')).toBe('client-documents');
    expect(includedBucketFolder('website-images')).toBe('website-images');
    expect(includedBucketFolder('business-data-exports')).toBeNull();
  });

  it('isOwnerObjectKey', () => {
    expect(isOwnerObjectKey(A, `${A}/x/y.png`)).toBe(true);
    expect(isOwnerObjectKey(A, `${A}/../x`)).toBe(false);
    expect(isOwnerObjectKey(A, `${B}/x`)).toBe(false);
    expect(isOwnerObjectKey(A, `${A}x/y`)).toBe(false);
  });
});

describe('source bounds', () => {
  const ROOT = process.cwd();
  const source = fs.readFileSync(path.join(ROOT, 'lib/repositories/BusinessDataExportFilesRepository.ts'), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('F-1: read-only (no upload, remove, update, insert, delete, upsert, rpc, move, copy)', () => {
    for (const verb of ['upload', 'remove', 'update', 'insert', 'delete', 'upsert', 'rpc', 'move', 'copy', 'createSignedUrl']) {
      expect(code).not.toMatch(new RegExp(`\\.${verb}\\(`));
    }
  });

  it('F-6: imported only by fileManifest.ts (tests aside), and not in the repositories barrel', () => {
    const importers: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir)) {
        if (['node_modules', '.next', '.git', '__tests__', '.claude'].includes(entry)) continue;
        const full = path.join(dir, entry);
        if (fs.statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry) && /BusinessDataExportFilesRepository['"]/.test(fs.readFileSync(full, 'utf8'))) {
          importers.push(path.relative(ROOT, full).split(path.sep).join('/'));
        }
      }
    };
    for (const dir of ['app', 'lib', 'components', 'hooks', 'scripts']) if (fs.existsSync(path.join(ROOT, dir))) walk(path.join(ROOT, dir));
    // The module names itself (its logger service); that is not an import.
    const others = importers.filter((file) => file !== 'lib/repositories/BusinessDataExportFilesRepository.ts');
    expect(others).toEqual(['lib/business-os/data-export/fileManifest.ts']);
    // Negative control: the scan does see a real importer.
    expect(importers).toContain('lib/business-os/data-export/fileManifest.ts');
  });
});
