import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadWorkOutlineSettings } from "./src/settings.ts";
import { findBranchState, resolveOutlinePath, type WorkOutlineState } from "./src/state.ts";
import { describeRenderMode, startTmuxRenderer, stopTmuxRenderer, type RenderMode } from "./src/tmux.ts";
import { WorkOutlineComponent, WorkOutlineViewerComponent } from "./src/widget.ts";

const EXTENSION_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROMPT = fs.readFileSync(path.join(EXTENSION_DIR, "prompt.md"), "utf8").trim();
const TMUX_RENDERER = path.join(EXTENSION_DIR, "bin", "tmux-renderer.mjs");
const WIDGET_KEY = "work-outline";
const PROMPT_SECTION_KEY = "work_outline_observer";

function ensureOutline(outlinePath: string): void {
	fs.mkdirSync(path.dirname(outlinePath), { recursive: true });
	try {
		fs.writeFileSync(
			outlinePath,
			"# GOAL\n\n- Establish the requested outcome and constraints.\n\n# WORK\n\n- WORK Establish scope and route [main]\n",
			{ encoding: "utf8", flag: "wx" },
		);
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

	function enable(ctx: ExtensionContext, persist: boolean, restoredPath?: string): void {
		outlinePath = resolveOutlinePath(pi, ctx, restoredPath ?? outlinePath);
		ensureOutline(outlinePath);
		enabled = true;
		startRenderer(ctx);
		if (persist) persistState();
	}

	function disable(ctx: ExtensionContext, persist: boolean): boolean {
		if (!clearRenderer(ctx)) {
			ctx.ui.notify("Could not close the tmux outline pane; the outline remains enabled.", "error");
			return false;
		}
		enabled = false;
		if (persist) persistState();
		return true;
	}

	function restoreFromBranch(ctx: ExtensionContext): void {
		const restored = findBranchState(ctx);
		const shouldEnable = restored?.enabled === true;
		const nextPath = resolveOutlinePath(pi, ctx, restored?.outlinePath);

		if (!clearRenderer(ctx)) {
			ctx.ui.notify("Could not close the previous tmux outline pane; branch renderer restoration was skipped.", "error");
			return;
		}
		enabled = false;
		outlinePath = nextPath;
		if (shouldEnable) enable(ctx, false, nextPath);
	}

	pi.on("session_start", async (_event, ctx) => restoreFromBranch(ctx));
	pi.on("session_tree", async (_event, ctx) => restoreFromBranch(ctx));

	pi.on("before_agent_start", async (event) => {
		if (!enabled || !outlinePath) {
			delete event.systemPromptOptions.sections[PROMPT_SECTION_KEY];
			return;
		}
		event.systemPromptOptions.sections[PROMPT_SECTION_KEY] =
			`${PROMPT}\n\n## Active observer file\n\nUse exactly this absolute path: ${JSON.stringify(outlinePath)}.`;
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		clearRenderer(ctx);
		enabled = false;
		outlinePath = undefined;
	});

	pi.registerCommand("work-outline", {
		description: "Enable, disable, view, or show the live work outline",
		handler: async (args, ctx) => {
			const action = args.trim().toLowerCase();
			if (action === "off" || action === "disable") {
				if (disable(ctx, true)) ctx.ui.notify("Work outline disabled for this session.", "info");
				return;
			}
			if (action && action !== "on" && action !== "enable" && action !== "status" && action !== "view") {
				ctx.ui.notify("Usage: /work-outline [on|off|status|view]", "warning");
				return;
			}
			if (!enabled && action !== "status" && action !== "view") enable(ctx, true);
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
