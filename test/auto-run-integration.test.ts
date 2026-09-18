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
 *    keeps its tasks and the Operon reminder keeps its identity.
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

async function startRun(vault: MockVault): Promise<void> {
  const plugin = new (TaskConsolidatorPlugin as unknown as new (app: unknown, manifest: unknown) => any)(
    createApp(vault),
    {},
  );
  await plugin.onload();
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

  console.log(`\n${checks} checks passed\n`);
}

void main();
