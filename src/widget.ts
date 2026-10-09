import * as fs from "node:fs";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	type TUI,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { continuationPrefix, parseOutline, type Status } from "./outline.ts";

function statusColor(theme: Theme, status: Status, text: string): string {
	switch (status) {
		case "RUN":
			return theme.fg("accent", text);
		case "WAIT":
			return theme.fg("warning", text);
		case "BLOCK":
			return theme.fg("error", text);
		case "DONE":
			return theme.fg("success", text);
		case "HOLD":
			return theme.fg("warning", text);
		case "DROP":
			return theme.fg("dim", text);
		case "TODO":
			return theme.fg("muted", text);
	}
}

export class WorkOutlineComponent implements Component {
	private source = "";
	private readError: string | undefined;
	private disposed = false;
	private readonly watchListener = () => this.reload();

	constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
		private readonly outlinePath: string,
	) {
		this.reload();
		fs.watchFile(this.outlinePath, { interval: 300 }, this.watchListener);
	}

	private reload(): void {
		if (this.disposed) return;
		try {
			const next = fs.readFileSync(this.outlinePath, "utf8");
			if (next === this.source && this.readError === undefined) return;
			this.source = next;
			this.readError = undefined;
		} catch (error) {
			const nextError = error instanceof Error ? error.message : String(error);
			if (nextError === this.readError) return;
			this.readError = nextError;
		}
		this.tui.requestRender();
	}

	private stylePrefix(tree: string, status: Status | undefined): { raw: string; styled: string } {
		const statusText = status ? status.padEnd(tree ? 6 : 7) : "";
		return {
			raw: tree + statusText,
			styled: this.theme.fg("dim", tree) + (status ? statusColor(this.theme, status, statusText) : ""),
		};
	}

	render(width: number): string[] {
		if (width <= 0) return [];
		if (this.readError) {
			return [truncateToWidth(this.theme.fg("error", `Cannot read ${this.outlinePath}: ${this.readError}`), width, "")];
		}

		const lines: string[] = [];
		for (const item of parseOutline(this.source)) {
			if (item.body === "") {
				lines.push("");
				continue;
			}
			if ((item.body === "GOAL" || item.body === "WORK") && item.tree === "") {
				lines.push(truncateToWidth(this.theme.bold(item.body), width, ""));
				continue;
			}

			const prefix = this.stylePrefix(item.tree, item.status);
			if (visibleWidth(prefix.raw) >= width) {
				const fallback = `${item.status ? `${item.status} ` : ""}${item.body}`;
				lines.push(...wrapTextWithAnsi(fallback, width).map((line) => truncateToWidth(line, width, "")));
				continue;
			}
			const available = width - visibleWidth(prefix.raw);
			const wrapped = wrapTextWithAnsi(item.body, available);
			for (const [index, body] of wrapped.entries()) {
				const line = index === 0
					? prefix.styled + body
					: this.theme.fg("dim", continuationPrefix(prefix.raw)) + body;
				lines.push(truncateToWidth(line, width, ""));
			}
		}
		return lines;
	}

	invalidate(): void {}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		fs.unwatchFile(this.outlinePath, this.watchListener);
	}
}
