import { stripVTControlCharacters } from "node:util";

export const STATUSES = ["TODO", "RUN", "WAIT", "BLOCK", "HUMAN", "DONE", "HOLD", "DROP"];

const STATUS_SET = new Set(STATUSES);
const BLINKING_STATUS_SET = new Set(["RUN", "WAIT", "BLOCK", "HUMAN", "HOLD"]);
const STATUS_LABEL_WIDTH = Math.max(...STATUSES.map((status) => status.length));
const SEGMENTER = typeof Intl.Segmenter === "function"
	? new Intl.Segmenter(undefined, { granularity: "grapheme" })
	: undefined;
const CONTROL_STRING_PATTERN = /(?:\u001B|\u009B)(?:\]|P|X|\^|_)[\s\S]*?(?:\u0007|\u001B\\|\u009C)/g;
const CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

export function isStatus(value) {
	return STATUS_SET.has(value);
}

export function statusBadge(status) {
	if (!isStatus(status)) return { leading: "", text: "", gap: "", blink: false };
	return {
		leading: " ".repeat(STATUS_LABEL_WIDTH - status.length),
		text: ` ${status} `,
		gap: " ",
		blink: BLINKING_STATUS_SET.has(status),
	};
}

export function sanitizeText(value) {
	return stripVTControlCharacters(value.replace(CONTROL_STRING_PATTERN, ""))
		.replace(CONTROL_PATTERN, "")
		.replace(/\t/g, " ");
}

export function sanitizeDiagnostic(value) {
	return sanitizeText(value).replace(/[\r\n]+/g, " ");
}

export function parseItem(line) {
	const match = /^( *)- (.*)$/.exec(line);
	if (!match) return undefined;
	return {
		level: Math.floor(match[1].length / 2),
		body: sanitizeText(match[2]),
	};
}

function isLastAtLevel(records, index) {
	const level = records[index].level;
	for (let laterIndex = index + 1; laterIndex < records.length; laterIndex += 1) {
		const later = records[laterIndex];
		if (later.level < level) return true;
		if (later.level === level) return false;
	}
	return true;
}

export function renderRecords(records) {
	const normalized = [];
	for (const record of records) {
		const previousLevel = normalized.at(-1)?.level ?? -1;
		normalized.push({ ...record, level: Math.min(record.level, previousLevel + 1) });
	}

	const lastFlags = normalized.map((_record, index) => isLastAtLevel(normalized, index));
	const ancestors = [];
	const output = [];

	for (const [index, record] of normalized.entries()) {
		const { level } = record;
		ancestors.length = level;
		let tree = "";
		if (level > 0) {
			tree = "       ";
			for (let depth = 1; depth < level; depth += 1) {
				const ancestorIndex = ancestors[depth];
				tree += lastFlags[ancestorIndex] ? "   " : "│  ";
			}
			tree += lastFlags[index] ? "└─ " : "├─ ";
		}
		output.push(record.status
			? { tree, status: record.status, body: record.body }
			: { tree, body: record.body });
		ancestors.push(index);
	}
	return output;
}

export function parseOutline(source) {
	const goal = [];
	const records = [];
	let section = "";

	for (const line of source.split(/\r?\n/)) {
		if (line === "# GOAL" || line === "# WORK") {
			section = line.slice(2);
			if (section === "GOAL") goal.push({ tree: "", body: "GOAL" });
			continue;
		}
		if (!line.trim()) continue;
		const item = parseItem(line);
		if (!item) continue;
		if (section === "GOAL") {
			goal.push({ tree: "  ", body: item.body });
			continue;
		}
		if (section !== "WORK") continue;
		const [candidate, ...rest] = item.body.split(/\s+/);
		if (candidate && isStatus(candidate) && rest.length > 0) {
			records.push({ level: item.level, status: candidate, body: rest.join(" ") });
		} else {
			records.push({ level: item.level, body: item.body });
		}
	}

	return [...goal, { tree: "", body: "" }, { tree: "", body: "WORK" }, ...renderRecords(records)];
}

export function continuationPrefix(prefix) {
	return [...prefix].map((character) => (character === "│" || character === "├" ? "│" : " ")).join("");
}

function graphemes(text) {
	if (!SEGMENTER) return [...text];
	return Array.from(SEGMENTER.segment(text), ({ segment }) => segment);
}

function graphemeWidth(grapheme) {
	if (!grapheme) return 0;
	if (/^[\p{Mark}\p{Cf}\p{Cc}]+$/u.test(grapheme)) return 0;
	if (/\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(grapheme)) return 2;
	const codePoint = grapheme.codePointAt(0);
	return codePoint >= 0x1100 && (
		codePoint <= 0x115f ||
		codePoint === 0x2329 ||
		codePoint === 0x232a ||
		(codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
		(codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
		(codePoint >= 0xf900 && codePoint <= 0xfaff) ||
		(codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
		(codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
		(codePoint >= 0xff00 && codePoint <= 0xff60) ||
		(codePoint >= 0xffe0 && codePoint <= 0xffe6)
	) ? 2 : 1;
}

export function visibleWidth(text) {
	return graphemes(sanitizeText(text)).reduce((width, grapheme) => width + graphemeWidth(grapheme), 0);
}

function splitAtWidth(text, limit) {
	const units = graphemes(text);
	let width = 0;
	let end = 0;
	let breakAt = -1;
	let resumeAt = -1;

	for (const [index, grapheme] of units.entries()) {
		const nextWidth = graphemeWidth(grapheme);
		if (width + nextWidth > limit) break;
		width += nextWidth;
		end = index + 1;
		if (/\s/u.test(grapheme) || "，；。：、,;".includes(grapheme)) {
			breakAt = /\s/u.test(grapheme) ? index : index + 1;
			resumeAt = index + 1;
		}
	}

	if (end === units.length) return [text, ""];
	if (end === 0) return [units[0], units.slice(1).join("")];
	if (breakAt > 0 && visibleWidth(units.slice(0, breakAt).join("")) >= Math.floor(limit / 2)) {
		return [
			units.slice(0, breakAt).join("").trimEnd(),
			units.slice(resumeAt).join("").trimStart(),
		];
	}
	return [units.slice(0, end).join(""), units.slice(end).join("")];
}

export function wrapBody(body, width) {
	const output = [];
	let remaining = sanitizeText(body);
	const limit = Math.max(1, width);
	while (remaining) {
		const [line, rest] = splitAtWidth(remaining, limit);
		output.push(line);
		remaining = rest;
	}
	return output.length ? output : [""];
}
