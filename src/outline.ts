export * from "./outline.mjs";

export const STATUSES = ["TODO", "RUN", "WAIT", "BLOCK", "HUMAN", "DONE", "HOLD", "DROP"] as const;
export type Status = (typeof STATUSES)[number];
export type RecordItem = { level: number; status?: Status; body: string };
export type DisplayItem = { tree: string; status?: Status; body: string };

export {
	continuationPrefix,
	isStatus,
	parseItem,
	parseOutline,
	renderRecords,
	sanitizeDiagnostic,
	statusBadge,
	sanitizeText,
	visibleWidth,
	wrapBody,
} from "./outline.mjs";
