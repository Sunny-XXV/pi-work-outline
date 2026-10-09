export const WIDGET_MAX_LINES = 8;
export const VIEWER_MAX_CONTENT_LINES = 15;

export function capWidgetLines(lines: string[], hint: string, maxLines = WIDGET_MAX_LINES): string[] {
	if (maxLines <= 0) return [];
	if (lines.length <= maxLines) return lines;
	if (maxLines === 1) return [hint];
	return [...lines.slice(0, maxLines - 1), hint];
}
