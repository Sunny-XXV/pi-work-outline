import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentDir, withFileMutationQueue, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadWorkOutlineSettings } from "./src/settings.ts";
import { configuredOutlinePath, findBranchState, resolveOutlinePath, type WorkOutlineState } from "./src/state.ts";
import { captureOutlineSnapshot, INITIAL_OUTLINE, resolveHistoryOutline, restoreOutlineFile, SNAPSHOT_TYPE } from "./src/history.ts";
import { describeRenderMode, startTmuxRenderer, stopTmuxRenderer, tmuxPaneExists, type RenderMode } from "./src/tmux.ts";
import { WorkOutlineComponent, WorkOutlineViewerComponent } from "./src/widget.ts";

const EXTENSION_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROMPT = fs.readFileSync(path.join(EXTENSION_DIR, "prompt.md"), "utf8").trim();
const TMUX_RENDERER = path.join(EXTENSION_DIR, "bin", "tmux-renderer.mjs");
const WIDGET_KEY = "work-outline";
const PROMPT_SECTION_KEY = "work_outline_observer";

function ensureOutline(outlinePath: string): void {
	fs.mkdirSync(path.dirname(outlinePath), { recursive: true });
	try {
		fs.writeFileSync(outlinePath, INITIAL_OUTLINE, { encoding: "utf8", flag: "wx" });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
	}
}

export default function workOutlineExtension(pi: ExtensionAPI): void {
	let enabled = false;
	let outlinePath: string | undefined;
	let renderMode: RenderMode | undefined;
	let tmuxPaneId: string | undefined;
	let tmuxOwnerId: string | undefined;
	let historyReady = false;
	let needsFreshOutline = false;
	let restoreContent: string | undefined;
	let pendingRestoreReason: string | undefined;

	function defaultOutlinePath(ctx: ExtensionContext): string {
		return path.join(getAgentDir(), "state", "work-outlines", `${ctx.sessionManager.getSessionId()}.md`);
	}

	async function checkpoint(ctx: ExtensionContext): Promise<void> {
		if (!historyReady || !outlinePath) return;
		const selectedPath = outlinePath;
		await withFileMutationQueue(selectedPath, async () => {
			captureOutlineSnapshot({
				entries: ctx.sessionManager.getBranch(),
				sessionId: ctx.sessionManager.getSessionId(),
				outlinePath: selectedPath,
				defaultPath: defaultOutlinePath(ctx),
				append: (type, data) => pi.appendEntry(type, data),
			});
		});
	}

	async function tryCheckpoint(ctx: ExtensionContext): Promise<boolean> {
		try {
			await checkpoint(ctx);
			return true;
		} catch (error) {
			ctx.ui.notify(`Could not save outline history: ${error instanceof Error ? error.message : String(error)}`, "error");
			return false;
		}
	}

	function showWidget(ctx: ExtensionContext): void {
		if (!enabled || !outlinePath || ctx.mode !== "tui" || !ctx.hasUI) return;
		const selectedPath = outlinePath;
		ctx.ui.setWidget(WIDGET_KEY, (tui, theme) => new WorkOutlineComponent(tui, theme, selectedPath));
	}

	function clearRenderer(ctx: ExtensionContext): boolean {
		if (ctx.mode === "tui" && ctx.hasUI) ctx.ui.setWidget(WIDGET_KEY, undefined);
		if (tmuxPaneId && !stopTmuxRenderer(tmuxPaneId, tmuxOwnerId)) return false;
		renderMode = undefined;
		tmuxPaneId = undefined;
		tmuxOwnerId = undefined;
		return true;
	}

	function startRenderer(ctx: ExtensionContext): void {
		if (!clearRenderer(ctx)) {
			ctx.ui.notify("Could not close the previous tmux outline pane; not opening a duplicate renderer.", "warning");
			return;
		}
		if (ctx.mode !== "tui" || !ctx.hasUI || !outlinePath) return;

		const settings = loadWorkOutlineSettings({
			agentDir: getAgentDir(),
			cwd: ctx.cwd,
			projectTrusted: ctx.isProjectTrusted(),
		});
		if (settings.renderer !== "widget") {
			tmuxOwnerId = `${ctx.sessionManager.getSessionId()}:${process.pid}`;
			const tmuxResult = startTmuxRenderer(
				outlinePath,
				tmuxOwnerId,
				TMUX_RENDERER,
				settings.tmuxPanePercent,
			);
			if (tmuxResult.paneId) {
				tmuxPaneId = tmuxResult.paneId;
				renderMode = "tmux";
				return;
			}
			if (tmuxResult.residualPaneId) {
				tmuxPaneId = tmuxResult.residualPaneId;
				if (!tmuxResult.residualOwned) tmuxOwnerId = undefined;
				renderMode = "tmux";
				ctx.ui.notify(`Could not initialize or close the tmux outline pane: ${tmuxResult.error}`, "error");
				return;
			}
			tmuxOwnerId = undefined;
			if (tmuxResult.attempted && tmuxResult.error) {
				ctx.ui.notify(`Could not open tmux outline pane; using widget: ${tmuxResult.error}`, "warning");
			}
		}

		renderMode = "widget";
		showWidget(ctx);
	}

	function persistState(): void {
		pi.appendEntry<WorkOutlineState>("work-outline-state", { enabled, outlinePath });
	}

	async function enable(ctx: ExtensionContext, persist: boolean): Promise<void> {
		outlinePath = resolveOutlinePath(pi, ctx, outlinePath);
		await withFileMutationQueue(outlinePath, async () => {
			if (restoreContent !== undefined) restoreOutlineFile(outlinePath!, restoreContent);
			else if (needsFreshOutline) restoreOutlineFile(outlinePath!, INITIAL_OUTLINE);
			else ensureOutline(outlinePath!);
		});
		needsFreshOutline = false;
		restoreContent = undefined;
		historyReady = true;
		await checkpoint(ctx);
		enabled = true;
		if (persist) persistState();
		startRenderer(ctx);
	}

	async function disable(ctx: ExtensionContext, persist: boolean): Promise<boolean> {
		if (!(await tryCheckpoint(ctx))) return false;
		if (!clearRenderer(ctx)) {
			ctx.ui.notify("Could not close the tmux outline pane; the outline remains enabled.", "error");
			return false;
		}
		enabled = false;
		if (persist) persistState();
		return true;
	}

	async function restoreFromBranch(ctx: ExtensionContext, reason: string): Promise<void> {
		pendingRestoreReason = reason;
		const restored = findBranchState(ctx);
		const forked = reason === "fork" || Boolean(ctx.sessionManager.getHeader()?.parentSession);
		const selection = resolveHistoryOutline({
			entries: ctx.sessionManager.getBranch(),
			sessionId: ctx.sessionManager.getSessionId(),
			defaultPath: defaultOutlinePath(ctx),
			configuredPath: configuredOutlinePath(ctx.cwd),
			restoredPath: restored?.outlinePath,
			forked,
		});

		if (!clearRenderer(ctx)) {
			historyReady = false;
			ctx.ui.notify("Could not close the previous tmux outline pane; branch renderer restoration was skipped.", "error");
			return;
		}
		enabled = false;
		historyReady = false;
		outlinePath = selection.outlinePath;
		// Other branches are checked only to distinguish legacy sessions from a
		// historical point before snapshots. Never restore their content.
		const alreadyVersioned = ctx.sessionManager.getEntries().some((entry) =>
			entry.type === "custom" && entry.customType === SNAPSHOT_TYPE
			&& (entry.data as { outlinePath?: unknown } | undefined)?.outlinePath === selection.outlinePath);
		needsFreshOutline = !selection.snapshot && (alreadyVersioned || reason === "tree"
			|| selection.migrated || forked || reason === "new");
		restoreContent = selection.snapshot?.content;
		if (!restored) {
			pendingRestoreReason = undefined;
			return;
		}

		try {
			await withFileMutationQueue(outlinePath, async () => {
				if (selection.snapshot) restoreOutlineFile(outlinePath!, selection.snapshot.content);
				else if (needsFreshOutline) restoreOutlineFile(outlinePath!, INITIAL_OUTLINE);
				else ensureOutline(outlinePath!); // Import one legacy baseline at its current leaf only.
			});
			needsFreshOutline = false;
			restoreContent = undefined;
			historyReady = true;
			await checkpoint(ctx);
			enabled = restored.enabled;
			if (selection.migrated) persistState();
			pendingRestoreReason = undefined;
			if (!selection.snapshot && (alreadyVersioned || reason === "tree" || selection.migrated || forked)) {
				ctx.ui.notify("No outline snapshot exists at this historical point; started a fresh outline instead of using newer branch content.", "warning");
			}
			if (enabled) startRenderer(ctx);
		} catch (error) {
			historyReady = false;
			ctx.ui.notify(`Could not restore outline history; observer disabled: ${error instanceof Error ? error.message : String(error)}`, "error");
		}
	}

	pi.on("session_start", async (event, ctx) => restoreFromBranch(ctx, event.reason));
	pi.on("session_tree", async (_event, ctx) => restoreFromBranch(ctx, "tree"));
	pi.on("session_before_tree", async (_event, ctx) => {
		if (!(await tryCheckpoint(ctx))) return { cancel: true };
	});
	pi.on("session_before_fork", async (_event, ctx) => {
		if (!(await tryCheckpoint(ctx))) return { cancel: true };
	});
	pi.on("session_before_switch", async (_event, ctx) => {
		if (!(await tryCheckpoint(ctx))) return { cancel: true };
	});
	// Pi persists each message after message_end handlers. Capturing here makes a
	// changed outline an ancestor of that response/tool result, so selecting the
	// visible response in /tree also includes its snapshot (not just turn end).
	pi.on("message_end", async (event, ctx) => {
		if (enabled && (event.message.role === "assistant" || event.message.role === "toolResult")) {
			await tryCheckpoint(ctx);
		}
	});
	pi.on("agent_before_settle", async (_event, ctx) => { await tryCheckpoint(ctx); });

	pi.on("before_agent_start", async (event) => {
		if (!enabled || !historyReady || !outlinePath) {
			delete event.systemPromptOptions.sections[PROMPT_SECTION_KEY];
			return;
		}
		event.systemPromptOptions.sections[PROMPT_SECTION_KEY] =
			`${PROMPT}\n\n## Active observer file\n\nUse exactly this absolute path: ${JSON.stringify(outlinePath)}.`;
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		await tryCheckpoint(ctx);
		clearRenderer(ctx);
		enabled = false;
		historyReady = false;
		outlinePath = undefined;
	});

	pi.registerCommand("work-outline", {
		description: "Enable, disable, view, or show the live work outline",
		handler: async (args, ctx) => {
			const action = args.trim().toLowerCase();
			if (action === "off" || action === "disable") {
				if (await disable(ctx, true)) ctx.ui.notify("Work outline disabled for this session.", "info");
				return;
			}
			if (action && action !== "on" && action !== "enable" && action !== "status" && action !== "view") {
				ctx.ui.notify("Usage: /work-outline [on|off|status|view]", "warning");
				return;
			}
			if (pendingRestoreReason) {
				if (action === "status" || action === "view") {
					ctx.ui.notify("Outline history restoration is incomplete. Run /work-outline on to retry it.", "warning");
					return;
				}
				await restoreFromBranch(ctx, pendingRestoreReason);
				if (pendingRestoreReason) return;
			}
			if (!enabled && action !== "status" && action !== "view") await enable(ctx, true);
			if (!enabled || !outlinePath) {
				ctx.ui.notify("Work outline is disabled. Run /work-outline to enable it.", "info");
				return;
			}
			const tmuxPaneMissing = renderMode === "tmux" && (!tmuxPaneId || !tmuxPaneExists(tmuxPaneId));
			if (action === "status" && tmuxPaneMissing) {
				ctx.ui.notify(
					`Work outline is enabled, but its tmux pane is missing. Run /work-outline on to repair it: ${outlinePath}`,
					"warning",
				);
				return;
			}
			if ((action === "on" || action === "enable" || !action) && tmuxPaneMissing) {
				tmuxPaneId = undefined;
				tmuxOwnerId = undefined;
				renderMode = undefined;
				startRenderer(ctx);
			}
			if (action === "view") {
				if (ctx.mode !== "tui" || !ctx.hasUI) {
					ctx.ui.notify("The outline viewer requires interactive TUI mode.", "warning");
					return;
				}
				const selectedPath = outlinePath;
				await ctx.ui.custom<void>((tui, theme, _keybindings, done) =>
					new WorkOutlineViewerComponent(tui, theme, selectedPath, done));
				return;
			}
			ctx.ui.notify(
				`Work outline enabled in ${describeRenderMode(renderMode, tmuxPaneId)}: ${outlinePath}`,
				"info",
			);
		},
	});
}
