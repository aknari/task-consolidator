---
created: 2026-09-01T20:48
updated: 2026-09-18T09:54
---
# Task Consolidator

**Author:** [T. Bautista](https://github.com/aknari)

Consolidate pending and cancelled tasks from your previous daily notes into today's daily note, migrate reminders and miscellaneous notes to dated files, and archive old daily notes — automatically when your daily note is created. Tasks are moved as plain Markdown lines, so nothing depends on a proprietary format.

Works with or without [Operon](https://github.com/hasanyilmaz/operon): task metadata (including `operonId`, `parentTask`, dates and priorities) travels verbatim, so Operon keeps recognizing the same tasks after a move — and nothing is ever left behind claiming an identity that has moved on.

## Features

- **Pending task consolidation (real move).** `- [ ]` and `- [!]` tasks from previous daily notes are moved — not copied — into today's tasks block. The full line is relocated verbatim: a plain task gets the managed tag when it carries none and, if it has no date of its own, a ` ➕ YYYY-MM-DD` stamp with the day it came from; an Operon task is never decorated — its `{{...}}` fields are what keeps it the same task — except for the `{{dateStarted:: YYYY-MM-DD}}` it lacks. The source keeps the line as `- [>]`, the convention the legacy notes already use, with a non-destructive comment saying where the work went and with the Operon metadata removed, so no second line ever claims that `operonId`.
- **The scheduling of a past day is not carried forward.** A task planned for the day it is leaving keeps a mark that pins it to that day — in a time-ruler (or any Dataview) column it would show under the past day instead of today's timeline, and dragging it would be the only way out. A pending task whose own scheduling date is earlier than the day it moves to arrives **unscheduled**, so it shows up in the ruler's unscheduled list to be planned again. That includes a bare `h:mm` prefix: it carries no date because the ruler reads it against the note it lives in, which is exactly what would silently re-plan the task for today once the line moves. Scheduling for today or a later day is left alone, and so is everything else (`due`, `start`, tags, links, Operon `{{...}}`); the `- [>]` left in the source note keeps its scheduling, because that is the record of how the day was planned. Can be turned off. See [Settings](#settings).
- **The day's plan is not the backlog.** A daily note has two sections — `## Plan del día`, the plan in clock order, and `## Tareas pendientes`, the backlog — but planning happens in the ruler, which only rewrites the line where it stands. A task dragged into today's timeline would therefore stay written under `## Tareas pendientes`, and the note would stop matching the plan it describes. With the plan block in the template, a task planned for the note's own day arrives under `## Plan del día` (in clock order, all-day lines last), and one that is not planned for it — unscheduled, or planned for another day — stays in the backlog. Consolidation applies the rule to the lines it carries in, and the note itself is put right a moment after you drag a task in the ruler (or on demand, with *Reconcile the plan and pending sections*). Nothing is stored: the rule is read from the scheduling marks themselves, which is what makes it reversible — un-plan the task, and the next pass carries it back. Where a task goes is not a setting: the plan block's presence is the switch, and a note without it (an older note, or a template not updated yet) behaves exactly as before. The only setting is *when* the rule runs, automatically after a drag or only when you ask.
- **Weekly summary.** When the first daily note of a new week is created, a report of the previous week's daily notes — pending, completed and cancelled tasks — is written into the weekly block. It is deliberately inert (no checkboxes, no task metadata, no task tag), so it is never mistaken for work to consolidate. See [Weekly summary](#weekly-summary).
- **Reminder and note migration.** The `## Para recordar` and `## Apuntes diversos` blocks of the previous note are appended to dated sections in configurable Markdown files, and the most recent reminders are re-injected into today's note. An Operon task among the reminders moves into today's note as the live line — identity and all, plus a `{{dateStarted::}}` when it has none — while the recorded copies (the dated file, and the previous note once the reminder has moved on) keep it as an inert `- [>]` tombstone.
- **Archiving.** Old daily notes are moved to a configurable archive folder (with collision checks) once the daily-note count exceeds a limit.
- **Automatic mode.** When today's daily note is created with the managed markers, consolidation and migration run on their own — once per day, no command needed. It waits for the note to stop changing first, and reports instead of losing tasks if a template writes over it. Can be toggled off.
- **Safety first.** Manual runs offer preview and confirmation; every write re-reads the file just before modifying it; a task is never removed from its source unless it was inserted into today's note first; all operations are idempotent.

## Requirements

- Obsidian 1.8.0 or newer.
- Daily notes named `YYYY-MM-DD.md`, all inside one folder (default `10-journal/daily notes`, configurable).
- Your daily-note template must contain the [managed blocks](#managed-blocks) described below.

## Installation

See **[INSTALL.md](INSTALL.md)** for the release, source and BRAT paths, and for what the plugin writes into your vault.

**Manual install (no build needed):**

1. Create the folder `.obsidian/plugins/task-consolidator/` inside your vault.
2. Copy `main.js` and `manifest.json` from the release into that folder.
3. In Obsidian: **Settings → Community plugins**, make sure Restricted mode is off, and enable **Task Consolidator** in the *Installed* tab.

**From source:**

```bash
npm install
npm run build   # compiles into dist/
npm run deploy  # build, then copy dist/ into .obsidian/plugins/task-consolidator/
```

## Usage

Open the command palette (`Cmd/Ctrl+P`) and use one of:

| Command | Description |
|---|---|
| `Task Consolidator: Preview daily consolidation` | Read-only report of pending and cancelled tasks that would move (per source note) and of the weekly summary that would be written. |
| `Task Consolidator: Consolidate current daily note` | Move pending and cancelled tasks from previous daily notes into today's note, and write the previous week's summary if the weekly block is empty (asks for confirmation). |
| `Task Consolidator: Reconcile the plan and pending sections` | Put today's tasks in the section they belong to: the ones planned for today under `## Plan del día`, in clock order, and the rest in the backlog. Writes only if something changes, and moves nothing else. The same happens by itself after a drag unless the automatic setting is off. |
| `Task Consolidator: Migrate previous daily notes material` | Migrate reminders and notes from the previous daily note into the dated misc files and re-inject recent reminders (asks for confirmation). |
| `Task Consolidator: Archive old daily notes` | Move the oldest daily notes to the archive folder until the configured maximum is kept. |

**Automatic mode** (on by default): when today's daily note is created *with the managed markers* — i.e. created from your template — the plugin runs the migration and consolidation for you, once per day. Notes created without markers never trigger it. Turn it off anytime with the *Run automatically when today's note is created* setting.

The run waits for the note to **settle** rather than firing a fixed time after the first write: every further write pushes it back (up to a ceiling), and once it has written it waits a moment more before marking anything as moved. A new daily note is often written twice — the periodic-notes plugin applies the daily template, and a Templater file template whose rule matches the note's date applies that same template again a few seconds later — and consolidating between the two writes would put the tasks in the note only for the second write to overwrite them. If the note turns out to have been rewritten after all, the plugin marks nothing, tells you, and the previous note keeps its tasks: nothing is lost and the consolidation can simply be repeated.

## Managed blocks

Your daily-note template should include these marker pairs. The plugin only touches content inside them; a duplicated or incomplete marker pair is a safety error (the plugin reports it and writes nothing), while a block you leave out is simply not used:

```markdown
## Plan del día
<!-- task-consolidator:plan:start -->
<!-- task-consolidator:plan:end -->
## Tareas pendientes
<!-- task-consolidator:tasks:start -->
<!-- task-consolidator:tasks:end -->

<!-- task-consolidator:cancelled:start -->
## Tareas canceladas
<!-- task-consolidator:cancelled:end -->

<!-- task-consolidator:reminders:start -->
## Para recordar
<!-- task-consolidator:reminders:end -->

<!-- task-consolidator:notes:start -->
## Apuntes diversos
<!-- task-consolidator:notes:end -->

<!-- task-consolidator:weekly:start -->
## Resumen de la última semana trabajada
<!-- task-consolidator:weekly:end -->
```

- **plan**: the day's plan. A task line belongs here exactly when it is scheduled for this note's own day; the order inside is by clock, all-day lines last. Omitting this block is not an error: the note simply keeps a single section, exactly as it did before the block existed.
- **tasks**: pending tasks to consolidate and the backlog (`- [ ]`, `- [!]`, plus indented subtask lines).
- **cancelled**: destination for carried-forward cancelled tasks (`- [-]`).
- **reminders**: content migrated to the reminders file; recent lines are re-injected into today's note.
- **notes**: content migrated to the notes file.
- **weekly**: destination for the generated weekly summary. The heading lives *inside* the markers and is the one the report carries over, so rename it there and the plugin will use it. Notes created before you added this block are simply skipped (a missing marker pair is never an error; only a half-present pair is).

## Plan del día and the backlog

The two sections are the same list at two moments: what you mean to do today, and what is waiting. The rule that keeps them apart is one line long — **a task belongs in the plan exactly when it is scheduled for this note's own day** — and it is read from the scheduling marks themselves (`[scheduled:: …]` with an hour, a `⏳` date, a leading `h:mm`, `[date::]`, `@{…}`): the notations the ruler writes, and the same ones the rest of this plugin already has to understand.

- **Both directions.** Un-planning is as ordinary as planning: drag the task back to *Unscheduled*, or plan it for another day, and the next pass returns it to the backlog — at its end, the place you would have given it.
- **Clock order, all-day last.** The plan is written in the order you read it; the backlog keeps the order it had.
- **Your typing is never rearranged.** The automatic pass only recognises the ruler's own footprint — the same lines, with and without scheduling. A task you type by hand, wherever you type it, stays where you put it; it moves to the plan when you plan it in the ruler, not because a rule was applied to your draft.
- **A task keeps what was written beside it.** Its indented subtasks travel with it, and so does a blank separator or a line you completed since: ticking a planned task does not make it drift to the bottom of the section.
- **What is never moved.** Only `- [ ]` and `- [!]` lines take part. `- [x]` is the record of what was done, `- [-]` waits for rescue and `- [>]` is a tombstone saying the work left the note; moving any of them would rewrite history. Text outside the two blocks is never read as a task, and an ambiguous marker pair leaves the note alone.
- **After a drag, once the note settles.** With *Reconcile the plan automatically after planning* on (the default) the rule also runs by itself: when today's note is written — the ruler's write when you drop a task — the plugin waits for the note to stop changing (about 2 s) and then moves the line. It only acts on **a change of scheduling**: the ruler rewrites a line in place, so every line keeps its identity, while a line you type, delete or rename is a change of the note's content — that one is yours, and the move waits for the command. A move that would change nothing is never written, so the plugin's own write cannot start a run of its own. Turn the setting off to keep the manual command only.
- **No setting decides where a task goes.** The plan block's presence is the switch for the split — a note without one is never rearranged — and with it the rule above is the only criterion. The one setting there is (*Reconcile the plan automatically after planning*) decides only *when* it runs.

## Weekly summary

When the **first daily note of a new ISO week** is created (i.e. the previous daily note belongs to an earlier week), the plugin writes a summary of **that previous week's daily notes** into the weekly block. It never sweeps the whole vault: only the notes of that week are read, which is also why "the last week you actually worked on" can be a week you only opened one note in.

```markdown
Semana 37 de 2026 · 2026-09-07 a 2026-09-13 · notas: 2026-09-07, 2026-09-09, 2026-09-10

**Pendientes (4)**
- Pasar palabras al #amawal del chat y otras (➕ 2024-12-17)
- Lisa: Mirar [[Apuntes de desarrollo]] y [[Notas sobre Lisa]] (➕ 2025-02-24)

**Completadas (1)**
- Preguntar si la extensión -1275 sigue libre #si-ulpgc (✅ 2026-09-10)

**Canceladas (0)**
(ninguna)
```

Design decisions worth knowing:

- **It is a report, not tasks.** Lines carry no checkbox, no `{{...}}` metadata (copying `operonId` would duplicate an Operon identity) and no task tag, so nothing in the summary is ever consolidated.
- **Written once, into an untouched block.** The block counts as untouched while it holds nothing but its heading and blank lines — the template's section title. That is how the plugin knows your heading (and carries it over) and how it avoids ever overwriting a summary, or text you wrote, later in the week.
- **The empty section does not linger.** The template produces that heading on *every* daily note, so whenever no report is due — the other days of the week, **or this setting turned off** — the untouched placeholder is emptied. The section title therefore appears exactly on the notes that have a report to show, and turning the feature off cannot leave empty headings behind. Emptying is the only thing the plugin does then: no report is ever written while the setting is off.
- **Your content wins.** Emptying happens only for a placeholder (its heading and blank lines). A summary already written, or any text you put in the block yourself, is never emptied and never overwritten.
- **Before the move, on purpose.** On the automatic path the summary is built *before* consolidation, because consolidation moves the pending tasks out of the previous week's notes; reading them afterwards would report "no pending tasks" for a week that did leave some open.
- **Completed tasks stay where they were ticked.** They are never moved, so a completed line is read from whichever note holds it, and the note is reported when it differs from the task's `✅` stamp — e.g. `(✅ 2026-09-04 · en 2026-09-02)`.
- **De-duplicated by text.** The same task carried forward through several notes of the week is reported once. Without this, legacy weeks inflated by ~40 %, because the old workflow copied tasks forward and marked the source with `[>]` — which is also what this plugin leaves behind.
- **A task's state is the last one really written down.** Every move leaves `- [>]` behind, and that mark says *the line moved*, not what became of the work, so it never becomes a state while a real mark survives in the week: a task pending on Monday and ticked on Wednesday is reported under **Completadas**, not under **Pendientes**. A `[>]` decides only when the week has no real mark left for a task, and then its block is what speaks — carried out of the tasks block the work left as pending, out of the canceladas block it left as cancelled. (The one case this cannot tell apart: a task cancelled *inside the tasks block* on the last note of the week and only carried forward afterwards, because the tombstone no longer records which block it was cancelled from.)
- **Both conventions are read.** Modern notes (this plugin's marker blocks) and legacy notes: no markers, `## Tareas canceladas` used as a dumping ground for `[x]` completions, and `- [>]` as the "already carried forward" mark — a legacy pending task whose only mark of the week is that tombstone is still reported as pending, by the rule above. A `[x]` is always a completed task, never a cancelled one.
- **Undated lines are labelled as such.** A `[x]` with no `✅` stamp is reported `(sin fecha · en <note>)` instead of being silently counted as done that week.

The manual commands have no week gate (you asked for it): they write the summary into an untouched block, which is the way to test it or to recover a note created before the feature was enabled.

## Settings

| Setting | Default | Description |
|---|---|---|
| Daily notes folder | `10-journal/daily notes` | Folder containing `YYYY-MM-DD.md` notes. |
| Archive folder | `10-journal/archive/old daily notes` | Destination for archived daily notes. |
| Reminders file | `10-journal/misc/recordatorios.md` | Markdown file receiving dated reminder blocks. |
| Notes file | `10-journal/misc/apuntes.md` | Markdown file receiving dated notes blocks. |
| Previous notes to scan | `14` | How many previous daily notes (not days) to review for tasks (3–30). |
| Maximum daily notes | `10` | How many daily notes to keep before archiving the oldest (3–30). |
| Automatic archiving | off | Archive old daily notes automatically after each consolidation. |
| Weekly summary of the previous week | on | Write the previous week's summary into the weekly block when the first daily note of a new week is created. Written only into an untouched block; when no report is due (including when this is off), an untouched block is emptied. |
| Weekly summary language | `es` | Language of the summary text (`es` / `en`). Task lines are copied verbatim. |
| Run automatically when today's note is created | on | Run migration + consolidation once per day when today's note is created with markers. |
| Reconcile the plan automatically after planning | on | Move a task to `## Plan del día` (or back to the backlog) once today's note has been quiet for about 2 s after a write — which is what the ruler does when you drag a task. Off: only the command moves tasks. |
| Include cancelled tasks | on | Carry `- [-]` tasks into today's cancelled block. Completed tasks are never moved. |
| Task tag | `#task` | Tag appended to migrated *plain* task lines that do not carry it yet. Operon tasks are never tagged. Empty = add no tag. |
| Carry the source date onto migrated tasks | on | Record the day a migrated task came from on the line carried into today's note: a plain task gets ` ➕ YYYY-MM-DD` (unless it already has a ` ➕` date) and an Operon task with no start date gets `{{dateStarted:: YYYY-MM-DD}}`. Tasks that already carry their own date are left untouched. |
| Clear the scheduling of an earlier day | on | Drop the scheduling marks of an earlier day from a migrated pending task — the parent and any indented subtask (time-ruler's `⏳ YYYY-MM-DD`, `[scheduled:: …]`, `[date:: …]`, `[startTime::]`, `[endTime::]`, `[allDay::]`, `[duration::]`, `@{…}`, and the leading `h:mm - h:mm`, which counts as an earlier day because it means the day of the note it came from) — so the task arrives unscheduled and can be planned again. Scheduling for today or later is kept, as are `due`, `start`, tags, links and the Operon `{{...}}` fields; the `- [>]` left in the source note keeps the scheduling as the record. |
| Migrate miscellaneous notes | on | Migrate the notes block to the notes file. |
| Migrate reminders | on | Migrate the reminders block and re-inject recent reminders. |
| Recent reminders | `9` | How many recent reminder lines to re-inject into today's note. |
| Refresh Operon index after consolidating | off | Run Operon's read-only "Rebuild full index" after each consolidation (safety net; normally unnecessary). |

## Safety model

- Preview first, then a confirmation modal before any multi-file change (manual commands).
- Every write re-reads the file and re-verifies the marker block immediately before modifying, so a note edited between planning and applying is left untouched.
- Today's note is written before the sources. A mid-way failure leaves a duplicate that later runs converge — never a lost task.
- Nothing is deleted on the way out: a line that has been carried forward stays in place as `- [>]`, keeping its text as the record of what the note held. A tombstone carries no Operon metadata on purpose — one identity may live in exactly one line. It keeps its scheduling too: that mark says how the day it came from was planned, the ruler does not read `- [>]` lines, and rewriting it into another notation would only leave a phantom plan next to the live copy.
- Operations are idempotent: running twice produces the same result (the second run finds nothing to do).
- Automatic mode is limited to notes that carry the managed markers, runs at most once per day, and never removes a task from its source unless the insertion into today's note succeeded.
- The automatic run waits for today's note to settle (4 s of quiet, and at most 40 s of waiting) before it starts, so it lands after the last writer. A short delay after the run checks once more that the note still holds what was written into it; if it does not, nothing is marked as moved, you are told, and the previous note keeps its tasks — an automatic run can therefore never be the reason a task exists nowhere.
- The automatic reconcile acts only when the note's change is a change of scheduling (the ruler's signature), never on a line you typed, deleted or renamed; it then waits until today's note has been quiet for about 2 s, re-reads it, and writes only when the move would change something — so a drag is followed by exactly one write, never a run of them. If the note changes while it is deciding, the automatic path gives up instead of rearranging a version it never saw.
- The weekly summary is written only into an untouched weekly block (its heading and blank lines, or nothing), so an existing summary is never overwritten.

## Operon integration

Operon is **optional** — the plugin is a Markdown processor and works with plain checkboxes.

- **Detection.** The plugin reads the live `operon` plugin instance and checks for its documented API surface (duck-typed; no npm dependency).
- **Identity preservation.** Task lines are moved verbatim, including `operonId`, `parentTask`, dates, priorities and dependencies. Operon's Calendar, Kanban and dependency views keep referencing the same task. The plugin never generates a second `operonId`, and never copies one either:
  - an Operon task is never tagged and never receives a ` ➕` date — its structured dates (`{{datetimeCreated::}}`, …) are its own;
  - a migrated pending Operon task with no start date receives `{{dateStarted:: YYYY-MM-DD}}`, placed where Operon writes it, so work carried forward from an old note does not look like it was born today. A task that already has a start date is left untouched;
  - a task's identity is its `operonId` and nothing else, so de-duplication and "already in today's note" are decided by id. A task that is already anywhere in today's note — its reminders block included — is never inserted a second time;
  - what stays behind is a tombstone without Operon metadata, so the `operonId` is claimed by exactly one line. If an old note still holds a second copy of a task, that copy is tombstoned and today's note keeps the only live line.
- **Index freshness.** Operon's index self-maintains from vault events, so nothing is usually needed. If you want a safety net, enable *Refresh Operon index after consolidating* to run Operon's read-only *Rebuild full index* after each consolidation.
- **No grants required.** Only grant-free discovery is used. If Operon is absent, disabled or not ready, every Operon call degrades to a benign no-op.

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # the weekly summary, the line helpers and the section rule (no Obsidian required)
npm run build       # bundles src/main.ts into dist/
npm run deploy      # build, then copy dist/ into .obsidian/plugins/task-consolidator/
```

The weekly engine (`src/weekly.ts`) has no Obsidian dependency on purpose: calendar maths, the reading of both note conventions, de-duplication and rendering are plain functions, so they can be tested against real notes without an app.

## License

MIT © [T. Bautista](https://github.com/aknari). See [LICENSE](LICENSE).
