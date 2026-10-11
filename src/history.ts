import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

export const SNAPSHOT_TYPE = "work-outline-snapshot";
export const INITIAL_OUTLINE = "# GOAL\n\n- Establish the requested outcome and constraints.\n\n# WORK\n\n- WORK Establish scope and route [main]\n";

export interface OutlineSnapshot {
	version: 1;
	sessionId: string;
	outlinePath: string;
	generated: boolean;
	content: string;
}

type HistoryEntry = { type: string; customType?: string; data?: unknown };

export function findOutlineSnapshot(entries: readonly HistoryEntry[], outlinePath: string): OutlineSnapshot | undefined {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index]!;
		if (entry.type !== "custom" || entry.customType !== SNAPSHOT_TYPE) continue;
		const snapshot = entry.data as Partial<OutlineSnapshot> | undefined;
		if (snapshot?.version === 1 && snapshot.outlinePath === outlinePath
			&& typeof snapshot.sessionId === "string" && typeof snapshot.generated === "boolean"
			&& typeof snapshot.content === "string") return snapshot as OutlineSnapshot;
	}
	return undefined;
}

export function resolveHistoryOutline(options: {
	entries: readonly HistoryEntry[];
	sessionId: string;
	defaultPath: string;
	configuredPath?: string;
	restoredPath?: string;
	forked: boolean;
}): { outlinePath: string; snapshot?: OutlineSnapshot; migrated: boolean } {
	const selectedPath = options.configuredPath ?? options.restoredPath ?? options.defaultPath;
	const snapshot = findOutlineSnapshot(options.entries, selectedPath);
	// Pi already copies the selected branch's custom entries into forks/clones.
	// Snapshot provenance is enough to give generated files a new owner, without
	// reading or parsing the parent session file.
	const inheritedDefault = snapshot?.generated === true && snapshot.sessionId !== options.sessionId;
	const legacyGeneratedPath = path.dirname(selectedPath) === path.dirname(options.defaultPath)
		&& /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.md$/i.test(path.basename(selectedPath));
	const legacyFork = options.forked && !snapshot && legacyGeneratedPath;
	const outlinePath = !options.configuredPath && (inheritedDefault || legacyFork)
		? options.defaultPath : selectedPath;
	return { outlinePath, snapshot, migrated: outlinePath !== selectedPath };
}

export function captureOutlineSnapshot(options: {
	entries: readonly HistoryEntry[];
	sessionId: string;
	outlinePath: string;
	defaultPath: string;
	append: (type: string, data: OutlineSnapshot) => void;
}): boolean {
	const content = fs.readFileSync(options.outlinePath, "utf8");
	const previous = findOutlineSnapshot(options.entries, options.outlinePath);
	const generated = options.outlinePath === options.defaultPath;
	if (previous?.sessionId === options.sessionId && previous.generated === generated
		&& previous.content === content) return false;
	options.append(SNAPSHOT_TYPE, {
		version: 1,
		sessionId: options.sessionId,
		outlinePath: options.outlinePath,
		generated,
		content,
	});
	return true;
}

export function restoreOutlineFile(outlinePath: string, content: string): void {
	let target = outlinePath;
	try {
		// Replace the referent, not a user's symbolic link.
		target = fs.realpathSync(outlinePath);
		if (fs.readFileSync(target, "utf8") === content) return;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		// A broken symbolic link is not a missing ordinary file. Do not replace it.
		let symbolicLink = false;
		try { symbolicLink = fs.lstatSync(outlinePath).isSymbolicLink(); }
		catch (linkError) { if ((linkError as NodeJS.ErrnoException).code !== "ENOENT") throw linkError; }
		if (symbolicLink) throw error;
	}
	fs.mkdirSync(path.dirname(target), { recursive: true });
	let mode = 0o600;
	try { mode = fs.statSync(target).mode & 0o777; }
	catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
	const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
	try {
		fs.writeFileSync(temporary, content, { encoding: "utf8", flag: "wx", mode });
		fs.renameSync(temporary, target);
	} finally {
		try { fs.unlinkSync(temporary); }
		catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
	}
}
