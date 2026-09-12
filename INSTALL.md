# Installing Task Consolidator

This plugin is not in Obsidian's community plugin list. Install it manually, from a
release, or with [BRAT](#option-3--brat-auto-updates).

## Requirements

- **Obsidian 1.8.0 or newer**, on desktop.
- **Daily notes named `YYYY-MM-DD.md`, all inside one folder** (default
  `10-journal/daily notes`, configurable).
- **Your daily-note template must contain the managed marker blocks.** Without them the
  plugin reports a safety error and writes nothing — see
  [Managed blocks](README.md#managed-blocks) in the README for the exact list.
- [Operon](https://github.com/hasanyilmaz/operon) is optional. It is detected at
  runtime and every call degrades to a no-op when it is absent.

## Option 1 — From a release (recommended)

1. Download these two files from the [latest release](../../releases/latest):

   | File | Why |
   |---|---|
   | `main.js` | The plugin itself. |
   | `manifest.json` | Identity, version and minimum Obsidian version. |

   There is no `styles.css` for this plugin.

2. Create the folder `.obsidian/plugins/task-consolidator/` inside your vault and copy
   both files into it.
3. In Obsidian: **Settings → Community plugins**, make sure *Restricted mode* is off,
   then enable **Task Consolidator** in the *Installed* tab.

## Option 2 — From source

```bash
git clone https://github.com/aknari/task-consolidator
cd task-consolidator
npm install
npm run typecheck
npm test
npm run build
```

`npm run build` writes `main.js` straight into `.obsidian/plugins/task-consolidator/` of
the repository's **parent** vault. That is why the build assumes the repo lives inside a
vault (for example `<vault>/80-support/task-consolidator/`); if you keep it elsewhere,
copy the built `main.js` and the `manifest.json` next to it into the plugin folder by
hand.

## Option 3 — BRAT (auto-updates)

Install [BRAT](https://github.com/TfTHacker/obsidian42-brat), then run
**BRAT: Add a beta plugin for testing** and enter `aknari/task-consolidator`. BRAT
installs the plugin and keeps it updated from this repository's releases.

## First run

1. Check the settings (**Settings → Task Consolidator**): daily notes folder, archive
   folder, the reminders and notes files, how many previous notes to scan, and whether
   automatic mode should run when today's note is created.
2. Run `Task Consolidator: Preview daily consolidation` from the command palette. It is
   **read-only**: it reports which tasks would move, from which note, and what weekly
   summary would be written.
3. Only then run `Task Consolidator: Consolidate current daily note`.

Automatic mode is on by default, and it only fires for notes created *with* the managed
markers — that is, from your template. Notes created without them never trigger it.

## What it writes, and where

| Path | What |
|---|---|
| Your daily notes | Tasks moved in, and the source line replaced by a non-destructive comment. |
| `10-journal/misc/recordatorios.md` (configurable) | Dated blocks migrated from the reminders section. |
| `10-journal/misc/apuntes.md` (configurable) | Dated blocks migrated from the notes section. |
| `10-journal/archive/old daily notes/` (configurable) | Daily notes archived once the count exceeds the limit. Only used when archiving is enabled. |
| `.obsidian/plugins/task-consolidator/data.json` | The plugin's own settings. |

## Updating

Replace `main.js` with the one from the new release (and check the release notes for
changes to the marker blocks or settings). With BRAT, updates are automatic.

## Uninstalling

Disable the plugin, then delete `.obsidian/plugins/task-consolidator/`.

Two things worth knowing:

- **Uninstalling does not undo any consolidation.** Tasks already moved stay where they
  were moved to.
- The marker comments (`<!-- task-consolidator:… -->`) stay in your notes. They are
  inert, and [Mark Hider](https://github.com/aknari/mark-hider) can hide them from the
  editor if they bother you.
