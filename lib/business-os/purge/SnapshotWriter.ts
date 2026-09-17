// lib/business-os/purge/SnapshotWriter.ts
//
// T10 — the pre-purge snapshot.
//
// This is the only thing standing between a Reset and a surprise. Everything
// else in the feature can be rebuilt from the requirement; the rows cannot.
//
// ── "Verified" means write-then-read-back (SA-4) ───────────────────────────
// A 200 from the storage API means the request was accepted, not that the
// bytes are retrievable. So the writer downloads what it just wrote and
// compares. If the read-back does not match, the snapshot is treated as absent
// and the run MUST abort with zero rows deleted (AC-35).
//
// That is not belt-and-braces. The whole value of the artefact is that it can
// be read AFTER the data is gone, which is the one moment it is too late to
// discover it could not be.
//
// ── Why the child ids are captured separately ──────────────────────────────
// `website_blocks`, `smart_link_clicks` and `user_capability_blocks` have no
// `user_id`; they are reachable only through a parent. After a purge the
// parents are gone, so nothing in the database can tell you which children
// SHOULD have been removed. AC-5 is therefore only testable if those ids were
// captured beforehand — the snapshot is its sole possible oracle (C-13).
//
// C-14: the assertion that consumes this must first prove the captured id set
// is non-empty and matches a known seeded count. An artefact produced by the
// system under test can lie in exactly one way — by being empty — and an
// empty-set assertion passes vacuously.

import { createLogger } from '@/lib/logger';
import { descriptorsForRun } from './descriptors';
import type { PurgeLevel, PurgeOptions } from './types';
import { businessPurgeRepository } from '@/lib/repositories/BusinessPurgeRepository';

const logger = createLogger({ module: 'PurgeSnapshotWriter' });

export const SNAPSHOT_BUCKET = 'business-purge-snapshots';

/**
 * Row ceiling for the whole snapshot (DEV-Q6).
 *
 * Exceeding it REFUSES rather than truncating. A truncated snapshot is the
 * forensic equivalent of a false all-clear: it looks like a record and is
 * missing the part you will eventually want.
 *
 * The two unbounded, publicly-writable analytics tables are exempt by carrying
 * `snapshot: 'ids'` in their descriptors — a ceiling applied to those would
 * make a high-traffic business permanently undeletable, which is a broken
 * product rather than a safety property.
 *
 * Measured basis: the live account used for slice 1 produced 74 rows for a
 * full Reset. 250k leaves four orders of magnitude of headroom below anything
 * that would trouble a serverless function's memory.
 */
export const SNAPSHOT_ROW_CEILING = 250_000;

export interface SnapshotTableEntry {
  table: string;
  mode: 'rows' | 'ids';
  count: number;
  /** Full rows, or `{id}` objects when the descriptor is ids-only. */
  data: unknown[];
}

export interface SnapshotResult {
  ok: boolean;
  path?: string;
  bytes?: number;
  tableCount?: number;
  rowCount?: number;
  /** Present on failure. The run must abort on any of these. */
  error?: string;
  verified: boolean;
}

export async function writeVerifiedSnapshot(params: {
  userId: string;
  level: PurgeLevel;
  options: PurgeOptions;
  correlationId: string;
  /** Recorded inside the snapshot so the artefact carries its own context. */
  context?: Record<string, unknown>;
}): Promise<SnapshotResult> {
  const { userId, level, options, correlationId, context } = params;
  const log = logger.child({ correlationId });
  const descriptors = descriptorsForRun(level, options);

  log.info({ userId, level, descriptors: descriptors.length }, 'Building pre-purge snapshot');

  // ── Collect ─────────────────────────────────────────────────────────────
  const tables: SnapshotTableEntry[] = [];
  let rowCount = 0;

  for (const descriptor of descriptors) {
    const { rows, error } = await businessPurgeRepository.readAllRows(descriptor, userId);

    if (rows === null) {
      // A table we could not read is a table we could not record. Refuse —
      // proceeding would delete rows with no forensic trace of them.
      return {
        ok: false,
        verified: false,
        error: `could not read ${descriptor.table} for the snapshot: ${error ?? 'unknown error'}`,
      };
    }

    rowCount += rows.length;
    if (rowCount > SNAPSHOT_ROW_CEILING) {
      return {
        ok: false,
        verified: false,
        error: `snapshot exceeds the ${SNAPSHOT_ROW_CEILING.toLocaleString()}-row ceiling; refusing rather than truncating`,
      };
    }

    tables.push({
      table: descriptor.table,
      mode: descriptor.snapshot,
      count: rows.length,
      data: rows,
    });
  }

  // Child ids, called out separately so AC-5's oracle is unambiguous rather
  // than something a reader has to reassemble from the table list.
  const childIds: Record<string, string[]> = {};
  for (const entry of tables) {
    const descriptor = descriptors.find((d) => d.table === entry.table);
    if (descriptor?.scope.kind === 'via') {
      childIds[entry.table] = entry.data
        .map((r) => (r as { id?: string }).id)
        .filter((id): id is string => typeof id === 'string');
    }
  }

  const payload = {
    schemaVersion: 1,
    kind: 'business-purge-snapshot',
    userId,
    level,
    options,
    correlationId,
    generatedAt: new Date().toISOString(),
    rowCount,
    tableCount: tables.length,
    /** AC-5's oracle. See the header. */
    childIds,
    context: context ?? {},
    tables,
  };

  const body = JSON.stringify(payload);
  const path = `${userId}/${new Date().toISOString().replace(/[:.]/g, '-')}.json`;

  // ── Write ───────────────────────────────────────────────────────────────
  try {
    await businessPurgeRepository.writeSnapshot(SNAPSHOT_BUCKET, path, body);
  } catch (error) {
    return {
      ok: false,
      verified: false,
      error: `snapshot write failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  // ── Read back and verify ────────────────────────────────────────────────
  try {
    const back = await businessPurgeRepository.readSnapshot(SNAPSHOT_BUCKET, path);

    if (back.length !== body.length) {
      return {
        ok: false,
        verified: false,
        path,
        error: `snapshot read-back length mismatch: wrote ${body.length} bytes, read ${back.length}`,
      };
    }

    // Byte length alone would pass for a same-size but different object, so
    // re-parse and check the table-key set — the property the artefact is
    // actually for.
    const parsed = JSON.parse(back) as typeof payload;
    const wroteKeys = tables.map((t) => t.table).sort().join(',');
    const readKeys = parsed.tables.map((t) => t.table).sort().join(',');

    if (wroteKeys !== readKeys) {
      return { ok: false, verified: false, path, error: 'snapshot read-back table-key set mismatch' };
    }

    if (parsed.rowCount !== rowCount) {
      return { ok: false, verified: false, path, error: 'snapshot read-back row count mismatch' };
    }

    log.info(
      { userId, path, bytes: body.length, tableCount: tables.length, rowCount },
      'Pre-purge snapshot written and verified',
    );

    return {
      ok: true,
      verified: true,
      path,
      bytes: body.length,
      tableCount: tables.length,
      rowCount,
    };
  } catch (error) {
    return {
      ok: false,
      verified: false,
      path,
      error: `snapshot read-back failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
