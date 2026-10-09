import * as fs from "node:fs";
import * as path from "node:path";

export type RendererPreference = "auto" | "tmux" | "widget";

export interface WorkOutlineSettings {
	renderer: RendererPreference;
	tmuxPanePercent: number;
}

export const DEFAULT_WORK_OUTLINE_SETTINGS: WorkOutlineSettings = {
	renderer: "tmux",
	tmuxPanePercent: 34,
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function workOutlineObject(settings: unknown): Record<string, unknown> | undefined {
	if (!isRecord(settings) || !isRecord(settings["work-outline"])) return undefined;
	return settings["work-outline"];
}

function rendererValue(value: unknown): RendererPreference | undefined {
	return value === "auto" || value === "tmux" || value === "widget" ? value : undefined;
}

function configuredRenderer(settings: Record<string, unknown> | undefined): unknown {
	return settings?.defaultRenderer ?? settings?.renderer;
}

function configuredPanePercent(settings: Record<string, unknown> | undefined): unknown {
	return settings?.tmuxSplitPercent ?? settings?.tmuxPanePercent;
}

function splitPercentValue(value: unknown): number | undefined {
	return Number.isSafeInteger(value) && (value as number) >= 10 && (value as number) <= 80
		? value as number
		: undefined;
}

export function resolveWorkOutlineSettings(
	userSettings: unknown,
	projectSettings?: unknown,
): WorkOutlineSettings {
	const user = workOutlineObject(userSettings);
	const project = workOutlineObject(projectSettings);
	const projectRenderer = configuredRenderer(project);
	const userRenderer = configuredRenderer(user);
	const projectPanePercent = configuredPanePercent(project);
	const userPanePercent = configuredPanePercent(user);
	return {
		renderer: projectRenderer === undefined
			? rendererValue(userRenderer) ?? DEFAULT_WORK_OUTLINE_SETTINGS.renderer
			: rendererValue(projectRenderer) ?? DEFAULT_WORK_OUTLINE_SETTINGS.renderer,
		tmuxPanePercent: projectPanePercent === undefined
			? splitPercentValue(userPanePercent) ?? DEFAULT_WORK_OUTLINE_SETTINGS.tmuxPanePercent
			: splitPercentValue(projectPanePercent) ?? DEFAULT_WORK_OUTLINE_SETTINGS.tmuxPanePercent,
	};
}

// Pi 1.1 does not expose effective extension settings on ExtensionContext, so read only
// the two documented locations and gate project settings on Pi's trust decision.
function readJson(filePath: string): unknown {
	try {
		return JSON.parse(fs.readFileSync(filePath, "utf8"));
	} catch {
		return undefined;
	}
}

export function loadWorkOutlineSettings(options: {
	agentDir: string;
	cwd: string;
	projectTrusted: boolean;
}): WorkOutlineSettings {
	const userSettings = readJson(path.join(options.agentDir, "settings.json"));
	const projectSettings = options.projectTrusted
		? readJson(path.join(options.cwd, ".pi", "settings.json"))
		: undefined;
	return resolveWorkOutlineSettings(userSettings, projectSettings);
}
