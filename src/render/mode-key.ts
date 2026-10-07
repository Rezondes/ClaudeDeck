import { escapeXml, svgDocument, truncate } from "./status-key.js";

const ACCENT = "#2F7BFF";
const LABELS: Record<string, string> = { acceptEdits: "Edits", plan: "Plan", default: "Default", auto: "Auto", bypassPermissions: "Bypass" };

export interface ModeKeyInput {
	/** Mode this key switches to. */
	mode: string;
	/** A permission request is waiting. */
	pending: boolean;
	/** Mode of the most recently active session, if known. */
	currentMode: string | undefined;
	/** Project of the request the key would answer (shown while pending). */
	project?: string;
}

const label = (mode: string) => LABELS[mode] ?? mode;

/** "Allow + mode" key: lit while a request waits, otherwise dim with the current session mode. */
export function renderModeKey({ mode, pending, currentMode, project }: ModeKeyInput): string {
	if (pending) {
		return svgDocument([
			`<rect width="144" height="144" fill="#000000"/>`,
			`<rect x="6" y="6" width="132" height="132" rx="20" fill="${ACCENT}"/>`,
			`<text x="72" y="58" text-anchor="middle" font-size="20" font-weight="700" fill="#FFFFFF">Allow +</text>`,
			`<text x="72" y="92" text-anchor="middle" font-size="24" font-weight="700" fill="#FFFFFF">${escapeXml(label(mode))}</text>`,
			...(project ? [`<text x="72" y="120" text-anchor="middle" font-size="14" fill="#FFFFFF" fill-opacity="0.85">${escapeXml(truncate(project, 14))}</text>`] : []),
		]);
	}
	return svgDocument([
		`<rect width="144" height="144" fill="#000000"/>`,
		`<rect x="6" y="6" width="132" height="132" rx="20" fill="#0B0C0E" stroke="${ACCENT}" stroke-width="3" stroke-opacity="0.6"/>`,
		`<text x="72" y="54" text-anchor="middle" font-size="16" fill="${ACCENT}" fill-opacity="0.7">Mode</text>`,
		`<text x="72" y="84" text-anchor="middle" font-size="22" font-weight="700" fill="${ACCENT}" fill-opacity="0.85">${escapeXml(currentMode ? label(currentMode) : "--")}</text>`,
		`<text x="72" y="116" text-anchor="middle" font-size="14" fill="#8A8F98">to ${escapeXml(label(mode))}</text>`,
	]);
}
