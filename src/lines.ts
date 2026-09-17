/**
 * Line transformations shared by the two migration paths.
 *
 * Pure string-in/string-out helpers, deliberately free of Obsidian imports so
 * they can be unit tested (the plugin's orchestration lives inside a Plugin
 * class and needs the app).
 *
 * Three rules live here, and they have to agree with each other:
 *
 *  - **Plain tasks travel decorated.** The managed tag is appended when the
 *    line does not carry it yet, and a ` ➕ YYYY-MM-DD` stamp records the day
 *    the task came from, unless the line has a ` ➕` date of its own.
 *  - **Operon tasks travel intact.** Their `{{...}}` fields are what keeps them
 *    the same task in Operon's Calendar, Kanban and dependencies, so they are
 *    moved verbatim. The single addition is `{{dateStarted:: YYYY-MM-DD}}` on a
 *    migrated *pending* task that has no start date, so work carried forward
 *    from an old note does not look like it was born today.
 *  - **What is left behind is a tombstone.** A line that has been carried
 *    forward stays in its source note as `- [>]` — the convention the legacy
 *    notes and the old Python script already use — with the text kept as the
 *    record and the Operon `{{...}}` fields removed. Dropping them is the whole
 *    point: a tombstone that kept an `operonId` would be a second line claiming
 *    one identity, which is the duplicate Operon can only resolve by hand.
 */

export interface LineOptions {
  /** Tag appended to migrated plain tasks (`#task` by default). Empty adds none. */
  taskTag: string;
  /** Whether a migrated task records the day it came from (see the file header). */
  stampCreatedDate: boolean;
}

/** Operon fields that canonically precede `dateStarted`. */
const BEFORE_DATE_STARTED = ["operonId", "status", "priority", "dateDue", "dateScheduled"] as const;

/** A `{{key:: value}}` container. Values are not expected to hold braces. */
const OPERON_FIELD = /\{\{\s*([^{}]*?)\s*::\s*([^{}]*?)\s*\}\}/gu;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The task's Operon identity, or `null` when the line carries none. */
export function operonId(line: string): string | null {
  const match = /\{\{\s*operonId\s*::\s*([^{}]*?)\s*\}\}/u.exec(line);
  return match === null ? null : match[1].trim();
}

/** Whether the line is an Operon task (it carries an `operonId`). */
export function isOperonLine(line: string): boolean {
  return operonId(line) !== null;
}

/** Whether the line already carries a given Operon field. */
export function hasOperonField(line: string, key: string): boolean {
  return new RegExp(`\\{\\{\\s*${escapeRegExp(key)}\\s*::`, "u").test(line);
}

/** Every `{{key:: value}}` container in the line, key lowercased, with its end offset. */
function fieldSpans(line: string): Array<{ key: string; end: number }> {
  const spans: Array<{ key: string; end: number }> = [];
  OPERON_FIELD.lastIndex = 0;
  for (let match = OPERON_FIELD.exec(line); match !== null; match = OPERON_FIELD.exec(line)) {
    spans.push({ key: match[1].toLowerCase(), end: match.index + match[0].length });
  }
  return spans;
}

/**
 * Inserts `{{key:: value}}` at its canonical position: after the last field of
 * `before` the line actually carries, following `before`'s own order. The order
 * is what decides, not where the fields happen to sit — a line whose dates are
 * out of order still gets the new field where Operon would write it.
 */
export function insertOperonField(line: string, key: string, value: string, before: readonly string[]): string {
  const spans = fieldSpans(line);
  let at = -1;
  for (const name of before) {
    const span = spans.find((candidate) => candidate.key === name.toLowerCase());
    if (span !== undefined) at = span.end;
  }
  const field = `{{${key}:: ${value}}}`;
  if (at < 0) return `${line.trimEnd()} ${field}`;
  return `${line.slice(0, at)} ${field}${line.slice(at)}`;
}

/**
 * Gives a migrated pending Operon task a start date when it has none. A task
 * that already carries `{{dateStarted}}`, or one that is not pending (a
 * cancelled `- [-]`, a completed `- [x]`), is returned untouched: only pending
 * work is decorated, the same rule the plain-task stamp follows.
 */
export function stampOperonStart(line: string, date: string): string {
  if (!isOperonLine(line) || hasOperonField(line, "dateStarted")) return line;
  if (!/^\s*- \[[ !]\]/u.test(line)) return line;
  return insertOperonField(line, "dateStarted", date, BEFORE_DATE_STARTED);
}

/** Whether the given standalone tag token appears in the line. */
export function tagPresent(line: string, tag: string): boolean {
  return new RegExp(`(^|\\s)${escapeRegExp(tag)}(?!\\S)`, "u").test(line);
}

/**
 * Canonical form of a *plain* task line, used for comparisons and as its key:
 * `- [!]` becomes `- [ ]`, the managed tag and any ` ➕ YYYY-MM-DD` stamp are
 * dropped, whitespace is collapsed. Decorated and undecorated copies of the
 * same task therefore compare equal, whether the stamp came from this plugin or
 * was written by hand.
 */
export function normalizeTaskLine(line: string, taskTag: string): string {
  let normalized = line.replace(/- \[!\]/u, "- [ ]");
  if (taskTag !== "") normalized = normalized.replace(new RegExp(`(^|\\s)${escapeRegExp(taskTag)}(?!\\S)`, "gu"), "$1");
  normalized = normalized.replace(/\s*➕\s*\d{4}-\d{2}-\d{2}/gu, "");
  return normalized.trimEnd().replace(/\s+/gu, " ");
}

/**
 * The identity of a task line, which is what de-duplication and "already in
 * today's note" both mean:
 *
 *  - an Operon task is its `operonId`, and nothing else. Its text, its dates
 *    and its `{{datetimeModified}}` change while you work, so comparing those
 *    would let the same task through twice and duplicate the id;
 *  - a plain task is its normalized text.
 */
export function taskKey(line: string, taskTag: string): string {
  const id = operonId(line);
  return id !== null ? `operon:${id}` : normalizeTaskLine(line, taskTag);
}

/**
 * Prepares a migrated pending line for insertion into today's note: `- [!]`
 * becomes `- [ ]`, plain tasks get the managed tag and the source-date stamp,
 * and Operon tasks keep their fields — plus a start date when they have none.
 */
export function prepareMigratedLine(line: string, sourceDate: string, options: LineOptions): string {
  const prepared = line.replace(/- \[!\]/u, "- [ ]").trimEnd();
  if (isOperonLine(prepared)) return options.stampCreatedDate ? stampOperonStart(prepared, sourceDate) : prepared;
  const braceIdx = prepared.indexOf("{{");
  const hasBraces = braceIdx >= 0;
  const parts: string[] = [];
  const tag = options.taskTag.trim();
  if (tag !== "" && !tagPresent(prepared, tag)) parts.push(tag);
  if (options.stampCreatedDate && !/\s*➕\s*\d{4}-\d{2}-\d{2}/u.test(prepared)) parts.push(`➕ ${sourceDate}`);
  if (parts.length === 0) return prepared;
  const head = hasBraces ? prepared.slice(0, braceIdx).trimEnd() : prepared;
  const tail = hasBraces ? prepared.slice(braceIdx).trimStart() : "";
  const suffix = parts.map((part) => ` ${part}`).join("");
  return tail === "" ? `${head}${suffix}` : `${head}${suffix} ${tail}`;
}

/**
 * The line a source note keeps in place of a task that has been carried
 * forward: `- [>]`, keeping the text (tags, `➕` date, wikilinks — the record of
 * what was there) and dropping the Operon `{{...}}` fields, so the tombstone is
 * no longer a task and no longer claims an identity.
 */
export function tombstoneLine(line: string): string {
  return line
    .replace(/^(\s*)- \[[^\]\n]\]/u, "$1- [>]")
    .replace(/\s*\{\{[^{}]*::[^{}]*\}\}/gu, "")
    .replace(/\s+$/u, "");
}

/**
 * Tombstones only the Operon lines of a block. The recorded copies — the
 * previous daily note and the dated file a reminder is archived into — must
 * never hold a second live copy of an Operon task, but plain Markdown lines are
 * left exactly as they were written.
 */
export function tombstoneOperonLines(block: string): string {
  return block
    .split("\n")
    .map((line) => (isOperonLine(line) ? tombstoneLine(line) : line))
    .join("\n");
}
