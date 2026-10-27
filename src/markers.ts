/**
 * What is wrong with the managed markers in one note.
 *
 * A block is read only when both of its markers are present, exactly once and
 * in order (see `findMarkerBlock`). Anything else makes the block invisible to
 * every run: the tasks in it are never carried forward, and the material in it
 * is never migrated. The outcome is safe — nothing is written from a note the
 * plugin cannot read — but it is silent, and a run that read nothing looks
 * exactly like a run with nothing to do.
 *
 * The case that started this: a marker line with a stray character,
 * `<!-- task-consolidator:tasks:endū-->`, written by accident while editing the
 * note. The line no longer matches the configured string, so the block has an
 * opening marker and no closing one. `findMarkerProblems` says so, and names the
 * line, which is what a notice and the status bar need.
 *
 * The typo check is a heuristic on purpose: it only looks at comment-shaped
 * lines that carry the plugin's prefix, and it whitelists the two comment
 * families the plugin writes itself — the `moved …` record and the dated
 * markers of the archive files — so nothing legitimate is reported.
 */

/** A managed block, as the settings name it. */
export interface MarkerPair {
  name: string;
  start: string;
  end: string;
}

export type MarkerProblemKind = "unpaired" | "duplicate" | "typo";

export interface MarkerProblem {
  kind: MarkerProblemKind;
  /** The block the problem belongs to; for a typo, the block the line names. */
  block: string | null;
  /** 1-based line number in the note. */
  line: number;
  /** The offending line, trimmed. */
  text: string;
  /** One sentence, ready for a notice or a tooltip. */
  message: string;
}

/** A comment that starts like a start/end marker, however it ends. */
const MARKER_SHAPE = /^<!--\s*task-consolidator:([a-z-]+):(start|end)/iu;
/** The record the plugin leaves in a source note after moving tasks out. */
const MOVED_COMMENT = /^<!--\s*task-consolidator:moved\b.*-->$/u;
/** The dated marker of the archive files (`recordatorios.md`, `apuntes.md`). */
const DATED_MARKER = /^<!--\s*task-consolidator:[a-z-]+:\d{4}-\d{2}-\d{2}\s*-->$/u;

function lineIndexes(lines: string[], marker: string): number[] {
  const found: number[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim() === marker) found.push(index);
  }
  return found;
}

/**
 * Every marker problem in `content`, in line order.
 *
 * A note that simply has no block of a kind is not a problem: older notes
 * predate the markers, and sources are read for whatever blocks they hold. Only
 * a *broken* pair — half of it, a repeated half, the halves in the wrong order —
 * and a line that only looks like a marker are reported.
 */
export function findMarkerProblems(content: string, pairs: MarkerPair[]): MarkerProblem[] {
  const lines = content.split("\n");
  const exact = new Set<string>();
  for (const pair of pairs) {
    exact.add(pair.start);
    exact.add(pair.end);
  }

  const problems: MarkerProblem[] = [];
  /** Sides (`block:side`) a typo already accounts for, so the generic missing-marker message is not repeated. */
  const typoSides = new Set<string>();

  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (!line.includes("task-consolidator:")) return;
    if (exact.has(line) || MOVED_COMMENT.test(line) || DATED_MARKER.test(line)) return;
    const match = MARKER_SHAPE.exec(line);
    if (match === null) return;
    const block = match[1];
    const side = match[2].toLowerCase() === "start" ? "start" : "end";
    typoSides.add(`${block}:${side}`);
    problems.push({
      kind: "typo",
      block,
      line: index + 1,
      text: line,
      message: `looks like the ${side === "start" ? "opening" : "closing"} marker of the ${block} block, but it does not match, so that block is not read`,
    });
  });

  for (const pair of pairs) {
    const starts = lineIndexes(lines, pair.start);
    const ends = lineIndexes(lines, pair.end);
    if (starts.length > 1) {
      problems.push({
        kind: "duplicate",
        block: pair.name,
        line: starts[1] + 1,
        text: lines[starts[1]].trim(),
        message: `opens the ${pair.name} block a second time; a repeated marker means the block is not read`,
      });
    }
    if (ends.length > 1) {
      problems.push({
        kind: "duplicate",
        block: pair.name,
        line: ends[1] + 1,
        text: lines[ends[1]].trim(),
        message: `closes the ${pair.name} block a second time; a repeated marker means the block is not read`,
      });
    }
    if (starts.length === 1 && ends.length === 0 && !typoSides.has(`${pair.name}:end`)) {
      problems.push({
        kind: "unpaired",
        block: pair.name,
        line: starts[0] + 1,
        text: lines[starts[0]].trim(),
        message: `opens the ${pair.name} block but there is no closing marker, so the block is not read`,
      });
    }
    if (ends.length === 1 && starts.length === 0 && !typoSides.has(`${pair.name}:start`)) {
      problems.push({
        kind: "unpaired",
        block: pair.name,
        line: ends[0] + 1,
        text: lines[ends[0]].trim(),
        message: `closes the ${pair.name} block but there is no opening marker, so the block is not read`,
      });
    }
    if (starts.length === 1 && ends.length === 1 && ends[0] < starts[0]) {
      problems.push({
        kind: "unpaired",
        block: pair.name,
        line: ends[0] + 1,
        text: lines[ends[0]].trim(),
        message: `closes the ${pair.name} block before it opens, so the block is not read`,
      });
    }
  }

  return problems.sort((a, b) => a.line - b.line || a.message.localeCompare(b.message));
}
