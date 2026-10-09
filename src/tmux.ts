import { spawnSync, type SpawnSyncReturns } from "node:child_process";
export type RenderMode = "tmux" | "widget";

const TMUX_OWNER_OPTION = "@work-outline-owner";
export const DEFAULT_TMUX_PANE_PERCENT = 34;

type TmuxStartResult = { paneId?: string; error?: string; attempted: boolean };

type RunTmux = (args: string[]) => SpawnSyncReturns<string>;

function defaultRunTmux(args: string[]): SpawnSyncReturns<string> {
	return spawnSync("tmux", args, { encoding: "utf8", timeout: 2_000 });
}

function output(value: string | Buffer | null | undefined): string {
	return value?.toString().trim() ?? "";
}

function resultError(result: SpawnSyncReturns<string>, fallback: string): string {
	return result.error?.message ?? (output(result.stderr) || fallback);
}

export function tmuxPaneExists(paneId: string, runTmux: RunTmux = defaultRunTmux): boolean {
	const result = runTmux(["display-message", "-p", "-t", paneId, "#{pane_id}"]);
	return result.status === 0 && output(result.stdout) === paneId;
}

export function startTmuxRenderer(
	outlinePath: string,
	ownerId: string,
	rendererPath: string,
	panePercent = DEFAULT_TMUX_PANE_PERCENT,
	runTmux: RunTmux = defaultRunTmux,
): TmuxStartResult {
	const sourcePane = process.env.TMUX_PANE?.trim();
	if (!process.env.TMUX || !sourcePane) return { attempted: false };

	const sourceResult = runTmux(["display-message", "-p", "-t", sourcePane, "#{pane_id}"]);
	if (sourceResult.error) return { attempted: true, error: sourceResult.error.message };
	if (sourceResult.status !== 0 || output(sourceResult.stdout) !== sourcePane) return { attempted: false };

	const nodeResult = spawnSync("node", ["-p", "process.execPath"], { encoding: "utf8", timeout: 2_000 });
	const nodePath = output(nodeResult.stdout);
	if (nodeResult.status !== 0 || !nodePath) {
		return {
			attempted: true,
			error: nodeResult.error?.message ?? "node is unavailable for the tmux renderer",
		};
	}

	const args = [
		"split-window",
		"-h",
		"-d",
		"-P",
		"-F",
		"#{pane_id}",
		"-t",
		sourcePane,
		"-p",
		String(panePercent),
		nodePath,
		rendererPath,
		outlinePath,
		"--owner-pid",
		String(process.pid),
	];
	const result = runTmux(args);
	if (result.status !== 0) {
		return {
			attempted: true,
			error: resultError(result, `tmux exited with status ${result.status}`),
		};
	}

	const paneId = output(result.stdout);
	if (!paneId) return { attempted: true, error: "tmux did not return the new pane id" };
	const ownerResult = runTmux(["set-option", "-p", "-t", paneId, TMUX_OWNER_OPTION, ownerId]);
	if (ownerResult.status !== 0) {
		runTmux(["kill-pane", "-t", paneId]);
		return {
			attempted: true,
			error: resultError(ownerResult, "could not mark the tmux pane"),
		};
	}

	const processResult = runTmux(["display-message", "-p", "-t", paneId, "#{pane_pid}"]);
	if (processResult.status !== 0 || !/^\d+$/.test(output(processResult.stdout))) {
		runTmux(["kill-pane", "-t", paneId]);
		return { attempted: true, error: "tmux outline renderer exited during startup" };
	}
	return { attempted: true, paneId };
}

export function stopTmuxRenderer(
	paneId: string | undefined,
	ownerId: string,
	runTmux: RunTmux = defaultRunTmux,
): void {
	if (!paneId || !tmuxPaneExists(paneId, runTmux)) return;
	const ownerResult = runTmux(["show-option", "-p", "-qv", "-t", paneId, TMUX_OWNER_OPTION]);
	if (ownerResult.status === 0 && output(ownerResult.stdout) === ownerId) {
		runTmux(["kill-pane", "-t", paneId]);
	}
}

export function describeRenderMode(renderMode: RenderMode | undefined, paneId: string | undefined): string {
	if (renderMode === "tmux") return `tmux pane ${paneId}`;
	if (renderMode === "widget") return "Pi widget";
	return "headless mode (observer file only)";
}
