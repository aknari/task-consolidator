interface HTMLElement {
    empty(): void;
    createEl(tag: string, options?: { text?: string }): HTMLElement;
}

declare module "obsidian" {
  export class App { vault: Vault; plugins: Plugins; commands: Commands; }
  export class Plugins { getPlugin(id: string): unknown; }
  export class Commands { executeCommandById(id: string): Promise<void>; commands: Record<string, unknown>; }
  export class Vault {
    getMarkdownFiles(): TFile[];
    getAbstractFileByPath(path: string): TAbstractFile | null;
    read(file: TFile): Promise<string>;
    modify(file: TFile, data: string): Promise<void>;
    create(path: string, data: string): Promise<TFile>;
    createFolder(path: string): Promise<void>;
    rename(file: TAbstractFile, newPath: string): Promise<void>;
    on(event: "create", callback: (file: TFile) => unknown): unknown;
    on(event: "modify", callback: (file: TFile) => unknown): unknown;
    on(event: "rename", callback: (file: TAbstractFile, oldPath: string) => unknown): unknown;
  }
  export class TAbstractFile { path: string; name: string; }
  export class TFile extends TAbstractFile { basename: string; extension: string; }
  export class Plugin {
    app: App;
    addCommand(command: { id: string; name: string; callback: () => void }): void;
    addSettingTab(tab: PluginSettingTab): void;
    loadData(): Promise<unknown>;
    saveData(data: unknown): Promise<void>;
    registerEvent(eventRef: unknown): void;
  }
  export class PluginSettingTab { constructor(app: App, plugin: Plugin); containerEl: HTMLElement; }
  export class Setting {
    constructor(containerEl: HTMLElement);
    setName(name: string): this;
    setDesc(desc: string): this;
    addText(callback: (component: TextComponent) => unknown): this;
    addToggle(callback: (component: ToggleComponent) => unknown): this;
    addButton(callback: (component: ButtonComponent) => unknown): this;
  }
  export class TextComponent { setValue(value: string): this; onChange(callback: (value: string) => void | Promise<void>): this; }
  export class ToggleComponent { setValue(value: boolean): this; onChange(callback: (value: boolean) => void | Promise<void>): this; }
  export class ButtonComponent { setButtonText(text: string): this; setCta(): this; setDisabled(value: boolean): this; onClick(callback: () => void | Promise<void>): this; }
  export class Modal { constructor(app: App); contentEl: HTMLElement; open(): void; close(): void; }
  export class Notice { constructor(message: string); }
}

declare interface Window { moment(): { format(format: string): string }; setTimeout(callback: () => void, ms: number): number; }
declare const window: Window;
