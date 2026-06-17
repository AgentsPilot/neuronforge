/**
 * ExecutionGraphCompiler — WP-60 (stem-aware config param matching)
 *
 * Background:
 *   The param auto-binder's third pass (`normalizeActionConfigWithSchema`)
 *   fuzzy-matches a missing required action param against workflow config keys
 *   via token-Jaccard with a 0.4 threshold. `folder_id` vs `folder_link` scores
 *   {folder,id}∩{folder,link}/{folder,id,link} = 0.333 < 0.4, so `list_files`'
 *   `folder_id` was left UNBOUND and the action defaulted to the Drive root.
 *
 *   WP-60 adds a stem-equality strong signal: dropping a trailing role-suffix
 *   token (id/link/url) makes `folder_id` and `folder_link` collapse to the same
 *   stem `folder` (full match), while genuinely different entities (`file_id` vs
 *   `sheet_id`) keep distinct stems and stay unmatched. It is an exact stem
 *   check, not a Jaccard threshold relaxation, so it adds no partial-overlap
 *   false positives.
 */

import { ExecutionGraphCompiler } from '../ExecutionGraphCompiler'

// findBestConfigMatch / stemKey are private and stateless — exercise them directly.
const compiler = new ExecutionGraphCompiler() as any
const match = (target: string, config: Record<string, any>, threshold = 0.4) =>
  compiler.findBestConfigMatch(target, config, threshold)

describe('ExecutionGraphCompiler — WP-60 stem-aware config matching', () => {
  it('binds folder_id to folder_link (the regression case)', () => {
    expect(
      match('folder_id', {
        folder_link: 'https://drive.google.com/drive/folders/ABC',
        user_email: 'x@y.com',
        email_format: 'table',
      })
    ).toBe('folder_link')
  })

  it('binds across all id/link/url role suffixes', () => {
    expect(match('folder_id', { folder_url: 'u' })).toBe('folder_url')
    expect(match('parent_folder_id', { parent_folder_link: 'u' })).toBe('parent_folder_link')
    expect(match('file_url', { file_id: 'x' })).toBe('file_id')
  })

  it('does NOT match different entities that only share a role suffix', () => {
    // file_id vs sheet_id: stems 'file' != 'sheet'; Jaccard {file,id}/{sheet,id} = 0.333 < 0.4
    expect(match('file_id', { sheet_id: 'x', name: 'n' })).toBeUndefined()
  })

  it('does NOT match on a shared stem-word when one side is not a role suffix', () => {
    // invoice_id vs invoice_date: stems 'invoice' != 'invoice_date'; Jaccard 0.333 < 0.4
    expect(match('invoice_id', { invoice_date: '2026-01-01' })).toBeUndefined()
  })

  it('prefers an exact key over a stem-only match', () => {
    expect(
      match('folder_id', { folder_id: 'BARE', folder_link: 'https://…/folders/ABC' })
    ).toBe('folder_id')
  })

  it('leaves unrelated params unmatched (no regression)', () => {
    expect(match('max_results', { folder_link: 'u', user_email: 'x@y.com' })).toBeUndefined()
  })

  it('stemKey drops only a trailing role suffix, never to empty', () => {
    expect(compiler.stemKey('folder_id')).toBe('folder')
    expect(compiler.stemKey('folder_link')).toBe('folder')
    expect(compiler.stemKey('parent_folder_url')).toBe('parent_folder')
    expect(compiler.stemKey('file_id')).toBe('file')
    expect(compiler.stemKey('id')).toBe('id') // single token — not reduced to empty
    expect(compiler.stemKey('email_format')).toBe('email_format') // no role suffix
  })
})
