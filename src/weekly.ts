/**
 * Weekly summary of "the last week you actually worked on".
 *
 * The summary describes the *daily notes of the week the previous daily note
 * belongs to*: that group is bounded (never the whole vault), and the group's
 * last note always holds the tasks still open, because consolidation moves
 * pending tasks forward. Completed tasks are never moved, so they stay in
 * whichever note they were ticked in — hence the note each line was read from
 * is reported alongside the task's own `✅` stamp when the two differ.
 *
 * Two conventions are read, because this vault has both:
 *
 *  - Modern (this plugin): tasks live inside the `tasks` and `cancelled`
 *    marker blocks. `[x]` stays where it was ticked, so completed tasks sit in
 *    the *tasks* block.
 *  - Legacy (the old Python script): notes have no markers, pending lines were
 *    rewritten as `[>]` in the source note, and anything that was not pending
 *    — including `[x]` completed tasks — was swept into `## Tareas canceladas`.
 *
 * Everything this module renders is deliberately **inert**: no checkbox, no
 * `{{...}}` metadata and no managed task tag. Three reasons:
 *
 *  1. A checkbox would make the summary lines look like tasks to be moved.
 *  2. Copying `{{operonId:: …}}` would put a second task with the same id in
 *     the vault, and Operon would see a duplicate identity.
 *  3. The managed tag would make every summary line answer tag queries.
 *
 * The lines are therefore a *report about* tasks, not tasks.
 */

export type WeeklyTaskState = "pending" | "completed" | "cancelled";

/** A daily note as read from the vault. */
export interface WeeklyNoteInput {
  /** Note date, `YYYY-MM-DD`. */
  date: string;
  content: string;
}

/** One task line found in the group, ready to be rendered. */
export interface WeeklyTask {
  state: WeeklyTaskState;
  /** Task text, made inert (no checkbox, no `{{...}}`, no managed tag). */
  text: string;
  /** `➕` created date, or the Operon created field, if any. */
  created: string | null;
  /** `✅` completed date, or the Operon `dateCompleted` field, if any. */
  completed: string | null;
  /** Date of the daily note the line was read from. */
  note: string;
}

export interface WeeklyMarkers {
  tasksStart: string;
  tasksEnd: string;
  cancelledStart: string;
  cancelledEnd: string;
}

export interface WeeklyReadOptions {
  /** Managed task tag, stripped from the rendered text (e.g. `#task`). */
  taskTag: string;
  markers: WeeklyMarkers;
}

export interface WeeklyRenderOptions extends WeeklyReadOptions {
  language: WeeklyLanguage;
  /** Safety cap per list; extra items are reported as "… and N more". */
  maxItemsPerList?: number;
}

export type WeeklyLanguage = "es" | "en";

const TASK_LINE = /^(\s*)[-*]\s*\[(.?)\]\s*(.*)$/;
const SECTION_HEADING = /^#{1,6}\s+(.*)$/;
const PENDING_HEADING = /^tareas pendientes/i;
const CANCELLED_HEADING = /^tareas canceladas/i;
const ISO_DATE = /\d{4}-\d{2}-\d{2}/;
const MULTI_SPACE = /\s+/g;

interface Labels {
  week: (week: number, year: number) => string;
  weekRange: (from: string, to: string) => string;
  notes: (count: number, dates: string) => string;
  pending: string;
  completed: string;
  cancelled: string;
  none: string;
  noDate: string;
  inNote: (date: string) => string;
  more: (count: number) => string;
}

export const LABELS: Record<WeeklyLanguage, Labels> = {
  es: {
    week: (week, year) => `Semana ${week} de ${year}`,
    weekRange: (from, to) => `${from} a ${to}`,
    notes: (count, dates) => `${count === 1 ? "nota" : "notas"}: ${dates}`,
    pending: "Pendientes",
    completed: "Completadas",
    cancelled: "Canceladas",
    none: "(ninguna)",
    noDate: "sin fecha",
    inNote: (date) => `en ${date}`,
    more: (count) => `… y ${count} más`,
  },
  en: {
    week: (week, year) => `Week ${week} of ${year}`,
    weekRange: (from, to) => `${from} to ${to}`,
    notes: (count, dates) => `${count === 1 ? "note" : "notes"}: ${dates}`,
    pending: "Pending",
    completed: "Completed",
    cancelled: "Cancelled",
    none: "(none)",
    noDate: "no date",
    inNote: (date) => `in ${date}`,
    more: (count) => `… and ${count} more`,
  },
};

const dateOnly = (value: string): string | null => {
  const match = value.match(ISO_DATE);
  return match === null ? null : match[0];
};

const toIso = (date: Date): string => date.toISOString().slice(0, 10);

/** ISO-8601 week number and week-year of a `YYYY-MM-DD` date. */
export function isoWeek(date: string): { year: number; week: number } {
  const value = new Date(`${date}T00:00:00Z`);
  const weekday = value.getUTCDay() || 7;
  value.setUTCDate(value.getUTCDate() + 4 - weekday);
  const year = value.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(((value.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { year, week };
}

/** Monday and Sunday of the ISO week a date belongs to. */
export function weekBounds(date: string): { monday: string; sunday: string } {
  const value = new Date(`${date}T00:00:00Z`);
  const weekday = value.getUTCDay() || 7;
  const monday = new Date(value);
  monday.setUTCDate(value.getUTCDate() - (weekday - 1));
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return { monday: toIso(monday), sunday: toIso(sunday) };
}

/** Whether `current` opens a new ISO week with respect to the previous note. */
export function isNewWeek(previous: string, current: string): boolean {
  const a = isoWeek(previous);
  const b = isoWeek(current);
  return a.year !== b.year || a.week !== b.week;
}

/**
 * Where a task line sits, which decides how its checkbox is read:
 * `tasks` holds pending work (and, with this plugin, whatever was completed
 * there); `cancelled` is the carry-forward block, which the legacy script also
 * used as a dumping ground for completed tasks.
 */
type Zone = "tasks" | "cancelled";

function zonesOf(content: string, markers: WeeklyMarkers): Array<{ zone: Zone; line: string }> {
  const lines = content.split("\n");
  const hasMarkers = content.includes(markers.tasksStart) && content.includes(markers.tasksEnd);
  const out: Array<{ zone: Zone; line: string }> = [];
  let zone: Zone | null = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (hasMarkers) {
      if (trimmed === markers.tasksStart) { zone = "tasks"; continue; }
      if (trimmed === markers.tasksEnd || trimmed === markers.cancelledEnd) { zone = null; continue; }
      if (trimmed === markers.cancelledStart) { zone = "cancelled"; continue; }
    } else {
      const heading = trimmed.match(SECTION_HEADING);
      if (heading !== null) {
        zone = PENDING_HEADING.test(heading[1]) ? "tasks" : CANCELLED_HEADING.test(heading[1]) ? "cancelled" : null;
        continue;
      }
    }
    if (zone !== null) out.push({ zone, line });
  }
  return out;
}

function stateOf(mark: string, zone: Zone): WeeklyTaskState | null {
  if (mark === "x" || mark === "X") return "completed";
  if (mark === "-" || mark === "/") return "cancelled";
  // `[ ]`, `[!]` (important) and the legacy `[>]` (already carried forward).
  if (mark === " " || mark === "!" || mark === ">") return "pending";
  // Anything else (`[?]`, a stray emoji, …) is not a state we can vouch for.
  return null;
}

/** Strips the parts that must never be re-emitted, keeping the text readable. */
function toInertText(raw: string, taskTag: string): string {
  let text = raw.replace(/\{\{[^}]*\}\}/g, " ");
  if (taskTag.trim() !== "") {
    const tag = taskTag.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text.replace(new RegExp(`(^|\\s)${tag}(?!\\S)`, "gu"), "$1");
  }
  text = text.replace(/\s*[➕✅]\s*\d{4}-\d{2}-\d{2}/gu, " ");
  return text.replace(MULTI_SPACE, " ").trim();
}

function datesOf(raw: string): { created: string | null; completed: string | null } {
  const completed = raw.match(/✅\s*(\d{4}-\d{2}-\d{2})/u) ?? raw.match(/\{\{\s*dateCompleted\s*::\s*([^}]+)\}\}/u);
  const created = raw.match(/➕\s*(\d{4}-\d{2}-\d{2})/u)
    ?? raw.match(/\{\{\s*datetimeCreated\s*::\s*([^}]+)\}\}/u)
    ?? raw.match(/\{\{\s*dateCreated\s*::\s*([^}]+)\}\}/u)
    ?? raw.match(/\{\{\s*dateStarted\s*::\s*([^}]+)\}\}/u)
    ?? raw.match(/\{\{\s*dateScheduled\s*::\s*([^}]+)\}\}/u);
  return { created: created === null ? null : dateOnly(created[1]), completed: completed === null ? null : dateOnly(completed[1]) };
}

/** Key used to collapse the same task appearing in several notes of the group. */
export function dedupeKey(text: string): string {
  const key = text
    .toLowerCase()
    .replace(/#[^\s#]+/gu, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(MULTI_SPACE, " ")
    .trim();
  return key === "" ? text.toLowerCase().trim() : key;
}

/**
 * Reads every task line of the given notes (expected in ascending date order)
 * and returns them de-duplicated by text, so a task carried forward through
 * several notes of the same week is reported once.
 */
export function readWeeklyTasks(notes: WeeklyNoteInput[], options: WeeklyReadOptions): WeeklyTask[] {
  const tasks: WeeklyTask[] = [];
  for (const note of notes) {
    // Parent level only: whatever is indented deeper than the shallowest task
    // line of its zone is that zone's subtask, not a task of its own. The
    // shallowest line is computed per zone, so an indented zone cannot hide
    // another zone's tasks.
    const byZone = new Map<Zone, string[]>();
    for (const { zone, line } of zonesOf(note.content, options.markers)) {
      const lines = byZone.get(zone);
      if (lines === undefined) byZone.set(zone, [line]); else lines.push(line);
    }
    for (const [zone, lines] of byZone) {
      const indents = lines
        .map((line) => line.match(TASK_LINE))
        .filter((match): match is RegExpMatchArray => match !== null)
        .map((match) => match[1].length);
      const parentIndent = indents.length === 0 ? 0 : Math.min(...indents);
      for (const line of lines) {
        const match = line.match(TASK_LINE);
        if (match === null || match[1].length !== parentIndent) continue;
        const state = stateOf(match[2], zone);
        if (state === null) continue;
        const raw = match[3];
        const text = toInertText(raw, options.taskTag);
        if (text === "") continue;
        const { created, completed } = datesOf(raw);
        tasks.push({ state, text, created, completed, note: note.date });
      }
    }
  }
  const seen = new Set<string>();
  return tasks.filter((task) => {
    const key = dedupeKey(task.text);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const byDate = (task: WeeklyTask, key: "created" | "completed"): string =>
  (key === "created" ? task.created : task.completed) ?? task.note;

const byState = (tasks: WeeklyTask[], state: WeeklyTaskState): WeeklyTask[] =>
  tasks
    .filter((task) => task.state === state)
    .sort((a, b) => {
      const field = state === "completed" ? "completed" : "created";
      return byDate(a, field).localeCompare(byDate(b, field)) || a.text.localeCompare(b.text);
    });

/**
 * Renders the summary body (without the surrounding marker lines) for the group
 * of daily notes, ascending by date.
 */
export function renderWeeklySummary(
  notes: WeeklyNoteInput[],
  tasks: WeeklyTask[],
  options: WeeklyRenderOptions,
): string[] {
  const labels = LABELS[options.language];
  const cap = options.maxItemsPerList ?? 50;
  const last = notes[notes.length - 1].date;
  const first = notes[0].date;
  const { monday, sunday } = weekBounds(last);
  const { week, year } = isoWeek(last);

  const out: string[] = [
    `${labels.week(week, year)} · ${labels.weekRange(monday, sunday)} · ${labels.notes(notes.length, notes.map((note) => note.date).join(", "))}`,
  ];

  const sections: Array<[string, WeeklyTaskState]> = [
    [labels.pending, "pending"],
    [labels.completed, "completed"],
    [labels.cancelled, "cancelled"],
  ];
  for (const [title, state] of sections) {
    const items = byState(tasks, state);
    out.push("", `**${title} (${items.length})**`);
    if (items.length === 0) {
      out.push(labels.none);
      continue;
    }
    for (const task of items.slice(0, cap)) {
      const marks: string[] = [];
      if (state === "completed") {
        marks.push(task.completed === null ? labels.noDate : `✅ ${task.completed}`);
        if (task.completed !== task.note) marks.push(labels.inNote(task.note));
      } else if (task.created !== null) {
        marks.push(`➕ ${task.created}`);
      }
      out.push(`- ${task.text}${marks.length === 0 ? "" : ` (${marks.join(" · ")})`}`);
    }
    if (items.length > cap) out.push(`- ${labels.more(items.length - cap)}`);
  }
  return out;
}

/**
 * The notes of the week the anchor belongs to, ascending. `notes` is expected
 * to be the full list of daily notes; anything outside the window is dropped.
 */
export function weeklyGroup(anchor: string, dates: string[]): string[] {
  const { monday, sunday } = weekBounds(anchor);
  return dates.filter((date) => date >= monday && date <= sunday).sort();
}

/** Convenience wrapper: read + render in one call. */
export function buildWeeklySummary(
  notes: WeeklyNoteInput[],
  options: WeeklyRenderOptions,
): string[] {
  return renderWeeklySummary(notes, readWeeklyTasks(notes, options), options);
}

/** The group must be non-empty and its last note must be the anchor. */
export function anchorOf(notes: WeeklyNoteInput[]): string | null {
  return notes.length === 0 ? null : notes[notes.length - 1].date;
}

const HEADING_LINE = /^#{1,6}\s+\S/;

/**
 * Reads the weekly block as a *placeholder*: `null` when it already holds real
 * content (a previous summary, or text the user wrote), otherwise its heading
 * lines (an empty array when the block is simply blank).
 *
 * This is the whole write-once rule. A block is unwritten only while it holds
 * nothing but its heading and blank lines — the template's section title — so:
 *
 *  - the heading the user put in the template is the one that gets used, and
 *    can be renamed there without touching code;
 *  - anything else inside the block (including a summary written before) is
 *    treated as the user's own content and never overwritten.
 */
export function weeklyPlaceholder(content: string): string[] | null {
  const lines = content.split("\n").map((line) => line.trim()).filter((line) => line !== "");
  return lines.every((line) => HEADING_LINE.test(line)) ? lines : null;
}

/**
 * The report as it is written into the block: the placeholder's heading lines
 * first (if the template had one), then the report.
 */
export function composeWeeklyBody(headings: string[], report: string[]): string[] {
  return headings.length === 0 ? report : [...headings, "", ...report];
}

/**
 * Replaces the body of the weekly block — the lines strictly between its two
 * marker lines, given by their indices — with `body`, leaving every other line
 * of the note byte-for-byte untouched. Pure, so the one write the summary ever
 * performs can be tested without Obsidian.
 */
export function spliceWeeklyBlock(content: string, block: { start: number; end: number }, body: string[]): string {
  const lines = content.split("\n");
  lines.splice(block.start + 1, block.end - block.start - 1, ...body);
  return lines.join("\n");
}
