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
function dailyNote(options: { plan?: string[]; tasks?: string[]; reminders?: string[]; weeklyHeading?: boolean } = {}): string {
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
    '<!-- task-consolidator:plan:start -->',
    ...(options.plan ?? []),
    '<!-- task-consolidator:plan:end -->',
    '## Tareas pendientes',
    '<!-- task-consolidator:tasks:start -->',
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

/** The plugin, loaded against the in-memory vault, without running anything. */
async function loadPlugin(vault: MockVault, settings: Record<string, unknown> = {}): Promise<any> {
  const plugin = new (TaskConsolidatorPlugin as unknown as new (app: unknown, manifest: unknown) => any)(
    createApp(vault),
    {},
  );
  await plugin.onload();
  Object.assign(plugin.settings, settings);
  // Shorten the grace period the test would otherwise spend waiting in real time.
  plugin.verifyGraceMs = 150;
  return plugin;
}

async function startRun(vault: MockVault, settings: Record<string, unknown> = {}): Promise<void> {
  const plugin = await loadPlugin(vault, settings);
  await plugin.runAutomaticConsolidation();
}

/** The lines between a marker pair of the note, for readable assertions. */
function section(content: string, pair: { start: string; end: string }): string[] {
  const lines = content.split('\n');
  const start = lines.indexOf(pair.start), end = lines.indexOf(pair.end);
  return start < 0 || end < 0 ? ['<missing>'] : lines.slice(start + 1, end);
}

const PLAN = { start: '<!-- task-consolidator:plan:start -->', end: '<!-- task-consolidator:plan:end -->' };
const BACKLOG = { start: '<!-- task-consolidator:tasks:start -->', end: '<!-- task-consolidator:tasks:end -->' };

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

  console.log('\nThe plan of a day that is over: an open task comes back as pending');

  {
    resetNotices();
    const vault = new MockVault();
    const planTask = '- [ ] Tarea de prueba   [scheduled:: 2026-09-17T17:45]  [duration:: 15m]';
    // The `simple` prefix, which is what the ruler writes when the line carries
    // no field of its own — in the plan block as well.
    const planPrefix = '- [ ] 09:00 - 09:30 Revisar el correo #task ➕ 2026-09-17';
    const planPrefixDated = '- [ ] 2026-09-17 10:00 - 10:30 Llamar al banco #task';
    vault.seed(YESTERDAY_PATH, dailyNote({ plan: [planTask, planPrefix, planPrefixDated] }));
    vault.seed(TODAY_PATH, TEMPLATE_TODAY);
    vault.seed(REMINDERS_FILE, '# Recordatorios\n');
    vault.seed(NOTES_FILE, '# Apuntes\n');
    await startRun(vault);

    const today = vault.content(TODAY_PATH);
    const backlog = section(today, BACKLOG);
    checkTrue(
      'a task left open in yesterday\'s plan arrives in today\'s backlog',
      backlog.some((line) => line.includes('Tarea de prueba')),
    );
    checkTrue(
      'without the slot of the day it left',
      !backlog.join('\n').includes('17:45') && !backlog.join('\n').includes('[scheduled:: 2026-09-17'),
    );
    checkTrue(
      'it is not smuggled into today\'s plan',
      !section(today, PLAN).some((line) => line.includes('Tarea de prueba')),
    );

    const yesterday = vault.content(YESTERDAY_PATH);
    checkTrue('yesterday\'s plan says where the work went', section(yesterday, PLAN).includes('<!-- task-consolidator:moved 3 task line(s) to 2026-09-18 -->'));
    checkTrue(
      'and keeps the line as a tombstone with the slot of that day',
      section(yesterday, PLAN).some((line) => line.startsWith('- [>] Tarea de prueba') && line.includes('17:45')),
    );
    checkTrue(
      'a bare h:mm - h:mm prefix in the plan is dropped on the way in',
      backlog.includes('- [ ] Revisar el correo #task ➕ 2026-09-17') && !today.includes('09:00 - 09:30'),
    );
    checkTrue(
      'a dated h:mm prefix is dropped too, date and all',
      backlog.includes('- [ ] Llamar al banco #task ➕ 2026-09-17') && !today.includes('10:00 - 10:30') && !today.includes('2026-09-17 10:00'),
    );
    checkTrue(
      'their tombstones keep the prefix, as the record of the plan',
      section(yesterday, PLAN).some((line) => line.startsWith('- [>] 09:00 - 09:30 Revisar el correo')) &&
        section(yesterday, PLAN).some((line) => line.startsWith('- [>] 2026-09-17 10:00 - 10:30 Llamar al banco')),
    );
    checkTrue('nothing was reported as lost', !notices.some((message) => message.includes('rewritten while consolidating')));
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

  console.log("\nA task planned for today arrives under 'Plan del día'");

  {
    resetNotices();
    const vault = new MockVault();
    const plannedForToday = '- [ ] Revisar el tema 3 #task [scheduled:: 2026-09-18T09:00] [duration:: 30m]';
    vault.seed(YESTERDAY_PATH, dailyNote({ tasks: [PLAIN_TASK, plannedForToday] }));
    vault.seed(TODAY_PATH, TEMPLATE_TODAY);
    vault.seed(REMINDERS_FILE, '# Recordatorios\n');
    vault.seed(NOTES_FILE, '# Apuntes\n');
    await startRun(vault);

    const today = vault.content(TODAY_PATH);
    const plan = section(today, PLAN).join('\n');
    const backlog = section(today, BACKLOG).join('\n');
    checkTrue('the task planned for today is the day\'s plan, not the backlog', plan.includes('Revisar el tema 3'));
    checkTrue('it keeps its scheduling, since today is the day it meant', plan.includes('[scheduled:: 2026-09-18T09:00]'));
    checkTrue('the unplanned task waits in the backlog', backlog.includes('Pasar palabras al #amawal'));
    checkTrue('and the plan is not duplicated into the backlog', !backlog.includes('Revisar el tema 3'));
  }

  console.log('\nWith a note that has no plan block: everything goes to the backlog, as before');

  {
    resetNotices();
    const vault = new MockVault();
    const plannedForToday = '- [ ] Revisar el tema 3 #task [scheduled:: 2026-09-18T09:00] [duration:: 30m]';
    vault.seed(YESTERDAY_PATH, dailyNote({ tasks: [plannedForToday] }));
    vault.seed(
      TODAY_PATH,
      dailyNote({ weeklyHeading: true }).replace('<!-- task-consolidator:plan:start -->\n<!-- task-consolidator:plan:end -->\n', ''),
    );
    vault.seed(REMINDERS_FILE, '# Recordatorios\n');
    vault.seed(NOTES_FILE, '# Apuntes\n');
    await startRun(vault);

    checkTrue(
      'an older note is left with its single section',
      section(vault.content(TODAY_PATH), BACKLOG).join('\n').includes('Revisar el tema 3'),
    );
  }

  console.log('\nThe reconcile command: both directions and clock order');

  {
    resetNotices();
    const early = '- [ ] Revisar materia #task [scheduled:: 2026-09-18T08:00] [duration:: 30m]';
    const late = '- [ ] Preparar examen #task [scheduled:: 2026-09-18T09:00] [duration:: 1h]';
    const tomorrow = '- [ ] Preparar materia #task [scheduled:: 2026-09-19T08:00]';
    const vault = new MockVault();
    vault.seed(TODAY_PATH, dailyNote({ plan: [late], tasks: [early, tomorrow, PLAIN_TASK] }));
    const plugin = await loadPlugin(vault);
    await plugin.reconcilePlanSections();

    const afterMove = vault.content(TODAY_PATH);
    const plan = section(afterMove, PLAN).join('\n');
    const backlog = section(afterMove, BACKLOG).join('\n');
    checkTrue('the 8:00 task is carried into the plan', plan.includes(early));
    checkTrue('and it sits above the 9:00 one', plan.indexOf(early) < plan.indexOf(late));
    checkTrue('a task planned for tomorrow stays in the backlog', backlog.includes(tomorrow));
    checkTrue('and so does one that is not planned at all', backlog.includes(PLAIN_TASK));
    checkTrue('the command reports the move', notices.some((message) => message.includes("1 to 'Plan del día'")));

    // The same rule, backwards: the day the plan line is planned for is no
    // longer this one, so the task belongs to the backlog again.
    vault.seed(TODAY_PATH, afterMove.replace('[scheduled:: 2026-09-18T08:00]', '[scheduled:: 2026-09-17T08:00]'));
    await plugin.reconcilePlanSections();
    const afterReturn = vault.content(TODAY_PATH);
    checkTrue('a plan line whose day is not today goes back', section(afterReturn, BACKLOG).join('\n').includes('Revisar materia'));
    checkTrue('and leaves the plan', !section(afterReturn, PLAN).join('\n').includes('Revisar materia'));
    checkTrue('while the task that is today\'s plan stays', section(afterReturn, PLAN).join('\n').includes('Preparar examen'));

    await plugin.reconcilePlanSections();
    checkTrue('a pass with nothing to change writes nothing', vault.content(TODAY_PATH) === afterReturn);
    checkTrue('and tells you so', notices.some((message) => message.includes('already where it belongs')));
  }

  console.log('\nThe watcher: a drag in the ruler is enough');

  {
    resetNotices();
    const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
    const late = '- [ ] Preparar examen #task [scheduled:: 2026-09-18T09:00] [duration:: 1h]';
    const vault = new MockVault();
    vault.seed(TODAY_PATH, dailyNote({ plan: [late], tasks: [PLAIN_TASK] }));
    vault.emitEvents = true;
    let writes = 0;
    vault.onWrite = (path) => { if (path === TODAY_PATH) writes += 1; };
    const plugin = await loadPlugin(vault, { autoConsolidate: false });
    plugin.reconcileDelayMs = 30;

    // The ruler's write: the line keeps its place, only its scheduling changes.
    const today = vault.getAbstractFileByPath(TODAY_PATH)!;
    const dragged = vault.content(TODAY_PATH).replace(PLAIN_TASK, `${PLAIN_TASK} [scheduled:: 2026-09-18T08:00] [duration:: 30m]`);
    await vault.modify(today, dragged);
    await sleep(200);

    const moved = vault.content(TODAY_PATH);
    checkTrue('the task is carried into the plan with no command at all', section(moved, PLAN).join('\n').includes('Pasar palabras al #amawal'));
    checkTrue('and leaves the backlog', !section(moved, BACKLOG).join('\n').includes('Pasar palabras al #amawal'));
    checkTrue('it lands in clock order, below the 9:00 task', section(moved, PLAN).join('\n').indexOf('Pasar palabras') < section(moved, PLAN).join('\n').indexOf('Preparar examen'));
    checkTrue('the drag and one move: exactly two writes', writes === 2);

    // A write that changes nothing must stay a write that changes nothing: the
    // plugin's own move re-arms nothing, and a no-op save is not rearranged.
    const writesAfterMove = writes;
    await vault.modify(today, vault.content(TODAY_PATH));
    await sleep(200);
    checkTrue('a save that changes nothing is not written over', writes === writesAfterMove + 1);

    // Un-planning, the way the ruler does it: the marks go, the line stays.
    await vault.modify(today, vault.content(TODAY_PATH).replace(' [scheduled:: 2026-09-18T08:00] [duration:: 30m]', ''));
    await sleep(200);
    const returned = vault.content(TODAY_PATH);
    checkTrue('dragging it back to Unscheduled returns it to the backlog', section(returned, BACKLOG).join('\n').includes('Pasar palabras al #amawal'));
    checkTrue('and the plan keeps only what is planned', !section(returned, PLAN).join('\n').includes('Pasar palabras al #amawal'));
  }

  console.log('\nThe watcher never acts on your typing');

  {
    resetNotices();
    const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
    const vault = new MockVault();
    vault.seed(TODAY_PATH, dailyNote({ tasks: [PLAIN_TASK] }));
    vault.emitEvents = true;
    let writes = 0;
    vault.onWrite = (path) => { if (path === TODAY_PATH) writes += 1; };
    const plugin = await loadPlugin(vault, { autoConsolidate: false });
    plugin.reconcileDelayMs = 30;

    // What a person does: a new task typed where they want it, unscheduled.
    const typed = '- [ ] Tarea de prueba';
    const today = vault.getAbstractFileByPath(TODAY_PATH)!;
    await vault.modify(
      today,
      vault.content(TODAY_PATH).replace('<!-- task-consolidator:plan:start -->', `<!-- task-consolidator:plan:start -->\n${typed}`),
    );
    await sleep(200);

    const afterTyping = vault.content(TODAY_PATH);
    checkTrue('a line typed into the plan stays exactly where you typed it', afterTyping.includes(`<!-- task-consolidator:plan:start -->\n${typed}`));
    checkTrue('it was not carried to the backlog', !afterTyping.split('<!-- task-consolidator:tasks:start -->')[1].includes('Tarea de prueba'));
    checkTrue('and the typing was the only write', writes === 1);

    // Renaming a task is the same story: yours, and never rearranged.
    await vault.modify(today, afterTyping.replace(typed, '- [ ] Tarea de prueba renombrada'));
    await sleep(200);
    checkTrue('renaming it does not move it either', vault.content(TODAY_PATH).includes('- [ ] Tarea de prueba renombrada'));
    checkTrue('and again only the two writes of yours happened', writes === 2);
  }

  console.log("\nThe watcher still recognises the ruler's own rewrite, tag and all");

  {
    resetNotices();
    const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
    const vault = new MockVault();
    // The same task, before and after the ruler rebuilds its line: the tag and
    // the `➕` stamp are gone, and only the scheduling was added.
    const beforeRebuild = '- [ ] Preparar materia #materia/sistemas-instrumentacion #task ➕ 2026-09-16';
    const rebuilt = '- [ ] Preparar materia #materia/sistemas-instrumentacion   [scheduled:: 2026-09-18T11:00]  [duration:: 2h]';
    vault.seed(TODAY_PATH, dailyNote({ tasks: [PLAIN_TASK, beforeRebuild] }));
    vault.emitEvents = true;
    const plugin = await loadPlugin(vault, { autoConsolidate: false });
    plugin.reconcileDelayMs = 30;

    const today = vault.getAbstractFileByPath(TODAY_PATH)!;
    await vault.modify(today, vault.content(TODAY_PATH).replace(beforeRebuild, rebuilt));
    await sleep(200);

    checkTrue("the ruler's lossy rebuild still reads as the same task", section(vault.content(TODAY_PATH), PLAN).join('\n').includes(rebuilt));
  }

  console.log('\nThe watcher, with the setting off: the note is only changed by hand');

  {
    resetNotices();
    const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
    const vault = new MockVault();
    vault.seed(TODAY_PATH, dailyNote({ tasks: [PLAIN_TASK] }));
    vault.emitEvents = true;
    let writes = 0;
    vault.onWrite = (path) => { if (path === TODAY_PATH) writes += 1; };
    const plugin = await loadPlugin(vault, { autoConsolidate: false, autoReconcile: false });
    plugin.reconcileDelayMs = 30;

    const today = vault.getAbstractFileByPath(TODAY_PATH)!;
    await vault.modify(today, vault.content(TODAY_PATH).replace(PLAIN_TASK, `${PLAIN_TASK} [scheduled:: 2026-09-18T08:00]`));
    await sleep(200);

    checkTrue('nothing is moved', section(vault.content(TODAY_PATH), PLAN).length === 0);
    checkTrue('and only the drag wrote', writes === 1);
  }

  console.log('\nThe watcher, on a note without a plan block');

  {
    resetNotices();
    const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
    const vault = new MockVault();
    vault.seed(
      TODAY_PATH,
      dailyNote({ tasks: [PLAIN_TASK] }).replace('<!-- task-consolidator:plan:start -->\n<!-- task-consolidator:plan:end -->\n', ''),
    );
    vault.emitEvents = true;
    let writes = 0;
    vault.onWrite = (path) => { if (path === TODAY_PATH) writes += 1; };
    const plugin = await loadPlugin(vault, { autoConsolidate: false });
    plugin.reconcileDelayMs = 30;

    const today = vault.getAbstractFileByPath(TODAY_PATH)!;
    const before = vault.content(TODAY_PATH);
    await vault.modify(today, before.replace(PLAIN_TASK, `${PLAIN_TASK} [scheduled:: 2026-09-18T08:00]`));
    await sleep(200);

    checkTrue('an older note is never rearranged', vault.content(TODAY_PATH).includes(`${PLAIN_TASK} [scheduled:: 2026-09-18T08:00]`));
    checkTrue('and nothing beyond the drag was written', writes === 1);
  }

  console.log('\nA marker typed over: the run says what it cannot read, and changes nothing');

  {
    resetNotices();
    const vault = seedVault();
    const broken = vault.content(YESTERDAY_PATH).replace('tasks:end -->', 'tasks:endū-->');
    vault.seed(YESTERDAY_PATH, broken);

    await startRun(vault);

    checkTrue('the notice names the note and the line', notices.some((n) => n.includes('2026-09-17.md, line') && n.includes('not read')));
    checkTrue('the tasks stay in the source', vault.content(YESTERDAY_PATH).includes(PLAIN_TASK));
    checkTrue('no copy was invented in today\'s note', !vault.content(TODAY_PATH).includes(PLAIN_TASK));
    checkTrue('and nothing was marked as moved', !vault.content(YESTERDAY_PATH).includes('task-consolidator:moved'));
  }

  console.log('\nThe same run, after the marker is repaired: the tasks move');

  {
    resetNotices();
    const vault = seedVault();
    vault.seed(YESTERDAY_PATH, vault.content(YESTERDAY_PATH).replace('tasks:end -->', 'tasks:endū-->'));
    await startRun(vault);

    vault.seed(YESTERDAY_PATH, vault.content(YESTERDAY_PATH).replace('tasks:endū-->', 'tasks:end -->'));
    await startRun(vault);

    checkTrue('the repaired note is read', vault.content(TODAY_PATH).includes(PLAIN_TASK));
    checkTrue('and its task is marked as moved', vault.content(YESTERDAY_PATH).includes('- [>] Pasar palabras'));
  }

  console.log('\nA broken note of today: the run is not finished, so the day is not consumed');

  {
    resetNotices();
    const vault = seedVault();
    vault.seed(TODAY_PATH, TEMPLATE_TODAY.replace('tasks:end -->', 'tasks:endū-->'));
    const plugin = await loadPlugin(vault);

    const completed = await plugin.runAutomaticConsolidation();

    checkTrue('the run reports that it did not finish', completed === false);
    checkTrue('nothing was written into today\'s note', !vault.content(TODAY_PATH).includes(PLAIN_TASK));
    checkTrue('the source keeps its task', vault.content(YESTERDAY_PATH).includes(PLAIN_TASK));
    checkTrue('and the status bar counts the problem', plugin.statusBarEl.text === '⚠ 1');
  }

  console.log('\nThe same typo, caught while the note is being written');

  {
    resetNotices();
    const vault = seedVault();
    vault.emitEvents = true;
    const plugin = await loadPlugin(vault, { autoConsolidate: false });
    plugin.markerCheckDelayMs = 20;
    const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

    const yesterday = vault.getAbstractFileByPath(YESTERDAY_PATH)!;
    await vault.modify(yesterday, vault.content(YESTERDAY_PATH).replace('tasks:end -->', 'tasks:endū-->'));
    await sleep(120);

    checkTrue('the write is announced without waiting for a run', notices.some((n) => n.includes('2026-09-17.md, line') && n.includes('does not match')));
    checkTrue('and it is not announced twice', notices.filter((n) => n.includes('2026-09-17.md, line')).length === 1);
  }

  console.log('\nThe backlog arrives ordered: priority first, then the day each came from');

  {
    resetNotices();
    const vault = new MockVault();
    vault.seed(
      YESTERDAY_PATH,
      dailyNote({
        tasks: [
          '- [ ] Mirar los discos SSD externos #task ⏬ ➕ 2026-09-10',
          '- [ ] Sin prioridad y sin fecha #task',
          '- [ ] Hablar con Pedro #task 🔺 ➕ 2026-09-15',
          '- [ ] Preparar la práctica #task 🔼 ➕ 2026-09-12',
          '  - [ ] Buscar el enunciado #task',
        ],
      }),
    );
    vault.seed(TODAY_PATH, TEMPLATE_TODAY);
    vault.seed(REMINDERS_FILE, '# Recordatorios\n');
    vault.seed(NOTES_FILE, '# Apuntes\n');

    await startRun(vault);

    const backlog = section(vault.content(TODAY_PATH), BACKLOG);
    const at = (needle: string): number => backlog.findIndex((line) => line.includes(needle));
    checkTrue('the highest priority is written first', at('Hablar con Pedro') === 0);
    checkTrue('the next one down follows it', at('Preparar la práctica') === 1);
    checkTrue('the lowest priority goes after them', at('Mirar los discos') === 3);
    checkTrue('a task with no priority and no date goes last', at('Sin prioridad') === 4);
    checkTrue('and a step stays under the task it belongs to', backlog[2]?.includes('Buscar el enunciado') === true);
  }

  console.log('\nAn important task is carried as a top-priority one');

  {
    resetNotices();
    const vault = new MockVault();
    vault.seed(YESTERDAY_PATH, dailyNote({ tasks: ['- [!] Remitir el acta #task ➕ 2026-09-14'] }));
    vault.seed(TODAY_PATH, TEMPLATE_TODAY);
    vault.seed(REMINDERS_FILE, '# Recordatorios\n');
    vault.seed(NOTES_FILE, '# Apuntes\n');

    await startRun(vault);

    const backlog = section(vault.content(TODAY_PATH), BACKLOG);
    checkTrue('the mark becomes the highest priority', backlog.some((line) => line.includes('- [ ] ⏫ Remitir el acta')));
    checkTrue('and the source keeps the record of it', vault.content(YESTERDAY_PATH).includes('- [>] Remitir el acta'));
  }

  console.log(`\n${checks} checks passed\n`);
}

void main();
