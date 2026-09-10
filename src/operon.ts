import { Plugin } from "obsidian";

/**
 * Optional Operon integration.
 *
 * Operon is deliberately NOT a dependency. Everything here is duck-typed
 * against the live Operon plugin instance and fails closed with a clean
 * "not present" result when Operon is missing, disabled, or on an unknown
 * version. The plugin never calls into Operon internals: the only public
 * surfaces used are the documented in-process Developer API accessor and
 * Obsidian's own command registry.
 */

const OPERON_PLUGIN_ID = "operon";
/** Operon's registered command id for the read-only "Rebuild full index". */
const OPERON_REBUILD_COMMAND = "operon:rebuild-index";

interface OperonAccessRequest {
  contractVersion: 1;
  runtimeApi: { min: 1; max: 1 };
  requestedCapabilities: readonly string[];
}

interface OperonDeveloperApiAccessor {
  getDeveloperApiV1?(consumer: object, request: OperonAccessRequest): unknown;
}

interface OperonSessionResult {
  ok?: boolean;
  error?: { code?: string; action?: string };
  api?: {
    system?: {
      health?(): unknown | Promise<unknown>;
    };
  };
}

interface OperonHealthPayload {
  ok?: boolean;
  error?: { code?: string; action?: string; reason?: string };
  lifecyclePhase?: string;
  freshness?: { settled?: boolean; coherence?: string };
  admission?: { reads?: unknown; writes?: unknown };
  [key: string]: unknown;
}

export interface OperonInfo {
  /** Whether the Operon plugin is enabled and exposes its Developer API. */
  present: boolean;
  /** Runtime readiness: true when settled, false when still settling, null when unknown. */
  ready: boolean | null;
  /** Human-readable summary for notices and logs. */
  detail: string;
}

/** Returns the live Operon plugin instance when it exposes its accessor. */
export function operonPlugin(plugin: Plugin): OperonDeveloperApiAccessor | undefined {
  const candidate = plugin.app.plugins.getPlugin(OPERON_PLUGIN_ID) as OperonDeveloperApiAccessor | undefined;
  return candidate !== undefined && typeof candidate.getDeveloperApiV1 === "function" ? candidate : undefined;
}

/**
 * Reports whether Operon is present and whether its Runtime is ready, using
 * only the grant-free discovery session (system.health + system.capabilities).
 * Never throws: every failure path degrades to a structured result.
 */
export async function operonInfo(plugin: Plugin): Promise<OperonInfo> {
  const operon = operonPlugin(plugin);
  if (operon === undefined) {
    return { present: false, ready: null, detail: "Operon is not enabled." };
  }
  try {
    const access = operon.getDeveloperApiV1!(plugin, {
      contractVersion: 1,
      runtimeApi: { min: 1, max: 1 },
      requestedCapabilities: ["system.health", "system.capabilities"],
    }) as OperonSessionResult | undefined;
    if (access === undefined || access.ok !== true || access.api?.system?.health === undefined) {
      const code = access?.error?.code ?? "access-refused";
      return { present: true, ready: null, detail: `Operon is enabled but the discovery session was refused (${code}).` };
    }
    const health = (await access.api.system.health()) as OperonHealthPayload;
    const readsAdmitted = health.admission?.reads === true || health.admission?.reads === "admitted";
    // Operon computes freshness.settled itself (phase "ready" and no error);
    // when that field is absent we fall back to the lifecycle phase and reads.
    const settled = health.freshness?.settled === true || health.lifecyclePhase === "ready" || (health.ok === true && readsAdmitted);
    const explicitlySettling = health.freshness?.settled === false || (health.lifecyclePhase !== undefined && health.lifecyclePhase !== "ready");
    return {
      present: true,
      ready: settled ? true : explicitlySettling ? false : null,
      detail: settled
        ? "Operon is enabled and its Runtime is ready."
        : explicitlySettling
          ? "Operon is enabled but its Runtime is still settling; its views may lag briefly."
          : "Operon is enabled, but its Runtime readiness could not be determined.",
    };
  } catch (error) {
    console.warn("Task Consolidator: Operon health check failed.", error);
    return { present: true, ready: null, detail: "Operon is enabled, but its Runtime did not answer the health check." };
  }
}

/**
 * Triggers Operon's read-only "Rebuild full index" command through Obsidian's
 * public command registry. Returns true only when the command existed and
 * executed without throwing. Safe to call with Operon absent: returns false.
 */
export async function requestOperonReindex(plugin: Plugin): Promise<boolean> {
  if (operonPlugin(plugin) === undefined) return false;
  const commands = plugin.app.commands;
  if (typeof commands.executeCommandById !== "function") return false;
  if (commands.commands !== undefined && !(OPERON_REBUILD_COMMAND in commands.commands)) return false;
  try {
    await commands.executeCommandById(OPERON_REBUILD_COMMAND);
    return true;
  } catch (error) {
    console.warn("Task Consolidator: could not trigger Operon's index rebuild.", error);
    return false;
  }
}
