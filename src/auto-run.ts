/**
 * When the automatic run may start, and whether it still has a live copy in
 * today's note when it does.
 *
 * Both rules live here, outside the plugin class, because they are the part
 * worth testing: the orchestration around them needs the Obsidian app.
 *
 * **Why the wait is not a fixed delay.** A daily note is normally written more
 * than once. The periodic-notes plugin applies the daily template when it
 * creates the note, and a Templater *file template* whose regex matches the
 * note's path (`.*\d{4}-\d{2}-\d{2}.*` matches `…/2026-09-18.md`) applies that
 * same template again a few seconds later. Consolidating between the two writes
 * is how the whole note gets overwritten afterwards: the tasks land, the
 * template writes over them, and the once-per-day guard then stops the plugin
 * from ever putting them back. Measured on a real note: the template's second
 * write arrived 1.2 s after the sources had been marked as moved, and the two
 * tasks and a live Operon reminder were left with no copy anywhere.
 *
 * So the run waits for the note to *settle*, and every further write pushes it
 * back. The ceiling keeps a note you are typing in from postponing it forever.
 *
 * **Why nothing is marked before the note is checked.** The run writes into
 * today's note first and marks the sources as moved afterwards, so a source is
 * never emptied before its task has a home. This module's `survivors` is the
 * last step of that same promise: whatever the run wrote into the note is
 * checked once more before any source is touched, and if the note was rewritten
 * underneath, nothing is marked and the run can simply be repeated.
 */

import { taskKey } from './lines';

/** Quiet time a daily note must show before the automatic run is allowed. */
export const AUTO_SETTLE_MS = 4000;

/** Hard ceiling on waiting, however busy the note is. */
export const AUTO_MAX_WAIT_MS = 40000;

/** Grace period after writing into the note, before the sources are marked. */
export const AUTO_VERIFY_MS = 5000;

/**
 * Milliseconds to wait before running, given when the run was first armed and
 * the current time. Every write to the note re-arms the run, so each call is
 * "how long to wait from now": the settle time, shortened as the ceiling
 * approaches so the wait can never grow past it.
 */
export function autoRunDelay(armedAtMs: number, nowMs: number): number {
  const elapsed = Math.max(0, nowMs - armedAtMs);
  return Math.max(0, Math.min(AUTO_SETTLE_MS, AUTO_MAX_WAIT_MS - elapsed));
}

export interface Survivors {
  /** Task identities the run inserted into today's note and that are gone. */
  missingKeys: string[];
  /** Live lines the run put into today's note and that are gone. */
  missingLines: string[];
}

/**
 * What the run wrote into today's note and is no longer there.
 *
 * Task lines are matched by identity (`taskKey`: the `operonId`, or the
 * normalized text), not by text, so a task that was moved or re-decorated still
 * counts as present. Whole lines are matched verbatim, which is what the
 * migrated reminder lines need: their `{{…}}` fields are the task's identity in
 * Operon, and losing them is exactly what must be noticed.
 */
export function survivors(content: string, keys: string[], lines: string[], taskTag: string): Survivors {
  const noteLines = content.split('\n');
  return {
    missingKeys: keys.filter((key) => !noteLines.some((line) => taskKey(line, taskTag) === key)),
    missingLines: lines.filter((line) => line.trim() !== '' && !content.includes(line)),
  };
}
