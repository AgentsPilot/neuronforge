/**
 * Capability sweep — is everything the catalog exposes actually reachable?
 *
 *   npx tsx --import ./scripts/env-preload.ts scripts/bizql-capability-sweep.ts [userId]
 *   ... --lang=he      sweep in Hebrew instead of English
 *
 * READ-ONLY. A plan containing a write step is reported and skipped, never run.
 *
 * WHY THIS IS NOT THE GOLDEN SET
 *
 * The golden set asks whether a plan is CORRECT, over questions someone already
 * thought to write down. This asks something cheaper to get wrong: whether every
 * entity, aggregate and derived field in the catalog is reachable from plain
 * language AT ALL. An entity can be catalogued, unit-tested and still dead —
 * nothing in the prompt leads the planner to it — and a suite built from
 * remembered questions cannot see that, because nobody wrote the question for
 * the entity nobody remembered.
 *
 * The probes are DERIVED FROM THE CATALOG, not listed here. Adding an entity
 * automatically adds its coverage, which is the same property that keeps the
 * catalog rather than a table of examples as the single source of truth.
 */

import { getBizQLPlanner } from '@/lib/business-os/bizql/planner/Planner';
import { runBusinessQuery } from '@/lib/business-os/bizql';
import { renderAnswer } from '@/lib/business-os/bizql/render/AnswerRenderer';
import { CATALOG } from '@/lib/business-os/catalog';
import { supabaseServer } from '@/lib/supabaseServer';
import type { Query } from '@/lib/business-os/bizql/types';

type Lang = 'en' | 'he' | 'es';

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
}

/** Phrasings built from the entity's own label — deliberately generic. */
function probesFor(label: string, lang: Lang): Array<{ kind: string; text: string }> {
  if (lang === 'he') {
    return [
      { kind: 'list', text: `הצג לי את ה${label} שלי` },
      { kind: 'count', text: `כמה ${label} יש לי?` },
    ];
  }
  if (lang === 'es') {
    return [
      { kind: 'list', text: `muéstrame mis ${label}` },
      { kind: 'count', text: `¿cuántos ${label} tengo?` },
    ];
  }
  return [
    { kind: 'list', text: `show me my ${label}` },
    { kind: 'count', text: `how many ${label} do I have?` },
  ];
}

function pluralLabel(entityKey: string, lang: Lang): string {
  const labels = CATALOG.entities[entityKey].labels;
  const many = labels.many ?? labels.one;
  return (many as Record<string, string>)[lang] ?? (many as Record<string, string>).en;
}

interface Outcome {
  entity: string;
  kind: string;
  text: string;
  status: 'ok' | 'wrong-entity' | 'asked' | 'refused' | 'error' | 'skipped-write';
  detail: string;
}

async function probe(
  entityKey: string,
  kind: string,
  text: string,
  userId: string,
  lang: Lang
): Promise<Outcome> {
  const base = { entity: entityKey, kind, text };

  const outcome = await getBizQLPlanner().plan({
    message: text,
    userId,
    language: lang,
    timezone: 'UTC',
  });

  if (!outcome.ok) {
    return { ...base, status: 'refused', detail: outcome.error?.split('\n').pop()?.trim() ?? '' };
  }
  if (outcome.clarification) {
    return { ...base, status: 'asked', detail: outcome.clarification };
  }

  const steps = outcome.plan!.steps as Query[];
  if (steps.some((s) => s.op === 'mutate' || s.op === 'for_each')) {
    return { ...base, status: 'skipped-write', detail: 'plan contained a write step' };
  }

  const planned = steps[0]?.entity;
  if (planned !== entityKey) {
    // Not automatically a bug — "how many payments" may legitimately plan over
    // invoices — but it means this probe did not exercise the entity, so the
    // entity is still unproven and the run says so.
    return { ...base, status: 'wrong-entity', detail: `planned '${planned}'` };
  }

  try {
    const results = [];
    for (const step of steps) results.push(await runBusinessQuery(step, { userId, consumer: 'test' }));

    const answer = renderAnswer(outcome.plan!.answer?.text, steps, results, { language: lang });
    const extra = answer.collapsed ? ` (collapsed ${answer.collapsed})` : '';
    return { ...base, status: 'ok', detail: `${answer.text}${extra}` };
  } catch (err) {
    return { ...base, status: 'error', detail: (err as Error).message.split('\n').pop()!.trim() };
  }
}

async function main() {
  const lang = (arg('lang') ?? 'en') as Lang;

  let userId = process.argv.find((a) => !a.startsWith('--') && /^[0-9a-f-]{36}$/i.test(a));
  if (!userId) {
    const { data } = await supabaseServer.from('crm_contacts').select('user_id').limit(1000);
    const counts = new Map<string, number>();
    for (const row of data ?? []) {
      const id = (row as { user_id: string }).user_id;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    userId = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }

  const entities = Object.keys(CATALOG.entities);
  console.log(`user ${userId}   lang ${lang}   ${entities.length} entities   READ-ONLY\n`);

  const outcomes: Outcome[] = [];

  for (const entityKey of entities) {
    const label = pluralLabel(entityKey, lang);
    for (const { kind, text } of probesFor(label, lang)) {
      const result = await probe(entityKey, kind, text, userId, lang);
      outcomes.push(result);

      const mark = { ok: '✓', 'wrong-entity': '~', asked: '?', refused: '✗', error: '✗', 'skipped-write': '·' }[
        result.status
      ];
      console.log(`${mark} ${entityKey.padEnd(14)} ${kind.padEnd(6)} ${result.detail.slice(0, 90)}`);
    }
  }

  // An entity counts as reachable if ANY probe reached it — one phrasing failing
  // is a prompt nuance; both failing means the entity is effectively invisible.
  const reachable = new Set(outcomes.filter((o) => o.status === 'ok').map((o) => o.entity));
  const unreachable = entities.filter((e) => !reachable.has(e));

  console.log('\n' + '─'.repeat(72));
  console.log(`reachable ${reachable.size}/${entities.length}`);
  if (unreachable.length > 0) {
    console.log(`UNREACHABLE: ${unreachable.join(', ')}`);
    for (const entity of unreachable) {
      for (const o of outcomes.filter((x) => x.entity === entity)) {
        console.log(`   ${entity} ${o.kind}: [${o.status}] ${o.detail.slice(0, 120)}`);
      }
    }
  }

  process.exit(unreachable.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
