import { BAR_TRACK, KEY_BACKGROUND, STATE_COLORS, contextColor } from "./colors";
import { escapeXml, svgDocument } from "./status-key";

/** Percent used per plan limit; null when unknown or the window has reset. */
export interface UsageKeyInput {
	fiveHour: number | null;
	sevenDay: number | null;
}

/** Reset label per plan limit (see resetLabel); null when unknown. */
export interface UsageResetInput {
	fiveHour: string | null;
	sevenDay: string | null;
}

const BAR_WIDTH = 108;
const DIM = STATE_COLORS.idle;
const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

/** "23:50" when the reset is today, else "Mo 09:00" (German weekday, local 24h time). */
export function resetLabel(resetsAt: Date, now: Date): string {
	const time = `${String(resetsAt.getHours()).padStart(2, "0")}:${String(resetsAt.getMinutes()).padStart(2, "0")}`;
	return resetsAt.toDateString() === now.toDateString() ? time : `${WEEKDAYS[resetsAt.getDay()]} ${time}`;
}

function frame(title: string): string[] {
	return [
		`<rect width="144" height="144" fill="#000000"/>`,
		`<rect x="6" y="6" width="132" height="132" rx="20" fill="${KEY_BACKGROUND}" stroke="${BAR_TRACK}" stroke-width="2"/>`,
		`<text x="72" y="34" text-anchor="middle" font-size="14" font-weight="600" fill="${DIM}">${title}</text>`,
	];
}

const label = (text: string, y: number) => `<text x="18" y="${y}" font-size="16" font-weight="600" fill="#FFFFFF">${text}</text>`;
const value = (text: string, y: number, color: string) =>
	`<text x="126" y="${y}" text-anchor="end" font-size="18" font-weight="700" fill="${color}">${escapeXml(text)}</text>`;

function usageRow(name: string, percentUsed: number | null, y: number): string[] {
	const percent = percentUsed === null || !Number.isFinite(percentUsed) ? null : Math.round(Math.min(100, Math.max(0, percentUsed)));
	const color = percent === null ? DIM : contextColor(percent);
	return [
		label(name, y),
		value(percent === null ? "--" : `${percent}%`, y, color),
		`<rect x="18" y="${y + 8}" width="${BAR_WIDTH}" height="6" rx="3" fill="${BAR_TRACK}"/>`,
		...(percent ? [`<rect x="18" y="${y + 8}" width="${(BAR_WIDTH * percent) / 100}" height="6" rx="3" fill="${color}"/>`] : []),
	];
}

export function renderUsageKey({ fiveHour, sevenDay }: UsageKeyInput): string {
	return svgDocument([...frame("USAGE"), ...usageRow("5h", fiveHour, 66), ...usageRow("7d", sevenDay, 106)]);
}

export function renderUsageResetKey({ fiveHour, sevenDay }: UsageResetInput): string {
	const row = (name: string, reset: string | null, y: number) => [label(name, y), value(reset ?? "--", y, reset ? "#FFFFFF" : DIM)];
	return svgDocument([...frame("RESET"), ...row("5h", fiveHour, 72), ...row("7d", sevenDay, 106)]);
}
