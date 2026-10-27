/**
 * Marker-audit tests. Run with: npm test
 *
 * The case that matters is the one that happened: a stray character in a
 * closing marker (`…:tasks:endū-->`) made yesterday's tasks block invisible, and
 * the automatic run reported "nothing to consolidate" instead of saying it could
 * not read the note. The audit has to name the line, not repeat the generic
 * "missing marker" twice, and it must leave the plugin's own comments alone.
 */
import { findMarkerProblems, type MarkerPair } from '../src/markers';

const PAIRS: MarkerPair[] = [
  { name: 'tasks', start: '<!-- task-consolidator:tasks:start -->', end: '<!-- task-consolidator:tasks:end -->' },
  { name: 'plan', start: '<!-- task-consolidator:plan:start -->', end: '<!-- task-consolidator:plan:end -->' },
  { name: 'cancelled', start: '<!-- task-consolidator:cancelled:start -->', end: '<!-- task-consolidator:cancelled:end -->' },
  { name: 'reminders', start: '<!-- task-consolidator:reminders:start -->', end: '<!-- task-consolidator:reminders:end -->' },
  { name: 'notes', start: '<!-- task-consolidator:notes:start -->', end: '<!-- task-consolidator:notes:end -->' },
  { name: 'weekly', start: '<!-- task-consolidator:weekly:start -->', end: '<!-- task-consolidator:weekly:end -->' },
];

let failed = 0;
function check(name: string, got: unknown, expected: unknown): void {
  const a = JSON.stringify(got), b = JSON.stringify(expected);
  if (a === b) return;
  failed += 1;
  console.error(`\nFAIL  ${name}\n  got      ${a}\n  expected ${b}`);
}

const CLEAN = [
  '# Nota',
  '<!-- task-consolidator:tasks:start -->',
  '- [ ] una tarea',
  '<!-- task-consolidator:tasks:end -->',
  '<!-- task-consolidator:plan:start -->',
  '<!-- task-consolidator:plan:end -->',
].join('\n');

// --------------------------------------------------------------------------
// A clean note says nothing
// --------------------------------------------------------------------------
check('a note with balanced markers has no problems', findMarkerProblems(CLEAN, PAIRS), []);
check(
  'a note without any managed block has no problems',
  findMarkerProblems('# Nota\n\nTexto suelto.\n', PAIRS),
  [],
);

// --------------------------------------------------------------------------
// The real case: a typed-over closing marker
// --------------------------------------------------------------------------
const TYPO = [
  '# Note',
  '<!-- task-consolidator:tasks:start -->',
  '- [ ] a task',
  '<!-- task-consolidator:tasks:endū-->',
  '<!-- task-consolidator:plan:start -->',
  '<!-- task-consolidator:plan:end -->',
].join('\n');
const typoProblems = findMarkerProblems(TYPO, PAIRS);
check('the typed-over marker is reported once', typoProblems.length, 1);
check('and it is a typo, not a missing pair', typoProblems[0]?.kind, 'typo');
check('with the line that holds it', typoProblems[0]?.line, 4);
check('and the block it names', typoProblems[0]?.block, 'tasks');
check('the message says what it looks like', typoProblems[0]?.message.includes('closing marker of the tasks block'), true);
check('the message says the block is not read', typoProblems[0]?.message.includes('not read'), true);
// The generic "no closing marker" is the same fact, said worse: it stays out.
check('the unpaired message is not repeated alongside the typo', typoProblems.filter((p) => p.kind === 'unpaired').length, 0);

check(
  'a marker with the spacing lost is a typo too',
  findMarkerProblems('<!-- task-consolidator:tasks:start-->\n<!-- task-consolidator:tasks:end -->', PAIRS).map((p) => p.kind),
  ['typo'],
);

// --------------------------------------------------------------------------
// Missing halves and repetitions
// --------------------------------------------------------------------------
check(
  'a start without an end is reported at the start',
  findMarkerProblems('# N\n<!-- task-consolidator:tasks:start -->\n- [ ] a', PAIRS).map((p) => [p.kind, p.line, p.block]),
  [['unpaired', 2, 'tasks']],
);
check(
  'an end without a start is reported at the end',
  findMarkerProblems('# N\n- [ ] a\n<!-- task-consolidator:tasks:end -->', PAIRS).map((p) => [p.kind, p.line, p.block]),
  [['unpaired', 3, 'tasks']],
);
check(
  'a repeated start is reported at the second one',
  findMarkerProblems(
    ['<!-- task-consolidator:tasks:start -->', '- [ ] a', '<!-- task-consolidator:tasks:start -->', '<!-- task-consolidator:tasks:end -->'].join('\n'),
    PAIRS,
  ).map((p) => [p.kind, p.line]),
  [['duplicate', 3]],
);
check(
  'a repeated end is reported at the second one',
  findMarkerProblems(
    ['<!-- task-consolidator:tasks:start -->', '<!-- task-consolidator:tasks:end -->', '<!-- task-consolidator:tasks:end -->'].join('\n'),
    PAIRS,
  ).map((p) => [p.kind, p.line]),
  [['duplicate', 3]],
);
check(
  'an end before its start is reported at the end',
  findMarkerProblems(
    ['<!-- task-consolidator:tasks:end -->', '- [ ] a', '<!-- task-consolidator:tasks:start -->'].join('\n'),
    PAIRS,
  ).map((p) => [p.kind, p.line, p.message.includes('before it opens')]),
  [['unpaired', 1, true]],
);

// --------------------------------------------------------------------------
// What the plugin writes itself is not a problem
// --------------------------------------------------------------------------
check(
  'the moved record and the dated archive markers are left alone',
  findMarkerProblems(
    [
      '<!-- task-consolidator:moved 6 task line(s) to 2026-10-26 -->',
      '<!-- task-consolidator:reminders:2026-10-26 -->',
      '<!-- task-consolidator:notes:2026-10-26 -->',
    ].join('\n'),
    PAIRS,
  ),
  [],
);

// --------------------------------------------------------------------------
// Problems come in line order
// --------------------------------------------------------------------------
const SEVERAL = [
  '<!-- task-consolidator:tasks:endū-->',
  '<!-- task-consolidator:tasks:start -->',
  '<!-- task-consolidator:tasks:start -->',
  '<!-- task-consolidator:tasks:end -->',
].join('\n');
check(
  'problems are sorted by line',
  findMarkerProblems(SEVERAL, PAIRS).map((p) => p.line),
  [1, 3],
);

// --------------------------------------------------------------------------
// Customised markers are the ones that count
// --------------------------------------------------------------------------
const CUSTOM: MarkerPair[] = [
  { name: 'tasks', start: '%% tc:tasks:start %%', end: '%% tc:tasks:end %%' },
];
check(
  'custom markers are read as configured',
  findMarkerProblems('%% tc:tasks:start %%\n- [ ] a\n%% tc:tasks:end %%', CUSTOM),
  [],
);
check(
  'a custom pair with half of it missing is still reported',
  findMarkerProblems('%% tc:tasks:start %%\n- [ ] a', CUSTOM).map((p) => [p.kind, p.block]),
  [['unpaired', 'tasks']],
);

console.log(failed === 0 ? 'markers: all checks passed' : `markers: ${failed} check(s) failed`);
if (failed > 0) process.exit(1);
