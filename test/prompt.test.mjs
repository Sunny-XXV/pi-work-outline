import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const prompt = fs.readFileSync(new URL("../prompt.md", import.meta.url), "utf8");

test("major goal changes preserve and compress prior work", () => {
	for (const requirement of [
		"Treat a major goal change as a transition within one continuous work history",
		"Do not clear or recreate `WORK`",
		"Replacing all prior `WORK` content is allowed only",
		"A changed goal by itself is not a reset condition",
	]) {
		assert.ok(prompt.includes(requirement), `missing prompt requirement: ${requirement}`);
	}
});
