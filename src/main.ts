import { App, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile } from "obsidian";
import { operonInfo, requestOperonReindex } from "./operon";
import {
  isOperonLine,
  normalizeTaskLine,
  prepareMigratedLine,
  stampOperonStart,
  taskKey,
  tombstoneLine,
  tombstoneOperonLines,
  type LineOptions,
} from "./lines";
import { AUTO_VERIFY_MS, autoRunDelay, survivors } from "./auto-run";
import {
  buildWeeklySummary,
  composeWeeklyBody,
  isNewWeek,
  spliceWeeklyBlock,
  weeklyGroup,
  weeklyPlaceholder,
  type WeeklyLanguage,
  type WeeklyNoteInput,
  type WeeklyRenderOptions,
} from "./weekly";

interface TaskConsolidatorSettings {
  dailyNotesFolder: string;
  archiveFolder: string;
  remindersFile: string;
  notesFile: string;
  daysToScan: number;
  maxDailyNotes: number;
  autoArchive: boolean;
  autoConsolidate: boolean;
  includeCancelled: boolean;
  taskTag: string;
  stampCreatedDate: boolean;
  migrateNotes: boolean;
  migrateReminders: boolean;
  recentReminders: number;
  refreshOperonIndex: boolean;
  tasksMarkerStart: string;
  tasksMarkerEnd: string;
  cancelledMarkerStart: string;
  cancelledMarkerEnd: string;
  remindersMarkerStart: string;
  remindersMarkerEnd: string;
  notesMarkerStart: string;
  notesMarkerEnd: string;
  weeklySummary: boolean;
  weeklyLanguage: WeeklyLanguage;
  weeklyMarkerStart: string;
  weeklyMarkerEnd: string;
}

const MARKERS = {
  tasksStart: "<!-- task-consolidator:tasks:start -->",
  tasksEnd: "<!-- task-consolidator:tasks:end -->",
  cancelledStart: "<!-- task-consolidator:cancelled:start -->",
  cancelledEnd: "<!-- task-consolidator:cancelled:end -->",
  remindersStart: "<!-- task-consolidator:reminders:start -->",
  remindersEnd: "<!-- task-consolidator:reminders:end -->",
  notesStart: "<!-- task-consolidator:notes:start -->",
  notesEnd: "<!-- task-consolidator:notes:end -->",
  weeklyStart: "<!-- task-consolidator:weekly:start -->",
  weeklyEnd: "<!-- task-consolidator:weekly:end -->",
};

const DEFAULT_SETTINGS: TaskConsolidatorSettings = {
  dailyNotesFolder: "10-journal/daily notes",
  archiveFolder: "10-journal/archive/old daily notes",
  remindersFile: "10-journal/misc/recordatorios.md",
  notesFile: "10-journal/misc/apuntes.md",
  daysToScan: 14,
  maxDailyNotes: 10,
  autoArchive: false,
  autoConsolidate: true,
  includeCancelled: true,
  taskTag: "#task",
  stampCreatedDate: true,
  migrateNotes: true,
  migrateReminders: true,
  recentReminders: 9,
  refreshOperonIndex: false,
  tasksMarkerStart: MARKERS.tasksStart,
  tasksMarkerEnd: MARKERS.tasksEnd,
  cancelledMarkerStart: MARKERS.cancelledStart,
  cancelledMarkerEnd: MARKERS.cancelledEnd,
  remindersMarkerStart: MARKERS.remindersStart,
  remindersMarkerEnd: MARKERS.remindersEnd,
  notesMarkerStart: MARKERS.notesStart,
  notesMarkerEnd: MARKERS.notesEnd,
  weeklySummary: true,
  weeklyLanguage: "es",
  weeklyMarkerStart: MARKERS.weeklyStart,
  weeklyMarkerEnd: MARKERS.weeklyEnd,
};

interface DailyNote { file: TFile; date: string; }

/**
 * What the weekly step intends to do to today's note. Decided without writing,
 * so the preview and the confirmation describe exactly what the write does.
 */
type WeeklyAction =
  | { kind: "write"; body: string[]; headline: string }
  | { kind: "tidy" }
  | { kind: "none" };
interface MarkerBlock { start: number; end: number; content: string; }

/** Writes the automatic run defers until today's note has been verified. */
interface DeferredRun {
  /** Records and tombstones that belong to the source notes and the dated files. */
  changes: Array<{ path: string; content: string }>;
  /** Whole lines the run put into today's note, to be checked once more. */
  lines: string[];
}

interface PlannedMove {
  /** Normalized key of the parent line, used for de-duplication. */
  key: string;
  /** Parent line normalized for insertion (`- [!]` becomes `- [ ]`). */
  parent: string;
  /** Original lines to move: the parent plus any contiguous indented subtask lines. */
  lines: string[];
  /** Source daily-note date (YYYY-MM-DD), used to stamp the ➕ created date. */
  date: string;
}
interface PlannedResult {
  moves: PlannedMove[];
  sources: Map<string, { note: DailyNote; moves: PlannedMove[] }>;
}
type MoveKind = "pending" | "cancelled";

interface KindSpec {
  /** Block in today's note where tasks of this kind are inserted. */
  insertBlock: [string, string];
  /** Blocks in source notes that are scanned for tasks of this kind. */
  blocks: Array<[string, string]>;
  isTarget: (line: string) => boolean;
  /** Lines the OTHER kind claims; never absorbed into a subtree of this kind. */
  otherClaimed: (line: string) => boolean;
  /** Wording used in the non-destructive moved comment. */
  comment: string;
}

export default class TaskConsolidatorPlugin extends Plugin {
  settings: TaskConsolidatorSettings = DEFAULT_SETTINGS;
  /** Timer of the pending automatic run; every write to the note re-arms it. */
  private autoTimer: number | null = null;
  /** When the run was first armed, so the wait cannot grow without a ceiling. */
  private autoArmedAt = 0;
  /** True while the automatic run is in flight (it writes more than once). */
  private autoRunning = false;
  /** Grace period before the sources are marked; a test hook shortens it. */
  private verifyGraceMs = AUTO_VERIFY_MS;
  private autoRanToday: string | null = null;

  async onload(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    // Acota los valores cargados (data.json) a rangos seguros: 3–30 en ambos casos.
    this.settings.daysToScan = Math.min(30, Math.max(3, Math.floor(this.settings.daysToScan) || DEFAULT_SETTINGS.daysToScan));
    this.settings.maxDailyNotes = Math.min(30, Math.max(3, Math.floor(this.settings.maxDailyNotes) || DEFAULT_SETTINGS.maxDailyNotes));
    if (this.settings.weeklyLanguage !== "en") this.settings.weeklyLanguage = "es";
    this.addCommand({ id: "preview-consolidation", name: "Preview daily consolidation", callback: () => this.previewConsolidation() });
    this.addCommand({ id: "consolidate-daily-note", name: "Consolidate current daily note", callback: () => this.consolidateCurrentDailyNote() });
    this.addCommand({ id: "migrate-daily-material", name: "Migrate previous daily notes material", callback: () => this.migratePreviousMaterial() });
    this.addCommand({ id: "archive-old-daily-notes", name: "Archive old daily notes", callback: () => this.archiveOldDailyNotes() });
    this.addSettingTab(new TaskConsolidatorSettingTab(this.app, this));
    this.registerEvent(this.app.vault.on("create", (file) => { void this.maybeAutoConsolidate(file); }));
    this.registerEvent(this.app.vault.on("modify", (file) => { void this.maybeAutoConsolidate(file); }));
    this.registerEvent(this.app.vault.on("rename", (file) => { if (file instanceof TFile) void this.maybeAutoConsolidate(file); }));
  }

  async saveSettings(): Promise<void> { await this.saveData(this.settings); }

  private async getDailyNotes(): Promise<DailyNote[]> {
    const prefix = `${this.settings.dailyNotesFolder.replace(/\/+$/, "")}/`;
    return this.app.vault.getMarkdownFiles().filter((file) => file.path.startsWith(prefix)).map((file) => {
      const match = file.basename.match(/^(\d{4}-\d{2}-\d{2})$/);
      return match === null ? null : { file, date: match[1] };
    }).filter((note): note is DailyNote => note !== null).sort((a, b) => b.date.localeCompare(a.date));
  }

  private findBlock(content: string, startMarker: string, endMarker: string): MarkerBlock | null {
    const lines = content.split("\n");
    const starts = lines.reduce<number[]>((found, line, index) => { if (line.trim() === startMarker) found.push(index); return found; }, []);
    const ends = lines.reduce<number[]>((found, line, index) => { if (line.trim() === endMarker) found.push(index); return found; }, []);
    if (starts.length !== 1 || ends.length !== 1 || ends[0] <= starts[0]) return null;
    return { start: starts[0], end: ends[0], content: lines.slice(starts[0] + 1, ends[0]).join("\n") };
  }

  private validateManagedBlocks(content: string): string[] {
    const errors: string[] = [];
    for (const [name, start, end] of [
      ["tasks", this.settings.tasksMarkerStart, this.settings.tasksMarkerEnd],
      ["cancelled", this.settings.cancelledMarkerStart, this.settings.cancelledMarkerEnd],
      ["reminders", this.settings.remindersMarkerStart, this.settings.remindersMarkerEnd],
      ["notes", this.settings.notesMarkerStart, this.settings.notesMarkerEnd],
      ["weekly", this.settings.weeklyMarkerStart, this.settings.weeklyMarkerEnd],
    ] as const) {
      const hasStart = content.includes(start), hasEnd = content.includes(end);
      if (hasStart !== hasEnd) errors.push(`${name}: incomplete marker pair`);
      if (content.split(start).length > 2) errors.push(`${name}: duplicate start marker`);
      if (content.split(end).length > 2) errors.push(`${name}: duplicate end marker`);
    }
    return errors;
  }

  private async currentDailyNote(): Promise<DailyNote | null> {
    const today = window.moment().format("YYYY-MM-DD");
    return (await this.getDailyNotes()).find((note) => note.date === today) ?? null;
  }

  /** The configured task tag (trimmed); empty disables tag stamping. */
  private taskTag(): string { return this.settings.taskTag.trim(); }

  /** Options the line helpers need, taken from this plugin's settings. */
  private lineOptions(): LineOptions {
    return { taskTag: this.taskTag(), stampCreatedDate: this.settings.stampCreatedDate };
  }

  private kindSpec(kind: MoveKind): KindSpec {
    if (kind === "pending") {
      return {
        insertBlock: [this.settings.tasksMarkerStart, this.settings.tasksMarkerEnd],
        blocks: [[this.settings.tasksMarkerStart, this.settings.tasksMarkerEnd]],
        isTarget: (line) => /^\s*- \[ \]/.test(line) || /^\s*- \[!\]/.test(line),
        otherClaimed: (line) => /^\s*- \[-\]/.test(line),
        comment: "task line(s)",
      };
    }
    return {
      insertBlock: [this.settings.cancelledMarkerStart, this.settings.cancelledMarkerEnd],
      blocks: [[this.settings.tasksMarkerStart, this.settings.tasksMarkerEnd], [this.settings.cancelledMarkerStart, this.settings.cancelledMarkerEnd]],
      isTarget: (line) => /^\s*- \[-\]/.test(line),
      otherClaimed: (line) => /^\s*- \[ \]/.test(line) || /^\s*- \[!\]/.test(line),
      comment: "cancelled task line(s)",
    };
  }

  /**
   * Plans moves of the given kind: for each previous daily note, scan the
   * relevant managed block(s) for target task lines (and their contiguous
   * indented subtask lines). De-duplicates by normalized parent line, newest
   * note first, so each task is planned to move exactly once. A line claimed by
   * the other kind is never absorbed into a subtree, so pending and cancelled
   * scans never double-claim a line.
   */
  private async planMoves(notes: DailyNote[], kind: MoveKind): Promise<PlannedResult> {
    const spec = this.kindSpec(kind);
    const moves: PlannedMove[] = [], seen = new Set<string>();
    const sources = new Map<string, { note: DailyNote; moves: PlannedMove[] }>();
    for (const note of notes) {
      const content = await this.app.vault.read(note.file);
      const noteMoves: PlannedMove[] = [];
      for (const [startMarker, endMarker] of spec.blocks) {
        const block = this.findBlock(content, startMarker, endMarker);
        if (block === null) continue;
        const lines = block.content.split("\n");
        let i = 0;
        while (i < lines.length) {
          const line = lines[i];
          if (!spec.isTarget(line)) { i += 1; continue; }
          const parent = normalizeTaskLine(line, this.taskTag());
          const key = taskKey(line, this.taskTag());
          const indent = line.match(/^\s*/)?.[0].length ?? 0;
          const subtree: string[] = [line];
          let j = i + 1;
          while (j < lines.length) {
            const child = lines[j];
            const childIndent = child.match(/^\s*/)?.[0].length ?? 0;
            if (!/^\s*- \[/.test(child) || childIndent <= indent || spec.otherClaimed(child)) break;
            subtree.push(child);
            j += 1;
          }
          // An Operon task is planned once per copy on purpose: if one operonId
          // ended up in more than one note, every stale copy has to be
          // tombstoned, while only one line reaches today's note (the insert
          // skips a task that is already there). Plain tasks keep the old
          // de-duplication by text.
          if (isOperonLine(line) || !seen.has(key)) {
            seen.add(key);
            const move: PlannedMove = { key, parent, lines: subtree, date: note.date };
            moves.push(move);
            noteMoves.push(move);
          }
          i = j;
        }
      }
      if (noteMoves.length > 0) sources.set(note.file.path, { note, moves: noteMoves });
    }
    return { moves, sources };
  }

  private emptyResult(): PlannedResult {
    return { moves: [], sources: new Map<string, { note: DailyNote; moves: PlannedMove[] }>() };
  }

  private async previewConsolidation(): Promise<void> {
    const current = await this.currentDailyNote();
    if (current === null) { new Notice("Task Consolidator: today's daily note was not found."); return; }
    const currentContent = await this.app.vault.read(current.file);
    const errors = this.validateManagedBlocks(currentContent);
    if (errors.length > 0) { new Notice(`Task Consolidator: cannot preview; ${errors.join("; ")}`); return; }
    const notes = (await this.getDailyNotes()).filter((note) => note.date < current.date).slice(0, this.settings.daysToScan);
    const pending = await this.planMoves(notes, "pending");
    const cancelled = this.settings.includeCancelled ? await this.planMoves(notes, "cancelled") : this.emptyResult();
    const noteCount = new Set([...pending.sources.keys(), ...cancelled.sources.keys()]).size;
    const parts = [`${pending.moves.length} pending task(s)`];
    if (cancelled.moves.length > 0) parts.push(`${cancelled.moves.length} cancelled task(s)`);
    // The manual commands write the summary whenever the block is untouched (no
    // week gate: you asked for it), so the preview mirrors exactly that.
    const weekly = await this.weeklyAction(current, false);
    const weeklyNote = weekly.kind === "write"
      ? ` Weekly summary ready: ${weekly.headline}.`
      : weekly.kind === "tidy"
        ? " The empty weekly section left by the template would be removed."
        : "";
    const operon = await operonInfo(this);
    new Notice(`Task Consolidator: ${parts.join(", ")} to move from ${noteCount} previous note(s).${weeklyNote} ${operon.present ? operon.detail : "Operon not enabled."}`);
    console.info("Task Consolidator preview", {
      current: current.file.path,
      pending: [...pending.sources.entries()].map(([path, { moves: sourceMoves }]) => ({ path, tasks: sourceMoves.map((move) => move.parent) })),
      cancelled: [...cancelled.sources.entries()].map(([path, { moves: sourceMoves }]) => ({ path, tasks: sourceMoves.map((move) => move.parent) })),
      weekly: weekly.kind === "write" ? weekly.headline : weekly.kind,
      operon,
    });
  }

  private async consolidateCurrentDailyNote(): Promise<void> {
    const current = await this.currentDailyNote();
    if (current === null) { new Notice("Task Consolidator: today's daily note was not found."); return; }
    const currentContent = await this.app.vault.read(current.file);
    const errors = this.validateManagedBlocks(currentContent);
    if (errors.length > 0) { new Notice(`Task Consolidator: stopped safely; ${errors.join("; ")}`); return; }
    const block = this.findBlock(currentContent, this.settings.tasksMarkerStart, this.settings.tasksMarkerEnd);
    if (block === null) { new Notice("Task Consolidator: add the tasks marker block to the daily-note template first."); return; }
    const notes = (await this.getDailyNotes()).filter((note) => note.date < current.date).slice(0, this.settings.daysToScan);
    const pending = await this.planMoves(notes, "pending");
    const cancelled = this.settings.includeCancelled ? await this.planMoves(notes, "cancelled") : this.emptyResult();
    // Mirror exactly what will happen: the manual path has no week gate, but it
    // still needs an untouched weekly block (and the setting on) to write into.
    const weekly = await this.weeklyAction(current, false);
    const hasMoves = pending.moves.length > 0 || cancelled.moves.length > 0;
    if (!hasMoves && weekly.kind === "none") { new Notice("Task Consolidator: no pending or cancelled tasks to move in the previous daily notes."); return; }
    const parts: string[] = [];
    if (pending.moves.length > 0) parts.push(`${pending.moves.length} pending task(s) from ${pending.sources.size} note(s)`);
    if (cancelled.moves.length > 0) parts.push(`${cancelled.moves.length} cancelled task(s) from ${cancelled.sources.size} note(s)`);
    const question = hasMoves
      ? `Move ${parts.join(" and ")} into today's daily note? Tasks already present in today's note are left there and only removed from the source.`
      : "Nothing to move into today's daily note.";
    const weeklyNote = weekly.kind === "write"
      ? " A summary of the previous week's daily notes will be written into the weekly block."
      : weekly.kind === "tidy"
        ? " The empty weekly section left by the template will be removed."
        : "";
    const summary = `${question}${weeklyNote}`;
    new ConfirmationModal(this.app, summary, async () => {
      const weeklyWritten = await this.maybeWriteWeeklySummary(current, false);
      if (!hasMoves) {
        new Notice(weeklyWritten ? "Task Consolidator: weekly summary of the previous week written." : "Task Consolidator: empty weekly section removed.");
        return;
      }
      await this.applyConsolidation(current, pending, cancelled, weeklyWritten);
    }).open();
  }

  /**
   * Applies a planned consolidation without asking for confirmation: inserts
   * pending and cancelled tasks into today's note, then removes them from their
   * source notes. Always writes today's note first and re-reads each file just
   * before writing; if today's tasks block cannot be found on re-read, nothing
   * is changed (a task is never removed from its source unless it was inserted
   * first). If today's note has no cancelled block, cancelled tasks are left in
   * place instead of being lost.
   */
  private async applyConsolidation(current: DailyNote, pending: PlannedResult, cancelled: PlannedResult, weeklyWritten = false, defer: DeferredRun | null = null): Promise<void> {
    const pendingRes = await this.applyInsertToCurrent(current, pending.moves, "pending");
    if (!pendingRes.blockFound && pending.moves.length > 0) {
      new Notice("Task Consolidator: today's tasks block was not found on re-read; nothing was changed.");
      return;
    }
    let cancelledApplied = cancelled.moves.length === 0;
    let insertedCancelled = 0;
    let cancelledKeys: string[] = [];
    if (cancelled.moves.length > 0) {
      const cancelledRes = await this.applyInsertToCurrent(current, cancelled.moves, "cancelled");
      if (cancelledRes.blockFound) {
        cancelledApplied = true;
        insertedCancelled = cancelledRes.inserted;
        cancelledKeys = cancelledRes.keys;
      } else {
        new Notice("Task Consolidator: today's note has no '## Tareas canceladas' block; cancelled tasks were left in place.");
      }
    }
    // Nothing is marked as moved until the note has been given the grace period
    // a template can take to write over it, and has been found to still hold
    // everything this run put there. If it was rewritten in the meantime, the
    // sources keep their tasks and the run can simply be repeated.
    if (defer !== null && !(await this.todayHoldsInserted(current, [...pendingRes.keys, ...cancelledKeys], defer.lines))) return;
    // The deferred material is written before the task tombstones, the order the
    // manual path has always used: its content was planned against the sources
    // as they were, so applying it afterwards would write that older text back
    // over the tombstones just made.
    if (defer !== null) await this.applyMaterialChanges(defer.changes);
    let removedPending = 0;
    for (const { note, moves } of pending.sources.values()) {
      removedPending += await this.applySourceRemoval(note, moves, current.date, "pending");
    }
    let removedCancelled = 0;
    if (cancelledApplied) {
      for (const { note, moves } of cancelled.sources.values()) {
        removedCancelled += await this.applySourceRemoval(note, moves, current.date, "cancelled");
      }
    }
    const inserted = pendingRes.inserted + insertedCancelled;
    const weekly = weeklyWritten ? " A weekly summary of the previous week was written." : "";
    new Notice(inserted === 0
      ? `Task Consolidator: previous note material migrated.${weekly}`
      : `Task Consolidator: inserted ${pendingRes.inserted} pending and ${insertedCancelled} cancelled task(s); marked ${removedPending + removedCancelled} line(s) as moved.${weekly}`);
    await this.reportOperonAfterChange();
    if (this.settings.autoArchive) await this.archiveOldDailyNotes();
  }

  /**
   * Waits out the grace period and reports whether today's note still holds what
   * the run wrote into it. A note rewritten underneath — a template applied a
   * second time is the case this exists for — is reported to you, and the caller
   * marks nothing as moved, so the sources keep their tasks and nothing is lost.
   */
  private async todayHoldsInserted(current: DailyNote, keys: string[], lines: string[]): Promise<boolean> {
    await new Promise<void>((resolve) => { window.setTimeout(resolve, this.verifyGraceMs); });
    const content = await this.app.vault.read(current.file);
    const { missingKeys, missingLines } = survivors(content, keys, lines, this.taskTag());
    if (missingKeys.length === 0 && missingLines.length === 0) return true;
    console.info("Task Consolidator: today's note was rewritten after consolidating", { missingKeys, missingLines });
    new Notice("Task Consolidator: today's note was rewritten while consolidating, so nothing was marked as moved and nothing is lost. Repeat the consolidation once the note has settled.");
    return false;
  }

  /**
   * Inserts the planned moves of a kind into today's block for that kind,
   * preserving the block's existing content (headings, already-present tasks).
   * Re-reads the note and re-verifies the block just before writing, so the
   * insert never runs on a stale or changed note. Tasks already present in the
   * current note are skipped (they will still be removed from their source).
   */
  private async applyInsertToCurrent(current: DailyNote, moves: PlannedMove[], kind: MoveKind): Promise<{ inserted: number; blockFound: boolean; keys: string[] }> {
    const [startMarker, endMarker] = this.kindSpec(kind).insertBlock;
    const content = await this.app.vault.read(current.file);
    const block = this.findBlock(content, startMarker, endMarker);
    if (block === null) return { inserted: 0, blockFound: false, keys: [] };
    const lines = content.split("\n");
    const existingKeys = this.existingTaskKeys(lines, block);
    const options = this.lineOptions();
    const toInsert: string[] = [];
    const insertedKeys: string[] = [];
    for (const move of moves) {
      if (existingKeys.has(move.key)) continue;
      existingKeys.add(move.key);
      insertedKeys.push(move.key);
      const insertLines = move.lines.map((line, index) => (kind === "pending" && index === 0) ? prepareMigratedLine(line, move.date, options) : line);
      toInsert.push(...insertLines);
    }
    if (toInsert.length === 0) return { inserted: 0, blockFound: true, keys: [] };
    lines.splice(block.end, 0, ...toInsert);
    await this.app.vault.modify(current.file, lines.join("\n"));
    return { inserted: toInsert.length, blockFound: true, keys: insertedKeys };
  }

  /**
   * Keys already present in today's note: every task line inside the target
   * block, plus — for Operon tasks — any line anywhere in the note. An Operon
   * task that already lives in today's note (its reminders block, its notes
   * block, its body) is never inserted a second time: two lines claiming one
   * `operonId` is the clash Operon can only resolve by hand.
   */
  private existingTaskKeys(lines: string[], block: MarkerBlock): Set<string> {
    const tag = this.taskTag();
    const keys = new Set<string>();
    for (const line of lines.slice(block.start + 1, block.end)) {
      if (/^\s*- \[[^]]+\]/.test(line)) keys.add(taskKey(line, tag));
    }
    for (const line of lines) if (isOperonLine(line)) keys.add(taskKey(line, tag));
    return keys;
  }

  /**
   * Marks the moved task lines of a kind in a source note as carried forward:
   * each one stays in place as `- [>]` — the convention the legacy notes and
   * the old Python script already use — keeping its text as the record of what
   * was there, and a non-destructive HTML comment says where the work went.
   *
   * The tombstone drops the Operon `{{...}}` fields, and that is the point: the
   * live copy in today's note now holds that `operonId`, and a second line
   * claiming it is exactly the duplicate Operon makes you resolve by hand.
   *
   * Re-reads the note, re-finds the relevant block(s), and re-locates each
   * parent line by its key (its `operonId`, or its normalized text) before
   * touching anything, so a note that changed between planning and applying is
   * left untouched rather than edited on stale assumptions. Subtask lines
   * indented under a marked parent are marked with it; every occurrence of a
   * planned key is marked (cancelled lines can appear in both the tasks and the
   * cancelled block).
   */
  private async applySourceRemoval(note: DailyNote, moves: PlannedMove[], destinationDate: string, kind: MoveKind): Promise<number> {
    const spec = this.kindSpec(kind), tag = this.taskTag();
    const content = await this.app.vault.read(note.file);
    const lines = content.split("\n");
    const markedIdx = new Set<number>();
    for (const [startMarker, endMarker] of spec.blocks) {
      const block = this.findBlock(content, startMarker, endMarker);
      if (block === null) continue;
      for (const move of moves) {
        for (let k = block.start + 1; k < block.end; k += 1) {
          if (markedIdx.has(k) || taskKey(lines[k], tag) !== move.key) continue;
          const indent = lines[k].match(/^\s*/)?.[0].length ?? 0;
          markedIdx.add(k);
          let j = k + 1;
          while (j < block.end) {
            const child = lines[j];
            const childIndent = child.match(/^\s*/)?.[0].length ?? 0;
            if (!/^\s*- \[/.test(child) || childIndent <= indent) break;
            markedIdx.add(j);
            j += 1;
          }
        }
      }
    }
    if (markedIdx.size === 0) return 0;
    for (const idx of markedIdx) lines[idx] = tombstoneLine(lines[idx]);
    lines.splice(Math.min(...markedIdx), 0, `<!-- task-consolidator:moved ${markedIdx.size} ${spec.comment} to ${destinationDate} -->`);
    await this.app.vault.modify(note.file, lines.join("\n"));
    return markedIdx.size;
  }

  /**
   * Builds the Markdown changes that migrate notes and reminders from the
   * previous daily note into the dated misc files and today's note.
   *
   * The two groups come back apart on purpose. `intoToday` writes into today's
   * note and has to happen first; `deferred` holds the records and the
   * tombstones of the source notes, and the automatic path applies it only after
   * today's note has been verified to still hold what was inserted. Marking a
   * source as moved on the strength of a copy that a second template write has
   * removed is how a live reminder — and the `operonId` that is the task's
   * identity in Operon — ends up existing nowhere.
   */
  private async buildMaterialChanges(current: DailyNote): Promise<{ intoToday: Array<{ path: string; content: string }>; deferred: Array<{ path: string; content: string }>; lines: string[]; previous: DailyNote | null; reason: string | null }> {
    const previous = (await this.getDailyNotes()).find((note) => note.date < current.date);
    if (previous === undefined) return { intoToday: [], deferred: [], lines: [], previous: null, reason: "no previous daily note found" };
    const source = await this.app.vault.read(previous.file), currentContent = await this.app.vault.read(current.file);
    const errors = [...this.validateManagedBlocks(source), ...this.validateManagedBlocks(currentContent)];
    if (errors.length > 0) return { intoToday: [], deferred: [], lines: [], previous, reason: `stopped safely; ${errors.join("; ")}` };
    const sourceNotes = this.findBlock(source, this.settings.notesMarkerStart, this.settings.notesMarkerEnd);
    const sourceReminders = this.findBlock(source, this.settings.remindersMarkerStart, this.settings.remindersMarkerEnd);
    const currentReminders = this.findBlock(currentContent, this.settings.remindersMarkerStart, this.settings.remindersMarkerEnd);
    const intoToday: Array<{ path: string; content: string }> = [];
    const deferred: Array<{ path: string; content: string }> = [];
    const lines: string[] = [];
    // A recorded copy never holds a live Operon task: the dated files, and the
    // previous note once its reminder has moved on, keep their Operon lines as
    // tombstones, so one `operonId` is never claimed twice. The copy someone
    // keeps working with is the live one — today's note for a reminder, the
    // source note itself for a miscellaneous note, which has no other home.
    if (this.settings.migrateNotes && sourceNotes?.content.trim()) {
      deferred.push({ path: this.settings.notesFile, content: await this.appendDatedBlock(this.settings.notesFile, "Notes", previous.date, tombstoneOperonLines(sourceNotes.content)) });
    }
    if (this.settings.migrateReminders && sourceReminders?.content.trim()) {
      // The dated marker is this migration's own record that the previous note
      // has already been carried. Running again the same day must change
      // nothing: re-injecting the block would overwrite the live copy today's
      // note already holds with the tombstones the source now keeps, and that
      // is the one way this could lose a task.
      const archive = this.app.vault.getAbstractFileByPath(this.settings.remindersFile);
      const archiveContent = archive instanceof TFile ? await this.app.vault.read(archive) : "";
      if (archiveContent.includes(this.datedMarker("Reminders", previous.date))) return { intoToday, deferred, lines, previous, reason: null };
      deferred.push({ path: this.settings.remindersFile, content: await this.appendDatedBlock(this.settings.remindersFile, "Reminders", previous.date, tombstoneOperonLines(sourceReminders.content)) });
      // What today's note receives is live material only: a line already marked
      // as carried forward is a record, not a reminder, and re-inserting it
      // would put the tombstone in the place the live task used to be.
      const live = sourceReminders.content.trim().split("\n")
        .filter((line) => !/^\s*- \[>\]/.test(line))
        .slice(0, this.settings.recentReminders)
        .map((line) => (this.settings.stampCreatedDate ? stampOperonStart(line, previous.date) : line));
      if (currentReminders !== null && live.length > 0) {
        const noteLines = currentContent.split("\n");
        const already = new Set(currentReminders.content.split("\n").map((line) => line.trim()));
        lines.push(...live.filter((line) => !already.has(line.trim())));
        noteLines.splice(currentReminders.start + 1, currentReminders.end - currentReminders.start - 1, ...live);
        intoToday.push({ path: current.file.path, content: noteLines.join("\n") });
      }
      const tombstoned = this.tombstoneOperonBlock(source, sourceReminders);
      if (tombstoned !== null) deferred.push({ path: previous.file.path, content: tombstoned });
    }
    return { intoToday, deferred, lines, previous, reason: null };
  }

  /**
   * The note with the Operon lines of one block turned into tombstones, or
   * `null` when it held none (nothing to write, and the note is left alone).
   */
  private tombstoneOperonBlock(content: string, block: MarkerBlock): string | null {
    const lines = content.split("\n");
    let touched = false;
    for (let i = block.start + 1; i < block.end; i += 1) {
      if (!isOperonLine(lines[i])) continue;
      lines[i] = tombstoneLine(lines[i]);
      touched = true;
    }
    return touched ? lines.join("\n") : null;
  }

  private async applyMaterialChanges(changes: Array<{ path: string; content: string }>): Promise<void> {
    for (const change of changes) {
      const file = this.app.vault.getAbstractFileByPath(change.path);
      if (file instanceof TFile) await this.app.vault.modify(file, change.content);
      else await this.app.vault.create(change.path, change.content);
    }
  }

  /** Options the weekly renderer needs, taken from this plugin's settings. */
  private weeklyRenderOptions(): WeeklyRenderOptions {
    return {
      taskTag: this.taskTag(),
      language: this.settings.weeklyLanguage,
      markers: {
        tasksStart: this.settings.tasksMarkerStart,
        tasksEnd: this.settings.tasksMarkerEnd,
        cancelledStart: this.settings.cancelledMarkerStart,
        cancelledEnd: this.settings.cancelledMarkerEnd,
      },
    };
  }

  /**
   * The daily notes of the week the most recent previous daily note belongs to,
   * ascending — the group the summary reports on. `null` when there is no
   * previous daily note, or when `requireNewWeek` is set and this note does not
   * open a new ISO week: the report answers "what happened in the last week you
   * actually worked on", so on the automatic path it belongs to the note that
   * opens a week, never to every note of that week.
   */
  private async previousWeekNotes(current: DailyNote, requireNewWeek: boolean): Promise<DailyNote[] | null> {
    const notes = await this.getDailyNotes();
    const previous = notes.find((note) => note.date < current.date);
    if (previous === undefined) return null;
    if (requireNewWeek && !isNewWeek(previous.date, current.date)) return null;
    const byDate = new Map(notes.map((note) => [note.date, note]));
    return weeklyGroup(previous.date, notes.map((note) => note.date))
      .map((date) => byDate.get(date))
      .filter((note): note is DailyNote => note !== undefined);
  }

  /**
   * Renders the previous week's summary, or `null` when there is nothing to
   * report (setting off, no previous daily note, or — on the automatic path —
   * the same week). Reading only the notes of that group is the whole point:
   * the vault is never swept.
   */
  private async weeklySummaryBody(current: DailyNote, requireNewWeek: boolean): Promise<string[] | null> {
    if (!this.settings.weeklySummary) return null;
    const notes = await this.previousWeekNotes(current, requireNewWeek);
    if (notes === null || notes.length === 0) return null;
    const inputs: WeeklyNoteInput[] = [];
    for (const note of notes) inputs.push({ date: note.date, content: await this.app.vault.read(note.file) });
    return buildWeeklySummary(inputs, this.weeklyRenderOptions());
  }

  /**
   * Decides, without writing, what the weekly step would do to today's note:
   *
   *  - `write`: a report is due and the block is untouched, so the report (with
   *    the template's heading carried over) goes in.
   *  - `tidy`: nothing is due — the setting is off, or this note does not open a
   *    new week, or there is no previous daily note — and the block is only a
   *    placeholder, so it is emptied. The template produces its heading on
   *    *every* daily note, and this is what keeps the section title from hanging
   *    empty on the days that have no report to show.
   *  - `none`: nothing to do (no block, or the block holds real content).
   *
   * A block holding anything beyond a heading and blank lines — a summary
   * already written, or text of your own — is never a placeholder, so it is
   * never emptied and never overwritten.
   */
  private async weeklyAction(current: DailyNote, requireNewWeek: boolean): Promise<WeeklyAction> {
    const content = await this.app.vault.read(current.file);
    const block = this.findBlock(content, this.settings.weeklyMarkerStart, this.settings.weeklyMarkerEnd);
    if (block === null) return { kind: "none" };
    const headings = weeklyPlaceholder(block.content);
    if (headings === null) return { kind: "none" };
    const report = await this.weeklySummaryBody(current, requireNewWeek);
    if (report !== null) return { kind: "write", body: composeWeeklyBody(headings, report), headline: report[0] };
    return headings.length === 0 ? { kind: "none" } : { kind: "tidy" };
  }

  /**
   * Applies the weekly action. `requireNewWeek` is set on the automatic path
   * (the report belongs to the note that opens a week); the manual commands pass
   * `false`, so you can also ask for it explicitly later.
   *
   * It runs *before* consolidation on purpose: consolidation moves the pending
   * tasks out of the previous week's notes, so reading them afterwards would
   * report "no pending tasks" for a week that did leave some open.
   */
  private async maybeWriteWeeklySummary(current: DailyNote, requireNewWeek: boolean): Promise<boolean> {
    const action = await this.weeklyAction(current, requireNewWeek);
    if (action.kind === "none") return false;
    // Re-read and re-verify just before writing, like every other write here.
    const content = await this.app.vault.read(current.file);
    const block = this.findBlock(content, this.settings.weeklyMarkerStart, this.settings.weeklyMarkerEnd);
    if (block === null || weeklyPlaceholder(block.content) === null) return false;
    if (action.kind === "write") {
      await this.app.vault.modify(current.file, spliceWeeklyBlock(content, block, action.body));
      return true;
    }
    console.info("Task Consolidator: the untouched weekly section was emptied.");
    await this.app.vault.modify(current.file, spliceWeeklyBlock(content, block, []));
    return false;
  }

  private async migratePreviousMaterial(): Promise<void> {
    const current = await this.currentDailyNote();
    if (current === null) { new Notice("Task Consolidator: today's daily note was not found."); return; }
    const material = await this.buildMaterialChanges(current);
    const { previous, reason } = material;
    if (reason !== null) { new Notice(`Task Consolidator: ${reason}`); return; }
    // The manual command applies everything at once: you asked for it, and no
    // automatic run is in flight that a template could be racing with.
    const changes = [...material.intoToday, ...material.deferred];
    if (changes.length === 0) { new Notice("Task Consolidator: no notes or reminders to migrate."); return; }
    new ConfirmationModal(this.app, `Apply ${changes.length} Markdown change(s) from ${previous!.date}?`, async () => {
      await this.applyMaterialChanges(changes);
      new Notice("Task Consolidator: notes and reminders migrated.");
      await this.reportOperonAfterChange();
    }).open();
  }

  /**
   * Automatic entry point used when today's daily note is created. Runs without
   * confirmation: migrates notes/reminders from the previous note, writes the
   * previous week's summary when this note opens a new week (and only then), and
   * consolidates pending and cancelled tasks. The summary is built before the
   * tasks move, so the previous week's pending work is still where it was.
   * Every sub-operation re-reads its files and is idempotent, so even a repeated
   * run converges to the same result.
   *
   * Only today's note is written here. The records, the tombstones and the
   * "moved" markers wait until the note has been verified to still hold what was
   * inserted (see applyConsolidation): the daily note is written twice when both
   * the periodic-notes plugin and a Templater file template apply the daily
   * template, and marking a source on the strength of a copy that a second write
   * removed is how a task ends up with no live copy anywhere.
   */
  private async runAutomaticConsolidation(): Promise<void> {
    const current = await this.currentDailyNote();
    if (current === null) return;
    const currentContent = await this.app.vault.read(current.file);
    if (this.validateManagedBlocks(currentContent).length > 0) {
      console.info("Task Consolidator: automatic run skipped; managed markers missing.");
      return;
    }
    const material = await this.buildMaterialChanges(current);
    await this.applyMaterialChanges(material.intoToday);
    const weeklyWritten = await this.maybeWriteWeeklySummary(current, true);
    const notes = (await this.getDailyNotes()).filter((note) => note.date < current.date).slice(0, this.settings.daysToScan);
    const pending = await this.planMoves(notes, "pending");
    const cancelled = this.settings.includeCancelled ? await this.planMoves(notes, "cancelled") : this.emptyResult();
    if (pending.moves.length === 0 && cancelled.moves.length === 0 && material.intoToday.length === 0) {
      new Notice(`Task Consolidator: automatic run finished; nothing to migrate or consolidate.${weeklyWritten ? " A weekly summary of the previous week was written." : ""}`);
      return;
    }
    await this.applyConsolidation(current, pending, cancelled, weeklyWritten, { changes: material.deferred, lines: material.lines });
  }

  /**
   * Vault-event guard: only reacts to today's daily note, only when the managed
   * markers are already present (i.e. the template has been applied), and only
   * once per day.
   *
   * The run is not scheduled a fixed time after the first event: every further
   * write to the note pushes it back, so it lands after the last writer. A daily
   * note is normally written more than once — the periodic-notes plugin applies
   * the daily template, and a Templater file template whose regex matches the
   * note's path applies that same template again a few seconds later — and
   * consolidating between the two writes is how the note ends up overwritten
   * after having been consolidated. The wait has a ceiling, so a note you are
   * typing in cannot postpone the run forever.
   */
  private async maybeAutoConsolidate(file: TFile): Promise<void> {
    if (!this.settings.autoConsolidate || this.autoRunning || file.extension !== "md") return;
    const today = window.moment().format("YYYY-MM-DD");
    if (this.autoRanToday === today) return;
    const current = await this.currentDailyNote();
    if (current === null || file.path !== current.file.path) return;
    const content = await this.app.vault.read(file);
    if (this.validateManagedBlocks(content).length > 0) return;
    this.armAutoRun(today);
  }

  /** Arms the automatic run for when today's note has been quiet long enough. */
  private armAutoRun(today: string): void {
    const now = Date.now();
    if (this.autoArmedAt === 0) this.autoArmedAt = now;
    const delay = autoRunDelay(this.autoArmedAt, now);
    if (this.autoTimer !== null) window.clearTimeout(this.autoTimer);
    this.autoTimer = window.setTimeout(() => {
      this.autoTimer = null;
      this.autoArmedAt = 0;
      this.autoRanToday = today;
      this.autoRunning = true;
      this.runAutomaticConsolidation()
        .catch((error) => console.error("Task Consolidator: automatic run failed", error))
        .finally(() => { this.autoRunning = false; });
    }, delay);
  }

  /**
   * Optional Operon follow-up after a successful consolidation. Operon keeps
   * its index current on its own from vault events; this only adds a safety-net
   * full reindex when the user enabled the setting and the command exists.
   */
  private async reportOperonAfterChange(): Promise<void> {
    const operon = await operonInfo(this);
    if (!operon.present) return;
    if (this.settings.refreshOperonIndex) {
      const refreshed = await requestOperonReindex(this);
      new Notice(refreshed ? "Task Consolidator: Operon index rebuild requested." : "Task Consolidator: could not trigger Operon's index rebuild; run Rebuild full index manually if tasks look stale.");
    } else {
      console.info("Task Consolidator: Operon detected after consolidation; its index updates automatically from vault events.", operon);
    }
  }

  /** The dated marker that records one block of one daily note as archived. */
  private datedMarker(kind: string, date: string): string {
    return `<!-- task-consolidator:${kind.toLowerCase()}:${date} -->`;
  }

  private async appendDatedBlock(path: string, kind: string, date: string, body: string): Promise<string> {
    const existing = this.app.vault.getAbstractFileByPath(path);
    const content = existing instanceof TFile ? await this.app.vault.read(existing) : "";
    const marker = this.datedMarker(kind, date);
    if (content.includes(marker)) return content;
    return `${content.trimEnd()}${content.trim() ? "\n\n" : ""}${marker}\n## ${kind} from ${date}\n${body.trim()}\n`;
  }

  private async archiveOldDailyNotes(): Promise<void> {
    const notes = await this.getDailyNotes(), keepPaths = new Set(notes.slice(0, Math.max(0, this.settings.maxDailyNotes)).map((note) => note.file.path));
    const old = notes.filter((note) => !keepPaths.has(note.file.path));
    if (old.length === 0) { new Notice("Task Consolidator: no daily notes need archiving."); return; }
    const destination = this.settings.archiveFolder.replace(/\/+$/, "");
    if (!this.app.vault.getAbstractFileByPath(destination)) await this.app.vault.createFolder(destination);
    for (const note of old) if (this.app.vault.getAbstractFileByPath(`${destination}/${note.file.name}`)) { new Notice(`Task Consolidator: archive collision; stopped at ${destination}/${note.file.name}.`); return; }
    for (const note of old) await this.app.vault.rename(note.file, `${destination}/${note.file.name}`);
    new Notice(`Task Consolidator: archived ${old.length} daily note(s).`);
  }
}

class ConfirmationModal extends Modal {
  constructor(app: App, private message: string, private onConfirm: () => Promise<void>) { super(app); }
  onOpen(): void {
    this.contentEl.createEl("p", { text: this.message });
    new Setting(this.contentEl).addButton((button) => button.setButtonText("Cancel").onClick(() => this.close())).addButton((button) => button.setCta().setButtonText("Apply").onClick(async () => { button.setDisabled(true); try { await this.onConfirm(); this.close(); } catch (error) { console.error("Task Consolidator", error); new Notice("Task Consolidator: operation failed; no further changes were attempted."); button.setDisabled(false); } }));
  }
  onClose(): void { this.contentEl.empty(); }
}

class TaskConsolidatorSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: TaskConsolidatorPlugin) { super(app, plugin); }
  display(): void {
    const { containerEl } = this; containerEl.empty(); containerEl.createEl("h2", { text: "Task Consolidator" });
    const path = (name: string, description: string, key: keyof TaskConsolidatorSettings) => new Setting(containerEl).setName(name).setDesc(description).addText((text) => text.setValue(String(this.plugin.settings[key])).onChange(async (value) => { this.plugin.settings[key] = value as never; await this.plugin.saveSettings(); }));
    path("Daily notes folder", "Folder containing YYYY-MM-DD daily notes.", "dailyNotesFolder"); path("Archive folder", "Destination for archived daily notes.", "archiveFolder"); path("Reminders file", "Markdown file for migrated reminders.", "remindersFile"); path("Notes file", "Markdown file for migrated miscellaneous notes.", "notesFile");
    new Setting(containerEl).setName("Previous notes to scan").setDesc("Maximum number of previous daily notes (not days) to review for pending tasks, most recent first (3–30).").addText((text) => text.setValue(String(this.plugin.settings.daysToScan)).onChange(async (value) => { const n = Math.floor(Number(value)); if (Number.isFinite(n)) { this.plugin.settings.daysToScan = Math.min(30, Math.max(3, n)); await this.plugin.saveSettings(); } }));
    new Setting(containerEl).setName("Maximum daily notes").setDesc("How many daily notes to keep before the oldest are archived when archiving runs (3–30).").addText((text) => text.setValue(String(this.plugin.settings.maxDailyNotes)).onChange(async (value) => { const n = Math.floor(Number(value)); if (Number.isFinite(n)) { this.plugin.settings.maxDailyNotes = Math.min(30, Math.max(3, n)); await this.plugin.saveSettings(); } }));
    new Setting(containerEl).setName("Automatic archiving").addToggle((toggle) => toggle.setValue(this.plugin.settings.autoArchive).onChange(async (value) => { this.plugin.settings.autoArchive = value; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Run automatically when today's note is created").setDesc("When today's daily note is created with the managed markers, automatically consolidate pending and cancelled tasks and migrate reminders and notes from the previous note. Runs at most once per day.").addToggle((toggle) => toggle.setValue(this.plugin.settings.autoConsolidate).onChange(async (value) => { this.plugin.settings.autoConsolidate = value; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Weekly summary of the previous week").setDesc("When the first daily note of a new week is created, write a report of the previous week's daily notes (pending, completed and cancelled tasks) inside the weekly marker block. The report is inert — no checkboxes, no task metadata, no task tag — so it is never consolidated. The template's heading is carried over, and whenever no report is due — the other days of the week, or this setting being off — the untouched section is emptied, so the template's heading never hangs empty in the note. An existing summary, or text of your own, is never overwritten.").addToggle((toggle) => toggle.setValue(this.plugin.settings.weeklySummary).onChange(async (value) => { this.plugin.settings.weeklySummary = value; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Weekly summary language").setDesc("Language of the weekly summary text. Task lines are copied verbatim in whatever language you wrote them.").addDropdown((dropdown) => dropdown.addOption("es", "Español").addOption("en", "English").setValue(this.plugin.settings.weeklyLanguage).onChange(async (value) => { this.plugin.settings.weeklyLanguage = value === "en" ? "en" : "es"; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Include cancelled tasks").setDesc("Move tasks marked cancelled (- [-]) from previous notes into today's '## Tareas canceladas' block. Completed tasks (- [x]) are never moved.").addToggle((toggle) => toggle.setValue(this.plugin.settings.includeCancelled).onChange(async (value) => { this.plugin.settings.includeCancelled = value; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Task tag").setDesc("Tag appended to migrated pending task lines that do not carry it yet (e.g. #task). Leave empty to add no tag.").addText((text) => text.setValue(this.plugin.settings.taskTag).onChange(async (value) => { this.plugin.settings.taskTag = value.trim(); await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Carry the source date onto migrated tasks").setDesc("Record the day a task came from on the line carried into today's note: a plain task gets ' ➕ YYYY-MM-DD' (unless it already has a ➕ date) and an Operon task with no start date gets '{{dateStarted:: YYYY-MM-DD}}'. Tasks that already carry their own date are left untouched.").addToggle((toggle) => toggle.setValue(this.plugin.settings.stampCreatedDate).onChange(async (value) => { this.plugin.settings.stampCreatedDate = value; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Migrate miscellaneous notes").addToggle((toggle) => toggle.setValue(this.plugin.settings.migrateNotes).onChange(async (value) => { this.plugin.settings.migrateNotes = value; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Migrate reminders").addToggle((toggle) => toggle.setValue(this.plugin.settings.migrateReminders).onChange(async (value) => { this.plugin.settings.migrateReminders = value; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Recent reminders").addText((text) => text.setValue(String(this.plugin.settings.recentReminders)).onChange(async (value) => { const n = Number(value); if (Number.isFinite(n) && n >= 0) { this.plugin.settings.recentReminders = Math.floor(n); await this.plugin.saveSettings(); } }));
    new Setting(containerEl).setName("Refresh Operon index after consolidating").setDesc("Only applies when Operon is enabled. Operon normally keeps its index current on its own from vault events; enable this as a safety net that runs its read-only \"Rebuild full index\" after each consolidation.").addToggle((toggle) => toggle.setValue(this.plugin.settings.refreshOperonIndex).onChange(async (value) => { this.plugin.settings.refreshOperonIndex = value; await this.plugin.saveSettings(); }));
  }
}
