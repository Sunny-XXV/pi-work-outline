import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	mergeStoredStates,
	resolveConfiguredPath,
	resolveStateOutlinePath,
	type StoredOutlineState,
} from "./config.ts";

export type WorkOutlineState = StoredOutlineState;

type StateEntry = { type: string; customType?: string; data?: WorkOutlineState };

export function findBranchState(ctx: ExtensionContext): WorkOutlineState | undefined {
	const states = (ctx.sessionManager.getBranch() as StateEntry[])
		.filter((entry) => entry.type === "custom" && entry.customType === "work-outline-state" && entry.data)
		.map((entry) => entry.data!);
	return mergeStoredStates(states);
}

export function configuredOutlinePath(cwd: string): string | undefined {
	return resolveConfiguredPath(process.env.WORK_OUTLINE_FILE, cwd);
}

export function resolveOutlinePath(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	restoredPath?: string,
): string {
	return resolveStateOutlinePath({
		configuredPath: configuredOutlinePath(ctx.cwd),
		restoredPath,
		agentDir: getAgentDir(),
		sessionId: ctx.sessionManager.getSessionId(),
	});
}
