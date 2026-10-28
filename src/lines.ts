/**
 * Line transformations shared by the two migration paths.
 *
 * Pure string-in/string-out helpers, deliberately free of Obsidian imports so
 * they can be unit tested (the plugin's orchestration lives inside a Plugin
 * class and needs the app).
 *
 * Four rules live here, and they have to agree with each other:
 *
 *  - **Plain tasks travel decorated.** The managed tag is written when the
 *    line does not carry it yet, at the start of the task text by default — the
 *    place the Tasks plugin puts it when it creates a task — or at the end if
 *    the settings say so. A ` ➕ YYYY-MM-DD` stamp records the day the task came
 *    from, unless the line has a ` ➕` date of its own.
 *  - **A past day's scheduling does not travel.** A task planned for the day
 *    it is leaving keeps a mark that pins it to that day: in a time-ruler
 *    column it lands in the `past` block instead of today's timeline, which is
 *    the opposite of what carrying it forward means. The marks that only place
 *    the task in time (and only those) are dropped when their own date is
 *    earlier than the day the line is moving to, so the task arrives
 *    unscheduled and can be planned again by hand. That includes a bare
 *    `h:mm` prefix: it carries no date of its own, because it is read against
 *    the note it lives in, so the day it means is the day it came from. A date
 *    that is still ahead is left alone, and so is every other field — `due`,
 *    `start`, `created`, tags, wikilinks and the Operon `{{...}}` block, which
 *    is Operon's own state and not this plugin's to rewrite. The tombstone in
 *    the source note keeps its scheduling: it is the record of how that day
 *    was planned, and the ruler does not read tombstones anyway.
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
  /** Tag written on migrated plain tasks (`#task` by default). Empty adds none. */
  taskTag: string;
  /**
   * Where that tag goes: at the start of the task text (the default, where the
   * Tasks plugin puts it) or at the end, before any `{{...}}` block.
   */
  taskTagPosition?: "start" | "end";
  /** Whether a migrated task records the day it came from (see the file header). */
  stampCreatedDate: boolean;
  /**
   * Whether a scheduling mark of an earlier day is dropped when the line moves
   * into the destination note (see `stripPastSchedule`). Omitted means on.
   */
  clearPastSchedule?: boolean;
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
 * The order carried tasks arrive in, which is the order the backlog is read in.
 *
 * Priority first — the icons the Tasks plugin writes, highest first — then the
 * due date, then the day the task came from, so that a week of unprioritised
 * work keeps the oldest at the top. A line with no priority sorts with the
 * lowest one, and a line with no date sorts last among its equals: the legacy
 * script ordered exactly this way, and that is the shape the eye expects at the
 * top of a backlog.
 *
 * Blocks are compared by their **parent** line. An indented step has no
 * priority of its own — it belongs to the task above it — so nothing here is
 * meant to be read from a step.
 */
const PRIORITY_RANK = new Map([
  ["🔺", 1],
  ["⏫", 2],
  ["🔼", 3],
  ["🔶", 4],
  ["🔽", 5],
  ["⏬", 6],
]);

/** 1 (highest) to 6 (lowest); no icon ranks as the lowest, as the script had it. */
export function priorityRank(line: string): number {
  for (const [icon, rank] of PRIORITY_RANK) if (line.includes(icon)) return rank;
  return 6;
}

/** The dates the same task can carry, in the two notations the vault writes. */
const DUE_DATES = [/📅\s*(\d{4}-\d{2}-\d{2})/u, /\{\{\s*dateDue\s*::\s*([^}]+?)\s*\}\}/u];
const CREATED_DATES = [
  /➕\s*(\d{4}-\d{2}-\d{2})/u,
  /\{\{\s*dateCreated\s*::\s*([^}]+?)\s*\}\}/u,
  /\{\{\s*datetimeCreated\s*::\s*([^}]+?)\s*\}\}/u,
  /\[\s*created\s*::\s*([^\]]+?)\s*\]/u,
];

/** The first `YYYY-MM-DD` any of the patterns finds, or `""` when none does. */
function isoDate(line: string, patterns: RegExp[]): string {
  for (const pattern of patterns) {
    const value = pattern.exec(line)?.[1];
    if (value !== undefined && /^\d{4}-\d{2}-\d{2}/u.test(value)) return value.slice(0, 10);
  }
  return "";
}

/**
 * Comparator for the parent lines of carried tasks: priority, then due, then
 * created. Undated lines go last within their group; a full tie keeps the order
 * the notes were scanned in, since `Array#sort` is stable.
 */
export function carriedOrder(a: string, b: string): number {
  const byPriority = priorityRank(a) - priorityRank(b);
  if (byPriority !== 0) return byPriority;
  for (const patterns of [DUE_DATES, CREATED_DATES]) {
    const left = isoDate(a, patterns), right = isoDate(b, patterns);
    if (left === right) continue;
    if (left === "") return 1;
    if (right === "") return -1;
    return left < right ? -1 : 1;
  }
  return 0;
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

/** A checkbox, the space after it, and the `simple` time prefix that may follow. */
const CHECKBOX_AND_PREFIX = /^(\s*-\s*\[[^\]\n]\]\s*)((?:(?:\d{4}-\d{2}-\d{2}\s+)?\d{1,2}:\d{2}(?:\s*-\s*\d{1,2}:\d{2})?\s+))?/u;

/**
 * Writes a tag at the start of a task's text, where the Tasks plugin puts the
 * one it creates itself.
 *
 * A `simple`-format time prefix stays in front of it (`- [ ] 09:00 - 09:30
 * #task Llamar`): the ruler only reads the hour when it follows the checkbox
 * directly, so a tag pushed in between would turn a planned task into an
 * unplanned one. Everything else — the text, the fields, the `{{...}}` block —
 * is left in the order it was written.
 */
export function prefixTaskTag(line: string, tag: string): string {
  const match = CHECKBOX_AND_PREFIX.exec(line);
  if (match === null) return line;
  const at = match[1].length + (match[2]?.length ?? 0);
  const head = line.slice(0, at);
  const tail = line.slice(at);
  const space = /\s$/u.test(head) ? "" : " ";
  return `${head}${space}${tag}${tail === "" ? "" : ` ${tail}`}`;
}

/**
 * Prepares a migrated pending line for insertion into today's note: `- [!]`
 * becomes `- [ ] ⏫`, a scheduling mark of an earlier day is dropped (see
 * `stripPastSchedule`), plain tasks get the managed tag at the start of their
 * text and the source-date stamp at the end, and Operon tasks keep their fields
 * — plus a start date when they have none. `targetDate` is the destination
 * daily note's date (`YYYY-MM-DD`); without it no scheduling is cleared, which
 * is what the callers that only decorate a line within its own note want.
 */
export function prepareMigratedLine(line: string, sourceDate: string, options: LineOptions, targetDate = ""): string {
  const source = options.clearPastSchedule !== false && targetDate !== "" ? stripPastSchedule(line, targetDate, sourceDate) : line;
  // `[!]` is how an important task gets written in a hurry (Task Status), and it
  // is not a state to keep: the priority icon is what the Tasks plugin sorts and
  // filters by, so the mark turns into the highest priority and the task takes
  // the place it asked for at the top of the backlog.
  let prepared = source.replace(/- \[!\]/u, "- [ ] ⏫").trimEnd();
  if (isOperonLine(prepared)) return options.stampCreatedDate ? stampOperonStart(prepared, sourceDate) : prepared;
  const tag = options.taskTag.trim();
  const addTag = tag !== "" && !tagPresent(prepared, tag);
  const addStamp = options.stampCreatedDate && !/\s*➕\s*\d{4}-\d{2}-\d{2}/u.test(prepared);
  if (!addTag && !addStamp) return prepared;
  if (addTag && (options.taskTagPosition ?? "start") === "start") prepared = prefixTaskTag(prepared, tag);
  const trailing: string[] = [];
  if (addTag && options.taskTagPosition === "end") trailing.push(tag);
  if (addStamp) trailing.push(`➕ ${sourceDate}`);
  if (trailing.length === 0) return prepared;
  const braceIdx = prepared.indexOf("{{");
  const head = braceIdx >= 0 ? prepared.slice(0, braceIdx).trimEnd() : prepared;
  const tail = braceIdx >= 0 ? prepared.slice(braceIdx).trimStart() : "";
  const suffix = trailing.map((part) => ` ${part}`).join("");
  return tail === "" ? `${head}${suffix}` : `${head}${suffix} ${tail}`;
}

/** An inline `[key:: value]` field, the form Dataview and the ruler share. */
function inlineField(line: string, key: string): string | null {
  const match = new RegExp(`\\[\\s*${escapeRegExp(key)}\\s*::\\s*([^\\]]*?)\\s*\\]`, "u").exec(line);
  return match === null ? null : match[1];
}

/** The Tasks-plugin emoji that holds a scheduling date (and an optional time). */
const TASKS_SCHEDULED = /⏳\s*(\d{4}-\d{2}-\d{2})/u;

/** The Kanban-plugin `@{YYYY-MM-DD}` date. */
const KANBAN_SCHEDULED = /@\{\s*(\d{4}-\d{2}-\d{2})[^}]*\}/u;

/** The Kanban-plugin `@@{hh:mm}` time that goes with it. */
const KANBAN_TIME = /\s*@@\{\s*[^}]*\}/gu;

/**
 * The `simple` format's leading `[YYYY-MM-DD ]h:mm[-h:mm]`, which is how the
 * ruler writes a time when the line carries no field of its own. Group 1 is the
 * checkpoint, so replacing with `$1` drops the scheduling and keeps the task.
 */
const SIMPLE_PREFIX = /^(\s*-\s*\[[^\]\n]\]\s+)(?:\d{4}-\d{2}-\d{2}\s+)?\d{1,2}:\d{2}(?:\s*-\s*\d{1,2}:\d{2})?\s+/u;

/** The same prefix, whether it carries a date of its own or not. */
const SIMPLE_PREFIX_ANY = /^\s*-\s*\[[^\]\n]\]\s+(?:\d{4}-\d{2}-\d{2}\s+)?\d{1,2}:\d{2}/u;

/** The date a dated `simple` prefix carries, when it has one. */
const SIMPLE_PREFIX_DATE = /^\s*-\s*\[[^\]\n]\]\s+(\d{4}-\d{2}-\d{2})\s+\d{1,2}:\d{2}/u;

/** Inline fields that hold a scheduling date. */
const SCHEDULE_DATE_FIELDS = ["scheduled", "date"] as const;

/** Inline fields that only say *when* within that date, or how long. */
const SCHEDULE_AUX_FIELDS = ["startTime", "endTime", "allDay", "duration"] as const;

/**
 * The day a line's own scheduling marks it to, or `null` when the line carries
 * none. The marks are read in the order the ruler prefers them, and only the
 * notations the ruler itself writes are recognised.
 *
 * A `h:mm` prefix carries no date because the ruler reads it against the note
 * the line lives in — that is what makes it relative. `sourceDate` is the day of
 * the note the line is coming from, so it is the day such a prefix means;
 * without it the prefix is left unread, and a line whose only scheduling is a
 * bare `h:mm` is treated as carrying none rather than guessed at.
 */
export function scheduledDate(line: string, sourceDate = ""): string | null {
  for (const key of SCHEDULE_DATE_FIELDS) {
    const value = inlineField(line, key);
    if (value === null) continue;
    const date = /\d{4}-\d{2}-\d{2}/u.exec(value);
    if (date !== null) return date[0];
  }
  const tasks = TASKS_SCHEDULED.exec(line);
  if (tasks !== null) return tasks[1];
  const kanban = KANBAN_SCHEDULED.exec(line);
  if (kanban !== null) return kanban[1];
  const dated = SIMPLE_PREFIX_DATE.exec(line);
  if (dated !== null) return dated[1];
  return sourceDate !== "" && SIMPLE_PREFIX_ANY.test(line) ? sourceDate : null;
}

/**
 * The hour a line is planned at, as minutes after midnight, or `null` when its
 * scheduling carries no hour of its own (an all-day task, or no scheduling at
 * all).
 *
 * It reads the same marks as `scheduledDate`, in the same order, so the two
 * answers never disagree about which mark is the real one: the inline date
 * field first (where the hour may ride along), then the Tasks emoji, the Kanban
 * braces, and the `simple` prefix. `[allDay:: true]` wins over everything: it
 * says the task occupies the day rather than an hour, so it sorts with the
 * all-day lines even when a stray `[startTime::]` survives on the line.
 *
 * Only the hour matters, never the date: the caller has already decided the
 * line belongs to a day (`scheduledDate`), and this is what orders the tasks
 * inside it.
 */
export function scheduledStartMinutes(line: string): number | null {
  if (/\[\s*allDay\s*::\s*true\s*\]/u.test(line)) return null;
  for (const key of SCHEDULE_DATE_FIELDS) {
    const value = inlineField(line, key);
    if (value === null) continue;
    const dated = /(\d{4}-\d{2}-\d{2})[T ](\d{1,2}):(\d{2})/u.exec(value);
    if (dated !== null) return toMinutes(dated[2], dated[3]);
    const bare = /(\d{1,2}):(\d{2})/u.exec(value);
    if (bare !== null) return toMinutes(bare[1], bare[2]);
  }
  const startTime = inlineField(line, "startTime");
  if (startTime !== null) {
    const bare = /(\d{1,2}):(\d{2})/u.exec(startTime);
    if (bare !== null) return toMinutes(bare[1], bare[2]);
  }
  const tasks = /⏳\s*\d{4}-\d{2}-\d{2}(?:[T ](\d{1,2}):(\d{2}))?/u.exec(line);
  if (tasks !== null) return tasks[1] === undefined ? null : toMinutes(tasks[1], tasks[2]);
  const kanban = /@\{\s*\d{4}-\d{2}-\d{2}(?:[T ](\d{1,2}):(\d{2}))?[^}]*\}/u.exec(line);
  if (kanban !== null) {
    if (kanban[1] !== undefined) return toMinutes(kanban[1], kanban[2]);
    const kanbanTime = /@@\{\s*(\d{1,2}):(\d{2})\s*\}/u.exec(line);
    return kanbanTime === null ? null : toMinutes(kanbanTime[1], kanbanTime[2]);
  }
  const prefix = /^\s*-\s*\[[^\]\n]\]\s+(?:\d{4}-\d{2}-\d{2}\s+)?(\d{1,2}):(\d{2})/u.exec(line);
  return prefix === null ? null : toMinutes(prefix[1], prefix[2]);
}

/** Minutes after midnight, or `null` when the pair is not a clock time. */
function toMinutes(hours: string, minutes: string): number | null {
  const h = Number(hours), m = Number(minutes);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

/**
 * Drops every scheduling mark from a line, and nothing else: the date and time
 * fields the ruler writes (Dataview, Tasks emoji, Kanban braces, and the
 * `simple` prefix), plus the duration that only describes them. `due`, `start`,
 * `created`, `priority`, `repeat`, `completion` and the Operon `{{...}}` block
 * stay where they are.
 */
export function stripSchedule(line: string): string {
  let stripped = line;
  for (const key of [...SCHEDULE_DATE_FIELDS, ...SCHEDULE_AUX_FIELDS]) {
    stripped = stripped.replace(new RegExp(`\\s*\\[\\s*${escapeRegExp(key)}\\s*::\\s*[^\\]]*?\\s*\\]`, "gu"), "");
  }
  stripped = stripped.replace(/\s*⏳\s*\d{4}-\d{2}-\d{2}(?:[T ]\d{1,2}:\d{2})?/gu, "");
  stripped = stripped.replace(KANBAN_TIME, "").replace(/\s*@\{\s*[^}]*\}/gu, "");
  stripped = stripped.replace(SIMPLE_PREFIX, "$1");
  return stripped.replace(/\s+$/u, "");
}

/**
 * A line whose own scheduling is earlier than `targetDate`, with that
 * scheduling removed. Anything else — no scheduling at all, scheduling for
 * `targetDate` or later, or a date this helper cannot read (an Operon
 * `{{dateScheduled:: ...}}`, say) — is returned exactly as it was: guessing
 * would either re-plan work the user meant to keep or quietly drop a date only
 * another plugin understands. Dates compare as `YYYY-MM-DD` strings, and only
 * the day matters, so a task planned for an earlier hour *today* is today's.
 *
 * `sourceDate` is the date of the note the line is leaving, and it is what a
 * bare `h:mm` prefix means (see `scheduledDate`). Carrying a task from an
 * earlier note to today and leaving that prefix in place is what would silently
 * re-plan it for today, so it goes like any other scheduling of an earlier day.
 */
export function stripPastSchedule(line: string, targetDate: string, sourceDate = ""): string {
  const date = scheduledDate(line, sourceDate);
  if (date === null || targetDate === "" || date >= targetDate) return line;
  return stripSchedule(line);
}

/**
 * The line a source note keeps in place of a task that has been carried
 * forward: `- [>]`, keeping the text (tags, `➕` date, wikilinks — the record of
 * what was there) and dropping the Operon `{{...}}` fields, so the tombstone is
 * no longer a task and no longer claims an identity.
 *
 * The scheduling is part of that record and stays: the tombstone is how the day
 * it came from was planned, the ruler does not read `- [>]` lines (see the
 * custom-status setting there), and rewriting it into another notation would
 * only put a second, phantom plan next to the live copy.
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
