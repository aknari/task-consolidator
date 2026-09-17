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
 *    tombstone keeping an `operonId` claims an identity today's note holds.
 */
import assert from 'node:assert/strict';
import {
  hasOperonField,
  insertOperonField,
  isOperonLine,
  normalizeTaskLine,
  operonId,
  prepareMigratedLine,
  stampOperonStart,
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
  'a plain task gets the tag and the source date',
  prepareMigratedLine('- [ ] Mirar la práctica 1', DATE, OPTIONS),
  '- [ ] Mirar la práctica 1 #task ➕ 2026-09-16',
);
check('a task that already carries both is untouched', prepareMigratedLine(PLAIN, DATE, OPTIONS), PLAIN);
check(
  '`- [!]` is carried into today as `- [ ]`, tagged twice never',
  prepareMigratedLine(PLAIN_IMPORTANT, DATE, OPTIONS),
  '- [ ] Mirar el vuelo de Riga a Gran Canaria #task ➕ 2026-09-16',
);
check(
  'the stamp can be turned off',
  prepareMigratedLine(OPERON, DATE, { taskTag: '#task', stampCreatedDate: false }),
  OPERON,
);
check(
  'a plain task before a `{{...}}` block keeps the block at the end',
  prepareMigratedLine('- [ ] X {{foo:: bar}}', DATE, OPTIONS),
  '- [ ] X #task ➕ 2026-09-16 {{foo:: bar}}',
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

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('lines: all checks passed');
