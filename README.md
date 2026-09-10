# Task Consolidator

**Author:** [T. Bautista](https://github.com/aknari)

Consolidate pending and cancelled tasks from your previous daily notes into today's daily note, migrate reminders and miscellaneous notes to dated files, and archive old daily notes — automatically when your daily note is created. Tasks are moved as plain Markdown lines, so nothing depends on a proprietary format.

Works with or without [Operon](https://github.com/hasanyilmaz/operon): task metadata (including `operonId`, `parentTask`, dates and priorities) travels verbatim, so Operon keeps recognizing the same tasks after a move.

## Features

- **Pending task consolidation (real move).** `- [ ]` and `- [!]` tasks from previous daily notes are moved — not copied — into today's tasks block. The full line (including any `{{...}}` metadata) is relocated verbatim — with the managed task tag added to the parent line when missing and, for plain tasks without dates of their own, a ` ➕ YYYY-MM-DD` created-date stamp — and the source is replaced by a non-destructive comment. No second `operonId` is ever generated.
- **Cancelled task carry-forward.** Tasks marked `- [-]` are moved into today's `## Tareas canceladas` block, so discarded tasks keep following you in case you want to rescue them. Completed tasks (`- [x]`) are never moved.
- **Reminder and note migration.** The `## Para recordar` and `## Apuntes diversos` blocks of the previous note are appended to dated sections in configurable Markdown files, and the most recent reminders are re-injected into today's note.
- **Archiving.** Old daily notes are moved to a configurable archive folder (with collision checks) once the daily-note count exceeds a limit.
- **Automatic mode.** When today's daily note is created with the managed markers, consolidation and migration run on their own — once per day, no command needed. Can be toggled off.
- **Safety first.** Manual runs offer preview and confirmation; every write re-reads the file just before modifying it; a task is never removed from its source unless it was inserted into today's note first; all operations are idempotent.

## Requirements

- Obsidian 1.8.0 or newer.
- Daily notes named `YYYY-MM-DD.md`, all inside one folder (default `10-journal/daily notes`, configurable).
- Your daily-note template must contain the [managed blocks](#managed-blocks) described below.

## Installation

**Manual install (no build needed):**

1. Create the folder `.obsidian/plugins/task-consolidator/` inside your vault.
2. Copy `main.js` and `manifest.json` from the release into that folder.
3. In Obsidian: **Settings → Community plugins**, make sure Restricted mode is off, and enable **Task Consolidator** in the *Installed* tab.

**From source:**

```bash
npm install
npm run build   # compiles and copies main.js into .obsidian/plugins/task-consolidator/
```

## Usage

Open the command palette (`Cmd/Ctrl+P`) and use one of:

| Command | Description |
|---|---|
| `Task Consolidator: Preview daily consolidation` | Read-only report of pending and cancelled tasks that would move, per source note. |
| `Task Consolidator: Consolidate current daily note` | Move pending and cancelled tasks from previous daily notes into today's note (asks for confirmation). |
| `Task Consolidator: Migrate previous daily notes material` | Migrate reminders and notes from the previous daily note into the dated misc files and re-inject recent reminders (asks for confirmation). |
| `Task Consolidator: Archive old daily notes` | Move the oldest daily notes to the archive folder until the configured maximum is kept. |

**Automatic mode** (on by default): when today's daily note is created *with the managed markers* — i.e. created from your template — the plugin runs the migration and consolidation for you, once per day. Notes created without markers never trigger it. Turn it off anytime with the *Run automatically when today's note is created* setting.

## Managed blocks

Your daily-note template should include these marker pairs. The plugin only touches content inside them; a missing, duplicated or incomplete marker pair is a safety error (the plugin reports it and writes nothing):

```markdown
<!-- task-consolidator:tasks:start -->
## Plan del día
## Tareas pendientes
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
```

- **tasks**: pending tasks to consolidate (`- [ ]`, `- [!]`, plus indented subtask lines).
- **cancelled**: destination for carried-forward cancelled tasks (`- [-]`).
- **reminders**: content migrated to the reminders file; recent lines are re-injected into today's note.
- **notes**: content migrated to the notes file.

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
| Run automatically when today's note is created | on | Run migration + consolidation once per day when today's note is created with markers. |
| Include cancelled tasks | on | Carry `- [-]` tasks into today's cancelled block. Completed tasks are never moved. |
| Task tag | `#task` | Tag appended to migrated pending task lines that do not carry it yet. Empty = add no tag. |
| Stamp created date on plain tasks | on | Append ` ➕ YYYY-MM-DD` (the date of the daily note the task came from) to migrated pending tasks that have no Operon metadata and no ` ➕` date yet. Operon tasks and lines that already carry a ` ➕` date are left untouched. |
| Migrate miscellaneous notes | on | Migrate the notes block to the notes file. |
| Migrate reminders | on | Migrate the reminders block and re-inject recent reminders. |
| Recent reminders | `9` | How many recent reminder lines to re-inject into today's note. |
| Refresh Operon index after consolidating | off | Run Operon's read-only "Rebuild full index" after each consolidation (safety net; normally unnecessary). |

## Safety model

- Preview first, then a confirmation modal before any multi-file change (manual commands).
- Every write re-reads the file and re-verifies the marker block immediately before modifying, so a note edited between planning and applying is left untouched.
- Today's note is written before the sources. A mid-way failure leaves a duplicate that later runs converge — never a lost task.
- Operations are idempotent: running twice produces the same result (the second run finds nothing to do).
- Automatic mode is limited to notes that carry the managed markers, runs at most once per day, and never removes a task from its source unless the insertion into today's note succeeded.

## Operon integration

Operon is **optional** — the plugin is a Markdown processor and works with plain checkboxes.

- **Detection.** The plugin reads the live `operon` plugin instance and checks for its documented API surface (duck-typed; no npm dependency).
- **Identity preservation.** Task lines are moved verbatim, including `operonId`, `parentTask`, dates, priorities and dependencies. Operon's Calendar, Kanban and dependency views keep referencing the same task. The plugin never generates a second `operonId`. Migration may append the managed task tag (`#task` by default) to the parent line, but never stamps a ` ➕` date onto Operon tasks — they keep their structured dates (`{{dateStarted::}}`, `{{datetimeCreated::}}`, …). Only plain Markdown tasks without their own dates receive the created-date stamp.
- **Index freshness.** Operon's index self-maintains from vault events, so nothing is usually needed. If you want a safety net, enable *Refresh Operon index after consolidating* to run Operon's read-only *Rebuild full index* after each consolidation.
- **No grants required.** Only grant-free discovery is used. If Operon is absent, disabled or not ready, every Operon call degrades to a benign no-op.

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit
npm run build       # bundles src/main.ts into .obsidian/plugins/task-consolidator/main.js
```

## License

MIT © [T. Bautista](https://github.com/aknari). See [LICENSE](LICENSE).
