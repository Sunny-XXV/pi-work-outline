import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_WORK_OUTLINE_SETTINGS, resolveWorkOutlineSettings } from "../src/settings.ts";

test("work-outline settings use documented defaults", () => {
	assert.deepEqual(resolveWorkOutlineSettings(undefined), DEFAULT_WORK_OUTLINE_SETTINGS);
});

test("project settings override user settings per field", () => {
	assert.deepEqual(resolveWorkOutlineSettings(
		{ "work-outline": { defaultRenderer: "tmux", tmuxSplitPercent: 28 } },
		{ "work-outline": { defaultRenderer: "widget" } },
	), { renderer: "widget", tmuxPanePercent: 28 });
});

test("draft setting names remain compatible", () => {
	assert.deepEqual(resolveWorkOutlineSettings(
		{ "work-outline": { renderer: "widget", tmuxPanePercent: 35 } },
	), { renderer: "widget", tmuxPanePercent: 35 });
});

test("invalid settings fall back safely", () => {
	assert.deepEqual(resolveWorkOutlineSettings(
		{ "work-outline": { defaultRenderer: "invalid", tmuxSplitPercent: 9 } },
		{ "work-outline": { tmuxSplitPercent: 81 } },
	), DEFAULT_WORK_OUTLINE_SETTINGS);
});

test("invalid project values do not reactivate overridden user values", () => {
	assert.deepEqual(resolveWorkOutlineSettings(
		{ "work-outline": { defaultRenderer: "widget", tmuxSplitPercent: 40 } },
		{ "work-outline": { defaultRenderer: "invalid", tmuxSplitPercent: 4 } },
	), DEFAULT_WORK_OUTLINE_SETTINGS);
});

test("tmux pane percentage accepts the documented boundaries", () => {
	assert.equal(resolveWorkOutlineSettings({ "work-outline": { tmuxSplitPercent: 10 } }).tmuxPanePercent, 10);
	assert.equal(resolveWorkOutlineSettings({ "work-outline": { tmuxSplitPercent: 80 } }).tmuxPanePercent, 80);
});
