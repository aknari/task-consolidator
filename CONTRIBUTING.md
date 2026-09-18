---
created: 2026-09-12T19:56
updated: 2026-09-18T09:54
---
# Contributing

Thanks for your interest in Task Consolidator.

## Before a big change

Open an issue first and describe the problem. This plugin moves tasks between notes,
so its design principles are not negotiable:

- **A task is never lost.** A task is only removed from its source after it has been
  inserted into the target note.
- **Everything is idempotent.** Running a command twice must produce the same result
  as running it once.
- **Re-read before writing.** The marker block is re-verified immediately before each
  write, so a note edited in between is left untouched.
- **The marker blocks are the contract.** The plugin only touches content between
  `<!-- task-consolidator:…:start -->` and `…:end -->`. A missing pair is skipped; a
  half-present or duplicated pair is a safety error and writes nothing.

Changes that weaken any of those are unlikely to be accepted.

## Setup

```bash
git clone https://github.com/aknari/task-consolidator
cd task-consolidator
npm install
npm run typecheck
npm test
npm run build
npm run deploy      # build, then copy dist/ into the vault's plugin folder
```

`npm run build` writes into `dist/` and nothing outside it, so the repository can live
anywhere. `npm run deploy` is the one that needs a vault: it copies `dist/` and
`manifest.json` into `<vault>/.obsidian/plugins/task-consolidator/` of the vault this
source lives in, or into `OBSIDIAN_PLUGIN_DIR` if you set it.

## Ground rules

- `src/weekly.ts` must not import `obsidian`: calendar maths, the reading of both note
  conventions (marker blocks and legacy `- [>]`), de-duplication and rendering are plain
  functions, which is what makes them testable against real notes without an app.
- Add a case to `test/weekly.test.ts` for any logic you touch. The test runs in plain
  Node, so prefer fixtures that look like real notes.
- Never generate a second `operonId`, and never stamp a created date onto a line that
  already carries structured Operon dates.
- Keep the UI strings in English.

## Testing by hand in Obsidian

1. Put the managed blocks in your daily-note template (see the README).
2. Run `Task Consolidator: Preview daily consolidation` first: it is read-only and
   reports what would move, per source note.
3. Then run the real command and check the source notes as well as today's note.

## Pull requests

1. Fork the repository and create a feature branch.
2. Keep the diff focused; one topic per PR.
3. Make sure `npm run typecheck` and `npm test` pass.
4. Describe what changed and why, and mention how you tested it in Obsidian.

Please be respectful and constructive in all interactions.
