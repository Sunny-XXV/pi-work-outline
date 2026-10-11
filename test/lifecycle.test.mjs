import "./helpers/pi-loader.mjs";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
const { default: workOutlineExtension } = await import("../index.ts");
import { setAgentDir } from "./helpers/pi-host.mjs";
import { INITIAL_OUTLINE, SNAPSHOT_TYPE } from "../src/history.ts";

function harness(t, options = {}) {
	const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "work-outline-lifecycle-"));
	setAgentDir(agentDir);
	t.after(() => fs.rmSync(agentDir, { recursive: true, force: true }));
	const previousEnvironment = process.env.WORK_OUTLINE_FILE;
	delete process.env.WORK_OUTLINE_FILE;
	t.after(() => {
		if (previousEnvironment === undefined) delete process.env.WORK_OUTLINE_FILE;
		else process.env.WORK_OUTLINE_FILE = previousEnvironment;
	});
	const entries = options.entries ? [...options.entries] : [];
	let leaf = entries.at(-1)?.id ?? null;
	let counter = 0;
	const handlers = new Map();
	const commands = new Map();
	const notifications = [];
	const sessionId = options.sessionId ?? "session";
	const append = (entry) => {
		const stored = { ...entry, id: `${sessionId}-${++counter}`, parentId: leaf };
		entries.push(stored);
		leaf = stored.id;
		return stored;
	};
	const branch = () => {
		const result = [];
		let id = leaf;
		while (id) {
			const entry = entries.find((entry) => entry.id === id);
			if (!entry) break;
			result.unshift(entry);
			id = entry.parentId;
		}
		return result;
	};
	const ctx = {
		cwd: agentDir, mode: "print", hasUI: false,
		isProjectTrusted: () => false,
		sessionManager: {
			getSessionId: () => sessionId,
			getHeader: () => ({ type: "session", id: sessionId, parentSession: options.parentSession }),
			getBranch: branch,
			getEntries: () => entries,
		},
		ui: { notify: (text, level) => notifications.push({ text, level }) },
	};
	const pi = {
		on: (name, handler) => { handlers.set(name, handler); },
		registerCommand: (name, command) => commands.set(name, command),
		appendEntry: (customType, data) => append({ type: "custom", customType, data }),
	};
	workOutlineExtension(pi);
	const emit = async (name, event = {}) => await handlers.get(name)?.({ type: name, ...event }, ctx);
	const outlinePath = path.join(agentDir, "state", "work-outlines", `${sessionId}.md`);
	return {
		agentDir, outlinePath, entries, branch, notifications, ctx, append, emit,
		command: async (args) => await commands.get("work-outline").handler(args, ctx),
		message: async (role, content = "test") => {
			// Matches Pi 1.1.0: extension message_end precedes persistence.
			const message = { role, content };
			await emit("message_end", { message });
			return append({ type: "message", message });
		},
		select: (id) => { leaf = id; },
	};
}

const source = (marker) => `# GOAL\n\n- ${marker}\n\n# WORK\n\n- DONE ${marker}\n`;

test("real entrypoint restores snapshots with visible assistant nodes and keeps abandoned branches", async (t) => {
	const h = harness(t);
	await h.emit("session_start", { reason: "startup" });
	await h.command("on");
	fs.writeFileSync(h.outlinePath, source("A"));
	const responseA = await h.message("assistant");
	fs.writeFileSync(h.outlinePath, source("B"));
	const responseB = await h.message("assistant");
	await h.emit("session_before_tree");
	h.select(responseA.id);
	await h.emit("session_tree");
	assert.equal(fs.readFileSync(h.outlinePath, "utf8"), source("A"));
	fs.writeFileSync(h.outlinePath, source("C"));
	await h.message("toolResult");
	h.select(responseB.id);
	await h.emit("session_tree");
	assert.equal(fs.readFileSync(h.outlinePath, "utf8"), source("B"));
	assert.equal(h.entries.some((entry) => entry.customType === SNAPSHOT_TYPE && entry.data.content === source("C")), true);
});

test("disabled restoration still restores content and removes the observer section", async (t) => {
	const h = harness(t);
	await h.emit("session_start", { reason: "startup" });
	await h.command("on");
	fs.writeFileSync(h.outlinePath, source("disabled baseline"));
	await h.command("off");
	const disabledLeaf = h.branch().at(-1).id;
	await h.command("on");
	fs.writeFileSync(h.outlinePath, source("future"));
	await h.message("assistant");
	h.select(disabledLeaf);
	await h.emit("session_tree");
	assert.equal(fs.readFileSync(h.outlinePath, "utf8"), source("disabled baseline"));
	const event = { systemPromptOptions: { sections: { work_outline_observer: "old" } } };
	await h.emit("before_agent_start", event);
	assert.equal(event.systemPromptOptions.sections.work_outline_observer, undefined);
});

test("old points with no snapshot do not import newer content on re-enable", async (t) => {
	const h = harness(t);
	await h.emit("session_start", { reason: "startup" });
	const older = await h.message("user");
	await h.command("on");
	fs.writeFileSync(h.outlinePath, source("future"));
	await h.message("assistant");
	h.select(older.id);
	await h.emit("session_tree");
	await h.command("on");
	assert.equal(fs.readFileSync(h.outlinePath, "utf8"), INITIAL_OUTLINE);
});

test("fork inherits only selected Pi entries and uses a separate default file", async (t) => {
	const parent = harness(t, { sessionId: "parent" });
	await parent.emit("session_start", { reason: "startup" });
	await parent.command("on");
	fs.writeFileSync(parent.outlinePath, source("fork point"));
	const forkPoint = await parent.message("assistant");
	const selected = parent.branch();
	fs.writeFileSync(parent.outlinePath, source("parent future"));
	await parent.message("assistant");
	const child = harness(t, { sessionId: "child", parentSession: "/parent.jsonl", entries: selected });
	await child.emit("session_start", { reason: "fork" });
	assert.equal(fs.readFileSync(child.outlinePath, "utf8"), source("fork point"));
	assert.equal(fs.readFileSync(parent.outlinePath, "utf8"), source("parent future"));
	fs.writeFileSync(child.outlinePath, source("child update"));
	await child.message("assistant");
	assert.equal(fs.readFileSync(parent.outlinePath, "utf8"), source("parent future"));
	const grandchild = harness(t, { sessionId: "grandchild", parentSession: "/child.jsonl", entries: child.branch() });
	await grandchild.emit("session_start", { reason: "startup" });
	assert.equal(fs.readFileSync(grandchild.outlinePath, "utf8"), source("child update"));
	assert.ok(forkPoint.id);
});

test("disabled forks restore inherited snapshots without enabling the observer", async (t) => {
	const parent = harness(t, { sessionId: "parent-disabled" });
	await parent.emit("session_start", { reason: "startup" });
	await parent.command("on");
	fs.writeFileSync(parent.outlinePath, source("disabled fork point"));
	await parent.command("off");
	const child = harness(t, { sessionId: "child-disabled", parentSession: "/parent.jsonl", entries: parent.branch() });
	await child.emit("session_start", { reason: "fork" });
	assert.equal(fs.readFileSync(child.outlinePath, "utf8"), source("disabled fork point"));
	assert.equal(child.branch().filter((entry) => entry.customType === "work-outline-state").at(-1).data.enabled, false);
	const event = { systemPromptOptions: { sections: { work_outline_observer: "old" } } };
	await child.emit("before_agent_start", event);
	assert.equal(event.systemPromptOptions.sections.work_outline_observer, undefined);
});

test("reload restores persisted content and checkpoints do not add unchanged snapshots", async (t) => {
	const h = harness(t);
	await h.emit("session_start", { reason: "startup" });
	await h.command("on");
	fs.writeFileSync(h.outlinePath, source("saved"));
	await h.message("assistant");
	const count = () => h.entries.filter((entry) => entry.customType === SNAPSHOT_TYPE).length;
	const before = count();
	await h.message("assistant");
	await h.emit("agent_before_settle");
	assert.equal(count(), before);
	fs.writeFileSync(h.outlinePath, source("unsaved"));
	await h.emit("session_start", { reason: "reload" });
	assert.equal(fs.readFileSync(h.outlinePath, "utf8"), source("saved"));
});

test("legacy sessions import only a current baseline; unavailable history is seeded", async (t) => {
	const h = harness(t);
	fs.mkdirSync(path.dirname(h.outlinePath), { recursive: true });
	fs.writeFileSync(h.outlinePath, source("legacy"));
	const oldState = h.append({ type: "custom", customType: "work-outline-state", data: { enabled: true, outlinePath: h.outlinePath } });
	await h.emit("session_start", { reason: "reload" });
	assert.equal(h.branch().some((entry) => entry.customType === SNAPSHOT_TYPE && entry.data.content === source("legacy")), true);
	fs.writeFileSync(h.outlinePath, source("future"));
	await h.message("assistant");
	h.select(oldState.id);
	await h.emit("session_tree");
	assert.equal(fs.readFileSync(h.outlinePath, "utf8"), INITIAL_OUTLINE);
	assert.match(h.notifications.at(-1).text, /No outline snapshot/);
});

test("snapshot history survives compaction entries and selecting a user input restores its parent state", async (t) => {
	const h = harness(t);
	await h.emit("session_start", { reason: "startup" });
	await h.command("on");
	fs.writeFileSync(h.outlinePath, source("before input"));
	await h.message("assistant");
	const input = await h.message("user");
	fs.writeFileSync(h.outlinePath, source("after input"));
	await h.message("assistant");
	h.append({ type: "compaction", summary: "summary only", firstKeptEntryId: input.id });
	await h.emit("session_start", { reason: "resume" });
	assert.equal(fs.readFileSync(h.outlinePath, "utf8"), source("after input"));
	h.select(input.parentId);
	await h.emit("session_tree");
	assert.equal(fs.readFileSync(h.outlinePath, "utf8"), source("before input"));
});

test("custom configured paths remain shared but their contents restore from the selected branch", async (t) => {
	const h = harness(t);
	const custom = path.join(h.agentDir, "custom.md");
	process.env.WORK_OUTLINE_FILE = custom;
	await h.emit("session_start", { reason: "startup" });
	await h.command("on");
	fs.writeFileSync(custom, source("custom old"));
	const old = await h.message("assistant");
	fs.writeFileSync(custom, source("custom new"));
	await h.message("assistant");
	h.select(old.id);
	await h.emit("session_tree");
	assert.equal(fs.readFileSync(custom, "utf8"), source("custom old"));
	assert.equal(h.branch().filter((entry) => entry.customType === SNAPSHOT_TYPE).at(-1).data.generated, false);
});

test("failed history capture cancels navigation and failed restoration disables the observer", async (t) => {
	const h = harness(t);
	await h.emit("session_start", { reason: "startup" });
	await h.command("on");
	fs.unlinkSync(h.outlinePath);
	assert.deepEqual(await h.emit("session_before_tree"), { cancel: true });
	assert.deepEqual(await h.emit("session_before_fork"), { cancel: true });
	fs.mkdirSync(h.outlinePath);
	await h.emit("session_tree");
	const event = { systemPromptOptions: { sections: { work_outline_observer: "old" } } };
	await h.emit("before_agent_start", event);
	assert.equal(event.systemPromptOptions.sections.work_outline_observer, undefined);
	assert.match(h.notifications.at(-1).text, /Could not restore outline history/);
	fs.rmdirSync(h.outlinePath);
	fs.writeFileSync(h.outlinePath, source("unrelated newer copy"));
	await h.command("on");
	assert.equal(fs.readFileSync(h.outlinePath, "utf8"), INITIAL_OUTLINE);
});
