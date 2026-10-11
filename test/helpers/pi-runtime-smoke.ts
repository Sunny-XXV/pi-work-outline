import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { getAgentDir, SessionManager, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { captureOutlineSnapshot, findOutlineSnapshot, SNAPSHOT_TYPE } from "../../src/history.ts";

export default function (pi: ExtensionAPI): void {
	pi.registerCommand("outline-history-smoke", {
		description: "Isolated runtime check for Pi session history",
		handler: async (_args, ctx) => {
			const smokeDir = path.join(getAgentDir(), "smoke");
			const outline = path.join(smokeDir, "outline.md");
			fs.mkdirSync(path.dirname(outline), { recursive: true });
			const manager = SessionManager.inMemory(ctx.cwd);
			const capture = () => captureOutlineSnapshot({
				entries: manager.getBranch(), sessionId: manager.getSessionId(),
				outlinePath: outline, defaultPath: outline,
				append: (type, data) => { manager.appendCustomEntry(type, data); },
			});
			fs.writeFileSync(outline, "old");
			capture();
			const oldLeaf = manager.getLeafId()!;
			fs.writeFileSync(outline, "new");
			capture();
			const newLeaf = manager.getLeafId()!;
			manager.branch(oldLeaf);
			assert.equal(findOutlineSnapshot(manager.getBranch(), outline)?.content, "old");
			manager.branch(newLeaf);
			assert.equal(findOutlineSnapshot(manager.getBranch(), outline)?.content, "new");
			manager.createBranchedSession(oldLeaf);
			assert.equal(findOutlineSnapshot(manager.getBranch(), outline)?.content, "old");
			assert.equal(manager.getBranch().some((entry) => entry.type === "custom" && entry.customType === SNAPSHOT_TYPE), true);
			const persistent = SessionManager.create(ctx.cwd, path.join(smokeDir, "sessions"));
			persistent.appendMessage({ role: "user", content: "Offline fixture", timestamp: Date.now() });
			persistent.appendCustomEntry(SNAPSHOT_TYPE, {
				version: 1, sessionId: persistent.getSessionId(), outlinePath: outline,
				generated: true, content: "persisted old",
			});
			const persistedOldLeaf = persistent.getLeafId()!;
			persistent.appendCustomEntry(SNAPSHOT_TYPE, {
				version: 1, sessionId: persistent.getSessionId(), outlinePath: outline,
				generated: true, content: "persisted new",
			});
			const reopened = SessionManager.open(persistent.getSessionFile()!);
			assert.equal(findOutlineSnapshot(reopened.getBranch(), outline)?.content, "persisted new");
			const forkFile = reopened.createBranchedSession(persistedOldLeaf)!;
			assert.equal(findOutlineSnapshot(SessionManager.open(forkFile).getBranch(), outline)?.content, "persisted old");
			assert.equal(findOutlineSnapshot(SessionManager.open(persistent.getSessionFile()!).getBranch(), outline)?.content, "persisted new");
			// Exercise the actual extension using Pi's real navigation/fork events.
			const livePath = path.join(getAgentDir(), "state", "work-outlines", `${ctx.sessionManager.getSessionId()}.md`);
			fs.mkdirSync(path.dirname(livePath), { recursive: true });
			pi.appendEntry("work-outline-state", { enabled: true, outlinePath: livePath });
			const liveCapture = (content: string) => {
				fs.writeFileSync(livePath, content);
				captureOutlineSnapshot({
					entries: ctx.sessionManager.getBranch(), sessionId: ctx.sessionManager.getSessionId(),
					outlinePath: livePath, defaultPath: livePath,
					append: (type, data) => pi.appendEntry(type, data),
				});
				return ctx.sessionManager.getLeafId()!;
			};
			const before = liveCapture("runtime old");
			const after = liveCapture("runtime new");
			assert.equal((await ctx.navigateTree(before)).cancelled, false);
			assert.equal(fs.readFileSync(livePath, "utf8"), "runtime old");
			assert.equal((await ctx.navigateTree(after)).cancelled, false);
			assert.equal(fs.readFileSync(livePath, "utf8"), "runtime new");
			const forked = await ctx.fork(before, {
				position: "at",
				withSession: async (child) => {
					const childPath = path.join(getAgentDir(), "state", "work-outlines", `${child.sessionManager.getSessionId()}.md`);
					assert.notEqual(childPath, livePath);
					assert.equal(fs.readFileSync(childPath, "utf8"), "runtime old");
					assert.equal(fs.readFileSync(livePath, "utf8"), "runtime new");
				},
			});
			assert.equal(forked.cancelled, false);
			process.stdout.write("PI_HISTORY_RUNTIME_OK\n");
		},
	});
}
