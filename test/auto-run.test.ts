/**
 * Automatic-run tests: when it may start, and whether what it wrote survived.
 * Run with: npm test
 *
 * The fixture is the incident this guards against, taken from the vault on
 * 2026-09-18. The daily note was written twice — periodic-notes applied the
 * daily template, and Templater applied the same template again from its file
 * templates — and the second write arrived after the consolidation:
 *
 *   10:10:13.657  the previous note was marked "moved 2 task line(s) to …"
 *   10:10:13.733  the reminder file was written
 *   10:10:14.910  today's note was written again, back to the bare template
 *
 * The two tasks and a live Operon reminder survived nowhere: `8l9f9l2` existed
 * in no `.md` file afterwards.
 *
 * What matters here:
 *  - the wait is a settle time that a later write pushes back, with a ceiling
 *    so a note being typed in cannot postpone the run forever;
 *  - a note rewritten back to its template is detected, so the sources are left
 *    untouched and nothing is lost.
 */
import assert from 'node:assert/strict';
import { AUTO_MAX_WAIT_MS, AUTO_SETTLE_MS, autoRunDelay, survivors } from '../src/auto-run';
import { taskKey } from '../src/lines';

const TAG = '#task';
let checks = 0;
function check(name: string, actual: unknown, expected: unknown): void {
  checks += 1;
  assert.deepEqual(actual, expected, name);
  console.log(`  ok  ${name}`);
}

console.log('\nTiming: the run waits for the note to settle');

check('a fresh arming waits the settle time', autoRunDelay(0, 0), AUTO_SETTLE_MS);
check('entering the ceiling shortens the wait', autoRunDelay(0, AUTO_MAX_WAIT_MS - 1000), 1000);
check('past the ceiling it runs now', autoRunDelay(0, AUTO_MAX_WAIT_MS + 60000), 0);
check('a clock that jumps backwards does not wait longer', autoRunDelay(5000, 1000), AUTO_SETTLE_MS);

// The incident's numbers: armed at the first write, the template wrote again
// 3.25 s later, and the run would have started at 4 s — after it.
const armedAt = 0;
const templateSecondWrite = 3250;
const runAt = armedAt + autoRunDelay(armedAt, templateSecondWrite);
check('the run starts after the template second write', runAt >= templateSecondWrite, true);
check('and not one tick early', runAt, 4000);

console.log('\nVerification: what the run wrote is checked before anything is marked');

const PLAIN = '- [ ] Pasar palabras al #amawal del chat y otras #task ➕ 2024-12-17';
const LISA = '- [ ] Lisa: Mirar [[Apuntes de desarrollo]] y [[Notas sobre Lisa]] #task ➕ 2025-02-24';
// The whole line, fields included: an Operon task's identity lives in them.
const OPERON_REMINDER =
  '- [ ] Descargar las transparencias de Ingeniería de Sistemas de Instrumentación {{operonId:: 8l9f9l2}} {{status:: Project.Brainstorming}} {{priority:: A}} {{dateStarted:: 2026-09-16}}';
const KEYS = [taskKey(PLAIN, TAG), taskKey(LISA, TAG)];
const LINES = [OPERON_REMINDER];

// Today's note as the template leaves it: the markers, the headings, no tasks.
const TEMPLATE_ONLY = [
  '## Plan del día',
  '<!-- task-consolidator:tasks:start -->',
  '## Tareas pendientes',
  '<!-- task-consolidator:tasks:end -->',
  '## Para recordar',
  '<!-- task-consolidator:reminders:start -->',
  '<!-- task-consolidator:reminders:end -->',
].join('\n');

const intact = survivors(TEMPLATE_ONLY, KEYS, LINES, TAG);
check('a note rewritten back to the template reports every task missing', intact.missingKeys.length, 2);
check('and the reminder line too', intact.missingLines, [OPERON_REMINDER]);

// The note as the consolidation left it, before the template overwrote it.
const CONSOLIDATED = [
  '## Plan del día',
  '<!-- task-consolidator:tasks:start -->',
  '## Tareas pendientes',
  PLAIN,
  LISA,
  '<!-- task-consolidator:tasks:end -->',
  '## Para recordar',
  '<!-- task-consolidator:reminders:start -->',
  OPERON_REMINDER,
  '<!-- task-consolidator:reminders:end -->',
].join('\n');

const held = survivors(CONSOLIDATED, KEYS, LINES, TAG);
check('a note that still holds everything reports nothing missing', held.missingKeys, []);
check('for the lines as well', held.missingLines, []);

// Identity, not text. A plain task is its normalized text, so losing the `#task`
// tag and the ` ➕` stamp does not make it a different task.
const UNDECORATED = CONSOLIDATED.replace(LISA, '- [ ] Lisa: Mirar [[Apuntes de desarrollo]] y [[Notas sobre Lisa]]');
check('a task that lost its decoration is still the same task', survivors(UNDECORATED, KEYS, LINES, TAG).missingKeys, []);

// An Operon task is its `operonId` and nothing else: its text, its dates and its
// `{{datetimeModified}}` change while you work, and comparing those would let the
// same task through twice.
const OPERON_TASK =
  '- [ ] Revisar el pipeline de Lisa {{operonId:: zf7exxn}} {{status:: Project.Planning}} {{datetimeModified:: 2026-09-18T09:00:00}}';
const OPERON_KEY = taskKey(OPERON_TASK, TAG);
const REWRITTEN_OPERON =
  `${TEMPLATE_ONLY}\n- [ ] Revisar el pipeline de Lisa a fondo {{operonId:: zf7exxn}} {{status:: Project.Pending}} {{datetimeModified:: 2026-09-18T10:30:00}}`;
check('an Operon task that was edited is still the same task', survivors(REWRITTEN_OPERON, [OPERON_KEY], [], TAG).missingKeys, []);

// A partial loss is a loss: only what is still there counts.
const HALF = CONSOLIDATED.replace(LISA, '').replace(OPERON_REMINDER, '');
const partial = survivors(HALF, KEYS, LINES, TAG);
check('losing one task is reported', partial.missingKeys.length, 1);
check('and the reminder with it', partial.missingLines.length, 1);

check('blank expected lines are not reported', survivors(TEMPLATE_ONLY, [], ['', '   '], TAG).missingLines, []);

console.log(`\n${checks} checks passed\n`);
