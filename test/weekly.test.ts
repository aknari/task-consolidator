/**
 * Weekly-summary tests. Run with: npm test
 *
 * The cases that matter are the ones that make the summary *honest*:
 *  - a `[x]` line is a completed task in both conventions, even though the
 *    legacy script parked them in `## Tareas canceladas`;
 *  - `[>]` is the legacy "already carried forward" mark, so it is pending;
 *  - the same task carried through several notes of a week is reported once;
 *  - and nothing the renderer emits can be mistaken for a task: no checkbox,
 *    no `{{...}}` metadata (which would duplicate an Operon id) and no tag.
 */
import assert from 'node:assert/strict';
import {
  buildWeeklySummary,
  composeWeeklyBody,
  isNewWeek,
  isoWeek,
  spliceWeeklyBlock,
  weeklyPlaceholder,
  readWeeklyTasks,
  weekBounds,
  weeklyGroup,
  type WeeklyMarkers,
  type WeeklyNoteInput,
} from '../src/weekly';

const MARKERS: WeeklyMarkers = {
  tasksStart: '<!-- task-consolidator:tasks:start -->',
  tasksEnd: '<!-- task-consolidator:tasks:end -->',
  cancelledStart: '<!-- task-consolidator:cancelled:start -->',
  cancelledEnd: '<!-- task-consolidator:cancelled:end -->',
};

const READ = { taskTag: '#task', markers: MARKERS };
const RENDER = { ...READ, language: 'es' as const };

let failed = 0;
function check(name: string, got: unknown, expected: unknown): void {
  const a = JSON.stringify(got), b = JSON.stringify(expected);
  if (a === b) return;
  failed += 1;
  console.error(`\nFAIL  ${name}\n  got      ${a}\n  expected ${b}`);
}

// --------------------------------------------------------------------------
// Calendar maths
// --------------------------------------------------------------------------
check('isoWeek 2026-09-10', isoWeek('2026-09-10'), { year: 2026, week: 37 });
check('isoWeek 2026-09-07 (monday)', isoWeek('2026-09-07'), { year: 2026, week: 37 });
check('isoWeek 2026-09-06 (sunday before)', isoWeek('2026-09-06'), { year: 2026, week: 36 });
// ISO weeks can belong to the following year: the week of 2025-12-29 is W01/2026.
check('isoWeek year rollover', isoWeek('2025-12-29'), { year: 2026, week: 1 });
check('weekBounds', weekBounds('2026-09-10'), { monday: '2026-09-07', sunday: '2026-09-13' });
check('weekBounds on a monday', weekBounds('2026-09-07'), { monday: '2026-09-07', sunday: '2026-09-13' });
check('isNewWeek true', isNewWeek('2026-09-04', '2026-09-07'), true);
check('isNewWeek false', isNewWeek('2026-09-09', '2026-09-10'), false);
check(
  'weeklyGroup picks only that week',
  weeklyGroup('2026-09-10', ['2025-11-12', '2026-09-02', '2026-09-04', '2026-09-07', '2026-09-09', '2026-09-10']),
  ['2026-09-07', '2026-09-09', '2026-09-10'],
);
check('weeklyGroup spans a month gap', weeklyGroup('2025-11-12', ['2025-10-09', '2025-10-10', '2025-11-06', '2025-11-12']), ['2025-11-12']);

// --------------------------------------------------------------------------
// Modern convention: marker blocks, completed tasks stay in the tasks block
// --------------------------------------------------------------------------
const MODERN: WeeklyNoteInput = {
  date: '2026-09-10',
  content: [
    '---',
    'tags:',
    '  - daily',
    '---',
    '# Nota del Día',
    '',
    '## Plan del día',
    MARKERS.tasksStart,
    '## Tareas pendientes',
    '- [ ] Pasar palabras al #amawal del chat y otras #task ➕ 2024-12-17',
    '- [x] Preguntar si la extensión -1275 sigue libre #si-ulpgc #task ➕ 2026-09-04 ✅ 2026-09-10',
    '- [x] Mirar lo del Zoom Earth Wallpaper #task {{operonId:: 73pdhq4}} {{status:: Project.Finished}} {{dateCompleted:: 2026-09-04}} {{datetimeCreated:: 2025-11-06T00:00:01}}',
    '- [x] Una completada sin sello #task',
    '- [ ] Padre #task',
    '  - [ ] Subtarea que nunca debe listarse #task',
    '- [?] Texto cualquiera',
    '- [ ] #task',
    MARKERS.tasksEnd,
    '## Tareas canceladas',
    MARKERS.cancelledStart,
    '- [-] Esta sí está cancelada #task ➕ 2025-09-15',
    MARKERS.cancelledEnd,
  ].join('\n'),
};

check(
  'modern: classification, dates and inert text',
  readWeeklyTasks([MODERN], READ).map((t) => [t.state, t.text, t.created, t.completed]),
  [
    ['pending', 'Pasar palabras al #amawal del chat y otras', '2024-12-17', null],
    ['completed', 'Preguntar si la extensión -1275 sigue libre #si-ulpgc', '2026-09-04', '2026-09-10'],
    ['completed', 'Mirar lo del Zoom Earth Wallpaper', '2025-11-06', '2026-09-04'],
    ['completed', 'Una completada sin sello', null, null],
    ['pending', 'Padre', null, null],
    ['cancelled', 'Esta sí está cancelada', '2025-09-15', null],
  ],
);

const modernOut = buildWeeklySummary([MODERN], RENDER).join('\n');
check('modern: no checkbox is ever emitted', /-\s*\[/.test(modernOut), false);
check('modern: no {{...}} metadata is copied', modernOut.includes('{{'), false);
check('modern: the operon id is not duplicated', modernOut.includes('73pdhq4'), false);
check('modern: the managed tag is stripped', /#task(?![\p{L}\p{N}_/-])/u.test(modernOut), false);
check('modern: other tags survive as context', modernOut.includes('#amawal'), true);
check('modern: subtasks are not listed', modernOut.includes('Subtarea'), false);
check('modern: unknown marks are ignored', modernOut.includes('Texto cualquiera'), false);
check('modern: empty task text is skipped', (modernOut.match(/^- $/gm) ?? []).length, 0);
check('modern: header', modernOut.includes('Semana 37 de 2026 · 2026-09-07 a 2026-09-13 · nota: 2026-09-10'), true);
check('modern: sections', modernOut.includes('**Pendientes (2)**'), true);
check('modern: no stamp is reported as such', modernOut.includes('(sin fecha · en 2026-09-10)'), true);
check('modern: stamp matching the note adds no note hint', modernOut.includes('(✅ 2026-09-10)'), true);

// --------------------------------------------------------------------------
// Legacy convention: no markers, `[>]` pending, `[x]` parked in "canceladas"
// --------------------------------------------------------------------------
const LEGACY: WeeklyNoteInput = {
  date: '2025-10-10',
  content: [
    '## Tareas pendientes',
    '- [>] Pasar palabras al #amawal del chat y otras #task ➕ 2024-12-17',
    '- [x] Mejorar y organizar script para copias de seguridad #task ➕ 2025-09-22 ✅ 2025-10-09',
    '- [>] [[251009y6m]]',
    '',
    '## Tareas canceladas',
    '- [x] Comprar desodorante en roll-on y gel #task ➕ 2025-09-15 ✅ 2025-09-22',
    '- [-] Una cancelada de verdad',
    '',
    '## Plan del día',
    '- [x] Un item de agenda que no es tarea',
  ].join('\n'),
};

check(
  'legacy: [>] is pending and [x] in "canceladas" is completed, not cancelled',
  readWeeklyTasks([LEGACY], READ).map((t) => [t.state, t.text, t.completed]),
  [
    ['pending', 'Pasar palabras al #amawal del chat y otras', null],
    ['completed', 'Mejorar y organizar script para copias de seguridad', '2025-10-09'],
    ['pending', '[[251009y6m]]', null],
    ['completed', 'Comprar desodorante en roll-on y gel', '2025-09-22'],
    ['cancelled', 'Una cancelada de verdad', null],
  ],
);
check('legacy: sections close at the next heading', readWeeklyTasks([LEGACY], READ).some((t) => t.text.includes('agenda')), false);

// --------------------------------------------------------------------------
// De-duplication across the week's notes
// --------------------------------------------------------------------------
const GROUP: WeeklyNoteInput[] = [
  { date: '2025-10-09', content: ['## Tareas pendientes', '- [>] Mirar el Apple MacBook Pro #task ➕ 2025-09-15', '- [>] Sólo aparece aquí #task'].join('\n') },
  { date: '2025-10-10', content: ['## Tareas pendientes', '- [>] Mirar el Apple MacBook Pro #task ➕ 2025-09-15', '- [>] Sólo aparece aquí #task'].join('\n') },
];
check(
  'the same task carried forward is reported once',
  readWeeklyTasks(GROUP, READ).map((t) => t.text),
  ['Mirar el Apple MacBook Pro', 'Sólo aparece aquí'],
);
// The legacy script left the same task in both notes, so 'Pending' would
// otherwise be inflated by ~40%: 18 raw records were 11 distinct tasks.
check('no inflation from copied-forward lines', readWeeklyTasks(GROUP, READ).length, 2);

// --------------------------------------------------------------------------
// Ordering and the cap
// --------------------------------------------------------------------------
const ORDERED: WeeklyNoteInput[] = [{
  date: '2026-09-10',
  content: [
    '## Plan del día',
    MARKERS.tasksStart,
    '- [ ] Novísima #task ➕ 2026-09-04',
    '- [ ] Antiquísima #task ➕ 2024-12-17',
    '- [ ] En medio #task ➕ 2025-02-24',
    '- [ ] Sin fecha #task',
    MARKERS.tasksEnd,
    MARKERS.cancelledStart,
    MARKERS.cancelledEnd,
  ].join('\n'),
}];
// The order only exists in the rendered summary: reading preserves document
// order, which is what lets the renderer decide the presentation.
const orderedOut = buildWeeklySummary(ORDERED, RENDER).join('\n');
const pendingOrder = ['Antiquísima', 'En medio', 'Novísima', 'Sin fecha']
  .map((text) => orderedOut.indexOf(`- ${text}`));
check(
  'pending is ordered oldest first, undated last',
  pendingOrder.every((index, i) => index >= 0 && (i === 0 || index > pendingOrder[i - 1])),
  true,
);
const capped = buildWeeklySummary(ORDERED, { ...RENDER, maxItemsPerList: 2 }).join('\n');
check('cap reports the remainder', capped.includes('… y 2 más'), true);
check('no section is left empty-looking', capped.includes('(ninguna)'), true);
check('english labels are available', buildWeeklySummary(ORDERED, { ...RENDER, language: 'en' }).join('\n').includes('**Pending (4)**'), true);

// --------------------------------------------------------------------------
// The write-once guard
// --------------------------------------------------------------------------
// A block is unwritten while it holds only its heading and blank lines (the
// template's section title): that is what lets the plugin carry the user's own
// heading, and what stops it from ever overwriting a summary already written.
check('an empty block is a placeholder', weeklyPlaceholder(''), []);
check('a blank block is a placeholder', weeklyPlaceholder('\n   \n\t\n'), []);
check('the template heading is a placeholder', weeklyPlaceholder('\n## Resumen de la última semana trabajada\n'), ['## Resumen de la última semana trabajada']);
check('another heading level works too', weeklyPlaceholder('### Lo de la semana pasada'), ['### Lo de la semana pasada']);
check('an existing summary is not a placeholder', weeklyPlaceholder('## Resumen\n\nSemana 37 de 2026 · …\n\n**Pendientes (4)**'), null);
check('user text is not a placeholder', weeklyPlaceholder('  algo que escribí yo  '), null);
check('a heading plus user text is not a placeholder', weeklyPlaceholder('## Resumen\n\nnota mía'), null);
check(
  'the report keeps the heading the user wrote',
  composeWeeklyBody(['## Mi titular'], ['Semana 37 de 2026 · …']),
  ['## Mi titular', '', 'Semana 37 de 2026 · …'],
);
check('a report without a heading is just the report', composeWeeklyBody([], ['Semana 37 de 2026 · …']), ['Semana 37 de 2026 · …']);
// What the plugin actually writes must not look like a placeholder again.
check(
  'a written summary is protected from a second run',
  weeklyPlaceholder(composeWeeklyBody(['## Resumen de la última semana trabajada'], buildWeeklySummary([MODERN], RENDER)).join('\n')),
  null,
);

// The gate that decides *when* a summary exists at all: only when the note
// opens a new week with respect to the previous daily note.
check('a tuesday note in the same week is not a new week', isNewWeek('2026-09-07', '2026-09-08'), false);
check('the first note after a gap opens a new week', isNewWeek('2026-09-10', '2026-09-16'), true);
check('the first note of the next week is a new week', isNewWeek('2026-09-10', '2026-09-14'), true);
check(
  'the anchor week is the previous note’s week, not the calendar month',
  weeklyGroup('2026-09-10', ['2026-08-31', '2026-09-02', '2026-09-04', '2026-09-07', '2026-09-09', '2026-09-10', '2026-09-14']),
  ['2026-09-07', '2026-09-09', '2026-09-10'],
);

// --------------------------------------------------------------------------
// The write itself: surgical, and never a checkbox
// --------------------------------------------------------------------------
const NOTE_WITH_BLOCK = [
  '---',
  'tags:',
  '  - daily',
  '---',
  '# Nota del Día',
  '## Plan del día',
  '<!-- task-consolidator:tasks:start -->',
  '## Tareas pendientes',
  '- [ ] Una tarea real #task ➕ 2026-09-04',
  '<!-- task-consolidator:tasks:end -->',
  '## Resumen de la última semana trabajada',
  '<!-- task-consolidator:weekly:start -->',
  '## Resumen de la última semana trabajada',
  '<!-- task-consolidator:weekly:end -->',
].join('\n');

const noteLines = NOTE_WITH_BLOCK.split('\n');
const block = {
  start: noteLines.indexOf('<!-- task-consolidator:weekly:start -->'),
  end: noteLines.indexOf('<!-- task-consolidator:weekly:end -->'),
};
check('the fixture block is well formed', block.start >= 0 && block.end === block.start + 2, true);

// Everything outside the block must come out byte-for-byte identical: the weekly
// write can never touch the tasks, the frontmatter or the user's prose.
const outsideBlock = (text: string): string => {
  const lines = text.split('\n');
  const s = lines.indexOf('<!-- task-consolidator:weekly:start -->');
  const e = lines.indexOf('<!-- task-consolidator:weekly:end -->');
  return [...lines.slice(0, s + 1), ...lines.slice(e)].join('\n');
};

const placeholder = weeklyPlaceholder(noteLines.slice(block.start + 1, block.end).join('\n'));
check('the template block is a placeholder', placeholder, ['## Resumen de la última semana trabajada']);
const written = spliceWeeklyBlock(
  NOTE_WITH_BLOCK,
  block,
  composeWeeklyBody(placeholder ?? [], ['Semana 36 de 2026 · …', '', '**Pendientes (0)**']),
);
check(
  'the heading and the summary land between the markers',
  written.includes('<!-- task-consolidator:weekly:start -->\n## Resumen de la última semana trabajada\n\nSemana 36 de 2026 · …\n\n**Pendientes (0)**\n<!-- task-consolidator:weekly:end -->'),
  true,
);
// The tidy step: an untouched placeholder is dropped when no summary is due,
// so the section title does not hang empty on the other days of the week.
const emptied = spliceWeeklyBlock(NOTE_WITH_BLOCK, block, []);
check(
  'an untouched placeholder can be emptied',
  emptied.includes('<!-- task-consolidator:weekly:start -->\n<!-- task-consolidator:weekly:end -->'),
  true,
);
check('only the block body changes when emptying', outsideBlock(emptied) === outsideBlock(NOTE_WITH_BLOCK), true);
check('only the block body changes', outsideBlock(written) === outsideBlock(NOTE_WITH_BLOCK), true);
check(
  'no checkbox is added to the note',
  written.split('\n').filter((line) => /^\s*- \[/.test(line)).length,
  1,
);
check('an existing real task is still there', written.includes('- [ ] Una tarea real #task ➕ 2026-09-04'), true);

if (failed > 0) {
  console.error(`\n${failed} test(s) failed.`);
  process.exit(1);
}
console.log('weekly: all tests passed');
