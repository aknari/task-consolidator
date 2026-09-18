/**
 * A stand-in for the `obsidian` module, just wide enough to drive `main.ts`
 * without the app. The integration test bundles with
 * `--alias:obsidian=./test/obsidian-mock.ts`, so `import … from "obsidian"`
 * inside the plugin resolves here.
 *
 * What it deliberately provides:
 *  - an in-memory vault (`MockVault`), with an `onWrite` hook so a test can make
 *    a *second* writer — a template being applied again — race the plugin;
 *  - the `Notice` sink, so a test can assert on what you would have been told;
 *  - no-ops for everything the plugin registers at load time.
 */

/** Every message a `new Notice(...)` produced, in order. */
export const notices: string[] = [];

export function resetNotices(): void {
  notices.length = 0;
}

export class TAbstractFile {
  path: string;
  name: string;

  constructor(path: string) {
    this.path = path;
    this.name = path.split("/").pop() ?? path;
  }
}

export class TFile extends TAbstractFile {
  basename: string;
  extension: string;

  constructor(path: string) {
    super(path);
    const dot = this.name.lastIndexOf(".");
    this.extension = dot < 0 ? "" : this.name.slice(dot + 1);
    this.basename = dot < 0 ? this.name : this.name.slice(0, dot);
  }
}

/** An in-memory vault. */
export class MockVault {
  private contents = new Map<string, string>();
  private files = new Map<string, TFile>();

  /**
   * Called after every write made *through the vault API*. Writes made with
   * `seed` do not notify, which is how a test plays the part of a writer that
   * the plugin did not ask for.
   */
  onWrite: ((path: string) => void) | null = null;

  /** Puts a file in the vault without notifying `onWrite`. */
  seed(path: string, content: string): void {
    this.files.set(path, new TFile(path));
    this.contents.set(path, content);
  }

  content(path: string): string {
    return this.contents.get(path) ?? "";
  }

  getMarkdownFiles(): TFile[] {
    return [...this.files.values()].filter((file) => file.extension === "md");
  }

  getAbstractFileByPath(path: string): TFile | null {
    return this.files.get(path) ?? null;
  }

  async read(file: TFile): Promise<string> {
    return this.content(file.path);
  }

  async modify(file: TFile, data: string): Promise<void> {
    this.write(file.path, data);
  }

  async create(path: string, data: string): Promise<TFile> {
    const file = new TFile(path);
    this.files.set(path, file);
    this.write(path, data);
    return file;
  }

  async createFolder(): Promise<void> {
    // Folders are implied by the paths in memory.
  }

  async rename(file: TAbstractFile, newPath: string): Promise<void> {
    const content = this.content(file.path);
    this.files.delete(file.path);
    this.contents.delete(file.path);
    file.path = newPath;
    this.files.set(newPath, new TFile(newPath));
    this.contents.set(newPath, content);
  }

  on(): unknown {
    // The integration test calls into the plugin directly, so no events are
    // needed; registering must simply not throw.
    return null;
  }

  private write(path: string, content: string): void {
    this.contents.set(path, content);
    this.onWrite?.(path);
  }
}

/** The slice of `App` the plugin touches. */
export function createApp(vault: MockVault): any {
  return {
    vault,
    plugins: { getPlugin: () => undefined },
    commands: { executeCommandById: async () => undefined, commands: {} },
  };
}

export class Notice {
  constructor(message: string) {
    notices.push(message);
  }
}

export class Modal {
  constructor(_app: unknown) {}
  open(): void {}
  close(): void {}
}

export class Setting {
  constructor(_containerEl: unknown) {}
  setName(): this { return this; }
  setDesc(): this { return this; }
  addText(): this { return this; }
  addToggle(): this { return this; }
  addDropdown(): this { return this; }
  addButton(): this { return this; }
}

export class PluginSettingTab {
  containerEl = { empty(): void {}, createEl(): unknown { return {}; } };
  constructor(_app: unknown, _plugin: unknown) {}
}

export class Plugin {
  app: unknown;
  constructor(app: unknown) {
    this.app = app;
  }
  addCommand(): void {}
  addSettingTab(): void {}
  registerEvent(): void {}
  async loadData(): Promise<unknown> { return {}; }
  async saveData(): Promise<void> {}
}
