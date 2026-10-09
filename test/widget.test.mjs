import assert from "node:assert/strict";
import test from "node:test";
import { capWidgetLines, VIEWER_MAX_CONTENT_LINES, WIDGET_MAX_LINES } from "../src/view.ts";

test("short widgets keep all rendered lines", () => {
	assert.deepEqual(capWidgetLines(["a", "b"], "more"), ["a", "b"]);
});

test("long widgets reserve the final row for the viewer hint", () => {
	const lines = Array.from({ length: 20 }, (_, index) => `line ${index}`);
	const capped = capWidgetLines(lines, "more");
	assert.equal(capped.length, WIDGET_MAX_LINES);
	assert.deepEqual(capped.slice(0, -1), lines.slice(0, WIDGET_MAX_LINES - 1));
	assert.equal(capped.at(-1), "more");
});

test("viewer height remains bounded", () => {
	assert.ok(VIEWER_MAX_CONTENT_LINES > WIDGET_MAX_LINES);
	assert.ok(VIEWER_MAX_CONTENT_LINES <= 20);
});
