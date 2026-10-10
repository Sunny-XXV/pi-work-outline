import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const entrypointUrl = new URL("../index.ts", import.meta.url);

test("extension exposes runtime commands without registering CLI flags", async () => {
	const source = await readFile(entrypointUrl, "utf8");
	assert.doesNotMatch(source, /registerFlag|getFlag/);
	assert.match(source, /registerCommand\("work-outline"/);
});

test("status is read-only while explicit enable actions may repair a missing tmux pane", async () => {
	const source = await readFile(entrypointUrl, "utf8");
	assert.match(source, /action === "status" && tmuxPaneMissing/);
	assert.match(source, /action === "on" \|\| action === "enable" \|\| !action/);
});
