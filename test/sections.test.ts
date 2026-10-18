/**
 * Section-reconciliation tests. Run with: npm run test:sections
 *
 * The rule under test is one line long — a task lives in the plan exactly when
 * it is scheduled for the note's own day — so these fixtures are about the ways
 * a note can disagree with it, using the marks the ruler actually writes
 * (`[scheduled:: …]` with `fieldFormat: dataview`, a `⏳` date, a leading
 * `h:mm`), and the ways it must *not* be touched: a tombstone, a cancelled
 * line, a completed one, a block that is not there.
 *
 * What matters here:
 *  - both directions, because unscheduling is as ordinary as planning;
 *  - clock order inside the plan, all-day last, and the backlog keeping its
 *    order with a returning task at its end;
 *  - a subtask travelling with its parent, a block keeping its heading, and a
 *    note with nothing to change coming back as `null` — no write at all.
 */
import { findMarkerBlock, isSchedulingOnlyChange, reconcileSections, type ReconcileOptions } from '../src/sections';

const OPTIONS: ReconcileOptions = {
  plan: { start: '<!-- plan:start -->', end: '<!-- plan:end -->' },
  tasks: { start: '<!-- tasks:start -->', end: '<!-- tasks:end -->' },
  noteDate: '2026-10-17',
};

let failed = 0;
function check(name: string, got: unknown, expected: unknown): void {
  const a = JSON.stringify(got), b = JSON.stringify(expected);
  if (a === b) return;
  failed += 1;
  console.error(`\nFAIL  ${name}\n  got      ${a}\n  expected ${b}`);
}

/** A note as the updated template leaves it, with both sections. */
function note(plan: string[] = [], tasks: string[] = []): string {
  return [
    '# Nota del Día',
    '',
    '## Plan del día',
    '<!-- plan:start -->',
    ...plan,
    '<!-- plan:end -->',
    '## Tareas pendientes',
    '<!-- tasks:start -->',
    '## Tareas pendientes',
    ...tasks,
    '<!-- tasks:end -->',
    '## Tareas cerradas',
    '<!-- tasks:cancelled:start -->',
    '- [ ] Una tarea de otro bloque que no se toca',
    '<!-- tasks:cancelled:end -->',
    '',
  ].join('\n');
}

/** The lines of one block, for readable assertions. */
function block(content: string, pair: { start: string; end: string }): string[] {
  const found = findMarkerBlock(content, pair.start, pair.end);
  if (found === null) return ['<missing>'];
  return content.split('\n').slice(found.start + 1, found.end);
}

const PLANNED_9 = '- [ ] Preparar examen [scheduled:: 2026-10-17T09:00] [duration:: 1h]';
const PLANNED_8 = '- [ ] Revisar materia [scheduled:: 2026-10-17T08:00] [duration:: 30m]';
const PLANNED_OTHER_DAY = '- [ ] Preparar materia [scheduled:: 2026-10-18T08:00] [duration:: 1h]';
const UNPLANNED = '- [ ] Lisa: Mirar [[Apuntes de desarrollo]] #task ➕ 2025-02-24';
const PREFIX_TODAY = '- [ ] 12:00 - 12:30 Revisión de informes P2 #task';
const ALL_DAY = '- [ ] Felicitar a Marta [scheduled:: 2026-10-17]';
const TOMBSTONE = '- [>] Pasar palabras al #amawal del chat y otras #task ➕ 2024-12-17';
const CANCELLED = '- [-] Solicitar tarjeta de identificación #ulpgc';
const COMPLETED = '- [x] Corregir cálculos previos P2 #task ✅ 2026-10-10';

// --------------------------------------------------------------------------
// Planning: the task in the backlog moves up
// --------------------------------------------------------------------------
{
  const result = reconcileSections(note([], [UNPLANNED, PLANNED_9]), OPTIONS);
  if (result === null) {
    failed += 1;
    console.error('\nFAIL  a planned task in the backlog is carried into the plan (got null)');
  } else {
    const plan = block(result.content, OPTIONS.plan);
    const tasks = block(result.content, OPTIONS.tasks);
    check('the planned task is now in the plan', plan.includes(PLANNED_9), true);
    check('and no longer in the backlog', tasks.includes(PLANNED_9), false);
    check('the unplanned one stays in the backlog', tasks.includes(UNPLANNED), true);
    check('the heading of the backlog is kept, once, first', tasks[0], '## Tareas pendientes');
    check('the move is reported', result.toPlan.length, 1);
    check('and nothing is reported as coming back', result.toPending.length, 0);
  }
}

// --------------------------------------------------------------------------
// Un-planning: the task goes back, at the end of the backlog
// --------------------------------------------------------------------------
{
  const result = reconcileSections(note([PLANNED_OTHER_DAY], [CANCELLED]), OPTIONS);
  if (result === null) {
    failed += 1;
    console.error('\nFAIL  a plan line planned for another day goes back (got null)');
  } else {
    check('the plan is empty again', block(result.content, OPTIONS.plan), []);
    check(
      'the task is back in the backlog, after what was already there',
      block(result.content, OPTIONS.tasks),
      ['## Tareas pendientes', CANCELLED, PLANNED_OTHER_DAY],
    );
    check('the return is reported', result.toPending.length, 1);
    check('and nothing was carried up', result.toPlan.length, 0);
  }
}

// --------------------------------------------------------------------------
// The clock decides the order inside the plan
// --------------------------------------------------------------------------
{
  const result = reconcileSections(note([PLANNED_9], [PLANNED_8, ALL_DAY]), OPTIONS);
  if (result === null) {
    failed += 1;
    console.error('\nFAIL  a task planned earlier goes above the one at 9:00 (got null)');
  } else {
    check(
      'the plan is in clock order, and the all-day line waits at the end',
      block(result.content, OPTIONS.plan),
      [PLANNED_8, PLANNED_9, ALL_DAY],
    );
  }
}

// A plan written by hand out of order is put right even when nothing moves.
{
  const result = reconcileSections(note([PLANNED_9, PLANNED_8]), OPTIONS);
  check('a plan out of order is sorted, and reported as such', result === null ? null : block(result.content, OPTIONS.plan), [PLANNED_8, PLANNED_9]);
  check('with no section change to report', result === null ? null : [result.toPlan.length, result.toPending.length], [0, 0]);
}

// --------------------------------------------------------------------------
// Every notation the ruler writes
// --------------------------------------------------------------------------
{
  const result = reconcileSections(note([], [PREFIX_TODAY, PLANNED_OTHER_DAY]), OPTIONS);
  if (result === null) {
    failed += 1;
    console.error('\nFAIL  a bare h:mm prefix means the note\'s own day (got null)');
  } else {
    check('a bare h:mm prefix is today, so the task is planned', block(result.content, OPTIONS.plan), [PREFIX_TODAY]);
    check('a date for another day is not, so it stays in the backlog', block(result.content, OPTIONS.tasks), ['## Tareas pendientes', PLANNED_OTHER_DAY]);
  }
}

// --------------------------------------------------------------------------
// What is never moved
// --------------------------------------------------------------------------
{
  const result = reconcileSections(note([TOMBSTONE, COMPLETED], [CANCELLED]), OPTIONS);
  check('a note with only records, cancelled and completed lines is left alone', result, null);
}

// --------------------------------------------------------------------------
// A subtask travels with its parent
// --------------------------------------------------------------------------
{
  const parent = '- [ ] Preparar exámenes [scheduled:: 2026-10-17T10:00]';
  const subtask = '  - [ ] Repasar el tema 3 #task';
  const result = reconcileSections(note([], [parent, subtask, UNPLANNED]), OPTIONS);
  if (result === null) {
    failed += 1;
    console.error('\nFAIL  a parent takes its subtask with it (got null)');
  } else {
    check('the subtask stays indented under its parent, in the plan', block(result.content, OPTIONS.plan), [parent, subtask]);
    check('and the backlog keeps the rest', block(result.content, OPTIONS.tasks), ['## Tareas pendientes', UNPLANNED]);
  }
}

// --------------------------------------------------------------------------
// Nothing to do, and nothing to touch
// --------------------------------------------------------------------------
check('a note already in place is not rewritten', reconcileSections(note([PLANNED_9], [UNPLANNED]), OPTIONS), null);

{
  const noPlan = ['## Tareas pendientes', '<!-- tasks:start -->', '## Tareas pendientes', PLANNED_9, '<!-- tasks:end -->', ''].join('\n');
  check('a note without the plan block is left exactly as it was', reconcileSections(noPlan, OPTIONS), null);
}

{
  const doubled = note([PLANNED_9], [UNPLANNED]).replace('<!-- plan:end -->', '<!-- plan:start -->\n<!-- plan:end -->');
  check('an ambiguous marker pair is left alone', reconcileSections(doubled, OPTIONS), null);
}

// --------------------------------------------------------------------------
// What was written beside a task travels with it
// --------------------------------------------------------------------------
{
  const done = '- [x] Corregir cálculos previos P2 #task ✅ 2026-10-17';
  const result = reconcileSections(note([], [PLANNED_9, done]), OPTIONS);
  if (result === null) {
    failed += 1;
    console.error('\nFAIL  a completed line beside a planned task travels with it (got null)');
  } else {
    check('ticking a planned task does not send it to the bottom of the section', block(result.content, OPTIONS.plan), [PLANNED_9, done]);
  }
}

// --------------------------------------------------------------------------
// Text outside the two blocks is never read as a task
// --------------------------------------------------------------------------
{
  const outside = note([PLANNED_9], [UNPLANNED]).replace(
    '- [ ] Una tarea de otro bloque que no se toca',
    '- [ ] Una tarea de otro bloque, planificada para hoy [scheduled:: 2026-10-17T07:00]',
  );
  const result = reconcileSections(outside, OPTIONS);
  check('a task in another block is never carried into the plan', result, null);
}

// --------------------------------------------------------------------------
// Telling the ruler's write from your typing
// --------------------------------------------------------------------------
{
  // The ruler rewrites the line in place, and its rebuild drops the tag and the
  // `➕` stamp the line carried. The identity is what has to survive, not the
  // decoration.
  const before = '- [ ] Preparar materia #materia/sistemas-instrumentacion #task ➕ 2026-10-16';
  const after = '- [ ] Preparar materia #materia/sistemas-instrumentacion   [scheduled:: 2026-10-16T11:00]  [duration:: 2h]';
  check('a planned line reads as scheduling alone, even when the ruler drops its tag', isSchedulingOnlyChange(before, after, '#task'), true);
  check('un-planning reads the same way, backwards', isSchedulingOnlyChange(after, before, '#task'), true);
  check('a note that did not change at all carries no signal', isSchedulingOnlyChange(before, before, '#task'), true);

  const base = note([], [UNPLANNED]);
  const typed = note([], ['- [ ] Tarea de prueba', UNPLANNED]);
  check('a line you typed is not a scheduling change', isSchedulingOnlyChange(base, typed, '#task'), false);
  check('a line you deleted is not either', isSchedulingOnlyChange(typed, base, '#task'), false);
  check(
    'a task you renamed is yours too',
    isSchedulingOnlyChange(base, base.replace('Lisa: Mirar', 'Lisa: Revisar'), '#task'),
    false,
  );
  check(
    'a note whose lines were reordered is not the ruler\'s doing',
    isSchedulingOnlyChange(note([], [UNPLANNED, PLANNED_9]), note([], [PLANNED_9, UNPLANNED]), '#task'),
    false,
  );
  check(
    'prose you are writing is never mistaken for planning',
    isSchedulingOnlyChange(note([], []), note([], []).replace('## Tareas pendientes', '## Tareas pendientes y algo mas'), '#task'),
    false,
  );
}

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('sections: all checks passed');
