/**
 * Line-helper tests. Run with: npm test
 *
 * The fixtures are the plugin's own working lines, taken from the vault:
 * a plain task carried forward since 2024, an Operon task whose duplicate
 * `operonId` had to be resolved by hand, and a cancelled Operon task.
 *
 * What matters here:
 *  - a task's identity is its `operonId`, so rewriting its dates or its
 *    `{{datetimeModified}}` never turns it into a different task (that is what
 *    let the same Operon task through twice and duplicated the id);
 *  - a migrated plain task is decorated, a migrated Operon task is not — it
 *    only receives the start date it lacks;
 *  - what is left behind is `- [>]` with no Operon metadata, because a
 *    tombstone keeping an `operonId` claims an identity today's note holds;
 *  - a task planned for the day it is leaving arrives without that scheduling,
 *    in every notation the ruler writes (including a bare `h:mm` prefix, whose
 *    day is the day of the note it came from), while one planned for today or
 *    later keeps it, and the tombstone keeps it all as the record. The fixtures
 *    of that section are the user's own lines.
 */
import assert from 'node:assert/strict';
import {
  carriedOrder,
  hasOperonField,
  insertOperonField,
  isOperonLine,
  normalizeTaskLine,
  operonId,
  prepareMigratedLine,
  prefixTaskTag,
  priorityRank,
  scheduledDate,
  stampOperonStart,
  stripPastSchedule,
  stripSchedule,
  taskKey,
  tombstoneLine,
  tombstoneOperonLines,
  type LineOptions,
} from '../src/lines';

const OPTIONS: LineOptions = { taskTag: '#task', stampCreatedDate: true };
const DATE = '2026-09-16';

// --------------------------------------------------------------------------
// Real lines from the vault
// --------------------------------------------------------------------------
const PLAIN = '- [ ] Pasar palabras al #amawal del chat y otras #task ➕ 2024-12-17';
const PLAIN_IMPORTANT = '- [!] Mirar el vuelo de Riga a Gran Canaria #task';
const OPERON =
  '- [ ] Descargar las transparencias de Ingeniería de Sistemas de Instrumentación {{operonId:: 8l9f9l2}} {{status:: Project.Brainstorming}} {{priority:: A}} {{parentTask:: zf7exxn}} {{datetimeCreated:: 2026-09-15T16:27:23}} {{datetimeModified:: 2026-09-15T16:30:36}}';
const OPERON_SCHEDULED =
  '- [ ] Preparar examen de Electrónica Aplicada al Buque. {{operonId:: x7hmg05}} {{status:: Project.Brainstorming}} {{priority:: S}} {{dateDue:: 2026-10-02}} {{parentTask:: kxcrvy5}} {{taskIcon:: ship}} {{taskColor:: 2563EB}}';
const OPERON_CANCELLED =
  '- [-] Solicitar tarjeta de identificación de la actualizada #ulpgc {{operonId:: sonhlh3}} {{status:: Project.Dropped}} {{priority:: C}} {{dateCancelled:: 2026-09-03}}';

let failed = 0;
function check(name: string, got: unknown, expected: unknown): void {
  const a = JSON.stringify(got), b = JSON.stringify(expected);
  if (a === b) return;
  failed += 1;
  console.error(`\nFAIL  ${name}\n  got      ${a}\n  expected ${b}`);
}

// --------------------------------------------------------------------------
// Identity
// --------------------------------------------------------------------------
check('an Operon line is recognised', isOperonLine(OPERON), true);
check('a plain line is not an Operon line', isOperonLine(PLAIN), false);
check('a Dataview inline field is not Operon metadata', isOperonLine('- [ ] X [due:: 2026-01-01]'), false);
check('a template snippet without a field is not Operon metadata', isOperonLine('- [ ] X {{date}}'), false);
check('operonId is read', operonId(OPERON), '8l9f9l2');
check(
  'the key of an Operon task is its id',
  taskKey(OPERON, '#task'),
  'operon:8l9f9l2',
);
check(
  'rewriting its dates does not make it another task',
  taskKey(OPERON.replace('2026-09-15T16:30:36', '2026-09-16T09:00:00'), '#task'),
  taskKey(OPERON, '#task'),
);
check(
  'two Operon tasks with the same text but different ids stay distinct',
  taskKey(OPERON.replace('8l9f9l2', 'i39av3r'), '#task'),
  'operon:i39av3r',
);
check(
  'the key of a plain task drops the tag and the ➕ stamp',
  taskKey(PLAIN, '#task'),
  '- [ ] Pasar palabras al #amawal del chat y otras',
);
check(
  'a decorated and an undecorated plain copy share one key',
  taskKey('- [ ] Pasar palabras al #amawal del chat y otras', '#task'),
  taskKey(PLAIN, '#task'),
);
check(
  '`- [!]` normalizes to `- [ ]`',
  normalizeTaskLine(PLAIN_IMPORTANT, '#task'),
  '- [ ] Mirar el vuelo de Riga a Gran Canaria',
);

// --------------------------------------------------------------------------
// Migration into today's note
// --------------------------------------------------------------------------
check(
  'an Operon task keeps its fields and gains no tag',
  prepareMigratedLine(OPERON, DATE, OPTIONS),
  OPERON.replace('{{priority:: A}}', '{{priority:: A}} {{dateStarted:: 2026-09-16}}'),
);
check(
  'the start date sits after dateScheduled when the task has one',
  stampOperonStart(OPERON_SCHEDULED.replace('{{dateDue:: 2026-10-02}}', '{{dateScheduled:: 2026-09-20}} {{dateDue:: 2026-10-02}}'), DATE),
  OPERON_SCHEDULED.replace(
    '{{dateDue:: 2026-10-02}}',
    '{{dateScheduled:: 2026-09-20}} {{dateStarted:: 2026-09-16}} {{dateDue:: 2026-10-02}}',
  ),
);
check(
  'a start date already present is never overwritten',
  stampOperonStart(OPERON.replace('{{priority:: A}}', '{{priority:: A}} {{dateStarted:: 2026-09-15}}'), DATE),
  OPERON.replace('{{priority:: A}}', '{{priority:: A}} {{dateStarted:: 2026-09-15}}'),
);
check('a cancelled Operon task gets no start date', stampOperonStart(OPERON_CANCELLED, DATE), OPERON_CANCELLED);
check(
  'a plain task gets the tag at the start of its text and the source date at the end',
  prepareMigratedLine('- [ ] Mirar la práctica 1', DATE, OPTIONS),
  '- [ ] #task Mirar la práctica 1 ➕ 2026-09-16',
);
check('a task that already carries both is untouched', prepareMigratedLine(PLAIN, DATE, OPTIONS), PLAIN);
// A tag already on the line is left exactly where it was written: this only
// writes one when the line has none, it never moves yours.
check(
  '`- [!]` is carried into today as `- [ ] ⏫`, tagged twice never',
  prepareMigratedLine(PLAIN_IMPORTANT, DATE, OPTIONS),
  '- [ ] ⏫ Mirar el vuelo de Riga a Gran Canaria #task ➕ 2026-09-16',
);
check(
  'the tag can be written at the end of the line instead',
  prepareMigratedLine('- [ ] Mirar la práctica 1', DATE, { ...OPTIONS, taskTagPosition: 'end' }),
  '- [ ] Mirar la práctica 1 #task ➕ 2026-09-16',
);
check(
  'an empty tag setting writes no tag at all',
  prepareMigratedLine('- [ ] Mirar la práctica 1', DATE, { ...OPTIONS, taskTag: '' }),
  '- [ ] Mirar la práctica 1 ➕ 2026-09-16',
);
check(
  'the stamp can be turned off',
  prepareMigratedLine(OPERON, DATE, { taskTag: '#task', stampCreatedDate: false }),
  OPERON,
);
check(
  'a plain task before a `{{...}}` block keeps the block at the end',
  prepareMigratedLine('- [ ] X {{foo:: bar}}', DATE, OPTIONS),
  '- [ ] #task X ➕ 2026-09-16 {{foo:: bar}}',
);
check(
  'the tag goes after a `simple` time prefix, which the ruler reads only there',
  prefixTaskTag('- [ ] 09:00 - 09:30 Llamar al banco', '#task'),
  '- [ ] 09:00 - 09:30 #task Llamar al banco',
);
check(
  'a dated prefix keeps the tag behind it too',
  prefixTaskTag('- [ ] 2026-10-20 09:00 - 09:30 Llamar al banco', '#task'),
  '- [ ] 2026-10-20 09:00 - 09:30 #task Llamar al banco',
);
check(
  'an indented subtask is tagged after its own indent',
  prefixTaskTag('  - [ ] Repasar el tema 3', '#task'),
  '  - [ ] #task Repasar el tema 3',
);
check(
  'a task with no text at all still gets its space and its tag',
  prefixTaskTag('- [ ]', '#task'),
  '- [ ] #task',
);
check('hasOperonField sees dateStarted', hasOperonField(OPERON, 'dateStarted'), false);
check(
  'insertOperonField falls back to the end of a line with no field to sit behind',
  insertOperonField('- [ ] X', 'dateStarted', DATE, ['operonId']),
  '- [ ] X {{dateStarted:: 2026-09-16}}',
);

// --------------------------------------------------------------------------
// What the source note keeps
// --------------------------------------------------------------------------
check(
  'a plain tombstone keeps the tag and the ➕ date',
  tombstoneLine(PLAIN),
  '- [>] Pasar palabras al #amawal del chat y otras #task ➕ 2024-12-17',
);
check(
  'an Operon tombstone drops every field and keeps the text',
  tombstoneLine(OPERON),
  '- [>] Descargar las transparencias de Ingeniería de Sistemas de Instrumentación',
);
check(
  'a cancelled tombstone loses its id too',
  tombstoneLine(OPERON_CANCELLED),
  '- [>] Solicitar tarjeta de identificación de la actualizada #ulpgc',
);
check(
  'an indented subtask tombstone keeps its indent',
  tombstoneLine('  - [ ] Subtask {{operonId:: abc1234}} {{status:: Project.Planned}}'),
  '  - [>] Subtask',
);
check(
  'a tombstone no longer claims an identity',
  isOperonLine(tombstoneLine(OPERON)),
  false,
);
check(
  'a plain line with a Dataview field is recorded as it was written',
  tombstoneLine('- [ ] X [due:: 2026-01-01]'),
  '- [>] X [due:: 2026-01-01]',
);
check(
  'tombstoneOperonLines only touches the Operon lines',
  tombstoneOperonLines(
    ['- [ ] Pedir cita en Ars Medica', OPERON, 'En /home/bautista/misc hay algo'].join('\n'),
  ),
  ['- [ ] Pedir cita en Ars Medica', '- [>] Descargar las transparencias de Ingeniería de Sistemas de Instrumentación', 'En /home/bautista/misc hay algo'].join('\n'),
);

// --------------------------------------------------------------------------
// Leaving a past day's scheduling behind
// --------------------------------------------------------------------------
const TARGET = '2026-10-16';
const SOURCE = '2026-10-15';
// The three lines of the vault note this was reported from, verbatim.
const MIGRATED_TIME = '- [ ] 11:20 - 12:00 Revisión de cálculos previos P3 #materia/principios-electronica #task ⏳ 2026-10-14 ➕ 2026-10-13';
const MIGRATED_EMPTY_TITLE = '- [ ] 14:00 - 14:30 #materia/sistemas-instrumentacion #task ⏳ 2026-10-14 ➕ 2026-10-13';
const ALREADY_TODAY = '- [ ] 12:00 - 12:30 Revisión de informes P2 #materia/principios-electronica #task [created:: 2026-10-13] ➕ 2026-10-14';

check('the scheduling date is read from the Tasks emoji', scheduledDate('- [ ] X ⏳ 2026-10-14'), '2026-10-14');
check('the scheduling date is read from the Dataview field', scheduledDate('- [ ] X [scheduled:: 2026-10-14T11:20]'), '2026-10-14');
check('the scheduling date is read from the Kanban braces', scheduledDate('- [ ] X @{2026-10-14} @@{09:00}'), '2026-10-14');
check('a bare h:mm prefix is no date on its own', scheduledDate('- [ ] 12:00 - 12:30 Revisión de informes P2'), null);
check(
  'a bare h:mm prefix means the day of the note it lives in',
  scheduledDate('- [ ] 12:00 - 12:30 Revisión de informes P2', SOURCE),
  SOURCE,
);
check(
  'a dated prefix carries its own date instead',
  scheduledDate('- [ ] 2026-10-20 09:00 - 09:30 Mirar la práctica 1', SOURCE),
  '2026-10-20',
);
check('a line with no scheduling has no date', scheduledDate(PLAIN), null);

check(
  'yesterday`s time survives, its pin to yesterday does not',
  stripPastSchedule(MIGRATED_TIME, TARGET),
  '- [ ] Revisión de cálculos previos P3 #materia/principios-electronica #task ➕ 2026-10-13',
);
check(
  'a line whose text was all scheduling keeps its tags and ➕ date',
  stripPastSchedule(MIGRATED_EMPTY_TITLE, TARGET),
  '- [ ] #materia/sistemas-instrumentacion #task ➕ 2026-10-13',
);
check(
  'the Dataview fields the ruler writes go together',
  stripPastSchedule('- [ ] X [scheduled:: 2026-10-14T11:20] [startTime:: 13:15] [duration:: 40m] [due:: 2026-10-30]', TARGET),
  '- [ ] X [due:: 2026-10-30]',
);
check(
  'the full-calendar fields go together too',
  stripPastSchedule('- [ ] X [date:: 2026-10-14] [startTime:: 09:00] [endTime:: 9:30] [duration:: 30m] [allDay:: true]', TARGET),
  '- [ ] X',
);
check('an emoji date with a time is cleared', stripPastSchedule('- [ ] X ⏳ 2026-10-14 09:00', TARGET), '- [ ] X');
check('the Kanban date and time are cleared', stripPastSchedule('- [ ] X @{2026-10-14} @@{09:00}', TARGET), '- [ ] X');
check(
  'a line with no scheduling is untouched',
  stripPastSchedule('- [ ] Mirar la práctica 1 #task', TARGET, SOURCE),
  '- [ ] Mirar la práctica 1 #task',
);
check(
  'a prefix planned for the day it is leaving goes with the rest',
  stripPastSchedule(ALREADY_TODAY, TARGET, SOURCE),
  '- [ ] Revisión de informes P2 #materia/principios-electronica #task [created:: 2026-10-13] ➕ 2026-10-14',
);
check(
  'a prefix of a day that is still ahead stays',
  stripPastSchedule('- [ ] 2026-10-20 09:00 - 09:30 Mirar la práctica 1', TARGET, SOURCE),
  '- [ ] 2026-10-20 09:00 - 09:30 Mirar la práctica 1',
);
check(
  'a prefix whose day is unknown is left alone rather than guessed at',
  stripPastSchedule(ALREADY_TODAY, TARGET),
  ALREADY_TODAY,
);
check(
  'scheduling that is still ahead is kept',
  stripPastSchedule('- [ ] X ⏳ 2026-10-20', TARGET),
  '- [ ] X ⏳ 2026-10-20',
);
check(
  'scheduling for the destination day itself is kept',
  stripPastSchedule('- [ ] X [scheduled:: 2026-10-16T08:00]', TARGET),
  '- [ ] X [scheduled:: 2026-10-16T08:00]',
);
check(
  'a date this helper cannot read is never guessed at',
  stripPastSchedule('- [ ] X [scheduled:: ayer]', TARGET),
  '- [ ] X [scheduled:: ayer]',
);
check(
  "Operon's own date is not this plugin's to clear",
  stripPastSchedule('- [ ] X {{operonId:: gmucqjc}} {{dateScheduled:: 2026-10-01}} ⏳ 2026-10-14', TARGET),
  '- [ ] X {{operonId:: gmucqjc}} {{dateScheduled:: 2026-10-01}}',
);
check(
  'a due date and a start date are not scheduling',
  stripPastSchedule('- [ ] X 📅 2026-09-01 [start:: 2026-09-01] ⏳ 2026-10-14', TARGET),
  '- [ ] X 📅 2026-09-01 [start:: 2026-09-01]',
);
check(
  'clearing twice changes nothing',
  stripSchedule(stripSchedule('- [ ] X ⏳ 2026-10-14 [duration:: 40m]')),
  '- [ ] X',
);
check(
  'a migrated pending line arrives unscheduled and decorated once',
  prepareMigratedLine(MIGRATED_TIME, SOURCE, OPTIONS, TARGET),
  '- [ ] Revisión de cálculos previos P3 #materia/principios-electronica #task ➕ 2026-10-13',
);
check(
  'the ➕ stamp of the day it came from is added when the line has none',
  prepareMigratedLine('- [ ] Mirar la práctica 1 ⏳ 2026-10-14', SOURCE, OPTIONS, TARGET),
  '- [ ] #task Mirar la práctica 1 ➕ 2026-10-15',
);
check(
  'the setting turns the clearing off',
  prepareMigratedLine('- [ ] Mirar la práctica 1 ⏳ 2026-10-14', SOURCE, { ...OPTIONS, clearPastSchedule: false }, TARGET),
  '- [ ] #task Mirar la práctica 1 ⏳ 2026-10-14 ➕ 2026-10-15',
);
check(
  'without a destination date the line is only decorated',
  prepareMigratedLine('- [ ] Mirar la práctica 1 ⏳ 2026-10-14', SOURCE, OPTIONS),
  '- [ ] #task Mirar la práctica 1 ⏳ 2026-10-14 ➕ 2026-10-15',
);
check(
  'a surviving time prefix keeps the tag behind it, never in between',
  prepareMigratedLine('- [ ] 09:00 - 09:30 Llamar al banco', SOURCE, { ...OPTIONS, clearPastSchedule: false }, TARGET),
  '- [ ] 09:00 - 09:30 #task Llamar al banco ➕ 2026-10-15',
);
check(
  'a migrated line with a prefix arrives cleared too',
  prepareMigratedLine(ALREADY_TODAY, SOURCE, OPTIONS, TARGET),
  '- [ ] Revisión de informes P2 #materia/principios-electronica #task [created:: 2026-10-13] ➕ 2026-10-14',
);
check(
  'an important task arrives as a top-priority one, which is what Tasks sorts by',
  prepareMigratedLine('- [!] Remitir el acta de #materia/electronica-buque ➕ 2026-10-13', SOURCE, OPTIONS, TARGET),
  '- [ ] #task ⏫ Remitir el acta de #materia/electronica-buque ➕ 2026-10-13',
);
check(
  'and its tombstone is the same record as any other',
  tombstoneLine('- [!] Remitir el acta ➕ 2026-10-13'),
  '- [>] Remitir el acta ➕ 2026-10-13',
);
check(
  'the tombstone left in the source note keeps the record',
  tombstoneLine(MIGRATED_TIME),
  '- [>] 11:20 - 12:00 Revisión de cálculos previos P3 #materia/principios-electronica #task ⏳ 2026-10-14 ➕ 2026-10-13',
);
check(
  'a prefix-only tombstone keeps its hour as well',
  tombstoneLine(ALREADY_TODAY),
  '- [>] 12:00 - 12:30 Revisión de informes P2 #materia/principios-electronica #task [created:: 2026-10-13] ➕ 2026-10-14',
);

// --------------------------------------------------------------------------
// The order carried tasks arrive in
// --------------------------------------------------------------------------
// What the legacy script did, and what the backlog is read in: priority, then
// due date, then the day the task came from. These are lines written the way the
// vault writes them.
const LOWEST = '- [ ] #task Mirar los discos SSD externos ⏬ ➕ 2026-10-27';
const TOP = '- [ ] #task Hablar con Pedro, Moisés y José. 🔺 ➕ 2026-10-27 📅 2026-10-28';
const HIGH = '- [ ] #task Mirar lo de Erasmus+ 🔼 ➕ 2026-10-27';
const UNDATED = '- [ ] Pedir a Margarita y a Juan Manuel los datos de estudiantes de prácticas';
const OPERON_DUE = '- [ ] Leer el libro {{operonId:: twcd222}} {{dateDue:: 2026-09-20}}';

check('priority ranks from highest to lowest', [TOP, HIGH, LOWEST].map((line) => priorityRank(line)), [1, 3, 6]);
check('a line with no priority ranks with the lowest', priorityRank(UNDATED), 6);
check(
  'carried tasks arrive by priority, then due date, then the day they came from',
  [UNDATED, LOWEST, OPERON_DUE, HIGH, TOP].sort((a, b) => carriedOrder(a, b)),
  [TOP, HIGH, OPERON_DUE, LOWEST, UNDATED],
);
// The lowest icon and no icon rank together, as they did in the script: between
// them the due date decides, and a line with no priority but a due date comes
// before one marked `⏬` without it.
check('the lowest priority and no priority rank together', [priorityRank(LOWEST), priorityRank(OPERON_DUE)], [6, 6]);
check(
  'the same priority is split by due date, earliest first',
  [OPERON_DUE, '- [ ] #task Otra {{dateDue:: 2026-10-30}}'].sort((a, b) => carriedOrder(a, b)),
  [OPERON_DUE, '- [ ] #task Otra {{dateDue:: 2026-10-30}}'],
);
check(
  'with no priority and no due date, the oldest task comes first',
  [
    '- [ ] Reciente #task ➕ 2026-10-27',
    '- [ ] Antigua #task ➕ 2024-12-17',
    '- [ ] Con fecha propia [created:: 2025-01-13] #task',
  ].sort((a, b) => carriedOrder(a, b)),
  [
    '- [ ] Antigua #task ➕ 2024-12-17',
    '- [ ] Con fecha propia [created:: 2025-01-13] #task',
    '- [ ] Reciente #task ➕ 2026-10-27',
  ],
);
check('two identical keys keep the order they were scanned in', carriedOrder(HIGH, HIGH), 0);

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('lines: all checks passed');
