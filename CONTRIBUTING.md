# Contributing to Task Consolidator

Thanks for your interest in contributing!

Please be respectful and constructive in all interactions.

- **Open an issue or discussion** before submitting major changes.
- **Fork** the repository and create a feature branch for your work.
- **Submit a pull request** with a clear description of your changes.
- If you have questions, open an issue.

## Development setup

```bash
git clone <repo-url>
cd task-consolidator
npm install
npm run typecheck   # tsc --noEmit
npm run build       # bundles src/main.ts into main.js at the repo root
```

## Testing

There is no automated test suite yet. When you change the consolidation logic,
please verify it manually:

1. Create a daily note for "yesterday" with tasks inside the managed marker
   blocks (see the README).
2. Run *Task Consolidator: Preview daily consolidation* — the preview must
   list the expected moves.
3. Run *Task Consolidator: Consolidate current daily note* and confirm the
   tasks moved and the source notes were updated in place.
4. Re-run the same command — a second run should find nothing to do
   (idempotency).