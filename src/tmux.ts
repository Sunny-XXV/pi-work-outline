import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import * as path from "node:path";
export type RenderMode = "tmux" | "widget";

const TMUX_OWNER_OPTION = "@work-outline-owner";
export const DEFAULT_TMUX_PANE_PERCENT = 34;

type TmuxStartResult = {
	paneId?: string;
	residualPaneId?: string;
	residualOwned?: boolean;
	error?: string;
	attempted: boolean;
};

type RunTmux = (args: string[]) => SpawnSyncReturns<string>;
type RunCommand = (command: string, args: string[]) => SpawnSyncReturns<string>;

function defaultRunTmux(args: string[]): SpawnSyncReturns<string> {
	return spawnSync("tmux", args, { encoding: "utf8", timeout: 2_000 });
}

function defaultRunCommand(command: string, args: string[]): SpawnSyncReturns<string> {
	return spawnSync(command, args, { encoding: "utf8", timeout: 2_000 });
}

function output(value: string | Buffer | null | undefined): string {
	return value?.toString().trim() ?? "";
}

function resultError(result: SpawnSyncReturns<string>, fallback: string): string {
	return result.error?.message ?? (output(result.stderr) || fallback);
}

export function resolveNodeExecutable(
	hostExecutable = process.execPath,
	runCommand: RunCommand = defaultRunCommand,
): string | undefined {
	if (/^node(?:\.exe)?$/i.test(path.basename(hostExecutable))) return hostExecutable;
	const result = runCommand("node", ["-p", "process.execPath"]);
	const nodePath = output(result.stdout);
	return result.status === 0 && path.isAbsolute(nodePath) && /^node(?:\.exe)?$/i.test(path.basename(nodePath))
		? nodePath
		: undefined;
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

	const nodePath = resolveNodeExecutable();
	if (!nodePath) return { attempted: true, error: "Node.js is unavailable for the tmux renderer" };
	const expectedCommand = path.basename(nodePath);

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
	if (!/^%\d+$/.test(paneId)) return { attempted: true, error: "tmux did not return a valid new pane id" };
	const ownerResult = runTmux(["set-option", "-p", "-t", paneId, TMUX_OWNER_OPTION, ownerId]);
	if (ownerResult.status !== 0) {
		const killResult = runTmux(["kill-pane", "-t", paneId]);
		const cleared = killResult.status === 0 || !tmuxPaneExists(paneId, runTmux);
		return {
			attempted: true,
			residualPaneId: cleared ? undefined : paneId,
			residualOwned: false,
			error: cleared
				? resultError(ownerResult, "could not mark the tmux pane")
				: `${resultError(ownerResult, "could not mark the tmux pane")}; the unowned pane could not be closed`,
		};
	}

	const processResult = runTmux([
		"display-message", "-p", "-t", paneId,
		"#{pane_pid}\t#{pane_dead}\t#{pane_current_command}",
	]);
	const [panePid, paneDead, paneCommand] = output(processResult.stdout).split("\t");
	if (processResult.status !== 0 || !/^\d+$/.test(panePid ?? "") || paneDead !== "0" || paneCommand !== expectedCommand) {
		const cleared = stopTmuxRenderer(paneId, ownerId, runTmux);
		return {
			attempted: true,
			residualPaneId: cleared ? undefined : paneId,
			residualOwned: !cleared,
			error: cleared
				? "tmux outline renderer exited during startup"
				: "tmux outline renderer exited during startup and its pane could not be closed",
		};
	}
	return { attempted: true, paneId };
}

export function stopTmuxRenderer(
	paneId: string | undefined,
	ownerId: string | undefined,
	runTmux: RunTmux = defaultRunTmux,
): boolean {
	if (!paneId || !tmuxPaneExists(paneId, runTmux)) return true;
	if (ownerId) {
		const ownerResult = runTmux(["show-option", "-p", "-qv", "-t", paneId, TMUX_OWNER_OPTION]);
		if (ownerResult.status !== 0 || output(ownerResult.stdout) !== ownerId) return true;
	}
	const killResult = runTmux(["kill-pane", "-t", paneId]);
	if (killResult.status === 0) return true;
	return !tmuxPaneExists(paneId, runTmux);
}

export function describeRenderMode(renderMode: RenderMode | undefined, paneId: string | undefined): string {
	if (renderMode === "tmux") return `tmux pane ${paneId}`;
	if (renderMode === "widget") return "Pi widget";
	return "headless mode (observer file only)";
}
