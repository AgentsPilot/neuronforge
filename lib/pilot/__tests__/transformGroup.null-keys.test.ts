/**
 * transformGroup — null/undefined/empty group-key guard (2026-05-10)
 *
 * Background: in Phase E of `leads-per-salesperson-email`, Lead 5's row in
 * the source spreadsheet was missing the "Sales Person" column (only 7 of 8
 * cols present). After rows_to_objects + map, that lead had `sales_person:
 * null`. The group transform coerced the key via `String(null)` = `"null"`
 * and put the lead into a group keyed by the literal string `"null"`. The
 * downstream scatter_gather sent a per-salesperson email with `to: ["null"]`
 * — invalid recipient, send returned null, silent failure.
 *
 * Fix: by default, skip items whose group-key value resolves to
 * null / undefined / empty-string and emit a single aggregated warning with
 * the count. Opt-in `config.include_null_keys: true` preserves the legacy
 * "missing" bucket for callers that want it (e.g., data-completeness
 * reports).
 *
 * These tests mirror the relevant slice of `StepExecutor.transformGroup` as
 * a pure function so we don't need to import StepExecutor (which pulls a
 * heavy dependency chain — same pattern as W2 / WP-SR rowsToObjects tests).
 */

interface GroupConfig {
  groupBy?: string
  include_null_keys?: boolean
}

interface GroupResult {
  groups: Array<{ key: string; items: any[]; count: number }>
  skippedNullKeys: number
}

/**
 * Pure-function mirror of the null-key-guard slice of transformGroup.
 * Tests the algorithm without depending on StepExecutor's import chain.
 */
function groupWithNullGuard(items: any[], config: GroupConfig): GroupResult {
  const includeNullKeys = config.include_null_keys === true
  const key = config.groupBy
  let skippedNullKeys = 0

  const grouped = items.reduce((acc, item) => {
    const rawKey = key ? item?.[key] : item
    const isMissing = rawKey === null || rawKey === undefined || rawKey === ''
    if (isMissing && !includeNullKeys) {
      skippedNullKeys++
      return acc
    }
    const k = String(rawKey)
    if (!acc[k]) acc[k] = []
    acc[k].push(item)
    return acc
  }, {} as Record<string, any[]>)

  return {
    groups: Object.entries(grouped).map(([k, v]) => ({
      key: k,
      items: v as any[],
      count: (v as any[]).length,
    })),
    skippedNullKeys,
  }
}

describe('transformGroup — null/undefined/empty-key guard', () => {
  const LEADS = [
    { lead_name: 'Lead 1', sales_person: 'barakm@orpak.com' },
    { lead_name: 'Lead 2', sales_person: 'meiribarak@gmail.com' },
    { lead_name: 'Lead 3', sales_person: 'barak.meiri@gilbarco.com' },
    { lead_name: 'Lead 4', sales_person: 'barak.meiri@gilbarco.com' },
    { lead_name: 'Lead 5', sales_person: null }, // ← the canonical bug case
  ]

  it('default: drops items with null key + records skip count (the WP-SR bug fix)', () => {
    const r = groupWithNullGuard(LEADS, { groupBy: 'sales_person' })
    expect(r.skippedNullKeys).toBe(1)
    expect(r.groups).toHaveLength(3) // not 4 — null group dropped
    expect(r.groups.find(g => g.key === 'null')).toBeUndefined()

    // Lead 5 must NOT appear in any group
    const allItems = r.groups.flatMap(g => g.items)
    expect(allItems.find(it => it.lead_name === 'Lead 5')).toBeUndefined()
  })

  it('default: drops items with undefined key', () => {
    const items = [
      { lead_name: 'A', sales_person: 'x@x.com' },
      { lead_name: 'B' }, // sales_person property missing
    ]
    const r = groupWithNullGuard(items, { groupBy: 'sales_person' })
    expect(r.skippedNullKeys).toBe(1)
    expect(r.groups).toHaveLength(1)
    expect(r.groups[0].key).toBe('x@x.com')
  })

  it('default: drops items with empty-string key', () => {
    const items = [
      { lead_name: 'A', sales_person: 'x@x.com' },
      { lead_name: 'B', sales_person: '' },
    ]
    const r = groupWithNullGuard(items, { groupBy: 'sales_person' })
    expect(r.skippedNullKeys).toBe(1)
    expect(r.groups).toHaveLength(1)
  })

  it('include_null_keys: true → preserves legacy "null" bucket', () => {
    const r = groupWithNullGuard(LEADS, { groupBy: 'sales_person', include_null_keys: true })
    expect(r.skippedNullKeys).toBe(0)
    expect(r.groups).toHaveLength(4)
    const nullGroup = r.groups.find(g => g.key === 'null')
    expect(nullGroup).toBeDefined()
    expect(nullGroup!.items).toHaveLength(1)
    expect(nullGroup!.items[0].lead_name).toBe('Lead 5')
  })

  it('preserves non-null keys: "0", "false", numbers, dates — not treated as missing', () => {
    const items = [
      { id: 1, status: 0 },
      { id: 2, status: false },
      { id: 3, status: 'active' },
      { id: 4, status: null }, // genuinely missing
    ]
    const r = groupWithNullGuard(items, { groupBy: 'status' })
    expect(r.skippedNullKeys).toBe(1)
    expect(r.groups.find(g => g.key === '0')).toBeDefined()
    expect(r.groups.find(g => g.key === 'false')).toBeDefined()
    expect(r.groups.find(g => g.key === 'active')).toBeDefined()
  })

  it('groups correctly for the canonical leads scenario (3 distinct sales_persons)', () => {
    const r = groupWithNullGuard(LEADS, { groupBy: 'sales_person' })
    expect(r.groups).toHaveLength(3)
    const keys = r.groups.map(g => g.key).sort()
    expect(keys).toEqual([
      'barak.meiri@gilbarco.com',
      'barakm@orpak.com',
      'meiribarak@gmail.com',
    ])
    expect(r.groups.find(g => g.key === 'barak.meiri@gilbarco.com')!.items).toHaveLength(2)
  })

  it('all-null input (with default behavior) → empty groups + full skip count', () => {
    const items = [{ a: null }, { a: null }, { a: undefined }]
    const r = groupWithNullGuard(items, { groupBy: 'a' })
    expect(r.skippedNullKeys).toBe(3)
    expect(r.groups).toHaveLength(0)
  })
})
