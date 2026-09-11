/**
 * The sentence a user reads before — and after — their data changes.
 *
 * This string is the whole interface to a write. It is the last thing between a
 * plan and the real record on the confirmation card, and the only report of
 * what happened once it is applied. Two things went wrong in it, and both were
 * invisible from the code because the VALUE written was correct each time; only
 * the description of it was wrong.
 */

import { executeMutate } from '../mutate/MutateExecutor';
import type { QueryContext } from '../types';

const CTX: QueryContext = {
  userId: '11111111-1111-1111-1111-111111111111',
  timezone: 'Asia/Jerusalem',
  consumer: 'chat',
};

const preview = (data: Record<string, unknown>, language: string, timezone = 'Asia/Jerusalem') =>
  executeMutate(
    {
      op: 'mutate',
      entity: 'tasks',
      action: 'update',
      target: { id: '22222222-2222-2222-2222-222222222222' },
      data,
    } as never,
    { ...CTX, timezone },
    { dryRun: true, language, utterance: 'x' }
  ).then((r) => r.preview ?? '');

describe('enum values in a write preview', () => {
  /*
   * The catalog carries these labels and the RESULT card already used them —
   * "עדיפות: בינונית". The write preview did not, so a Hebrew conversation
   * ended on "בוצע — עדכן משימה — עדיפות: high". The single English word in the
   * sentence was the one saying what had just been done.
   */
  it('shows the Hebrew label, not the stored value', async () => {
    await expect(preview({ priority: 'high' }, 'he')).resolves.toContain('גבוהה');
    await expect(preview({ priority: 'high' }, 'he')).resolves.not.toContain('high');
  });

  it('translates status too', async () => {
    await expect(preview({ status: 'completed' }, 'he')).resolves.toContain('הושלמה');
    await expect(preview({ status: 'completed' }, 'es')).resolves.toContain('completada');
  });

  it('still reads correctly in English', async () => {
    await expect(preview({ priority: 'urgent' }, 'en')).resolves.toContain('urgent');
  });

  it('falls back to the stored value when a label is missing', async () => {
    // Better shown as itself than hidden: an unlabelled value is still the
    // truth about what is being written.
    await expect(preview({ title: 'call the bank' }, 'he')).resolves.toContain('call the bank');
  });
});

describe('dates in a write preview', () => {
  /*
   * This is the exact instant `resolveDateExpr` writes for "30 October" in
   * Asia/Jerusalem (UTC+2 on that date) — midnight local. Formatted with no
   * timeZone the server renders it in ITS zone, UTC on Vercel, where the same
   * instant is still the 29th. So the confirmation said "29 באוק׳" about a task
   * the dialog then correctly showed as the 30th.
   */
  const MIDNIGHT_30_OCT_IN_JERUSALEM = '2026-10-29T22:00:00.000Z';

  it('renders the day the business meant, not the server day', async () => {
    const shown = await preview({ due_date: MIDNIGHT_30_OCT_IN_JERUSALEM }, 'en', 'Asia/Jerusalem');

    expect(shown).toContain('30');
    expect(shown).not.toContain('29');
  });

  it('is the server zone that was wrong, not the instant — UTC still reads as the 29th', async () => {
    // The same instant for a business actually in UTC IS the 29th there, which
    // is why this could never have been fixed by shifting the stored value.
    const shown = await preview({ due_date: MIDNIGHT_30_OCT_IN_JERUSALEM }, 'en', 'UTC');

    expect(shown).toContain('29');
  });
});
