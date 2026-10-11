import assert from "node:assert/strict";
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
	captureOutlineSnapshot, findOutlineSnapshot, INITIAL_OUTLINE,
	resolveHistoryOutline, restoreOutlineFile, SNAPSHOT_TYPE,
} from "../src/history.ts";

function snapshotEntry(outlinePath, content, sessionId = "parent", generated = true) {
	return { type: "custom", customType: SNAPSHOT_TYPE, data: { version: 1, sessionId, outlinePath, generated, content } };
}

function temporary(t) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "work-outline-history-"));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	return dir;
}

test("snapshots select only the nearest valid version on the supplied branch/path", () => {
	const old = snapshotEntry("/outline.md", "old");
	const alternate = snapshotEntry("/outline.md", "alternate");
	assert.equal(findOutlineSnapshot([old], "/outline.md").content, "old");
	assert.equal(findOutlineSnapshot([old, alternate], "/outline.md").content, "alternate");
	assert.equal(findOutlineSnapshot([old, snapshotEntry("/other.md", "other")], "/outline.md").content, "old");
	assert.equal(findOutlineSnapshot([old, { ...old, data: { ...old.data, version: 99 } }], "/outline.md").content, "old");
	assert.equal(findOutlineSnapshot([], "/outline.md"), undefined);
});

test("forks use Pi-copied snapshots to own their generated files, including nested forks", () => {
	const entries = [snapshotEntry("/agent/state/work-outlines/parent.md", "parent state")];
	const child = resolveHistoryOutline({
		entries, sessionId: "child", defaultPath: "/agent/state/work-outlines/child.md",
		restoredPath: entries[0].data.outlinePath, forked: true,
	});
	assert.equal(child.outlinePath, "/agent/state/work-outlines/child.md");
	assert.equal(child.snapshot.content, "parent state");
	assert.equal(child.migrated, true);
	const grandchild = resolveHistoryOutline({
		entries: [snapshotEntry(child.outlinePath, "child state", "child")],
		sessionId: "grandchild", defaultPath: "/agent/state/work-outlines/grandchild.md",
		restoredPath: child.outlinePath, forked: true,
	});
	assert.equal(grandchild.snapshot.content, "child state");
	assert.equal(grandchild.outlinePath, "/agent/state/work-outlines/grandchild.md");
});

test("configured/shared custom files are not migrated, while snapshotless fork baselines do not read newer parent content", () => {
	assert.equal(resolveHistoryOutline({
		entries: [snapshotEntry("/custom.md", "old", "parent", false)],
		sessionId: "child", defaultPath: "/child.md", restoredPath: "/custom.md", forked: true,
	}).outlinePath, "/custom.md");
	assert.equal(resolveHistoryOutline({
		entries: [snapshotEntry("/parent.md", "old")],
		sessionId: "child", defaultPath: "/child.md", restoredPath: "/parent.md",
		configuredPath: "/parent.md", forked: true,
	}).outlinePath, "/parent.md");
	const legacy = resolveHistoryOutline({
		entries: [], sessionId: "child", defaultPath: "/agent/work-outlines/child.md",
		restoredPath: "/agent/work-outlines/00000000-0000-0000-0000-000000000000.md", forked: true,
	});
	assert.equal(legacy.outlinePath, "/agent/work-outlines/child.md");
	assert.equal(resolveHistoryOutline({
		entries: [], sessionId: "child", defaultPath: "/child.md", restoredPath: "/custom.md", forked: true,
	}).outlinePath, "/custom.md");
	assert.equal(legacy.snapshot, undefined);
});

test("same-session tree restoration retains the file path", () => {
	const restored = resolveHistoryOutline({
		entries: [snapshotEntry("/parent.md", "old")], sessionId: "parent",
		defaultPath: "/parent.md", restoredPath: "/parent.md", forked: false,
	});
	assert.equal(restored.outlinePath, "/parent.md");
	assert.equal(restored.migrated, false);
	assert.equal(restored.snapshot.content, "old");
});

test("unchanged snapshots are deduplicated but changed content and ownership append new state", (t) => {
	const dir = temporary(t);
	const outlinePath = path.join(dir, "outline.md");
	fs.writeFileSync(outlinePath, "first");
	const entries = [];
	const options = { entries, sessionId: "owner", outlinePath, defaultPath: outlinePath,
		append: (type, data) => entries.push({ type: "custom", customType: type, data }) };
	assert.equal(captureOutlineSnapshot(options), true);
	assert.equal(captureOutlineSnapshot(options), false);
	fs.writeFileSync(outlinePath, "second");
	assert.equal(captureOutlineSnapshot(options), true);
	assert.equal(entries.length, 2);
	assert.equal(captureOutlineSnapshot({ ...options, sessionId: "child" }), true);
	assert.equal(entries.at(-1).data.sessionId, "child");
});

test("restoration is atomic, preserves permissions and symlinks, and never modifies the parent file", (t) => {
	const dir = temporary(t);
	const parent = path.join(dir, "parent.md");
	const child = path.join(dir, "nested", "child.md");
	fs.writeFileSync(parent, "parent");
	restoreOutlineFile(child, "fork baseline");
	fs.chmodSync(child, 0o640);
	restoreOutlineFile(child, "child update");
	assert.equal(fs.readFileSync(parent, "utf8"), "parent");
	assert.equal(fs.statSync(child).mode & 0o777, 0o640);
	const linked = path.join(dir, "link.md");
	fs.symlinkSync(child, linked);
	restoreOutlineFile(linked, "restored through link");
	assert.equal(fs.lstatSync(linked).isSymbolicLink(), true);
	assert.equal(fs.readFileSync(child, "utf8"), "restored through link");
	const broken = path.join(dir, "broken.md");
	fs.symlinkSync(path.join(dir, "missing.md"), broken);
	assert.throws(() => restoreOutlineFile(broken, "must not replace link"), { code: "ENOENT" });
	assert.equal(fs.lstatSync(broken).isSymbolicLink(), true);
	assert.deepEqual(fs.readdirSync(path.dirname(child)), ["child.md"]);
	assert.equal(INITIAL_OUTLINE.includes("- WORK"), true);
});
