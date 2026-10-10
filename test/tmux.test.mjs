import assert from "node:assert/strict";
import test from "node:test";
import {
	describeRenderMode,
	resolveNodeExecutable,
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

function withTmuxEnvironment(callback) {
	const originalTmux = process.env.TMUX;
	const originalPane = process.env.TMUX_PANE;
	process.env.TMUX = "socket";
	process.env.TMUX_PANE = "%0";
	try {
		return callback();
	} finally {
		if (originalTmux === undefined) delete process.env.TMUX;
		else process.env.TMUX = originalTmux;
		if (originalPane === undefined) delete process.env.TMUX_PANE;
		else process.env.TMUX_PANE = originalPane;
	}
}

function successfulStartRun(calls) {
	return (args) => {
		calls.push(args);
		if (args[0] === "display-message" && args.at(-1) === "#{pane_id}") {
			return result(0, args[3] === "%0" ? "%0\n" : "%1\n");
		}
		if (args[0] === "split-window") return result(0, "%1\n");
		if (args[0] === "set-option") return result(0);
		if (args.at(-1) === "#{pane_pid}\t#{pane_dead}\t#{pane_current_command}") {
			return result(0, `123\t0\t${process.platform === "win32" ? "node.exe" : "node"}\n`);
		}
		return result(1, "", "unexpected");
	};
}

test("tmux renderer passes paths as distinct arguments and marks ownership", () => withTmuxEnvironment(() => {
	const calls = [];
	const start = startTmuxRenderer(
		"/tmp/outline path $(literal).md",
		"owner",
		"/tmp/renderer path.mjs",
		41,
		successfulStartRun(calls),
	);
	assert.equal(start.paneId, "%1");
	const split = calls.find(([command]) => command === "split-window");
	assert.ok(split);
	assert.ok(split.includes("/tmp/outline path $(literal).md"));
	assert.ok(split.includes("/tmp/renderer path.mjs"));
	assert.ok(split.includes(process.execPath));
	assert.equal(split[split.indexOf("-p") + 1], "41");
	assert.equal(split.at(-2), "--owner-pid");
}));

test("tmux renderer keeps the 34 percent default", () => withTmuxEnvironment(() => {
	const calls = [];
	startTmuxRenderer("/tmp/outline.md", "owner", "/tmp/renderer.mjs", undefined, successfulStartRun(calls));
	const split = calls.find(([command]) => command === "split-window");
	assert.equal(split[split.indexOf("-p") + 1], "34");
}));

test("compiled hosts resolve a real Node executable through PATH", () => {
	const run = (command, args) => {
		assert.equal(command, "node");
		assert.deepEqual(args, ["-p", "process.execPath"]);
		return result(0, "/opt/node/bin/node\n");
	};
	assert.equal(resolveNodeExecutable("/nix/store/pi/bin/pi", run), "/opt/node/bin/node");
});

test("Node hosts use their own executable without PATH discovery", () => {
	assert.equal(resolveNodeExecutable("/opt/node/bin/node", () => { throw new Error("must not run"); }), "/opt/node/bin/node");
});

test("compiled-host discovery rejects a non-Node executable response", () => {
	assert.equal(resolveNodeExecutable("/nix/store/pi/bin/pi", () => result(0, "/nix/store/pi/bin/pi\n")), undefined);
});

test("startup rejects a live pane running the wrong command", () => withTmuxEnvironment(() => {
	let paneExists = true;
	const run = (args) => {
		if (args[0] === "display-message" && args.at(-1) === "#{pane_id}") {
			return result(paneExists ? 0 : 1, paneExists ? (args[3] === "%0" ? "%0\n" : "%1\n") : "");
		}
		if (args[0] === "split-window") return result(0, "%1\n");
		if (args[0] === "set-option") return result(0);
		if (args.at(-1) === "#{pane_pid}\t#{pane_dead}\t#{pane_current_command}") return result(0, "123\t0\tpi\n");
		if (args[0] === "show-option") return result(0, "owner\n");
		if (args[0] === "kill-pane") { paneExists = false; return result(0); }
		return result(1, "", "unexpected");
	};
	const start = startTmuxRenderer("/tmp/outline.md", "owner", "/tmp/renderer.mjs", 34, run);
	assert.equal(start.paneId, undefined);
	assert.match(start.error, /exited during startup/);
}));

test("startup rejects a dead retained pane", () => withTmuxEnvironment(() => {
	let paneExists = true;
	const run = (args) => {
		if (args[0] === "display-message" && args.at(-1) === "#{pane_id}") {
			return result(paneExists ? 0 : 1, paneExists ? (args[3] === "%0" ? "%0\n" : "%1\n") : "");
		}
		if (args[0] === "split-window") return result(0, "%1\n");
		if (args[0] === "set-option") return result(0);
		if (args.at(-1) === "#{pane_pid}\t#{pane_dead}\t#{pane_current_command}") return result(0, "123\t1\tnode\n");
		if (args[0] === "show-option") return result(0, "owner\n");
		if (args[0] === "kill-pane") { paneExists = false; return result(0); }
		return result(1, "", "unexpected");
	};
	const start = startTmuxRenderer("/tmp/outline.md", "owner", "/tmp/renderer.mjs", 34, run);
	assert.equal(start.paneId, undefined);
	assert.match(start.error, /exited during startup/);
}));

test("failed owned-pane cleanup is reported and remains discoverable", () => {
	const run = (args) => {
		if (args[0] === "display-message") return result(0, "%1\n");
		if (args[0] === "show-option") return result(0, "owner\n");
		if (args[0] === "kill-pane") return result(1, "", "busy");
		return result(1, "", "unexpected");
	};
	assert.equal(stopTmuxRenderer("%1", "owner", run), false);
});

test("unowned startup residuals can still be cleaned by their exact returned pane id", () => {
	let paneExists = true;
	const run = (args) => {
		if (args[0] === "display-message") return result(paneExists ? 0 : 1, paneExists ? "%1\n" : "");
		if (args[0] === "kill-pane") { paneExists = false; return result(0); }
		return result(1, "", "unexpected");
	};
	assert.equal(stopTmuxRenderer("%1", undefined, run), true);
	assert.equal(paneExists, false);
});

test("stop kills only a pane with matching ownership", () => {
	const calls = [];
	const run = (args) => {
		calls.push(args);
		if (args[0] === "display-message") return result(0, "%1\n");
		if (args[0] === "show-option") return result(0, "another-owner\n");
		return result(0);
	};
	assert.equal(stopTmuxRenderer("%1", "owner", run), true);
	assert.equal(calls.some(([command]) => command === "kill-pane"), false);
});

test("renderer mode descriptions do not claim a widget in headless mode", () => {
	assert.equal(describeRenderMode(undefined, undefined), "headless mode (observer file only)");
	assert.equal(describeRenderMode("widget", undefined), "Pi widget");
	assert.equal(describeRenderMode("tmux", "%7"), "tmux pane %7");
});
