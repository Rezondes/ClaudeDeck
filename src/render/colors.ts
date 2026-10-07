export const STATE_COLORS = {
	working: "#2F7BFF",
	approval: "#F5C518",
	input: "#B05CE6",
	done: "#2FBF5B",
	idle: "#8A8F98",
} as const;

export const DECISION_COLORS = {
	allow: "#2FBF5B",
	always: "#F5C518",
	deny: "#E5484D",
} as const;

export const CONTEXT_COLORS = {
	low: "#2FBF5B",
	mid: "#F5C518",
	high: "#E5484D",
} as const;

export const KEY_BACKGROUND = "#101216";
export const BAR_TRACK = "#2A2D33";
export const FONT_FAMILY = "Segoe UI, Arial, sans-serif";

export function contextColor(percent: number): string {
	if (percent >= 80) return CONTEXT_COLORS.high;
	if (percent >= 50) return CONTEXT_COLORS.mid;
	return CONTEXT_COLORS.low;
}
