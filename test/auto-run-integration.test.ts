/**
 * Integration test of the automatic run, against an in-memory vault.
 * Run with: npm run test:integration
 *
 * It reproduces the incident of 2026-09-18. The daily note was written twice —
 * the periodic-notes plugin applied the daily template, and a Templater file
 * template applied the same template again a few seconds later — and the second
 * write landed *after* the consolidation had already marked the previous note as
 * moved:
 *
 *   10:10:13.657  the reminder file was written
 *   10:10:13.733  the previous note was marked "moved 2 task line(s) to …"
 *   10:10:14.910  today's note was written again, back to the bare template
 *
 * Afterwards the two tasks and a live Operon reminder existed nowhere; the
 * `operonId` the reminder carried was in no `.md` file at all.
 *
 * What matters here:
 *  - the ordinary run still migrates and consolidates exactly as before;
 *  - a note rewritten underneath the run is detected, and then *nothing* is
 *    marked as moved and the dated records are not written, so the previous note
 *    keeps its tasks and the Operon reminder keeps its identity;
 *  - a task planned for the day it is leaving arrives without that scheduling —
 *    a bare `h:mm` prefix included, since its day is the day of the note it
 *    came from — while the tombstone keeps it as the record, and — with the
 *    setting off — the run behaves exactly as it did before it existed.
 */
import assert from 'node:assert/strict';
import { MockVault, createApp, notices, resetNotices } from './obsidian-mock';
import TaskConsolidatorPlugin from '../src/main';

const TODAY = '2026-09-18';
const YESTERDAY = '2026-09-17';
const FOLDER = '10-journal/daily notes';
const TODAY_PATH = `${FOLDER}/${TODAY}.md`;
const YESTERDAY_PATH = `${FOLDER}/${YESTERDAY}.md`;
const REMINDERS_FILE = '10-journal/misc/recordatorios.md';
const NOTES_FILE = '10-journal/misc/apuntes.md';

const PLAIN_TASK = '- [ ] Pasar palabras al #amawal del chat y otras #task ➕ 2024-12-17';
const LISA_TASK = '- [ ] Lisa: Mirar [[Apuntes de desarrollo]] y [[Notas sobre Lisa]] #task ➕ 2025-02-24';
const OPERON_REMINDER =
  '- [ ] Descargar las transparencias de Ingeniería de Sistemas de Instrumentación {{operonId:: 8l9f9l2}} {{status:: Project.Brainstorming}} {{priority:: A}} {{parentTask:: zf7exxn}}';

const WEEKLY_HEADING = '## Resumen de la última semana trabajada';

// The reported lines: two tasks planned for the day they were leaving (the
// `⏳` pins them there, whatever the note they now live in), and one planned by
// its own `h:mm` prefix, which is read against the note it is moving into.
const PLANNED_WITH_TIME =
  '- [ ] 11:20 - 12:00 Revisión de cálculos previos P3 #materia/principios-electronica #task ⏳ 2026-09-17 ➕ 2026-09-16';
const PLANNED_EMPTY_TITLE =
  '- [ ] 14:00 - 14:30 #materia/sistemas-instrumentacion #task ⏳ 2026-09-17 ➕ 2026-09-16';
const PLANNED_BY_PREFIX = '- [ ] 12:00 - 12:30 Revisión de informes P2 #materia/principios-electronica #task ➕ 2026-09-17';
// The same task text planned at two different hours in two different notes:
// clearing the scheduling reduces both to one line, and neither may be lost.
// A subtask line travels with its parent and has its own scheduling cleared
// even though the line itself is otherwise verbatim.
const SAME_TEXT_MORNING = '- [ ] 09:00 - 09:30 Preparar exámenes #task ⏳ 2026-09-17';
const SAME_TEXT_EVENING = '- [ ] 16:00 - 16:30 Preparar exámenes #task ⏳ 2026-09-16';
const PARENT_WITH_SUBTASK = '- [ ] Preparar exámenes #task ⏳ 2026-09-17';
const SUBTASK_PLANNED = '  - [ ] 18:00 - 18:30 Repasar el tema 3 #task';

/** A daily note with every managed block the plugin expects. */
function dailyNote(options: { tasks?: string[]; reminders?: string[]; weeklyHeading?: boolean } = {}): string {
  return [
    '---',
    'title: Daily Note',
    '---',
    '# Nota del Día',
    '',
    '<!-- task-consolidator:weekly:start -->',
    ...(options.weeklyHeading === true ? [WEEKLY_HEADING] : []),
    '<!-- task-consolidator:weekly:end -->',
    '## Plan del día',
    '<!-- task-consolidator:tasks:start -->',
    '## Tareas pendientes',
    ...(options.tasks ?? []),
    '<!-- task-consolidator:tasks:end -->',
    '## Tareas canceladas',
    '<!-- task-consolidator:cancelled:start -->',
    '<!-- task-consolidator:cancelled:end -->',
    '## Para recordar',
    '<!-- task-consolidator:reminders:start -->',
    ...(options.reminders ?? []),
    '<!-- task-consolidator:reminders:end -->',
    '## Apuntes diversos',
    '<!-- task-consolidator:notes:start -->',
    '<!-- task-consolidator:notes:end -->',
    '',
  ].join('\n');
}

/** Today's note exactly as the daily template leaves it: heading, no tasks. */
const TEMPLATE_TODAY = dailyNote({ weeklyHeading: true });

let checks = 0;
function checkTrue(name: string, value: boolean): void {
  checks += 1;
  assert.ok(value, name);
  console.log(`  ok  ${name}`);
}

// The plugin reads the date through `window.moment()`; Node has no such window.
(globalThis as unknown as { window: unknown }).window = {
  moment: () => ({ format: () => TODAY }),
  setTimeout: (callback: () => void, ms: number) => setTimeout(callback, ms),
  clearTimeout: (handle: number) => clearTimeout(handle as unknown as NodeJS.Timeout),
};

function seedVault(): MockVault {
  const vault = new MockVault();
  vault.seed(YESTERDAY_PATH, dailyNote({ tasks: [PLAIN_TASK, LISA_TASK], reminders: [OPERON_REMINDER] }));
  vault.seed(TODAY_PATH, TEMPLATE_TODAY);
  vault.seed(REMINDERS_FILE, '# Recordatorios\n');
  vault.seed(NOTES_FILE, '# Apuntes\n');
  return vault;
}

async function startRun(vault: MockVault, settings: Record<string, unknown> = {}): Promise<void> {
  const plugin = new (TaskConsolidatorPlugin as unknown as new (app: unknown, manifest: unknown) => any)(
    createApp(vault),
    {},
  );
  await plugin.onload();
  Object.assign(plugin.settings, settings);
  // Shorten the grace period the test would otherwise spend waiting in real time.
  plugin.verifyGraceMs = 150;
  await plugin.runAutomaticConsolidation();
}

async function main(): Promise<void> {
  console.log('\nThe ordinary run: everything is migrated, and then marked');

  {
    resetNotices();
    const vault = seedVault();
    await startRun(vault);

    const today = vault.content(TODAY_PATH);
    checkTrue('today keeps the first task', today.includes(PLAIN_TASK));
    checkTrue('today keeps the second task', today.includes(LISA_TASK));
    checkTrue('today keeps the Operon reminder, with its identity', today.includes('{{operonId:: 8l9f9l2}}'));
    checkTrue('the migrated Operon reminder gets a start date', today.includes('{{dateStarted:: 2026-09-17}}'));

    const yesterday = vault.content(YESTERDAY_PATH);
    checkTrue('the previous note records where the work went', yesterday.includes('moved 2 task line(s) to 2026-09-18'));
    checkTrue('its tasks become tombstones', yesterday.includes('- [>] Pasar palabras al #amawal'));
    checkTrue('and the reminder file gets the dated record', vault.content(REMINDERS_FILE).includes('Reminders from 2026-09-17'));
    checkTrue('the run reported what it did', notices.some((message) => message.includes('inserted 2 pending')));
  }

  console.log('\nThe incident: the note is rewritten underneath the run');

  {
    resetNotices();
    const vault = seedVault();
    let replayed = false;
    vault.onWrite = (path) => {
      // The template's second write, 50 ms in: after the run has written into
      // today's note, before the run has marked anything as moved.
      if (path !== TODAY_PATH || replayed) return;
      replayed = true;
      setTimeout(() => { vault.seed(TODAY_PATH, TEMPLATE_TODAY); }, 50);
    };

    await startRun(vault);

    checkTrue('the second write really happened', replayed);
    checkTrue(
      'today is the bare template again, as it was in the incident',
      !vault.content(TODAY_PATH).includes('Pasar palabras al'),
    );

    const yesterday = vault.content(YESTERDAY_PATH);
    checkTrue('the previous note keeps its first task pending', yesterday.includes(PLAIN_TASK));
    checkTrue('and its second one', yesterday.includes(LISA_TASK));
    checkTrue('it is NOT marked as moved', !yesterday.includes('moved 2 task line(s)'));
    checkTrue('and the Operon reminder keeps its identity', yesterday.includes('{{operonId:: 8l9f9l2}}'));
    checkTrue(
      'the dated record was not written either',
      !vault.content(REMINDERS_FILE).includes('Reminders from 2026-09-17'),
    );
    checkTrue(
      'you are told, instead of losing the tasks quietly',
      notices.some((message) => message.includes('rewritten while consolidating')),
    );
  }

  console.log('\nThe reported case: tasks planned for the day they are leaving');

  {
    resetNotices();
    const vault = new MockVault();
    vault.seed(
      YESTERDAY_PATH,
      dailyNote({ tasks: [PLANNED_WITH_TIME, PLANNED_EMPTY_TITLE, PLANNED_BY_PREFIX] }),
    );
    vault.seed(TODAY_PATH, TEMPLATE_TODAY);
    vault.seed(REMINDERS_FILE, '# Recordatorios\n');
    vault.seed(NOTES_FILE, '# Apuntes\n');
    await startRun(vault);

    const today = vault.content(TODAY_PATH);
    checkTrue('the pin to the past day is gone from the line carried in', !today.includes('⏳ 2026-09-17'));
    checkTrue('and the hour prefix that was read against it as well', !today.includes('11:20 - 12:00'));
    checkTrue(
      'the task itself is there, decorated exactly once',
      today.includes('- [ ] Revisión de cálculos previos P3 #materia/principios-electronica #task ➕ 2026-09-16'),
    );
    checkTrue(
      'a line whose text was all scheduling keeps its tags',
      today.includes('- [ ] #materia/sistemas-instrumentacion #task ➕ 2026-09-16'),
    );
    checkTrue(
      'a bare h:mm prefix means the day it came from, so it goes as well',
      today.includes('- [ ] Revisión de informes P2 #materia/principios-electronica #task ➕ 2026-09-17'),
    );
    checkTrue('no hour of the previous day survived anywhere in it', !today.includes('12:00 - 12:30'));
    checkTrue('nothing was reported as lost', !notices.some((message) => message.includes('rewritten while consolidating')));

    const yesterday = vault.content(YESTERDAY_PATH);
    checkTrue(
      'the tombstone left behind keeps the record of how that day was planned',
      yesterday.includes('- [>] 11:20 - 12:00 Revisión de cálculos previos P3 #materia/principios-electronica #task ⏳ 2026-09-17 ➕ 2026-09-16'),
    );
    checkTrue(
      'and a prefix-only tombstone keeps its hour',
      yesterday.includes('- [>] 12:00 - 12:30 Revisión de informes P2'),
    );
  }

  console.log('\nA subtask planned for the day it is leaving');

  {
    resetNotices();
    const vault = new MockVault();
    vault.seed(
      YESTERDAY_PATH,
      dailyNote({ tasks: [PARENT_WITH_SUBTASK, SUBTASK_PLANNED] }),
    );
    vault.seed(TODAY_PATH, TEMPLATE_TODAY);
    vault.seed(REMINDERS_FILE, '# Recordatorios\n');
    vault.seed(NOTES_FILE, '# Apuntes\n');
    await startRun(vault);

    const today = vault.content(TODAY_PATH);
    checkTrue('the subtask travels with its parent, indented', today.includes('  - [ ] Repasar el tema 3 #task'));
    checkTrue('without the hour it was planned at that day', !today.includes('18:00 - 18:30'));
    checkTrue('and without the parent`s pin either', !today.includes('⏳ 2026-09-17'));
  }

  console.log('\nThe same task text planned twice, and a run repeated');

  {
    resetNotices();
    const vault = new MockVault();
    const yesterdaySource = dailyNote({
      tasks: [PLANNED_WITH_TIME, SAME_TEXT_MORNING, SAME_TEXT_EVENING],
    });
    vault.seed(YESTERDAY_PATH, yesterdaySource);
    vault.seed(TODAY_PATH, TEMPLATE_TODAY);
    vault.seed(REMINDERS_FILE, '# Recordatorios\n');
    vault.seed(NOTES_FILE, '# Apuntes\n');
    await startRun(vault);

    const occurrences = (haystack: string, needle: string): number => haystack.split(needle).length - 1;
    const today = (): string => vault.content(TODAY_PATH);
    checkTrue(
      'two tasks that differ only in their scheduling both arrive, and stay two',
      occurrences(today(), '- [ ] Preparar exámenes #task') === 2,
    );
    checkTrue('and no scheduling came with them', !today().includes('⏳'));

    // The previous note as it was, and the run repeated: the sources plan the
    // same moves again, and the copies already in today's note have to be
    // recognised under the form this run would write, not the form they came in.
    vault.seed(YESTERDAY_PATH, yesterdaySource);
    await startRun(vault);

    checkTrue(
      'a repeated run inserts no duplicate of a cleared line',
      occurrences(today(), '- [ ] Revisión de cálculos previos P3 #materia/principios-electronica #task') === 1,
    );
    checkTrue('and the repeated run reports nothing lost', !notices.some((message) => message.includes('rewritten while consolidating')));
  }

  console.log('\nWith the setting off: the run behaves as it did before');

  {
    resetNotices();
    const vault = new MockVault();
    vault.seed(YESTERDAY_PATH, dailyNote({ tasks: [PLANNED_WITH_TIME, PLANNED_EMPTY_TITLE] }));
    vault.seed(TODAY_PATH, TEMPLATE_TODAY);
    vault.seed(REMINDERS_FILE, '# Recordatorios\n');
    vault.seed(NOTES_FILE, '# Apuntes\n');
    await startRun(vault, { clearPastSchedule: false });

    const today = vault.content(TODAY_PATH);
    checkTrue('the line arrives with its scheduling intact', today.includes(`- [ ] ${PLANNED_WITH_TIME.slice(6)}`));
    checkTrue('and the tombstone keeps it as well', vault.content(YESTERDAY_PATH).includes('- [>] 11:20 - 12:00'));
  }

  console.log(`\n${checks} checks passed\n`);
}

void main();
