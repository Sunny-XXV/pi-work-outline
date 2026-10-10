import * as fs from "node:fs";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	matchesKey,
	type Component,
	type TUI,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { continuationPrefix, parseOutline, statusBadge, type Status } from "./outline.ts";
import { capWidgetLines, VIEWER_MAX_CONTENT_LINES, WIDGET_MAX_LINES } from "./view.ts";

function styleStatus(theme: Theme, status: Status): string {
	const badge = statusBadge(status);
	const style = (() => {
		switch (status) {
			case "RUN": return { fg: theme.colors.toolPendingBg, bg: theme.colors.accent };
			case "WAIT": return { fg: theme.colors.toolPendingBg, bg: theme.colors.warning };
			case "BLOCK": return { fg: theme.colors.toolErrorBg, bg: theme.colors.error };
			case "HUMAN": return { fg: theme.colors.toolErrorBg, bg: theme.colors.error, bold: true };
			case "DONE": return { fg: theme.colors.toolSuccessBg, bg: theme.colors.success };
			case "HOLD": return { fg: theme.colors.customMessageBg, bg: theme.colors.customMessageLabel };
			case "DROP": return { fg: theme.colors.toolPendingBg, bg: theme.colors.dim };
			case "TODO": return { fg: theme.colors.toolPendingBg, bg: theme.colors.muted };
		}
	})();
	const styled = theme.style(badge.text, style);
	return badge.blink ? `\u001b[5m${styled}\u001b[25m` : styled;
}

function stylePrefix(theme: Theme, tree: string, status: Status | undefined): { raw: string; styled: string } {
	const badge = status ? statusBadge(status) : undefined;
	const statusText = badge ? badge.text + badge.gap : "";
	return {
		raw: tree + statusText,
		styled: theme.fg("dim", tree) + (status && badge ? styleStatus(theme, status) + badge.gap : ""),
	};
}

function renderOutlineLines(
	source: string,
	readError: string | undefined,
	outlinePath: string,
	theme: Theme,
	width: number,
): string[] {
	if (width <= 0) return [];
	if (readError) {
		return [truncateToWidth(theme.fg("error", `Cannot read ${outlinePath}: ${readError}`), width, "")];
	}

	const lines: string[] = [];
	for (const item of parseOutline(source)) {
		if (item.body === "") {
			lines.push("");
			continue;
		}
		if ((item.body === "GOAL" || item.body === "WORK") && item.tree === "") {
			lines.push(truncateToWidth(theme.bold(item.body), width, ""));
			continue;
		}

		const prefix = stylePrefix(theme, item.tree, item.status);
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
				: theme.fg("dim", continuationPrefix(prefix.raw)) + body;
			lines.push(truncateToWidth(line, width, ""));
		}
	}
	return lines;
}

class WatchedOutline {
	private source = "";
	private readError: string | undefined;
	private disposed = false;
	private readonly outlinePath: string;
	private readonly onChange: () => void;
	private readonly watchListener = () => this.reload();

	constructor(outlinePath: string, onChange: () => void) {
		this.outlinePath = outlinePath;
		this.onChange = onChange;
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
		this.onChange();
	}

	render(theme: Theme, width: number): string[] {
		return renderOutlineLines(this.source, this.readError, this.outlinePath, theme, width);
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		fs.unwatchFile(this.outlinePath, this.watchListener);
	}
}

export class WorkOutlineComponent implements Component {
	private readonly tui: TUI;
	private readonly theme: Theme;
	private readonly outline: WatchedOutline;

	constructor(tui: TUI, theme: Theme, outlinePath: string) {
		this.tui = tui;
		this.theme = theme;
		this.outline = new WatchedOutline(outlinePath, () => this.tui.requestRender());
	}

	render(width: number): string[] {
		const lines = this.outline.render(this.theme, width);
		const hidden = Math.max(0, lines.length - WIDGET_MAX_LINES + 1);
		const hint = truncateToWidth(
			this.theme.fg("dim", `… ${hidden} more lines · /work-outline view`),
			Math.max(0, width),
			"",
		);
		return capWidgetLines(lines, hint);
	}

	invalidate(): void {}

	dispose(): void {
		this.outline.dispose();
	}
}

export class WorkOutlineViewerComponent implements Component {
	private readonly tui: TUI;
	private readonly theme: Theme;
	private readonly done: () => void;
	private readonly outline: WatchedOutline;
	private scrollOffset = 0;
	private closed = false;

	constructor(tui: TUI, theme: Theme, outlinePath: string, done: () => void) {
		this.tui = tui;
		this.theme = theme;
		this.done = done;
		this.outline = new WatchedOutline(outlinePath, () => this.tui.requestRender());
	}

	private close(): void {
		if (this.closed) return;
		this.closed = true;
		this.done();
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c") || data === "q") {
			this.close();
			return;
		}
		if (matchesKey(data, "up")) this.scrollOffset -= 1;
		else if (matchesKey(data, "down")) this.scrollOffset += 1;
		else if (matchesKey(data, "pageUp")) this.scrollOffset -= VIEWER_MAX_CONTENT_LINES;
		else if (matchesKey(data, "pageDown")) this.scrollOffset += VIEWER_MAX_CONTENT_LINES;
		else if (matchesKey(data, "home")) this.scrollOffset = 0;
		else if (matchesKey(data, "end")) this.scrollOffset = Number.MAX_SAFE_INTEGER;
		else return;
		this.tui.requestRender();
	}

	render(width: number): string[] {
		if (width <= 0) return [];
		const lines = this.outline.render(this.theme, width);
		const maxOffset = Math.max(0, lines.length - VIEWER_MAX_CONTENT_LINES);
		this.scrollOffset = Math.min(maxOffset, Math.max(0, this.scrollOffset));
		const visible = lines.slice(this.scrollOffset, this.scrollOffset + VIEWER_MAX_CONTENT_LINES);
		const above = this.scrollOffset;
		const below = Math.max(0, lines.length - this.scrollOffset - visible.length);
		return [
			truncateToWidth(this.theme.bold("WORK OUTLINE"), width, ""),
			...visible,
			truncateToWidth(
				this.theme.fg("dim", `↑ ${above} · ↓ ${below} · arrows/page/home/end scroll · Esc/q close`),
				width,
				"",
			),
		];
	}

	invalidate(): void {}

	dispose(): void {
		this.outline.dispose();
	}
}
