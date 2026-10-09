import * as path from "node:path";

export interface StoredOutlineState {
	enabled: boolean;
	outlinePath?: string;
}

export function mergeStoredStates(states: StoredOutlineState[]): StoredOutlineState | undefined {
	let enabled: boolean | undefined;
	let outlinePath: string | undefined;
	for (let index = states.length - 1; index >= 0; index -= 1) {
		const state = states[index]!;
		enabled ??= state.enabled;
		outlinePath ??= state.outlinePath;
		if (enabled !== undefined && outlinePath !== undefined) break;
	}
	return enabled === undefined ? undefined : { enabled, outlinePath };
}

export function resolveConfiguredPath(
	flagValue: unknown,
	environmentValue: string | undefined,
	cwd: string,
): string | undefined {
	const configured = typeof flagValue === "string" && flagValue.trim()
		? flagValue.trim()
		: environmentValue?.trim();
	return configured ? path.resolve(cwd, configured) : undefined;
}

export function resolveStateOutlinePath(options: {
	configuredPath?: string;
	restoredPath?: string;
	agentDir: string;
	sessionId: string;
}): string {
	return options.configuredPath
		?? options.restoredPath
		?? path.join(options.agentDir, "state", "work-outlines", `${options.sessionId}.md`);
}
