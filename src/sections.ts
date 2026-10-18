/**
 * Where a task line belongs *inside* one daily note: the day's plan or the
 * backlog.
 *
 * The vault has two managed blocks under two headings — `## Plan del día`, the
 * handwritten plan of the day ordered by clock, and `## Tareas pendientes`, the
 * backlog — and the daily note is the record of that plan. Planning a task
 * happens in the ruler, which only rewrites the line where it stands: it adds
 * the scheduling marks (a `[scheduled:: …]` field, a `⏳` emoji, a leading
 * `h:mm`) and leaves the line in whatever heading section it was in. So the
 * text of the note stops matching the plan it describes.
 *
 * The rule that puts them back together is one line long: a task belongs in the
 * plan **exactly when it is scheduled for this note's own day**, and in the
 * backlog otherwise. No other state is invented and nothing is stored, so the
 * rule is idempotent and reversible by construction: unschedule the task in the
 * ruler (or plan it for another day) and the next pass carries it back.
 *
 * Deliberate limits:
 *
 *  - only `- [ ]` and `- [!]` lines take part. A completed `- [x]` is the
 *    record of what was done, a cancelled `- [-]` waits for rescue, and a `- [>]`
 *    is a tombstone saying the work left the note: moving any of them would
 *    rewrite history, so they stay where they were written.
 *  - a task keeps its indented subtask lines, because a plan that separates a
 *    parent from its steps is worse than one in the wrong section.
 *  - the two blocks are all that is touched. Text outside them, and any other
 *    block, is never read as a task and never rewritten.
 *  - a block that cannot be found unambiguously (no marker pair, or a repeated
 *    one) means the note is left alone, exactly as every other write here does.
 *
 * The section's own layout is preserved: whatever precedes the first task inside
 * a block (its heading, a comment) stays first, and so does whatever follows the
 * last one. Within the plan the tasks are in clock order, all-day lines last;
 * the backlog keeps the order it had, and a task coming back lands at its end —
 * the order you would have given it by hand.
 */
import { scheduledDate, scheduledStartMinutes, stripSchedule, taskKey } from "./lines";

/** A marker-delimited region of a note, as line indexes. */
export interface MarkerBlock {
  start: number;
  end: number;
  content: string;
}

/** The two markers that delimit a managed block. */
export interface MarkerPair {
  start: string;
  end: string;
}

export interface ReconcileOptions {
  plan: MarkerPair;
  /** The block whose heading is `## Tareas pendientes`. */
  tasks: MarkerPair;
  /** The date of the note being reconciled (`YYYY-MM-DD`). */
  noteDate: string;
}

/** A task line and the indented lines that belong to it. */
export interface SectionEntry {
  lines: string[];
  /** The block the entry was read from, which is what the caller reports. */
  from: "plan" | "tasks";
}

export interface BlockParts {
  /** Lines before the first task: the block's heading, a comment, a blank line. */
  head: string[];
  entries: SectionEntry[];
}

export interface ReconcileResult {
  content: string;
  /** Tasks that changed section, by their text, for the report. */
  toPlan: string[];
  toPending: string[];
}

/** A pending or important task line, with its indentation. */
const ELIGIBLE = /^(\s*)- \[[ !]\]/u;

/**
 * The block delimited by a marker pair, or `null` when the note holds no such
 * pair — or more than one of either marker, or the pair in the wrong order. A
 * note the plugin cannot read unambiguously is a note it does not write to.
 */
export function findMarkerBlock(content: string, startMarker: string, endMarker: string): MarkerBlock | null {
  const lines = content.split("\n");
  const starts = lines.reduce<number[]>((found, line, index) => { if (line.trim() === startMarker) found.push(index); return found; }, []);
  const ends = lines.reduce<number[]>((found, line, index) => { if (line.trim() === endMarker) found.push(index); return found; }, []);
  if (starts.length !== 1 || ends.length !== 1 || ends[0] <= starts[0]) return null;
  return { start: starts[0], end: ends[0], content: lines.slice(starts[0] + 1, ends[0]).join("\n") };
}

/**
 * Reads one block into its leading lines and its task entries, each with the
 * lines that belong to it: the indented subtasks below it, and anything else
 * written beside it — a blank separator, a comment, a line that has been
 * completed or cancelled since.
 *
 * Those lines travel with the task they were written next to, and that is the
 * point: ticking a planned task must not make it drift to the bottom of the
 * section, and a hand-written separator must not be left behind by a move.
 */
export function splitBlock(lines: string[], block: MarkerBlock, from: "plan" | "tasks"): BlockParts {
  const head: string[] = [], entries: SectionEntry[] = [];
  let i = block.start + 1;
  while (i < block.end && !ELIGIBLE.test(lines[i])) { head.push(lines[i]); i += 1; }
  while (i < block.end) {
    const match = ELIGIBLE.exec(lines[i]);
    if (match === null) { head.push(lines[i]); i += 1; continue; }
    const indent = match[1].length;
    const entry: SectionEntry = { lines: [lines[i]], from };
    i += 1;
    while (i < block.end) {
      const next = ELIGIBLE.exec(lines[i]);
      if (next !== null && next[1].length <= indent) break;
      entry.lines.push(lines[i]);
      i += 1;
    }
    entries.push(entry);
  }
  return { head, entries };
}

/** Whether the entry is planned for the note's own day. */
function isPlannedToday(entry: SectionEntry, noteDate: string): boolean {
  return scheduledDate(entry.lines[0], noteDate) === noteDate;
}

/** The entry's hour, or `null` for an all-day line. */
function clockOf(entry: SectionEntry): number | null {
  return scheduledStartMinutes(entry.lines[0]);
}

/** Clock order, all-day lines last, and the order they came in for ties. */
function byClock(a: SectionEntry, b: SectionEntry): number {
  const ta = clockOf(a), tb = clockOf(b);
  if (ta === null && tb === null) return 0;
  if (ta === null) return 1;
  if (tb === null) return -1;
  return ta - tb;
}

function text(entry: SectionEntry): string {
  return entry.lines[0].trim();
}

/**
 * The note with every task line in the section it belongs to, or `null` when
 * there is nothing to change — the note is not written then, so a pass that
 * finds everything in place costs nothing.
 *
 * `null` also means the note is not ours to arrange: a missing (or ambiguous)
 * marker pair leaves it untouched, which is what keeps older notes without a
 * plan section working exactly as they did.
 */
/**
 * Whether the only thing that changed between two versions of a note is the
 * scheduling of lines that were already there.
 *
 * That is the ruler's signature: when you plan a task it rewrites *that line*
 * in place — the marks come, the marks go, and it may rebuild the line's
 * decoration (`#task`, a `➕` date) while it is at it — but every line keeps its
 * identity, and no line appears or disappears. Everything a person does at the
 * keyboard looks different: a new line, a deleted one, a renamed task. The
 * automatic reconcile is allowed to act only on the signature, because acting
 * on your typing is how a note gets rewritten while you are writing it.
 *
 * The comparison is deliberately forgiving about decoration and strict about
 * identity: `taskKey` already ignores the managed tag and the `➕` stamp, so the
 * ruler's lossy rebuild still reads as the same task, while a changed word in
 * its text does not.
 */
export function isSchedulingOnlyChange(before: string, after: string, taskTag: string): boolean {
  const a = before.split("\n"), b = after.split("\n");
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === b[i]) continue;
    if (taskKey(stripSchedule(a[i]), taskTag) !== taskKey(stripSchedule(b[i]), taskTag)) return false;
  }
  return true;
}

export function reconcileSections(content: string, options: ReconcileOptions): ReconcileResult | null {
  const plan = findMarkerBlock(content, options.plan.start, options.plan.end);
  const tasks = findMarkerBlock(content, options.tasks.start, options.tasks.end);
  if (plan === null || tasks === null) return null;
  const lines = content.split("\n");
  const planParts = splitBlock(lines, plan, "plan");
  const taskParts = splitBlock(lines, tasks, "tasks");

  const plannedFromTasks: SectionEntry[] = [], plannedFromPlan: SectionEntry[] = [];
  const pendingFromTasks: SectionEntry[] = [], pendingFromPlan: SectionEntry[] = [];
  for (const entry of taskParts.entries) (isPlannedToday(entry, options.noteDate) ? plannedFromTasks : pendingFromTasks).push(entry);
  for (const entry of planParts.entries) (isPlannedToday(entry, options.noteDate) ? plannedFromPlan : pendingFromPlan).push(entry);

  const planned = [...plannedFromPlan, ...plannedFromTasks].sort(byClock);
  const pending = [...pendingFromTasks, ...pendingFromPlan];
  const planBody = [...planParts.head, ...planned.flatMap((entry) => entry.lines)];
  const taskBody = [...taskParts.head, ...pending.flatMap((entry) => entry.lines)];

  // The plan block sits above the backlog in the template, but nothing promises
  // it: the higher range is spliced first so the lower one keeps its indexes.
  const out = lines.slice();
  const edits = [
    { block: plan, body: planBody },
    { block: tasks, body: taskBody },
  ].sort((a, b) => b.block.start - a.block.start);
  for (const edit of edits) out.splice(edit.block.start + 1, edit.block.end - edit.block.start - 1, ...edit.body);

  const reconciled = out.join("\n");
  if (reconciled === content) return null;
  return { content: reconciled, toPlan: plannedFromTasks.map(text), toPending: pendingFromPlan.map(text) };
}
