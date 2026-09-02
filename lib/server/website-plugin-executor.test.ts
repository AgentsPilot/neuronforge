// lib/server/website-plugin-executor.test.ts
//
// Fast, pure unit tests for the Website plugin executor. Repositories are mocked (no DB).
// Focus: dispatch, missing user_id, the G3 block ownership guards (Option A — a block op against a
// page the user doesn't own fails closed with access_denied BEFORE the mutating call, and a
// PGRST116 { data: null, error } is treated as not-owned), and the M1 page allow-lists (a
// caller-supplied params.user_id / params.id / params.status is dropped — create/update receive the
// authenticated userId and a payload without the injected fields).
//
// DB-backed behaviour (real publish, analytics rollups, cross-tenant guard end-to-end) is QA-manual
// — see the workplan lean-test policy.

const pageRepo = {
  listByUser: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  publish: jest.fn(),
  unpublish: jest.fn(),
};
const blockRepo = {
  findById: jest.fn(),
  findByPageId: jest.fn(),
  toggleEnabled: jest.fn(),
  updateContent: jest.fn(),
};
const analyticsRepo = {
  getSummary: jest.fn(),
  getPageSummary: jest.fn(),
};

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));
jest.mock('@/lib/repositories/WebsitePageRepository', () => ({
  WebsitePageRepository: jest.fn().mockImplementation(() => pageRepo),
}));
jest.mock('@/lib/repositories/WebsiteBlockRepository', () => ({
  WebsiteBlockRepository: jest.fn().mockImplementation(() => blockRepo),
}));
jest.mock('@/lib/repositories/WebsiteAnalyticsRepository', () => ({
  WebsiteAnalyticsRepository: jest.fn().mockImplementation(() => analyticsRepo),
}));

import { WebsitePluginExecutor } from './website-plugin-executor';

function run(action: string, params: any, connection: any = { user_id: 'u1' }) {
  const executor = new WebsitePluginExecutor({} as any, {} as any);
  return (executor as any).executeSpecificAction(connection, action, params);
}

const ok = (data: any) => ({ data, error: null });
// PGRST116 shape: not-owned/not-found returns null data with a NON-null error (M2).
const notOwned = () => ({ data: null, error: Object.assign(new Error('no rows'), { code: 'PGRST116' }) });

beforeEach(() => {
  jest.clearAllMocks();
  pageRepo.listByUser.mockResolvedValue(ok([{ id: 'p1' }]));
  pageRepo.findById.mockResolvedValue(ok({ id: 'p1', user_id: 'u1', slug: 's' }));
  pageRepo.create.mockResolvedValue(ok({ id: 'p1' }));
  pageRepo.update.mockResolvedValue(ok({ id: 'p1' }));
  pageRepo.publish.mockResolvedValue(ok({ id: 'p1', status: 'live' }));
  pageRepo.unpublish.mockResolvedValue(ok({ id: 'p1', status: 'draft' }));
  blockRepo.findById.mockResolvedValue(ok({ id: 'b1', page_id: 'p1' }));
  blockRepo.findByPageId.mockResolvedValue(ok([{ id: 'b1' }]));
  blockRepo.toggleEnabled.mockResolvedValue(ok({ id: 'b1', enabled: false }));
  blockRepo.updateContent.mockResolvedValue(ok({ id: 'b1' }));
  analyticsRepo.getSummary.mockResolvedValue(ok({ total_views: 0 }));
  analyticsRepo.getPageSummary.mockResolvedValue(ok({ total_views: 0 }));
});

describe('WebsitePluginExecutor — page dispatch', () => {
  it('list_pages → listByUser(userId)', async () => {
    const res = await run('list_pages', {});
    expect(pageRepo.listByUser).toHaveBeenCalledWith('u1');
    expect(res).toEqual([{ id: 'p1' }]);
  });

  it('get_page → findById(id, userId) and returns the page', async () => {
    const res = await run('get_page', { id: 'p1' });
    expect(pageRepo.findById).toHaveBeenCalledWith('p1', 'u1');
    expect(res).toEqual({ id: 'p1', user_id: 'u1', slug: 's' });
  });

  it('get_page → access_denied when the page is not owned (null data)', async () => {
    pageRepo.findById.mockResolvedValueOnce(notOwned());
    await expect(run('get_page', { id: 'foreign' })).rejects.toThrow(/access_denied/);
  });

  it('publish_page → publish(id, userId)', async () => {
    const res = await run('publish_page', { id: 'p1' });
    expect(pageRepo.publish).toHaveBeenCalledWith('p1', 'u1');
    expect(res).toEqual({ id: 'p1', status: 'live' });
  });

  it('unpublish_page → unpublish(id, userId)', async () => {
    await run('unpublish_page', { id: 'p1' });
    expect(pageRepo.unpublish).toHaveBeenCalledWith('p1', 'u1');
  });
});

describe('WebsitePluginExecutor — M1 page allow-lists', () => {
  it('create_page: injected user_id / id / status are DROPPED; user_id is the authenticated id', async () => {
    await run('create_page', {
      user_id: 'ATTACKER',
      id: 'INJECTED',
      status: 'live',
      published: true,
      custom_domain_verified: true,
      page_type: 'landing',
      slug: 'promo',
      title: 'Promo',
      meta_description: 'desc',
    });
    expect(pageRepo.create).toHaveBeenCalledTimes(1);
    const [page] = pageRepo.create.mock.calls[0];
    expect(page.user_id).toBe('u1');
    expect(page).toEqual({
      user_id: 'u1',
      page_type: 'landing',
      slug: 'promo',
      title: 'Promo',
      meta_description: 'desc',
    });
    expect(page).not.toHaveProperty('id');
    expect(page).not.toHaveProperty('status');
    expect(page).not.toHaveProperty('published');
    expect(page).not.toHaveProperty('custom_domain_verified');
  });

  it('update_page: a params.user_id is IGNORED — update gets the authenticated userId and a patch WITHOUT user_id', async () => {
    await run('update_page', {
      id: 'p1',
      user_id: 'ATTACKER',
      status: 'live',
      published: true,
      custom_domain_verified: true,
      title: 'New title',
    });
    expect(pageRepo.update).toHaveBeenCalledTimes(1);
    const [id, passedUserId, patch] = pageRepo.update.mock.calls[0];
    expect(id).toBe('p1');
    expect(passedUserId).toBe('u1');
    expect(patch).toEqual({ title: 'New title' });
    expect(patch).not.toHaveProperty('user_id');
    expect(patch).not.toHaveProperty('status');
    expect(patch).not.toHaveProperty('published');
    expect(patch).not.toHaveProperty('custom_domain_verified');
  });

  it('create_page requires page_type / slug / title', async () => {
    await expect(run('create_page', { slug: 's', title: 't' })).rejects.toThrow(/page_type/);
    expect(pageRepo.create).not.toHaveBeenCalled();
  });

  it('update_page requires id', async () => {
    await expect(run('update_page', { title: 't' })).rejects.toThrow(/id/);
    expect(pageRepo.update).not.toHaveBeenCalled();
  });
});

describe('WebsitePluginExecutor — G3 block ownership (Option A)', () => {
  it('list_blocks: unowned pageId → access_denied, findByPageId NOT called', async () => {
    pageRepo.findById.mockResolvedValueOnce(notOwned());
    await expect(run('list_blocks', { page_id: 'foreign' })).rejects.toThrow(/access_denied/);
    expect(blockRepo.findByPageId).not.toHaveBeenCalled();
  });

  it('list_blocks: owned page → asserts ownership then findByPageId(pageId, enabledOnly)', async () => {
    await run('list_blocks', { page_id: 'p1', enabled_only: true });
    expect(pageRepo.findById).toHaveBeenCalledWith('p1', 'u1');
    expect(blockRepo.findByPageId).toHaveBeenCalledWith('p1', true);
  });

  it('toggle_block: block whose page is unowned → access_denied BEFORE toggleEnabled', async () => {
    pageRepo.findById.mockResolvedValueOnce(notOwned()); // block found, but its page is not owned
    await expect(run('toggle_block', { block_id: 'b1', enabled: false })).rejects.toThrow(/access_denied/);
    expect(blockRepo.toggleEnabled).not.toHaveBeenCalled();
  });

  it('toggle_block: non-existent blockId → access_denied, toggleEnabled NOT called', async () => {
    blockRepo.findById.mockResolvedValueOnce(notOwned());
    await expect(run('toggle_block', { block_id: 'missing', enabled: true })).rejects.toThrow(/access_denied/);
    expect(blockRepo.toggleEnabled).not.toHaveBeenCalled();
  });

  it('toggle_block: owned → resolves ownership then toggleEnabled(blockId, enabled)', async () => {
    await run('toggle_block', { block_id: 'b1', enabled: false });
    expect(blockRepo.findById).toHaveBeenCalledWith('b1');
    expect(pageRepo.findById).toHaveBeenCalledWith('p1', 'u1');
    expect(blockRepo.toggleEnabled).toHaveBeenCalledWith('b1', false);
  });

  it('update_block_content: block whose page is unowned → access_denied BEFORE updateContent', async () => {
    pageRepo.findById.mockResolvedValueOnce(notOwned());
    await expect(
      run('update_block_content', { block_id: 'b1', content: { headline: 'x' } })
    ).rejects.toThrow(/access_denied/);
    expect(blockRepo.updateContent).not.toHaveBeenCalled();
  });

  it('update_block_content: owned → updateContent(blockId, content)', async () => {
    await run('update_block_content', { block_id: 'b1', content: { headline: 'x' } });
    expect(blockRepo.updateContent).toHaveBeenCalledWith('b1', { headline: 'x' });
  });
});

describe('WebsitePluginExecutor — analytics', () => {
  it('get_analytics_summary → getSummary(userId, subdomain)', async () => {
    await run('get_analytics_summary', { subdomain: 'acme' });
    expect(analyticsRepo.getSummary).toHaveBeenCalledWith('u1', 'acme');
  });

  it('get_page_analytics → getPageSummary(pageId, userId)', async () => {
    await run('get_page_analytics', { page_id: 'p1' });
    expect(analyticsRepo.getPageSummary).toHaveBeenCalledWith('p1', 'u1');
  });
});

describe('WebsitePluginExecutor — guards', () => {
  it('throws access_denied when connection has no user_id', async () => {
    await expect(run('list_pages', {}, {})).rejects.toThrow(/access_denied/);
  });

  it('rejects unknown actions', async () => {
    await expect(run('frobnicate', {})).rejects.toThrow(/not supported/);
  });

  it('requires page_id on list_blocks (before any ownership read)', async () => {
    await expect(run('list_blocks', {})).rejects.toThrow(/page_id/);
    expect(pageRepo.findById).not.toHaveBeenCalled();
  });

  it('propagates a repository error as a throw', async () => {
    pageRepo.listByUser.mockResolvedValueOnce({ data: null, error: new Error('boom') });
    await expect(run('list_pages', {})).rejects.toThrow('boom');
  });
});
