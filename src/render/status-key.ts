import { BAR_TRACK, FONT_FAMILY, KEY_BACKGROUND, STATE_COLORS, contextColor } from "./colors";

export type StatusState = "working" | "approval" | "input" | "done" | "idle";

export interface StatusKeyInput {
	project: string;
	state: StatusState;
	contextPercent: number | null;
	flash?: boolean;
}

const LABELS: Record<StatusState, string> = {
	working: "Working",
	approval: "Approve",
	input: "Input",
	done: "Done",
	idle: "Idle",
};

const BAR_WIDTH = 108;
const KEY_RECT = `x="6" y="6" width="132" height="132" rx="20"`;

export function escapeXml(text: string): string {
	return text
		.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
		.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);
}

/** Cuts by code points so emoji are never split (a lone surrogate makes encodeURIComponent throw). */
export function truncate(text: string, max: number): string {
	const chars = Array.from(text);
	return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : text;
}

export function toDataUrl(svg: string): string {
	return `data:image/svg+xml;charset=utf8,${encodeURIComponent(svg)}`;
}

export function svgDocument(body: string[]): string {
	return [
		`<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144" font-family="${FONT_FAMILY}">`,
		...body,
		"</svg>",
	].join("\n");
}

export function renderStatusKey({ project, state, contextPercent, flash = false }: StatusKeyInput): string {
	const color = STATE_COLORS[state];
	const percent =
		contextPercent === null || !Number.isFinite(contextPercent) ? null : Math.round(Math.min(100, Math.max(0, contextPercent)));
	const ctxColor = percent === null ? STATE_COLORS.idle : contextColor(percent);
	const name = truncate(project, 10);
	const nameSize = Array.from(name).length <= 7 ? 21 : 17;
	// ponytail: glow faked with stacked strokes, the Stream Deck SVG renderer has no filters
	const border = flash
		? `<rect class="border" ${KEY_RECT} fill="none" stroke="#FFFFFF" stroke-width="4"/>`
		: [9, 6, 3]
				.map((w, i) => `<rect class="border" ${KEY_RECT} fill="none" stroke="${color}" stroke-width="${w}" stroke-opacity="${[0.15, 0.3, 1][i]}"/>`)
				.join("");
	return svgDocument([
		`<defs><radialGradient id="tint" cx="50%" cy="30%" r="80%"><stop offset="0" stop-color="${color}" stop-opacity="0.30"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient></defs>`,
		`<rect width="144" height="144" fill="#000000"/>`,
		`<rect ${KEY_RECT} fill="${KEY_BACKGROUND}"/>`,
		`<rect ${KEY_RECT} fill="url(#tint)"/>`,
		border,
		`<text x="72" y="52" text-anchor="middle" font-size="${nameSize}" font-weight="700" fill="#FFFFFF">${escapeXml(name)}</text>`,
		`<text x="18" y="92" font-size="15" font-weight="600" fill="${color}">${LABELS[state]}</text>`,
		`<text x="126" y="92" text-anchor="end" font-size="15" font-weight="600" fill="${ctxColor}">${percent === null ? "--" : `${percent}%`}</text>`,
		...(percent === null
			? []
			: [
					`<g id="bar"><rect x="18" y="104" width="${BAR_WIDTH}" height="8" rx="4" fill="${BAR_TRACK}"/><rect x="18" y="104" width="${(BAR_WIDTH * percent) / 100}" height="8" rx="4" fill="${ctxColor}"/></g>`,
				]),
	]);
}

export function renderEmptyStatusKey(): string {
	return svgDocument([
		`<rect width="144" height="144" fill="#000000"/>`,
		`<rect ${KEY_RECT} fill="${KEY_BACKGROUND}" stroke="${BAR_TRACK}" stroke-width="2"/>`,
	]);
}
