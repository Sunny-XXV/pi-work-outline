import assert from "node:assert/strict";
import test from "node:test";
import {
	continuationPrefix,
	normalizeStatus,
	parseItem,
	parseOutline,
	renderRecords,
	sanitizeDiagnostic,
	statusBadge,
	sanitizeText,
	visibleWidth,
	wrapBody,
} from "../src/outline.ts";

test("parseOutline extracts canonical statuses, summaries, hierarchy, and legacy aliases", () => {
	const result = parseOutline(`# GOAL

- Ship the dashboard.

# WORK

- DONE Inspect sources
  - Three sources are reusable.
  - RUN Validate freshness
- TODO Build dashboard
- HUMAN Approve production access
`);
	assert.deepEqual(result, [
		{ tree: "", body: "GOAL" },
		{ tree: "  ", body: "Ship the dashboard." },
		{ tree: "", body: "" },
		{ tree: "", body: "WORK" },
		{ tree: "", status: "DONE", body: "Inspect sources", childAnchor: 0 },
		{ tree: "├─ ", body: "Three sources are reusable." },
		{ tree: "└─", status: "WORK", body: "Validate freshness" },
		{ tree: "", status: "TODO", body: "Build dashboard" },
		{ tree: "", status: "HUMN", body: "Approve production access" },
	]);
	assert.equal(normalizeStatus("RUN"), "WORK");
	assert.equal(normalizeStatus("BLOCK"), "BLKD");
	assert.equal(normalizeStatus("HUMAN"), "HUMN");
});

test("renderRecords clamps indentation jumps while retaining a valid tree", () => {
	assert.deepEqual(renderRecords([
		{ level: 0, status: "WORK", body: "root" },
		{ level: 4, body: "jump" },
		{ level: 1, body: "sibling" },
	]), [
		{ tree: "", status: "WORK", body: "root", childAnchor: 0 },
		{ tree: "├─ ", body: "jump" },
		{ tree: "└─ ", body: "sibling" },
	]);
});

test("nested guides join parent badge edges and preserve ancestor lines", () => {
	assert.deepEqual(renderRecords([
		{ level: 0, status: "DONE", body: "root" },
		{ level: 1, status: "WORK", body: "child" },
		{ level: 2, body: "grandchild" },
		{ level: 1, status: "TODO", body: "sibling" },
		{ level: 0, status: "DONE", body: "next root" },
	]), [
		{ tree: "", status: "DONE", body: "root", childAnchor: 0 },
		{ tree: "├─", status: "WORK", body: "child", childAnchor: 2 },
		{ tree: "│ └─ ", body: "grandchild" },
		{ tree: "└─", status: "TODO", body: "sibling" },
		{ tree: "", status: "DONE", body: "next root" },
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

test("status badges use one uniform four-letter label with colored side cells", () => {
	for (const status of ["TODO", "WORK", "WAIT", "BLKD", "HUMN", "DONE", "HOLD", "DROP"]) {
		const badge = statusBadge(status);
		assert.equal(badge.leading, "");
		assert.equal(visibleWidth(badge.text), 6);
		assert.equal(badge.text, ` ${status} `);
		assert.equal(badge.gap, " ");
	}
	assert.deepEqual(statusBadge("HUMAN"), statusBadge("HUMN"));
	assert.deepEqual(statusBadge("BLOCK"), statusBadge("BLKD"));
	assert.deepEqual(statusBadge("RUN"), statusBadge("WORK"));
});

test("continuation rows retain ancestor guides and tagged-parent child stems", () => {
	assert.equal(continuationPrefix(" WORK  ", 0), "│      ");
	assert.equal(continuationPrefix("├─ WORK  ", 2), "│ │      ");
});

test("visibleWidth and wrapping handle CJK, combining marks, and emoji graphemes", () => {
	assert.equal(visibleWidth("Ae\u0301中👨‍👩‍👧‍👦"), 6);
	assert.deepEqual(wrapBody("中中abc", 4), ["中中", "abc"]);
	assert.deepEqual(wrapBody("👨‍👩‍👧‍👦x", 2), ["👨‍👩‍👧‍👦", "x"]);
});

test("wrapping always progresses at tiny widths", () => {
	assert.deepEqual(wrapBody("abc", 0), ["a", "b", "c"]);
});
