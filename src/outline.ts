export * from "./outline.mjs";

export const STATUSES = ["TODO", "WORK", "WAIT", "BLKD", "HUMN", "DONE", "HOLD", "DROP"] as const;
export type Status = (typeof STATUSES)[number];
export type LegacyStatus = "RUN" | "BLOCK" | "HUMAN";
export type RecordItem = { level: number; status?: Status | LegacyStatus; body: string };
export type DisplayItem = { tree: string; status?: Status; body: string; childAnchor?: number };

export {
	continuationPrefix,
	isStatus,
	normalizeStatus,
	parseItem,
	parseOutline,
	renderRecords,
	sanitizeDiagnostic,
	statusBadge,
	sanitizeText,
	visibleWidth,
	wrapBody,
} from "./outline.mjs";
