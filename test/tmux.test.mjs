import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
	describeRenderMode,
	startTmuxRenderer,
	stopTmuxRenderer,
} from "../src/tmux.ts";

function result(status, stdout = "", stderr = "") {
	return {
		pid: 1,
		output: [null, stdout, stderr],
		stdout,
		stderr,
		status,
		signal: null,
		error: undefined,
	};
}

test("tmux renderer passes paths as distinct arguments and marks ownership", () => {
	const originalTmux = process.env.TMUX;
	const originalPane = process.env.TMUX_PANE;
	process.env.TMUX = "socket";
	process.env.TMUX_PANE = "%0";
	const calls = [];
	const run = (args) => {
		calls.push(args);
		if (args[0] === "display-message" && args.at(-1) === "#{pane_id}") return result(0, args[3] === "%0" ? "%0\n" : "%1\n");
		if (args[0] === "split-window") return result(0, "%1\n");
		if (args[0] === "set-option") return result(0);
		if (args.at(-1) === "#{pane_pid}") return result(0, "123\n");
		return result(1, "", "unexpected");
	};

	try {
		const start = startTmuxRenderer(
			"/tmp/outline path $(literal).md",
			"owner",
			"/tmp/renderer path.mjs",
			run,
		);
		assert.equal(start.paneId, "%1");
		const split = calls.find(([command]) => command === "split-window");
		assert.ok(split);
		assert.ok(split.includes("/tmp/outline path $(literal).md"));
		assert.ok(split.includes("/tmp/renderer path.mjs"));
		assert.equal(split.at(-2), "--owner-pid");
	} finally {
		if (originalTmux === undefined) delete process.env.TMUX;
		else process.env.TMUX = originalTmux;
		if (originalPane === undefined) delete process.env.TMUX_PANE;
		else process.env.TMUX_PANE = originalPane;
	}
});

test("stop kills only a pane with matching ownership", () => {
	const calls = [];
	const run = (args) => {
		calls.push(args);
		if (args[0] === "display-message") return result(0, "%1\n");
		if (args[0] === "show-option") return result(0, "another-owner\n");
		return result(0);
	};
	stopTmuxRenderer("%1", "owner", run);
	assert.equal(calls.some(([command]) => command === "kill-pane"), false);
});

test("renderer mode descriptions do not claim a widget in headless mode", () => {
	assert.equal(describeRenderMode(undefined, undefined), "headless mode (observer file only)");
	assert.equal(describeRenderMode("widget", undefined), "Pi widget");
	assert.equal(describeRenderMode("tmux", "%7"), "tmux pane %7");
});

test("node is available for the real tmux renderer launcher", () => {
	assert.equal(spawnSync("node", ["-p", "process.execPath"]).status, 0);
});
