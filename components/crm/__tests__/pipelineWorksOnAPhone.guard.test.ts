/**
 * The pipeline board can be used on a phone, and from a keyboard.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG
 *
 * Two faults, and the second is the one that mattered.
 *
 *   WIDTH   Each column was `flex-1` with an inline `minWidth: 200px`, and the
 *           file had no breakpoint in it at all. Five stages made the board
 *           1,012px wide and a sales pipeline's seven made it 1,418px, so a
 *           375px phone showed about one and a half columns.
 *
 *   TOUCH   The cards were `draggable` with the HTML5 drag events, which never
 *           fire on a touch device. Moving a contact between stages -- the one
 *           thing a board is for -- was impossible on a phone, and impossible
 *           from a keyboard anywhere, because dragging was the only way.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SOURCE GUARD
 *
 * jsdom has no touch input, no pointer, no layout and no viewport. A column
 * 1,012px wide measures the same there as one that fits, and a gesture that
 * cannot happen cannot be fired. Nothing here is observable in a render test,
 * so the guard pins the decisions instead.
 *
 * Comments are stripped before matching, because the notes beside each fix
 * quote the code they replaced.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as fs from 'fs';
import * as path from 'path';

const FILE = 'components/crm/CRMPipelineView.tsx';
const source = fs.readFileSync(path.join(process.cwd(), FILE), 'utf8');
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('the guard reads code, not prose', () => {
  it('strips comments first, or it passes on its own explanation', () => {
    expect(source).toContain('minWidth: 200px');
    expect(code).not.toContain('minWidth: 200px');
  });
});

describe('a finger can move a contact', () => {
  it('no card is an HTML5 draggable any more', () => {
    // These five are the whole old mechanism, and not one of them fires on
    // touch. Leaving any behind means two drag systems on one card.
    for (const dead of ['draggable', 'onDragStart={(e)', 'onDragOver={(e)', 'onDragLeave=', 'onDrop={']) {
      expect(code).not.toContain(dead);
    }
    expect(code).not.toContain('dataTransfer');
  });

  it('cards and columns come from dnd-kit instead', () => {
    expect(code).toContain('useDraggable(');
    expect(code).toContain('useDroppable(');
    expect(code).toContain('<DndContext');
  });

  it('a hold lifts the card and a swipe still scrolls', () => {
    /*
     * The crux. A finger landing on a card is ambiguous: scrolling the board
     * and picking a card up begin identically. Without a delay every swipe
     * would lift a card; without a tolerance the lift would survive a scroll
     * that had already begun.
     */
    expect(code).toMatch(/TouchSensor,\s*\{\s*activationConstraint:\s*\{\s*delay:\s*250,\s*tolerance:\s*8\s*\}/);
  });

  it('a mouse uses distance, not patience', () => {
    // 8px, the same figure the intake editor and the website page already use.
    expect(code).toMatch(/MouseSensor,\s*\{\s*activationConstraint:\s*\{\s*distance:\s*8\s*\}/);
  });

  it('MouseSensor and TouchSensor, not one PointerSensor', () => {
    // A single PointerSensor would need `touch-action: none` on the card,
    // which stops the column scrolling under a finger.
    expect(code).not.toContain('PointerSensor');
  });

  it('the lifted card is drawn outside the two scroll containers', () => {
    // The column scrolls vertically and the board horizontally, so a card
    // dragged in place is clipped by both.
    expect(code).toContain('<DragOverlay');
  });
});

describe('a keyboard can move a contact', () => {
  it('the arrow keys move a card one stage', () => {
    expect(code).toContain("event.key !== 'ArrowLeft' && event.key !== 'ArrowRight'");
    expect(code).toContain('onNudge(contact,');
  });

  it('they follow reading order, not screen order', () => {
    // In Hebrew the next stage is to the LEFT. An arrow that moved by pixels
    // would run the pipeline backwards for every RTL account.
    expect(code).toMatch(/document\.dir === 'rtl' \? 'ArrowLeft' : 'ArrowRight'/);
  });

  it('a card can be reached by tab, and shows it has focus', () => {
    expect(code).toContain('tabIndex={0}');
    expect(code).toContain('focus-visible:ring-[#8B5CF6]');
  });

  it('the nudge stops at both ends of the pipeline', () => {
    // `stages[index + direction]` is undefined past either end, and -1 from
    // findIndex would otherwise wrap round to the last stage.
    expect(code).toContain('if (index === -1 || !next) return;');
  });
});

describe('one stage fills a phone', () => {
  it('the column has no fixed pixel width left', () => {
    expect(code).not.toMatch(/minWidth:\s*'200px'/);
  });

  it('it is 85% on a phone and shares the board from sm: up', () => {
    // 85% leaves the next column visibly peeking, which is what tells a reader
    // the board continues sideways.
    expect(code).toContain('w-[85%]');
    expect(code).toContain('sm:flex-1');
    expect(code).toContain('sm:min-w-[200px]');
  });

  it('a swipe lands on a stage rather than between two', () => {
    expect(code).toContain('snap-center');
    expect(code).toContain('snap-x snap-mandatory');
  });

  it('and snapping is off where the whole board is visible', () => {
    // From sm: up it would fight an ordinary scroll.
    expect(code).toContain('sm:snap-none');
  });
});

describe('the stage labels survive a narrow screen', () => {
  it('they scroll instead of truncating to nothing', () => {
    // Seven stages across 375px is 50px each, which holds neither a name nor a
    // count.
    expect(code).toContain('w-[88px]');
    expect(code).toContain('overflow-x-auto sm:overflow-visible');
  });

  it('tapping one brings its column to the middle', () => {
    expect(code).toContain('onStageSelect?.(index)');
    expect(code).toMatch(/scrollIntoView\(\{[^}]*inline: 'center'/);
  });

  it('without dragging the page around it', () => {
    // `block: 'nearest'` stops the page itself jumping to show the board.
    expect(code).toMatch(/scrollIntoView\(\{[^}]*block: 'nearest'/);
  });
});

describe('the hold is taught, once', () => {
  /*
   * A gesture nobody is told about is the same as no gesture. The hint is the
   * only thing on screen that explains why a card does not move the instant a
   * finger lands on it.
   */
  it('says what to do, from the dictionary rather than hardcoded', () => {
    expect(code).toContain("t('crm.pipeline.hold_hint')");
  });

  it('only where the hold is the rule', () => {
    // A mouse picks a card up after 8px and needs no telling.
    const hint = code.slice(code.indexOf('!hintDismissed'), code.indexOf('!hintDismissed') + 400);
    expect(hint).toContain('sm:hidden');
  });

  it('not on an empty board, where there is nothing to practise on', () => {
    expect(code).toContain('!hintDismissed && contacts.length > 0');
  });

  it('is dismissible, and stays dismissed', () => {
    expect(code).toContain("localStorage.setItem(HOLD_HINT_KEY, '1')");
    expect(code).toContain("localStorage.getItem(HOLD_HINT_KEY) === '1'");
  });

  it('is read in an effect, not during render', () => {
    // The server renders this too and has no localStorage; reading it during
    // render makes the first client paint disagree with the server's.
    const read = code.slice(code.indexOf('const [hintDismissed'), code.indexOf('const dismissHint'));
    expect(read).toMatch(/useEffect\(\(\) => \{/);
    expect(read).toContain('useState(true)');
  });

  it('survives storage being refused, by showing the hint', () => {
    // Private browsing. A hint seen twice beats one nobody can ever see.
    const read = code.slice(code.indexOf('const [hintDismissed'), code.indexOf('const dismissHint'));
    expect(read).toMatch(/catch \{[\s\S]*setHintDismissed\(false\)/);
  });
});

describe('a card can be moved without any gesture', () => {
  it('every card offers "Move to"', () => {
    expect(code).toContain('<MoveToMenu');
    expect(code).toContain("t('crm.pipeline.move_to')");
  });

  it('the menu does not arm a drag or open the drawer underneath', () => {
    /*
     * The card is a dnd-kit draggable listening on its whole surface. Without
     * both of these, pressing the button would start a drag and releasing it
     * would open the contact.
     */
    expect(code).toContain('onPointerDown={stop} onClick={stop}');
    expect(code).toMatch(/const stop = \(event: React\.SyntheticEvent\) => \{\s*event\.stopPropagation\(\);/);
  });

  it('closes on an outside press and on Escape', () => {
    expect(code).toContain("document.addEventListener('mousedown', away)");
    expect(code).toContain("event.key === 'Escape'");
  });

  it('and removes both listeners when it closes', () => {
    // Left attached, every card ever opened keeps a handler on the document.
    expect(code).toContain("document.removeEventListener('mousedown', away)");
    expect(code).toContain("document.removeEventListener('keydown', escape)");
  });

  it('offers the stage a card is already in, but does not act on it', () => {
    // Removing it would renumber the list under someone reading it.
    expect(code).toContain('disabled={here}');
    expect(code).toContain('if (!here) onPick(stage.stage_key);');
  });

  it('names stages the way the rest of the board does', () => {
    // `localizeStageLabel`, not `stage_label`: onboarding invents pipelines
    // whose keys the dictionary has never seen.
    const menu = code.slice(code.indexOf('function MoveToMenu'), code.indexOf('/** One stage,'));
    expect(menu).toContain('localizeStageLabel(');
  });
});

describe('the grip is visible where there is no hover', () => {
  it('shows on a touch screen as well as on hover', () => {
    // It was `opacity-0 group-hover:opacity-100`, and a finger never hovers,
    // so the only hint a card could be moved was invisible on a phone.
    expect(code).toContain('group-hover:opacity-100 pointer-coarse:opacity-100');
  });
});

describe('what the move does has not changed', () => {
  it('still moves optimistically and still reverts on failure', () => {
    // The board has always shown the card in its new column before the server
    // agreed. That behaviour is reused, not rewritten.
    expect(code).toContain('setPendingMoves(prev => ({ ...prev, [contactId]: stage }))');
    expect(code).toContain("method: 'PUT'");
  });

  it('a drop onto the stage a card is already in does nothing', () => {
    expect(code).toContain('if (currentStage === stage) return;');
  });

  it('the pending stage is what a second move counts from', () => {
    // Not `contact.stage`, which is the server's answer and is behind by one
    // while a move is in flight.
    expect(code).toContain('pendingMoves[contact.id] ?? contact.stage');
  });
});
