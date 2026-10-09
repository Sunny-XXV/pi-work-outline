import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { mergeStoredStates, resolveConfiguredPath, resolveStateOutlinePath } from "../src/config.ts";

test("CLI path overrides environment path", () => {
	assert.equal(
		resolveConfiguredPath(" ./flag.md ", "./environment.md", "/repo"),
		path.resolve("/repo", "flag.md"),
	);
});

test("environment path is used when the CLI flag is absent", () => {
	assert.equal(
		resolveConfiguredPath(undefined, " ./environment.md ", "/repo"),
		path.resolve("/repo", "environment.md"),
	);
});

test("configured path overrides restored state and default agent directory", () => {
	assert.equal(resolveStateOutlinePath({
		configuredPath: "/configured.md",
		restoredPath: "/restored.md",
		agentDir: "/custom-agent",
		sessionId: "session",
	}), "/configured.md");
});

test("restored path overrides the generated default", () => {
	assert.equal(resolveStateOutlinePath({
		restoredPath: "/restored.md",
		agentDir: "/custom-agent",
		sessionId: "session",
	}), "/restored.md");
});

test("legacy disable entries retain the most recent earlier path", () => {
	assert.deepEqual(mergeStoredStates([
		{ enabled: true, outlinePath: "/custom.md" },
		{ enabled: false },
	]), { enabled: false, outlinePath: "/custom.md" });
});

test("newer explicit paths take precedence over earlier paths", () => {
	assert.deepEqual(mergeStoredStates([
		{ enabled: true, outlinePath: "/old.md" },
		{ enabled: true, outlinePath: "/new.md" },
	]), { enabled: true, outlinePath: "/new.md" });
});

test("default path follows the configured Pi agent directory", () => {
	assert.equal(resolveStateOutlinePath({
		agentDir: "/custom-agent",
		sessionId: "session",
	}), path.join("/custom-agent", "state", "work-outlines", "session.md"));
});
