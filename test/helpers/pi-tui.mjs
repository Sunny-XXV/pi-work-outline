export function matchesKey(data, key) { return data === key; }
export function truncateToWidth(value, width) { return value.slice(0, Math.max(0, width)); }
export function visibleWidth(value) { return [...value].length; }
export function wrapTextWithAnsi(value) { return [value]; }
