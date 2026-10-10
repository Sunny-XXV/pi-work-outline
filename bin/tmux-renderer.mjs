#!/usr/bin/env node
import fs from "node:fs";
import process, { stderr, stdout } from "node:process";
import readline from "node:readline";
import { spawnSync } from "node:child_process";
import { styleText } from "node:util";
import {
	continuationPrefix,
	parseOutline,
	sanitizeDiagnostic,
	statusBadge,
	visibleWidth,
	wrapBody,
} from "../src/outline.mjs";

const outlinePath = process.argv[2];
const ownerPidIndex = process.argv.indexOf("--owner-pid");
const ownerPid = ownerPidIndex >= 0
	? Number.parseInt(process.argv[ownerPidIndex + 1] ?? "", 10)
	: undefined;

if (!outlinePath) {
	stderr.write("work-outline: missing outline path\n");
	process.exit(2);
}

function styleStatus(status) {
	const badge = statusBadge(status);
	if (!badge.text) return badge;
	const formats = (() => {
		switch (status) {
			case "WORK": return ["bgCyan", "black"];
			case "WAIT": return ["bgYellow", "black"];
			case "BLKD": return ["bgRed", "white"];
			case "HUMN": return ["bgRedBright", "white", "bold"];
			case "DONE": return ["bgGreen", "black"];
			case "HOLD": return ["bgMagenta", "white"];
			case "DROP": return ["bgGray", "black"];
			case "TODO": return ["bgWhite", "black"];
			default: return [];
		}
	})();
	return { ...badge, styled: styleText(badge.blink ? ["blink", ...formats] : formats, badge.text) };
}

function renderSource(source, readError) {
	const width = Math.max(1, stdout.columns || 80);
	if (readError) {
		return [styleText("redBright", `Cannot read ${sanitizeDiagnostic(outlinePath)}: ${sanitizeDiagnostic(readError)}`)];
	}

	const lines = [];
	for (const item of parseOutline(source)) {
		if (!item.body) {
			lines.push("");
			continue;
		}
		if ((item.body === "GOAL" || item.body === "WORK") && !item.tree) {
			lines.push(styleText("bold", item.body));
			continue;
		}

		const badge = styleStatus(item.status);
		const statusText = badge.text ? badge.leading + badge.text + badge.gap : "";
		const rawPrefix = item.tree + statusText;
		const styledPrefix = styleText("gray", item.tree + badge.leading) + (badge.styled ?? "") + badge.gap;
		const prefixWidth = visibleWidth(rawPrefix);
		if (prefixWidth >= width) {
			const fallback = `${item.status ? `${item.status} ` : ""}${item.body}`;
			lines.push(...wrapBody(fallback, width));
			continue;
		}
		for (const [index, body] of wrapBody(item.body, width - prefixWidth).entries()) {
			lines.push(index === 0
				? styledPrefix + body
				: styleText("gray", continuationPrefix(rawPrefix, item.childAnchor)) + body);
		}
	}
	return lines;
}

let source = "";
let readError;
let renderPending = false;
let closed = false;
let renderTimer;
const tmuxPane = process.env.TMUX_PANE?.trim();

function clearHistory() {
	if (!process.env.TMUX || !tmuxPane) return;
	spawnSync("tmux", ["clear-history", "-t", tmuxPane], {
		stdio: "ignore",
		timeout: 1_000,
	});
}

function discardPreviousFrame() {
	// CSI 3 J clears terminal scrollback even when tmux history management is unavailable.
	stdout.write("\u001b[3J");
	clearHistory();
}

function load() {
	try {
		source = fs.readFileSync(outlinePath, "utf8");
		readError = undefined;
	} catch (error) {
		readError = error instanceof Error ? error.message : String(error);
	}
}

function render() {
	if (closed) return;
	load();
	readline.cursorTo(stdout, 0, 0);
	readline.clearScreenDown(stdout);
	discardPreviousFrame();
	stdout.write(`${renderSource(source, readError).join("\n")}\n`);
}

function requestRender() {
	if (renderPending || closed) return;
	renderPending = true;
	renderTimer = setTimeout(() => {
		renderPending = false;
		renderTimer = undefined;
		render();
	}, 30);
}

function close() {
	if (closed) return;
	closed = true;
	fs.unwatchFile(outlinePath, requestRender);
	if (renderTimer) clearTimeout(renderTimer);
	if (ownerTimer) clearInterval(ownerTimer);
	process.exit(0);
}

function ownerIsAlive() {
	if (!ownerPid || !Number.isSafeInteger(ownerPid) || ownerPid <= 1) return true;
	try {
		process.kill(ownerPid, 0);
		return true;
	} catch (error) {
		return error?.code === "EPERM";
	}
}

const ownerTimer = ownerPid ? setInterval(() => {
	if (!ownerIsAlive()) close();
}, 500) : undefined;
ownerTimer?.unref();

fs.watchFile(outlinePath, { interval: 300 }, requestRender);
process.on("SIGWINCH", requestRender);
process.on("SIGHUP", close);
process.on("SIGINT", close);
process.on("SIGTERM", close);
render();
