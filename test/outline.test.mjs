import assert from "node:assert/strict";
import test from "node:test";
import {
	continuationPrefix,
	parseItem,
	parseOutline,
	renderRecords,
	sanitizeDiagnostic,
	sanitizeText,
	visibleWidth,
	wrapBody,
} from "../src/outline.ts";

test("parseOutline extracts goal, statuses, summaries, and hierarchy", () => {
	const result = parseOutline(`# GOAL

- Ship the dashboard.

# WORK

- DONE Inspect sources
  - Three sources are reusable.
  - RUN Validate freshness
- TODO Build dashboard
`);
	assert.deepEqual(result, [
		{ tree: "", body: "GOAL" },
		{ tree: "  ", body: "Ship the dashboard." },
		{ tree: "", body: "" },
		{ tree: "", body: "WORK" },
		{ tree: "", status: "DONE", body: "Inspect sources" },
		{ tree: "       ├─ ", body: "Three sources are reusable." },
		{ tree: "       └─ ", status: "RUN", body: "Validate freshness" },
		{ tree: "", status: "TODO", body: "Build dashboard" },
	]);
});

test("renderRecords clamps indentation jumps while retaining a valid tree", () => {
	assert.deepEqual(renderRecords([
		{ level: 0, status: "RUN", body: "root" },
		{ level: 4, body: "jump" },
		{ level: 1, body: "sibling" },
	]), [
		{ tree: "", status: "RUN", body: "root" },
		{ tree: "       ├─ ", body: "jump" },
		{ tree: "       └─ ", body: "sibling" },
	]);
});

test("text sanitation removes terminal escapes, control strings, and controls", () => {
	assert.equal(sanitizeText("safe\u001b[31m red\u001b[0m\u001bc\u0007\ttail"), "safe red tail");
	assert.equal(sanitizeText("a\u001b]8;;https://example.com\u0007b\u001b]8;;\u0007c"), "abc");
	assert.equal(sanitizeText("a\u001b]8;;https://example.com\u001b\\b\u001b]8;;\u001b\\c"), "abc");
	assert.equal(sanitizeText("a\u001bPpayload\u001b\\b"), "ab");
	assert.equal(sanitizeDiagnostic("bad\u001b]8;;https://example.com\u0007path\u001b]8;;\u0007\nnext"), "badpath next");
	assert.deepEqual(parseItem("  - safe\u001b[2J"), { level: 1, body: "safe" });
});

test("visibleWidth and wrapping handle CJK, combining marks, and emoji graphemes", () => {
	assert.equal(visibleWidth("Ae\u0301中👨‍👩‍👧‍👦"), 6);
	assert.deepEqual(wrapBody("中中abc", 4), ["中中", "abc"]);
	assert.deepEqual(wrapBody("👨‍👩‍👧‍👦x", 2), ["👨‍👩‍👧‍👦", "x"]);
});

test("wrapping always progresses at tiny widths", () => {
	assert.deepEqual(wrapBody("abc", 0), ["a", "b", "c"]);
	assert.equal(continuationPrefix("       ├─ RUN   "), "       │        ");
});
