import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const entrypointUrl = new URL("../index.ts", import.meta.url);

test("extension exposes runtime commands without registering CLI flags", async () => {
	const source = await readFile(entrypointUrl, "utf8");
	assert.doesNotMatch(source, /registerFlag|getFlag/);
	assert.match(source, /registerCommand\("work-outline"/);
});
